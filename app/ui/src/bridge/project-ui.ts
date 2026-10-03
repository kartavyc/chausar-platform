/** Checked canonical DTOs -> preformatted component data. No React, IPC or network.
 * Strict compile-time tests compare these explicit projection types to the actual
 * component DTOs without coupling the delivered bridge to UI implementation code. */
import type {
  ChartView, Figure, FigureLabel, Language, Mark, MissingState, OpenSheetIntent,
  RowView, StatView, ViewState,
} from './presentation.ts';
import { ReplyValidationError, assertIntegerString, validateChart, validateFigure, validateRow, validateToday } from './validate.ts';
import { count, date, figureText, missing, moneySpoken, time } from '../format/index.ts';
import type { MissingWords, SpokenMoneyWords } from '../format/index.ts';

export interface UIFormatContext {
  readonly language: Language;
  readonly timeZone: string;
  readonly missingWords: MissingWords;
  /** Catalog-owned words. Supply for amount-in-words screen reader qualification. */
  readonly spokenMoneyWords?: SpokenMoneyWords;
  /** Explicit host layout capacity, without inventing an enterprise lens or scope. */
  readonly maxStats?: 3 | 4 | 12;
}
export type UIFigureProjection =
  | { readonly kind: 'money' | 'count' | 'percent'; readonly exact: string; readonly display: string; readonly spoken?: string; readonly receiptId: string; readonly labels: readonly FigureLabel[] }
  | { readonly kind: 'missing'; readonly missing: MissingState };
export interface UICountProjection { readonly exact: string | null; readonly display: string }
export interface UIRowProjection { readonly id: string; readonly mark: Mark; readonly what: string; readonly note: string; readonly figure?: UIFigureProjection; readonly can?: readonly ['open'] }
export interface UIRowResult { readonly row: UIRowProjection; readonly action?: OpenSheetIntent }
export interface UIChartValueProjection { readonly id: string; readonly label: string; readonly value: UIFigureProjection }
export type UIChartProjection =
  | { readonly form: 'columns'; readonly sentence: string; readonly values: readonly UIChartValueProjection[] }
  | { readonly form: 'ordered-bar'; readonly sentence: string; readonly values: readonly UIChartValueProjection[] }
  | { readonly form: 'line'; readonly sentence: string; readonly values: readonly UIChartValueProjection[]; readonly from: string; readonly to: string };
export type UIChartAvailability =
  | { readonly state: 'available' }
  | { readonly state: 'missing'; readonly reasonCode: 'CHART_NOT_PROVIDED' | 'CHART_FORM_NOT_IMPLEMENTED' | 'CHART_HAS_NO_POINTS' | 'CHART_HAS_NO_KNOWN_POINTS' };
export type UIChartState =
  | { readonly state: 'available'; readonly chart: UIChartProjection }
  | { readonly state: 'missing'; readonly reasonCode: 'CHART_NOT_PROVIDED' | 'CHART_FORM_NOT_IMPLEMENTED' | 'CHART_HAS_NO_POINTS' | 'CHART_HAS_NO_KNOWN_POINTS' };
export interface UIStatProjection { readonly id: string; readonly label: string; readonly figure: UIFigureProjection; readonly change?: UIFigureProjection; readonly changeLabel?: string; readonly chart?: UIChartProjection; readonly chartState: UIChartAvailability }
export interface UIDayEventProjection { readonly id: string; readonly mark: Mark; readonly time: string; readonly words: string }
export type UIScreenStateProjection = { readonly kind: 'ready' } | { readonly kind: 'empty' } | { readonly kind: 'boundary-state'; readonly source: ViewState };
export interface UITodayDataProjection {
  readonly state: UIScreenStateProjection;
  readonly date: string;
  readonly review: { readonly count: UICountProjection; readonly rows: readonly UIRowProjection[] };
  readonly worthALook: readonly UIRowProjection[];
  readonly thisMonth: readonly UIStatProjection[];
  readonly thisMonthMissing?: MissingState;
  readonly earlierToday: readonly UIDayEventProjection[];
}
export interface UITodayProjection {
  /** Preserve the supplied title, even when a component separately uses its fixed key. */
  readonly title: string;
  readonly data: UITodayDataProjection;
  readonly rowActions: readonly { readonly rowId: string; readonly intent: OpenSheetIntent }[];
  readonly dayActions: readonly { readonly eventId: string; readonly intent: OpenSheetIntent }[];
  /** The caller must render these missing states; a missing chart is never a blank plot. */
  readonly chartStates: readonly { readonly statId: string; readonly state: UIChartState }[];
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function context(config: UIFormatContext): void {
  if (!['en', 'hi'].includes(config.language) || typeof config.timeZone !== 'string' || !config.timeZone || (config.maxStats !== undefined && ![3, 4, 12].includes(config.maxStats))) throw new ReplyValidationError('format.context');
  // Check the explicit timezone even when the current projection has no day events.
  try { new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone }); }
  catch { throw new ReplyValidationError('format.timeZone'); }
}
function formattedFigure(figure: Figure, config: UIFormatContext): UIFigureProjection {
  if (figure.kind === 'missing') return { kind: 'missing', missing: figure.state };
  const display = figureText(figure, config.missingWords);
  const exact = figure.kind === 'money' ? figure.paise : figure.kind === 'count' ? figure.count : figure.basisPoints;
  const base = { kind: figure.kind, exact, display, receiptId: figure.receiptId, labels: [...figure.labels] };
  if (figure.kind === 'money') return config.spokenMoneyWords ? { ...base, spoken: moneySpoken(figure.paise, config.spokenMoneyWords) } : base;
  return { ...base, spoken: display };
}
export function projectFigureForUi(raw: unknown, config: UIFormatContext): UIFigureProjection {
  context(config); return freeze(formattedFigure(validateFigure(raw), config));
}
export function projectMetadataCountForUi(raw: string | null, config: UIFormatContext): UICountProjection {
  context(config);
  if (raw !== null) assertIntegerString(raw, 'metadata.count', false);
  return freeze({ exact: raw, display: raw === null ? missing('unknown', config.missingWords) : count(raw) });
}
function formattedRow(row: RowView, config: UIFormatContext): UIRowResult {
  const output: UIRowProjection = {
    id: row.id, mark: row.mark, what: row.title, note: row.note,
    ...(row.figure ? { figure: formattedFigure(row.figure, config) } : {}),
    ...(row.action ? { can: ['open'] as const } : {}),
  };
  return row.action ? { row: output, action: row.action } : { row: output };
}
export function projectRowForUi(raw: unknown, config: UIFormatContext): UIRowResult {
  context(config); return freeze(formattedRow(validateRow(raw), config));
}
function formattedChart(chart: ChartView | null, config: UIFormatContext): UIChartState {
  if (chart === null) return { state: 'missing', reasonCode: 'CHART_NOT_PROVIDED' };
  if (!['columns', 'line', 'ordered-bar'].includes(chart.kind)) return { state: 'missing', reasonCode: 'CHART_FORM_NOT_IMPLEMENTED' };
  if (chart.points.length === 0) return { state: 'missing', reasonCode: 'CHART_HAS_NO_POINTS' };
  if (chart.points.every(point => point.value.kind === 'missing')) return { state: 'missing', reasonCode: 'CHART_HAS_NO_KNOWN_POINTS' };
  const values = chart.points.map(point => ({ id: point.id, label: point.label, value: formattedFigure(point.value, config) }));
  if (chart.kind === 'line') return { state: 'available', chart: { form: 'line', sentence: chart.description, values, from: chart.points[0]!.label, to: chart.points.at(-1)!.label } };
  if (chart.kind === 'columns' || chart.kind === 'ordered-bar') return { state: 'available', chart: { form: chart.kind, sentence: chart.description, values } };
  throw new ReplyValidationError('chart.kind');
}
export function projectChartForUi(raw: unknown, config: UIFormatContext): UIChartState {
  context(config); return freeze(formattedChart(raw === null ? null : validateChart(raw), config));
}
function formattedStat(stat: StatView, config: UIFormatContext): { readonly tile: UIStatProjection; readonly chartState: UIChartState } {
  const chartState = formattedChart(stat.chart, config);
  return {
    tile: { id: stat.id, label: stat.label, figure: formattedFigure(stat.figure, config),
      chartState: chartState.state === 'available' ? { state: 'available' } : chartState,
      ...(stat.change ? { change: formattedFigure(stat.change, config) } : {}),
      ...(stat.changeLabel ? { changeLabel: stat.changeLabel } : {}),
      ...(chartState.state === 'available' ? { chart: chartState.chart } : {}),
    }, chartState,
  };
}
export function projectTodayForUi(raw: unknown, config: UIFormatContext): UITodayProjection {
  context(config); const today = validateToday(raw);
  if (today.stats.length > (config.maxStats ?? 3)) throw new ReplyValidationError('today.stats.layout-limit');
  const attention = today.attention.map(row => formattedRow(row, config));
  const worth = today.worthLook.map(row => formattedRow(row, config));
  const stats = today.stats.map(stat => formattedStat(stat, config));
  const rowActions = [...attention, ...worth].flatMap(result => result.action ? [{ rowId: result.row.id, intent: result.action }] : []);
  return freeze({
    title: today.title,
    data: {
      state: today.state.kind === 'ready' || today.state.kind === 'empty' ? { kind: today.state.kind } : { kind: 'boundary-state', source: today.state },
      date: date(today.date, 'long', config.language),
      review: { count: projectMetadataCountForUi(today.pendingCount, config), rows: attention.map(result => result.row) },
      worthALook: worth.map(result => result.row), thisMonth: stats.map(stat => stat.tile),
      ...(stats.length === 0 ? { thisMonthMissing: 'unknown' as const } : {}),
      earlierToday: today.dayEvents.map(event => ({ id: event.id, mark: event.mark, time: time(event.at, config.timeZone), words: event.label })),
    }, rowActions,
    dayActions: today.dayEvents.flatMap(event => event.action ? [{ eventId: event.id, intent: event.action }] : []),
    chartStates: stats.map(stat => ({ statId: stat.tile.id, state: stat.chartState })),
  });
}
