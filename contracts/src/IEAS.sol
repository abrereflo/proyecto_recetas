// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice An attestation as stored by the Ethereum Attestation Service.
///
/// @dev Transcribed field by field from EAS v1.2.0
///      (`eas-contracts/contracts/Common.sol`). The order and the types must
///      match the deployed contract EXACTLY: `getAttestation` returns an ABI
///      encoded tuple, and a reordered or resized field decodes into the wrong
///      slot silently — `revocationTime` would be read from `expirationTime`
///      and a revoked credential would pass. Any change here must be checked
///      against the canonical source, never inferred.
struct Attestation {
    bytes32 uid; // A unique identifier of the attestation.
    bytes32 schema; // The unique identifier of the schema.
    uint64 time; // The time when the attestation was created (Unix timestamp).
    uint64 expirationTime; // The time when the attestation expires (Unix timestamp), 0 for never.
    uint64 revocationTime; // The time when the attestation was revoked (Unix timestamp), 0 if live.
    bytes32 refUID; // The UID of the related attestation.
    address recipient; // The recipient of the attestation.
    address attester; // The attester/sender of the attestation.
    bool revocable; // Whether the attestation is revocable.
    bytes data; // Custom attestation data.
}

/// @notice The only part of the EAS surface this project consumes.
///
/// @dev `PrescriptionRegistry` never attests and never revokes: credentials are
///      issued and withdrawn by the credential authority, off this contract
///      (docs/02-roles-y-permisos.md). The registry only reads.
///
///      An unknown uid is NOT an error in EAS: `getAttestation` returns a
///      zeroed `Attestation`. Callers must therefore treat "all fields zero" as
///      "no such credential" rather than expecting a revert.
interface IEAS {
    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}
