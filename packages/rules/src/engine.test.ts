import { describe, expect, it } from 'vitest';
import type { PrescriptionItem } from '@recetas/shared';
import { evaluate } from './engine';
import { EMPTY_PATIENT_CONTEXT, RULESET_VERSION, type PatientContext } from './types';
import { atcLevel4 } from './atc';

function item(overrides: Partial<PrescriptionItem> = {}): PrescriptionItem {
  return {
    atcCode: 'J01CA04',
    activeIngredient: 'amoxicillin',
    strength: '500 mg',
    doseForm: 'capsule',
    quantity: 21,
    dosageInstruction: '1 capsule every 8 hours for 7 days',
    ...overrides,
  };
}

const noAllergies: PatientContext = EMPTY_PATIENT_CONTEXT;

describe('atcLevel4', () => {
  it('truncates to the chemical subgroup', () => {
    expect(atcLevel4('J01CA04')).toBe('J01CA');
    expect(atcLevel4('j01ca08')).toBe('J01CA');
  });

  it('returns null when the code is too short to resolve level 4', () => {
    expect(atcLevel4('J01')).toBeNull();
    expect(atcLevel4('')).toBeNull();
  });
});

describe('DUPLICATE_THERAPY', () => {
  it('raises a moderate alert when two items share the ATC level 4 subgroup', () => {
    const alerts = evaluate(
      {
        items: [
          item({ atcCode: 'J01CA04', activeIngredient: 'amoxicillin' }),
          item({ atcCode: 'J01CA08', activeIngredient: 'pivmecillinam' }),
        ],
      },
      noAllergies,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      code: 'DUPLICATE_THERAPY',
      severity: 'moderate',
      evidence: ['J01CA04', 'J01CA08'],
      rulesetVersion: RULESET_VERSION,
    });
  });

  it('stays silent for different subgroups', () => {
    const alerts = evaluate(
      {
        items: [
          item({ atcCode: 'J01CA04' }),
          item({ atcCode: 'N02BE01', activeIngredient: 'paracetamol' }),
        ],
      },
      noAllergies,
    );

    expect(alerts).toHaveLength(0);
  });

  it('reports each pair once', () => {
    const alerts = evaluate(
      {
        items: [
          item({ atcCode: 'J01CA04' }),
          item({ atcCode: 'J01CA08' }),
          item({ atcCode: 'J01CA01' }),
        ],
      },
      noAllergies,
    );

    // 3 items in the same subgroup -> 3 pairs, not 6.
    expect(alerts).toHaveLength(3);
  });

  it('skips items whose ATC code cannot resolve level 4', () => {
    const alerts = evaluate(
      { items: [item({ atcCode: 'J01' }), item({ atcCode: 'J01' })] },
      noAllergies,
    );

    expect(alerts).toHaveLength(0);
  });
});

describe('DECLARED_ALLERGY', () => {
  it('raises a critical alert on an exact match against the declared allergies', () => {
    const alerts = evaluate(
      { items: [item({ activeIngredient: 'amoxicillin' })] },
      { declaredAllergies: ['Amoxicillin'], concomitantMedication: [] },
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      code: 'DECLARED_ALLERGY',
      severity: 'critical',
      evidence: ['amoxicillin', 'Amoxicillin'],
      rulesetVersion: RULESET_VERSION,
    });
  });

  it('ignores case, surrounding space and diacritics', () => {
    const alerts = evaluate(
      { items: [item({ activeIngredient: 'metamizol' })] },
      { declaredAllergies: ['  Metamizól '], concomitantMedication: [] },
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.code).toBe('DECLARED_ALLERGY');
  });

  it('does not fire on an unrelated ingredient that shares a fragment', () => {
    const alerts = evaluate(
      { items: [item({ activeIngredient: 'amoxicillin clavulanate' })] },
      { declaredAllergies: ['amoxicillin'], concomitantMedication: [] },
    );

    // Substring matching would fire here. Alert fatigue is a clinical risk.
    expect(alerts).toHaveLength(0);
  });

  it('finds nothing when the doctor declared nothing', () => {
    const alerts = evaluate({ items: [item()] }, noAllergies);
    expect(alerts).toHaveLength(0);
  });
});

describe('evaluate', () => {
  it('returns alerts and never throws, so it can never block issuance', () => {
    const alerts = evaluate({ items: [] }, noAllergies);
    expect(alerts).toEqual([]);
  });

  it('orders critical alerts before moderate ones', () => {
    const alerts = evaluate(
      {
        items: [
          item({ atcCode: 'J01CA04', activeIngredient: 'amoxicillin' }),
          item({ atcCode: 'J01CA08', activeIngredient: 'pivmecillinam' }),
        ],
      },
      { declaredAllergies: ['amoxicillin'], concomitantMedication: [] },
    );

    expect(alerts.map((alert) => alert.code)).toEqual(['DECLARED_ALLERGY', 'DUPLICATE_THERAPY']);
  });

  it('is deterministic: the same input yields the same output', () => {
    const draft = {
      items: [item({ atcCode: 'J01CA04' }), item({ atcCode: 'J01CA08' })],
    };
    const context: PatientContext = {
      declaredAllergies: ['amoxicillin'],
      concomitantMedication: [],
    };

    expect(evaluate(draft, context)).toEqual(evaluate(draft, context));
  });

  it('stamps every alert with the ruleset version', () => {
    const alerts = evaluate(
      { items: [item({ atcCode: 'J01CA04' }), item({ atcCode: 'J01CA08' })] },
      { declaredAllergies: ['amoxicillin'], concomitantMedication: [] },
    );

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.rulesetVersion).toBe(RULESET_VERSION);
    }
  });
});
