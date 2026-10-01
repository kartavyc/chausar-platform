import { authorize, audit, check, hash, newId, now, type Context, type Fact, type StateStore } from './contracts.ts';
import { canSeeFact, currentAccess, selectFacts, validDate, validatePeriod, type FactFilter, type Period } from './memory.ts';
import { OntologyService, type Definition } from './ontology.ts';
import { formatMinor } from './currency.ts';

export type CalculationRequest = FactFilter & { operation: string; comparePeriod?: Period; onDate?: string; assumptions?: { priceChangeBps: string } };
export type Figure = { key: string; label: string; minor: string; display: string; unit: 'money' | 'basis-points'; currency?: string };
export type ReceiptRow = { factId: string; entityId: string; sourceId: string; sourceRow: number; kind: string; amountMinor: string; validFrom: string; dueDate?: string; invoiceId?: string; customerId?: string; orderId?: string; status?: string; branch?: string; normalization?: { sourceCurrency: string; targetCurrency: string; rate: unknown } };
export type CalculationReceipt = { id: string; memberId: string; epoch: number; sourceIds: string[]; operation: string; createdAt: string; asOf: string; period: Period | null; comparePeriod: Period | null; branch: string | null; currency: string; ontologyVersion: number; dictionaryHash: string; definitionHash: string; definitions: Definition[]; figures: Figure[]; valueMinor: string; totalMinor: string; rowIds: string[]; rows: ReceiptRow[]; exclusions: { rowId: string; reason: string }[]; coverage: { selectedRows: number; countedRows: number; excludedRows: number; unresolvedConflicts: number; importIds: string[]; completeness: 'reconciled-imports' | 'unreconciled-facts' | 'empty' | 'partial'; gaps: string[] }; assumptions: Record<string, unknown>; explanation: string; stale: boolean; staleReason?: string; allowedNumbers: string[]; databaseProof?: unknown };
export type CalculatorOptions = {
  verifier?: (receipt: CalculationReceipt) => Promise<unknown>;
  consumerGuard?: (context: Context, request: CalculationRequest) => void;
  receiptGuard?: (context: Context, receipt: CalculationReceipt) => void;
};
export function formatMoney(n: string | bigint, currency = 'INR') { return formatMinor(n, currency); }
export function sumMoney(values: string[]) { return String(values.reduce((sum, value) => { check(/^-?\d+$/.test(value), 'INVALID_MINOR_UNITS', 'Calculator amounts must be whole minor-unit strings.'); return sum + BigInt(value); }, 0n)); }
const moneyFigure = (key: string, label: string, value: bigint, currency: string): Figure => ({ key, label, minor: String(value), display: formatMoney(value, currency), unit: 'money', currency });
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
  constructor(store: StateStore, options: CalculatorOptions = {}) { this.store = store; this.verifier = options.verifier; this.consumerGuard = options.consumerGuard; this.receiptGuard = options.receiptGuard; }
  catalog(ctx: Context) { const dictionary = new OntologyService(this.store).current(ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before asking for numbers.'); return dictionary.operations; }
  guard(text: string, receipt: CalculationReceipt) { return numberGuard(text, receipt); }
  async ask(ctx: Context, question: string, filters: Omit<CalculationRequest, 'operation'> = {}) {
    authorize(this.store, ctx); const operation = matchQuestion(question, this.catalog(ctx).map(o => o.id));
    if (!operation) {
      await this.store.update(state => { authorize(this.store, ctx); state.unsupported.push({ id: newId('wanted'), at: now(), question, status: 'not-yet', by: ctx.memberId }); });
      return { supported: false, message: 'I cannot calculate that yet. Choose a published calculation and an explicit period; the question was added to the wanted list.', receipt: null };
    }
    const receipt = await this.calculate(ctx, { ...filters, operation }); return { supported: true, message: receipt.explanation, receipt };
  }
  async calculate(ctx: Context, request: CalculationRequest): Promise<CalculationReceipt> {
    authorize(this.store, ctx); currentAccess(this.store, ctx, request.branch);
    check(request && Object.keys(request).every(k => ['operation', 'period', 'asOf', 'branch', 'customerId', 'orderId', 'comparePeriod', 'onDate', 'assumptions', 'kinds'].includes(k)), 'INVALID_CALCULATION', 'Only declared calculation parameters are accepted.');
    validatePeriod(request.period); validatePeriod(request.comparePeriod);
    this.consumerGuard?.(ctx, structuredClone(request));
    const dictionary = new OntologyService(this.store).current(ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before calculating.');
    const sourceSnapshot = () => { const s = this.store.read(); return hash({ facts: s.facts, sourceRules: s.sourceRules, merges: s.merges, tombstones: s.tombstones }); }; const factsSnapshotHash = sourceSnapshot();
    const operation = dictionary.operations.find(o => o.id === request.operation); check(operation, 'UNKNOWN_CALCULATION', 'No published calculation fits this request.');
    check(!request.kinds, 'INVALID_CALCULATION', 'The published definition determines which record kinds are counted.');
    if (request.comparePeriod) check(operation.type === 'change', 'INVALID_CALCULATION', 'Comparison periods are only accepted by the change calculation.');
    if (request.assumptions) check(operation.type === 'scenario', 'INVALID_CALCULATION', 'Assumptions are only accepted by the scenario calculation.');
    const definitions = dictionary.definitions.filter(d => operation.definitions.includes(d.name)); const relevantKinds = definitions.map(d => d.kind);
    const selection = selectFacts(this.store, ctx, { period: operation.type === 'aging' ? undefined : request.period, asOf: request.asOf, branch: request.branch, customerId: request.customerId, orderId: request.orderId, kinds: relevantKinds });
    const excluded = [...selection.excluded]; const counted = new Map<string, Fact>(); const missingMeasures = new Set<string>();
    const selectedFactIds = new Set(selection.facts.map(f => f.id));
    const conflictIds = new Set(selection.conflicts.map(c => JSON.stringify([c.kind, c.entityId])));
    const metric = (name: string, selected: Fact[] = selection.facts): bigint => {
      const d = definitions.find(def => def.name === name); check(d, 'MISSING_DEFINITION', 'A calculation refers to an unpublished definition.'); let total = 0n;
      for (const row of selected.filter(f => f.kind === d.kind)) {
        const status = String(row.fields.status ?? '');
        if (['cancelled', 'void', 'draft', 'bounced'].includes(status)) { excluded.push({ rowId: row.id, reason: `Status ${status} is excluded by the published counting rule.` }); continue; }
        const value = row.fields[d.field];
        if (value === undefined || value === null) { check(d.nulls !== 'reject', 'MISSING_MEASURE_VALUE', `A ${d.name} fact is missing its required amount.`); missingMeasures.add(row.id); excluded.push({ rowId: row.id, reason: 'A null amount is explicitly excluded by the dictionary.' }); continue; }
        check(typeof value === 'string' && /^-?\d+$/.test(value), 'INVALID_MINOR_UNITS', 'Financial calculations require exact integer minor-unit strings.');
        check(row.fields.currency === d.currency, 'CURRENCY_MISMATCH', 'Unconverted currencies cannot be added.');
        const amount = BigInt(value); check(!['refunds', 'costs'].includes(d.name) || amount >= 0n, 'INVALID_EVENT_SIGN', 'Refunds and costs must be positive event values; corrections are separate versions.');
        total += amount * BigInt(d.sign ?? 1); counted.set(row.id, row);
      }
      return total;
    };
    const figures: Figure[] = []; let result = 0n; const assumptions: Record<string, unknown> = {};
    if (operation.type === 'sum') {
      result = metric(operation.definitions[0]); if (request.operation === 'net_sales') result -= metric('refunds');
      figures.push(moneyFigure('total', operation.label, result, dictionary.currency));
    } else if (operation.type === 'margin') {
      const earned = metric('earned'), refunds = metric('refunds'), costs = metric('costs'); const net = earned - refunds; result = net - costs;
      figures.push(moneyFigure('earned', 'Earned', earned, dictionary.currency), moneyFigure('refunds', 'Refunds', refunds, dictionary.currency), moneyFigure('netSales', 'Net sales', net, dictionary.currency), moneyFigure('costs', 'Imported costs', costs, dictionary.currency), moneyFigure('contribution', 'Contribution', result, dictionary.currency));
      const ratio = bps(result, net); if (ratio !== null) figures.push({ key: 'marginBps', label: 'Margin in basis points (truncated)', minor: String(ratio), display: `${ratio} bps`, unit: 'basis-points' });
    } else if (operation.type === 'change') {
      check(request.period && request.comparePeriod, 'COMPARISON_REQUIRED', 'Give both current and comparison periods.');
      const prior = selectFacts(this.store, ctx, { ...request, period: request.comparePeriod, kinds: relevantKinds });
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
        check(BigInt(String(invoice.fields.amountMinor)) >= 0n, 'INVALID_EVENT_SIGN', 'Invoice values must be nonnegative; credit notes are separate events.');
      }
      const credits = new Map<string, bigint>();
      for (const f of usable.filter(f => f.kind === paymentDefinition.kind || f.kind === refundDefinition.kind)) {
        const amount = BigInt(String(f.fields.amountMinor)); check(amount >= 0n, 'INVALID_EVENT_SIGN', 'Aging receipts and credits must be nonnegative event values.');
        const key = link(f.fields.invoiceId, f.fields.customerId);
        if (!key || !invoiceLinks.has(key)) unallocated += amount;
        else credits.set(key, (credits.get(key) ?? 0n) + amount);
      }
      for (const invoice of invoices) {
        const key = link(invoice.fields.invoiceId, invoice.fields.customerId)!;
        let outstanding = BigInt(String(invoice.fields.amountMinor)) - (credits.get(key) ?? 0n); if (outstanding < 0n) { unallocated += -outstanding; outstanding = 0n; }
        const days = Math.floor((Date.parse(onDate) - Date.parse(String(invoice.fields.dueDate))) / 86_400_000); const bucket = days <= 0 ? 'notDue' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'over90'; buckets[bucket] += outstanding; result += outstanding;
      }
      for (const [key, value] of Object.entries(buckets)) figures.push(moneyFigure(key, { notDue: 'Not yet due', days1to30: 'Overdue one to thirty days', days31to60: 'Overdue thirty-one to sixty days', days61to90: 'Overdue sixty-one to ninety days', over90: 'Overdue more than ninety days' }[key]!, value, dictionary.currency));
      figures.push(moneyFigure('outstanding', 'Outstanding receivables', result, dictionary.currency), moneyFigure('unallocated', 'Unallocated receipts or credits', unallocated, dictionary.currency)); assumptions.onDate = onDate;
    }
    const state = this.store.read(); const rows = [...counted.values()];
    const importIds = state.imports.filter(i => i.rowIds?.some((id: string) => counted.has(id))).map(i => i.id);
    const allReconciled = rows.every(r => state.imports.some(i => i.coverage?.reconciled && i.rowIds?.includes(r.id)));
    const gaps: string[] = []; if (!allReconciled && rows.length) gaps.push('Some selected facts were entered directly and are not reconciled to a source report.');
    if (conflictIds.size) gaps.push('Unresolved source conflicts were excluded from this total.');
    if (missingMeasures.size) gaps.push('Some selected amounts are unknown and were excluded by the dictionary. This total is partial; missing amounts are not zero.');
    if (!rows.length) gaps.push('No visible facts were counted. An empty selection is not proof that the business activity was zero.');
    if (request.operation === 'margin') gaps.push('Contribution includes imported costs only. Missing freight, fees, advertising, overhead or tax treatment can change the economic result.');
    const effectiveExcluded = excluded.filter(e => !counted.has(e.rowId) || e.reason !== 'Outside the requested event period.');
    const receipt: CalculationReceipt = {
      id: newId('receipt'), memberId: ctx.memberId, epoch: ctx.epoch, sourceIds: [...new Set(rows.map(r => r.sourceId))], operation: request.operation, createdAt: now(), asOf: selection.asOf,
      period: request.period ?? null, comparePeriod: request.comparePeriod ?? null, branch: request.branch ?? null, currency: dictionary.currency,
      ontologyVersion: dictionary.version, dictionaryHash: dictionary.hash, definitionHash: hash(definitions), definitions, figures, valueMinor: String(result), totalMinor: String(result), rowIds: rows.map(f => f.id),
      rows: rows.map(f => ({ factId: f.id, entityId: f.entityId, sourceId: f.sourceId, sourceRow: f.sourceRow, kind: f.kind, amountMinor: String(f.fields.amountMinor), validFrom: f.validFrom, branch: f.branch })),
      exclusions: [...new Map(effectiveExcluded.map(e => [`${e.rowId}:${e.reason}`, e])).values()],
      coverage: { selectedRows: selectedFactIds.size, countedRows: rows.length, excludedRows: new Set(effectiveExcluded.map(e => e.rowId)).size, unresolvedConflicts: conflictIds.size, importIds, completeness: conflictIds.size || missingMeasures.size ? 'partial' : !rows.length ? 'empty' : allReconciled ? 'reconciled-imports' : 'unreconciled-facts', gaps },
      assumptions, explanation: figures.map(f => `${f.label}: ${f.display}.`).join(' ') + (gaps.length ? ` Coverage: ${gaps.join(' ')}` : ''), stale: false, allowedNumbers: [],
    };
    for (const row of receipt.rows) { const fact = counted.get(row.factId)!; if (fact.fields._fx) row.normalization = { sourceCurrency: String(fact.fields._sourceCurrency), targetCurrency: dictionary.currency, rate: structuredClone(fact.fields._fx) }; }
    for (const row of receipt.rows) { const fact = counted.get(row.factId)!; row.validFrom = fact.validFrom; for (const field of ['dueDate', 'invoiceId', 'customerId', 'orderId', 'status'] as const) if (typeof fact.fields[field] === 'string') row[field] = fact.fields[field]; }
    receipt.allowedNumbers = [...new Set([...figures.flatMap(f => [f.minor, ...numericTokens(f.display)]), String(rows.length), String(receipt.coverage.excludedRows), ...numericTokens(JSON.stringify({ period: receipt.period, comparePeriod: receipt.comparePeriod, asOf: receipt.asOf, onDate: assumptions.onDate }))])];
    numberGuard(receipt.explanation, receipt);
    if (this.verifier) receipt.databaseProof = await this.verifier(structuredClone(receipt));
    this.consumerGuard?.(ctx, structuredClone(request)); this.receiptGuard?.(ctx, structuredClone(receipt));
    await this.store.update(s => { authorize(this.store, ctx); this.consumerGuard?.(ctx, structuredClone(request)); this.receiptGuard?.(ctx, structuredClone(receipt)); rows.forEach(f => check(canSeeFact(this.store, ctx, f), 'ACCESS_REVOKED', 'Read permission changed while this number was being calculated.')); check(sourceSnapshot() === factsSnapshotHash, 'FACTS_CHANGED', 'The source facts or identity rules changed during calculation. Recalculate.'); check(new OntologyService(this.store).current(ctx)?.hash === dictionary.hash, 'DICTIONARY_CHANGED', 'The dictionary changed; calculate again.'); s.receipts.push(structuredClone(receipt)); s.answers.push({ id: newId('answer'), receiptId: receipt.id, request: structuredClone(request), at: receipt.createdAt, text: receipt.explanation, stale: false }); audit(s, 'calculation.completed', { receiptId: receipt.id, operation: request.operation, rowCount: rows.length }); });
    return receipt;
  }
  receipt(ctx: Context, id: string): CalculationReceipt {
    authorize(this.store, ctx); const receipt = this.store.read().receipts.find(r => r.id === id); check(receipt, 'RECEIPT_NOT_FOUND', 'This receipt is unavailable.');
    check(receipt.memberId === ctx.memberId && receipt.epoch === ctx.epoch, 'RECEIPT_FORBIDDEN', 'This private saved receipt belongs to a different account or permission epoch. Recalculate under your current access.');
    const facts = this.store.read().facts; for (const rowId of new Set([...receipt.rowIds, ...(receipt.exclusions ?? []).map((e: { rowId: string }) => e.rowId)])) { const fact = facts.find(f => f.id === rowId); check(fact && !fact.deletedAt && canSeeFact(this.store, ctx, fact), 'RECEIPT_FORBIDDEN', 'This saved receipt contains rows outside your current access.'); }
    currentAccess(this.store, ctx, receipt.branch ?? undefined); this.receiptGuard?.(ctx, structuredClone(receipt)); return structuredClone(receipt);
  }
}
