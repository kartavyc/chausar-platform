import { authorize, audit, check, hash, newId, now, type Context, type State, type StateStore } from './contracts.ts';
import { CalculatorService, numberGuard, formatMoney, type CalculationReceipt, type CalculationRequest, type CalculatorOptions } from './calculator.ts';
import { canSeeFact, currentAccess, validDate } from './memory.ts';
import { assertSourceAccess } from './trust.ts';
import type { AlertBrief, AlertBriefScope } from './alerts-contracts.ts';
import { confirmDecision as confirmJournal, draftDecision as draftJournal, dueDecisions as dueJournal, journalContentReceiptIds, journalExecutionSnapshot, reviseDecision as reviseJournal, reviewDecision as reviewJournal, type JournalContent, type JournalDecision, type JournalDraft, type JournalExecutionReceipt, type JournalObservation, type JournalReview } from './decision-journal.ts';

export type DecisionInput = { text: string; reviewDate: string; receiptIds?: string[]; hypotheses?: string[]; branch?: string };
export type DecisionReview = { outcome: 'accepted' | 'rejected' | 'continue' | 'completed'; notes?: string };
export type JournalDecisionReview = { outcome: JournalReview['outcome']; notes?: string; observation: JournalObservation; nextReviewDate?: string };
export type ReportOptions = CalculatorOptions & {
  /** Trusted host resolver: existence, current access and effect interpretation stay with the execution service. */
  executionReceipt?: (ctx: Context, id: string, view: StateStore) => JournalExecutionReceipt;
  /** Resolve private retained alerts against the final current-authority view. No evaluation or dispatch. */
  alertBrief?: (ctx: Context, scope: AlertBriefScope, view: StateStore) => AlertBrief;
};
export type ComplianceEntry = { title: string; dueDate: string; sourceUrl: string; publishedAt: string; reviewedBy: string };
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function forecastValue(series: bigint[]): bigint {
  const count = BigInt(series.length); const sumX = count * (count - 1n) / 2n; const sumXX = count * (count - 1n) * (2n * count - 1n) / 6n; const sumY = series.reduce((a, b) => a + b, 0n); const sumXY = series.reduce((a, b, i) => a + BigInt(i) * b, 0n);
  const denominator = count * sumXX - sumX * sumX; if (denominator === 0n) return series.at(-1)!;
  const slopeNumerator = count * sumXY - sumX * sumY;
  return (sumY * denominator + slopeNumerator * (count * count - sumX)) / (count * denominator);
}
function stateView(state: State): StateStore {
  return { read: () => structuredClone(state), update: async () => { throw new Error('The journal authorization view is read-only.'); } };
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function richRecord(value: unknown): value is Record<string, unknown> { return record(value) && Object.hasOwn(value, 'revision'); }
function journalRecord(value: unknown): value is JournalDecision {
  return richRecord(value) && Number.isSafeInteger(value.revision) && typeof value.ownerId === 'string' && Array.isArray(value.options) && Array.isArray(value.assumptions) && record(value.expectedOutcome) && Array.isArray(value.receipts) && Array.isArray(value.revisions) && Array.isArray(value.reviews) && Array.isArray(value.receiptIds) && Array.isArray(value.sourceIds) && Array.isArray(value.rowIds);
}
function observationIds(observation: JournalObservation): { receipts: string[]; executions: string[] } {
  check(record(observation) && Array.isArray(observation.measurements) && Array.isArray(observation.executionReceiptIds), 'INVALID_REVIEW', 'Supply explicit measurement and execution reference lists.');
  const receipts = observation.measurements.map(ref => {
    check(record(ref) && typeof ref.receiptId === 'string' && ref.receiptId.trim().length > 0, 'INVALID_REFERENCE', 'Measurements need a receipt ID.'); return ref.receiptId;
  });
  check(observation.executionReceiptIds.every(id => typeof id === 'string' && id.trim().length > 0), 'INVALID_REVIEW', 'Execution receipt IDs must be nonblank references.');
  return { receipts: [...new Set(receipts)], executions: [...new Set(observation.executionReceiptIds)] };
}
function payload(value: unknown, keys: string[], code: string) {
  check(record(value) && Object.keys(value).every(key => keys.includes(key)), code, 'Unknown journal properties are refused.');
}
function detached<T>(value: T, code: string): T {
  try { return structuredClone(value); } catch { check(false, code, 'Journal requests must be plain data.'); }
}
export class ReportService {
  store: StateStore;
  calculator: CalculatorService;
  options: ReportOptions;
  constructor(store: StateStore, options: ReportOptions = {}) { this.store = store; this.options = options; this.calculator = new CalculatorService(store, options); }
  private calculatorAt(view: StateStore) { return new CalculatorService(view, this.options); }
  private receiptAt(view: StateStore, ctx: Context, id: string): CalculationReceipt {
    const receipt = this.calculatorAt(view).receipt(ctx, id);
    assertSourceAccess(view.read(), ctx, receipt.sourceIds);
    return receipt;
  }
  private ownerAt(view: StateStore, ctx: Context, content: JournalContent) {
    currentAccess(view, ctx, content.branch);
    const owner = view.read().members.find(member => member.id === content.ownerId);
    check(owner?.active && (!content.branch || owner.branches.includes('*') || owner.branches.includes(content.branch)), 'INVALID_DECISION_OWNER', 'Choose a current active owner with access to the decision branch.');
  }
  private executionAt(view: StateStore, ctx: Context, ids: string[]): JournalExecutionReceipt[] {
    return ids.map(id => {
      check(this.options.executionReceipt, 'EXECUTION_RECEIPT_UNAVAILABLE', 'Execution references need the trusted execution-service resolver.');
      const evidence = journalExecutionSnapshot(this.options.executionReceipt({ ...ctx }, id, view));
      check(evidence.id === id, 'INVALID_EXECUTION_RECEIPT', 'The resolved execution record differs from its requested ID.');
      this.executionAccess(view, ctx, evidence);
      return evidence;
    });
  }
  private executionAccess(view: StateStore, ctx: Context, evidence: JournalExecutionReceipt) {
    const state = view.read(); assertSourceAccess(state, ctx, evidence.sourceIds);
    for (const rowId of evidence.rowIds) {
      const fact = state.facts.find(row => row.id === rowId);
      check(fact && !fact.deletedAt && canSeeFact(view, ctx, fact), 'EXECUTION_RECEIPT_FORBIDDEN', 'Execution evidence includes a row outside your current access.');
    }
  }
  private journalAccess(view: StateStore, ctx: Context, value: JournalDecision): CalculationReceipt[] {
    authorize(view, ctx); this.ownerAt(view, ctx, value);
    const state = view.read(); assertSourceAccess(state, ctx, value.sourceIds);
    value.receipts.forEach(receipt => assertSourceAccess(state, ctx, receipt.sourceIds));
    const ids = [...new Set([...value.receiptIds, ...value.receipts.map(receipt => receipt.id)])];
    const receipts = ids.map(id => this.receiptAt(view, ctx, id));
    const executionIds = [...new Set(value.reviews.flatMap(review => observationIds(review.observation).executions))];
    value.reviews.forEach(review => (review.executionReceipts ?? []).forEach(evidence => this.executionAccess(view, ctx, journalExecutionSnapshot(evidence))));
    this.executionAt(view, ctx, executionIds);
    return receipts;
  }
  private journalAt(state: State, ctx: Context, id: string) {
    const view = stateView(state); authorize(view, ctx, 'prepare');
    const value: unknown = state.decisions.find(item => item.id === id);
    check(value, 'DECISION_NOT_FOUND', 'This decision is unavailable under your current access.');
    check(journalRecord(value), 'JOURNAL_DECISION_REQUIRED', 'This operation needs a rich journal decision.');
    const receipts = this.journalAccess(view, ctx, value);
    return { view, value, receipts };
  }
  draftDecision(ctx: Context, content: JournalContent): JournalDraft {
    const view = stateView(this.store.read()); authorize(view, ctx, 'prepare');
    const ids = journalContentReceiptIds(content); this.ownerAt(view, ctx, content);
    return draftJournal(content, ids.map(id => this.receiptAt(view, ctx, id)));
  }
  async confirmDecision(ctx: Context, draft: JournalDraft, input: { reviewedDigest: string }): Promise<JournalDecision> {
    authorize(this.store, ctx, 'prepare'); payload(input, ['reviewedDigest'], 'INVALID_CONFIRMATION');
    const request = detached({ draft, input, ctx }, 'INVALID_DRAFT');
    return this.store.update(state => {
      const view = stateView(state); authorize(view, request.ctx, 'prepare');
      const ids = journalContentReceiptIds(request.draft.content); this.ownerAt(view, request.ctx, request.draft.content);
      const receipts = ids.map(id => this.receiptAt(view, request.ctx, id));
      const candidate = confirmJournal(request.draft, { reviewedDigest: request.input.reviewedDigest, id: newId('decision'), actorId: request.ctx.memberId, at: now(), receipts });
      state.decisions.push(candidate); audit(state, 'decision.created', { decisionId: candidate.id, reviewDate: candidate.reviewDate, revision: candidate.revision, journal: true, memberId: request.ctx.memberId });
      return structuredClone(candidate);
    });
  }
  async reviseDecision(ctx: Context, id: string, content: JournalContent, input: { expectedRevision: number; reason: string }): Promise<JournalDecision> {
    authorize(this.store, ctx, 'prepare'); payload(input, ['expectedRevision', 'reason'], 'INVALID_REVISION');
    const request = detached({ id, content, input, ctx }, 'INVALID_REVISION');
    return this.store.update(state => {
      const { view, value } = this.journalAt(state, request.ctx, request.id);
      const ids = journalContentReceiptIds(request.content); this.ownerAt(view, request.ctx, request.content);
      const receipts = ids.map(receiptId => this.receiptAt(view, request.ctx, receiptId));
      const candidate = reviseJournal(value, request.content, { ...request.input, actorId: request.ctx.memberId, at: now(), receipts });
      state.decisions[state.decisions.findIndex(item => item.id === request.id)] = candidate;
      audit(state, 'decision.revised', { decisionId: candidate.id, revision: candidate.revision, memberId: request.ctx.memberId });
      return structuredClone(candidate);
    });
  }
  async reviewJournalDecision(ctx: Context, id: string, review: JournalDecisionReview, input: { expectedRevision: number }): Promise<JournalDecision> {
    authorize(this.store, ctx, 'prepare'); payload(input, ['expectedRevision'], 'INVALID_REVIEW');
    const request = detached({ id, review, input, ctx }, 'INVALID_REVIEW');
    return this.store.update(state => {
      const { view, value } = this.journalAt(state, request.ctx, request.id);
      const refs = observationIds(request.review.observation);
      const receipts = refs.receipts.map(receiptId => this.receiptAt(view, request.ctx, receiptId));
      const executions = this.executionAt(view, request.ctx, refs.executions);
      const candidate = reviewJournal(value, request.review, { expectedRevision: request.input.expectedRevision, actorId: request.ctx.memberId, at: now(), receipts });
      if (executions.length) candidate.reviews[candidate.reviews.length - 1].executionReceipts = executions;
      state.decisions[state.decisions.findIndex(item => item.id === request.id)] = candidate;
      audit(state, 'decision.reviewed', { decisionId: candidate.id, outcome: request.review.outcome, revision: candidate.revision, memberId: request.ctx.memberId });
      return structuredClone(candidate);
    });
  }
  dueDecisions(ctx: Context, filter: { dueOn?: string; branch?: string } = {}) {
    authorize(this.store, ctx); currentAccess(this.store, ctx, filter.branch);
    if (filter.dueOn !== undefined) check(validDate(filter.dueOn), 'INVALID_DATE', 'Give a valid due-on date.');
    return dueJournal(this.decisions(ctx), filter);
  }
  async report(ctx: Context, type: 'lender' | 'bank' | 'investor' | 'ca', request: Omit<CalculationRequest, 'operation'> = {}) {
    authorize(this.store, ctx); check(['lender', 'bank', 'investor', 'ca'].includes(type), 'UNKNOWN_REPORT', 'Choose a lender, investor or accountant report.');
    const ids = this.calculator.catalog(ctx).map(o => o.id); const wanted = type === 'ca' ? ['billed', 'received', 'earned', 'refunds', 'purchases', 'aging'] : ['billed', 'received', 'net_sales', 'margin', 'aging'];
    const receipts: CalculationReceipt[] = [], blocked: string[] = [];
    for (const operation of wanted) {
      if (!ids.includes(operation)) { blocked.push(`${operation}: no published definition.`); continue; }
      try { receipts.push(await this.calculator.calculate(ctx, { ...request, operation })); } catch (error) { blocked.push(`${operation}: ${(error as Error).message}`); }
    }
    const gaps = [...new Set(receipts.flatMap(r => r.coverage.gaps).concat(blocked))];
    if (type === 'bank' || type === 'lender') gaps.push('This is a receipt-backed financial annex, not a certified lender application. Balance sheet, audited accounts, debt schedule, cash-flow classification and bank-specific forms require reviewed data.');
    if (type === 'ca') gaps.push('This is an accountant review pack. It does not file tax returns or certify compliance. GST reconciliation covers imported source files only.');
    if (type === 'investor') gaps.push('This is an investor data annex. It does not provide a valuation or certify unimported metrics.');
    const title = `${type === 'ca' ? 'Accountant' : type === 'bank' || type === 'lender' ? 'Lender' : 'Investor'} review pack`;
    const sections = receipts.map(r => ({ title: r.operation, receiptId: r.id, figures: r.figures, period: r.period, asOf: r.asOf, dictionaryHash: r.dictionaryHash, coverage: r.coverage, explanation: r.explanation }));
    authorize(this.store, ctx); receipts.forEach(r => this.calculator.receipt(ctx, r.id));
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px;color:#15231e}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ccd5cf;text-align:left}small{color:#53645a}</style><h1>${escapeHtml(title)}</h1><p>Every amount below links to a calculation receipt. Coverage and omissions are part of the report.</p>${receipts.map(r => `<section><h2>${escapeHtml(r.operation)}</h2><table><thead><tr><th>Measure</th><th>Exact result</th><th>Receipt</th></tr></thead><tbody>${r.figures.map(f => `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(f.display)}</td><td>${escapeHtml(r.id)}</td></tr>`).join('')}</tbody></table><small>Definition ${escapeHtml(r.definitionHash)}; known on ${escapeHtml(r.asOf)}.</small></section>`).join('')}<h2>Coverage and missing information</h2><ul>${gaps.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul></html>`;
    return { id: newId('report'), title, type, createdAt: now(), status: gaps.length ? 'partial' : 'review-ready', sections, receiptIds: receipts.map(r => r.id), rowIds: [...new Set(receipts.flatMap(r => r.rowIds))], gaps, html, delivery: 'local-draft' };
  }
  async decision(ctx: Context, input: DecisionInput) {
    authorize(this.store, ctx, 'prepare');
    check(input && Object.keys(input).every(k => ['text', 'reviewDate', 'receiptIds', 'hypotheses', 'branch'].includes(k)), 'INVALID_DECISION', 'Unknown decision properties are refused.');
    check(typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= 5000 && validDate(input.reviewDate), 'INVALID_DECISION', 'A decision needs a sentence and a valid review date.');
    currentAccess(this.store, ctx, input.branch); const receipts = (input.receiptIds ?? []).map(id => this.calculator.receipt(ctx, id));
    check(!receipts.some(r => r.stale), 'STALE_EVIDENCE', 'Recalculate stale evidence before attaching it to a decision.');
    check(!input.hypotheses || input.hypotheses.every(h => typeof h === 'string' && h.length <= 5000), 'INVALID_HYPOTHESIS', 'Hypotheses are separate labelled text.');
    return this.store.update(state => { const view = stateView(state); authorize(view, ctx, 'prepare'); currentAccess(view, ctx, input.branch); const currentReceipts = (input.receiptIds ?? []).map(id => this.calculatorAt(view).receipt(ctx, id)); check(!currentReceipts.some(receipt => receipt.stale), 'STALE_EVIDENCE', 'Recalculate stale evidence before attaching it to a decision.'); const decision = { id: newId('decision'), ...structuredClone(input), text: input.text.trim(), receiptIds: input.receiptIds ?? [], hypotheses: input.hypotheses ?? [], rowIds: [...new Set(currentReceipts.flatMap(r => r.rowIds))], createdAt: now(), by: ctx.memberId, status: 'open', reviews: [] }; state.decisions.push(decision); audit(state, 'decision.created', { decisionId: decision.id, reviewDate: input.reviewDate }); return structuredClone(decision); });
  }
  decisions(ctx: Context, filter: { dueOn?: string; branch?: string } = {}) {
    authorize(this.store, ctx); currentAccess(this.store, ctx, filter.branch); if (filter.dueOn !== undefined) check(validDate(filter.dueOn), 'INVALID_DATE', 'Give a valid due-on date.');
    const view = stateView(this.store.read()); const items = view.read().decisions.filter(d => !d.branch || !filter.branch || d.branch === filter.branch).filter(d => !filter.dueOn || (d.reviewDate <= filter.dueOn && d.status === 'open'));
    return structuredClone(items.filter(d => { try { if (richRecord(d)) { check(journalRecord(d), 'INVALID_DECISION', 'This journal record is invalid.'); this.journalAccess(view, ctx, d); } else { currentAccess(view, ctx, d.branch); (d.receiptIds ?? []).forEach((id: string) => this.calculatorAt(view).receipt(ctx, id)); } return true; } catch { return false; } }));
  }
  async reviewDecision(ctx: Context, id: string, review: DecisionReview) {
    authorize(this.store, ctx, 'prepare'); check(['accepted', 'rejected', 'continue', 'completed'].includes(review.outcome) && Object.keys(review).every(k => ['outcome', 'notes'].includes(k)), 'INVALID_REVIEW', 'Choose a declared decision outcome.');
    const view = stateView(this.store.read()); const available = view.read().decisions.find(d => {
      if (d.id !== id) return false;
      try { currentAccess(view, ctx, d.branch); (d.receiptIds ?? []).forEach((receiptId: string) => this.receiptAt(view, ctx, receiptId)); return true; } catch { return false; }
    });
    check(available, 'DECISION_NOT_FOUND', 'This decision is unavailable under your current access.');
    check(!richRecord(available), 'JOURNAL_REVIEW_REQUIRED', 'Review a rich journal with an explicit observation and expected revision.');
    return this.store.update(state => { const view = stateView(state); authorize(view, ctx, 'prepare'); const d = state.decisions.find(item => item.id === id); check(d, 'DECISION_NOT_FOUND', 'Decision access changed.'); check(!richRecord(d), 'JOURNAL_REVIEW_REQUIRED', 'Review a rich journal with an explicit observation and expected revision.'); currentAccess(view, ctx, d.branch); (d.receiptIds ?? []).forEach((receiptId: string) => this.calculatorAt(view).receipt(ctx, receiptId)); d.reviews.push({ ...structuredClone(review), at: now(), by: ctx.memberId }); d.status = review.outcome === 'continue' ? 'open' : 'closed'; audit(state, 'decision.reviewed', { decisionId: id, outcome: review.outcome }); return structuredClone(d); });
  }
  async setComplianceCalendar(ctx: Context, entries: ComplianceEntry[], version: string) {
    authorize(this.store, ctx, 'admin'); check(version.length > 0 && entries.every(e => e.title && validDate(e.dueDate) && /^https:\/\//.test(e.sourceUrl) && Number.isFinite(Date.parse(e.publishedAt)) && e.reviewedBy), 'UNVERIFIED_CALENDAR', 'Calendar dates must come from a linked publication and a named human review.');
    return this.store.update(state => { authorize(this.store, ctx, 'admin'); const calendar = { id: newId('calendar'), type: 'compliance-calendar', at: now(), version, entries: structuredClone(entries) }; state.schedules.push(calendar); audit(state, 'calendar.published', { version, entries: entries.length }); return calendar; });
  }
  async brief(ctx: Context, input: Omit<CalculationRequest, 'operation'> & { onDate?: string; ritual?: 'monday' | 'friday' } = {}) {
    authorize(this.store, ctx); const onDate = input.onDate ?? now().slice(0, 10); check(validDate(onDate), 'INVALID_DATE', 'Give a valid briefing date.');
    const { ritual = 'monday', ...request } = input; const report = await this.report(ctx, 'investor', request);
    const decisions = this.decisions(ctx, { dueOn: onDate, branch: input.branch }); const calendars = this.store.read().schedules.filter(s => s.type === 'compliance-calendar'); const calendar = calendars.at(-1);
    const dueDates = calendar?.entries.filter((e: ComplianceEntry) => e.dueDate >= onDate && Date.parse(e.dueDate) - Date.parse(onDate) <= 14 * 86_400_000) ?? [];
    const finalView = stateView(this.store.read()); authorize(finalView, ctx);
    const scope = { ...(input.branch === undefined ? {} : { branch: input.branch }), ...(input.sourceIds === undefined ? {} : { sourceIds: [...input.sourceIds] }) };
    const alerts: AlertBrief = this.options.alertBrief?.(ctx, scope, finalView) ?? { configured: false, evaluated: false, checkedAt: now(),
      scope: { branch: input.branch ?? null, sourceIds: input.sourceIds ?? null }, items: [], receiptIds: [], pin: hash({ configured: false }) };
    const receiptIds = [...new Set([...report.receiptIds, ...alerts.receiptIds])];
    receiptIds.forEach(id => this.calculatorAt(finalView).receipt(ctx, id));
    return { id: newId('brief'), ritual, onDate, headline: ritual === 'friday' ? 'Your weekly review is ready' : 'Your weekly business brief is ready', report, decisions, alerts, compliance: { entries: dueDates, calendarVersion: calendar?.version ?? null, status: calendar ? 'human-reviewed-source-list' : 'No published compliance calendar. No dates were guessed.' }, delivery: { state: 'draft', channels: ['email', 'whatsapp'], requiresApproval: true }, receiptIds };
  }
  async forecast(ctx: Context, input: { receiptIds: string[] }) {
    authorize(this.store, ctx); check(input && Object.keys(input).length === 1 && Array.isArray(input.receiptIds), 'INVALID_FORECAST', 'Forecast from explicit monthly calculation receipts.');
    const receipts = input.receiptIds.map(id => this.calculator.receipt(ctx, id));
    check(receipts.length >= 8 && receipts.every(r => ['earned', 'revenue'].includes(r.operation) && r.period && !r.stale && r.coverage.completeness === 'reconciled-imports'), 'FORECAST_HISTORY_REQUIRED', 'A forecast needs at least eight current reconciled monthly earned-revenue receipts.');
    const currencies = new Set(receipts.map(r => r.currency)); const hashes = new Set(receipts.map(r => r.definitionHash)); check(currencies.size === 1 && hashes.size === 1, 'FORECAST_DEFINITION_MISMATCH', 'Monthly receipts must use the same definition and currency.');
    receipts.sort((a, b) => a.period!.from.localeCompare(b.period!.from));
    for (let i = 0; i < receipts.length; i++) {
      const p = receipts[i].period!; const month = new Date(`${p.from}T00:00:00Z`); const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      check(p.from.endsWith('-01') && p.to === end, 'FORECAST_MONTH_REQUIRED', 'Every forecast receipt must cover one whole calendar month.');
      if (i) { const prior = new Date(`${receipts[i - 1].period!.from}T00:00:00Z`); const next = new Date(Date.UTC(prior.getUTCFullYear(), prior.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); check(p.from === next, 'FORECAST_GAP', 'Monthly history must be consecutive and contain no duplicate periods.'); }
    }
    const series = receipts.map(r => BigInt(r.totalMinor)); const holdout = Math.min(3, series.length - 5); let baselineError = 0n, candidateError = 0n; const folds: any[] = [];
    for (let i = series.length - holdout; i < series.length; i++) { const baseline = series[i - 1], candidate = forecastValue(series.slice(0, i)), actual = series[i]; const baselineAbs = actual >= baseline ? actual - baseline : baseline - actual; const candidateAbs = actual >= candidate ? actual - candidate : candidate - actual; baselineError += baselineAbs; candidateError += candidateAbs; folds.push({ period: receipts[i].period, actualMinor: String(actual), baselineMinor: String(baseline), candidateMinor: String(candidate), baselineErrorMinor: String(baselineAbs), candidateErrorMinor: String(candidateAbs) }); }
    const beatsBaseline = candidateError < baselineError; const baseline = series.at(-1)!; const forecast = beatsBaseline ? forecastValue(series) : null; const currency = receipts[0].currency;
    const result = { id: newId('forecast'), operation: 'forecast', qualification: 'experimental', status: beatsBaseline ? 'passed-local-baseline-gate' : 'refused', createdAt: now(), receiptIds: receipts.map(r => r.id), rowIds: [...new Set(receipts.flatMap(r => r.rowIds))], method: 'Expanding-window linear trend with exact integer-cent arithmetic; fractional cents truncate toward zero', baseline: 'Last observed month', errorMetric: 'Sum of absolute errors on withheld final months', holdoutMonths: holdout, baselineErrorMinor: String(baselineError), candidateErrorMinor: String(candidateError), folds, forecastMinor: forecast === null ? null : String(forecast), baselineMinor: String(baseline), currency, display: forecast === null ? 'Forecast refused: it did not beat the last-month baseline in the local rolling backtest.' : formatMoney(forecast, currency), uncertainty: 'This local backtest is not independent qualification. Changes in operations or seasonality can invalidate the forecast.', hash: '' }; result.hash = hash(result);
    await this.store.update(state => { authorize(this.store, ctx); result.receiptIds.forEach(id => this.calculator.receipt(ctx, id)); state.answers.push({ ...structuredClone(result), type: 'forecast', stale: false }); audit(state, 'forecast.backtested', { forecastId: result.id, beatsBaseline }); }); return result;
  }
}
