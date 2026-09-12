import { encodeStoredPayload } from '@recetas/chain';
import {
  DocumentStoreRejectedError,
  DocumentStoreUnreachableError,
  MalformedStoreResponseError,
  type DocumentPort,
  type StoredEnvelope,
  type StoreEnvelopeInput,
} from '../../ports/document.port';
import type { DoctorConfig } from '../config/env';

/**
 * `DocumentPort` over `POST /prescriptions` (services/api).
 *
 * VERIFIED against services/api/src/routes/prescriptions.ts: the body is
 * `{ ciphertext, salt }` and the 201 answer is `{ pointer, createdAt }`. The
 * route takes no credentials — the store holds bytes it cannot read and hands
 * back an opaque pointer (docs/05).
 *
 * The `ciphertext` field is NOT the inner AES ciphertext: it is
 * `encodeStoredPayload(envelope)`, base64 of the UTF-8 JSON of the whole sealed
 * envelope, because the pharmacy needs the iv, the auth tag and the signatures
 * to open and verify it. The encoder comes from @recetas/chain, where it sits
 * next to the decoder apps/pharmacy reads it back with; the two are halves of
 * one wire format and must never drift.
 *
 * HARD RULE (docs/03): the salt is WRITTEN here and never read back — the API
 * deliberately does not return it. The only thing this adapter puts in a URL is
 * the collection path: never a patient identifier, never a salt, never a key.
 */

export interface HttpDocumentAdapterOptions {
  config: DoctorConfig;
  /** Injected for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

export function createHttpDocumentAdapter(options: HttpDocumentAdapterOptions): DocumentPort {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    async storeEnvelope({ document, saltHex }: StoreEnvelopeInput): Promise<StoredEnvelope> {
      const url = `${config.apiUrl}/prescriptions`;

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ ciphertext: encodeStoredPayload(document), salt: saltHex }),
        });
      } catch (error) {
        throw new DocumentStoreUnreachableError(config.apiUrl, { cause: error });
      }

      if (response.status !== 201) {
        throw new DocumentStoreRejectedError(response.status);
      }

      let body: { pointer?: unknown; createdAt?: unknown };
      try {
        body = (await response.json()) as { pointer?: unknown; createdAt?: unknown };
      } catch (error) {
        throw new MalformedStoreResponseError({ cause: error });
      }

      if (typeof body.pointer !== 'string' || body.pointer.length === 0) {
        // Without a pointer there is nothing to put in the QR, and anchoring
        // now would produce a receta that verifies on chain and cannot be read.
        throw new MalformedStoreResponseError();
      }

      return {
        pointer: body.pointer,
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
      };
    },
  };
}
