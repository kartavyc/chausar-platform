import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AlertsService, type AlertCreate, type BusinessAlert } from '../runtime/alerts.ts';
import { CalculatorService, type CalculationReceipt } from '../runtime/calculator.ts';
import { ChausarError, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ImportService } from '../runtime/ingest.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { ReportService } from '../runtime/reports.ts';
import { TodayAttentionService, type ReviewedComplianceEntry, type TodayAttentionCalendarInput, type TodayAttentionOptions, type TodayAttentionRequest } from '../runtime/today-attention.ts';
import { Vault } from '../runtime/vault.ts';
import { FixtureStateStore } from './database-fixtures.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const displayed: TodayAttentionRequest = { displayedDate: '2026-10-04', timeZone: 'Asia/Kolkata', branch: 'main' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceId = 'synthetic-today-source';
const minute = 60_000;
const passphrase = 'synthetic today acceptance passphrase';

// Real import, ontology, calculator, alert and report services use encrypted local
// storage. Literal synthetic CSV totals do not establish native SQL qualification.
async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir()), prefix = '.today-attention-';
  const directory = await mkdtemp(join(temporaryRoot, prefix));
  let vault: Vault | undefined;
  t.after(async () => {
    await vault?.close();
    const target = await realpath(directory), scope = relative(temporaryRoot, target);
    assert.equal(target, resolve(directory)); assert.equal(dirname(target), temporaryRoot);
    assert.ok(scope.length > 0 && !scope.startsWith('..') && !isAbsolute(scope) && basename(target).startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  vault = (await Vault.create({ directory, storage: 'experimental-file', passphrase,
    name: 'PRIVATE SYNTHETIC TODAY WORKSPACE', demo: true })).vault;
  await new OntologyService(vault).publish(owner, 'ecommerce');
  const base = Date.now() + minute;
  let offset = 0;
  const at = (value: number) => new Date(base + value * minute).toISOString();
  const clock = () => at(offset);
  const store = () => vault!;
  const alerts = () => new AlertsService(store(), { clock });
  const reports = () => new ReportService(store());
  const today = (options: TodayAttentionOptions = {}) => new TodayAttentionService(store(), {
    alertsOptions: () => ({ clock }), ...options,
  });
  async function measurement(valueMinor: string, when: number): Promise<CalculationReceipt> {
    const amount = BigInt(valueMinor), major = `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
    const imported = await new ImportService(store()).commit(owner, {
      sourceId, format: 'csv', expectedTotals: { rowCount: 1, amountMinor: valueMinor },
      content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
        + `sale,sale,2026-09-10,${major},INR,C,I,O,,delivered,PRIVATE_SYNTHETIC_TODAY_ROW_${when},main\n`,
    });
    assert.equal(imported.qualification, 'experimental'); assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, valueMinor); offset = when;
    const receipt = await new CalculatorService(store()).calculate(owner, { operation: 'earned', sourceIds: [sourceId],
      period, branch: 'main', asOf: at(when) });
    assert.equal(receipt.valueMinor, valueMinor); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
    assert.ok(receipt.coverage.importIds.includes(imported.id)); assert.deepEqual(receipt.rowIds, imported.rowIds);
    return receipt;
  }
  async function published(baseline: CalculationReceipt, changes: Partial<AlertCreate> = {}) {
    const draft = await alerts().create(owner, { conditionId: 'synthetic-explicit-revenue-condition',
      label: 'PRIVATE_SYNTHETIC_TODAY_ALERT', baselineReceiptId: baseline.id, figureKey: 'total',
      unit: { kind: 'money', currency: 'INR' }, sourceIds: [sourceId], periodMode: 'fixed', direction: 'above',
      activateMinor: '10000', clearMinor: '8000', activation: { observations: 1, durationMs: 0 },
      clearance: { observations: 1, durationMs: 0 }, severity: { initial: 'warning', downgrade: 'on-clear' },
      reopening: 'same-episode', maxEvidenceAgeMs: 60 * minute, maxObservationGapMs: 60 * minute, ...changes });
    return alerts().publish(owner, draft.id, { expectedRevision: draft.revision });
  }
  async function evaluate(alert: BusinessAlert, receipt: CalculationReceipt, observationId: string) {
    return alerts().evaluate(owner, alert.id, { expectedRevision: alert.revision, observationId,
      observedAt: receipt.asOf, receiptId: receipt.id });
  }
  return { directory, store, at, alerts, reports, today, measurement, published, evaluate,
    advance: (value: number) => { offset = value; },
    async reopen() { await vault!.close(); vault = await Vault.open({ directory, storage: 'experimental-file', passphrase }); },
  };
}

function entry(entryId: string, dueDate: string): ReviewedComplianceEntry {
  return { entryId, title: `Reviewed synthetic obligation ${entryId}`, dueDate,
    sourceUrl: `https://example.invalid/reviewed/${entryId}`, publishedAt: '2026-09-01T09:00:00Z',
    lastCheckedAt: '2026-10-03T11:00:00Z', reviewedAt: '2026-10-03T12:00:00Z', reviewedBy: 'synthetic-reviewer',
    applicability: { state: 'unknown', basis: 'Reviewer has not established this business applicability.' } };
}
function reviewedCalendar(entries: ReviewedComplianceEntry[] = []): Extract<TodayAttentionCalendarInput, { state: 'reviewed' }> {
  return { state: 'reviewed', calendarId: 'private-reviewed-calendar', version: 'reviewed-v1', sourceIds: [sourceId],
    reviewedAt: '2026-10-03T12:00:00Z', reviewedBy: 'synthetic-reviewer', lastCheckedAt: '2026-10-03T11:00:00Z',
    applicability: { state: 'unknown', basis: 'Reviewer has not established aggregate business applicability.' },
    coverage: { from: '2026-10-01', through: '2026-10-31', timeZone: displayed.timeZone }, entries };
}

test('Today requires an explicit valid civil date and timezone without accepting calendar data from callers', () => {
  const service = new TodayAttentionService(new FixtureStateStore());
  for (const request of [{ displayedDate: '2026-02-30', timeZone: 'Asia/Kolkata' },
    { displayedDate: displayed.displayedDate }, { timeZone: displayed.timeZone },
    { ...displayed, timeZone: 'invalid/zone' }, { ...displayed, calendar: reviewedCalendar() },
    { ...displayed, branch: '' }]) {
    assert.throws(() => service.read(owner, request as TodayAttentionRequest), { code: 'INVALID_TODAY_ATTENTION' });
  }
  assert.deepEqual(service.read(owner, displayed).request, displayed);
});

test('real repeated observations and duplicate receipt attempts produce one retained episode row', async t => {
  const f = await fixture(t), baseline = await f.measurement('12000', 0);
  let alert = await f.published(baseline);
  alert = (await f.evaluate(alert, baseline, 'first')).alert;
  const second = await f.measurement('13000', 1);
  const evaluation = await f.evaluate(alert, second, 'second'); alert = evaluation.alert;
  const duplicate = await f.evaluate(alert, second, 'same-evidence-again');
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.alert.observations.length, 2);
  const result = f.today().read(owner, displayed);
  assert.equal(result.counts.alertEpisodes, 1); assert.equal(result.alertEpisodes.length, 1);
  assert.deepEqual(result.alertEpisodes[0].reference, { kind: 'alert-episode', alertId: alert.id, episodeId: alert.episodes[0].id });
  assert.equal(result.alertEpisodes[0].episode.observationIds.length, 2);
  assert.equal(result.alertEpisodes[0].lastObservation?.id, 'second'); assert.equal(result.evaluated, false);
  await f.reopen(); assert.deepEqual(f.today().read(owner, displayed), result);
});

test('new lower source data and expired evidence cannot clear a retained breach during Today read', async t => {
  const f = await fixture(t), first = await f.measurement('12000', 0);
  let alert = await f.published(first); alert = (await f.evaluate(alert, first, 'measured-breach')).alert;
  const held = f.today().read(owner, displayed);
  await f.measurement('5000', 1);
  let result = f.today().read(owner, displayed);
  assert.equal(result.alertEpisodes[0].episode.status, 'open');
  assert.equal(result.alertEpisodes[0].lastObservation?.state, 'breach');
  assert.equal(result.alertEpisodes[0].evidence.state, 'uncertain');
  assert.ok(result.alertEpisodes[0].evidence.issues.includes('stale-receipt'));
  assert.throws(() => f.today().assertCurrent(owner, held), { code: 'TODAY_ATTENTION_STALE' });
  f.advance(61); result = f.today().read(owner, displayed);
  assert.equal(result.alertEpisodes[0].episode.status, 'open');
  assert.ok(result.alertEpisodes[0].evidence.issues.includes('expired-evidence'));
  assert.ok(result.alertEpisodes[0].evidence.issues.includes('observation-gap'));
  assert.equal(f.alerts().get(owner, alert.id).revision, alert.revision);
});

test('uncertain amendments preserve breach history and measured amendments expose retained retractions', async t => {
  const f = await fixture(t), first = await f.measurement('12000', 0);
  let alert = await f.published(first); alert = (await f.evaluate(alert, first, 'original')).alert;
  const held = f.today().read(owner, displayed);
  f.advance(1);
  alert = (await f.alerts().evaluate(owner, alert.id, { expectedRevision: alert.revision,
    observationId: 'unknown-amendment', observedAt: first.asOf, missingReason: 'Restated source amount not available.',
    correction: { observationId: 'original', reason: 'Source reported a correction without a measured total.' } })).alert;
  let row = f.today().read(owner, displayed).alertEpisodes[0];
  assert.equal(row.episode.status, 'open'); assert.equal(row.episode.uncertain, true);
  assert.equal(row.lastObservation?.id, 'unknown-amendment'); assert.equal(row.lastObservation?.state, 'unknown');
  assert.equal(row.amendments[0].amends, 'original'); assert.equal(row.lastObservation?.receiptId, null);
  assert.throws(() => f.today().assertCurrent(owner, held), { code: 'TODAY_ATTENTION_STALE' });
  const corrected = await f.measurement('5000', 2);
  alert = (await f.alerts().evaluate(owner, alert.id, { expectedRevision: alert.revision,
    observationId: 'qualified-amendment', observedAt: first.asOf, receiptId: corrected.id,
    correction: { observationId: 'original', reason: 'Reviewed source restated the original measured total.' } })).alert;
  row = f.today().read(owner, displayed).alertEpisodes[0];
  assert.equal(row.episode.status, 'retracted'); assert.equal(row.lastObservation?.id, 'qualified-amendment');
  assert.deepEqual(row.amendments.map(value => value.id), ['unknown-amendment', 'qualified-amendment']);
  assert.ok(row.notices.some(notice => notice.transition === 'amended' && notice.after.status === 'retracted'));
  assert.equal(row.lastObservation?.receiptId, corrected.id); assert.equal(f.today().read(owner, displayed).counts.alertEpisodes, 1);
});

test('each retained episode exposes its own latest observation and keeps existing deterministic order', async t => {
  const f = await fixture(t), first = await f.measurement('12000', 0);
  let alert = await f.published(first, { reopening: 'new-episode' });
  alert = (await f.evaluate(alert, first, 'first-open')).alert;
  alert = (await f.evaluate(alert, await f.measurement('5000', 1), 'first-clear')).alert;
  alert = (await f.evaluate(alert, await f.measurement('13000', 2), 'second-open')).alert;
  const result = f.today().read(owner, displayed);
  assert.equal(result.counts.alertEpisodes, 2);
  assert.deepEqual(result.alertEpisodes.map(row => row.reference.episodeId), alert.episodes.map(episode => episode.id));
  assert.deepEqual(result.alertEpisodes.map(row => row.lastObservation?.id), ['first-clear', 'second-open']);
  assert.deepEqual(result.alertEpisodes.map(row => row.episode.status), ['cleared', 'open']);
});

test('due decisions are open and today or overdue in retained service order, with typed references', async t => {
  const f = await fixture(t), receipt = await f.measurement('12000', 0), reports = f.reports();
  const today = await reports.decision(owner, { text: 'PRIVATE_SYNTHETIC_TODAY_DECISION', reviewDate: '2026-10-04', receiptIds: [receipt.id], branch: 'main' });
  const overdue = await reports.decision(owner, { text: 'Overdue synthetic review', reviewDate: '2026-10-03', receiptIds: [receipt.id], branch: 'main' });
  await reports.decision(owner, { text: 'Tomorrow synthetic review', reviewDate: '2026-10-05', receiptIds: [receipt.id], branch: 'main' });
  const closed = await reports.decision(owner, { text: 'Closed synthetic review', reviewDate: '2026-10-03', receiptIds: [receipt.id], branch: 'main' });
  await reports.reviewDecision(owner, closed.id, { outcome: 'completed' });
  const result = f.today().read(owner, displayed);
  assert.equal(result.counts.dueDecisions, 2);
  assert.deepEqual(result.dueDecisions.map(row => row.reference), [today.id, overdue.id].map(decisionId => ({ kind: 'decision', decisionId })));
  assert.deepEqual(result.dueDecisions.map(row => row.due), ['today', 'overdue']);
  assert.ok(result.dueDecisions.every(row => row.status === 'open' && row.receiptIds[0] === receipt.id && row.revision === null));
});

test('revoked sources suppress alert, decision and calendar rows without leaking hidden references or counts', async t => {
  const f = await fixture(t), receipt = await f.measurement('12000', 0);
  let alert = await f.published(receipt); alert = (await f.evaluate(alert, receipt, 'private-observation')).alert;
  const decision = await f.reports().decision(owner, { text: 'PRIVATE_SYNTHETIC_TODAY_DECISION', reviewDate: displayed.displayedDate, receiptIds: [receipt.id], branch: 'main' });
  const calendar = reviewedCalendar([entry('private-calendar-entry', displayed.displayedDate)]);
  const service = f.today({ calendar: () => calendar }), held = service.read(owner, displayed);
  assert.deepEqual(held.counts, { alertEpisodes: 1, dueDecisions: 1, calendarEntries: 1 });
  await f.store().update(state => { state.sourceRules.push({ sourceId, revoked: true }); });
  const hidden = service.read(owner, displayed);
  assert.deepEqual(hidden.counts, { alertEpisodes: 0, dueDecisions: 0, calendarEntries: 0 });
  assert.equal(hidden.calendar.state, 'unavailable');
  if (hidden.calendar.state === 'unavailable') assert.equal(hidden.calendar.reason, 'current-authority-unavailable');
  for (const privateValue of [alert.id, alert.episodes[0].id, receipt.id, decision.id, calendar.calendarId,
    'PRIVATE_SYNTHETIC_TODAY_ALERT', 'PRIVATE_SYNTHETIC_TODAY_DECISION', 'private-calendar-entry']) {
    assert.equal(JSON.stringify(hidden).includes(privateValue), false);
  }
  assert.throws(() => service.assertCurrent(owner, held), { code: 'TODAY_ATTENTION_STALE' });
});

test('revoked member epochs reject held authority and new epochs cannot reuse old private alerts or decision receipts', async t => {
  const f = await fixture(t), receipt = await f.measurement('12000', 0);
  let alert = await f.published(receipt); alert = (await f.evaluate(alert, receipt, 'private-epoch-observation')).alert;
  const decision = await f.reports().decision(owner, { text: 'Private epoch decision', reviewDate: displayed.displayedDate, receiptIds: [receipt.id], branch: 'main' });
  const service = f.today(), held = service.read(owner, displayed);
  await f.store().update(state => { state.members[0].epoch++; });
  assert.throws(() => service.read(owner, displayed), { code: 'ACCESS_REVOKED' });
  assert.throws(() => service.assertCurrent(owner, held), { code: 'ACCESS_REVOKED' });
  const currentOwner = { ...owner, epoch: 2 }, current = service.read(currentOwner, displayed);
  assert.deepEqual(current.counts, { alertEpisodes: 0, dueDecisions: 0, calendarEntries: 0 });
  for (const privateValue of [alert.id, receipt.id, decision.id, 'Private epoch decision']) assert.equal(JSON.stringify(current).includes(privateValue), false);
  assert.throws(() => service.assertCurrent(currentOwner, held), { code: 'TODAY_ATTENTION_STALE' });
});

test('reviewed calendar window is exactly displayed day through day plus six, preserving unknown applicability and provenance', () => {
  const store = new FixtureStateStore();
  const calendar = reviewedCalendar([entry('outside-before', '2026-10-03'), entry('seventh-day', '2026-10-10'),
    entry('first-day', '2026-10-04'), entry('outside-after', '2026-10-11')]);
  const result = new TodayAttentionService(store, { calendar: () => calendar }).read(owner, displayed);
  assert.deepEqual(result.calendar.window, { from: '2026-10-04', through: '2026-10-10', days: 7, timeZone: 'Asia/Kolkata' });
  assert.equal(result.calendar.state, 'reviewed'); assert.equal(result.counts.calendarEntries, 2);
  if (result.calendar.state !== 'reviewed') return assert.fail('Expected reviewed calendar.');
  assert.deepEqual(result.calendar.rows.map(row => row.entryId), ['seventh-day', 'first-day']);
  assert.deepEqual(result.calendar.rows.map(row => row.reference), ['seventh-day', 'first-day'].map(entryId => ({ kind: 'compliance-entry', calendarId: calendar.calendarId, entryId })));
  assert.deepEqual(result.calendar.applicability, calendar.applicability);
  assert.ok(result.calendar.rows.every(row => row.applicability.state === 'unknown'));
  assert.equal(result.calendar.rows[0].publishedAt, '2026-09-01T09:00:00Z');
  assert.equal(result.calendar.rows[0].lastCheckedAt, '2026-10-03T11:00:00Z');
  assert.notEqual(result.calendar.rows[0].publishedAt, result.calendar.rows[0].lastCheckedAt);
});

test('calendar distinguishes missing, reviewed empty, explicit unsupported and legacy source contract', async () => {
  const store = new FixtureStateStore(), service = new TodayAttentionService(store);
  const missing = service.read(owner, displayed);
  assert.equal(missing.calendar.state, 'unavailable'); assert.equal(missing.counts.calendarEntries, 0);
  const empty = new TodayAttentionService(store, { calendar: () => reviewedCalendar() }).read(owner, displayed);
  assert.equal(empty.calendar.state, 'reviewed'); assert.deepEqual(empty.calendar.rows, []);
  assert.equal(new TodayAttentionService(store, { calendar: () => ({ state: 'unavailable' }) }).read(owner, displayed).calendar.state, 'unavailable');
  assert.equal(new TodayAttentionService(store, { calendar: () => ({ state: 'unsupported' }) }).read(owner, displayed).calendar.state, 'unsupported');
  await new ReportService(store).setComplianceCalendar(owner, [{ title: 'Legacy reviewed due date',
    dueDate: '2026-10-04', sourceUrl: 'https://example.invalid/legacy', publishedAt: '2026-09-01', reviewedBy: 'reviewer' }], 'legacy-v1');
  const legacy = service.read(owner, displayed);
  assert.equal(legacy.calendar.state, 'unsupported');
  if (legacy.calendar.state === 'unsupported') assert.equal(legacy.calendar.reason, 'calendar-source-contract-required');
  assert.deepEqual(legacy.calendar.rows, []); assert.equal(JSON.stringify(legacy).includes('Legacy reviewed due date'), false);
});

test('missing reviewed provenance and applicability are unsupported rather than inferred', () => {
  const changes: ((calendar: ReturnType<typeof reviewedCalendar>) => void)[] = [
    calendar => { delete (calendar as Partial<typeof calendar>).lastCheckedAt; },
    calendar => { delete (calendar as Partial<typeof calendar>).reviewedAt; },
    calendar => { delete (calendar as Partial<typeof calendar>).applicability; },
    calendar => { calendar.sourceIds = []; },
    calendar => { calendar.sourceIds = Array<string>(1); },
    calendar => { calendar.entries = Array<ReviewedComplianceEntry>(1); },
    calendar => { calendar.entries[0].lastCheckedAt = ''; },
    calendar => { calendar.entries[0].sourceUrl = 'https://'; },
    calendar => { delete (calendar.entries[0] as Partial<ReviewedComplianceEntry>).applicability; },
    calendar => { calendar.entries[0].reviewedAt = '2026-02-30T12:00:00Z'; },
  ];
  for (const change of changes) {
    const calendar = reviewedCalendar([entry('private-unverified-entry', displayed.displayedDate)]); change(calendar);
    const result = new TodayAttentionService(new FixtureStateStore(), { calendar: () => calendar }).read(owner, displayed);
    assert.equal(result.calendar.state, 'unsupported');
    if (result.calendar.state === 'unsupported') assert.equal(result.calendar.reason, 'calendar-provenance-incomplete');
    assert.equal(result.counts.calendarEntries, 0); assert.equal(JSON.stringify(result).includes('private-unverified-entry'), false);
  }
});

test('trusted calendar adapter extra fields are never forwarded into Today domain rows', () => {
  const calendar = reviewedCalendar([entry('declared-entry', displayed.displayedDate)]);
  Object.assign(calendar, { hiddenAdapterPayload: 'PRIVATE_ADAPTER_CALENDAR_PAYLOAD' });
  Object.assign(calendar.applicability, { hiddenAdapterPayload: 'PRIVATE_ADAPTER_APPLICABILITY_PAYLOAD' });
  Object.assign(calendar.coverage, { hiddenAdapterPayload: 'PRIVATE_ADAPTER_COVERAGE_PAYLOAD' });
  Object.assign(calendar.entries[0], { hiddenAdapterPayload: 'PRIVATE_ADAPTER_ENTRY_PAYLOAD' });
  Object.assign(calendar.entries[0].applicability, { hiddenAdapterPayload: 'PRIVATE_ADAPTER_ENTRY_APPLICABILITY_PAYLOAD' });
  const result = new TodayAttentionService(new FixtureStateStore(), { calendar: () => calendar }).read(owner, displayed);
  assert.equal(result.calendar.state, 'reviewed'); assert.equal(result.counts.calendarEntries, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_ADAPTER_'), false);
  assert.equal(JSON.stringify(result).includes('hiddenAdapterPayload'), false);
});

test('calendar must explicitly cover all seven days in the displayed timezone across month and leap-day boundaries', () => {
  for (const coverage of [{ from: '2026-10-05', through: '2026-10-10', timeZone: displayed.timeZone },
    { from: '2026-10-04', through: '2026-10-09', timeZone: displayed.timeZone },
    { from: '2026-10-04', through: '2026-10-10', timeZone: 'Etc/UTC' }]) {
    const calendar = { ...reviewedCalendar(), coverage };
    const result = new TodayAttentionService(new FixtureStateStore(), { calendar: () => calendar }).read(owner, displayed);
    assert.equal(result.calendar.state, 'unsupported');
    if (result.calendar.state === 'unsupported') assert.equal(result.calendar.reason, 'calendar-window-not-covered');
  }
  const service = new TodayAttentionService(new FixtureStateStore());
  assert.equal(service.read(owner, { displayedDate: '2026-12-29', timeZone: 'Etc/UTC' }).calendar.window.through, '2027-01-04');
  assert.equal(service.read(owner, { displayedDate: '2028-02-27', timeZone: 'Etc/UTC' }).calendar.window.through, '2028-03-04');
});

test('held responses pin readiness, decision lifecycle, calendar provenance and caller integrity', async t => {
  const f = await fixture(t), receipt = await f.measurement('12000', 0);
  let alert = await f.published(receipt); alert = (await f.evaluate(alert, receipt, 'held-breach')).alert;
  const decision = await f.reports().decision(owner, { text: 'Held synthetic review', reviewDate: displayed.displayedDate, receiptIds: [receipt.id], branch: 'main' });
  let ready = true, calendar = reviewedCalendar();
  const seen: StateStore[] = [];
  const service = f.today({
    alertsOptions: view => { seen.push(view); return { clock: () => f.at(0), calculatorOptions: snapshot => ({ receiptGuard: ctx => {
      assert.notEqual(snapshot, f.store()); assert.equal(snapshot.read().members[0].epoch, ctx.epoch);
      if (!ready) throw new ChausarError('HOST_NOT_READY', 'Synthetic connector readiness revoked.');
    } }) }; },
    reportOptions: view => { seen.push(view); return { receiptGuard: ctx => {
      assert.notEqual(view, f.store()); assert.equal(view.read().members[0].epoch, ctx.epoch);
      if (!ready) throw new ChausarError('HOST_NOT_READY', 'Synthetic connector readiness revoked.');
    } }; }, calendar: () => calendar,
  });
  const held = service.read(owner, displayed);
  assert.deepEqual(service.assertCurrent(owner, held), held); assert.ok(seen.every(view => view !== f.store()));
  ready = false; const unavailable = service.read(owner, displayed);
  assert.deepEqual(unavailable.counts, { alertEpisodes: 0, dueDecisions: 0, calendarEntries: 0 });
  assert.throws(() => service.assertCurrent(owner, held), { code: 'TODAY_ATTENTION_STALE' });
  ready = true; calendar = { ...calendar, lastCheckedAt: '2026-10-03T13:00:00Z' };
  assert.throws(() => service.assertCurrent(owner, held), { code: 'TODAY_ATTENTION_STALE' });
  const beforeClosure = service.read(owner, displayed);
  await f.reports().reviewDecision(owner, decision.id, { outcome: 'completed' });
  assert.throws(() => service.assertCurrent(owner, beforeClosure), { code: 'TODAY_ATTENTION_STALE' });
  const intact = service.read(owner, displayed), tampered = structuredClone(intact);
  tampered.alertEpisodes[0].label = 'Changed held label';
  assert.throws(() => service.assertCurrent(owner, tampered), { code: 'TODAY_ATTENTION_STALE' });
  f.advance(61);
  assert.throws(() => f.today().assertCurrent(owner, intact), { code: 'TODAY_ATTENTION_STALE' });
});

test('Today and held revalidation leave the real state and encrypted authority bytes unchanged', async t => {
  const f = await fixture(t), receipt = await f.measurement('12000', 0);
  let alert = await f.published(receipt); alert = (await f.evaluate(alert, receipt, 'read-only-breach')).alert;
  await f.reports().decision(owner, { text: 'Read-only synthetic review', reviewDate: displayed.displayedDate, receiptIds: [receipt.id], branch: 'main' });
  let updates = 0;
  const counted: StateStore = { read: () => f.store().read(), update: async change => { updates++; return f.store().update(change); } };
  const service = new TodayAttentionService(counted, { alertsOptions: () => ({ clock: () => f.at(0) }),
    calendar: (_ctx, _request, view) => { assert.notEqual(view, counted); return reviewedCalendar(); } });
  const before = f.store().read(), encrypted = await readFile(join(f.directory, 'authority.encrypted.json'), 'utf8');
  const held = service.read(owner, displayed); service.read(owner, displayed); service.assertCurrent(owner, held);
  assert.equal(updates, 0); assert.deepEqual(f.store().read(), before);
  assert.equal(await readFile(join(f.directory, 'authority.encrypted.json'), 'utf8'), encrypted);
  assert.equal(encrypted.includes('PRIVATE_SYNTHETIC_TODAY_ALERT'), false); assert.equal(encrypted.includes(passphrase), false);
  assert.deepEqual([before.jobs.length, before.modelReceipts.length, before.actions.length, before.schedules.length], [0, 0, 0, 0]);
});

test('a trusted hook cannot release references based on authority superseded during the read', () => {
  const underlying = new FixtureStateStore();
  let calls = 0;
  const store: StateStore = { read: () => { const state = underlying.read();
    if (++calls >= 2) state.revision++; return state;
  }, update: change => underlying.update(change) };
  assert.throws(() => new TodayAttentionService(store).read(owner, displayed), { code: 'TODAY_ATTENTION_STALE' });
  const revoke: StateStore = { read: () => { const state: State = underlying.read();
    if (++calls >= 2) state.members[0].active = false; return state;
  }, update: change => underlying.update(change) };
  calls = 0; assert.throws(() => new TodayAttentionService(revoke).read(owner, displayed), { code: 'ACCESS_REVOKED' });
});
