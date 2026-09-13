// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IEAS, AttestationRequest, AttestationRequestData} from "@eas/IEAS.sol";
import {PrescriptionRegistry} from "../src/PrescriptionRegistry.sol";

/// @notice The credential authority attests ONE professional credential on a
///         public network, through the project's own EAS v1.2.0.
///
/// This is the half of the accreditation that only the authority can do. The
/// other half — `registerCredential(uid)` — belongs to the holder and is
/// deliberately NOT in this script; see the note at the bottom of this comment.
///
///   cd contracts
///   set -a; . ../.env; set +a
///
///   CREDENTIAL_ROLE=practitioner \
///   CREDENTIAL_HOLDER=0x... \
///   PRACTITIONER_LICENSE_NUMBER=MP-12345 PRACTITIONER_SPECIALTY_CODE=A01 \
///   forge script script/IssueCredential.s.sol --rpc-url fuji --broadcast \
///     --private-key "$DEPLOYER_PRIVATE_KEY"
///
/// That is DEPLOYER_PRIVATE_KEY only because the MVP deployment collapsed the
/// authority into the deployer account (docs/19-despliegue.md). The script never
/// reads it: whichever key Forge is given has to BE the registry's
/// `issuerAuthority`, and `--account`, `--interactive` or `--ledger` work just
/// as well the day the authority moves to a hardware wallet.
///
/// A dry run needs no key at all, only the address that WOULD sign, because the
/// authority check below runs against `msg.sender`:
///
///   CREDENTIAL_ROLE=pharmacy CREDENTIAL_HOLDER=0x... \
///   forge script script/IssueCredential.s.sol --rpc-url fuji \
///     --sender "$ISSUER_AUTHORITY"
///
/// @dev NO KEY IS READ, DERIVED, DEFAULTED OR LOGGED HERE, and that is a design
///      constraint rather than an omission. `SetupCredentials.s.sol` (lines
///      18-22) states it plainly: handing the authority's key to a script is how
///      a credential authority stops being one. That rule forbids a compile-time
///      constant like `LocalDemo.ISSUER_AUTHORITY_KEY`; it does not forbid the
///      sanctioned pattern `Deploy.s.sol` already uses, which is a bare
///      `vm.broadcast()` with Forge supplying the signer at invocation time via
///      `--private-key`, `--account`, `--interactive` or `--ledger`. The key
///      therefore never enters the repository, and the same script works
///      unchanged the day the authority becomes a hardware wallet or a multisig.
///
///      WHY THERE IS NO SECOND SCRIPT FOR THE HOLDER. `registerCredential(uid)`
///      must be signed by the holder, and in this project holders are
///      browser-wallet accounts (docs/20-wallet-y-red-de-pruebas.md): their keys
///      live inside a MetaMask extension, not in a keystore Forge can open. A
///      script for that step would exist only to be fed an exported private key,
///      which is the same mistake in a different hat. It is one call with one
///      argument, so `cast send` — or the explorer's "Write Contract" tab, since
///      `PrescriptionRegistry` is verified on Snowtrace — is both shorter and
///      more honest. docs/19-despliegue.md carries the recipe.
///
///      Anvil is refused on purpose. There the registry sits behind a `MockEAS`
///      whose schema uids are `LocalDemo` stand-ins that a real `SchemaRegistry`
///      would never produce, and `SetupCredentials.s.sol` already accredits the
///      three demo accounts there in one command.
contract IssueCredential is Script {
    /// @dev Anvil. `SetupCredentials.s.sol` owns that chain.
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    /// @dev One year, the same validity `SetupCredentials.s.sol` grants locally.
    uint256 internal constant DEFAULT_VALIDITY_DAYS = 365;

    error LocalChainUsesSetupCredentials(uint256 chainId);
    error MissingEasAddress();
    error MissingRegistryAddress();
    error MissingCredentialRole();
    error UnknownCredentialRole(string role);
    error MissingCredentialHolder();
    error MissingPractitionerSchema();
    error MissingPharmacySchema();
    error NoCodeAtEas(address eas);
    error NoCodeAtRegistry(address registry);
    error EasMismatch(address configured, address registryEas);
    error SchemaMismatch(bytes32 configured, bytes32 registrySchema);
    error NotTheIssuerAuthority(address broadcaster, address issuerAuthority);
    error ValidUntilTooLarge(uint256 validUntil);
    error ValidUntilAlreadyPast(uint64 validUntil, uint64 nowTs);

    /// @dev `keccak256("Attested(address,address,bytes32,bytes32)")`, the topic
    ///      the uid has to be fished out of. See `_reportUid`.
    bytes32 internal constant ATTESTED_TOPIC =
        0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35;

    /// @dev Resolved configuration, grouped so `run()` stays readable and the
    ///      checks below can be read as one list instead of a parameter soup.
    struct Plan {
        address eas;
        PrescriptionRegistry registry;
        bool practitioner;
        bytes32 schema;
        address holder;
        uint64 validFrom;
        uint64 validUntil;
        bytes data;
    }

    /// @dev The return value is named `simulatedUid` and not `uid` on purpose:
    ///      Forge echoes it in its own `== Return ==` block, outside this
    ///      script's control, and an operator who copies a value labelled `uid`
    ///      into `registerCredential` loses a transaction. See `_reportUid`.
    function run() external returns (bytes32 simulatedUid) {
        if (block.chainid == LOCAL_CHAIN_ID) {
            console2.log("Esta red es Anvil (chainId 31337), donde la demo usa MockEAS y uids de");
            console2.log("esquema que no son los del SchemaRegistry real.");
            console2.log("Para el camino local: forge script script/SetupCredentials.s.sol --broadcast");
            revert LocalChainUsesSetupCredentials(block.chainid);
        }

        Plan memory plan = _resolve();

        // Forge executes `run()` with msg.sender set to the account it will sign
        // with (`--sender`, or the address derived from `--private-key` /
        // `--account`). Checking it here costs nothing; getting it wrong costs a
        // real transaction that produces an attestation the registry can never
        // accept, because `registerCredential` demands
        // `attester == issuerAuthority` and that field is immutable.
        address issuerAuthority = plan.registry.issuerAuthority();
        if (msg.sender != issuerAuthority) {
            revert NotTheIssuerAuthority(msg.sender, issuerAuthority);
        }

        console2.log("--- Emision de credencial ---------------------------------");
        console2.log("chainId:", block.chainid);
        console2.log("EAS:", plan.eas);
        console2.log("PrescriptionRegistry:", address(plan.registry));
        console2.log("Emisor de credenciales (firma esta transaccion):", issuerAuthority);
        console2.log("Rol:", plan.practitioner ? "practitioner" : "pharmacy");
        console2.log("Titular:", plan.holder);
        console2.log("Esquema:");
        console2.logBytes32(plan.schema);
        console2.log("Valida desde (unix):", plan.validFrom);
        console2.log("Valida hasta (unix):", plan.validUntil);

        bytes32 previous = plan.registry.credentialOf(plan.holder);
        if (previous != bytes32(0)) {
            console2.log("Aviso: el titular ya tiene una credencial registrada. Registrar la nueva");
            console2.log("la reemplaza; la anterior sigue viva en EAS hasta que se revoque.");
            console2.logBytes32(previous);
        }

        AttestationRequestData memory request = AttestationRequestData({
            recipient: plan.holder,
            expirationTime: plan.validUntil,
            // MUST be revocable: `registerCredential` and both accreditation
            // checks reject an attestation whose `revocationTime` is set, so a
            // non-revocable credential would be one the authority could never
            // withdraw. Both schemas were registered as revocable for exactly
            // this reason (`RegisterSchemas.s.sol`), and EAS reverts with
            // `Irrevocable` if the two ever disagree.
            revocable: true,
            // No parent attestation: a credential stands on its own.
            refUID: bytes32(0),
            data: plan.data,
            // Neither schema has a resolver, so EAS reverts with `NotPayable`
            // on any non-zero value. Nothing to pay, and nothing may be sent.
            value: 0
        });

        vm.broadcast();
        simulatedUid = IEAS(plan.eas).attest(AttestationRequest({schema: plan.schema, data: request}));

        _reportUid(plan, simulatedUid);
    }

    /// @dev THE UID THIS RUN COMPUTES IS NOT THE UID THE CHAIN WILL PRODUCE, and
    ///      printing it as if it were is the one mistake that would waste the
    ///      authority's transaction.
    ///
    ///      EAS derives the uid inside the transaction, and `attestation.time` —
    ///      `uint64(block.timestamp)` at execution — is part of the preimage
    ///      (`EAS.sol:442` and `EAS.sol:698-713`). A forge script builds its
    ///      calldata during a simulation against the block it forked, and the
    ///      transaction is then mined in a LATER block with a different
    ///      timestamp. Everything else in the preimage is frozen calldata and
    ///      survives unchanged; `time` does not. So the two uids differ, and a
    ///      `registerCredential` built from the simulated one reverts with
    ///      `CredentialNotFound` after the gas is gone.
    ///
    ///      This is exactly the trap `MockEAS` hides on Anvil: it derives its uid
    ///      from a counter rather than from the clock, which is why
    ///      `SetupCredentials.s.sol` can attest and register in one script and
    ///      why that pattern cannot be carried over to a public network.
    ///
    ///      There is no way to learn the real uid from inside the script: the
    ///      body finishes before Forge sends anything. It has to be read back off
    ///      the chain afterwards, and the `Attested` event is where it lives —
    ///      `uid` is the only non-indexed field, so it is the whole of the log's
    ///      `data`. With no resolver on either schema the attest transaction
    ///      emits that one log and nothing else.
    function _reportUid(Plan memory plan, bytes32 simulatedUid) private view {
        console2.log("-----------------------------------------------------------");
        console2.log("uid SIMULADO (NO sirve para registrar, ver abajo):");
        console2.logBytes32(simulatedUid);
        console2.log("");
        console2.log("EAS calcula el uid dentro de la transaccion, usando el block.timestamp del");
        console2.log("bloque en que se mina. La simulacion usa otro, asi que el uid real es otro.");
        console2.log("Leerlo del evento Attested despues del envio, sin --broadcast no hay nada");
        console2.log("que leer:");
        console2.log("");
        console2.log("  jq -r --arg t '%s' \\", vm.toString(ATTESTED_TOPIC));
        console2.log("    '.receipts[-1].logs[] | select(.topics[0]==$t) | .data' \\");
        console2.log("    broadcast/IssueCredential.s.sol/%s/run-latest.json", vm.toString(block.chainid));
        console2.log("");
        console2.log("Despues, el titular -y solo el titular- ejecuta con SU clave:");
        console2.log(
            string.concat(
                "  cast send ", vm.toString(address(plan.registry)), " 'registerCredential(bytes32)' <uid> \\"
            )
        );
        console2.log("    --rpc-url fuji --private-key <clave-del-titular>");
        console2.log("");
        console2.log("Comprobacion de que la credencial quedo: debe devolver ese mismo uid.");
        console2.log(
            string.concat(
                "  cast call ",
                vm.toString(address(plan.registry)),
                " 'credentialOf(address)(bytes32)' ",
                vm.toString(plan.holder)
            )
        );
        console2.log("    --rpc-url fuji");
    }

    /// @dev Every value this script needs, refused loudly when missing. The
    ///      schema uid comes from the environment and is then compared against
    ///      the registry's immutable rather than simply read from the registry:
    ///      a `.env` that drifted away from the deployed contract is exactly the
    ///      failure this catches, and reading the registry alone would make the
    ///      comparison tautological.
    function _resolve() private view returns (Plan memory plan) {
        plan.eas = vm.envOr("EAS_ADDRESS", address(0));
        if (plan.eas == address(0)) revert MissingEasAddress();
        if (plan.eas.code.length == 0) revert NoCodeAtEas(plan.eas);

        address registryAddress = vm.envOr("PRESCRIPTION_REGISTRY_ADDRESS", address(0));
        if (registryAddress == address(0)) revert MissingRegistryAddress();
        if (registryAddress.code.length == 0) revert NoCodeAtRegistry(registryAddress);
        plan.registry = PrescriptionRegistry(registryAddress);

        address registryEas = plan.registry.eas();
        if (registryEas != plan.eas) revert EasMismatch(plan.eas, registryEas);

        plan.practitioner = _resolveRole();
        plan.schema = _resolveSchema(plan.registry, plan.practitioner);

        plan.holder = vm.envOr("CREDENTIAL_HOLDER", address(0));
        if (plan.holder == address(0)) revert MissingCredentialHolder();

        (plan.validFrom, plan.validUntil) = _resolveValidity();
        plan.data =
            _encodeData(plan.practitioner, plan.registry.issuerAuthority(), plan.validFrom, plan.validUntil);
    }

    /// @dev The schema uid for the chosen role, taken from the environment and
    ///      then checked against the registry's own immutable. The check is the
    ///      point: `practitionerSchema` and `pharmacySchema` were burnt in at
    ///      deploy time and cannot be changed, so an environment that drifted
    ///      away from them would produce an attestation rejected by
    ///      `registerCredential` with `CredentialUnknownSchema` — after the gas.
    function _resolveSchema(PrescriptionRegistry registry, bool practitioner)
        private
        view
        returns (bytes32 schema)
    {
        bytes32 onChain;

        if (practitioner) {
            schema = vm.envOr("PRACTITIONER_SCHEMA_UID", bytes32(0));
            if (schema == bytes32(0)) revert MissingPractitionerSchema();
            onChain = registry.practitionerSchema();
        } else {
            schema = vm.envOr("PHARMACY_SCHEMA_UID", bytes32(0));
            if (schema == bytes32(0)) revert MissingPharmacySchema();
            onChain = registry.pharmacySchema();
        }

        if (schema != onChain) revert SchemaMismatch(schema, onChain);
    }

    /// @dev `CREDENTIAL_ROLE` is a selector, not free text: the two roles are the
    ///      only thing separating a credential that can `issue` from one that can
    ///      `dispense`, so an unrecognised value stops the run instead of
    ///      silently falling back to either one.
    function _resolveRole() private view returns (bool practitioner) {
        string memory role = vm.envOr("CREDENTIAL_ROLE", string(""));
        bytes32 h = keccak256(bytes(role));

        if (h == keccak256("")) revert MissingCredentialRole();
        if (h == keccak256("practitioner")) return true;
        if (h == keccak256("pharmacy")) return false;
        revert UnknownCredentialRole(role);
    }

    /// @dev `CREDENTIAL_VALID_UNTIL` (absolute unix seconds) wins when set;
    ///      otherwise `CREDENTIAL_VALIDITY_DAYS` counts forward from now and
    ///      defaults to one year, the same span the local demo grants.
    function _resolveValidity() private view returns (uint64 validFrom, uint64 validUntil) {
        validFrom = uint64(block.timestamp);

        uint256 absolute = vm.envOr("CREDENTIAL_VALID_UNTIL", uint256(0));
        uint256 resolved = absolute != 0
            ? absolute
            : block.timestamp + vm.envOr("CREDENTIAL_VALIDITY_DAYS", DEFAULT_VALIDITY_DAYS) * 1 days;

        if (resolved > type(uint64).max) revert ValidUntilTooLarge(resolved);
        validUntil = uint64(resolved);

        // EAS rejects an expiration already in the past, and so does the
        // registry. Failing here names the value; failing there costs gas.
        if (validUntil <= validFrom) revert ValidUntilAlreadyPast(validUntil, validFrom);
    }

    /// @dev THE `data` FIELD IS POPULATED, not left empty, and the choice is
    ///      deliberate.
    ///
    ///      `PrescriptionRegistry` never decodes `data` — it reads `schema`,
    ///      `recipient`, `attester`, `revocationTime` and `expirationTime` and
    ///      nothing else — so `bytes("")` would satisfy every on-chain check
    ///      today. It would also publish a credential that says nothing: the
    ///      schemas of docs/03-modelo-de-datos.md declare a licence number and a
    ///      specialty (or a pharmacy licence and a sanitary registry reference)
    ///      precisely so an off-chain verifier can answer "which practitioner is
    ///      this, and under what licence", which is the question
    ///      docs/02-roles-y-permisos.md hangs the whole trust chain on (D-05:
    ///      somebody must have checked that the holder of this address really is
    ///      that person). An attestation with empty `data` cannot be audited
    ///      after the fact, and backfilling it means revoking and re-issuing.
    ///      Encoding it now costs one `abi.encode` and a few hundred gas.
    ///
    ///      The encoding is `abi.encode` of the declared fields in declaration
    ///      order, which is what the EAS SDK expects. One caveat worth writing
    ///      down: the declarations registered by `RegisterSchemas.s.sol` carry a
    ///      leading struct name (`PractitionerCredential(string licenseNumber,
    ///      ...)`) rather than the bare field list EAS's own tooling parses.
    ///      Nothing on-chain reads the declaration string — EAS stores it and
    ///      never interprets it — so this is invisible to the registry, but a
    ///      generic EAS explorer will not auto-decode these attestations. The
    ///      field order here is the one that matters and it is the declared one.
    ///
    ///      `issuerAuthority`, `validFrom` and `validUntil` are duplicated inside
    ///      `data` because the schema declares them. The registry ignores the
    ///      copies and trusts only EAS's own `attester` and `expirationTime`, so
    ///      the copies are descriptive, never authoritative. `validFrom` is in
    ///      fact the simulation's timestamp, frozen into calldata, and so lands a
    ///      few seconds before EAS's own `attestation.time` — the same clock gap
    ///      that makes the uid unpredictable (`_reportUid`). Harmless precisely
    ///      because nothing reads it to make a decision.
    ///
    ///      The string fields default to the empty string. That is a legible
    ///      "not supplied" rather than an invented licence number, and the run
    ///      says so out loud instead of hiding it.
    function _encodeData(bool practitioner, address issuerAuthority, uint64 validFrom, uint64 validUntil)
        private
        view
        returns (bytes memory)
    {
        if (practitioner) {
            string memory licenseNumber = vm.envOr("PRACTITIONER_LICENSE_NUMBER", string(""));
            string memory specialtyCode = vm.envOr("PRACTITIONER_SPECIALTY_CODE", string(""));
            _warnIfEmpty("PRACTITIONER_LICENSE_NUMBER", licenseNumber);
            _warnIfEmpty("PRACTITIONER_SPECIALTY_CODE", specialtyCode);
            return abi.encode(licenseNumber, specialtyCode, issuerAuthority, validFrom, validUntil);
        }

        string memory pharmacyLicense = vm.envOr("PHARMACY_LICENSE", string(""));
        string memory sanitaryRegistryRef = vm.envOr("PHARMACY_SANITARY_REGISTRY_REF", string(""));
        _warnIfEmpty("PHARMACY_LICENSE", pharmacyLicense);
        _warnIfEmpty("PHARMACY_SANITARY_REGISTRY_REF", sanitaryRegistryRef);
        return abi.encode(pharmacyLicense, sanitaryRegistryRef, issuerAuthority, validFrom, validUntil);
    }

    function _warnIfEmpty(string memory name, string memory value) private pure {
        if (bytes(value).length != 0) return;
        console2.log("Aviso: %s sin valor. La credencial se emite sin ese dato,", name);
        console2.log("y corregirlo despues obliga a revocar y reemitir.");
    }
}
