/**
 * The three stages of writing a prescription (docs/17, D2, D3 and D5).
 *
 * The mockup draws four, splitting review from signature. They are one screen
 * here because they are one decision: D5 shows what is about to be signed and
 * carries the button that signs it, and a separate "revisión" step the doctor
 * passes through without deciding anything is a click, not a stage.
 *
 * Colour is never the only carrier of position (docs/17): the current stage is
 * named to assistive technology with `aria-current`, and every stage keeps its
 * number and its word.
 */

export type FlowStageId = 'patient' | 'medication' | 'review';

interface Stage {
  id: FlowStageId;
  label: string;
}

const STAGES: readonly Stage[] = [
  { id: 'patient', label: '1 · Paciente' },
  { id: 'medication', label: '2 · Medicación' },
  { id: 'review', label: '3 · Revisión y firma' },
] as const;

export interface FlowStepsProps {
  current: FlowStageId;
}

export function FlowSteps({ current }: FlowStepsProps) {
  const currentIndex = STAGES.findIndex((stage) => stage.id === current);

  return (
    <ol aria-label="Progreso de la receta" className="steps">
      {STAGES.map((stage, index) => (
        <li
          className={`steps__item ${stageModifier(index, currentIndex)}`}
          key={stage.id}
          {...(index === currentIndex ? { 'aria-current': 'step' as const } : {})}
        >
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

function stageModifier(index: number, currentIndex: number): string {
  if (index < currentIndex) return 'steps__item--done';
  return index === currentIndex ? 'steps__item--current' : '';
}
