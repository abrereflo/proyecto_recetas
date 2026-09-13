import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url, hexToBytes } from '@recetas/crypto';
import type { Bytes32 } from '@recetas/shared';
import { P256_ORDER } from './der';
import {
  AssertionEncodingError,
  assertionFromResponse,
  buildAssertion,
  challengeFor,
  encodeAssertion,
  normaliseS,
  P256_ORDER_HALF,
} from './assertion-envelope';
import {
  CHROME_ASSERTION,
  CHROME_ASSERTION_HIGH_S,
  CHROME_ASSERTION_HIGH_S_SIGNATURE,
  ESCAPED_SOLIDUS_CLIENT_DATA_JSON,
  REORDERED_CLIENT_DATA_JSON,
  REORDERED_CLIENT_DATA_JSON_TEXT,
  SAFARI_ASSERTION,
  SIGNATURE_BOTH_PADDED,
  SIGNATURE_SHORT_R_PADDED_S,
  VECTOR_CHALLENGE,
  VECTOR_CHALLENGE_B64URL,
} from '../../test/webauthn-vectors';

const encoder = new TextEncoder();

describe('challengeFor: the userOpHash as the browser must write it', () => {
  it('matches the base64url a real browser put in a real clientDataJSON', () => {
    // The right-hand side was written by Safari, not by this repository.
    expect(challengeFor(VECTOR_CHALLENGE)).toBe(VECTOR_CHALLENGE_B64URL);
  });

  it('is 43 characters and carries no padding', () => {
    const encoded = challengeFor(VECTOR_CHALLENGE);

    expect(encoded).toHaveLength(43);
    expect(encoded).not.toContain('=');
  });

  it('uses the URL-safe alphabet, never + or /', () => {
    // 0xfb… and 0xff… land on the characters that differ between alphabets.
    const encoded = challengeFor(`0x${'ff'.repeat(32)}` as Bytes32);

    expect(encoded).not.toMatch(/[+/]/);
    expect(encoded).toBe(`${'_'.repeat(42)}8`);
  });

  it('round-trips back to the same 32 bytes', () => {
    expect(base64UrlToBytes(challengeFor(VECTOR_CHALLENGE))).toEqual(hexToBytes(VECTOR_CHALLENGE));
  });

  it('refuses anything that is not 32 bytes', () => {
    expect(() => challengeFor('0xdeadbeef' as Bytes32)).toThrow(AssertionEncodingError);
  });
});

describe('normaliseS: the flip authenticators do not do for you', () => {
  it('leaves a value already in the low half alone', () => {
    expect(normaliseS(CHROME_ASSERTION.s)).toBe(CHROME_ASSERTION.s);
    expect(normaliseS(1n)).toBe(1n);
    expect(normaliseS(P256_ORDER_HALF)).toBe(P256_ORDER_HALF);
  });

  it('flips the twin of a real signature back to the published value', () => {
    expect(normaliseS(CHROME_ASSERTION_HIGH_S)).toBe(CHROME_ASSERTION.s);
  });

  it('flips a value one above the half, which is the boundary the contract tests', () => {
    expect(normaliseS(P256_ORDER_HALF + 1n)).toBe(P256_ORDER - (P256_ORDER_HALF + 1n));
  });

  it('always lands in the low half', () => {
    for (const s of [
      SIGNATURE_SHORT_R_PADDED_S.s,
      SIGNATURE_BOTH_PADDED.s,
      CHROME_ASSERTION_HIGH_S,
      P256_ORDER - 1n,
    ]) {
      expect(normaliseS(s)).toBeLessThanOrEqual(P256_ORDER_HALF);
    }
  });

  it('is an involution on the low half: flipping a flipped value returns it', () => {
    expect(normaliseS(normaliseS(CHROME_ASSERTION_HIGH_S))).toBe(CHROME_ASSERTION.s);
  });

  it('agrees with the published normalisation of two real signatures', () => {
    expect(normaliseS(SIGNATURE_SHORT_R_PADDED_S.s)).toBe(SIGNATURE_SHORT_R_PADDED_S.normalisedS);
    expect(normaliseS(SIGNATURE_BOTH_PADDED.s)).toBe(SIGNATURE_BOTH_PADDED.normalisedS);
  });
});

describe('buildAssertion locates the fields the contract will compare', () => {
  it('finds the offsets a real Chrome document has', () => {
    const assertion = assertionFromResponse(CHROME_ASSERTION);

    expect(assertion.challengeIndex).toBe(CHROME_ASSERTION.challengeIndex);
    expect(assertion.typeIndex).toBe(CHROME_ASSERTION.typeIndex);
  });

  it('finds them in a document that puts challenge first and type last', () => {
    // A real legacy Firefox document. `typeIndex` is 136 here and 1 everywhere
    // else, so any client that hard-coded the modern layout breaks on it.
    const assertion = buildAssertion({
      authenticatorData: base64UrlToBytes(SAFARI_ASSERTION.authenticatorData),
      clientDataJSON: base64UrlToBytes(REORDERED_CLIENT_DATA_JSON),
      signature: base64UrlToBytes(SAFARI_ASSERTION.signature),
    });

    expect(assertion.challengeIndex).toBe(REORDERED_CLIENT_DATA_JSON_TEXT.indexOf('"challenge":"'));
    expect(assertion.typeIndex).toBe(REORDERED_CLIENT_DATA_JSON_TEXT.indexOf('"type":"'));
    expect(assertion.typeIndex).toBe(136);
  });

  it('counts BYTES, not JavaScript characters', () => {
    // A non-ASCII origin before the challenge. `String.prototype.indexOf`
    // counts UTF-16 code units; `WebAuthn._matchesAt` reads a BYTE offset into
    // the UTF-8 payload. Two accented characters are enough to separate them,
    // and an origin is the one field of this document an attacker influences.
    const text = '{"origin":"https://recetas.exámple.árbol","type":"webauthn.get","challenge":"x"}';
    const bytes = encoder.encode(text);

    const assertion = buildAssertion({
      authenticatorData: base64UrlToBytes(SAFARI_ASSERTION.authenticatorData),
      clientDataJSON: bytes,
      signature: base64UrlToBytes(SAFARI_ASSERTION.signature),
    });

    expect(text.indexOf('"challenge":"')).not.toBe(assertion.challengeIndex);
    expect(bytes.subarray(assertion.challengeIndex, assertion.challengeIndex + 13)).toEqual(
      encoder.encode('"challenge":"'),
    );
    expect(bytes.subarray(assertion.typeIndex, assertion.typeIndex + 8)).toEqual(
      encoder.encode('"type":"'),
    );
  });

  it('normalises s while building, so the caller cannot forget', () => {
    const assertion = buildAssertion({
      authenticatorData: base64UrlToBytes(CHROME_ASSERTION.authenticatorData),
      clientDataJSON: base64UrlToBytes(CHROME_ASSERTION.clientDataJSON),
      signature: base64UrlToBytes(CHROME_ASSERTION_HIGH_S_SIGNATURE),
    });

    expect(assertion.s).toBe(CHROME_ASSERTION.s);
    expect(assertion.r).toBe(CHROME_ASSERTION.r);
  });

  it('refuses a document with no challenge field rather than guessing an offset', () => {
    expect(() =>
      buildAssertion({
        authenticatorData: base64UrlToBytes(SAFARI_ASSERTION.authenticatorData),
        clientDataJSON: encoder.encode('{"type":"webauthn.get"}'),
        signature: base64UrlToBytes(SAFARI_ASSERTION.signature),
      }),
    ).toThrow(/no "challenge":" field/);
  });

  it('refuses a document with no type field', () => {
    expect(() =>
      buildAssertion({
        authenticatorData: base64UrlToBytes(SAFARI_ASSERTION.authenticatorData),
        clientDataJSON: encoder.encode('{"challenge":"x"}'),
        signature: base64UrlToBytes(SAFARI_ASSERTION.signature),
      }),
    ).toThrow(/no "type":" field/);
  });

  it('keeps clientDataJSON byte-identical, escapes and all', () => {
    // A real Firefox document that escapes its solidus — `https:\/\/dev.dontneeda.pw`
    // — which is legal JSON and which `JSON.parse` followed by `JSON.stringify`
    // would silently drop. Those two backslashes are inside the bytes the
    // authenticator hashed, so losing them changes `sha256(clientDataJSON)` and
    // fails a signature that was never wrong.
    const bytes = base64UrlToBytes(ESCAPED_SOLIDUS_CLIENT_DATA_JSON);

    const assertion = buildAssertion({
      authenticatorData: base64UrlToBytes(SAFARI_ASSERTION.authenticatorData),
      clientDataJSON: bytes,
      signature: base64UrlToBytes(SAFARI_ASSERTION.signature),
    });

    expect(assertion.clientDataJSON).toEqual(bytes);
    expect(bytesToBase64Url(assertion.clientDataJSON)).toBe(ESCAPED_SOLIDUS_CLIENT_DATA_JSON);

    // What a tidy-minded client would have sent instead, and why it must not.
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('https:\\/\\/dev.dontneeda.pw');
    expect(JSON.stringify(JSON.parse(text))).not.toBe(text);
  });
});

describe('encodeAssertion', () => {
  it('produces a blob whose length is a whole number of 32-byte words plus nothing', () => {
    const encoded = encodeAssertion(assertionFromResponse(SAFARI_ASSERTION));

    expect((encoded.length - 2) % 64).toBe(0);
  });

  it('changes when one byte of clientDataJSON changes', () => {
    const assertion = assertionFromResponse(SAFARI_ASSERTION);
    const tampered = { ...assertion, clientDataJSON: Uint8Array.from(assertion.clientDataJSON) };
    tampered.clientDataJSON[100] = tampered.clientDataJSON[100]! ^ 0x01;

    expect(encodeAssertion(tampered)).not.toBe(encodeAssertion(assertion));
  });

  it('refuses nothing itself: an out-of-range index is the contract’s to reject', () => {
    // The client should never produce this, but if it did, the envelope must
    // still encode — `WebAuthn._matchesAt` bounds-checks the offset into a
    // `false`, and a throw here would hide that behaviour behind a client bug.
    const assertion = { ...assertionFromResponse(SAFARI_ASSERTION), challengeIndex: 9999 };

    expect(encodeAssertion(assertion)).toMatch(/^0x[0-9a-f]+$/);
  });
});
