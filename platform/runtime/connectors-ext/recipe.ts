import { check, ChausarError, hash } from '../contracts.ts';
import { digest } from '../actions.ts';
import { norm } from './tabular.ts';
import { DATE_FORMATS, parseDate, parseInteger, parseMoney, type DateFormat } from './values.ts';
import type { Abstention, CanonicalRecord, Check, DecodedTable, RawRow, RecipeOutcome, Refusal, SourceTotals } from './types.ts';

/**
 * The mapping language for source exports: typed data, interpreted by this one engine.
 * A recipe names columns by their source headings, maps source words to dictionary words,
 * and must say which of the source's own totals it is checked against.
 */
export type FieldType = 'text' | 'money' | 'date' | 'integer';
export type FieldSpec = { from: readonly string[]; type: FieldType; required?: boolean; dateFormats?: readonly DateFormat[] };
export type TotalsSpec =
  /** A labelled row after the table ("Total", "Grand Total") carries the source's own sums. */
  | { kind: 'footer-row'; labelField: string; labels: readonly string[]; amountFields: readonly string[]; countField?: string }
  /** The decoder read a structured total from the source (a JSON summary, a declared API count). */
  | { kind: 'declared' }
  /** Bank statements: opening plus every entry must equal each running balance and the closing balance. */
  | { kind: 'running-balance'; balanceField: string }
  /** The person types the total shown by the system's own report. */
  | { kind: 'report' };
export type MeasureSpec =
  | { type: 'money'; amount: { field: string } | { credit: string; debit: string }; currency: { constant: string } | { field: string }; unit: 'major' | 'minor' }
  | { type: 'count'; field: string; unit: string };
export type SourceRecipe = {
  id: string; version: string; group: string; operation: string; title: string;
  /** Registered decoder id. Source bytes never choose decoder code. */
  decoder: string;
  /** Header groups that identify the table row when exports carry title lines above it. */
  header?: readonly (readonly string[])[];
  /** JSON decoders: the path to the record array; `*` steps into every array element. */
  records?: readonly string[];
  fields: Readonly<Record<string, FieldSpec>>;
  measure: MeasureSpec;
  identity: readonly string[];
  kind: { constant: string } | { field: string; values: Readonly<Record<string, string>> };
  status?: { field: string; values: Readonly<Record<string, string>> };
  /** Rows whose field holds one of these (normalized) values are not imported, and are counted as excluded. */
  exclude?: { field: string; values: readonly string[] };
  /** A Dr/Cr style column that sets the sign of the measure. */
  sign?: { field: string; negative: readonly string[]; positive: readonly string[] };
  /** Canonical output field to recipe field. Money outputs are converted to minor units. */
  outputs?: Readonly<Record<string, string>>;
  totals: TotalsSpec;
  ignored?: readonly string[];
  notices?: readonly string[];
  sensitivity: 'financial' | 'personal' | 'operational';
};
export type DecoderInput = { text?: string; rows?: readonly (readonly string[])[]; records?: readonly Record<string, unknown>[]; meta?: Record<string, string> };
export type Decoder = { id: string; version: string; accepts: 'text' | 'rows' | 'records'; decode(input: DecoderInput, recipe: SourceRecipe): DecodedTable };
export type RunOptions = { reportTotals?: { rowCount: number | null; total: string }; fileName?: string };

const ID = /^[a-z][a-z0-9.-]{1,80}$/;
const KIND = /^[a-z][a-z0-9_]{0,63}$/;
const OUTPUTS = new Set(['customerId', 'customerName', 'invoiceId', 'orderId', 'dueDate', 'status', 'description', 'gstin', 'pan', 'taxMinor',
  'sku', 'marketplace', 'shippingMinor', 'feeMinor', 'marketingMinor', 'bankReference', 'company', 'costType', 'accountClass', 'unit',
  'paymentMethod', 'outletId', 'subscriptionId', 'projectId', 'quantity', 'stockQuantity']);
const STATUS = /^[a-z][a-z_]{0,40}$|^$/;

/** A recipe compiles only as plain data with a stated source-total check and exact identity. */
export function compileRecipe(recipe: SourceRecipe, decoders: ReadonlyMap<string, Decoder>): SourceRecipe {
  check(recipe && typeof recipe === 'object', 'RECIPE_INVALID', 'A recipe is a data record.');
  let copy: SourceRecipe;
  try { copy = JSON.parse(JSON.stringify(recipe)); } catch { throw new ChausarError('RECIPE_CODE_FORBIDDEN', 'Recipes hold data only.'); }
  check(digest(copy) === digest(JSON.parse(JSON.stringify(copy))) && hash(JSON.stringify(copy)) === hash(JSON.stringify(recipe)), 'RECIPE_CODE_FORBIDDEN', 'Recipes hold data only, never functions or code.');
  check(ID.test(copy.id) && /^\d+(?:\.\d+){0,2}$/.test(copy.version) && ID.test(copy.group) && ID.test(copy.operation) && typeof copy.title === 'string' && copy.title.length > 0 && copy.title.length <= 120, 'RECIPE_INVALID', 'A recipe needs an id, version, group, operation and title.');
  check(decoders.has(copy.decoder), 'RECIPE_DECODER_UNKNOWN', 'A recipe must name a registered decoder.');
  check(['financial', 'personal', 'operational'].includes(copy.sensitivity), 'RECIPE_INVALID', 'Mark how sensitive the data is.');
  const fields = copy.fields; check(fields && typeof fields === 'object' && Object.keys(fields).length > 0 && Object.keys(fields).length <= 80, 'RECIPE_INVALID', 'Name the fields the recipe reads.');
  for (const [name, spec] of Object.entries(fields)) {
    check(/^[a-z][a-zA-Z0-9]{0,40}$/.test(name) && Array.isArray(spec.from) && spec.from.length > 0 && spec.from.every(alias => typeof alias === 'string' && alias.length > 0 && alias.length <= 120)
      && ['text', 'money', 'date', 'integer'].includes(spec.type), 'RECIPE_FIELD_INVALID', 'Each field needs typed source headings.');
    check(new Set(spec.from.map(norm)).size === spec.from.length, 'RECIPE_FIELD_INVALID', 'A field lists the same heading twice.');
    if (spec.type === 'date') check(Array.isArray(spec.dateFormats) && spec.dateFormats.length > 0 && spec.dateFormats.every(f => DATE_FORMATS.includes(f)), 'RECIPE_DATE_FORMAT_REQUIRED', 'Every date field states its formats.');
  }
  const known = (name: string, types?: FieldType[]) => Object.hasOwn(fields, name) && (!types || types.includes(fields[name].type));
  check(Array.isArray(copy.identity) && copy.identity.length > 0 && copy.identity.every(name => known(name)), 'RECIPE_IDENTITY_REQUIRED', 'A recipe names the fields that identify one record.');
  check(known('date', ['date']), 'RECIPE_DATE_REQUIRED', 'A recipe needs a typed business date field named date.');
  const m = copy.measure;
  if (m.type === 'money') {
    check(['major', 'minor'].includes(m.unit) && ('field' in m.amount ? known(m.amount.field, ['money']) : known(m.amount.credit, ['money']) && known(m.amount.debit, ['money'])), 'RECIPE_MEASURE_INVALID', 'The amount must be a money field.');
    check('constant' in m.currency ? /^[A-Z]{3}$/.test(m.currency.constant) : known(m.currency.field, ['text']), 'RECIPE_CURRENCY_REQUIRED', 'State the currency or the field that holds it.');
  } else check(m.type === 'count' && known(m.field, ['integer']) && /^[a-z][a-z_]{0,30}$/.test(m.unit), 'RECIPE_MEASURE_INVALID', 'A count needs an integer field and a unit.');
  check('constant' in copy.kind ? KIND.test(copy.kind.constant) : known(copy.kind.field) && Object.keys(copy.kind.values).length > 0 && Object.values(copy.kind.values).every(v => KIND.test(v)), 'RECIPE_KIND_INVALID', 'Map every source record type to a dictionary kind.');
  if (copy.status) check(known(copy.status.field) && Object.keys(copy.status.values).length > 0 && Object.values(copy.status.values).every(v => STATUS.test(v)), 'RECIPE_STATUS_INVALID', 'Map every source status to a dictionary status.');
  if (copy.exclude) check(known(copy.exclude.field) && copy.exclude.values.length > 0, 'RECIPE_INVALID', 'Exclusions name a field and values.');
  if (copy.sign) check(known(copy.sign.field) && copy.sign.negative.length > 0 && copy.sign.positive.length > 0, 'RECIPE_SIGN_INVALID', 'A sign column lists both its debit and credit words.');
  for (const [target, source] of Object.entries(copy.outputs ?? {})) check(OUTPUTS.has(target) && (target === 'status' ? !!copy.status : known(source)), 'RECIPE_OUTPUT_INVALID', 'Outputs are dictionary fields read from named recipe fields.');
  const t = copy.totals;
  check(t && ['footer-row', 'declared', 'running-balance', 'report'].includes(t.kind), 'RECIPE_TOTALS_REQUIRED', 'A recipe without its check against the source\'s own totals does not compile.');
  if (t.kind === 'footer-row') check(known(t.labelField) && t.labels.length > 0 && t.amountFields.length > 0 && t.amountFields.every(f => known(f, m.type === 'money' ? ['money'] : ['integer'])) && (!t.countField || known(t.countField, ['integer'])), 'RECIPE_TOTALS_REQUIRED', 'The total row names its label and amount columns.');
  if (t.kind === 'running-balance') check(m.type === 'money' && known(t.balanceField, ['money']), 'RECIPE_TOTALS_REQUIRED', 'A running balance needs a money balance column.');
  if (copy.records) check(Array.isArray(copy.records) && copy.records.every(step => typeof step === 'string' && step.length > 0 && step.length <= 80 && !['__proto__', 'prototype', 'constructor'].includes(step)), 'RECIPE_INVALID', 'A record path holds plain keys.');
  return Object.freeze(copy);
}

class Stop extends Error {
  readonly refusal?: Refusal; readonly abstention?: Abstention;
  constructor(refusal?: Refusal, abstention?: Abstention) { super('recipe stopped'); this.refusal = refusal; this.abstention = abstention; }
}
const refuse = (code: string, reason: string, line?: number): never => { throw new Stop({ code, reason, ...(line ? { line } : {}) }); };
const abstain = (a: Abstention): never => { throw new Stop(undefined, a); };
const QUESTIONS: Record<Abstention['reason'], string> = {
  ambiguous_field: 'Two columns could hold this field. Which one does?',
  unknown_value: 'This value has no meaning in the recipe yet. What does it mean?',
  date_format: 'These dates can be read two ways. Which order is the day and month in?',
  currency: 'The file does not say its currency. Which currency is it in?',
  sign_convention: 'The file does not say which entries are money in and which are money out. Which is which?',
};
const ask = (reason: Abstention['reason'], field: string, options: string[]): never => abstain({ reason, field, question: QUESTIONS[reason], options: options.slice(0, 20) });

/** Run one recipe over decoded rows and check the result against the source's own totals. */
export function runRecipe(recipe: SourceRecipe, decoder: Decoder, input: DecoderInput, options: RunOptions = {}): RecipeOutcome {
  const contentHash = hash(input.text ?? JSON.stringify(input.rows ?? input.records ?? []));
  const unit = recipe.measure.type === 'money' ? ('constant' in recipe.measure.currency ? recipe.measure.currency.constant : 'source-currency') : recipe.measure.unit;
  const outcome: RecipeOutcome = { status: 'accepted', recipe: { id: recipe.id, version: recipe.version, group: recipe.group, operation: recipe.operation, measure: recipe.measure.type, digest: digest(recipe) },
    records: [], observed: { rowCount: 0, total: '0', unit }, sourceTotals: null, checks: [], unmappedFields: [], excludedRows: 0, refusal: null, abstention: null, period: null, contentHash, notices: [...(recipe.notices ?? [])] };
  try {
    let table: DecodedTable;
    try { table = decoder.decode(input, recipe); }
    catch (error) { if (error instanceof Stop) throw error; const code = (error as any)?.code; const line = (error as any)?.line; refuse(typeof code === 'string' ? code : 'MALFORMED_SOURCE', typeof code === 'string' && (error as Error).message ? (error as Error).message : 'The file could not be read with this recipe.', Number.isSafeInteger(line) && line > 0 ? line : undefined); }
    const columns: Record<string, string | null> = {};
    const headers = new Map(table!.headers.map(h => [norm(h), h]));
    for (const [name, spec] of Object.entries(recipe.fields)) {
      const found = [...new Set(spec.from.map(norm).filter(alias => headers.has(alias)).map(alias => headers.get(alias)!))];
      if (found.length > 1) ask('ambiguous_field', name, found);
      if (!found.length && spec.required) refuse('REQUIRED_COLUMN_MISSING', 'A column this recipe needs is missing. The export may be from another report or version.');
      columns[name] = found[0] ?? null;
    }
    const used = new Set(Object.values(columns).filter(Boolean).map(h => norm(h!))), ignored = new Set((recipe.ignored ?? []).map(norm));
    outcome.unmappedFields = table!.headers.filter(h => !used.has(norm(h)) && !ignored.has(norm(h)));
    const cell = (row: RawRow, name: string): string => { const header = columns[name]; return header ? (row.cells[header] ?? '').trim() : ''; };
    const m = recipe.measure;
    const currencyOf = (row: RawRow): string => {
      if (m.type !== 'money') return '';
      if ('constant' in m.currency) return m.currency.constant;
      const value = cell(row, m.currency.field).toUpperCase();
      if (!value) ask('currency', m.currency.field, []);
      if (!/^[A-Z]{3}$/.test(value)) refuse('INVALID_CURRENCY', 'A currency is not an ISO code.', row.line);
      return value;
    };
    const money = (row: RawRow, name: string, currency: string): string | null => {
      try { return parseMoney(cell(row, name), m.type === 'money' ? m.unit : 'major', currency); }
      catch { return refuse('INVALID_MONEY', 'An amount is not exact decimal money.', row.line); }
    };
    // Footers: decoder-split rows, plus every row from the first labelled total onward.
    const t = recipe.totals; let body = table!.rows, footers = [...table!.footers];
    if (t.kind === 'footer-row') {
      const labels = new Set(t.labels.map(norm));
      const at = body.findIndex(row => labels.has(norm(cell(row, t.labelField))));
      if (at >= 0) { footers = [...body.slice(at), ...footers]; body = body.slice(0, at); }
    }
    const records = new Map<string, CanonicalRecord>(); let total = 0n, firstCurrency: string | null = null; const dates: string[] = [];
    let previousBalance: bigint | null = null; const balanceStart = table!.balances?.opening ?? null;
    for (const row of body) {
      if (recipe.exclude && recipe.exclude.values.map(norm).includes(norm(cell(row, recipe.exclude.field)))) { outcome.excludedRows++; continue; }
      const parsed: Record<string, string> = {};
      for (const [name, spec] of Object.entries(recipe.fields)) {
        const raw = cell(row, name);
        if (spec.type === 'date' && raw) {
          const { date, readings } = parseDate(raw, spec.dateFormats!);
          if (readings.length > 1) ask('date_format', name, readings);
          if (!date) refuse('INVALID_DATE', 'A date does not match the formats this recipe states.', row.line);
          parsed[name] = date!;
        } else if (spec.type === 'integer' && raw) {
          try { parsed[name] = parseInteger(raw)!; } catch { refuse('INVALID_INTEGER', 'A count is not a whole number.', row.line); }
        } else parsed[name] = raw;
        if (spec.required && !parsed[name] && spec.type !== 'money') refuse('MISSING_VALUE', 'A required value is empty.', row.line);
      }
      if (!parsed.date) refuse('MISSING_VALUE', 'A row has no business date.', row.line);
      let kind: string;
      if ('constant' in recipe.kind) kind = recipe.kind.constant;
      else {
        const value = norm(cell(row, recipe.kind.field)), map = Object.fromEntries(Object.entries(recipe.kind.values).map(([k, v]) => [norm(k), v]));
        if (!Object.hasOwn(map, value)) ask('unknown_value', recipe.kind.field, [cell(row, recipe.kind.field)]);
        kind = map[value];
      }
      let quantity: bigint, currency = '';
      if (m.type === 'money') {
        currency = currencyOf(row);
        if ('field' in m.amount) {
          const amount = money(row, m.amount.field, currency);
          if (amount === null) refuse('MISSING_AMOUNT', 'A row has no amount. A missing amount is not counted as zero.', row.line);
          quantity = BigInt(amount!);
        } else {
          const credit = money(row, m.amount.credit, currency), debit = money(row, m.amount.debit, currency);
          if (credit === null && debit === null) refuse('MISSING_AMOUNT', 'A row has neither a money-in nor a money-out amount.', row.line);
          if (credit !== null && debit !== null && BigInt(credit) !== 0n && BigInt(debit) !== 0n) refuse('AMBIGUOUS_MOVEMENT', 'A row has both a money-in and a money-out amount.', row.line);
          const c = BigInt(credit ?? '0'), d = BigInt(debit ?? '0');
          if (c < 0n || d < 0n) refuse('AMBIGUOUS_MOVEMENT', 'Money-in and money-out amounts must not be negative.', row.line);
          quantity = c - d;
        }
        if (recipe.sign) {
          const word = norm(cell(row, recipe.sign.field));
          const negative = recipe.sign.negative.map(norm).includes(word), positive = recipe.sign.positive.map(norm).includes(word);
          if (negative === positive) ask('sign_convention', recipe.sign.field, [cell(row, recipe.sign.field)]);
          quantity = (quantity < 0n ? -quantity : quantity) * (negative ? -1n : 1n);
        }
      } else {
        const value = parsed[m.field];
        if (!value) refuse('MISSING_AMOUNT', 'A row has no count. A missing count is not counted as zero.', row.line);
        quantity = BigInt(value);
      }
      if (t.kind === 'running-balance') {
        const balance = money(row, t.balanceField, currency);
        if (balance === null) refuse('BALANCE_MISSING', 'A statement row has no running balance.', row.line);
        const opening = previousBalance === null && balanceStart !== null ? parseMoney(balanceStart, 'major', currency) : null;
        if (previousBalance === null && balanceStart !== null && opening === null) refuse('BALANCE_MISSING', 'The statement states an opening balance without a figure.');
        const expected = previousBalance === null ? (opening !== null ? BigInt(opening) + quantity : null) : previousBalance + quantity;
        if (expected !== null && expected !== BigInt(balance!)) {
          outcome.checks.push({ id: 'running-balance', status: 'failed', expected: String(expected), observed: balance, line: row.line });
          refuse('BALANCE_BROKEN', 'The running balance breaks at this line. An entry before it is missing or changed.', row.line);
        }
        if (previousBalance === null && balanceStart === null) outcome.checks.push({ id: 'opening-balance', status: 'passed', expected: String(BigInt(balance!) - quantity), observed: String(BigInt(balance!) - quantity), line: row.line });
        previousBalance = BigInt(balance!);
      }
      const identity = recipe.identity.map(name => parsed[name] ?? '');
      if (identity.some(value => value === '')) refuse('IDENTITY_MISSING', 'A row is missing a value that identifies it.', row.line);
      const fields: Record<string, string> = {};
      for (const [target, source] of Object.entries(recipe.outputs ?? {})) {
        if (target === 'status') continue;
        const spec = recipe.fields[source]; const raw = parsed[source];
        if (!raw) continue;
        if (spec.type === 'money' && !currency) continue; // a count recipe has no currency to read money outputs in
        fields[target] = spec.type === 'money' ? (money(row, source, currency) ?? '') : raw;
        if (fields[target] === '') delete fields[target];
      }
      if (recipe.status) {
        const value = norm(cell(row, recipe.status.field)), map = Object.fromEntries(Object.entries(recipe.status.values).map(([k, v]) => [norm(k), v]));
        if (!Object.hasOwn(map, value)) ask('unknown_value', recipe.status.field, [cell(row, recipe.status.field)]);
        if (map[value]) fields.status = map[value];
      }
      const entityId = `${recipe.group}:${identity.join('|')}`;
      if (entityId.length > 400) refuse('IDENTITY_TOO_LONG', 'A row\'s identifying values are too long to tell records apart.', row.line);
      const record: CanonicalRecord = { entityId, kind, date: parsed.date, sourceRow: row.line, fields,
        measure: m.type === 'money' ? { type: 'money', amountMinor: String(quantity), currency } : { type: 'count', quantity: String(quantity), unit: m.unit } };
      const key = `${kind}:${entityId}`, prior = records.get(key);
      if (prior) {
        const same = digest({ ...prior, sourceRow: 0 }) === digest({ ...record, sourceRow: 0 });
        if (!same) refuse('DUPLICATE_SOURCE_ROW', 'Two rows have the same identity and different values.', row.line);
        outcome.notices.push('A repeated row was counted once.');
        continue;
      }
      if (m.type === 'money' && firstCurrency !== null && firstCurrency !== currency) refuse('MIXED_CURRENCY', 'One file mixes currencies. Import each currency separately.', row.line);
      if (firstCurrency === null) firstCurrency = currency;
      records.set(key, record); total += quantity;
      dates.push(parsed.date);
    }
    outcome.records = [...records.values()];
    outcome.observed = { rowCount: outcome.records.length, total: String(total), unit: m.type === 'money' ? (outcome.records[0]?.measure as any)?.currency ?? unit : m.unit };
    dates.sort(); outcome.period = dates.length ? { from: dates[0], to: dates.at(-1)! } : null;
    if (!outcome.records.length) refuse('EMPTY_SOURCE', 'The file has no rows to import.');
    const currency = m.type === 'money' ? (outcome.records[0].measure as any).currency as string : 'INR';
    const compare = (expectedRows: number | null, expectedTotal: string | null, totals: SourceTotals) => {
      outcome.sourceTotals = totals;
      outcome.checks.push({ id: 'source-total', status: expectedTotal === null ? 'unavailable' : expectedTotal === String(total) ? 'passed' : 'failed', expected: expectedTotal, observed: String(total) });
      outcome.checks.push({ id: 'source-row-count', status: expectedRows === null ? 'unavailable' : expectedRows === outcome.records.length ? 'passed' : 'failed', expected: expectedRows, observed: outcome.records.length });
      if (expectedTotal === null && expectedRows === null) refuse('SOURCE_TOTALS_REQUIRED', 'The source did not state its own total. Enter the total from the system\'s own report.');
      if (expectedRows !== null && expectedRows !== outcome.records.length) refuse('SOURCE_ROW_MISMATCH', 'The row count differs from the source\'s own report. The file may be cut short or filtered.');
      if (expectedTotal !== null && expectedTotal !== String(total)) refuse('SOURCE_TOTAL_MISMATCH', 'The total differs from the source\'s own report. The file may be cut short or filtered.');
      if (expectedTotal === null) refuse('SOURCE_TOTALS_REQUIRED', 'The source stated a row count but no amount. Enter the total from the system\'s own report.');
    };
    if (t.kind === 'footer-row') {
      const labels = new Set(t.labels.map(norm)), footer = footers.find(row => labels.has(norm(cell(row, t.labelField))));
      if (!footer) { outcome.checks.push({ id: 'source-total', status: 'unavailable' }); refuse('SOURCE_CUT_SHORT', 'The source\'s own total row is missing. The file looks cut short or was exported without totals.'); }
      let expected = 0n, any = false;
      for (const field of t.amountFields) {
        const value = m.type === 'money' ? money(footer!, field, currency) : (() => { try { return parseInteger(cell(footer!, field)); } catch { return refuse('INVALID_INTEGER', 'The total row holds a value that is not a whole number.', footer!.line); } })();
        if (value !== null) { any = true; expected += BigInt(value); }
      }
      // A credit/debit total row states both sums; the signed total is money in minus money out.
      if (m.type === 'money' && 'credit' in m.amount && t.amountFields.length === 2) {
        const credit = money(footer!, m.amount.credit, currency), debit = money(footer!, m.amount.debit, currency);
        expected = BigInt(credit ?? '0') - BigInt(debit ?? '0'); any = credit !== null || debit !== null;
      }
      let rows: number | null = null;
      if (t.countField) { const value = (() => { try { return parseInteger(cell(footer!, t.countField!)); } catch { return null; } })(); rows = value === null ? null : Number(value); }
      compare(rows, any ? String(expected) : null, { rowCount: rows, total: any ? String(expected) : null, reference: 'total-row', provenance: 'in-file-total' });
    } else if (t.kind === 'declared') {
      const declared = table!.declared;
      if (!declared) { outcome.checks.push({ id: 'source-total', status: 'unavailable' }); refuse('SOURCE_CUT_SHORT', 'The source\'s own summary is missing. The file looks cut short.'); }
      let amount: string | null = null;
      if (declared!.amount !== null) {
        try { amount = m.type === 'money' ? parseMoney(declared!.amount, declared!.amountUnit, currency) : parseInteger(declared!.amount); }
        catch { refuse('INVALID_MONEY', 'The source summary holds an amount that is not exact.'); }
      }
      compare(declared!.rowCount, amount, { rowCount: declared!.rowCount, total: amount, reference: declared!.reference, provenance: 'source-declared' });
    } else if (t.kind === 'running-balance') {
      const closing = table!.balances?.closing ?? null;
      if (closing === null) { outcome.checks.push({ id: 'closing-balance', status: 'unavailable' }); refuse('SOURCE_CUT_SHORT', 'The statement\'s closing balance is missing. The statement looks cut short.'); }
      const closingMinor = parseMoney(closing!, 'major', currency);
      const passed = closingMinor !== null && previousBalance !== null && BigInt(closingMinor) === previousBalance;
      outcome.checks.push({ id: 'closing-balance', status: passed ? 'passed' : 'failed', expected: closingMinor, observed: previousBalance === null ? null : String(previousBalance) });
      outcome.sourceTotals = { rowCount: null, total: closingMinor, reference: 'statement-closing-balance', provenance: 'balance-continuity' };
      if (!passed) refuse('BALANCE_CLOSING_MISMATCH', 'Opening balance plus every entry does not equal the closing balance. The statement may be cut short.');
    } else {
      const report = options.reportTotals;
      if (!report) { outcome.checks.push({ id: 'source-total', status: 'unavailable' }); refuse('SOURCE_TOTALS_REQUIRED', 'Enter the total from the system\'s own report before this file can count.'); }
      check(typeof report!.total === 'string' && /^-?\d{1,30}$/.test(report!.total) && (report!.rowCount === null || (Number.isSafeInteger(report!.rowCount) && report!.rowCount >= 0)), 'INVALID_SOURCE_TOTALS', 'Report totals are a whole minor-unit amount and an optional row count.');
      compare(report!.rowCount, report!.total, { rowCount: report!.rowCount, total: report!.total, reference: 'report-entered-by-person', provenance: 'user-entered-report' });
    }
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    outcome.status = error.refusal ? 'refused' : 'abstained';
    outcome.refusal = error.refusal ?? null; outcome.abstention = error.abstention ?? null;
  }
  return outcome;
}
