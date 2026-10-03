/**
 * Steps: dots on a line with the walking square. Five for an action (Prepared, Approve,
 * Send, Read back, Recorded), six for first run. The step reached carries an open green
 * square; finished steps are filled grey dots; later ones are open grey dots. The square
 * moves to the next step once, over 240 ms. The state is also written under each step.
 *
 * The step reached is the first one that is not done. When every step is done the action
 * is finished: the square rests on the last step, filled, and that step's words say so.
 * It never falls back to the first step.
 */

import type { CSSProperties } from 'react';
import type { Mark, StepItem } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Square } from './Square';
import s from './Steps.module.css';

export interface StepsProps {
  steps: ReadonlyArray<StepItem>;
  className?: string | undefined;
}

const STATE_KEY = (state: StepItem['state']) => `STEPSTATE.${state}`;

export function Steps({ steps, className }: StepsProps) {
  const t = useT();
  const n = Math.max(steps.length, 2);
  const firstOpen = steps.findIndex((st) => st.state !== 'done');
  const complete = steps.length > 0 && firstOpen === -1;
  const i = complete ? steps.length - 1 : Math.max(firstOpen, 0);
  const style = { '--n': String(n), '--i': String(i) } as CSSProperties;
  const walkingMark: Mark = complete ? 'cha' : steps[i]?.state === 'unsure' ? 'unsure' : 'busy';

  return (
    <ol className={[s.steps, className].filter(Boolean).join(' ')} style={style}>
      <span className={[s.walker, 'm-step'].join(' ')} aria-hidden="true">
        <Square mark={walkingMark} />
      </span>
      {steps.map((step, k) => {
        const done = k < i;
        const here = k === i;
        return (
          <li key={step.nameKey} className={[s.step, done ? s.done : '', here ? s.here : ''].filter(Boolean).join(' ')} aria-current={here && !complete ? 'step' : undefined}>
            <span className={s.dot} aria-hidden="true" />
            <span className={s.name}>{t(step.nameKey)}</span>
            <span className={here ? s.state : 'sr'}>{t(STATE_KEY(step.state))}</span>
            {step.at !== undefined && <span className={[s.at, 'fig'].join(' ')}>{step.at}</span>}
          </li>
        );
      })}
    </ol>
  );
}
