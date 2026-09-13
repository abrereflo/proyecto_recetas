import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { numberToHex, parseTransaction, recoverTransactionAddress } from 'viem';
import type { Address } from '@recetas/shared';
import { SignerUnavailableError } from '../../ports/signer.port';
import type { PharmacyConfig } from '../config/env';
import {
  KEYSTORE_STORAGE_KEY,
  KeystoreCorruptError,
  KeystorePassphraseError,
  encryptPrivateKey,
  serialiseKeystore,
} from './keystore';
import {
  SignerLockedError,
  UnsupportedRpcMethodError,
  createLocalKeySigner,
} from './local-key-signer.adapter';

/**
 * The device-key signer, docs/23-firma-en-el-dispositivo.md.
 *
 * Anvil's first well-known development account again (see keystore.test.ts):
 * public by construction, and the only kind of account this path may ever hold.
 */

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const PASSPHRASE = 'farmacia-central-2026';

const CONFIG: PharmacyConfig = {
  apiUrl: 'http://localhost:3000',
  rpcUrl: 'http://localhost:8545',
  chainId: 43113,
  registryAddress: '0x7777777777777777777777777777777777777777',
};

const TX_HASH = `0x${'ab'.repeat(32)}` as const;

/** Derived once: PBKDF2 at 310 000 iterations is deliberately not cheap. */
let storedKeystore = '';

beforeAll(async () => {
  storedKeystore = serialiseKeystore(await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE));
});

beforeEach(() => {
  globalThis.localStorage.clear();
});

function withStoredKey(): void {
  globalThis.localStorage.setItem(KEYSTORE_STORAGE_KEY, storedKeystore);
}

interface FakeNode {
  fetchImpl: typeof globalThis.fetch;
  calls: { method: string; params: unknown[] }[];
  methodsCalled(): string[];
  paramsOf(method: string): unknown[] | undefined;
}

/**
 * A JSON-RPC node over `fetch`.
 *
 * Every read viem needs to build the transaction is answered here, so the test
 * asserts the one thing that matters: what leaves the device is a SIGNED raw
 * transaction, broadcast with `eth_sendRawTransaction`, and the key never
 * travels.
 */
function fakeNode(overrides: Record<string, unknown> = {}): FakeNode {
  const results: Record<string, unknown> = {
    eth_chainId: numberToHex(CONFIG.chainId),
    eth_getTransactionCount: '0x7',
    eth_estimateGas: '0x5208',
    eth_gasPrice: '0x3b9aca00',
    eth_maxPriorityFeePerGas: '0x3b9aca00',
    eth_getBlockByNumber: {
      baseFeePerGas: '0x3b9aca00',
      number: '0x10',
      timestamp: '0x66e00000',
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      hash: `0x${'11'.repeat(32)}`,
      transactions: [],
    },
    eth_sendRawTransaction: TX_HASH,
    ...overrides,
  };

  const calls: { method: string; params: unknown[] }[] = [];

  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params?: unknown[];
    };
    calls.push({ method: body.method, params: body.params ?? [] });

    if (!(body.method in results)) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: `unexpected method ${body.method}` },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: body.id, result: results[body.method] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  return {
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    calls,
    methodsCalled: () => calls.map((call) => call.method),
    paramsOf: (method) => calls.find((call) => call.method === method)?.params,
  };
}

function signerWith(node: FakeNode = fakeNode()) {
  return createLocalKeySigner({ config: CONFIG, fetchImpl: node.fetchImpl });
}

describe('a device with no key at all', () => {
  it('is not available, has no account and hands out no provider', async () => {
    const signer = signerWith();

    expect(signer.isAvailable()).toBe(false);
    expect(signer.hasKey()).toBe(false);
    expect(signer.getProvider()).toBeUndefined();
    await expect(signer.getAccount()).resolves.toBeNull();
  });

  it('refuses to connect with SignerUnavailableError, not with SignerLockedError', async () => {
    const error = await signerWith()
      .connect()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SignerUnavailableError);
    expect(error).not.toBeInstanceOf(SignerLockedError);
  });
});

describe('a device that has a key but has not been unlocked', () => {
  beforeEach(withStoredKey);

  it('is available: the key is here, it is only closed', () => {
    const signer = signerWith();

    expect(signer.isAvailable()).toBe(true);
    expect(signer.hasKey()).toBe(true);
    expect(signer.isUnlocked()).toBe(false);
  });

  // The distinction the access screen branches on: "there is nothing here" and
  // "there is something here and it needs a passphrase" are different problems
  // with different answers.
  it('refuses to connect with SignerLockedError, not with SignerUnavailableError', async () => {
    const error = await signerWith()
      .connect()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SignerLockedError);
    expect(error).not.toBeInstanceOf(SignerUnavailableError);
    expect((error as Error).name).toBe('SignerLockedError');
  });

  it('has no account to report until it is unlocked', async () => {
    await expect(signerWith().getAccount()).resolves.toBeNull();
  });
});

describe('unlocking', () => {
  beforeEach(withStoredKey);

  it('returns the address derived from the stored key', async () => {
    const signer = signerWith();

    await expect(signer.unlock(PASSPHRASE)).resolves.toBe(TEST_ADDRESS);
    expect(signer.isUnlocked()).toBe(true);
    await expect(signer.getAccount()).resolves.toBe(TEST_ADDRESS);
    await expect(signer.connect()).resolves.toBe(TEST_ADDRESS);
  });

  it('rejects a wrong passphrase and stays locked', async () => {
    const signer = signerWith();

    await expect(signer.unlock('contraseña-incorrecta')).rejects.toBeInstanceOf(
      KeystorePassphraseError,
    );
    expect(signer.isUnlocked()).toBe(false);
    await expect(signer.getAccount()).resolves.toBeNull();
  });

  it('reports a damaged stored blob as corrupt rather than as a wrong passphrase', async () => {
    globalThis.localStorage.setItem(KEYSTORE_STORAGE_KEY, '{ truncated');

    await expect(signerWith().unlock(PASSPHRASE)).rejects.toBeInstanceOf(KeystoreCorruptError);
  });
});

describe('lock() puts the key beyond reach again', () => {
  beforeEach(withStoredKey);

  it('leaves the signer locked, available and unable to connect', async () => {
    const signer = signerWith();
    await signer.unlock(PASSPHRASE);

    signer.lock();

    expect(signer.isUnlocked()).toBe(false);
    expect(signer.isAvailable()).toBe(true);
    await expect(signer.getAccount()).resolves.toBeNull();
    await expect(signer.connect()).rejects.toBeInstanceOf(SignerLockedError);
  });

  it('refuses to sign after locking, without touching the network', async () => {
    const node = fakeNode();
    const signer = signerWith(node);
    await signer.unlock(PASSPHRASE);
    signer.lock();

    const provider = signer.getProvider();
    await expect(
      provider?.request({
        method: 'eth_sendTransaction',
        params: [{ from: TEST_ADDRESS, to: CONFIG.registryAddress, data: '0x' }],
      }),
    ).rejects.toBeInstanceOf(SignerLockedError);

    expect(node.calls).toHaveLength(0);
  });
});

describe('enrolling a device that had no key', () => {
  it('stores the encrypted key, unlocks and returns the address', async () => {
    const signer = signerWith();

    await expect(signer.enrol(TEST_PRIVATE_KEY, PASSPHRASE)).resolves.toBe(TEST_ADDRESS);

    expect(signer.isUnlocked()).toBe(true);
    expect(signer.hasKey()).toBe(true);
    const written = globalThis.localStorage.getItem(KEYSTORE_STORAGE_KEY) ?? '';
    expect(written).not.toContain(TEST_PRIVATE_KEY.slice(2));
    expect(written).not.toContain(PASSPHRASE);
  });

  it('forgets the key on request, and locks with it', async () => {
    const signer = signerWith();
    await signer.enrol(TEST_PRIVATE_KEY, PASSPHRASE);

    signer.forget();

    expect(signer.hasKey()).toBe(false);
    expect(signer.isUnlocked()).toBe(false);
    expect(signer.isAvailable()).toBe(false);
    expect(globalThis.localStorage.getItem(KEYSTORE_STORAGE_KEY)).toBeNull();
  });
});

describe('the chain is configuration here, not a network the device is on', () => {
  beforeEach(withStoredKey);

  it('reports the configured chain id without asking anyone', async () => {
    const node = fakeNode();
    const signer = signerWith(node);

    await expect(signer.getChainId()).resolves.toBe(CONFIG.chainId);
    expect(node.calls).toHaveLength(0);
  });

  it('accepts the configured chain and refuses any other one, by name', async () => {
    const signer = signerWith();

    await expect(signer.ensureChain(CONFIG.chainId)).resolves.toBeUndefined();
    await expect(signer.ensureChain(31337)).rejects.toThrow(/31337/);
    await expect(signer.ensureChain(31337)).rejects.toThrow(new RegExp(String(CONFIG.chainId)));
  });
});

describe('the EIP-1193 shim, which is all viem needs to write', () => {
  beforeEach(withStoredKey);

  it('answers eth_accounts with the derived address once unlocked, and empty while locked', async () => {
    const signer = signerWith();
    const provider = signer.getProvider();

    await expect(provider?.request({ method: 'eth_accounts' })).resolves.toEqual([]);

    await signer.unlock(PASSPHRASE);
    await expect(provider?.request({ method: 'eth_accounts' })).resolves.toEqual([TEST_ADDRESS]);
  });

  it('answers eth_chainId with the configured chain, in hexadecimal', async () => {
    const provider = signerWith().getProvider();

    await expect(provider?.request({ method: 'eth_chainId' })).resolves.toBe(
      numberToHex(CONFIG.chainId),
    );
  });

  it('forwards eth_estimateGas to the configured node', async () => {
    const node = fakeNode();
    const signer = signerWith(node);
    await signer.unlock(PASSPHRASE);

    await expect(
      signer.getProvider()?.request({
        method: 'eth_estimateGas',
        params: [{ from: TEST_ADDRESS, to: CONFIG.registryAddress, data: '0x' }],
      }),
    ).resolves.toBe('0x5208');
    expect(node.methodsCalled()).toContain('eth_estimateGas');
  });

  it('signs eth_sendTransaction locally and broadcasts it as a raw transaction', async () => {
    const node = fakeNode();
    const signer = signerWith(node);
    await signer.unlock(PASSPHRASE);

    const hash = await signer.getProvider()?.request({
      method: 'eth_sendTransaction',
      params: [{ from: TEST_ADDRESS, to: CONFIG.registryAddress, data: '0xdeadbeef' }],
    });

    expect(hash).toBe(TX_HASH);

    const broadcast = node.paramsOf('eth_sendRawTransaction');
    const serialised = broadcast?.[0] as `0x${string}`;
    expect(serialised).toMatch(/^0x[0-9a-f]+$/);

    // What left the device is a signed transaction from this account — the key
    // itself never appeared in any request body.
    await expect(
      recoverTransactionAddress({ serializedTransaction: serialised as never }),
    ).resolves.toBe(TEST_ADDRESS);

    const parsed = parseTransaction(serialised);
    expect(parsed.to?.toLowerCase()).toBe(CONFIG.registryAddress.toLowerCase());
    expect(parsed.data).toBe('0xdeadbeef');
    expect(parsed.chainId).toBe(CONFIG.chainId);

    for (const call of node.calls) {
      expect(JSON.stringify(call)).not.toContain(TEST_PRIVATE_KEY.slice(2));
    }
  });

  it('refuses to sign for an account that is not the one on this device', async () => {
    const signer = signerWith();
    await signer.unlock(PASSPHRASE);

    await expect(
      signer.getProvider()?.request({
        method: 'eth_sendTransaction',
        params: [{ from: '0x9999999999999999999999999999999999999999', to: TEST_ADDRESS }],
      }),
    ).rejects.toThrow(/0x9999/i);
  });

  // Nothing may fail quietly: an unsupported method has to say which one it was.
  it.each(['personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain'])(
    'refuses %s with an error that names the method',
    async (method) => {
      const signer = signerWith();
      await signer.unlock(PASSPHRASE);

      const error = await signer
        .getProvider()
        ?.request({ method })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnsupportedRpcMethodError);
      expect((error as Error).message).toContain(method);
    },
  );
});
