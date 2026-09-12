import type { AlertCode, AlertSeverity } from './types';

/**
 * User-facing copy for each alert code.
 *
 * Interface copy is written in Spanish because the users are Bolivian doctors
 * and pharmacists; code, identifiers and comments stay in English.
 *
 * The engine emits codes, never sentences. This catalogue is the only place
 * where a code becomes text, so the wording can change without touching a rule.
 */

export interface AlertCopy {
  title: string;
  body: string;
}

export const ALERT_COPY_ES: Record<AlertCode, AlertCopy> = {
  DECLARED_ALLERGY: {
    title: 'Alergia declarada',
    body: 'El principio activo prescrito coincide con una alergia declarada en este formulario.',
  },
  DUPLICATE_THERAPY: {
    title: 'Duplicidad terapéutica',
    body: 'Dos ítems de la receta pertenecen al mismo subgrupo químico ATC.',
  },
};

export const SEVERITY_LABEL_ES: Record<AlertSeverity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  moderate: 'Moderada',
  info: 'Informativa',
};

/**
 * Mandatory notice for the patient-context screen (D2).
 *
 * The engine evaluates only what the doctor writes here: there is no history to
 * cross-check against (D-25). Saying otherwise would have the doctor trust a
 * coverage that does not exist.
 */
export const CONTEXT_DISCLAIMER_ES =
  'El motor de reglas solo evalúa lo que usted escriba en este formulario. No consulta ningún historial del paciente.';

/**
 * The engine never blocks issuance (docs/06). This is the wording the UI uses
 * when the doctor dismisses an alert.
 */
export const NEVER_BLOCKS_ES =
  'Ninguna alerta bloquea la emisión. Usted decide, y su decisión queda registrada con el motivo.';
