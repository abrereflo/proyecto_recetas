import { describe, expect, it } from 'vitest';
import { ENTRY_POINT_V07_ADDRESS } from '@recetas/chain';
import { loadEnv, parseCorsOrigins, relayerConfig } from './env';

/**
 * The configuration contract. The process refuses to start on an invalid value
 * rather than failing later on the first request — and, for the relayer, it
 * refuses to start a relayer that could not do its job.
 */

const REGISTRY = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365';
const PAYMASTER = `0x${'88'.repeat(20)}`;
const FACTORY = `0x${'99'.repeat(20)}`;
/** A throwaway constant. It holds nothing, on any chain. */
const THROWAWAY_KEY = `0x${'7c'.repeat(32)}`;

const minimal = { DATABASE_URL: 'postgres://user:pass@localhost:5432/db' };

describe('the base contract still holds', () => {
  it('accepts the minimum and fills in the defaults', () => {
    const env = loadEnv(minimal);

    expect(env.API_PORT).toBe(3000);
    expect(env.CHAIN_ID).toBe(31337);
    expect(env.NODE_ENV).toBe('development');
  });

  it('refuses a missing database url rather than failing on the first request', () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment configuration/);
  });

  it('splits the cors origins', () => {
    expect(parseCorsOrigins('http://a, http://b ,')).toEqual(['http://a', 'http://b']);
  });
});

describe('addresses are checked here, not at the first RPC call', () => {
  it('refuses a truncated registry address', () => {
    expect(() => loadEnv({ ...minimal, PRESCRIPTION_REGISTRY_ADDRESS: '0xD5F2' })).toThrow(
      /20-byte address/,
    );
  });

  it('defaults the EntryPoint to the canonical v0.7 address', () => {
    expect(loadEnv(minimal).ENTRY_POINT_ADDRESS).toBe(ENTRY_POINT_V07_ADDRESS);
  });

  it('allows the EntryPoint to be overridden, for a local chain', () => {
    const env = loadEnv({ ...minimal, ENTRY_POINT_ADDRESS: FACTORY });

    expect(env.ENTRY_POINT_ADDRESS).toBe(FACTORY);
  });
});

describe('the relayer key', () => {
  it('refuses anything that is not a 32-byte hex key', () => {
    expect(() => loadEnv({ ...minimal, RELAYER_PRIVATE_KEY: 'hunter2' })).toThrow(
      /32-byte hex private key/,
    );

    expect(() => loadEnv({ ...minimal, RELAYER_PRIVATE_KEY: `0x${'7c'.repeat(31)}` })).toThrow(
      /32-byte hex private key/,
    );
  });

  it('accepts a well-formed one', () => {
    expect(loadEnv({ ...minimal, RELAYER_PRIVATE_KEY: THROWAWAY_KEY }).RELAYER_PRIVATE_KEY).toBe(
      THROWAWAY_KEY,
    );
  });
});

/**
 * THE RELAYER IS OFF UNLESS THREE THINGS ARE CONFIGURED TOGETHER. A key with no
 * paymaster is a relayer that pays transaction fees to carry operations nobody
 * reimburses it for; a paymaster with no key is a relayer that cannot submit.
 * Neither is a degraded relayer, so neither starts one.
 */
describe('when the relayer turns on, and when it stays off', () => {
  it('stays off with nothing configured, so the payload store boots unchanged', () => {
    expect(relayerConfig(loadEnv(minimal))).toBeUndefined();
  });

  it('stays off with a key but no paymaster', () => {
    const env = loadEnv({
      ...minimal,
      RELAYER_PRIVATE_KEY: THROWAWAY_KEY,
      PRESCRIPTION_REGISTRY_ADDRESS: REGISTRY,
    });

    expect(relayerConfig(env)).toBeUndefined();
  });

  it('stays off with a paymaster but no key', () => {
    const env = loadEnv({
      ...minimal,
      PRESCRIPTION_REGISTRY_ADDRESS: REGISTRY,
      PRESCRIPTION_PAYMASTER_ADDRESS: PAYMASTER,
    });

    expect(relayerConfig(env)).toBeUndefined();
  });

  it('turns on when the key, the registry and the paymaster are all there', () => {
    const env = loadEnv({
      ...minimal,
      RPC_URL: 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
      CHAIN_ID: '43113',
      RELAYER_PRIVATE_KEY: THROWAWAY_KEY,
      PRESCRIPTION_REGISTRY_ADDRESS: REGISTRY,
      PRESCRIPTION_PAYMASTER_ADDRESS: PAYMASTER,
      PASSKEY_ACCOUNT_FACTORY_ADDRESS: FACTORY,
    });

    expect(relayerConfig(env)).toMatchObject({
      chainId: 43113,
      registry: REGISTRY,
      paymaster: PAYMASTER,
      factory: FACTORY,
      entryPoint: ENTRY_POINT_V07_ADDRESS,
    });
  });

  it('turns on without a factory, and then cannot prepare a first operation', () => {
    const env = loadEnv({
      ...minimal,
      RELAYER_PRIVATE_KEY: THROWAWAY_KEY,
      PRESCRIPTION_REGISTRY_ADDRESS: REGISTRY,
      PRESCRIPTION_PAYMASTER_ADDRESS: PAYMASTER,
    });

    expect(relayerConfig(env)?.factory).toBeUndefined();
  });
});

describe('the ceilings that bound what one submission can cost', () => {
  it('defaults the fee ceiling to 100 nAVAX', () => {
    expect(loadEnv(minimal).RELAYER_MAX_FEE_PER_GAS_WEI).toBe(100_000_000_000n);
  });

  /** The value `PrescriptionPaymaster`'s own docblock recommends for `maxCostPerOp`. */
  it('defaults the prefund ceiling to 0.06 AVAX, enough for a deploying operation', () => {
    expect(loadEnv(minimal).RELAYER_MAX_PREFUND_WEI).toBe(60_000_000_000_000_000n);
  });

  it('takes both from configuration', () => {
    const env = loadEnv({
      ...minimal,
      RELAYER_MAX_FEE_PER_GAS_WEI: '5000',
      RELAYER_MAX_PREFUND_WEI: '6000',
    });

    expect(env.RELAYER_MAX_FEE_PER_GAS_WEI).toBe(5_000n);
    expect(env.RELAYER_MAX_PREFUND_WEI).toBe(6_000n);
  });

  it('refuses a ceiling of zero, which would refuse every operation', () => {
    expect(() => loadEnv({ ...minimal, RELAYER_MAX_PREFUND_WEI: '0' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('defaults the rate limit to 30 per minute', () => {
    const env = loadEnv(minimal);

    expect(env.RELAYER_RATE_LIMIT).toBe(30);
    expect(env.RELAYER_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });
});
