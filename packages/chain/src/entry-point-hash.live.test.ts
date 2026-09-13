import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import type { Address } from '@recetas/shared';
import { ENTRY_POINT_V07_ADDRESS, entryPointV07Abi } from './entry-point-abi';
import { getUserOpHash, packUserOperation, type UserOperationDraft } from './user-operation';

/**
 * THE SINGLE MOST VALUABLE TEST IN THIS SLICE, and the reason it is opt-in.
 *
 * `user-operation.ts` reimplements `userOpHash` because the doctor's
 * authenticator has to be handed a challenge before any round trip exists. A
 * reimplementation of a consensus-critical digest that is never compared with
 * the contract it imitates is a guess. This file makes the comparison against
 * the real thing: `getUserOpHash` on the deployed EntryPoint v0.7, as a free
 * `eth_call`.
 *
 * WHY IT DOES NOT RUN BY DEFAULT. `pnpm -r test` has to pass with no network,
 * on a laptop on a train, and a suite that silently depends on a public RPC is
 * a suite that fails for reasons that have nothing to do with the change under
 * test. So the offline guarantee lives in `user-operation.test.ts`, which pins
 * the SAME three operations against answers already read off the chain on
 * 13/09/2026; this file is how those fixtures are re-confirmed, and how a
 * fourth one would be recorded.
 *
 *   RPC_URL=https://avalanche-fuji-c-chain-rpc.publicnode.com \
 *   CHAIN_ID=43113 \
 *   ENTRY_POINT_LIVE_CHECK=1 pnpm --filter @recetas/chain test
 *
 * Read-only. It sends no transaction, deploys nothing and spends nothing.
 *
 * NOTE ON THE RPC. `api.avax-test.network` rate-limits hard enough to make this
 * flaky; the publicnode endpoint above is the one this project uses
 * (docs/19-despliegue.md).
 */

const enabled = process.env.ENTRY_POINT_LIVE_CHECK === '1';
const rpcUrl = process.env.RPC_URL ?? 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
const chainId = Number(process.env.CHAIN_ID ?? 43113);
const entryPoint = (process.env.ENTRY_POINT_ADDRESS ?? ENTRY_POINT_V07_ADDRESS) as Address;

const REGISTRY = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365' as Address;

const DRAFTS: ReadonlyArray<{ name: string; draft: UserOperationDraft }> = [
  {
    name: 'every field at its zero value',
    draft: {
      sender: '0x0000000000000000000000000000000000000001' as Address,
      nonce: 0n,
      initCode: '0x',
      callData: '0x',
      verificationGasLimit: 0n,
      callGasLimit: 0n,
      preVerificationGas: 0n,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: 0n,
      signature: '0x',
    },
  },
  {
    name: 'a counterfactual first operation with a paymaster',
    draft: {
      sender: '0x4429d872fB9253C8516AE525b03cE06FbbbEC143' as Address,
      nonce: 0n,
      initCode: `0x${'99'.repeat(20)}deadbeef`,
      callData: '0xdeadbeef',
      verificationGasLimit: 1_500_000n,
      callGasLimit: 150_000n,
      preVerificationGas: 60_000n,
      maxPriorityFeePerGas: 150n,
      maxFeePerGas: 1_000n,
      paymaster: {
        address: `0x${'88'.repeat(20)}` as Address,
        verificationGasLimit: 150_000n,
        postOpGasLimit: 0n,
      },
      signature: '0xabcd',
    },
  },
  {
    name: 'a settled account calling the registry',
    draft: {
      sender: REGISTRY,
      nonce: 7n,
      initCode: '0x',
      callData: '0xcafebabe',
      verificationGasLimit: 450_000n,
      callGasLimit: 250_000n,
      preVerificationGas: 55_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
      maxFeePerGas: 30_000_000_000n,
      signature: '0x',
    },
  },
];

describe.skipIf(!enabled)('the deployed EntryPoint agrees with this module', () => {
  const client = createPublicClient({ transport: http(rpcUrl) });

  for (const { name, draft } of DRAFTS) {
    it(
      `getUserOpHash matches for ${name}`,
      async () => {
        const userOp = packUserOperation(draft);

        const onChain = await client.readContract({
          address: entryPoint,
          abi: entryPointV07Abi,
          functionName: 'getUserOpHash',
          args: [userOp],
        });

        expect(getUserOpHash({ userOp, entryPoint, chainId })).toBe(onChain);
      },
      30_000,
    );
  }
});
