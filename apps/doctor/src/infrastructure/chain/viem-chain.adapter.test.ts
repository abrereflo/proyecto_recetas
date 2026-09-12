import { describe, expect, it } from 'vitest';
import {
  CallExecutionError,
  HttpRequestError,
  LimitExceededRpcError,
  RawContractError,
  RpcRequestError,
  encodeErrorResult,
  getContractError,
} from 'viem';
import { prescriptionRegistryAbi } from '@recetas/chain';
import { ChainUnreachableError, TransactionRevertedError } from '../../ports/chain.port';
import { SignerRejectedError } from '../../ports/signer.port';
import { BLOCK_TIME, CHAIN_ID, CONFIG, CONTENT_HASH, EXPIRES_AT, PATIENT_COMMITMENT, PRESCRIBER, TRANSACTION_HASH } from '../../test/fixtures';
import { decodeIssueRejection } from './issue-errors';
import { asPrescriberDecision, createViemChainAdapter } from './viem-chain.adapter';

/** R4-001: `issue` was the one method outside the adapter's transport
 * classifier, so a dropped RPC mid-anchor reached the screen as an unmodelled
 * error and the pipeline's "no answer from the chain" branch was dead code. */
describe('anchoring a prescription', () => {
  it('reports a dropped transport as an unreachable node, never as a verdict', async () => {
    const dropped = { simulateContract: () => Promise.reject(droppedTransport()) };
    await expect(anchorWith(dropped)).rejects.toBeInstanceOf(ChainUnreachableError);
  });

  /**
   * R4-002, the positive control for the test above: inspecting the cause chain
   * must not turn every refusal into "no answer from the node". The contract
   * answered, so the revert has to reach its decoder intact.
   */
  it('still lets a genuine revert reach its decoder as a verdict', async () => {
    const refused = { simulateContract: () => Promise.reject(contractRefusal()) };
    const error = await anchorWith(refused).catch((rejected: unknown) => rejected);

    expect(error).not.toBeInstanceOf(ChainUnreachableError);
    expect(decodeIssueRejection(error)).toEqual({ code: 'already-issued', contentHash: CONTENT_HASH });
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

/**
 * R4-002: `writeContract` IS the broadcast, so a transport failure there is the
 * one case where nobody knows whether the transaction reached the node. It has
 * to keep the attempt alive as an incomplete operation; the same shape carrying
 * a real refusal must not.
 */
describe('a contract call that failed at the broadcast itself', () => {
  it('reports a dropped transport as an unreachable node', async () => {
    await expect(anchorRejectingTheBroadcast(droppedTransport())).rejects.toBeInstanceOf(
      ChainUnreachableError,
    );
  });

  it('still lets a genuine revert reach its decoder as a verdict', async () => {
    const error = await anchorRejectingTheBroadcast(contractRefusal()).catch(
      (rejected: unknown) => rejected,
    );

    expect(error).not.toBeInstanceOf(ChainUnreachableError);
    expect(decodeIssueRejection(error)).toEqual({ code: 'already-issued', contentHash: CONTENT_HASH });
  });
});

/**
 * The shapes viem REALLY throws from a contract call.
 *
 * Both are built by `getContractError` itself — the single function every
 * `simulateContract`, `readContract` and `writeContract` funnels its catch
 * through — so these fixtures cannot drift from the production shape, and a
 * transport failure and a revert deliberately come out as the SAME class.
 */
const asIssueFailure = (cause: Error) =>
  getContractError(cause, {
    abi: prescriptionRegistryAbi,
    address: CONFIG.registryAddress,
    args: [CONTENT_HASH, PATIENT_COMMITMENT, EXPIRES_AT],
    functionName: 'issue',
    sender: PRESCRIBER,
  });

/** An HTTP request that never got an answer, wrapped exactly as viem wraps it. */
const droppedTransport = () =>
  asIssueFailure(new CallExecutionError(new HttpRequestError({ url: CONFIG.rpcUrl }), {}));

/** The node returning `AlreadyIssued` revert data, wrapped exactly as viem wraps it. */
const contractRefusal = () =>
  asIssueFailure(
    new RawContractError({
      data: encodeErrorResult({
        abi: prescriptionRegistryAbi,
        errorName: 'AlreadyIssued',
        args: [CONTENT_HASH],
      }),
    }),
  );

/** Anchors against a wallet whose `writeContract` rejects with `error`. */
function anchorRejectingTheBroadcast(error: unknown): Promise<unknown> {
  return anchorWith({}, () => Promise.reject(error));
}

const receipt = (status: string) => ({ waitForTransactionReceipt: async () => ({ status, blockNumber: 42n }) });
const simulated = { address: CONFIG.registryAddress, abi: prescriptionRegistryAbi, functionName: 'issue', args: [CONTENT_HASH, PATIENT_COMMITMENT, EXPIRES_AT], account: PRESCRIBER };

/** Anchors against a public client whose step under test is overridden. */
function anchorWith(client: object, send?: () => Promise<unknown>): Promise<unknown> {
  const chainId = `0x${CHAIN_ID.toString(16)}`;
  return createViemChainAdapter({
    config: CONFIG,
    publicClient: { simulateContract: async () => ({ request: simulated }), getBlock: async () => ({ timestamp: BLOCK_TIME }), ...client } as never,
    getProvider: () => ({
      request: async ({ method }) => {
        if (method === 'eth_chainId') return chainId;
        // The broadcast itself, so a test can fail exactly that step.
        return send === undefined ? TRANSACTION_HASH : send();
      },
    }),
  }).issue({ contentHash: CONTENT_HASH, patientCommitment: PATIENT_COMMITMENT, expiresAt: EXPIRES_AT, prescriber: PRESCRIBER });
}
