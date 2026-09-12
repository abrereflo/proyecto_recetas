import { ISSUE_STEPS, type IssueStepId } from '../../domain/issuance';
import { FlowSteps } from '../components/FlowSteps';
import { ScreenShell } from '../components/ScreenShell';

/**
 * Between D5 and D6: the issuing pipeline, step by step.
 *
 * Not a spinner, for the same reason the pharmacy's P3 is not one (docs/17):
 * the doctor is waiting on a sequence with a correctness property attached to
 * its ORDER — the document is stored off-chain BEFORE it is anchored — and when
 * something fails, which step it failed on is the difference between "nothing
 * happened, try again" and "check before you hand anything to the patient". A
 * spinner erases exactly that.
 *
 * The steps and their Spanish labels come from `ISSUE_STEPS`, which is the same
 * order the pipeline executes. A second list written here would be free to
 * disagree with it.
 */

export interface IssuingScreenProps {
  /** The steps the pipeline has reported completed, in order. */
  completed: readonly IssueStepId[];
}

export function IssuingScreen({ completed }: IssuingScreenProps) {
  const done = new Set(completed);
  const current = ISSUE_STEPS.find((step) => !done.has(step.id));

  return (
    <ScreenShell status={<span className="badge badge--info">Emitiendo</span>}>
      <div className="stack stack--loose">
        <FlowSteps current="review" />

        <div className="stack stack--tight">
          <h1 className="title-screen">Emitiendo la receta</h1>
          <p className="text-secondary">
            No cierre esta pestaña. Acepte la solicitud de firma cuando el equipo se la pida.
          </p>
        </div>

        <ol aria-live="polite" className="steps steps--vertical">
          {ISSUE_STEPS.map((step) => (
            <li
              className={`steps__item ${stepModifier(done.has(step.id), step.id === current?.id)}`}
              key={step.id}
            >
              <span aria-hidden="true">{done.has(step.id) ? '✓' : '·'}</span>
              {step.label}
              {done.has(step.id) && <span className="sr-only"> (completado)</span>}
            </li>
          ))}
        </ol>
      </div>
    </ScreenShell>
  );
}

function stepModifier(isDone: boolean, isCurrent: boolean): string {
  if (isDone) return 'steps__item--done';
  return isCurrent ? 'steps__item--current' : '';
}
