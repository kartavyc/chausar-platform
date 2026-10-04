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
import {
  detachToday, todayChart, todayDigest, todayFigure, validateEngineToday, validateTodayAttention,
  validateTodayEventReference, validateTodayInput, validateTodayPrepared, validateTodayQueue, validateTodayReview,
} from '../src/bridge/today-engine.ts';
import type { TodayConfiguration, EngineTodayResponse, TodayPrepareTilesRequest, TodayPreparedTiles, TodayReviewQueue, TodayReviewRow, TodayTileValue, TodayAttention, TodayDayEvent } from '../src/bridge/today-engine.ts';
import type { UiContext } from '../src/host/contracts.ts';

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

/** Explicit producer fixtures are not installed defaults or live workspace evidence. */
const producerDisplay = { date: '2026-10-04', timeZone: 'Asia/Kolkata' };
const producerContext: UiContext = {
  workspace: { id: 'workspace_fixture', name: 'Synthetic producer fixture', demo: true },
  member: { id: 'member_fixture', name: 'Synthetic reader', role: 'owner', epoch: 7, branches: ['North office'] },
  contextKey: 'a'.repeat(64),
};

function producerConfiguration(): TodayConfiguration {
  const buckets = [
    { id: 'first', label: 'Engine first bucket', period: { from: '2026-09-01', to: '2026-09-14' } },
    { id: 'second', label: 'Engine second bucket', period: { from: '2026-09-15', to: '2026-09-30' } },
  ];
  return {
    configurationId: 'configuration_fixture', configurationDigest: 'b'.repeat(64),
    starterPack: { id: 'Retail / दुकान', dictionaryHash: 'c'.repeat(64), version: 4 },
    request: {
      dictionaryHash: 'c'.repeat(64), asOf: sourceTime, scope: { sourceIds: ['source_fixture', '_second_source'], branch: 'North office' },
      tiles: [
        { id: 'earned', label: 'Engine earned label', operation: 'earned', figureKey: 'total', period: { ...period }, buckets: structuredClone(buckets), comparison: { operation: 'changeEarned', figureKey: 'change', period: { from: '2026-08-01', to: '2026-08-31' } } },
        { id: 'contribution', label: 'Engine contribution label', operation: 'margin', figureKey: 'contribution', period: { ...period }, buckets: structuredClone(buckets) },
        { id: 'margin', label: 'Engine margin label', operation: 'margin', figureKey: 'marginBps', period: { ...period }, buckets: structuredClone(buckets) },
      ],
    },
  };
}

function producerPrepareRequest(configuration = producerConfiguration()): TodayPrepareTilesRequest {
  return { ...producerDisplay, ...configuration };
}

function producerValue(operation: string, key: string, receiptId: string, unit: 'money' | 'basis-points' = 'money'): TodayTileValue {
  return {
    status: 'partial',
    figure: { key, label: 'Exact Engine figure label', minor: unit === 'money' ? HUGE_INTEGER : '1937', display: unit === 'money' ? 'Engine ₹90,071,992,547,409,931.27' : 'Engine 19.37%', unit, ...(unit === 'money' ? { currency: 'INR' } : {}) },
    receiptId,
    definition: { dictionaryHash: 'c'.repeat(64), ontologyVersion: 4, definitionHash: 'd'.repeat(64), definitions: [{ name: operation, label: 'Engine meaning label', meaning: 'Engine source meaning including unresolved rows.', kind: 'sale', field: 'amountMinor', currency: 'INR', nulls: 'reject', sign: 1 }], operationId: operation, operationType: operation === 'margin' ? 'margin' : operation === 'changeEarned' ? 'change' : 'sum' },
    coverage: { selectedRows: 3, countedRows: 1, excludedRows: 2, unresolvedConflicts: 1, importIds: ['import_fixture'], completeness: 'partial', gaps: ['Engine unresolved source coverage'] },
    gaps: [{ code: 'SOURCE_PARTIAL', message: 'Engine did not release all evidence.', definitionName: operation, period: { ...period } }],
  };
}

function producerPrepared(configuration = producerConfiguration()): TodayPreparedTiles {
  return {
    reference: { id: 'capture_fixture', digest: 'e'.repeat(64) }, display: { ...producerDisplay },
    configuration: { id: configuration.configurationId, digest: configuration.configurationDigest, starterPack: { ...configuration.starterPack }, origin: 'custom' },
    result: {
      version: 1, asOf: configuration.request.asOf, dictionary: { hash: configuration.starterPack.dictionaryHash, version: configuration.starterPack.version },
      scope: structuredClone(configuration.request.scope), atomic: false, verification: 'not-configured',
      tiles: configuration.request.tiles.map(tile => ({
        id: tile.id, label: tile.label, operation: tile.operation, figureKey: tile.figureKey, period: { ...tile.period },
        value: producerValue(tile.operation, tile.figureKey, `receipt_${tile.id}`, tile.figureKey === 'marginBps' ? 'basis-points' : 'money'),
        points: tile.buckets.map((bucket, index) => ({ ...structuredClone(bucket), value: index === 0
          ? producerValue(tile.operation, tile.figureKey, `receipt_${tile.id}_${bucket.id}`, tile.figureKey === 'marginBps' ? 'basis-points' : 'money')
          : { status: 'unavailable', figure: null, receiptId: null, definition: null, coverage: null, gaps: [{ code: 'BUCKET_UNAVAILABLE', message: 'Engine bucket evidence is unavailable.' }] } })),
        ...(tile.comparison ? { comparison: { ...structuredClone(tile.comparison), value: { ...producerValue(tile.comparison.operation, tile.comparison.figureKey, `receipt_${tile.id}_comparison`), figure: { key: tile.comparison.figureKey, label: 'Engine comparison', minor: '-1703', display: 'Engine decrease ₹17.03', unit: 'money', currency: 'INR' } } } } : {}),
      })),
    },
  };
}

function producerReviewRows(): TodayReviewRow[] {
  const action: TodayReviewRow = {
    kind: 'action-approval', title: 'Engine action review', since: sourceTime,
    reference: { kind: 'action-approval', id: 'action_fixture', revision: 3, digest: '1'.repeat(64) },
    request: { method: 'actions.approve', payload: { id: 'action_fixture', digest: '1'.repeat(64) } }, canApprove: false,
    provenance: [{ producer: 'actions', id: 'action_fixture', revision: 3, digest: '1'.repeat(64) }],
  };
  const job: TodayReviewRow = {
    kind: 'job-approval', title: 'Engine job mandate review', since: sourceTime,
    reference: { kind: 'job-approval', id: 'job_fixture', revision: 4, digest: '2'.repeat(64) },
    request: { method: 'jobs.approve', payload: { id: 'job_fixture', digest: '2'.repeat(64) } }, canApprove: true,
    provenance: [{ producer: 'jobs', id: 'job_fixture', revision: 4, digest: '2'.repeat(64) }],
  };
  const acceptanceReference = { kind: 'job-acceptance' as const, id: 'job_delivered', revision: 5, digest: '3'.repeat(64), deliverableDigest: '4'.repeat(64) };
  const acceptance: TodayReviewRow = {
    kind: 'job-acceptance', title: 'Engine deliverable review', since: sourceTime, reference: acceptanceReference,
    request: { method: 'jobs.accept', payload: { id: 'job_delivered', reference: { ...acceptanceReference } } }, canApprove: true,
    provenance: [{ producer: 'job-action-preview', id: 'job_delivered', revision: 5, digest: '3'.repeat(64), stepId: 'step_fixture', operationKey: 'send:message', actionId: 'action_preview', actionDigest: '5'.repeat(64), deliverableDigest: '4'.repeat(64) }],
  };
  const lesson: TodayReviewRow = {
    kind: 'lesson-decision', title: 'Engine lesson human decision', since: sourceTime,
    reference: { kind: 'lesson-decision', id: 'lesson_fixture', revision: 6, digest: '6'.repeat(64), reviewId: 'review_fixture', reviewDigest: '7'.repeat(64), evaluationDigest: '8'.repeat(64) },
    request: { method: 'memory.decideLesson', payload: { candidate: { id: 'lesson_fixture', revision: 6, digest: '6'.repeat(64) }, reviewId: 'review_fixture', reviewDigest: '7'.repeat(64) }, requiredHumanFields: ['decision', 'reason'] }, canApprove: true,
    provenance: [{ producer: 'lessons', id: 'lesson_fixture', revision: 6, digest: '6'.repeat(64) }],
  };
  return [action, job, acceptance, lesson];
}

function producerQueue(rows = producerReviewRows()): TodayReviewQueue {
  return { scope: 'prepared-actions-job-mandates-deliverables-lessons-v1', completeness: 'complete', count: rows.length + 2, knownCount: rows.length + 2, rows, nextCursor: 'eyJvcGFxdWUiOiJmaXh0dXJlLXNlYWwifQ', producers: { actions: { status: 'complete' }, jobs: { status: 'complete' }, lessons: { status: 'complete' } } };
}

function producerEngine(): EngineTodayResponse {
  return {
    kind: 'today-engine-v1', display: { ...producerDisplay }, atomic: false, noAction: true, starterPack: { ...producerConfiguration().starterPack },
    defaults: { state: 'unconfigured', reason: 'pack-defaults-not-configured' }, state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' }, productReviewCount: null,
    tiles: { state: 'unavailable', reason: 'capture-required' }, attention: { state: 'unavailable', reason: 'attention-guards-required' },
    review: { state: 'available', value: producerQueue() }, dayEvents: { state: 'unavailable', reason: 'events-service-unavailable' },
  };
}

function producerAttention(): TodayAttention {
  return {
    kind: 'today-attention-v1', request: { displayedDate: producerDisplay.date, timeZone: producerDisplay.timeZone, branch: 'North office' },
    authority: { workspaceId: producerContext.workspace.id, memberId: producerContext.member.id, epoch: producerContext.member.epoch, stateRevision: 19 },
    alertEpisodes: [{ reference: { kind: 'alert-episode', alertId: 'alert_fixture', episodeId: 'episode_fixture' }, conditionId: 'condition_fixture', label: 'Engine retained cleared episode', revision: 2, definitionDigest: '9'.repeat(64), branch: 'North office', sourceIds: ['source_fixture'], receiptIds: ['receipt_alert'], episode: { id: 'episode_fixture', status: 'cleared', severity: 'warning', openedAt: sourceTime, clearedAt: sourceTime, reopenCount: 0, uncertain: true, observationIds: ['observation_fixture'] }, lastObservation: { id: 'observation_fixture', anchorId: 'anchor_fixture', observedAt: sourceTime, recordedAt: sourceTime, state: 'unknown', issues: ['Engine retained uncertainty'], receiptId: null }, amendments: [], notices: [], evidence: { state: 'uncertain', issues: ['Engine retained uncertainty'] } }],
    dueDecisions: [{ reference: { kind: 'decision', decisionId: 'decision_fixture' }, text: 'Engine retained due decision', reviewDate: producerDisplay.date, due: 'today', status: 'open', branch: 'North office', revision: null, receiptIds: ['receipt_decision'] }],
    calendar: {
      window: { from: producerDisplay.date, through: '2026-10-10', days: 7, timeZone: producerDisplay.timeZone }, state: 'reviewed',
      reference: { kind: 'reviewed-compliance-calendar', calendarId: 'Calendar / कर', version: 'Reviewed version / १' }, sourceIds: ['Reviewed source / १'], reviewedAt: sourceTime, reviewedBy: 'Engine reviewer', lastCheckedAt: sourceTime,
      applicability: { state: 'unknown', basis: 'Engine reviewed applicability is unresolved.' }, coverage: { from: '2026-10-01', through: '2026-10-31', timeZone: producerDisplay.timeZone },
      rows: [{ entryId: 'Entry / कर १', title: 'Engine reviewed entry', dueDate: '2026-10-06', sourceUrl: 'https://example.com/fixture', publishedAt: sourceTime, lastCheckedAt: sourceTime, reviewedAt: sourceTime, reviewedBy: 'Engine reviewer', applicability: { state: 'unknown', basis: 'Engine reviewed applicability is unresolved.' }, reference: { kind: 'compliance-entry', calendarId: 'Calendar / कर', entryId: 'Entry / कर १' } }],
    },
    counts: { alertEpisodes: 1, dueDecisions: 1, calendarEntries: 1 }, alertsCheckedAt: sourceTime, evaluated: false, pin: 'f'.repeat(64),
  };
}

function producerEvents(): TodayDayEvent[] {
  const base = { at: '2026-10-04T07:00:00.000Z', actor: { kind: 'member' as const, memberId: 'member_fixture' } };
  const events: TodayDayEvent[] = [
    { ...base, id: 'event_import', kind: 'source.imported', args: { sourceId: 'source_fixture', format: 'xlsx', rowCount: 0, qualification: 'experimental' }, reference: { kind: 'import', importId: 'import_fixture', sourceId: 'source_fixture' } },
    { ...base, id: 'event_refusal', kind: 'source.import-refused', args: { sourceId: 'source_fixture', reasonCode: 'unsupported_shape', qualification: 'experimental' }, reference: { kind: 'import-refusal', learningEventId: 'learning_fixture' } },
    { ...base, id: 'event_calculation', kind: 'calculation.completed', args: { operation: 'earned', stale: true }, reference: { kind: 'receipt', receiptId: 'receipt_fixture' } },
    { ...base, id: 'event_created', kind: 'decision.created', args: {}, reference: { kind: 'decision', decisionId: 'decision_fixture' } },
    { ...base, id: 'event_revised', kind: 'decision.revised', args: { revision: 2 }, reference: { kind: 'decision', decisionId: 'decision_fixture' } },
    { ...base, id: 'event_reviewed', kind: 'decision.reviewed', args: { outcome: 'continue', revision: 2 }, reference: { kind: 'decision', decisionId: 'decision_fixture' } },
    { ...base, id: 'event_delivered', kind: 'job.delivered', args: { spentMinor: '1703' }, reference: { kind: 'job-delivery', jobId: 'job_delivered' } },
  ];
  for (const kind of ['action.prepared', 'action.revised', 'action.approved', 'action.attempt', 'action.settled', 'action.reconciled', 'action.cancelled', 'action.interrupted'] as const) {
    events.push({ ...base, id: `event_${kind}`, kind, args: { connector: 'connector_fixture', operation: 'operation_fixture', outcome: 'unknown', businessSuccess: null }, reference: { kind: 'action', actionId: 'action_fixture' } });
  }
  return events;
}

test('Today producer input is optional and accepted explicit configuration is detached and deeply immutable', () => {
  assert.deepEqual(validateTodayInput({}), {});
  const raw = { display: { ...producerDisplay }, configuration: producerConfiguration(), charts: [{ tileId: 'earned', form: 'columns', sentence: 'Explicit fixture chart sentence' }] };
  const accepted = validateTodayInput(raw);
  assert.deepEqual(accepted, raw); assert.notEqual(accepted, raw); assert.notEqual(accepted.configuration?.request, raw.configuration.request);
  raw.display.date = '2027-01-01'; raw.configuration.request.tiles[0]!.label = PRIVATE; raw.charts[0]!.sentence = PRIVATE;
  assert.equal(accepted.display?.date, '2026-10-04'); assert.equal(accepted.configuration?.request.tiles[0]?.label, 'Engine earned label');
  assert.equal(accepted.charts?.[0]?.sentence, 'Explicit fixture chart sentence');
  assert.ok(Object.isFrozen(accepted)); assert.ok(Object.isFrozen(accepted.configuration?.request.tiles[0]?.buckets[0]?.period));
  assert.throws(() => { accepted.configuration!.request.scope.sourceIds.push('source_injected'); }, TypeError);
});

test('Today producer input refuses inferred displays, incomplete bindings and invalid later buckets', () => {
  const config = producerConfiguration(), first = config.request.tiles[0]!;
  const invalidInputs: unknown[] = [
    { date: producerDisplay.date }, { display: { date: producerDisplay.date } }, { display: { ...producerDisplay, date: '2026-02-31' } }, { display: { ...producerDisplay, timeZone: 'Invalid/Fixture' } },
    { display: { ...producerDisplay, inferred: true } }, { configuration: { ...config, starterPack: { ...config.starterPack, version: 0 } } },
    { configuration: { ...config, request: { ...config.request, dictionaryHash: 'f'.repeat(64) } } },
    { configuration: { ...config, request: { ...config.request, tiles: config.request.tiles.slice(0, 2) } } },
    { configuration: { ...config, request: { ...config.request, sourceIds: ['source_fixture'] } } },
    { configuration: { ...config, request: { ...config.request, asOf: '2026-10-01T09:00:00Z' } } },
    { configuration: { ...config, request: { ...config.request, scope: { ...config.request.scope, sourceIds: ['source_fixture', 'source_fixture'] } } } },
    { configuration: { ...config, request: { ...config.request, tiles: [first, first, config.request.tiles[2]!] } } },
    { configuration: { ...config, request: { ...config.request, tiles: [{ ...first, buckets: [first.buckets[0]!, { ...first.buckets[1]!, period: { from: '2026-09-14', to: '2026-10-01' } }] }, ...config.request.tiles.slice(1)] } } },
    { configuration: { ...config, request: { ...config.request, tiles: [{ ...first, buckets: Array.from({ length: 121 }, () => first.buckets[0]!) }, ...config.request.tiles.slice(1)] } } },
  ];
  for (const input of invalidInputs) assert.throws(() => validateTodayInput(input), ReplyValidationError);
});

test('Today unknown boundary rejects getters without invocation, symbols, hostile prototypes, cycles and sparse arrays', () => {
  let getterReads = 0;
  const getter = { display: { ...producerDisplay } };
  Object.defineProperty(getter.display, 'date', { enumerable: true, get() { getterReads++; return producerDisplay.date; } });
  const symbol = { display: { ...producerDisplay } }; Object.defineProperty(symbol.display, Symbol('hidden'), { value: PRIVATE });
  const hidden = { display: { ...producerDisplay } }; Object.defineProperty(hidden.display, 'hidden', { value: PRIVATE });
  const inherited = { display: Object.setPrototypeOf({ ...producerDisplay }, { authority: true }) };
  const cyclic: Record<string, unknown> = { display: { ...producerDisplay } }; cyclic.self = cyclic;
  const sparse = producerConfiguration(); delete sparse.request.tiles[1];
  const accessorArray = producerConfiguration(); Object.defineProperty(accessorArray.request.tiles, '2', { enumerable: true, get() { getterReads++; return producerConfiguration().request.tiles[2]; } });
  const extraArray = producerConfiguration(); Object.defineProperty(extraArray.request.tiles, 'private', { enumerable: true, value: PRIVATE });
  for (const input of [getter, symbol, hidden, inherited, cyclic, { configuration: sparse }, { configuration: accessorArray }, { configuration: extraArray }]) assert.throws(() => validateTodayInput(input), ReplyValidationError);
  assert.equal(getterReads, 0);
  const aliased = { first: producerDisplay, second: producerDisplay };
  const detached = detachToday(aliased); assert.deepEqual(detached, aliased);
  assert.throws(() => detachToday({ value: Number.NaN }), ReplyValidationError);
  assert.throws(() => detachToday({ value: 'x'.repeat(50001) }), ReplyValidationError);
});

test('Today request digest preserves JSON property insertion order while optional canonical digest binds the same content', async () => {
  const original = { b: 2, a: 1 }, reordered = { a: 1, b: 2 };
  assert.notEqual(await todayDigest(original), await todayDigest(reordered));
  assert.equal(await todayDigest(original, true), await todayDigest(reordered, true));
  assert.equal(await todayDigest({}), '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  assert.deepEqual(Object.keys(original), ['b', 'a']);
  const configuration = producerConfiguration();
  const request = configuration.request;
  const reorderedRequest = { tiles: request.tiles, scope: request.scope, asOf: request.asOf, dictionaryHash: request.dictionaryHash };
  assert.notEqual(await todayDigest(request), await todayDigest(reorderedRequest));
});

test('Today prepared values retain every primary, bucket and comparison proof without arithmetic or zero substitution', () => {
  const raw = producerPrepared(), accepted = validateTodayPrepared(raw, producerPrepareRequest());
  assert.deepEqual(accepted, raw); assert.notEqual(accepted.result.tiles[0], raw.result.tiles[0]);
  const earned = accepted.result.tiles[0]!, margin = accepted.result.tiles[2]!;
  assert.equal(earned.value.figure?.minor, HUGE_INTEGER); assert.equal(earned.value.figure?.display, 'Engine ₹90,071,992,547,409,931.27');
  assert.equal(earned.value.figure?.currency, 'INR'); assert.equal(earned.value.receiptId, 'receipt_earned');
  assert.equal(earned.points[0]?.value.receiptId, 'receipt_earned_first');
  assert.equal(earned.points[1]?.value.figure, null); assert.equal(earned.points[1]?.value.receiptId, null);
  assert.deepEqual(earned.points[1]?.value.gaps, [{ code: 'BUCKET_UNAVAILABLE', message: 'Engine bucket evidence is unavailable.' }]);
  assert.equal(earned.comparison?.value.figure?.minor, '-1703'); assert.equal(earned.comparison?.value.figure?.display, 'Engine decrease ₹17.03');
  assert.equal(earned.comparison?.value.receiptId, 'receipt_earned_comparison'); assert.equal(margin.value.figure?.unit, 'basis-points');
  assert.equal(margin.value.figure?.display, 'Engine 19.37%'); assert.equal(Object.hasOwn(margin.value.figure!, 'currency'), false);
  assert.deepEqual(earned.value.coverage, raw.result.tiles[0]?.value.coverage); assert.deepEqual(earned.value.definition, raw.result.tiles[0]?.value.definition);
  raw.result.tiles[0]!.value.gaps[0]!.message = PRIVATE; raw.result.scope.sourceIds.push('source_injected');
  assert.equal(accepted.result.tiles[0]?.value.gaps[0]?.message, 'Engine did not release all evidence.'); assert.equal(accepted.result.scope.sourceIds.length, 2);
  assert.ok(Object.isFrozen(earned.comparison?.value.definition?.definitions[0])); assert.ok(Object.isFrozen(earned.value.coverage?.gaps));
});

test('Today prepared boundary rejects substitutions in all display, request, pack, primary, bucket and comparison bindings', () => {
  const mutate: ((value: TodayPreparedTiles) => unknown)[] = [
    value => ({ ...value, display: { ...value.display, date: '2026-10-05' } }),
    value => ({ ...value, configuration: { ...value.configuration, id: 'other_configuration' } }),
    value => ({ ...value, configuration: { ...value.configuration, digest: 'f'.repeat(64) } }),
    value => ({ ...value, configuration: { ...value.configuration, starterPack: { ...value.configuration.starterPack, id: 'other_pack' } } }),
    value => ({ ...value, result: { ...value.result, asOf: '2026-10-02T09:00:00.000Z' } }),
    value => ({ ...value, result: { ...value.result, dictionary: { ...value.result.dictionary, version: 5 } } }),
    value => ({ ...value, result: { ...value.result, scope: { ...value.result.scope, branch: 'Other branch' } } }),
    value => ({ ...value, result: { ...value.result, scope: { ...value.result.scope, sourceIds: ['source_fixture'] } } }),
    value => ({ ...value, result: { ...value.result, tiles: value.result.tiles.slice(0, 2) } }),
    value => { value.result.tiles[2]!.value.figure!.key = 'foreign_figure'; return value; },
    value => { value.result.tiles[0]!.value.receiptId = null; return value; },
    value => { value.result.tiles[0]!.value.definition!.dictionaryHash = 'f'.repeat(64); return value; },
    value => { value.result.tiles[0]!.points[1]!.id = 'foreign_bucket'; return value; },
    value => { value.result.tiles[0]!.points[1]!.period.to = '2026-09-29'; return value; },
    value => { value.result.tiles[0]!.points[0]!.value.definition!.operationId = 'foreign_operation'; return value; },
    value => { value.result.tiles[0]!.comparison!.value.figure!.key = 'foreign_comparison'; return value; },
    value => { value.result.tiles[0]!.comparison!.value.definition!.ontologyVersion = 5; return value; },
    value => { delete value.result.tiles[0]!.comparison; return value; },
  ];
  for (const change of mutate) assert.throws(() => validateTodayPrepared(change(producerPrepared()), producerPrepareRequest()), ReplyValidationError);
});

test('Today figures and explicit chart forms preserve producer display and missing bucket proof state', () => {
  const prepared = validateTodayPrepared(producerPrepared(), producerPrepareRequest()), earned = prepared.result.tiles[0]!;
  assert.deepEqual(todayFigure(earned.value), { kind: 'money', exact: HUGE_INTEGER, display: 'Engine ₹90,071,992,547,409,931.27', receiptId: 'receipt_earned', labels: [] });
  assert.deepEqual(todayFigure(earned.points[1]!.value), { kind: 'missing', missing: 'unknown' });
  assert.equal(todayChart(earned), undefined); assert.equal(todayChart(earned, { tileId: 'foreign_tile', form: 'columns', sentence: 'Fixture' }), undefined);
  const columns = todayChart(earned, { tileId: earned.id, form: 'columns', sentence: 'Engine ordered columns' });
  assert.equal(columns?.form, 'columns'); assert.equal(columns?.values[0]?.value.kind, 'money'); assert.equal(columns?.values[1]?.value.kind, 'missing');
  assert.deepEqual(columns?.values.map(point => point.id), ['first', 'second']); assert.ok(Object.isFrozen(columns?.values[0]?.value));
  assert.equal(todayChart(earned, { tileId: earned.id, form: 'line', sentence: 'Engine line' }), undefined);
  const line = todayChart(earned, { tileId: earned.id, form: 'line', sentence: 'Engine line', from: 'Engine start', to: 'Engine end' });
  assert.equal(line?.form, 'line'); if (line?.form === 'line') { assert.equal(line.from, 'Engine start'); assert.equal(line.to, 'Engine end'); }
  assert.equal(todayChart(earned, { tileId: earned.id, form: 'ordered-bar', sentence: 'Engine bars' })?.form, 'ordered-bar');
});

test('Today queue preserves four complete references, human fields, provenance and opaque continuation', () => {
  const raw = producerQueue(), accepted = validateTodayQueue(raw, 4);
  assert.deepEqual(accepted, raw); assert.equal(accepted.scope, 'prepared-actions-job-mandates-deliverables-lessons-v1');
  assert.equal(accepted.count, 6); assert.equal(accepted.nextCursor, 'eyJvcGFxdWUiOiJmaXh0dXJlLXNlYWwifQ');
  for (const row of accepted.rows) assert.deepEqual(validateTodayReview(row, row.reference), row);
  const lesson = accepted.rows[3]!;
  assert.equal(lesson.reference.kind, 'lesson-decision'); if (lesson.reference.kind === 'lesson-decision') assert.equal(lesson.reference.evaluationDigest, '8'.repeat(64));
  assert.equal(lesson.request.method, 'memory.decideLesson'); if (lesson.request.method === 'memory.decideLesson') assert.deepEqual(lesson.request.requiredHumanFields, ['decision', 'reason']);
  raw.rows[0]!.title = PRIVATE; raw.producers.actions.status = 'unavailable';
  assert.equal(accepted.rows[0]?.title, 'Engine action review'); assert.equal(accepted.producers.actions.status, 'complete');
  assert.ok(Object.isFrozen(accepted.rows[2]?.provenance[0])); assert.ok(Object.isFrozen(accepted.rows[3]?.reference));
});

test('Today review resolution refuses changed revision, digest, deliverable, review and evaluation pins for every row kind', () => {
  for (const row of producerReviewRows()) {
    const reference = row.reference;
    assert.throws(() => validateTodayReview(row, { ...reference, revision: reference.revision + 1 }), ReplyValidationError);
    assert.throws(() => validateTodayReview(row, { ...reference, digest: 'f'.repeat(64) }), ReplyValidationError);
    assert.throws(() => validateTodayReview(row, { ...reference, id: 'other_entity' }), ReplyValidationError);
    if (reference.kind === 'job-acceptance') assert.throws(() => validateTodayReview(row, { ...reference, deliverableDigest: 'f'.repeat(64) }), ReplyValidationError);
    if (reference.kind === 'lesson-decision') {
      assert.throws(() => validateTodayReview(row, { ...reference, reviewId: 'other_review' }), ReplyValidationError);
      assert.throws(() => validateTodayReview(row, { ...reference, reviewDigest: 'f'.repeat(64) }), ReplyValidationError);
      assert.throws(() => validateTodayReview(row, { ...reference, evaluationDigest: 'f'.repeat(64) }), ReplyValidationError);
    }
  }
});

test('Today queue refuses malformed later rows, borrowed request pins, automatic human decisions and invented cursors', () => {
  const rows = producerReviewRows(), action = rows[0]!, acceptance = rows[2]!, lesson = rows[3]!;
  const badRows: unknown[] = [
    { ...action, request: { method: 'jobs.approve', payload: { id: action.reference.id, digest: action.reference.digest } } },
    { ...action, request: { method: 'actions.approve', payload: { id: 'other_action', digest: action.reference.digest } } },
    { ...acceptance, request: { method: 'jobs.accept', payload: { id: acceptance.reference.id, reference: { ...acceptance.reference, deliverableDigest: 'f'.repeat(64) } } } },
    { ...lesson, request: { method: 'memory.decideLesson', payload: { candidate: { id: lesson.reference.id, revision: lesson.reference.revision, digest: lesson.reference.digest }, reviewId: 'other_review', reviewDigest: '7'.repeat(64) }, requiredHumanFields: ['decision', 'reason'] } },
    { ...lesson, request: { ...lesson.request, requiredHumanFields: ['reason', 'decision'] } },
    { ...lesson, request: { ...lesson.request, payload: { ...lesson.request.payload, decision: 'accept', reason: 'Automatic fixture' } } },
  ];
  for (const invalidRow of badRows) assert.throws(() => validateTodayQueue({ ...producerQueue(), rows: [rows[0], invalidRow] }, 4), ReplyValidationError);
  for (const cursor of ['', 'not/base64url', 'x'.repeat(513), { offset: 4 }]) assert.throws(() => validateTodayQueue({ ...producerQueue(), nextCursor: cursor }, 4), ReplyValidationError);
  for (const limit of [0, 101, 1.5, Number.NaN]) assert.throws(() => validateTodayQueue(producerQueue(), limit), ReplyValidationError);
  assert.throws(() => validateTodayQueue(producerQueue(), 3), ReplyValidationError);
  assert.throws(() => validateTodayQueue({ ...producerQueue(), rows: [rows[0], rows[0]], knownCount: 2, count: 2 }, 4), ReplyValidationError);
});

test('Today scoped review count stays unknown for incomplete and unavailable producers and rejects false completeness', () => {
  const incomplete: TodayReviewQueue = { ...producerQueue(), completeness: 'incomplete', count: null, producers: { actions: { status: 'complete' }, jobs: { status: 'incomplete', reason: 'UNSUPPORTED_MUTATION_CONTRACT' }, lessons: { status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' } } };
  assert.deepEqual(validateTodayQueue(incomplete, 4), incomplete);
  const unavailable: TodayReviewQueue = { ...producerQueue([]), completeness: 'unavailable', count: null, knownCount: 0, nextCursor: null, producers: { actions: { status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' }, jobs: { status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' }, lessons: { status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' } } };
  assert.deepEqual(validateTodayQueue(unavailable, 4), unavailable);
  assert.throws(() => validateTodayQueue({ ...incomplete, count: incomplete.knownCount }, 4), ReplyValidationError);
  assert.throws(() => validateTodayQueue({ ...producerQueue(), count: 0 }, 4), ReplyValidationError);
  assert.throws(() => validateTodayQueue({ ...unavailable, completeness: 'complete', count: 0 }, 4), ReplyValidationError);
});

test('Today Engine preserves aggregate partial state and scoped count without inventing product obligations or tiles', () => {
  const raw = producerEngine(), accepted = validateEngineToday(raw, producerDisplay, producerContext);
  assert.equal(accepted.atomic, false); assert.equal(accepted.noAction, true); assert.equal(accepted.productReviewCount, null);
  assert.deepEqual(accepted.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
  assert.deepEqual(accepted.defaults, { state: 'unconfigured', reason: 'pack-defaults-not-configured' });
  assert.deepEqual(accepted.tiles, { state: 'unavailable', reason: 'capture-required' });
  assert.equal(accepted.review.state, 'available'); if (accepted.review.state === 'available') assert.equal(accepted.review.value.count, 6);
  raw.display.date = '2026-11-01'; assert.equal(accepted.display.date, producerDisplay.date); assert.ok(Object.isFrozen(accepted.state));
  for (const invalid of [{ ...producerEngine(), atomic: true }, { ...producerEngine(), noAction: false }, { ...producerEngine(), productReviewCount: 6 }, { ...producerEngine(), state: { kind: 'ready' } }, { ...producerEngine(), display: { ...producerDisplay, timeZone: 'UTC' } }]) assert.throws(() => validateEngineToday(invalid, producerDisplay, producerContext), ReplyValidationError);
});

test('Today Engine accepts prepared tiles only with the exact private capture, configuration and current pack', () => {
  const configuration = producerConfiguration(), prepared = producerPrepared(configuration);
  const raw: EngineTodayResponse = { ...producerEngine(), tiles: { state: 'prepared', value: prepared } };
  const request = { ...producerDisplay, tileCapture: { ...prepared.reference } };
  assert.deepEqual(validateEngineToday(raw, request, producerContext, configuration), raw);
  assert.throws(() => validateEngineToday(raw, producerDisplay, producerContext, configuration), ReplyValidationError);
  assert.throws(() => validateEngineToday(raw, request, producerContext), ReplyValidationError);
  assert.throws(() => validateEngineToday(raw, { ...request, tileCapture: { ...request.tileCapture, digest: 'f'.repeat(64) } }, producerContext, configuration), ReplyValidationError);
  assert.throws(() => validateEngineToday({ ...raw, starterPack: null }, request, producerContext, configuration), ReplyValidationError);
  assert.throws(() => validateEngineToday({ ...raw, starterPack: { ...configuration.starterPack, version: 5 } }, request, producerContext, configuration), ReplyValidationError);
});

test('Today attention selection retains exact producer rows, historical lifecycle and reviewed opaque references', () => {
  const attention = producerAttention(); assert.equal(attention.calendar.state, 'reviewed'); if (attention.calendar.state !== 'reviewed') return;
  const calendar = attention.calendar;
  const selection = { state: 'configured' as const, policyId: 'fixture explicit selection', policyRevision: 'review / १', eligibleCount: 3, rows: [
    { id: 'calendar selected', kind: 'compliance-entry' as const, value: attention.calendar.rows[0]! },
    { id: 'alert selected', kind: 'alert-episode' as const, value: attention.alertEpisodes[0]! },
    { id: 'decision selected', kind: 'due-decision' as const, value: attention.dueDecisions[0]! },
  ] };
  const raw: EngineTodayResponse = { ...producerEngine(), review: { state: 'available', value: { ...producerQueue([]), count: 0, knownCount: 0, nextCursor: null } }, attention: { state: 'available', value: attention, selection } };
  const accepted = validateEngineToday(raw, producerDisplay, producerContext);
  assert.equal(accepted.attention.state, 'available'); if (accepted.attention.state !== 'available') return;
  assert.deepEqual(accepted.attention.selection.rows.map(row => row.id), ['calendar selected', 'alert selected', 'decision selected']);
  assert.equal(accepted.attention.value.alertEpisodes[0]?.episode.status, 'cleared'); assert.equal(accepted.attention.value.alertEpisodes[0]?.evidence.state, 'uncertain');
  for (const row of selection.rows) assert.deepEqual(validateTodayAttention(row.value, row.value.reference), row.value);
  assert.deepEqual(validateTodayAttention(attention.calendar, attention.calendar.reference), attention.calendar);
  assert.ok(Object.isFrozen(accepted.attention.selection.rows[0]?.value));
  assert.throws(() => validateEngineToday({ ...raw, attention: { state: 'available', value: attention, selection: { ...selection, rows: [{ ...selection.rows[1]!, value: { ...attention.alertEpisodes[0]!, label: 'Substituted selected title' } }] } } }, producerDisplay, producerContext), ReplyValidationError);
  assert.throws(() => validateTodayAttention(attention.calendar.rows[0], { ...attention.calendar.rows[0]!.reference, calendarId: 'Foreign calendar' }), ReplyValidationError);
  assert.throws(() => validateTodayAttention(calendar, { ...calendar.reference, version: 'Foreign version' }), ReplyValidationError);
});

test('Today attention refuses authority changes, borrowed dates, false counts and an overfilled combined at-rest review area', () => {
  const attention = producerAttention();
  const selections = { state: 'configured' as const, policyId: 'explicit_policy', policyRevision: 'revision_fixture', eligibleCount: 2, rows: [
    { id: 'alert', kind: 'alert-episode' as const, value: attention.alertEpisodes[0]! }, { id: 'decision', kind: 'due-decision' as const, value: attention.dueDecisions[0]! },
  ] };
  const raw: EngineTodayResponse = { ...producerEngine(), attention: { state: 'available', value: attention, selection: { state: 'unavailable', reason: 'selection-policy-required', rows: [] } } };
  assert.deepEqual(validateEngineToday(raw, producerDisplay, producerContext), raw);
  const changes: unknown[] = [
    { ...attention, authority: { ...attention.authority, workspaceId: 'foreign_workspace' } }, { ...attention, authority: { ...attention.authority, memberId: 'foreign_member' } }, { ...attention, authority: { ...attention.authority, epoch: attention.authority.epoch + 1 } },
    { ...attention, request: { ...attention.request, displayedDate: '2026-10-05' } }, { ...attention, request: { ...attention.request, timeZone: 'UTC' } },
    { ...attention, counts: { ...attention.counts, alertEpisodes: 0 } }, { ...attention, evaluated: true },
  ];
  for (const value of changes) assert.throws(() => validateEngineToday({ ...raw, attention: { state: 'available', value, selection: { state: 'unavailable', reason: 'selection-policy-required', rows: [] } } }, producerDisplay, producerContext), ReplyValidationError);
  assert.throws(() => validateEngineToday({ ...raw, attention: { state: 'available', value: attention, selection: selections } }, producerDisplay, producerContext), ReplyValidationError);
});

test('Today typed events accept every producer kind and exact resolver reference without reordering or currency inference', () => {
  const events = producerEvents(); assert.equal(events.length, 15);
  for (const event of events) {
    const raw: EngineTodayResponse = { ...producerEngine(), dayEvents: { state: 'available', value: { ...producerDisplay, calendarRevision: 'calendar revision fixture', events: [event], total: 1, state: { kind: 'complete', reasonCodes: [] } } } };
    const accepted = validateEngineToday(raw, producerDisplay, producerContext);
    assert.equal(accepted.dayEvents.state, 'available'); if (accepted.dayEvents.state !== 'available') continue;
    assert.deepEqual(accepted.dayEvents.value.events, [event]); assert.equal(accepted.dayEvents.value.total, 1);
    assert.deepEqual(validateTodayEventReference(event.reference, event.reference), event.reference);
    assert.throws(() => validateTodayEventReference({ ...event.reference, extraAuthority: true }, event.reference), ReplyValidationError);
    assert.ok(Object.isFrozen(accepted.dayEvents.value.events[0]?.args));
    if (event.kind === 'job.delivered') { assert.equal(event.args.spentMinor, '1703'); assert.equal(Object.hasOwn(event.args, 'currency'), false); }
  }
  const firstSix = events.slice(0, 6).reverse();
  const raw: EngineTodayResponse = { ...producerEngine(), dayEvents: { state: 'available', value: { ...producerDisplay, calendarRevision: null, events: firstSix, total: 15, state: { kind: 'partial', reasonCodes: ['PROJECTION_CAPABILITY_PARTIAL'] } } } };
  const accepted = validateEngineToday(raw, producerDisplay, producerContext);
  if (accepted.dayEvents.state === 'available') assert.deepEqual(accepted.dayEvents.value.events.map(event => event.id), firstSix.map(event => event.id));
});

test('Today events refuse invalid later entries, unknown kinds and reasons, duplicate identities and fabricated complete coverage', () => {
  const events = producerEvents(), base = { ...producerDisplay, calendarRevision: null, events: events.slice(0, 2), total: 2, state: { kind: 'complete', reasonCodes: [] } };
  const failures: unknown[] = [
    { ...base, events: [events[0], { ...events[1], kind: 'unknown.event' }] }, { ...base, events: [events[0], { ...events[1], actor: { kind: 'member', memberId: 'member_fixture', name: PRIVATE } }] },
    { ...base, events: [events[0], events[0]] }, { ...base, events: events.slice(0, 7), total: 7 }, { ...base, total: 1 },
    { ...base, state: { kind: 'complete', reasonCodes: ['PROJECTION_CAPABILITY_PARTIAL'] } }, { ...base, state: { kind: 'partial', reasonCodes: [] } },
    { ...base, state: { kind: 'partial', reasonCodes: ['UNKNOWN_REASON'] } }, { ...base, date: '2026-10-05' },
  ];
  for (const value of failures) assert.throws(() => validateEngineToday({ ...producerEngine(), dayEvents: { state: 'available', value } }, producerDisplay, producerContext), ReplyValidationError);
  const notRecorded: TodayDayEvent = { ...events[0]!, actor: { kind: 'not-recorded' } };
  const honest: EngineTodayResponse = { ...producerEngine(), dayEvents: { state: 'available', value: { ...producerDisplay, calendarRevision: null, events: [notRecorded], total: 1, state: { kind: 'partial', reasonCodes: ['ACTOR_NOT_RECORDED'] } } } };
  assert.deepEqual(validateEngineToday(honest, producerDisplay, producerContext), honest);
  const sparse = producerEngine(); const rows = producerReviewRows(); delete rows[3]; sparse.review = { state: 'available', value: producerQueue(rows) };
  assert.throws(() => validateEngineToday(sparse, producerDisplay, producerContext), ReplyValidationError);
});

function producerReviewedCalendar() {
  const calendar = producerAttention().calendar;
  if (calendar.state !== 'reviewed') throw new Error('The synthetic calendar fixture must be reviewed.');
  return calendar;
}

function producerAttentionEngine(attention: TodayAttention): EngineTodayResponse {
  return {
    ...producerEngine(),
    review: { state: 'available', value: { ...producerQueue([]), count: 0, knownCount: 0, nextCursor: null } },
    attention: { state: 'available', value: attention, selection: { state: 'unavailable', reason: 'selection-policy-required', rows: [] } },
  };
}

test('Today retained attention accepts 10,000 reduced observations, offset fractions and explicit null evidence', () => {
  const attention = producerAttention(), retained = attention.alertEpisodes[0]!;
  const observations = Array.from({ length: 10000 }, (_, index) => ({
    id: `observation_${index}`, anchorId: `anchor_${index}`,
    observedAt: index % 2 === 0 ? '2026-10-01T14:30:00.1+05:30' : '2026-10-01T05:00:00.25-04:00',
    recordedAt: '2026-10-01T14:30:00.125+05:30', state: 'unknown' as const,
    issues: ['Engine retained observation uncertainty'], receiptId: index % 2 === 0 ? null : `receipt_observation_${index}`,
    ...(index > 0 ? { amends: `observation_${index - 1}`, amendmentReason: 'Engine retained amendment reason' } : {}),
  }));
  retained.amendments = observations;
  retained.lastObservation = null;
  retained.episode.observationIds = observations.map(observation => observation.id);
  const raw = producerAttentionEngine(attention), accepted = validateEngineToday(raw, producerDisplay, producerContext);
  assert.equal(accepted.attention.state, 'available'); if (accepted.attention.state !== 'available') return;
  const released = accepted.attention.value.alertEpisodes[0]!;
  assert.equal(released.amendments.length, 10000); assert.equal(released.episode.observationIds.length, 10000);
  assert.equal(released.lastObservation, null); assert.equal(released.amendments[0]?.receiptId, null);
  assert.equal(released.amendments[9999]?.receiptId, 'receipt_observation_9999');
  assert.equal(released.amendments[0]?.observedAt, '2026-10-01T14:30:00.1+05:30');
  assert.equal(released.amendments[9999]?.observedAt, '2026-10-01T05:00:00.25-04:00');
  assert.equal(released.amendments[9999]?.amends, 'observation_9998');
  assert.ok(Object.isFrozen(released.amendments)); assert.ok(Object.isFrozen(released.amendments[9999]?.issues));
  observations[9999]!.issues[0] = PRIVATE;
  assert.equal(released.amendments[9999]?.issues[0], 'Engine retained observation uncertainty');
  const invalidLast = { ...retained, amendments: [...observations.slice(0, -1), { ...observations[9999]!, state: 'guessed' }] };
  assert.throws(() => validateTodayAttention(invalidLast, retained.reference), ReplyValidationError);
});

test('Today reviewed calendars preserve long opaque Unicode identities, not-applicable meaning and wider native coverage', () => {
  const attention = producerAttention(), calendar = producerReviewedCalendar();
  const calendarId = 'Calendar / कर विवरण '.repeat(350), entryId = 'Entry / कर मद '.repeat(450), version = 'Reviewed / संस्करण १ '.repeat(300);
  assert.ok(calendarId.length > 5000); assert.ok(entryId.length > 5000); assert.ok(version.length > 5000);
  calendar.reference = { kind: 'reviewed-compliance-calendar', calendarId, version };
  calendar.applicability = { state: 'not-applicable', basis: 'Engine reviewer recorded that this calendar does not apply.' };
  calendar.coverage = { from: '2025-01-01', through: '2027-12-31', timeZone: producerDisplay.timeZone };
  calendar.reviewedAt = '2026-10-01T14:30:00.1+05:30'; calendar.lastCheckedAt = '2026-10-01T05:00:00.25-04:00';
  calendar.rows[0] = { ...calendar.rows[0]!, entryId, reference: { kind: 'compliance-entry', calendarId, entryId }, applicability: { ...calendar.applicability }, publishedAt: '2026-10-01T14:30:00.125+05:30' };
  attention.calendar = calendar;
  const raw = producerAttentionEngine(attention), accepted = validateEngineToday(raw, producerDisplay, producerContext);
  assert.equal(accepted.attention.state, 'available'); if (accepted.attention.state !== 'available') return;
  const released = accepted.attention.value.calendar;
  assert.equal(released.state, 'reviewed'); if (released.state !== 'reviewed') return;
  assert.equal(released.reference.calendarId, calendarId); assert.equal(released.reference.version, version);
  assert.equal(released.rows[0]?.reference.entryId, entryId); assert.deepEqual(released.coverage, calendar.coverage);
  assert.equal(released.applicability.state, 'not-applicable'); assert.equal(released.rows[0]?.applicability.state, 'not-applicable');
  assert.deepEqual(validateTodayAttention(calendar, calendar.reference), calendar);
  assert.deepEqual(validateTodayAttention(calendar.rows[0], calendar.rows[0]!.reference), calendar.rows[0]);
  assert.ok(Object.isFrozen(released.rows[0]?.applicability));
});

test('Today alert episodes bind their reference and every notice to the retained episode before and after state', () => {
  const retained = producerAttention().alertEpisodes[0]!;
  retained.notices = [{
    id: 'notice_fixture', kind: 'local-alert-notice-v1', transition: 'cleared', alertId: retained.reference.alertId,
    episodeId: retained.reference.episodeId, at: '2026-10-01T14:30:00.125+05:30', observationId: 'observation_fixture',
    before: { ...structuredClone(retained.episode), status: 'open' }, after: structuredClone(retained.episode), delivery: 'local-only',
  }];
  assert.deepEqual(validateTodayAttention(retained, retained.reference), retained);
  const failures: unknown[] = [
    { ...retained, episode: { ...retained.episode, id: 'foreign_episode' } },
    { ...retained, reference: { ...retained.reference, episodeId: 'foreign_episode' } },
    { ...retained, notices: [{ ...retained.notices[0], alertId: 'foreign_alert' }] },
    { ...retained, notices: [{ ...retained.notices[0], episodeId: 'foreign_episode' }] },
    { ...retained, notices: [{ ...retained.notices[0], before: { ...retained.episode, id: 'foreign_before_episode' } }] },
    { ...retained, notices: [{ ...retained.notices[0], after: { ...retained.episode, id: 'foreign_after_episode' } }] },
  ];
  for (const value of failures) assert.throws(() => validateTodayAttention(value, retained.reference), ReplyValidationError);
  const withoutPriorState = { ...retained, notices: [{ ...retained.notices[0]!, before: null }] };
  assert.deepEqual(validateTodayAttention(withoutPriorState, retained.reference), withoutPriorState);
});

test('Today calendar resolution refuses foreign entry, calendar, window, due-date and coverage bindings', () => {
  const valid = producerReviewedCalendar(), row = valid.rows[0]!;
  const mutations: ((calendar: ReturnType<typeof producerReviewedCalendar>) => unknown)[] = [
    calendar => { calendar.rows[0]!.reference.entryId = 'Foreign entry'; return calendar; },
    calendar => { calendar.rows[0]!.reference.calendarId = 'Foreign calendar'; return calendar; },
    calendar => { calendar.rows[0]!.dueDate = '2026-10-03'; return calendar; },
    calendar => { calendar.rows[0]!.dueDate = '2026-10-11'; return calendar; },
    calendar => { calendar.window.through = '2026-10-09'; return calendar; },
    calendar => { calendar.window.through = '2026-10-11'; return calendar; },
    calendar => { calendar.coverage.from = '2026-10-05'; return calendar; },
    calendar => { calendar.coverage.through = '2026-10-09'; return calendar; },
    calendar => { calendar.coverage.timeZone = 'UTC'; return calendar; },
    calendar => { calendar.sourceIds = []; return calendar; },
    calendar => { calendar.sourceIds.push(calendar.sourceIds[0]!); return calendar; },
    calendar => { calendar.rows.push(structuredClone(calendar.rows[0]!)); return calendar; },
    calendar => { calendar.rows.push({ ...structuredClone(calendar.rows[0]!), entryId: 'Second / मद', reference: { ...calendar.rows[0]!.reference, entryId: 'Foreign second entry' } }); return calendar; },
  ];
  for (const mutate of mutations) assert.throws(() => validateTodayAttention(mutate(producerReviewedCalendar()), valid.reference), ReplyValidationError);
  assert.throws(() => validateTodayAttention({ ...row, reference: { ...row.reference, entryId: 'Foreign entry' } }, row.reference), ReplyValidationError);
  assert.throws(() => validateTodayAttention(row, { ...row.reference, calendarId: 'Foreign calendar' }), ReplyValidationError);
});

test('Today Engine binds a valid native calendar window to the displayed date and explicit business zone', () => {
  const attention = producerAttention();
  const shifted = producerReviewedCalendar(); shifted.window.from = '2026-10-05'; shifted.window.through = '2026-10-11';
  const foreignZone = producerReviewedCalendar(); foreignZone.window.timeZone = 'UTC'; foreignZone.coverage.timeZone = 'UTC';
  assert.deepEqual(validateTodayAttention(shifted, shifted.reference), shifted);
  assert.deepEqual(validateTodayAttention(foreignZone, foreignZone.reference), foreignZone);
  for (const calendar of [shifted, foreignZone]) assert.throws(() => validateEngineToday(producerAttentionEngine({ ...attention, calendar }), producerDisplay, producerContext), ReplyValidationError);
  const unavailable: TodayAttention = { ...attention, calendar: { window: { from: '2026-10-05', through: '2026-10-11', days: 7, timeZone: producerDisplay.timeZone }, state: 'unavailable', reason: 'no-reviewed-calendar', rows: [] }, counts: { ...attention.counts, calendarEntries: 0 } };
  assert.throws(() => validateEngineToday(producerAttentionEngine(unavailable), producerDisplay, producerContext), ReplyValidationError);
});

test('Today configured attention refuses duplicate selected identities or references within an otherwise valid row budget', () => {
  const attention = producerAttention(), base = producerAttentionEngine(attention);
  const duplicateIds = [
    { id: 'same_selected_id', kind: 'alert-episode' as const, value: attention.alertEpisodes[0]! },
    { id: 'same_selected_id', kind: 'due-decision' as const, value: attention.dueDecisions[0]! },
  ];
  const duplicateReferences = [
    { id: 'first_selected_id', kind: 'alert-episode' as const, value: attention.alertEpisodes[0]! },
    { id: 'second_selected_id', kind: 'alert-episode' as const, value: structuredClone(attention.alertEpisodes[0]!) },
  ];
  for (const rows of [duplicateIds, duplicateReferences]) {
    const raw: EngineTodayResponse = { ...base, attention: { state: 'available', value: attention, selection: { state: 'configured', policyId: 'explicit_policy', policyRevision: 'revision_fixture', eligibleCount: 2, rows } } };
    assert.throws(() => validateEngineToday(raw, producerDisplay, producerContext), ReplyValidationError);
  }
});

test('Today events reject negative native job spend and bind imported source arguments to the exact import reference', () => {
  const events = producerEvents(), imported = events.find(event => event.kind === 'source.imported'), delivered = events.find(event => event.kind === 'job.delivered');
  assert.ok(imported?.kind === 'source.imported'); assert.ok(delivered?.kind === 'job.delivered');
  const engineWithEvent = (event: unknown) => ({ ...producerEngine(), dayEvents: { state: 'available', value: { ...producerDisplay, calendarRevision: null, events: [event], total: 1, state: { kind: 'complete', reasonCodes: [] } } } });
  for (const spentMinor of ['-1', '-1703', '-0']) assert.throws(() => validateEngineToday(engineWithEvent({ ...delivered, args: { spentMinor } }), producerDisplay, producerContext), ReplyValidationError);
  const zeroSpend = engineWithEvent({ ...delivered, args: { spentMinor: '0' } });
  const accepted = validateEngineToday(zeroSpend, producerDisplay, producerContext);
  assert.equal(accepted.dayEvents.state, 'available'); if (accepted.dayEvents.state === 'available') {
    const event = accepted.dayEvents.value.events[0]!; assert.equal(event.kind, 'job.delivered');
    if (event.kind === 'job.delivered') { assert.equal(event.args.spentMinor, '0'); assert.equal(Object.hasOwn(event.args, 'currency'), false); }
  }
  assert.throws(() => validateEngineToday(engineWithEvent({ ...imported, args: { ...imported.args, sourceId: 'foreign_argument_source' } }), producerDisplay, producerContext), ReplyValidationError);
  assert.throws(() => validateEngineToday(engineWithEvent({ ...imported, reference: { ...imported.reference, sourceId: 'foreign_reference_source' } }), producerDisplay, producerContext), ReplyValidationError);
});

test('Today duplicate full references refuse reordered keys while distinct native references remain accepted', { timeout: 10000 }, () => {
  const rows = producerReviewRows(), row = rows[0]!;
  if (row.reference.kind !== 'action-approval') throw Error('Expected native action pin');
  const reordered = { digest: row.reference.digest, revision: row.reference.revision, id: row.reference.id, kind: row.reference.kind };
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(row.reference));
  assert.deepEqual(validateTodayQueue(producerQueue(rows), 4).rows, rows);
  assert.throws(() => validateTodayQueue(producerQueue([row, { ...row, reference: reordered }]), 4), ReplyValidationError);
  const attention = producerAttention(), due = attention.dueDecisions[0]!;
  const selected = { state: 'configured' as const, policyId: 'explicit_policy', policyRevision: 'revision_fixture', eligibleCount: 2, rows: [
    { id: 'first', kind: 'alert-episode' as const, value: attention.alertEpisodes[0]! },
    { id: 'second', kind: 'due-decision' as const, value: due },
  ] };
  const base = producerAttentionEngine(attention);
  assert.equal(validateEngineToday({ ...base, attention: { state: 'available', value: attention, selection: selected } }, producerDisplay, producerContext).attention.state, 'available');
  const duplicate = { ...selected, rows: [
    { id: 'first', kind: 'due-decision' as const, value: due },
    { id: 'second', kind: 'due-decision' as const, value: { ...due, reference: { decisionId: due.reference.decisionId, kind: due.reference.kind } } },
  ] };
  assert.throws(() => validateEngineToday({ ...base, attention: { state: 'available', value: attention, selection: duplicate } }, producerDisplay, producerContext), ReplyValidationError);
});

test('Today native opaque pack names and complete numeric metadata survive while missing figure evidence refuses', { timeout: 10000 }, () => {
  const configuration = producerConfiguration(), longPack = { ...configuration.starterPack, id: 'p'.repeat(5001) };
  assert.equal(validateTodayInput({ display: producerDisplay, configuration: { ...configuration, starterPack: longPack } }).configuration?.starterPack.id, longPack.id);
  assert.equal(validateEngineToday({ ...producerEngine(), starterPack: longPack }, producerDisplay, producerContext).starterPack?.id, longPack.id);
  const prepared = producerPrepared(configuration), first = prepared.result.tiles[0]!;
  assert.deepEqual(validateTodayPrepared(prepared, { ...producerDisplay, ...configuration }).result.tiles[0]?.value, first.value);
  for (const value of [
    { ...first.value, definition: null }, { ...first.value, coverage: null },
    { ...first.value, receiptId: null }, { ...first.value, figure: null },
    { ...first.value, status: 'unavailable' as const },
  ]) assert.throws(() => validateTodayPrepared({ ...prepared, result: { ...prepared.result, tiles: [ { ...first, value }, ...prepared.result.tiles.slice(1) ] } }, { ...producerDisplay, ...configuration }), ReplyValidationError);
  const unavailable = { ...first.value, status: 'unavailable' as const, figure: null };
  assert.deepEqual(validateTodayPrepared({ ...prepared, result: { ...prepared.result, tiles: [{ ...first, value: unavailable }, ...prepared.result.tiles.slice(1)] } }, { ...producerDisplay, ...configuration }).result.tiles[0]?.value, unavailable);
});

test('Today queue, event and configured attention cuts retain native count coherence without fabricating empty totals', { timeout: 10000 }, () => {
  const empty = { ...producerQueue([]), count: 0, knownCount: 0, nextCursor: null };
  assert.deepEqual(validateTodayQueue(empty, 4), empty);
  for (const changed of [{ ...empty, count: 1, knownCount: 1 }, { ...empty, nextCursor: 'opaque_cursor' }]) assert.throws(() => validateTodayQueue(changed, 4), ReplyValidationError);
  const events = { ...producerDisplay, calendarRevision: null, events: [], total: 0, state: { kind: 'partial' as const, reasonCodes: ['PROJECTION_CAPABILITY_PARTIAL' as const] } };
  assert.deepEqual(validateEngineToday({ ...producerEngine(), dayEvents: { state: 'available', value: events } }, producerDisplay, producerContext).dayEvents, { state: 'available', value: events });
  assert.throws(() => validateEngineToday({ ...producerEngine(), dayEvents: { state: 'available', value: { ...events, total: 1 } } }, producerDisplay, producerContext), ReplyValidationError);
  const attention = producerAttention(), selection = { state: 'configured' as const, policyId: 'explicit_policy', policyRevision: 'revision_fixture', eligibleCount: 3, rows: [{ id: 'one', kind: 'alert-episode' as const, value: attention.alertEpisodes[0]! }] };
  const base = { ...producerEngine(), attention: { state: 'available' as const, value: attention, selection } };
  assert.equal(validateEngineToday(base, producerDisplay, producerContext).attention.state, 'available');
  assert.throws(() => validateEngineToday({ ...base, attention: { ...base.attention, selection: { ...selection, eligibleCount: 4 } } }, producerDisplay, producerContext), ReplyValidationError);
  assert.throws(() => validateEngineToday({ ...base, attention: { ...base.attention, selection: { ...selection, rows: [] } } }, producerDisplay, producerContext), ReplyValidationError);
});
