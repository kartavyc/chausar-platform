/**
 * Line with an end dot: a balance over days. The line is grey, 2 thick, and draws from
 * left to right once. The last point is a dot in ink with a ring in the ground colour.
 * Every point is a mark that opens its receipt. A missing day breaks the line, and a
 * known day with missing days on both sides is still drawn, as a small grey point, so a
 * known value never disappears into a gap.
 */

import type { LineChart } from '../../app/presentation.ts';
import { isFigure } from '../../app/presentation.ts';
import { exactExtent, exactLinear, linear, toExact } from './scale.ts';
import { Mark, MissingList, Target, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface LineProps {
  chart: LineChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const LABEL_H = 18;
const PAD = 6;

interface Point {
  x: number;
  y: number;
}

export function Line({ chart, onReceipt, width = 200, height = 48, className }: LineProps) {
  const n = Math.max(chart.values.length, 1);
  const exacts = chart.values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const domain = exactExtent(exacts);
  const y = domain ? exactLinear(domain.min, domain.max, height - PAD, PAD) : null;
  const x = linear(0, Math.max(n - 1, 1), PAD, width - PAD);
  const total = height + LABEL_H;

  /* A point is placed only for a known whole value. Anything else breaks the line. */
  const points: ReadonlyArray<Point | null> = exacts.map((exact, i) => (exact === null || y === null ? null : { x: x(i), y: y(exact) }));

  const runs: Point[][] = [];
  let run: Point[] = [];
  let last: Point | null = null;
  for (const point of points) {
    if (point === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(point);
    last = point;
  }
  if (run.length > 0) runs.push(run);

  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${total}`} width={width} height={total} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        {runs.map((r, k) => {
          const first = r[0];
          if (first === undefined) return null;
          if (r.length === 1) {
            return first === last ? null : <circle key={k} className={s.point} cx={first.x} cy={first.y} />;
          }
          const d = r.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
          return <path key={k} className={[s.line, 'm-draw'].join(' ')} d={d} pathLength={1} />;
        })}
        {last !== null && (
          <>
            <circle className={s.ring} cx={last.x} cy={last.y} data-halo="" />
            <circle className={s.dot} cx={last.x} cy={last.y} />
          </>
        )}
        {chart.values.map((v, i) => {
          if (!isFigure(v.value)) return null;
          /* A known value that cannot be placed keeps its mark on the baseline. */
          const point = points[i] ?? { x: x(i), y: height - PAD };
          return (
            <Mark key={v.id} label={v.label} display={v.value.display} spoken={v.value.spoken} receiptId={v.value.receiptId} onReceipt={onReceipt}>
              <Target cx={point.x} cy={point.y} />
            </Mark>
          );
        })}
        <text className={s.label} x={PAD} y={total - 4} textAnchor="start">
          {chart.from}
        </text>
        <text className={[s.label, s.labelInk].join(' ')} x={width - PAD} y={total - 4} textAnchor="end">
          {chart.to}
        </text>
      </svg>
      <MissingList values={chart.values} />
    </div>
  );
}
