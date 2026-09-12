import { useEffect, useRef, useState } from 'react';
import type { Address } from '@recetas/shared';
import type { ListPrescriptions, PrescriptionListItem } from '../../application/list-prescriptions';
import { describeIssueRejection, type IssueRejection } from '../../domain/issuance';
import { ScreenShell } from '../components/ScreenShell';
import { formatAddress, formatDay } from '../format';

/**
 * D7 — Mis recetas.
 *
 * HARD RULE (docs/04, docs/17 D7): "«Dispensada» sin ninguna acción
 * disponible." A dispensation is irreversible and the contract exposes no
 * reopening of any kind, so an interface that offered one would lie about the
 * only property that sustains the project.
 *
 * NO ROW CARRIES AN ACTION BUTTON AT ALL TODAY, and that is deliberate.
 * `PrescriptionListItem.actions` declares `cancel` as available on an issued
 * prescription, but the core has no cancel use case and `ChainPort` has no
 * method that could perform one — the projection says what WOULD be available,
 * it does not perform anything. A button that cannot act is worse than no
 * button: the doctor presses it, nothing happens, and they stop trusting the
 * screen. The list therefore renders state and evidence only.
 *
 * TODO (docs/04, docs/17 D7, docs/18 Fase 6): wiring «Cancelar receta» needs
 * three things that do not exist yet — `cancel(bytes32)` on `ChainPort`, a
 * `cancelPrescription` use case beside application/issue-prescription.ts, and
 * its own confirmation, because cancelling is irreversible too. Until all three
 * exist this screen shows no control.
 *
 * HARD RULE (docs/17): "Caducada" is CLIENT-DERIVED, against BLOCK time, and
 * `createListPrescriptions` already did that derivation. This screen renders
 * `label`; it never re-decides a state from the device clock.
 *
 * HARD RULE (docs/03): nothing identifying the patient exists on chain, so
 * there is nothing about them to render here. Not even the commitment is shown:
 * it identifies nobody, but it is also of no use to the doctor.
 */

const STATE_BADGE: Record<PrescriptionListItem['state'], { className: string; mark: string }> = {
  issued: { className: 'badge--info', mark: 'ℹ' },
  expired: { className: 'badge--neutral', mark: '⏱' },
  dispensed: { className: 'badge--success', mark: '✓' },
  cancelled: { className: 'badge--danger', mark: '✗' },
};

export interface PrescriptionsScreenProps {
  list: ListPrescriptions;
  prescriber: Address;
  onNewPrescription(): void;
}

type Listing =
  | { status: 'loading' }
  | { status: 'listed'; items: PrescriptionListItem[] }
  | { status: 'unavailable'; reason: IssueRejection };

export function PrescriptionsScreen({
  list,
  prescriber,
  onNewPrescription,
}: PrescriptionsScreenProps) {
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await runList(() => list({ prescriber }));
      if (cancelled || !mounted.current) return;

      setListing(
        result.outcome === 'listed'
          ? { status: 'listed', items: result.items }
          : { status: 'unavailable', reason: result.reason },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [list, prescriber]);

  return (
    <ScreenShell status={<span className="badge badge--neutral">Mis recetas</span>} wide>
      <div className="stack stack--loose">
        <div className="row row--between">
          <h1 className="title-screen">Mis recetas</h1>
          <button className="btn btn--primary" onClick={onNewPrescription} type="button">
            Nueva receta
          </button>
        </div>

        {listing.status === 'loading' && <p className="text-secondary">Consultando la cadena…</p>}

        {listing.status === 'unavailable' && (
          <div className="alert alert--danger" role="alert">
            <span aria-hidden="true" className="alert__icon">
              ✗
            </span>
            <div>
              <p className="alert__title">{describeIssueRejection(listing.reason).headline}</p>
              <p className="alert__body">{describeIssueRejection(listing.reason).reason}</p>
              <p className="alert__body">
                No se está mostrando una lista vacía: no se pudo consultar. Sus recetas siguen en
                la cadena tal como se registraron.
              </p>
            </div>
          </div>
        )}

        {listing.status === 'listed' && listing.items.length === 0 && (
          <div className="card stack stack--tight">
            <p className="text-secondary">Todavía no ha emitido ninguna receta desde este equipo.</p>
            <p className="text-muted">
              Cuando emita la primera aparecerá aquí, con el estado que tenga en la cadena.
            </p>
          </div>
        )}

        {listing.status === 'listed' &&
          listing.items.map((item) => (
            <article className="card stack stack--tight" key={item.contentHash}>
              <div className="row row--between">
                <span className="mono">{item.contentHash}</span>
                <span className={`badge ${STATE_BADGE[item.state].className}`}>
                  <span aria-hidden="true">{STATE_BADGE[item.state].mark}</span> {item.label}
                </span>
              </div>

              <p className="text-muted">
                Emitida el {formatDay(item.issuedAt)} · caduca el {formatDay(item.expiresAt)}
              </p>

              {item.state === 'dispensed' && item.dispensedAt !== undefined && (
                <p className="text-muted">
                  Entregada el {formatDay(item.dispensedAt)}
                  {item.dispensedBy === undefined ? '' : ' por '}
                  {item.dispensedBy === undefined ? null : (
                    <span className="mono">{formatAddress(item.dispensedBy)}</span>
                  )}
                </p>
              )}
            </article>
          ))}
      </div>
    </ScreenShell>
  );
}

type ListOutcome = Awaited<ReturnType<ListPrescriptions>>;

/**
 * The boundary around the one call that can throw.
 *
 * `createListPrescriptions` answers with `unavailable` for a chain that refused
 * or did not respond, and rethrows anything nobody modelled. An unmodelled
 * error must not reach the consulting room as a verdict about the recetas, so
 * it becomes the same honest "could not query" as any other network failure.
 */
async function runList(call: () => Promise<ListOutcome>): Promise<ListOutcome> {
  try {
    return await call();
  } catch {
    return {
      outcome: 'unavailable',
      reason: {
        code: 'network-error',
        message: 'No se pudo consultar el listado de recetas en la cadena.',
      },
    };
  }
}
