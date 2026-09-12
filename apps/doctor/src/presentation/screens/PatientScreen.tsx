import { useState } from 'react';
import { CONTEXT_DISCLAIMER_ES } from '@recetas/rules';
import {
  MAX_VALIDITY_DAYS,
  expiresAtMidnight,
  validateDraft,
  type DraftIssueCode,
  type PrescriptionDraft,
} from '../../domain/draft';
import { Field } from '../components/Field';
import { FlowSteps } from '../components/FlowSteps';
import { ScreenShell } from '../components/ScreenShell';
import { editDraft } from '../draft-editing';
import { formatDay, joinDeclaredList, splitDeclaredList } from '../format';

/**
 * D2 — Paciente y contexto clínico.
 *
 * HARD RULE (D-25, docs/06, docs/17 D2): "Aviso obligatorio: el motor solo
 * evalúa lo que se escriba aquí." The engine has no history to cross-check
 * against and never will, by design (docs/03). `CONTEXT_DISCLAIMER_ES` is
 * therefore rendered inside the context card itself, as an alert the doctor
 * cannot scroll past on the way to the field it is about — not as a footnote.
 * Silence from the engine means "you did not tell me", never "there is no
 * risk", and a doctor who is not told that will read it the other way.
 *
 * HARD RULE (D-13, docs/17): validity is whole days and expiry lands at
 * midnight, so the preview below shows a DATE WITHOUT A TIME.
 *
 * The field errors come from `validateDraft` and its Spanish catalogue, never
 * from a second copy of the rules living in this screen.
 */

/** The form problems this screen owns. The item codes belong to D3. */
const PATIENT_ISSUE_CODES: readonly DraftIssueCode[] = [
  'patient-id-missing',
  'patient-name-missing',
  'patient-birth-date-missing',
  'practitioner-license-missing',
  'practitioner-name-missing',
  'validity-days-invalid',
];

export interface PatientScreenProps {
  draft: PrescriptionDraft;
  onDraftChange(draft: PrescriptionDraft): void;
  onContinue(): void;
  onOpenPrescriptions(): void;
  /** The issuing instant, injected so the expiry preview is testable (D-13). */
  now?: Date;
}

export function PatientScreen({
  draft,
  onDraftChange,
  onContinue,
  onOpenPrescriptions,
  now = new Date(),
}: PatientScreenProps) {
  const [submitted, setSubmitted] = useState(false);

  /**
   * The two free-text context fields keep their RAW text locally.
   *
   * The draft stores the parsed list, because that is what `evaluate` reads.
   * Rendering the control from a re-joined list instead would round-trip every
   * keystroke through `split`/`join`, and the doctor could never type the space
   * after a comma: it is trimmed away before it reaches the input again. The
   * parsed list and the text the doctor is typing are two different values, and
   * this is the field that has to hold both.
   */
  const [allergiesText, setAllergiesText] = useState(() =>
    joinDeclaredList(draft.patientContext.declaredAllergies),
  );
  const [medicationText, setMedicationText] = useState(() =>
    joinDeclaredList(draft.patientContext.concomitantMedication),
  );

  const issues = validateDraft(draft).filter((issue) => PATIENT_ISSUE_CODES.includes(issue.code));
  const problem = (code: DraftIssueCode): string | undefined =>
    submitted ? issues.find((issue) => issue.code === code)?.message : undefined;

  const submit = (): void => {
    setSubmitted(true);
    // Form validation, never clinical validation: this screen has not evaluated
    // a single rule, and no alert could reach this branch (docs/06).
    if (issues.length === 0) onContinue();
  };

  return (
    <ScreenShell status={<span className="badge badge--info">Receta en borrador</span>}>
      <div className="stack stack--loose">
        <FlowSteps current="patient" />

        <div className="stack stack--tight">
          <h1 className="title-screen">Paciente y contexto clínico</h1>
          <p className="text-secondary">
            Estos datos viajan cifrados dentro de la receta. A la cadena solo llega un compromiso
            criptográfico que no permite deducir quién es el paciente.
          </p>
        </div>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Datos del paciente</h2>
          </header>

          <div className="stack">
            <div className="grid-2">
              <Field
                error={problem('patient-id-missing')}
                hint="No se publica. Solo viaja su compromiso criptográfico."
                id="patient-id"
                label="Documento de identidad"
                required
              >
                {(props) => (
                  <input
                    {...props}
                    onChange={(event) =>
                      onDraftChange(
                        editDraft(draft, {
                          patient: { ...draft.patient, patientId: event.target.value },
                        }),
                      )
                    }
                    value={draft.patient.patientId}
                  />
                )}
              </Field>

              <Field
                error={problem('patient-name-missing')}
                id="patient-name"
                label="Nombre completo"
                required
              >
                {(props) => (
                  <input
                    {...props}
                    onChange={(event) =>
                      onDraftChange(
                        editDraft(draft, {
                          patient: { ...draft.patient, fullName: event.target.value },
                        }),
                      )
                    }
                    value={draft.patient.fullName}
                  />
                )}
              </Field>

              <Field
                error={problem('patient-birth-date-missing')}
                id="patient-birth-date"
                label="Fecha de nacimiento"
                required
              >
                {(props) => (
                  <input
                    {...props}
                    onChange={(event) =>
                      onDraftChange(
                        editDraft(draft, {
                          patient: { ...draft.patient, birthDate: event.target.value },
                        }),
                      )
                    }
                    type="date"
                    value={draft.patient.birthDate}
                  />
                )}
              </Field>

              <Field
                error={problem('validity-days-invalid')}
                hint={validityHint(draft, now)}
                id="validity-days"
                label={`Vigencia en días (máximo ${MAX_VALIDITY_DAYS})`}
              >
                {(props) => (
                  <input
                    {...props}
                    inputMode="numeric"
                    onChange={(event) =>
                      onDraftChange(
                        editDraft(draft, { validityDays: Number(event.target.value) }),
                      )
                    }
                    type="number"
                    value={Number.isNaN(draft.validityDays) ? '' : draft.validityDays}
                  />
                )}
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Prescriptor</h2>
          </header>

          <div className="grid-2">
            <Field
              error={problem('practitioner-name-missing')}
              id="practitioner-name"
              label="Nombre completo del prescriptor"
              required
            >
              {(props) => (
                <input
                  {...props}
                  onChange={(event) =>
                    onDraftChange(
                      editDraft(draft, {
                        practitioner: { ...draft.practitioner, fullName: event.target.value },
                      }),
                    )
                  }
                  value={draft.practitioner.fullName}
                />
              )}
            </Field>

            <Field
              error={problem('practitioner-license-missing')}
              id="practitioner-license"
              label="Matrícula profesional"
              required
            >
              {(props) => (
                <input
                  {...props}
                  onChange={(event) =>
                    onDraftChange(
                      editDraft(draft, {
                        practitioner: {
                          ...draft.practitioner,
                          licenseNumber: event.target.value,
                        },
                      }),
                    )
                  }
                  value={draft.practitioner.licenseNumber}
                />
              )}
            </Field>
          </div>
        </section>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Contexto clínico declarado</h2>
            <span className="badge badge--neutral">Se evalúa en este equipo</span>
          </header>

          <div className="stack">
            {/* D-25: the mandatory notice, inside the card it is about. */}
            <div className="alert alert--warning" role="alert">
              <span aria-hidden="true" className="alert__icon">
                ⚠
              </span>
              <div>
                <p className="alert__title">Lo que no se declare aquí, no se detecta</p>
                <p className="alert__body">{CONTEXT_DISCLAIMER_ES}</p>
              </div>
            </div>

            <Field
              hint="Separe cada una con una coma."
              id="declared-allergies"
              label="Alergias declaradas"
            >
              {(props) => (
                <input
                  {...props}
                  onChange={(event) => {
                    setAllergiesText(event.target.value);
                    onDraftChange(
                      editDraft(draft, {
                        patientContext: {
                          ...draft.patientContext,
                          declaredAllergies: splitDeclaredList(event.target.value),
                        },
                      }),
                    );
                  }}
                  value={allergiesText}
                />
              )}
            </Field>

            <Field
              hint="Separe cada una con una coma."
              id="concomitant-medication"
              label="Medicación concomitante"
            >
              {(props) => (
                <input
                  {...props}
                  onChange={(event) => {
                    setMedicationText(event.target.value);
                    onDraftChange(
                      editDraft(draft, {
                        patientContext: {
                          ...draft.patientContext,
                          concomitantMedication: splitDeclaredList(event.target.value),
                        },
                      }),
                    );
                  }}
                  value={medicationText}
                />
              )}
            </Field>
          </div>
        </section>

        <div className="row row--between">
          <button className="btn btn--ghost" onClick={onOpenPrescriptions} type="button">
            Ver mis recetas
          </button>
          <button className="btn btn--primary" onClick={submit} type="button">
            Continuar a medicación
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}

/** "30 días — caduca el 11/10/2026". A day, never an instant (D-13). */
function validityHint(draft: PrescriptionDraft, now: Date): string {
  try {
    return `Caduca a medianoche del ${formatDay(expiresAtMidnight(now, draft.validityDays))}.`;
  } catch {
    // `expiresAtMidnight` refuses a window outside [1, MAX_VALIDITY_DAYS]; the
    // field error below already says what to do about it.
    return 'Indique un número entero de días para ver la fecha de caducidad.';
  }
}
