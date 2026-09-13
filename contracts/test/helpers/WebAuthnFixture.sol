// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {WebAuthn} from "../../src/WebAuthn.sol";
import {P256Fixture} from "./P256Fixture.sol";

/// @notice Building and signing WebAuthn assertions, the way a browser and an
///         authenticator would.
///
/// @dev NOTHING HERE FAKES A SIGNATURE, for the same reason `P256Fixture` says
///      nothing there does. An assertion built by this fixture is signed with
///      `vm.signP256` over `sha256(authenticatorData || sha256(clientDataJSON))`
///      — the real message, computed the real way — so a test that passes here
///      would pass against a real enclave, and a contract that got the digest
///      recipe backwards fails here exactly as it would in production.
///
///      What this fixture CANNOT do is prove the recipe itself is right: both
///      sides of a constructed vector come from this repository, so an agreed
///      misunderstanding would go unnoticed. That gap is closed in
///      `test/WebAuthn.t.sol` by two assertions this project did not produce —
///      real Safari and Chrome passkey assertions, published by Coinbase, whose
///      signatures were made by actual secure enclaves. Those are the anchor;
///      the constructed ones exist to reach the cases a published vector cannot
///      cover, like a cleared User Present bit.
abstract contract WebAuthnFixture is P256Fixture {
    /// @dev `sha256("localhost")`, taken from the published vectors so that the
    ///      constructed assertions and the real ones agree on this field.
    ///
    ///      The contract never reads it — `WebAuthn` deliberately does not check
    ///      `rpIdHash`, and the header of that file argues why — so its value is
    ///      only ever a plausible 32 bytes in the right place.
    bytes32 internal constant RP_ID_HASH = 0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763;

    /// @dev User Present and User Verified. What a platform passkey emits, and
    ///      the minimum this project accepts.
    bytes1 internal constant FLAGS_UP_UV = 0x05;

    /// @dev Someone touched it; the authenticator did not establish who.
    bytes1 internal constant FLAGS_UP_ONLY = 0x01;

    /// @dev A verified user who was somehow not present. Contradictory, and
    ///      refused for the UP rule rather than for being nonsense.
    bytes1 internal constant FLAGS_UV_ONLY = 0x04;

    /// @dev UP, UV, Backup Eligible, Backup State — a synced iCloud/Google
    ///      passkey, which is the common case.
    bytes1 internal constant FLAGS_UP_UV_SYNCED = 0x1D;

    /// @dev UP, UV, Backup State set WITHOUT Backup Eligible: an authenticator
    ///      claiming a credential is backed up and cannot be backed up.
    bytes1 internal constant FLAGS_UP_UV_IMPOSSIBLE_BACKUP = 0x15;

    string internal constant TYPE_GET = "webauthn.get";
    string internal constant TYPE_CREATE = "webauthn.create";

    string internal constant ORIGIN = "https://recetas.example";

    /// @notice `rpIdHash || flags || signCount`, the 37-byte minimum.
    function _authenticatorData(bytes1 flags) internal pure returns (bytes memory) {
        return _authenticatorData(flags, 1);
    }

    function _authenticatorData(bytes1 flags, uint32 signCount) internal pure returns (bytes memory) {
        return abi.encodePacked(RP_ID_HASH, flags, signCount);
    }

    /// @notice The JSON a browser serialises, in the order the spec prescribes.
    function _clientDataJSON(string memory ceremonyType, bytes32 challenge, string memory origin)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"type":"',
            ceremonyType,
            '","challenge":"',
            string(WebAuthn.base64UrlEncode(challenge)),
            '","origin":"',
            origin,
            '","crossOrigin":false}'
        );
    }

    /// @notice Where `"challenge":"` starts in a JSON built by `_clientDataJSON`.
    /// @dev `{` + `"type":"` + the type + `"` + `,`. Computed rather than
    ///      hard-coded because `webauthn.create` is three bytes longer than
    ///      `webauthn.get`, and a fixture that quietly pointed at the wrong
    ///      offset would make the ceremony-type test pass for the wrong reason.
    function _challengeIndex(string memory ceremonyType) internal pure returns (uint256) {
        return 11 + bytes(ceremonyType).length;
    }

    /// @notice A complete, genuinely signed assertion. The happy path.
    function _assertion(uint256 privateKey, bytes32 challenge)
        internal
        pure
        returns (WebAuthn.Assertion memory)
    {
        return _assertion(privateKey, challenge, FLAGS_UP_UV, TYPE_GET, ORIGIN);
    }

    /// @notice The same, with the three things a test might want to vary.
    function _assertion(
        uint256 privateKey,
        bytes32 challenge,
        bytes1 flags,
        string memory ceremonyType,
        string memory origin
    ) internal pure returns (WebAuthn.Assertion memory) {
        return _signAssertion(
            privateKey,
            _authenticatorData(flags),
            _clientDataJSON(ceremonyType, challenge, origin),
            _challengeIndex(ceremonyType),
            1
        );
    }

    /// @notice Sign exactly these bytes, whatever they say.
    ///
    /// @dev The digest is built here the way the W3C algorithm says an
    ///      authenticator builds it: hash the client data, append that hash to
    ///      `authenticatorData`, hash again. `s` comes back normalised to the
    ///      low half by `P256Fixture._sign`, which is what a client is required
    ///      to do and what a real authenticator does NOT do.
    function _signAssertion(
        uint256 privateKey,
        bytes memory authenticatorData,
        string memory clientDataJSON,
        uint256 challengeIndex,
        uint256 typeIndex
    ) internal pure returns (WebAuthn.Assertion memory assertion) {
        assertion.authenticatorData = authenticatorData;
        assertion.clientDataJSON = clientDataJSON;
        assertion.challengeIndex = challengeIndex;
        assertion.typeIndex = typeIndex;

        bytes32 digest = sha256(abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON))));

        (assertion.r, assertion.s) = _sign(privateKey, digest);
    }

    /// @notice The envelope as it travels in `userOp.signature`.
    function _encode(WebAuthn.Assertion memory assertion) internal pure returns (bytes memory) {
        return abi.encode(assertion);
    }

    /// @notice First offset at which `needle` occurs in `haystack`, or
    ///         `type(uint256).max`.
    ///
    /// @dev Exists to make one point in one test: that a naive substring search
    ///      for the challenge WOULD have found it, in a document where the
    ///      anchored check correctly says no. Never used by the contracts.
    function _indexOf(string memory haystack, string memory needle) internal pure returns (uint256) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);

        if (n.length == 0 || n.length > h.length) return type(uint256).max;

        for (uint256 i = 0; i <= h.length - n.length; ++i) {
            bool hit = true;

            for (uint256 j = 0; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }

            if (hit) return i;
        }

        return type(uint256).max;
    }
}
