import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, generateDek, sealDocument, utf8ToBytes } from '@recetas/crypto';
import type { EncryptedDocument } from '@recetas/shared';
import {
  DocumentNotFoundError,
  DocumentStoreUnreachableError,
  MalformedEnvelopeError,
} from '../../ports/document.port';
import { PRESCRIBER, aDocument } from '../../test/fixtures';
import type { PharmacyConfig } from '../config/env';
import { createHttpDocumentAdapter, decodeStoredPayload } from './http-document.adapter';

/**
 * VERIFIED against services/api/src/routes/prescriptions.ts: the response body
 * is `{ pointer, ciphertext, createdAt }` and its `ciphertext` field carries
 * the WHOLE envelope as base64 JSON, not the inner AES ciphertext.
 */

const CONFIG: PharmacyConfig = {
  apiUrl: 'http://localhost:3000',
  rpcUrl: 'http://localhost:8545',
  chainId: 31337,
  registryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
};

async function anEnvelope(): Promise<EncryptedDocument> {
  const { document } = await sealDocument(aDocument(), generateDek(), {
    sign: () => ({ eip712: { signer: PRESCRIBER, value: `0x${'ab'.repeat(65)}` } }),
  });
  return document;
}

function storedPayload(envelope: EncryptedDocument): string {
  return bytesToBase64(utf8ToBytes(JSON.stringify(envelope)));
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('a stored envelope', () => {
  it('parses the doubly-encoded payload back into the full envelope', async () => {
    const envelope = await anEnvelope();
    const fetchImpl = vi.fn(async () =>
      respond(200, {
        pointer: 'PT0000000000000000000A',
        ciphertext: storedPayload(envelope),
        createdAt: '2026-09-11T13:41:00.000Z',
      }),
    );

    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });
    const result = await adapter.fetchEnvelope('PT0000000000000000000A');

    // The iv, the auth tag and the signatures ARE retrievable: they live one
    // decoding step below the field the HTTP body calls `ciphertext`.
    expect(result).toEqual(envelope);
    expect(result.encryption.iv.length).toBeGreaterThan(0);
    expect(result.encryption.authTag.length).toBeGreaterThan(0);
    expect(result.signatures.eip712.signer).toBe(PRESCRIBER);
  });

  it('puts only the opaque pointer in the URL', async () => {
    const envelope = await anEnvelope();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      respond(200, { pointer: 'p', ciphertext: storedPayload(envelope), createdAt: 'x' }),
    );

    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });
    await adapter.fetchEnvelope('PT0000000000000000000A');

    const url = fetchImpl.mock.calls[0]?.[0];
    expect(url).toBe('http://localhost:3000/prescriptions/PT0000000000000000000A');
  });

  it('escapes the pointer instead of concatenating it raw', async () => {
    const envelope = await anEnvelope();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      respond(200, { pointer: 'p', ciphertext: storedPayload(envelope), createdAt: 'x' }),
    );

    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });
    await adapter.fetchEnvelope('a/../b');

    const url = fetchImpl.mock.calls[0]?.[0];
    expect(url).toBe('http://localhost:3000/prescriptions/a%2F..%2Fb');
  });
});

describe('failures', () => {
  it('turns a 404 into DocumentNotFoundError', async () => {
    const fetchImpl = vi.fn(async () => respond(404, { error: 'not_found', message: 'x' }));
    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });

    await expect(adapter.fetchEnvelope('missing')).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it('turns a transport failure into DocumentStoreUnreachableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });

    await expect(adapter.fetchEnvelope('p')).rejects.toBeInstanceOf(DocumentStoreUnreachableError);
  });

  it('turns a 500 into DocumentStoreUnreachableError', async () => {
    const fetchImpl = vi.fn(async () => respond(500, { error: 'boom', message: 'x' }));
    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });

    await expect(adapter.fetchEnvelope('p')).rejects.toBeInstanceOf(DocumentStoreUnreachableError);
  });

  it('rejects a body without a ciphertext field', async () => {
    const fetchImpl = vi.fn(async () => respond(200, { pointer: 'p', createdAt: 'x' }));
    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });

    await expect(adapter.fetchEnvelope('p')).rejects.toBeInstanceOf(MalformedEnvelopeError);
  });

  it('rejects a payload that is not a sealed envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(200, {
        pointer: 'p',
        ciphertext: bytesToBase64(utf8ToBytes('{"nope":true}')),
        createdAt: 'x',
      }),
    );
    const adapter = createHttpDocumentAdapter({ config: CONFIG, fetchImpl: fetchImpl as never });

    await expect(adapter.fetchEnvelope('p')).rejects.toBeInstanceOf(MalformedEnvelopeError);
  });
});

describe('decodeStoredPayload', () => {
  it('round-trips what apps/cli/src/storage.ts writes', async () => {
    const envelope = await anEnvelope();
    expect(decodeStoredPayload(storedPayload(envelope))).toEqual(envelope);
  });
});
