/**
 * RuleBar: a bar with a marked line, a rule and an example against it ("a meaning"). The
 * example is a thin ink bar from zero; the rule is a short upright line across the track
 * at its own value, on the same scale. Both carry their written labels and values, and
 * each opens its own receipt. A missing rule or example writes its words in its place.
 * The engine's sentence about the two ("398 of 412 past invoices fit") is shown under the
 * bar as given; nothing here compares the two or works out how far apart they are.
 */

import { isFigure, missingOf } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { MISSING_WORDS } from '../Figure';
import type { RuleBarChart } from './types.ts';
import { BAR_RADIUS, exactExtent, exactLinear, includeZero, pixelSpan, toExact } from './scale.ts';
import { Mark, NoChart, Target, emptyReason, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface RuleBarProps {
  chart: RuleBarChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  className?: string | undefined;
}

const PAD = 6;
/** The line of text above the bar, where the rule's label is written. */
const TOP = 18;
const BAR_H = 10;
/** How far the rule's line reaches past the bar, above and below. */
const REACH = 4;
const LABEL_H = 18;

export function RuleBar({ chart, onReceipt, width = 280, className }: RuleBarProps) {
  const t = useT();
  const { rule, example } = chart;
  const reason = emptyReason([example, rule]);
  if (reason !== null) return <NoChart reason={reason} sentence={chart.sentence} values={[example, rule]} className={className} />;

  const ruleExact = isFigure(rule.value) ? toExact(rule.value.exact) : null;
  const exampleExact = isFigure(example.value) ? toExact(example.value.exact) : null;
  const domain = includeZero(exactExtent([ruleExact, exampleExact]) ?? { min: 0n, max: 0n });
  const x = exactLinear(domain.min, domain.max, PAD, width - PAD);
  const zero = x(0n);
  const barTop = TOP + REACH;
  const mid = barTop + BAR_H / 2;
  const boxH = barTop + BAR_H + REACH + LABEL_H;
  const rx = ruleExact === null ? null : x(ruleExact);
  /* The rule's label reads away from the nearer edge, so it stays inside the box. */
  const ruleAnchor = rx !== null && rx > width / 2 ? 'end' : 'start';
  const span = exampleExact === null ? null : pixelSpan(x, 0n, exampleExact);

  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${boxH}`} width={width} height={boxH} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        <line className={s.baseline} x1={PAD} x2={width - PAD} y1={mid} y2={mid} />
        <line className={s.baseline} x1={zero} x2={zero} y1={barTop} y2={barTop + BAR_H} />
        {isFigure(example.value) ? (
          <Mark label={example.label} display={example.value.display} spoken={example.value.spoken} receiptId={example.value.receiptId} onReceipt={onReceipt}>
            {span !== null && span.size > 0 && (
              <rect
                className={[s.bar, s.ink, 'm-grow-across'].join(' ')}
                style={{ transformOrigin: span.rising ? 'left center' : 'right center' }}
                x={span.lo}
                y={barTop}
                width={span.size}
                height={BAR_H}
                rx={BAR_RADIUS}
              />
            )}
            <Target cx={span === null ? zero : (span.lo + span.hi) / 2} cy={mid} />
            <text className={[s.label, s.labelInk].join(' ')} x={0} y={boxH - 4} textAnchor="start">
              {t('CHART.ruleBar.value', { label: example.label, amount: example.value.display })}
            </text>
          </Mark>
        ) : (
          <text className={s.label} x={0} y={boxH - 4} textAnchor="start">
            {t('CHART.missing', { label: example.label, words: t(MISSING_WORDS[missingOf(example.value)]) })}
          </text>
        )}
        {isFigure(rule.value) ? (
          <Mark label={rule.label} display={rule.value.display} spoken={rule.value.spoken} receiptId={rule.value.receiptId} onReceipt={onReceipt}>
            {rx !== null && <line className={s.marker} x1={rx} x2={rx} y1={TOP} y2={barTop + BAR_H + REACH} />}
            <Target cx={rx ?? zero} cy={mid} />
            <text className={s.ruleLabel} x={rx ?? 0} y={TOP - 4} textAnchor={rx === null ? 'start' : ruleAnchor}>
              {t('CHART.ruleBar.value', { label: rule.label, amount: rule.value.display })}
            </text>
          </Mark>
        ) : (
          <text className={s.ruleLabel} x={width - PAD} y={TOP - 4} textAnchor="end">
            {t('CHART.missing', { label: rule.label, words: t(MISSING_WORDS[missingOf(rule.value)]) })}
          </text>
        )}
      </svg>
      {chart.caption !== undefined && <p className={s.caption}>{chart.caption}</p>}
    </div>
  );
}
