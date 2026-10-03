/**
 * Strip: small squares in a row. On the desktop, twelve months of a source (loaded,
 * loading, not loaded yet, refused). In the CA console, the four steps of the month's
 * close (bank, GST, TDS, trial balance). The squares are hidden from screen readers; the
 * words for each cell are read instead.
 */

import { useT } from '../app/text';
import s from './Strip.module.css';

export type StripState = 'done' | 'loading' | 'not-done' | 'refused';

export interface StripCell {
  state: StripState;
  /** What this cell is: a month or a step, already localised. */
  label: string;
}

export interface StripProps {
  cells: ReadonlyArray<StripCell>;
  /** Squares only, for a legend whose words are written beside it. */
  bare?: boolean | undefined;
  className?: string | undefined;
}

const WORDS: Readonly<Record<StripState, string>> = {
  done: 'STRIP.done',
  loading: 'STRIP.loading',
  'not-done': 'STRIP.not-done',
  refused: 'STRIP.refused',
};

export function Strip({ cells, bare = false, className }: StripProps) {
  const t = useT();
  return (
    <span className={[s.strip, className].filter(Boolean).join(' ')}>
      <span className={s.cells} aria-hidden="true">
        {cells.map((c, i) => (
          <span key={i} className={[s.cell, s[c.state]].join(' ')} />
        ))}
      </span>
      {!bare && (
        <span className="sr">
          {cells.map((c, i) => (
            <span key={i}>{t('STRIP.cell', { label: c.label, state: t(WORDS[c.state]) })} </span>
          ))}
        </span>
      )}
    </span>
  );
}
