import { EMPTY_PATIENT_CONTEXT, evaluate, type ClinicalAlert } from '@recetas/rules';
import type { PrescriptionItem } from '@recetas/shared';
import { pruneJustifications, type AlertJustification } from '../domain/alerts';
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

  return { ...edited, justifications };
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

export function removeItem(draft: PrescriptionDraft, index: number): PrescriptionDraft {
  return editDraft(draft, { items: draft.items.filter((_, position) => position !== index) });
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
