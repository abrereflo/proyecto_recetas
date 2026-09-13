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
 * Pure data, no behaviour. Editing helpers live in presentation/draft-editing.ts.
 */

export interface ControlledMedication {
  /** Stable, kebab-case identifier of the active ingredient; used for control ids. */
  id: string;
  /** Spanish INN, as the rest of the app spells ingredients. */
  activeIngredient: string;
  /** WHO ATC classification, fifth level. */
  atcCode: string;
  strength: string;
  doseForm: string;
}

export const CONTROLLED_MEDICATIONS: readonly ControlledMedication[] = [
  {
    id: 'morfina',
    activeIngredient: 'morfina',
    atcCode: 'N02AA01',
    strength: '10 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'tramadol',
    activeIngredient: 'tramadol',
    atcCode: 'N02AX02',
    strength: '50 mg',
    doseForm: 'cápsula',
  },
  {
    id: 'fentanilo',
    activeIngredient: 'fentanilo',
    atcCode: 'N02AB03',
    strength: '50 µg/h',
    doseForm: 'parche transdérmico',
  },
  {
    id: 'codeina',
    activeIngredient: 'codeína',
    atcCode: 'R05DA04',
    strength: '30 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'diazepam',
    activeIngredient: 'diazepam',
    atcCode: 'N05BA01',
    strength: '10 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'alprazolam',
    activeIngredient: 'alprazolam',
    atcCode: 'N05BA12',
    strength: '0,5 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'clonazepam',
    activeIngredient: 'clonazepam',
    atcCode: 'N03AE01',
    strength: '2 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'midazolam',
    activeIngredient: 'midazolam',
    atcCode: 'N05CD08',
    strength: '15 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'zolpidem',
    activeIngredient: 'zolpidem',
    atcCode: 'N05CF02',
    strength: '10 mg',
    doseForm: 'comprimido',
  },
  {
    id: 'metilfenidato',
    activeIngredient: 'metilfenidato',
    atcCode: 'N06BA04',
    strength: '10 mg',
    doseForm: 'comprimido',
  },
];
