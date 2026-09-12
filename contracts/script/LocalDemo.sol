// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Fixed values for the local demo chain, shared by the scripts.
///
/// @dev These are the well-known, public Anvil development keys. They are
///      worthless outside a local node and are written down deliberately so the
///      demo runs with zero setup, exactly as apps/cli/src/config.ts does.
///      NOTHING here may ever be reused on a public network, and every script
///      that reads these values refuses to run outside chainId 31337.
///
///      The schema uids are stand-ins for the real ones registered in the EAS
///      SchemaRegistry (docs/03-modelo-de-datos.md). On a public network they
///      arrive through PRACTITIONER_SCHEMA_UID and PHARMACY_SCHEMA_UID.
library LocalDemo {
    uint256 internal constant CHAIN_ID = 31337;

    /// @dev keccak256 of the schema declaration of docs/03-modelo-de-datos.md.
    bytes32 internal constant PRACTITIONER_SCHEMA = keccak256(
        "PractitionerCredential(string licenseNumber,string specialtyCode,address issuerAuthority,uint64 validFrom,uint64 validUntil)"
    );

    bytes32 internal constant PHARMACY_SCHEMA = keccak256(
        "PharmacyCredential(string pharmacyLicense,string sanitaryRegistryRef,address issuerAuthority,uint64 validFrom,uint64 validUntil)"
    );

    /// @dev Anvil account #9 stands in for the credential authority, which is a
    ///      multisig in the pilot (docs/02-roles-y-permisos.md).
    uint256 internal constant ISSUER_AUTHORITY_KEY =
        0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6;
    address internal constant ISSUER_AUTHORITY = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720;

    /// @dev Anvil account #0: the prescribing doctor of the demo.
    uint256 internal constant DOCTOR_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    /// @dev Anvil account #1 and #2: the two pharmacies of act 2 and act 3.
    uint256 internal constant PHARMACY_A_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant PHARMACY_B_KEY =
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
}
