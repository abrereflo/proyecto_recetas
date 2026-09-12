import { describe, expect, it } from 'vitest';
import { evaluate, type ClinicalAlert, type PatientContext } from '@recetas/rules';
import { anItem } from '../test/fixtures';
import {
  JustificationRequiredError,
  MIN_JUSTIFICATION_LENGTH,
  alertIdentity,
  dismissAlert,
  justificationSatisfies,
  partitionAlerts,
  presentAlert,
  pruneJustifications,
  requiresJustification,
} from './alerts';

/**
 * Fase 6, task 12: "supresión de repetición de alertas ya desestimadas".
 *
 * `evaluate()` is stateless and returns the FULL set every time, so suppression
 * has to live outside it. The property that matters is not that a dismissal
 * sticks — it is that it STOPS sticking the moment the evidence changes.
 */

const RECORDED_AT = '2026-09-11T13:41:00.000Z';
const MOTIVE = 'Alergia leve documentada hace años; se mantiene bajo observación.';

function allergyContext(...declaredAllergies: string[]): PatientContext {
  return { declaredAllergies, concomitantMedication: [] };
}

function firstAlert(alerts: ClinicalAlert[]): ClinicalAlert {
  const alert = alerts[0];
  if (alert === undefined) throw new Error('expected at least one alert');
  return alert;
}

describe('alert identity', () => {
  it('is derived from the code and the evidence, never from the array position', () => {
    const items = [anItem({ activeIngredient: 'amoxicilina' }), anItem({ atcCode: 'N02BE01' })];
    const context = allergyContext('amoxicilina');

    const before = evaluate({ items }, context);
    const after = evaluate({ items: [...items].reverse() }, context);

    expect(alertIdentity(firstAlert(before))).toBe(alertIdentity(firstAlert(after)));
  });

  it('ignores incidental spacing and casing in the evidence', () => {
    const a = evaluate({ items: [anItem({ activeIngredient: 'amoxicilina' })] }, allergyContext('Amoxicilina'));
    const b = evaluate({ items: [anItem({ activeIngredient: 'amoxicilina' })] }, allergyContext('  amoxicilina  '));

    expect(alertIdentity(firstAlert(a))).toBe(alertIdentity(firstAlert(b)));
  });

  it('differs when the evidence differs', () => {
    const a = evaluate({ items: [anItem({ activeIngredient: 'amoxicilina' })] }, allergyContext('amoxicilina'));
    const b = evaluate({ items: [anItem({ activeIngredient: 'ibuprofeno' })] }, allergyContext('ibuprofeno'));

    expect(alertIdentity(firstAlert(a))).not.toBe(alertIdentity(firstAlert(b)));
  });
});

describe('dismissing an alert', () => {
  it('demands a written motive for a critical alert (D4)', () => {
    const alert = firstAlert(
      evaluate({ items: [anItem({ activeIngredient: 'amoxicilina' })] }, allergyContext('amoxicilina')),
    );

    expect(alert.severity).toBe('critical');
    expect(requiresJustification(alert)).toBe(true);
    expect(justificationSatisfies(alert, '')).toBe(false);
    expect(justificationSatisfies(alert, 'x'.repeat(MIN_JUSTIFICATION_LENGTH - 1))).toBe(false);
    expect(justificationSatisfies(alert, MOTIVE)).toBe(true);

    expect(() => dismissAlert([], { alert, text: ' ', recordedAt: RECORDED_AT })).toThrow(
      JustificationRequiredError,
    );
  });

  it('accepts a moderate alert with no motive at all', () => {
    const alert = firstAlert(
      evaluate(
        { items: [anItem({ atcCode: 'J01CA04' }), anItem({ atcCode: 'J01CA08' })] },
        allergyContext(),
      ),
    );

    expect(alert.code).toBe('DUPLICATE_THERAPY');
    expect(requiresJustification(alert)).toBe(false);
    expect(dismissAlert([], { alert, text: '', recordedAt: RECORDED_AT })).toHaveLength(1);
  });

  it('replaces a previous decision instead of stacking a second one', () => {
    const alert = firstAlert(
      evaluate({ items: [anItem({ activeIngredient: 'amoxicilina' })] }, allergyContext('amoxicilina')),
    );

    const once = dismissAlert([], { alert, text: MOTIVE, recordedAt: RECORDED_AT });
    const twice = dismissAlert(once, {
      alert,
      text: `${MOTIVE} Revisado de nuevo.`,
      recordedAt: '2026-09-11T14:00:00.000Z',
    });

    expect(twice).toHaveLength(1);
    expect(twice[0]?.text).toContain('Revisado de nuevo.');
  });
});

describe('partitioning the current alert set', () => {
  const items = [anItem({ activeIngredient: 'amoxicilina' })];
  const context = allergyContext('amoxicilina');

  it('puts an undecided alert in the active group', () => {
    const partition = partitionAlerts(evaluate({ items }, context), []);

    expect(partition.active).toHaveLength(1);
    expect(partition.previouslyDismissed).toEqual([]);
  });

  it('keeps a dismissed alert suppressed on every later evaluation', () => {
    const alerts = evaluate({ items }, context);
    const justifications = dismissAlert([], {
      alert: firstAlert(alerts),
      text: MOTIVE,
      recordedAt: RECORDED_AT,
    });

    // The engine is stateless: it raises the same alert again, unchanged.
    const partition = partitionAlerts(evaluate({ items }, context), justifications);

    expect(partition.active).toEqual([]);
    expect(partition.previouslyDismissed).toHaveLength(1);
    expect(partition.previouslyDismissed[0]?.justification?.text).toBe(MOTIVE);
  });

  /**
   * THE POINT OF THE WHOLE MODULE. A dismissal is a decision about a concrete
   * clinical fact. Edit the item that produced it and the fact is a different
   * one, so the alert must come back unsuppressed rather than inherit a motive
   * written about something else.
   */
  it('raises the alert again when the doctor edits the item that triggered it', () => {
    const justifications = dismissAlert([], {
      alert: firstAlert(evaluate({ items }, context)),
      text: MOTIVE,
      recordedAt: RECORDED_AT,
    });

    const edited = [anItem({ activeIngredient: 'ampicilina' })];
    const partition = partitionAlerts(
      evaluate({ items: edited }, allergyContext('amoxicilina', 'ampicilina')),
      justifications,
    );

    expect(partition.previouslyDismissed).toEqual([]);
    expect(partition.active).toHaveLength(1);
    expect(partition.active[0]?.evidence).toContain('ampicilina');
  });

  it('raises the alert again when the declared allergy is rewritten', () => {
    const justifications = dismissAlert([], {
      alert: firstAlert(evaluate({ items }, context)),
      text: MOTIVE,
      recordedAt: RECORDED_AT,
    });

    // Same ingredient, different declared wording: different evidence.
    const partition = partitionAlerts(
      evaluate({ items }, allergyContext('amoxicilina trihidrato')),
      justifications,
    );

    expect(partition.active.concat(partition.previouslyDismissed)).toEqual([]);
  });

  it('preserves the engine order inside each group', () => {
    const mixed = [
      anItem({ activeIngredient: 'amoxicilina', atcCode: 'J01CA04' }),
      anItem({ activeIngredient: 'pivmecilinam', atcCode: 'J01CA08' }),
    ];
    const alerts = evaluate({ items: mixed }, context);

    expect(alerts.map((alert) => alert.severity)).toEqual(['critical', 'moderate']);
    expect(partitionAlerts(alerts, []).active.map((alert) => alert.severity)).toEqual([
      'critical',
      'moderate',
    ]);
  });
});

describe('the presentation model', () => {
  it('carries the copy, the severity label, the evidence and the ruleset version', () => {
    const alert = firstAlert(
      evaluate({ items: [anItem({ activeIngredient: 'amoxicilina' })] }, allergyContext('amoxicilina')),
    );

    const presented = presentAlert(alert);

    expect(presented).toMatchObject({
      code: 'DECLARED_ALLERGY',
      severity: 'critical',
      severityLabel: 'Crítica',
      title: 'Alergia declarada',
      requiresJustification: true,
      rulesetVersion: alert.rulesetVersion,
    });
    expect(presented.evidence).toEqual(alert.evidence);
  });
});

describe('pruning decisions', () => {
  it('drops the motive for an alert that is no longer raised', () => {
    const items = [anItem({ activeIngredient: 'amoxicilina' })];
    const justifications = dismissAlert([], {
      alert: firstAlert(evaluate({ items }, allergyContext('amoxicilina'))),
      text: MOTIVE,
      recordedAt: RECORDED_AT,
    });

    expect(pruneJustifications(justifications, evaluate({ items }, allergyContext()))).toEqual([]);
  });

  it('keeps the motive while the alert stands', () => {
    const items = [anItem({ activeIngredient: 'amoxicilina' })];
    const alerts = evaluate({ items }, allergyContext('amoxicilina'));
    const justifications = dismissAlert([], {
      alert: firstAlert(alerts),
      text: MOTIVE,
      recordedAt: RECORDED_AT,
    });

    expect(pruneJustifications(justifications, alerts)).toEqual(justifications);
  });
});
