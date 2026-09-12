// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PrescriptionRegistry} from "../src/PrescriptionRegistry.sol";
import {MockEAS} from "../test/mocks/MockEAS.sol";
import {LocalDemo} from "./LocalDemo.sol";

/// @notice Accredits the three demo accounts on the local chain.
///
///   forge script script/SetupCredentials.s.sol --rpc-url anvil --broadcast
///
/// With no PRESCRIPTION_REGISTRY_ADDRESS it deploys the whole local stack:
/// MockEAS, the registry, the three attestations and the three registrations.
/// With one, it accredits against the registry already deployed there.
///
/// @dev Anvil only. On a public network the credential authority attests from
///      its own multisig, through the real EAS, and each professional calls
///      `registerCredential` from their own account. There is no script for
///      that and there should not be one: handing the authority's key to a
///      script is how a credential authority stops being one.
contract SetupCredentials is Script {
    error NotTheLocalChain(uint256 chainId);
    error NotAMockEas(address eas);
    error IssuerMismatch(address expected, address actual);

    uint64 internal constant VALIDITY = 365 days;

    function run() external returns (PrescriptionRegistry registry, MockEAS eas) {
        if (block.chainid != LocalDemo.CHAIN_ID) {
            revert NotTheLocalChain(block.chainid);
        }

        (registry, eas) = _resolveStack();

        _assertMock(address(eas));

        address issuer = registry.issuerAuthority();
        if (issuer != vm.addr(LocalDemo.ISSUER_AUTHORITY_KEY)) {
            revert IssuerMismatch(vm.addr(LocalDemo.ISSUER_AUTHORITY_KEY), issuer);
        }

        uint64 validUntil = uint64(block.timestamp) + VALIDITY;

        console2.log("--- Acreditacion de las cuentas de la demo -----------------");
        console2.log("PrescriptionRegistry:", address(registry));
        console2.log("EAS (MockEAS):", address(eas));
        console2.log("Emisor de credenciales:", issuer);
        console2.log("Credenciales validas hasta (unix):", validUntil);

        _accredit(
            "Medica (cuenta 0)",
            registry,
            eas,
            LocalDemo.DOCTOR_KEY,
            registry.practitionerSchema(),
            validUntil
        );
        _accredit(
            "Farmacia A (cuenta 1)",
            registry,
            eas,
            LocalDemo.PHARMACY_A_KEY,
            registry.pharmacySchema(),
            validUntil
        );
        _accredit(
            "Farmacia B (cuenta 2)",
            registry,
            eas,
            LocalDemo.PHARMACY_B_KEY,
            registry.pharmacySchema(),
            validUntil
        );

        console2.log("-----------------------------------------------------------");
        console2.log("Listo. Ejecute: PRESCRIPTION_REGISTRY_ADDRESS=<registro> receta demo");
    }

    /// @dev Reuses the deployed registry when one is configured, and otherwise
    ///      brings up the whole stack so a fresh Anvil needs a single command.
    function _resolveStack() private returns (PrescriptionRegistry registry, MockEAS eas) {
        address configured = vm.envOr("PRESCRIPTION_REGISTRY_ADDRESS", address(0));

        if (configured != address(0) && configured.code.length > 0) {
            registry = PrescriptionRegistry(configured);
            return (registry, MockEAS(registry.eas()));
        }

        // Account #0 pays for the local deployment, so the script needs no
        // --private-key to bootstrap a fresh Anvil.
        vm.broadcast(LocalDemo.DOCTOR_KEY);
        eas = new MockEAS();

        vm.broadcast(LocalDemo.DOCTOR_KEY);
        registry = new PrescriptionRegistry(
            address(eas),
            LocalDemo.PRACTITIONER_SCHEMA,
            LocalDemo.PHARMACY_SCHEMA,
            vm.addr(LocalDemo.ISSUER_AUTHORITY_KEY)
        );
    }

    /// @dev The authority attests, and the holder registers the pointer itself.
    ///      Two different keys sign those two transactions, which is the whole
    ///      point: the registry never takes the authority's word for who the
    ///      caller is, and the authority never touches the registry.
    function _accredit(
        string memory label,
        PrescriptionRegistry registry,
        MockEAS eas,
        uint256 holderKey,
        bytes32 schema,
        uint64 validUntil
    ) private {
        address holder = vm.addr(holderKey);

        vm.broadcast(LocalDemo.ISSUER_AUTHORITY_KEY);
        bytes32 uid = eas.attest(schema, holder, vm.addr(LocalDemo.ISSUER_AUTHORITY_KEY), validUntil, 0);

        vm.broadcast(holderKey);
        registry.registerCredential(uid);

        console2.log(label);
        console2.log("  cuenta:", holder);
        console2.log("  uid de la credencial:");
        console2.logBytes32(uid);
    }

    function _assertMock(address eas) private view {
        try MockEAS(eas).isMock() returns (bool mock) {
            if (mock) return;
        } catch {}
        revert NotAMockEas(eas);
    }
}
