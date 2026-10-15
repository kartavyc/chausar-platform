/**
 * Shared pieces of the ask lane: payload checks, the lane's private state, periods on the
 * workspace's April to March calendar, the topic of each calculation, and the translation of
 * core refusals into the lane's own fixed codes.
 *
 * Nothing here does business arithmetic beyond exact BigInt sums of receipt rows. Every number
 * that reaches a screen comes from a calculator receipt.
 */
import { ChausarError, check, type Context, type State } from '../contracts.ts';
import { moduleState, peekModuleState, type ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { Dictionary, Operation } from '../ontology.ts';
import { starterPacks } from '../ontology.ts';
import type { Period } from '../memory.ts';
import { validDate } from '../memory.ts';
import type { AskState, PeriodChoice, PeriodId, Topic } from './contracts.ts';

export const LANE = 'ask';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

export function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Only declared keys, every required key present. */
export function input(payload: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, any> {
  check(plain(payload) && Object.keys(payload).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(payload, key)),
    'ASK_INVALID', 'Send only the declared fields for this request.');
  return payload;
}
export const identifier = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
export function requireId(value: unknown): string { check(identifier(value), 'ASK_INVALID', 'Choose one item by its identifier.'); return value; }
export function text(value: unknown, max = 2000): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'ASK_INVALID', 'Write the text, within its length limit.');
  return value;
}
export function period(value: unknown): Period {
  check(plain(value) && Object.keys(value).length === 2 && validDate(value.from) && validDate(value.to) && value.from <= value.to,
    'ASK_INVALID', 'Choose a period with a start date on or before its end date.');
  return { from: value.from as string, to: value.to as string };
}
export function minorString(value: unknown): string {
  check(typeof value === 'string' && /^-?\d{1,30}$/.test(value), 'ASK_INVALID', 'Amounts are whole paise written as digits.');
  return String(BigInt(value));
}

export function initAskState(): AskState {
  return { version: 1, saved: [], checks: [], why: [], corrections: [], wantedWords: [], wantedActions: [], asked: [], drafts: [], gst: { toleranceMinor: '100' } };
}
export const askState = (state: State) => moduleState(state, LANE, initAskState);
export const peekAsk = (state: State) => peekModuleState<AskState>(state, LANE) ?? initAskState();

/** The workspace's business day. The host may set the zone; Indian businesses default to Kolkata. */
export function businessToday(host: ModuleHost, today?: unknown): string {
  if (today !== undefined) { check(validDate(today), 'ASK_INVALID', 'Give the day as YYYY-MM-DD.'); return today; }
  const zone = typeof host.options.timeZone === 'string' ? host.options.timeZone : 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const monthEnd = (year: number, month: number) => `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
export const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;
/** Month arithmetic on (year, month 1..12). */
export function addMonths(year: number, month: number, delta: number): [number, number] {
  const index = year * 12 + (month - 1) + delta; return [Math.floor(index / 12), (index % 12) + 1];
}

/** Named periods on the workspace calendar. The financial year runs April to March. */
export function periodChoices(today: string): PeriodChoice[] {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const [ly, lm] = addMonths(year, month, -1);
  const quarterStart = Math.floor(((month + 8) % 12) / 3) * 3; // months since April of the quarter's first month
  const [qy, qm] = addMonths(year, month, -(((month + 8) % 12) - quarterStart));
  const [pqy, pqm] = addMonths(qy, qm, -3);
  const fyStart = month >= 4 ? year : year - 1;
  return [
    { id: 'this-month', period: { from: monthStart(year, month), to: today } },
    { id: 'last-month', period: { from: monthStart(ly, lm), to: monthEnd(ly, lm) } },
    { id: 'this-quarter', period: { from: monthStart(qy, qm), to: today } },
    { id: 'last-quarter', period: { from: monthStart(pqy, pqm), to: monthEnd(...addMonths(pqy, pqm, 2)) } },
    { id: 'this-year', period: { from: `${fyStart}-04-01`, to: today } },
    { id: 'last-year', period: { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` } },
  ];
}
export function namedPeriod(id: unknown, today: string): Period {
  const found = periodChoices(today).find(choice => choice.id === id);
  check(found, 'ASK_INVALID', 'Choose a named period from the calendar.');
  return found.period;
}
export const PERIOD_IDS: readonly PeriodId[] = ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year'];

/** The comparison period of the same length immediately before. */
export function priorPeriod(p: Period): Period {
  const from = Date.parse(`${p.from}T00:00:00Z`), to = Date.parse(`${p.to}T00:00:00Z`);
  const fy = Number(p.from.slice(0, 4)), fm = Number(p.from.slice(5, 7));
  // Whole calendar months compare with the same number of whole months before.
  if (p.from.endsWith('-01') && p.to === monthEnd(Number(p.to.slice(0, 4)), Number(p.to.slice(5, 7)))) {
    const months = (Number(p.to.slice(0, 4)) - fy) * 12 + Number(p.to.slice(5, 7)) - fm + 1;
    const [sy, sm] = addMonths(fy, fm, -months), [ey, em] = addMonths(fy, fm, -1);
    return { from: monthStart(sy, sm), to: monthEnd(ey, em) };
  }
  const days = Math.round((to - from) / 86_400_000) + 1;
  const end = new Date(from - 86_400_000), start = new Date(from - days * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Months a period touches, as YYYY-MM. */
export function monthsOf(p: Period): string[] {
  const out: string[] = []; let [y, m] = [Number(p.from.slice(0, 4)), Number(p.from.slice(5, 7))];
  const last = p.to.slice(0, 7);
  while (`${y}-${pad(m)}` <= last && out.length < 240) { out.push(`${y}-${pad(m)}`); [y, m] = addMonths(y, m, 1); }
  return out;
}

const TOPIC: Readonly<Record<string, Topic>> = {
  billed: 'sales', earned: 'sales', revenue: 'sales', net_sales: 'sales', margin: 'sales', refunds: 'sales', change: 'sales', scenario: 'sales',
  received: 'collections', aging: 'collections', costs: 'cash', purchases: 'stock',
};
export const topicOf = (operation: Pick<Operation, 'id'>): Topic => TOPIC[operation.id] ?? 'other';
export function needsOf(operation: Operation): ('period' | 'comparePeriod' | 'onDate' | 'priceChange')[] {
  const needs: ('period' | 'comparePeriod' | 'onDate' | 'priceChange')[] = ['period'];
  if (operation.parameters.includes('comparePeriod')) needs.push('comparePeriod');
  if (operation.parameters.includes('onDate')) needs.push('onDate');
  if (operation.parameters.includes('assumptions')) needs.push('priceChange');
  return needs;
}

/** True while the published meanings are still a starter pack's, unchanged by the owner. */
export function seedDictionary(dictionary: Dictionary): boolean {
  const pack = starterPacks.find(candidate => candidate.pack === dictionary.pack);
  return !!pack && JSON.stringify(pack.definitions) === JSON.stringify(dictionary.definitions);
}

export function currentDictionary(host: ModuleHost, ctx: Context): Dictionary | null {
  return host.services.ontology.current(ctx) as Dictionary | null;
}

const RULE_CODES = new Set(['ACCESS_REVOKED', 'FORBIDDEN', 'FORBIDDEN_BRANCH', 'BRANCH_FORBIDDEN', 'SOURCE_REVOKED', 'SOURCE_FORBIDDEN', 'SOURCE_DELETED', 'RECEIPT_FORBIDDEN', 'MARKING_HIDDEN', 'SOURCE_NOT_ALLOWED']);
export const isRuleCode = (code: string) => RULE_CODES.has(code) || code.endsWith('_FORBIDDEN') || code.startsWith('SOURCE_') && code.endsWith('_DENIED');
export const codeOf = (error: unknown) => error instanceof ChausarError ? error.code : typeof (error as any)?.code === 'string' ? (error as any).code as string : 'ASK_FAILED';

/**
 * Calls a core engine method. A refusal comes back with the lane's own fixed code and sentence,
 * so no outside text reaches a screen; the core code is kept as `cause` for the lane document.
 */
export async function core<T = any>(host: ModuleHost, method: string, payload: Record<string, unknown>): Promise<T> {
  try { return await host.call(method, payload) as T; }
  catch (error) { throw translate(error); }
}
export function translate(error: unknown): ChausarError {
  const code = codeOf(error);
  if (code.startsWith('ASK_')) return error as ChausarError;
  let mapped: ChausarError;
  if (code === 'DICTIONARY_REQUIRED') mapped = new ChausarError('ASK_NO_DICTIONARY', 'Publish what your words mean before asking for numbers.');
  else if (code === 'RECEIPT_NOT_FOUND' || code === 'DECISION_NOT_FOUND' || code === 'FORECAST_NOT_FOUND') mapped = new ChausarError('ASK_NOT_FOUND', 'This item is no longer available.');
  else if (isRuleCode(code)) mapped = new ChausarError('ASK_STOPPED_BY_RULE', 'A rule in Trust stops this answer for your seat.');
  else if (code === 'UNKNOWN_METHOD' || code === 'METHOD_UNAVAILABLE') mapped = new ChausarError('METHOD_UNAVAILABLE', 'This part is not built yet.');
  else if (code === 'REVISION_CONFLICT') mapped = new ChausarError('ASK_CHANGED', 'This changed since you opened it. Look at it again first.');
  else if (code === 'FACTS_CHANGED' || code === 'DICTIONARY_CHANGED') mapped = new ChausarError('ASK_CHANGED', 'The books or meanings changed while working this out. Try again.');
  else if (code === 'STALE_EVIDENCE') mapped = new ChausarError('ASK_STALE', 'Rebuild the answer before using it here.');
  else mapped = new ChausarError('ASK_REFUSED', 'The calculation refused this request.');
  (mapped as any).cause = code;
  return mapped;
}

/** Sign of each counted row in a receipt's total, from the published definitions. Exact only for sums. */
export function rowSigns(receipt: CalculationReceipt): Map<string, bigint> | null {
  if (!['sum'].includes(operationType(receipt))) return null;
  const signs = new Map<string, bigint>();
  for (const definition of receipt.definitions) signs.set(definition.kind, BigInt(definition.sign ?? 1));
  if (receipt.operation === 'net_sales' && receipt.compiledCalculation === undefined) {
    const refunds = receipt.definitions.find(definition => definition.name === 'refunds');
    if (refunds) signs.set(refunds.kind, -BigInt(refunds.sign ?? 1));
  }
  return signs;
}
/** The calculation type, read from the receipt's single figure key: `total` is a sum. */
export function operationType(receipt: CalculationReceipt): 'sum' | 'other' {
  return receipt.figures.length === 1 && receipt.figures[0]!.key === 'total' ? 'sum' : 'other';
}
/** Exact BigInt check that the signed rows of a sum receipt add up to its total. */
export function signedRows(receipt: CalculationReceipt): { factId: string; row: CalculationReceipt['rows'][number]; signed: bigint }[] | null {
  const signs = rowSigns(receipt); if (!signs) return null;
  const rows = receipt.rows.map(row => ({ factId: row.factId, row, signed: BigInt(row.amountMinor) * (signs.get(row.kind) ?? 0n) }));
  const total = rows.reduce((sum, row) => sum + row.signed, 0n);
  return total === BigInt(receipt.valueMinor) ? rows : null;
}

/**
 * A figure's unit as Ask draws it. Receipts carry money, basis points, and (stock on hand and
 * connector receipts) quantities in a named unit and counts of lines or entries. A unit this
 * page does not know is `other`: drawn as plain text, never as rupees.
 */
export type FigureUnit = 'money' | 'basis-points' | 'quantity' | 'count' | 'other';
const QUANTITY_UNIT = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._/()-]{0,39}$/u;
export function unitOf(figure: unknown): { unit: FigureUnit; quantityUnit: string | null } {
  const f = (figure ?? {}) as { unit?: unknown; quantityUnit?: unknown };
  const unit: FigureUnit = f.unit === 'money' || f.unit === 'basis-points' || f.unit === 'quantity' || f.unit === 'count' ? f.unit : 'other';
  const quantityUnit = unit === 'quantity' && typeof f.quantityUnit === 'string' && QUANTITY_UNIT.test(f.quantityUnit) ? f.quantityUnit : null;
  return { unit, quantityUnit };
}

export const headlineKey = (receipt: CalculationReceipt) => {
  const preferred = ['total', 'contribution', 'change', 'scenario', 'outstanding'];
  return preferred.find(key => receipt.figures.some(figure => figure.key === key)) ?? receipt.figures[0]?.key ?? 'total';
};

export function asText(value: unknown): string { return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : value === null ? '' : JSON.stringify(value) ?? ''; }

/** Normalized words for matching. Letters and digits of any script, lower case. */
export function words(value: string): string[] {
  return value.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

export function list<T>(value: unknown, max: number, item: (entry: unknown, index: number) => T): T[] {
  check(Array.isArray(value) && value.length <= max, 'ASK_INVALID', 'Send a short list.');
  return value.map(item);
}

/** The kind of rule behind a core access refusal. */
export function ruleKind(code: string): 'branch' | 'source' | 'seat' | 'access' | 'marking' {
  if (code.includes('BRANCH')) return 'branch';
  if (code.startsWith('SOURCE_')) return 'source';
  if (code.includes('MARKING')) return 'marking';
  if (code === 'ACCESS_REVOKED') return 'access';
  return 'seat';
}

/**
 * Opens a receipt for this seat. A receipt that does not exist and one that belongs to another
 * member give the same answer, so a receipt id cannot be probed. Only the seat's own receipt can
 * be "stopped by a rule" (its rows moved out of the seat's access).
 */
export async function openReceipt(host: ModuleHost, ctx: Context, id: unknown): Promise<CalculationReceipt> {
  const receiptId = requireId(id);
  try { return await host.call('receipts.get', { id: receiptId }) as CalculationReceipt; }
  catch (error) {
    const own = host.store.read().receipts.some(r => r?.id === receiptId && r.memberId === ctx.memberId);
    if (!own) throw new ChausarError('ASK_NOT_FOUND', 'This item is no longer available.');
    throw translate(error);
  }
}
