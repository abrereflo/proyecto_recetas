// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {EAS} from "@eas/EAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {SchemaRegistry} from "@eas/SchemaRegistry.sol";

/// @notice Deploys the project's OWN Ethereum Attestation Service instance.
///
/// Avalanche Fuji, chainId 43113:
///   forge script script/DeployEAS.s.sol --rpc-url fuji --broadcast
///
/// @dev Avalanche has no official EAS deployment. The upstream repository ships
///      `deployments/` for 26 networks and not one of them is Avalanche, so
///      there is no canonical address to point at and no predeploy to assume:
///      this project runs its own EAS, and the two addresses printed here are
///      the ones every other component must be configured with.
///
///      Deployment order is not a preference. `EAS` takes the SchemaRegistry in
///      its constructor and reverts with `InvalidRegistry` on the zero address,
///      so the registry exists first and is immutable inside EAS afterwards.
///      Pointing the stack at a different SchemaRegistry later means deploying a
///      new EAS as well.
///
///      Version: EAS v1.2.0, the same release `src/IEAS.sol` was transcribed
///      from. Both contracts answer `version()` with "1.2.0", which is the cheap
///      way to confirm on-chain that the deployment is the expected one.
///
///      On Anvil this script refuses to run: the local demo already has a
///      `MockEAS` behind the registry (`Deploy.s.sol`, `SetupCredentials.s.sol`)
///      and its schema uids are stand-ins that the real SchemaRegistry would
///      never produce. Deploying a real EAS there would leave two attestation
///      services on the same chain and a demo that silently reads the wrong one.
contract DeployEAS is Script {
    error LocalChainUsesMockEas(uint256 chainId);

    /// @dev Anvil. Mirrors `LocalDemo.CHAIN_ID` on purpose: `LocalDemo.sol` is
    ///      `^0.8.24` and EAS v1.2.0 pins `0.8.19`, so the two can never share a
    ///      compilation unit and the constant cannot be imported here.
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    function run() external returns (SchemaRegistry schemaRegistry, EAS eas) {
        if (block.chainid == LOCAL_CHAIN_ID) {
            console2.log("Esta red es Anvil (chainId 31337), donde la demo ya usa MockEAS.");
            console2.log("Desplegar aqui un EAS real dejaria dos servicios de attestations en la");
            console2.log("misma cadena y uids de esquema que no coinciden con los de LocalDemo.");
            console2.log("Para el camino local: forge script script/SetupCredentials.s.sol --broadcast");
            revert LocalChainUsesMockEas(block.chainid);
        }

        vm.startBroadcast();
        schemaRegistry = new SchemaRegistry();
        eas = new EAS(ISchemaRegistry(address(schemaRegistry)));
        vm.stopBroadcast();

        console2.log("--- EAS propio del proyecto --------------------------------");
        console2.log("chainId:", block.chainid);
        console2.log("SchemaRegistry:", address(schemaRegistry));
        console2.log("EAS:", address(eas));
        console2.log("Version de EAS:", eas.version());
        console2.log("------------------------------------------------------------");
        console2.log("Copie SchemaRegistry a SCHEMA_REGISTRY_ADDRESS en .env.");
        console2.log("Copie EAS a EAS_ADDRESS en .env.");
        console2.log("Siguiente paso: forge script script/RegisterSchemas.s.sol --broadcast");
    }
}
