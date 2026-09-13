// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {P256} from "./P256.sol";

/// @title WebAuthn
/// @notice Verification of a WebAuthn authentication assertion — the thing a
///         passkey actually produces — against a P-256 public key.
///
/// @dev WHY THIS LIBRARY EXISTS, and why the task that asked for it was worded
///      wrongly. `docs/18-tareas-por-fases.md` called Fase 5 item 4 the
///      "translation of the WebAuthn response into the format the verifier
///      expects", which reads like client-side work. It cannot be. An
///      authenticator does not sign whatever 32 bytes you hand it: it signs
///
///          sha256(authenticatorData || sha256(clientDataJSON))
///
///      where the bytes you asked for — here the `userOpHash` — appear inside
///      `clientDataJSON` as a base64url `challenge`, alongside an origin, a
///      ceremony type, and whatever else the browser felt like serialising. A
///      signature over THAT message is not a signature over `userOpHash` in a
///      different encoding; it is a signature over a different message. No
///      client-side transformation can turn one into the other without the
///      private key, which is in a secure enclave and is never leaving it. The
///      only place the gap can be closed is on chain, by rebuilding the message
///      the authenticator actually signed and then checking that the thing
///      buried inside it is the operation we meant to authorise. That is this
///      library.
///
/// @dev PROVENANCE. The shape follows Coinbase's WebAuthnSol
///      (github.com/base/webauthn-sol), which in turn follows daimo's
///      `WebAuthn.sol` (github.com/daimo-eth/p256-verifier). Both are MIT and
///      both are in production. What is NOT copied from them is the policy:
///      User Verification is mandatory here rather than a caller flag, and the
///      malleability rule is this project's, inherited from `P256.sol`. Those
///      two departures are argued below.
///
/// @dev WHAT IS CHECKED, in the numbering of the W3C verification algorithm
///      (https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion):
///
///        11. `type` is exactly `webauthn.get`.
///        12. `challenge` is exactly the base64url of the digest we asked for.
///        16. User Present is set.
///        17. User Verified is set. Always. See below.
///        19. `sha256(clientDataJSON)`.
///        20. P-256 verification of `sha256(authenticatorData || that)`.
///
///      Plus the WebAuthn L3 well-formedness rule that Backup State may not be
///      set when Backup Eligibility is not — an authenticator claiming a
///      credential is backed up while also claiming it cannot be backed up is
///      contradicting itself, and this library would rather refuse it than
///      guess which half was true.
///
/// @dev WHAT IS DELIBERATELY NOT CHECKED, and why — these are load-bearing
///      omissions, not gaps:
///
///      THE `origin` IN `clientDataJSON`, AND `rpIdHash` IN `authenticatorData`.
///      Both pin the assertion to a domain. Neither is checked, for the same
///      two reasons. First, it would buy very little: a passkey is created for
///      one Relying Party and the authenticator refuses to use it for any
///      other, so the credential is already domain-scoped by construction, and
///      the public key in this account IS that credential. Second, it would
///      cost a great deal: the RP id would have to be frozen into the account,
///      and the account address is a CREATE2 commitment to its constructor
///      arguments (see `PasskeyAccount`), so moving the doctor's app from a
///      preview URL to its real domain would invalidate every account and every
///      EAS credential issued to one. A buildathon demo that changes hostname
///      once would brick itself. The trade is accepted knowingly: this library
///      trusts the authenticator to enforce RP scoping, exactly as Coinbase and
///      daimo both document that they do.
///
///      THE SIGNATURE COUNTER. It is in `authenticatorData` and it is ignored.
///      It exists for cloning detection through risk scoring, which needs
///      per-credential mutable state; this account has none on purpose, and
///      ERC-7562 would not let validation read it anyway.
///
///      `topOrigin` / CROSS-ORIGIN USE. Assumed absent. The doctor's app must
///      not embed the ceremony in an iframe, which is the default anyway.
///
/// @dev GAS, MEASURED RATHER THAN GUESSED. `verificationGasLimit` has to cover
///      all of this, so here are the numbers, taken with `gasleft()` deltas on
///      a cancun EVM over a 136-byte `clientDataJSON` and a 512-byte envelope:
///
///        - ABI-decoding the envelope out of `userOp.signature`: 9.1k. Only
///          1.9k of that is the decode; the other 7.2k is the external self-call
///          that gives `abi.decode` a revert boundary, because ERC-4337 forbids
///          reverting over a malformed signature. See
///          `PasskeyAccount.decodeAssertion` — the price is argued there.
///        - everything `check` does except the curve: ~8.1k, of which
///          base64url of the challenge is 4.7k, the two `sha256` calls are
///          ~1.3k, and the anchored comparisons and flag reads are the rest.
///          The base64url figure was 15.7k before that function was rewritten
///          in assembly; at 57% of the envelope cost it had stopped being a
///          detail.
///        - `P256.verify`, which dominates everything above: ~3.4k against the
///          Fuji precompile, ~330k when the fallback verifier has to answer.
///
///      End to end, `PasskeyAccount.validateUserOp` measured ~52k with a cheap
///      mock backend standing in for the precompile, and ~393k when the
///      Solidity fallback answered. So the WebAuthn envelope costs about 17k
///      more than the raw P-256 check it replaced.
///
///      SIZE `verificationGasLimit` FOR THE FALLBACK — call it 450k — NOT FOR
///      THE PRECOMPILE. The warning `P256.sol` already carries applies here with
///      more force: the expensive path is the REJECTED signature, because an
///      empty answer from the precompile sends the question to the 330k
///      verifier. An operation budgeted from a happy-path measurement fails as
///      out-of-gas rather than as a clean `SIG_VALIDATION_FAILED`, and those two
///      look nothing alike from a bundler's logs.
library WebAuthn {
    /// @notice A WebAuthn assertion, as `PasskeyAccount` receives it in
    ///         `userOp.signature`.
    ///
    /// @dev Field-for-field identical to Coinbase's `WebAuthnAuth`, on purpose:
    ///      it means the client can be written against published helpers rather
    ///      than against a bespoke encoding invented here, and `viem` can
    ///      produce it with one `encodeAbiParameters` call.
    ///
    ///      A HAND-ROLLED COMPACT ENCODING WAS CONSIDERED AND REJECTED, and the
    ///      case for it was not weak: it would shrink the envelope from 512
    ///      bytes to about 245, and a length-prefixed layout can be
    ///      bounds-checked inline, which removes the 9.1k self-call that
    ///      `abi.decode` needs to be made non-reverting. Around 13k gas, all
    ///      told. It loses anyway on two counts. The bounds checking would
    ///      become this project's code to get right, in the one function every
    ///      signature passes through, where an off-by-one is a forgery
    ///      primitive — whereas the ABI decoder is code nobody here has to
    ///      write. And a bespoke layout has to be reimplemented from this
    ///      docblock by whoever writes the client, while this struct can be
    ///      encoded by copying a published example. 13k gas is a fraction of a
    ///      cent on Fuji; a client and a contract disagreeing by one byte, with
    ///      only `SIG_VALIDATION_FAILED` to debug it by, costs a day.
    ///
    /// @param authenticatorData Straight from the authenticator. At least 37
    ///        bytes: `rpIdHash` (32) || `flags` (1) || `signCount` (4).
    /// @param clientDataJSON Straight from the browser. Hashed whole, so not one
    ///        byte of it may be reformatted in transit — no re-serialising, no
    ///        whitespace tidying, no key reordering. Send the bytes you got.
    /// @param challengeIndex Byte offset in `clientDataJSON` where the literal
    ///        `"challenge":"` begins. In JavaScript:
    ///        `json.indexOf('"challenge":"')`.
    /// @param typeIndex Byte offset where `"type":"` begins.
    ///        `json.indexOf('"type":"')`.
    /// @param r P-256 signature, r.
    /// @param s P-256 signature, s. MUST be in the low half of the group —
    ///        authenticators do not do this for you. See `Rejection.HighS`.
    struct Assertion {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 r;
        uint256 s;
    }

    /// @notice Why an assertion was refused.
    ///
    /// @dev This enum is the only reason the library is written as `check`
    ///      returning a reason rather than `verify` returning a bool, and it
    ///      earns its place. ERC-4337 forbids `validateUserOp` from reverting
    ///      over a bad signature, so the account can only answer `1` — a single
    ///      bit, with no room for "your `s` was in the wrong half" or "your
    ///      authenticator did not verify the user". A doctor whose login fails
    ///      would get nothing to act on. `PasskeyAccount.checkAssertion` is a
    ///      free `eth_call` that reverts with exactly this value, so the
    ///      failure is one query away from being explained instead of being a
    ///      mystery. `verify` is kept for callers that only want the bit.
    ///
    /// @dev `MalformedEnvelope` is raised by the account rather than by this
    ///      library — it is what a failed `abi.decode` becomes. It lives in this
    ///      enum so that one vocabulary covers every way an assertion can be
    ///      refused, which is what makes the diagnostic useful.
    enum Rejection {
        None,
        MalformedEnvelope,
        AuthenticatorDataTooShort,
        UserNotPresent,
        UserNotVerified,
        InconsistentBackupFlags,
        WrongCeremonyType,
        ChallengeMismatch,
        HighS,
        InvalidSignature
    }

    /// @notice Bit 0 of the flags byte: a user was present — someone touched it.
    bytes1 internal constant FLAG_USER_PRESENT = 0x01;

    /// @notice Bit 2: the authenticator verified WHO was present.
    bytes1 internal constant FLAG_USER_VERIFIED = 0x04;

    /// @notice Bit 3: this credential may be backed up / synced.
    bytes1 internal constant FLAG_BACKUP_ELIGIBLE = 0x08;

    /// @notice Bit 4: this credential currently IS backed up.
    bytes1 internal constant FLAG_BACKUP_STATE = 0x10;

    /// @notice `rpIdHash` (32) || `flags` (1) || `signCount` (4).
    uint256 internal constant AUTHENTICATOR_DATA_MIN_LENGTH = 37;

    /// @notice Offset of the flags byte inside `authenticatorData`.
    uint256 internal constant FLAGS_OFFSET = 32;

    /// @notice `"type":"webauthn.get"` — 21 bytes, quotes and colon included.
    bytes32 internal constant TYPE_GET_HASH = keccak256('"type":"webauthn.get"');

    /// @notice Length of the string `TYPE_GET_HASH` is the hash of.
    uint256 internal constant TYPE_FIELD_LENGTH = 21;

    /// @notice `"challenge":"` (13) + base64url of 32 bytes (43) + `"` (1).
    uint256 internal constant CHALLENGE_FIELD_LENGTH = 57;

    /// @notice base64url's alphabet: RFC 4648 §5, `-` and `_` for `+` and `/`.
    bytes internal constant BASE64URL_ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /// @notice Is this assertion a valid authorisation of `challenge` by the
    ///         holder of `(x, y)`?
    /// @dev Never reverts. See `check`.
    function verify(
        Assertion memory assertion,
        bytes32 challenge,
        uint256 x,
        uint256 y,
        address fallbackVerifier
    ) internal view returns (bool) {
        return check(assertion, challenge, x, y, fallbackVerifier) == Rejection.None;
    }

    /// @notice The same question, answered with a reason.
    ///
    /// @dev NEVER REVERTS, on any input, however malformed. Everything that
    ///      could — an index past the end of the JSON, a one-byte
    ///      `authenticatorData` — is bounds-checked into a `Rejection` instead.
    ///      `PasskeyAccount.validateUserOp` depends on that absolutely: a
    ///      reverting validation takes the bundler's whole bundle down with it.
    ///
    /// @dev CHECK ORDER IS CHEAPEST-FIRST. A rejected operation still costs the
    ///      bundler real gas to discover, so the checks that need no hashing run
    ///      before the ones that do, and `P256.verify` — which is between 3.4k
    ///      and 330k gas — runs last, after everything that could have refused
    ///      the assertion for free.
    ///
    /// @param assertion What the authenticator and the browser produced.
    /// @param challenge What we asked to be signed: the `userOpHash`.
    /// @param x Owner's public key, X.
    /// @param y Owner's public key, Y.
    /// @param fallbackVerifier Passed through to `P256.verify`; zero for
    ///        precompile-only.
    function check(
        Assertion memory assertion,
        bytes32 challenge,
        uint256 x,
        uint256 y,
        address fallbackVerifier
    ) internal view returns (Rejection) {
        // --- Malleability, first because it is one comparison -----------------
        //
        // THIS IS THE LANDMINE OF THE WHOLE FEATURE, so it is checked here and
        // named here rather than being left to fall out of `P256.verify` as an
        // anonymous `false`.
        //
        // `P256.verify` REJECTS `s` in the upper half of the group, on purpose
        // and after measurement: neither the Fuji precompile nor the audited
        // fallback does, so without the rule every prescription would have two
        // equally valid signatures. That decision is argued at length in
        // `P256.sol` and it is not revisited here.
        //
        // WHERE THE FLIP BELONGS: WITH THE CLIENT. This library does NOT
        // normalise. Authenticators emit whichever half the nonce landed in, so
        // roughly HALF OF ALL REAL PASSKEY ASSERTIONS ARRIVE WITH HIGH `s` AND
        // WILL BE REFUSED HERE. The client must flip them before submitting:
        //
        //     if (s > n / 2) s = n - s;
        //
        // which produces an equally valid signature over the same message, and
        // is what Coinbase's and daimo's SDKs both already do client-side.
        //
        // Normalising here instead would have cost about twenty gas and removed
        // the footgun entirely, and it was still rejected, for one reason: it
        // would make this library disagree with `P256.verify` about what a valid
        // signature is. `P256.verify` would then hold a policy no production
        // caller ever exercises — a rule that is documented, tested, and dead.
        // One rule, applied in one place, enforced everywhere: that is worth
        // more than a papered-over client bug, PROVIDED the client bug is
        // findable. Which is what `Rejection.HighS` and
        // `PasskeyAccount.checkAssertion` are for: half the logins failing is
        // survivable if `eth_call` says why in one round trip, and fatal if it
        // does not.
        if (assertion.s > P256.N_DIV_2) return Rejection.HighS;

        // --- Flags ------------------------------------------------------------
        if (assertion.authenticatorData.length < AUTHENTICATOR_DATA_MIN_LENGTH) {
            return Rejection.AuthenticatorDataTooShort;
        }

        bytes1 flags = assertion.authenticatorData[FLAGS_OFFSET];

        // 16. Someone was there.
        if (flags & FLAG_USER_PRESENT != FLAG_USER_PRESENT) {
            return Rejection.UserNotPresent;
        }

        // 17. USER VERIFICATION IS MANDATORY HERE. Coinbase and daimo both make
        //     this a caller flag; this library hard-codes it, and the reason is
        //     clinical rather than technical.
        //
        //     User Present means a human touched the authenticator. User
        //     Verified means the authenticator established WHICH human — a
        //     fingerprint, a face, a device PIN. The difference between those
        //     two is the difference between "this device signed a prescription"
        //     and "this doctor signed a prescription", and the second is the
        //     only one that means anything when the artefact being produced is a
        //     medical-legal record naming a licensed prescriber. `docs/02` ties
        //     the right to issue to an EAS credential held by a PERSON; an
        //     unlocked phone left on a ward desk, or a security key left plugged
        //     in, must not be able to exercise it.
        //
        //     BE HONEST ABOUT WHAT THIS BUYS. The UV bit is the authenticator's
        //     own claim, and this contract has no attestation with which to
        //     check it. Someone who has extracted the private key can set it to
        //     whatever they like. So this defends against negligence — a
        //     borrowed unlocked device, a shared token, a resident tapping the
        //     attending's key — and not against the key holder themselves, who
        //     could sign anything regardless. Negligence is the failure mode
        //     that actually happens on a ward.
        //
        //     THE PRICE, and it falls on the client: every ceremony must be
        //     requested with `userVerification: "required"`, at registration and
        //     at every assertion. `"preferred"` will silently produce UV=0 on
        //     some authenticators and those logins will be refused. Platform
        //     passkeys — Touch ID, Face ID, Windows Hello, Android — set UV as a
        //     matter of course, which is why the published Chrome and Safari
        //     vectors in the tests both carry flags `0x05`. Older U2F-style
        //     roaming keys cannot do UV at all and are, deliberately, not usable
        //     as prescriber credentials in this system.
        //
        //     It is not a constructor parameter for the same reason nothing else
        //     here is: a per-account switch would be an administrator over how
        //     much a signature means, and this project does not have those.
        if (flags & FLAG_USER_VERIFIED != FLAG_USER_VERIFIED) {
            return Rejection.UserNotVerified;
        }

        // WebAuthn L3: a credential cannot be backed up if it is not eligible
        // to be. An authenticator asserting both is contradicting itself.
        if (
            flags & FLAG_BACKUP_ELIGIBLE != FLAG_BACKUP_ELIGIBLE
                && flags & FLAG_BACKUP_STATE == FLAG_BACKUP_STATE
        ) {
            return Rejection.InconsistentBackupFlags;
        }

        bytes memory clientData = bytes(assertion.clientDataJSON);

        // --- 11. The ceremony type -------------------------------------------
        //
        // Without this, a REGISTRATION ceremony could be replayed as an
        // authentication. The two produce structurally similar client data and
        // the same key signs both; only this field distinguishes "I am creating
        // a credential" from "I am authorising this operation". A client that
        // could be induced to register a credential with a `userOpHash` as the
        // challenge — which is a perfectly ordinary-looking thing to ask for —
        // would otherwise be handing out valid authorisations.
        if (!_matchesAt(clientData, assertion.typeIndex, TYPE_FIELD_LENGTH, TYPE_GET_HASH)) {
            return Rejection.WrongCeremonyType;
        }

        // --- 12. The challenge ------------------------------------------------
        //
        // HOW THE CHALLENGE IS LOCATED, and what the careless version costs.
        //
        // This takes Coinbase WebAuthnSol's approach, which is daimo's: the
        // CLIENT says where the field starts, and the contract compares an
        // ANCHORED, FULLY DELIMITED slice at that offset — the key name, the
        // colon, the opening quote, all 43 base64url characters, and THE
        // CLOSING QUOTE. Nothing about the offset is trusted; it is only a
        // pointer, and the comparison is what decides.
        //
        // THE CARELESS VERSION IS A SUBSTRING SEARCH: encode the `userOpHash`
        // as base64url and look for it anywhere in `clientDataJSON`. That is
        // forgeable. `clientDataJSON` is an open-ended JSON object — the spec
        // explicitly allows fields this contract has never heard of — and the
        // `origin` is attacker-influenced. So an attacker obtains ONE genuine
        // assertion from the doctor for a challenge of the attacker's choosing,
        // on a page whose URL they control:
        //
        //     {"type":"webauthn.get",
        //      "challenge":"<the attacker's own operation>",
        //      "origin":"https://evil.example/?x=<the victim's userOpHash>"}
        //
        // A substring search finds the victim's hash, says yes, and the P-256
        // check passes — the signature IS genuine, it is simply a signature over
        // something else. One tap by the doctor becomes an authorisation for an
        // operation they never saw. Anchoring to `"challenge":"` and requiring
        // the closing quote kills it, and it kills it for a reason worth
        // stating: JSON has no way to put an unescaped `"` inside a string
        // value, so the 57-byte literal this compares against CANNOT occur
        // anywhere except as a genuine `challenge` field. The delimiters are the
        // security property; dropping either quote gives the attack back.
        //
        // Compared as a keccak of the memory region rather than by copying the
        // slice out: same answer, no allocation, and no chance of an off-by-one
        // in a hand-written byte loop.
        bytes32 expected = keccak256(abi.encodePacked('"challenge":"', base64UrlEncode(challenge), '"'));

        if (!_matchesAt(clientData, assertion.challengeIndex, CHALLENGE_FIELD_LENGTH, expected)) {
            return Rejection.ChallengeMismatch;
        }

        // --- 19 and 20. The message the authenticator actually signed ---------
        //
        // Note the order: the JSON is hashed first, and THAT hash — not the
        // JSON — is concatenated after `authenticatorData`. Getting this
        // backwards, or concatenating the JSON itself, produces a digest that
        // fails for every signature ever made, which is indistinguishable from
        // "passkeys do not work".
        bytes32 digest = sha256(abi.encodePacked(assertion.authenticatorData, sha256(clientData)));

        if (!P256.verify(digest, assertion.r, assertion.s, x, y, fallbackVerifier)) {
            return Rejection.InvalidSignature;
        }

        return Rejection.None;
    }

    /// @notice base64url of exactly 32 bytes, unpadded: 43 characters.
    ///
    /// @dev Specialised to `bytes32` rather than general `bytes` because the
    ///      challenge is always a `userOpHash` and never anything else. 32 bytes
    ///      is 256 bits, 43 characters is 258, so the last character carries the
    ///      trailing 4 bits in its top 4 and two zero bits below them — and
    ///      there is NO `=` padding, because WebAuthn's base64url is the
    ///      unpadded form. A padded encoding would produce `…TM8=` and fail
    ///      against every browser on earth.
    ///
    /// @dev WRITTEN IN ASSEMBLY, AND MEASURED BEFORE IT WAS. The obvious
    ///      Solidity — `encoded[i] = alphabet[...]` in a loop — costs 15.7k gas,
    ///      because each of the 43 characters pays for two bounds-checked
    ///      `bytes1` accesses and their masking. That was 57% of the entire
    ///      envelope check, for a table lookup. The loop below is the same
    ///      arithmetic with `mstore8` and `byte`, and it is the only place in
    ///      this project where assembly buys enough to be worth the risk. The
    ///      risk is contained by the tests: `test/WebAuthn.t.sol` pins this
    ///      function against a string a real browser wrote, against both ends of
    ///      the range, and against a byte-by-byte counting vector.
    function base64UrlEncode(bytes32 value) internal pure returns (bytes memory encoded) {
        // ORDER MATTERS: the alphabet is allocated first so that `encoded`'s own
        // 96 bytes sit behind it. The lookup below reads a full word starting at
        // `table + index`, so with `index` up to 63 it reads up to 31 bytes past
        // the 64-byte table — harmless, because those bytes are allocated and
        // only read, but only as long as something IS allocated there.
        bytes memory alphabet = BASE64URL_ALPHABET;

        encoded = new bytes(43);

        uint256 word = uint256(value);

        assembly ("memory-safe") {
            let out := add(encoded, 0x20)
            let table := add(alphabet, 0x20)

            // Forty-two whole 6-bit groups, most significant first. At `i` the
            // group occupies bits [6i, 6i+6) counting from the top, which is a
            // right shift of `256 - 6(i + 1)` = `250 - 6i`.
            for { let i := 0 } lt(i, 42) { i := add(i, 1) } {
                let sixBits := and(shr(sub(250, mul(6, i)), word), 0x3F)
                mstore8(add(out, i), byte(0, mload(add(table, sixBits))))
            }

            // 252 bits consumed, 4 left. They are the HIGH bits of the final
            // group, so they shift up by two and the bottom two bits are zero.
            mstore8(add(out, 42), byte(0, mload(add(table, shl(2, and(word, 0x0F))))))
        }
    }

    /// @dev Does the `length`-byte window of `data` at `offset` hash to
    ///      `expected`?
    ///
    ///      Both bounds checks are written as subtractions from `data.length`
    ///      rather than as `offset + length > data.length`, because `offset`
    ///      comes from the client and an addition would overflow-revert in
    ///      Solidity 0.8 — and a revert here is precisely the thing that must
    ///      not happen during validation. An out-of-range index has to be a
    ///      `false`, not a thrown bundle.
    function _matchesAt(bytes memory data, uint256 offset, uint256 length, bytes32 expected)
        private
        pure
        returns (bool)
    {
        if (length > data.length) return false;
        if (offset > data.length - length) return false;

        bytes32 actual;

        // Read-only keccak over a window of `data`'s payload. Memory-safe: the
        // bounds above put the whole window inside the allocation.
        assembly ("memory-safe") {
            actual := keccak256(add(add(data, 0x20), offset), length)
        }

        return actual == expected;
    }
}
