import { useState } from 'react';
import type { ClinicalAlert } from '@recetas/rules';
import {
  ALERT_DISMISSAL_COPY_ES,
  dismissAlert,
  justificationSatisfies,
  presentAlert,
  type AlertJustification,
} from '../../domain/alerts';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';

/**
 * D4 — Alerta crítica.
 *
 * HARD RULE (docs/17, D4): "Modal con motivo escrito obligatorio; el botón nace
 * deshabilitado." The confirmation button is disabled on its first render and
 * stays disabled until `justificationSatisfies` passes — the SAME predicate the
 * core uses to refuse a dismissal, so the button and the rule can never drift
 * apart. Whitespace is not a motive: the predicate trims.
 *
 * HARD RULE (docs/06, docs/17): this dialog does not gate the issuance. It
 * gates the DISMISSAL of the alert. Whatever the doctor does here — justify,
 * withdraw the item, or close the dialog without deciding — the flow lands back
 * on D3, where the way forward is unconditional. Nothing on this screen can
 * stop a prescription from being issued, and the reducer has no transition that
 * would let it.
 *
 * The dialog never auto-dismisses and never closes itself on a timer: a
 * decision that happens because the doctor stopped typing is not a decision.
 */

export interface CriticalAlertDialogProps {
  alert: ClinicalAlert;
  /** The decisions already recorded on this draft. */
  justifications: readonly AlertJustification[];
  /** Receives the NEW list once the motive is written. */
  onJustify(justifications: AlertJustification[]): void;
  /** Present only when the alert points at an item that can be withdrawn. */
  onRemoveOffendingItem?: (() => void) | undefined;
  /** Escape, and the way back to editing the item that raised the alert. */
  onClose(): void;
  /** Injected so the recorded instant is deterministic in tests. */
  now?: () => Date;
}

export function CriticalAlertDialog({
  alert,
  justifications,
  onJustify,
  onRemoveOffendingItem,
  onClose,
  now = () => new Date(),
}: CriticalAlertDialogProps) {
  const [text, setText] = useState('');
  const presented = presentAlert(alert);

  // The predicate is the core's, not a length check written here. `disabled` is
  // therefore false only when `dismissAlert` would actually accept the text.
  const satisfied = justificationSatisfies(alert, text);

  const confirm = (): void => {
    if (!satisfied) return;
    onJustify(dismissAlert(justifications, { alert, text, recordedAt: now().toISOString() }));
  };

  return (
    <Modal onClose={onClose} title={presented.title}>
      <div className="row">
        <span className="badge badge--danger">
          <span aria-hidden="true">⛔</span> Severidad {presented.severityLabel.toLowerCase()}
        </span>
        <span className="text-muted">
          Regla <span className="mono">{presented.code}</span> · conjunto de reglas{' '}
          <span className="mono">{presented.rulesetVersion}</span>
        </span>
      </div>

      <p className="text-secondary">{presented.body}</p>

      <p className="text-secondary">
        Evidencia: <span className="mono">{presented.evidence.join(' · ')}</span>
      </p>

      <Field
        // The field is not marked invalid before the doctor has written
        // anything: an empty field they have not reached yet is not an error,
        // and the hint already states the requirement.
        error={text.length > 0 && !satisfied ? ALERT_DISMISSAL_COPY_ES.justificationMissing : undefined}
        hint={ALERT_DISMISSAL_COPY_ES.justificationHint}
        id="critical-alert-justification"
        label={ALERT_DISMISSAL_COPY_ES.justificationLabel}
        required
      >
        {(props) => (
          <textarea
            {...props}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            value={text}
          />
        )}
      </Field>

      <p className="text-muted">
        El motivo queda registrado junto a la receta, cifrado y fuera de la cadena.
      </p>

      <div className="row row--end">
        <button className="btn btn--secondary" onClick={onClose} type="button">
          Volver a editar la receta
        </button>

        {onRemoveOffendingItem !== undefined && (
          <button className="btn btn--secondary" onClick={onRemoveOffendingItem} type="button">
            Retirar el ítem
          </button>
        )}

        <button
          className="btn btn--danger"
          // Born disabled (docs/17, D4). The state below is the whole rule.
          disabled={!satisfied}
          onClick={confirm}
          type="button"
        >
          Mantener bajo mi responsabilidad
        </button>
      </div>
    </Modal>
  );
}
