/**
 * One bar in ordered greys: ages or stages of one whole, least severe first. The last
 * stage takes ink; the stages before it take the ordered greys. Every stage is a mark
 * that opens its receipt and carries a written label. Segment widths are geometry: the
 * whole is never shown.
 *
 * A width is drawn only for what is known and can be a part: a whole value of zero or
 * more. A known zero has no width and keeps its mark. A missing stage is a short dashed
 * gap with its words written under the bar; it is never a zero. When a value is below
 * zero or is not a whole number, or when every stage is zero, there are no shares to
 * draw: no width is invented, and the values are written out instead, each still
 * opening its receipt.
 */

import type { OrderedBarChart } from '../../app/presentation.ts';
import { isFigure } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { exactShares, toExact } from './scale.ts';
import { Mark, MissingList, Target, ValueList, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface OrderedBarProps {
  chart: OrderedBarChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  className?: string | undefined;
}

const BAR_H = 10;
const GAP = 2;
const LABEL_H = 18;
/** The drawn width of a missing stage. It marks the gap; it is not a share. */
const STUB = 12;

/** Shades from the last stage backwards: ink, then the ordered greys. With more than
 *  four stages the earliest ones share the lightest grey. */
const SHADES_FROM_LAST: ReadonlyArray<string> = ['r1', 'r2', 'r3', 'r4'];
/** The reference two-stage bar is the first grey (--r3, the same as --mute) then ink. */
const SHADES_TWO: ReadonlyArray<string> = ['r1', 'r3'];

function shadeOf(index: number, n: number): string {
  const fromLast = n - 1 - index;
  const shades = n === 2 ? SHADES_TWO : SHADES_FROM_LAST;
  return shades[Math.min(fromLast, shades.length - 1)] ?? 'r1';
}

export function OrderedBar({ chart, onReceipt, width = 200, className }: OrderedBarProps) {
  const t = useT();
  const n = chart.values.length;
  const exacts = chart.values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const undrawable = chart.values.some((v, i) => {
    const exact = exacts[i] ?? null;
    return isFigure(v.value) && (exact === null || exact < 0n);
  });
  const shares = undrawable ? null : exactShares(exacts);

  if (shares === null) {
    return (
      <div className={className} role="group" aria-label={chart.sentence}>
        {undrawable && <p className={s.unavailable}>{t('CHART.shares.unavailable')}</p>}
        <ValueList values={chart.values} onReceipt={onReceipt} />
      </div>
    );
  }

  const gaps = chart.values.filter((v) => !isFigure(v.value)).length;
  const usable = Math.max(width - GAP * Math.max(n - 1, 0) - STUB * gaps, 0);
  const total = BAR_H + LABEL_H;
  const mid = BAR_H / 2;

  let cursor = 0;
  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${total}`} width={width} height={total} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        {chart.values.map((v, i) => {
          const share = shares[i] ?? null;
          const w = share === null ? STUB : usable * share;
          const x0 = cursor;
          cursor += w + GAP;
          const shade = shadeOf(i, n);
          const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
          const lx = i === 0 ? 0 : i === n - 1 ? width : x0 + w / 2;
          if (!isFigure(v.value) || share === null) {
            return (
              <g key={v.id}>
                <line className={s.gap} x1={x0} x2={x0 + w} y1={mid} y2={mid} />
                <text className={s.label} x={lx} y={total - 4} textAnchor={anchor}>
                  {v.label}
                </text>
              </g>
            );
          }
          return (
            <Mark key={v.id} label={v.label} display={v.value.display} spoken={v.value.spoken} receiptId={v.value.receiptId} onReceipt={onReceipt}>
              {w > 0 && <rect className={[s.segment, s[shade], 'm-grow-across'].join(' ')} x={x0} y={0} width={w} height={BAR_H} />}
              <Target cx={x0 + w / 2} cy={mid} />
              <text className={[s.label, shade === 'r1' ? s.labelInk : ''].join(' ')} x={lx} y={total - 4} textAnchor={anchor}>
                {v.label}
              </text>
            </Mark>
          );
        })}
      </svg>
      <MissingList values={chart.values} />
    </div>
  );
}
