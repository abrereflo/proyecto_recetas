import { z } from 'zod';
import type { Address } from '@recetas/shared';

/**
 * Typed, validated access to the `VITE_*` variables (root `env.example`).
 *
 * Mirrors apps/pharmacy/src/infrastructure/config/env.ts deliberately: both
 * applications read the same four variables out of the same root `.env`, and a
 * second, differently-shaped configuration reader would be one more place for
 * the two apps to disagree about what a valid deployment looks like.
 *
 * Validation runs at module load, but it NEVER throws on import.
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol runs, and an app that crashes while loading its
 * own bundle cannot render the message explaining why. The result is therefore
 * a value the UI can branch on; `loadDoctorConfig()` is the throwing variant
 * for call sites that already know the config is good.
 *
 * The Vite dev server reads the root `.env` because `vite.config.ts` points
 * `envDir` at the workspace root. Without that line no `VITE_*` variable
 * reaches this app at all.
 */

export interface DoctorConfig {
  /** Off-chain encrypted payload store, without a trailing slash. */
  apiUrl: string;
  rpcUrl: string;
  chainId: number;
  registryAddress: Address;
}

/** A named, catchable configuration problem the UI can render verbatim. */
export class ConfigurationError extends Error {
  constructor(
    /** The `VITE_*` name the operator has to fix. */
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export type DoctorConfigResult =
  | { ok: true; config: DoctorConfig }
  | { ok: false; error: ConfigurationError };

/** Shape of the environment this app reads. Every value arrives as a string. */
export type DoctorEnv = Record<string, string | boolean | undefined>;

const urlSchema = z.string().trim().min(1).url();
const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'no es una dirección de 20 bytes');
const chainIdSchema = z.coerce.number().int().positive();

interface Rule {
  variable: string;
  /** Actionable, in the operator's language. */
  hint: string;
  schema: z.ZodType<unknown>;
}

const RULES = {
  apiUrl: {
    variable: 'VITE_API_URL',
    hint: 'Debe ser la URL del almacén de recetas, por ejemplo http://localhost:3000.',
    schema: urlSchema,
  },
  rpcUrl: {
    variable: 'VITE_RPC_URL',
    hint: 'Debe ser la URL del nodo RPC, por ejemplo http://localhost:8545.',
    schema: urlSchema,
  },
  chainId: {
    variable: 'VITE_CHAIN_ID',
    hint: 'Debe ser el identificador numérico de la cadena, por ejemplo 43113 en Avalanche Fuji.',
    schema: chainIdSchema,
  },
  registryAddress: {
    variable: 'VITE_PRESCRIPTION_REGISTRY_ADDRESS',
    // Blank in env.example on purpose: the contract is not deployed yet.
    hint:
      'Debe ser la dirección del contrato PrescriptionRegistry ya desplegado. ' +
      'Está vacía hasta que se ejecute contracts/script/Deploy.s.sol.',
    schema: addressSchema,
  },
} as const satisfies Record<keyof DoctorConfig, Rule>;

function read<T>(env: DoctorEnv, rule: Rule): T {
  const raw = env[rule.variable];
  const value = typeof raw === 'string' ? raw.trim() : raw;

  if (value === undefined || value === '') {
    throw new ConfigurationError(
      rule.variable,
      `Falta la variable de entorno ${rule.variable}. ${rule.hint}`,
    );
  }

  const parsed = rule.schema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigurationError(
      rule.variable,
      `La variable de entorno ${rule.variable} no es válida. ${rule.hint}`,
    );
  }

  return parsed.data as T;
}

/** Parses the environment, throwing a `ConfigurationError` on the first gap. */
export function loadDoctorConfig(env: DoctorEnv = importMetaEnv()): DoctorConfig {
  return {
    apiUrl: read<string>(env, RULES.apiUrl).replace(/\/+$/, ''),
    rpcUrl: read<string>(env, RULES.rpcUrl),
    chainId: read<number>(env, RULES.chainId),
    registryAddress: read<string>(env, RULES.registryAddress) as Address,
  };
}

/** Non-throwing variant. This is what screens should branch on. */
export function readDoctorConfig(env: DoctorEnv = importMetaEnv()): DoctorConfigResult {
  try {
    return { ok: true, config: loadDoctorConfig(env) };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return { ok: false, error };
    }
    throw error;
  }
}

function importMetaEnv(): DoctorEnv {
  return import.meta.env as unknown as DoctorEnv;
}

/**
 * Evaluated once at module load, so a misconfigured deployment is known before
 * the first screen renders — and still without throwing during import.
 */
export const doctorConfigResult: DoctorConfigResult = readDoctorConfig();
