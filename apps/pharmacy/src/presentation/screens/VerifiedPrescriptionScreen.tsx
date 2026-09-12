import { useState } from 'react';
import type { PrescriptionDocument, PrescriptionRecord } from '@recetas/shared';
import { ScreenShell } from '../components/ScreenShell';
import { formatAddress, formatIsoDay, shortHash } from '../format';

/**
 * P4 — Receta verificada.
 *
 * HARD RULE (docs/17, docs/04): "Confirmar entrega es un acto humano, no un
 * efecto secundario del escaneo." Rendering this screen registers nothing. The
 * transition to `Dispensed` is irreversible, and firing something irreversible
 * from a passive gesture — pointing a camera at a code — is a design error.
 * That is why the primary action opens a confirmation step instead of calling
 * `dispense`, and why the write starts only on the second, deliberate press.
 *
 * HARD RULE (docs/03, docs/17): `patient.patientId` and `salt` NEVER reach the
 * DOM. The cédula must not be on a screen held up at a counter, and the salt is
 * what protects the anchored commitment. Only the patient's name is shown,
 * which is what a paper prescription shows today.
 */

export interface VerifiedPrescriptionScreenProps {
  document: PrescriptionDocument;
  record: PrescriptionRecord;
  /** The anchored content hash, so the evidence is readable on this screen. */
  contentHash: string;
  /** Dispatched only from the confirmation step. */
  onConfirm(): void;
  onCancel(): void;
}

export function VerifiedPrescriptionScreen({
  document,
  record,
  contentHash,
  onConfirm,
  onCancel,
}: VerifiedPrescriptionScreenProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <ScreenShell
      status={
        <span className="badge badge--success">
          <span aria-hidden="true">✓</span> Verificada
        </span>
      }
    >
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1 className="title-screen">{document.patient.fullName}</h1>
          <p className="text-secondary">
            {document.practitioner.fullName} ·{' '}
            <span className="mono">{document.practitioner.licenseNumber}</span>
          </p>
          <p className="text-muted">
            Emitida el {formatIsoDay(document.issuedAt)} · caduca el{' '}
            {formatIsoDay(document.expiresAt)}
          </p>
        </div>

        <section className="stack">
          <h2 className="title-section">Medicación prescrita</h2>
          {document.items.map((item, index) => (
            <article
              className="card stack stack--tight"
              key={`${item.atcCode}-${item.activeIngredient}-${index}`}
            >
              <strong>
                {item.activeIngredient} {item.strength}
              </strong>
              <span className="mono text-muted">
                {item.atcCode} · {item.doseForm}
              </span>
              <span className="text-secondary">
                {item.quantity} unidades — {item.dosageInstruction}
              </span>
            </article>
          ))}
          <p className="text-muted">
            Se prescribe por principio activo. La equivalencia comercial queda a su criterio.
          </p>
        </section>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Evidencia en cadena</h2>
            <span className="badge badge--info">Emitida</span>
          </header>
          <dl className="kv">
            <dt>Huella del contenido</dt>
            <dd className="mono">{shortHash(contentHash)}</dd>
            <dt>Prescriptor</dt>
            <dd className="mono">{formatAddress(record.prescriber)}</dd>
          </dl>
        </section>

        {confirming ? (
          <section className="alert alert--warning" role="alert">
            <span className="alert__icon" aria-hidden="true">
              ⚠
            </span>
            <div className="stack">
              <div>
                <p className="alert__title">Confirme la entrega del medicamento</p>
                <p className="alert__body">
                  Al confirmar, esta receta queda registrada como dispensada de forma definitiva y
                  no podrá volver a dispensarse en ninguna farmacia. Confirme solo cuando el
                  medicamento esté entregado.
                </p>
              </div>
              <div className="stack">
                <button className="btn btn--primary btn--lg btn--block" onClick={onConfirm} type="button">
                  Sí, registrar la entrega
                </button>
                <button
                  className="btn btn--secondary btn--block"
                  onClick={() => setConfirming(false)}
                  type="button"
                >
                  Volver
                </button>
              </div>
            </div>
          </section>
        ) : (
          <div className="stack">
            <button
              className="btn btn--primary btn--lg btn--block"
              // Opens the confirmation step. It does NOT dispense: see the
              // module comment above.
              onClick={() => setConfirming(true)}
              type="button"
            >
              Confirmar entrega
            </button>
            <button className="btn btn--ghost btn--block" onClick={onCancel} type="button">
              Cancelar
            </button>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}
