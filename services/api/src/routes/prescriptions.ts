import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DatabaseHandle } from '../db/client';
import { prescriptions } from '../db/schema';

/**
 * The encrypted payload store.
 *
 * This service never sees plaintext and never sees the DEK. It stores bytes it
 * cannot read and hands back an opaque pointer. Losing this database does not
 * break verification of what the chain already anchored; it breaks retrieval.
 */

/** 128 bits of entropy, base64url. Opaque and unguessable, not an identifier. */
const POINTER_BYTES = 16;

function newPointer(): string {
  return randomBytes(POINTER_BYTES).toString('base64url');
}

const pointerSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'pointer must be base64url');

const createPrescriptionBodySchema = z.object({
  /** base64 of the AES-256-GCM ciphertext. */
  ciphertext: z.string().min(1).max(1_000_000),
  /** Hex of the per-prescription commitment salt (32 bytes). */
  salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'salt must be 0x-prefixed 32-byte hex'),
});

const createPrescriptionResponseSchema = z.object({
  pointer: pointerSchema,
  createdAt: z.string(),
});

const readPrescriptionResponseSchema = z.object({
  pointer: pointerSchema,
  ciphertext: z.string(),
  createdAt: z.string(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export function prescriptionRoutes(database: DatabaseHandle): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/prescriptions',
      {
        schema: {
          description: 'Store an encrypted prescription payload and return an opaque pointer.',
          body: createPrescriptionBodySchema,
          response: { 201: createPrescriptionResponseSchema },
        },
      },
      async (request, reply) => {
        const { ciphertext, salt } = request.body;
        const pointer = newPointer();

        const [row] = await database.db
          .insert(prescriptions)
          .values({ pointer, ciphertext, salt })
          .returning();

        if (row === undefined) {
          throw new Error('insert returned no row');
        }

        // Never log the salt or the ciphertext.
        request.log.info({ pointer }, 'stored encrypted prescription payload');

        return reply.status(201).send({
          pointer: row.pointer,
          createdAt: row.createdAt.toISOString(),
        });
      },
    );

    app.get(
      '/prescriptions/:pointer',
      {
        schema: {
          description: 'Fetch the ciphertext for an opaque pointer.',
          params: z.object({ pointer: pointerSchema }),
          response: { 200: readPrescriptionResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request, reply) => {
        const { pointer } = request.params;

        const [row] = await database.db
          .select({
            pointer: prescriptions.pointer,
            ciphertext: prescriptions.ciphertext,
            createdAt: prescriptions.createdAt,
          })
          .from(prescriptions)
          .where(eq(prescriptions.pointer, pointer))
          .limit(1);

        if (row === undefined) {
          return reply.status(404).send({
            error: 'not_found',
            message: 'No encrypted payload for that pointer.',
          });
        }

        // The salt is deliberately NOT selected and NOT returned: it stays in
        // the store. If it leaked, the on-chain commitment would stop
        // protecting the patient (docs/03-modelo-de-datos.md).
        return reply.status(200).send({
          pointer: row.pointer,
          ciphertext: row.ciphertext,
          createdAt: row.createdAt.toISOString(),
        });
      },
    );
  };
}
