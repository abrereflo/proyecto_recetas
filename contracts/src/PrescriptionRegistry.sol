// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IPrescriptionRegistry, PrescriptionRecord, PrescriptionStatus} from "./IPrescriptionRegistry.sol";
import {Attestation, IEAS} from "./IEAS.sol";

/// @title PrescriptionRegistry
/// @notice Lifecycle of a verifiable prescription: issue, dispense once, cancel.
///
/// @dev Design rules this contract must never break (docs/04-smart-contracts.md):
///
///      1. NO patient identifier on-chain. Not the id, not a hash of the id,
///         not a stable pseudonym. Only `keccak256(patientId, salt)` with a
///         DIFFERENT salt per prescription. A code review that finds a name, an
///         id, a diagnosis, an allergy or a drug name in this file must block
///         the merge (docs/03-modelo-de-datos.md).
///      2. `Dispensed` is absorbing. There is no reopen function: not
///         administrative, not emergency, not multisig. A mistake is fixed by
///         issuing a new prescription, and the mistake stays on the chain.
///      3. Checks-effects-interactions. State is written after every check and
///         there is no external call after a state mutation. The only external
///         call is the read to EAS, and it always happens BEFORE any write.
///      4. No administrator (D-14). Nobody can grant, whitelist or revoke here.
///         Credentials live in EAS, are self-registered as a pointer, and are
///         re-verified against EAS on every single call.
///
/// @dev The MVP is single-use per prescription. Chronic treatment and partial
///      dispensing (quantityLeft / maxClaims) are a documented extension and
///      are deliberately NOT implemented here (D-12).
contract PrescriptionRegistry is IPrescriptionRegistry {
    mapping(bytes32 contentHash => PrescriptionRecord record) private _records;

    /// @notice The EAS uid each account registered for itself, or zero.
    /// @dev A POINTER, not a verdict. The attestation behind it is re-read and
    ///      re-validated on every call, so the answer is never cached: a licence
    ///      withdrawn one second ago blocks the next `dispense`.
    mapping(address account => bytes32 uid) public credentialOf;

    /// @notice Ethereum Attestation Service instance holding professional credentials.
    address public immutable eas;

    /// @notice EAS schema uid for practitioner credentials.
    bytes32 public immutable practitionerSchema;

    /// @notice EAS schema uid for pharmacy credentials.
    bytes32 public immutable pharmacySchema;

    /// @notice The only attester whose credentials count. Anyone can issue an
    ///         attestation; only the authorised issuer's is accepted.
    address public immutable issuerAuthority;

    constructor(
        address eas_,
        bytes32 practitionerSchema_,
        bytes32 pharmacySchema_,
        address issuerAuthority_
    ) {
        eas = eas_;
        practitionerSchema = practitionerSchema_;
        pharmacySchema = pharmacySchema_;
        issuerAuthority = issuerAuthority_;
    }

    /// @inheritdoc IPrescriptionRegistry
    function issue(bytes32 contentHash, bytes32 patientCommitment, uint64 expiresAt) external {
        if (!_isAccreditedPractitioner(msg.sender)) {
            revert NotAccreditedPractitioner(msg.sender);
        }
        if (expiresAt <= block.timestamp) {
            revert InvalidExpiry(expiresAt);
        }

        PrescriptionRecord storage p = _records[contentHash];

        if (p.status != PrescriptionStatus.None) {
            revert AlreadyIssued(contentHash);
        }

        p.prescriber = msg.sender;
        p.patientCommitment = patientCommitment;
        p.issuedAt = uint64(block.timestamp);
        p.expiresAt = expiresAt;
        p.status = PrescriptionStatus.Issued;

        emit PrescriptionIssued(contentHash, msg.sender, patientCommitment, expiresAt);
    }

    /// @inheritdoc IPrescriptionRegistry
    /// @dev The heart of the system. The second call reverts with
    ///      `AlreadyDispensed`, and that revert is the demo.
    function dispense(bytes32 contentHash) external {
        if (!_isAccreditedPharmacy(msg.sender)) {
            revert NotAccreditedPharmacy(msg.sender);
        }

        PrescriptionRecord storage p = _records[contentHash];

        if (p.status == PrescriptionStatus.None) {
            revert UnknownPrescription(contentHash);
        }
        if (p.status == PrescriptionStatus.Cancelled) {
            revert PrescriptionCancelledError(contentHash);
        }
        if (p.status == PrescriptionStatus.Dispensed) {
            revert AlreadyDispensed(contentHash, p.dispensedBy, p.dispensedAt);
        }
        if (block.timestamp >= p.expiresAt) {
            revert PrescriptionExpired(contentHash, p.expiresAt);
        }

        p.status = PrescriptionStatus.Dispensed;
        p.dispensedBy = msg.sender;
        p.dispensedAt = uint64(block.timestamp);

        emit PrescriptionDispensed(contentHash, msg.sender, p.dispensedAt);
    }

    /// @inheritdoc IPrescriptionRegistry
    /// @dev Only the prescriber, only before dispensing.
    function cancel(bytes32 contentHash) external {
        PrescriptionRecord storage p = _records[contentHash];

        if (p.status == PrescriptionStatus.None) {
            revert UnknownPrescription(contentHash);
        }
        if (p.prescriber != msg.sender) {
            revert NotPrescriber(msg.sender, p.prescriber);
        }
        if (p.status == PrescriptionStatus.Dispensed) {
            revert AlreadyDispensed(contentHash, p.dispensedBy, p.dispensedAt);
        }
        if (p.status == PrescriptionStatus.Cancelled) {
            revert PrescriptionCancelledError(contentHash);
        }

        p.status = PrescriptionStatus.Cancelled;

        emit PrescriptionCancelled(contentHash, msg.sender);
    }

    /// @inheritdoc IPrescriptionRegistry
    /// @dev Read-only, no gas cost for the pharmacy. `dispensable` folds the
    ///      derived expiry condition in, so the client never has to infer it.
    function verify(bytes32 contentHash)
        external
        view
        returns (PrescriptionStatus status, bool dispensable, address prescriber, uint64 expiresAt)
    {
        PrescriptionRecord storage p = _records[contentHash];

        status = p.status;
        prescriber = p.prescriber;
        expiresAt = p.expiresAt;
        dispensable = status == PrescriptionStatus.Issued && block.timestamp < p.expiresAt;
    }

    /// @inheritdoc IPrescriptionRegistry
    function getPrescription(bytes32 contentHash) external view returns (PrescriptionRecord memory) {
        return _records[contentHash];
    }

    /// @inheritdoc IPrescriptionRegistry
    /// @dev Self-registration, and it introduces no administrator.
    ///
    ///      Anyone may call this with any uid, but a uid only sticks if EAS says
    ///      it is an unrevoked, unexpired credential issued by `issuerAuthority`
    ///      to the caller under one of the two known schemas. A forged pointer
    ///      fails every one of those checks, so the permission to write here is
    ///      worthless: the authority stays with the credential issuer, exactly
    ///      as docs/02-roles-y-permisos.md describes.
    ///
    ///      Checks-effects-interactions: the EAS read is the only external call
    ///      and it completes before `credentialOf` is written.
    function registerCredential(bytes32 uid) external {
        if (uid == bytes32(0)) {
            revert InvalidCredentialUid();
        }

        Attestation memory a = IEAS(eas).getAttestation(uid);

        // EAS answers an unknown uid with a zeroed struct instead of reverting.
        if (a.uid == bytes32(0)) {
            revert CredentialNotFound(uid);
        }
        if (a.recipient != msg.sender) {
            revert CredentialNotForCaller(msg.sender, a.recipient);
        }
        if (a.attester != issuerAuthority) {
            revert CredentialWrongIssuer(a.attester, issuerAuthority);
        }
        if (a.schema != practitionerSchema && a.schema != pharmacySchema) {
            revert CredentialUnknownSchema(a.schema);
        }
        if (a.revocationTime != 0) {
            revert CredentialRevoked(uid, a.revocationTime);
        }
        if (a.expirationTime != 0 && block.timestamp >= a.expirationTime) {
            revert CredentialExpired(uid, a.expirationTime);
        }

        // Renewal is just a new uid taking the place of the old one.
        credentialOf[msg.sender] = uid;

        emit CredentialRegistered(msg.sender, uid, a.schema);
    }

    /// @dev The five checks of docs/04-smart-contracts.md, read from EAS on
    ///      every call and NEVER cached in storage, so a withdrawn licence cuts
    ///      access immediately.
    function _isAccreditedPractitioner(address account) internal view returns (bool) {
        return _hasLiveCredential(account, practitionerSchema);
    }

    /// @dev The same five checks against `pharmacySchema`.
    function _isAccreditedPharmacy(address account) internal view returns (bool) {
        return _hasLiveCredential(account, pharmacySchema);
    }

    /// @dev Shared body of both accreditation checks. `schema` is what separates
    ///      a practitioner from a pharmacy: a pharmacy credential can never
    ///      satisfy `issue`, and a practitioner credential can never satisfy
    ///      `dispense`, even though both are registered through the same door.
    function _hasLiveCredential(address account, bytes32 schema) private view returns (bool) {
        bytes32 uid = credentialOf[account];
        if (uid == bytes32(0)) return false;

        Attestation memory a = IEAS(eas).getAttestation(uid);

        return a.schema == schema && a.recipient == account && a.attester == issuerAuthority
            && a.revocationTime == 0 && (a.expirationTime == 0 || block.timestamp < a.expirationTime);
    }
}
