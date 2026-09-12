-- Initial migration: off-chain encrypted payload store (docs/05, D-08).
--
-- This table holds bytes the service cannot read. No patient identifier and no
-- plaintext clinical field may ever be added to it.
--
-- Keep this file in sync with src/db/schema.ts: `pnpm db:generate` regenerates
-- migrations from the schema, `pnpm db:push` applies the schema directly (the
-- fast path for local development).
CREATE TABLE IF NOT EXISTS "prescriptions" (
	"pointer" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
