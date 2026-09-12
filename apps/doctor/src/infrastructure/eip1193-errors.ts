/**
 * EIP-1193/EIP-3085 error codes and the `cause`-walking classifier, shared by
 * `infrastructure/signer` and `infrastructure/chain`.
 *
 * Lives here, a sibling of both, rather than inside either one: Corte 2
 * (docs/21-acceso-para-la-demo.md) removes the write path's dependency on
 * `infrastructure/signer`, and `viem-chain.adapter.ts` still has to classify a
 * declined transaction prompt by the same codes the signer adapter uses for a
 * declined connection or chain switch. A single shared module keeps that
 * classification in one place without either adapter importing the other.
 */

/** Error code EIP-1193 reserves for "the user said no". */
export const USER_REJECTED = 4001;
/** Error code EIP-3085/1193 returns when the chain is not known to the provider. */
export const UNRECOGNISED_CHAIN = 4902;

export function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number') return code;
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined || cause === error ? undefined : errorCode(cause);
}
