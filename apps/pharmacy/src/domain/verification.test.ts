import { describe, expect, it } from 'vitest';
import { PrescriptionStatus } from '@recetas/shared';
import {
  BLOCK_TIME,
  CONTENT_HASH,
  DISPENSED_AT,
  EXPIRES_AT,
  OTHER_COMMITMENT,
  OTHER_SIGNER,
  PHARMACY_A,
  PRESCRIBER,
  TAMPERED_CONTENT_HASH,
  aChainState,
  aDocumentEvidence,
  aRecord,
  anEvidence,
} from '../test/fixtures';
import {
  CHECK_ORDER,
  abortAt,
  pendingChecks,
  rejectAt,
  runVerification,
  type CheckId,
  type CheckResult,
  type CheckState,
} from './verification';

/**
 * The five checks of screen P3 (docs/17).
 *
 * Each test drives one check to failure and asserts three things: the reason
 * code, the evidence it carries, and that every later check is `skipped` and
 * never silently `passed`.
 */

function stateOf(checks: CheckResult[], id: CheckId): CheckState {
  const found = checks.find((check) => check.id === id);
  if (found === undefined) throw new Error(`check ${id} missing from the result`);
  return found.state;
}

function statesAfter(checks: CheckResult[], id: CheckId): CheckState[] {
  const index = CHECK_ORDER.indexOf(id);
  return checks.slice(index + 1).map((check) => check.state);
}

describe('the checklist itself', () => {
  it('lists the five checks of P3 in pipeline order', () => {
    expect(CHECK_ORDER).toEqual([
      'registered',
      'not-dispensed',
      'integrity',
      'prescriber-signature',
      'patient-commitment',
    ]);
  });

  it('starts every check pending, so P3 can render five lines before any answer', () => {
    expect(pendingChecks()).toEqual([
      { id: 'registered', state: 'pending' },
      { id: 'not-dispensed', state: 'pending' },
      { id: 'integrity', state: 'pending' },
      { id: 'prescriber-signature', state: 'pending' },
      { id: 'patient-commitment', state: 'pending' },
    ]);
  });

  it('always reports all five checks, whatever the outcome', () => {
    const rejected = runVerification(anEvidence({ chain: aChainState({ status: PrescriptionStatus.None }) }));
    const accepted = runVerification(anEvidence());

    expect(rejected.checks).toHaveLength(CHECK_ORDER.length);
    expect(accepted.checks).toHaveLength(CHECK_ORDER.length);
  });
});

describe('the happy path', () => {
  it('passes all five checks and returns the decrypted document and the record', () => {
    const evidence = anEvidence();
    const result = runVerification(evidence);

    expect(result.outcome).toBe('dispensable');
    if (result.outcome !== 'dispensable') throw new Error('expected a dispensable outcome');

    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(result.record).toEqual(evidence.record);
    expect(result.document.patient.fullName).toBe('Paciente de Prueba');
  });
});

describe('check 1 — registered', () => {
  it('rejects an unknown prescription and skips every later check', () => {
    const result = runVerification(
      anEvidence({ chain: aChainState({ status: PrescriptionStatus.None, dispensable: false }) }),
    );

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toEqual({ code: 'unknown-prescription' });
    expect(stateOf(result.checks, 'registered')).toBe('failed');
    expect(statesAfter(result.checks, 'registered')).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });
});

describe('check 2 — not dispensed', () => {
  // This is the single most important behaviour in the product (docs/00,
  // docs/04, docs/17 P6): the verdict has to name who dispensed and when.
  it('surfaces dispensedBy and dispensedAt for an already dispensed prescription', () => {
    const result = runVerification(
      anEvidence({
        chain: aChainState({ status: PrescriptionStatus.Dispensed, dispensable: false }),
        record: aRecord({
          status: PrescriptionStatus.Dispensed,
          dispensedBy: PHARMACY_A,
          dispensedAt: DISPENSED_AT,
        }),
      }),
    );

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') throw new Error('expected a rejection');

    expect(result.reason).toEqual({
      code: 'already-dispensed',
      dispensedBy: PHARMACY_A,
      dispensedAt: DISPENSED_AT,
    });
    expect(stateOf(result.checks, 'registered')).toBe('passed');
    expect(stateOf(result.checks, 'not-dispensed')).toBe('failed');
    expect(statesAfter(result.checks, 'not-dispensed')).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('rejects a cancelled prescription with its own code', () => {
    const result = runVerification(
      anEvidence({
        chain: aChainState({ status: PrescriptionStatus.Cancelled, dispensable: false }),
        record: aRecord({ status: PrescriptionStatus.Cancelled }),
      }),
    );

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({ code: 'cancelled' });
    expect(statesAfter(result.checks, 'not-dispensed')).toEqual(['skipped', 'skipped', 'skipped']);
  });

  // Expiry is derived against BLOCK time, never the device clock (docs/17), and
  // the boundary must match `block.timestamp >= p.expiresAt` in
  // PrescriptionRegistry.dispense.
  describe('expiry boundary against the injected reference timestamp', () => {
    it('is still valid one second before expiresAt', () => {
      const result = runVerification(anEvidence({ referenceTimestamp: EXPIRES_AT - 1n }));
      expect(result.outcome).toBe('dispensable');
    });

    it('is expired exactly at expiresAt', () => {
      const result = runVerification(anEvidence({ referenceTimestamp: EXPIRES_AT }));

      if (result.outcome !== 'rejected') throw new Error('expected a rejection');
      expect(result.reason).toEqual({ code: 'expired', expiresAt: EXPIRES_AT });
      expect(stateOf(result.checks, 'not-dispensed')).toBe('failed');
      expect(statesAfter(result.checks, 'not-dispensed')).toEqual([
        'skipped',
        'skipped',
        'skipped',
      ]);
    });

    it('is expired one second after expiresAt', () => {
      const result = runVerification(anEvidence({ referenceTimestamp: EXPIRES_AT + 1n }));

      if (result.outcome !== 'rejected') throw new Error('expected a rejection');
      expect(result.reason).toEqual({ code: 'expired', expiresAt: EXPIRES_AT });
    });

    it('ignores the device clock entirely: only the injected timestamp decides', () => {
      const past = runVerification(anEvidence({ referenceTimestamp: BLOCK_TIME }));
      const future = runVerification(anEvidence({ referenceTimestamp: EXPIRES_AT + 10_000n }));

      expect(past.outcome).toBe('dispensable');
      expect(future.outcome).toBe('rejected');
    });
  });
});

describe('check 3 — integrity', () => {
  it('rejects a stored document whose hash is not the anchored one', () => {
    const result = runVerification(
      anEvidence({ document: aDocumentEvidence({ storedContentHash: TAMPERED_CONTENT_HASH }) }),
    );

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'integrity-failed',
      anchoredContentHash: CONTENT_HASH,
      storedContentHash: TAMPERED_CONTENT_HASH,
    });
    expect(stateOf(result.checks, 'integrity')).toBe('failed');
    expect(statesAfter(result.checks, 'integrity')).toEqual(['skipped', 'skipped']);
  });

  it('accepts a hash that differs only in case', () => {
    const result = runVerification(
      anEvidence({
        document: aDocumentEvidence({
          storedContentHash: CONTENT_HASH.toUpperCase().replace('0X', '0x') as typeof CONTENT_HASH,
        }),
      }),
    );

    expect(result.outcome).toBe('dispensable');
  });
});

describe('check 4 — prescriber signature', () => {
  it('rejects a document signed by somebody other than the on-chain prescriber', () => {
    const result = runVerification(
      anEvidence({ document: aDocumentEvidence({ signer: OTHER_SIGNER }) }),
    );

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'signature-failed',
      signer: OTHER_SIGNER,
      prescriber: PRESCRIBER,
    });
    expect(stateOf(result.checks, 'prescriber-signature')).toBe('failed');
    expect(statesAfter(result.checks, 'prescriber-signature')).toEqual(['skipped']);
  });

  it('rejects a signature that does not recover, even when the signer matches', () => {
    const result = runVerification(
      anEvidence({ document: aDocumentEvidence({ signatureValid: false }) }),
    );

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'signature-failed',
      signer: PRESCRIBER,
      prescriber: PRESCRIBER,
    });
  });
});

describe('check 5 — patient commitment', () => {
  it('rejects a document whose patient is not the one anchored at issue time', () => {
    const result = runVerification(
      anEvidence({
        document: aDocumentEvidence({ recomputedPatientCommitment: OTHER_COMMITMENT }),
      }),
    );

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({ code: 'patient-mismatch' });
    expect(stateOf(result.checks, 'patient-commitment')).toBe('failed');
    expect(result.checks.slice(0, 4).map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
  });

  it('never leaks the patient identifier or the salt into the reason', () => {
    const result = runVerification(
      anEvidence({
        document: aDocumentEvidence({ recomputedPatientCommitment: OTHER_COMMITMENT }),
      }),
    );

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(JSON.stringify(result.reason)).not.toContain('CI-0000000');
    expect(JSON.stringify(result.reason)).not.toContain('0x5555');
  });
});

describe('a document that never arrived', () => {
  it('reports an incomplete verification instead of a verdict about the receta', () => {
    const result = runVerification(anEvidence({ document: undefined }));

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('network-error');
    expect(stateOf(result.checks, 'registered')).toBe('passed');
    expect(stateOf(result.checks, 'not-dispensed')).toBe('passed');
    expect(statesAfter(result.checks, 'not-dispensed')).toEqual(['skipped', 'skipped', 'skipped']);
  });
});

describe('short-circuit helpers', () => {
  it('rejectAt marks the named check failed and everything after it skipped', () => {
    const result = rejectAt('integrity', {
      code: 'integrity-failed',
      anchoredContentHash: CONTENT_HASH,
      storedContentHash: TAMPERED_CONTENT_HASH,
    });

    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'failed',
      'skipped',
      'skipped',
    ]);
  });

  it('abortAt marks nothing failed, because nothing was disproved', () => {
    const result = abortAt('integrity', { code: 'network-error', message: 'sin red' });

    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(result.checks.some((check) => check.state === 'failed')).toBe(false);
  });
});
