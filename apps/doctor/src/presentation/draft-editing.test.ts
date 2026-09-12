import { describe, expect, it } from 'vitest';
import { alertIdentity, dismissAlert, partitionAlerts } from '../domain/alerts';
import { aDraft, anItem } from '../test/fixtures';
import {
  addItem,
  alertsFor,
  editDraft,
  emptyDraft,
  findOffendingItem,
  removeItem,
  replaceItem,
} from './draft-editing';

/**
 * Draft editing is where the dismissal model is kept honest: a decision must
 * not survive the fact it was about.
 */

const RECORDED_AT = '2026-09-11T13:41:00.000Z';

/** A draft whose only item collides with the only declared allergy. */
function allergicDraft() {
  return aDraft({
    items: [anItem({ activeIngredient: 'amoxicilina' })],
    patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
  });
}

function justifyEverything(draft: ReturnType<typeof allergicDraft>) {
  const [alert] = alertsFor(draft);
  if (alert === undefined) throw new Error('expected a critical alert');

  return editDraft(draft, {
    justifications: dismissAlert(draft.justifications, {
      alert,
      text: 'Reacción previa leve y sin alternativa terapéutica disponible.',
      recordedAt: RECORDED_AT,
    }),
  });
}

describe('a blank draft', () => {
  it('starts with one empty item, so D3 has a line to type into', () => {
    const draft = emptyDraft();

    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.activeIngredient).toBe('');
    expect(draft.justifications).toEqual([]);
  });

  it('raises no alert, because nothing has been declared yet', () => {
    expect(alertsFor(emptyDraft())).toEqual([]);
  });
});

describe('a recorded decision only covers the fact it was made about', () => {
  it('moves the alert into the dismissed group once the motive is written', () => {
    const draft = justifyEverything(allergicDraft());
    const { active, previouslyDismissed } = partitionAlerts(alertsFor(draft), draft.justifications);

    expect(active).toEqual([]);
    expect(previouslyDismissed).toHaveLength(1);
    expect(previouslyDismissed[0]?.justification?.text).toContain('Reacción previa');
  });

  it('drops the decision the moment the triggering item is edited', () => {
    const justified = justifyEverything(allergicDraft());

    const edited = replaceItem(justified, 0, { activeIngredient: 'ibuprofeno' });

    // The alert is gone with the collision, and so is the decision about it.
    expect(alertsFor(edited)).toEqual([]);
    expect(edited.justifications).toEqual([]);
  });

  it('does not resurrect a decision when the same fact is typed back in', () => {
    const justified = justifyEverything(allergicDraft());
    const away = replaceItem(justified, 0, { activeIngredient: 'ibuprofeno' });

    const back = replaceItem(away, 0, { activeIngredient: 'amoxicilina' });
    const { active, previouslyDismissed } = partitionAlerts(alertsFor(back), back.justifications);

    expect(active).toHaveLength(1);
    expect(previouslyDismissed).toEqual([]);
  });

  it('keeps a decision that is still about a live fact', () => {
    const justified = justifyEverything(allergicDraft());

    // An edit somewhere else entirely: the allergy collision is untouched.
    const edited = replaceItem(justified, 0, { dosageInstruction: '1 cápsula cada 12 horas' });

    expect(edited.justifications).toHaveLength(1);
    expect(partitionAlerts(alertsFor(edited), edited.justifications).active).toEqual([]);
  });

  it('drops the decision when the declared allergy is withdrawn on D2', () => {
    const justified = justifyEverything(allergicDraft());

    const edited = editDraft(justified, {
      patientContext: { declaredAllergies: [], concomitantMedication: [] },
    });

    expect(edited.justifications).toEqual([]);
  });

  it('drops the decision when the offending item is removed', () => {
    const justified = justifyEverything(allergicDraft());
    const withTwo = addItem(justified);

    const edited = removeItem(withTwo, 0);

    expect(alertsFor(edited)).toEqual([]);
    expect(edited.justifications).toEqual([]);
  });
});

describe('the item a critical alert is about', () => {
  it('is found from the evidence the engine attached to it', () => {
    const draft = aDraft({
      items: [anItem({ activeIngredient: 'ibuprofeno' }), anItem({ activeIngredient: 'amoxicilina' })],
      patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
    });
    const [alert] = alertsFor(draft);
    if (alert === undefined) throw new Error('expected a critical alert');

    expect(findOffendingItem(draft, alert)).toBe(1);
    expect(alertIdentity(alert)).toContain('DECLARED_ALLERGY');
  });

  it('reports nothing when no item matches, so D4 offers no withdrawal', () => {
    const draft = allergicDraft();
    const [alert] = alertsFor(draft);
    if (alert === undefined) throw new Error('expected a critical alert');

    const withoutItem = editDraft(draft, { items: [] });

    expect(findOffendingItem(withoutItem, alert)).toBeUndefined();
  });
});
