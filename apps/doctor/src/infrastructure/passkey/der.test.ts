import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, hexToBytes } from '@recetas/crypto';
import {
  DerFormatError,
  decodeEcdsaSignature,
  decodeSpkiP256PublicKey,
  P256_ORDER,
} from './der';
import {
  REAL_REGISTRATION,
  REAL_REGISTRATION_SPKI,
  SIGNATURE_BOTH_PADDED,
  SIGNATURE_PADDED_R_SHORT_S,
  SIGNATURE_SHORT_R_PADDED_S,
} from '../../test/webauthn-vectors';

/**
 * The DER decoders, pinned against signatures browsers actually produced.
 *
 * THE CASE THIS FILE IS REALLY ABOUT is the leading zero. A DER INTEGER is
 * signed, so a 32-byte value whose top bit is set gains a 0x00 byte — and
 * because `r` and `s` are independent, all four combinations occur in the wild
 * at roughly 25% each. The three published signatures below cover three of
 * them; the fourth (both short, 70 bytes) is covered by the Coinbase vectors in
 * `webauthn-envelope-vectors.test.ts`.
 */

const rebuild = (r: bigint, s: bigint): Uint8Array => {
  const integer = (value: bigint): number[] => {
    let hex = value.toString(16);
    if (hex.length % 2 === 1) hex = `0${hex}`;
    const bytes = [...hexToBytes(hex)];
    if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0x00);
    return [0x02, bytes.length, ...bytes];
  };

  const body = [...integer(r), ...integer(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
};

describe('decodeEcdsaSignature over real browser signatures', () => {
  it.each([
    ['32-byte r, padded 33-byte s', SIGNATURE_SHORT_R_PADDED_S],
    ['padded r and padded s', SIGNATURE_BOTH_PADDED],
    ['padded 33-byte r, 32-byte s', SIGNATURE_PADDED_R_SHORT_S],
  ])('reads %s', (_label, vector) => {
    const der = base64UrlToBytes(vector.signature);

    expect(der.length).toBe(vector.length);
    expect(decodeEcdsaSignature(der)).toEqual({ r: vector.r, s: vector.s });
  });

  it('produces different lengths for the same curve, which is the whole point', () => {
    const lengths = [
      SIGNATURE_SHORT_R_PADDED_S,
      SIGNATURE_BOTH_PADDED,
      SIGNATURE_PADDED_R_SHORT_S,
    ].map((vector) => base64UrlToBytes(vector.signature).length);

    // A reader that sliced at fixed offsets would be right for one of these.
    expect(new Set(lengths).size).toBeGreaterThan(1);
  });

  it('round-trips a value re-encoded from its own integers', () => {
    const { r, s } = SIGNATURE_BOTH_PADDED;

    expect(decodeEcdsaSignature(rebuild(r, s))).toEqual({ r, s });
  });
});

describe('decodeEcdsaSignature refuses what it cannot be sure about', () => {
  const valid = base64UrlToBytes(SIGNATURE_SHORT_R_PADDED_S.signature);

  it('refuses a structure that is not a SEQUENCE', () => {
    const wrong = Uint8Array.from(valid);
    wrong[0] = 0x31;

    expect(() => decodeEcdsaSignature(wrong)).toThrow(DerFormatError);
  });

  it('refuses a SEQUENCE whose declared length disagrees with the buffer', () => {
    const short = Uint8Array.from(valid);
    short[1] = short[1]! - 1;

    expect(() => decodeEcdsaSignature(short)).toThrow(/declares 68 bytes but 69 follow/);
  });

  it('refuses a trailing byte after s', () => {
    const extra = Uint8Array.from([...valid, 0x00]);
    extra[1] = extra[1]! + 1;

    expect(() => decodeEcdsaSignature(extra)).toThrow(/unexpected byte/);
  });

  it('refuses a second field that is not an INTEGER', () => {
    const wrong = Uint8Array.from(valid);
    // r is 32 bytes: 0x30 0x45 0x02 0x20 <32 bytes> then s's tag.
    wrong[2 + 2 + 32] = 0x04;

    expect(() => decodeEcdsaSignature(wrong)).toThrow(/expected an INTEGER/);
  });

  it('refuses a gratuitous leading zero, because it is a second encoding of one value', () => {
    // 0x0001... — the pad is not needed because 0x01 has its top bit clear.
    const body = [0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01];
    const nonMinimal = Uint8Array.from([0x30, body.length, ...body]);

    expect(() => decodeEcdsaSignature(nonMinimal)).toThrow(/non-minimal/);
  });

  it('refuses a negative INTEGER', () => {
    // 0x80... with no pad is a negative two's-complement value.
    const body = [0x02, 0x01, 0x80, 0x02, 0x01, 0x01];
    const negative = Uint8Array.from([0x30, body.length, ...body]);

    expect(() => decodeEcdsaSignature(negative)).toThrow(/negative/);
  });

  it('refuses a scalar at or above the group order', () => {
    expect(() => decodeEcdsaSignature(rebuild(P256_ORDER, 1n))).toThrow(/outside \[1, n-1\]/);
    expect(() => decodeEcdsaSignature(rebuild(1n, P256_ORDER + 5n))).toThrow(/outside \[1, n-1\]/);
  });

  it('refuses a zero scalar', () => {
    const body = [0x02, 0x01, 0x00, 0x02, 0x01, 0x01];

    expect(() => decodeEcdsaSignature(Uint8Array.from([0x30, body.length, ...body]))).toThrow(
      /outside \[1, n-1\]/,
    );
  });

  it('refuses an empty buffer rather than reading past it', () => {
    expect(() => decodeEcdsaSignature(new Uint8Array())).toThrow(DerFormatError);
  });

  it('refuses a long-form length, which a P-256 signature never needs', () => {
    const inner = [...base64UrlToBytes(SIGNATURE_SHORT_R_PADDED_S.signature).subarray(2)];
    const longForm = Uint8Array.from([0x30, 0x81, inner.length, ...inner]);

    expect(() => decodeEcdsaSignature(longForm)).toThrow(/not a short form/);
  });
});

describe('decodeSpkiP256PublicKey', () => {
  it('reads the key a real browser reported for a real credential', () => {
    const key = decodeSpkiP256PublicKey(base64UrlToBytes(REAL_REGISTRATION_SPKI));

    expect(`0x${key.x.toString(16).padStart(64, '0')}`).toBe(REAL_REGISTRATION.publicKeyX);
    expect(`0x${key.y.toString(16).padStart(64, '0')}`).toBe(REAL_REGISTRATION.publicKeyY);
  });

  it('refuses a key of the wrong length', () => {
    const spki = base64UrlToBytes(REAL_REGISTRATION_SPKI);

    expect(() => decodeSpkiP256PublicKey(spki.subarray(0, 90))).toThrow(/is 90/);
  });

  it('refuses a curve that is not P-256', () => {
    const spki = Uint8Array.from(base64UrlToBytes(REAL_REGISTRATION_SPKI));
    // Last byte of the prime256v1 OID: 0x07 identifies the curve.
    spki[22] = 0x22;

    expect(() => decodeSpkiP256PublicKey(spki)).toThrow(/not an uncompressed P-256 key/);
  });

  it('refuses a compressed point, which carries only half the key', () => {
    const spki = Uint8Array.from(base64UrlToBytes(REAL_REGISTRATION_SPKI));
    spki[26] = 0x02;

    expect(() => decodeSpkiP256PublicKey(spki)).toThrow(/only uncompressed/);
  });
});
