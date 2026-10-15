import { authorize, audit, check, hash, newId, now, type Context, type Fact, type State, type StateStore } from './contracts.ts';
import { canSeeFact, currentAccess, selectFacts, validDate, validatePeriod, type FactFilter, type Period } from './memory.ts';
import { OntologyService, type Definition } from './ontology.ts';
import { currencyMinorDigits, formatMinor } from './currency.ts';
import { assertCompiledSingleSum, compileSingleSum, type CompiledCalculationBinding, type CompiledSingleSum } from './compiled-calculation.ts';
import { assertSourceAccess, withheldMeasure } from './trust.ts';
import { resolveCoreOperationAlias } from './core-operation-aliases.ts';
import { quantityOf, stockOnHand } from './stock-on-hand.ts';

export type CalculationRequest = FactFilter & { operation: string; sourceIds?: string[]; comparePeriod?: Period; onDate?: string; assumptions?: { priceChangeBps: string } };
export type Figure = { key: string; label: string; minor: string; display: string; unit: 'money' | 'basis-points'; currency?: string };
/** `quantity` figures are whole item counts in `quantityUnit` (stock on hand); `count` figures count lines or entries. Neither is money.
 *  They appear only on stock-on-hand and connector receipts; they are kept out of `Figure` so existing money readers keep their exact type,
 *  and a reader of those receipts must accept `ReceiptFigure`. */
export type CountFigure = { key: string; label: string; minor: string; display: string; unit: 'quantity' | 'count'; quantityUnit?: string };
export type ReceiptFigure = Figure | CountFigure;
/** A quantity or count figure inside a receipt's figure list (see `CountFigure`). */
export const countFigure = (key: string, label: string, value: bigint | number, unit: 'quantity' | 'count', quantityUnit?: string): Figure =>
  ({ key, label, minor: String(value), display: quantityUnit ? `${value} ${quantityUnit}` : String(value), unit, ...(quantityUnit ? { quantityUnit } : {}) } as CountFigure as unknown as Figure);
/** A figure a receipt cannot give, in words: never zero. */
export type MissingFigure = { key: string; label: string; missing: 'not-loaded-yet' | 'absent' | 'unknown' | 'not-applicable' | 'not-counted'; reason: string };
export type ReceiptRow = { factId: string; entityId: string; sourceId: string; sourceRow: number; kind: string; amountMinor: string; measureField?: string; validFrom: string; dueDate?: string; invoiceId?: string; customerId?: string; orderId?: string; status?: string; branch?: string; normalization?: { sourceCurrency: string; targetCurrency: string; rate: unknown }; sourceAmountMinor?: string; item?: string; quantityUnit?: string };
export type CalculationReceipt = { id: string; memberId: string; epoch: number; sourceIds: string[]; requestedSourceIds?: string[]; operation: string; createdAt: string; asOf: string; period: Period | null; comparePeriod: Period | null; branch: string | null; currency: string; ontologyVersion: number; dictionaryHash: string; definitionHash: string; definitions: Definition[]; compiledCalculation?: CompiledCalculationBinding; figures: Figure[]; valueMinor: string; totalMinor: string; rowIds: string[]; rows: ReceiptRow[]; exclusions: { rowId: string; reason: string }[]; coverage: { selectedRows: number; countedRows: number; excludedRows: number; unresolvedConflicts: number; importIds: string[]; completeness: 'reconciled-imports' | 'unreconciled-facts' | 'empty' | 'partial'; gaps: string[]; notCounted?: number }; assumptions: Record<string, unknown>; explanation: string; stale: boolean; staleReason?: string; allowedNumbers: string[]; databaseProof?: unknown; restatement?: ReceiptRestatement; missingFigures?: MissingFigure[]; provenance?: ReceiptProvenance };
/** Who and what stood behind a receipt, recorded when it is made (core-data `receipts.provenance`). Absent on receipts made before it existed. */
export type ReceiptProvenance = {
  recipes?: { sourceId: string; recipeId: string; acceptedBy: string | null; acceptedAt: string | null }[];
  meaning?: { publishedBy: string; reviewedBy: string | null; coSignedBy: string | null; reviewedAt: string | null };
  forecast?: { method: string; learnedFrom: { from: string; to: string }; testedOn: { from: string; to: string } } | null;
  allowedBy?: { ruleId: string; check: string; device: 'desktop' | 'phone' | 'mcp'; memberId: string; at: string };
};
/** Adds `provenance` to a receipt as it is made, from the calculation's own state snapshot. Must not change any figure. */
export type ReceiptDecorator = (ctx: Context, receipt: CalculationReceipt, state: State) => void;
const receiptDecorators = new Set<ReceiptDecorator>();
export function registerReceiptDecorator(decorator: ReceiptDecorator): void { receiptDecorators.add(decorator); }
/** Runs the registered decorators on a receipt made outside `calculate` (core-data's connector and GST receipts). */
export function decorateReceipt(ctx: Context, receipt: CalculationReceipt, state: State): void { for (const decorate of receiptDecorators) decorate(structuredClone(ctx), receipt, state); }
export type CalculatorOptions = {
  /** Trusted publication context only, never a caller-authored calculation parameter. */
  restatement?: ReceiptRestatement;
  verifier?: (receipt: CalculationReceipt) => Promise<unknown>;
  consumerGuard?: (context: Context, request: CalculationRequest) => void;
  receiptGuard?: (context: Context, receipt: CalculationReceipt) => void;
};
export type ReceiptRestatement = { version: 1; interpretation: 'restated-private-diagnostic'; trialId: string; forkDigest: string;
  candidateStateDigest: string; publicationId: string; originalAnswerId: string; originalReceiptId: string };
export function formatMoney(n: string | bigint, currency = 'INR') { return formatMinor(n, currency); }
export function sumMoney(values: string[]) { return String(values.reduce((sum, value) => { check(/^-?\d+$/.test(value), 'INVALID_MINOR_UNITS', 'Calculator amounts must be whole minor-unit strings.'); return sum + BigInt(value); }, 0n)); }
const moneyFigure = (key: string, label: string, value: bigint, currency: string): Figure => ({ key, label, minor: String(value), display: formatMoney(value, currency), unit: 'money', currency });
/**
 * Exchange rates (BK-19). The calculator never fetches a rate and never imports a lane: one reader of the owner's
 * dated rate table is registered here (core-data registers work-books' `books.setRate` table). A rate is exact:
 * `units` of the dictionary currency (major units) for `per` units of the row's currency, both whole-number strings.
 * A row converts only with the rate dated on its own event day; there is no nearest-date rule. A row without one
 * is not counted, with its reason, and the receipt says how many (`coverage.notCounted`).
 */
export type RateLike = { currency: string; on: string; units: string; per: string; source: string };
let rateSource: ((state: State) => readonly RateLike[]) | null = null;
export function registerRateSource(reader: ((state: State) => readonly RateLike[]) | null) { rateSource = reader; }
export function ratesOf(state: State): readonly RateLike[] { try { const list = rateSource?.(state); return Array.isArray(list) ? list : []; } catch { return []; } }
export const NO_RATE_REASON = 'No exchange rate is recorded for this currency on this date, so this amount is not counted.';
export const NOT_COUNTED_GAP = 'Some amounts in another currency have no exchange rate for their date and are not counted. The receipt gives how many; they are not zero.';
const wholeRate = /^[1-9]\d{0,17}$/;
/** Exact conversion to the nearest minor unit of the target currency, halves rounded away from zero (the importer's `half-up`). */
export function convertMinor(amount: bigint, fromCurrency: string, toCurrency: string, rate: { units: string; per: string }): bigint {
  check(wholeRate.test(rate.units) && wholeRate.test(rate.per), 'INVALID_EXCHANGE_RATE', 'Exchange rates need two exact positive whole numbers.');
  const numerator = amount * BigInt(rate.units) * 10n ** BigInt(currencyMinorDigits(toCurrency)), denominator = BigInt(rate.per) * 10n ** BigInt(currencyMinorDigits(fromCurrency));
  const remainder = numerator % denominator; let result = numerator / denominator;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= denominator) result += numerator < 0n ? -1n : 1n;
  return result;
}
export type Converted = { amount: bigint; sourceAmountMinor?: string; normalization?: NonNullable<ReceiptRow['normalization']> } | { notCounted: string };
/** One exact money value of a fact in the dictionary currency, or why it is not counted. Rows converted when read (`_fx`) are already in the dictionary currency. */
export function convertFact(state: State, fact: Fact, value: string, currency: string): Converted {
  const from = fact.fields.currency;
  if (from === currency) return { amount: BigInt(value) };
  check(!fact.fields._fx && typeof from === 'string' && /^[A-Z]{3}$/.test(from), 'CURRENCY_MISMATCH', 'Unconverted currencies cannot be added.');
  const on = fact.validFrom.slice(0, 10), rate = ratesOf(state).find(r => r?.currency === from && r.on === on && wholeRate.test(String(r.units)) && wholeRate.test(String(r.per)));
  if (!rate) return { notCounted: NO_RATE_REASON };
  try { currencyMinorDigits(from); } catch { return { notCounted: 'This currency has no qualified minor unit, so this amount is not counted.' }; }
  return { amount: convertMinor(BigInt(value), from, currency, rate), sourceAmountMinor: value,
    normalization: { sourceCurrency: from, targetCurrency: currency, rate: { units: String(rate.units), per: String(rate.per), on: rate.on, source: String(rate.source), rounding: 'half-up' } } };
}
const STOCK_FIGURES = 100;
const units = (figures: Figure[]) => new Set((figures as ReceiptFigure[]).filter(f => f.unit === 'quantity').map(f => (f as CountFigure).quantityUnit)).size;
function bps(numerator: bigint, denominator: bigint): bigint | null { return denominator === 0n ? null : numerator * 10000n / denominator; }
function numericTokens(text: string) { return [...text.matchAll(/(?<![\p{L}\d])[+-]?\d[\d,]*(?:\.\d+)?(?![\p{L}\d])/gu)].map(m => m[0].replaceAll(',', '').replace(/^\+/, '')); }
function normalizedNumber(value: string) { const negative = value.startsWith('-'); const [whole, decimals] = value.replace(/^-/, '').split('.'); return `${negative ? '-' : ''}${BigInt(whole)}${decimals ? '.' + decimals.replace(/0+$/, '') : ''}`.replace(/\.$/, ''); }
export function numberGuard(text: string, receipt: Pick<CalculationReceipt, 'allowedNumbers'>) {
  check(typeof text === 'string', 'INVALID_EXPLANATION', 'An explanation must be text.');
  const allowed = new Set(receipt.allowedNumbers.map(normalizedNumber)); const unsupported = numericTokens(text).filter(n => !allowed.has(normalizedNumber(n)));
  check(unsupported.length === 0, 'UNGROUNDED_NUMBER', 'The explanation contains a number absent from its calculation receipt.'); return { accepted: true, checkedNumbers: numericTokens(text).length };
}
function matchQuestion(question: string, available: string[]): string | null {
  const normalized = question.toLowerCase().replace(/[?!.]/g, '').trim();
  const patterns: Record<string, RegExp> = { billed: /^(?:what (?:was|is) |how much (?:was|is) )?(?:billed|invoiced)(?: revenue| sales| amount)?$/, received: /^(?:what (?:was|is) |how much (?:was|is) )?(?:received|collections|cash received|money received)$/, earned: /^(?:what (?:was|is) |how much (?:was|is) )?earned(?: revenue)?$/, revenue: /^(?:what (?:was|is) (?:the )?|how much (?:was|is) (?:the )?)?revenue$/, refunds: /^(?:what (?:was|is) (?:the )?)?(?:refunds|returns)$/, margin: /^(?:what (?:was|is) (?:the )?)?(?:margin|contribution margin|order margin)$/, aging: /^(?:what (?:was|is) (?:the )?)?(?:aging|receivable aging|unpaid invoices)$/, net_sales: /^(?:what (?:was|is) (?:the )?)?net sales$/, costs: /^(?:what (?:was|is) (?:the )?)?costs$/, purchases: /^(?:what (?:was|is) (?:the )?)?purchases$/ };
  return available.find(id => patterns[id]?.test(normalized)) ?? null;
}

export class CalculatorService {
  store: StateStore;
  verifier?: CalculatorOptions['verifier'];
  consumerGuard?: CalculatorOptions['consumerGuard'];
  receiptGuard?: CalculatorOptions['receiptGuard'];
  readonly restatement?: ReceiptRestatement;
  constructor(store: StateStore, options: CalculatorOptions = {}) {
    this.store = store; this.verifier = options.verifier; this.consumerGuard = options.consumerGuard; this.receiptGuard = options.receiptGuard;
    if (options.restatement) {
      const value = options.restatement;
      check(value.version === 1 && value.interpretation === 'restated-private-diagnostic'
        && Object.keys(value).sort().join(',') === 'candidateStateDigest,forkDigest,interpretation,originalAnswerId,originalReceiptId,publicationId,trialId,version'
        && [value.forkDigest, value.candidateStateDigest].every(pin => /^[a-f0-9]{64}$/.test(pin))
        && [value.trialId, value.publicationId, value.originalAnswerId, value.originalReceiptId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)),
      'RESTATEMENT_CONTEXT_REQUIRED', 'Restated receipts need the exact issued fork, version and original receipt context.');
      this.restatement = structuredClone(value);
    }
  }
  catalog(ctx: Context) { const dictionary = new OntologyService(this.store).current(ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before asking for numbers.'); return dictionary.operations; }
  guard(text: string, receipt: CalculationReceipt) { return numberGuard(text, receipt); }
  async ask(ctx: Context, question: string, filters: Omit<CalculationRequest, 'operation'> = {}) {
    authorize(this.store, ctx); const dictionary = new OntologyService(this.store).current(ctx);
    check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before asking for numbers.');
    const discovery = resolveCoreOperationAlias(question, dictionary);
    const operation = discovery.kind === 'matched' ? discovery.operationId : discovery.kind === 'ambiguous' ? null : matchQuestion(question, dictionary.operations.map(o => o.id));
    if (!operation) {
      await this.store.update(state => { authorize(this.store, ctx); state.unsupported.push({ id: newId('wanted'), at: now(), question, status: 'not-yet', by: ctx.memberId }); });
      return { supported: false, message: 'I cannot calculate that yet. Choose a published calculation and an explicit period; the question was added to the wanted list.', receipt: null };
    }
    const receipt = await this.calculate(ctx, { ...filters, operation }); return { supported: true, message: receipt.explanation, receipt };
  }
  async calculate(ctx: Context, request: CalculationRequest): Promise<CalculationReceipt> {
    authorize(this.store, ctx);
    check(request && typeof request === 'object' && !Array.isArray(request) && Object.keys(request).every(k => ['operation', 'sourceIds', 'period', 'asOf', 'branch', 'customerId', 'orderId', 'comparePeriod', 'onDate', 'assumptions', 'kinds'].includes(k)), 'INVALID_CALCULATION', 'Only declared calculation parameters are accepted.');
    request = structuredClone(request);
    currentAccess(this.store, ctx, request.branch);
    if (request.sourceIds !== undefined) check(Array.isArray(request.sourceIds) && request.sourceIds.length <= 64 && Array.from(request.sourceIds).every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id)) && new Set(request.sourceIds).size === request.sourceIds.length, 'INVALID_SOURCE_SCOPE', 'Choose at most sixty-four distinct plain source identifiers.');
    const requestedSourceIds = request.sourceIds, selectedSources = requestedSourceIds === undefined ? undefined : new Set(requestedSourceIds);
    const assertRequestedAccess = (state = this.store.read()) => { currentAccess({ read: () => state, update: this.store.update.bind(this.store) }, ctx, request.branch); if (requestedSourceIds !== undefined) assertSourceAccess(state, ctx, requestedSourceIds); };
    assertRequestedAccess();
    // Restrict facts before source-version and conflict resolution; filtering a computed total would be too late.
    const selectionStore: StateStore = selectedSources === undefined ? this.store : {
      read: () => { const state = this.store.read(); return { ...state, facts: state.facts.filter(fact => selectedSources.has(fact.sourceId)) }; },
      update: async () => { throw new Error('Calculation selection is read-only.'); },
    };
    validatePeriod(request.period); validatePeriod(request.comparePeriod);
    this.consumerGuard?.(ctx, structuredClone(request));
    const dictionary = new OntologyService(this.store).current(ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before calculating.');
    const sourceSnapshot = () => { const s = this.store.read(); return hash({ facts: s.facts, sourceRules: s.sourceRules, merges: s.merges, tombstones: s.tombstones, rates: ratesOf(s) }); }; const factsSnapshotHash = sourceSnapshot();
    const operation = dictionary.operations.find(o => o.id === request.operation); check(operation, 'UNKNOWN_CALCULATION', 'No published calculation fits this request.');
    check(!request.kinds, 'INVALID_CALCULATION', 'The published definition determines which record kinds are counted.');
    if (request.comparePeriod) check(operation.type === 'change', 'INVALID_CALCULATION', 'Comparison periods are only accepted by the change calculation.');
    if (request.assumptions) check(operation.type === 'scenario', 'INVALID_CALCULATION', 'Assumptions are only accepted by the scenario calculation.');
    const definitions = dictionary.definitions.filter(d => operation.definitions.includes(d.name)); const relevantKinds = definitions.map(d => d.kind);
    let compoundMoneyField: string | undefined;
    if (operation.type === 'change' || operation.type === 'scenario') {
      check(operation.definitions.length === 1 && operation.definitions[0] === 'earned' && definitions.length === 1 && definitions[0].name === 'earned',
        'MISSING_DEFINITION', 'Comparison and price scenarios require exactly one published earned definition.');
      check(dictionary.fields[definitions[0].field] === 'money', 'INVALID_DEFINITION', 'The published earned definition must name an exact money field.');
      compoundMoneyField = definitions[0].field;
    }
    if (operation.type === 'stock') check(definitions.length === 1 && definitions[0].measure === 'quantity' && !request.period && request.customerId === undefined && request.orderId === undefined,
      'INVALID_CALCULATION', 'Stock on hand is a balance on one date: give an on-date, not a period, customer or order.');
    let compiledSum: CompiledSingleSum | undefined;
    if (operation.type === 'sum' && operation.definitions.length === 1) {
      check(definitions.length === 1, 'COMPILED_SUM_MISMATCH', 'A published sum must resolve exactly one definition.');
      if (dictionary.compiledSums === undefined) compiledSum = compileSingleSum(operation, definitions[0], dictionary.version);
      else {
        check(Array.isArray(dictionary.compiledSums), 'COMPILED_SUM_MISMATCH', 'The published compiler catalogue is invalid.');
        const matches = dictionary.compiledSums.filter(sum => sum?.operationId === operation.id);
        check(matches.length === 1, 'COMPILED_SUM_MISMATCH', 'The published sum needs exactly one retained compiler artifact.');
        assertCompiledSingleSum(matches[0], operation.id, definitions[0], dictionary.version); compiledSum = matches[0];
      }
    }
    // A declared event period applies to every counted event kind, including
    // aging invoices, payments and credits. The observation date is a separate
    // upper bound; omitting period explicitly selects all event dates.
    const selection = selectFacts(selectionStore, ctx, { period: request.period, asOf: request.asOf, branch: request.branch, customerId: request.customerId, orderId: request.orderId, kinds: relevantKinds });
    const excluded = [...selection.excluded]; const counted = new Map<string, Fact>(); const missingMeasures = new Set<string>();
    const selectedFactIds = new Set(selection.facts.map(f => f.id));
    const conflictIds = new Set(selection.conflicts.map(c => JSON.stringify([c.kind, c.entityId])));
    // Rows converted here with an owner-entered rate (BK-19), and rows not counted because no rate is dated on their day.
    const rateState = this.store.read(), converted = new Map<string, { field: string; amount: bigint; sourceAmountMinor: string; normalization: NonNullable<ReceiptRow['normalization']> }>(), notCounted = new Set<string>();
    const metric = (name: string, selected: Fact[] = selection.facts): bigint => {
      const d = definitions.find(def => def.name === name); check(d, 'MISSING_DEFINITION', 'A calculation refers to an unpublished definition.'); let total = 0n;
      for (const row of selected.filter(f => f.kind === d.kind)) {
        const status = String(row.fields.status ?? '');
        if (['cancelled', 'void', 'draft', 'bounced'].includes(status)) { excluded.push({ rowId: row.id, reason: `Status ${status} is excluded by the published counting rule.` }); continue; }
        if (withheldMeasure(row, d.field, excluded, missingMeasures)) continue;
        const value = row.fields[d.field];
        if (value === undefined || value === null) { check(d.nulls !== 'reject', 'MISSING_MEASURE_VALUE', `A ${d.name} fact is missing its required amount.`); missingMeasures.add(row.id); excluded.push({ rowId: row.id, reason: 'A null amount is explicitly excluded by the dictionary.' }); continue; }
        check(typeof value === 'string' && /^-?\d+$/.test(value), 'INVALID_MINOR_UNITS', 'Financial calculations require exact integer minor-unit strings.');
        const conversion = convertFact(rateState, row, value, d.currency);
        if ('notCounted' in conversion) { notCounted.add(row.id); excluded.push({ rowId: row.id, reason: conversion.notCounted }); continue; }
        if (conversion.normalization) converted.set(row.id, { field: d.field, amount: conversion.amount, sourceAmountMinor: conversion.sourceAmountMinor!, normalization: conversion.normalization });
        const amount = conversion.amount; check(!['refunds', 'costs'].includes(d.name) || amount >= 0n, 'INVALID_EVENT_SIGN', 'Refunds and costs must be positive event values; corrections are separate versions.');
        total += amount * BigInt(d.sign ?? 1); counted.set(row.id, row);
      }
      return total;
    };
    const figures: Figure[] = []; let result = 0n; const assumptions: Record<string, unknown> = {};
    const amountOf = (f: Fact) => converted.get(f.id)?.amount ?? BigInt(String(f.fields.amountMinor)); const stockRows = new Map<string, { item: string; unit: string }>();
    if (operation.type === 'sum') {
      result = metric(operation.definitions[0]); if (request.operation === 'net_sales' && !compiledSum) result -= metric('refunds');
      figures.push(moneyFigure('total', operation.label, result, dictionary.currency));
    } else if (operation.type === 'margin') {
      const earned = metric('earned'), refunds = metric('refunds'), costs = metric('costs'); const net = earned - refunds; result = net - costs;
      figures.push(moneyFigure('earned', 'Earned', earned, dictionary.currency), moneyFigure('refunds', 'Refunds', refunds, dictionary.currency), moneyFigure('netSales', 'Net sales', net, dictionary.currency), moneyFigure('costs', 'Imported costs', costs, dictionary.currency), moneyFigure('contribution', 'Contribution', result, dictionary.currency));
      const ratio = bps(result, net); if (ratio !== null) figures.push({ key: 'marginBps', label: 'Margin in basis points (truncated)', minor: String(ratio), display: `${ratio} bps`, unit: 'basis-points' });
    } else if (operation.type === 'change') {
      check(request.period && request.comparePeriod, 'COMPARISON_REQUIRED', 'Give both current and comparison periods.');
      const prior = selectFacts(selectionStore, ctx, { ...request, period: request.comparePeriod, kinds: relevantKinds });
      for (const fact of prior.facts) selectedFactIds.add(fact.id);
      for (const conflict of prior.conflicts) conflictIds.add(JSON.stringify([conflict.kind, conflict.entityId]));
      const current = metric('earned'), previous = metric('earned', prior.facts); result = current - previous; excluded.push(...prior.excluded);
      figures.push(moneyFigure('current', 'Current earned revenue', current, dictionary.currency), moneyFigure('previous', 'Prior earned revenue', previous, dictionary.currency), moneyFigure('change', 'Measured change', result, dictionary.currency));
      const ratio = bps(result, previous); if (ratio !== null) figures.push({ key: 'changeBps', label: 'Change in basis points (truncated)', minor: String(ratio), display: `${ratio} bps`, unit: 'basis-points' });
      assumptions.causalStatus = 'Measured change is not a causal explanation. Causes require separate evidence; no hypothesis is asserted as a fact.';
    } else if (operation.type === 'scenario') {
      check(request.assumptions && Object.keys(request.assumptions).length === 1 && /^-?\d+$/.test(request.assumptions.priceChangeBps), 'SCENARIO_REQUIRED', 'Give an integer price change in basis points.');
      const priceChange = BigInt(request.assumptions.priceChangeBps); check(priceChange >= -10000n && priceChange <= 100000n, 'SCENARIO_LIMIT', 'The price scenario is outside the declared range.');
      const baseline = metric('earned'); const numerator = baseline * (10000n + priceChange); result = numerator / 10000n;
      figures.push(moneyFigure('baseline', 'Measured baseline', baseline, dictionary.currency), moneyFigure('scenario', 'Scenario revenue', result, dictionary.currency), moneyFigure('change', 'Scenario change', result - baseline, dictionary.currency), { key: 'priceChangeBps', label: 'Assumed price change', minor: String(priceChange), display: `${priceChange} bps`, unit: 'basis-points' });
      assumptions.priceChangeBps = String(priceChange); assumptions.volume = 'Held constant'; assumptions.rounding = 'Truncate fractional minor units toward zero'; assumptions.status = 'Scenario only. Source facts are unchanged.';
    } else if (operation.type === 'aging') {
      const onDate = request.onDate ?? selection.asOf.slice(0, 10); check(validDate(onDate), 'INVALID_AGING_DATE', 'Give a valid aging date.');
      const ageRows = selection.facts.filter(f => f.validFrom <= onDate); const invoiceDefinition = definitions.find(d => d.name === 'billed')!; const paymentDefinition = definitions.find(d => d.name === 'received')!; const refundDefinition = definitions.find(d => d.name === 'refunds')!;
      const buckets: Record<string, bigint> = { notDue: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n }; let unallocated = 0n;
      metric('billed', ageRows); metric('received', ageRows); metric('refunds', ageRows);
      const usable = ageRows.filter(f => counted.has(f.id));
      check(definitions.every(d => (d.sign ?? 1) === 1 && d.field === 'amountMinor') && new Set(definitions.map(d => d.kind)).size === 3, 'AGING_DEFINITION_UNSUPPORTED', 'Aging requires distinct positively defined invoice, payment and refund amount measures.');
      const invoiceLinks = new Set<string>(); const invoices = usable.filter(f => f.kind === invoiceDefinition.kind);
      const link = (invoiceId: unknown, customerId: unknown) => typeof invoiceId === 'string' && invoiceId.length > 0 && typeof customerId === 'string' && customerId.length > 0 ? JSON.stringify([invoiceId, customerId]) : null;
      for (const invoice of invoices) {
        const key = link(invoice.fields.invoiceId, invoice.fields.customerId);
        check(key && validDate(invoice.fields.dueDate), 'AGING_LINK_REQUIRED', 'Every invoice needs invoice, customer and due-date links for aging.');
        check(!invoiceLinks.has(key), 'AGING_AMBIGUOUS_INVOICE', 'Distinct invoices cannot reuse an invoice/customer link.'); invoiceLinks.add(key);
        check(amountOf(invoice) >= 0n, 'INVALID_EVENT_SIGN', 'Invoice values must be nonnegative; credit notes are separate events.');
      }
      const credits = new Map<string, bigint>();
      for (const f of usable.filter(f => f.kind === paymentDefinition.kind || f.kind === refundDefinition.kind)) {
        const amount = amountOf(f); check(amount >= 0n, 'INVALID_EVENT_SIGN', 'Aging receipts and credits must be nonnegative event values.');
        const key = link(f.fields.invoiceId, f.fields.customerId);
        if (!key || !invoiceLinks.has(key)) unallocated += amount;
        else credits.set(key, (credits.get(key) ?? 0n) + amount);
      }
      for (const invoice of invoices) {
        const key = link(invoice.fields.invoiceId, invoice.fields.customerId)!;
        let outstanding = amountOf(invoice) - (credits.get(key) ?? 0n); if (outstanding < 0n) { unallocated += -outstanding; outstanding = 0n; }
        const days = Math.floor((Date.parse(onDate) - Date.parse(String(invoice.fields.dueDate))) / 86_400_000); const bucket = days <= 0 ? 'notDue' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'over90'; buckets[bucket] += outstanding; result += outstanding;
      }
      for (const [key, value] of Object.entries(buckets)) figures.push(moneyFigure(key, { notDue: 'Not yet due', days1to30: 'Overdue one to thirty days', days31to60: 'Overdue thirty-one to sixty days', days61to90: 'Overdue sixty-one to ninety days', over90: 'Overdue more than ninety days' }[key]!, value, dictionary.currency));
      figures.push(moneyFigure('outstanding', 'Outstanding receivables', result, dictionary.currency), moneyFigure('unallocated', 'Unallocated receipts or credits', unallocated, dictionary.currency)); assumptions.onDate = onDate;
    } else if (operation.type === 'stock') {
      // Stock on hand (jobs-ext stock check): per item, as of one date; never a sum of different units and never money.
      const onDate = request.onDate ?? selection.asOf.slice(0, 10); check(validDate(onDate), 'INVALID_STOCK_DATE', 'Give a valid date for stock on hand.');
      const d = definitions[0], stock = stockOnHand(selection.facts.filter(f => f.validFrom.slice(0, 10) <= onDate), d);
      excluded.push(...stock.excluded); stock.missing.forEach(id => missingMeasures.add(id)); for (const f of stock.counted) counted.set(f.id, f);
      for (const item of stock.items) for (const id of item.rowIds) stockRows.set(id, { item: item.item, unit: item.unit });
      for (const item of stock.items.slice(0, STOCK_FIGURES)) figures.push(countFigure(`item:${item.item}`, item.item, item.quantity, 'quantity', item.unit));
      result = stock.items.reduce((sum, item) => sum + item.quantity, 0n); const units = new Set(stock.items.map(item => item.unit));
      figures.push(countFigure('items', 'Items with stock figures', stock.items.length, 'count'));
      if (units.size === 1) figures.push(countFigure('total', 'Stock on hand, all items', result, 'quantity', [...units][0]));
      if (stock.items.length > STOCK_FIGURES) figures.push(countFigure('itemsNotShown', 'Items on the receipt rows but not shown as figures', stock.items.length - STOCK_FIGURES, 'count'));
      assumptions.onDate = onDate; assumptions.balance = d.balance; assumptions.unitRule = 'Units are never converted; an item with rows in different units is not counted.';
    }
    const state = this.store.read(); const rows = [...counted.values()];
    const importIds = state.imports.filter(i => i.rowIds?.some((id: string) => counted.has(id))).map(i => i.id);
    const allReconciled = rows.every(r => state.imports.some(i => i.coverage?.reconciled && i.rowIds?.includes(r.id)));
    const gaps: string[] = []; if (!allReconciled && rows.length) gaps.push('Some selected facts were entered directly and are not reconciled to a source report.');
    if (conflictIds.size) gaps.push('Unresolved source conflicts were excluded from this total.');
    const withheldRows = new Set(excluded.filter(e => e.reason === 'withheld').map(e => e.rowId));
    if ([...missingMeasures].some(id => !withheldRows.has(id))) gaps.push('Some selected amounts are unknown and were excluded by the dictionary. This total is partial; missing amounts are not zero.');
    if (withheldRows.size) gaps.push('Some amounts are withheld from your seat by a marking and were not counted. This total is partial; withheld amounts are not zero.');
    if (!rows.length) gaps.push('No visible facts were counted. An empty selection is not proof that the business activity was zero.');
    if (notCounted.size) gaps.push(NOT_COUNTED_GAP);
    if (operation.type === 'stock' && units(figures) > 1) gaps.push('Items are in different units, so there is no stock total across all items.');
    if (operation.type === 'margin') gaps.push('Contribution includes imported costs only. Missing freight, fees, advertising, overhead or tax treatment can change the economic result.');
    const effectiveExcluded = excluded.filter(e => !counted.has(e.rowId) || e.reason !== 'Outside the requested event period.');
    const receipt: CalculationReceipt = {
      id: newId('receipt'), memberId: ctx.memberId, epoch: ctx.epoch, sourceIds: [...new Set(rows.map(r => r.sourceId))], operation: request.operation, createdAt: now(), asOf: selection.asOf,
      ...(requestedSourceIds === undefined ? {} : { requestedSourceIds: [...requestedSourceIds] }),
      period: request.period ?? null, comparePeriod: request.comparePeriod ?? null, branch: request.branch ?? null, currency: dictionary.currency,
      ontologyVersion: dictionary.version, dictionaryHash: dictionary.hash, definitionHash: hash(definitions), definitions, figures, valueMinor: String(result), totalMinor: String(result), rowIds: rows.map(f => f.id),
      ...(compiledSum ? { compiledCalculation: { dictionaryHash: dictionary.hash, sum: structuredClone(compiledSum) } } : {}),
      rows: rows.map(f => ({ factId: f.id, entityId: f.entityId, sourceId: f.sourceId, sourceRow: f.sourceRow, kind: f.kind, amountMinor: String(f.fields[compiledSum?.moneyField ?? compoundMoneyField ?? 'amountMinor']),
        ...(compiledSum ? { measureField: compiledSum.moneyField } : compoundMoneyField && compoundMoneyField !== 'amountMinor' ? { measureField: compoundMoneyField } : {}), validFrom: f.validFrom, branch: f.branch })),
      exclusions: [...new Map(effectiveExcluded.map(e => [`${e.rowId}:${e.reason}`, e])).values()],
      coverage: { selectedRows: selectedFactIds.size, countedRows: rows.length, excludedRows: new Set(effectiveExcluded.map(e => e.rowId)).size, unresolvedConflicts: conflictIds.size, importIds, completeness: conflictIds.size || missingMeasures.size || notCounted.size ? 'partial' : !rows.length ? 'empty' : allReconciled ? 'reconciled-imports' : 'unreconciled-facts', gaps, notCounted: notCounted.size },
      assumptions, explanation: figures.map(f => `${f.label}: ${f.display}.`).join(' ') + (gaps.length ? ` Coverage: ${gaps.join(' ')}` : ''), stale: false, allowedNumbers: [],
    };
    for (const row of receipt.rows) { const fact = counted.get(row.factId)!; if (fact.fields._fx && (!row.measureField || row.measureField === 'amountMinor')) row.normalization = { sourceCurrency: String(fact.fields._sourceCurrency), targetCurrency: dictionary.currency, rate: structuredClone(fact.fields._fx) }; }
    for (const row of receipt.rows) { const fx = converted.get(row.factId); if (fx && fx.field === (row.measureField ?? 'amountMinor')) Object.assign(row, { amountMinor: String(fx.amount), sourceAmountMinor: fx.sourceAmountMinor, normalization: structuredClone(fx.normalization) }); }
    for (const row of receipt.rows) { const stock = stockRows.get(row.factId); if (stock) Object.assign(row, { amountMinor: String(quantityOf(counted.get(row.factId)!.fields[definitions[0].field])), measureField: definitions[0].field, item: stock.item, quantityUnit: stock.unit }); }
    for (const row of receipt.rows) { const fact = counted.get(row.factId)!; row.validFrom = fact.validFrom; for (const field of ['dueDate', 'invoiceId', 'customerId', 'orderId', 'status'] as const) if (typeof fact.fields[field] === 'string') row[field] = fact.fields[field]; }
    receipt.allowedNumbers = [...new Set([...figures.flatMap(f => [f.minor, ...numericTokens(f.display)]), String(rows.length), String(receipt.coverage.excludedRows), ...(notCounted.size ? [String(notCounted.size)] : []), ...figures.flatMap(f => numericTokens(f.label)), ...numericTokens(JSON.stringify({ period: receipt.period, comparePeriod: receipt.comparePeriod, asOf: receipt.asOf, onDate: assumptions.onDate }))])];
    numberGuard(receipt.explanation, receipt);
    for (const decorate of receiptDecorators) decorate(structuredClone(ctx), receipt, this.store.read());
    if (this.restatement) receipt.restatement = structuredClone(this.restatement);
    // The SQL verifier checks money operations only; stock on hand counts quantities and carries no database proof.
    if (this.verifier && operation.type !== 'stock') receipt.databaseProof = await this.verifier(structuredClone(receipt));
    assertRequestedAccess();
    this.consumerGuard?.(ctx, structuredClone(request)); this.receiptGuard?.(ctx, structuredClone(receipt));
    // A request for the current view has already resolved its actual knowledge
    // cut during this calculation. Retain that cut with NEW saved requests so
    // dashboard/conversation results can replay their original meaning later.
    // Explicit supplied cuts and all existing saved requests remain unchanged.
    const savedRequest = { ...structuredClone(request), asOf: request.asOf ?? receipt.asOf };
    await this.store.update(s => { assertRequestedAccess(s); this.consumerGuard?.(ctx, structuredClone(request)); this.receiptGuard?.(ctx, structuredClone(receipt)); rows.forEach(f => check(canSeeFact(this.store, ctx, f), 'ACCESS_REVOKED', 'Read permission changed while this number was being calculated.')); check(sourceSnapshot() === factsSnapshotHash, 'FACTS_CHANGED', 'The source facts or identity rules changed during calculation. Recalculate.'); check(new OntologyService(this.store).current(ctx)?.hash === dictionary.hash, 'DICTIONARY_CHANGED', 'The dictionary changed; calculate again.'); s.receipts.push(structuredClone(receipt)); s.answers.push({ id: newId('answer'), receiptId: receipt.id, request: savedRequest, at: receipt.createdAt, text: receipt.explanation, stale: false }); audit(s, 'calculation.completed', { receiptId: receipt.id, operation: request.operation, rowCount: rows.length }); });
    return receipt;
  }
  receipt(ctx: Context, id: string): CalculationReceipt {
    authorize(this.store, ctx); const receipt = this.store.read().receipts.find(r => r.id === id); check(receipt, 'RECEIPT_NOT_FOUND', 'This receipt is unavailable.');
    check(receipt.memberId === ctx.memberId && receipt.epoch === ctx.epoch, 'RECEIPT_FORBIDDEN', 'This private saved receipt belongs to a different account or permission epoch. Recalculate under your current access.');
    if (receipt.requestedSourceIds !== undefined) assertSourceAccess(this.store.read(), ctx, receipt.requestedSourceIds);
    const facts = this.store.read().facts; for (const rowId of new Set([...receipt.rowIds, ...(receipt.exclusions ?? []).map((e: { rowId: string }) => e.rowId)])) { const fact = facts.find(f => f.id === rowId); check(fact && !fact.deletedAt && canSeeFact(this.store, ctx, fact), 'RECEIPT_FORBIDDEN', 'This saved receipt contains rows outside your current access.'); }
    currentAccess(this.store, ctx, receipt.branch ?? undefined); this.receiptGuard?.(ctx, structuredClone(receipt)); return structuredClone(receipt);
  }
}
