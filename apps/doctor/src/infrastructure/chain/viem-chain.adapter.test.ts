import { describe, expect, it } from 'vitest';
import { ChainUnreachableError } from '../../ports/chain.port';
import { SignerRejectedError } from '../../ports/signer.port';
import { CONFIG, CONTENT_HASH, EXPIRES_AT, PATIENT_COMMITMENT, PRESCRIBER } from '../../test/fixtures';
import { asPrescriberDecision, createViemChainAdapter } from './viem-chain.adapter';

/** R4-001: `issue` was the one method outside the adapter's transport
 * classifier, so a dropped RPC mid-anchor reached the screen as an unmodelled
 * error and the pipeline's "no answer from the chain" branch was dead code. */
describe('anchoring a prescription', () => {
  it('reports a dropped transport as an unreachable node, never as a verdict', async () => {
    const chain = createViemChainAdapter({
      config: CONFIG,
      publicClient: {
        simulateContract: () =>
          Promise.reject(Object.assign(new Error('socket'), { name: 'HttpRequestError' })),
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

  it('reports a declined transaction prompt as a decision, not a network fault', () => {
    expect(() => asPrescriberDecision({ code: 4001 })).toThrow(SignerRejectedError);
  });
});
