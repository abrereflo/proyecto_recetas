import { decodeCborItem, type CborValue } from './cbor';
import type { P256PublicKey } from './der';

/**
 * The COSE_Key (RFC 9052 §7) an authenticator embeds in `authenticatorData` at
 * registration, read as the `(x, y)` `PasskeyAccount` is constructed with.
 *
 * WHY `alg` IS CHECKED AND NOT INFERRED. `PasskeyAccount` verifies P-256 and
 * only P-256, so a credential created with Ed25519 (-8) or RS256 (-257)
 * produces an account that can never be signed for — and the address of that
 * account is a CREATE2 commitment to the key, so the mistake is permanent and
 * silent: enrolment succeeds, a credential authority attests to the address,
 * and the first prescription fails. Requiring `-7` here turns that into a
 * refusal at the one moment it is still cheap to fix. `pubKeyCredParams` in the
 * ceremony already asks for `-7` alone, but an authenticator answering with
 * something else is exactly the case worth catching rather than trusting.
 */

/** COSE_Key label 1: key type. */
const LABEL_KTY = 1;

/** COSE_Key label 3: algorithm. */
const LABEL_ALG = 3;

/** EC2 key parameter -1: curve. */
const LABEL_CRV = -1;

/** EC2 key parameter -2: x coordinate. */
const LABEL_X = -2;

/** EC2 key parameter -3: y coordinate. */
const LABEL_Y = -3;

/** `kty` value 2: a two-coordinate elliptic-curve key. */
const KTY_EC2 = 2;

/** `alg` value -7: ECDSA with SHA-256, which WebAuthn calls ES256. */
export const COSE_ALG_ES256 = -7;

/** `crv` value 1: NIST P-256, alias secp256r1, alias prime256v1. */
const CRV_P256 = 1;

const COORDINATE_LENGTH = 32;

export class CoseKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoseKeyError';
  }
}

export interface CoseP256PublicKey extends P256PublicKey {
  /** Offset just past the key, so a caller can find the extensions after it. */
  end: number;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function coordinate(map: Map<CborValue, CborValue>, label: number, name: string): bigint {
  const raw = map.get(label);

  if (!(raw instanceof Uint8Array)) {
    throw new CoseKeyError(`the COSE key has no byte string for ${name}`);
  }

  // Fixed width, not "at most 32". RFC 9052 §7.1.1 requires the coordinate to
  // be padded to the field size, and a short coordinate silently read as a
  // small integer is a different key.
  if (raw.length !== COORDINATE_LENGTH) {
    throw new CoseKeyError(`${name} is ${raw.length} bytes; a P-256 coordinate is ${COORDINATE_LENGTH}`);
  }

  return bytesToBigInt(raw);
}

/**
 * One COSE_Key starting at `offset`, required to be an ES256 P-256 key.
 *
 * @returns the coordinates and the offset just past the key.
 */
export function decodeCoseP256PublicKey(bytes: Uint8Array, offset = 0): CoseP256PublicKey {
  const item = decodeCborItem(bytes, offset);

  if (!(item.value instanceof Map)) {
    throw new CoseKeyError('the credential public key is not a CBOR map');
  }

  const map = item.value;

  if (map.get(LABEL_KTY) !== KTY_EC2) {
    throw new CoseKeyError(`unsupported COSE key type ${String(map.get(LABEL_KTY))}; expected EC2 (2)`);
  }

  if (map.get(LABEL_ALG) !== COSE_ALG_ES256) {
    throw new CoseKeyError(
      `the credential was created for COSE algorithm ${String(map.get(LABEL_ALG))}; ` +
        `this account verifies ES256 (${COSE_ALG_ES256}) and nothing else`,
    );
  }

  if (map.get(LABEL_CRV) !== CRV_P256) {
    throw new CoseKeyError(`unsupported curve ${String(map.get(LABEL_CRV))}; expected P-256 (1)`);
  }

  return {
    x: coordinate(map, LABEL_X, 'x'),
    y: coordinate(map, LABEL_Y, 'y'),
    end: item.end,
  };
}
