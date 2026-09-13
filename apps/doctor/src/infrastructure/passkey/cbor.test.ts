import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, hexToBytes } from '@recetas/crypto';
import { CborFormatError, decodeCbor, decodeCborItem } from './cbor';
import { REAL_REGISTRATION } from '../../test/webauthn-vectors';

/**
 * The CBOR subset, against RFC 8949's own appendix A examples and against a
 * real attestation object.
 *
 * The examples are quoted from the specification rather than produced by an
 * encoder in this repository, which is the only way a decoder test means
 * anything: a decoder and its own encoder will agree on any misunderstanding
 * they happen to share.
 */

const cbor = (hex: string): Uint8Array => hexToBytes(hex);

describe('the integers and strings a COSE key is made of', () => {
  // RFC 8949 appendix A.
  it.each([
    ['00', 0],
    ['01', 1],
    ['17', 23],
    ['1818', 24],
    ['1903e8', 1000],
    ['1a000f4240', 1_000_000],
    ['20', -1],
    ['26', -7],
    ['3863', -100],
  ])('decodes %s', (hex, expected) => {
    expect(decodeCbor(cbor(hex))).toBe(expected);
  });

  it('decodes a byte string', () => {
    expect(decodeCbor(cbor('4401020304'))).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('decodes a text string', () => {
    expect(decodeCbor(cbor('6449455446'))).toBe('IETF');
  });

  it('decodes an empty map and an empty array', () => {
    expect(decodeCbor(cbor('a0'))).toEqual(new Map());
    expect(decodeCbor(cbor('80'))).toEqual([]);
  });

  it('decodes a nested map keyed by small integers, which is what COSE is', () => {
    // {1: 2, 3: -7}
    expect(decodeCbor(cbor('a201020326'))).toEqual(
      new Map<unknown, unknown>([
        [1, 2],
        [3, -7],
      ]),
    );
  });

  it('reports where an item ended, so the caller can read what follows it', () => {
    // A one-byte item followed by two bytes nobody asked about.
    expect(decodeCborItem(cbor('01ffff'), 0)).toEqual({ value: 1, end: 1 });
  });
});

describe('what the decoder refuses', () => {
  it('refuses indefinite-length items', () => {
    // 0x5f: byte string of indefinite length.
    expect(() => decodeCbor(cbor('5f42010243030405ff'))).toThrow(/indefinite-length/);
  });

  it('refuses tags', () => {
    // 0xc0: tag 0, a standard date-time string.
    expect(() => decodeCbor(cbor('c06161'))).toThrow(/major type 6/);
  });

  it('refuses floats', () => {
    // 0xf9 0x3c00: half-precision 1.0.
    expect(() => decodeCbor(cbor('f93c00'))).toThrow(/unsupported simple value/);
  });

  it('refuses a string that runs past the end of the buffer', () => {
    expect(() => decodeCbor(cbor('440102'))).toThrow(/only 2 remain/);
  });

  it('refuses trailing bytes after a complete item', () => {
    expect(() => decodeCbor(cbor('01ff'))).toThrow(/unexpected byte/);
  });

  it('refuses a map that repeats a key', () => {
    // {1: 2, 1: 3} — invalid CBOR, and a way to make two readers disagree.
    expect(() => decodeCbor(cbor('a201020103'))).toThrow(/repeats the key/);
  });

  it('refuses an empty buffer', () => {
    expect(() => decodeCbor(new Uint8Array())).toThrow(CborFormatError);
  });
});

describe('a real attestation object', () => {
  const decoded = decodeCbor(base64UrlToBytes(REAL_REGISTRATION.attestationObject));

  it('is a three-key map of fmt, attStmt and authData', () => {
    expect(decoded).toBeInstanceOf(Map);
    expect([...(decoded as Map<unknown, unknown>).keys()]).toEqual(['fmt', 'attStmt', 'authData']);
  });

  it('carries the authenticator data the browser would also have exposed directly', () => {
    const authData = (decoded as Map<unknown, unknown>).get('authData');

    expect(authData).toBeInstanceOf(Uint8Array);
    expect(authData).toEqual(base64UrlToBytes(REAL_REGISTRATION.authenticatorData));
  });

  it('declares no attestation statement, which is what was asked for', () => {
    expect((decoded as Map<unknown, unknown>).get('fmt')).toBe('none');
    expect((decoded as Map<unknown, unknown>).get('attStmt')).toEqual(new Map());
  });
});
