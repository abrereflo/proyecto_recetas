import { describe, expect, it } from 'vitest';
import {
  CONTROLLED_MEDICATIONS,
  CONTROLLED_MEDICATION_FAMILIES,
  groupedControlledMedications,
} from './controlled-medications';

/**
 * The catalogue is fixed data, so the tests pin its shape rather than its
 * contents: a wrong ATC code is a clinical error, a duplicated one would make
 * two checkboxes drive the same item.
 */

/** WHO ATC, fifth level: anatomical letter, two digits, two letters, two digits. */
const ATC_CODE = /^[A-Z]\d{2}[A-Z]{2}\d{2}$/;

describe('the controlled-medication catalogue', () => {
  it('holds exactly ten medications', () => {
    expect(CONTROLLED_MEDICATIONS).toHaveLength(10);
  });

  it('gives every medication a distinct id', () => {
    const ids = CONTROLLED_MEDICATIONS.map((medication) => medication.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every medication a distinct ATC code', () => {
    const codes = CONTROLLED_MEDICATIONS.map((medication) => medication.atcCode);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses well-formed WHO ATC codes only', () => {
    for (const medication of CONTROLLED_MEDICATIONS) {
      expect(medication.atcCode).toMatch(ATC_CODE);
    }
  });

  it('leaves no field blank', () => {
    for (const medication of CONTROLLED_MEDICATIONS) {
      expect(medication.id.trim()).not.toBe('');
      expect(medication.activeIngredient.trim()).not.toBe('');
      expect(medication.atcCode.trim()).not.toBe('');
      expect(medication.strength.trim()).not.toBe('');
      expect(medication.doseForm.trim()).not.toBe('');
      expect(medication.family.trim()).not.toBe('');
    }
  });

  it('files every medication under a family the display order knows about', () => {
    for (const medication of CONTROLLED_MEDICATIONS) {
      expect(CONTROLLED_MEDICATION_FAMILIES).toContain(medication.family);
    }
  });
});

/**
 * The grouping is what D3 renders, so an empty family would be a heading with
 * nothing under it, and a dropped entry would be a medication the doctor can no
 * longer prescribe from the list at all.
 */
describe('the catalogue grouped by therapeutic family', () => {
  it('lists the families in the declared display order', () => {
    expect(groupedControlledMedications().map((group) => group.family)).toEqual([
      ...CONTROLLED_MEDICATION_FAMILIES,
    ]);
  });

  it('leaves no family empty', () => {
    for (const group of groupedControlledMedications()) {
      expect(group.medications.length).toBeGreaterThan(0);
    }
  });

  it('keeps every medication, exactly once', () => {
    const grouped = groupedControlledMedications().flatMap((group) => group.medications);

    expect(grouped).toHaveLength(CONTROLLED_MEDICATIONS.length);
    expect(new Set(grouped)).toEqual(new Set(CONTROLLED_MEDICATIONS));
  });
});
