// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PackedUserOperation} from "./IAccount.sol";
import {Attestation, IEAS} from "./IEAS.sol";
import {IEntryPointStake, IPaymaster, PostOpMode} from "./IPaymaster.sol";
import {IPrescriptionRegistry} from "./IPrescriptionRegistry.sol";
import {PrescriptionRegistry} from "./PrescriptionRegistry.sol";

/// @title PrescriptionPaymaster
/// @notice Pays the gas for prescription operations, so a doctor never owns
///         AVAX. Fase 5 item 6 of docs/18-tareas-por-fases.md, verbatim:
///         "solo llamadas a `PrescriptionRegistry`, solo cuentas acreditadas,
///         con límite por cuenta y ventana".
///
/// @dev THE POLICY, in the order this contract applies it:
///
///        1. The operation must be the account calling the `PrescriptionRegistry`
///           and nothing else, moving no value.
///        2. The sender must hold a LIVE credential — the same five conditions
///           `PrescriptionRegistry._hasLiveCredential` applies, re-read from EAS
///           on every operation, never cached.
///        3. The sender must be inside its per-account quota for the current
///           window, and the operation must not be able to cost more than
///           `maxCostPerOp`.
///
///      Any of the three failing is a REVERT with a named error and its
///      arguments. See the failure-channel note below; it is the whole of
///      Fase 5 item 8.
///
/// @dev ERC-7562 AND WHO CAN ACTUALLY SUBMIT THESE OPERATIONS. This is the most
///      important limitation of this contract and it is stated first, in full,
///      because a reader who skips it will believe something untrue.
///
///      ERC-7562 constrains what a paymaster may do inside
///      `validatePaymasterUserOp`. Two of its rules bite here:
///
///        [STO-033] A paymaster gets "read-only access to any storage in a
///        non-entity contract" ONLY IF IT IS STAKED. This contract reads
///        `PrescriptionRegistry.credentialOf` and then `EAS.getAttestation`.
///        The first is a slot keyed by the sender, the second is a slot keyed
///        by a credential uid and is associated with nothing. Both are storage
///        of contracts that are not this paymaster. So: STAKE IS REQUIRED.
///        `addStake` exists for exactly that and it has not been called — Fase 5
///        item 7 is an operational step, not code.
///
///        [OP-011] The TIMESTAMP opcode is forbidden during validation. The
///        window in rule 3 reads `block.timestamp`, so this contract breaks
///        that rule, AND STAKING DOES NOT FIX IT.
///
///      Therefore, plainly: THIS PAYMASTER IS NOT COMPATIBLE WITH A PUBLIC
///      ERC-4337 BUNDLER, staked or not, and no such compatibility has been
///      tested. It is built for the path this project has actually verified:
///      EntryPoint v0.7 at 0x0000000071727De22E5E9d8BAf0edAc6f37da032 is live
///      on Avalanche Fuji and its `handleOps(PackedUserOperation[], address
///      payable)` is `public` with no access control, so the project's own
///      relayer submits operations directly and no commercial bundler is
///      involved. ERC-7562 is a bundler mempool policy; the EntryPoint does not
///      enforce it, and an operation that breaks it executes correctly when it
///      is submitted directly.
///
///      THE ALTERNATIVES THAT WERE CONSIDERED AND WHY THEY LOST:
///
///        (a) Mirror the accreditation into this paymaster's own storage, with a
///            permissionless `refresh(account)` that copies the registry's
///            verdict across. Validation would then touch only sender-associated
///            slots in this contract, which is legal unstaked. Rejected: the
///            mirror is a CACHED verdict, and docs/04-smart-contracts.md forbids
///            caching accreditation precisely so that a revoked licence cuts
///            access on the next call. A mirror that is stale for even one
///            operation sponsors a revoked doctor, and nobody would be obliged
///            to refresh it.
///
///        (b) Drop the EAS read and accept `credentialOf(sender) != 0` as the
///            test. That slot IS associated with the sender, so it is legal for
///            an unstaked paymaster. Rejected: it answers "this account once
///            pointed at a credential", not "this account is accredited now".
///            docs/01-arquitectura.md lists "Rechazo si la attestation está
///            revocada" as a rule of the sponsorship policy, and this variant
///            cannot honour it.
///
///        (c) Replace the window revert with the ERC-4337 `validAfter` channel,
///            which would remove the TIMESTAMP read from validation. Rejected
///            for what it costs the doctor; see the failure-channel note.
///
///      The limitation is written down here, in docs/18, and nowhere is public
///      bundler compatibility claimed.
///
/// @dev THE FAILURE CHANNEL — Fase 5 item 8, "mensaje de rechazo por límite de
///      patrocinio agotado". A paymaster has two ways to say no and they are not
///      equivalent:
///
///        RETURN `validationData = 1`. EntryPoint v0.7 turns this into
///        `FailedOp(opIndex, "AA34 signature error")`. A fixed string, no
///        arguments, and it says "signature" about something that has nothing to
///        do with a signature.
///
///        RETURN a `validAfter` in the future. EntryPoint v0.7 turns this into
///        `FailedOp(opIndex, "AA32 paymaster expired or not due")`. Also a fixed
///        string, also no arguments.
///
///        REVERT. EntryPoint v0.7 catches it and re-throws
///        `FailedOpWithRevert(opIndex, "AA33 reverted", inner)`, where `inner`
///        is THIS CONTRACT'S OWN ERROR, selector and arguments intact.
///
///      This contract reverts, every time, for every rule. The client decodes
///      `inner` and reads `SponsorshipExhausted(account, used, limit,
///      windowEndsAt)` — four values, including the moment the quota comes back,
///      which is what the doctor's screen has to turn into "ya has emitido 40
///      recetas hoy; el patrocinio se renueva a las 14:32".
///
///      Note what reverting does NOT cost: for a PAYMASTER, unlike an account,
///      both channels take `handleOps` down for that operation — AA32 and AA34
///      are reverts too. There is no bundle-safety argument for returning `1`
///      here, only a loss of information. That asymmetry with
///      `PasskeyAccount.validateUserOp`, which must return and must not revert,
///      is deliberate and is the reason the two contracts differ.
///
///      Belt and braces: `sponsorshipOf` is a free `eth_call` that answers the
///      same question BEFORE the doctor signs anything, so the UI never has to
///      learn about the limit by failing.
///
/// @dev NO ADMINISTRATOR, and what the one privileged address can and cannot do.
///      `PrescriptionRegistry` has no administrator at all (D-14) and this
///      contract keeps that shape everywhere it can: the policy is immutable,
///      nobody can whitelist an account, nobody can blacklist one, nobody can
///      raise their own quota, and there is no upgrade path.
///
///      The one exception is money, because a deposit that nobody can recover is
///      a burn, not a design. `funder` is fixed at construction, cannot be
///      transferred, and its only power is to move THIS CONTRACT'S OWN deposit
///      and stake back to itself — there is not even a destination parameter, so
///      value that enters here can only ever leave to one address that is
///      readable in the deployed code. It cannot issue, cancel, dispense, read a
///      prescription, or change who gets sponsored. docs/02-roles-y-permisos.md
///      already names this role ("Operador del paymaster": define and fund the
///      sponsorship policy, and nothing else) and already forbids it everything
///      else.
///
///      The worst a compromised `funder` key achieves is emptying the deposit,
///      at which point sponsorship stops — which is the same state as the
///      deposit simply running out, a state the system has to survive anyway.
///      No prescription is lost: what is on the registry is on the registry.
contract PrescriptionPaymaster is IPaymaster {
    /// @notice `execute(address,uint256,bytes)` — the one call shape sponsored.
    ///
    /// @dev Written as a signature rather than taken from `PasskeyAccount` so
    ///      this contract does not import the account. That is not tidiness: the
    ///      paymaster must be able to judge an operation from its calldata
    ///      alone, which is all the EntryPoint gives it, and coupling it to one
    ///      account implementation would suggest otherwise. The signature is the
    ///      standard one every ERC-4337 tooling emits.
    ///      `test_the_sponsored_selector_is_the_accounts_execute` pins it to
    ///      `PasskeyAccount.execute` so the two can never drift apart in silence.
    bytes4 public constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));

    /// @notice `registerCredential(bytes32)`, the one call a not-yet-accredited
    ///         account is allowed to make. See `_credentialUid`.
    bytes4 internal constant REGISTER_CREDENTIAL_SELECTOR = IPrescriptionRegistry.registerCredential.selector;

    /// @notice Length of an ABI-encoded `registerCredential(bytes32)` call.
    uint256 internal constant REGISTER_CREDENTIAL_LENGTH = 36;

    /// @notice Only the EntryPoint may drive this paymaster.
    error NotEntryPoint(address caller);

    /// @notice Only `funder` may move this paymaster's money.
    error NotTheFunder(address caller, address funder);

    /// @notice The operation's `callData` is too short to be a call at all.
    error UnsupportedCallData(uint256 length);

    /// @notice The operation calls something other than `execute`.
    error UnsupportedSelector(bytes4 selector);

    /// @notice The operation points at a contract that is not the registry.
    error TargetNotSponsored(address target, address registry);

    /// @notice The operation tries to move native currency.
    error ValueNotSponsored(uint256 value);

    /// @notice The sender holds no live professional credential.
    error NotAccredited(address account);

    /// @notice The sender used up its sponsored operations for this window.
    /// @dev THE message of Fase 5 item 8. `windowEndsAt` is included so the UI
    ///      can say when sponsorship comes back instead of only that it is gone.
    error SponsorshipExhausted(address account, uint32 used, uint32 limit, uint64 windowEndsAt);

    /// @notice The operation could cost more than this paymaster will risk.
    error CostNotSponsored(uint256 maxCost, uint256 allowed);

    /// @notice A policy parameter would have made the contract useless or unsafe.
    error InvalidPolicy();

    /// @notice EntryPoint v0.7. The only address allowed to call this paymaster.
    address public immutable entryPoint;

    /// @notice The one contract whose calls are sponsored.
    address public immutable registry;

    /// @notice EAS instance the registry trusts. Copied FROM the registry.
    address public immutable eas;

    /// @notice Practitioner schema uid. Copied FROM the registry.
    bytes32 public immutable practitionerSchema;

    /// @notice Pharmacy schema uid. Copied FROM the registry.
    bytes32 public immutable pharmacySchema;

    /// @notice The only attester whose credentials count. Copied FROM the registry.
    address public immutable issuerAuthority;

    /// @notice The one address this contract's money can ever reach.
    address public immutable funder;

    /// @notice Sponsored operations allowed per account per window.
    uint32 public immutable opsPerWindow;

    /// @notice Length of the window, in seconds.
    uint64 public immutable windowSeconds;

    /// @notice The most a single sponsored operation may be allowed to cost.
    uint256 public immutable maxCostPerOp;

    /// @notice One account's quota state. Fits in a single slot.
    struct Window {
        /// @dev When the current window closes. Zero for an account that has
        ///      never been sponsored, which reads as "already closed" and
        ///      therefore opens a fresh window on first use.
        uint64 endsAt;
        /// @dev Operations sponsored inside the current window.
        uint32 used;
    }

    /// @dev Keyed by sender, which makes every slot here "associated storage of
    ///      the account" under ERC-7562 — the one kind of storage a paymaster
    ///      may touch during validation without being staked. That is not what
    ///      forces the stake requirement; the registry and EAS reads are.
    mapping(address account => Window window) private _windows;

    /// @param registry_ The `PrescriptionRegistry` whose calls are sponsored.
    ///        Everything the accreditation check needs — the EAS instance, both
    ///        schema uids and the issuing authority — is READ OFF THE REGISTRY
    ///        here rather than passed in again. A paymaster wired to a different
    ///        EAS or a different authority than the registry it pays for would
    ///        sponsor operations the registry then refuses, and the deployment
    ///        would look fine. This makes that impossible to express.
    /// @param entryPoint_ EntryPoint v0.7.
    /// @param funder_ The only address that may ever withdraw. See the note on
    ///        administrators above.
    /// @param opsPerWindow_ Sponsored operations per account per window.
    /// @param windowSeconds_ Window length.
    /// @param maxCostPerOp_ Ceiling on one operation's `maxCost`.
    ///
    /// @dev WHY THESE ARE CONSTRUCTOR ARGUMENTS AND NOT SETTERS. Fase 5 item 6
    ///      asks for a limit that can be changed without a redeploy, IF that is
    ///      possible without an administrator. It is not: any setter is an
    ///      administrator over who gets sponsored, and this project's contracts
    ///      are adminless on purpose. So the parameters are immutable, and the
    ///      smallest mechanism that still allows a change is used instead:
    ///      DEPLOY A SECOND PAYMASTER AND POINT `paymasterAndData` AT IT. That
    ///      costs one deployment and touches nothing else — not the registry,
    ///      not the accounts, not one credential, because nothing in this system
    ///      stores a paymaster address. The old deposit is recoverable through
    ///      `withdraw`. A policy change is therefore a deploy and a config line,
    ///      which is cheaper than the trust an owner key would cost.
    ///
    /// @dev THE RECOMMENDED VALUES, and the arithmetic behind them.
    ///
    ///      An earlier version of this block sized `maxCostPerOp_` at 0.02 ether
    ///      from a guess of "on the order of 800k gas". The relayer then measured
    ///      the real thing, and the guess was low by more than half: a FIRST
    ///      operation folds account deployment into `verificationGasLimit`
    ///      (v0.7 has no separate field for it) and reserves over 1.8M gas.
    ///      At the 25 nAVAX this block used to assume, that is about 0.047 AVAX
    ///      — so the old recommendation would have made this paymaster REFUSE
    ///      THE ONE OPERATION THAT LETS AN ACCOUNT EXIST, and the phase's exit
    ///      criterion would have been unreachable by parameter choice rather
    ///      than by any defect. `gas-policy.test.ts` pins that arithmetic.
    ///
    ///      Two measurements, both from 13/09/2026, both on the real chain or
    ///      from `forge test --gas-report`, and both worth keeping separate
    ///      from the choice they inform:
    ///
    ///        A deploying operation reserves >1.8M gas; a steady-state `issue`
    ///        reserves roughly half that, because it pays no deployment.
    ///
    ///        Fuji's base fee measured 10 wei — nine orders of magnitude under
    ///        the 25 nAVAX older documents in this repository assume. DO NOT
    ///        size against 10 wei. A ceiling exists for the day the fee is not
    ///        10 wei, and `handleOps` is permissionless, so a hostile submitter
    ///        chooses the gas price. Size against the number that hurts.
    ///
    ///        `windowSeconds_` = 1 days. A prescribing day is the natural unit;
    ///        an hour would refuse a busy clinic and a week would let one
    ///        compromised passkey drain a week of budget in an afternoon.
    ///
    ///        `maxCostPerOp_` = 0.06 ether. It has to clear the deploying
    ///        operation at a fee that is allowed to rise: 1.9M gas at 25 nAVAX
    ///        is 0.0475, and the headroom is the point. Below roughly 0.05 this
    ///        paymaster cannot bootstrap an account at that fee.
    ///
    ///        `opsPerWindow_` = 25. This is the parameter that absorbs the
    ///        correction, because `opsPerWindow_ * maxCostPerOp_` is the only
    ///        bound that matters for solvency and it must be one the deposit can
    ///        actually pay. 25 * 0.06 = 1.5 AVAX per account per day; two
    ///        accredited accounts therefore cannot exceed 3 AVAX in a day,
    ///        against a funding account that holds 3.499. It still clears a
    ///        20-consultation day plus enrolment. The old 40 * 0.06 would be
    ///        2.4 AVAX for ONE account, which is not a bound the deposit can
    ///        honour, and a bound you cannot pay is not a bound.
    ///
    ///      Note the worst case is worst-case: only the first operation is
    ///      expensive, so a realistic day costs far less. Bounds are chosen
    ///      against the adversary, not against the average.
    constructor(
        address registry_,
        address entryPoint_,
        address funder_,
        uint32 opsPerWindow_,
        uint64 windowSeconds_,
        uint256 maxCostPerOp_
    ) {
        if (
            registry_ == address(0) || entryPoint_ == address(0) || funder_ == address(0)
                || opsPerWindow_ == 0 || windowSeconds_ == 0 || maxCostPerOp_ == 0
        ) {
            revert InvalidPolicy();
        }

        PrescriptionRegistry r = PrescriptionRegistry(registry_);

        registry = registry_;
        entryPoint = entryPoint_;
        funder = funder_;
        opsPerWindow = opsPerWindow_;
        windowSeconds = windowSeconds_;
        maxCostPerOp = maxCostPerOp_;

        eas = r.eas();
        practitionerSchema = r.practitionerSchema();
        pharmacySchema = r.pharmacySchema();
        issuerAuthority = r.issuerAuthority();
    }

    /// @dev The boundary, and it names the caller for the same reason
    ///      `PasskeyAccount` does: a misrouted call should be debuggable.
    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) {
            revert NotEntryPoint(msg.sender);
        }
        _;
    }

    /// @dev The money boundary. Deliberately not called `onlyOwner`: this is not
    ///      ownership of the policy, it is the right to take back a deposit.
    modifier onlyFunder() {
        if (msg.sender != funder) {
            revert NotTheFunder(msg.sender, funder);
        }
        _;
    }

    /// @inheritdoc IPaymaster
    ///
    /// @dev Returns an EMPTY CONTEXT, so EntryPoint v0.7 never calls `postOp`.
    ///      That is a choice, not an omission. The only thing a `postOp` here
    ///      could add is telemetry — what the operation really cost, which is
    ///      the number docs/12 and docs/13 insist must be measured rather than
    ///      estimated — and the EntryPoint ALREADY emits it:
    ///      `UserOperationEvent(userOpHash, sender, paymaster, nonce, success,
    ///      actualGasCost, actualGasUsed)`, indexed by paymaster. Re-emitting it
    ///      from here would buy nothing and would cost a failure mode: a
    ///      `postOp` that runs out of `paymasterPostOpGasLimit` reverts the whole
    ///      operation with `PostOpReverted`, which would mean a doctor's
    ///      prescription failing for a log line.
    ///
    /// @dev The quota is spent HERE, during validation, and it is NOT refunded
    ///      if the operation then reverts inside the registry. That is correct
    ///      rather than convenient: a reverting operation costs this paymaster
    ///      real AVAX, and a quota that only counted successes would leave the
    ///      cheapest abuse — an operation designed to fail — entirely unbounded.
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        external
        onlyEntryPoint
        returns (bytes memory context, uint256 validationData)
    {
        if (maxCost > maxCostPerOp) {
            revert CostNotSponsored(maxCost, maxCostPerOp);
        }

        bytes memory innerCall = _requireRegistryCall(userOp.callData);

        _requireAccredited(userOp.sender, innerCall);
        _consumeQuota(userOp.sender);

        return ("", 0);
    }

    /// @inheritdoc IPaymaster
    ///
    /// @dev Never reached under EntryPoint v0.7, because the context above is
    ///      empty and v0.7 skips `postOp` on an empty context. It is implemented
    ///      anyway for two reasons: `IPaymaster` is a two-function interface and
    ///      a contract that claims it should honour both, and the EntryPoint
    ///      boundary has to hold on every externally reachable function, not
    ///      only on the ones currently in use. Returning a context later is a
    ///      one-line change and this guard is what makes that safe.
    function postOp(PostOpMode, bytes calldata, uint256, uint256) external onlyEntryPoint {}

    // --- Funding -------------------------------------------------------------

    /// @notice Put AVAX into this paymaster's EntryPoint deposit.
    /// @dev Permissionless: adding value can never hurt anyone, and the demo
    ///      should be fundable from any key the team happens to have loaded.
    ///      Read `funder` before sending: whatever lands here can only ever be
    ///      withdrawn to that address, so a donation from anyone else is a
    ///      donation in the literal sense.
    function deposit() external payable {
        IEntryPointStake(entryPoint).depositTo{value: msg.value}(address(this));
    }

    /// @notice Same as `deposit`, for a plain transfer.
    /// @dev Forwarding immediately matters: AVAX sitting in this contract's own
    ///      balance pays for nothing. The EntryPoint only ever spends the
    ///      deposit it holds on the paymaster's behalf.
    receive() external payable {
        IEntryPointStake(entryPoint).depositTo{value: msg.value}(address(this));
    }

    /// @notice What is left to sponsor with.
    function getDeposit() external view returns (uint256) {
        return IEntryPointStake(entryPoint).balanceOf(address(this));
    }

    /// @notice Take part of the deposit back.
    /// @dev No destination parameter, on purpose. The only address this
    ///      contract's money can reach is `funder`, and that is verifiable by
    ///      reading the code rather than by trusting whoever calls.
    function withdraw(uint256 amount) external onlyFunder {
        IEntryPointStake(entryPoint).withdrawTo(payable(funder), amount);
    }

    /// @notice Stake this paymaster in the EntryPoint.
    ///
    /// @dev Needed for ERC-7562 [STO-033]; see the header. NOT PERMISSIONLESS,
    ///      and the reason is a real griefing vector rather than caution: the
    ///      EntryPoint's `addStake` requires the new unstake delay to be greater
    ///      than or equal to the current one and then adopts it, so anyone who
    ///      could reach this function could stake one wei with a delay of
    ///      `type(uint32).max` — about 136 years — and every later stake would
    ///      inherit that delay and be unrecoverable.
    function addStake(uint32 unstakeDelaySec) external payable onlyFunder {
        IEntryPointStake(entryPoint).addStake{value: msg.value}(unstakeDelaySec);
    }

    /// @notice Start the unstake delay running.
    function unlockStake() external onlyFunder {
        IEntryPointStake(entryPoint).unlockStake();
    }

    /// @notice Recover the stake once the delay has elapsed. To `funder`, only.
    function withdrawStake() external onlyFunder {
        IEntryPointStake(entryPoint).withdrawStake(payable(funder));
    }

    // --- Policy, readable before signing -------------------------------------

    /// @notice What `account` has left, as validation would see it right now.
    ///
    /// @dev Exists so the doctor's app can check the quota with a free
    ///      `eth_call` before asking for a fingerprint, instead of discovering
    ///      it by having an operation refused. It applies the same rollover rule
    ///      validation applies, so the UI never has to reimplement it — a
    ///      duplicated rule is a rule that eventually disagrees with itself.
    ///
    /// @return used Operations spent in the window that is open now.
    /// @return limit `opsPerWindow`, repeated so one call answers everything.
    /// @return windowEndsAt When `used` returns to zero.
    function sponsorshipOf(address account)
        external
        view
        returns (uint32 used, uint32 limit, uint64 windowEndsAt)
    {
        Window memory w = _windows[account];

        if (block.timestamp >= w.endsAt) {
            return (0, opsPerWindow, uint64(block.timestamp) + windowSeconds);
        }

        return (w.used, opsPerWindow, w.endsAt);
    }

    // --- The three rules -----------------------------------------------------

    /// @dev Rule 1: only calls to `PrescriptionRegistry`, moving no value.
    ///
    ///      WHY THIS IS CHECKED HERE AT ALL, given `PasskeyAccount.execute`
    ///      already refuses any other target. Because the paymaster is the one
    ///      paying, and a payer that delegates its own spending rule to the
    ///      thing it is paying for has no rule. Concretely: the account enforces
    ///      the target only for accounts of that exact implementation, and
    ///      NOTHING binds this paymaster to that implementation — `sender` is
    ///      whatever address the operation names, its code is whatever is
    ///      deployed there, and a future account, a second factory or a plain
    ///      contract wallet would all arrive here looking identical. Re-checking
    ///      costs a calldata compare and removes a dependency on somebody else's
    ///      invariant. It is also the only check of the three that survives the
    ///      account being wrong.
    ///
    /// @return innerCall The call the account would make on the registry. Needed
    ///         by rule 2 to recognise a credential registration.
    function _requireRegistryCall(bytes calldata callData) internal view returns (bytes memory innerCall) {
        if (callData.length < 4) {
            revert UnsupportedCallData(callData.length);
        }

        bytes4 selector = bytes4(callData[0:4]);

        if (selector != EXECUTE_SELECTOR) {
            revert UnsupportedSelector(selector);
        }

        // A malformed tail makes `abi.decode` revert on its own, which is the
        // right outcome — the operation is refused — and the EntryPoint still
        // delivers the reason to the client inside `FailedOpWithRevert`.
        (address target, uint256 value, bytes memory data) =
            abi.decode(callData[4:], (address, uint256, bytes));

        if (target != registry) {
            revert TargetNotSponsored(target, registry);
        }
        if (value != 0) {
            revert ValueNotSponsored(value);
        }

        return data;
    }

    /// @dev Rule 2: only accredited accounts, judged the way the registry judges.
    ///
    ///      THE BOOTSTRAP, and why it is not a hole. An account that has never
    ///      registered a credential has `credentialOf == 0`, so a strict reading
    ///      of this rule would refuse it — including the very first operation of
    ///      its life, which is the one that registers the credential. And that
    ///      operation cannot be paid for any other way, because the doctor has
    ///      no AVAX: refusing it makes Fase 5's exit criterion, "una emisión
    ///      completa sin que el médico posea AVAX", unreachable by construction.
    ///
    ///      So an unregistered account is sponsored for exactly one thing: a
    ///      call to `registerCredential(uid)` whose `uid` is ALREADY a live
    ///      credential naming that account, issued by `issuerAuthority`. The
    ///      gate is not weakened, it is moved: the account must still hold a
    ///      live credential, it just has not pointed at it yet. An attacker
    ///      cannot pass it without an attestation signed by the credential
    ///      authority, which is the same thing that stops them everywhere else
    ///      in this system.
    function _requireAccredited(address account, bytes memory innerCall) internal view {
        bytes32 uid = _credentialUid(account, innerCall);

        if (uid == bytes32(0)) {
            revert NotAccredited(account);
        }

        Attestation memory a = IEAS(eas).getAttestation(uid);

        // The same five conditions as `PrescriptionRegistry._hasLiveCredential`,
        // re-read from EAS on every operation and never cached — for the reason
        // docs/04-smart-contracts.md gives: a licence withdrawn one second ago
        // must stop the next call, and sponsoring is a call.
        //
        // The one difference is deliberate: EITHER schema is accepted. The
        // policy in docs/01-arquitectura.md is "solo desde smart accounts con
        // attestation profesional vigente", not "solo médicos", and a pharmacy
        // confirming a dispensation has exactly the same reason not to own
        // AVAX. Which role may do what is the registry's decision, made again on
        // every call; it is not this contract's to second-guess.
        bool live = (a.schema == practitionerSchema || a.schema == pharmacySchema) && a.recipient == account
            && a.attester == issuerAuthority && a.revocationTime == 0
            && (a.expirationTime == 0 || block.timestamp < a.expirationTime);

        if (!live) {
            revert NotAccredited(account);
        }
    }

    /// @dev The uid to judge `account` by: the one it registered, or — when it
    ///      has registered none — the one this very operation is registering.
    ///      Returns zero when there is nothing to judge, which the caller turns
    ///      into `NotAccredited`.
    function _credentialUid(address account, bytes memory innerCall) private view returns (bytes32 uid) {
        uid = IPrescriptionRegistry(registry).credentialOf(account);

        if (uid != bytes32(0)) {
            return uid;
        }

        if (innerCall.length != REGISTER_CREDENTIAL_LENGTH) {
            return bytes32(0);
        }

        bytes32 head;

        // `innerCall` is `bytes memory`, which Solidity will not slice, and its
        // length is already pinned at exactly one selector plus one word above.
        // The first load reads the leading word, whose high four bytes are the
        // selector; the second reads the argument that follows it. Both are
        // taken as `bytes32` and narrowed in Solidity afterwards — writing
        // straight into a `bytes4` would leave the low 28 bytes dirty, and the
        // compiler assumes values produced by assembly are already clean.
        assembly ("memory-safe") {
            head := mload(add(innerCall, 0x20))
            uid := mload(add(innerCall, 0x24))
        }

        if (bytes4(head) != REGISTER_CREDENTIAL_SELECTOR) {
            return bytes32(0);
        }
    }

    /// @dev Rule 3: a fixed window per account, opened by the first sponsored
    ///      operation in it and closed `windowSeconds` later.
    ///
    ///      A fixed window rather than a sliding one, on purpose: a sliding
    ///      window needs a list of timestamps per account, which is unbounded
    ///      storage written during validation — more gas, more slots, and a cost
    ///      that grows with the limit. The fixed window fits in ONE slot and its
    ///      only weakness is the edge case where an account spends its quota at
    ///      the end of one window and again at the start of the next. That
    ///      doubles the burst, never the sustained rate, and the AVAX ceiling
    ///      that actually matters is `maxCostPerOp`, which no burst can move.
    function _consumeQuota(address account) private {
        Window memory w = _windows[account];

        // Also true of an account that has never been sponsored, whose `endsAt`
        // is zero. A fresh account and an account whose window elapsed are the
        // same case and are handled by the same branch.
        if (block.timestamp >= w.endsAt) {
            w.endsAt = uint64(block.timestamp) + windowSeconds;
            w.used = 0;
        }

        if (w.used >= opsPerWindow) {
            revert SponsorshipExhausted(account, w.used, opsPerWindow, w.endsAt);
        }

        w.used += 1;

        _windows[account] = w;
    }
}
