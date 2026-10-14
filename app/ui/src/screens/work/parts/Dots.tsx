/**
 * Dots: the five steps of an action as five small dots, for a row on the record of
 * actions (WK-05). Done is a filled grey dot, the step reached a small open square in
 * its mark's colour, later steps open grey dots. Each state is also in words for readers.
 */
import type { Step } from '../contract.ts';
import { fill } from '../kit/words.ts';
import type { WorkKey, WorkWords } from '../text.ts';
import s from '../work.module.css';

export interface DotsProps { steps: readonly Step[]; w: WorkWords }

export function Dots({ steps, w }: DotsProps) {
  const here = steps.findIndex(st => st.state !== 'done');
  const words = steps.map(st => fill(w.dot, { step: w[`step.${st.name}` as WorkKey], state: w[`ss.${st.state}` as WorkKey] })).join('; ');
  const reached = (st: Step) => (st.state === 'unsure' ? s.dotUnsure : st.state === 'waiting-for-you' ? s.dotYou : s.dotBusy);
  return (
    <span className={s.dots} role="img" aria-label={words}>
      {steps.map((st, i) => (
        <span key={st.name} aria-hidden="true" className={[s.dot, st.state === 'done' ? s.dotDone : i === here ? reached(st) : ''].filter(Boolean).join(' ')} />
      ))}
    </span>
  );
}
