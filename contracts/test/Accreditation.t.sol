// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IPrescriptionRegistry} from "../src/IPrescriptionRegistry.sol";
import {RegistryFixture} from "./helpers/RegistryFixture.sol";

/// @notice Credential verification against EAS.
///
/// @dev Two questions are answered here, and they are not the same one.
///
///      1. Registration: which uids may an account point itself at? Anyone can
///         call `registerCredential`, so the five checks of
///         docs/04-smart-contracts.md must reject a forged pointer at the door.
///      2. Use: is the credential still live at the moment of `issue` or
///         `dispense`? The registry re-reads EAS on every call and caches
///         nothing, so a credential that passed registration yesterday must
///         fail today if it was revoked, expired, reassigned or reissued by
///         someone other than the authority.
///
///      The second half is why the state is mutated under a registered uid in
///      several tests below. Real EAS cannot overwrite an attestation; the test
///      double can, and that is the only way to reach the state a revocation or
///      a compromised issuer would produce without inventing a second contract.
contract AccreditationTest is RegistryFixture {
    address internal constant PRESCRIBER = address(0xA11CE);
    address internal constant PHARMACY_A = address(0xB0B);
    /// @dev Deliberately never accredited: this is the pharmacy off the register.
    address internal constant PHARMACY_B = address(0xCAFE);
    address internal constant IMPOSTOR_ISSUER = address(0xBADC0DE);

    bytes32 internal constant CONTENT_HASH = keccak256("ciphertext-bytes");
    bytes32 internal constant PATIENT_COMMITMENT = keccak256("patientId+per-prescription-salt");
    bytes32 internal constant OTHER_SCHEMA = keccak256("SomeOtherCredential");

    uint64 internal expiresAt;

    event CredentialRegistered(address indexed account, bytes32 indexed uid, bytes32 indexed schema);

    function setUp() public {
        vm.warp(1_757_000_000);

        _deployRegistry();

        _accredit(PRESCRIBER, PRACTITIONER_SCHEMA);
        _accredit(PHARMACY_A, PHARMACY_SCHEMA);

        expiresAt = uint64(block.timestamp + 30 days);

        vm.prank(PRESCRIBER);
        registry.issue(CONTENT_HASH, PATIENT_COMMITMENT, expiresAt);
    }

    // ---------------------------------------------------------------------
    // Registration: the happy path and renewal
    // ---------------------------------------------------------------------

    function test_registerCredential_stores_the_pointer_and_emits() public {
        bytes32 uid = _attest(PHARMACY_SCHEMA, PHARMACY_B, ISSUER_AUTHORITY, 0, 0);

        vm.expectEmit(true, true, true, false);
        emit CredentialRegistered(PHARMACY_B, uid, PHARMACY_SCHEMA);

        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);

        assertEq(registry.credentialOf(PHARMACY_B), uid);
    }

    /// @notice A renewal is a new uid, and the pointer simply moves. No
    ///         administrator is involved, and the old uid stops being used.
    function test_registerCredential_renewal_replaces_the_uid() public {
        bytes32 firstUid = registry.credentialOf(PHARMACY_A);
        bytes32 renewedUid =
            _attest(PHARMACY_SCHEMA, PHARMACY_A, ISSUER_AUTHORITY, uint64(block.timestamp + 365 days), 0);

        assertTrue(renewedUid != firstUid);

        vm.prank(PHARMACY_A);
        registry.registerCredential(renewedUid);

        assertEq(registry.credentialOf(PHARMACY_A), renewedUid);

        // The renewed credential works straight away.
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);
    }

    // ---------------------------------------------------------------------
    // Registration: the five reasons a pointer is refused
    // ---------------------------------------------------------------------

    function test_registerCredential_with_zero_uid_reverts() public {
        vm.expectRevert(IPrescriptionRegistry.InvalidCredentialUid.selector);
        vm.prank(PHARMACY_B);
        registry.registerCredential(bytes32(0));
    }

    /// @notice EAS answers an unknown uid with a zeroed struct, not a revert.
    ///         A made-up uid must not be mistaken for a valid credential.
    function test_registerCredential_with_unknown_uid_reverts() public {
        bytes32 invented = keccak256("a uid nobody ever attested");

        vm.expectRevert(abi.encodeWithSelector(IPrescriptionRegistry.CredentialNotFound.selector, invented));
        vm.prank(PHARMACY_B);
        registry.registerCredential(invented);
    }

    function test_registerCredential_of_another_account_reverts() public {
        bytes32 uid = registry.credentialOf(PHARMACY_A);

        vm.expectRevert(
            abi.encodeWithSelector(
                IPrescriptionRegistry.CredentialNotForCaller.selector, PHARMACY_B, PHARMACY_A
            )
        );
        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);
    }

    /// @notice Anyone can attest anything in EAS. Only the authority counts.
    function test_registerCredential_from_unauthorised_issuer_reverts() public {
        bytes32 uid = _attest(PHARMACY_SCHEMA, PHARMACY_B, IMPOSTOR_ISSUER, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                IPrescriptionRegistry.CredentialWrongIssuer.selector, IMPOSTOR_ISSUER, ISSUER_AUTHORITY
            )
        );
        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);
    }

    function test_registerCredential_with_unknown_schema_reverts() public {
        bytes32 uid = _attest(OTHER_SCHEMA, PHARMACY_B, ISSUER_AUTHORITY, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.CredentialUnknownSchema.selector, OTHER_SCHEMA)
        );
        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);
    }

    function test_registerCredential_already_revoked_reverts() public {
        uint64 revokedAt = uint64(block.timestamp - 1 days);
        bytes32 uid = _attest(PHARMACY_SCHEMA, PHARMACY_B, ISSUER_AUTHORITY, 0, revokedAt);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.CredentialRevoked.selector, uid, revokedAt)
        );
        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);
    }

    function test_registerCredential_already_expired_reverts() public {
        uint64 credentialExpiry = uint64(block.timestamp - 1);
        bytes32 uid = _attest(PHARMACY_SCHEMA, PHARMACY_B, ISSUER_AUTHORITY, credentialExpiry, 0);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.CredentialExpired.selector, uid, credentialExpiry)
        );
        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);
    }

    // ---------------------------------------------------------------------
    // `dispense`: the five reasons a pharmacy is not accredited
    // ---------------------------------------------------------------------

    /// @notice Named in docs/04-smart-contracts.md. Exit criterion of phase 3:
    ///         the contract refuses an account with no credential at all.
    function test_dispense_without_credential_reverts() public {
        assertEq(registry.credentialOf(PHARMACY_B), bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPharmacy.selector, PHARMACY_B)
        );
        vm.prank(PHARMACY_B);
        registry.dispense(CONTENT_HASH);
    }

    /// @notice Named in docs/04-smart-contracts.md. A revocation made AFTER the
    ///         credential was registered cuts access on the very next call,
    ///         because the verdict is never cached — only the pointer is.
    function test_dispense_with_revoked_credential_reverts() public {
        bytes32 uid = registry.credentialOf(PHARMACY_A);

        // It worked a moment ago: same pharmacy, same credential, another
        // prescription, dispensed without complaint.
        bytes32 earlierHash = keccak256("an-earlier-ciphertext");
        vm.prank(PRESCRIBER);
        registry.issue(earlierHash, PATIENT_COMMITMENT, expiresAt);
        vm.prank(PHARMACY_A);
        registry.dispense(earlierHash);

        eas.revoke(uid);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPharmacy.selector, PHARMACY_A)
        );
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);

        // The pointer is untouched: what changed is what EAS answers about it.
        assertEq(registry.credentialOf(PHARMACY_A), uid);
    }

    function test_dispense_with_expired_credential_reverts() public {
        uint64 credentialExpiry = uint64(block.timestamp + 10 days);
        bytes32 uid = _attest(PHARMACY_SCHEMA, PHARMACY_B, ISSUER_AUTHORITY, credentialExpiry, 0);

        vm.prank(PHARMACY_B);
        registry.registerCredential(uid);

        // Past the credential expiry, still well inside the prescription's.
        vm.warp(credentialExpiry + 1);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPharmacy.selector, PHARMACY_B)
        );
        vm.prank(PHARMACY_B);
        registry.dispense(CONTENT_HASH);
    }

    /// @notice The credential was reissued to somebody else under the same uid.
    ///         `recipient != account` stops the previous holder from reusing it.
    function test_dispense_with_credential_of_another_account_reverts() public {
        bytes32 uid = registry.credentialOf(PHARMACY_A);
        eas.attestWithUid(uid, PHARMACY_SCHEMA, PHARMACY_B, ISSUER_AUTHORITY, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPharmacy.selector, PHARMACY_A)
        );
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);
    }

    /// @notice The attestation behind a registered uid was replaced by one the
    ///         authority never signed. `attester != issuerAuthority` catches it.
    function test_dispense_with_credential_from_unauthorised_issuer_reverts() public {
        bytes32 uid = registry.credentialOf(PHARMACY_A);
        eas.attestWithUid(uid, PHARMACY_SCHEMA, PHARMACY_A, IMPOSTOR_ISSUER, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPharmacy.selector, PHARMACY_A)
        );
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);
    }

    /// @notice A practitioner credential is not a pharmacy licence. Both are
    ///         registered through the same door, and the schema keeps them apart.
    function test_dispense_with_practitioner_credential_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPharmacy.selector, PRESCRIBER)
        );
        vm.prank(PRESCRIBER);
        registry.dispense(CONTENT_HASH);
    }

    // ---------------------------------------------------------------------
    // `issue`: the same five reasons for a practitioner
    // ---------------------------------------------------------------------

    /// @notice Named in docs/04-smart-contracts.md.
    function test_issue_by_non_practitioner_reverts() public {
        assertEq(registry.credentialOf(PHARMACY_B), bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, PHARMACY_B)
        );
        vm.prank(PHARMACY_B);
        registry.issue(keccak256("other-ciphertext"), PATIENT_COMMITMENT, expiresAt);
    }

    function test_issue_with_revoked_credential_reverts() public {
        eas.revoke(registry.credentialOf(PRESCRIBER));

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, PRESCRIBER)
        );
        vm.prank(PRESCRIBER);
        registry.issue(keccak256("other-ciphertext"), PATIENT_COMMITMENT, expiresAt);
    }

    function test_issue_with_expired_credential_reverts() public {
        address doctor = address(0xD0C2);
        uint64 credentialExpiry = uint64(block.timestamp + 10 days);
        bytes32 uid = _attest(PRACTITIONER_SCHEMA, doctor, ISSUER_AUTHORITY, credentialExpiry, 0);

        vm.prank(doctor);
        registry.registerCredential(uid);

        vm.warp(credentialExpiry + 1);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, doctor)
        );
        vm.prank(doctor);
        registry.issue(keccak256("other-ciphertext"), PATIENT_COMMITMENT, uint64(block.timestamp + 30 days));
    }

    function test_issue_with_credential_of_another_account_reverts() public {
        bytes32 uid = registry.credentialOf(PRESCRIBER);
        eas.attestWithUid(uid, PRACTITIONER_SCHEMA, address(0xD0C2), ISSUER_AUTHORITY, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, PRESCRIBER)
        );
        vm.prank(PRESCRIBER);
        registry.issue(keccak256("other-ciphertext"), PATIENT_COMMITMENT, expiresAt);
    }

    function test_issue_with_credential_from_unauthorised_issuer_reverts() public {
        bytes32 uid = registry.credentialOf(PRESCRIBER);
        eas.attestWithUid(uid, PRACTITIONER_SCHEMA, PRESCRIBER, IMPOSTOR_ISSUER, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, PRESCRIBER)
        );
        vm.prank(PRESCRIBER);
        registry.issue(keccak256("other-ciphertext"), PATIENT_COMMITMENT, expiresAt);
    }

    /// @notice A pharmacy licence does not let you prescribe.
    function test_issue_with_pharmacy_credential_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotAccreditedPractitioner.selector, PHARMACY_A)
        );
        vm.prank(PHARMACY_A);
        registry.issue(keccak256("other-ciphertext"), PATIENT_COMMITMENT, expiresAt);
    }
}
