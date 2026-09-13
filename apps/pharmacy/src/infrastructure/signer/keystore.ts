import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from '@recetas/crypto';
import type { Hex } from '@recetas/shared';

/**
 * A pharmacy signing key, encrypted under a passphrase, stored in this browser.
 *
 * WHY THIS EXISTS (docs/23-firma-en-el-dispositivo.md): the injected provider's
 * in-app browser blocks the camera and cannot install the PWA, so the counter
 * phone needs a way to sign from Safari or Chrome. This is DELIBERATE
 * SCAFFOLDING, not the target architecture — D-04's passkey + ERC-4337 account
 * replaces it, and then this file is deleted rather than migrated.
 *
 * WebCrypto only, no new dependency, mirroring @recetas/crypto's envelope:
 *
 *   PBKDF2-SHA256, 310 000 iterations, random 16-byte salt  -> 256-bit key
 *   AES-256-GCM, random 12-byte iv                          -> ciphertext
 *
 * The iteration count is OWASP's 2023 floor for PBKDF2-HMAC-SHA256 and is
 * written into the blob, together with the version, the salt and the iv, so a
 * later version can raise it and re-encrypt instead of stranding the device.
 *
 * HARD RULE: the private key in the clear never reaches `localStorage`,
 * `sessionStorage`, a log line or a React state. Only the blob below is stored,
 * and the plaintext lives in one closure inside the adapter (see
 * local-key-signer.adapter.ts) until `lock()` drops it.
 */

/** Namespaced so the project's own storage is obvious in devtools. */
export const KEYSTORE_STORAGE_KEY = 'recetas.pharmacy.signing-key';

/** Bump together with a migration, never alone. */
export const KEYSTORE_VERSION = 1;

/** OWASP 2023 floor for PBKDF2-HMAC-SHA256. */
export const KEYSTORE_ITERATIONS = 310_000;

/**
 * The lowest iteration count this version will decrypt.
 *
 * A blob claiming fewer was either produced by something else or edited by
 * hand; opening it would silently downgrade the only protection the key has.
 */
export const KEYSTORE_MINIMUM_ITERATIONS = 310_000;

export const KEYSTORE_SALT_BYTES = 16;
export const KEYSTORE_IV_BYTES = 12;
export const KEYSTORE_KEY_BITS = 256;

/**
 * Short enough to be typed at a counter, long enough to be worth the KDF.
 * Enforced here as well as on the screen, so nothing can store a weaker one.
 */
export const MINIMUM_PASSPHRASE_LENGTH = 12;

const KDF = 'PBKDF2-SHA256';
const CIPHER = 'AES-GCM-256';

/** Self-describing on purpose: every parameter needed to reopen it is inside. */
export interface Keystore {
  version: number;
  kdf: typeof KDF;
  iterations: number;
  /** base64, 16 bytes. */
  salt: string;
  /** base64, 12 bytes. */
  iv: string;
  cipher: typeof CIPHER;
  /** base64: AES-GCM output, ciphertext and 128-bit tag together. */
  ciphertext: string;
}

/** What was pasted is not a 32-byte private key. */
export class InvalidPrivateKeyError extends Error {
  constructor() {
    super(
      'La clave de firma no tiene el formato esperado: deben ser 64 caracteres hexadecimales, ' +
        'con o sin el prefijo 0x.',
    );
    this.name = 'InvalidPrivateKeyError';
  }
}

/** The passphrase is below the minimum; nothing was derived or stored. */
export class WeakPassphraseError extends Error {
  constructor() {
    super(`La contraseña debe tener al menos ${MINIMUM_PASSPHRASE_LENGTH} caracteres.`);
    this.name = 'WeakPassphraseError';
  }
}

/**
 * The passphrase did not open the blob.
 *
 * Distinct from `KeystoreCorruptError` because the answers differ: this one is
 * "type it again", the other is "erase it and set the device up once more".
 * Raw WebCrypto raises a bare `OperationError` with no message for this case,
 * which is unrenderable, so it is never allowed to escape.
 */
export class KeystorePassphraseError extends Error {
  constructor() {
    super('La contraseña no abre la clave guardada en este dispositivo.');
    this.name = 'KeystorePassphraseError';
  }
}

/** The stored blob is unreadable, damaged, or from a version this cannot read. */
export class KeystoreCorruptError extends Error {
  constructor(reason: string) {
    super(`La clave guardada en este dispositivo no se puede leer: ${reason}`);
    this.name = 'KeystoreCorruptError';
  }
}

function webcrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('WebCrypto is unavailable; a modern browser is required');
  }
  return globalThis.crypto;
}

const PRIVATE_KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Accepts what a person actually pastes — spaces, a newline, upper case, with
 * or without `0x` — and returns the single canonical form everything else uses.
 */
export function normalisePrivateKey(value: string): Hex {
  const trimmed = value.trim().toLowerCase();
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;

  if (!PRIVATE_KEY_PATTERN.test(body)) throw new InvalidPrivateKeyError();
  return `0x${body}` as Hex;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const subtle = webcrypto().subtle;
  const material = await subtle.importKey('raw', utf8ToBytes(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);

  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEYSTORE_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPrivateKey(
  privateKey: string,
  passphrase: string,
): Promise<Keystore> {
  if (passphrase.length < MINIMUM_PASSPHRASE_LENGTH) throw new WeakPassphraseError();
  const normalised = normalisePrivateKey(privateKey);

  const crypto = webcrypto();
  const salt = crypto.getRandomValues(new Uint8Array(KEYSTORE_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(KEYSTORE_IV_BYTES));
  const key = await deriveKey(passphrase, salt, KEYSTORE_ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8ToBytes(normalised),
  );

  return {
    version: KEYSTORE_VERSION,
    kdf: KDF,
    iterations: KEYSTORE_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: CIPHER,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

function decodeField(keystore: Keystore, field: 'salt' | 'iv' | 'ciphertext'): Uint8Array {
  try {
    return base64ToBytes(keystore[field]);
  } catch {
    throw new KeystoreCorruptError(`el campo ${field} no es base64 válido`);
  }
}

export async function decryptPrivateKey(keystore: Keystore, passphrase: string): Promise<Hex> {
  assertReadable(keystore);

  const salt = decodeField(keystore, 'salt');
  const iv = decodeField(keystore, 'iv');
  const ciphertext = decodeField(keystore, 'ciphertext');

  if (salt.length !== KEYSTORE_SALT_BYTES) {
    throw new KeystoreCorruptError(`la sal no mide ${KEYSTORE_SALT_BYTES} bytes`);
  }
  if (iv.length !== KEYSTORE_IV_BYTES) {
    throw new KeystoreCorruptError(`el vector de inicialización no mide ${KEYSTORE_IV_BYTES} bytes`);
  }

  const key = await deriveKey(passphrase, salt, keystore.iterations);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await webcrypto().subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    // AES-GCM cannot tell "wrong passphrase" from "tampered ciphertext": both
    // are an authentication-tag failure. The passphrase is overwhelmingly the
    // likelier of the two at a counter, and it is the one with a next step.
    throw new KeystorePassphraseError();
  }

  try {
    return normalisePrivateKey(bytesToUtf8(new Uint8Array(plaintext)));
  } catch {
    // The tag verified, so the passphrase WAS right and the plaintext is still
    // not a key: the blob was written by something else.
    throw new KeystoreCorruptError('el contenido descifrado no es una clave de firma');
  }
}

/**
 * Validates everything that can be validated before a passphrase is involved.
 * Kept separate so `parseKeystore` and `decryptPrivateKey` cannot disagree.
 */
function assertReadable(candidate: unknown): asserts candidate is Keystore {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new KeystoreCorruptError('no es un objeto');
  }

  const blob = candidate as Partial<Keystore>;

  if (blob.version !== KEYSTORE_VERSION) {
    throw new KeystoreCorruptError(`versión desconocida (${String(blob.version)})`);
  }
  if (blob.kdf !== KDF) {
    throw new KeystoreCorruptError(`derivación desconocida (${String(blob.kdf)})`);
  }
  if (blob.cipher !== CIPHER) {
    throw new KeystoreCorruptError(`cifrado desconocido (${String(blob.cipher)})`);
  }
  if (typeof blob.iterations !== 'number' || !Number.isInteger(blob.iterations)) {
    throw new KeystoreCorruptError('el número de iteraciones no es válido');
  }
  if (blob.iterations < KEYSTORE_MINIMUM_ITERATIONS) {
    throw new KeystoreCorruptError(
      `declara ${blob.iterations} iteraciones, por debajo del mínimo de ` +
        `${KEYSTORE_MINIMUM_ITERATIONS}`,
    );
  }

  for (const field of ['salt', 'iv', 'ciphertext'] as const) {
    if (typeof blob[field] !== 'string' || blob[field] === '') {
      throw new KeystoreCorruptError(`falta el campo ${field}`);
    }
  }
}

export function serialiseKeystore(keystore: Keystore): string {
  return JSON.stringify(keystore);
}

export function parseKeystore(serialised: string): Keystore {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialised);
  } catch {
    throw new KeystoreCorruptError('no es JSON');
  }

  assertReadable(candidate);
  return candidate;
}

/**
 * `localStorage`, when there is one.
 *
 * Reached through a function rather than captured at module load so a test —
 * or a browser in a mode that denies storage — is handled in one place.
 */
function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * True when SOMETHING is stored, readable or not.
 *
 * Deliberately not `loadKeystore() !== null`: a damaged blob still occupies the
 * device, and the screen has to know it is there in order to offer erasing it.
 */
export function hasKeystore(storage: Storage | undefined = defaultStorage()): boolean {
  const raw = storage?.getItem(KEYSTORE_STORAGE_KEY);
  return typeof raw === 'string' && raw !== '';
}

/** Throws `KeystoreCorruptError` when something is stored but unreadable. */
export function loadKeystore(storage: Storage | undefined = defaultStorage()): Keystore | null {
  const raw = storage?.getItem(KEYSTORE_STORAGE_KEY);
  if (typeof raw !== 'string' || raw === '') return null;
  return parseKeystore(raw);
}

export function saveKeystore(
  keystore: Keystore,
  storage: Storage | undefined = defaultStorage(),
): void {
  storage?.setItem(KEYSTORE_STORAGE_KEY, serialiseKeystore(keystore));
}

export function clearKeystore(storage: Storage | undefined = defaultStorage()): void {
  storage?.removeItem(KEYSTORE_STORAGE_KEY);
}
