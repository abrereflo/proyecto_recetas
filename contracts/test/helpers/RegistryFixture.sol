// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrescriptionRegistry} from "../../src/PrescriptionRegistry.sol";
import {MockEAS} from "../mocks/MockEAS.sol";

/// @notice Shared wiring for every test that needs an accredited caller.
///
/// @dev Accreditation is now a precondition of `issue` and `dispense`, so each
///      suite would otherwise repeat the same four steps: deploy the EAS double,
///      deploy the registry, attest, register. The helpers below keep that noise
///      out of the tests that are really about the prescription lifecycle.
abstract contract RegistryFixture is Test {
    MockEAS internal eas;
    PrescriptionRegistry internal registry;

    /// @dev The credential authority of the pilot (a multisig in production,
    ///      docs/02-roles-y-permisos.md). Only its attestations count.
    address internal constant ISSUER_AUTHORITY = address(0xACCEDA);

    bytes32 internal constant PRACTITIONER_SCHEMA = keccak256("PractitionerCredential");
    bytes32 internal constant PHARMACY_SCHEMA = keccak256("PharmacyCredential");

    /// @dev Deploys the EAS double and a registry pointed at it.
    function _deployRegistry() internal {
        eas = new MockEAS();
        registry =
            new PrescriptionRegistry(address(eas), PRACTITIONER_SCHEMA, PHARMACY_SCHEMA, ISSUER_AUTHORITY);
    }

    /// @dev The happy path: a live credential issued by the authority to
    ///      `account`, registered by `account` itself.
    function _accredit(address account, bytes32 schema) internal returns (bytes32 uid) {
        uid = _attest(schema, account, ISSUER_AUTHORITY, 0, 0);
        vm.prank(account);
        registry.registerCredential(uid);
    }

    /// @dev Raw attestation, every field caller-controlled, nothing registered.
    function _attest(
        bytes32 schema,
        address recipient,
        address attester,
        uint64 expirationTime,
        uint64 revocationTime
    ) internal returns (bytes32 uid) {
        uid = eas.attest(schema, recipient, attester, expirationTime, revocationTime);
    }
}
