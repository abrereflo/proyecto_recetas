import { keccak256 } from 'viem';
import {
  DOCUMENT_TYPE_PRESCRIPTION,
  ENCRYPTION_ALGORITHM,
  SCHEMA_VERSION,
  type DocumentSignatures,
  type EncryptedDocument,
} from '@recetas/shared';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  utf8ToBytes,
} from './encoding';

/**
 * Envelope encryption, docs/05-almacenamiento-y-cifrado.md.
 *
 * One random DEK per prescription, AES-256-GCM, WebCrypto only. No external
 * crypto library is used anywhere in this package on purpose.
 *
 * TODO (D-24): the DEK is used unwrapped in the MVP and travels in the QR.
 * Phase 2 wraps it per recipient with HPKE (RFC 9180) over a dedicated P-256
 * encryption key pair, explicitly distinct from the WebAuthn signing passkey.
 */

/** AES-256 key length in bytes. */
export const DEK_LENGTH = 32;
/** 96-bit nonce, the GCM standard. */
export const IV_LENGTH = 12;
/** 128-bit GCM authentication tag. */
export const AUTH_TAG_LENGTH = 16;
/** Commitment salt length in bytes: one bytes32 per prescription. */
export const SALT_LENGTH = 32;

function webcrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('WebCrypto is unavailable; Node 22+ or a modern browser is required');
  }
  return globalThis.crypto;
}

export function randomBytes(length: number): Uint8Array {
  return webcrypto().getRandomValues(new Uint8Array(length));
}

/** A fresh data encryption key. One per prescription, never reused. */
export function generateDek(): Uint8Array {
  return randomBytes(DEK_LENGTH);
}

/**
 * A fresh commitment salt. One per prescription: a stable salt would let any
 * chain observer group a patient's prescriptions (hard rule, docs/03).
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

export function generateIv(): Uint8Array {
  return randomBytes(IV_LENGTH);
}

async function importKey(dek: Uint8Array): Promise<CryptoKey> {
  if (dek.length !== DEK_LENGTH) {
    throw new Error(`DEK must be ${DEK_LENGTH} bytes, got ${dek.length}`);
  }
  return webcrypto().subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface EncryptResult {
  /** Ciphertext without the authentication tag. */
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

/** Encrypt raw bytes with AES-256-GCM. */
export async function encryptBytes(
  plaintext: Uint8Array,
  dek: Uint8Array,
  iv: Uint8Array = generateIv(),
): Promise<EncryptResult> {
  const key = await importKey(dek);
  const sealed = new Uint8Array(
    await webcrypto().subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH * 8 },
      key,
      plaintext,
    ),
  );
  // WebCrypto appends the tag to the ciphertext; the envelope stores them apart.
  return {
    ciphertext: sealed.slice(0, sealed.length - AUTH_TAG_LENGTH),
    authTag: sealed.slice(sealed.length - AUTH_TAG_LENGTH),
    iv,
  };
}

/** Decrypt raw bytes. Throws if the ciphertext or the tag was tampered with. */
export async function decryptBytes(
  ciphertext: Uint8Array,
  authTag: Uint8Array,
  iv: Uint8Array,
  dek: Uint8Array,
): Promise<Uint8Array> {
  const key = await importKey(dek);
  const sealed = concatBytes(ciphertext, authTag);
  const plaintext = await webcrypto().subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH * 8 },
    key,
    sealed,
  );
  return new Uint8Array(plaintext);
}

/**
 * keccak256 of the ciphertext bytes. This is the `contentHash` anchored
 * on-chain and carried in the QR (docs/05).
 */
export function contentHashOf(ciphertext: Uint8Array | string): `0x${string}` {
  const bytes = typeof ciphertext === 'string' ? base64ToBytes(ciphertext) : ciphertext;
  return keccak256(bytes);
}

export interface EncryptDocumentOptions {
  signatures: DocumentSignatures;
  createdAt?: string;
  iv?: Uint8Array;
  documentType?: string;
}

export interface SealDocumentOptions {
  /**
   * Produces the envelope signatures once `contentHash` is known.
   *
   * The prescriber signs the anchored `contentHash`, so the signature cannot
   * exist before the ciphertext does. This callback is the seam that keeps the
   * encrypt/sign/assemble order in one place (docs/05, issue sequence).
   */
  sign: (contentHash: `0x${string}`) => DocumentSignatures | Promise<DocumentSignatures>;
  createdAt?: string;
  iv?: Uint8Array;
  documentType?: string;
}

export interface EncryptDocumentResult {
  document: EncryptedDocument;
  contentHash: `0x${string}`;
}

/**
 * Encrypt a plaintext clinical document, sign the resulting `contentHash` and
 * assemble the storable envelope.
 *
 * The caller owns the DEK: this package never persists or transmits it.
 */
export async function sealDocument(
  plaintext: unknown,
  dek: Uint8Array,
  options: SealDocumentOptions,
): Promise<EncryptDocumentResult> {
  const serialized = utf8ToBytes(JSON.stringify(plaintext));
  const { ciphertext, iv, authTag } = await encryptBytes(serialized, dek, options.iv);
  const contentHash = contentHashOf(ciphertext);
  const signatures = await options.sign(contentHash);

  const document: EncryptedDocument = {
    schemaVersion: SCHEMA_VERSION,
    documentType: options.documentType ?? DOCUMENT_TYPE_PRESCRIPTION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    encryption: {
      algorithm: ENCRYPTION_ALGORITHM,
      iv: bytesToBase64(iv),
      authTag: bytesToBase64(authTag),
    },
    signatures,
    ciphertext: bytesToBase64(ciphertext),
  };

  return { document, contentHash };
}

/**
 * Encrypt a plaintext clinical document into the storable envelope when the
 * signatures are already known.
 */
export async function encryptDocument(
  plaintext: unknown,
  dek: Uint8Array,
  options: EncryptDocumentOptions,
): Promise<EncryptDocumentResult> {
  const sealOptions: SealDocumentOptions = { sign: () => options.signatures };
  if (options.createdAt !== undefined) sealOptions.createdAt = options.createdAt;
  if (options.iv !== undefined) sealOptions.iv = options.iv;
  if (options.documentType !== undefined) sealOptions.documentType = options.documentType;

  return sealDocument(plaintext, dek, sealOptions);
}

/**
 * Decrypt an envelope back into its plaintext object.
 *
 * `expectedContentHash` is the value read from the chain. When supplied, the
 * integrity check runs BEFORE decryption, which is the order the pharmacy flow
 * requires (docs/05, dispense sequence).
 */
export async function decryptDocument<T = unknown>(
  document: EncryptedDocument,
  dek: Uint8Array,
  expectedContentHash?: string,
): Promise<T> {
  if (document.encryption.algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error(`unsupported algorithm: ${document.encryption.algorithm}`);
  }

  const ciphertext = base64ToBytes(document.ciphertext);

  if (expectedContentHash !== undefined) {
    const actual = contentHashOf(ciphertext);
    if (actual.toLowerCase() !== expectedContentHash.toLowerCase()) {
      throw new Error('content hash mismatch: the stored ciphertext is not the anchored one');
    }
  }

  const plaintext = await decryptBytes(
    ciphertext,
    base64ToBytes(document.encryption.authTag),
    base64ToBytes(document.encryption.iv),
    dek,
  );

  return JSON.parse(bytesToUtf8(plaintext)) as T;
}

/**
 * `patientCommitment = keccak256(patientId, salt)` (docs/03).
 *
 * DECISION: the concatenation is UTF-8 bytes of `patientId` followed by the raw
 * salt bytes, which is what `keccak256(abi.encodePacked(patientId, salt))`
 * produces in Solidity. The salt never leaves the encrypted store.
 */
export function patientCommitment(patientId: string, salt: Uint8Array): `0x${string}` {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`salt must be ${SALT_LENGTH} bytes, got ${salt.length}`);
  }
  return keccak256(concatBytes(utf8ToBytes(patientId), salt));
}

/** Hex form of a salt, for storage alongside the ciphertext. */
export function saltToHex(salt: Uint8Array): `0x${string}` {
  return bytesToHex(salt);
}
