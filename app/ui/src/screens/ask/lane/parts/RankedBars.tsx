/**
 * RankedBars: a few values of one kind as horizontal bars, largest first. Every bar and every
 * figure opens its receipt. A missing value stays in the list as words, with no bar. Bar
 * lengths are geometry from the exact values (charts/scale.ts); nothing here is shown as a
 * number except the figure's own display.
 */
import type { ChartValue } from '../../../../app/presentation.ts';
import { isFigure } from '../../../../app/presentation.ts';
import { Figure } from '../../../../parts/Figure';
import { exactLinear, toExact } from '../../../../parts/charts/scale.ts';
import s from './RankedBars.module.css';

export interface RankedBarsProps {
  /** One sentence for screen readers that states what the bars show. */
  sentence: string;
  values: ReadonlyArray<ChartValue>;
  onReceipt: (receiptId: string) => void;
  className?: string | undefined;
}

function magnitude(v: ChartValue): bigint | null {
  if (!isFigure(v.value)) return null;
  const x = toExact(v.value.exact);
  return x === null ? null : x < 0n ? -x : x;
}

export function RankedBars({ sentence, values, onReceipt, className }: RankedBarsProps) {
  const ranked = values.map(v => ({ v, m: magnitude(v) }))
    .sort((a, b) => a.m === null ? (b.m === null ? 0 : 1) : b.m === null ? -1 : a.m > b.m ? -1 : a.m < b.m ? 1 : 0);
  const top = ranked[0]?.m ?? null;
  const width = top === null ? () => 0 : exactLinear(0n, top, 0, 100);
  return (
    <figure className={[s.bars, className].filter(Boolean).join(' ')} data-ranked-bars="">
      <figcaption className="sr">{sentence}</figcaption>
      <ul className={s.list}>
        {ranked.map(({ v, m }, i) => {
          const f = v.value;
          return (
            <li key={v.id} className={s.item}>
              <span className={s.label}>{v.label}</span>
              <span className={s.track}>
                {m !== null && isFigure(f) && (
                  <button type="button" tabIndex={-1} aria-hidden="true" className={[s.bar, i === 0 ? s.ink : ''].join(' ')}
                    style={{ width: `${Math.max(width(m), 0.5)}%` }} onClick={() => onReceipt(f.receiptId)} />
                )}
              </span>
              <Figure value={f} onReceipt={onReceipt} className={s.figure} />
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
