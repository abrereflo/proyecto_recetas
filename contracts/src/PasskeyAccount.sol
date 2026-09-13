// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IAccount, PackedUserOperation} from "./IAccount.sol";
import {WebAuthn} from "./WebAuthn.sol";

/// @title PasskeyAccount
/// @notice An ERC-4337 smart account whose owner is a P-256 public key, so a
///         doctor signs prescriptions with the passkey in their phone or laptop
///         instead of with an externally owned account.
///
/// @dev What this contract buys, in the language of docs/01-arquitectura.md:
///      the doctor has no seed phrase, no browser extension and no AVAX. The
///      key is generated inside the device's secure enclave, never leaves it,
///      and is unlocked with a fingerprint, a face or a PIN. This contract is
///      what makes that key mean something on chain.
///
/// @dev WHY ENTRYPOINT v0.7. Both v0.6 (0x5FF1…2789) and v0.7 (0x0000…a032)
///      are deployed on Avalanche Fuji, so availability does not decide it.
///      v0.7 is chosen because:
///
///        - It is the version current bundlers and paymaster providers target.
///          Fase 5 item 5 has to pick one of those providers and picking the
///          version they have moved on from starts that conversation badly.
///        - `paymasterAndData` is parsed into explicit fields by the
///          EntryPoint, instead of v0.6's convention of slicing a blob at fixed
///          offsets. The paymaster policy in Fase 5 item 6 is a sponsorship
///          decision about prescriptions; it should not also be a byte-offset
///          exercise.
///        - Validation and execution gas limits are packed into one word, which
///          cuts calldata, which is most of the cost on an L1 like the C-Chain.
///        - v0.6's `validateUserOp` takes a differently shaped struct. Targeting
///          it is not a flag, it is a different account.
///
///      v0.8 (0x4337…f108) is also live on Fuji. It is NOT chosen: it hashes
///      the operation as EIP-712 typed data and leans on EIP-7702-era
///      behaviour, which is a second unverified dependency to carry into a
///      buildathon. v0.7 is the version this project has checked.
///
/// @dev WHY THE PUBLIC KEY IS IMMUTABLE. `publicKeyX` and `publicKeyY` live in
///      code, not in storage. Three reasons, in order of weight:
///
///        1. The address becomes a commitment to the key. The factory deploys
///           with CREATE2 and the key is a constructor argument, so it is inside
///           the initcode the address is derived from. You cannot change the key
///           without changing the address. An EAS credential is issued to an
///           address (docs/02-roles-y-permisos.md), so this is what stops a
///           credential following a key it was never issued for.
///        2. It suits this project's stance. `PrescriptionRegistry` has no
///           administrator, no upgrade path and no reopen function, on purpose
///           (D-14). An account with a rotatable owner would be the one mutable
///           thing in an otherwise frozen system, and it would be the piece
///           holding the signing authority.
///        3. Validation reads it for free. ERC-7562 fences off what storage an
///           account may touch while validating; code is not storage, so an
///           immutable sidesteps the rule entirely and costs no SLOAD.
///
///      THE PRICE, stated plainly: A LOST PASSKEY IS A LOST ACCOUNT. There is
///      no rotation, no recovery and no social guardian. The doctor enrols a new
///      passkey, which produces a new account at a new address, and the
///      credential authority issues a fresh EAS attestation to it. That is not a
///      workaround, it is the same move the system already makes for a renewed
///      licence: a new uid takes the place of the old one. Prescriptions already
///      issued keep naming the old address forever, which is correct — they were
///      signed by that key, and the audit trail should say so.
///
/// @dev HOW AN ACCOUNT COMES INTO EXISTENCE, and who pays. `PasskeyAccountFactory`
///      deploys it with CREATE2 from the public key, so the address is known
///      before any code exists at it. The doctor's app computes that address at
///      enrolment and shows it; the credential authority attests to it while it
///      is still counterfactual. The first UserOperation carries the factory
///      call in `initCode` and the EntryPoint deploys the account as part of
///      that operation, paid for by the paymaster. The doctor never sends a
///      transaction to create their own account, which is the entire point:
///      they would need AVAX to do it.
///
/// @dev WHAT THIS ACCOUNT ACCEPTS AS A SIGNATURE: A WEBAUTHN ASSERTION, AND
///      NOTHING ELSE. `userOp.signature` is an ABI-encoded `WebAuthn.Assertion`
///      and it is verified by `WebAuthn.check`, which rebuilds
///      `sha256(authenticatorData || sha256(clientDataJSON))` and confirms that
///      the `challenge` inside the JSON is this operation's `userOpHash`.
///
///      THE RAW P-256 PATH THAT USED TO BE HERE IS GONE, and that is the
///      deliberate part. This account previously verified a bare `r || s` over
///      `userOpHash`, and keeping that as a second accepted shape would have
///      been free, backwards-compatible, and wrong:
///
///        - It would be an authenticator bypass with the security argument
///          removed. The whole premise is that the key lives in a secure
///          enclave, that the enclave only ever signs WebAuthn envelopes, and
///          that it only does so after verifying the user. A bare signature
///          over `userOpHash` is, by construction, something the enclave CANNOT
///          produce. So the raw path could never be used by a doctor with an
///          intact passkey — it could only ever be used by someone holding an
///          exported private key, which is exactly the case the design exists
///          to make impossible. It is a door that only an attacker can fit
///          through.
///        - It would silently void the User Verification requirement.
///          `WebAuthn.check` refuses an assertion whose authenticator did not
///          verify the user, because a prescription has to be attributable to a
///          person and not to a device someone tapped. A raw signature carries
///          no flags at all, so the rule would hold for one of the two accepted
///          shapes and not the other — which is the same as not holding.
///        - It would make the audit trail ambiguous. "The doctor signed this"
///          would mean two different things depending on which branch ran, and
///          the chain would not record which.
///
///      The cost is real and is accepted: there is no way to drive this account
///      without a working WebAuthn client, tests included, and a bug in the
///      envelope encoding cannot be worked around by falling back to a plain
///      signature. Good. A fallback nobody legitimate can use is not a
///      fallback.
///
/// @dev WHAT IS NOT HERE, so nobody assumes it is:
///
///      NO ERC-1271. The pharmacy app verifies the prescriber's EIP-712
///      signature off-chain (docs/01-arquitectura.md). Once the prescriber is a
///      contract rather than an EOA, that check needs `isValidSignature`. It is
///      not implemented here because it is not part of Fase 5 items 1 and 2, and
///      it deserves its own tests.
///
///      NO ADMIN, NO UPGRADE, NO ROTATION. Deliberate. See above.
contract PasskeyAccount is IAccount {
    /// @notice ERC-4337's "the signature was fine" answer.
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;

    /// @notice ERC-4337's "the signature was not fine" answer.
    /// @dev A return value, never a revert. See `IAccount.validateUserOp`.
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    /// @notice Only the EntryPoint may drive this account.
    error NotEntryPoint(address caller);

    /// @notice `checkAssertion` refused an assertion, and this is why.
    /// @dev Only ever thrown from the read-only diagnostic. `validateUserOp`
    ///      must not revert over a signature and does not.
    error AssertionRejected(WebAuthn.Rejection reason);

    /// @notice `execute` was pointed somewhere other than the registry.
    error TargetNotAllowed(address target, address allowed);

    /// @notice `execute` was asked to move native currency.
    error ValueNotAllowed(uint256 value);

    /// @notice A public key coordinate was zero, which is not a curve point.
    /// @dev A cheap guard against a construction that silently produces an
    ///      account nobody can ever sign for. It is not a full on-curve check;
    ///      the verifier does that on every signature anyway.
    error InvalidPublicKey(uint256 x, uint256 y);

    /// @notice EntryPoint v0.7. The only address allowed to call this account.
    address public immutable entryPoint;

    /// @notice The one contract this account may call.
    address public immutable registry;

    /// @notice Audited Solidity P-256 verifier, or zero for precompile-only.
    /// @dev Upstream's canonical deployment is
    ///      0xc2b78104907F722DABAc4C69f826a522B2754De4 and it is already live on
    ///      Fuji, so nothing needs deploying to use it. Immutable for the same
    ///      reason as the key: a swappable verifier address would be an
    ///      administrator over signature validity wearing a different hat.
    address public immutable fallbackVerifier;

    /// @notice X coordinate of the owner's P-256 public key.
    uint256 public immutable publicKeyX;

    /// @notice Y coordinate of the owner's P-256 public key.
    uint256 public immutable publicKeyY;

    /// @param entryPoint_ EntryPoint v0.7.
    /// @param registry_ The `PrescriptionRegistry` this account serves.
    /// @param fallbackVerifier_ EIP-7212-shaped verifier, or zero.
    /// @param publicKeyX_ Owner's public key, X.
    /// @param publicKeyY_ Owner's public key, Y.
    constructor(
        address entryPoint_,
        address registry_,
        address fallbackVerifier_,
        uint256 publicKeyX_,
        uint256 publicKeyY_
    ) {
        if (publicKeyX_ == 0 || publicKeyY_ == 0) {
            revert InvalidPublicKey(publicKeyX_, publicKeyY_);
        }

        entryPoint = entryPoint_;
        registry = registry_;
        fallbackVerifier = fallbackVerifier_;
        publicKeyX = publicKeyX_;
        publicKeyY = publicKeyY_;
    }

    /// @dev The boundary. Everything an outsider could use to move this account
    ///      is behind it, and it names the caller so a misrouted call is
    ///      debuggable instead of being a bare `revert()`.
    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) {
            revert NotEntryPoint(msg.sender);
        }
        _;
    }

    /// @inheritdoc IAccount
    ///
    /// @dev Note the asymmetry, and it is the point of this function: a wrong
    ///      signature RETURNS 1, a wrong caller REVERTS. ERC-4337 requires the
    ///      first — the EntryPoint must be able to charge for and discard a
    ///      badly signed operation without the surrounding bundle failing — and
    ///      the second is not a signature problem at all.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        validationData = _validateSignature(userOp.signature, userOpHash);

        // Paid whatever the verdict. The EntryPoint refunds what the operation
        // did not spend, and an account that skipped the prefund on a failed
        // signature would simply make the bundler eat the cost of validating it.
        _payPrefund(missingAccountFunds);
    }

    /// @notice Make one call to the `PrescriptionRegistry`.
    ///
    /// @dev WHY THE TARGET IS LOCKED. This could have been a general-purpose
    ///      `execute` — most ERC-4337 accounts are — and it deliberately is not.
    ///
    ///      docs/01-arquitectura.md already says the paymaster will only sponsor
    ///      calls to `PrescriptionRegistry`. That rule is worth having in the
    ///      account too, because the paymaster enforces it only for operations
    ///      the paymaster pays for: a funded account bypasses the policy
    ///      entirely. Enforced here, the containment is unconditional. A stolen
    ///      passkey can issue or cancel prescriptions — bad, and visible, and
    ///      revocable by withdrawing the EAS credential — but it cannot approve
    ///      a token, cannot sign for another protocol and cannot move funds. The
    ///      blast radius of the worst case stays inside the one contract the
    ///      doctor was accredited for.
    ///
    ///      THE PRICE: the registry address is frozen into the account, so a
    ///      registry redeployment orphans every account. Acceptable, because the
    ///      registry is itself immutable and adminless — a redeployment is a new
    ///      system with new credentials, not a migration — and because `issue`
    ///      and `registerCredential` both live on the registry, which is
    ///      everything the doctor's flow needs.
    ///
    /// @param target Must be `registry`.
    /// @param value Must be zero. The parameter is kept so the calldata is the
    ///        standard `execute(address,uint256,bytes)` every bundler SDK emits;
    ///        an account with a different signature would need custom tooling
    ///        for no gain. Zero is enforced because every registry function is
    ///        non-payable, so any non-zero value is a mistake, and refusing it
    ///        means this account can never be used to move AVAX to anyone.
    /// @param data ABI-encoded call, typically `issue` or `registerCredential`.
    function execute(address target, uint256 value, bytes calldata data) external onlyEntryPoint {
        if (target != registry) {
            revert TargetNotAllowed(target, registry);
        }
        if (value != 0) {
            revert ValueNotAllowed(value);
        }

        (bool ok, bytes memory result) = target.call(data);

        if (!ok) {
            // Re-throw the registry's own error, arguments and all.
            // `AlreadyDispensed(hash, who, when)` has to survive the trip: it is
            // what the pharmacy screen reads, and collapsing it into a generic
            // failure here would erase the message the whole product is built
            // around (docs/04-smart-contracts.md).
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    /// @notice Accept native currency.
    ///
    /// @dev Needed so the account can prefund its own operations when no
    ///      paymaster is in play — which is the state of things until Fase 5
    ///      item 7 funds one, and therefore the state of things during a demo
    ///      that has to work anyway.
    ///
    ///      Note what this implies, because it is a real trade-off and not an
    ///      oversight: AVAX sent here can only ever leave as a gas prefund to
    ///      the EntryPoint. `execute` refuses to move value and there is no
    ///      withdraw function. Send this account more than it will spend on gas
    ///      and the remainder is stuck. That is the cost of the account not
    ///      being a wallet, and given what a stolen passkey could otherwise
    ///      reach, it is the right way round.
    receive() external payable {}

    /// @notice Why an assertion would be refused — a free `eth_call`, never
    ///         used during validation.
    ///
    /// @dev THIS EXISTS BECAUSE ERC-4337 LEAVES NO ROOM FOR AN EXPLANATION.
    ///      `validateUserOp` may only answer 0 or 1, so every one of the nine
    ///      distinct ways an assertion can be wrong reaches the doctor's screen
    ///      as the same silent failure. That is tolerable for a forged
    ///      signature and intolerable for the one mistake this design makes
    ///      likely: a client that forgot to normalise `s` fails HALF its
    ///      logins, at random, with nothing to go on (see the malleability note
    ///      in `WebAuthn.check`). One call here turns that into
    ///      `AssertionRejected(HighS)`.
    ///
    ///      Reverting is the right shape for a diagnostic and the wrong shape
    ///      for validation, which is why these are two functions and not one
    ///      with a flag.
    ///
    /// @param signature An ABI-encoded `WebAuthn.Assertion`, exactly as it
    ///        would be carried in `userOp.signature`.
    /// @param userOpHash The digest it is supposed to authorise.
    function checkAssertion(bytes calldata signature, bytes32 userOpHash) external view {
        WebAuthn.Rejection reason = _checkAssertion(signature, userOpHash);

        if (reason != WebAuthn.Rejection.None) {
            revert AssertionRejected(reason);
        }
    }

    /// @notice ABI-decode an assertion envelope.
    ///
    /// @dev Public only so that `_checkAssertion` can call it through `this`,
    ///      and that indirection is the entire point: `abi.decode` REVERTS on a
    ///      malformed buffer, and `validateUserOp` must return 1 rather than
    ///      revert — a reverting validation takes the bundler's whole bundle
    ///      with it. An external call is a revert boundary; `try` turns the
    ///      revert into a value.
    ///
    ///      IT COSTS 9.1K GAS PER VALIDATION, measured, of which 7.2k is the
    ///      boundary itself and 1.9k the decode it wraps. That is not cheap and
    ///      it is bought deliberately: the alternative is re-implementing the
    ///      ABI decoder's offset and length checks by hand, in assembly, in the
    ///      function every signature passes through, where an off-by-one is a
    ///      forgery primitive rather than a bug. The decoder is code this
    ///      project does not have to be right about. `WebAuthn.Assertion`
    ///      carries the same argument for the encoding it decodes into.
    ///
    ///      It is also genuinely useful to a client debugging its encoder.
    function decodeAssertion(bytes calldata signature) external pure returns (WebAuthn.Assertion memory) {
        return abi.decode(signature, (WebAuthn.Assertion));
    }

    /// @dev The one thing this account actually decides.
    ///
    ///      `userOpHash` is the EntryPoint's own digest over the operation, its
    ///      address and the chain id, so binding the signature to it is what
    ///      makes the signature un-replayable across chains, EntryPoints and
    ///      operations. The nonce inside it does the same across repeats. Here
    ///      that binding is one level deeper than it looks: the authenticator
    ///      signed a JSON document, and `userOpHash` is what the `challenge`
    ///      field inside that document has to say.
    function _validateSignature(bytes calldata signature, bytes32 userOpHash)
        internal
        view
        returns (uint256)
    {
        return _checkAssertion(signature, userOpHash) == WebAuthn.Rejection.None
            ? SIG_VALIDATION_SUCCESS
            : SIG_VALIDATION_FAILED;
    }

    /// @dev Decode, then verify. Neither half may revert.
    function _checkAssertion(bytes calldata signature, bytes32 userOpHash)
        internal
        view
        returns (WebAuthn.Rejection)
    {
        try this.decodeAssertion(signature) returns (WebAuthn.Assertion memory assertion) {
            return WebAuthn.check(assertion, userOpHash, publicKeyX, publicKeyY, fallbackVerifier);
        } catch {
            return WebAuthn.Rejection.MalformedEnvelope;
        }
    }

    /// @dev Send the EntryPoint what the operation needs up front.
    ///      A failure is ignored on purpose: ERC-4337 says so, and the
    ///      EntryPoint is about to revert the operation with a message that
    ///      describes the shortfall far better than anything this account could
    ///      raise from inside the payment attempt.
    function _payPrefund(uint256 missingAccountFunds) internal {
        if (missingAccountFunds == 0) return;

        (bool sent,) = payable(msg.sender).call{value: missingAccountFunds}("");

        if (!sent) {
            // Intentionally empty. See above.
        }
    }
}
