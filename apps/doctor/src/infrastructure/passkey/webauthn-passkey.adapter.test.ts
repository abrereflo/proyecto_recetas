import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url } from '@recetas/crypto';
import {
  PasskeyAssertionRefusedError,
  PasskeyRejectedError,
  PasskeyUnavailableError,
} from '../../ports/passkey.port';
import { createWebAuthnPasskey } from './webauthn-passkey.adapter';
import { challengeFor } from './assertion-envelope';
import {
  CHROME_ASSERTION,
  CHROME_ASSERTION_HIGH_S_SIGNATURE,
  REAL_REGISTRATION,
  REAL_REGISTRATION_SPKI,
  SAFARI_ASSERTION,
  VECTOR_CHALLENGE,
} from '../../test/webauthn-vectors';

/**
 * The adapter, driven through a mocked `navigator.credentials`.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT. jsdom has no WebAuthn and no secure
 * enclave, so nothing here signs anything: `navigator.credentials.get` is a
 * function that returns bytes a real authenticator produced earlier. That is
 * enough to prove FOUR things, all of which are this adapter's job —
 *
 *   - the options it asks for, `userVerification: 'required'` and ES256 alone,
 *     because those are what make the credential usable by `WebAuthn.check`;
 *   - that the `challenge` it sends is the base64url of the `userOpHash` and
 *     nothing else;
 *   - that a real ceremony's output reaches `encodeAssertion` unaltered, having
 *     gone through the library's own ArrayBuffer-to-base64url conversion rather
 *     than through a shortcut this test invented;
 *   - that a declined prompt, and an assertion the account would refuse, come
 *     back as the two named errors rather than as something generic.
 *
 * — and it proves NOTHING about the parts that need real hardware: that an
 * authenticator honours `userVerification: 'required'`, that the platform
 * prompt appears, that a synced passkey behaves the same on a second device, or
 * that `s` really does land in the upper half about half the time. Those are
 * findings a device makes, not a test. The `webauthn-envelope-vectors` suite is
 * what stands in for them, because its inputs came from real enclaves.
 */

interface CeremonyCall {
  publicKey: {
    challenge: ArrayBuffer;
    pubKeyCredParams?: { alg: number; type: string }[];
    authenticatorSelection?: { userVerification?: string; residentKey?: string };
    userVerification?: string;
    allowCredentials?: { id: ArrayBuffer; type: string }[];
    attestation?: string;
    rp?: { name: string; id?: string };
    timeout?: number;
  };
}

const buffer = (base64url: string): ArrayBuffer => base64UrlToBytes(base64url).buffer as ArrayBuffer;

function registrationCredential(overrides: { publicKey?: string | null } = {}) {
  return {
    id: REAL_REGISTRATION.rawId,
    rawId: buffer(REAL_REGISTRATION.rawId),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      attestationObject: buffer(REAL_REGISTRATION.attestationObject),
      clientDataJSON: buffer(REAL_REGISTRATION.clientDataJSON),
      getTransports: () => ['internal'],
      getPublicKeyAlgorithm: () => -7,
      getPublicKey: () =>
        overrides.publicKey === null ? null : buffer(overrides.publicKey ?? REAL_REGISTRATION_SPKI),
      getAuthenticatorData: () => buffer(REAL_REGISTRATION.authenticatorData),
    },
    getClientExtensionResults: () => ({}),
  };
}

function assertionCredential(
  vector: { authenticatorData: string; clientDataJSON: string; signature: string },
  rawId = REAL_REGISTRATION.rawId,
) {
  return {
    id: rawId,
    rawId: buffer(rawId),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      authenticatorData: buffer(vector.authenticatorData),
      clientDataJSON: buffer(vector.clientDataJSON),
      signature: buffer(vector.signature),
      userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  };
}

const create = vi.fn();
const get = vi.fn();

function installWebAuthn(): void {
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    value: class {
      static isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> {
        return Promise.resolve(true);
      }
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: { create, get },
    configurable: true,
    writable: true,
  });
}

function uninstallWebAuthn(): void {
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  create.mockReset();
  get.mockReset();
  installWebAuthn();
});

afterEach(() => {
  uninstallWebAuthn();
});

const REGISTER_INPUT = {
  userId: bytesToBase64Url(Uint8Array.from([1, 2, 3, 4])),
  userName: 'dra.quispe',
  userDisplayName: 'Dra. Quispe',
  serviceName: 'Recetas',
};

describe('availability', () => {
  it('is available when the browser exposes WebAuthn', () => {
    expect(createWebAuthnPasskey().isAvailable()).toBe(true);
  });

  it('is unavailable when it does not, and refuses to start a ceremony', async () => {
    uninstallWebAuthn();
    const passkey = createWebAuthnPasskey();

    expect(passkey.isAvailable()).toBe(false);
    expect(await passkey.hasVerifyingAuthenticator()).toBe(false);
    await expect(passkey.register(REGISTER_INPUT)).rejects.toBeInstanceOf(PasskeyUnavailableError);
  });

  it('reports whether the device can verify who is present', async () => {
    expect(await createWebAuthnPasskey().hasVerifyingAuthenticator()).toBe(true);
  });
});

describe('register', () => {
  it('asks for ES256 alone and for user verification, not user presence', async () => {
    create.mockResolvedValue(registrationCredential());

    await createWebAuthnPasskey().register(REGISTER_INPUT);

    const { publicKey } = create.mock.calls[0]![0] as CeremonyCall;

    expect(publicKey.pubKeyCredParams).toEqual([{ alg: -7, type: 'public-key' }]);
    expect(publicKey.authenticatorSelection?.userVerification).toBe('required');
    expect(publicKey.attestation).toBe('none');
    expect(publicKey.rp).toEqual({ name: 'Recetas' });
  });

  it('sends a fresh 32-byte challenge every time', async () => {
    create.mockResolvedValue(registrationCredential());
    const passkey = createWebAuthnPasskey();

    await passkey.register(REGISTER_INPUT);
    await passkey.register(REGISTER_INPUT);

    const challenges = create.mock.calls.map(
      (call) => new Uint8Array((call[0] as CeremonyCall).publicKey.challenge),
    );

    expect(challenges[0]).toHaveLength(32);
    expect(bytesToBase64Url(challenges[0]!)).not.toBe(bytesToBase64Url(challenges[1]!));
  });

  it('returns the key the account will be built from', async () => {
    create.mockResolvedValue(registrationCredential());

    const credential = await createWebAuthnPasskey().register(REGISTER_INPUT);

    expect(credential).toEqual({
      credentialId: REAL_REGISTRATION.rawId,
      publicKeyX: REAL_REGISTRATION.publicKeyX,
      publicKeyY: REAL_REGISTRATION.publicKeyY,
      backupEligible: false,
    });
  });

  it('works on a browser that does not implement getPublicKey()', async () => {
    create.mockResolvedValue(registrationCredential({ publicKey: null }));

    const credential = await createWebAuthnPasskey().register(REGISTER_INPUT);

    expect(credential.publicKeyX).toBe(REAL_REGISTRATION.publicKeyX);
  });

  it('reports a declined prompt as a decision, not a failure', async () => {
    const declined = new Error('The operation either timed out or was not allowed');
    declined.name = 'NotAllowedError';
    create.mockRejectedValue(declined);

    await expect(createWebAuthnPasskey().register(REGISTER_INPUT)).rejects.toBeInstanceOf(
      PasskeyRejectedError,
    );
  });

  it('passes an rpId through when one is given', async () => {
    create.mockResolvedValue(registrationCredential());

    await createWebAuthnPasskey().register({ ...REGISTER_INPUT, rpId: 'recetas.example' });

    const { publicKey } = create.mock.calls[0]![0] as CeremonyCall;
    expect(publicKey.rp).toEqual({ name: 'Recetas', id: 'recetas.example' });
  });
});

describe('authorize', () => {
  it('sends the userOpHash as the challenge, base64url and unpadded', async () => {
    get.mockResolvedValue(assertionCredential(SAFARI_ASSERTION));

    await createWebAuthnPasskey().authorize({ userOpHash: VECTOR_CHALLENGE });

    const { publicKey } = get.mock.calls[0]![0] as CeremonyCall;

    expect(bytesToBase64Url(new Uint8Array(publicKey.challenge))).toBe(
      challengeFor(VECTOR_CHALLENGE),
    );
    expect(publicKey.userVerification).toBe('required');
  });

  it('restricts the ceremony to the enrolled credential when one is named', async () => {
    get.mockResolvedValue(assertionCredential(SAFARI_ASSERTION));

    await createWebAuthnPasskey().authorize({
      userOpHash: VECTOR_CHALLENGE,
      credentialId: REAL_REGISTRATION.rawId,
    });

    const { publicKey } = get.mock.calls[0]![0] as CeremonyCall;
    const [allowed] = publicKey.allowCredentials ?? [];

    expect(allowed?.type).toBe('public-key');
    expect(new Uint8Array(allowed!.id)).toEqual(base64UrlToBytes(REAL_REGISTRATION.rawId));
  });

  it('returns the envelope the Solidity suite feeds the contract', async () => {
    get.mockResolvedValue(assertionCredential(SAFARI_ASSERTION));

    const authorization = await createWebAuthnPasskey().authorize({
      userOpHash: VECTOR_CHALLENGE,
    });

    expect(authorization.signature).toBe(SAFARI_ASSERTION.envelope);
    expect(authorization.credentialId).toBe(REAL_REGISTRATION.rawId);
  });

  it('flips a high s on the way through, so the envelope is the accepted one', async () => {
    get.mockResolvedValue(
      assertionCredential({ ...CHROME_ASSERTION, signature: CHROME_ASSERTION_HIGH_S_SIGNATURE }),
    );

    const authorization = await createWebAuthnPasskey().authorize({
      userOpHash: VECTOR_CHALLENGE,
    });

    expect(authorization.signature).toBe(CHROME_ASSERTION.envelope);
  });

  it('refuses an assertion whose authenticator did not verify the user, and says so', async () => {
    // The same real assertion with the User Verified bit cleared: 0x05 → 0x01.
    const authenticatorData = Uint8Array.from(
      base64UrlToBytes(SAFARI_ASSERTION.authenticatorData),
    );
    authenticatorData[32] = 0x01;

    get.mockResolvedValue(
      assertionCredential({
        ...SAFARI_ASSERTION,
        authenticatorData: bytesToBase64Url(authenticatorData),
      }),
    );

    const error = await createWebAuthnPasskey()
      .authorize({ userOpHash: VECTOR_CHALLENGE })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PasskeyAssertionRefusedError);
    expect((error as PasskeyAssertionRefusedError).reason).toBe('UserNotVerified');
    expect((error as Error).message).toMatch(/huella/);
  });

  it('refuses a genuine assertion that authorises another operation', async () => {
    get.mockResolvedValue(assertionCredential(SAFARI_ASSERTION));

    const error = await createWebAuthnPasskey()
      .authorize({ userOpHash: `0x${'11'.repeat(32)}` })
      .catch((caught: unknown) => caught);

    expect((error as PasskeyAssertionRefusedError).reason).toBe('ChallengeMismatch');
  });

  it('reports a cancelled prompt as a decision', async () => {
    const declined = new Error('cancelled');
    declined.name = 'NotAllowedError';
    get.mockRejectedValue(declined);

    await expect(
      createWebAuthnPasskey().authorize({ userOpHash: VECTOR_CHALLENGE }),
    ).rejects.toBeInstanceOf(PasskeyRejectedError);
  });

  it('lets an unrelated failure through unchanged, rather than calling it a cancellation', async () => {
    get.mockRejectedValue(new TypeError('something else entirely'));

    await expect(
      createWebAuthnPasskey().authorize({ userOpHash: VECTOR_CHALLENGE }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
