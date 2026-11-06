/**
 * The view models the charts draw (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md, package 3B2). W4 maps
 * engine views onto them; W3 adds no engine type. Every number is an integer the engine scaled to per mille
 * (0 to 1000 of the chart's own scale) and every string is engine text, already formatted. The browser never
 * divides, adds up money or formats a number: it only draws what it is given.
 */

import type { FigureProof } from '../Figure';
import type { DeptId } from '../icons';

/** Today's goal bar (D's `.g-bar` on the goal card, `.gb` on the Money tile). The goal counts money invoiced before
 *  tax. All three are per mille of the goal. */
export interface GoalBarData {
  /** Invoiced so far: the filled part. Past 1000 the bar is simply full. */
  invoicedPermille: number;
  /** Ready to issue: the striped part's length, drawn straight after the invoiced part, or 0 for none. */
  readyPermille: number;
  /** Where today's pace sits: the thin marker. */
  pacePermille: number;
  /** The engine's sentence that reads the bar: how much of the goal is invoiced, what issuing the ready invoices
   *  would make it, and where today's pace is. */
  label: string;
}

/** A level line on a chart's scale, with the engine's words for it, written in a gutter on the left. */
export interface ChartTick {
  permille: number;
  label: string;
}

/** One bar: a month, a week or a department. */
export interface BarPoint {
  key: string;
  /** Short words under the bar or beside it (a month, "so far", a department). */
  label: string;
  /** The bar's length, per mille of the chart's scale. `null` when there is no value: no bar is drawn, never a 0. */
  valuePermille: number | null;
  /** The engine's own text for the value (an amount or a count); ignored when `valuePermille` is null. */
  value: string;
  /** A second engine string for this point: under the label in a column chart (D-Money's "What was left" row),
   *  beside the value in ranked bars (D-Team's spend beside the jobs). The chart's `noteLabel` names it. */
  note?: string | undefined;
  /** This value's own receipt, listed in the chart's table. */
  receiptId?: string | undefined;
  /** Ranked bars by department take the department's colour. */
  dept?: DeptId | undefined;
}

export interface BarSeries {
  /** The series' name ("In", "Out", "Jobs"): the legend and the table's column heading. */
  label: string;
  points: BarPoint[];
}

/** The five ages of money owed, oldest last. */
export type AgingBucketId = 'not-due' | '1-30' | '31-60' | '61-90' | 'over-90';

export interface AgingBucket {
  id: AgingBucketId;
  /** The age in words ("1 to 30 days late"). */
  label: string;
  /** How many invoices, in words ("1 invoice", "none"). */
  count: string;
  amount: string;
  /** The bucket's share of the bar. The engine sends at least 1 for a bucket that holds anything. */
  permille: number;
}

/** Who owes you, by age (D's `.aging` and `.ag-l`). One proof covers the tile. */
export interface AgingData {
  buckets: AgingBucket[];
  /** The receipt (or "model estimate") behind every amount here. */
  proof: FigureProof;
  label: string;
}

/** A total split by department (D's `.sbar` and `.sleg`: AI spend by department). One proof covers the split. */
export interface SplitData {
  parts: { dept: DeptId; amount: string; permille: number }[];
  /** The receipt (or "model estimate") behind every amount here: every money figure on a chart has one. */
  proof: FigureProof;
  label: string;
}

/** One week of the cash line. Actual figures run up to today, the forecast from today on: today is the last point
 *  with an actual value, where the forecast takes over. */
export interface CashPoint {
  key: string;
  /** Words for the table and the hover line ("Week of ..."). */
  label: string;
  /** What was in the bank, per mille of the chart's scale; null for weeks still to come. */
  actualPermille: number | null;
  /** The engine's text for the actual figure, null with it. */
  actual: string | null;
  /** The forecast, per mille; null where the forecast does not reach. */
  forecastPermille: number | null;
  forecast: string | null;
}

/** Cash in the bank, week by week (D's `.cash` tile), marked as a forecast with its assumptions listed. */
export interface CashData {
  points: CashPoint[];
  /** One short label per point, under the chart; '' leaves a point unlabelled. */
  axis: string[];
  /** What the forecast takes for granted, in the engine's words, listed under the chart. */
  assumptions: string[];
  /** Level lines with the engine's labels, per mille of the same scale. Optional. */
  ticks?: ChartTick[] | undefined;
  /** The receipt (or "model estimate") behind every amount here. */
  proof: FigureProof;
  label: string;
}
