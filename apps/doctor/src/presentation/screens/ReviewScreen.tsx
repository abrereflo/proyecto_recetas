import { Fragment } from 'react';
import { partitionAlerts } from '../../domain/alerts';
import { expiresAtMidnight, type PrescriptionDraft } from '../../domain/draft';
import { ADSIB_PENDING_NOTICE_ES } from '../../domain/issuance';
import type { Address } from '@recetas/shared';
import { AlertCard } from '../components/AlertCard';
import { FlowSteps } from '../components/FlowSteps';
import { ScreenShell } from '../components/ScreenShell';
import { alertsFor } from '../draft-editing';
import { formatAddress, formatDay } from '../format';
import { describePrescriptionSignature } from '../typed-data';

/**
 * D5 — Revisión y firma.
 *
 * HARD RULE (docs/17, D5): "Datos tipados como frases legibles, nunca un
 * hexadecimal." The EIP-712 message is rendered as sentences by
 * presentation/typed-data.ts. A doctor who signs something they cannot read is
 * not consenting, they are obeying.
 *
 * HARD RULE (D-17, docs/17): the ADSIB signature is declared and honestly
 * unintegrated. `ADSIB_PENDING_NOTICE_ES` says so verbatim and the badge reads
 * `pending-integration`, which is exactly the status the issued document will
 * carry. Simulating legal validity is the one thing this screen must never do.
 *
 * HARD RULE (docs/03, docs/17): the patient identifier and the commitment salt
 * are NOT on this screen. The salt does not exist yet — it is generated inside
 * the issuing pipeline — and the identifier stays in the draft, travels inside
 * the encrypted document and reaches neither the chain nor this page.
 *
 * HARD RULE (docs/06): the alert summary below is a reminder, not a gate.
 * "Firmar y emitir" is enabled whatever it says.
 */

export interface ReviewScreenProps {
  draft: PrescriptionDraft;
  /** The account the chain will record as `prescriber`. */
  prescriber: Address;
  chainId: number;
  onBack(): void;
  /** The explicit act. Nothing else on this screen starts the pipeline. */
  onConfirmSignature(): void;
  /** The issuing instant, injected so the expiry preview is testable (D-13). */
  now?: Date;
}

export function ReviewScreen({
  draft,
  prescriber,
  chainId,
  onBack,
  onConfirmSignature,
  now = new Date(),
}: ReviewScreenProps) {
  const expiresAt = expiresAtMidnight(now, draft.validityDays);
  const sentences = describePrescriptionSignature({
    draft,
    prescriber,
    expiresAt,
    issuedAt: now,
    chainId,
  });

  const { active, previouslyDismissed } = partitionAlerts(alertsFor(draft), draft.justifications);

  return (
    <ScreenShell status={<span className="badge badge--info">Pendiente de firma</span>}>
      <div className="stack stack--loose">
        <FlowSteps current="review" />

        <div className="stack stack--tight">
          <h1 className="title-screen">Va a firmar esta receta</h1>
          <p className="text-secondary">
            Lea lo que va a firmar. Al firmar, este equipo cifra la receta, la guarda y la
            registra en la cadena.
          </p>
        </div>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Qué queda firmado</h2>
          </header>

          <dl className="kv">
            {sentences.map((entry) => (
              <Fragment key={entry.field}>
                <dt>{entry.field}</dt>
                <dd>{entry.sentence}</dd>
              </Fragment>
            ))}
          </dl>
        </section>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Receta</h2>
            <span className="badge badge--neutral">Caduca el {formatDay(expiresAt)}</span>
          </header>

          <div className="stack">
            <dl className="kv">
              <dt>Prescriptor</dt>
              <dd>
                {draft.practitioner.fullName} · matrícula{' '}
                <span className="mono">{draft.practitioner.licenseNumber}</span>
              </dd>
              <dt>Cuenta que firma</dt>
              <dd className="mono">{formatAddress(prescriber)}</dd>
              <dt>Paciente</dt>
              <dd>
                {draft.patient.fullName}{' '}
                <span className="text-muted">(no se publica en la cadena)</span>
              </dd>
            </dl>

            <ol className="stack stack--tight">
              {draft.items.map((item, index) => (
                <li key={index}>
                  {item.activeIngredient} {item.strength} · {item.doseForm} ·{' '}
                  {item.quantity} u. — {item.dosageInstruction}{' '}
                  <span className="mono">{item.atcCode}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {(active.length > 0 || previouslyDismissed.length > 0) && (
          <section className="card">
            <header className="card__header">
              <h2 className="title-section">Alertas de esta receta</h2>
            </header>
            <div className="stack">
              {active.map((alert) => (
                <AlertCard alert={alert} key={alert.id} live={false} />
              ))}
              {previouslyDismissed.map((alert) => (
                <AlertCard alert={alert} key={alert.id} live={false} />
              ))}
            </div>
          </section>
        )}

        <div className="alert alert--info">
          <span aria-hidden="true" className="alert__icon">
            ℹ
          </span>
          <div>
            <p className="alert__title">Firma ADSIB: pendiente de integración</p>
            <p className="alert__body">{ADSIB_PENDING_NOTICE_ES}</p>
          </div>
        </div>

        <div className="row row--between">
          <button className="btn btn--secondary" onClick={onBack} type="button">
            Volver a la medicación
          </button>

          <div className="row">
            <span className="badge badge--warning">
              <span aria-hidden="true">⚠</span> ADSIB · pending-integration
            </span>
            <button
              className="btn btn--primary btn--lg"
              // The one control that starts the pipeline. The reducer accepts
              // `confirmSignature` from nowhere else (docs/17, D5).
              onClick={onConfirmSignature}
              type="button"
            >
              Firmar y emitir
            </button>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}
