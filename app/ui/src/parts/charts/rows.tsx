/**
 * Bars inside rows, shared by RankedBars and PairBars: a written label at the left, a
 * thin bar from one shared zero, and the written value at the right. Every known value is
 * a mark that opens its receipt; a missing value writes its words where the value would
 * be and draws only a short dashed gap at zero. The rows keep the order they were given.
 */

import type { ChartValue } from '../../app/presentation.ts';
import { isFigure, missingOf } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { MISSING_WORDS } from '../Figure';
import { BAR_RADIUS, exactExtent, exactLinear, includeZero, pixelSpan, toExact } from './scale.ts';
import { Mark, Target, moveAmongMarks } from './marks';
import s from './charts.module.css';

/** The fill of one row's bar: ink for the thing the chart is about, a grey otherwise. */
export type RowShade = 'ink' | 'r3' | 'dim';

export interface BarRowsProps {
  sentence: string;
  values: ReadonlyArray<ChartValue>;
  shadeOf: (value: ChartValue, index: number) => RowShade;
  onReceipt: (receiptId: string) => void;
  width: number;
}

const ROW_H = 28;
const BAR_H = 10;
const GAP = 8;
/** Half the drawn width of a missing row's gap. It marks the gap; it is not a value. */
const STUB = 6;

export function BarRows({ sentence, values, shadeOf, onReceipt, width }: BarRowsProps) {
  const t = useT();
  const exacts = values.map((v) => (isFigure(v.value) ? toExact(v.value.exact) : null));
  const domain = includeZero(exactExtent(exacts) ?? { min: 0n, max: 0n });
  const labelW = width * 0.3;
  const valueW = width * 0.24;
  const x = exactLinear(domain.min, domain.max, labelW + GAP, width - valueW - GAP);
  const zero = x(0n);
  const plotH = ROW_H * Math.max(values.length, 1);

  return (
    <svg className={s.svg} viewBox={`0 0 ${width} ${plotH}`} width={width} height={plotH} role="group" aria-label={sentence} onKeyDown={moveAmongMarks}>
      <line className={s.baseline} x1={zero} x2={zero} y1={0} y2={plotH} />
      {values.map((v, i) => {
        const mid = ROW_H * i + ROW_H / 2;
        const shade = shadeOf(v, i);
        const labelEl = (
          <text className={[s.label, shade === 'ink' ? s.labelInk : ''].join(' ')} x={0} y={mid} dominantBaseline="central">
            {v.label}
          </text>
        );
        if (!isFigure(v.value)) {
          return (
            <g key={v.id}>
              <line className={s.gap} x1={zero - STUB} x2={zero + STUB} y1={mid} y2={mid} />
              {labelEl}
              <text className={s.valueMissing} x={width} y={mid} textAnchor="end" dominantBaseline="central">
                {t(MISSING_WORDS[missingOf(v.value)])}
              </text>
            </g>
          );
        }
        const exact = exacts[i] ?? null;
        /* A known value that is not a whole number cannot be placed. It keeps its mark
           and its written amount; it is never drawn as a zero bar. */
        const span = exact === null ? null : pixelSpan(x, 0n, exact);
        return (
          <Mark key={v.id} label={v.label} display={v.value.display} spoken={v.value.spoken} receiptId={v.value.receiptId} onReceipt={onReceipt}>
            {span !== null && span.size > 0 && (
              <rect
                className={[s.bar, s[shade], 'm-grow-across'].join(' ')}
                style={{ transformOrigin: span.rising ? 'left center' : 'right center' }}
                x={span.lo}
                y={mid - BAR_H / 2}
                width={span.size}
                height={BAR_H}
                rx={BAR_RADIUS}
              />
            )}
            <Target cx={span === null ? zero : (span.lo + span.hi) / 2} cy={mid} />
            {labelEl}
            <text className={s.value} x={width} y={mid} textAnchor="end" dominantBaseline="central">
              {v.value.display}
            </text>
          </Mark>
        );
      })}
    </svg>
  );
}
