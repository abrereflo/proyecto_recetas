import {
  ALERT_COPY_ES,
  SEVERITY_LABEL_ES,
  type AlertCode,
  type AlertSeverity,
  type ClinicalAlert,
} from '@recetas/rules';

/**
 * Presentation model and dismissal rules for the clinical alerts of screens D3
 * and D4 (docs/17), and the answer to Fase 6 task 12, "supresión de repetición
 * de alertas ya desestimadas" (docs/18).
 *
 * WHY THIS MODULE EXISTS. `evaluate()` is stateless: it re-derives the FULL set
 * of alerts from the draft on every keystroke and has no memory of what the
 * doctor already decided. Rendering that set directly re-raises an alert the
 * doctor dismissed thirty seconds ago, every time another item is typed, and
 * alert fatigue is a documented clinical risk (docs/06). Suppression therefore
 * belongs here, outside the engine, where it cannot make a rule conditional.
 *
 * HARD RULE (docs/06, docs/17 "Ninguna alerta clínica bloquea la emisión"):
 * nothing in this module can stop an issuance. It classifies and it remembers
 * decisions; the issuing use case never imports it.
 *
 * Pure: no I/O, no clock. Every instant arrives as a parameter.
 */

/**
 * Stable identity of one alert, derived from WHAT IT SAYS and not from where it
 * happened to land in the array.
 *
 * The array index is unusable as an identity: items reorder, get inserted and
 * get deleted while the doctor writes, so index 1 is a different alert one
 * keystroke later and the dismissal would silently transfer to it.
 *
 * The evidence is part of the identity ON PURPOSE. A dismissal is a decision
 * about a concrete clinical fact — "amoxicilina against a declared amoxicilina
 * allergy" — and not about a rule in the abstract. If the doctor edits the item
 * that triggered it, the evidence changes, the identity changes, and the alert
 * comes back unsuppressed. That is the whole point of the mechanism: a stale
 * dismissal must never cover a fact nobody has looked at.
 *
 * `rulesetVersion` is in the identity for the same reason: a new ruleset is a
 * new judgement and deserves a fresh decision.
 */
export type AlertIdentity = string;

/** Normalised so incidental spacing or casing does not fork the identity. */
function normalizeEvidence(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function alertIdentity(alert: ClinicalAlert): AlertIdentity {
  const evidence = alert.evidence.map(normalizeEvidence).join('');
  return `${alert.rulesetVersion}${alert.code}${evidence}`;
}

/**
 * The doctor's written decision about one alert (screen D4).
 *
 * This is the value carried with the draft (`PrescriptionDraft.justifications`)
 * and nothing consults it while issuing. It exists so the decision is recorded
 * with its motive, which is what docs/06 asks for: "usted decide, y su decisión
 * queda registrada con el motivo".
 */
export interface AlertJustification {
  alertId: AlertIdentity;
  code: AlertCode;
  severity: AlertSeverity;
  /** Free text written by the doctor. Empty for alerts that require none. */
  text: string;
  /** ISO 8601 timestamp of the decision. */
  recordedAt: string;
}

/**
 * Shortest text accepted as a written motive on screen D4.
 *
 * A single character is not a motive. The D4 button "nace deshabilitado"
 * (docs/17) and stays disabled until `justificationSatisfies` passes.
 */
export const MIN_JUSTIFICATION_LENGTH = 10;

/** Only a critical alert demands a written motive before it can be dismissed (D4). */
export function requiresJustification(alert: ClinicalAlert): boolean {
  return alert.severity === 'critical';
}

/** The predicate behind the disabled state of the D4 confirmation button. */
export function justificationSatisfies(alert: ClinicalAlert, text: string): boolean {
  if (!requiresJustification(alert)) return true;
  return text.trim().length >= MIN_JUSTIFICATION_LENGTH;
}

/**
 * Raised when a critical alert is dismissed without a written motive.
 *
 * This guards the D4 modal, which is a screen rule. It is NOT a gate on
 * issuance: nothing on the issuing path calls `dismissAlert`, and a draft whose
 * critical alert was never dismissed is still perfectly issuable (docs/06).
 */
export class JustificationRequiredError extends Error {
  constructor(readonly alertId: AlertIdentity) {
    super('Escriba el motivo clínico antes de continuar con esta alerta.');
    this.name = 'JustificationRequiredError';
  }
}

export interface DismissAlertInput {
  alert: ClinicalAlert;
  /** The written motive. Mandatory for a critical alert (D4). */
  text: string;
  /** ISO 8601 timestamp of the decision. A parameter, never an ambient clock. */
  recordedAt: string;
}

/**
 * Records a dismissal, returning a NEW list. Re-dismissing the same alert
 * replaces the previous decision rather than stacking a second one.
 */
export function dismissAlert(
  justifications: readonly AlertJustification[],
  input: DismissAlertInput,
): AlertJustification[] {
  const { alert, text, recordedAt } = input;
  const alertId = alertIdentity(alert);

  if (!justificationSatisfies(alert, text)) {
    throw new JustificationRequiredError(alertId);
  }

  const decision: AlertJustification = {
    alertId,
    code: alert.code,
    severity: alert.severity,
    text: text.trim(),
    recordedAt,
  };

  return [...justifications.filter((entry) => entry.alertId !== alertId), decision];
}

/** Everything screen D3 needs to render one alert, copy included. */
export interface PresentedAlert {
  id: AlertIdentity;
  code: AlertCode;
  severity: AlertSeverity;
  /** "Crítica", "Moderada"… — colour is never the only carrier (docs/17). */
  severityLabel: string;
  title: string;
  body: string;
  /** The exact input values that produced the alert. Always shown (docs/17 D3). */
  evidence: string[];
  rulesetVersion: string;
  requiresJustification: boolean;
  /** Present only for an alert the doctor already decided on. */
  justification?: AlertJustification;
}

export function presentAlert(
  alert: ClinicalAlert,
  justification?: AlertJustification,
): PresentedAlert {
  const copy = ALERT_COPY_ES[alert.code];

  const presented: PresentedAlert = {
    id: alertIdentity(alert),
    code: alert.code,
    severity: alert.severity,
    severityLabel: SEVERITY_LABEL_ES[alert.severity],
    title: copy.title,
    body: copy.body,
    evidence: [...alert.evidence],
    rulesetVersion: alert.rulesetVersion,
    requiresJustification: requiresJustification(alert),
  };

  if (justification !== undefined) presented.justification = justification;

  return presented;
}

/**
 * The current alert set, split into what still needs the doctor's attention and
 * what was already decided.
 *
 * `previouslyDismissed` is deliberately RETURNED rather than dropped: screen D3
 * keeps the decided alerts visible in a quiet register with their motive, so
 * the record of what was weighed does not disappear from the screen it was made
 * on. Suppression means "stop shouting", not "hide the evidence".
 *
 * Engine order is preserved inside each group (critical first, docs/06).
 */
export interface AlertPartition {
  active: PresentedAlert[];
  previouslyDismissed: PresentedAlert[];
}

export function partitionAlerts(
  alerts: readonly ClinicalAlert[],
  justifications: readonly AlertJustification[],
): AlertPartition {
  const decided = new Map(justifications.map((entry) => [entry.alertId, entry]));
  const partition: AlertPartition = { active: [], previouslyDismissed: [] };

  for (const alert of alerts) {
    // Identity carries the evidence, so an edited item yields a new identity,
    // finds no decision here and lands in `active` again. That is the rule, not
    // an accident of the lookup.
    const justification = decided.get(alertIdentity(alert));

    if (justification === undefined) {
      partition.active.push(presentAlert(alert));
    } else {
      partition.previouslyDismissed.push(presentAlert(alert, justification));
    }
  }

  return partition;
}

/**
 * Drops decisions whose alert is no longer raised.
 *
 * Without this the draft accumulates motives for facts that stopped existing,
 * and a fact that comes BACK — the doctor removes an item and types it again —
 * would silently resurrect a dismissal the alert never earned a second time.
 */
export function pruneJustifications(
  justifications: readonly AlertJustification[],
  alerts: readonly ClinicalAlert[],
): AlertJustification[] {
  const live = new Set(alerts.map(alertIdentity));
  return justifications.filter((entry) => live.has(entry.alertId));
}

/** Spanish copy for the dismissal surface of screens D3 and D4. */
export const ALERT_DISMISSAL_COPY_ES = {
  /** Heading of the quiet group. */
  dismissedGroupTitle: 'Alertas ya valoradas',
  dismissedGroupBody:
    'Estas alertas siguen vigentes y no se repiten porque usted ya dejó constancia de su ' +
    'decisión. Si modifica el ítem que las originó, volverán a mostrarse.',
  /** Label of the D4 text field. */
  justificationLabel: 'Motivo clínico de la decisión',
  justificationHint: `Escriba al menos ${MIN_JUSTIFICATION_LENGTH} caracteres para poder continuar.`,
  justificationMissing: 'Escriba el motivo clínico antes de continuar con esta alerta.',
} as const;
