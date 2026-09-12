import { describeIssueRejection, type IssueRejection } from '../../domain/issuance';
import { ScreenShell } from '../components/ScreenShell';

/**
 * The refusal screen.
 *
 * HARD RULE (docs/17): "El rechazo nombra a quién y cuándo, nunca «operación
 * fallida»." One code, one reason, one action — all three come from
 * `describeIssueRejection`, which pairs each rejection with the copy that
 * accepts its evidence. This screen writes none of that text itself.
 *
 * Nothing was anchored on any of these paths, so returning to the form is safe
 * and is offered; that is the difference between this screen and D6.
 */

export interface RejectionScreenProps {
  reason: IssueRejection;
  onResumeEditing(): void;
  onNewPrescription(): void;
}

export function RejectionScreen({
  reason,
  onResumeEditing,
  onNewPrescription,
}: RejectionScreenProps) {
  const message = describeIssueRejection(reason);

  return (
    <ScreenShell
      status={
        <span className="badge badge--danger">
          <span aria-hidden="true">✗</span> No emitida
        </span>
      }
    >
      <div className="stack stack--loose">
        <div className="verdict verdict--danger" role="alert">
          <span aria-hidden="true" className="verdict__mark">
            ✗
          </span>
          <h1 className="verdict__headline">{message.headline}</h1>
          <p className="verdict__reason">{message.reason}</p>
        </div>

        <div className="alert alert--info">
          <span aria-hidden="true" className="alert__icon">
            ℹ
          </span>
          <div>
            <p className="alert__title">Qué hacer ahora</p>
            <p className="alert__body">{message.action}</p>
          </div>
        </div>

        <dl className="kv">
          <dt>Motivo</dt>
          <dd className="mono">{message.code}</dd>
        </dl>

        <div className="row row--between">
          <button className="btn btn--secondary" onClick={onResumeEditing} type="button">
            Volver a la receta
          </button>
          <button className="btn btn--primary" onClick={onNewPrescription} type="button">
            Empezar una receta nueva
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}
