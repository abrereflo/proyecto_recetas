// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {P256} from "../src/P256.sol";
import {WebAuthn} from "../src/WebAuthn.sol";
import {WebAuthnFixture} from "./helpers/WebAuthnFixture.sol";

/// @notice What `src/WebAuthn.sol` accepts as a doctor's authorisation, and
///         everything it refuses.
///
/// @dev TWO KINDS OF VECTOR, and the distinction matters.
///
///      The two named `..._real_..._assertion` are REAL: public key, signature,
///      `authenticatorData` and `clientDataJSON` all come from actual passkey
///      ceremonies performed in Safari and in Chrome, published by Coinbase in
///      `base/webauthn-sol` (MIT) and used unmodified. Nothing in this
///      repository produced those bytes, which is exactly why they are here: a
///      contract that misunderstood the digest recipe or the JSON layout could
///      still pass a suite where this project wrote both sides of every vector.
///      These two are the anchor to reality.
///
///      Everything else is CONSTRUCTED, with `vm.signP256` over a hand-built
///      `authenticatorData`/`clientDataJSON` pair, because a published vector
///      cannot be asked for a cleared User Present bit, a registration ceremony
///      replayed as an authentication, or a challenge smuggled into an origin.
///      They are genuine signatures over genuine digests; only the scenarios
///      are invented.
contract WebAuthnTest is WebAuthnFixture {
    // --- The published vectors -----------------------------------------------
    //
    // base/webauthn-sol, test/WebAuthn.t.sol. One credential, two browsers.

    uint256 internal constant VECTOR_X =
        28_573_233_055_232_466_711_029_625_910_063_034_642_429_572_463_461_595_413_086_259_353_299_906_450_061;
    uint256 internal constant VECTOR_Y =
        39_367_742_072_897_599_771_788_408_398_752_356_480_431_855_827_262_528_811_857_788_332_151_452_825_281;

    bytes32 internal constant VECTOR_CHALLENGE =
        0xf631058a3ba1116acce12396fad0a125b5041c43f8e15723709f81aa8d5f4ccf;

    /// @dev The base64url of `VECTOR_CHALLENGE`, written out as a literal rather
    ///      than produced by `WebAuthn.base64UrlEncode`. That is on purpose: the
    ///      JSON below is the JSON the browser actually hashed, so if this
    ///      project's encoder disagreed with it by one character the signature
    ///      check would fail — which is the point of having a real vector at
    ///      all. Encoding it here with our own encoder would make both sides of
    ///      the comparison ours again.
    string internal constant VECTOR_CHALLENGE_B64 = "9jEFijuhEWrM4SOW-tChJbUEHEP44VcjcJ-Bqo1fTM8";

    uint256 internal x;
    uint256 internal y;

    function setUp() public {
        _installVerifier();
        _installPrecompile();

        (x, y) = _publicKey(DOCTOR_KEY);
    }

    // --- Real assertions -----------------------------------------------------

    /// @notice A genuine Safari passkey assertion verifies.
    /// @dev iCloud Keychain, `http://localhost:3005`, no `crossOrigin` field.
    function test_check_accepts_a_real_safari_assertion() public view {
        WebAuthn.Assertion memory assertion = _safariVector();

        _assertRejection(
            WebAuthn.check(assertion, VECTOR_CHALLENGE, VECTOR_X, VECTOR_Y, VERIFIER), WebAuthn.Rejection.None
        );
    }

    /// @notice And a genuine Chrome one, which serialises the JSON differently.
    /// @dev Chrome appends `"crossOrigin":false`, so the document is longer and
    ///      the signature is over different bytes even though the challenge and
    ///      the credential are identical. Two browsers, one credential: proof
    ///      that nothing here depends on a particular JSON length or shape.
    function test_check_accepts_a_real_chrome_assertion() public view {
        WebAuthn.Assertion memory assertion = _chromeVector();

        _assertRejection(
            WebAuthn.check(assertion, VECTOR_CHALLENGE, VECTOR_X, VECTOR_Y, VERIFIER), WebAuthn.Rejection.None
        );
    }

    /// @notice The evidence behind the decision to make User Verification
    ///         mandatory.
    ///
    /// @dev Both real vectors carry flags `0x05` — User Present AND User
    ///      Verified — because both were produced by platform authenticators,
    ///      which verify the user as a matter of course. Requiring UV therefore
    ///      costs nothing on the hardware doctors actually carry, which is what
    ///      makes it an affordable rule rather than a pious one. If this
    ///      assertion ever fails, the argument in `WebAuthn.check` needs
    ///      revisiting, not the test.
    function test_the_real_vectors_were_user_verified() public pure {
        assertEq(_safariVector().authenticatorData[32], bytes1(0x05), "safari");
        assertEq(_chromeVector().authenticatorData[32], bytes1(0x05), "chrome");
    }

    /// @notice A real, valid assertion is not valid for a different operation.
    function test_check_rejects_a_real_assertion_against_another_challenge() public view {
        _assertRejection(
            WebAuthn.check(_safariVector(), keccak256("another operation"), VECTOR_X, VECTOR_Y, VERIFIER),
            WebAuthn.Rejection.ChallengeMismatch
        );
    }

    /// @notice Nor for a different credential.
    function test_check_rejects_a_real_assertion_for_another_key() public view {
        _assertRejection(
            WebAuthn.check(_safariVector(), VECTOR_CHALLENGE, x, y, VERIFIER),
            WebAuthn.Rejection.InvalidSignature
        );
    }

    // --- base64url -----------------------------------------------------------

    /// @notice The encoder agrees with what the browser actually wrote.
    /// @dev `VECTOR_CHALLENGE_B64` is copied from a real `clientDataJSON`. This
    ///      is the only test that pins the encoder against an outside authority;
    ///      everything else would agree with a consistently wrong encoder.
    function test_base64url_matches_a_real_browsers_encoding() public pure {
        assertEq(string(WebAuthn.base64UrlEncode(VECTOR_CHALLENGE)), VECTOR_CHALLENGE_B64);
    }

    /// @notice 43 characters, no `=`. Ever.
    /// @dev WebAuthn uses the UNPADDED form. A padded encoder would append `=`,
    ///      the anchored comparison would never match, and every login would
    ///      fail — an error that looks like a signature problem and is not.
    function test_base64url_is_unpadded_and_43_characters() public pure {
        bytes memory encoded = WebAuthn.base64UrlEncode(VECTOR_CHALLENGE);

        assertEq(encoded.length, 43);

        for (uint256 i = 0; i < encoded.length; ++i) {
            assertTrue(encoded[i] != bytes1("="), "padding leaked into the encoding");
            assertTrue(encoded[i] != bytes1("+") && encoded[i] != bytes1("/"), "not the URL-safe alphabet");
        }
    }

    /// @notice The bit-shuffling at both ends of the range.
    /// @dev The last character is the one an encoder gets wrong: 32 bytes is 256
    ///      bits and 43 characters is 258, so the final character holds four real
    ///      bits in its HIGH end and two zeroes below. The all-ones case is the
    ///      one that catches a shift in the wrong direction — `_` forty-two
    ///      times and then `8`, not `_`.
    function test_base64url_encodes_the_extremes() public pure {
        assertEq(
            string(WebAuthn.base64UrlEncode(bytes32(0))),
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "all zero"
        );
        assertEq(
            string(WebAuthn.base64UrlEncode(bytes32(type(uint256).max))),
            "__________________________________________8",
            "all ones"
        );
        assertEq(
            string(
                WebAuthn.base64UrlEncode(0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f)
            ),
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            "every byte value in sequence"
        );
    }

    // --- The happy path, constructed -----------------------------------------

    function test_check_accepts_a_constructed_assertion() public view {
        _assertRejection(
            WebAuthn.check(
                _assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_UV, TYPE_GET, ORIGIN),
                USER_OP_HASH,
                x,
                y,
                VERIFIER
            ),
            WebAuthn.Rejection.None
        );
    }

    /// @dev A synced iCloud or Google passkey sets Backup Eligible and Backup
    ///      State as well. That is the ordinary case for the device a doctor
    ///      carries and it must not be mistaken for a malformed flag byte.
    function test_check_accepts_a_synced_credential() public view {
        WebAuthn.Assertion memory assertion =
            _assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_UV_SYNCED, TYPE_GET, ORIGIN);

        _assertRejection(WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.None);
    }

    function test_verify_is_check_collapsed_to_a_bit() public view {
        WebAuthn.Assertion memory good = _assertion(DOCTOR_KEY, USER_OP_HASH);
        WebAuthn.Assertion memory bad = _assertion(IMPOSTOR_KEY, USER_OP_HASH);

        assertTrue(WebAuthn.verify(good, USER_OP_HASH, x, y, VERIFIER));
        assertFalse(WebAuthn.verify(bad, USER_OP_HASH, x, y, VERIFIER));
    }

    // --- Binding to the operation --------------------------------------------

    /// @notice An assertion authorises ONE operation.
    /// @dev The doctor really did sign this, with the right key, in a real
    ///      ceremony — for something else. That is the whole reason the
    ///      challenge is checked rather than assumed.
    function test_check_rejects_an_assertion_bound_to_another_operation() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, keccak256("a different operation"));

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.ChallengeMismatch
        );
    }

    /// @notice THE attack the careless implementation allows.
    ///
    /// @dev This is the test the whole design of `WebAuthn.check` step 12 exists
    ///      for, so it asserts the attack as well as the defence.
    ///
    ///      The doctor visits a page the attacker controls and approves ONE
    ///      ordinary-looking ceremony. The challenge in it is the attacker's own
    ///      operation — so the assertion is completely genuine, as the first
    ///      assertion below proves — but the attacker has arranged for the
    ///      VICTIM operation's hash to appear in the `origin`, which they chose.
    ///
    ///      An implementation that located the challenge by searching for it
    ///      anywhere in `clientDataJSON` would find it, and would hand back a
    ///      valid authorisation for an operation the doctor never saw. The
    ///      middle assertion proves that search would have succeeded. It is not
    ///      a hypothetical: it is one `indexOf` away from being the obvious
    ///      implementation.
    ///
    ///      Anchoring to the literal `"challenge":"…"`, closing quote included,
    ///      refuses it — and keeps refusing it when the attacker points
    ///      `challengeIndex` straight at their smuggled copy, because the twelve
    ///      bytes in front of it are `?x=`, not `"challenge":"`.
    function test_check_rejects_a_challenge_smuggled_into_another_field() public view {
        bytes32 victimOp = keccak256("issue a prescription the doctor never saw");
        bytes32 attackerOp = keccak256("the operation the attacker actually asked for");

        string memory smuggled = string(WebAuthn.base64UrlEncode(victimOp));
        string memory json = string.concat(
            '{"type":"webauthn.get","challenge":"',
            string(WebAuthn.base64UrlEncode(attackerOp)),
            '","origin":"https://evil.example/?x=',
            smuggled,
            '"}'
        );

        WebAuthn.Assertion memory assertion =
            _signAssertion(DOCTOR_KEY, _authenticatorData(FLAGS_UP_UV), json, 23, 1);

        _assertRejection(
            WebAuthn.check(assertion, attackerOp, x, y, VERIFIER),
            WebAuthn.Rejection.None,
            "the assertion is genuine; that is what makes the attack an attack"
        );

        uint256 smuggledAt = _indexOf(json, smuggled);
        assertTrue(smuggledAt != type(uint256).max, "a naive substring search WOULD have found the challenge");

        _assertRejection(
            WebAuthn.check(assertion, victimOp, x, y, VERIFIER),
            WebAuthn.Rejection.ChallengeMismatch,
            "the anchored comparison refuses it"
        );

        assertion.challengeIndex = smuggledAt - 13;

        _assertRejection(
            WebAuthn.check(assertion, victimOp, x, y, VERIFIER),
            WebAuthn.Rejection.ChallengeMismatch,
            "and pointing the index at the smuggled copy does not help"
        );
    }

    /// @notice The closing quote is load-bearing.
    /// @dev Here the challenge field holds the right 43 characters followed by
    ///      one more. Without the trailing `"` in the comparison this would pass,
    ///      and with it the value is pinned to exactly the digest we asked for.
    function test_check_requires_the_challenge_field_to_end_where_it_should() public view {
        string memory json = string.concat(
            '{"type":"webauthn.get","challenge":"',
            string(WebAuthn.base64UrlEncode(USER_OP_HASH)),
            'X","origin":"https://recetas.example"}'
        );

        WebAuthn.Assertion memory assertion =
            _signAssertion(DOCTOR_KEY, _authenticatorData(FLAGS_UP_UV), json, 23, 1);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.ChallengeMismatch
        );
    }

    // --- The ceremony type ---------------------------------------------------

    /// @notice A registration cannot be replayed as an authentication.
    /// @dev Same key, same challenge, same flags — and `"type":"webauthn.create"`
    ///      instead of `"webauthn.get"`. Without step 11 this would be a valid
    ///      authorisation obtained by asking the doctor to enrol a passkey.
    function test_check_rejects_a_registration_ceremony() public view {
        WebAuthn.Assertion memory assertion =
            _assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_UV, TYPE_CREATE, ORIGIN);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.WrongCeremonyType
        );
    }

    // --- Flags ---------------------------------------------------------------

    function test_check_rejects_an_assertion_with_no_user_present() public view {
        WebAuthn.Assertion memory assertion =
            _assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UV_ONLY, TYPE_GET, ORIGIN);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.UserNotPresent
        );
    }

    /// @notice The clinical-accountability rule, enforced.
    /// @dev User Present is set: somebody touched the authenticator. User
    ///      Verified is not: the authenticator never established who. This is a
    ///      device left unlocked on a ward desk, and it may not issue a
    ///      prescription. See the argument in `WebAuthn.check` step 17.
    function test_check_rejects_an_assertion_the_authenticator_did_not_verify() public view {
        WebAuthn.Assertion memory assertion =
            _assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_ONLY, TYPE_GET, ORIGIN);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.UserNotVerified
        );
    }

    /// @dev Backup State without Backup Eligible: the authenticator says the
    ///      credential is backed up and that it cannot be backed up.
    function test_check_rejects_contradictory_backup_flags() public view {
        WebAuthn.Assertion memory assertion =
            _assertion(DOCTOR_KEY, USER_OP_HASH, FLAGS_UP_UV_IMPOSSIBLE_BACKUP, TYPE_GET, ORIGIN);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER),
            WebAuthn.Rejection.InconsistentBackupFlags
        );
    }

    /// @dev 36 bytes: `rpIdHash` and nothing after it. Reading the flags byte
    ///      without this check would revert, and reverting is the one thing
    ///      validation may not do.
    function test_check_rejects_authenticator_data_too_short_to_have_flags() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        assertion.authenticatorData = abi.encodePacked(RP_ID_HASH, bytes4(0));

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER),
            WebAuthn.Rejection.AuthenticatorDataTooShort
        );
    }

    // --- Malleability --------------------------------------------------------

    /// @notice A high-`s` assertion is REFUSED, and the backend would have taken
    ///         it.
    ///
    /// @dev The same two-part assertion `P256.t.sol` makes, repeated here
    ///      because this is where it will actually bite: authenticators do not
    ///      normalise, so roughly half of real assertions look like this one.
    ///      The precompile says yes to the flipped twin; this library says no,
    ///      by name, so that `PasskeyAccount.checkAssertion` can tell a client
    ///      exactly what it forgot.
    function test_check_rejects_a_high_s_assertion_the_precompile_would_accept() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);

        bytes32 digest =
            sha256(abi.encodePacked(assertion.authenticatorData, sha256(bytes(assertion.clientDataJSON))));

        assertion.s = _flip(assertion.s);
        assertGt(assertion.s, N_DIV_2, "the flipped s should be in the high half");

        (bool ok, bytes memory ret) =
            P256.PRECOMPILE.staticcall(abi.encodePacked(digest, assertion.r, assertion.s, x, y));
        assertTrue(
            ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1, "backend rejected the high-s twin"
        );

        _assertRejection(WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.HighS);
    }

    // --- The signature itself ------------------------------------------------

    function test_check_rejects_an_assertion_from_another_key() public view {
        WebAuthn.Assertion memory assertion = _assertion(IMPOSTOR_KEY, USER_OP_HASH);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.InvalidSignature
        );
    }

    /// @dev The challenge is untouched, so step 12 passes; the document around
    ///      it changed, so the digest does not. The whole `clientDataJSON` is
    ///      signed, not just the part this contract reads.
    function test_check_rejects_client_data_edited_after_signing() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);

        assertion.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            string(WebAuthn.base64UrlEncode(USER_OP_HASH)),
            '","origin":"https://recetas.example.evil","crossOrigin":false}'
        );

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.InvalidSignature
        );
    }

    /// @dev And so is `authenticatorData`. The signature counter is not read by
    ///      this library, which does not make it free to change.
    function test_check_rejects_authenticator_data_edited_after_signing() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        assertion.authenticatorData = _authenticatorData(FLAGS_UP_UV, 99);

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.InvalidSignature
        );
    }

    // --- Indices the client controls -----------------------------------------

    /// @notice An out-of-range index is a refusal, never a revert.
    /// @dev `challengeIndex` and `typeIndex` arrive from the client and nothing
    ///      constrains them. `type(uint256).max` would overflow any
    ///      `offset + length` bounds check written the obvious way, and an
    ///      arithmetic revert inside `validateUserOp` is how an account gets
    ///      itself dropped by every bundler on the network.
    function test_check_survives_indices_that_would_overflow_a_bounds_check() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        assertion.challengeIndex = type(uint256).max;

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.ChallengeMismatch
        );

        assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        assertion.typeIndex = type(uint256).max;

        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.WrongCeremonyType
        );
    }

    /// @dev Off by one in either direction is a mismatch, not a near miss.
    function test_check_rejects_a_misplaced_challenge_index() public view {
        WebAuthn.Assertion memory assertion = _assertion(DOCTOR_KEY, USER_OP_HASH);
        uint256 correct = assertion.challengeIndex;

        assertion.challengeIndex = correct + 1;
        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.ChallengeMismatch
        );

        assertion.challengeIndex = correct - 1;
        _assertRejection(
            WebAuthn.check(assertion, USER_OP_HASH, x, y, VERIFIER), WebAuthn.Rejection.ChallengeMismatch
        );
    }

    // --- Fixtures ------------------------------------------------------------

    bytes32 internal constant USER_OP_HASH = keccak256("userOpHash");

    /// @dev Safari / iCloud Keychain. Copied byte for byte from
    ///      base/webauthn-sol.
    function _safariVector() internal pure returns (WebAuthn.Assertion memory assertion) {
        assertion.authenticatorData =
        hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000101";
        assertion.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            VECTOR_CHALLENGE_B64,
            '","origin":"http://localhost:3005"}'
        );
        assertion.challengeIndex = 23;
        assertion.typeIndex = 1;
        assertion.r =
            43_684_192_885_701_841_787_131_392_247_364_253_107_519_555_363_555_461_570_655_060_745_499_568_693_242;
        assertion.s =
            22_655_632_649_588_629_308_599_201_066_602_670_461_698_485_748_654_492_451_178_007_896_016_452_673_579;
    }

    /// @dev Chrome. Same credential, same challenge, a longer document.
    function _chromeVector() internal pure returns (WebAuthn.Assertion memory assertion) {
        assertion.authenticatorData =
        hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000010a";
        assertion.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            VECTOR_CHALLENGE_B64,
            '","origin":"http://localhost:3005","crossOrigin":false}'
        );
        assertion.challengeIndex = 23;
        assertion.typeIndex = 1;
        assertion.r =
            29_739_767_516_584_490_820_047_863_506_833_955_097_567_272_713_519_339_793_744_591_468_032_609_909_569;
        assertion.s =
            45_947_455_641_742_997_809_691_064_512_762_075_989_493_430_661_170_736_817_032_030_660_832_793_108_102;
    }

    function _assertRejection(WebAuthn.Rejection actual, WebAuthn.Rejection expected) internal pure {
        assertEq(uint256(actual), uint256(expected), "wrong rejection reason");
    }

    function _assertRejection(WebAuthn.Rejection actual, WebAuthn.Rejection expected, string memory why)
        internal
        pure
    {
        assertEq(uint256(actual), uint256(expected), why);
    }
}
