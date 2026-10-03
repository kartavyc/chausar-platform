/**
 * Stat: a label, a figure, what changed, and a small chart. The figure, the change and
 * every mark in the chart open their receipts. A missing figure is words.
 * A stat always says whether it has a chart. When it has none, the reason is written in
 * its place (no series supplied, a form not built yet, no points, no known points), so a
 * blank never suggests that data exists.
 */

import type { ChartMissingReason, StatTile } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Figure } from './Figure';
import { Chart } from './charts/Chart';
import s from './Stat.module.css';

export interface StatProps {
  tile: StatTile;
  onReceipt: (receiptId: string) => void;
  chartWidth?: number | undefined;
  chartHeight?: number | undefined;
  className?: string | undefined;
}

const UNAVAILABLE: Readonly<Record<ChartMissingReason, string>> = {
  CHART_NOT_PROVIDED: 'CHART.unavailable.CHART_NOT_PROVIDED',
  CHART_FORM_NOT_IMPLEMENTED: 'CHART.unavailable.CHART_FORM_NOT_IMPLEMENTED',
  CHART_HAS_NO_POINTS: 'CHART.unavailable.CHART_HAS_NO_POINTS',
  CHART_HAS_NO_KNOWN_POINTS: 'CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS',
};

export function Stat({ tile, onReceipt, chartWidth, chartHeight, className }: StatProps) {
  const t = useT();
  /* A state of "available" with no chart beside it is treated as not provided. */
  const reason: ChartMissingReason | null =
    tile.chartState.state === 'missing' ? tile.chartState.reasonCode : tile.chart === undefined ? 'CHART_NOT_PROVIDED' : null;

  return (
    <div className={[s.stat, className].filter(Boolean).join(' ')}>
      <span className={s.label}>{tile.label}</span>
      <span className={s.figureLine}>
        <Figure value={tile.figure} size="tile" onReceipt={onReceipt} />
        {tile.changeLabel !== undefined && <span className={s.change}>{tile.changeLabel}</span>}
        {tile.change !== undefined && <Figure value={tile.change} onReceipt={onReceipt} className={s.change} />}
      </span>
      {reason === null && tile.chart !== undefined ? (
        <Chart chart={tile.chart} onReceipt={onReceipt} width={chartWidth} height={chartHeight} className={s.chart} />
      ) : (
        <p className={s.unavailable}>{t(UNAVAILABLE[reason ?? 'CHART_NOT_PROVIDED'])}</p>
      )}
    </div>
  );
}
