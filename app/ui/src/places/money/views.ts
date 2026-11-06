/**
 * The Money views the charts draw, as slots wave 3 left and wave 4 fills (docs/superpowers/plans/2026-10-23-chausar-
 * ink-v2-w4.md, package 4J20):
 *
 *   goal   the goal bar on "Invoiced this month" (W4 4I2, venture.goals.get; the goal counts money invoiced before tax)
 *   split  AI spend by department (W4 4A2, split.ts)
 *   aging  what clients owe, in five ages (W4 4J4, venture.money.aging)
 *   flow   in and out by month (W4 4J4, venture.money.flow)
 *   cash   cash in the bank, week by week, with its forecast (W4 4J4, venture.money.cash)
 *
 * Each is the chart part's own view model (src/parts/charts/types.ts): integers the engine scaled to per mille and
 * strings the engine formatted, with the receipt that proves every amount on the chart. Aging has one receipt for the
 * whole tile; in and out by month and the cash weeks have one receipt per figure (`each`), each listed in the chart's
 * table. Nothing is added up, divided or rounded here: a view the engine does not send (an older engine, or no bank
 * statement for the cash line) leaves its slot empty, and the chart is left out rather than drawn from made-up numbers.
 * `engine` keeps the views as sent, for the tiles' own figures (the lowest weeks, the next three weeks, late invoices).
 */

import { useT, type T } from '../../text';
import { useResource } from '../../engine/context';
import type { AgingView, CashView, EngineError, FlowView, VentureRunEvent } from '../../engine/types';
import type { AgingData, BarSeries, CashData, ChartTick, GoalBarData, SplitData } from '../../parts/charts/types';
import type { ChartProof } from '../../parts/charts/ChartData';
import { useSpendSplit } from './split';
import { useDay, useMonthWords, type Day } from './words';

/** In and out by month: two series with the same months, each figure with its own receipt. */
export interface FlowData {
  series: [BarSeries, BarSeries];
  /** The sentence that reads the chart. */
  label: string;
  proof: ChartProof;
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
  /** The engine's views as sent (4J20), for the tiles around the charts; absent in a view given by a test or specimen. */
  engine?: { aging?: AgingView | undefined; flow?: FlowView | undefined; cash?: CashView | undefined } | undefined;
  /** A money view the engine refused for a reason other than not having it yet, to say so on the page. */
  failed?: EngineError | undefined;
}

/** Money moves when the queue does (an invoice issued, a payment recorded); spend when a run does. */
const onViews = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type.startsWith('run.');

/** An engine that does not have a view yet answers one of these; the screen then leaves that view out, quietly. */
const NOT_YET = new Set(['NOT_BUILT_YET', 'METHOD_NOT_ALLOWED', 'UNKNOWN_METHOD']);
export const notYet = (error: EngineError | undefined) => error !== undefined && NOT_YET.has(error.code);

/** Owed by age, from venture.money.aging: the five ages in the UI's words, every amount under the aging receipt. */
export function agingData(view: AgingView, t: T): AgingData | undefined {
  const receiptId = view.total.receiptId;
  // One receipt proves the tile: a bucket proved by another receipt would make the chart claim more than its receipt.
  if (!receiptId || view.buckets.some((bucket) => bucket.amount.receiptId !== receiptId)) return undefined;
  return {
    buckets: view.buckets.map((bucket) => ({
      id: bucket.id, label: t(`money.aging.bucket.${bucket.id}`),
      count: bucket.count === 0 ? t('money.aging.none') : t('money.aging.count', { count: String(bucket.count) }),
      amount: bucket.amount.display, permille: bucket.permille,
    })),
    proof: { receiptId },
    // Each age that holds money, in words, in the chart's name: colour is never the only way to read the bar.
    label: t('money.aging.label', { total: view.total.display, parts: view.buckets.filter((bucket) => bucket.count > 0).map((bucket) => `${t(`money.aging.bucket.${bucket.id}`)} ${bucket.amount.display}`).join(', ') }),
  };
}

/** In and out by month, from venture.money.flow: a month with nothing on a side draws no bar there, never a 0. */
export function flowData(view: FlowView, t: T, month: (key: string) => string): FlowData | undefined {
  if (view.months.length === 0 || view.months.every((row) => row.in === null && row.out === null)) return undefined;
  const last = view.months[view.months.length - 1]!;
  const label = (key: string) => (key === last.month ? t('money.flow.soFar', { month: month(key) }) : month(key));
  return {
    series: [
      {
        label: t('money.flow.in'),
        points: view.months.map((row) => ({
          key: row.month, label: label(row.month), valuePermille: row.in ? row.inPermille : null, value: row.in?.display ?? '', receiptId: row.in?.receiptId,
          ...(row.left ? { note: row.left.display, noteReceiptId: row.left.receiptId } : {}),
        })),
      },
      {
        label: t('money.flow.out'),
        points: view.months.map((row) => ({ key: row.month, label: label(row.month), valuePermille: row.out ? row.outPermille : null, value: row.out?.display ?? '', receiptId: row.out?.receiptId })),
      },
    ],
    label: t('money.flow.label', { count: String(view.months.length) }),
    proof: 'each',
    noteLabel: t('money.flow.left'),
    current: last.month,
  };
}

/** Cash, next 13 weeks, from venture.money.cash: none without a bank statement (the tile says to import one). */
export function cashData(view: CashView, t: T, day: Day, short: Day): CashData | undefined {
  if (view.points.length === 0) return undefined;
  return {
    points: view.points.map((point, k) => ({
      key: point.week,
      label: k === 0 ? t('money.cash.today') : t('money.cash.weekTo', { date: day(point.week) }),
      actualPermille: point.actual ? point.actualPermille : null, actual: point.actual?.display ?? null,
      forecastPermille: point.forecast ? point.forecastPermille : null, forecast: point.forecast?.display ?? null,
      receiptId: point.forecast?.receiptId ?? point.actual?.receiptId,
    })),
    // Every third week is named under the chart, so fourteen dates never crowd a phone (and the page stays quiet).
    axis: view.points.map((point, k) => (k % 3 === 0 ? short(point.week) : '')),
    assumptions: view.assumptions,
    ticks: view.ticks,
    proof: 'each',
    label: t('money.cash.label'),
  };
}

/**
 * The views the open business has: the spend split by department (4A2), and the aging, in and out and cash views
 * (4J4), each mapped onto its chart. The goal bar is the invoiced tile's own (4I2, Overview.tsx).
 */
export function useMoneyViews(): MoneyViews {
  const t = useT();
  const day = useDay();
  const short = useDay('short');
  const month = useMonthWords('short');
  const split = useSpendSplit();
  const aging = useResource('venture.money.aging', {}, { refreshOn: onViews });
  const flow = useResource('venture.money.flow', { months: 6 }, { refreshOn: onViews });
  const cash = useResource('venture.money.cash', {}, { refreshOn: onViews });
  const failed = [aging.error, flow.error, cash.error].find((error) => error !== undefined && !notYet(error));
  return {
    ...(split ? { split } : {}),
    ...(aging.data ? { aging: agingData(aging.data, t) } : {}),
    ...(flow.data ? { flow: flowData(flow.data, t, month) } : {}),
    ...(cash.data ? { cash: cashData(cash.data, t, day, short) } : {}),
    engine: { aging: aging.data, flow: flow.data, cash: cash.data },
    ...(failed ? { failed } : {}),
  };
}
