import { z } from 'zod';
import { ENTRY_POINT_V07_ADDRESS } from '@recetas/chain';
import type { Address } from '@recetas/shared';

/**
 * A 20-byte address, checked here rather than at the first RPC call.
 *
 * `PRESCRIPTION_REGISTRY_ADDRESS` used to be a bare `z.string()`, which let a
 * truncated paste through to become an opaque chain error. Every address in
 * this file goes through the same rule now.
 */
const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address')
  .transform((value) => value as Address);

/**
 * Environment contract. The process refuses to start on an invalid value rather
 * than failing later on the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),
  /** RPC endpoint. Anvil locally, Avalanche Fuji for integration. */
  RPC_URL: z.string().url().default('http://localhost:8545'),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  PRESCRIPTION_REGISTRY_ADDRESS: addressSchema.optional(),

  // --- Relayer (Fase 5 item 5) ---------------------------------------------
  //
  // ALL OPTIONAL, AND THAT IS THE POINT. This service's first duty is the
  // encrypted payload store, and it has to keep booting on a machine that has
  // no relayer key — a developer running the pharmacy flow, CI, the Docker
  // compose profile. `buildApp` registers the relayer routes only when
  // `relayerConfig` answers, and answers nothing otherwise.

  /**
   * The relayer's own key. It pays the TRANSACTION that carries a
   * `UserOperation`; the gas of the operation itself comes from the paymaster's
   * EntryPoint deposit.
   *
   * NEVER HARDCODED, NEVER LOGGED, NEVER RETURNED. `relayerConfig` keeps it in
   * one field that no route reads and no log line touches; `GET /relayer`
   * answers with the derived address only. `relayer.test.ts` and
   * `routes/relayer.test.ts` both assert that the key does not appear in what
   * the service says about itself.
   *
   * It holds test AVAX and nothing else (docs/08). A key with real funds does
   * not belong in this variable on any machine.
   */
  RELAYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex private key')
    .optional(),

  /** EntryPoint v0.7. Canonical on every chain that has it; overridable for Anvil. */
  ENTRY_POINT_ADDRESS: addressSchema.default(ENTRY_POINT_V07_ADDRESS),

  /**
   * `PasskeyAccountFactory`. Needed only to build `initCode` for an account
   * that does not exist yet. Absent means the relayer can carry a first
   * operation a client built itself, but cannot build one.
   */
  PASSKEY_ACCOUNT_FACTORY_ADDRESS: addressSchema.optional(),

  /**
   * `PrescriptionPaymaster`. THE ONE PAYMASTER THIS RELAYER WILL CARRY.
   *
   * Not a convenience: it is the check that bounds the money flow. See the
   * exposure note in `relayer.ts`.
   */
  PRESCRIPTION_PAYMASTER_ADDRESS: addressSchema.optional(),

  /**
   * Ceiling on `maxFeePerGas`, in wei. Fuji's base fee is dynamic and this is
   * what stops a fee spike from turning one submission into a large bill.
   * Default: 100 nAVAX, four times the 25 nAVAX that
   * `PrescriptionPaymaster`'s own docblock uses for its worked example.
   */
  RELAYER_MAX_FEE_PER_GAS_WEI: z.coerce.bigint().positive().default(100_000_000_000n),

  /**
   * Ceiling on one operation's required prefund, in wei. Mirrors the
   * paymaster's `maxCostPerOp` so the relayer can refuse an over-budget
   * operation with a sentence instead of forwarding it to be refused as
   * `AA33 reverted` wrapping `CostNotSponsored`.
   *
   * Default: 0.06 AVAX. This mirrors the paymaster's corrected recommendation
   * and NOT its earlier 0.02, which was sized from a guess of 800k gas. A
   * deploying operation reserves over 1.8M, so a 0.02 ceiling here would refuse
   * every doctor's first operation at any fee near 25 nAVAX — and the first
   * operation is the one that makes the account exist. See the constructor
   * docblock of `PrescriptionPaymaster` and `gas-policy.test.ts`.
   *
   * Keep this at or below the deployed paymaster's `maxCostPerOp`: its job is
   * to turn a refusal the paymaster would make anyway into a sentence the
   * doctor can read, not to permit anything the paymaster would not.
   */
  RELAYER_MAX_PREFUND_WEI: z.coerce.bigint().positive().default(60_000_000_000_000_000n),

  /** Submissions allowed per key per window. See `rate-limit.ts`. */
  RELAYER_RATE_LIMIT: z.coerce.number().int().positive().default(30),

  /** Length of that window, in seconds. */
  RELAYER_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

/**
 * Everything the relayer needs, or nothing at all.
 *
 * The relayer is OFF unless three things are configured together: a key to
 * submit with, a registry whose calls are the only ones worth carrying, and a
 * paymaster to name in `paymasterAndData`. Any one of them missing is not a
 * degraded relayer, it is a relayer that would either fail on the first request
 * or spend the relayer's own AVAX with nothing bounding it — so the routes are
 * not registered at all and `GET /relayer` is a 404.
 *
 * THE PAYMASTER IS PART OF THE MINIMUM ON PURPOSE. A relayer that carried
 * unsponsored operations would be paying the transaction gas for an operation
 * whose sender pays the EntryPoint from its own deposit, and nothing in that
 * chain reimburses the relayer. See the exposure note in `relayer.ts`.
 */
export interface RelayerConfig {
  /** Never logged, never serialised. See `RELAYER_PRIVATE_KEY`. */
  privateKey: `0x${string}`;
  rpcUrl: string;
  chainId: number;
  entryPoint: Address;
  registry: Address;
  paymaster: Address;
  factory?: Address;
  maxFeePerGasWei: bigint;
  maxPrefundWei: bigint;
  rateLimit: number;
  rateLimitWindowSeconds: number;
}

export function relayerConfig(env: Env): RelayerConfig | undefined {
  if (
    env.RELAYER_PRIVATE_KEY === undefined ||
    env.PRESCRIPTION_REGISTRY_ADDRESS === undefined ||
    env.PRESCRIPTION_PAYMASTER_ADDRESS === undefined
  ) {
    return undefined;
  }

  return {
    privateKey: env.RELAYER_PRIVATE_KEY as `0x${string}`,
    rpcUrl: env.RPC_URL,
    chainId: env.CHAIN_ID,
    entryPoint: env.ENTRY_POINT_ADDRESS,
    registry: env.PRESCRIPTION_REGISTRY_ADDRESS,
    paymaster: env.PRESCRIPTION_PAYMASTER_ADDRESS,
    ...(env.PASSKEY_ACCOUNT_FACTORY_ADDRESS === undefined
      ? {}
      : { factory: env.PASSKEY_ACCOUNT_FACTORY_ADDRESS }),
    maxFeePerGasWei: env.RELAYER_MAX_FEE_PER_GAS_WEI,
    maxPrefundWei: env.RELAYER_MAX_PREFUND_WEI,
    rateLimit: env.RELAYER_RATE_LIMIT,
    rateLimitWindowSeconds: env.RELAYER_RATE_LIMIT_WINDOW_SECONDS,
  };
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
