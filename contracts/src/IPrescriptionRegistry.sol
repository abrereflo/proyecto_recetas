// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Lifecycle status of a prescription.
/// @dev `Expired` is deliberately absent. It is not a stored state: it is a
///      condition derived by comparing `block.timestamp` with `expiresAt`.
///      Nobody pays gas to declare expired a prescription nobody will use.
///      Numeric values must stay aligned with the TypeScript enum in
///      packages/shared/src/prescription.ts.
enum PrescriptionStatus {
    None,
    Issued,
    Dispensed,
    Cancelled
}

/// @notice The complete on-chain record.
/// @dev Four things only: a content hash, a salted patient commitment, the
///      prescriber address and two timestamps. Everything that identifies a
///      person or describes their health lives encrypted off-chain
///      (docs/03-modelo-de-datos.md).
struct PrescriptionRecord {
    address prescriber; // smart account of the practitioner
    bytes32 patientCommitment; // keccak256(patientId, salt) - salt stays off-chain
    uint64 issuedAt;
    uint64 expiresAt;
    address dispensedBy;
    uint64 dispensedAt;
    PrescriptionStatus status;
}

interface IPrescriptionRegistry {
    event PrescriptionIssued(
        bytes32 indexed contentHash, address indexed prescriber, bytes32 patientCommitment, uint64 expiresAt
    );
    event PrescriptionDispensed(bytes32 indexed contentHash, address indexed pharmacy, uint64 dispensedAt);
    event PrescriptionCancelled(bytes32 indexed contentHash, address indexed prescriber);
    /// @notice An account pointed itself at its own EAS credential.
    /// @dev Registration stores a POINTER, never a verdict. The attestation is
    ///      re-read and re-validated on every `issue` and every `dispense`, so a
    ///      revocation made after this event cuts access on the next call.
    event CredentialRegistered(address indexed account, bytes32 indexed uid, bytes32 indexed schema);

    error AlreadyIssued(bytes32 contentHash);
    error UnknownPrescription(bytes32 contentHash);
    /// @dev Returns who dispensed and when, so the pharmacy screen can say
    ///      "already dispensed on X by another pharmacy" instead of a generic
    ///      failure. This message is what the pitch projects.
    error AlreadyDispensed(bytes32 contentHash, address dispensedBy, uint64 dispensedAt);
    error PrescriptionExpired(bytes32 contentHash, uint64 expiresAt);
    error PrescriptionCancelledError(bytes32 contentHash);
    error NotAccreditedPractitioner(address caller);
    error NotAccreditedPharmacy(address caller);
    error NotPrescriber(address caller, address prescriber);
    error InvalidExpiry(uint64 expiresAt);

    // --- Credential registration ------------------------------------------
    // Self-registration is permissionless, so every rejection has to say which
    // of the five checks failed. "Not accredited" alone leaves the practitioner
    // guessing between a typo, a wrong issuer and a withdrawn licence.

    error InvalidCredentialUid();
    error CredentialNotFound(bytes32 uid);
    error CredentialNotForCaller(address caller, address recipient);
    error CredentialWrongIssuer(address attester, address expectedIssuer);
    error CredentialUnknownSchema(bytes32 schema);
    error CredentialRevoked(bytes32 uid, uint64 revocationTime);
    error CredentialExpired(bytes32 uid, uint64 expirationTime);

    /// @notice Point `msg.sender` at its own EAS credential.
    /// @dev Permissionless on purpose: there is no administrator (D-14). A uid
    ///      that does not belong to the caller, was not signed by the credential
    ///      authority, carries an unknown schema, is revoked or has expired is
    ///      rejected here and would be rejected again on every use.
    ///      Registering again is how a renewal lands: a renewed credential is a
    ///      new uid, and the pointer simply moves.
    function registerCredential(bytes32 uid) external;

    /// @notice The EAS uid this account registered, or zero.
    function credentialOf(address account) external view returns (bytes32 uid);

    function issue(bytes32 contentHash, bytes32 patientCommitment, uint64 expiresAt) external;

    function dispense(bytes32 contentHash) external;

    function cancel(bytes32 contentHash) external;

    function verify(bytes32 contentHash)
        external
        view
        returns (PrescriptionStatus status, bool dispensable, address prescriber, uint64 expiresAt);

    function getPrescription(bytes32 contentHash) external view returns (PrescriptionRecord memory);
}
