import { decodeCoseP256PublicKey } from './cose';
import type { P256PublicKey } from './der';

/**
 * `authenticatorData` (W3C WebAuthn §6.1), as far as this project needs to read
 * it.
 *
 * TWO CEREMONIES, TWO SHAPES. An authentication assertion carries the 37-byte
 * minimum — `rpIdHash || flags || signCount` — and nothing else; that is what
 * `WebAuthn.Assertion.authenticatorData` transmits verbatim and what
 * `WebAuthn.check` reads the flag byte out of. A registration attestation
 * carries the same 37 bytes followed by ATTESTED CREDENTIAL DATA: the
 * authenticator's AAGUID, the credential id, and the COSE public key that
 * becomes `PasskeyAccount`'s immutable owner. This module parses both.
 *
 * THE FLAGS ARE READ HERE TOO, and checked before the ceremony is reported as
 * successful, because of what `WebAuthn.check` does with them. User Verified is
 * mandatory in that contract — deliberately, so that a prescription names a
 * PERSON and not a device someone tapped — and a credential registered without
 * it is a credential whose future assertions will be refused on chain with
 * `UserNotVerified`. Catching UV=0 at enrolment costs one error message;
 * catching it later costs the doctor an account address that is already
 * attested in EAS and can never be signed for.
 */

/** `rpIdHash` (32) || `flags` (1) || `signCount` (4). */
export const AUTHENTICATOR_DATA_MIN_LENGTH = 37;

const FLAGS_OFFSET = 32;
const SIGN_COUNT_OFFSET = 33;
const AAGUID_LENGTH = 16;

/** Mirrors `WebAuthn.FLAG_*` in contracts/src/WebAuthn.sol, bit for bit. */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKUP_STATE = 0x10;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;
const FLAG_EXTENSION_DATA = 0x80;

export class AuthenticatorDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticatorDataError';
  }
}

export interface AuthenticatorFlags {
  userPresent: boolean;
  /** Bit 2. `WebAuthn.check` refuses the assertion when this is false. */
  userVerified: boolean;
  backupEligible: boolean;
  backupState: boolean;
  attestedCredentialData: boolean;
  extensionData: boolean;
}

export interface AttestedCredentialData {
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  publicKey: P256PublicKey;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: AuthenticatorFlags;
  raw: number;
  signCount: number;
  /** Present only for a registration ceremony. */
  attestedCredentialData?: AttestedCredentialData;
}

export function readFlags(raw: number): AuthenticatorFlags {
  return {
    userPresent: (raw & FLAG_USER_PRESENT) !== 0,
    userVerified: (raw & FLAG_USER_VERIFIED) !== 0,
    backupEligible: (raw & FLAG_BACKUP_ELIGIBLE) !== 0,
    backupState: (raw & FLAG_BACKUP_STATE) !== 0,
    attestedCredentialData: (raw & FLAG_ATTESTED_CREDENTIAL_DATA) !== 0,
    extensionData: (raw & FLAG_EXTENSION_DATA) !== 0,
  };
}

export function parseAuthenticatorData(bytes: Uint8Array): ParsedAuthenticatorData {
  if (bytes.length < AUTHENTICATOR_DATA_MIN_LENGTH) {
    throw new AuthenticatorDataError(
      `authenticatorData is ${bytes.length} bytes; the minimum is ${AUTHENTICATOR_DATA_MIN_LENGTH}`,
    );
  }

  const raw = bytes[FLAGS_OFFSET]!;
  const flags = readFlags(raw);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signCount = view.getUint32(SIGN_COUNT_OFFSET, false);

  const parsed: ParsedAuthenticatorData = {
    rpIdHash: bytes.slice(0, FLAGS_OFFSET),
    flags,
    raw,
    signCount,
  };

  if (!flags.attestedCredentialData) return parsed;

  const credentialLengthOffset = AUTHENTICATOR_DATA_MIN_LENGTH + AAGUID_LENGTH;

  if (bytes.length < credentialLengthOffset + 2) {
    throw new AuthenticatorDataError(
      'authenticatorData claims attested credential data but ends inside the AAGUID',
    );
  }

  const credentialIdLength = view.getUint16(credentialLengthOffset, false);
  const credentialIdStart = credentialLengthOffset + 2;
  const credentialIdEnd = credentialIdStart + credentialIdLength;

  if (bytes.length < credentialIdEnd) {
    throw new AuthenticatorDataError(
      `the credential id declares ${credentialIdLength} bytes, only ${bytes.length - credentialIdStart} remain`,
    );
  }

  const publicKey = decodeCoseP256PublicKey(bytes, credentialIdEnd);

  parsed.attestedCredentialData = {
    aaguid: bytes.slice(AUTHENTICATOR_DATA_MIN_LENGTH, credentialLengthOffset),
    credentialId: bytes.slice(credentialIdStart, credentialIdEnd),
    publicKey: { x: publicKey.x, y: publicKey.y },
  };

  return parsed;
}
