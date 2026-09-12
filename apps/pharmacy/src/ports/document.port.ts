import type { EncryptedDocument } from '@recetas/shared';

/**
 * Access to the off-chain encrypted payload store (services/api).
 *
 * What the store returns under `ciphertext` is the WHOLE sealed envelope
 * (inner ciphertext + iv + authTag + signatures) encoded as base64 JSON, which
 * is what apps/cli/src/storage.ts writes. The anchored `contentHash` still
 * covers only the inner AES ciphertext bytes, so this port hands back the
 * parsed envelope and the integrity check runs on `document.ciphertext`.
 *
 * HARD RULE (docs/03): the commitment salt is written to the store and never
 * read back — the API deliberately does not return it. The pharmacy recovers it
 * from inside the decrypted document and it never reaches a URL or a log line.
 */
export interface DocumentPort {
  fetchEnvelope(pointer: string): Promise<EncryptedDocument>;
}

/** The pointer resolves to nothing: the QR points at content that is gone. */
export class DocumentNotFoundError extends Error {
  constructor(readonly pointer: string) {
    super('El almacén no tiene ningún documento para este código.');
    this.name = 'DocumentNotFoundError';
  }
}

/** The store did not answer, or answered with an unusable status. */
export class DocumentStoreUnreachableError extends Error {
  constructor(readonly apiUrl: string, options?: { cause?: unknown }) {
    super(`No hay respuesta del almacén de recetas en ${apiUrl}.`, options);
    this.name = 'DocumentStoreUnreachableError';
  }
}

/** Something was stored, but it is not a valid sealed envelope. */
export class MalformedEnvelopeError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('El contenido almacenado no tiene la forma de un sobre cifrado válido.', options);
    this.name = 'MalformedEnvelopeError';
  }
}
