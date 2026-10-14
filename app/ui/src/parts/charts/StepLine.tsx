/**
 * A step line: what was believed over time (history). Each step holds its value until
 * the next step, then the line rises or falls to it. The line is grey, 2 thick, and draws
 * once from left to right; the latest known step is ink. A missing step breaks the line
 * and is a short dashed gap on the floor with its words under the chart, never a zero.
 * Every known step is a mark that opens its receipt.
 */

import { isFigure } from '../../app/presentation.ts';
import type { StepLineChart } from './types.ts';
import { exactExtent, exactLinear, pathOf, slotEdges, stepRuns, toExact } from './scale.ts';
import { Mark, MissingList, NoChart, Target, emptyReason, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface StepLineProps {
  chart: StepLineChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const LABEL_H = 18;
const PAD = 6;

export function StepLine({ chart, onReceipt, width = 240, height = 48, className }: StepLineProps) {
  const reason = emptyReason(chart.values);
  if (reason !== null) return <NoChart reason={reason} sentence={chart.sentence} values={chart.values} className={className} />;

  const n = chart.values.length;
  const exacts = chart.values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const domain = exactExtent(exacts);
  const y = domain ? exactLinear(domain.min, domain.max, height - PAD, PAD) : null;
  const edges = slotEdges(n, PAD, width - PAD);
  const levels = exacts.map((exact) => (exact === null || y === null ? null : y(exact)));
  const runs = stepRuns(levels, edges);
  const latest = levels.reduce<number>((found, level, i) => (level === null ? found : i), -1);
  const boxH = height + LABEL_H;
  const floor = height - PAD;

  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${boxH}`} width={width} height={boxH} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        {runs.map((r) => (
          <path key={r.first} className={[s.line, 'm-draw'].join(' ')} d={pathOf(r.points)} pathLength={1} />
        ))}
        {latest >= 0 && (
          <line className={s.lineInk} x1={edges[latest] ?? PAD} x2={edges[latest + 1] ?? width - PAD} y1={levels[latest] ?? floor} y2={levels[latest] ?? floor} />
        )}
        {chart.values.map((v, i) => {
          const left = edges[i] ?? PAD;
          const right = edges[i + 1] ?? width - PAD;
          if (!isFigure(v.value)) {
            return <line key={v.id} className={s.gap} x1={left} x2={right} y1={floor} y2={floor} />;
          }
          /* A known value that cannot be placed keeps its mark on the floor. */
          const level = levels[i] ?? floor;
          return (
            <Mark key={v.id} label={v.label} display={v.value.display} spoken={v.value.spoken} receiptId={v.value.receiptId} onReceipt={onReceipt}>
              <Target cx={(left + right) / 2} cy={level} />
            </Mark>
          );
        })}
        <text className={s.label} x={PAD} y={boxH - 4} textAnchor="start">
          {chart.from}
        </text>
        <text className={[s.label, s.labelInk].join(' ')} x={width - PAD} y={boxH - 4} textAnchor="end">
          {chart.to}
        </text>
      </svg>
      <MissingList values={chart.values} />
    </div>
  );
}
