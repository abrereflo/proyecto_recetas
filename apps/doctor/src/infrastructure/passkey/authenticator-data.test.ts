import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, bytesToHex, concatBytes, hexToBytes } from '@recetas/crypto';
import { CoseKeyError, decodeCoseP256PublicKey } from './cose';
import { AuthenticatorDataError, parseAuthenticatorData, readFlags } from './authenticator-data';
import { REAL_REGISTRATION } from '../../test/webauthn-vectors';

/**
 * `authenticatorData` and the COSE key inside it.
 *
 * The registration case is pinned against a real Firefox/Android attestation,
 * so the layout — AAGUID, a two-byte credential-id length, then a CBOR key — is
 * asserted against bytes an authenticator wrote. The flag cases are
 * constructed, because no published vector can be asked for a cleared User
 * Verified bit, and the flag values are copied from `WebAuthn.sol` rather than
 * from this module's own constants.
 */

const RP_ID_HASH = hexToBytes('49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763');

/** The COSE key of the real credential, lifted out of its real authData. */
const REAL_COSE_KEY = base64UrlToBytes(REAL_REGISTRATION.authenticatorData).slice(37 + 16 + 2 + 65);

function authenticatorData(flags: number, signCount = 1): Uint8Array {
  const tail = new Uint8Array(5);
  tail[0] = flags;
  new DataView(tail.buffer).setUint32(1, signCount, false);
  return concatBytes(RP_ID_HASH, tail);
}

describe('readFlags agrees with the bits WebAuthn.sol names', () => {
  it('reads 0x05 as User Present and User Verified — what a platform passkey emits', () => {
    expect(readFlags(0x05)).toEqual({
      userPresent: true,
      userVerified: true,
      backupEligible: false,
      backupState: false,
      attestedCredentialData: false,
      extensionData: false,
    });
  });

  it('reads 0x1d as a synced passkey: present, verified, eligible, backed up', () => {
    const flags = readFlags(0x1d);

    expect(flags.userVerified).toBe(true);
    expect(flags.backupEligible).toBe(true);
    expect(flags.backupState).toBe(true);
  });

  it('reads 0x15 as the contradiction WebAuthn.sol refuses: backed up, not eligible', () => {
    const flags = readFlags(0x15);

    expect(flags.backupEligible).toBe(false);
    expect(flags.backupState).toBe(true);
  });

  it('reads 0x01 as someone touched it and nothing more', () => {
    const flags = readFlags(0x01);

    expect(flags.userPresent).toBe(true);
    expect(flags.userVerified).toBe(false);
  });
});

describe('parseAuthenticatorData over an assertion-shaped 37 bytes', () => {
  it('reads the rpIdHash, the flags and the counter', () => {
    const parsed = parseAuthenticatorData(authenticatorData(0x05, 266));

    expect(bytesToHex(parsed.rpIdHash)).toBe(bytesToHex(RP_ID_HASH));
    expect(parsed.flags.userVerified).toBe(true);
    expect(parsed.signCount).toBe(266);
    expect(parsed.attestedCredentialData).toBeUndefined();
  });

  it('refuses fewer than 37 bytes rather than reading past the end', () => {
    expect(() => parseAuthenticatorData(new Uint8Array(36))).toThrow(AuthenticatorDataError);
  });

  it('reads a four-byte counter as unsigned big-endian', () => {
    expect(parseAuthenticatorData(authenticatorData(0x05, 0xffffffff)).signCount).toBe(4294967295);
  });
});

describe('parseAuthenticatorData over a real registration', () => {
  const parsed = parseAuthenticatorData(base64UrlToBytes(REAL_REGISTRATION.authenticatorData));

  it('sees the attested-credential-data bit and the user verification', () => {
    expect(parsed.raw).toBe(0x45);
    expect(parsed.flags.attestedCredentialData).toBe(true);
    expect(parsed.flags.userPresent).toBe(true);
    expect(parsed.flags.userVerified).toBe(true);
  });

  it('recovers the credential id the browser also reported as rawId', () => {
    const attested = parsed.attestedCredentialData;

    expect(attested).toBeDefined();
    expect(attested!.credentialId).toEqual(base64UrlToBytes(REAL_REGISTRATION.rawId));
    expect(attested!.aaguid).toHaveLength(16);
  });

  it('recovers the public key the credential was created with', () => {
    const key = parsed.attestedCredentialData!.publicKey;

    expect(`0x${key.x.toString(16).padStart(64, '0')}`).toBe(REAL_REGISTRATION.publicKeyX);
    expect(`0x${key.y.toString(16).padStart(64, '0')}`).toBe(REAL_REGISTRATION.publicKeyY);
  });

  it('refuses a credential-id length that overruns the buffer', () => {
    const bytes = Uint8Array.from(base64UrlToBytes(REAL_REGISTRATION.authenticatorData));
    new DataView(bytes.buffer).setUint16(37 + 16, 0xffff, false);

    expect(() => parseAuthenticatorData(bytes)).toThrow(/only \d+ remain/);
  });

  it('refuses a truncation that ends inside the AAGUID', () => {
    const bytes = base64UrlToBytes(REAL_REGISTRATION.authenticatorData).slice(0, 40);

    expect(() => parseAuthenticatorData(bytes)).toThrow(/ends inside the AAGUID/);
  });
});

describe('decodeCoseP256PublicKey', () => {
  it('reads a real COSE key and says where it ended', () => {
    const key = decodeCoseP256PublicKey(REAL_COSE_KEY);

    expect(`0x${key.x.toString(16).padStart(64, '0')}`).toBe(REAL_REGISTRATION.publicKeyX);
    expect(key.end).toBe(REAL_COSE_KEY.length);
  });

  it('finds a key that does not start at offset zero', () => {
    const padded = concatBytes(Uint8Array.from([0xaa, 0xbb]), REAL_COSE_KEY);
    const key = decodeCoseP256PublicKey(padded, 2);

    expect(key.x).toBe(BigInt(REAL_REGISTRATION.publicKeyX));
    expect(key.end).toBe(padded.length);
  });

  it('refuses a credential created for an algorithm this account cannot verify', () => {
    const bytes = Uint8Array.from(REAL_COSE_KEY);
    // `a5 01 02 03 26 ...` — byte 4 is the alg value. 0x38 0x18 would be -25,
    // but a single-byte change to 0x27 makes it -8, Ed25519.
    bytes[4] = 0x27;

    expect(() => decodeCoseP256PublicKey(bytes)).toThrow(/ES256/);
  });

  it('refuses a key type that is not a two-coordinate curve point', () => {
    const bytes = Uint8Array.from(REAL_COSE_KEY);
    bytes[2] = 0x03;

    expect(() => decodeCoseP256PublicKey(bytes)).toThrow(/unsupported COSE key type/);
  });

  it('refuses anything that is not a CBOR map', () => {
    expect(() => decodeCoseP256PublicKey(hexToBytes('01'))).toThrow(CoseKeyError);
  });
});
