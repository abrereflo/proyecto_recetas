import {
  PLACEHOLDER_ASSERTION_SIGNATURE,
  estimatePreVerificationGas,
  requiredPrefund,
  type UserOperationDraft,
} from '@recetas/chain';
import type { Address } from '@recetas/shared';

/**
 * HOW BIG EACH GAS LIMIT IS, AND WHERE THE NUMBER CAME FROM.
 *
 * Every constant below is either MEASURED or DICTATED. Nothing here is a round
 * number somebody liked, because in ERC-4337 a limit that is too low does not
 * degrade — the EntryPoint refuses the operation with an `AA` code that names
 * no field, and the doctor sees a prescription that did not happen.
 *
 * The measurements come from `forge test --gas-report` in `contracts/`, run on
 * 13/09/2026 against the suite that was passing at 141 tests. Each one names
 * the function it came from so it can be re-taken rather than trusted.
 */

/**
 * `verificationGasLimit` for an account that already exists.
 *
 * SOURCE: `contracts/src/WebAuthn.sol`, which says it outright — "SIZE
 * `verificationGasLimit` FOR THE FALLBACK — call it 450k — NOT FOR THE
 * PRECOMPILE".
 *
 * WHY THE FALLBACK AND NOT THE PRECOMPILE, restated because it is the whole
 * reason this is not 60k: the expensive path is the REJECTED signature. On
 * Fuji the RIP-7212 precompile answers a valid signature in ~3.4k gas, but it
 * answers an invalid one with an EMPTY return, and `P256.verify` then asks the
 * 330k Solidity verifier. An operation budgeted from the happy path fails as
 * out-of-gas instead of as a clean `SIG_VALIDATION_FAILED`, and those two look
 * nothing alike from the outside.
 *
 * CROSS-CHECKED: `forge test --match-test
 * test_validateUserOp_still_works_without_the_precompile --gas-report` reports
 * 387,539 gas for `validateUserOp` with the Solidity verifier answering. 450k
 * clears that with 16% of headroom.
 */
export const VERIFICATION_GAS_LIMIT = 450_000n;

/**
 * What deploying the account adds, for the first operation only.
 *
 * SOURCE: `forge test --gas-report`, `PasskeyAccountFactory.createAccount`, max
 * 990,367 gas across 69 calls (the min of 40,198 is the idempotent path, where
 * the account already exists).
 *
 * WHY IT IS ADDED TO `verificationGasLimit` RATHER THAN TO ITS OWN FIELD: v0.7
 * folded account deployment into the verification budget. v0.6 had a separate
 * field; v0.7 does not, and an operation that carries `initCode` with a 450k
 * verification limit runs out of gas inside the factory.
 */
export const ACCOUNT_DEPLOYMENT_GAS = 990_367n;

/**
 * `verificationGasLimit` for an operation that also deploys its account.
 *
 * 450,000 + 990,367, rounded up to a round number for readability. The rounding
 * is upward on purpose: unspent verification gas is refunded, unavailable
 * verification gas is a failed prescription.
 */
export const DEPLOYMENT_VERIFICATION_GAS_LIMIT = 1_500_000n;

/**
 * `callGasLimit` for `execute(registry, 0, issue(...))`.
 *
 * SOURCE: `forge test --gas-report`. `PasskeyAccount.execute` max 141,945 gas,
 * wrapping `PrescriptionRegistry.issue` at max 137,510.
 *
 * SET TO 250,000 — 1.76x the measurement, not the double it would be at 283,890
 * — and the reason for the headroom is named rather than "for safety": every
 * one of those figures was taken against `contracts/test/mocks/MockEAS.sol`,
 * whose `getAttestation` costs 16,843 gas. The EAS this project deployed on
 * Fuji stores a longer `Attestation` with a `bytes data` field and reads more
 * cold slots, so the real figure is higher and has not been measured on Fuji.
 * When it is, this constant should come down to match it.
 */
export const ISSUE_CALL_GAS_LIMIT = 250_000n;

/**
 * `callGasLimit` for `execute(registry, 0, registerCredential(uid))`.
 *
 * SOURCE: `forge test --gas-report`, `PrescriptionRegistry.registerCredential`
 * max 67,566 gas, plus the `execute` wrapper. Same MockEAS caveat, and 150,000
 * is MORE than double that — a wider margin than the issue path gets, because
 * the wrapper's own cost is not in the 67,566 and unspent call gas is refunded.
 */
export const REGISTER_CALL_GAS_LIMIT = 150_000n;

/**
 * `paymasterVerificationGasLimit`.
 *
 * SOURCE: `forge test --gas-report`,
 * `PrescriptionPaymaster.validatePaymasterUserOp` max 78,815 gas across 31
 * calls.
 *
 * SET TO 200,000 — more than double — for one reason that is not caution: the
 * measured path reads `MockEAS`. Real EAS `getAttestation` returns a larger
 * struct from more cold storage slots, and the paymaster reads it on EVERY
 * operation by design, because docs/04 forbids caching an accreditation
 * verdict. This is the single figure in this file with the widest gap between
 * what was measured and what will happen on Fuji.
 */
export const PAYMASTER_VERIFICATION_GAS_LIMIT = 200_000n;

/**
 * `paymasterPostOpGasLimit`.
 *
 * ZERO, AND IT IS CORRECT. `PrescriptionPaymaster.validatePaymasterUserOp`
 * returns an empty context, and EntryPoint v0.7 skips `postOp` entirely on an
 * empty context — its docblock argues why, at length: the only thing a `postOp`
 * could add is telemetry the EntryPoint already emits in
 * `UserOperationEvent`, and it would buy a failure mode where a prescription
 * fails for a log line.
 *
 * The field still counts toward the required prefund, so a non-zero value here
 * would inflate what the paymaster is asked to reserve for gas that cannot be
 * spent. If a future paymaster returns a context, this becomes a real number
 * and the tests below will not notice — which is why it is a named constant
 * with this note attached rather than a literal zero at a call site.
 */
export const PAYMASTER_POST_OP_GAS_LIMIT = 0n;

/** Which of the two calls the first operation of an account's life makes. */
export type OperationShape = 'register-credential' | 'issue';

export interface GasSizingInput {
  /** True when the account does not exist yet and `initCode` will deploy it. */
  deploying: boolean;
  shape: OperationShape;
}

export interface AccountGasSizing {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
}

/**
 * The two account-side limits for one operation.
 *
 * NOTE WHICH COMBINATION IS THE REAL ONE. A deploying operation is always a
 * `registerCredential`, never an `issue`: `PrescriptionPaymaster` sponsors an
 * account with no registered credential for exactly one thing, and an `issue`
 * as the first operation comes back as `NotAccredited` before it reaches the
 * registry. The other three combinations are still computed rather than
 * refused, because this function sizes gas and does not enforce policy — the
 * paymaster does that, on chain, where it counts.
 */
export function sizeAccountGas(input: GasSizingInput): AccountGasSizing {
  return {
    verificationGasLimit: input.deploying
      ? DEPLOYMENT_VERIFICATION_GAS_LIMIT
      : VERIFICATION_GAS_LIMIT,
    callGasLimit: input.shape === 'issue' ? ISSUE_CALL_GAS_LIMIT : REGISTER_CALL_GAS_LIMIT,
  };
}

/**
 * `maxFeePerGas` from the chain's own base fee, with a ceiling.
 *
 * WHY A MULTIPLIER AND NOT A CONSTANT. Avalanche's C-Chain base fee is
 * dynamic, and since ACP-176 it sits far below the 25 nAVAX figure older
 * documents assume — 10 wei on Fuji on 13/09/2026, measured. A hardcoded fee
 * would either overpay by nine orders of magnitude or fail to land under load.
 *
 * WHY THE CEILING. `maxFeePerGas` is what the required prefund is priced at, so
 * an unbounded fee is an unbounded claim on the paymaster's deposit, and the
 * relayer chooses it. The ceiling is configuration, not a constant, because it
 * is the kind of number an operator has to be able to move without a deploy.
 */
export const BASE_FEE_MULTIPLIER = 2n;

export function sizeFees(input: {
  baseFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  ceilingWei: bigint;
}): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const maxPriorityFeePerGas =
    input.maxPriorityFeePerGas > input.ceilingWei ? input.ceilingWei : input.maxPriorityFeePerGas;

  const wanted = input.baseFeePerGas * BASE_FEE_MULTIPLIER + maxPriorityFeePerGas;

  return {
    maxFeePerGas: wanted > input.ceilingWei ? input.ceilingWei : wanted,
    maxPriorityFeePerGas,
  };
}

/** A refusal this service makes itself, before anything reaches the chain. */
export class GasPolicyError extends Error {
  constructor(
    readonly code: 'fee_above_ceiling' | 'prefund_above_ceiling',
    message: string,
  ) {
    super(message);
    this.name = 'GasPolicyError';
  }
}

/**
 * Refuse an operation this relayer will not carry, and say why in words.
 *
 * THE POINT IS THE SENTENCE, not the saving. Both of these would also be caught
 * on chain — the prefund one by `PrescriptionPaymaster` reverting
 * `CostNotSponsored(maxCost, allowed)` — but the client would receive it as
 * `FailedOpWithRevert(0, "AA33 reverted", <bytes>)` after a round trip. This is
 * the same verdict, before the round trip, with the numbers in it.
 */
export function assertWithinPolicy(
  draft: UserOperationDraft,
  limits: { maxFeePerGasWei: bigint; maxPrefundWei: bigint },
): void {
  if (draft.maxFeePerGas > limits.maxFeePerGasWei) {
    throw new GasPolicyError(
      'fee_above_ceiling',
      `maxFeePerGas ${draft.maxFeePerGas} is above this relayer's ceiling of ${limits.maxFeePerGasWei} wei`,
    );
  }

  const prefund = requiredPrefund(draft);

  if (prefund > limits.maxPrefundWei) {
    throw new GasPolicyError(
      'prefund_above_ceiling',
      `this operation would reserve ${prefund} wei, above this relayer's ceiling of ${limits.maxPrefundWei} wei`,
    );
  }
}

/**
 * `preVerificationGas`, sized against the operation that will actually be sent.
 *
 * THE SIGNATURE HAS TO BE THE RIGHT SIZE HERE, and at this moment it does not
 * exist: the doctor has not touched the sensor. So the draft is measured with
 * `PLACEHOLDER_ASSERTION_SIGNATURE` standing in for the ~512-byte WebAuthn
 * envelope. Sizing against the empty signature the draft actually carries would
 * under-budget the calldata by thousands of gas and the operation would be
 * refused for a reason that has nothing to do with the signature being wrong.
 *
 * `apps/doctor` has a test asserting a real envelope is never longer than the
 * placeholder, which is the direction that matters.
 */
export function sizePreVerificationGas(params: {
  draft: UserOperationDraft;
  beneficiary: Address;
}): bigint {
  return estimatePreVerificationGas({
    draft: { ...params.draft, signature: PLACEHOLDER_ASSERTION_SIGNATURE },
    beneficiary: params.beneficiary,
  });
}
