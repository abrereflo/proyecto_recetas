import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';
import type { Address } from '@recetas/shared';
import type { RejectionReason } from '../../domain/rejection';
import { prescriptionRegistryAbi } from './registry-abi';

/**
 * Translation of `PrescriptionRegistry`'s custom errors into domain rejection
 * codes (docs/04, docs/17 P6 and P7).
 *
 * This is the seam that turns "transaction reverted" into "ya fue dispensada
 * el 11/09/2026 a las 09:42 por otra farmacia". The Spanish copy lives in
 * domain/rejection.ts; this file only produces the machine-readable reason and
 * the evidence it carries.
 *
 * Errors that cannot happen to a pharmacy (`AlreadyIssued`, `NotPrescriber`,
 * the credential-registration family) deliberately return `undefined` so the
 * caller rethrows instead of inventing a verdict for the counter.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

function addressArg(args: readonly unknown[] | undefined, index: number): Address {
  const value = args?.[index];
  return typeof value === 'string' ? (value as Address) : ZERO_ADDRESS;
}

function timestampArg(args: readonly unknown[] | undefined, index: number): bigint {
  const value = args?.[index];
  return typeof value === 'bigint' ? value : 0n;
}

/** Maps one decoded custom error onto its rejection reason. */
export function rejectionForError(
  errorName: string,
  args: readonly unknown[] | undefined,
): RejectionReason | undefined {
  switch (errorName) {
    // P6. `dispensedBy` and `dispensedAt` are the whole point of this error.
    case 'AlreadyDispensed':
      return {
        code: 'already-dispensed',
        dispensedBy: addressArg(args, 1),
        dispensedAt: timestampArg(args, 2),
      };

    // The clock/block race fallback: expiry is normally derived client-side
    // before any gas is spent, but if the block advanced past `expiresAt`
    // between the read and the write, the contract says so and both paths land
    // on the same reason (docs/04, docs/17).
    case 'PrescriptionExpired':
      return { code: 'expired', expiresAt: timestampArg(args, 1) };

    case 'PrescriptionCancelledError':
      return { code: 'cancelled' };

    case 'UnknownPrescription':
      return { code: 'unknown-prescription' };

    // The registry re-reads the EAS attestation on every `dispense`, so a
    // credential revoked after registration cuts access on the next call.
    case 'NotAccreditedPharmacy':
      return { code: 'pharmacy-credential-revoked', account: addressArg(args, 0) };

    default:
      return undefined;
  }
}

/**
 * Pulls a decoded custom error out of whatever viem threw.
 *
 * Two paths are covered, exactly as in apps/cli: the rich
 * `ContractFunctionRevertedError` raised by `simulateContract`, and a bare
 * revert data blob, which is what some nodes return when estimation is skipped.
 */
export function decodeRegistryRejection(error: unknown): RejectionReason | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);

    if (reverted instanceof ContractFunctionRevertedError && reverted.data !== undefined) {
      return rejectionForError(reverted.data.errorName, reverted.data.args);
    }
  }

  const raw = rawRevertData(error);
  if (raw !== undefined) {
    try {
      const decoded = decodeErrorResult({ abi: prescriptionRegistryAbi, data: raw });
      return rejectionForError(decoded.errorName, decoded.args as readonly unknown[] | undefined);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function rawRevertData(error: unknown): Hex | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = (error as { data?: unknown }).data;
  if (typeof candidate === 'string' && candidate.startsWith('0x') && candidate.length >= 10) {
    return candidate as Hex;
  }

  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : rawRevertData(cause);
}
