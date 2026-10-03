/**
 * DayLine: a time line across the page for one day. Up to six marks on a hairline, each
 * with its time, two words, and a small note or figure. Older marks fold into the first
 * one. A mark's figure is a figure like any other: it opens its own receipt, from its own
 * button. The last mark's words open the full activity list when that is supplied; that
 * control and the figure's button sit one after the other, never one inside the other.
 */

import type { DayEvent } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Square } from './Square';
import { Figure } from './Figure';
import s from './DayLine.module.css';

export const DAYLINE_MAX = 6;

export interface DayLineProps {
  events: ReadonlyArray<DayEvent>;
  onReceipt: (receiptId: string) => void;
  /** Opens the full activity list. */
  onOpenAll?: (() => void) | undefined;
  labelledBy?: string | undefined;
  className?: string | undefined;
}

export function DayLine({ events, onReceipt, onOpenAll, labelledBy, className }: DayLineProps) {
  const t = useT();
  const shown = events.slice(0, DAYLINE_MAX);
  return (
    <ol className={[s.line, className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      {shown.map((ev, i) => {
        const body = (
          <>
            <span className={s.markRow}>
              <Square mark={ev.mark} />
            </span>
            <span className={[s.time, 'fig'].join(' ')}>{ev.time}</span>
            <span className={s.words}>{ev.words}</span>
          </>
        );
        return (
          <li key={ev.id} className={s.mark}>
            {onOpenAll && i === shown.length - 1 ? (
              <button type="button" className={s.button} onClick={onOpenAll}>
                {body}
              </button>
            ) : (
              <span className={s.static}>{body}</span>
            )}
            {ev.note !== undefined && <span className={s.note}>{ev.note}</span>}
            {ev.figure !== undefined && <Figure value={ev.figure} onReceipt={onReceipt} className={s.figure} />}
            {i === 0 && ev.folded !== undefined && <span className={s.folded}>{t('TD-01.folded', { count: ev.folded.display })}</span>}
          </li>
        );
      })}
    </ol>
  );
}
