/**
 * Shared pieces of the chart parts: a keyboard-operable mark that opens its receipt, the
 * transparent 24 pixel target every mark carries, the written list of missing values
 * under a chart, and the written list of every value for a chart that cannot be drawn.
 */

import type { KeyboardEvent, ReactNode } from 'react';
import type { ChartValue } from '../../app/presentation.ts';
import { isFigure, missingOf } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { Figure, MISSING_WORDS } from '../Figure';
import { HIT_RADIUS } from './scale.ts';
import s from './charts.module.css';

export interface MarkProps {
  label: string;
  display: string;
  spoken?: string | undefined;
  receiptId: string;
  onReceipt: (receiptId: string) => void;
  children: ReactNode;
}

/** A group that is focusable, named, and opens the receipt with Enter, Space or a click.
 *  The written amount is in the title (hover) and the accessible name. A mark exists only
 *  for a known value with a receipt, and the receipt callback is required, so a mark is
 *  never an inactive button. */
export function Mark({ label, display, spoken, receiptId, onReceipt, children }: MarkProps) {
  const t = useT();
  const name = t('CHART.open', { label, amount: spoken ?? display });
  const open = () => onReceipt(receiptId);
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  return (
    <g className={s.mark} role="button" tabIndex={0} aria-label={name} onClick={open} onKeyDown={onKey}>
      <title>{t('CHART.hover', { label, amount: display })}</title>
      {children}
    </g>
  );
}

/** The transparent target of a mark, 24 pixels each way around (cx, cy), so a bar of no
 *  height and a narrow bar can still be pressed and still show the focus outline. */
export function Target({ cx, cy }: { cx: number; cy: number }) {
  return <rect className={s.hit} x={cx - HIT_RADIUS} y={cy - HIT_RADIUS} width={HIT_RADIUS * 2} height={HIT_RADIUS * 2} />;
}

/** The missing values of a chart, in words. A gap is never a zero. */
export function MissingList({ values }: { values: ReadonlyArray<ChartValue> }) {
  const t = useT();
  const missing = values.filter((v) => !isFigure(v.value));
  if (missing.length === 0) return null;
  return (
    <p className={s.missing}>
      {missing.map((v) => (
        <span key={v.id} className={s.missingItem}>
          {t('CHART.missing', { label: v.label, words: t(MISSING_WORDS[missingOf(v.value)]) })}
        </span>
      ))}
    </p>
  );
}

/** Every value of a chart, written: its label, and its figure or its missing words.
 *  Shown when the values cannot be drawn, so each figure still opens its receipt. */
export function ValueList({ values, onReceipt }: { values: ReadonlyArray<ChartValue>; onReceipt: (receiptId: string) => void }) {
  return (
    <ul className={s.values}>
      {values.map((v) => (
        <li key={v.id} className={s.valueItem}>
          <span className={s.valueLabel}>{v.label}</span>
          <Figure value={v.value} onReceipt={onReceipt} />
        </li>
      ))}
    </ul>
  );
}
