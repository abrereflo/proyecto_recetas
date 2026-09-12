import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { parseCorsOrigins, type Env } from './env';
import { createDatabase, type DatabaseHandle } from './db/client';
import { healthRoutes } from './routes/health';
import { prescriptionRoutes } from './routes/prescriptions';

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

  app.addHook('onClose', async () => {
    await database.close();
  });

  return { app, database };
}
