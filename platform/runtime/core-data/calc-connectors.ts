/**
 * Receipts for the connector pages (RP-02) and the GSTR-2B match (AS-19). Every figure is exact BigInt arithmetic over
 * visible, version-resolved facts of the chosen sources; nothing is a float and nothing missing becomes zero.
 *
 * Facts as connectors-ext writes them (read from its recipes, not guessed):
 *  - bank statements (`bank-statements` group): kind `bank`, signed `amountMinor` (credit positive, debit negative).
 *    The statement's own opening and closing balances live on the connector envelope (`balances`, minor units,
 *    `period` = first to last entry date), not on the facts.
 *  - GSTR-3B table 3.1 (`gst.gstr3b-supplies`): kind `gst_return_summary`, one row per table line, `amountMinor` =
 *    taxable value, optional `taxMinor`, dated the first day of the return month; the line is the end of the entity id
 *    (`gst-downloads:<date>|3.1(a)`). Table 4 credit rows share the kind and are not turnover.
 *  - GSTR-2B (`gst.gstr2b-b2b`) and the purchase register: both kind `purchase`, told apart only by source;
 *    `gstin` (or `customerId`), `invoiceId`, `amountMinor` (taxable), optional `taxMinor`. Matching reuses
 *    connectors-ext's pure `matchPurchaseRegister` exactly; the line key is `SUPPLIERGSTIN|INVOICE|FY`.
 *
 * Bank and GST rows are not converted between currencies here: a row in another currency is not counted.
 */
import { check, type Context, type Fact, type State, type StateStore } from '../contracts.ts';
import { currentAccess, selectFacts, validatePeriod, type Period } from '../memory.ts';
import { assertSourceAccess } from '../trust.ts';
import { countFigure, formatMoney, type CalculatorService, type Figure, type MissingFigure } from '../calculator.ts';
import type { Dictionary } from '../ontology.ts';
import type { ModuleHost } from '../modules/types.ts';
import { exactNumber, financialYear, matchPurchaseRegister, NOT_APPLICABLE, type MatchLine } from '../connectors-ext/gst-match.ts';
import { peekCx, type Envelope } from '../connectors-ext/state.ts';
import { buildReceipt, factsSnapshot, storeReceipts, type ReceiptDraft } from './calc-receipts.ts';

const SOURCE = /^[A-Za-z0-9_.:-]{1,200}$/;
const MINOR = /^-?\d{1,30}$/;
/** At most this many purchase lines (register and GSTR-2B together) are matched in one request, so at most this many line receipts are stored. */
export const MAX_MATCH_LINES = 2000;
const TOLERANCE_MAX = 10_000_000n;
const money = (key: string, label: string, value: bigint, currency: string): Figure => ({ key, label, minor: String(value), display: formatMoney(value, currency), unit: 'money', currency });
const missingFigure = (key: string, label: string, missing: MissingFigure['missing'], reason: string): MissingFigure => ({ key, label, missing, reason });
const day = (fact: Fact) => fact.validFrom.slice(0, 10);

function keys(payload: Record<string, any>, allowed: string[], required: string[]) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(payload, k)), 'INVALID_CALCULATION', 'Only declared calculation parameters are accepted.');
}
function sources(value: unknown): string[] {
  check(Array.isArray(value) && value.length >= 1 && value.length <= 64 && value.every(id => typeof id === 'string' && SOURCE.test(id)) && new Set(value).size === value.length, 'INVALID_SOURCE_SCOPE', 'Choose one to sixty-four distinct plain source identifiers.');
  return [...value as string[]];
}
function branchOf(value: unknown): string | null {
  if (value === undefined) return null; check(typeof value === 'string' && SOURCE.test(value), 'INVALID_CALCULATION', 'Name the branch exactly.'); return value;
}
function periodOf(value: unknown): Period {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PERIOD', 'Use an inclusive period with valid from and to dates.');
  validatePeriod(value as Period); return { from: (value as Period).from, to: (value as Period).to };
}
type Setup = { state: State; dictionary: Dictionary; snapshot: string; calculator: CalculatorService | undefined };
function begin(ctx: Context, host: ModuleHost, sourceIds: string[], branch: string | null): Setup {
  const store = host.store, state = store.read(); currentAccess(store, ctx, branch ?? undefined); assertSourceAccess(state, ctx, sourceIds);
  const dictionary: Dictionary | null = host.services.ontology?.current(ctx) ?? null; check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before calculating.');
  return { state, dictionary, snapshot: factsSnapshot(state), calculator: host.services.calculator };
}
/** Visible, version-resolved facts of the chosen sources, exactly as the calculator selects them. */
function select(ctx: Context, store: StateStore, sourceIds: string[], filter: { kinds: string[]; period?: Period; branch: string | null }) {
  const chosen = new Set(sourceIds);
  const view: StateStore = { read: () => { const state = store.read(); return { ...state, facts: state.facts.filter(fact => chosen.has(fact.sourceId)) }; }, update: async () => { throw new Error('Calculation selection is read-only.'); } };
  return selectFacts(view, ctx, { kinds: filter.kinds, ...(filter.period ? { period: filter.period } : {}), ...(filter.branch ? { branch: filter.branch } : {}) });
}
/** An exact amount in the dictionary currency, or the reason it is not counted. */
function amount(fact: Fact, field: string, currency: string): { value: bigint } | { reason: string; notCounted?: true } {
  const raw = fact.fields[field];
  if (typeof raw !== 'string' || !MINOR.test(raw)) return { reason: 'The amount is not an exact whole number of minor units, so it is not counted.' };
  if (fact.fields.currency !== undefined && fact.fields.currency !== currency) return { reason: 'The amount is in another currency, which these receipts do not convert, so it is not counted.', notCounted: true };
  return { value: BigInt(raw) };
}

// ---- Bank totals ---------------------------------------------------------------------------------------------

/**
 * `coredata.bankTotals { sourceIds, period, branch? }`. Figures (stable keys): `credits`, `debits` (positive), `net`
 * (credits minus debits), `entries` (count), and `opening` / `closing` only when a committed statement states them.
 * Opening on `period.from` = the stated opening of a statement whose entries span that day, plus that source's
 * entries from the statement's first day up to the day before; closing on `period.to` = a spanning statement's
 * stated closing minus its entries after that day. Over several sources a balance is given only when every source has one.
 */
export async function bankTotals(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['sourceIds', 'period', 'branch'], ['sourceIds', 'period']);
  const sourceIds = sources(payload.sourceIds), period = periodOf(payload.period), branch = branchOf(payload.branch);
  const setup = begin(ctx, host, sourceIds, branch), currency = setup.dictionary.currency;
  const inPeriod = select(ctx, host.store, sourceIds, { kinds: ['bank'], period, branch }), all = select(ctx, host.store, sourceIds, { kinds: ['bank'], branch });
  const exclusions = [...inPeriod.excluded], rows: ReceiptDraft['rows'] = []; let credits = 0n, debits = 0n, notCounted = 0;
  for (const fact of inPeriod.facts) {
    const value = amount(fact, 'amountMinor', currency);
    if ('reason' in value) { exclusions.push({ rowId: fact.id, reason: value.reason }); if (value.notCounted) notCounted++; continue; }
    if (value.value >= 0n) credits += value.value; else debits -= value.value;
    rows.push({ fact, amountMinor: String(value.value) });
  }
  const balance = (side: 'opening' | 'closing'): bigint | 'absent' | 'unknown' => {
    let total = 0n;
    for (const sourceId of sourceIds) {
      const statements = peekCx(setup.state).envelopes.filter((e: Envelope) => e.sourceId === sourceId && e.status === 'accepted' && !!e.committed && !!e.period && e.balances?.[side] != null && MINOR.test(String(e.balances[side])) && (!branch || e.branch === branch));
      const found = new Set<string>(); let unknown = false;
      for (const statement of statements) {
        const span = statement.period!, at = side === 'opening' ? period.from : period.to;
        if (!(span.from <= at && at <= span.to)) continue;
        try { currentAccess(host.store, ctx, statement.branch); } catch { unknown = true; continue; }
        const window = all.facts.filter(f => f.sourceId === sourceId && (side === 'opening' ? day(f) >= span.from && day(f) < at : day(f) > at && day(f) <= span.to));
        let value = BigInt(String(statement.balances![side]));
        for (const fact of window) { const entry = amount(fact, 'amountMinor', currency); if ('reason' in entry) { unknown = true; break; } value += side === 'opening' ? entry.value : -entry.value; }
        found.add(String(value));
      }
      if (unknown || found.size > 1) return 'unknown';
      if (found.size === 0) return 'absent';
      total += BigInt([...found][0]);
    }
    return total;
  };
  const opening = balance('opening'), closing = balance('closing');
  const figures: Figure[] = [money('credits', 'Money in (credits)', credits, currency), money('debits', 'Money out (debits)', debits, currency), money('net', 'Net movement', credits - debits, currency)];
  const missingFigures: MissingFigure[] = []; const gaps: string[] = []; let partial = false;
  for (const [key, label, value] of [['opening', 'Opening balance', opening], ['closing', 'Closing balance', closing]] as const) {
    if (typeof value === 'bigint') figures.push(money(key, label, value, currency));
    else missingFigures.push(missingFigure(key, label, value, value === 'absent' ? 'No committed statement of every chosen account states this balance on this date.' : 'The statements disagree, or some of their entries cannot be read, so this balance is unknown.'));
  }
  figures.push(countFigure('entries', 'Entries in the period', rows.length, 'count'));
  if (typeof opening === 'bigint' && typeof closing === 'bigint' && opening + credits - debits !== closing) { partial = true; gaps.push('The opening balance plus the period\'s entries does not equal the closing balance: a statement or some entries may be missing.'); }
  if (sourceIds.some(id => !rows.some(r => r.fact.sourceId === id))) gaps.push('A chosen account has no entries in this period. A statement not loaded is not counted as zero.');
  if (inPeriod.conflicts.length) partial = true;
  const draft: ReceiptDraft = { operation: 'bank_totals', requestedSourceIds: sourceIds, period, branch, asOf: inPeriod.asOf, figures, missingFigures, rows, exclusions,
    selectedRows: inPeriod.facts.length, conflicts: inPeriod.conflicts.length, notCounted, partial, gaps, valueMinor: String(credits - debits),
    assumptions: { balances: 'Opening and closing come from the statements\' own stated balances and their entries; they are never assumed.', signs: 'Credits are positive entries and debits negative entries, shown as positive money out.' },
    request: { calc: 'bank_totals', sourceIds, period, ...(branch ? { branch } : {}) } };
  const receipt = buildReceipt(ctx, setup.state, setup.dictionary, draft);
  const [id] = await storeReceipts(ctx, host.store, setup.calculator, [{ receipt, request: draft.request }], { snapshot: setup.snapshot, dictionaryHash: setup.dictionary.hash, sourceIds, branch });
  return { receipt: host.services.calculator.receipt(ctx, id), figures: Object.fromEntries(figures.map(f => [f.key, f.minor])), missing: Object.fromEntries(missingFigures.map(m => [m.key, m.missing])) };
}

// ---- GSTR-3B turnover ----------------------------------------------------------------------------------------

const TABLES = [['3.1(a)', 'outwardTaxable', 'Outward taxable supplies (table 3.1(a))'], ['3.1(b)', 'zeroRated', 'Zero rated outward supplies (table 3.1(b))'],
  ['3.1(c)', 'nilExempt', 'Nil rated and exempted outward supplies (table 3.1(c))'], ['3.1(e)', 'nonGst', 'Non-GST outward supplies (table 3.1(e))'],
  ['3.1(d)', 'reverseChargeInward', 'Inward supplies liable to reverse charge (table 3.1(d)), not turnover']] as const;
const OUTWARD = new Set(['3.1(a)', '3.1(b)', '3.1(c)', '3.1(e)']);
const tableOf = (fact: Fact) => /\|(3\.1\([a-e]\))$/.exec(fact.entityId)?.[1] ?? null;
function months(period: Period): string[] { const list: string[] = []; for (let y = Number(period.from.slice(0, 4)), m = Number(period.from.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= period.to.slice(0, 7); m === 12 ? (y++, m = 1) : m++) list.push(`${y}-${String(m).padStart(2, '0')}`); return list; }

/**
 * `coredata.gstr3bTurnover { sourceIds, period, branch? }`. Figures (stable keys): `turnover` = 3.1(a)+(b)+(c)+(e)
 * taxable value; `outwardTaxable`, `zeroRated`, `nilExempt`, `nonGst` per table; `reverseChargeInward` (3.1(d), never
 * turnover); `outwardTax` = tax on 3.1(a) and (b), given only when every such row states its tax. A table with no row
 * is missing (`absent`), never zero. Two rows for one month and table (two sources) are both set aside as a conflict.
 * Not applicable to a composition or unregistered business (`GST_RETURN_NOT_APPLICABLE`).
 */
export async function gstr3bTurnover(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['sourceIds', 'period', 'branch'], ['sourceIds', 'period']);
  const sourceIds = sources(payload.sourceIds), period = periodOf(payload.period), branch = branchOf(payload.branch);
  const setup = begin(ctx, host, sourceIds, branch), currency = setup.dictionary.currency;
  check(setup.dictionary.gstMode === 'regular', 'GST_RETURN_NOT_APPLICABLE', 'A composition or unregistered business files no GSTR-3B outward supplies table.');
  const selection = select(ctx, host.store, sourceIds, { kinds: ['gst_return_summary'], period, branch });
  const lines = selection.facts.filter(f => tableOf(f) !== null), exclusions = [...selection.excluded];
  const slots = new Map<string, Fact[]>(); for (const fact of lines) { const key = `${day(fact).slice(0, 7)} ${tableOf(fact)}`; slots.set(key, [...(slots.get(key) ?? []), fact]); }
  const totals = new Map<string, bigint>(), rows: ReceiptDraft['rows'] = []; let conflicts = selection.conflicts.length, notCounted = 0, tax = 0n, taxKnown = true, taxRows = 0;
  for (const group of slots.values()) {
    if (group.length > 1) { conflicts++; for (const fact of group) exclusions.push({ rowId: fact.id, reason: 'Two GSTR-3B rows give the same table for the same month, so neither is counted.' }); continue; }
    const fact = group[0], table = tableOf(fact)!, value = amount(fact, 'amountMinor', currency);
    if ('reason' in value) { exclusions.push({ rowId: fact.id, reason: value.reason }); if (value.notCounted) notCounted++; continue; }
    totals.set(table, (totals.get(table) ?? 0n) + value.value); rows.push({ fact, amountMinor: String(value.value) });
    if (table === '3.1(a)' || table === '3.1(b)') { taxRows++; const t = fact.fields.taxMinor; if (typeof t === 'string' && MINOR.test(t)) tax += BigInt(t); else taxKnown = false; }
  }
  const figures: Figure[] = [], missingFigures: MissingFigure[] = [], gaps: string[] = [];
  const outward = [...totals.entries()].filter(([table]) => OUTWARD.has(table)), turnover = outward.reduce((sum, [, v]) => sum + v, 0n);
  if (outward.length) figures.push(money('turnover', 'Turnover in GSTR-3B (outward supplies, table 3.1)', turnover, currency));
  else missingFigures.push(missingFigure('turnover', 'Turnover in GSTR-3B (outward supplies, table 3.1)', 'not-loaded-yet', 'No GSTR-3B outward supplies row is loaded for this period.'));
  for (const [table, key, label] of TABLES) {
    if (totals.has(table)) figures.push(money(key, label, totals.get(table)!, currency));
    else missingFigures.push(missingFigure(key, label, 'absent', 'The loaded returns have no row for this table.'));
  }
  if (taxRows && taxKnown) figures.push(money('outwardTax', 'Tax on outward taxable and zero rated supplies', tax, currency));
  else missingFigures.push(missingFigure('outwardTax', 'Tax on outward taxable and zero rated supplies', taxRows ? 'unknown' : 'absent', taxRows ? 'A row does not state its tax, so the tax is unknown, not zero.' : 'The loaded returns have no taxable outward row.'));
  const loaded = new Set(rows.map(r => day(r.fact).slice(0, 7))), wanted = months(period);
  if (wanted.some(month => !loaded.has(month))) gaps.push('Some months of this period have no GSTR-3B loaded. They are not counted as zero.');
  gaps.push('GSTR-3B states the return as filed; credit and debit notes are already netted in it by the filer.');
  const draft: ReceiptDraft = { operation: 'gstr3b_turnover', requestedSourceIds: sourceIds, period, branch, asOf: selection.asOf, figures, missingFigures, rows, exclusions,
    selectedRows: lines.length, conflicts, notCounted, partial: false, gaps, valueMinor: String(turnover),
    assumptions: { months: [...loaded].sort(), turnover: 'Taxable value of tables 3.1(a), 3.1(b), 3.1(c) and 3.1(e); table 3.1(d) is inward and never turnover.' },
    request: { calc: 'gstr3b_turnover', sourceIds, period, ...(branch ? { branch } : {}) } };
  const receipt = buildReceipt(ctx, setup.state, setup.dictionary, draft);
  const [id] = await storeReceipts(ctx, host.store, setup.calculator, [{ receipt, request: draft.request }], { snapshot: setup.snapshot, dictionaryHash: setup.dictionary.hash, sourceIds, branch });
  return { receipt: host.services.calculator.receipt(ctx, id), figures: Object.fromEntries(figures.map(f => [f.key, f.minor])), missing: Object.fromEntries(missingFigures.map(m => [m.key, m.missing])) };
}

// ---- GSTR-2B match -------------------------------------------------------------------------------------------

type LineGroup = 'matched' | 'within-tolerance' | 'amount-differs' | 'books-only' | 'gstr2b-only' | 'probable';
type Side = { taxableMinor: string; taxMinor: string | null; factId: string };
const LINE_LABELS: Record<LineGroup, string> = { matched: 'Matched', 'within-tolerance': 'Differs within your tolerance', 'amount-differs': 'Amount differs', 'books-only': 'In the books only', 'gstr2b-only': 'In GSTR-2B only', probable: 'Probable match to confirm' };
const abs = (v: bigint) => v < 0n ? -v : v;

/**
 * `coredata.gst2bReceipt { registerSourceId, gstr2bSourceId, period, toleranceMinor }` →
 * `{ receiptId, lines: { key, receiptId }[] }`. One group receipt (`gstr2b_match`) and one receipt per line
 * (`gstr2b_line`); every one opens with `receipts.get`. Lines are sorted by key; a probable pair uses its
 * purchase-register line's key. Lines set aside (invalid GSTIN, repeated invoice) are exclusions on the group
 * receipt and get no line. A difference within `toleranceMinor` (taxable and, where both state it, tax) is
 * `within-tolerance`, never `matched`. Refuses `GST_MATCH_NOT_APPLICABLE` (composition or unregistered),
 * `GST_MATCH_SOURCES_EMPTY` (either side has no purchases in the period) and `GST_MATCH_TOO_LARGE`
 * (more than `MAX_MATCH_LINES` purchase lines).
 *
 * Group figures (stable keys): money `booksTaxable`, `gstr2bTaxable`, `difference` (GSTR-2B minus books, over the
 * lines matched by key), `matchedTaxable`, `inBooksOnlyTaxable`, `in2bOnlyTaxable`, `creditAtRisk` (tax of books-only
 * lines that state it); counts `matched`, `withinTolerance`, `amountDiffers`, `inBooksOnly`, `in2bOnly`, `probable`,
 * `invalid`, `creditAtRiskUnknownTax`. Line figures: `booksTaxable`, `gstr2bTaxable`, `difference`, `booksTax`,
 * `gstr2bTax`, `taxDifference`; a side or tax the line does not have is a missing figure.
 */
export async function gst2bReceipt(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['registerSourceId', 'gstr2bSourceId', 'period', 'toleranceMinor'], ['registerSourceId', 'gstr2bSourceId', 'period', 'toleranceMinor']);
  const [registerSourceId, gstr2bSourceId] = sources([payload.registerSourceId, payload.gstr2bSourceId]), period = periodOf(payload.period);
  check(typeof payload.toleranceMinor === 'string' && /^\d{1,12}$/.test(payload.toleranceMinor) && BigInt(payload.toleranceMinor) <= TOLERANCE_MAX, 'INVALID_CALCULATION', 'Choose a tolerance from nothing up to one lakh rupees, in whole paise.');
  const tolerance = BigInt(payload.toleranceMinor), sourceIds = [registerSourceId, gstr2bSourceId];
  const setup = begin(ctx, host, sourceIds, null), currency = setup.dictionary.currency;
  if (setup.dictionary.gstMode !== 'regular') check(false, 'GST_MATCH_NOT_APPLICABLE', NOT_APPLICABLE[setup.dictionary.gstMode]);
  const selection = select(ctx, host.store, sourceIds, { kinds: ['purchase'], period, branch: null });
  const exclusions = [...selection.excluded], byId = new Map<string, Fact>(); let notCounted = 0;
  const lines = (sourceId: string): MatchLine[] => selection.facts.filter(f => f.sourceId === sourceId).flatMap(fact => {
    const value = amount(fact, 'amountMinor', currency), tax = fact.fields.taxMinor;
    if ('reason' in value) { exclusions.push({ rowId: fact.id, reason: value.reason }); if (value.notCounted) notCounted++; return []; }
    if (tax !== undefined && tax !== null && !(typeof tax === 'string' && MINOR.test(tax))) { exclusions.push({ rowId: fact.id, reason: 'The tax is not an exact whole number of minor units, so the line is not matched.' }); return []; }
    const invoice = String(fact.fields.invoiceId ?? '');
    if (!invoice.trim()) { exclusions.push({ rowId: fact.id, reason: 'The line has no invoice number, so it is not matched.' }); return []; }
    byId.set(fact.id, fact);
    return [{ entityId: fact.id, supplierGstin: String(fact.fields.gstin ?? fact.fields.customerId ?? ''), invoiceNumber: invoice, invoiceDate: day(fact), taxableMinor: String(value.value), taxMinor: typeof tax === 'string' ? tax : null, sourceRow: fact.sourceRow }];
  });
  const register = lines(registerSourceId), gstr2b = lines(gstr2bSourceId);
  check(register.length > 0 && gstr2b.length > 0, 'GST_MATCH_SOURCES_EMPTY', 'Both the purchase register and GSTR-2B need imported purchases in this period. A source not loaded yet is not matched as empty.');
  check(register.length + gstr2b.length <= MAX_MATCH_LINES, 'GST_MATCH_TOO_LARGE', 'There are too many purchase lines to give each its own receipt. Choose a shorter period.');
  const result = matchPurchaseRegister({ register, gstr2b, gstMode: 'regular', period });
  check(result.mode === 'matched', 'GST_MATCH_NOT_APPLICABLE', 'The purchase register is not matched with GSTR-2B.');
  const taxOf = new Map([...register, ...gstr2b].map(line => [line.entityId, line.taxMinor]));
  const items: { key: string; group: LineGroup; rule?: string; books: Side | null; twoB: Side | null }[] = [];
  const side = (receipt: { entityId: string }, taxableMinor: string, taxMinor: string | null): Side => ({ factId: receipt.entityId, taxableMinor, taxMinor });
  for (const m of result.matched) items.push({ key: `${m.supplierGstin}|${m.invoiceNumber}|${m.financialYear}`, group: 'matched',
    books: side(m.receipt.register, m.taxableMinor, taxOf.get(m.receipt.register.entityId) ?? null), twoB: side(m.receipt.gstr2b, m.taxableMinor, taxOf.get(m.receipt.gstr2b.entityId) ?? null) });
  for (const m of result.amountMismatch) {
    const inside = abs(BigInt(m.difference.taxableMinor)) <= tolerance && (m.difference.taxMinor === null || abs(BigInt(m.difference.taxMinor)) <= tolerance);
    items.push({ key: `${m.supplierGstin}|${m.invoiceNumber}|${m.financialYear}`, group: inside ? 'within-tolerance' : 'amount-differs',
      books: side(m.receipt.register, m.register.taxableMinor, m.register.taxMinor), twoB: side(m.receipt.gstr2b, m.gstr2b.taxableMinor, m.gstr2b.taxMinor) });
  }
  const oneKey = (line: { supplierGstin: string; invoiceNumber: string; invoiceDate: string }) => `${line.supplierGstin}|${exactNumber(line.invoiceNumber)}|${financialYear(line.invoiceDate)}`;
  for (const p of result.probable) items.push({ key: oneKey(p.register), group: 'probable', rule: p.rule, books: side(p.register.receipt, p.register.taxableMinor, p.register.taxMinor), twoB: side(p.gstr2b.receipt, p.gstr2b.taxableMinor, p.gstr2b.taxMinor) });
  for (const o of result.inBooksOnly) items.push({ key: oneKey(o), group: 'books-only', books: side(o.receipt, o.taxableMinor, o.taxMinor), twoB: null });
  for (const o of result.in2bOnly) items.push({ key: oneKey(o), group: 'gstr2b-only', books: null, twoB: side(o.receipt, o.taxableMinor, o.taxMinor) });
  items.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const invalid of result.invalid) exclusions.push({ rowId: invalid.receipt.entityId, reason: invalid.reason === 'invalid-gstin' ? 'The supplier GSTIN is not valid, so the line is set aside and not matched.' : 'Two lines on one side have the same invoice, so they are set aside and not matched.' });
  const sum = (list: (Side | null)[]) => list.reduce((total, s) => total + (s ? BigInt(s.taxableMinor) : 0n), 0n);
  const count = (group: LineGroup) => items.filter(i => i.group === group).length;
  const books = items.map(i => i.books), twoB = items.map(i => i.twoB), keyed = items.filter(i => i.books && i.twoB && i.group !== 'probable');
  const figures: Figure[] = [
    money('booksTaxable', 'Purchases in the books (taxable value)', sum(books), currency), money('gstr2bTaxable', 'Purchases in GSTR-2B (taxable value)', sum(twoB), currency),
    money('difference', 'GSTR-2B minus books, on invoices in both', sum(keyed.map(i => i.twoB)) - sum(keyed.map(i => i.books)), currency),
    money('matchedTaxable', 'Matched invoices (taxable value)', sum(items.filter(i => i.group === 'matched').map(i => i.books)), currency),
    money('inBooksOnlyTaxable', 'Invoices in the books only (taxable value)', sum(items.filter(i => i.group === 'books-only').map(i => i.books)), currency),
    money('in2bOnlyTaxable', 'Invoices in GSTR-2B only (taxable value)', sum(items.filter(i => i.group === 'gstr2b-only').map(i => i.twoB)), currency),
    money('creditAtRisk', 'Input tax credit at risk', BigInt(result.creditAtRisk.taxMinor), currency),
    countFigure('matched', 'Invoices matched', count('matched'), 'count'), countFigure('withinTolerance', 'Invoices differing within your tolerance', count('within-tolerance'), 'count'),
    countFigure('amountDiffers', 'Invoices with a different amount', count('amount-differs'), 'count'), countFigure('inBooksOnly', 'Invoices in the books only', count('books-only'), 'count'),
    countFigure('in2bOnly', 'Invoices in GSTR-2B only', count('gstr2b-only'), 'count'), countFigure('probable', 'Probable matches to confirm', count('probable'), 'count'),
    countFigure('invalid', 'Lines set aside', result.invalid.length, 'count'), countFigure('creditAtRiskUnknownTax', 'Books-only invoices whose tax is unknown', result.creditAtRisk.linesWithUnknownTax, 'count'),
  ];
  const gaps = [...result.notices]; if (result.creditAtRisk.linesWithUnknownTax) gaps.push('Some invoices in the books only do not state their tax; the credit at risk leaves them out and is not their zero.');
  const factRows = (list: (Side | null)[]) => list.filter((s): s is Side => !!s).map(s => ({ fact: byId.get(s.factId)!, amountMinor: s.taxableMinor }));
  const common = { requestedSourceIds: sourceIds, period, branch: null, asOf: selection.asOf, conflicts: selection.conflicts.length, partial: false };
  const groupRequest = { calc: 'gstr2b_match', registerSourceId, gstr2bSourceId, period, toleranceMinor: String(tolerance) };
  const group = buildReceipt(ctx, setup.state, setup.dictionary, { ...common, operation: 'gstr2b_match', figures, missingFigures: [], rows: factRows([...books, ...twoB]), exclusions,
    selectedRows: selection.facts.length, notCounted, gaps, valueMinor: result.creditAtRisk.taxMinor, request: groupRequest,
    assumptions: { toleranceMinor: String(tolerance), key: 'supplier GSTIN | invoice number | financial year', lineReceipts: `At most ${MAX_MATCH_LINES} purchase lines are matched in one request.` } });
  const lineReceipts = items.map(item => {
    const b = item.books, t = item.twoB, lineFigures: Figure[] = [], missing: MissingFigure[] = [];
    const put = (key: string, label: string, value: string | null, why: MissingFigure['missing'], reason: string) => value === null ? missing.push(missingFigure(key, label, why, reason)) : lineFigures.push(money(key, label, BigInt(value), currency));
    put('booksTaxable', 'Taxable value in the books', b?.taxableMinor ?? null, 'absent', 'This invoice is not in the purchase register.');
    put('gstr2bTaxable', 'Taxable value in GSTR-2B', t?.taxableMinor ?? null, 'absent', 'This invoice is not in GSTR-2B.');
    put('difference', 'GSTR-2B minus books', b && t ? String(BigInt(t.taxableMinor) - BigInt(b.taxableMinor)) : null, 'not-applicable', 'The invoice is on one side only.');
    put('booksTax', 'Tax in the books', b ? b.taxMinor : null, b ? 'unknown' : 'absent', b ? 'The register line does not state its tax.' : 'This invoice is not in the purchase register.');
    put('gstr2bTax', 'Tax in GSTR-2B', t ? t.taxMinor : null, t ? 'unknown' : 'absent', t ? 'The GSTR-2B line does not state its tax.' : 'This invoice is not in GSTR-2B.');
    put('taxDifference', 'Tax in GSTR-2B minus tax in the books', b?.taxMinor != null && t?.taxMinor != null ? String(BigInt(t.taxMinor) - BigInt(b.taxMinor)) : null, b && t ? 'unknown' : 'not-applicable', b && t ? 'A side does not state its tax.' : 'The invoice is on one side only.');
    const request = { calc: 'gstr2b_line', registerSourceId, gstr2bSourceId, period, toleranceMinor: String(tolerance), key: item.key };
    const receipt = buildReceipt(ctx, setup.state, setup.dictionary, { ...common, operation: 'gstr2b_line', figures: lineFigures, missingFigures: missing, rows: factRows([b, t]), exclusions: [],
      selectedRows: [b, t].filter(Boolean).length, notCounted: 0, gaps: [`${LINE_LABELS[item.group]}.`], valueMinor: b && t ? String(BigInt(t.taxableMinor) - BigInt(b.taxableMinor)) : (b ?? t)!.taxableMinor, request,
      assumptions: { key: item.key, group: item.group, ...(item.rule ? { rule: item.rule } : {}), toleranceMinor: String(tolerance) } });
    return { key: item.key, receipt, request };
  });
  const ids = await storeReceipts(ctx, host.store, setup.calculator, [{ receipt: group, request: groupRequest }, ...lineReceipts.map(l => ({ receipt: l.receipt, request: l.request }))],
    { snapshot: setup.snapshot, dictionaryHash: setup.dictionary.hash, sourceIds, branch: null });
  return { receiptId: ids[0], lines: lineReceipts.map((line, index) => ({ key: line.key, receiptId: ids[index + 1] })) };
}
