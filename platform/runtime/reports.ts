import { authorize, audit, check, hash, newId, now, type Context, type StateStore } from './contracts.ts';
import { CalculatorService, numberGuard, formatMoney, type CalculationReceipt, type CalculationRequest, type CalculatorOptions } from './calculator.ts';
import { currentAccess, validDate } from './memory.ts';

export type DecisionInput = { text: string; reviewDate: string; receiptIds?: string[]; hypotheses?: string[]; branch?: string };
export type DecisionReview = { outcome: 'accepted' | 'rejected' | 'continue' | 'completed'; notes?: string };
export type ComplianceEntry = { title: string; dueDate: string; sourceUrl: string; publishedAt: string; reviewedBy: string };
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function forecastValue(series: bigint[]): bigint {
  const count = BigInt(series.length); const sumX = count * (count - 1n) / 2n; const sumXX = count * (count - 1n) * (2n * count - 1n) / 6n; const sumY = series.reduce((a, b) => a + b, 0n); const sumXY = series.reduce((a, b, i) => a + BigInt(i) * b, 0n);
  const denominator = count * sumXX - sumX * sumX; if (denominator === 0n) return series.at(-1)!;
  const slopeNumerator = count * sumXY - sumX * sumY;
  return (sumY * denominator + slopeNumerator * (count * count - sumX)) / (count * denominator);
}
export class ReportService {
  store: StateStore;
  calculator: CalculatorService;
  constructor(store: StateStore, options: CalculatorOptions = {}) { this.store = store; this.calculator = new CalculatorService(store, options); }
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
    return this.store.update(state => { authorize(this.store, ctx, 'prepare'); (input.receiptIds ?? []).forEach(id => this.calculator.receipt(ctx, id)); const decision = { id: newId('decision'), ...structuredClone(input), text: input.text.trim(), receiptIds: input.receiptIds ?? [], hypotheses: input.hypotheses ?? [], rowIds: [...new Set(receipts.flatMap(r => r.rowIds))], createdAt: now(), by: ctx.memberId, status: 'open', reviews: [] }; state.decisions.push(decision); audit(state, 'decision.created', { decisionId: decision.id, reviewDate: input.reviewDate }); return structuredClone(decision); });
  }
  decisions(ctx: Context, filter: { dueOn?: string; branch?: string } = {}) {
    authorize(this.store, ctx); currentAccess(this.store, ctx, filter.branch); if (filter.dueOn) check(validDate(filter.dueOn), 'INVALID_DATE', 'Give a valid due-on date.');
    const items = this.store.read().decisions.filter(d => !d.branch || !filter.branch || d.branch === filter.branch).filter(d => !filter.dueOn || (d.reviewDate <= filter.dueOn && d.status === 'open'));
    return structuredClone(items.filter(d => { try { currentAccess(this.store, ctx, d.branch); (d.receiptIds ?? []).forEach((id: string) => this.calculator.receipt(ctx, id)); return true; } catch { return false; } }));
  }
  async reviewDecision(ctx: Context, id: string, review: DecisionReview) {
    authorize(this.store, ctx, 'prepare'); check(['accepted', 'rejected', 'continue', 'completed'].includes(review.outcome) && Object.keys(review).every(k => ['outcome', 'notes'].includes(k)), 'INVALID_REVIEW', 'Choose a declared decision outcome.');
    const available = this.decisions(ctx).find(d => d.id === id); check(available, 'DECISION_NOT_FOUND', 'This decision is unavailable under your current access.');
    return this.store.update(state => { authorize(this.store, ctx, 'prepare'); check(this.decisions(ctx).some(d => d.id === id), 'DECISION_NOT_FOUND', 'Decision access changed.'); const d = state.decisions.find(d => d.id === id)!; d.reviews.push({ ...structuredClone(review), at: now(), by: ctx.memberId }); d.status = review.outcome === 'continue' ? 'open' : 'closed'; audit(state, 'decision.reviewed', { decisionId: id, outcome: review.outcome }); return structuredClone(d); });
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
    authorize(this.store, ctx); report.receiptIds.forEach(id => this.calculator.receipt(ctx, id));
    return { id: newId('brief'), ritual, onDate, headline: ritual === 'friday' ? 'Your weekly review is ready' : 'Your weekly business brief is ready', report, decisions, compliance: { entries: dueDates, calendarVersion: calendar?.version ?? null, status: calendar ? 'human-reviewed-source-list' : 'No published compliance calendar. No dates were guessed.' }, delivery: { state: 'draft', channels: ['email', 'whatsapp'], requiresApproval: true }, receiptIds: report.receiptIds };
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
