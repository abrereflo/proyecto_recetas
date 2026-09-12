import { z } from 'zod';
import { addressSchema, hexSchema } from './prescription';

/**
 * Encrypted envelope as stored off-chain and hashed into `contentHash`.
 * Shape comes verbatim from docs/03-modelo-de-datos.md.
 */

export const SCHEMA_VERSION = '1.0.0' as const;
export const DOCUMENT_TYPE_PRESCRIPTION = 'Prescription' as const;

/** Only AES-256-GCM is supported. Envelope encryption, docs/05. */
export const ENCRYPTION_ALGORITHM = 'AES-256-GCM' as const;

export interface EncryptionMetadata {
  algorithm: typeof ENCRYPTION_ALGORITHM;
  /** base64, 12 bytes (96-bit GCM nonce). */
  iv: string;
  /** base64, 16 bytes. */
  authTag: string;
}

export const encryptionMetadataSchema = z.object({
  algorithm: z.literal(ENCRYPTION_ALGORITHM),
  iv: z.string().min(1),
  authTag: z.string().min(1),
});

/** EIP-712 signature produced by the prescriber's smart account. */
export interface Eip712Signature {
  /** Prescriber smart account address. */
  signer: string;
  /** Hex signature value. */
  value: string;
}

export const eip712SignatureSchema = z.object({
  signer: addressSchema,
  value: hexSchema,
});

/**
 * Bolivian legal signature (ADSIB, PKCS#7 over X.509/RSA).
 * Not integrated in the MVP: status stays `pending-integration` and the UI must
 * never simulate legal validity (D-17, docs/17-diseno-y-experiencia.md).
 */
export interface AdsibSignature {
  certificateSerial: string;
  /** base64 PKCS#7 detached signature. */
  value: string;
  status: 'pending-integration' | 'valid' | 'invalid';
}

export const adsibSignatureSchema = z.object({
  certificateSerial: z.string(),
  value: z.string(),
  status: z.enum(['pending-integration', 'valid', 'invalid']),
});

export interface DocumentSignatures {
  eip712: Eip712Signature;
  adsib?: AdsibSignature;
}

export const documentSignaturesSchema = z.object({
  eip712: eip712SignatureSchema,
  adsib: adsibSignatureSchema.optional(),
});

/**
 * The object whose keccak256 anchors the prescription on-chain.
 *
 * NOTE: `contentHash` is keccak256 of the ciphertext bytes, not of this whole
 * envelope (docs/05-almacenamiento-y-cifrado.md).
 */
export interface EncryptedDocument {
  schemaVersion: string;
  documentType: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  encryption: EncryptionMetadata;
  signatures: DocumentSignatures;
  /** base64 of the AES-256-GCM ciphertext, without the auth tag. */
  ciphertext: string;
}

export const encryptedDocumentSchema = z.object({
  schemaVersion: z.string().min(1),
  documentType: z.string().min(1),
  createdAt: z.string().datetime(),
  encryption: encryptionMetadataSchema,
  signatures: documentSignaturesSchema,
  ciphertext: z.string().min(1),
});
