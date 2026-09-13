import { EMPTY_PATIENT_CONTEXT, evaluate, type ClinicalAlert } from '@recetas/rules';
import type { PrescriptionItem } from '@recetas/shared';
import { pruneJustifications, type AlertJustification } from '../domain/alerts';
import {
  CONTROLLED_MEDICATIONS,
  type ControlledMedication,
} from '../domain/controlled-medications';
import { DEFAULT_VALIDITY_DAYS, type PrescriptionDraft } from '../domain/draft';

/**
 * Draft editing for screens D2 and D3.
 *
 * WHY THIS EXISTS RATHER THAN A `setDraft` IN THE SCREEN. `evaluate()` is
 * stateless and re-derives the whole alert set on every keystroke, and an alert
 * identity carries its evidence (domain/alerts.ts). So the moment the doctor
 * edits the item that raised an alert, the old identity stops existing and the
 * decision recorded against it is about a fact nobody is looking at any more.
 * `pruneJustifications` drops exactly those, and it has to run on EVERY edit —
 * not on the ones somebody remembered. Routing all draft mutation through
 * `editDraft` is what makes that structural instead of a convention.
 *
 * `catalogueSelections` is reconciled on the same terms and for the same
 * reason: a D3 checkbox records the line it wrote, and the moment that line is
 * withdrawn or edited away the record is about something nobody is looking at
 * any more. `pruneCatalogueSelections` runs beside the other one.
 *
 * Pure: no React, no clock. The screens hold the value and hand it back.
 */

/** A blank draft. One per prescription; D6 is terminal, so it is never reused. */
export function emptyDraft(): PrescriptionDraft {
  return {
    patient: { patientId: '', fullName: '', birthDate: '' },
    practitioner: { licenseNumber: '', fullName: '' },
    items: [emptyItem()],
    patientContext: { ...EMPTY_PATIENT_CONTEXT },
    validityDays: DEFAULT_VALIDITY_DAYS,
    justifications: [],
    catalogueSelections: [],
  };
}

/** A blank medication line. Prescribed by active ingredient and ATC only (D-07). */
export function emptyItem(): PrescriptionItem {
  return {
    atcCode: '',
    activeIngredient: '',
    strength: '',
    doseForm: '',
    quantity: 0,
    dosageInstruction: '',
  };
}

/**
 * Exactly the line checking a catalogue box writes: the medication's identity
 * and presentation, with everything else as `emptyItem()` left it.
 *
 * One definition serves both directions — it is what `toggleCatalogueItem` adds
 * and what `isUntouchedCatalogueItem` compares a line against — so "what the
 * catalogue wrote" cannot mean one thing when adding and another when removing.
 */
export function catalogueItem(medication: ControlledMedication): PrescriptionItem {
  return {
    ...emptyItem(),
    atcCode: medication.atcCode,
    activeIngredient: medication.activeIngredient,
    strength: medication.strength,
    doseForm: medication.doseForm,
  };
}

/** The alerts the engine raises for a draft as it currently stands. */
export function alertsFor(draft: PrescriptionDraft): ClinicalAlert[] {
  return evaluate({ items: draft.items }, draft.patientContext);
}

/**
 * Applies a patch and re-reconciles the recorded decisions with the alerts the
 * edited draft actually raises.
 *
 * Every mutation on D2 and D3 goes through here, including the ones that cannot
 * possibly change the alert set: a second path that skipped the pruning is the
 * exact bug this module exists to prevent.
 */
export function editDraft(
  draft: PrescriptionDraft,
  patch: Partial<PrescriptionDraft>,
): PrescriptionDraft {
  const edited: PrescriptionDraft = { ...draft, ...patch };
  const justifications = pruneJustifications(edited.justifications, alertsFor(edited));
  const catalogueSelections = pruneCatalogueSelections(edited.catalogueSelections, edited.items);

  return { ...edited, justifications, catalogueSelections };
}

/**
 * Drops the record of a checked box whose line is no longer in the draft.
 *
 * The mirror of `pruneJustifications` (domain/alerts.ts), and there for the
 * same reason: "Quitar ítem" takes the line away, and an edit to its active
 * ingredient or ATC code turns it into a different medication. Either way the
 * box would otherwise stay checked over a line nobody can point at.
 */
function pruneCatalogueSelections(
  selections: readonly string[],
  items: readonly PrescriptionItem[],
): string[] {
  return selections.filter((id) => {
    const medication = CONTROLLED_MEDICATIONS.find((entry) => entry.id === id);
    return medication !== undefined && items.some((item) => isFromCatalogue(item, medication));
  });
}

/** Replaces one medication line. */
export function replaceItem(
  draft: PrescriptionDraft,
  index: number,
  patch: Partial<PrescriptionItem>,
): PrescriptionDraft {
  const items = draft.items.map((item, position) =>
    position === index ? { ...item, ...patch } : item,
  );

  return editDraft(draft, { items });
}

export function addItem(draft: PrescriptionDraft): PrescriptionDraft {
  return editDraft(draft, { items: [...draft.items, emptyItem()] });
}

/**
 * Removes one medication line, and keeps the list invariant: D3 is never left
 * without a line to type into, so removing the last one clears it to a blank
 * line instead of emptying the list.
 *
 * WHY HERE AND NOT BY DISABLING THE CONTROL. The screen used to hold this
 * invariant by disabling "Quitar ítem" on the last item, which closed the one
 * exit the checkbox hint points at: with a single line carrying typed work, the
 * checkbox refuses to remove it and the disabled button could not either. The
 * invariant belongs in this pure function, where it holds for every caller and
 * leaves the removal path always available — `toggleCatalogueItem` already
 * follows the same rule.
 */
export function removeItem(draft: PrescriptionDraft, index: number): PrescriptionDraft {
  const remaining = draft.items.filter((_, position) => position !== index);
  return editDraft(draft, { items: remaining.length === 0 ? [emptyItem()] : remaining });
}

/**
 * Whether THIS BOX put a line in the draft that is still there.
 *
 * Both halves are load-bearing. The recorded id is what separates the line the
 * checkbox wrote from a coinciding one the doctor typed: the box means "added
 * from the catalogue", so a hand-typed diazepam 10 mg comprimido N05BA01 leaves
 * it unchecked, and clicking it can never delete work the box did not create.
 * The surviving line is what keeps a stale record from showing as checked —
 * `editDraft` prunes those, and checking it here too means a draft assembled
 * anywhere else answers the same way.
 *
 * The line is matched on ATC code AND active ingredient: the pair is what the
 * catalogue writes, and either alone is ambiguous — a doctor may type the same
 * ingredient at another strength, or an ATC code with a spelling of their own.
 */
export function isCatalogueItemSelected(
  draft: PrescriptionDraft,
  medication: ControlledMedication,
): boolean {
  return (
    draft.catalogueSelections.includes(medication.id) &&
    draft.items.some((item) => isFromCatalogue(item, medication))
  );
}

/**
 * Whether any line matching this catalogue medication carries prescribing work
 * the doctor typed — on ANY field, not only quantity and dosage: the strength
 * and the dose form are plain editable inputs on the item card, and a corrected
 * strength is prescribing work as surely as a quantity is.
 *
 * WHY "UNTOUCHED" IS STILL INFERRED FROM THE FIELDS. Which box wrote a line is
 * recorded on the draft (`catalogueSelections`), but what has been typed on it
 * since cannot be: `PrescriptionItem` (packages/shared) is sealed into the
 * signed, encrypted document, so a per-field marker would become part of what
 * the doctor signs and the pharmacist verifies, for the sole benefit of a
 * checkbox. So "nobody has touched it since" is read back off the item itself,
 * by comparing it with the line `catalogueItem` writes.
 *
 * D3 uses this to explain, beside the checkbox, why unchecking will not clear
 * it — see `toggleCatalogueItem` for why it does not.
 */
export function hasDoctorEnteredWork(
  draft: PrescriptionDraft,
  medication: ControlledMedication,
): boolean {
  return draft.items.some(
    (item) => isFromCatalogue(item, medication) && !isUntouchedCatalogueItem(item, medication),
  );
}

/**
 * The checkbox on D3. Unchecked → records the pick and adds a line prefilled
 * with the medication's identity and presentation, leaving quantity and dosage
 * to the doctor. Checked → drops the record and removes the lines it wrote, so
 * the box cannot stay checked.
 *
 * WHY UNCHECKING CAN REFUSE TO REMOVE. Which line the box wrote is recorded,
 * but a line the doctor typed by hand can still match the same medication, and
 * the removal takes every matching line. Deleting one on a click would silently
 * lose the quantity and posology already written on a controlled-substance
 * prescription — no confirmation, no undo. Between a checkbox that is always
 * honest and prescribing data that is never lost, the data wins: if ANY
 * matching line carries typed work, nothing is removed, the box stays checked,
 * and D3 says why. Deliberate removal has its own path, and it is per item and
 * visible: the "Quitar ítem" button on the card.
 *
 * The refusal still routes through `editDraft`, with an empty patch, so the
 * justification-pruning invariant holds on every branch rather than on the ones
 * that happen to change something.
 *
 * Two edges keep the item list honest: a blank opening line is replaced rather
 * than left above the new one, and removing the last line leaves a blank one
 * rather than an empty list — the same invariant `removeItem` holds, so the
 * "Quitar ítem" path this refusal points the doctor at is never closed.
 */
export function toggleCatalogueItem(
  draft: PrescriptionDraft,
  medication: ControlledMedication,
): PrescriptionDraft {
  const withoutThisMedication = draft.catalogueSelections.filter((id) => id !== medication.id);

  if (isCatalogueItemSelected(draft, medication)) {
    if (hasDoctorEnteredWork(draft, medication)) return editDraft(draft, {});

    const remaining = draft.items.filter((item) => !isFromCatalogue(item, medication));
    return editDraft(draft, {
      items: remaining.length === 0 ? [emptyItem()] : remaining,
      catalogueSelections: withoutThisMedication,
    });
  }

  const added = catalogueItem(medication);
  const [only] = draft.items;
  const replacesBlankLine = draft.items.length === 1 && only !== undefined && isBlankItem(only);

  // Filtered before appending, so a box checked again after its previous line
  // was withdrawn is recorded once rather than twice.
  return editDraft(draft, {
    items: replacesBlankLine ? [added] : [...draft.items, added],
    catalogueSelections: [...withoutThisMedication, medication.id],
  });
}

function isFromCatalogue(item: PrescriptionItem, medication: ControlledMedication): boolean {
  return (
    item.atcCode === medication.atcCode && item.activeIngredient === medication.activeIngredient
  );
}

/** Still exactly what checking the box produced: no field edited since. */
function isUntouchedCatalogueItem(
  item: PrescriptionItem,
  medication: ControlledMedication,
): boolean {
  return matchesTemplate(item, catalogueItem(medication));
}

/** Exactly what `emptyItem()` returns: nothing typed on any field. */
function isBlankItem(item: PrescriptionItem): boolean {
  return matchesTemplate(item, emptyItem());
}

/**
 * Whether a line is still, field by field, the `template` a control wrote.
 *
 * The single spelling of "nobody has touched this": both predicates above read
 * it from here, so "untouched" cannot drift into meaning one set of fields in
 * one place and another set elsewhere. Every key of `PrescriptionItem` is
 * compared rather than a hand-written list, which is what keeps a field added
 * to the type later inside the comparison instead of silently outside it.
 *
 * Whitespace is not prescribing work, so the dosage is trimmed before judging.
 */
function matchesTemplate(item: PrescriptionItem, template: PrescriptionItem): boolean {
  return (Object.keys(template) as (keyof PrescriptionItem)[]).every((key) =>
    key === 'dosageInstruction'
      ? item.dosageInstruction.trim() === template.dosageInstruction.trim()
      : item[key] === template[key],
  );
}

/**
 * The item a critical alert is about, so D4 can offer to withdraw it.
 *
 * `DECLARED_ALLERGY` — the only critical code the MVP raises — puts the
 * offending `activeIngredient` first in its evidence, verbatim (the engine in
 * packages/rules/src/engine.ts). Reading it back from there rather than
 * re-running the match keeps one implementation of "which item was this about".
 *
 * Returns `undefined` when no item matches: D4 then offers no withdrawal rather
 * than removing the wrong line.
 */
export function findOffendingItem(
  draft: PrescriptionDraft,
  alert: ClinicalAlert,
): number | undefined {
  const [ingredient] = alert.evidence;
  if (ingredient === undefined) return undefined;

  const index = draft.items.findIndex((item) => item.activeIngredient === ingredient);
  return index === -1 ? undefined : index;
}

/** Records the doctor's written decision about one alert (screen D4). */
export function withJustification(
  draft: PrescriptionDraft,
  justifications: AlertJustification[],
): PrescriptionDraft {
  return editDraft(draft, { justifications });
}
