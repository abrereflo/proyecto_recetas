import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { encodeErrorResult, encodeFunctionData } from 'viem';
import {
  ENTRY_POINT_V07_ADDRESS,
  entryPointV07Abi,
  prescriptionRegistryAbi,
  type PackedUserOperation,
} from '@recetas/chain';
import type { Address, Bytes32, Hex } from '@recetas/shared';
import type { RelayerConfig } from '../env';
import { prescriptionPaymasterErrorsAbi } from '../relayer/failures';
import { Relayer, type RelayerChain } from '../relayer/relayer';
import { relayerRoutes } from './relayer';

/**
 * The HTTP surface, driven through Fastify's own injector with a fake chain
 * underneath. Nothing here talks to a node and nothing signs.
 */

const REGISTRY = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365' as Address;
const PAYMASTER = `0x${'88'.repeat(20)}` as Address;
const FACTORY = `0x${'99'.repeat(20)}` as Address;
const RELAYER_ADDRESS = '0x4429d872fB9253C8516AE525b03cE06FbbbEC143' as Address;
const ACCOUNT = '0x7b33436643a681262562785C02Cba36524491042' as Address;
const CREDENTIAL_UID = `0x${'11'.repeat(32)}` as Bytes32;
const PUBLIC_KEY_X = '28573233055232466711029625910063034642429572463461595413086259353299906450061';
const PUBLIC_KEY_Y = '39367742072897599771788408398752356480431855827262528811857788332151452825281';

/** A throwaway constant. It holds nothing, on any chain. See `relayer.test.ts`. */
const THROWAWAY_KEY = `0x${'7c'.repeat(32)}` as const;

const baseConfig: RelayerConfig = {
  privateKey: THROWAWAY_KEY,
  rpcUrl: 'http://localhost:8545',
  chainId: 43113,
  entryPoint: ENTRY_POINT_V07_ADDRESS,
  registry: REGISTRY,
  paymaster: PAYMASTER,
  factory: FACTORY,
  maxFeePerGasWei: 100_000_000_000n,
  maxPrefundWei: 20_000_000_000_000_000n,
  rateLimit: 30,
  rateLimitWindowSeconds: 60,
};

const executeAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const REGISTER_CALL_DATA = encodeFunctionData({
  abi: executeAbi,
  functionName: 'execute',
  args: [
    REGISTRY,
    0n,
    encodeFunctionData({
      abi: prescriptionRegistryAbi,
      functionName: 'registerCredential',
      args: [CREDENTIAL_UID],
    }),
  ],
});

function fakeChain(simulate?: () => Promise<void>) {
  const sent: PackedUserOperation[] = [];

  const chain: RelayerChain = {
    address: RELAYER_ADDRESS,
    getBalance: async () => 3_499_000_000_000_000_000n,
    getCodeSize: async () => 0,
    getNonce: async () => 0n,
    getFees: async () => ({ baseFeePerGas: 10n, maxPriorityFeePerGas: 150n }),
    predictAccount: async () => ACCOUNT,
    getPaymasterDeposit: async () => 1_000_000_000_000_000_000n,
    simulateHandleOps: simulate ?? (async () => {}),
    sendHandleOps: async (userOp) => {
      sent.push(userOp);

      return `0x${'ab'.repeat(32)}` as Hex;
    },
  };

  return { chain, sent };
}

let app: FastifyInstance | undefined;

async function build(config: Partial<RelayerConfig> = {}, simulate?: () => Promise<void>) {
  const merged = { ...baseConfig, ...config };
  const { chain, sent } = fakeChain(simulate);

  const instance = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  instance.setValidatorCompiler(validatorCompiler);
  instance.setSerializerCompiler(serializerCompiler);
  await instance.register(relayerRoutes(new Relayer(chain, merged), merged));
  await instance.ready();

  app = instance;

  return { app: instance, sent };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /relayer', () => {
  it('says what it is, on which chain, with what left to spend', async () => {
    const { app: instance } = await build();

    const response = await instance.inject({ method: 'GET', url: '/relayer' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      address: RELAYER_ADDRESS,
      chainId: 43113,
      entryPoint: ENTRY_POINT_V07_ADDRESS,
      registry: REGISTRY,
      paymaster: PAYMASTER,
      isBundler: false,
    });
  });

  /** The key is configuration; the address is public the moment it submits. */
  it('never returns the private key', async () => {
    const { app: instance } = await build();

    const response = await instance.inject({ method: 'GET', url: '/relayer' });

    expect(response.body).not.toContain(THROWAWAY_KEY);
    expect(response.body).not.toContain(THROWAWAY_KEY.slice(2));
  });
});

describe('POST /relayer/user-operations/prepare', () => {
  it('returns the unsigned operation and the hash to sign', async () => {
    const { app: instance } = await build();

    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations/prepare',
      payload: { publicKeyX: PUBLIC_KEY_X, publicKeyY: PUBLIC_KEY_Y, callData: REGISTER_CALL_DATA },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.userOpHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.deploying).toBe(true);
    expect(body.shape).toBe('register-credential');
    expect(body.userOp.sender).toBe(ACCOUNT);
    expect(body.userOp.signature).toBe('0x');
  });

  it('refuses calldata this relayer does not carry, with a code', async () => {
    const { app: instance } = await build();

    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations/prepare',
      payload: { publicKeyX: PUBLIC_KEY_X, publicKeyY: PUBLIC_KEY_Y, callData: '0xdeadbeef' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('callData_not_execute');
  });

  it('rejects a body that is not the shape it asked for', async () => {
    const { app: instance } = await build();

    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations/prepare',
      payload: { publicKeyX: 'not a number', publicKeyY: PUBLIC_KEY_Y, callData: '0x' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /relayer/user-operations', () => {
  async function prepareOne(instance: FastifyInstance) {
    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations/prepare',
      payload: { publicKeyX: PUBLIC_KEY_X, publicKeyY: PUBLIC_KEY_Y, callData: REGISTER_CALL_DATA },
    });

    return response.json() as { userOp: Record<string, string>; userOpHash: string };
  }

  it('submits a signed operation and returns both hashes', async () => {
    const { app: instance, sent } = await build();
    const prepared = await prepareOne(instance);

    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations',
      payload: {
        userOp: { ...prepared.userOp, signature: `0x${'cd'.repeat(256)}` },
        userOpHash: prepared.userOpHash,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userOpHash: prepared.userOpHash,
      beneficiary: RELAYER_ADDRESS,
    });
    expect(sent).toHaveLength(1);
  });

  /**
   * Fase 5 item 8, all the way to the wire: the paymaster's own error, with the
   * moment sponsorship comes back, reaches the client as data rather than as
   * "AA33 reverted".
   */
  it('hands back SponsorshipExhausted with its arguments instead of an opaque failure', async () => {
    const inner = encodeErrorResult({
      abi: prescriptionPaymasterErrorsAbi,
      errorName: 'SponsorshipExhausted',
      args: [ACCOUNT, 40, 40, 1_757_600_000n],
    });

    const revert = encodeErrorResult({
      abi: entryPointV07Abi,
      errorName: 'FailedOpWithRevert',
      args: [0n, 'AA33 reverted', inner],
    });

    const { app: instance, sent } = await build({}, async () => {
      throw Object.assign(new Error('execution reverted'), { cause: { data: revert } });
    });

    const prepared = await prepareOne(instance);

    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations',
      payload: { userOp: prepared.userOp },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: 'would_revert',
      failure: {
        entryPointReason: 'AA33 reverted',
        source: 'paymaster',
        name: 'SponsorshipExhausted',
        args: { account: ACCOUNT, used: '40', limit: '40', windowEndsAt: '1757600000' },
      },
    });
    expect(sent).toHaveLength(0);
  });

  it('refuses an operation whose hash the client got wrong', async () => {
    const { app: instance } = await build();
    const prepared = await prepareOne(instance);

    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations',
      payload: { userOp: prepared.userOp, userOpHash: `0x${'00'.repeat(32)}` },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('hash_mismatch');
  });
});

/**
 * The limiter is defence (2). Simulation catches nearly everything for free,
 * but an operation that simulates clean and reverts on inclusion still bills
 * the relayer and costs the caller nothing. This is what bounds that residue.
 */
describe('the open endpoint is rate limited', () => {
  it('refuses once a caller is over the limit, and says when it reopens', async () => {
    const { app: instance } = await build({ rateLimit: 2, rateLimitWindowSeconds: 60 });

    const payload = {
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    };

    for (let i = 0; i < 2; i += 1) {
      const ok = await instance.inject({
        method: 'POST',
        url: '/relayer/user-operations/prepare',
        payload,
      });

      expect(ok.statusCode).toBe(200);
    }

    const limited = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations/prepare',
      payload,
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited', limit: 2 });
    expect(limited.json().windowEndsAt).toBeGreaterThan(0);
  });

  /**
   * Keyed by sender as well as by caller, so a distributed client cannot spend
   * one doctor's sponsorship quota faster than that doctor could.
   *
   * EVERY SUBMISSION COMES FROM ITS OWN ADDRESS, which is what makes this an
   * assertion about the sender key at all. Sharing one address — as this test
   * did — lets the ip bucket account for the 429 on its own, and the test then
   * passes unchanged with sender limiting deleted from the route.
   */
  it('counts submissions against the sender, not only against the caller', async () => {
    const { app: instance, sent } = await build({ rateLimit: 2, rateLimitWindowSeconds: 60 });
    const prepared = await prepareOne(instance);
    const submit = (remoteAddress: string) =>
      instance.inject({
        method: 'POST',
        url: '/relayer/user-operations',
        payload: { userOp: prepared.userOp },
        remoteAddress,
      });

    expect((await submit('10.0.0.1')).statusCode).toBe(200);
    expect((await submit('10.0.0.2')).statusCode).toBe(200);
    // A third fresh caller: the only budget left to exhaust is the sender's.
    expect((await submit('10.0.0.3')).statusCode).toBe(429);
    expect(sent).toHaveLength(2);
  });

  /**
   * Addresses are public and the body schema checks only hex and decimal shape,
   * so if a refused submission counted, anyone could post garbage naming a known
   * doctor's account and lock them out with a 429. The two calls come from
   * different addresses, leaving only the sender's single slot under test.
   */
  it('does not charge the sender for a submission it refused', async () => {
    let refusing = true;
    const { app: instance, sent } = await build({ rateLimit: 1 }, async () => {
      if (refusing) {
        throw Object.assign(new Error('execution reverted'), { cause: { data: '0xdeadbeef' } });
      }
    });
    const prepared = await prepareOne(instance);
    const submit = (remoteAddress: string) =>
      instance.inject({
        method: 'POST',
        url: '/relayer/user-operations',
        payload: { userOp: prepared.userOp },
        remoteAddress,
      });

    expect((await submit('10.0.0.1')).statusCode).toBe(422);

    refusing = false;

    // A 429 here would mean the refusal had spent the sender's only slot.
    expect((await submit('10.0.0.2')).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
  });

  async function prepareOne(instance: FastifyInstance) {
    const response = await instance.inject({
      method: 'POST',
      url: '/relayer/user-operations/prepare',
      payload: { publicKeyX: PUBLIC_KEY_X, publicKeyY: PUBLIC_KEY_Y, callData: REGISTER_CALL_DATA },
    });

    return response.json() as { userOp: Record<string, string>; userOpHash: string };
  }
});
