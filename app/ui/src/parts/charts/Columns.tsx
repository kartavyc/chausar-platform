/**
 * Columns by month, the latest in ink: how a figure moved over time.
 * Bars grow from the baseline once when the chart opens. Every bar is a mark that opens
 * its receipt. A missing month is a gap with its words written under the chart.
 *
 * The bars share one zero baseline: a value above zero rises from it, a value below zero
 * hangs from it, and a known zero has no height at all. Positions are worked out from
 * the exact values (charts/scale.ts); nothing here is rounded before it is normalised.
 * Every bar carries a transparent 24 pixel target, so a zero and a narrow bar can be
 * pressed and focused like any other.
 */

import type { ColumnsChart } from '../../app/presentation.ts';
import { isFigure } from '../../app/presentation.ts';
import { BAR_MAX, BAR_RADIUS, HIT_RADIUS, exactExtent, exactLinear, includeZero, toExact } from './scale.ts';
import { useT } from '../../app/text';
import { Mark, MissingList, Target, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface ColumnsProps {
  chart: ColumnsChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const LABEL_H = 18;

export function Columns({ chart, onReceipt, width = 200, height = 48, className }: ColumnsProps) {
  const t = useT();
  const n = Math.max(chart.values.length, 1);
  const exacts = chart.values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const domain = includeZero(exactExtent(exacts) ?? { min: 0n, max: 0n });
  const y = exactLinear(domain.min, domain.max, height, 0);
  const y0 = y(0n);
  const slot = width / n;
  const barW = Math.min(BAR_MAX, slot * 0.6);
  const total = height + LABEL_H;
  /* The target sits on the baseline, held inside the plot. */
  const targetY = Math.min(Math.max(y0, HIT_RADIUS), Math.max(height - HIT_RADIUS, HIT_RADIUS));

  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${total}`} width={width} height={total} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        <line className={s.baseline} x1={0} x2={width} y1={y0} y2={y0} />
        {chart.values.map((v, i) => {
          const cx = slot * i + slot / 2;
          const exact = exacts[i] ?? null;
          const latest = i === chart.values.length - 1;
          const ink = v.emphasis ?? latest;
          const labelEl = (
            <text className={[s.label, ink ? s.labelInk : ''].join(' ')} x={cx} y={total - 4} textAnchor="middle">
              {v.label}
            </text>
          );
          if (!isFigure(v.value)) {
            return (
              <g key={v.id}>
                {v.outline ? (
                  <rect className={s.outline} x={cx - barW / 2} y={0} width={barW} height={height} rx={BAR_RADIUS} />
                ) : (
                  <line className={s.gap} x1={cx - barW / 2} x2={cx + barW / 2} y1={y0} y2={y0} />
                )}
                {labelEl}
              </g>
            );
          }
          /* A known value that is not a whole number cannot be placed. It is still a
             mark with its written amount; it is never drawn as a zero. */
          const yv = exact === null ? null : y(exact);
          const below = yv !== null && yv > y0;
          const bar = yv !== null && (
            <rect
              className={[s.bar, ink ? s.ink : s.dim, 'm-grow'].join(' ')}
              style={{ transformOrigin: below ? 'center top' : 'center bottom' }}
              x={cx - barW / 2}
              y={Math.min(yv, y0)}
              width={barW}
              height={Math.abs(yv - y0)}
              rx={BAR_RADIUS}
            />
          );
          /* Told by the owner: no receipt to open, so the bar is not a button. */
          if (v.value.told) {
            const words = t('CHART.told', { label: v.label, amount: v.value.display });
            return (
              <g key={v.id} role="img" aria-label={words} data-told="">
                <title>{words}</title>
                {bar}
                {labelEl}
              </g>
            );
          }
          return (
            <Mark key={v.id} label={v.label} display={v.value.display} spoken={v.value.spoken} receiptId={v.value.receiptId} onReceipt={onReceipt}>
              {bar}
              <Target cx={cx} cy={targetY} />
              {labelEl}
            </Mark>
          );
        })}
      </svg>
      <MissingList values={chart.values} />
    </div>
  );
}
