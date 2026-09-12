import { describe, expect, it, vi } from 'vitest';
import type { Account, PublicClient, WalletClient } from 'viem';

import { dispenseOnChain, issueOnChain } from './registry';
import type { CliConfig } from './config';

/**
 * `waitForTransactionReceipt` resolves for a reverted transaction just as it
 * does for a mined one: the verdict lives in `receipt.status`, never in the
 * absence of a throw. A dispensation that reverted on-chain and printed as a
 * success is the exact opposite of what this project exists to demonstrate.
 */

const CONFIG: CliConfig = {
  rpcUrl: 'http://localhost:8545',
  chainId: 31337,
  registryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  apiUrl: 'http://localhost:3000',
};

const CONTENT_HASH = `0x${'11'.repeat(32)}` as const;
const COMMITMENT = `0x${'22'.repeat(32)}` as const;
const TX_HASH = `0x${'33'.repeat(32)}` as const;

function clients(status: 'success' | 'reverted') {
  const publicClient = {
    simulateContract: vi.fn().mockResolvedValue({ request: {} }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status,
      blockNumber: 42n,
      gasUsed: 21_000n,
      transactionHash: TX_HASH,
    }),
  } as unknown as PublicClient;

  const walletClient = {
    writeContract: vi.fn().mockResolvedValue(TX_HASH),
  } as unknown as WalletClient;

  return { publicClient, walletClient };
}

const ACCOUNT = { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' } as unknown as Account;

describe('dispenseOnChain', () => {
  it('returns the outcome when the receipt reports success', async () => {
    const { publicClient, walletClient } = clients('success');

    const outcome = await dispenseOnChain(publicClient, walletClient, ACCOUNT, CONFIG, CONTENT_HASH);

    expect(outcome.hash).toBe(TX_HASH);
    expect(outcome.blockNumber).toBe(42n);
  });

  it('throws instead of reporting success when the transaction reverted on-chain', async () => {
    const { publicClient, walletClient } = clients('reverted');

    await expect(
      dispenseOnChain(publicClient, walletClient, ACCOUNT, CONFIG, CONTENT_HASH),
    ).rejects.toThrow(/revirti/i);
  });

  it('names the transaction hash so a reverted dispensation can be inspected', async () => {
    const { publicClient, walletClient } = clients('reverted');

    await expect(
      dispenseOnChain(publicClient, walletClient, ACCOUNT, CONFIG, CONTENT_HASH),
    ).rejects.toThrow(TX_HASH);
  });
});

describe('issueOnChain', () => {
  it('throws instead of reporting success when the transaction reverted on-chain', async () => {
    const { publicClient, walletClient } = clients('reverted');

    await expect(
      issueOnChain(publicClient, walletClient, ACCOUNT, CONFIG, {
        contentHash: CONTENT_HASH,
        patientCommitment: COMMITMENT,
        expiresAt: 1_800_000_000n,
      }),
    ).rejects.toThrow(/revirti/i);
  });
});
