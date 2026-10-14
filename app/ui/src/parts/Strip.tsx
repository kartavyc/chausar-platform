/**
 * Strip: small squares in a row. On the desktop, twelve months of a source (loaded,
 * loading, not loaded yet, refused, failed). In the CA console, the four steps of the
 * month's close (bank, GST, TDS, trial balance). The squares are hidden from screen
 * readers; the words for each cell are read instead.
 *
 * A failed read is an amber ring: the read failed, which is not the same as a file
 * refused (filled amber).
 *
 * As a chart (with `onReceipt`), every square stands in a 24 pixel slot, and a loaded
 * month that carries a receipt id is a button that opens its receipt. The arrow keys move
 * from one such month to the next. A strip of no cells says so in words. Without
 * `onReceipt` the strip is as it always was.
 */

import { useT } from '../app/text';
import { NoChart, moveAmongMarks } from './charts/marks';
import s from './Strip.module.css';

export type StripState = 'done' | 'loading' | 'not-done' | 'refused' | 'failed';

export interface StripCell {
  state: StripState;
  /** What this cell is: a month or a step, already localised. */
  label: string;
  /** The receipt of a loaded month. Opened only when the strip has `onReceipt`. */
  receiptId?: string | undefined;
}

export interface StripProps {
  cells: ReadonlyArray<StripCell>;
  /** Squares only, for a legend whose words are written beside it. */
  bare?: boolean | undefined;
  /** One sentence for screen readers that states what the strip shows. */
  sentence?: string | undefined;
  /** Opens a loaded month's receipt. With it, the strip is a chart of buttons. */
  onReceipt?: ((receiptId: string) => void) | undefined;
  className?: string | undefined;
}

const WORDS: Readonly<Record<StripState, string>> = {
  done: 'STRIP.done',
  loading: 'STRIP.loading',
  'not-done': 'STRIP.not-done',
  refused: 'STRIP.refused',
  failed: 'CHART.strip.failed',
};

export function Strip({ cells, bare = false, sentence, onReceipt, className }: StripProps) {
  const t = useT();
  if (onReceipt !== undefined && !bare) {
    if (cells.length === 0) return <NoChart reason="CHART_HAS_NO_POINTS" sentence={sentence ?? ''} className={className} />;
    return (
      <span className={[s.strip, className].filter(Boolean).join(' ')} role="group" aria-label={sentence} onKeyDown={moveAmongMarks}>
        <span className={s.slots}>
          {cells.map((c, i) => {
            const square = <span className={[s.cell, s[c.state]].join(' ')} aria-hidden="true" />;
            const state = t(WORDS[c.state]);
            const receiptId = c.receiptId;
            if (c.state === 'done' && receiptId !== undefined && receiptId.length > 0) {
              return (
                <button
                  key={i}
                  type="button"
                  className={[s.slot, s.open].join(' ')}
                  data-mark=""
                  aria-label={t('CHART.strip.open', { label: c.label, state })}
                  title={t('STRIP.cell', { label: c.label, state })}
                  onClick={() => onReceipt(receiptId)}
                >
                  {square}
                </button>
              );
            }
            return (
              <span key={i} className={s.slot}>
                {square}
                <span className="sr">{t('STRIP.cell', { label: c.label, state })}</span>
              </span>
            );
          })}
        </span>
      </span>
    );
  }
  return (
    <span className={[s.strip, className].filter(Boolean).join(' ')} role={sentence === undefined ? undefined : 'group'} aria-label={sentence}>
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
