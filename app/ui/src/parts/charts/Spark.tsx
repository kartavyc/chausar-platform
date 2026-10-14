/**
 * Spark: a fine line inside a row, beside the row's figure ("a trend beside a figure").
 * The line is a picture: it has its sentence for screen readers and no marks of its own,
 * so it adds no stops to the keyboard. The figure beside it is the control and opens the
 * receipt; a missing figure is its words. A missing point breaks the line. The line draws
 * once and ends in a small ink dot.
 */

import { isFigure } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { Figure } from '../Figure';
import type { SparkChart } from './types.ts';
import { exactExtent, exactLinear, linear, pathOf, runsOf, toExact } from './scale.ts';
import { emptyReason } from './marks';
import s from './charts.module.css';

export interface SparkProps {
  chart: SparkChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const PAD = 3;

export function Spark({ chart, onReceipt, width = 64, height = 16, className }: SparkProps) {
  const t = useT();
  const reason = emptyReason(chart.values);
  const n = Math.max(chart.values.length, 1);
  const exacts = chart.values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const domain = exactExtent(exacts);
  const y = domain ? exactLinear(domain.min, domain.max, height - PAD, PAD) : null;
  const x = linear(0, Math.max(n - 1, 1), PAD, width - PAD);
  const runs = runsOf(exacts.map((exact, i) => (exact === null || y === null ? null : { x: x(i), y: y(exact) })));
  const lastRun = runs[runs.length - 1];
  const last = lastRun === undefined ? null : (lastRun[lastRun.length - 1] ?? null);

  return (
    <span className={[s.sparkRow, className].filter(Boolean).join(' ')}>
      {reason !== null ? (
        <span className={s.unavailable}>{t(`CHART.unavailable.${reason}`)}</span>
      ) : (
        <svg className={s.svg} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={chart.sentence}>
          {runs.map((r, k) => {
            const first = r[0];
            if (first === undefined) return null;
            if (r.length === 1) return first === last ? null : <circle key={k} className={s.point} cx={first.x} cy={first.y} />;
            return <path key={k} className={[s.sparkLine, 'm-draw'].join(' ')} d={pathOf(r)} pathLength={1} />;
          })}
          {last !== null && <circle className={s.sparkDot} cx={last.x} cy={last.y} />}
        </svg>
      )}
      <Figure value={chart.figure} onReceipt={onReceipt} />
    </span>
  );
}
