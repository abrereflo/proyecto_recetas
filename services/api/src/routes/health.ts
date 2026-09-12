import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DatabaseHandle } from '../db/client';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptime: z.number(),
  checks: z.object({
    postgres: z.enum(['ok', 'unreachable']),
  }),
});

export function healthRoutes(database: DatabaseHandle): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/health',
      {
        schema: {
          description: 'Liveness plus a Postgres round trip.',
          response: { 200: healthResponseSchema, 503: healthResponseSchema },
        },
      },
      async (_request, reply) => {
        let postgres: 'ok' | 'unreachable' = 'ok';

        try {
          await database.ping();
        } catch (error) {
          postgres = 'unreachable';
          app.log.error({ err: error }, 'postgres health check failed');
        }

        const body = {
          status: postgres === 'ok' ? ('ok' as const) : ('degraded' as const),
          uptime: Math.round(process.uptime()),
          checks: { postgres },
        };

        return reply.status(postgres === 'ok' ? 200 : 503).send(body);
      },
    );
  };
}
