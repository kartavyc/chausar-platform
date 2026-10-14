/**
 * Bridge: why a figure moved. The start, each cause up or down, then the end, as
 * floating segments on one scale with one zero baseline. The start and the end are ink
 * and stand on zero; a measured cause is grey; a cause that is only a guess is an open,
 * dashed segment with the word Guess above it. Guesses come after every measured cause,
 * past a dashed divider, so the two are never mixed. A guess among measured causes is not
 * drawn at all: the steps are written out instead, each still opening its receipt.
 *
 * The part never works out a level. The engine sends each step's exact `from` and `to`;
 * here they are only scaled (charts/scale.ts). A step without both levels keeps its mark
 * and written amount on the baseline. A missing step is a gap with its words under the
 * chart. Every known step opens its receipt.
 */

import { isFigure } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import type { BridgeChart, BridgeKind } from './types.ts';
import { BAR_MAX, BAR_RADIUS, exactExtent, exactLinear, includeZero, pixelSpan, toExact } from './scale.ts';
import { Mark, MissingList, NoChart, Target, ValueList, emptyReason, moveAmongMarks } from './marks';
import s from './charts.module.css';

export interface BridgeProps {
  chart: BridgeChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const LABEL_H = 18;
/** Room above the plot for the word Guess over a segment at the top. */
const WORD_H = 16;

const FILL: Readonly<Record<BridgeKind, string>> = {
  start: 'ink',
  end: 'ink',
  measured: 'dim',
  guess: 'guess',
};

export function Bridge({ chart, onReceipt, width = 280, height = 64, className }: BridgeProps) {
  const t = useT();
  const steps = chart.steps;
  const reason = emptyReason(steps);
  if (reason !== null) return <NoChart reason={reason} sentence={chart.sentence} values={steps} className={className} />;

  const mixed = steps.some((step, i) => step.kind === 'measured' && steps.slice(0, i).some((before) => before.kind === 'guess'));
  if (mixed) {
    return (
      <div className={className} role="group" aria-label={chart.sentence}>
        <p className={s.unavailable}>{t('CHART.bridge.mixed')}</p>
        <ValueList values={steps.map((step) => (step.kind === 'guess' ? { ...step, label: t('CHART.bridge.guessLabel', { label: step.label }) } : step))} onReceipt={onReceipt} />
      </div>
    );
  }

  /* The levels the engine sent, exact. A step is placed only when its value is known and
     both of its levels are whole numbers. */
  const levels = steps.map((step) => {
    if (!isFigure(step.value)) return null;
    const from = step.from === undefined ? null : toExact(step.from);
    const to = step.to === undefined ? null : toExact(step.to);
    return from === null || to === null ? null : { from, to };
  });
  const domain = includeZero(exactExtent(levels.flatMap((l) => (l === null ? [] : [l.from, l.to]))) ?? { min: 0n, max: 0n });
  const n = steps.length;
  const y = exactLinear(domain.min, domain.max, WORD_H + height, WORD_H);
  const y0 = y(0n);
  const slot = width / n;
  const barW = Math.min(BAR_MAX, slot * 0.6);
  const boxH = WORD_H + height + LABEL_H;
  const firstGuess = steps.findIndex((step) => step.kind === 'guess');

  return (
    <div className={className}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${boxH}`} width={width} height={boxH} role="group" aria-label={chart.sentence} onKeyDown={moveAmongMarks}>
        <line className={s.baseline} x1={0} x2={width} y1={y0} y2={y0} />
        {firstGuess > 0 && <line className={s.divider} x1={slot * firstGuess} x2={slot * firstGuess} y1={0} y2={WORD_H + height} />}
        {steps.map((step, i) => {
          const here = levels[i] ?? null;
          const next = levels[i + 1] ?? null;
          if (here === null || next === null) return null;
          const cx = slot * i + slot / 2;
          const ly = y(here.to);
          return <line key={`c-${step.id}`} className={s.connector} x1={cx + barW / 2} x2={cx + slot - barW / 2} y1={ly} y2={ly} />;
        })}
        {steps.map((step, i) => {
          const cx = slot * i + slot / 2;
          const guess = step.kind === 'guess';
          const label = guess ? t('CHART.bridge.guessLabel', { label: step.label }) : step.label;
          const ink = FILL[step.kind] === 'ink';
          const labelEl = (
            <text className={[s.label, ink ? s.labelInk : ''].join(' ')} x={cx} y={boxH - 4} textAnchor="middle">
              {step.label}
            </text>
          );
          if (!isFigure(step.value)) {
            return (
              <g key={step.id}>
                <line className={s.gap} x1={cx - barW / 2} x2={cx + barW / 2} y1={y0} y2={y0} />
                {labelEl}
              </g>
            );
          }
          const here = levels[i] ?? null;
          const span = here === null ? null : pixelSpan(y, here.from, here.to);
          const shape = FILL[step.kind];
          return (
            <Mark key={step.id} label={label} display={step.value.display} spoken={step.value.spoken} receiptId={step.value.receiptId} onReceipt={onReceipt}>
              {span !== null && (
                <rect
                  className={[shape === 'guess' ? s.guess : [s.bar, s[shape]].join(' '), 'm-grow'].join(' ')}
                  style={{ transformOrigin: span.rising ? 'center top' : 'center bottom' }}
                  x={cx - barW / 2}
                  y={span.lo}
                  width={barW}
                  height={span.size}
                  rx={shape === 'guess' ? 0 : Math.min(BAR_RADIUS, span.size / 2)}
                />
              )}
              {guess && (
                <text className={s.guessWord} x={cx} y={(span === null ? y0 : span.lo) - 4} textAnchor="middle">
                  {t('CHART.bridge.guess')}
                </text>
              )}
              <Target cx={cx} cy={span === null ? y0 : (span.lo + span.hi) / 2} />
              {labelEl}
            </Mark>
          );
        })}
      </svg>
      <MissingList values={steps} />
    </div>
  );
}
