import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url } from '@recetas/crypto';
import {
  credentialIdBytes,
  publicKeyFromRegistration,
  publicKeyToHex,
  RegistrationError,
  type RegistrationResponseParts,
} from './registration';
import { REAL_REGISTRATION, REAL_REGISTRATION_SPKI } from '../../test/webauthn-vectors';

/**
 * Reading the owner out of an enrolment.
 *
 * The happy paths all run against ONE real registration, deliberately: the
 * point of this module is that four different ways of asking for the same key
 * — the attestation object, `getAuthenticatorData()`, `getPublicKey()` and the
 * combination of them — all produce the same 64 bytes, and only a real
 * ceremony can make that a meaningful statement.
 */

function response(overrides: Partial<RegistrationResponseParts['response']> = {}): RegistrationResponseParts {
  return {
    rawId: REAL_REGISTRATION.rawId,
    response: {
      attestationObject: REAL_REGISTRATION.attestationObject,
      clientDataJSON: REAL_REGISTRATION.clientDataJSON,
      ...overrides,
    },
  };
}

describe('publicKeyFromRegistration reads the same key whichever way it is asked', () => {
  it('from the attestation object alone — the only field every browser sets', () => {
    const credential = publicKeyFromRegistration(response());

    expect(credential.publicKeyX).toBe(REAL_REGISTRATION.publicKeyX);
    expect(credential.publicKeyY).toBe(REAL_REGISTRATION.publicKeyY);
    expect(credential.credentialId).toBe(REAL_REGISTRATION.rawId);
  });

  it('from getAuthenticatorData(), skipping CBOR at the outer level', () => {
    const credential = publicKeyFromRegistration(
      response({ authenticatorData: REAL_REGISTRATION.authenticatorData }),
    );

    expect(credential.publicKeyX).toBe(REAL_REGISTRATION.publicKeyX);
  });

  it('cross-checked against the DER key getPublicKey() returns', () => {
    const credential = publicKeyFromRegistration(
      response({
        authenticatorData: REAL_REGISTRATION.authenticatorData,
        publicKey: REAL_REGISTRATION_SPKI,
        publicKeyAlgorithm: -7,
      }),
    );

    expect(credential.publicKeyX).toBe(REAL_REGISTRATION.publicKeyX);
    expect(credential.publicKeyY).toBe(REAL_REGISTRATION.publicKeyY);
  });

  it('reports whether the credential can be synced', () => {
    // Flags 0x45: present, verified, attested. Backup Eligible is not set.
    expect(publicKeyFromRegistration(response()).backupEligible).toBe(false);
  });
});

describe('publicKeyFromRegistration refuses an enrolment that would be permanent and wrong', () => {
  it('refuses an algorithm this account cannot verify, before any address is committed to', () => {
    expect(() => publicKeyFromRegistration(response({ publicKeyAlgorithm: -257 }))).toThrow(
      /ES256/,
    );
  });

  it('refuses two sources that disagree, rather than picking one', () => {
    // One bit of the DER key flipped. In practice this means a passkey provider
    // intercepted the call and answered for a different credential.
    const spki = Uint8Array.from(base64UrlToBytes(REAL_REGISTRATION_SPKI));
    spki[40] = spki[40]! ^ 0x01;

    expect(() =>
      publicKeyFromRegistration(response({ publicKey: bytesToBase64Url(spki) })),
    ).toThrow(/refusing to guess/);
  });

  it('refuses a ceremony whose authenticator did not verify the user', () => {
    // Clear the User Verified bit: flags 0x45 becomes 0x41.
    const authData = Uint8Array.from(base64UrlToBytes(REAL_REGISTRATION.authenticatorData));
    authData[32] = 0x41;

    expect(() =>
      publicKeyFromRegistration(response({ authenticatorData: bytesToBase64Url(authData) })),
    ).toThrow(/User Verified/);
  });

  it('refuses a ceremony that carried no attested credential data', () => {
    const authData = Uint8Array.from(base64UrlToBytes(REAL_REGISTRATION.authenticatorData));
    // Clear the Attested Credential Data bit: 0x45 becomes 0x05.
    authData[32] = 0x05;

    expect(() =>
      publicKeyFromRegistration(response({ authenticatorData: bytesToBase64Url(authData) })),
    ).toThrow(/no attested credential data/);
  });

  it('refuses an attestation object with no authData', () => {
    // `{"fmt":"none"}` in CBOR.
    const attestationObject = bytesToBase64Url(
      Uint8Array.from([0xa1, 0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65]),
    );

    expect(() => publicKeyFromRegistration(response({ attestationObject }))).toThrow(
      RegistrationError,
    );
  });
});

describe('the helpers the factory and a later ceremony need', () => {
  it('pads both coordinates to 32 bytes, so a small X never shortens the commitment', () => {
    expect(publicKeyToHex({ x: 1n, y: 2n })).toEqual({
      x: `0x${'0'.repeat(63)}1`,
      y: `0x${'0'.repeat(63)}2`,
    });
  });

  it('turns the credential id back into the bytes it was', () => {
    const credential = publicKeyFromRegistration(response());

    expect(credentialIdBytes(credential)).toBe(
      `0x${Buffer.from(base64UrlToBytes(REAL_REGISTRATION.rawId)).toString('hex')}`,
    );
  });
});
