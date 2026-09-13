// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title P256
/// @notice secp256r1 (P-256) signature verification, the curve WebAuthn and the
///         secure enclaves of phones and laptops use.
///
/// @dev Why this library exists at all: the EVM verifies secp256k1 natively and
///      P-256 not at all. A doctor's passkey lives in the device enclave and
///      signs on P-256, so without this the whole "no wallet, no seed phrase"
///      premise of docs/01-arquitectura.md has nothing to stand on.
///
///      TWO BACKENDS, ONE POLICY. Verification is delegated, never hand-rolled:
///
///        1. The RIP-7212 precompile at 0x…0100. Confirmed live on Avalanche
///           Fuji. Cheap (a few thousand gas).
///        2. An audited Solidity verifier at an address supplied by the caller.
///           See vendor/p256-verifier/P256Verifier.sol. Correct but expensive,
///           around 330k gas, which is why it is the fallback and not the
///           default. Fase 5 item 2 of docs/18-tareas-por-fases.md asks for it.
///
///      Neither backend enforces low-`s`, so the malleability rule below is
///      applied HERE, before either of them is consulted. That is the only way
///      one policy can cover both.
///
/// @dev READING THE PRECOMPILE'S ANSWER. RIP-7212 returns 32 bytes of 0x…01 for
///      a good signature and NOTHING AT ALL — zero bytes, with the call
///      reporting success — for a bad one. Verified by `eth_call` against Fuji
///      on 13/09/2026. An empty return is therefore ambiguous: it is what a
///      rejected signature looks like, and it is also what a chain WITHOUT the
///      precompile looks like, because a call to an address with no code
///      succeeds and returns nothing. There is no way to tell them apart from
///      inside the EVM.
///
///      This library resolves the ambiguity by asking the fallback. An empty
///      answer is treated as "no verdict", not as "invalid", and the question is
///      put to the Solidity verifier when the caller configured one. That is
///      safe in both directions — the fallback does the same curve arithmetic,
///      so it can neither rescue a bad signature nor condemn a good one — and it
///      costs a wasted 330k-gas call whenever a genuinely invalid signature
///      arrives on a chain that does have the precompile. An operation with an
///      invalid signature was going to fail anyway, so that gas buys certainty
///      about deployment, which is the thing we cannot otherwise observe.
///
///      One consequence to know about before blaming the bundler: on Fuji a
///      VALID signature costs a few thousand gas and a REJECTED one costs
///      around 330k, so an operation whose `verificationGasLimit` was sized for
///      the happy path runs out of gas on the unhappy one. The operation is
///      dropped either way; the difference is that the failure surfaces as
///      out-of-gas rather than as a clean `SIG_VALIDATION_FAILED`.
///
/// @dev BUNDLER COMPATIBILITY, a known rough edge. ERC-7562 forbids an account
///      from calling an address with no code during validation, precompiles
///      excepted. On Fuji 0x…0100 IS a precompile, so the primary path is fine;
///      but a bundler whose simulator does not know about RIP-7212 may reject
///      the operation, and on a chain without the precompile the primary call
///      is, by that rule, a call into the void. Fase 5 item 5 (bundler) is where
///      this gets settled and it is deliberately not settled here.
library P256 {
    /// @notice RIP-7212 / EIP-7212 verification precompile.
    /// @dev Live on Avalanche Fuji. Input is 160 bytes, laid out as
    ///      `digest || r || s || x || y`, each field a big-endian 32-byte word.
    address internal constant PRECOMPILE = address(0x100);

    /// @notice Order of the secp256r1 group.
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    /// @notice `N / 2`, rounded down. The boundary of the low-`s` half.
    uint256 internal constant N_DIV_2 = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;

    /// @notice Verify `digest` against the P-256 public key `(x, y)` using the
    ///         precompile alone.
    /// @dev Returns false rather than reverting, always. Callers that must not
    ///      revert on a bad signature — `PasskeyAccount.validateUserOp`, which
    ///      ERC-4337 requires to report failure as a return value — depend on
    ///      that. There is no error path here to name.
    function verify(bytes32 digest, uint256 r, uint256 s, uint256 x, uint256 y) internal view returns (bool) {
        return verify(digest, r, s, x, y, address(0));
    }

    /// @notice Verify `digest` against `(x, y)`, falling back to
    ///         `fallbackVerifier` when the precompile gives no verdict.
    /// @param fallbackVerifier An EIP-7212-shaped verifier contract, or the zero
    ///        address to run precompile-only. Upstream publishes the audited one
    ///        at 0xc2b78104907F722DABAc4C69f826a522B2754De4 on every chain it has
    ///        been deployed to, Fuji included.
    ///
    /// @dev MALLEABILITY: high-`s` signatures are REJECTED, not normalised.
    ///
    ///      An ECDSA signature `(r, s)` has a twin `(r, n - s)` that verifies
    ///      against the same message and the same key. Both backends accept both
    ///      — this is not an assumption, it was measured: on 13/09/2026 the Fuji
    ///      precompile and the verifier at 0xc2b7…4De4 each answered 0x…01 for a
    ///      signature and for its high-`s` twin. So if this library did nothing,
    ///      every prescription would have two equally valid signatures.
    ///
    ///      Rejecting is chosen over normalising because normalising would make
    ///      the account accept both spellings, and a signature is not only an
    ///      authorisation here: it is the audit evidence a pharmacy is shown and
    ///      the natural idempotency key for anything off-chain that needs to
    ///      recognise a submission it has already seen. Two byte strings that
    ///      are both "the" signature of one prescription is a defect in an audit
    ///      trail even when it is harmless to the chain. Rejecting makes the
    ///      encoding canonical: exactly one valid signature per (message, key).
    ///
    ///      THE COST, stated plainly: WebAuthn authenticators do NOT normalise.
    ///      Roughly half of all real passkey assertions carry a high `s` and
    ///      will be refused here. The client must flip them before submitting —
    ///      `if (s > N/2) s = N - s` — which yields an equally valid signature
    ///      over the same message. The same choice is made by daimo's
    ///      `P256.verifySignature` and by Coinbase's WebAuthnSol, and their SDKs
    ///      normalise client-side for this reason.
    ///
    ///      `WebAuthn.check` upholds that rule rather than papering over it: it
    ///      refuses a high-`s` assertion instead of flipping it, so this library
    ///      is the only place the policy lives. Because a refusal during
    ///      ERC-4337 validation is a silent `1`, the obligation on the client is
    ///      backed by a diagnostic — `PasskeyAccount.checkAssertion` answers
    ///      `AssertionRejected(HighS)` over a free `eth_call`. Forget the flip
    ///      and half of all logins fail; without that call, they fail for no
    ///      visible reason.
    function verify(bytes32 digest, uint256 r, uint256 s, uint256 x, uint256 y, address fallbackVerifier)
        internal
        view
        returns (bool)
    {
        // Out-of-range scalars are refused before any call is paid for. Both
        // backends would refuse them too; doing it here keeps the answer
        // identical whichever backend happens to be reachable.
        if (r == 0 || r >= N) return false;
        if (s == 0 || s > N_DIV_2) return false;

        bytes memory payload = abi.encodePacked(digest, r, s, x, y);

        (bool ok, bytes memory ret) = PRECOMPILE.staticcall(payload);

        // A full 32-byte word is a verdict, and it is final: the fallback is
        // not consulted to second-guess it.
        if (ok && ret.length == 32) {
            return abi.decode(ret, (uint256)) == 1;
        }

        // Anything else — empty, short, or a failed call — is "no verdict".
        if (fallbackVerifier == address(0)) return false;

        (ok, ret) = fallbackVerifier.staticcall(payload);

        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }
}
