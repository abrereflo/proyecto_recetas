import { decodeRegistryError, toRegistryRevert, type RegistryRevert } from '@recetas/chain';
import type { RejectionReason } from '../../domain/rejection';

/**
 * Translation of `PrescriptionRegistry`'s custom errors into domain rejection
 * codes (docs/04, docs/17 P6 and P7).
 *
 * This is the seam that turns "transaction reverted" into "ya fue dispensada
 * el 11/09/2026 a las 09:42 por otra farmacia". The Spanish copy lives in
 * domain/rejection.ts; this file only produces the machine-readable reason and
 * the evidence it carries.
 *
 * The decoding itself — the `BaseError` walk, the cause-chain recursion over
 * raw revert data and the defensive argument readers — moved to @recetas/chain,
 * where apps/cli and the doctor app share it (review finding read-002, lineage
 * review-fbc6fee420beae2b). What stays here is the only part that is the
 * pharmacy's own: which reverts are a verdict for the counter, and what the
 * counter calls them.
 *
 * Errors that cannot happen to a pharmacy (`AlreadyIssued`, `NotPrescriber`,
 * the credential-registration family) deliberately return `undefined` so the
 * caller rethrows instead of inventing a verdict for the counter.
 */

/** Maps one decoded registry revert onto its rejection reason. */
function rejectionFor(revert: RegistryRevert | undefined): RejectionReason | undefined {
  if (revert === undefined) return undefined;

  switch (revert.name) {
    // P6. `dispensedBy` and `dispensedAt` are the whole point of this error.
    case 'AlreadyDispensed':
      return {
        code: 'already-dispensed',
        dispensedBy: revert.dispensedBy,
        dispensedAt: revert.dispensedAt,
      };

    // The clock/block race fallback: expiry is normally derived client-side
    // before any gas is spent, but if the block advanced past `expiresAt`
    // between the read and the write, the contract says so and both paths land
    // on the same reason (docs/04, docs/17).
    case 'PrescriptionExpired':
      return { code: 'expired', expiresAt: revert.expiresAt };

    case 'PrescriptionCancelledError':
      return { code: 'cancelled' };

    case 'UnknownPrescription':
      return { code: 'unknown-prescription' };

    // The registry re-reads the EAS attestation on every `dispense`, so a
    // credential revoked after registration cuts access on the next call.
    case 'NotAccreditedPharmacy':
      return { code: 'pharmacy-credential-revoked', account: revert.caller };

    default:
      return undefined;
  }
}

/** Maps one decoded custom error, by name and arguments, onto its reason. */
export function rejectionForError(
  errorName: string,
  args: readonly unknown[] | undefined,
): RejectionReason | undefined {
  return rejectionFor(toRegistryRevert(errorName, args));
}

/** Pulls a rejection reason out of whatever viem threw. */
export function decodeRegistryRejection(error: unknown): RejectionReason | undefined {
  return rejectionFor(decodeRegistryError(error));
}
