import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';

import { createViemChainAdapter } from './viem-chain.adapter';
import { prescriptionRegistryAbi } from './registry-abi';
import type { PharmacyConfig } from '../config/env';

/**
 * The dispensing write is the only transaction this app ever sends, and it is
 * the one the demo rests on. `waitForTransactionReceipt` resolves for a
 * reverted transaction too, so without reading `receipt.status` a losing race
 * against another pharmacy renders the success screen — the same prescription
 * dispensed twice, in front of the jury.
 */

const CONFIG = {
  rpcUrl: 'http://localhost:8545',
  chainId: 31337,
  registryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
} as unknown as PharmacyConfig;

const CONTENT_HASH = `0x${'ab'.repeat(32)}` as const;
const PHARMACY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TX_HASH = `0x${'cd'.repeat(32)}` as const;

function adapterWith(status: 'success' | 'reverted') {
  // The adapter builds its own wallet client, so the simulated request has to be
  // encodable by viem — an empty object is not enough.
  const request = {
    address: CONFIG.registryAddress,
    abi: prescriptionRegistryAbi,
    functionName: 'dispense',
    args: [CONTENT_HASH],
    account: PHARMACY,
    chain: null,
  };

  const publicClient = {
    simulateContract: vi.fn().mockResolvedValue({ request }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status,
      blockNumber: 7n,
      transactionHash: TX_HASH,
    }),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1_757_000_000n }),
  } as unknown as PublicClient;

  // A provider that resolves every request to the dispensing transaction hash.
  const getProvider = () => ({ request: vi.fn().mockResolvedValue(TX_HASH) }) as never;

  return {
    adapter: createViemChainAdapter({ config: CONFIG, publicClient, signer: { getProvider } }),
    publicClient,
  };
}

/**
 * Corte 2 (docs/21-acceso-para-la-demo.md): the chain adapter used to import
 * `injectedProvider` and reach for `window.ethereum` on its own, so a
 * different signer implementation (the passkey swap of D-04) would never be
 * used by the one call that actually signs. This pins the fix: the adapter
 * resolves its provider through `SignerPort` alone, even with no injected
 * provider at all.
 */
describe('the write path resolves its provider through SignerPort, not window.ethereum', () => {
  it('dispenses using the stub the port supplies, with no injected provider present', async () => {
    expect(globalThis.window?.ethereum).toBeUndefined();

    const { adapter } = adapterWith('success');
    const receipt = await adapter.dispense(CONTENT_HASH, PHARMACY);

    expect(receipt.transactionHash).toBe(TX_HASH);
  });
});

describe('viem chain adapter — dispense', () => {
  it('returns the receipt when the transaction succeeded', async () => {
    const { adapter } = adapterWith('success');

    const receipt = await adapter.dispense(CONTENT_HASH, PHARMACY);

    expect(receipt.transactionHash).toBe(TX_HASH);
    expect(receipt.blockNumber).toBe(7n);
    expect(receipt.dispensedBy).toBe(PHARMACY);
  });

  it('throws instead of returning a receipt when the transaction reverted', async () => {
    const { adapter } = adapterWith('reverted');

    await expect(adapter.dispense(CONTENT_HASH, PHARMACY)).rejects.toThrow(/revirti/i);
  });

  it('does not read the block of a reverted transaction', async () => {
    const { adapter, publicClient } = adapterWith('reverted');

    await expect(adapter.dispense(CONTENT_HASH, PHARMACY)).rejects.toThrow();
    expect(publicClient.getBlock).not.toHaveBeenCalled();
  });
});
