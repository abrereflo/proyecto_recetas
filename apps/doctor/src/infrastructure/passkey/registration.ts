import { base64UrlToBytes, bytesToHex } from '@recetas/crypto';
import type { Hex } from '@recetas/shared';
import type { PasskeyCredential } from '../../ports/passkey.port';
import { decodeCbor } from './cbor';
import { COSE_ALG_ES256 } from './cose';
import { decodeSpkiP256PublicKey, type P256PublicKey } from './der';
import { parseAuthenticatorData } from './authenticator-data';

/**
 * A WebAuthn registration ceremony, read as the two coordinates
 * `PasskeyAccount` is constructed with.
 *
 * WHY THIS IS THE MOST CONSEQUENTIAL FUNCTION IN THE FEATURE. `PasskeyAccountFactory`
 * deploys with CREATE2 and the public key is a constructor argument, so THE
 * ACCOUNT ADDRESS IS A COMMITMENT TO THESE 64 BYTES. An EAS credential is then
 * issued to that address. Get `(x, y)` wrong here and everything downstream
 * still works — an address is computed, it is attested, it is shown to the
 * doctor — right up until the first prescription, which fails as
 * `InvalidSignature` and cannot be fixed, because the account has no rotation
 * and the credential names an address nobody can sign for. The only repair is
 * to enrol again from scratch.
 *
 * That is why this module reads the key TWICE whenever the browser makes it
 * possible, from two independently encoded sources, and refuses the credential
 * if they disagree.
 */

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}

/**
 * The registration response fields this module reads.
 *
 * Structurally compatible with `@simplewebauthn/browser`'s
 * `RegistrationResponseJSON`, declared here rather than imported so that the
 * whole of this file stays testable — and reusable by a relayer — without the
 * library or a browser being present.
 */
export interface RegistrationResponseParts {
  rawId: string;
  response: {
    attestationObject: string;
    clientDataJSON: string;
    /** `getAuthenticatorData()`. Optional: not every browser implements it. */
    authenticatorData?: string | undefined;
    /** `getPublicKey()`, an SPKI DER key. Optional for the same reason. */
    publicKey?: string | undefined;
    /** `getPublicKeyAlgorithm()`. Optional for the same reason. */
    publicKeyAlgorithm?: number | undefined;
  };
}

/**
 * `authenticatorData` out of the CBOR attestation object.
 *
 * Only reached when the browser did not expose `getAuthenticatorData()`.
 */
function authenticatorDataFromAttestation(attestationObject: Uint8Array): Uint8Array {
  const decoded = decodeCbor(attestationObject);

  if (!(decoded instanceof Map)) {
    throw new RegistrationError('the attestation object is not a CBOR map');
  }

  const authData = decoded.get('authData');

  if (!(authData instanceof Uint8Array)) {
    throw new RegistrationError('the attestation object carries no authData byte string');
  }

  return authData;
}

function toHex32(value: bigint, name: string): Hex {
  const hex = value.toString(16).padStart(64, '0');

  if (hex.length !== 64) {
    throw new RegistrationError(`the public key ${name} does not fit in 32 bytes`);
  }

  return `0x${hex}`;
}

/**
 * The `(x, y)` of a registration response, cross-checked against the browser's
 * own DER key whenever one was offered.
 */
export function publicKeyFromRegistration(response: RegistrationResponseParts): PasskeyCredential {
  const { publicKey, publicKeyAlgorithm, authenticatorData, attestationObject } = response.response;

  // The ceremony asked for ES256 alone in `pubKeyCredParams`. An authenticator
  // that answered with something else produced a credential this account can
  // never verify, and the moment to say so is now — not after the address has
  // been attested.
  if (publicKeyAlgorithm !== undefined && publicKeyAlgorithm !== COSE_ALG_ES256) {
    throw new RegistrationError(
      `the credential was created for COSE algorithm ${publicKeyAlgorithm}; ` +
        `this account verifies ES256 (${COSE_ALG_ES256}) and nothing else`,
    );
  }

  const authData = parseAuthenticatorData(
    authenticatorData === undefined
      ? authenticatorDataFromAttestation(base64UrlToBytes(attestationObject))
      : base64UrlToBytes(authenticatorData),
  );

  // User Verification is mandatory in `WebAuthn.check`, so a credential
  // registered without it is a credential whose every future assertion will be
  // refused on chain. `authenticatorSelection.userVerification` was set to
  // `required` for this ceremony; this is the check that the authenticator
  // honoured it.
  if (!authData.flags.userPresent || !authData.flags.userVerified) {
    throw new RegistrationError(
      'the authenticator did not verify the user during registration; ' +
        'this account only accepts assertions with User Verified set',
    );
  }

  const attested = authData.attestedCredentialData;

  if (attested === undefined) {
    throw new RegistrationError('the registration carries no attested credential data');
  }

  const fromCose = attested.publicKey;

  // The second, independent reading. `getPublicKey()` returns the same key in a
  // completely different encoding — ASN.1 DER rather than CBOR — parsed by a
  // completely different function. Two decoders agreeing on 64 bytes is a far
  // stronger statement than either one on its own, and a disagreement is a bug
  // that must never be resolved by picking a side.
  if (publicKey !== undefined) {
    const fromSpki = decodeSpkiP256PublicKey(base64UrlToBytes(publicKey));

    if (fromSpki.x !== fromCose.x || fromSpki.y !== fromCose.y) {
      throw new RegistrationError(
        'the attested credential key and the key the browser reported do not match; ' +
          'refusing to guess which of the two the account should commit to',
      );
    }
  }

  assertUsable(fromCose);

  return {
    credentialId: response.rawId,
    publicKeyX: toHex32(fromCose.x, 'X'),
    publicKeyY: toHex32(fromCose.y, 'Y'),
    backupEligible: authData.flags.backupEligible,
  };
}

/**
 * `PasskeyAccount`'s constructor reverts with `InvalidPublicKey` on a zero
 * coordinate. Raising it here saves a failed deployment and says why.
 */
function assertUsable(key: P256PublicKey): void {
  if (key.x === 0n || key.y === 0n) {
    throw new RegistrationError('a public key coordinate is zero, which is not a point on P-256');
  }
}

/** Both coordinates, as the 32-byte hex the factory takes. */
export function publicKeyToHex(key: P256PublicKey): { x: Hex; y: Hex } {
  return { x: toHex32(key.x, 'X'), y: toHex32(key.y, 'Y') };
}

/** The credential id as bytes, for a caller that needs them rather than base64url. */
export function credentialIdBytes(credential: PasskeyCredential): Hex {
  return bytesToHex(base64UrlToBytes(credential.credentialId));
}
