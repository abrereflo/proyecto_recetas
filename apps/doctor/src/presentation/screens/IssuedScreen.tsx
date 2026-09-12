import { QR_DISCLOSURE_WARNING_ES } from '../../domain/issuance';
import { QrCode } from '../components/QrCode';
import { ScreenShell } from '../components/ScreenShell';
import type { IssuedPrescription } from '../flow/doctor-flow';
import { formatDay } from '../format';

/**
 * D6 — Receta emitida.
 *
 * HARD RULE (D-24, docs/17 D6): "Advertencia explícita: quien tiene el código
 * puede leer la receta." The QR carries the decryption key unwrapped. That is
 * the most serious privacy gap of the MVP and the warning is the honest
 * mitigation while no per-recipient wrapping exists, so
 * `QR_DISCLOSURE_WARNING_ES` sits beside the code rather than under a fold.
 *
 * HARD RULE (D-13, docs/17): the expiry is a DATE WITHOUT A TIME. The contract
 * refuses a dispensation from midnight of that day, so an hour on this screen
 * would be an hour the doctor could promise and the pharmacy could not honour.
 *
 * HARD RULE (docs/05, docs/03): THE CODE CANNOT BE SHOWN AGAIN. The decryption
 * key exists only in this browser session — it was generated here, it went into
 * this QR, and it was never stored anywhere this application can read back. D7
 * lists the prescription from the chain, where only the content hash and the
 * commitment live, so it can never regenerate this code. The screen says so
 * plainly, and it deliberately offers NO action that would suggest otherwise:
 * no "send later", no "recover code", no list entry that reopens it.
 *
 * TODO (docs/18, Fase 6 D6): printing and downloading are in the mockup and are
 * not wired here. Both need a decision about a file that carries the decryption
 * key out of the browser — which is the same D-24 problem, one step further
 * away from the patient. Whoever adds them decides that first.
 */

export interface IssuedScreenProps {
  result: IssuedPrescription;
  chainId: number;
  onNewPrescription(): void;
  onOpenPrescriptions(): void;
}

export function IssuedScreen({
  result,
  chainId,
  onNewPrescription,
  onOpenPrescriptions,
}: IssuedScreenProps) {
  return (
    <ScreenShell
      status={
        <span className="badge badge--success">
          <span aria-hidden="true">✓</span> Registrada en cadena
        </span>
      }
    >
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1 className="title-screen">Receta emitida</h1>
          <p className="text-secondary">
            Entregue este código al paciente ahora. La farmacia lo escanea para verificar y
            dispensar.
          </p>
        </div>

        <QrCode label="Código QR de la receta" value={result.qr} />

        {/* D-24: the warning the whole screen exists to carry. */}
        <div className="alert alert--warning" role="alert">
          <span aria-hidden="true" className="alert__icon">
            ⚠
          </span>
          <div>
            <p className="alert__title">Quien tenga este código puede leer la receta</p>
            <p className="alert__body">{QR_DISCLOSURE_WARNING_ES}</p>
          </div>
        </div>

        {/* The session-only key, said plainly rather than discovered later. */}
        <div className="alert alert--danger" role="alert">
          <span aria-hidden="true" className="alert__icon">
            ⚠
          </span>
          <div>
            <p className="alert__title">Este código no se puede volver a mostrar</p>
            <p className="alert__body">
              La clave que permite leer la receta se generó en este equipo y solo existe mientras
              esta pantalla esté abierta. En «Mis recetas» verá que la receta está emitida, pero el
              código no se puede generar de nuevo desde ahí. Entréguelo antes de continuar.
            </p>
          </div>
        </div>

        <dl className="kv">
          <dt>Huella del contenido</dt>
          <dd className="mono">{result.contentHash}</dd>
          <dt>Transacción</dt>
          <dd className="mono">{result.transactionHash}</dd>
          <dt>Caduca</dt>
          <dd>{formatDay(result.expiresAt)}</dd>
          <dt>Red</dt>
          <dd className="mono">{chainId}</dd>
        </dl>

        <div className="row row--between">
          <button className="btn btn--secondary" onClick={onOpenPrescriptions} type="button">
            Ver mis recetas
          </button>
          <button className="btn btn--primary" onClick={onNewPrescription} type="button">
            Escribir otra receta
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}
