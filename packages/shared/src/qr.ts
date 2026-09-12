import { z } from 'zod';
import { addressSchema, bytes32Schema } from './prescription';

/** Current QR envelope version. */
export const QR_PAYLOAD_VERSION = 1 as const;

/**
 * The only artefact the patient carries (docs/03-modelo-de-datos.md).
 *
 * HARD RULE: the commitment salt NEVER appears here, nor in a URL, nor in a
 * shareable link. Only the DEK travels in the QR, and only while D-24 remains
 * open (docs/05-almacenamiento-y-cifrado.md).
 *
 * Whoever holds the QR can read the prescription. That is deliberate and
 * equivalent to holding the paper today, and the doctor UI must say so (D6).
 */
export interface QrPayload {
  /** Envelope version. */
  v: number;
  /** EVM chain id. Avalanche Fuji is 43113. */
  chainId: number;
  /** PrescriptionRegistry address. */
  registry: string;
  /** keccak256 of the ciphertext; what the pharmacy looks up on-chain. */
  contentHash: string;
  /** Opaque off-chain pointer. Not an IPNS name (docs/05). */
  pointer: string;
  /** base64url of the unwrapped DEK. MVP only; wrapped per recipient in Phase 2 (D-24). */
  key: string;
}

export const qrPayloadSchema = z.object({
  v: z.number().int().positive(),
  chainId: z.number().int().positive(),
  registry: addressSchema,
  contentHash: bytes32Schema,
  pointer: z.string().min(1),
  key: z.string().min(1),
});

export function encodeQrPayload(payload: QrPayload): string {
  return JSON.stringify(qrPayloadSchema.parse(payload));
}

export function decodeQrPayload(raw: string): QrPayload {
  return qrPayloadSchema.parse(JSON.parse(raw));
}
