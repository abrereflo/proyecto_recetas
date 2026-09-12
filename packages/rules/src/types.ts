import { z } from 'zod';
import { prescriptionItemSchema, type PrescriptionItem } from '@recetas/shared';

/**
 * Deterministic clinical rules engine, docs/06-validacion-clinica.md.
 *
 * This is NOT artificial intelligence. It is a table lookup: same input, same
 * output, always, with the evidence that produced each alert attached.
 */

/** Version of the ruleset. Every alert records the version that produced it. */
export const RULESET_VERSION = '2026.09.1';

/**
 * Severity ladder (docs/06). The UI decides how loudly to present each level;
 * the engine only classifies.
 *
 * - critical: declared allergy matching a prescribed active ingredient
 * - high: major drug-drug interaction (out of MVP scope, D-15)
 * - moderate: therapeutic duplication
 * - info: context observation
 */
export type AlertSeverity = 'critical' | 'high' | 'moderate' | 'info';

export const alertSeveritySchema = z.enum(['critical', 'high', 'moderate', 'info']);

/** Stable machine codes. The UI maps these to copy; never the other way round. */
export type AlertCode = 'DUPLICATE_THERAPY' | 'DECLARED_ALLERGY';

export const alertCodeSchema = z.enum(['DUPLICATE_THERAPY', 'DECLARED_ALLERGY']);

/** An alert always cites the evidence that produced it. */
export interface ClinicalAlert {
  code: AlertCode;
  severity: AlertSeverity;
  /** The exact input values that triggered the rule. */
  evidence: string[];
  rulesetVersion: string;
}

export const clinicalAlertSchema = z.object({
  code: alertCodeSchema,
  severity: alertSeveritySchema,
  evidence: z.array(z.string()),
  rulesetVersion: z.string(),
});

/** The prescription being drafted, before signing. */
export interface PrescriptionDraft {
  items: PrescriptionItem[];
}

export const prescriptionDraftSchema = z.object({
  items: z.array(prescriptionItemSchema),
});

/**
 * Everything the engine knows about the patient.
 *
 * It comes from the form the doctor fills in at the moment of prescribing, and
 * from nowhere else: there is no history to query, because the privacy rule of
 * docs/03 makes one impossible (D-25). The doctor UI must state this (screen D2).
 *
 * TODO (D-25): `age` and `weight` are not captured in the MVP; they are needed
 * for the out-of-range dose rule in Phase 2.
 */
export interface PatientContext {
  /** Allergies as written by the doctor, free text. */
  declaredAllergies: string[];
  /** Concomitant medication as reported by the patient to the doctor. */
  concomitantMedication: string[];
}

export const patientContextSchema = z.object({
  declaredAllergies: z.array(z.string()),
  concomitantMedication: z.array(z.string()),
});

export const EMPTY_PATIENT_CONTEXT: PatientContext = {
  declaredAllergies: [],
  concomitantMedication: [],
};
