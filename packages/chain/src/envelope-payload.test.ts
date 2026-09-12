import { describe, expect, it } from 'vitest';
import { bytesToBase64, utf8ToBytes } from '@recetas/crypto';
import type { EncryptedDocument } from '@recetas/shared';
import { decodeStoredPayload, encodeStoredPayload } from './envelope-payload';

/**
 * The encoder and the decoder are two halves of one wire format, and they used
 * to live in different applications. A round trip is the assertion that keeps
 * them from drifting apart again.
 */

const ENVELOPE: EncryptedDocument = {
  schemaVersion: '1.0.0',
  documentType: 'Prescription',
  createdAt: '2026-09-11T13:42:00.000Z',
  encryption: {
    algorithm: 'AES-256-GCM',
    iv: 'AAECAwQFBgcICQoL',
    authTag: 'DQ4PEBESExQVFhcYGRobHA==',
  },
  signatures: {
    eip712: {
      signer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      value: '0xdeadbeef',
    },
  },
  ciphertext: 'c2VhbGVkLXByZXNjcmlwdGlvbi1ieXRlcw==',
};

describe('round trip', () => {
  it('decodes back to exactly what was encoded', () => {
    expect(decodeStoredPayload(encodeStoredPayload(ENVELOPE))).toEqual(ENVELOPE);
  });

  it('keeps the optional ADSIB signature block through the round trip', () => {
    const withAdsib: EncryptedDocument = {
      ...ENVELOPE,
      signatures: {
        ...ENVELOPE.signatures,
        adsib: {
          certificateSerial: '1234567890',
          value: 'cGtjczctZGV0YWNoZWQ=',
          status: 'pending-integration',
        },
      },
    };

    expect(decodeStoredPayload(encodeStoredPayload(withAdsib))).toEqual(withAdsib);
  });

  // The API's `ciphertext` field is base64 of the envelope's JSON, NOT the
  // inner AES ciphertext. Pinning the encoding keeps a stored row written by
  // one consumer readable by another (docs/03).
  it('encodes as base64 of the envelope JSON', () => {
    expect(encodeStoredPayload(ENVELOPE)).toBe(
      bytesToBase64(utf8ToBytes(JSON.stringify(ENVELOPE))),
    );
  });

  it('leaves the inner ciphertext byte-identical, since contentHash covers it', () => {
    expect(decodeStoredPayload(encodeStoredPayload(ENVELOPE)).ciphertext).toBe(
      ENVELOPE.ciphertext,
    );
  });
});

describe('malformed input', () => {
  it.each([
    ['not base64 of anything parseable', 'not-base64-json'],
    ['base64 of something that is not JSON', bytesToBase64(utf8ToBytes('plain text'))],
    ['base64 of JSON that is not an envelope', bytesToBase64(utf8ToBytes('{"hello":"world"}'))],
    ['an empty string', ''],
  ])('throws on %s', (_label, payload) => {
    expect(() => decodeStoredPayload(payload)).toThrow();
  });

  it('rejects an envelope with a field of the wrong shape', () => {
    const broken = bytesToBase64(
      utf8ToBytes(JSON.stringify({ ...ENVELOPE, createdAt: 'not-a-timestamp' })),
    );

    expect(() => decodeStoredPayload(broken)).toThrow();
  });
});
