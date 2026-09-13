import { describe, expect, it } from 'vitest';
import { alertIdentity, dismissAlert, partitionAlerts } from '../domain/alerts';
import { CONTROLLED_MEDICATIONS, type ControlledMedication } from '../domain/controlled-medications';
import { aDraft, anItem } from '../test/fixtures';
import {
  addItem,
  alertsFor,
  editDraft,
  emptyDraft,
  emptyItem,
  findOffendingItem,
  hasDoctorEnteredWork,
  isCatalogueItemSelected,
  removeItem,
  replaceItem,
  toggleCatalogueItem,
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
    expect(draft.catalogueSelections).toEqual([]);
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

describe('removing an item by hand', () => {
  it('leaves one blank line rather than an empty list, so D3 always has a line to type into', () => {
    const draft = aDraft({ items: [anItem()] });

    const edited = removeItem(draft, 0);

    expect(edited.items).toEqual([emptyItem()]);
  });

  it('keeps the other lines when the draft carries more than one', () => {
    const draft = aDraft({ items: [anItem({ activeIngredient: 'ibuprofeno' }), anItem()] });

    const edited = removeItem(draft, 0);

    expect(edited.items).toEqual([anItem()]);
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

describe('picking a controlled medication from the catalogue', () => {
  function catalogued(id: string): ControlledMedication {
    const found = CONTROLLED_MEDICATIONS.find((medication) => medication.id === id);
    if (found === undefined) throw new Error(`expected ${id} in the catalogue`);
    return found;
  }

  const morphine = catalogued('morfina');
  const tramadol = catalogued('tramadol');

  /**
   * The line a checkbox writes: identity and presentation, nothing clinical.
   * Quantity and dosage are left exactly as `emptyItem()` leaves them, because
   * that blankness is what marks the line as nobody's work but the catalogue's.
   */
  function itemFor(medication: ControlledMedication) {
    return anItem({
      atcCode: medication.atcCode,
      activeIngredient: medication.activeIngredient,
      strength: medication.strength,
      doseForm: medication.doseForm,
      quantity: 0,
      dosageInstruction: '',
    });
  }

  describe('is selected', () => {
    it('when the box recorded the pick and its line is still in the draft', () => {
      const draft = aDraft({ items: [itemFor(morphine)], catalogueSelections: [morphine.id] });

      expect(isCatalogueItemSelected(draft, morphine)).toBe(true);
      expect(isCatalogueItemSelected(draft, tramadol)).toBe(false);
    });

    it('never on the ATC code alone', () => {
      const draft = aDraft({
        items: [anItem({ atcCode: morphine.atcCode, activeIngredient: 'otro principio' })],
        catalogueSelections: [morphine.id],
      });

      expect(isCatalogueItemSelected(draft, morphine)).toBe(false);
    });

    it('never on the active ingredient alone', () => {
      const draft = aDraft({
        items: [anItem({ atcCode: 'X00XX00', activeIngredient: morphine.activeIngredient })],
        catalogueSelections: [morphine.id],
      });

      expect(isCatalogueItemSelected(draft, morphine)).toBe(false);
    });
  });

  /**
   * The defect this distinction exists to close. "Checked" used to mean "the
   * draft happens to hold a line that looks like this entry", which a doctor
   * can produce by typing — diazepam 10 mg comprimido N05BA01 is exactly what
   * the catalogue would have written. The box then rendered checked over work
   * the doctor never asked it for, and one click on it deleted that line: the
   * quantity and dosage were still blank, so the guard read it as untouched.
   */
  describe('tracks what the box added, not what the draft happens to contain', () => {
    /** Typed by hand on the item card: every field coincides, nothing recorded. */
    function handTyped() {
      return aDraft({ items: [itemFor(morphine)] });
    }

    it('leaves the box unchecked over a hand-typed line that coincides exactly', () => {
      expect(isCatalogueItemSelected(handTyped(), morphine)).toBe(false);
    });

    it('adds a separate prefilled line instead of deleting the hand-typed one', () => {
      const toggled = toggleCatalogueItem(handTyped(), morphine);

      expect(toggled.items).toHaveLength(2);
      expect(toggled.items[0]).toEqual(itemFor(morphine));
      expect(toggled.items[1]).toEqual(itemFor(morphine));
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(true);
    });

    it('removes the line the box added when the box is unchecked again', () => {
      const checked = toggleCatalogueItem(aDraft({ items: [emptyItem()] }), morphine);

      const unchecked = toggleCatalogueItem(checked, morphine);

      expect(unchecked.items).toEqual([emptyItem()]);
      expect(unchecked.catalogueSelections).toEqual([]);
      expect(isCatalogueItemSelected(unchecked, morphine)).toBe(false);
    });

    it('drops the record when the line is withdrawn with "Quitar ítem"', () => {
      const checked = toggleCatalogueItem(aDraft({ items: [anItem()] }), morphine);
      expect(isCatalogueItemSelected(checked, morphine)).toBe(true);

      const removed = removeItem(checked, 1);

      expect(removed.catalogueSelections).toEqual([]);
      expect(isCatalogueItemSelected(removed, morphine)).toBe(false);
    });

    it('drops the record when the line is edited away from the entry', () => {
      const checked = toggleCatalogueItem(aDraft({ items: [emptyItem()] }), morphine);

      const edited = replaceItem(checked, 0, { activeIngredient: 'morfina liberación prolongada' });

      expect(edited.catalogueSelections).toEqual([]);
      expect(isCatalogueItemSelected(edited, morphine)).toBe(false);
    });

    it('prunes a stale record on any edit at all, like a justification', () => {
      // The pruning lives in `editDraft`, so an edit that has nothing to do
      // with the item list still leaves no record pointing at a missing line.
      const stale = aDraft({ items: [anItem()], catalogueSelections: [morphine.id] });

      const edited = editDraft(stale, { validityDays: 15 });

      expect(edited.catalogueSelections).toEqual([]);
    });

    it('records one entry per box, and never twice for the same box', () => {
      const checked = toggleCatalogueItem(
        toggleCatalogueItem(aDraft({ items: [emptyItem()] }), morphine),
        tramadol,
      );

      const again = toggleCatalogueItem(toggleCatalogueItem(checked, morphine), morphine);

      expect(again.catalogueSelections).toEqual([tramadol.id, morphine.id]);
    });
  });

  describe('checking it', () => {
    it('adds an item prefilled from the catalogue, with quantity and dosage left to the doctor', () => {
      const draft = aDraft({ items: [anItem()] });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toHaveLength(2);
      expect(toggled.items[1]).toEqual({
        atcCode: morphine.atcCode,
        activeIngredient: morphine.activeIngredient,
        strength: morphine.strength,
        doseForm: morphine.doseForm,
        quantity: 0,
        dosageInstruction: '',
      });
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(true);
    });

    it('replaces the single blank line instead of leaving it above', () => {
      const draft = aDraft({ items: [emptyItem()] });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toHaveLength(1);
      expect(toggled.items[0]?.activeIngredient).toBe(morphine.activeIngredient);
    });

    it('keeps a line the doctor has started typing into', () => {
      const draft = aDraft({ items: [anItem({ activeIngredient: 'ibu', atcCode: '' })] });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toHaveLength(2);
      expect(toggled.items[0]?.activeIngredient).toBe('ibu');
    });

    it('adds one line per medication checked', () => {
      const draft = aDraft({ items: [emptyItem()] });

      const toggled = toggleCatalogueItem(toggleCatalogueItem(draft, morphine), tramadol);

      expect(toggled.items.map((item) => item.activeIngredient)).toEqual([
        morphine.activeIngredient,
        tramadol.activeIngredient,
      ]);
    });
  });

  describe('unchecking it', () => {
    it('removes the matching item and keeps the rest', () => {
      const draft = aDraft({
        items: [anItem(), itemFor(morphine)],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual([anItem()]);
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(false);
    });

    it('removes every item that matches, so the checkbox cannot stay checked', () => {
      const draft = aDraft({
        items: [itemFor(morphine), anItem(), itemFor(morphine)],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual([anItem()]);
    });

    it('leaves one blank line rather than an empty list', () => {
      const draft = aDraft({ items: [itemFor(morphine)], catalogueSelections: [morphine.id] });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual([emptyItem()]);
    });

    it('keeps a line the doctor typed a quantity into, and the box stays checked', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), quantity: 30 }],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual(draft.items);
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(true);
    });

    it('keeps a line the doctor typed a dosage into', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), dosageInstruction: '1 comprimido cada 8 horas' }],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual(draft.items);
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(true);
    });

    it('keeps a line whose prefilled strength the doctor corrected', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), strength: '20 mg' }],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual(draft.items);
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(true);
    });

    it('keeps a line whose prefilled dose form the doctor corrected', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), doseForm: 'solución inyectable' }],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual(draft.items);
      expect(isCatalogueItemSelected(toggled, morphine)).toBe(true);
    });

    it('removes nothing when one matching line is untouched and another carries typed work', () => {
      const draft = aDraft({
        items: [itemFor(morphine), { ...itemFor(morphine), quantity: 30 }],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual(draft.items);
    });

    it('still removes a line whose dosage holds nothing but whitespace', () => {
      const draft = aDraft({
        items: [anItem(), { ...itemFor(morphine), dosageInstruction: '   ' }],
        catalogueSelections: [morphine.id],
      });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toEqual([anItem()]);
    });

    it('drops a recorded decision about the withdrawn item, like any other edit', () => {
      const allergic = aDraft({
        items: [itemFor(morphine)],
        catalogueSelections: [morphine.id],
        patientContext: {
          declaredAllergies: [morphine.activeIngredient],
          concomitantMedication: [],
        },
      });
      const justified = justifyEverything(allergic);
      expect(justified.justifications).toHaveLength(1);

      const toggled = toggleCatalogueItem(justified, morphine);

      expect(alertsFor(toggled)).toEqual([]);
      expect(toggled.justifications).toEqual([]);
    });
  });

  describe('telling the doctor why the box will not clear', () => {
    it('reports no work on a line the catalogue wrote and nobody touched', () => {
      const draft = aDraft({ items: [itemFor(morphine)] });

      expect(hasDoctorEnteredWork(draft, morphine)).toBe(false);
    });

    it('reports work once a quantity is typed on the matching line', () => {
      const draft = aDraft({ items: [{ ...itemFor(morphine), quantity: 30 }] });

      expect(hasDoctorEnteredWork(draft, morphine)).toBe(true);
    });

    it('reports work once a dosage is typed on the matching line', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), dosageInstruction: '1 comprimido cada 8 horas' }],
      });

      expect(hasDoctorEnteredWork(draft, morphine)).toBe(true);
    });

    it('reports work once the prefilled strength is corrected on the matching line', () => {
      const draft = aDraft({ items: [{ ...itemFor(morphine), strength: '20 mg' }] });

      expect(hasDoctorEnteredWork(draft, morphine)).toBe(true);
    });

    it('reports work once the prefilled dose form is corrected on the matching line', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), doseForm: 'solución inyectable' }],
      });

      expect(hasDoctorEnteredWork(draft, morphine)).toBe(true);
    });

    it('ignores work typed on a line belonging to another medication', () => {
      const draft = aDraft({ items: [itemFor(morphine), anItem()] });

      expect(hasDoctorEnteredWork(draft, morphine)).toBe(false);
      expect(hasDoctorEnteredWork(draft, tramadol)).toBe(false);
    });
  });

  describe('a prefilled line edited away from the catalogue entry', () => {
    it('stops counting as selected, so the box renders unchecked', () => {
      const draft = aDraft({
        items: [{ ...itemFor(morphine), activeIngredient: 'morfina liberación prolongada' }],
        catalogueSelections: [morphine.id],
      });

      expect(isCatalogueItemSelected(draft, morphine)).toBe(false);
    });

    it('checking the box again appends a fresh line and leaves the edited one alone', () => {
      const edited = { ...itemFor(morphine), activeIngredient: 'morfina liberación prolongada' };
      const draft = aDraft({ items: [edited], catalogueSelections: [morphine.id] });

      const toggled = toggleCatalogueItem(draft, morphine);

      expect(toggled.items).toHaveLength(2);
      expect(toggled.items[0]).toEqual(edited);
      expect(toggled.items[1]).toEqual(itemFor(morphine));
    });
  });
});
