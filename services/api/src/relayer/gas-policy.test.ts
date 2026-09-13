import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_ASSERTION_SIGNATURE, type UserOperationDraft } from '@recetas/chain';
import type { Address } from '@recetas/shared';
import {
  ACCOUNT_DEPLOYMENT_GAS,
  BASE_FEE_MULTIPLIER,
  DEPLOYMENT_VERIFICATION_GAS_LIMIT,
  GasPolicyError,
  ISSUE_CALL_GAS_LIMIT,
  PAYMASTER_POST_OP_GAS_LIMIT,
  REGISTER_CALL_GAS_LIMIT,
  VERIFICATION_GAS_LIMIT,
  assertWithinPolicy,
  sizeAccountGas,
  sizeFees,
  sizePreVerificationGas,
} from './gas-policy';

const RELAYER = '0x4429d872fB9253C8516AE525b03cE06FbbbEC143' as Address;
const PAYMASTER = `0x${'88'.repeat(20)}` as Address;

const draft: UserOperationDraft = {
  sender: '0x7b33436643a681262562785C02Cba36524491042' as Address,
  nonce: 0n,
  initCode: '0x',
  callData: '0xdeadbeef',
  verificationGasLimit: VERIFICATION_GAS_LIMIT,
  callGasLimit: ISSUE_CALL_GAS_LIMIT,
  preVerificationGas: 60_000n,
  maxPriorityFeePerGas: 150n,
  maxFeePerGas: 1_000n,
  paymaster: { address: PAYMASTER, verificationGasLimit: 200_000n, postOpGasLimit: 0n },
  signature: '0x',
};

describe('the account-side limits, and where they come from', () => {
  /**
   * `WebAuthn.sol` says it outright: size for the fallback, not the precompile,
   * because the expensive path is the REJECTED signature. Cross-checked against
   * `forge test --gas-report`, which reports 387,539 for `validateUserOp` with
   * the Solidity verifier answering.
   */
  it('sizes verification for the Solidity fallback, not the precompile', () => {
    expect(VERIFICATION_GAS_LIMIT).toBe(450_000n);
    expect(VERIFICATION_GAS_LIMIT).toBeGreaterThan(387_539n);
  });

  /**
   * v0.7 folded account deployment into `verificationGasLimit`. The measured
   * `PasskeyAccountFactory.createAccount` max is 990,367, so a first operation
   * budgeted at 450k runs out of gas inside the factory.
   */
  it('covers the measured cost of deploying the account on the first operation', () => {
    expect(ACCOUNT_DEPLOYMENT_GAS).toBe(990_367n);
    expect(DEPLOYMENT_VERIFICATION_GAS_LIMIT).toBeGreaterThanOrEqual(
      VERIFICATION_GAS_LIMIT + ACCOUNT_DEPLOYMENT_GAS,
    );
  });

  it('uses the deployment budget only when the account does not exist yet', () => {
    expect(sizeAccountGas({ deploying: true, shape: 'register-credential' })).toEqual({
      verificationGasLimit: DEPLOYMENT_VERIFICATION_GAS_LIMIT,
      callGasLimit: REGISTER_CALL_GAS_LIMIT,
    });

    expect(sizeAccountGas({ deploying: false, shape: 'issue' })).toEqual({
      verificationGasLimit: VERIFICATION_GAS_LIMIT,
      callGasLimit: ISSUE_CALL_GAS_LIMIT,
    });
  });

  /** `issue` measured at 137,510; `registerCredential` at 67,566. */
  it('gives an issue more call gas than a credential registration', () => {
    expect(ISSUE_CALL_GAS_LIMIT).toBeGreaterThan(REGISTER_CALL_GAS_LIMIT);
    expect(ISSUE_CALL_GAS_LIMIT).toBeGreaterThan(137_510n);
    expect(REGISTER_CALL_GAS_LIMIT).toBeGreaterThan(67_566n);
  });

  /**
   * `PrescriptionPaymaster.validatePaymasterUserOp` returns an empty context,
   * and v0.7 skips `postOp` entirely on an empty context. A non-zero value
   * would inflate the prefund the paymaster is asked to reserve for gas that
   * cannot be spent.
   */
  it('asks for no postOp gas, because postOp is never called', () => {
    expect(PAYMASTER_POST_OP_GAS_LIMIT).toBe(0n);
  });
});

describe('fees come from the chain, with a ceiling', () => {
  it('pays twice the base fee plus the priority fee', () => {
    expect(sizeFees({ baseFeePerGas: 10n, maxPriorityFeePerGas: 150n, ceilingWei: 1_000_000n }))
      .toEqual({ maxFeePerGas: 10n * BASE_FEE_MULTIPLIER + 150n, maxPriorityFeePerGas: 150n });
  });

  /**
   * Fuji's base fee was 10 wei on 13/09/2026, measured — nine orders of
   * magnitude below the 25 nAVAX older documents assume. A hardcoded fee would
   * be wrong in one direction or the other; this is why it is read.
   */
  it('produces a sane fee at the base fee Fuji actually charges', () => {
    const fees = sizeFees({ baseFeePerGas: 10n, maxPriorityFeePerGas: 150n, ceilingWei: 10n ** 12n });

    expect(fees.maxFeePerGas).toBe(170n);
  });

  it('never exceeds the ceiling, however high the base fee goes', () => {
    const fees = sizeFees({
      baseFeePerGas: 10n ** 18n,
      maxPriorityFeePerGas: 10n ** 18n,
      ceilingWei: 100_000_000_000n,
    });

    expect(fees.maxFeePerGas).toBe(100_000_000_000n);
    expect(fees.maxPriorityFeePerGas).toBe(100_000_000_000n);
  });

  it('keeps the priority fee at or below the max fee', () => {
    const fees = sizeFees({
      baseFeePerGas: 0n,
      maxPriorityFeePerGas: 10n ** 18n,
      ceilingWei: 500n,
    });

    expect(fees.maxPriorityFeePerGas).toBeLessThanOrEqual(fees.maxFeePerGas);
  });
});

describe('refusing an operation this relayer will not carry', () => {
  const limits = { maxFeePerGasWei: 100_000_000_000n, maxPrefundWei: 20_000_000_000_000_000n };

  it('accepts an ordinary operation', () => {
    expect(() => assertWithinPolicy(draft, limits)).not.toThrow();
  });

  it('refuses a fee above the ceiling, by name', () => {
    expect(() => assertWithinPolicy({ ...draft, maxFeePerGas: 10n ** 15n }, limits)).toThrow(
      GasPolicyError,
    );

    try {
      assertWithinPolicy({ ...draft, maxFeePerGas: 10n ** 15n }, limits);
    } catch (error) {
      expect((error as GasPolicyError).code).toBe('fee_above_ceiling');
    }
  });

  /**
   * The same verdict `PrescriptionPaymaster` would give as
   * `CostNotSponsored(maxCost, allowed)` — but before the round trip, and with
   * the numbers in the sentence instead of inside `FailedOpWithRevert`.
   */
  it('refuses a prefund above the ceiling, by name', () => {
    try {
      assertWithinPolicy(draft, { ...limits, maxPrefundWei: 1n });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as GasPolicyError).code).toBe('prefund_above_ceiling');
      expect((error as GasPolicyError).message).toMatch(/would reserve \d+ wei/);
    }
  });

  /**
   * THE FINDING WORTH KEEPING. A first operation deploys the account, so it
   * reserves roughly 1.9M gas rather than the "on the order of 800k" figure
   * `PrescriptionPaymaster`'s own docblock uses to justify a 0.02 AVAX
   * `maxCostPerOp`. At the 25 nAVAX that docblock assumes, that is about 0.047
   * AVAX and the paymaster would refuse its own bootstrap operation. It does
   * not bite today only because Fuji's base fee is nine orders of magnitude
   * lower — which is a reason to choose `maxCostPerOp` from this arithmetic
   * when the paymaster is finally deployed, not a reason to ignore it.
   */
  it('shows that a deploying operation reserves far more than 800k gas', () => {
    const deploying: UserOperationDraft = {
      ...draft,
      verificationGasLimit: DEPLOYMENT_VERIFICATION_GAS_LIMIT,
      callGasLimit: REGISTER_CALL_GAS_LIMIT,
    };

    const gas =
      deploying.verificationGasLimit +
      deploying.callGasLimit +
      deploying.preVerificationGas +
      (deploying.paymaster?.verificationGasLimit ?? 0n);

    expect(gas).toBeGreaterThan(1_800_000n);

    // At the 25 nAVAX the paymaster's docblock assumes, this is over its
    // recommended 0.02 AVAX ceiling.
    expect(gas * 25_000_000_000n).toBeGreaterThan(20_000_000_000_000_000n);
  });
});

describe('preVerificationGas is sized against the signature the operation will carry', () => {
  it('measures the placeholder envelope, not the empty signature in the draft', () => {
    const sized = sizePreVerificationGas({ draft, beneficiary: RELAYER });

    // Same draft, but with the envelope already in place: the answer must not
    // move, because the placeholder is what was measured either way.
    const already = sizePreVerificationGas({
      draft: { ...draft, signature: PLACEHOLDER_ASSERTION_SIGNATURE },
      beneficiary: RELAYER,
    });

    expect(sized).toBe(already);
  });

  it('is larger for an operation that also deploys its account', () => {
    const deploying = sizePreVerificationGas({
      draft: { ...draft, initCode: `0x${'99'.repeat(20)}${'ab'.repeat(68)}` },
      beneficiary: RELAYER,
    });

    expect(deploying).toBeGreaterThan(sizePreVerificationGas({ draft, beneficiary: RELAYER }));
  });
});
