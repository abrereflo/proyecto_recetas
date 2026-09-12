import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from '@recetas/crypto';
import { encryptedDocumentSchema, type EncryptedDocument } from '@recetas/shared';

/**
 * Codec for the off-chain payload store (services/api).
 *
 * SINGLE SOURCE, and the pair that must never drift: the encoder lived in
 * apps/cli/src/storage.ts and the decoder in
 * apps/pharmacy/src/infrastructure/document/http-document.adapter.ts, one in
 * each app, each unaware of the other. They are two halves of one wire format.
 *
 * What travels in the API's `ciphertext` field is the whole sealed envelope
 * (ciphertext + iv + authTag + signatures) as base64 of its UTF-8 JSON, because
 * the pharmacy needs all of it to decrypt and to check the prescriber
 * signature, and the QR carries only the pointer (docs/03-modelo-de-datos.md).
 *
 * That field is therefore NOT the inner AES ciphertext. The anchored
 * `contentHash` still covers exactly the inner ciphertext bytes
 * (`document.ciphertext`), so the integrity check runs one decoding step deeper
 * and swapping or editing a stored row is still detected.
 *
 * HARD RULE (docs/03): the commitment salt is written to the store and never
 * read back — the API deliberately does not return it. The pharmacy recovers it
 * from inside the decrypted document, so it never appears in this codec.
 */

export function encodeStoredPayload(document: EncryptedDocument): string {
  return bytesToBase64(utf8ToBytes(JSON.stringify(document)));
}

/** Throws if the payload is not base64 of a valid `EncryptedDocument`. */
export function decodeStoredPayload(payload: string): EncryptedDocument {
  const json = bytesToUtf8(base64ToBytes(payload));
  return encryptedDocumentSchema.parse(JSON.parse(json)) as EncryptedDocument;
}
