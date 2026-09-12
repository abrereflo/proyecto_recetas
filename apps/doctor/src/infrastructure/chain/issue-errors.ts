import { decodeRegistryError, toRegistryRevert, type RegistryRevert } from '@recetas/chain';
import type { IssueRejection } from '../../domain/issuance';

/**
 * Translation of `PrescriptionRegistry`'s custom errors into the doctor's
 * rejection vocabulary (docs/04, docs/17 D5).
 *
 * This is the seam that turns "transaction reverted" into "ya existe en la
 * cadena una receta con esta misma huella de contenido", with its own next
 * step. The Spanish copy lives in domain/issuance.ts, exactly as the pharmacy
 * keeps its copy in domain/rejection.ts and its mapping in
 * infrastructure/chain/registry-errors.ts: the words belong to the domain, the
 * decoding to infrastructure, and the same revert means different things to a
 * consulting room and to a counter.
 *
 * The decoding itself — the `BaseError` walk, the cause-chain recursion over
 * raw revert data and the defensive argument readers — lives in @recetas/chain
 * and is shared with apps/cli and apps/pharmacy (review finding read-002,
 * lineage review-fbc6fee420beae2b). Nothing is re-copied here.
 *
 * Errors that cannot happen while ISSUING — `AlreadyDispensed`, `NotPrescriber`,
 * `UnknownPrescription`, the whole credential-registration family — deliberately
 * return `undefined` so the caller rethrows instead of inventing a verdict for
 * the doctor out of a failure nobody modelled (docs/17: never a generic refusal).
 */

/** Maps one decoded registry revert onto the doctor's rejection reason. */
function rejectionFor(revert: RegistryRevert | undefined): IssueRejection | undefined {
  if (revert === undefined) return undefined;

  switch (revert.name) {
    // The contentHash is already anchored. Only a byte-identical document can
    // produce it, so this is a repeated submission, not a clash.
    case 'AlreadyIssued':
      return { code: 'already-issued', contentHash: revert.contentHash };

    // The registry re-reads the EAS attestation on every `issue`, so a
    // credential revoked after registration cuts access on the next call
    // (docs/04). Access to FUTURE issuance, never to what is already anchored.
    case 'NotAccreditedPractitioner':
      return { code: 'practitioner-credential-missing', account: revert.caller };

    // Expiry is derived client-side at midnight (D-13) before any gas is spent,
    // but if the block advanced past it between the derivation and the write,
    // the contract says so and both paths land on the same reason.
    case 'InvalidExpiry':
      return { code: 'invalid-expiry', expiresAt: revert.expiresAt };

    default:
      return undefined;
  }
}

/** Maps one decoded custom error, by name and arguments, onto its rejection. */
export function issueRejectionForError(
  errorName: string,
  args: readonly unknown[] | undefined,
): IssueRejection | undefined {
  return rejectionFor(toRegistryRevert(errorName, args));
}

/** Pulls an issuing rejection out of whatever viem threw. */
export function decodeIssueRejection(error: unknown): IssueRejection | undefined {
  return rejectionFor(decodeRegistryError(error));
}
