import { describe, expect, it, vi } from 'vitest';
import { decodeStoredPayload, encodeStoredPayload } from '@recetas/chain';
import { saltToHex } from '@recetas/crypto';
import {
  DocumentStoreRejectedError,
  DocumentStoreUnreachableError,
  MalformedStoreResponseError,
} from '../../ports/document.port';
import { CONFIG, POINTER, SALT_BYTES, anEnvelope } from '../../test/fixtures';
import { createHttpDocumentAdapter } from './http-document.adapter';

/**
 * The WRITE half of the off-chain store (services/api), verified against
 * services/api/src/routes/prescriptions.ts.
 */

const SALT_HEX = saltToHex(SALT_BYTES);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterWith(fetchImpl: typeof fetch): ReturnType<typeof createHttpDocumentAdapter> {
  return createHttpDocumentAdapter({ config: CONFIG, fetchImpl });
}

describe('storing a sealed envelope', () => {
  it('posts to /prescriptions and returns the pointer the QR carries', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { pointer: POINTER, createdAt: '2026-09-11T13:41:00.000Z' }),
    );

    const stored = await adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
      document: anEnvelope(),
      saltHex: SALT_HEX,
    });

    expect(stored).toEqual({ pointer: POINTER, createdAt: '2026-09-11T13:41:00.000Z' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/prescriptions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends the WHOLE envelope under ciphertext, the way the pharmacy reads it back', async () => {
    const envelope = anEnvelope();
    let body: { ciphertext?: string; salt?: string } = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as { ciphertext?: string; salt?: string };
      return jsonResponse(201, { pointer: POINTER, createdAt: '2026-09-11T13:41:00.000Z' });
    });

    await adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
      document: envelope,
      saltHex: SALT_HEX,
    });

    expect(body.ciphertext).toBe(encodeStoredPayload(envelope));
    // The round trip the pharmacy performs must recover the same envelope.
    expect(decodeStoredPayload(body.ciphertext ?? '')).toEqual(envelope);
    expect(body.salt).toBe(SALT_HEX);
  });

  /** HARD RULE (docs/03): the salt goes in the BODY and never in a URL. */
  it('puts nothing but the collection path in the URL', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:3000/prescriptions');
      expect(url).not.toContain(SALT_HEX.slice(2));
      return jsonResponse(201, { pointer: POINTER, createdAt: '2026-09-11T13:41:00.000Z' });
    });

    await adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
      document: anEnvelope(),
      saltHex: SALT_HEX,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reports an unreachable store without inventing a pointer', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('failed to fetch');
    });

    await expect(
      adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
        document: anEnvelope(),
        saltHex: SALT_HEX,
      }),
    ).rejects.toBeInstanceOf(DocumentStoreUnreachableError);
  });

  it('reports a refusal with the status the store answered', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(413, { error: 'too large' }));

    await expect(
      adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
        document: anEnvelope(),
        saltHex: SALT_HEX,
      }),
    ).rejects.toMatchObject({ name: 'DocumentStoreRejectedError', status: 413 });
  });

  it('treats a 200 as a refusal: only 201 means the payload was stored', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { pointer: POINTER }));

    await expect(
      adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
        document: anEnvelope(),
        saltHex: SALT_HEX,
      }),
    ).rejects.toBeInstanceOf(DocumentStoreRejectedError);
  });

  it('refuses a 201 that carries no usable pointer', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { createdAt: 'now' }));

    await expect(
      adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
        document: anEnvelope(),
        saltHex: SALT_HEX,
      }),
    ).rejects.toBeInstanceOf(MalformedStoreResponseError);
  });

  it('refuses a 201 whose body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 201 }));

    await expect(
      adapterWith(fetchImpl as unknown as typeof fetch).storeEnvelope({
        document: anEnvelope(),
        saltHex: SALT_HEX,
      }),
    ).rejects.toBeInstanceOf(MalformedStoreResponseError);
  });
});
