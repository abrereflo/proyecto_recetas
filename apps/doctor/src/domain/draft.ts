import { saltToHex } from '@recetas/crypto';
import type { PatientContext } from '@recetas/rules';
import {
  prescriptionDocumentSchema,
  type Bytes32,
  type PrescriptionDocument,
  type PrescriptionItem,
  type PrescriptionPatient,
  type PrescriptionPractitioner,
} from '@recetas/shared';
import type { AlertJustification } from './alerts';

/**
 * The prescription being written, before anything is encrypted, signed or
 * anchored (screens D2, D3 and D4).
 *
 * Pure: no I/O, no React, no viem, no ambient clock. Every instant this module
 * needs arrives as a parameter, which is what makes the expiry boundary
 * testable at all.
 */

/** Bolivia keeps a fixed UTC-4 offset all year; it observes no daylight saving. */
export const CLINIC_TIME_ZONE = 'America/La_Paz';
export const CLINIC_UTC_OFFSET = '-04:00';

/** Default validity window, in days. Same default as apps/cli. */
export const DEFAULT_VALIDITY_DAYS = 30;

/** Longest window the form accepts. A year-long prescription is a data error. */
export const MAX_VALIDITY_DAYS = 180;

/**
 * Everything the doctor fills in, plus the decisions taken about the alerts it
 * produced.
 *
 * HARD RULE (docs/06, docs/17 "Ninguna alerta clínica bloquea la emisión"):
 * `justifications` is DATA CARRIED WITH THE DRAFT, never a gate. A critical
 * alert requires a written justification on screen D4 — that requirement is a
 * property of the D4 modal (`justificationSatisfies` in domain/alerts.ts), and
 * the issuing use case stays callable whatever this array contains. Putting the
 * check inside the pipeline would move clinical responsibility from the doctor
 * to a rules module.
 */
export interface PrescriptionDraft {
  patient: PrescriptionPatient;
  practitioner: PrescriptionPractitioner;
  items: PrescriptionItem[];
  /**
   * What the doctor declared on screen D2. The engine sees this and nothing
   * else: there is no history to query (D-25, docs/06).
   */
  patientContext: PatientContext;
  /** Whole days of validity. Expiry lands at midnight (D-13). */
  validityDays: number;
  /** Written motives for dismissed alerts (screen D4). Never a gate. */
  justifications: AlertJustification[];
}

/** Stable machine codes for form problems. The UI maps these to its fields. */
export type DraftIssueCode =
  | 'patient-id-missing'
  | 'patient-name-missing'
  | 'patient-birth-date-missing'
  | 'practitioner-license-missing'
  | 'practitioner-name-missing'
  | 'items-empty'
  | 'item-incomplete'
  | 'item-quantity-invalid'
  | 'validity-days-invalid';

export interface DraftIssue {
  code: DraftIssueCode;
  /** Index of the offending item, when the problem belongs to one. */
  itemIndex?: number;
  /** Ready for the screen. Neutral professional register (docs/17). */
  message: string;
}

/** Spanish copy for every form problem, one distinct message per code. */
export const DRAFT_ISSUE_COPY_ES: Record<DraftIssueCode, string> = {
  'patient-id-missing': 'Indique el documento de identidad del paciente.',
  'patient-name-missing': 'Indique el nombre completo del paciente.',
  'patient-birth-date-missing': 'Indique la fecha de nacimiento del paciente.',
  'practitioner-license-missing': 'Indique la matrícula profesional del prescriptor.',
  'practitioner-name-missing': 'Indique el nombre completo del prescriptor.',
  'items-empty': 'La receta debe incluir al menos un medicamento.',
  'item-incomplete':
    'Complete principio activo, código ATC, concentración, forma farmacéutica y posología.',
  'item-quantity-invalid': 'La cantidad debe ser un número entero mayor que cero.',
  'validity-days-invalid': `La validez debe ser un número entero de días entre 1 y ${MAX_VALIDITY_DAYS}.`,
};

function issue(code: DraftIssueCode, itemIndex?: number): DraftIssue {
  const problem: DraftIssue = { code, message: DRAFT_ISSUE_COPY_ES[code] };
  if (itemIndex !== undefined) problem.itemIndex = itemIndex;
  return problem;
}

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * Form-level validation, in the doctor's language.
 *
 * This is NOT clinical validation: it never inspects an interaction, an allergy
 * or a duplication, and it never looks at `justifications`. Clinical content is
 * the rules engine's business and it never blocks (docs/06).
 */
export function validateDraft(draft: PrescriptionDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (blank(draft.patient.patientId)) issues.push(issue('patient-id-missing'));
  if (blank(draft.patient.fullName)) issues.push(issue('patient-name-missing'));
  if (blank(draft.patient.birthDate)) issues.push(issue('patient-birth-date-missing'));
  if (blank(draft.practitioner.licenseNumber)) issues.push(issue('practitioner-license-missing'));
  if (blank(draft.practitioner.fullName)) issues.push(issue('practitioner-name-missing'));

  if (draft.items.length === 0) issues.push(issue('items-empty'));

  draft.items.forEach((item, index) => {
    if (
      blank(item.activeIngredient) ||
      blank(item.atcCode) ||
      blank(item.strength) ||
      blank(item.doseForm) ||
      blank(item.dosageInstruction)
    ) {
      issues.push(issue('item-incomplete', index));
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      issues.push(issue('item-quantity-invalid', index));
    }
  });

  if (!isValidValidityWindow(draft.validityDays)) issues.push(issue('validity-days-invalid'));

  return issues;
}

function isValidValidityWindow(validityDays: number): boolean {
  return Number.isInteger(validityDays) && validityDays >= 1 && validityDays <= MAX_VALIDITY_DAYS;
}

/**
 * Expiry, derived on the client at midnight of the expiry day (D-13).
 *
 * `expiresAt` is the instant at which validity ENDS: 00:00 clinic time of the
 * day `validityDays` days after the day of `reference`. The contract refuses a
 * dispensation once `block.timestamp >= expiresAt`, so the last day on which
 * the receta can be dispensed is the day before that calendar day, and the
 * interface therefore shows a DATE WITHOUT A TIME (docs/17, D-13).
 *
 * The clinic timezone is pinned rather than read from the host: a workstation
 * configured in another timezone must not derive a different expiry day than
 * apps/cli or the pharmacy would. Bolivia observes no daylight saving, so the
 * fixed offset is exact.
 *
 * `reference` is a parameter, never `Date.now()`, so the day boundary is
 * testable — which is the only way this rule can be verified at all.
 */
export function expiresAtMidnight(reference: Date, validityDays: number): bigint {
  if (!isValidValidityWindow(validityDays)) {
    throw new RangeError(`validityDays must be an integer in [1, ${MAX_VALIDITY_DAYS}]`);
  }

  const target = new Date(reference.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const clinicDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);

  return BigInt(Math.floor(Date.parse(`${clinicDay}T00:00:00${CLINIC_UTC_OFFSET}`) / 1000));
}

/** ISO 8601 rendering of a Unix-seconds instant, as the document schema wants. */
export function secondsToIso(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

/** ISO 8601 to Unix seconds, as the EIP-712 message expects. */
export function isoToSeconds(iso: string): bigint {
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? 0n : BigInt(Math.floor(millis / 1000));
}

export interface BuildDocumentInput {
  draft: PrescriptionDraft;
  /** Fresh 32-byte commitment salt. One per prescription (docs/03). */
  salt: Uint8Array;
  /** The issuing instant. A parameter so the result is reproducible in tests. */
  issuedAt: Date;
}

export interface BuiltDocument {
  document: PrescriptionDocument;
  issuedAtSeconds: bigint;
  /** Same instant as `document.expiresAt`, as the uint64 the contract stores. */
  expiresAtSeconds: bigint;
}

/**
 * Assembles and validates the plaintext clinical document.
 *
 * This object is the one thing that must never leave the browser in the clear.
 * It carries the patient identifier and the salt, and both stay inside it: the
 * salt is written to the off-chain store beside the ciphertext, and neither
 * value ever reaches the chain or the QR (docs/03, docs/17).
 *
 * Throws the zod error when the assembled document does not satisfy
 * `prescriptionDocumentSchema`; `validateDraft` is what the form calls to avoid
 * reaching that point.
 */
export function buildPrescriptionDocument(input: BuildDocumentInput): BuiltDocument {
  const { draft, salt, issuedAt } = input;

  const issuedAtSeconds = BigInt(Math.floor(issuedAt.getTime() / 1000));
  const expiresAtSeconds = expiresAtMidnight(issuedAt, draft.validityDays);

  const document: PrescriptionDocument = {
    patient: {
      patientId: draft.patient.patientId.trim(),
      fullName: draft.patient.fullName.trim(),
      birthDate: draft.patient.birthDate.trim(),
    },
    salt: saltToHex(salt) as Bytes32,
    practitioner: {
      licenseNumber: draft.practitioner.licenseNumber.trim(),
      fullName: draft.practitioner.fullName.trim(),
    },
    items: draft.items,
    issuedAt: issuedAt.toISOString(),
    expiresAt: secondsToIso(expiresAtSeconds),
  };

  // D4's promise, kept: the motive is retained WITH the receta, inside the
  // envelope encrypted below. It reaches no signature, no `issue()` argument
  // and no QR — only `alertId`, an internal handle, is dropped.
  const motives = draft.justifications.map(({ alertId: _internal, ...motive }) => motive);
  if (motives.length > 0) document.justifications = motives;

  // Validate against the shared schema, but keep the branded literal types.
  prescriptionDocumentSchema.parse(document);

  return { document, issuedAtSeconds, expiresAtSeconds };
}
