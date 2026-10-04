import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrowserTodayReader, createDesktopTodayReader, projectBriefToday, projectDashboardToday, projectTodayHostForUi,
} from '../src/bridge/today-host.ts';
import type {
  BriefTodayInput, DashboardTodayInput, DesktopTodayReadPort, TodayHostProjection,
} from '../src/bridge/today-host.ts';
import type { CalculationReceiptEvidence } from '../src/bridge/presentation.ts';
import { ReplyValidationError, projectCalculationReceipt } from '../src/bridge/validate.ts';
import { fullCalculationReceiptFixture, HUGE_INTEGER } from './fixtures.ts';
import { projectTodayForUi } from '../src/bridge/project-ui.ts';

/** Source-shaped synthetic envelopes; they never qualify a database or live workspace. */
type FullReceipt = ReturnType<typeof fullCalculationReceiptFixture> & { requestedSourceIds?: readonly string[] };
const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceTime = '2026-10-01T09:00:00.000Z';
const PRIVATE = 'PRIVATE_SOURCE_SQL_TOKEN_FIXTURE';

function sumReceipt(operation: string, minor = '900', currency = 'INR'): FullReceipt {
  const base = fullCalculationReceiptFixture();
  const kind = operation === 'billed' ? 'invoice' : operation === 'received' ? 'payment' : 'sale';
  return {
    ...base, id: `receipt_${operation}`, operation, currency,
    definitions: [{ name: operation, label: operation, meaning: 'Synthetic fixture definition.', kind, field: 'amountMinor', currency, nulls: 'reject' }],
    figures: [{ key: 'total', label: `Engine ${operation}`, minor, display: `${currency} source-formatted fixture value`, unit: 'money', currency }],
    valueMinor: minor, totalMinor: minor, sourceIds: ['source_fixture'], rowIds: [`fact_${operation}`],
    rows: [{ factId: `fact_${operation}`, entityId: `entity_${operation}`, sourceId: 'source_fixture', sourceRow: 2, kind, amountMinor: minor, validFrom: '2026-09-10' }],
    exclusions: [], coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0, unresolvedConflicts: 0, importIds: ['import_fixture'], completeness: 'reconciled-imports', gaps: [] },
    assumptions: {}, explanation: 'Synthetic receipt fixture.', allowedNumbers: [minor, '1'],
  };
}

function marginReceipt(): FullReceipt { return { ...fullCalculationReceiptFixture(), id: 'receipt_margin' }; }
function dashboardReceipts(): FullReceipt[] { return [sumReceipt('billed'), sumReceipt('received'), sumReceipt('earned'), marginReceipt()]; }
function fresh(receipts: readonly FullReceipt[]): CalculationReceiptEvidence[] { return receipts.map(receipt => projectCalculationReceipt(receipt)); }

const uiConfig = { language: 'en' as const, timeZone: 'Asia/Kolkata', missingWords: { absent: 'Absent', null: 'Not recorded', unknown: 'Not known', withheld: 'Withheld', 'not-applicable': 'Not applicable', 'not-loaded-yet': 'Not loaded yet', 'not-counted': 'Not counted' } };
function dashboard(calculations: readonly unknown[] = dashboardReceipts()) {
  return {
    workspace: { id: 'workspace_fixture', name: 'Synthetic Today fixture', currency: 'INR', demo: true, createdAt: sourceTime },
    calculations, factCount: 3, sources: 1,
    decisions: [{ id: 'decision_fixture', text: PRIVATE, status: 'open' }],
    waitingActions: [{ id: 'action_fixture', status: 'unknown', payload: { private: PRIVATE } }],
    jobs: [{ id: 'job_fixture', goal: PRIVATE }],
    policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false },
    dictionary: null,
    lastActivity: [{ id: 'event_old', at: '2020-01-01T09:00:00.000Z', event: PRIVATE, details: { private: PRIVATE } }],
  };
}

function brief(receipts: readonly FullReceipt[] = [marginReceipt()]) {
  const receiptIds = receipts.map(receipt => receipt.id);
  return {
    id: 'brief_fixture', ritual: 'monday', onDate: '2026-10-01', headline: 'Your weekly business brief is ready',
    report: {
      id: 'report_fixture', title: 'Investor review pack', type: 'investor', createdAt: sourceTime, status: 'partial',
      sections: receipts.map(receipt => ({ title: receipt.operation, receiptId: receipt.id, figures: receipt.figures, period: receipt.period, asOf: receipt.asOf, dictionaryHash: receipt.dictionaryHash, coverage: receipt.coverage, explanation: receipt.explanation })),
      receiptIds, rowIds: [...new Set(receipts.flatMap(receipt => [...receipt.rowIds]))],
      gaps: ['Synthetic fixture: contribution includes imported costs only.'], html: `<html>${PRIVATE}</html>`, delivery: 'local-draft',
    },
    decisions: [{ id: 'decision_fixture', text: PRIVATE, receiptIds }],
    alerts: { configured: false, evaluated: false, checkedAt: sourceTime,
      scope: { branch: receipts[0]?.branch ?? null, sourceIds: receipts[0]?.requestedSourceIds ?? null },
      items: [], receiptIds: [], pin: 'd'.repeat(64) },
    compliance: { entries: [], calendarVersion: null, status: 'No published compliance calendar. No dates were guessed.' },
    delivery: { state: 'draft', channels: ['email', 'whatsapp'], requiresApproval: true }, receiptIds,
  };
}

/** Current reports.brief shape from reports.ts and alerts-contracts.ts. Synthetic
 * alert evidence qualifies only this source contract, never a live workspace. */
function currentBrief(reportReceipts: readonly FullReceipt[] = [marginReceipt()], alertReceipts: readonly FullReceipt[] = []) {
  const snapshot = brief(reportReceipts);
  const alertReceiptIds = [...new Set(alertReceipts.map(receipt => receipt.id))].sort();
  const alerts = {
    configured: alertReceipts.length > 0, evaluated: false, checkedAt: sourceTime,
    scope: { branch: null, sourceIds: null },
    items: alertReceipts.length ? [{
      alertId: 'alert_fixture', conditionId: 'condition_fixture', label: PRIVATE, revision: 1, definitionDigest: 'c'.repeat(64),
      branch: null, sourceIds: ['source_fixture'],
      episodes: [{ id: 'episode_fixture', status: 'open', severity: 'critical', openedAt: sourceTime, reopenCount: 0, uncertain: false, observationIds: ['observation_fixture'] }],
      observation: { id: 'observation_fixture', observedAt: sourceTime, recordedAt: sourceTime, state: 'breach', receiptId: alertReceipts.at(-1)!.id },
      evidence: { state: 'current', issues: [] }, receiptIds: alertReceiptIds,
    }] : [],
    receiptIds: alertReceiptIds, pin: 'd'.repeat(64),
  };
  return { ...snapshot, alerts, receiptIds: [...new Set([...snapshot.receiptIds, ...alerts.receiptIds])] };
}

function dashboardInput(): DashboardTodayInput {
  return { title: 'Today fixture', date: '2026-10-01', request: { period }, selections: [{ operation: 'earned', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }, { operation: 'margin', figureKey: 'marginBps' }] };
}
function briefInput(): BriefTodayInput {
  return { title: 'Today fixture', date: '2026-10-01', request: { period, onDate: '2026-10-01', ritual: 'monday' }, selections: [{ operation: 'margin', figureKey: 'contribution' }] };
}
function stat(projection: TodayHostProjection, operation: string, figureKey: string) {
  const evidence = projection.statsEvidence.find(item => item.operation === operation && item.figureKey === figureKey);
  assert.ok(evidence, `Missing evidence for ${operation}/${figureKey}`);
  const tile = projection.today.stats.find(item => item.id === evidence.statId);
  assert.ok(tile, `Missing tile for ${operation}/${figureKey}`);
  return { tile, evidence };
}
function invalid(read: () => unknown): void { assert.throws(read, ReplyValidationError); }
function denial(code = 'ACCESS_REVOKED') { return Object.assign(new Error(PRIVATE), { code }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('dashboard selection preserves huge exact money, margin contribution and ratio units from fresh receipts', () => {
  const receipts = dashboardReceipts().map(receipt => receipt.operation === 'earned' ? sumReceipt('earned', HUGE_INTEGER) : receipt);
  const result = projectDashboardToday(dashboard(receipts), fresh(receipts), dashboardInput());
  assert.equal(result.source, 'dashboard');
  const earned = stat(result, 'earned', 'total');
  assert.equal(earned.tile.figure.kind, 'money');
  if (earned.tile.figure.kind !== 'money') assert.fail('Lost money unit');
  assert.equal(earned.tile.figure.paise, HUGE_INTEGER);
  assert.equal(earned.tile.figure.receiptId, 'receipt_earned');
  assert.equal(earned.tile.label, 'Engine earned');
  assert.equal(earned.evidence.engineFigure.display, receipts[2]!.figures[0]!.display);
  assert.equal(stat(result, 'margin', 'contribution').evidence.engineFigure.minor, '275');
  const ratio = stat(result, 'margin', 'marginBps');
  assert.equal(ratio.tile.figure.kind, 'percent');
  if (ratio.tile.figure.kind !== 'percent') assert.fail('Ratio was relabeled money');
  assert.equal(ratio.tile.figure.basisPoints, '3437');
  assert.equal(ratio.evidence.engineFigure.unit, 'basis-points');
  assert.equal(Object.hasOwn(ratio.evidence.engineFigure, 'currency'), false);
  assert.deepEqual(earned.evidence.scope, { period, asOf: sourceTime, branch: null, currency: 'INR' });
  assert.ok(Object.isFrozen(result.today.stats));
  assert.ok(Object.isFrozen(earned.evidence.coverage));
});

test('Today never derives aggregate counts, attention rows, historical day marks or plots from opaque source records', () => {
  const receipts = dashboardReceipts();
  const result = projectDashboardToday(dashboard(receipts), fresh(receipts), dashboardInput());
  assert.deepEqual(result.today.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
  assert.equal(result.today.pendingCount, null);
  assert.deepEqual(result.today.attention, []); assert.deepEqual(result.today.worthLook, []); assert.deepEqual(result.today.dayEvents, []);
  assert.ok(result.today.stats.every(tile => tile.chart === null));
  assert.equal(result.unavailable.charts, 'TODAY_CHART_SERIES_NOT_PROVIDED');
  assert.equal(result.unavailable.pendingCount, 'TODAY_PENDING_COUNT_NOT_PROVIDED');
  assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  for (const invented of ['factCount', 'sources', 'jobs', 'lastActivity', 'waitingActions', 'decisions', 'cause', 'html']) assert.equal(Object.hasOwn(result.today, invented), false);
});

test('failed calculations, omitted ratios and foreign currency become explicit unavailable selections', () => {
  const input = { ...dashboardInput(), selections: [{ operation: 'billed', figureKey: 'total' }] };
  const remaining = dashboardReceipts().filter(receipt => receipt.operation !== 'billed');
  const failed = projectDashboardToday(dashboard([{ operation: 'billed', error: PRIVATE }, ...remaining]), fresh(remaining), input);
  assert.deepEqual(failed.unavailableSelections, [{ operation: 'billed', figureKey: 'total', reasonCode: 'CALCULATION_UNAVAILABLE' }]);
  assert.equal(JSON.stringify(failed).includes(PRIVATE), false);
  const noRatio = dashboardReceipts().map(receipt => receipt.operation === 'margin' ? { ...receipt, figures: receipt.figures.filter(figure => figure.key !== 'marginBps') } : receipt);
  const omitted = projectDashboardToday(dashboard(noRatio), fresh(noRatio), { ...input, selections: [{ operation: 'margin', figureKey: 'marginBps' }] });
  assert.deepEqual(omitted.unavailableSelections, [{ operation: 'margin', figureKey: 'marginBps', reasonCode: 'FIGURE_NOT_PROVIDED' }]);
  const foreign = dashboardReceipts().map(receipt => receipt.operation === 'billed' ? sumReceipt('billed', '900', 'USD') : receipt);
  const unsupported = projectDashboardToday(dashboard(foreign), fresh(foreign), input);
  assert.deepEqual(unsupported.unavailableSelections, [{ operation: 'billed', figureKey: 'total', reasonCode: 'UNSUPPORTED_PRESENTATION_CURRENCY' }]);
  assert.equal(unsupported.statsEvidence.some(item => item.operation === 'billed'), false);
});

test('counted zero stays known while empty and wholly unknown source coverage never become business zero', () => {
  const input = { ...dashboardInput(), selections: [{ operation: 'earned', figureKey: 'total' }] };
  const zero = sumReceipt('earned', '0');
  const known = dashboardReceipts().map(receipt => receipt.operation === 'earned' ? zero : receipt);
  const figure = stat(projectDashboardToday(dashboard(known), fresh(known), input), 'earned', 'total').tile.figure;
  assert.equal(figure.kind, 'money'); if (figure.kind !== 'money') assert.fail('Counted zero became unknown'); assert.equal(figure.paise, '0');
  for (const completeness of ['empty', 'partial'] as const) {
    const unknown: FullReceipt = { ...zero, sourceIds: [], rowIds: [], rows: [], exclusions: [], coverage: { selectedRows: completeness === 'partial' ? 1 : 0, countedRows: 0, excludedRows: 0, unresolvedConflicts: 0, importIds: [], completeness, gaps: ['Unknown activity is not zero.'] } };
    const receipts = dashboardReceipts().map(receipt => receipt.operation === 'earned' ? unknown : receipt);
    const result = projectDashboardToday(dashboard(receipts), fresh(receipts), input);
    assert.deepEqual(stat(result, 'earned', 'total').tile.figure, { kind: 'missing', state: 'unknown' });
    assert.equal(stat(result, 'earned', 'total').evidence.coverage.completeness, completeness);
  }
});

test('brief projection retains weekly/draft qualification and explicit empty reviewed source scope', () => {
  const scoped: FullReceipt = { ...marginReceipt(), requestedSourceIds: [], sourceIds: [], rowIds: [], rows: [], exclusions: [], coverage: { selectedRows: 0, countedRows: 0, excludedRows: 0, unresolvedConflicts: 0, importIds: [], completeness: 'empty', gaps: ['Explicit empty scope.'] } };
  const input = { ...briefInput(), request: { ...briefInput().request, sourceIds: [] } };
  const result = projectBriefToday(brief([scoped]), fresh([scoped]), input);
  assert.equal(result.source, 'brief');
  assert.deepEqual(result.statsEvidence[0]!.scope.requestedSourceIds, []);
  assert.equal(result.brief?.headline, 'Your weekly business brief is ready');
  assert.deepEqual(result.brief?.delivery, { state: 'draft', channels: ['email', 'whatsapp'], requiresApproval: true });
  assert.equal(result.brief?.report.delivery, 'local-draft');
  assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  assert.deepEqual(result.today.dayEvents, []);
  assert.equal(result.today.pendingCount, null);
});

test('brief report gaps expose fresh coverage and the fixed qualification while suppressing operation error text', () => {
  const receipts = [marginReceipt()];
  const snapshot = brief(receipts);
  const qualification = 'This is an investor data annex. It does not provide a valuation or certify unimported metrics.';
  const coverageGap = receipts[0]!.coverage.gaps[0]!;
  const result = projectBriefToday({ ...snapshot, report: { ...snapshot.report, gaps: [coverageGap, `billed: ${PRIVATE}`, qualification] } }, fresh(receipts), briefInput());
  assert.deepEqual(result.brief?.report.gaps, [coverageGap, qualification]);
  assert.equal(JSON.stringify(result).includes(PRIVATE), false);
});

test('duplicate or mismatched receipt snapshots and request scope fail atomically', () => {
  const receipts = dashboardReceipts();
  const snapshot = dashboard(receipts);
  invalid(() => projectDashboardToday({ ...snapshot, calculations: [receipts[0], receipts[0], receipts[2], receipts[3]] }, fresh(receipts), dashboardInput()));
  invalid(() => projectDashboardToday(snapshot, [fresh(receipts)[0]!, fresh(receipts)[0]!, ...fresh(receipts).slice(2)], dashboardInput()));
  const changed = receipts.map(receipt => receipt.operation === 'earned' ? sumReceipt('earned', '901') : receipt);
  invalid(() => projectDashboardToday(snapshot, fresh(changed), dashboardInput()));
  const wrongScope = receipts.map(receipt => receipt.operation === 'earned' ? { ...receipt, branch: 'west' } : receipt);
  invalid(() => projectDashboardToday(snapshot, fresh(wrongScope), dashboardInput()));
  invalid(() => projectDashboardToday(snapshot, fresh(receipts).slice(0, 3), dashboardInput()));
  const extra = sumReceipt('net_sales');
  invalid(() => projectDashboardToday(snapshot, [...fresh(receipts), ...fresh([extra])], dashboardInput()));
  invalid(() => projectDashboardToday(snapshot, fresh(receipts), { ...dashboardInput(), request: { period: { from: '2026-08-01', to: '2026-08-31' } } }));
});

test('dashboard fresh authorization preserves immutable receipt provenance while allowing a refreshed stale flag', () => {
  const receipts = dashboardReceipts();
  const snapshot = dashboard(receipts);
  const mutations = [
    { asOf: '2026-10-02T09:00:00.000Z' },
    { createdAt: '2026-10-02T09:00:00.000Z' },
    { ontologyVersion: 2 },
    { memberId: 'other_member' },
    { epoch: 2 },
    { dictionaryHash: 'c'.repeat(64) },
    { definitionHash: 'd'.repeat(64) },
    { valueMinor: '901', totalMinor: '901' },
  ];
  for (const mutation of mutations) {
    const changed = receipts.map(receipt => receipt.operation === 'earned' ? { ...receipt, ...mutation } : receipt);
    invalid(() => projectDashboardToday(snapshot, fresh(changed), dashboardInput()));
  }
  const refreshed = receipts.map(receipt => ({ ...receipt, stale: true }));
  assert.equal(projectDashboardToday(snapshot, fresh(refreshed), dashboardInput()).receipts.every(receipt => receipt.stale), true);
});

test('brief section summaries match fresh receipt identity, figures, coverage and scope in order', () => {
  const receipts = [sumReceipt('billed'), marginReceipt()];
  const snapshot = brief(receipts);
  const input = { ...briefInput(), selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }] };
  assert.equal(projectBriefToday(snapshot, fresh(receipts), input).statsEvidence.length, 2);
  invalid(() => projectBriefToday({ ...snapshot, receiptIds: [...snapshot.receiptIds].reverse() }, fresh(receipts), input));
  invalid(() => projectBriefToday({ ...snapshot, report: { ...snapshot.report, receiptIds: ['other_receipt', receipts[1]!.id] } }, fresh(receipts), input));
  invalid(() => projectBriefToday({ ...snapshot, report: { ...snapshot.report, sections: [snapshot.report.sections[0], snapshot.report.sections[0]] } }, fresh(receipts), input));
  const changed = receipts.map(receipt => receipt.operation === 'billed' ? sumReceipt('billed', '901') : receipt);
  invalid(() => projectBriefToday(snapshot, fresh(changed), input));
  const changedTime = receipts.map(receipt => ({ ...receipt, asOf: '2026-10-02T09:00:00.000Z' }));
  invalid(() => projectBriefToday(snapshot, fresh(changedTime), input));
  invalid(() => projectBriefToday(snapshot, fresh(receipts), { ...input, request: { ...input.request, sourceIds: [] } }));
});

test('malformed source envelopes, accessors and cycles are refused without executing book data', () => {
  const receipts = dashboardReceipts();
  const snapshot = dashboard(receipts);
  for (const value of [{ ...snapshot, calculations: [] }, { ...snapshot, sources: -1 }, { ...snapshot, factCount: '3' }, { ...snapshot, workspace: null }, { ...snapshot, extra: PRIVATE }]) invalid(() => projectDashboardToday(value, fresh(receipts), dashboardInput()));
  let invoked = 0;
  const accessor = Object.defineProperty({ ...snapshot }, 'calculations', { enumerable: true, get() { invoked++; return receipts; } });
  invalid(() => projectDashboardToday(accessor, fresh(receipts), dashboardInput()));
  assert.equal(invoked, 0);
  const nested = Object.defineProperty({}, 'private', { enumerable: true, get() { invoked++; return PRIVATE; } });
  invalid(() => projectDashboardToday({ ...snapshot, jobs: [nested] }, fresh(receipts), dashboardInput()));
  assert.equal(invoked, 0);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  invalid(() => projectDashboardToday({ ...snapshot, decisions: [cycle] }, fresh(receipts), dashboardInput()));
  invalid(() => projectDashboardToday(Object.setPrototypeOf({ ...snapshot }, { private: PRIVATE }), fresh(receipts), dashboardInput()));
  invalid(() => projectDashboardToday({ ...snapshot, decisions: [Object.create(null)] }, fresh(receipts), dashboardInput()));
  const large = 'x'.repeat(2000000);
  invalid(() => projectDashboardToday({ ...snapshot, dictionary: { descriptions: [large, large, large, large, large] } }, fresh(receipts), dashboardInput()));
  const report = brief();
  invalid(() => projectBriefToday({ ...report, delivery: { ...report.delivery, state: 'sent' } }, fresh([marginReceipt()]), briefInput()));
});

test('desktop and browser readers use distinct ports and reread every successful receipt including unselected ones', async () => {
  const receipts = dashboardReceipts();
  const calls: unknown[] = [];
  const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
  const port: DesktopTodayReadPort = { async request(method, payload) { calls.push({ method, payload }); if (method === 'dashboard.get') return dashboard(receipts); if (method === 'reports.brief') return brief([receipts[3]!]); return byId.get((payload as { id: string }).id); } };
  const reader = createDesktopTodayReader(port);
  assert.equal(reader.environment, 'desktop');
  const input = { ...dashboardInput(), selections: [{ operation: 'margin', figureKey: 'contribution' }] };
  assert.equal((await reader.dashboard(input)).ok, true);
  assert.deepEqual(calls[0], { method: 'dashboard.get', payload: { period } });
  assert.deepEqual(calls.slice(1), receipts.map(receipt => ({ method: 'receipts.get', payload: { id: receipt.id } })));
  calls.length = 0;
  assert.equal((await reader.dashboard(input)).ok, true);
  assert.equal(calls.filter(call => (call as { method: string }).method === 'receipts.get').length, 4);
  const browserCalls: unknown[] = [];
  const browser = createBrowserTodayReader({ async call(message) { browserCalls.push(message); if (message.method === 'reports.brief') return brief([receipts[3]!]); if (message.method === 'dashboard.get') return dashboard(receipts); return byId.get(message.payload.id); } });
  assert.equal(browser.environment, 'browser');
  assert.equal((await browser.brief(briefInput())).ok, true);
  assert.deepEqual(browserCalls, [{ method: 'reports.brief', payload: briefInput().request }, { method: 'receipts.get', payload: { id: 'receipt_margin' } }]);
});

test('current reports.brief empty alerts envelopes retain draft and partial Today qualification', async () => {
  const receipt = marginReceipt();
  for (const configured of [false, true]) for (const environment of ['desktop', 'browser'] as const) {
    const snapshot = currentBrief([receipt]);
    snapshot.alerts.configured = configured;
    const calls: unknown[] = [];
    async function read(method: string, payload: unknown) {
      calls.push({ method, payload });
      if (method === 'reports.brief') return snapshot;
      assert.equal(method, 'receipts.get');
      assert.deepEqual(payload, { id: receipt.id });
      return receipt;
    }
    const reader = environment === 'desktop' ? createDesktopTodayReader({ request: read })
      : createBrowserTodayReader({ call: message => read(message.method, message.payload) });
    const result = await reader.brief(briefInput());
    assert.equal(result.ok, true, `${environment} rejected the current empty alerts contract (configured=${configured})`);
    if (!result.ok) assert.fail('Current reports.brief envelope was rejected');
    assert.deepEqual(calls, [{ method: 'reports.brief', payload: briefInput().request }, { method: 'receipts.get', payload: { id: receipt.id } }]);
    assert.deepEqual(result.value.today.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
    assert.equal(result.value.today.pendingCount, null);
    assert.deepEqual(result.value.today.attention, []);
    assert.deepEqual(result.value.today.worthLook, []);
    assert.deepEqual(result.value.today.dayEvents, []);
    assert.ok(result.value.today.stats.every(tile => tile.chart === null));
    assert.equal(result.value.brief?.delivery.state, 'draft');
    const ui = projectTodayHostForUi(result.value, uiConfig);
    assert.equal(ui.data.earlierTodayMissing, 'unknown');
    assert.deepEqual(ui.data.review.count, { exact: null, display: 'Not known' });
    assert.equal(JSON.stringify(ui).includes(PRIVATE), false);
  }
});

test('current reports.brief rereads the report and alert receipt union once without promoting alert-only evidence to report stats', async () => {
  const reportReceipt = marginReceipt(), billed = sumReceipt('billed');
  const alertReceipt: FullReceipt = { ...billed, period: { from: '2026-08-01', to: '2026-08-31' }, rows: billed.rows.map(row => ({ ...row, validFrom: '2026-08-10' })) };
  const snapshot = currentBrief([reportReceipt], [reportReceipt, alertReceipt]);
  assert.deepEqual(snapshot.report.receiptIds, [reportReceipt.id]);
  assert.deepEqual(snapshot.alerts.receiptIds, [alertReceipt.id, reportReceipt.id]);
  assert.deepEqual(snapshot.receiptIds, [reportReceipt.id, alertReceipt.id]);
  const input = { ...briefInput(), selections: [{ operation: 'margin', figureKey: 'contribution' }, { operation: 'billed', figureKey: 'total' }] };
  for (const environment of ['desktop', 'browser'] as const) {
    const calls: unknown[] = [];
    async function read(method: string, payload: unknown) {
      calls.push({ method, payload });
      if (method === 'reports.brief') return snapshot;
      assert.equal(method, 'receipts.get');
      return [reportReceipt, alertReceipt].find(receipt => receipt.id === (payload as { id: string }).id);
    }
    const reader = environment === 'desktop' ? createDesktopTodayReader({ request: read })
      : createBrowserTodayReader({ call: message => read(message.method, message.payload) });
    const result = await reader.brief(input);
    assert.equal(result.ok, true, `${environment} rejected the current alert receipt union`);
    if (!result.ok) assert.fail('Current report and alert receipt union was rejected');
    assert.deepEqual(calls, [{ method: 'reports.brief', payload: input.request }, ...snapshot.receiptIds.map(id => ({ method: 'receipts.get', payload: { id } }))]);
    assert.equal(stat(result.value, 'margin', 'contribution').evidence.receiptId, reportReceipt.id);
    assert.equal(result.value.statsEvidence.length, 1);
    assert.deepEqual(result.value.unavailableSelections, [{ operation: 'billed', figureKey: 'total', reasonCode: 'CALCULATION_UNAVAILABLE' }]);
    assert.deepEqual(result.value.today.attention, []);
    assert.equal(result.value.today.pendingCount, null);
    assert.deepEqual(result.value.today.dayEvents, []);
    assert.equal(Object.hasOwn(result.value, 'alerts'), false);
    const ui = projectTodayHostForUi(result.value, uiConfig);
    assert.equal(ui.data.earlierTodayMissing, 'unknown');
    assert.equal(JSON.stringify(result).includes(PRIVATE), false);
    assert.equal(JSON.stringify(ui).includes(PRIVATE), false);
    for (const receiptIds of [[reportReceipt.id], [alertReceipt.id, reportReceipt.id], [reportReceipt.id, alertReceipt.id, alertReceipt.id], [reportReceipt.id, 'receipt_unreferenced']]) {
      invalid(() => projectBriefToday({ ...snapshot, receiptIds }, fresh([reportReceipt, alertReceipt]), input));
    }
  }
});

test('current reports.brief accepts lexically sorted alert receipt IDs independently of alert item order', async () => {
  const reportReceipt = marginReceipt();
  const highReceipt: FullReceipt = { ...sumReceipt('billed'), id: 'receipt_z' };
  const lowReceipt: FullReceipt = { ...sumReceipt('billed'), id: 'receipt_a' };
  const snapshot = currentBrief([reportReceipt], [highReceipt, lowReceipt]);
  const item = snapshot.alerts.items[0]!;
  snapshot.alerts.items = [
    { ...item, alertId: 'alert_a', conditionId: 'condition_a', receiptIds: [highReceipt.id],
      episodes: [{ ...item.episodes[0]!, id: 'episode_a', observationIds: ['observation_a'] }],
      observation: { ...item.observation, id: 'observation_a', receiptId: highReceipt.id } },
    { ...item, alertId: 'alert_z', conditionId: 'condition_z', receiptIds: [lowReceipt.id],
      episodes: [{ ...item.episodes[0]!, id: 'episode_z', observationIds: ['observation_z'] }],
      observation: { ...item.observation, id: 'observation_z', receiptId: lowReceipt.id } },
  ];
  snapshot.alerts.receiptIds = [lowReceipt.id, highReceipt.id];
  snapshot.receiptIds = [reportReceipt.id, ...snapshot.alerts.receiptIds];
  assert.deepEqual(snapshot.alerts.items.map(value => value.alertId), ['alert_a', 'alert_z']);
  assert.deepEqual(snapshot.alerts.items.flatMap(value => value.receiptIds), [highReceipt.id, lowReceipt.id]);
  assert.deepEqual(snapshot.receiptIds, [reportReceipt.id, lowReceipt.id, highReceipt.id]);
  for (const environment of ['desktop', 'browser'] as const) {
    const calls: unknown[] = [];
    async function read(method: string, payload: unknown) {
      calls.push({ method, payload });
      if (method === 'reports.brief') return snapshot;
      assert.equal(method, 'receipts.get');
      return [reportReceipt, highReceipt, lowReceipt].find(receipt => receipt.id === (payload as { id: string }).id);
    }
    const reader = environment === 'desktop' ? createDesktopTodayReader({ request: read })
      : createBrowserTodayReader({ call: message => read(message.method, message.payload) });
    const result = await reader.brief(briefInput());
    assert.equal(result.ok, true, `${environment} rejected producer-sorted alert receipt IDs`);
    if (!result.ok) assert.fail('Sorted alert receipt IDs were tied to alert item order');
    assert.deepEqual(calls, [{ method: 'reports.brief', payload: briefInput().request }, ...snapshot.receiptIds.map(id => ({ method: 'receipts.get', payload: { id } }))]);
    assert.deepEqual(result.value.receipts.map(receipt => receipt.id), [reportReceipt.id]);
    assert.equal(stat(result.value, 'margin', 'contribution').evidence.receiptId, reportReceipt.id);
    assert.equal(result.value.statsEvidence.length, 1);
    assert.equal(projectTodayHostForUi(result.value, uiConfig).data.earlierTodayMissing, 'unknown');
    assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  }
});

test('current reports.brief accepts bounded observation IDs with spaces and Unicode without releasing private alert metadata', async () => {
  const reportReceipt = marginReceipt(), alertReceipt = sumReceipt('billed');
  const observationIds = ['daily check 1', 'सुबह जाँच २'];
  for (const observationId of observationIds) for (const environment of ['desktop', 'browser'] as const) {
    const snapshot = currentBrief([reportReceipt], [alertReceipt]);
    const item = snapshot.alerts.items[0]!;
    item.observation.id = observationId;
    item.episodes[0]!.observationIds = [...observationIds];
    const calls: unknown[] = [];
    async function read(method: string, payload: unknown) {
      calls.push({ method, payload });
      if (method === 'reports.brief') return snapshot;
      assert.equal(method, 'receipts.get');
      return [reportReceipt, alertReceipt].find(receipt => receipt.id === (payload as { id: string }).id);
    }
    const reader = environment === 'desktop' ? createDesktopTodayReader({ request: read })
      : createBrowserTodayReader({ call: message => read(message.method, message.payload) });
    const result = await reader.brief(briefInput());
    assert.equal(result.ok, true, `${environment} rejected a producer-valid observation ID`);
    if (!result.ok) assert.fail('Legal observation text was treated as a route identifier');
    assert.deepEqual(calls, [{ method: 'reports.brief', payload: briefInput().request }, ...snapshot.receiptIds.map(id => ({ method: 'receipts.get', payload: { id } }))]);
    assert.deepEqual(result.value.receipts.map(receipt => receipt.id), [reportReceipt.id]);
    assert.deepEqual(result.value.today.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
    assert.deepEqual(result.value.today.attention, []);
    const ui = projectTodayHostForUi(result.value, uiConfig);
    for (const privateText of [PRIVATE, ...observationIds]) {
      assert.equal(JSON.stringify(result).includes(privateText), false);
      assert.equal(JSON.stringify(ui).includes(privateText), false);
    }
  }
});

test('current reports.brief alert-only receipt authority loss refuses all values after a prior successful read', async () => {
  const reportReceipt = marginReceipt(), alertReceipt = sumReceipt('billed');
  const snapshot = currentBrief([reportReceipt], [reportReceipt, alertReceipt]);
  for (const environment of ['desktop', 'browser'] as const) for (const [engineCode, expected] of [['SOURCE_REVOKED', 'ACCESS_DENIED'], ['VAULT_LOCKED', 'VAULT_LOCKED'], ['RECEIPT_NOT_FOUND', 'EVIDENCE_UNAVAILABLE']] as const) {
    let revoked = false;
    const calls: unknown[] = [];
    async function read(method: string, payload: unknown) {
      calls.push({ method, payload });
      if (method === 'reports.brief') return snapshot;
      assert.equal(method, 'receipts.get');
      const id = (payload as { id: string }).id;
      if (id === alertReceipt.id && revoked) throw denial(engineCode);
      return [reportReceipt, alertReceipt].find(receipt => receipt.id === id);
    }
    const reader = environment === 'desktop' ? createDesktopTodayReader({ request: read })
      : createBrowserTodayReader({ call: message => read(message.method, message.payload) });
    assert.equal((await reader.brief(briefInput())).ok, true, `${environment} could not establish the current brief before authority loss`);
    calls.length = 0; revoked = true;
    const result = await reader.brief(briefInput());
    assert.deepEqual(result, { ok: false, code: expected });
    assert.deepEqual(calls, [{ method: 'reports.brief', payload: briefInput().request }, ...snapshot.receiptIds.map(id => ({ method: 'receipts.get', payload: { id } }))]);
    assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  }
});

test('unsafe or unsupported request filters fail before any transport call', async () => {
  let calls = 0;
  const reader = createDesktopTodayReader({ async request() { calls++; return dashboard(); } });
  const unsafeDashboardRequests = [{ branch: 'west' }, { asOf: sourceTime }, { sourceIds: [] }, { period: { from: '2026-02-31', to: '2026-09-30' } }, { period: { from: '2026-09-30', to: '2026-09-01' } }];
  for (const request of unsafeDashboardRequests) assert.deepEqual(await reader.dashboard({ ...dashboardInput(), request } as unknown as DashboardTodayInput), { ok: false, code: 'INVALID_REPLY' });
  const unsafeBriefRequests = [{ sourceIds: ['source_fixture', 'source_fixture'] }, { sourceIds: ['../private'] }, { sourceIds: Array.from({ length: 65 }, (_, index) => `source_${index}`) }, { sourceIds: [''] }, { branch: '' }, { onDate: '2026-02-31' }, { ritual: 'daily' }, { asOf: '2026-10-01T25:00:00Z' }, { kinds: ['sale'] }];
  for (const request of unsafeBriefRequests) assert.deepEqual(await reader.brief({ ...briefInput(), request } as unknown as BriefTodayInput), { ok: false, code: 'INVALID_REPLY' });
  assert.deepEqual(await reader.dashboard({ ...dashboardInput(), selections: [...dashboardInput().selections, { operation: 'received', figureKey: 'total' }] }), { ok: false, code: 'INVALID_REPLY' });
  assert.equal(calls, 0);
});

test('read requests detach caller-owned scope and stat selections before awaiting the source', async () => {
  const receipts = dashboardReceipts();
  const response = deferred<unknown>();
  let transported: unknown;
  const reader = createDesktopTodayReader({ async request(method, payload) {
    if (method === 'dashboard.get') { transported = payload; return response.promise; }
    if (method === 'reports.brief') return brief();
    return receipts.find(receipt => receipt.id === (payload as { id: string }).id);
  } });
  const mutable = { title: 'Today fixture', date: '2026-10-01', request: { period: { ...period } }, selections: [{ operation: 'earned', figureKey: 'total' }] };
  const pending = reader.dashboard(mutable);
  mutable.request.period.from = '2026-08-01';
  mutable.selections[0]!.figureKey = 'forged_after_request';
  response.resolve(dashboard(receipts));
  const result = await pending;
  assert.equal(result.ok, true); if (!result.ok) assert.fail('Caller mutation changed the authorized request');
  assert.deepEqual(transported, { period });
  assert.equal(stat(result.value, 'earned', 'total').evidence.receiptId, 'receipt_earned');
});

test('fresh receipt denials and identity mismatches return no cached or partially projected values', async () => {
  const receipts = dashboardReceipts();
  const mismatch = createDesktopTodayReader({ async request(method, payload) { if (method === 'dashboard.get') return dashboard(receipts); if (method === 'reports.brief') return brief(); return { ...receipts.find(receipt => receipt.id === (payload as { id: string }).id)!, id: 'wrong_receipt' }; } });
  assert.deepEqual(await mismatch.dashboard(dashboardInput()), { ok: false, code: 'INVALID_REPLY' });
  const revoked = createBrowserTodayReader({ async call(message) { if (message.method === 'dashboard.get') return dashboard(receipts); if (message.method === 'reports.brief') return brief(); throw denial(); } });
  const result = await revoked.dashboard(dashboardInput());
  assert.deepEqual(result, { ok: false, code: 'ACCESS_DENIED' });
  assert.equal(JSON.stringify(result).includes(PRIVATE), false);
});

test('late unselected receipt denial suppresses the entire projection and returns only a sanitized failure code', async () => {
  const receipts = dashboardReceipts();
  for (const [engineCode, expected] of [['SOURCE_REVOKED', 'ACCESS_DENIED'], ['VAULT_LOCKED', 'VAULT_LOCKED'], ['UNAUTHENTICATED', 'UNAUTHENTICATED'], ['RECEIPT_NOT_FOUND', 'EVIDENCE_UNAVAILABLE'], ['unexpected_private_error', 'REQUEST_FAILED']] as const) {
    let receiptReads = 0;
    const reader = createDesktopTodayReader({ async request(method, payload) {
      if (method === 'dashboard.get') return dashboard(receipts);
      if (method === 'reports.brief') return brief();
      receiptReads++;
      if (receiptReads === 4) throw denial(engineCode);
      return receipts.find(receipt => receipt.id === (payload as { id: string }).id);
    } });
    const result = await reader.dashboard({ ...dashboardInput(), selections: [{ operation: 'earned', figureKey: 'total' }] });
    assert.deepEqual(result, { ok: false, code: expected });
    assert.equal(receiptReads, 4);
    assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  }
});

test('invalidation rejects late dashboard completion and late receipt rereads without leaking source state', async () => {
  const receipts = dashboardReceipts();
  const response = deferred<unknown>();
  let receiptReads = 0;
  const reader = createDesktopTodayReader({ async request(method) { if (method === 'dashboard.get') return response.promise; receiptReads++; return receipts[0]; } });
  const pending = reader.dashboard(dashboardInput());
  reader.invalidate(); response.resolve(dashboard(receipts));
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(receiptReads, 0);
  const receiptResponse = deferred<unknown>();
  const rereadStarted = deferred<void>();
  const browser = createBrowserTodayReader({ async call(message) { if (message.method === 'dashboard.get') return dashboard(receipts); if (message.method === 'reports.brief') return brief(); rereadStarted.resolve(); return receiptResponse.promise; } });
  const late = browser.dashboard(dashboardInput());
  await rereadStarted.promise; browser.invalidate(); receiptResponse.resolve(receipts[0]);
  assert.deepEqual(await late, { ok: false, code: 'READ_INVALIDATED' });
});

test('authority loss on one concurrent read invalidates an earlier in-flight source reply', async () => {
  const receipts = dashboardReceipts();
  const earlier = deferred<unknown>();
  let requests = 0;
  const reader = createDesktopTodayReader({ async request(method, payload) {
    if (method === 'dashboard.get') { requests++; if (requests === 1) return earlier.promise; throw denial(); }
    if (method === 'reports.brief') return brief();
    return receipts.find(receipt => receipt.id === (payload as { id: string }).id);
  } });
  const old = reader.dashboard(dashboardInput());
  assert.deepEqual(await reader.dashboard(dashboardInput()), { ok: false, code: 'ACCESS_DENIED' });
  earlier.resolve(dashboard(receipts));
  assert.deepEqual(await old, { ok: false, code: 'READ_INVALIDATED' });
});

test('host UI projection keeps uncaptured activity explicit without changing authoritative ready-empty Today', () => {
  const receipts = dashboardReceipts();
  const host = projectDashboardToday(dashboard(receipts), fresh(receipts), dashboardInput());
  const ui = projectTodayHostForUi(host, uiConfig);
  assert.deepEqual(ui.data.earlierToday, []); assert.equal(ui.data.earlierTodayMissing, 'unknown');
  assert.deepEqual(ui.data.review.count, { exact: null, display: 'Not known' });
  assert.equal(ui.unavailable.dayEvents, 'TODAY_DAY_EVENTS_CONTRACT_NOT_PROVIDED');
  assert.deepEqual(ui.statsEvidence, host.statsEvidence); assert.equal(ui.source, 'dashboard');
  assert.deepEqual(ui.data.thisMonth[0]?.chartState, { state: 'missing', reasonCode: 'CHART_NOT_PROVIDED' });
  assert.equal(JSON.stringify(ui).includes(PRIVATE), false); assert.equal(Object.isFrozen(ui.data), true);
  const authoritative = projectTodayForUi({ ...host.today, stats: [], state: { kind: 'ready' } }, uiConfig);
  assert.deepEqual(authoritative.data.earlierToday, []); assert.equal(Object.hasOwn(authoritative.data, 'earlierTodayMissing'), false);
});

test('host UI projection rechecks source bindings and refuses fabricated events, values or draft delivery', () => {
  const receipts = dashboardReceipts(), host = projectDashboardToday(dashboard(receipts), fresh(receipts), dashboardInput());
  assert.throws(() => projectTodayHostForUi({ ...host, today: { ...host.today, dayEvents: [{ id: 'invented_today', at: sourceTime, mark: 'cha', label: PRIVATE }] } }, uiConfig), ReplyValidationError);
  const first = host.today.stats[0]!;
  assert.throws(() => projectTodayHostForUi({ ...host, today: { ...host.today, stats: [{ ...first, figure: { kind: 'money', currency: 'INR', paise: '999999', receiptId: first.figure.kind === 'missing' ? 'no_receipt' : first.figure.receiptId, labels: [] } }, ...host.today.stats.slice(1)] } }, uiConfig), ReplyValidationError);
  assert.throws(() => projectTodayHostForUi({ ...host, statsEvidence: [{ ...host.statsEvidence[0]!, engineFigure: { ...host.statsEvidence[0]!.engineFigure, display: PRIVATE } }, ...host.statsEvidence.slice(1)] }, uiConfig), ReplyValidationError);
  const briefReceipts = [marginReceipt()], briefHost = projectBriefToday(brief(briefReceipts), fresh(briefReceipts), briefInput());
  const briefUi = projectTodayHostForUi(briefHost, uiConfig);
  assert.equal(briefUi.brief?.delivery.state, 'draft'); assert.equal(briefUi.data.earlierTodayMissing, 'unknown');
  assert.equal(Object.hasOwn(briefUi.brief!.report, 'html'), false);
  assert.throws(() => projectTodayHostForUi({ ...briefHost, brief: { ...briefHost.brief!, report: { ...briefHost.brief!.report, gaps: [PRIVATE] } } }, uiConfig), ReplyValidationError);
});

test('brief filters preserve backend source identifiers and branch labels without route-slug coercion', () => {
  const receipt = { ...marginReceipt(), sourceIds: ['_source'], requestedSourceIds: ['_source'], branch: 'North office', rows: marginReceipt().rows.map(row => ({ ...row, sourceId: '_source', branch: 'North office' })) };
  const projection = projectBriefToday(brief([receipt]), fresh([receipt]), { ...briefInput(), request: { ...briefInput().request, sourceIds: ['_source'], branch: 'North office', customerId: 'Customer with spaces', orderId: 'Order 01' } });
  assert.deepEqual(projection.statsEvidence[0]!.scope.requestedSourceIds, ['_source']);
  assert.equal(projection.statsEvidence[0]!.scope.branch, 'North office');
  assert.equal(Object.hasOwn(projection.statsEvidence[0]!.scope, 'customerId'), false);
  assert.equal(Object.hasOwn(projection.statsEvidence[0]!.scope, 'orderId'), false);
});
