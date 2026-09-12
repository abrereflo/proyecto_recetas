// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {ISchemaResolver} from "@eas/resolver/ISchemaResolver.sol";

/// @notice Registers the two credential schemas of docs/03-modelo-de-datos.md
///         in the SchemaRegistry deployed by `DeployEAS.s.sol`.
///
///   SCHEMA_REGISTRY_ADDRESS=0x... \
///   forge script script/RegisterSchemas.s.sol --rpc-url fuji --broadcast
///
/// @dev The two declarations below are byte for byte the ones `LocalDemo.sol`
///      hashes for the Anvil stand-ins. Keeping one wording for both paths is
///      what makes a credential issued locally and one issued on Fuji describe
///      the same thing.
///
///      THE UIDS DO NOT MATCH BETWEEN THE TWO PATHS, AND THAT IS EXPECTED.
///      `LocalDemo` uses `keccak256(declaration)` as a stand-in uid. The real
///      registry derives it as `keccak256(abi.encodePacked(schema, resolver,
///      revocable))`, so the values printed here are different numbers and they
///      are the only ones a public deployment may use. Copy them into
///      PRACTITIONER_SCHEMA_UID and PHARMACY_SCHEMA_UID before running
///      `Deploy.s.sol`, which burns them into the registry as immutables.
///
///      Registration is idempotent on purpose: `SchemaRegistry.register`
///      reverts with `AlreadyExists()` on a second attempt, which would abort a
///      rerun after a partial deployment. The uid is derived off-chain first and
///      the schema is only submitted when the registry does not know it yet.
contract RegisterSchemas is Script {
    error MissingSchemaRegistryAddress();
    error NoCodeAtSchemaRegistry(address schemaRegistry);
    error UnexpectedUid(bytes32 expected, bytes32 actual);

    /// @dev Same declaration as `LocalDemo.PRACTITIONER_SCHEMA`.
    string internal constant PRACTITIONER_DECLARATION =
        "PractitionerCredential(string licenseNumber,string specialtyCode,address issuerAuthority,uint64 validFrom,uint64 validUntil)";

    /// @dev Same declaration as `LocalDemo.PHARMACY_SCHEMA`.
    string internal constant PHARMACY_DECLARATION =
        "PharmacyCredential(string pharmacyLicense,string sanitaryRegistryRef,address issuerAuthority,uint64 validFrom,uint64 validUntil)";

    /// @dev Credentials MUST be revocable. `_isAccreditedPractitioner` and
    ///      `_isAccreditedPharmacy` reject an attestation whose `revocationTime`
    ///      is set, and a schema registered as non-revocable would make the
    ///      credential authority unable to withdraw an accreditation at all.
    bool internal constant REVOCABLE = true;

    /// @dev No resolver: the registry reads attestations, it never delegates a
    ///      side effect to attestation time (docs/04-smart-contracts.md).
    ISchemaResolver internal constant NO_RESOLVER = ISchemaResolver(address(0));

    function run() external returns (bytes32 practitionerUid, bytes32 pharmacyUid) {
        address configured = vm.envOr("SCHEMA_REGISTRY_ADDRESS", address(0));
        if (configured == address(0)) revert MissingSchemaRegistryAddress();
        if (configured.code.length == 0) revert NoCodeAtSchemaRegistry(configured);

        ISchemaRegistry registry = ISchemaRegistry(configured);

        console2.log("--- Esquemas de credencial --------------------------------");
        console2.log("chainId:", block.chainid);
        console2.log("SchemaRegistry:", configured);

        practitionerUid = _register(registry, "PractitionerCredential", PRACTITIONER_DECLARATION);
        pharmacyUid = _register(registry, "PharmacyCredential", PHARMACY_DECLARATION);

        console2.log("-----------------------------------------------------------");
        console2.log("Copie esos uids a PRACTITIONER_SCHEMA_UID y PHARMACY_SCHEMA_UID en .env.");
        console2.log("Siguiente paso: forge script script/Deploy.s.sol --broadcast");
    }

    function _register(ISchemaRegistry registry, string memory label, string memory declaration)
        private
        returns (bytes32 uid)
    {
        uid = _uid(declaration);

        if (registry.getSchema(uid).uid != bytes32(0)) {
            console2.log(label, "ya estaba registrado, uid:");
            console2.logBytes32(uid);
            return uid;
        }

        vm.broadcast();
        bytes32 registered = registry.register(declaration, NO_RESOLVER, REVOCABLE);
        if (registered != uid) revert UnexpectedUid(uid, registered);

        console2.log(label, "registrado, uid:");
        console2.logBytes32(uid);
    }

    /// @dev Mirrors `SchemaRegistry._getUID`, which is private. Deriving the uid
    ///      before sending the transaction is what makes a rerun safe.
    function _uid(string memory declaration) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(declaration, NO_RESOLVER, REVOCABLE));
    }
}
