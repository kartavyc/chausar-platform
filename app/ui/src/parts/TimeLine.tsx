/**
 * TimeLine: steps down the page, one row per step with its square, its date, one
 * sentence, and its cost in rupees at the right. The sentence was built by the sentences
 * module from a typed event; the engine sends no prose, and nothing here joins pieces.
 * A cost is a figure and opens its receipt. The control that opens a step and the cost's
 * own button sit side by side. Ordinary history appears at once: the staggered
 * appearance belongs to receipt rows only.
 */

import type { TimeEvent } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Square } from './Square';
import { Figure } from './Figure';
import s from './TimeLine.module.css';

export interface TimeLineProps {
  events: ReadonlyArray<TimeEvent>;
  onReceipt: (receiptId: string) => void;
  onOpen?: ((id: string) => void) | undefined;
  labelledBy?: string | undefined;
  className?: string | undefined;
}

export function TimeLine({ events, onReceipt, onOpen, labelledBy, className }: TimeLineProps) {
  const t = useT();
  return (
    <ol className={[s.line, className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      {events.map((ev) => {
        const main = (
          <>
            <Square mark={ev.mark} wordsKey={ev.state ? `STEPSTATE.${ev.state}` : undefined} />
            <span className={[s.date, 'fig'].join(' ')}>{ev.date}</span>
            <span className={s.sentence}>
              {ev.sentence}
              {ev.who !== undefined && <span className={s.who}>{t('TIMELINE.who', { name: ev.who })}</span>}
            </span>
          </>
        );
        return (
          <li key={ev.id} className={s.step}>
            {onOpen ? (
              <button type="button" className={s.button} onClick={() => onOpen(ev.id)}>
                {main}
              </button>
            ) : (
              <span className={s.button}>{main}</span>
            )}
            <span className={s.cost}>{ev.cost !== undefined && <Figure value={ev.cost} onReceipt={onReceipt} />}</span>
          </li>
        );
      })}
    </ol>
  );
}
