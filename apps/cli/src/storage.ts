import { decodeStoredPayload, encodeStoredPayload } from '@recetas/chain';
import type { EncryptedDocument } from '@recetas/shared';
import type { CliConfig } from './config';

/**
 * Client for the off-chain encrypted payload store (services/api).
 *
 * The payload codec itself lives in @recetas/chain: the encoder was here and
 * the decoder was in apps/pharmacy, two halves of one wire format sitting in
 * different applications with nothing keeping them in step.
 *
 * The salt is written here and never read back: the API deliberately does not
 * return it (hard rule, docs/03). The pharmacy recovers it from inside the
 * decrypted document.
 */

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      `No hay respuesta del almacén off-chain en ${url}. ` +
        'Arranque la API con: corepack pnpm --filter "@recetas/api" exec tsx src/server.ts',
    );
  }
}

/** Stores the sealed envelope and returns the opaque pointer that goes in the QR. */
export async function storeEnvelope(
  config: CliConfig,
  document: EncryptedDocument,
  saltHex: string,
): Promise<string> {
  const response = await request(`${config.apiUrl}/prescriptions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext: encodeStoredPayload(document), salt: saltHex }),
  });

  if (response.status !== 201) {
    throw new Error(
      `El almacén rechazó el payload cifrado (HTTP ${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { pointer?: unknown };
  if (typeof body.pointer !== 'string') {
    throw new Error('El almacén no devolvió un puntero válido.');
  }

  return body.pointer;
}

/** Downloads the sealed envelope for a pointer. */
export async function fetchEnvelope(
  config: CliConfig,
  pointer: string,
): Promise<EncryptedDocument> {
  const response = await request(
    `${config.apiUrl}/prescriptions/${encodeURIComponent(pointer)}`,
  );

  if (response.status === 404) {
    throw new Error(
      'El almacén off-chain no tiene ningún documento para este puntero. ' +
        'El QR apunta a un contenido que ya no existe.',
    );
  }

  if (!response.ok) {
    throw new Error(
      `El almacén off-chain devolvió HTTP ${response.status} al recuperar el documento.`,
    );
  }

  const body = (await response.json()) as { ciphertext?: unknown };
  if (typeof body.ciphertext !== 'string') {
    throw new Error('El almacén devolvió una respuesta sin contenido cifrado.');
  }

  try {
    return decodeStoredPayload(body.ciphertext);
  } catch {
    throw new Error('El contenido almacenado no tiene la forma de un sobre cifrado válido.');
  }
}

/** Fails early with a readable message instead of halfway through the flow. */
export async function assertStoreReachable(config: CliConfig): Promise<void> {
  const response = await request(`${config.apiUrl}/health`);
  if (!response.ok) {
    throw new Error(`El almacén off-chain responde HTTP ${response.status} en /health.`);
  }
}
