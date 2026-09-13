import { encodeAbiParameters } from 'viem';
import { base64UrlToBytes, bytesToBase64Url, bytesToHex, hexToBytes } from '@recetas/crypto';
import type { Bytes32, Hex } from '@recetas/shared';
import { decodeEcdsaSignature, P256_ORDER } from './der';

/**
 * The envelope `PasskeyAccount` decodes out of `userOp.signature`, built from
 * what a WebAuthn authentication ceremony actually returns.
 *
 * This module is the client half of the contract argued in
 * `contracts/src/WebAuthn.sol`. Everything in it exists because that file says
 * so, and each rule below names the failure it prevents.
 */

/**
 * Half the group order, rounded down. `P256.N_DIV_2` on the contract side.
 *
 * A signature whose `s` is above this is refused by `WebAuthn.check` with
 * `Rejection.HighS` — not normalised, refused. See `normaliseS`.
 */
export const P256_ORDER_HALF = P256_ORDER >> 1n;

/** The 13 bytes `WebAuthn.check` anchors the challenge comparison to. */
const CHALLENGE_KEY = '"challenge":"';

/** The 8 bytes `challengeIndex`'s sibling points at. */
const TYPE_KEY = '"type":"';

/** The only ceremony type this account accepts. W3C verification step 11. */
export const CEREMONY_TYPE_GET = 'webauthn.get';

const encoder = new TextEncoder();

/**
 * `WebAuthn.Assertion`, field for field.
 *
 * `authenticatorData` and `clientDataJSON` are kept as BYTES rather than as a
 * `Hex` or a `string`, deliberately. `clientDataJSON` is hashed whole on chain,
 * so the bytes that travel must be the bytes the browser produced — and a
 * JavaScript string is UTF-16, so any value that round-trips through one is a
 * value that has been re-encoded. It happens to be lossless for well-formed
 * UTF-8 and it is not lossless for anything else; `TextDecoder` replaces an
 * invalid sequence with U+FFFD, which changes `sha256(clientDataJSON)`, which
 * fails every signature check with no clue as to why. Bytes in, bytes out.
 */
export interface WebAuthnAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  challengeIndex: number;
  typeIndex: number;
  r: bigint;
  s: bigint;
}

export class AssertionEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionEncodingError';
  }
}

/**
 * The ABI shape of `WebAuthn.Assertion`.
 *
 * NOTE THE SECOND COMPONENT: `bytes`, where the Solidity struct says `string`.
 * That is not a mismatch, it is the point. The ABI encoding of `string` and of
 * `bytes` is byte-for-byte identical — both are a dynamic array of bytes with a
 * length word — so `abi.decode(signature, (WebAuthn.Assertion))` accepts this
 * encoding exactly as it accepts one produced from a Solidity `string`. What
 * declaring it as `bytes` buys is that viem never asks us for a JavaScript
 * string, so the UTF-16 round trip described on `WebAuthnAssertion` cannot
 * happen by accident later. The contract hashes the bytes; we send the bytes.
 */
export const ASSERTION_ABI_PARAMETERS = [
  {
    type: 'tuple',
    name: 'assertion',
    components: [
      { name: 'authenticatorData', type: 'bytes' },
      { name: 'clientDataJSON', type: 'bytes' },
      { name: 'challengeIndex', type: 'uint256' },
      { name: 'typeIndex', type: 'uint256' },
      { name: 'r', type: 'uint256' },
      { name: 's', type: 'uint256' },
    ],
  },
] as const;

/**
 * The WebAuthn `challenge` for a given operation: the `userOpHash`, base64url,
 * unpadded.
 *
 * `WebAuthn.check` rebuilds exactly this string on chain with its own assembly
 * encoder and compares 57 anchored bytes against `clientDataJSON`. Padding
 * would produce 44 characters and `ChallengeMismatch` on every single login.
 */
export function challengeFor(userOpHash: Bytes32): string {
  const bytes = hexToBytes(userOpHash);

  if (bytes.length !== 32) {
    throw new AssertionEncodingError(`a userOpHash is 32 bytes; this one is ${bytes.length}`);
  }

  return bytesToBase64Url(bytes);
}

/** First occurrence of `needle` in `haystack`, or -1. Bytes, never characters. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]!) continue outer;
    }
    return i;
  }

  return -1;
}

/**
 * Where a literal key begins inside `clientDataJSON`, as a BYTE offset.
 *
 * WHY NOT `json.indexOf(...)`, WHICH IS WHAT THE CONTRACT'S DOC SAYS. Because
 * the contract's doc is written for a reader who knows the difference and
 * JavaScript is not. `String.prototype.indexOf` returns an index into UTF-16
 * CODE UNITS; `WebAuthn._matchesAt` reads a BYTE offset into the UTF-8 payload.
 * They agree for as long as `clientDataJSON` is pure ASCII and diverge the
 * moment it is not — and `clientDataJSON` is JSON-serialised with
 * `JSON.stringify` semantics, which emit non-ASCII characters literally rather
 * than as `\uXXXX` escapes. An internationalised `origin`, a `topOrigin`, or
 * any field a future browser adds is enough. The offset would then point into
 * the middle of the document, the anchored comparison would fail, and the
 * failure would be `ChallengeMismatch` on some machines and not others.
 *
 * Searching the bytes is the same work and is right everywhere.
 *
 * @remarks The first occurrence is the real one. JSON cannot carry an
 *          unescaped `"` inside a string value, so the 13 bytes of
 *          `"challenge":"` cannot appear anywhere except as a genuine key —
 *          which is the same property `WebAuthn.check` relies on to make the
 *          anchored comparison unforgeable.
 */
function offsetOf(clientDataJSON: Uint8Array, key: string): number {
  const at = indexOfBytes(clientDataJSON, encoder.encode(key));

  if (at < 0) {
    throw new AssertionEncodingError(`clientDataJSON has no ${key} field`);
  }

  return at;
}

/**
 * `s` in the low half of the group, flipping it when the authenticator did not.
 *
 * THIS IS THE ONE THAT BREAKS HALF THE LOGINS IF IT IS MISSING, and it is
 * missing by default because no authenticator does it. ECDSA admits two valid
 * signatures for every message — `(r, s)` and `(r, n - s)` — and a secure
 * enclave returns whichever its nonce produced, so roughly half of real
 * assertions arrive with `s` above `n / 2`. `P256.verify` refuses those, on
 * purpose, so that a prescription's signature is a canonical identifier rather
 * than merely an authorisation; `WebAuthn.check` names the refusal
 * `Rejection.HighS` rather than letting it fall out as an anonymous `false`,
 * precisely so that a client which forgot this can be told.
 *
 * `n - s` is an equally valid signature over the same message by the same key.
 * Nothing is weakened and nothing is re-signed.
 */
export function normaliseS(s: bigint): bigint {
  return s > P256_ORDER_HALF ? P256_ORDER - s : s;
}

export interface AssertionParts {
  /** Exactly as the authenticator returned it. */
  authenticatorData: Uint8Array;
  /** Exactly as the browser returned it. Never re-serialised. */
  clientDataJSON: Uint8Array;
  /** `AuthenticatorAssertionResponse.signature`, ASN.1 DER. */
  signature: Uint8Array;
}

/** The raw ceremony output, as the six fields the contract decodes. */
export function buildAssertion(parts: AssertionParts): WebAuthnAssertion {
  const { r, s } = decodeEcdsaSignature(parts.signature);

  return {
    authenticatorData: parts.authenticatorData,
    clientDataJSON: parts.clientDataJSON,
    challengeIndex: offsetOf(parts.clientDataJSON, CHALLENGE_KEY),
    typeIndex: offsetOf(parts.clientDataJSON, TYPE_KEY),
    r,
    s: normaliseS(s),
  };
}

/** The envelope as it travels in `userOp.signature`. */
export function encodeAssertion(assertion: WebAuthnAssertion): Hex {
  return encodeAbiParameters(ASSERTION_ABI_PARAMETERS, [
    {
      authenticatorData: bytesToHex(assertion.authenticatorData),
      clientDataJSON: bytesToHex(assertion.clientDataJSON),
      challengeIndex: BigInt(assertion.challengeIndex),
      typeIndex: BigInt(assertion.typeIndex),
      r: assertion.r,
      s: assertion.s,
    },
  ]);
}

/**
 * The shape `@simplewebauthn/browser` returns from `startAuthentication`,
 * narrowed to the four fields this module reads.
 *
 * Declared here rather than imported so that every pure function in this file
 * can be tested, and reused by the relayer, without the library being present.
 */
export interface AuthenticationResponseParts {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** A ceremony result, decoded from base64url into the six contract fields. */
export function assertionFromResponse(response: AuthenticationResponseParts): WebAuthnAssertion {
  return buildAssertion({
    authenticatorData: base64UrlToBytes(response.authenticatorData),
    clientDataJSON: base64UrlToBytes(response.clientDataJSON),
    signature: base64UrlToBytes(response.signature),
  });
}
