import { useMemo } from 'react';
import type { PrescriptionItem } from '@recetas/shared';
import {
  ALERT_COPY_ES,
  CONTEXT_DISCLAIMER_ES,
  NEVER_BLOCKS_ES,
  SEVERITY_LABEL_ES,
  evaluate,
  type AlertSeverity,
  type PatientContext,
} from '@recetas/rules';

/**
 * Placeholder screen for the doctor SPA.
 *
 * It exercises the design system classes and the rules engine end to end so the
 * wiring is proven before the real screens (D1..D7 in docs/17) are built.
 *
 * Interface copy is Spanish; identifiers and comments are English.
 */

// TODO: replace with the real prescription form (screens D2 and D3).
const DEMO_ITEMS: PrescriptionItem[] = [
  {
    atcCode: 'J01CA04',
    activeIngredient: 'amoxicillin',
    strength: '500 mg',
    doseForm: 'capsule',
    quantity: 21,
    dosageInstruction: '1 cápsula cada 8 horas durante 7 días',
  },
  {
    atcCode: 'J01CA08',
    activeIngredient: 'pivmecillinam',
    strength: '400 mg',
    doseForm: 'tablet',
    quantity: 15,
    dosageInstruction: '1 comprimido cada 8 horas durante 5 días',
  },
];

// TODO: this comes from the patient-context form. There is no history to read
// from: the engine only sees what the doctor types here (D-25).
const DEMO_CONTEXT: PatientContext = {
  declaredAllergies: ['amoxicillin'],
  concomitantMedication: [],
};

const SEVERITY_TO_ALERT_CLASS: Record<AlertSeverity, string> = {
  critical: 'alert--danger',
  high: 'alert--danger',
  moderate: 'alert--warning',
  info: 'alert--info',
};

const SEVERITY_TO_ICON: Record<AlertSeverity, string> = {
  critical: '⛔',
  high: '⚠',
  moderate: '⚠',
  info: 'ℹ',
};

export function App() {
  const alerts = useMemo(() => evaluate({ items: DEMO_ITEMS }, DEMO_CONTEXT), []);

  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="app-bar__brand">Receta Verificable</span>
        <span className="text-muted">Consultorio · entorno de desarrollo</span>
      </header>

      <main className="app-main">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <h1 className="title-screen">Nueva receta</h1>
            <p className="text-secondary">
              Andamiaje inicial. Las pantallas reales se construyen sobre las maquetas de{' '}
              <span className="mono">design/mockups/doctor.html</span>.
            </p>
          </div>

          <section className="card">
            <header className="card__header">
              <h2 className="title-section">Contexto clínico declarado</h2>
              <span className="badge badge--neutral">D-25</span>
            </header>
            <div className="stack">
              <div className="alert alert--info">
                <span className="alert__icon" aria-hidden="true">
                  ℹ
                </span>
                <div>
                  <p className="alert__title">Alcance de la verificación</p>
                  <p className="alert__body">{CONTEXT_DISCLAIMER_ES}</p>
                </div>
              </div>
              <dl className="kv">
                <dt>Alergias declaradas</dt>
                <dd>{DEMO_CONTEXT.declaredAllergies.join(', ') || 'Ninguna'}</dd>
                <dt>Medicación concomitante</dt>
                <dd>{DEMO_CONTEXT.concomitantMedication.join(', ') || 'Ninguna'}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <header className="card__header">
              <h2 className="title-section">Medicación prescrita</h2>
              <span className="badge badge--info">{DEMO_ITEMS.length} ítems</span>
            </header>
            <div className="stack">
              {DEMO_ITEMS.map((item) => (
                <dl className="kv" key={`${item.atcCode}-${item.activeIngredient}`}>
                  <dt>Principio activo</dt>
                  <dd>{item.activeIngredient}</dd>
                  <dt>Código ATC</dt>
                  <dd className="mono">{item.atcCode}</dd>
                  <dt>Presentación</dt>
                  <dd>
                    {item.strength} · {item.doseForm} · {item.quantity} u.
                  </dd>
                  <dt>Posología</dt>
                  <dd>{item.dosageInstruction}</dd>
                </dl>
              ))}
            </div>
          </section>

          <section className="card">
            <header className="card__header">
              <h2 className="title-section">Verificación determinística</h2>
              <span className="badge badge--neutral mono">
                {alerts[0]?.rulesetVersion ?? 'sin alertas'}
              </span>
            </header>
            <div className="stack">
              {alerts.length === 0 ? (
                <p className="text-secondary">Sin alertas para esta receta.</p>
              ) : (
                alerts.map((alert, index) => (
                  <div
                    className={`alert ${SEVERITY_TO_ALERT_CLASS[alert.severity]}`}
                    key={`${alert.code}-${index}`}
                  >
                    <span className="alert__icon" aria-hidden="true">
                      {SEVERITY_TO_ICON[alert.severity]}
                    </span>
                    <div>
                      <p className="alert__title">
                        {ALERT_COPY_ES[alert.code].title} ·{' '}
                        {SEVERITY_LABEL_ES[alert.severity]}
                      </p>
                      <p className="alert__body">{ALERT_COPY_ES[alert.code].body}</p>
                      <p className="text-muted">
                        Evidencia: <span className="mono">{alert.evidence.join(' · ')}</span>
                      </p>
                    </div>
                  </div>
                ))
              )}
              <p className="text-muted">{NEVER_BLOCKS_ES}</p>
            </div>
          </section>

          <div className="row row--end">
            {/* TODO: EIP-712 signature with the passkey (screen D5) and issue()
                through the paymaster. The word "wallet" never appears in this
                interface (docs/17). */}
            <button className="btn btn--secondary" type="button">
              Guardar borrador
            </button>
            <button className="btn btn--primary" type="button" disabled>
              Firmar y emitir
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
