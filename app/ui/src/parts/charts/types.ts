/**
 * The typed descriptions of the chart forms beyond Columns, Line and OrderedBar. They
 * follow the presentation DTOs (app/presentation.ts): every value arrives already worked
 * out by the engine, with its written `display` and its receipt; a missing value is words.
 * A chart part only places these values. It never sorts them, adds them, takes one from
 * another or works out a share or a change: where a form needs a level (a bridge), the
 * engine sends it as an exact value beside the figure.
 *
 * These live beside the chart parts until the coordinator moves them into the
 * presentation DTOs; their shapes are the same either way.
 */

import type { ChartValue, FigureOrMissing } from '../../app/presentation.ts';
import type { StripCell } from '../Strip';

/** Ranked bars inside rows: a breakdown, largest first. */
export interface RankedBarsChart {
  readonly form: 'ranked-bars';
  /** One sentence for screen readers that states what the chart shows. */
  readonly sentence: string;
  /** In the engine's order, largest first. The part never reorders them. */
  readonly values: ReadonlyArray<ChartValue>;
}

/** Where a step of a bridge belongs: the figure it starts from, a cause that was
 *  measured, a cause that is only a guess, or the figure it ends at. */
export type BridgeKind = 'start' | 'measured' | 'guess' | 'end';

/** One step of a bridge. `value` is what the step says (the start, a cause, the end),
 *  with its receipt. `from` and `to` are the exact levels the engine worked out for the
 *  step, as whole-unit strings: where its segment begins and ends. The start and the end
 *  stand on zero, so the engine sends `from: '0'` for them. A step without both levels
 *  keeps its mark and its written amount but draws no segment. */
export interface BridgeStep extends ChartValue {
  readonly kind: BridgeKind;
  readonly from?: string;
  readonly to?: string;
}

/** Bridge: why a figure moved. Start, each cause up or down, end. Measured causes come
 *  first; guesses, if any, come after them and before the end, drawn open and labelled.
 *  A guess among measured causes is refused, never drawn mixed in. */
export interface BridgeChart {
  readonly form: 'bridge';
  readonly sentence: string;
  readonly steps: ReadonlyArray<BridgeStep>;
}

/** A line against a goal rule: a job's progress to its goal. */
export interface GoalLineChart {
  readonly form: 'goal-line';
  readonly sentence: string;
  readonly values: ReadonlyArray<ChartValue>;
  /** The goal, drawn as a marked horizontal rule with its label. It opens its receipt. */
  readonly goal: ChartValue;
  /** Written labels at the two ends of the baseline. */
  readonly from: string;
  readonly to: string;
}

/** A step line: what was believed over time. Each step holds until the next. */
export interface StepLineChart {
  readonly form: 'step-line';
  readonly sentence: string;
  readonly values: ReadonlyArray<ChartValue>;
  readonly from: string;
  readonly to: string;
}

/** Two thin bars, grey then ink: before and after. */
export interface PairBarsChart {
  readonly form: 'pair-bars';
  readonly sentence: string;
  readonly before: ChartValue;
  readonly after: ChartValue;
}

/** Twelve small squares for months: loaded, loading, not loaded yet, refused, failed. */
export interface StripChart {
  readonly form: 'strip';
  readonly sentence: string;
  readonly cells: ReadonlyArray<StripCell>;
}

/** A fine line in a row, beside the row's figure. The line is a picture with a sentence;
 *  the figure is the control and opens the receipt. */
export interface SparkChart {
  readonly form: 'spark';
  readonly sentence: string;
  readonly values: ReadonlyArray<ChartValue>;
  readonly figure: FigureOrMissing;
}

/** A bar with a marked line: a rule and an example against it. */
export interface RuleBarChart {
  readonly form: 'rule-bar';
  readonly sentence: string;
  /** The rule, drawn as the marked line, with its label. */
  readonly rule: ChartValue;
  /** The example, drawn as the bar, with its label. */
  readonly example: ChartValue;
  /** A sentence the engine wrote about the two, shown under the bar as given:
   *  "398 of 412 past invoices fit". */
  readonly caption?: string;
}

export type MoreChart =
  | RankedBarsChart
  | BridgeChart
  | GoalLineChart
  | StepLineChart
  | PairBarsChart
  | StripChart
  | SparkChart
  | RuleBarChart;
