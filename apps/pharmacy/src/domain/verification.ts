import {
  PrescriptionStatus,
  type Address,
  type Bytes32,
  type PrescriptionDocument,
  type PrescriptionRecord,
  type VerificationResult,
} from '@recetas/shared';
import type { RejectionReason } from './rejection';

/**
 * The five checks of screen P3 (docs/17), in order and independently reportable.
 *
 * "Cinco comprobaciones, cinco líneas. Integridad, vigencia, unicidad, firma y
 * correspondencia son verificaciones distintas que pueden fallar por motivos
 * distintos. Colapsarlas en un spinner impide que el farmacéutico sepa qué
 * falló cuando algo falle." — docs/17, P3.
 *
 * This module is pure: no I/O, no React, no viem, no clock. The reference
 * timestamp is an input precisely so expiry is derived from BLOCK time and
 * never from `Date.now()` (docs/17: a device with a skewed clock must not
 * disagree with the contract).
 */

export type CheckId =
  | 'registered'
  | 'not-dispensed'
  | 'integrity'
  | 'prescriber-signature'
  | 'patient-commitment';

/** Pipeline order. Reordering changes what the pharmacist sees fail first. */
export const CHECK_ORDER = [
  'registered',
  'not-dispensed',
  'integrity',
  'prescriber-signature',
  'patient-commitment',
] as const satisfies readonly CheckId[];

export type CheckState = 'pending' | 'passed' | 'failed' | 'skipped';

export interface CheckResult {
  id: CheckId;
  state: CheckState;
}

/** Initial list for P3, before any answer has arrived. */
export function pendingChecks(): CheckResult[] {
  return CHECK_ORDER.map((id) => ({ id, state: 'pending' }));
}

/**
 * Everything checks 3 to 5 need, already materialised by the application layer.
 *
 * HARD RULE (docs/03): the salt used to recompute the commitment stays inside
 * the decrypted document. It is recomputed by the caller and only its keccak256
 * output reaches this module — the salt itself never appears in a result, a
 * log line or a URL.
 */
export interface DocumentEvidence {
  /** The decrypted, schema-validated prescription. */
  document: PrescriptionDocument;
  /** keccak256 of the ciphertext actually downloaded from the off-chain store. */
  storedContentHash: Bytes32;
  /**
   * The contentHash the QR carries. It is also the key the chain was queried
   * with, so matching it means matching what the chain indexed.
   */
  anchoredContentHash: Bytes32;
  /** Signer declared by the envelope's EIP-712 signature. */
  signer: Address;
  /** Result of verifying that signature offline against the on-chain record. */
  signatureValid: boolean;
  /** keccak256(patientId, salt) recomputed from the decrypted document. */
  recomputedPatientCommitment: Bytes32;
}

export interface VerificationEvidence {
  /** Block timestamp in Unix seconds. NEVER the device clock (docs/17). */
  referenceTimestamp: bigint;
  /** Return of `PrescriptionRegistry.verify`. */
  chain: VerificationResult;
  /** Return of `PrescriptionRegistry.getPrescription`. */
  record: PrescriptionRecord;
  /**
   * Absent while checks 1 and 2 have not passed: nothing is downloaded or
   * decrypted before the chain authorises it (docs/05, dispense sequence).
   */
  document?: DocumentEvidence | undefined;
}

export type VerificationOutcome =
  | {
      outcome: 'dispensable';
      document: PrescriptionDocument;
      record: PrescriptionRecord;
      checks: CheckResult[];
    }
  | { outcome: 'rejected'; reason: RejectionReason; checks: CheckResult[] };

/** Outcome of one individual check. */
export type CheckOutcome = { ok: true } | { ok: false; reason: RejectionReason };

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

// --- The five checks, each a pure predicate over its own evidence ----------

/** 1. The prescription exists on chain at all. */
export function checkRegistered(chain: VerificationResult): CheckOutcome {
  return chain.status === PrescriptionStatus.None
    ? { ok: false, reason: { code: 'unknown-prescription' } }
    : { ok: true };
}

/**
 * 2. Still dispensable: issued, not dispensed, not cancelled, not expired.
 *
 * Expiry is DERIVED here, exactly as `PrescriptionRegistry.dispense` derives
 * it: `block.timestamp >= expiresAt` reverts with `PrescriptionExpired`. A
 * client that waits for an enum value that never arrives shows "Emitida" over
 * an expired prescription and the pharmacist finds out when the transaction
 * fails (docs/17).
 */
export function checkNotDispensed(
  chain: VerificationResult,
  record: PrescriptionRecord,
  referenceTimestamp: bigint,
): CheckOutcome {
  if (chain.status === PrescriptionStatus.Dispensed) {
    // P6. The evidence the whole product is built around.
    return {
      ok: false,
      reason: {
        code: 'already-dispensed',
        dispensedBy: record.dispensedBy,
        dispensedAt: record.dispensedAt,
      },
    };
  }

  if (chain.status === PrescriptionStatus.Cancelled) {
    return { ok: false, reason: { code: 'cancelled' } };
  }

  if (referenceTimestamp >= chain.expiresAt) {
    return { ok: false, reason: { code: 'expired', expiresAt: chain.expiresAt } };
  }

  return { ok: true };
}

/**
 * 3. Integrity, BEFORE decryption (docs/05, dispense sequence).
 *
 * `anchoredContentHash` is both the QR's claim and the key the chain answered
 * for, so one comparison covers "the QR was not edited" and "the stored blob is
 * the one the chain indexed".
 */
export function checkIntegrity(evidence: DocumentEvidence): CheckOutcome {
  if (sameHex(evidence.storedContentHash, evidence.anchoredContentHash)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: {
      code: 'integrity-failed',
      anchoredContentHash: evidence.anchoredContentHash,
      storedContentHash: evidence.storedContentHash,
    },
  };
}

/** 4. The envelope's EIP-712 signature recovers to the on-chain prescriber. */
export function checkPrescriberSignature(
  evidence: DocumentEvidence,
  record: PrescriptionRecord,
): CheckOutcome {
  if (!sameHex(evidence.signer, record.prescriber) || !evidence.signatureValid) {
    return {
      ok: false,
      reason: { code: 'signature-failed', signer: evidence.signer, prescriber: record.prescriber },
    };
  }

  return { ok: true };
}

/** 5. keccak256(patientId, salt) equals the commitment anchored at issue time. */
export function checkPatientCommitment(
  evidence: DocumentEvidence,
  record: PrescriptionRecord,
): CheckOutcome {
  return sameHex(evidence.recomputedPatientCommitment, record.patientCommitment)
    ? { ok: true }
    : { ok: false, reason: { code: 'patient-mismatch' } };
}

// --- The pipeline ----------------------------------------------------------

class ChecklistBuilder {
  private readonly results: CheckResult[] = pendingChecks();

  private cursor = 0;

  /** Records an outcome and returns whether the pipeline may continue. */
  record(outcome: CheckOutcome): boolean {
    const current = this.results[this.cursor];
    if (current === undefined) {
      throw new Error(`verification pipeline overran its ${CHECK_ORDER.length} checks`);
    }

    this.cursor += 1;
    current.state = outcome.ok ? 'passed' : 'failed';
    return outcome.ok;
  }

  /**
   * Every check after a failure is `skipped`, never `passed`.
   *
   * A checklist that keeps ticking green lines after a red one is lying about
   * evidence it never gathered (docs/17, P3).
   */
  skipRemaining(): void {
    for (let index = this.cursor; index < this.results.length; index += 1) {
      const pending = this.results[index];
      if (pending !== undefined) pending.state = 'skipped';
    }
    this.cursor = this.results.length;
  }

  snapshot(): CheckResult[] {
    return this.results.map((result) => ({ ...result }));
  }
}

/**
 * Chain-side verdict: checks 1 and 2 only.
 *
 * Exported on its own so the application layer can short-circuit BEFORE it
 * downloads or decrypts anything. The chain is asked first and nothing else
 * happens if it says no (docs/05).
 */
export function evaluateChainState(
  chain: VerificationResult,
  record: PrescriptionRecord,
  referenceTimestamp: bigint,
): CheckOutcome {
  const registered = checkRegistered(chain);
  if (!registered.ok) return registered;

  return checkNotDispensed(chain, record, referenceTimestamp);
}

/**
 * Runs the five checks in order, short-circuiting on the first failure.
 *
 * The returned `checks` array always has five entries in `CHECK_ORDER`, so P3
 * can render the same five lines whatever happens.
 */
export function runVerification(evidence: VerificationEvidence): VerificationOutcome {
  const checklist = new ChecklistBuilder();

  const reject = (reason: RejectionReason): VerificationOutcome => {
    checklist.skipRemaining();
    return { outcome: 'rejected', reason, checks: checklist.snapshot() };
  };

  const registered = checkRegistered(evidence.chain);
  if (!checklist.record(registered)) {
    return reject(registered.ok ? unreachable() : registered.reason);
  }

  const notDispensed = checkNotDispensed(
    evidence.chain,
    evidence.record,
    evidence.referenceTimestamp,
  );
  if (!checklist.record(notDispensed)) {
    return reject(notDispensed.ok ? unreachable() : notDispensed.reason);
  }

  const document = evidence.document;
  if (document === undefined) {
    // The chain authorised the dispensation but the off-chain document never
    // arrived, so checks 3 to 5 have no evidence to run against. This is an
    // incomplete verification, not a verdict about the prescription.
    checklist.skipRemaining();
    return {
      outcome: 'rejected',
      reason: {
        code: 'network-error',
        message:
          'No se pudo recuperar el documento cifrado de la receta, así que la verificación ' +
          'quedó incompleta.',
      },
      checks: checklist.snapshot(),
    };
  }

  const integrity = checkIntegrity(document);
  if (!checklist.record(integrity)) {
    return reject(integrity.ok ? unreachable() : integrity.reason);
  }

  const signature = checkPrescriberSignature(document, evidence.record);
  if (!checklist.record(signature)) {
    return reject(signature.ok ? unreachable() : signature.reason);
  }

  const commitment = checkPatientCommitment(document, evidence.record);
  if (!checklist.record(commitment)) {
    return reject(commitment.ok ? unreachable() : commitment.reason);
  }

  return {
    outcome: 'dispensable',
    document: document.document,
    record: evidence.record,
    checks: checklist.snapshot(),
  };
}

function unreachable(): never {
  throw new Error('verification pipeline reported a failure without a reason');
}

function checklistWith(target: CheckId, targetState: 'failed' | 'skipped'): CheckResult[] {
  const index = CHECK_ORDER.indexOf(target);
  if (index < 0) throw new Error(`unknown check id: ${target}`);

  return CHECK_ORDER.map((id, position) => ({
    id,
    state: position < index ? 'passed' : position === index ? targetState : 'skipped',
  }));
}

/**
 * Verdict for a check that ran and said no.
 *
 * Lets the application layer short-circuit mid-flight — the chain is asked
 * before anything is downloaded, and the integrity check runs before anything
 * is decrypted — while still handing P3 the same five lines, with every later
 * check `skipped` rather than silently `passed`.
 */
export function rejectAt(failed: CheckId, reason: RejectionReason): VerificationOutcome {
  return { outcome: 'rejected', reason, checks: checklistWith(failed, 'failed') };
}

/**
 * Verdict for a check that could not run at all — the node or the store did not
 * answer. Nothing is marked `failed`, because nothing was disproved: the check
 * and everything after it are `skipped`.
 */
export function abortAt(next: CheckId, reason: RejectionReason): VerificationOutcome {
  return { outcome: 'rejected', reason, checks: checklistWith(next, 'skipped') };
}
