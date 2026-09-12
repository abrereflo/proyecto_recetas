import { base64ToBytes, bytesToUtf8 } from '@recetas/crypto';
import { encryptedDocumentSchema, type EncryptedDocument } from '@recetas/shared';
import {
  DocumentNotFoundError,
  DocumentStoreUnreachableError,
  MalformedEnvelopeError,
  type DocumentPort,
} from '../../ports/document.port';
import type { PharmacyConfig } from '../config/env';

/**
 * `DocumentPort` over `GET /prescriptions/:pointer` (services/api).
 *
 * VERIFIED against services/api/src/routes/prescriptions.ts and
 * apps/cli/src/storage.ts: the response body is
 * `{ pointer, ciphertext, createdAt }`, and its `ciphertext` field is NOT the
 * inner AES ciphertext — it is base64 of the UTF-8 JSON of the whole
 * `EncryptedDocument` envelope. The iv, the auth tag and the signatures are
 * therefore all retrievable; they live one decoding step deeper.
 *
 * The anchored `contentHash` still covers only the inner ciphertext bytes
 * (`document.ciphertext`), so the integrity check runs on that field and not on
 * what the HTTP body called `ciphertext`.
 *
 * HARD RULE (docs/03): the API deliberately does not return the commitment
 * salt. The pharmacy recovers it from inside the decrypted document. The
 * pointer is opaque and is the only thing this adapter puts in a URL — never a
 * patient identifier, never a salt.
 */

export interface HttpDocumentAdapterOptions {
  config: PharmacyConfig;
  /** Injected for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

export function decodeStoredPayload(payload: string): EncryptedDocument {
  const json = bytesToUtf8(base64ToBytes(payload));
  return encryptedDocumentSchema.parse(JSON.parse(json)) as EncryptedDocument;
}

export function createHttpDocumentAdapter(options: HttpDocumentAdapterOptions): DocumentPort {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    async fetchEnvelope(pointer: string): Promise<EncryptedDocument> {
      const url = `${config.apiUrl}/prescriptions/${encodeURIComponent(pointer)}`;

      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { accept: 'application/json' } });
      } catch (error) {
        throw new DocumentStoreUnreachableError(config.apiUrl, { cause: error });
      }

      if (response.status === 404) {
        throw new DocumentNotFoundError(pointer);
      }

      if (!response.ok) {
        throw new DocumentStoreUnreachableError(config.apiUrl);
      }

      let body: { ciphertext?: unknown };
      try {
        body = (await response.json()) as { ciphertext?: unknown };
      } catch (error) {
        throw new MalformedEnvelopeError({ cause: error });
      }

      if (typeof body.ciphertext !== 'string') {
        throw new MalformedEnvelopeError();
      }

      try {
        return decodeStoredPayload(body.ciphertext);
      } catch (error) {
        throw new MalformedEnvelopeError({ cause: error });
      }
    },
  };
}
