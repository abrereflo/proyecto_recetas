import type { CheckId, CheckResult, CheckState } from '../../domain/verification';

/**
 * The five checks of P3, as five named sentences.
 *
 * HARD RULE (docs/17, P3): "Cinco comprobaciones, cinco líneas." A spinner —
 * or five unlabelled ticks — hides which of five independent verifications
 * failed, which is precisely what the pharmacist needs to know in order to act.
 *
 * HARD RULE (docs/17, accessibility): colour is never the only signal. Every
 * row carries a mark, a sentence and a screen-reader state word, so the list is
 * readable in greyscale and by a screen reader.
 */

/** One sentence per check, in the language of the counter. */
export const CHECK_LABELS: Record<CheckId, string> = {
  registered: 'Registrada en la cadena',
  'not-dispensed': 'No dispensada y dentro de vigencia',
  integrity: 'Integridad del contenido',
  'prescriber-signature': 'Firma del prescriptor',
  'patient-commitment': 'Correspondencia con el paciente',
};

/** Spoken state, so the row never depends on the colour of its rule. */
const STATE_LABELS: Record<CheckState, string> = {
  pending: 'pendiente',
  passed: 'comprobado',
  failed: 'no superado',
  skipped: 'sin comprobar',
};

const STATE_MARKS: Record<CheckState, string> = {
  pending: '○',
  passed: '✓',
  failed: '✗',
  skipped: '—',
};

export interface CheckListProps {
  checks: CheckResult[];
  /**
   * The row the verification is working on right now. Only meaningful while
   * the answer has not arrived; once it has, every row has its own state.
   */
  currentId?: CheckId | undefined;
}

function itemClassName(check: CheckResult, currentId: CheckId | undefined): string {
  if (check.state === 'passed' || check.state === 'failed') return 'steps__item steps__item--done';
  if (check.id === currentId && check.state === 'pending') return 'steps__item steps__item--current';
  return 'steps__item';
}

export function CheckList({ checks, currentId }: CheckListProps) {
  return (
    <ol className="steps steps--vertical">
      {checks.map((check) => (
        <li className={itemClassName(check, currentId)} key={check.id}>
          <span aria-hidden="true">{STATE_MARKS[check.state]}</span>
          <span>{CHECK_LABELS[check.id]}</span>
          <span className="sr-only">: {STATE_LABELS[check.state]}</span>
        </li>
      ))}
    </ol>
  );
}

/** The first row still waiting for an answer, or `undefined` when none is. */
export function firstPendingCheck(checks: CheckResult[]): CheckId | undefined {
  return checks.find((check) => check.state === 'pending')?.id;
}
