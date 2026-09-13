import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { parseCorsOrigins, relayerConfig, type Env } from './env';
import { createDatabase, type DatabaseHandle } from './db/client';
import { healthRoutes } from './routes/health';
import { prescriptionRoutes } from './routes/prescriptions';
import { relayerRoutes } from './routes/relayer';
import { Relayer } from './relayer/relayer';
import { createViemRelayerChain } from './relayer/viem-relayer-chain';

export interface AppContext {
  app: FastifyInstance;
  database: DatabaseHandle;
}

export async function buildApp(env: Env): Promise<AppContext> {
  const database = createDatabase(env.DATABASE_URL);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Request bodies carry ciphertext and salts. Never serialise them.
      redact: ['req.headers.authorization', 'req.body', 'res.body'],
    },
    bodyLimit: 2_000_000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: parseCorsOrigins(env.CORS_ORIGIN),
    methods: ['GET', 'POST'],
  });

  await app.register(healthRoutes(database));
  await app.register(prescriptionRoutes(database));

  /**
   * THE RELAYER IS OPTIONAL AND OFF BY DEFAULT (Fase 5 item 5).
   *
   * `relayerConfig` answers only when a key, a registry and a paymaster are all
   * configured together, so this service keeps booting unchanged on a machine
   * that has none of them — which is every machine that is only running the
   * encrypted payload store. When it is off, `/relayer` is a 404 rather than a
   * route that fails on use, because a relayer that exists but cannot relay is
   * worse than one that is plainly absent.
   */
  const relayer = relayerConfig(env);

  if (relayer !== undefined) {
    await app.register(relayerRoutes(new Relayer(createViemRelayerChain(relayer), relayer), relayer));

    // The address, never the key. See `env.ts`.
    app.log.info(
      { chainId: relayer.chainId, entryPoint: relayer.entryPoint, paymaster: relayer.paymaster },
      'relayer enabled: submitting UserOperations directly to the EntryPoint (not a bundler)',
    );
  }

  app.addHook('onClose', async () => {
    await database.close();
  });

  return { app, database };
}
