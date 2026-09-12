import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  /** Round trip to Postgres. Used by GET /health. */
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async ping() {
      const result = await pool.query('SELECT 1 AS ok');
      return result.rows.length === 1;
    },
    async close() {
      await pool.end();
    },
  };
}
