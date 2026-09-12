import { useState } from 'react';
import { NEVER_BLOCKS_ES, type ClinicalAlert } from '@recetas/rules';
import {
  ALERT_DISMISSAL_COPY_ES,
  alertIdentity,
  partitionAlerts,
  type PresentedAlert,
} from '../../domain/alerts';
import { validateDraft, type DraftIssue, type PrescriptionDraft } from '../../domain/draft';
import { AlertCard } from '../components/AlertCard';
import { Field } from '../components/Field';
import { FlowSteps } from '../components/FlowSteps';
import { ScreenShell } from '../components/ScreenShell';
import { addItem, alertsFor, removeItem, replaceItem } from '../draft-editing';

/**
 * D3 — Medicación.
 *
 * HARD RULE (D-07, docs/17 D3): there is no commercial product catalogue. The
 * MVP prescribes by ACTIVE INGREDIENT and ATC code, and the equivalence is left
 * to the pharmacist's judgement. A brand field here would promise a catalogue
 * that does not exist and an equivalence nobody has validated.
 *
 * HARD RULE (docs/06, docs/17): "Ninguna alerta clínica bloquea la emisión."
 * `NEVER_BLOCKS_ES` is rendered beside the alerts, and the control that moves
 * on to D5 reads nothing about them: it is enabled whatever the engine says.
 * The absence of that condition is the rule.
 *
 * HARD RULE (docs/17 D3): every alert cites its evidence and its ruleset
 * version. That belongs to `AlertCard`, which cannot render one without both.
 *
 * The alert set is re-derived from the draft on every render, which is what
 * `evaluate` is for: it is stateless, so nothing here can hold a stale verdict.
 * The decisions already taken are matched against it by `partitionAlerts`, and
 * `editDraft` prunes a decision the moment the item that earned it changes —
 * see presentation/draft-editing.ts for why that has to happen on every edit.
 */

export interface MedicationScreenProps {
  draft: PrescriptionDraft;
  onDraftChange(draft: PrescriptionDraft): void;
  /** Opens D4 over this screen. It never dismisses anything by itself. */
  onCriticalAlert(alert: ClinicalAlert): void;
  onBack(): void;
  onContinue(): void;
}

export function MedicationScreen({
  draft,
  onDraftChange,
  onCriticalAlert,
  onBack,
  onContinue,
}: MedicationScreenProps) {
  const [submitted, setSubmitted] = useState(false);

  const alerts = alertsFor(draft);
  const { active, previouslyDismissed } = partitionAlerts(alerts, draft.justifications);

  // The raw alert is what D4 needs: `dismissAlert` and `justificationSatisfies`
  // both take a `ClinicalAlert`, and its identity already carries the evidence.
  const rawAlerts = new Map(alerts.map((alert) => [alertIdentity(alert), alert]));

  const issues = validateDraft(draft).filter((issue) => isMedicationIssue(issue));
  const itemProblem = (index: number): string | undefined =>
    submitted
      ? issues.find((issue) => issue.itemIndex === index && issue.code === 'item-incomplete')
          ?.message
      : undefined;
  const quantityProblem = (index: number): string | undefined =>
    submitted
      ? issues.find(
          (issue) => issue.itemIndex === index && issue.code === 'item-quantity-invalid',
        )?.message
      : undefined;

  const submit = (): void => {
    setSubmitted(true);
    // Form validation only. No branch here reads `active`, so a screenful of
    // critical alerts cannot keep the doctor from moving on (docs/06).
    if (issues.length === 0) onContinue();
  };

  const raise = (alert: PresentedAlert): void => {
    const raw = rawAlerts.get(alert.id);
    if (raw !== undefined) onCriticalAlert(raw);
  };

  return (
    <ScreenShell
      status={<span className="badge badge--info">Receta en borrador</span>}
      wide
    >
      <div className="stack stack--loose">
        <FlowSteps current="medication" />

        <div className="stack stack--tight">
          <h1 className="title-screen">Medicación</h1>
          <p className="text-secondary">
            Se prescribe por principio activo y código ATC. La elección del producto comercial
            equivalente queda a criterio del farmacéutico.
          </p>
        </div>

        {draft.items.map((item, index) => (
          <section className="card" key={index}>
            <header className="card__header">
              <h2 className="title-section">Ítem {index + 1}</h2>
              <button
                className="btn btn--ghost"
                disabled={draft.items.length === 1}
                onClick={() => onDraftChange(removeItem(draft, index))}
                type="button"
              >
                Quitar ítem {index + 1}
              </button>
            </header>

            <div className="stack">
              <div className="grid-2">
                <Field
                  error={itemProblem(index)}
                  id={`item-${index}-ingredient`}
                  label="Principio activo"
                  required
                >
                  {(props) => (
                    <input
                      {...props}
                      onChange={(event) =>
                        onDraftChange(
                          replaceItem(draft, index, { activeIngredient: event.target.value }),
                        )
                      }
                      value={item.activeIngredient}
                    />
                  )}
                </Field>

                <Field
                  hint="Clasificación ATC de la OMS, por ejemplo J01CA04."
                  id={`item-${index}-atc`}
                  label="Código ATC"
                  required
                >
                  {(props) => (
                    <input
                      {...props}
                      className={`${props.className} mono`}
                      onChange={(event) =>
                        onDraftChange(replaceItem(draft, index, { atcCode: event.target.value }))
                      }
                      value={item.atcCode}
                    />
                  )}
                </Field>

                <Field id={`item-${index}-strength`} label="Concentración" required>
                  {(props) => (
                    <input
                      {...props}
                      onChange={(event) =>
                        onDraftChange(replaceItem(draft, index, { strength: event.target.value }))
                      }
                      value={item.strength}
                    />
                  )}
                </Field>

                <Field id={`item-${index}-dose-form`} label="Forma farmacéutica" required>
                  {(props) => (
                    <input
                      {...props}
                      onChange={(event) =>
                        onDraftChange(replaceItem(draft, index, { doseForm: event.target.value }))
                      }
                      value={item.doseForm}
                    />
                  )}
                </Field>

                <Field
                  error={quantityProblem(index)}
                  id={`item-${index}-quantity`}
                  label="Cantidad"
                  required
                >
                  {(props) => (
                    <input
                      {...props}
                      inputMode="numeric"
                      onChange={(event) =>
                        onDraftChange(
                          replaceItem(draft, index, { quantity: Number(event.target.value) }),
                        )
                      }
                      type="number"
                      value={Number.isNaN(item.quantity) ? '' : item.quantity}
                    />
                  )}
                </Field>
              </div>

              <Field id={`item-${index}-dosage`} label="Posología" required>
                {(props) => (
                  <input
                    {...props}
                    onChange={(event) =>
                      onDraftChange(
                        replaceItem(draft, index, { dosageInstruction: event.target.value }),
                      )
                    }
                    value={item.dosageInstruction}
                  />
                )}
              </Field>
            </div>
          </section>
        ))}

        <div className="row row--between">
          <button
            className="btn btn--secondary"
            onClick={() => onDraftChange(addItem(draft))}
            type="button"
          >
            Añadir otro ítem
          </button>
        </div>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Verificación clínica</h2>
            <span className="badge badge--neutral">{active.length} sin valorar</span>
          </header>

          <div className="stack">
            {/* HARD RULE (docs/06, docs/17): stated where it cannot be missed,
                above the alerts themselves rather than under them. */}
            <p className="text-secondary">{NEVER_BLOCKS_ES}</p>

            {active.length === 0 && previouslyDismissed.length === 0 ? (
              <p className="text-secondary">
                El motor no encontró coincidencias con lo declarado en el formulario.
              </p>
            ) : (
              active.map((alert) => (
                <AlertCard
                  alert={alert}
                  key={alert.id}
                  {...(alert.requiresJustification
                    ? {
                        action: {
                          label: 'Valorar esta alerta',
                          onClick: () => raise(alert),
                        },
                      }
                    : {})}
                />
              ))
            )}

            {previouslyDismissed.length > 0 && (
              // The quiet group. Suppression means "stop shouting", not "hide
              // the evidence": the decisions stay on the screen they were made
              // on, with their motive (domain/alerts.ts).
              <details className="stack stack--tight">
                <summary>
                  {ALERT_DISMISSAL_COPY_ES.dismissedGroupTitle} ({previouslyDismissed.length})
                </summary>
                <p className="text-muted">{ALERT_DISMISSAL_COPY_ES.dismissedGroupBody}</p>
                {previouslyDismissed.map((alert) => (
                  <AlertCard alert={alert} key={alert.id} live={false} />
                ))}
              </details>
            )}
          </div>
        </section>

        <div className="row row--between">
          <button className="btn btn--secondary" onClick={onBack} type="button">
            Volver al paciente
          </button>
          <button className="btn btn--primary" onClick={submit} type="button">
            Revisar y firmar
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}

/** The form problems this screen owns. The rest belong to D2. */
function isMedicationIssue(issue: DraftIssue): boolean {
  return (
    issue.code === 'items-empty' ||
    issue.code === 'item-incomplete' ||
    issue.code === 'item-quantity-invalid'
  );
}
