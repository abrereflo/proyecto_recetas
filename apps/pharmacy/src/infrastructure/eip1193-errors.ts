/**
 * EIP-1193/EIP-3085 error codes and the `cause`-walking classifier.
 *
 * Lives here, a sibling of `infrastructure/signer` and `infrastructure/chain`,
 * rather than inside either one. The pharmacy's write path does not classify a
 * declined prompt today — only the signer adapter does — but Corte 2
 * (docs/21-acceso-para-la-demo.md) forbids anything under
 * `infrastructure/chain` from importing `infrastructure/signer`, and
 * `no-signer-import.test.ts` enforces it. Keeping this module in step with the
 * doctor's means the day `dispense` needs the same classification there is a
 * place to import it from, instead of a choice between duplicating the codes
 * and breaking the guard.
 *
 * Mirrors apps/doctor/src/infrastructure/eip1193-errors.ts; the two are meant
 * to stay byte-comparable.
 */

/** Error code EIP-1193 reserves for "the user said no". */
export const USER_REJECTED = 4001;
/** Error code EIP-3085/1193 returns when the chain is not known to the provider. */
export const UNRECOGNISED_CHAIN = 4902;

/**
 * Walks the `cause` chain: a provider that wraps its error code one level deep
 * (or more) still has to be recognised, or a wrapped 4902 never reaches the
 * `wallet_addEthereumChain` fallback (docs/21-acceso-para-la-demo.md, "Corte 1").
 */
export function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number') return code;
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined || cause === error ? undefined : errorCode(cause);
}
