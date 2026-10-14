/**
 * A line against a goal rule: a job's progress to its goal. The line is grey, 2 thick,
 * draws once from left to right and ends in an ink dot with a ring. The goal is a dashed
 * horizontal rule on the same scale, with its label and written value beside it; the
 * goal opens its own receipt like every point. A missing day breaks the line; a missing
 * goal draws no rule and writes its words under the chart. Nothing here works out how
 * far the line is from the goal.
 */

import { isFigure } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import type { GoalLineChart } from './types.ts';
import { HIT_RADIUS, exactExtent, exactLinear, linear, pathOf, runsOf, toExact } from './scale.ts';
import { Mark, MissingList, NoChart, Target, emptyReason, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface GoalLineProps {
  chart: GoalLineChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const LABEL_H = 18;
/** Room above the plot for the goal's label when the goal is the highest value. */
const TOP = 16;
const PAD = 6;

export function GoalLine({ chart, onReceipt, width = 240, height = 56, className }: GoalLineProps) {
  const t = useT();
  const reason = emptyReason(chart.values);
  if (reason !== null) return <NoChart reason={reason} sentence={chart.sentence} values={[...chart.values, chart.goal]} className={className} />;

  const n = Math.max(chart.values.length, 1);
  const exacts = chart.values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const goal = chart.goal;
  const goalExact = isFigure(goal.value) ? toExact(goal.value.exact) : null;
  const domain = exactExtent([...exacts, goalExact]);
  const y = domain ? exactLinear(domain.min, domain.max, TOP + height - PAD, TOP + PAD) : null;
  const x = linear(0, Math.max(n - 1, 1), PAD, width - PAD);
  const boxH = TOP + height + LABEL_H;
  const floor = TOP + height - PAD;

  const points = exacts.map((exact, i) => (exact === null || y === null ? null : { x: x(i), y: y(exact) }));
  const runs = runsOf(points);
  const lastRun = runs[runs.length - 1];
  const last = lastRun === undefined ? null : (lastRun[lastRun.length - 1] ?? null);
  const gy = goalExact === null || y === null ? null : y(goalExact);

  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${boxH}`} width={width} height={boxH} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        {runs.map((r, k) => {
          const first = r[0];
          if (first === undefined) return null;
          if (r.length === 1) return first === last ? null : <circle key={k} className={s.point} cx={first.x} cy={first.y} />;
          return <path key={k} className={[s.line, 'm-draw'].join(' ')} d={pathOf(r)} pathLength={1} />;
        })}
        {last !== null && (
          <>
            <circle className={s.ring} cx={last.x} cy={last.y} />
            <circle className={s.dot} cx={last.x} cy={last.y} />
          </>
        )}
        {chart.values.map((v, i) => {
          if (!isFigure(v.value)) return null;
          const point = points[i] ?? { x: x(i), y: floor };
          return (
            <Mark key={v.id} label={v.label} display={v.value.display} spoken={v.value.spoken} receiptId={v.value.receiptId} onReceipt={onReceipt}>
              <Target cx={point.x} cy={point.y} />
            </Mark>
          );
        })}
        {isFigure(goal.value) && (
          <Mark key={goal.id} label={goal.label} display={goal.value.display} spoken={goal.value.spoken} receiptId={goal.value.receiptId} onReceipt={onReceipt}>
            {gy !== null && <line className={s.rule} x1={PAD} x2={width - PAD} y1={gy} y2={gy} />}
            <text className={s.ruleLabel} x={width - PAD} y={(gy ?? floor) - 4} textAnchor="end">
              {t('CHART.goalLine.rule', { label: goal.label, amount: goal.value.display })}
            </text>
            <Target cx={width - PAD - HIT_RADIUS} cy={gy ?? floor} />
          </Mark>
        )}
        <text className={s.label} x={PAD} y={boxH - 4} textAnchor="start">
          {chart.from}
        </text>
        <text className={[s.label, s.labelInk].join(' ')} x={width - PAD} y={boxH - 4} textAnchor="end">
          {chart.to}
        </text>
      </svg>
      <MissingList values={[...chart.values, goal]} />
    </div>
  );
}
