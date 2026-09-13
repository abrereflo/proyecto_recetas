// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IAccount, PackedUserOperation} from "../src/IAccount.sol";
import {
    IPrescriptionRegistry,
    PrescriptionRecord,
    PrescriptionStatus
} from "../src/IPrescriptionRegistry.sol";
import {P256} from "../src/P256.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {RegistryFixture} from "./helpers/RegistryFixture.sol";
import {WebAuthnFixture} from "./helpers/WebAuthnFixture.sol";

/// @notice Shared setup: a registry, a factory, and one accredited account whose
///         owner is a P-256 keypair.
abstract contract PasskeyAccountFixture is RegistryFixture, WebAuthnFixture {
    /// @dev EntryPoint v0.7, at its canonical address. Deployed on Avalanche
    ///      Fuji — verified with `cast code` — and left as bare address here,
    ///      because every one of these tests is about what the ACCOUNT does when
    ///      the EntryPoint calls it, not about what the EntryPoint does.
    ///      `vm.prank` is the honest way to say "the EntryPoint called".
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    PasskeyAccountFactory internal factory;
    PasskeyAccount internal account;

    uint256 internal keyX;
    uint256 internal keyY;

    function _deployAccount() internal {
        _installVerifier();
        _installPrecompile();
        _deployRegistry();

        factory = new PasskeyAccountFactory(ENTRY_POINT, address(registry), VERIFIER);

        (keyX, keyY) = _publicKey(DOCTOR_KEY);
        account = factory.createAccount(keyX, keyY);
    }

    /// @dev A UserOperation carrying `signature`. Every other field is padding:
    ///      the account reads only the signature, because the EntryPoint has
    ///      already folded the rest into `userOpHash`.
    function _userOp(bytes memory signature) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = 0;
        op.callData = "";
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 0;
        op.gasFees = bytes32(0);
        op.signature = signature;
    }

    /// @dev A signature in the shape `validateUserOp` expects: an ABI-encoded
    ///      `WebAuthn.Assertion`, signed the way an authenticator signs — over
    ///      `sha256(authenticatorData || sha256(clientDataJSON))`, with the
    ///      `userOpHash` carried inside the JSON as a base64url `challenge`.
    ///
    ///      This used to return `abi.encode(r, s)` over the `userOpHash`
    ///      itself. It no longer can: that shape is refused now, deliberately,
    ///      and `test_validateUserOp_refuses_a_raw_p256_signature` is what holds
    ///      the door shut.
    function _signature(uint256 privateKey, bytes32 userOpHash) internal pure returns (bytes memory) {
        return _encode(_assertion(privateKey, userOpHash));
    }
}

/// @notice `PasskeyAccount` — who may call it, what it signs for, what it runs.
contract PasskeyAccountTest is PasskeyAccountFixture {
    /// @dev Stands in for the digest EntryPoint v0.7 computes over the
    ///      operation, its own address and the chain id. Its content does not
    ///      matter to the account; that it is the thing signed does.
    bytes32 internal constant USER_OP_HASH = keccak256("userOpHash");

    address internal constant STRANGER = address(0xDEAD);

    function setUp() public {
        vm.warp(1_757_000_000);
        _deployAccount();
    }

    // --- Signature validation ------------------------------------------------

    function test_validateUserOp_accepts_the_owners_signature() public {
        PackedUserOperation memory op = _userOp(_signature(DOCTOR_KEY, USER_OP_HASH));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 0);
    }

    /// @notice A bad signature must be REPORTED, never thrown.
    ///
    /// @dev This is the ERC-4337 rule that is easiest to break by accident and
    ///      most expensive when broken: a reverting `validateUserOp` takes the
    ///      whole bundle down with it, so a bundler will simply stop including
    ///      operations from this account. The assertion is therefore not only
    ///      "the answer is 1" but "getting that answer did not revert" — which
    ///      is what calling it and reading a return value proves.
    function test_validateUserOp_reports_a_signature_over_another_hash() public {
        PackedUserOperation memory op = _userOp(_signature(DOCTOR_KEY, keccak256("another operation")));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    function test_validateUserOp_reports_a_signature_from_another_key() public {
        PackedUserOperation memory op = _userOp(_signature(IMPOSTOR_KEY, USER_OP_HASH));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @notice The malleable twin of a good assertion is refused.
    /// @dev Same key, same ceremony, same challenge, flipped `s` — accepted by
    ///      the precompile, refused here. See the malleability note in
    ///      `src/P256.sol` and the argument for where the flip belongs in
    ///      `WebAuthn.check`. THIS IS THE FAILURE MODE HALF OF ALL REAL LOGINS
    ///      WILL HIT if the client forgets to normalise, so it is also the case
    ///      `checkAssertion` has to be able to explain — see
    ///      `test_checkAssertion_names_a_high_s_signature`.
    function test_validateUserOp_reports_a_high_s_assertion() public {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        assertion.s = _flip(assertion.s);

        PackedUserOperation memory op = _userOp(_encode(assertion));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @notice A RAW P-256 SIGNATURE OVER THE `userOpHash` IS NOT ACCEPTED.
    ///
    /// @dev This is the test that pins down the decision, so it is worth being
    ///      blunt about what it asserts: the signature below is arithmetically
    ///      perfect. It is the owner's key, over this exact operation, and
    ///      `P256.verify` would say yes to it without hesitation. The account
    ///      says no, because a secure enclave cannot produce it — the enclave
    ///      only ever signs WebAuthn envelopes — so the only party who can is
    ///      one holding an exported private key. Accepting it would have been a
    ///      free compatibility shim usable exclusively by an attacker, and it
    ///      would have voided the User Verification rule on its way past.
    function test_validateUserOp_refuses_a_raw_p256_signature() public {
        (uint256 r, uint256 s) = _sign(DOCTOR_KEY, USER_OP_HASH);

        assertTrue(
            P256.verify(USER_OP_HASH, r, s, keyX, keyY, VERIFIER), "the raw signature is genuinely valid"
        );

        PackedUserOperation memory op = _userOp(abi.encode(r, s));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @notice A registration ceremony cannot be replayed as an authorisation.
    function test_validateUserOp_reports_a_registration_ceremony() public {
        PackedUserOperation memory op =
            _userOp(_encode(_assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_UV, TYPE_CREATE, ORIGIN)));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @notice An unverified user does not get to prescribe.
    /// @dev Someone touched the authenticator; it never established who. The
    ///      full argument is in `WebAuthn.check` step 17 and it is a
    ///      clinical-accountability one, not a UX one.
    function test_validateUserOp_reports_an_assertion_without_user_verification() public {
        PackedUserOperation memory op =
            _userOp(_encode(_assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_ONLY, TYPE_GET, ORIGIN)));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @dev `abi.decode` REVERTS on a buffer this short, and reverting is the
    ///      one thing validation must not do over a signature — it would take
    ///      the bundler's whole bundle with it. The self-call in
    ///      `decodeAssertion` is what turns that revert back into a `1`.
    function test_validateUserOp_reports_a_malformed_signature() public {
        PackedUserOperation memory op = _userOp(hex"1234");

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @dev Well-formed ABI, wrong shape: a tuple that decodes but whose inner
    ///      offsets point nowhere useful. Still a `1`, still not a revert.
    function test_validateUserOp_reports_an_envelope_of_the_wrong_shape() public {
        PackedUserOperation memory op = _userOp(abi.encode(uint256(1), uint256(2), uint256(3)));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    // --- The diagnostic ------------------------------------------------------

    /// @notice `checkAssertion` is silent when there is nothing to say.
    function test_checkAssertion_accepts_a_good_assertion() public view {
        account.checkAssertion(_signature(DOCTOR_KEY, USER_OP_HASH), USER_OP_HASH);
    }

    /// @notice The reason half the logins failed, in one free `eth_call`.
    ///
    /// @dev ERC-4337 lets `validateUserOp` answer nothing but 0 or 1, so a
    ///      client that forgot `if (s > n/2) s = n - s` sees an unexplained,
    ///      intermittent, fifty-percent failure rate and no way to tell it from
    ///      a wrong key, a wrong origin or a bad bundler. This is the whole
    ///      justification for the `Rejection` enum existing, so the test asserts
    ///      the REASON and not merely that it reverted.
    function test_checkAssertion_names_a_high_s_signature() public {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        assertion.s = _flip(assertion.s);

        vm.expectRevert(
            abi.encodeWithSelector(PasskeyAccount.AssertionRejected.selector, WebAuthn.Rejection.HighS)
        );
        account.checkAssertion(_encode(assertion), USER_OP_HASH);
    }

    function test_checkAssertion_names_a_missing_user_verification() public {
        bytes memory signature =
            _encode(_assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_ONLY, TYPE_GET, ORIGIN));

        vm.expectRevert(
            abi.encodeWithSelector(
                PasskeyAccount.AssertionRejected.selector, WebAuthn.Rejection.UserNotVerified
            )
        );
        account.checkAssertion(signature, USER_OP_HASH);
    }

    function test_checkAssertion_names_a_wrong_ceremony() public {
        bytes memory signature =
            _encode(_assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_UV, TYPE_CREATE, ORIGIN));

        vm.expectRevert(
            abi.encodeWithSelector(
                PasskeyAccount.AssertionRejected.selector, WebAuthn.Rejection.WrongCeremonyType
            )
        );
        account.checkAssertion(signature, USER_OP_HASH);
    }

    function test_checkAssertion_names_an_assertion_for_another_operation() public {
        bytes memory signature = _signature(DOCTOR_KEY, keccak256("a different operation"));

        vm.expectRevert(
            abi.encodeWithSelector(
                PasskeyAccount.AssertionRejected.selector, WebAuthn.Rejection.ChallengeMismatch
            )
        );
        account.checkAssertion(signature, USER_OP_HASH);
    }

    function test_checkAssertion_names_an_assertion_from_another_key() public {
        bytes memory signature = _signature(IMPOSTOR_KEY, USER_OP_HASH);

        vm.expectRevert(
            abi.encodeWithSelector(
                PasskeyAccount.AssertionRejected.selector, WebAuthn.Rejection.InvalidSignature
            )
        );
        account.checkAssertion(signature, USER_OP_HASH);
    }

    /// @dev Including the case that is not the library's to diagnose: a buffer
    ///      that never decoded at all.
    function test_checkAssertion_names_a_malformed_envelope() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                PasskeyAccount.AssertionRejected.selector, WebAuthn.Rejection.MalformedEnvelope
            )
        );
        account.checkAssertion(hex"1234", USER_OP_HASH);
    }

    /// @dev And that `checkAssertion` is only ever a diagnostic: it decides
    ///      nothing, it charges nothing, and anybody may call it. A doctor's app
    ///      asks it BEFORE putting a fingerprint prompt on screen.
    function test_checkAssertion_is_open_to_anyone() public {
        vm.prank(STRANGER);
        account.checkAssertion(_signature(DOCTOR_KEY, USER_OP_HASH), USER_OP_HASH);
    }

    function test_validateUserOp_reports_an_empty_signature() public {
        PackedUserOperation memory op = _userOp("");

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 1);
    }

    /// @dev The account is on a chain that has no RIP-7212 precompile. The
    ///      signature is good and it still validates, because the account was
    ///      built with a fallback verifier. This is Fase 5 item 2, end to end.
    function test_validateUserOp_still_works_without_the_precompile() public {
        vm.etch(address(0x100), "");

        PackedUserOperation memory op = _userOp(_signature(DOCTOR_KEY, USER_OP_HASH));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0), 0);
    }

    // --- The EntryPoint boundary ---------------------------------------------

    function test_validateUserOp_from_a_stranger_reverts() public {
        PackedUserOperation memory op = _userOp(_signature(DOCTOR_KEY, USER_OP_HASH));

        vm.expectRevert(abi.encodeWithSelector(PasskeyAccount.NotEntryPoint.selector, STRANGER));
        vm.prank(STRANGER);
        account.validateUserOp(op, USER_OP_HASH, 0);
    }

    /// @dev Holding the passkey is not the same as being allowed to call the
    ///      account directly. A correctly signed operation from the wrong caller
    ///      is still the wrong caller.
    function test_execute_from_a_stranger_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PasskeyAccount.NotEntryPoint.selector, STRANGER));
        vm.prank(STRANGER);
        account.execute(address(registry), 0, "");
    }

    // --- Prefunding ----------------------------------------------------------

    function test_validateUserOp_pays_the_entry_point_what_it_is_owed() public {
        vm.deal(address(account), 1 ether);
        uint256 before = ENTRY_POINT.balance;

        PackedUserOperation memory op = _userOp(_signature(DOCTOR_KEY, USER_OP_HASH));

        vm.prank(ENTRY_POINT);
        account.validateUserOp(op, USER_OP_HASH, 0.4 ether);

        assertEq(ENTRY_POINT.balance - before, 0.4 ether);
        assertEq(address(account).balance, 0.6 ether);
    }

    /// @dev Paid even when the signature is refused. The bundler spent real gas
    ///      finding that out and ERC-4337 lets it charge for the attempt.
    function test_validateUserOp_pays_even_when_the_signature_is_bad() public {
        vm.deal(address(account), 1 ether);
        uint256 before = ENTRY_POINT.balance;

        PackedUserOperation memory op = _userOp(_signature(IMPOSTOR_KEY, USER_OP_HASH));

        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, USER_OP_HASH, 0.4 ether), 1);

        assertEq(ENTRY_POINT.balance - before, 0.4 ether);
    }

    // --- Execution -----------------------------------------------------------

    /// @notice The point of the whole exercise: a prescription issued by a
    ///         passkey, through the EntryPoint, with no EOA anywhere.
    function test_execute_issues_a_prescription() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);

        bytes32 contentHash = keccak256("ciphertext-bytes");
        bytes32 commitment = keccak256("patientId+salt");
        uint64 expiresAt = uint64(block.timestamp + 30 days);

        vm.prank(ENTRY_POINT);
        account.execute(
            address(registry),
            0,
            abi.encodeCall(IPrescriptionRegistry.issue, (contentHash, commitment, expiresAt))
        );

        PrescriptionRecord memory record = registry.getPrescription(contentHash);

        assertEq(uint8(record.status), uint8(PrescriptionStatus.Issued));
        assertEq(record.prescriber, address(account), "the account is the prescriber, not an EOA");
        assertEq(record.patientCommitment, commitment);
        assertEq(record.expiresAt, expiresAt);
    }

    /// @dev The account self-registers its own credential, which is the step
    ///      that makes `issue` possible at all. It works because
    ///      `registerCredential` keys off `msg.sender`, and through `execute`
    ///      `msg.sender` is the account.
    function test_execute_registers_the_accounts_own_credential() public {
        bytes32 uid = _attest(PRACTITIONER_SCHEMA, address(account), ISSUER_AUTHORITY, 0, 0);

        vm.prank(ENTRY_POINT);
        account.execute(address(registry), 0, abi.encodeCall(IPrescriptionRegistry.registerCredential, (uid)));

        assertEq(registry.credentialOf(address(account)), uid);
    }

    /// @dev An unaccredited account gets the registry's own refusal, not a
    ///      generic one. The bubbling in `execute` is what preserves it.
    function test_execute_bubbles_the_registrys_error_with_its_arguments() public {
        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, address(account))
        );

        vm.prank(ENTRY_POINT);
        account.execute(
            address(registry),
            0,
            abi.encodeCall(
                IPrescriptionRegistry.issue,
                (keccak256("h"), keccak256("c"), uint64(block.timestamp + 1 days))
            )
        );
    }

    /// @notice `AlreadyDispensed` has to survive the trip, arguments and all.
    /// @dev It is the message the pharmacy screen is built around. A wrapper
    ///      that flattened it into "call failed" would be a product bug, so the
    ///      test asserts the three arguments and not just the selector.
    function test_execute_bubbles_already_dispensed_intact() public {
        _accredit(address(account), PRACTITIONER_SCHEMA);
        address pharmacy = address(0xB0B);
        _accredit(pharmacy, PHARMACY_SCHEMA);

        bytes32 contentHash = keccak256("dispensed-twice");

        vm.prank(ENTRY_POINT);
        account.execute(
            address(registry),
            0,
            abi.encodeCall(
                IPrescriptionRegistry.issue, (contentHash, keccak256("c"), uint64(block.timestamp + 30 days))
            )
        );

        vm.prank(pharmacy);
        registry.dispense(contentHash);

        uint64 dispensedAt = uint64(block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(
                IPrescriptionRegistry.AlreadyDispensed.selector, contentHash, pharmacy, dispensedAt
            )
        );
        vm.prank(ENTRY_POINT);
        account.execute(address(registry), 0, abi.encodeCall(IPrescriptionRegistry.cancel, (contentHash)));
    }

    // --- Containment ---------------------------------------------------------

    /// @notice The account is not a wallet, and this is what enforces it.
    /// @dev A stolen passkey can issue and cancel prescriptions — visible,
    ///      auditable, revocable by withdrawing the EAS credential. It cannot
    ///      approve a token, sign for another protocol, or reach any other
    ///      contract, because there is no path out of `execute` that does not go
    ///      to the registry.
    function test_execute_refuses_any_other_target() public {
        address elsewhere = address(0xBEEF);

        vm.expectRevert(
            abi.encodeWithSelector(PasskeyAccount.TargetNotAllowed.selector, elsewhere, address(registry))
        );
        vm.prank(ENTRY_POINT);
        account.execute(elsewhere, 0, "");
    }

    function test_execute_refuses_to_move_value() public {
        vm.deal(address(account), 1 ether);

        vm.expectRevert(abi.encodeWithSelector(PasskeyAccount.ValueNotAllowed.selector, 1 wei));
        vm.prank(ENTRY_POINT);
        account.execute(address(registry), 1 wei, "");
    }

    function test_account_accepts_native_currency() public {
        vm.deal(STRANGER, 1 ether);

        vm.prank(STRANGER);
        (bool sent,) = address(account).call{value: 1 ether}("");

        assertTrue(sent);
        assertEq(address(account).balance, 1 ether);
    }

    // --- Construction --------------------------------------------------------

    function test_the_account_is_wired_to_entry_point_v07() public view {
        assertEq(account.entryPoint(), ENTRY_POINT);
        assertEq(account.registry(), address(registry));
        assertEq(account.fallbackVerifier(), VERIFIER);
        assertEq(account.publicKeyX(), keyX);
        assertEq(account.publicKeyY(), keyY);
    }

    function test_constructor_refuses_a_zero_public_key() public {
        vm.expectRevert(abi.encodeWithSelector(PasskeyAccount.InvalidPublicKey.selector, 0, keyY));
        new PasskeyAccount(ENTRY_POINT, address(registry), VERIFIER, 0, keyY);

        vm.expectRevert(abi.encodeWithSelector(PasskeyAccount.InvalidPublicKey.selector, keyX, 0));
        new PasskeyAccount(ENTRY_POINT, address(registry), VERIFIER, keyX, 0);
    }
}

/// @notice `PasskeyAccountFactory` — the counterfactual address, and nothing else.
contract PasskeyAccountFactoryTest is PasskeyAccountFixture {
    function setUp() public {
        vm.warp(1_757_000_000);
        _deployAccount();
    }

    /// @notice The address can be known before the code exists.
    /// @dev This is what lets the credential authority attest to a doctor's
    ///      account before that account has ever been deployed, which is what
    ///      lets the first prescription be the transaction that deploys it.
    function test_getAddress_predicts_the_account_before_it_exists() public {
        (uint256 otherX, uint256 otherY) = _publicKey(IMPOSTOR_KEY);

        address predicted = factory.getAddress(otherX, otherY);
        assertEq(predicted.code.length, 0, "nothing should be deployed there yet");

        assertEq(address(factory.createAccount(otherX, otherY)), predicted);
        assertGt(predicted.code.length, 0);
    }

    /// @dev ERC-4337 can replay a UserOperation's `initCode` against an account
    ///      that already exists. The factory must hand back what is there rather
    ///      than revert on the CREATE2 collision.
    function test_createAccount_is_idempotent() public {
        assertEq(address(factory.createAccount(keyX, keyY)), address(account));
    }

    /// @notice One passkey, one address — and a different passkey is a different
    ///         account, necessarily.
    /// @dev The key is a constructor argument, so it is inside the initcode the
    ///      CREATE2 address is derived from. That is what stops an EAS
    ///      credential issued to one address from ever covering another key.
    function test_the_address_is_bound_to_the_public_key() public view {
        (uint256 otherX, uint256 otherY) = _publicKey(IMPOSTOR_KEY);

        assertTrue(factory.getAddress(keyX, keyY) != factory.getAddress(otherX, otherY));
        assertEq(factory.getAddress(keyX, keyY), address(account));
    }

    function test_accounts_from_this_factory_can_sign() public {
        (uint256 otherX, uint256 otherY) = _publicKey(IMPOSTOR_KEY);
        PasskeyAccount other = factory.createAccount(otherX, otherY);

        bytes32 userOpHash = keccak256("a second doctor's operation");

        PackedUserOperation memory op = _userOp(_signature(IMPOSTOR_KEY, userOpHash));
        op.sender = address(other);

        vm.prank(ENTRY_POINT);
        assertEq(other.validateUserOp(op, userOpHash, 0), 0);

        // ...and cannot sign for the first doctor's account.
        vm.prank(ENTRY_POINT);
        assertEq(account.validateUserOp(op, userOpHash, 0), 1);
    }
}
