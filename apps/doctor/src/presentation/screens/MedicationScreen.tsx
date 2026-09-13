import { useState } from 'react';
import { NEVER_BLOCKS_ES, type ClinicalAlert } from '@recetas/rules';
import {
  ALERT_DISMISSAL_COPY_ES,
  alertIdentity,
  partitionAlerts,
  type PresentedAlert,
} from '../../domain/alerts';
import {
  CONTROLLED_MEDICATIONS,
  groupedControlledMedications,
} from '../../domain/controlled-medications';
import { validateDraft, type DraftIssue, type PrescriptionDraft } from '../../domain/draft';
import { AlertCard } from '../components/AlertCard';
import { Field } from '../components/Field';
import { FlowSteps } from '../components/FlowSteps';
import { ScreenShell } from '../components/ScreenShell';
import {
  addItem,
  alertsFor,
  hasDoctorEnteredWork,
  isCatalogueItemSelected,
  removeItem,
  replaceItem,
  toggleCatalogueItem,
} from '../draft-editing';

/**
 * D3 — Medicación.
 *
 * HARD RULE (D-07, docs/17 D3): there is no commercial product catalogue. The
 * MVP prescribes by ACTIVE INGREDIENT and ATC code, and the equivalence is left
 * to the pharmacist's judgement. A brand field here would promise a catalogue
 * that does not exist and an equivalence nobody has validated. The checkbox
 * list of controlled medications is not that catalogue: it names active
 * ingredients with their ATC codes (domain/controlled-medications.ts) and only
 * saves typing the identity of a line; quantity and dosage stay on the card.
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

  // Read off the draft with the same predicate that decides whether each box
  // renders checked, so the count cannot disagree with the rows under it.
  const selectedCount = CONTROLLED_MEDICATIONS.filter((medication) =>
    isCatalogueItemSelected(draft, medication),
  ).length;

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

        <section className="card">
          <fieldset className="choice-list">
            <legend>
              <span className="title-section">Medicamentos controlados</span>
              {/* The count is the one piece of state the collapsed groups cannot
                  show at a glance, so it is stated in words rather than left to
                  be counted off the rows. */}
              <span className="badge badge--neutral">{selectionSummary(selectedCount)}</span>
            </legend>
            <p className="text-secondary">
              Marque uno o varios. Cada medicamento marcado se añade como ítem; complete cantidad y
              posología más abajo.
            </p>

            {/* Grouped by therapeutic family, in the order the catalogue
                declares (domain/controlled-medications.ts). Each group is a
                nested fieldset, so its legend names it for a screen reader
                exactly as the heading names it on screen. */}
            {groupedControlledMedications().map((group) => (
              <fieldset className="choice-group" key={group.family}>
                <legend>{group.family}</legend>

                <div className="choice-group__options">
                  {group.medications.map((medication) => {
                    const id = `controlled-${medication.id}`;
                    const noteId = `${id}-note`;
                    // The box is checked but clicking it will not clear it: the
                    // doctor has written on that line and `toggleCatalogueItem`
                    // refuses to delete their work. Saying so beside the control,
                    // tied to it by `aria-describedby`, is what keeps that refusal
                    // from reading as a broken checkbox — and the sentence carries
                    // the meaning on its own, without relying on colour.
                    const selected = isCatalogueItemSelected(draft, medication);
                    const locked = selected && hasDoctorEnteredWork(draft, medication);

                    return (
                      <div className="choice" key={medication.id}>
                        {/* The label is the row, so the whole card is the hit
                            area. The checked box inside it is the redundant,
                            non-colour signal of the selected state. */}
                        <label
                          className={`choice__option${selected ? ' choice__option--selected' : ''}`}
                          htmlFor={id}
                        >
                          <input
                            checked={selected}
                            className="choice__box"
                            id={id}
                            onChange={() => onDraftChange(toggleCatalogueItem(draft, medication))}
                            type="checkbox"
                            {...(locked ? { 'aria-describedby': noteId } : {})}
                          />
                          <span className="choice__text">
                            <span className="choice__name">{medication.activeIngredient}</span>
                            <span className="choice__presentation">
                              {medication.strength}, {medication.doseForm}
                            </span>
                          </span>{' '}
                          <span className="choice__atc">{medication.atcCode}</span>
                        </label>
                        {locked && (
                          <p className="field__hint choice__note" id={noteId}>
                            Este medicamento ya tiene cantidad y posología suyas. Para retirarlo, use
                            el botón «Quitar ítem» de su ficha.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </fieldset>
        </section>

        {draft.items.map((item, index) => (
          <section className="card" key={index}>
            <header className="card__header">
              <h2 className="title-section">Ítem {index + 1}</h2>
              {/* Never disabled, not even on the last item. The checkbox hint
                  above sends the doctor here when unchecking refuses to delete
                  their work, and with a single line that is exactly the state a
                  disabled button would leave without an exit. The "the list is
                  never empty" invariant lives in `removeItem`, which clears the
                  last line back to a blank one instead of emptying the list. */}
              <button
                className="btn btn--ghost"
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

/**
 * How many catalogue medications are currently checked, in words.
 *
 * Spelled out rather than rendered as a bare number so the badge reads as a
 * sentence, and so the zero case says something ("Ninguno seleccionado")
 * instead of showing a "0" the doctor has to interpret.
 */
function selectionSummary(count: number): string {
  if (count === 0) return 'Ninguno seleccionado';
  return count === 1 ? '1 seleccionado' : `${count} seleccionados`;
}

/** The form problems this screen owns. The rest belong to D2. */
function isMedicationIssue(issue: DraftIssue): boolean {
  return (
    issue.code === 'items-empty' ||
    issue.code === 'item-incomplete' ||
    issue.code === 'item-quantity-invalid'
  );
}
