import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import type { CalendarDefinition } from '../runtime/calendar.ts';

// Explicit synthetic time, zone, evaluation bounds and policies: no production defaults.
const rules = new IntlCalendarRules({ timeZones: ['UTC'], minYear: 2026, maxYear: 2026, maxCachedLocalTimes: 32 });
const bounds = { maxNominalSlots: 4, maxCalendarDays: 4 };
const sourceId = 'synthetic-calendar-invoices';
const passphrase = 'Synthetic-calendar-engine-fixture';
function definition(patch: Partial<CalendarDefinition> = {}): CalendarDefinition {
  return { version: 1, basis: 'calendar', timeZone: 'UTC', rulesRevision: rules.revision,
    effectiveFrom: '2026-10-01T00:00:00.000Z',
    recurrence: { kind: 'daily', startDate: '2026-10-01', at: '09:00', everyDays: 1 },
    dst: { gap: 'reject', overlap: 'reject' }, excludedResolvedDates: [], holidays: { kind: 'include' },
    missed: { kind: 'catch-up', maxPerPass: 1, overflow: 'retain' }, overlap: 'defer', identityBasis: 'local-date',
    stop: { until: '2026-10-04T00:00:00.000Z', maxNominalOccurrences: 3 }, revisionPolicy: 'idle-only', ...patch };
}
function mandate(patch: Record<string, unknown> = {}) {
  return { type: 'calculation-set', goal: 'Calculate only the scheduled synthetic invoices',
    input: { requests: [{ id: 'billed', input: { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' } }, reserveMinor: '1', durationMs: 1000 }] },
    sourceIds: [sourceId], budgetMinor: '10', reserveMinor: '2',
    limits: { modelUnits: 0, durationMs: 5000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 3, deadline: '2026-10-04T00:00:00.000Z' },
    calendar: definition(), background: false, testedRoutes: [], allowedActions: [], requiresApproval: true, ...patch };
}
async function fixture(t: any, configured = true) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-calendar-engine-'));
  let clock = Date.parse('2026-10-01T09:00:00.000Z');
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    durableJobs: { workerId: 'synthetic-calendar-http', maxActiveJobs: 4, leaseMs: 1000, networkAvailable: () => false, clock: () => clock },
    ...(configured ? { jobCalendar: { rules, bounds } } : {}) });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-calendar-engine-')); await rm(directory, { recursive: true, force: true }); });
  async function call(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: any = {}) {
    const response = await call(method, payload); assert.equal(response.status, 200, `${method}: ${JSON.stringify(response.body.error)}`); return response.body.result;
  }
  await rpc('workspace.create', { name: 'Synthetic calendar invoices', passphrase, demo: false });
  // Legacy CSV is a labelled synthetic parser fixture, not a qualified vendor adapter.
  await rpc('sources.import', { sourceId, format: 'csv',
    content: 'id,kind,date,amount,currency,branch\nsynthetic-invoice,invoice,2026-09-02,123.45,INR,main\n',
    expectedTotals: { rowCount: 1, amountMinor: '12345' },
    recipe: { version: 1, id: 'synthetic-calendar-csv-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic calendar invoices', branches: ['main'] },
      bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }],
      allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' } });
  await rpc('trust.update', { autonomy: true });
  return { engine, rpc, call, at: (at: string) => { clock = Date.parse(at); } };
}

test('public calendar RPC produces exact scheduled receipts and preserves acceptance, pause and occurrence identity', async t => {
  const f = await fixture(t); const types = await f.rpc('jobs.types'); assert.equal(types.calendar.configured, true);
  const job = await f.rpc('jobs.create', mandate()); const preview = await f.rpc('jobs.calendar.preview', { id: job.id });
  assert.equal(preview.coverage.complete, true); assert.equal(preview.selected[0].instant, '2026-10-01T09:00:00.000Z');
  const blocked = await f.rpc('jobs.run', { id: job.id }); assert.equal(blocked.status, 'approval-blocked'); assert.equal(blocked.reservedMinor, '0');
  await f.rpc('jobs.approve', { id: job.id, digest: job.digest });
  const delivered = await f.rpc('jobs.run', { id: job.id }); assert.equal(delivered.status, 'awaiting-acceptance');
  const receiptId = delivered.deliverable.result.calculations[0].value.receiptId;
  const receipt = await f.rpc('receipts.get', { id: receiptId }); assert.equal(receipt.valueMinor, '12345');
  assert.equal(delivered.execution.calendar.requestedLocal, '2026-10-01T09:00');
  assert.equal(delivered.execution.calendar.rulesRevision, rules.revision);
  assert.ok(receipt.jobOperation.key.includes(delivered.execution.calendar.occurrenceId));
  assert.deepEqual(delivered.deliverable.calendar, delivered.execution.calendar);
  const paused = await f.rpc('jobs.calendar.pause', { id: job.id }); assert.equal(paused.status, 'awaiting-acceptance');
  await f.rpc('jobs.accept', { id: job.id, repeat: true }); f.at('2026-10-02T09:00:00.000Z');
  const deferred = await f.rpc('jobs.run', { id: job.id }); assert.equal(deferred.execution, undefined);
  assert.equal(f.engine.vault!.read().receipts.length, 1);
  await f.rpc('jobs.calendar.resume', { id: job.id });
  const resumed = (await f.rpc('jobs.list')).find((item: any) => item.id === job.id);
  await f.rpc('jobs.approve', { id: job.id, digest: resumed.digest });
  const second = await f.rpc('jobs.run', { id: job.id }); assert.equal(second.status, 'awaiting-acceptance');
  assert.equal(second.execution.calendar.requestedLocal, '2026-10-02T09:00');
  assert.notEqual(second.execution.calendar.occurrenceId, delivered.execution.calendar.occurrenceId);
  assert.equal(f.engine.vault!.read().receipts.length, 2);
});

test('calendar revision RPC requires both current revisions and explicit replacement, and clears prior approval', async t => {
  const f = await fixture(t); const job = await f.rpc('jobs.create', mandate()); await f.rpc('jobs.approve', { id: job.id, digest: job.digest });
  const patch = definition({ effectiveFrom: '2026-10-01T10:00:00.000Z', recurrence: { kind: 'daily', startDate: '2026-10-01', at: '11:00', everyDays: 1 } });
  let response = await f.call('jobs.calendar.configure', { id: job.id, definition: patch, expectedScheduleRevision: 1, expectedObjectiveRevision: 1 });
  assert.equal(response.body.error.code, 'CALENDAR_REVISION_POLICY_REQUIRED');
  response = await f.call('jobs.calendar.configure', { id: job.id, definition: patch, expectedScheduleRevision: 1, replacement: 'replace-immediately' });
  assert.equal(response.body.error.code, 'CALENDAR_REVISION_CHANGED');
  const revised = await f.rpc('jobs.calendar.configure', { id: job.id, definition: patch, expectedScheduleRevision: 1, expectedObjectiveRevision: 1, replacement: 'replace-immediately' });
  assert.equal(revised.calendar.revision, 2); assert.equal(revised.approval, undefined); assert.notEqual(revised.digest, job.digest);
  response = await f.call('jobs.calendar.configure', { id: job.id, definition: patch, expectedScheduleRevision: 1, expectedObjectiveRevision: 1, replacement: 'replace-immediately' });
  assert.equal(response.body.error.code, 'CALENDAR_REVISION_CHANGED');
  response = await f.call('jobs.approve', { id: job.id, digest: job.digest }); assert.equal(response.body.error.code, 'PREVIEW_CHANGED');
});

test('calendar host ports cannot be injected by RPC and legacy briefs refuse calendar requests', async t => {
  const f = await fixture(t, false); const response = await f.call('jobs.create', { ...mandate(), calendarRules: rules, calendarBounds: bounds });
  assert.equal(response.body.error.code, 'CALENDAR_RULES_REQUIRED'); assert.deepEqual((await f.rpc('jobs.types')).calendar, { configured: false });
  const legacy = await f.call('jobs.create', mandate({ type: 'owner-brief' })); assert.equal(legacy.body.error.code, 'CALENDAR_RUNNER_REQUIRED');
  assert.equal(f.engine.vault!.read().jobs.length, 0);
});

test('calendar RPC retains current owner authority and expired calendars cannot produce another receipt', async t => {
  const f = await fixture(t); const job = await f.rpc('jobs.create', mandate());
  await assert.rejects(f.engine.requestAs({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' }, 'jobs.calendar.pause', { id: job.id }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(f.engine.requestAs({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: true }, 'jobs.calendar.resume', { id: job.id }), { code: 'APP_APPROVAL_REQUIRED' });
  await f.rpc('jobs.approve', { id: job.id, digest: job.digest }); f.at('2026-10-04T00:00:00.000Z');
  const stopped = await f.rpc('jobs.run', { id: job.id }); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.execution, undefined);
  assert.equal(f.engine.vault!.read().receipts.length, 0);
});

test('legacy brief creation and host tick use the same explicitly installed synthetic clock', async t => {
  const f = await fixture(t); f.at('2026-09-01T09:00:00.000Z');
  const job = await f.rpc('jobs.create', { type: 'owner-brief', goal: 'Prepare only the synthetic owner brief',
    budgetMinor: '10', reserveMinor: '2', sourceIds: [sourceId], intervalMs: 60000, graceMs: 0, catchup: 'latest',
    nextRunAt: '2026-09-01T09:05:00.000Z', stopRule: { maxRuns: 1, deadline: '2026-09-01T10:00:00.000Z' } });
  assert.equal(job.createdAt, '2026-09-01T09:00:00.000Z');
  f.engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  assert.deepEqual(await f.engine.tick(), []);
  assert.equal(f.engine.vault!.read().jobs[0].runs, 0); assert.equal(f.engine.vault!.read().receipts.length, 0);
});
