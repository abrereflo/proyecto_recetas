import { describe, expect, it } from 'vitest';
import { saltToHex } from '@recetas/crypto';
import { prescriptionDocumentSchema } from '@recetas/shared';
import { ISSUED_AT_DATE, SALT_BYTES, aDraft, anItem } from '../test/fixtures';
import {
  DEFAULT_VALIDITY_DAYS,
  MAX_VALIDITY_DAYS,
  buildPrescriptionDocument,
  expiresAtMidnight,
  isoToSeconds,
  validateDraft,
} from './draft';

/**
 * D-13, docs/17: "Se asume medianoche del día de vencimiento; la fecha se
 * muestra sin hora." The derivation is client-side and pinned to Bolivian time.
 */
describe('the expiry derivation', () => {
  /** 2026-09-11T00:00:00-04:00. */
  const SEPTEMBER_11_MIDNIGHT = 1_789_099_200n;
  /** 2026-09-12T00:00:00-04:00. */
  const SEPTEMBER_12_MIDNIGHT = 1_789_185_600n;
  /** 2026-10-11T00:00:00-04:00. */
  const OCTOBER_11_MIDNIGHT = 1_791_691_200n;

  it('lands on midnight, Bolivian time, of the day the validity window ends', () => {
    expect(expiresAtMidnight(ISSUED_AT_DATE, DEFAULT_VALIDITY_DAYS)).toBe(OCTOBER_11_MIDNIGHT);
  });

  it('carries no time of day at all: the instant is exactly 04:00 UTC', () => {
    const seconds = expiresAtMidnight(ISSUED_AT_DATE, 7);
    expect(new Date(Number(seconds) * 1000).toISOString()).toMatch(/T04:00:00\.000Z$/);
  });

  /**
   * The boundary that matters: one second apart across CLINIC midnight, not
   * UTC midnight. A workstation configured elsewhere must not derive a
   * different expiry day than apps/cli or the pharmacy would.
   */
  it('changes expiry day at the clinic midnight, not at the UTC one', () => {
    const lastSecondOfSeptember10 = new Date('2026-09-11T03:59:59.000Z');
    const firstSecondOfSeptember11 = new Date('2026-09-11T04:00:00.000Z');

    expect(expiresAtMidnight(lastSecondOfSeptember10, 1)).toBe(SEPTEMBER_11_MIDNIGHT);
    expect(expiresAtMidnight(firstSecondOfSeptember11, 1)).toBe(SEPTEMBER_12_MIDNIGHT);
  });

  it('is stable across the whole clinic day', () => {
    const morning = expiresAtMidnight(new Date('2026-09-11T13:00:00.000Z'), 1);
    const evening = expiresAtMidnight(new Date('2026-09-12T01:00:00.000Z'), 1);

    expect(morning).toBe(SEPTEMBER_12_MIDNIGHT);
    expect(evening).toBe(SEPTEMBER_12_MIDNIGHT);
  });

  it('refuses a window that is not a whole number of days in range', () => {
    expect(() => expiresAtMidnight(ISSUED_AT_DATE, 0)).toThrow(RangeError);
    expect(() => expiresAtMidnight(ISSUED_AT_DATE, 1.5)).toThrow(RangeError);
    expect(() => expiresAtMidnight(ISSUED_AT_DATE, MAX_VALIDITY_DAYS + 1)).toThrow(RangeError);
  });
});

describe('form validation', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft(aDraft())).toEqual([]);
  });

  it('names every missing patient and practitioner field separately', () => {
    const issues = validateDraft(
      aDraft({
        patient: { patientId: '  ', fullName: '', birthDate: '' },
        practitioner: { licenseNumber: '', fullName: '' },
      }),
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'patient-id-missing',
      'patient-name-missing',
      'patient-birth-date-missing',
      'practitioner-license-missing',
      'practitioner-name-missing',
    ]);
  });

  it('refuses a prescription with no medication', () => {
    expect(validateDraft(aDraft({ items: [] })).map((issue) => issue.code)).toEqual(['items-empty']);
  });

  it('points at the offending item by index', () => {
    const issues = validateDraft(
      aDraft({ items: [anItem(), anItem({ quantity: 0 }), anItem({ atcCode: '' })] }),
    );

    expect(issues).toEqual([
      expect.objectContaining({ code: 'item-quantity-invalid', itemIndex: 1 }),
      expect.objectContaining({ code: 'item-incomplete', itemIndex: 2 }),
    ]);
  });

  it('refuses a validity window outside the accepted range', () => {
    expect(validateDraft(aDraft({ validityDays: 0 })).map((i) => i.code)).toEqual([
      'validity-days-invalid',
    ]);
    expect(validateDraft(aDraft({ validityDays: MAX_VALIDITY_DAYS + 1 })).map((i) => i.code)).toEqual(
      ['validity-days-invalid'],
    );
  });

  /**
   * HARD RULE (docs/06): form validation is not clinical validation. A draft
   * whose item matches a declared allergy is still a VALID FORM; the alert is
   * advisory and never blocks (docs/17).
   */
  it('says nothing about clinical content', () => {
    const issues = validateDraft(
      aDraft({
        items: [anItem({ activeIngredient: 'amoxicilina' })],
        patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
      }),
    );

    expect(issues).toEqual([]);
  });
});

describe('the assembled document', () => {

  /** R1-001: D4's promise holds only if the motive reaches the sealed document,
   * and the field must stay optional for documents that predate it. */
  it('carries the critical-alert motive, and stays valid without one', () => {
    const written = {
      alertId: 'DECLARED_ALLERGY:J01CA04',
      code: 'DECLARED_ALLERGY' as const,
      severity: 'critical' as const,
      text: 'Alergia leve documentada; el beneficio supera el riesgo.',
      recordedAt: '2026-09-11T13:40:00.000Z',
    };
    const build = (draft = aDraft()) =>
      buildPrescriptionDocument({ draft, salt: SALT_BYTES, issuedAt: ISSUED_AT_DATE }).document;
    const { alertId: _internal, ...motive } = written;

    expect(build(aDraft({ justifications: [written] })).justifications).toEqual([motive]);
    expect(build().justifications).toBeUndefined();
    expect(prescriptionDocumentSchema.safeParse(build()).success).toBe(true);
  });

  /**
   * `catalogueSelections` exists for one checkbox on D3. It is draft state, not
   * clinical content, and the document is what the doctor signs and the
   * pharmacist verifies — so it must stop at the boundary, on the document and
   * on every item inside it.
   */
  it('leaves the D3 checkbox bookkeeping behind, on the document and on its items', () => {
    const { document } = buildPrescriptionDocument({
      draft: aDraft({ items: [anItem()], catalogueSelections: ['morfina'] }),
      salt: SALT_BYTES,
      issuedAt: ISSUED_AT_DATE,
    });

    expect(document).not.toHaveProperty('catalogueSelections');
    for (const item of document.items) expect(item).not.toHaveProperty('catalogueSelections');
    expect(JSON.stringify(document)).not.toContain('catalogueSelections');
    expect(prescriptionDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('carries the salt and the patient identifier, and nothing else does', () => {
    const { document, issuedAtSeconds, expiresAtSeconds } = buildPrescriptionDocument({
      draft: aDraft(),
      salt: SALT_BYTES,
      issuedAt: ISSUED_AT_DATE,
    });

    expect(document.salt).toBe(saltToHex(SALT_BYTES));
    expect(document.patient.patientId).toBe('CI-0000000');
    expect(issuedAtSeconds).toBe(1_789_134_060n);
    expect(expiresAtSeconds).toBe(1_791_691_200n);
  });

  it('states the same expiry instant in both representations', () => {
    const { document, expiresAtSeconds } = buildPrescriptionDocument({
      draft: aDraft(),
      salt: SALT_BYTES,
      issuedAt: ISSUED_AT_DATE,
    });

    expect(isoToSeconds(document.expiresAt)).toBe(expiresAtSeconds);
  });

  it('trims the values the doctor typed', () => {
    const { document } = buildPrescriptionDocument({
      draft: aDraft({
        patient: { patientId: '  CI-1 ', fullName: ' Nombre ', birthDate: ' 1990-01-01 ' },
      }),
      salt: SALT_BYTES,
      issuedAt: ISSUED_AT_DATE,
    });

    expect(document.patient).toEqual({
      patientId: 'CI-1',
      fullName: 'Nombre',
      birthDate: '1990-01-01',
    });
  });
});
