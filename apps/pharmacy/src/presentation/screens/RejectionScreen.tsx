import { describeRejection, type RejectionCode, type RejectionReason } from '../../domain/rejection';
import type { CheckResult } from '../../domain/verification';
import { CheckList } from '../components/CheckList';
import { ScreenShell } from '../components/ScreenShell';
import { shortHash } from '../format';

/**
 * P7 — Otros rechazos.
 *
 * ONE component for every code, driven entirely by `describeRejection()`. It
 * has no generic fallback and no default branch: the copy catalogue in
 * domain/rejection.ts gives each code its own headline, its own explanation and
 * its own next step.
 *
 * HARD RULE (docs/17): "Cinco motivos, cinco acciones distintas." Collapsing
 * two codes into one message turns two very different situations — a
 * prescription that simply expired and a document whose content was altered —
 * into the same shrug.
 *
 * HARD RULE (docs/07, docs/17): the revocation copy says future access is
 * revoked. Nothing already registered is deleted, and the catalogue says so.
 *
 * Whether the verdict is a refusal or an incomplete verification decides the
 * tone, never a generic "operación fallida".
 */

/**
 * Codes that are NOT a verdict about the prescription: nothing was disproved,
 * the verification simply could not be completed or was never applicable here.
 */
const NOT_A_VERDICT: ReadonlySet<RejectionCode> = new Set<RejectionCode>([
  'network-error',
  'wrong-deployment',
]);

export interface RejectionScreenProps {
  reason: RejectionReason;
  /** The five lines that produced the verdict, when there are any. */
  checks?: CheckResult[] | undefined;
  contentHash?: string | undefined;
  onScanAnother(): void;
}

export function RejectionScreen({
  reason,
  checks,
  contentHash,
  onScanAnother,
}: RejectionScreenProps) {
  const message = describeRejection(reason);
  const incomplete = NOT_A_VERDICT.has(message.code);

  return (
    <ScreenShell
      status={
        <span className={incomplete ? 'badge badge--warning' : 'badge badge--danger'}>
          <span aria-hidden="true">{incomplete ? '⚠' : '✗'}</span>
          {incomplete ? ' Sin verificar' : ' Rechazada'}
        </span>
      }
    >
      <div className="stack stack--loose">
        <section className="verdict verdict--danger" role="alert">
          <span className="verdict__mark" aria-hidden="true">
            {incomplete ? '⚠' : '✗'}
          </span>
          <h1 className="verdict__headline">{message.headline}</h1>
          <p className="verdict__reason">{message.reason}</p>
        </section>

        <div className={incomplete ? 'alert alert--warning' : 'alert alert--danger'}>
          <span className="alert__icon" aria-hidden="true">
            {incomplete ? '⚠' : '✗'}
          </span>
          <div>
            <p className="alert__title">Qué hacer ahora</p>
            {/* One distinct action per code, straight from the catalogue. */}
            <p className="alert__body">{message.action}</p>
          </div>
        </div>

        {checks !== undefined && (
          <section className="stack stack--tight">
            <h2 className="title-section">Comprobaciones</h2>
            <CheckList checks={checks} />
          </section>
        )}

        {contentHash !== undefined && (
          <dl className="kv">
            <dt>Código leído</dt>
            <dd className="mono">{shortHash(contentHash)}</dd>
          </dl>
        )}

        <button className="btn btn--secondary btn--block" onClick={onScanAnother} type="button">
          Escanear otra receta
        </button>
      </div>
    </ScreenShell>
  );
}
