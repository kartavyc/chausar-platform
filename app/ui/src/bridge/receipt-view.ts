/**
 * ReceiptView: what the Receipt part draws, and the pure adapter that builds it from the
 * engine's CalculationReceiptEvidence.
 *
 * The part formats nothing. Every amount, count and date here is already a display string
 * from the format module, with the exact engine value kept beside it. A line of small print
 * the engine did not supply is absent; it is never filled with a guess. The engine's
 * current receipt carries no question, way in, recipe, meaning, rate, forecast, number
 * guard result, allowing decision or model route, so the adapter leaves all of those out.
 */

import type { Figure as FigureView, FigureOrMissing, Count, Language, MissingState, StatementLabel } from '../app/presentation.ts';
import type { CalculationReceiptEvidence, EngineFigureEvidence, ReceiptPeriod } from './presentation.ts';
import { count as formatCount, date, money, percent, time } from '../format/index.ts';

export type ReceiptWayIn = 'interface' | 'exported-file' | 'computer-export';
export type ReceiptRecipeState = 'seed' | 'tested' | 'not-yet-tested' | 'failed';
export type ReceiptGrade = 'model' | 'owner' | 'accountant' | 'ca' | 'reconciled';
export type ReceiptSendLevel = 'nothing' | 'shape-only' | 'samples';

/** One group of rows left out, with its reason as the engine wrote it. */
export interface ReceiptLeftOut {
  readonly reason: string;
  readonly rows: Count;
}

/** One total under the rule. Known totals open their receipt like any figure. */
export interface ReceiptTotal {
  readonly key: string;
  readonly label: string;
  readonly figure: FigureOrMissing;
}

/** The small print, each line present only when supplied. Strings are display strings. */
export interface ReceiptSmallPrint {
  readonly source?: { readonly names: string; readonly wayIn?: ReceiptWayIn; readonly readAt?: string };
  readonly recipe?: { readonly state: ReceiptRecipeState; readonly acceptedBy: string; readonly grade: ReceiptGrade };
  readonly meaning?: { readonly publishedBy: string; readonly reviewedBy?: string; readonly cosignedBy?: string };
  readonly rate?: { readonly value: string; readonly date: string; readonly source: string };
  readonly forecast?: { readonly method: string; readonly trainedOn: string; readonly heldOut: string };
  readonly numberGuard?: { readonly passed: boolean; readonly matched: Count; readonly of: Count };
  readonly allowedBy?: { readonly text: string; readonly ruleId?: string; readonly person?: string; readonly device?: string; readonly at?: string };
  readonly route?: { readonly kind: string; readonly sendLevel: ReceiptSendLevel; readonly cost?: string };
}

export interface ReceiptView {
  readonly receiptId: string;
  /** Part 1: how it was worked out, four marks on a line. */
  readonly workedOut: {
    /** The person's question as written. Absent when the receipt was not made from a question. */
    readonly question?: string;
    readonly calculation: string;
    readonly rowsRead: Count;
    /** Whether the total was checked against the rows. */
    readonly totalChecked: boolean;
  };
  /** Part 2. */
  readonly calculation: string;
  readonly period?: { readonly from: string; readonly to: string };
  readonly asKnownOn: string;
  /** Part 3. */
  readonly rowsCounted: Count;
  readonly leftOut: ReadonlyArray<ReceiptLeftOut>;
  /** Part 4. Empty when no total is known; the part then shows the missing word. */
  readonly totals: ReadonlyArray<ReceiptTotal>;
  /** Shown above the totals when the engine says so: the receipt is stale. */
  readonly statement?: StatementLabel;
  /** Part 5. */
  readonly smallPrint: ReceiptSmallPrint;
}

export interface ReceiptViewOptions {
  readonly language: Language;
  /** The workspace time zone, given explicitly; the machine's zone is never assumed. */
  readonly timeZone: string;
  /** The question as the person wrote it, when the host holds it. */
  readonly question?: string;
}

function countOf(digits: string): Count {
  return { exact: digits, display: formatCount(digits) };
}

function when(iso: string, options: ReceiptViewOptions): string {
  if (iso.length <= 10) return date(iso, 'short', options.language);
  return `${date(iso.slice(0, 10), 'short', options.language)}, ${time(iso, options.timeZone)}`;
}

function period(value: ReceiptPeriod, options: ReceiptViewOptions): NonNullable<ReceiptView['period']> {
  return { from: date(value.from, 'short', options.language), to: date(value.to, 'short', options.language) };
}

function totalOf(figure: EngineFigureEvidence, receipt: CalculationReceiptEvidence, known: boolean): ReceiptTotal {
  if (!known) {
    const missing: MissingState = 'unknown';
    return { key: figure.key, label: figure.label, figure: { kind: 'missing', missing } };
  }
  const labels = receipt.stale ? (['stale'] as const) : ([] as const);
  if (figure.unit === 'basis-points') {
    const shown: FigureView = { kind: 'percent', exact: figure.minor, display: percent(figure.minor), receiptId: receipt.id, labels };
    return { key: figure.key, label: figure.label, figure: shown };
  }
  const currency = figure.currency ?? receipt.currency;
  /* The format module writes rupees. Another currency keeps the engine's own display as written. */
  const shown: FigureView = currency === 'INR'
    ? { kind: 'money', exact: figure.minor, display: money(figure.minor), receiptId: receipt.id, labels }
    : { kind: 'money', exact: figure.minor, display: figure.display, receiptId: receipt.id, labels, asWritten: currency };
  return { key: figure.key, label: figure.label, figure: shown };
}

/** Group the rows left out by their reason, in the order each reason first appears. */
function leftOutGroups(receipt: CalculationReceiptEvidence): ReceiptLeftOut[] {
  const groups = new Map<string, bigint>();
  for (const item of receipt.exclusions) groups.set(item.reason, (groups.get(item.reason) ?? 0n) + 1n);
  return [...groups].map(([reason, rows]) => ({ reason, rows: countOf(rows.toString()) }));
}

/**
 * Map the engine's receipt to what the Receipt part draws. Pure: no clock, no locale of
 * the machine, no floating point. Money stays whole paise until the format module writes it.
 */
export function receiptViewFromEvidence(receipt: CalculationReceiptEvidence, options: ReceiptViewOptions): ReceiptView {
  const coverage = receipt.coverage;
  const known = coverage.completeness !== 'empty' && !(coverage.completeness === 'partial' && coverage.countedRows === 0);
  const counted = BigInt(coverage.countedRows);
  /* Rows read are the rows counted and the rows left out together. When the engine's
     own excluded count disagrees with its list of exclusions, the larger is used so no
     row is hidden from "rows read". */
  const listed = BigInt(receipt.exclusions.length);
  const excluded = BigInt(coverage.excludedRows) > listed ? BigInt(coverage.excludedRows) : listed;
  const rowsRead = countOf((counted + excluded).toString());
  const view: ReceiptView = {
    receiptId: receipt.id,
    workedOut: {
      ...(options.question !== undefined && options.question.trim().length > 0 ? { question: options.question.trim() } : {}),
      calculation: receipt.operation,
      rowsRead,
      totalChecked: known && !receipt.stale && coverage.unresolvedConflicts === 0,
    },
    calculation: receipt.operation,
    ...(receipt.period === null ? {} : { period: period(receipt.period, options) }),
    asKnownOn: when(receipt.asOf, options),
    rowsCounted: countOf(counted.toString()),
    leftOut: leftOutGroups(receipt),
    totals: receipt.figures.map((figure) => totalOf(figure, receipt, known)),
    ...(receipt.stale ? { statement: 'stale' as const } : {}),
    smallPrint: {
      /* The engine names its sources but not their way in or when each was read: those stay absent. */
      ...(receipt.sourceIds.length > 0 ? { source: { names: receipt.sourceIds.join(', ') } } : {}),
    },
  };
  return view;
}
