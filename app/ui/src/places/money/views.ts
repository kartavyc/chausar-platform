/**
 * The Money views the charts draw, as slots wave 4 fills (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md,
 * package 3F). The engine does not send these series yet, so in wave 3 every slot is empty and Money draws no chart:
 * a chart is left out rather than drawn from made-up numbers.
 *
 *   goal   the goal bar on "Invoiced this month" (W4 4I, venture.goals.get; the goal counts money invoiced before tax)
 *   split  AI spend by department (W4 4A)
 *   aging  what clients owe, in five ages (W4 4J, venture.money.aging)
 *   flow   in and out by month (W4 4J, venture.money.flow)
 *   cash   cash in the bank, week by week, with its forecast (W4 4J, venture.money.cash)
 *
 * Each is the chart part's own view model (src/parts/charts/types.ts): integers the engine scaled to per mille and
 * strings the engine formatted, with the receipt that proves every amount on the chart. W4 maps its engine views onto
 * them inside `useMoneyViews`; nothing else in Money changes.
 */

import type { AgingData, BarSeries, CashData, ChartTick, GoalBarData, SplitData } from '../../parts/charts/types';
import type { FigureProof } from '../../parts/Figure';

/** In and out by month: two series with the same months, proved by one receipt. */
export interface FlowData {
  series: [BarSeries, BarSeries];
  /** The engine's sentence that reads the chart. */
  label: string;
  proof: FigureProof;
  /** Names the second string under each month ("What was left"), when the points carry one. */
  noteLabel?: string | undefined;
  ticks?: ChartTick[] | undefined;
  /** The month that is now; left out, the last one. */
  current?: string | undefined;
}

export interface MoneyViews {
  goal?: GoalBarData | undefined;
  split?: SplitData | undefined;
  aging?: AgingData | undefined;
  flow?: FlowData | undefined;
  cash?: CashData | undefined;
}

const NONE: MoneyViews = Object.freeze({});

/** The views the open business has. Placeholder until W4 4I, 4A and 4J: none yet. */
export function useMoneyViews(): MoneyViews {
  return NONE;
}
