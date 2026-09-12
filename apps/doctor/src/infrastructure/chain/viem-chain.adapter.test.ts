import { describe, expect, it } from 'vitest';
import { HttpRequestError, LimitExceededRpcError, RpcRequestError } from 'viem';
import { prescriptionRegistryAbi } from '@recetas/chain';
import { ChainUnreachableError, TransactionRevertedError } from '../../ports/chain.port';
import { SignerRejectedError } from '../../ports/signer.port';
import { BLOCK_TIME, CHAIN_ID, CONFIG, CONTENT_HASH, EXPIRES_AT, PATIENT_COMMITMENT, PRESCRIBER, TRANSACTION_HASH } from '../../test/fixtures';
import { asPrescriberDecision, createViemChainAdapter } from './viem-chain.adapter';

/** R4-001: `issue` was the one method outside the adapter's transport
 * classifier, so a dropped RPC mid-anchor reached the screen as an unmodelled
 * error and the pipeline's "no answer from the chain" branch was dead code. */
describe('anchoring a prescription', () => {
  it('reports a dropped transport as an unreachable node, never as a verdict', async () => {
    const chain = createViemChainAdapter({
      config: CONFIG,
      publicClient: {
        simulateContract: () => Promise.reject(new HttpRequestError({ url: CONFIG.rpcUrl })),
      } as never,
      getProvider: () => ({ request: async () => undefined }),
    });

    const anchor = chain.issue({
      contentHash: CONTENT_HASH,
      patientCommitment: PATIENT_COMMITMENT,
      expiresAt: EXPIRES_AT,
      prescriber: PRESCRIBER,
    });
    await expect(anchor).rejects.toBeInstanceOf(ChainUnreachableError);
  });

  /** R4-001: viem resolves the receipt of a REVERTED transaction exactly as it
   * resolves a mined one, so without reading the status the doctor was told to
   * hand over a QR the pharmacy resolves as `None`. */
  it('refuses to report a reverted transaction as an issuance', async () => {
    const mined = { transactionHash: TRANSACTION_HASH, blockNumber: 42n, blockTimestamp: BLOCK_TIME };
    await expect(anchorWith(receipt('success'))).resolves.toEqual(mined);
    await expect(anchorWith(receipt('reverted'))).rejects.toBeInstanceOf(TransactionRevertedError);
  });

  /** R4-002: the receipt poller rejects with the RAW RPC error, so a rate-limited
   * node arrives as an `RpcError` subclass no allowlist of names contains. */
  it('classifies a rate-limited node on the receipt path as unreachable', async () => {
    const rpc = new RpcRequestError({ body: {}, error: { code: -32005, message: 'busy' }, url: CONFIG.rpcUrl });
    const limited = { waitForTransactionReceipt: () => Promise.reject(new LimitExceededRpcError(rpc)) };
    await expect(anchorWith(limited)).rejects.toBeInstanceOf(ChainUnreachableError);
  });

  it('reports a declined transaction prompt as a decision, not a network fault', () => {
    expect(() => asPrescriberDecision({ code: 4001 })).toThrow(SignerRejectedError);
  });
});

const receipt = (status: string) => ({ waitForTransactionReceipt: async () => ({ status, blockNumber: 42n }) });
const simulated = { address: CONFIG.registryAddress, abi: prescriptionRegistryAbi, functionName: 'issue', args: [CONTENT_HASH, PATIENT_COMMITMENT, EXPIRES_AT], account: PRESCRIBER };

/** Anchors against a public client whose step under test is overridden. */
function anchorWith(client: object): Promise<unknown> {
  return createViemChainAdapter({
    config: CONFIG,
    publicClient: { simulateContract: async () => ({ request: simulated }), getBlock: async () => ({ timestamp: BLOCK_TIME }), ...client } as never,
    getProvider: () => ({ request: async ({ method }) => (method === 'eth_chainId' ? `0x${CHAIN_ID.toString(16)}` : TRANSACTION_HASH) }),
  }).issue({ contentHash: CONTENT_HASH, patientCommitment: PATIENT_COMMITMENT, expiresAt: EXPIRES_AT, prescriber: PRESCRIBER });
}
