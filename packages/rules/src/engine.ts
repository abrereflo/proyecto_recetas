import { atcLevel4 } from './atc';
import {
  RULESET_VERSION,
  type ClinicalAlert,
  type PatientContext,
  type PrescriptionDraft,
} from './types';

/**
 * The engine only reads, never blocks, never writes to the chain
 * (docs/06-validacion-clinica.md).
 *
 * `evaluate` returns alerts. Acting on them is the doctor's decision, recorded
 * separately in the alert log. A rule failure can never alter a prescription.
 */

/** Lowercase, trim, strip diacritics, collapse whitespace. */
function normalizeTerm(term: string): string {
  return term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * DECLARED_ALLERGY — critical.
 *
 * Matches an active ingredient against the allergies the doctor declared in the
 * form. Matching is exact after normalization: a substring match would fire on
 * unrelated ingredients that merely share a fragment, and alert fatigue is a
 * real clinical risk (docs/06).
 *
 * TODO (D-15): group-level allergy matching (e.g. the whole penicillin family)
 * needs a drug knowledge source. The MVP covers declared allergies and ATC
 * duplication only, and must not claim more.
 */
function declaredAllergyRule(
  draft: PrescriptionDraft,
  patientContext: PatientContext,
): ClinicalAlert[] {
  const alerts: ClinicalAlert[] = [];
  const allergies = new Map<string, string>();
  for (const allergy of patientContext.declaredAllergies) {
    const normalized = normalizeTerm(allergy);
    if (normalized.length > 0 && !allergies.has(normalized)) {
      allergies.set(normalized, allergy.trim());
    }
  }
  if (allergies.size === 0) {
    return alerts;
  }

  for (const item of draft.items) {
    const ingredient = normalizeTerm(item.activeIngredient);
    const declared = allergies.get(ingredient);
    if (declared !== undefined) {
      alerts.push({
        code: 'DECLARED_ALLERGY',
        severity: 'critical',
        evidence: [item.activeIngredient, declared],
        rulesetVersion: RULESET_VERSION,
      });
    }
  }

  return alerts;
}

/**
 * DUPLICATE_THERAPY — moderate.
 *
 * Two items sharing an ATC level-4 chemical subgroup (docs/06):
 *
 *   for each pair (itemA, itemB) in prescription.items:
 *     if atcLevel4(itemA.atcCode) == atcLevel4(itemB.atcCode): raise
 *
 * Each pair is reported once. Items whose ATC code is too short to resolve a
 * level 4 are skipped rather than guessed at.
 */
function duplicateTherapyRule(draft: PrescriptionDraft): ClinicalAlert[] {
  const alerts: ClinicalAlert[] = [];
  const items = draft.items;

  for (let i = 0; i < items.length; i += 1) {
    const itemA = items[i];
    if (itemA === undefined) continue;
    const groupA = atcLevel4(itemA.atcCode);
    if (groupA === null) continue;

    for (let j = i + 1; j < items.length; j += 1) {
      const itemB = items[j];
      if (itemB === undefined) continue;
      const groupB = atcLevel4(itemB.atcCode);
      if (groupB === null) continue;

      if (groupA === groupB) {
        alerts.push({
          code: 'DUPLICATE_THERAPY',
          severity: 'moderate',
          evidence: [itemA.atcCode, itemB.atcCode],
          rulesetVersion: RULESET_VERSION,
        });
      }
    }
  }

  return alerts;
}

const SEVERITY_ORDER: Record<ClinicalAlert['severity'], number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  info: 3,
};

/**
 * Evaluate a draft against the declared patient context.
 *
 * Deterministic: the same input always yields the same alerts, in the same
 * order (severity first, then rule order). It NEVER throws on clinical content
 * and it NEVER blocks issuance; the caller decides what to do with the result.
 */
export function evaluate(
  draft: PrescriptionDraft,
  patientContext: PatientContext,
): ClinicalAlert[] {
  const alerts = [...declaredAllergyRule(draft, patientContext), ...duplicateTherapyRule(draft)];

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
