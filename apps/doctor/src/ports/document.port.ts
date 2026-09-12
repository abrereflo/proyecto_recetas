import type { EncryptedDocument, Hex } from '@recetas/shared';

/**
 * Write access to the off-chain encrypted payload store (services/api).
 *
 * This is the WRITE half of the wire format whose READ half apps/pharmacy owns.
 * What travels under `ciphertext` is the WHOLE sealed envelope (inner ciphertext
 * + iv + authTag + signatures) encoded by `encodeStoredPayload` from
 * @recetas/chain, because the pharmacy needs all of it to decrypt and to check
 * the prescriber signature (docs/03, docs/05).
 *
 * HARD RULE (docs/03): the commitment salt is written here and never read back
 * — the API deliberately does not return it. The pharmacy recovers it from
 * inside the decrypted document. It never reaches the chain, the QR, a URL or a
 * log line.
 */

/** What `POST /prescriptions` answers with (201). */
export interface StoredEnvelope {
  /** Opaque, unguessable pointer. This is what travels in the QR. */
  pointer: string;
  /** ISO 8601 timestamp assigned by the store. */
  createdAt: string;
}

export interface StoreEnvelopeInput {
  document: EncryptedDocument;
  /** Hex of the 32-byte commitment salt. Written, never read back (docs/03). */
  saltHex: Hex;
}

export interface DocumentPort {
  storeEnvelope(input: StoreEnvelopeInput): Promise<StoredEnvelope>;
}

/** The store did not answer at all. Nothing was written. */
export class DocumentStoreUnreachableError extends Error {
  constructor(
    readonly apiUrl: string,
    options?: { cause?: unknown },
  ) {
    super(`No hay respuesta del almacén de recetas en ${apiUrl}.`, options);
    this.name = 'DocumentStoreUnreachableError';
  }
}

/** The store answered, and refused the payload. */
export class DocumentStoreRejectedError extends Error {
  constructor(
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(`El almacén de recetas rechazó el documento cifrado (HTTP ${status}).`, options);
    this.name = 'DocumentStoreRejectedError';
  }
}

/** The store answered 201 with a body that carries no usable pointer. */
export class MalformedStoreResponseError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('El almacén de recetas no devolvió un puntero válido.', options);
    this.name = 'MalformedStoreResponseError';
  }
}
