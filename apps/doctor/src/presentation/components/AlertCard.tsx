import type { AlertSeverity } from '@recetas/rules';
import type { PresentedAlert } from '../../domain/alerts';

/**
 * One clinical alert, on screens D3 and D4.
 *
 * HARD RULE (docs/17, D3): "Toda alerta cita su evidencia y la versión del
 * conjunto de reglas." Without both, the doctor cannot judge whether an alert
 * deserves attention, and within two weeks dismisses every one of them by
 * reflex. Alert fatigue is not fought by showing fewer alerts; it is fought by
 * making each one auditable. Evidence and ruleset version are therefore part of
 * this component and not an option a caller can leave out.
 *
 * HARD RULE (docs/17): colour is never the only carrier of meaning. Every
 * severity brings its own mark AND its own word.
 */

const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  critical: 'alert--danger',
  high: 'alert--danger',
  moderate: 'alert--warning',
  info: 'alert--info',
};

const SEVERITY_MARK: Record<AlertSeverity, string> = {
  critical: '⛔',
  high: '⚠',
  moderate: '⚠',
  info: 'ℹ',
};

export interface AlertCardProps {
  alert: PresentedAlert;
  /**
   * Rendered as the alert's own control. Only a critical alert gets one, and
   * it opens D4 — it never dismisses anything by itself.
   */
  action?: { label: string; onClick(): void };
  /** False for the quiet group of already-decided alerts on D3. */
  live?: boolean;
}

export function AlertCard({ alert, action, live = true }: AlertCardProps) {
  return (
    <div
      className={`alert ${SEVERITY_CLASS[alert.severity]}`}
      // Only a live alert interrupts a screen reader. The decided ones are a
      // record of what was weighed, not news.
      {...(live ? { role: 'alert' as const } : {})}
    >
      <span aria-hidden="true" className="alert__icon">
        {SEVERITY_MARK[alert.severity]}
      </span>
      <div className="stack stack--tight">
        <p className="alert__title">
          {alert.title} — severidad {alert.severityLabel.toLowerCase()}
        </p>
        <p className="alert__body">{alert.body}</p>

        <p className="alert__body">
          Evidencia: <span className="mono">{alert.evidence.join(' · ')}</span>
        </p>

        <p className="text-muted">
          Regla <span className="mono">{alert.code}</span> · conjunto de reglas{' '}
          <span className="mono">{alert.rulesetVersion}</span>
        </p>

        {alert.justification !== undefined && (
          <p className="alert__body">
            Motivo registrado: <q>{alert.justification.text}</q>
          </p>
        )}

        {action !== undefined && (
          <p className="alert__body">
            <button className="btn btn--secondary" onClick={action.onClick} type="button">
              {action.label}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
