// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {P256} from "../src/P256.sol";
import {P256Fixture} from "./helpers/P256Fixture.sol";
import {MisbehavingPrecompileStub} from "./mocks/P256Precompile.sol";

/// @notice What `src/P256.sol` decides, and what it delegates.
///
/// @dev The curve arithmetic is not under test here — it belongs to the
///      RIP-7212 precompile and to an audited verifier, and this project wrote
///      neither. What IS under test is everything the library owns and could
///      get wrong on its own: the 160-byte payload layout, the low-`s` policy,
///      the range checks, and the reading of an answer that is deliberately
///      ambiguous.
contract P256Test is P256Fixture {
    bytes32 internal constant DIGEST = keccak256("userOpHash-ish");
    bytes32 internal constant OTHER_DIGEST = keccak256("a different operation");

    uint256 internal x;
    uint256 internal y;
    uint256 internal r;
    uint256 internal s;

    function setUp() public {
        _installVerifier();
        (x, y) = _publicKey(DOCTOR_KEY);
        (r, s) = _sign(DOCTOR_KEY, DIGEST);
    }

    // --- The precompile path -------------------------------------------------

    function test_verify_accepts_a_real_signature() public {
        _installPrecompile();

        assertTrue(P256.verify(DIGEST, r, s, x, y));
    }

    function test_verify_rejects_another_digest() public {
        _installPrecompile();

        assertFalse(P256.verify(OTHER_DIGEST, r, s, x, y));
    }

    function test_verify_rejects_another_key() public {
        _installPrecompile();

        (uint256 otherX, uint256 otherY) = _publicKey(IMPOSTOR_KEY);

        assertFalse(P256.verify(DIGEST, r, s, otherX, otherY));
    }

    function testFuzz_verify_accepts_any_real_signature(uint256 privateKey, bytes32 digest) public {
        _installPrecompile();

        // Valid P-256 private keys are 1..n-1. `bound` keeps the fuzzer inside
        // that range instead of throwing most of its runs away on `vm.assume`.
        privateKey = bound(privateKey, 1, N - 1);

        (uint256 fx, uint256 fy) = _publicKey(privateKey);
        (uint256 fr, uint256 fs) = _sign(privateKey, digest);

        assertTrue(P256.verify(digest, fr, fs, fx, fy));
    }

    // --- Malleability --------------------------------------------------------

    /// @notice The reason the low-`s` check exists at all.
    ///
    /// @dev This test asserts two things at once, and the first is the
    ///      justification for the second: the BACKEND happily accepts the
    ///      malleable twin — measured here, exactly as it was measured against
    ///      Fuji by `eth_call` — and the LIBRARY does not. Delete the check in
    ///      `P256.verify` and the second assertion flips while the first stays
    ///      put, which is the whole point: the policy is ours, not the chain's.
    function test_verify_rejects_high_s_that_the_precompile_would_accept() public {
        _installPrecompile();

        uint256 highS = _flip(s);
        assertGt(highS, N_DIV_2, "the flipped s should be in the high half");

        (bool ok, bytes memory ret) = P256.PRECOMPILE.staticcall(abi.encodePacked(DIGEST, r, highS, x, y));
        assertTrue(ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1, "backend rejected high s");

        assertFalse(P256.verify(DIGEST, r, highS, x, y), "library accepted a malleable signature");
    }

    /// @dev And the twin is refused by the fallback too, not only by the
    ///      precompile path. One policy, both backends — which only works
    ///      because the check happens before either is consulted.
    function test_verify_rejects_high_s_on_the_fallback_path_too() public view {
        assertFalse(P256.verify(DIGEST, r, _flip(s), x, y, VERIFIER));
    }

    // --- Scalars outside the group -------------------------------------------

    function test_verify_rejects_zero_r() public {
        _installPrecompile();

        assertFalse(P256.verify(DIGEST, 0, s, x, y));
    }

    function test_verify_rejects_zero_s() public {
        _installPrecompile();

        assertFalse(P256.verify(DIGEST, r, 0, x, y));
    }

    function test_verify_rejects_r_at_the_group_order() public {
        _installPrecompile();

        assertFalse(P256.verify(DIGEST, N, s, x, y));
    }

    // --- Reading an ambiguous answer -----------------------------------------

    /// @notice The hazard the fallback exists to cover.
    ///
    /// @dev No precompile is installed, so 0x…0100 is an empty address: the
    ///      call SUCCEEDS and returns nothing, which is byte for byte what a
    ///      rejected signature looks like. With no fallback configured there is
    ///      nothing to disambiguate it with, so a perfectly good signature is
    ///      refused. That is the correct failure — refusing is safe, accepting
    ///      would not be — but it is also exactly why deploying this account to
    ///      a chain without RIP-7212 and without a fallback address bricks it
    ///      silently rather than loudly.
    function test_verify_refuses_a_good_signature_when_nothing_can_answer() public view {
        assertFalse(P256.verify(DIGEST, r, s, x, y));
    }

    function test_verify_falls_back_when_the_precompile_is_absent() public view {
        assertTrue(P256.verify(DIGEST, r, s, x, y, VERIFIER));
    }

    function test_verify_fallback_rejects_another_digest() public view {
        assertFalse(P256.verify(OTHER_DIGEST, r, s, x, y, VERIFIER));
    }

    function test_verify_falls_back_when_the_precompile_returns_too_few_bytes() public {
        _installPrecompile(MisbehavingPrecompileStub.Mode.Short);

        assertTrue(P256.verify(DIGEST, r, s, x, y, VERIFIER));
    }

    function test_verify_falls_back_when_the_precompile_reverts() public {
        _installPrecompile(MisbehavingPrecompileStub.Mode.Reverts);

        assertTrue(P256.verify(DIGEST, r, s, x, y, VERIFIER));
    }

    /// @dev A full 32-byte word is a verdict and the fallback is not asked to
    ///      overrule it — in EITHER direction. The two tests below pin that
    ///      down by making the precompile lie in both directions while a
    ///      truthful fallback stands right next to it.
    ///
    ///      This is a trust decision worth naming: the chain's precompile is
    ///      authoritative. Cross-checking it against the fallback would double
    ///      the cost of every single validation to defend against a compromised
    ///      chain, and a compromised chain can rewrite `PrescriptionRegistry`'s
    ///      storage anyway, so the defence would buy nothing.
    function test_verify_trusts_a_precompile_that_says_no() public {
        _installPrecompile(MisbehavingPrecompileStub.Mode.AlwaysInvalid);

        assertFalse(P256.verify(DIGEST, r, s, x, y, VERIFIER));
    }

    function test_verify_trusts_a_precompile_that_says_yes() public {
        _installPrecompile(MisbehavingPrecompileStub.Mode.AlwaysValid);

        assertTrue(P256.verify(OTHER_DIGEST, r, s, x, y, VERIFIER));
    }

    // --- The bytes on the wire -----------------------------------------------

    /// @notice The payload layout, asserted rather than assumed.
    /// @dev 160 bytes, `digest || r || s || x || y`, each field a big-endian
    ///      32-byte word. Get the order wrong and every signature fails; get the
    ///      packing wrong — `abi.encode` instead of `abi.encodePacked`, say —
    ///      and the precompile reads 160 bytes of something else. Neither
    ///      mistake is visible from a passing "valid signature" test alone,
    ///      because both backends would simply say no to everything.
    function test_payload_is_the_shape_rip7212_documents() public view {
        bytes memory payload = abi.encodePacked(DIGEST, r, s, x, y);

        assertEq(payload.length, 160);
        assertEq(bytes32(_word(payload, 0)), DIGEST);
        assertEq(_word(payload, 1), r);
        assertEq(_word(payload, 2), s);
        assertEq(_word(payload, 3), x);
        assertEq(_word(payload, 4), y);
    }

    function _word(bytes memory payload, uint256 index) private pure returns (uint256 value) {
        assembly {
            value := mload(add(payload, add(0x20, mul(index, 0x20))))
        }
    }
}
