/**
 * A fixed demo catalogue of medications subject to controlled-substance
 * prescribing in Bolivia.
 *
 * This is NOT a regulatory source: the list, strengths and dose forms are a
 * plausible, hard-coded sample for the MVP, so screen D3 can offer a checkbox
 * per medication instead of a blank line. What a checkbox writes is exactly the
 * identity and presentation of the medication — active ingredient, ATC code,
 * strength and dose form. Quantity and dosage instruction remain the doctor's
 * and are typed on the item card, as for any free-text line.
 *
 * D-07 still holds: no commercial product is named here; the entries are
 * active ingredients with their WHO ATC codes.
 *
 * Pure data and one derivation of it. Editing helpers live in
 * presentation/draft-editing.ts.
 */

/**
 * The therapeutic families D3 groups the list by.
 *
 * The grouping is clinical, not decorative: a prescriber reads "benzodiazepina"
 * as a class with shared risks, and two entries of the same family on one
 * prescription is the duplication the rules engine looks for. Ten flat rows
 * carry none of that.
 */
export type ControlledMedicationFamily =
  | 'Opioides'
  | 'Benzodiazepinas'
  | 'Hipnóticos no benzodiazepínicos'
  | 'Estimulantes';

/**
 * Display order of the families on D3.
 *
 * The order lives here rather than in the screen's markup so that adding a
 * family is a data edit, and so that a family nobody assigned an entry to shows
 * up as an empty group in the tests instead of silently vanishing from the UI.
 */
export const CONTROLLED_MEDICATION_FAMILIES: readonly ControlledMedicationFamily[] = [
  'Opioides',
  'Benzodiazepinas',
  'Hipnóticos no benzodiazepínicos',
  'Estimulantes',
];

export interface ControlledMedication {
  /** Stable, kebab-case identifier of the active ingredient; used for control ids. */
  id: string;
  /** Spanish INN, as the rest of the app spells ingredients. */
  activeIngredient: string;
  /** WHO ATC classification, fifth level. */
  atcCode: string;
  strength: string;
  doseForm: string;
  /** Therapeutic family, which is how D3 groups the list. */
  family: ControlledMedicationFamily;
}

export const CONTROLLED_MEDICATIONS: readonly ControlledMedication[] = [
  {
    id: 'morfina',
    activeIngredient: 'morfina',
    atcCode: 'N02AA01',
    strength: '10 mg',
    doseForm: 'comprimido',
    family: 'Opioides',
  },
  {
    id: 'tramadol',
    activeIngredient: 'tramadol',
    atcCode: 'N02AX02',
    strength: '50 mg',
    doseForm: 'cápsula',
    family: 'Opioides',
  },
  {
    id: 'fentanilo',
    activeIngredient: 'fentanilo',
    atcCode: 'N02AB03',
    strength: '50 µg/h',
    doseForm: 'parche transdérmico',
    family: 'Opioides',
  },
  {
    id: 'codeina',
    activeIngredient: 'codeína',
    atcCode: 'R05DA04',
    strength: '30 mg',
    doseForm: 'comprimido',
    family: 'Opioides',
  },
  {
    id: 'diazepam',
    activeIngredient: 'diazepam',
    atcCode: 'N05BA01',
    strength: '10 mg',
    doseForm: 'comprimido',
    family: 'Benzodiazepinas',
  },
  {
    id: 'alprazolam',
    activeIngredient: 'alprazolam',
    atcCode: 'N05BA12',
    strength: '0,5 mg',
    doseForm: 'comprimido',
    family: 'Benzodiazepinas',
  },
  {
    id: 'clonazepam',
    activeIngredient: 'clonazepam',
    atcCode: 'N03AE01',
    strength: '2 mg',
    doseForm: 'comprimido',
    family: 'Benzodiazepinas',
  },
  {
    id: 'midazolam',
    activeIngredient: 'midazolam',
    atcCode: 'N05CD08',
    strength: '15 mg',
    doseForm: 'comprimido',
    family: 'Benzodiazepinas',
  },
  {
    id: 'zolpidem',
    activeIngredient: 'zolpidem',
    atcCode: 'N05CF02',
    strength: '10 mg',
    doseForm: 'comprimido',
    family: 'Hipnóticos no benzodiazepínicos',
  },
  {
    id: 'metilfenidato',
    activeIngredient: 'metilfenidato',
    atcCode: 'N06BA04',
    strength: '10 mg',
    doseForm: 'comprimido',
    family: 'Estimulantes',
  },
];

/** One therapeutic family with the entries that belong to it, ready to render. */
export interface ControlledMedicationGroup {
  family: ControlledMedicationFamily;
  medications: readonly ControlledMedication[];
}

/**
 * The catalogue in display order, grouped by therapeutic family.
 *
 * Derived rather than stored so the flat list stays the single source of truth:
 * an entry cannot be in the grouped view and missing from the flat one, and the
 * group order is `CONTROLLED_MEDICATION_FAMILIES` rather than whatever order the
 * markup happens to spell out.
 */
export function groupedControlledMedications(): readonly ControlledMedicationGroup[] {
  return CONTROLLED_MEDICATION_FAMILIES.map((family) => ({
    family,
    medications: CONTROLLED_MEDICATIONS.filter((medication) => medication.family === family),
  }));
}
