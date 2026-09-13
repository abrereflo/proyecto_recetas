// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PackedUserOperation} from "../src/IAccount.sol";
import {PostOpMode} from "../src/IPaymaster.sol";
import {IPrescriptionRegistry} from "../src/IPrescriptionRegistry.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {PrescriptionPaymaster} from "../src/PrescriptionPaymaster.sol";
import {P256Fixture} from "./helpers/P256Fixture.sol";
import {RegistryFixture} from "./helpers/RegistryFixture.sol";
import {MockEntryPoint} from "./mocks/MockEntryPoint.sol";

/// @notice Shared setup: a registry, a real passkey account, a stand-in for the
///         EntryPoint's deposit bookkeeping, and a paymaster over all three.
abstract contract PaymasterFixture is RegistryFixture, P256Fixture {
    /// @dev EntryPoint v0.7 at its canonical address, live on Avalanche Fuji.
    ///      The deposit double is etched here so `deposit`, `withdraw` and
    ///      `addStake` have something with code to talk to; validation itself is
    ///      driven with `vm.prank`, exactly as `PasskeyAccount.t.sol` does.
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// @dev Deliberately tiny. The recommended production value is 25 a day and
    ///      the reasoning is in the constructor's NatSpec; a test that had to
    ///      sponsor twenty-five operations to reach the limit would be
    ///      twenty-five times slower and no clearer about what the limit does.
    uint32 internal constant OPS_PER_WINDOW = 3;

    uint64 internal constant WINDOW = 1 days;

    uint256 internal constant MAX_COST_PER_OP = 0.02 ether;

    /// @dev The only address this paymaster's money can ever reach.
    address internal constant FUNDER = address(0xF0DE7);

    address internal constant STRANGER = address(0xDEAD);

    /// @dev Fixed so `SponsorshipExhausted` can be asserted with the exact
    ///      window boundary and not an approximation.
    uint64 internal constant START = 1_757_000_000;

    PasskeyAccountFactory internal factory;
    PasskeyAccount internal account;
    PrescriptionPaymaster internal paymaster;
    MockEntryPoint internal entryPoint;

    uint256 internal keyX;
    uint256 internal keyY;

    function _deployEverything() internal {
        vm.warp(START);

        _installVerifier();
        _installPrecompile();
        _deployRegistry();

        MockEntryPoint template = new MockEntryPoint();
        vm.etch(ENTRY_POINT, address(template).code);
        entryPoint = MockEntryPoint(payable(ENTRY_POINT));

        factory = new PasskeyAccountFactory(ENTRY_POINT, address(registry), VERIFIER);

        (keyX, keyY) = _publicKey(DOCTOR_KEY);
        account = factory.createAccount(keyX, keyY);

        paymaster = new PrescriptionPaymaster(
            address(registry), ENTRY_POINT, FUNDER, OPS_PER_WINDOW, WINDOW, MAX_COST_PER_OP
        );
    }

    // --- Building the operations the paymaster judges -------------------------

    /// @dev The calldata a `PasskeyAccount` carries: `execute(target, value, data)`.
    function _execute(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("execute(address,uint256,bytes)", target, value, data);
    }

    /// @dev The operation the whole project exists for: issue a prescription.
    function _issue() internal view returns (bytes memory) {
        return abi.encodeCall(
            IPrescriptionRegistry.issue,
            (keccak256("ciphertext-bytes"), keccak256("patientId+salt"), uint64(block.timestamp + 30 days))
        );
    }

    function _op(address sender, bytes memory callData)
        internal
        pure
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.callData = callData;
    }

    /// @dev A sponsored `issue` from `account`, which is the default subject of
    ///      almost every test here.
    function _sponsoredIssue() internal view returns (PackedUserOperation memory) {
        return _op(address(account), _execute(address(registry), 0, _issue()));
    }

    /// @dev Ask the paymaster, as the EntryPoint would.
    function _validate(PackedUserOperation memory op)
        internal
        returns (bytes memory context, uint256 validationData)
    {
        vm.prank(ENTRY_POINT);
        return paymaster.validatePaymasterUserOp(op, keccak256("userOpHash"), MAX_COST_PER_OP);
    }
}

/// @notice `PrescriptionPaymaster` — who gets sponsored, and who is told why not.
contract PrescriptionPaymasterTest is PaymasterFixture {
    function setUp() public {
        _deployEverything();
    }

    // --- What is sponsored ---------------------------------------------------

    /// @notice Fase 5's exit criterion in one assertion: an accredited doctor's
    ///         `issue` is paid for by somebody else.
    function test_sponsors_an_accredited_practitioner_issuing() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        (bytes memory context, uint256 validationData) = _validate(_sponsoredIssue());

        assertEq(validationData, 0, "the paymaster agreed to pay");
        assertEq(context.length, 0, "an empty context means postOp is skipped");
    }

    /// @dev A pharmacy has the same reason not to own AVAX as a doctor, and the
    ///      policy in docs/01-arquitectura.md says "attestation profesional
    ///      vigente", not "médico". Which role may call what stays the
    ///      registry's decision.
    function test_sponsors_an_accredited_pharmacy_dispensing() public {
        _accredit(address(account), PHARMACY_SCHEMA);

        bytes memory callData =
            _execute(address(registry), 0, abi.encodeCall(IPrescriptionRegistry.dispense, (keccak256("h"))));

        (, uint256 validationData) = _validate(_op(address(account), callData));

        assertEq(validationData, 0);
    }

    /// @notice The bootstrap, and it is what makes the exit criterion reachable.
    ///
    /// @dev An account that has never registered a credential has
    ///      `credentialOf == 0`, so a strict accreditation gate would refuse the
    ///      very operation that registers it — and the doctor has no AVAX to pay
    ///      for it any other way. The gate is not skipped: the uid inside the
    ///      call must already be a live credential naming this account.
    function test_sponsors_the_registration_of_an_unregistered_credential() public {
        bytes32 uid = _attest(PRACTITIONER_SCHEMA, address(account), ISSUER_AUTHORITY, 0, 0);

        assertEq(registry.credentialOf(address(account)), bytes32(0), "nothing registered yet");

        bytes memory callData =
            _execute(address(registry), 0, abi.encodeCall(IPrescriptionRegistry.registerCredential, (uid)));

        (, uint256 validationData) = _validate(_op(address(account), callData));

        assertEq(validationData, 0);
    }

    // --- Who is refused, and how they are told --------------------------------

    function test_refuses_an_account_with_no_credential_at_all() public {
        vm.expectRevert(
            abi.encodeWithSelector(PrescriptionPaymaster.NotAccredited.selector, address(account))
        );
        _validate(_sponsoredIssue());
    }

    /// @dev The bootstrap is not a way in. A credential issued to somebody else
    ///      buys nothing, which is the same rule `registerCredential` itself
    ///      applies one moment later.
    function test_refuses_a_registration_of_someone_elses_credential() public {
        bytes32 uid = _attest(PRACTITIONER_SCHEMA, address(0xB0B), ISSUER_AUTHORITY, 0, 0);

        bytes memory callData =
            _execute(address(registry), 0, abi.encodeCall(IPrescriptionRegistry.registerCredential, (uid)));

        vm.expectRevert(
            abi.encodeWithSelector(PrescriptionPaymaster.NotAccredited.selector, address(account))
        );
        _validate(_op(address(account), callData));
    }

    /// @dev Anyone can write an attestation. Only the credential authority's
    ///      counts, here exactly as in the registry.
    function test_refuses_a_registration_of_a_credential_from_another_issuer() public {
        bytes32 uid = _attest(PRACTITIONER_SCHEMA, address(account), address(0xFA15E), 0, 0);

        bytes memory callData =
            _execute(address(registry), 0, abi.encodeCall(IPrescriptionRegistry.registerCredential, (uid)));

        vm.expectRevert(
            abi.encodeWithSelector(PrescriptionPaymaster.NotAccredited.selector, address(account))
        );
        _validate(_op(address(account), callData));
    }

    /// @dev An unregistered account gets ONE sponsored call and it is
    ///      `registerCredential`. Anything else is refused even though the
    ///      target is the registry.
    function test_refuses_an_unregistered_account_trying_to_issue() public {
        _attest(PRACTITIONER_SCHEMA, address(account), ISSUER_AUTHORITY, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(PrescriptionPaymaster.NotAccredited.selector, address(account))
        );
        _validate(_sponsoredIssue());
    }

    /// @notice Revocation cuts sponsorship on the next operation, not eventually.
    /// @dev This is the reason the paymaster reads EAS instead of settling for
    ///      `credentialOf != 0`, and the reason it must be staked under
    ///      ERC-7562 [STO-033]. docs/01-arquitectura.md lists "rechazo si la
    ///      attestation está revocada" as a rule of the policy; a cached verdict
    ///      could not honour it.
    function test_refuses_a_revoked_credential() public {
        bytes32 uid = _accredit(address(account), PRACTITIONER_SCHEMA);

        (, uint256 validationData) = _validate(_sponsoredIssue());
        assertEq(validationData, 0, "sponsored while the credential was live");

        eas.revoke(uid);

        vm.expectRevert(
            abi.encodeWithSelector(PrescriptionPaymaster.NotAccredited.selector, address(account))
        );
        _validate(_sponsoredIssue());
    }

    function test_refuses_an_expired_credential() public {
        uint64 expiresAt = uint64(block.timestamp + 365 days);
        bytes32 uid = _attest(PRACTITIONER_SCHEMA, address(account), ISSUER_AUTHORITY, expiresAt, 0);

        vm.prank(address(account));
        registry.registerCredential(uid);

        vm.warp(expiresAt);

        vm.expectRevert(
            abi.encodeWithSelector(PrescriptionPaymaster.NotAccredited.selector, address(account))
        );
        _validate(_sponsoredIssue());
    }

    // --- What is sponsored: the call itself ----------------------------------

    /// @notice The paymaster decides for itself where the money may go.
    ///
    /// @dev `PasskeyAccount.execute` would refuse this target too. The check is
    ///      repeated because nothing binds this paymaster to that account
    ///      implementation: `sender` is whatever address the operation names,
    ///      and a different account contract would arrive here looking
    ///      identical. A payer that borrows its spending rule from the thing it
    ///      pays for has no rule.
    function test_refuses_a_target_that_is_not_the_registry() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        address elsewhere = address(0xBEEF);
        bytes memory callData = _execute(elsewhere, 0, "");

        vm.expectRevert(
            abi.encodeWithSelector(
                PrescriptionPaymaster.TargetNotSponsored.selector, elsewhere, address(registry)
            )
        );
        _validate(_op(address(account), callData));
    }

    function test_refuses_a_call_that_is_not_execute() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        // The registry call, unwrapped: right destination, wrong shape.
        bytes memory callData = _issue();

        vm.expectRevert(
            abi.encodeWithSelector(
                PrescriptionPaymaster.UnsupportedSelector.selector, IPrescriptionRegistry.issue.selector
            )
        );
        _validate(_op(address(account), callData));
    }

    function test_refuses_calldata_too_short_to_be_a_call() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.UnsupportedCallData.selector, 0));
        _validate(_op(address(account), ""));

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.UnsupportedCallData.selector, 2));
        _validate(_op(address(account), hex"1234"));
    }

    function test_refuses_an_operation_that_moves_value() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        bytes memory callData = _execute(address(registry), 1 wei, _issue());

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.ValueNotSponsored.selector, 1 wei));
        _validate(_op(address(account), callData));
    }

    /// @notice The ceiling that turns a count of operations into a bound in AVAX.
    /// @dev `handleOps` is permissionless, so whoever submits the operation also
    ///      chooses its gas price. Without this cap the per-account limit bounds
    ///      the number of operations and nothing about their cost.
    function test_refuses_an_operation_that_could_cost_too_much() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        vm.expectRevert(
            abi.encodeWithSelector(
                PrescriptionPaymaster.CostNotSponsored.selector, MAX_COST_PER_OP + 1, MAX_COST_PER_OP
            )
        );
        vm.prank(ENTRY_POINT);
        paymaster.validatePaymasterUserOp(_sponsoredIssue(), keccak256("h"), MAX_COST_PER_OP + 1);
    }

    // --- The limit, and the message when it runs out -------------------------

    /// @notice Fase 5 item 8: the doctor learns that SPONSORSHIP ran out.
    ///
    /// @dev The paymaster reverts rather than returning `validationData = 1`,
    ///      and that is the whole point. EntryPoint v0.7 wraps a reverting
    ///      `validatePaymasterUserOp` in `FailedOpWithRevert(opIndex, "AA33
    ///      reverted", inner)` and `inner` is these exact bytes — selector and
    ///      four arguments. Returning `1` would have produced `FailedOp(opIndex,
    ///      "AA34 signature error")`: a fixed string, no arguments, and a lie
    ///      about the cause. Both channels revert `handleOps` either way, so the
    ///      only difference is how much the client learns.
    ///
    ///      The assertion is therefore on the FULL encoding, `windowEndsAt`
    ///      included, because that is the value the screen turns into "el
    ///      patrocinio se renueva a las…".
    function test_the_limit_is_enforced_and_named() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        for (uint32 i = 0; i < OPS_PER_WINDOW; i++) {
            (, uint256 validationData) = _validate(_sponsoredIssue());
            assertEq(validationData, 0);
        }

        vm.expectRevert(
            abi.encodeWithSelector(
                PrescriptionPaymaster.SponsorshipExhausted.selector,
                address(account),
                OPS_PER_WINDOW,
                OPS_PER_WINDOW,
                START + WINDOW
            )
        );
        _validate(_sponsoredIssue());
    }

    function test_the_limit_resets_when_the_window_closes() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        for (uint32 i = 0; i < OPS_PER_WINDOW; i++) {
            _validate(_sponsoredIssue());
        }

        // One second before the window closes, still refused.
        vm.warp(START + WINDOW - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrescriptionPaymaster.SponsorshipExhausted.selector,
                address(account),
                OPS_PER_WINDOW,
                OPS_PER_WINDOW,
                START + WINDOW
            )
        );
        _validate(_sponsoredIssue());

        // On the boundary, sponsored again, and the quota starts over.
        vm.warp(START + WINDOW);
        (, uint256 validationData) = _validate(_sponsoredIssue());

        assertEq(validationData, 0);

        (uint32 used,, uint64 windowEndsAt) = paymaster.sponsorshipOf(address(account));

        assertEq(used, 1, "the new window counts from one");
        assertEq(windowEndsAt, START + 2 * WINDOW);
    }

    /// @dev The quota is a property of the account, not of the paymaster. One
    ///      doctor exhausting theirs must not stop the clinic.
    function test_the_limit_is_not_shared_between_accounts() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        (uint256 otherX, uint256 otherY) = _publicKey(IMPOSTOR_KEY);
        PasskeyAccount other = factory.createAccount(otherX, otherY);
        _accredit(address(other), PRACTITIONER_SCHEMA);

        for (uint32 i = 0; i < OPS_PER_WINDOW; i++) {
            _validate(_sponsoredIssue());
        }

        (uint32 used,,) = paymaster.sponsorshipOf(address(account));
        assertEq(used, OPS_PER_WINDOW, "the first account is spent");

        bytes memory callData = _execute(address(registry), 0, _issue());
        (, uint256 validationData) = _validate(_op(address(other), callData));

        assertEq(validationData, 0, "the second account is untouched");
    }

    /// @notice The quota is readable before the doctor is asked for a fingerprint.
    /// @dev Item 8 is not only about the failure message: a UI that can see the
    ///      limit never has to discover it by failing. The view applies the same
    ///      rollover rule validation applies, so the client never reimplements it.
    function test_sponsorshipOf_reports_the_window_the_way_validation_sees_it() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        (uint32 used, uint32 limit, uint64 windowEndsAt) = paymaster.sponsorshipOf(address(account));

        assertEq(used, 0, "an account never sponsored has spent nothing");
        assertEq(limit, OPS_PER_WINDOW);
        assertEq(windowEndsAt, START + WINDOW, "the window a first operation would open");

        _validate(_sponsoredIssue());

        (used, limit, windowEndsAt) = paymaster.sponsorshipOf(address(account));

        assertEq(used, 1);
        assertEq(windowEndsAt, START + WINDOW);

        vm.warp(START + WINDOW + 5);
        (used,, windowEndsAt) = paymaster.sponsorshipOf(address(account));

        assertEq(used, 0, "an elapsed window reads as empty without anyone resetting it");
        assertEq(windowEndsAt, START + WINDOW + 5 + WINDOW);
    }

    // --- The EntryPoint boundary ---------------------------------------------

    function test_validatePaymasterUserOp_from_a_stranger_reverts() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.NotEntryPoint.selector, STRANGER));
        vm.prank(STRANGER);
        paymaster.validatePaymasterUserOp(_sponsoredIssue(), keccak256("h"), MAX_COST_PER_OP);
    }

    /// @dev `postOp` is unreachable under EntryPoint v0.7 because the context is
    ///      empty, but it is externally callable and therefore has to hold the
    ///      same boundary as everything else here.
    function test_postOp_from_a_stranger_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.NotEntryPoint.selector, STRANGER));
        vm.prank(STRANGER);
        paymaster.postOp(PostOpMode.opSucceeded, "", 1, 1);
    }

    function test_postOp_from_the_entry_point_is_accepted() public {
        vm.prank(ENTRY_POINT);
        paymaster.postOp(PostOpMode.opReverted, "", 1, 1);
    }

    // --- Construction --------------------------------------------------------

    /// @notice The accreditation wiring is COPIED from the registry, never
    ///         passed in twice.
    /// @dev A paymaster pointed at a different EAS or a different authority than
    ///      the registry it pays for would sponsor operations the registry then
    ///      refuses, and the deployment would look correct. Reading the four
    ///      values off the registry makes that impossible to express.
    function test_the_accreditation_wiring_is_copied_from_the_registry() public view {
        assertEq(paymaster.eas(), registry.eas());
        assertEq(paymaster.practitionerSchema(), registry.practitionerSchema());
        assertEq(paymaster.pharmacySchema(), registry.pharmacySchema());
        assertEq(paymaster.issuerAuthority(), registry.issuerAuthority());
        assertEq(paymaster.registry(), address(registry));
        assertEq(paymaster.entryPoint(), ENTRY_POINT);
        assertEq(paymaster.funder(), FUNDER);
        assertEq(paymaster.opsPerWindow(), OPS_PER_WINDOW);
        assertEq(paymaster.windowSeconds(), WINDOW);
        assertEq(paymaster.maxCostPerOp(), MAX_COST_PER_OP);
    }

    /// @notice The one call shape the paymaster sponsors is the one the account
    ///         actually emits.
    /// @dev The paymaster writes the signature out rather than importing the
    ///      account, so that it judges an operation from calldata alone. This is
    ///      what stops the two drifting apart in silence.
    function test_the_sponsored_selector_is_the_accounts_execute() public view {
        assertEq(paymaster.EXECUTE_SELECTOR(), PasskeyAccount.execute.selector);
    }

    /// @dev Every one of these would deploy a contract that cannot do its job: a
    ///      zero limit sponsors nobody, a zero window never reopens, a zero cost
    ///      ceiling refuses every operation, and a zero funder strands the
    ///      deposit forever.
    function test_constructor_refuses_a_policy_that_cannot_work() public {
        vm.expectRevert(PrescriptionPaymaster.InvalidPolicy.selector);
        new PrescriptionPaymaster(address(registry), ENTRY_POINT, FUNDER, 0, WINDOW, MAX_COST_PER_OP);

        vm.expectRevert(PrescriptionPaymaster.InvalidPolicy.selector);
        new PrescriptionPaymaster(address(registry), ENTRY_POINT, FUNDER, OPS_PER_WINDOW, 0, MAX_COST_PER_OP);

        vm.expectRevert(PrescriptionPaymaster.InvalidPolicy.selector);
        new PrescriptionPaymaster(address(registry), ENTRY_POINT, FUNDER, OPS_PER_WINDOW, WINDOW, 0);

        vm.expectRevert(PrescriptionPaymaster.InvalidPolicy.selector);
        new PrescriptionPaymaster(
            address(registry), ENTRY_POINT, address(0), OPS_PER_WINDOW, WINDOW, MAX_COST_PER_OP
        );
    }
}

/// @notice `PrescriptionPaymaster` — the money, and the one address it can reach.
contract PrescriptionPaymasterFundingTest is PaymasterFixture {
    function setUp() public {
        _deployEverything();
    }

    /// @dev Funding is permissionless because adding value can never hurt
    ///      anyone. Recovering it is not, because it can.
    function test_anyone_may_fund_the_deposit() public {
        vm.deal(STRANGER, 1 ether);

        vm.prank(STRANGER);
        paymaster.deposit{value: 0.4 ether}();

        assertEq(paymaster.getDeposit(), 0.4 ether);

        // A plain transfer forwards too: AVAX left sitting in this contract's
        // own balance would pay for nothing.
        vm.prank(STRANGER);
        (bool sent,) = address(paymaster).call{value: 0.6 ether}("");

        assertTrue(sent);
        assertEq(paymaster.getDeposit(), 1 ether);
        assertEq(address(paymaster).balance, 0, "nothing is parked in the paymaster itself");
    }

    /// @notice The deposit can only ever leave to `funder`, and there is no
    ///         parameter to say otherwise.
    function test_withdraw_reaches_the_funder_and_nowhere_else() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        paymaster.deposit{value: 1 ether}();

        vm.prank(FUNDER);
        paymaster.withdraw(0.6 ether);

        assertEq(FUNDER.balance, 0.6 ether);
        assertEq(paymaster.getDeposit(), 0.4 ether);
    }

    function test_only_the_funder_may_withdraw() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        paymaster.deposit{value: 1 ether}();

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.NotTheFunder.selector, STRANGER, FUNDER));
        vm.prank(STRANGER);
        paymaster.withdraw(1 ether);
    }

    /// @notice Staking is the funder's, and the reason is a griefing vector.
    /// @dev The EntryPoint's `addStake` adopts the unstake delay it is given and
    ///      refuses any later one that is shorter. A permissionless `addStake`
    ///      would let anyone stake one wei with a delay of `type(uint32).max` —
    ///      about 136 years — and every stake after that would inherit it.
    function test_only_the_funder_may_stake() public {
        vm.deal(STRANGER, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.NotTheFunder.selector, STRANGER, FUNDER));
        vm.prank(STRANGER);
        paymaster.addStake{value: 1 wei}(type(uint32).max);

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.NotTheFunder.selector, STRANGER, FUNDER));
        vm.prank(STRANGER);
        paymaster.unlockStake();

        vm.expectRevert(abi.encodeWithSelector(PrescriptionPaymaster.NotTheFunder.selector, STRANGER, FUNDER));
        vm.prank(STRANGER);
        paymaster.withdrawStake();
    }

    /// @notice ERC-7562 [STO-033] asks a paymaster that reads other contracts'
    ///         storage during validation to be staked. This one does read them —
    ///         the registry and EAS — so the path has to exist even though
    ///         calling it is an operational step, not a code one.
    function test_the_funder_can_stake_and_recover_the_stake() public {
        vm.deal(FUNDER, 1 ether);

        vm.prank(FUNDER);
        paymaster.addStake{value: 1 ether}(1 days);

        assertEq(entryPoint.stakes(address(paymaster)), 1 ether);
        assertEq(entryPoint.unstakeDelays(address(paymaster)), 1 days);

        vm.prank(FUNDER);
        paymaster.unlockStake();

        vm.prank(FUNDER);
        paymaster.withdrawStake();

        assertEq(entryPoint.stakes(address(paymaster)), 0);
        assertEq(FUNDER.balance, 1 ether, "the stake came back to the funder, not to the caller");
    }
}
