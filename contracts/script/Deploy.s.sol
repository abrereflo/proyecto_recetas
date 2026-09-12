// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PrescriptionRegistry} from "../src/PrescriptionRegistry.sol";
import {MockEAS} from "../test/mocks/MockEAS.sol";
import {LocalDemo} from "./LocalDemo.sol";

/// @notice Deploys PrescriptionRegistry.
///
/// Local (Anvil), everything defaulted and a MockEAS deployed for you:
///   forge script script/Deploy.s.sol --rpc-url anvil --broadcast
///
/// Avalanche Fuji, where nothing is defaulted. The EAS address and the two
/// schema uids come from script/DeployEAS.s.sol and script/RegisterSchemas.s.sol,
/// which must have run first: Avalanche has no official EAS deployment, so
/// there is no canonical address to assume here.
///   EAS_ADDRESS=0x... \
///   PRACTITIONER_SCHEMA_UID=0x... PHARMACY_SCHEMA_UID=0x... ISSUER_AUTHORITY=0x... \
///   forge script script/Deploy.s.sol --rpc-url fuji --broadcast --verify
///
/// @dev The contract is immutable and has no administrator (D-14). A new
///      version means a new deployment and an explicit migration.
///
///      The four constructor arguments ARE the security model: a zero EAS
///      address, a zero schema uid or a zero issuer authority would deploy a
///      registry whose credential checks can never pass — or, worse, one where a
///      zeroed attestation matches a zeroed schema. Off Anvil this script
///      therefore refuses to start rather than deploying something that looks
///      alive and is not.
contract Deploy is Script {
    error MissingEasAddress();
    error MissingPractitionerSchema();
    error MissingPharmacySchema();
    error MissingIssuerAuthority();

    function run() external returns (PrescriptionRegistry registry) {
        bool local = block.chainid == LocalDemo.CHAIN_ID;

        address eas = vm.envOr("EAS_ADDRESS", address(0));
        bytes32 practitionerSchema = vm.envOr("PRACTITIONER_SCHEMA_UID", bytes32(0));
        bytes32 pharmacySchema = vm.envOr("PHARMACY_SCHEMA_UID", bytes32(0));
        address issuerAuthority = vm.envOr("ISSUER_AUTHORITY", address(0));

        if (local) {
            // Anvil has no EAS deployment, so the demo brings its own.
            if (eas == address(0)) {
                vm.broadcast();
                eas = address(new MockEAS());
                console2.log("MockEAS desplegado en:", eas);
            }
            if (practitionerSchema == bytes32(0)) practitionerSchema = LocalDemo.PRACTITIONER_SCHEMA;
            if (pharmacySchema == bytes32(0)) pharmacySchema = LocalDemo.PHARMACY_SCHEMA;
            if (issuerAuthority == address(0)) issuerAuthority = LocalDemo.ISSUER_AUTHORITY;
        } else {
            if (eas == address(0)) revert MissingEasAddress();
            if (practitionerSchema == bytes32(0)) revert MissingPractitionerSchema();
            if (pharmacySchema == bytes32(0)) revert MissingPharmacySchema();
            if (issuerAuthority == address(0)) revert MissingIssuerAuthority();
        }

        vm.broadcast();
        registry = new PrescriptionRegistry(eas, practitionerSchema, pharmacySchema, issuerAuthority);

        console2.log("PrescriptionRegistry desplegado en:", address(registry));
        console2.log("EAS:", eas);
        console2.log("Emisor de credenciales:", issuerAuthority);
        console2.logBytes32(practitionerSchema);
        console2.logBytes32(pharmacySchema);
        console2.log("Copie esa direccion a PRESCRIPTION_REGISTRY_ADDRESS en .env.");
        if (local) {
            console2.log("Siguiente paso: forge script script/SetupCredentials.s.sol --broadcast");
        }
    }
}
