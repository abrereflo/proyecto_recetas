import { describe, expect, it, vi } from 'vitest';
import { custom } from 'viem';
import { ENTRY_POINT_V07_ADDRESS, type PackedUserOperation } from '@recetas/chain';
import type { Address, Bytes32 } from '@recetas/shared';
import type { RelayerConfig } from '../env';
import { createViemRelayerChain } from './viem-relayer-chain';

/**
 * The submission queue, which is the only decision in that file — everything
 * else there is adapter. It is also the part that has now broken twice.
 */

const ADDRESS = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365' as Address;
const ZERO_32 = `0x${'00'.repeat(32)}` as Bytes32;

const config: RelayerConfig = {
  /** A throwaway constant. It holds nothing, on any chain. See `relayer.test.ts`. */
  privateKey: `0x${'7c'.repeat(32)}`,
  rpcUrl: 'http://node.invalid',
  chainId: 43113,
  entryPoint: ENTRY_POINT_V07_ADDRESS,
  registry: ADDRESS,
  paymaster: ADDRESS,
  maxFeePerGasWei: 100_000_000_000n,
  maxPrefundWei: 20_000_000_000_000_000n,
  rateLimit: 30,
  rateLimitWindowSeconds: 60,
};

const USER_OP: PackedUserOperation = {
  sender: ADDRESS,
  nonce: 0n,
  initCode: '0x',
  callData: '0x',
  accountGasLimits: ZERO_32,
  preVerificationGas: 0n,
  gasFees: ZERO_32,
  paymasterAndData: '0x',
  signature: '0x',
};

/** Everything `writeContract` asks a node before it can sign and broadcast. */
const ANSWERS: Record<string, unknown> = {
  eth_chainId: '0xa869',
  eth_getBlockByNumber: { number: '0x1', baseFeePerGas: '0x7' },
  eth_maxPriorityFeePerGas: '0x1',
  eth_getTransactionCount: '0x0',
};

/**
 * THE ASSERTION IS ABOUT THE SECOND SEND'S RPCs, not about the order the two
 * promises settle in. Serialised means the second `sendHandleOps` has asked the
 * node nothing — above all not for a nonce — while the first is still waiting
 * on `eth_sendRawTransaction`. Counting nonce reads is what fails when the
 * queue is removed: both sends read the same number, which is the collision.
 */
describe('two submissions at once', () => {
  it('does not let the second read a nonce while the first is in flight', async () => {
    const seen: string[] = [];
    const nonceReads = () => seen.filter((call) => call === 'eth_getTransactionCount').length;
    let releaseFirst = () => {};

    const chain = createViemRelayerChain(
      config,
      custom(
        {
          request: async ({ method }: { method: string }) => {
            seen.push(method);

            if (method !== 'eth_sendRawTransaction') {
              return ANSWERS[method];
            }

            if (seen.filter((call) => call === 'eth_sendRawTransaction').length === 1) {
              await new Promise<void>((resolve) => {
                releaseFirst = resolve;
              });
            }

            return `0x${'ab'.repeat(32)}`;
          },
        },
        { retryCount: 0 },
      ),
    );

    const both = Promise.all([
      chain.sendHandleOps(USER_OP, 100_000n),
      chain.sendHandleOps(USER_OP, 100_000n),
    ]);

    await vi.waitFor(() => expect(seen).toContain('eth_sendRawTransaction'));

    expect(nonceReads()).toBe(1);

    releaseFirst();

    expect(await both).toHaveLength(2);
    expect(nonceReads()).toBe(2);
  });
});
