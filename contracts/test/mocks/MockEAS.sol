// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Attestation, IEAS} from "../../src/IEAS.sol";

/// @notice A controllable stand-in for the Ethereum Attestation Service.
///
/// @dev Exists so the five rejection reasons of docs/04-smart-contracts.md can
///      be reproduced deterministically: wrong issuer, wrong recipient, unknown
///      schema, revoked and expired. Real EAS gives no way to forge those
///      states on demand.
///
///      It is also what `Deploy.s.sol` and `SetupCredentials.s.sol` put behind
///      the registry on Anvil (chainId 31337) so the demo runs with no external
///      dependency. On a public network the registry points at the real EAS
///      v1.2.0 this project deploys itself with `DeployEAS.s.sol` — Avalanche
///      has no official EAS instance — and the deploy script refuses to start
///      without its address.
///
///      Two behaviours are copied from the real contract on purpose:
///        - an unknown uid returns a ZEROED `Attestation`, it does not revert;
///        - `revocationTime` and `expirationTime` use 0 as "never".
contract MockEAS is IEAS {
    mapping(bytes32 uid => Attestation attestation) private _attestations;

    uint64 private _counter;

    event MockAttested(bytes32 indexed uid, bytes32 indexed schema, address indexed recipient);
    event MockRevoked(bytes32 indexed uid, uint64 revocationTime);

    /// @notice Marks this instance as the test double, so a client refuses to
    ///         drive it against a real network by accident.
    function isMock() external pure returns (bool) {
        return true;
    }

    /// @notice Creates an attestation with a generated uid.
    /// @dev Every field a credential check reads is caller-controlled, including
    ///      `revocationTime`, so an already-revoked credential can be built in
    ///      one call.
    function attest(
        bytes32 schema,
        address recipient,
        address attester,
        uint64 expirationTime,
        uint64 revocationTime
    ) external returns (bytes32 uid) {
        _counter += 1;
        uid = keccak256(abi.encode(schema, recipient, attester, expirationTime, _counter, block.chainid));
        _store(uid, schema, recipient, attester, expirationTime, revocationTime);
    }

    /// @notice Creates an attestation under a uid chosen by the caller.
    /// @dev Lets a client know the uid before sending the transaction, so it can
    ///      register the credential without reading logs back.
    function attestWithUid(
        bytes32 uid,
        bytes32 schema,
        address recipient,
        address attester,
        uint64 expirationTime,
        uint64 revocationTime
    ) external {
        require(uid != bytes32(0), "MockEAS: zero uid");
        _store(uid, schema, recipient, attester, expirationTime, revocationTime);
    }

    /// @notice Revokes as of the current block.
    function revoke(bytes32 uid) external {
        _revoke(uid, uint64(block.timestamp));
    }

    /// @inheritdoc IEAS
    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }

    function _store(
        bytes32 uid,
        bytes32 schema,
        address recipient,
        address attester,
        uint64 expirationTime,
        uint64 revocationTime
    ) private {
        _attestations[uid] = Attestation({
            uid: uid,
            schema: schema,
            time: uint64(block.timestamp),
            expirationTime: expirationTime,
            revocationTime: revocationTime,
            refUID: bytes32(0),
            recipient: recipient,
            attester: attester,
            revocable: true,
            data: ""
        });

        emit MockAttested(uid, schema, recipient);
    }

    function _revoke(bytes32 uid, uint64 revocationTime) private {
        require(_attestations[uid].uid != bytes32(0), "MockEAS: unknown uid");

        _attestations[uid].revocationTime = revocationTime;

        emit MockRevoked(uid, revocationTime);
    }
}
