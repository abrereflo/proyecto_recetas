import { describeRejection, type RejectionReasonOf } from '../../domain/rejection';
import { ScreenShell } from '../components/ScreenShell';
import { formatAddress, formatDateTime, shortHash } from '../format';

/**
 * P6 — Rechazada porque ya fue dispensada.
 *
 * This is the screen the whole product is built around (docs/00, docs/04,
 * docs/17). It is projected in front of a jury and read from three metres, and
 * at a real counter it does the same job: the pharmacist must see it without
 * bringing the phone up to their face. `verdict--danger` carries the 48 px
 * headline (--text-4xl in design/tokens.css); this screen does not restyle it.
 *
 * HARD RULE (docs/17): it names WHO and WHEN, never "operación fallida". The
 * contract's `AlreadyDispensed` error returns `dispensedBy` and `dispensedAt`,
 * which is exactly why this screen can accuse with a date and an address while
 * any other system would shrug.
 *
 * HARD RULE (docs/04, docs/17): NO reopen button exists on this screen, and
 * none will ever be added. The contract has no operation that could reopen a
 * dispensed prescription, so a control offering it would make the interface lie
 * about the one property that sustains the project. `Escanear otra receta`
 * moves on to the NEXT prescription; it does not reopen, undo or revert this
 * one.
 */

export interface AlreadyDispensedScreenProps {
  reason: RejectionReasonOf<'already-dispensed'>;
  /** The anchored content hash of the code that was just scanned. */
  contentHash?: string | undefined;
  onScanAnother(): void;
}

export function AlreadyDispensedScreen({
  reason,
  contentHash,
  onScanAnother,
}: AlreadyDispensedScreenProps) {
  const message = describeRejection(reason);

  return (
    <ScreenShell
      status={
        <span className="badge badge--danger">
          <span aria-hidden="true">✗</span> Rechazada
        </span>
      }
    >
      <div className="stack stack--loose">
        <section className="verdict verdict--danger" role="alert">
          <span className="verdict__mark" aria-hidden="true">
            ✗
          </span>
          <h1 className="verdict__headline">{message.headline}</h1>
          <p className="verdict__reason">{message.reason}</p>
        </section>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Evidencia en cadena</h2>
            <span className="badge badge--danger">Dispensada</span>
          </header>
          <dl className="kv">
            <dt>Dispensada por</dt>
            <dd className="mono">{formatAddress(reason.dispensedBy)}</dd>
            <dt>Fecha de dispensación</dt>
            <dd>{formatDateTime(reason.dispensedAt)}</dd>
            {contentHash !== undefined && (
              <>
                <dt>Receta</dt>
                <dd className="mono">{shortHash(contentHash)}</dd>
              </>
            )}
          </dl>
        </section>

        <div className="alert alert--danger">
          <span className="alert__icon" aria-hidden="true">
            ✗
          </span>
          <div>
            <p className="alert__title">Qué hacer ahora</p>
            <p className="alert__body">{message.action}</p>
          </div>
        </div>

        <button className="btn btn--secondary btn--block" onClick={onScanAnother} type="button">
          Escanear otra receta
        </button>
      </div>
    </ScreenShell>
  );
}
