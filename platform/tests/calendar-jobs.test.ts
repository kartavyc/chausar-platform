import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';
import { DurableJobRunner } from '../runtime/job-runner.ts';
import type { GoalProvider, GoalRunner, ProviderRequest } from '../runtime/job-runner.ts';
import type { GoalExecution, GoalPlan, ProviderSettlement } from '../runtime/job-protocol.ts';
import { digest } from '../runtime/actions.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import type { CalendarRules } from '../runtime/calendar-zone.ts';
import type { CalendarDefinition } from '../runtime/calendar.ts';

class Store implements StateStore {
  state = initialState('Synthetic calendar mandates', true); queue = Promise.resolve(); failSettlement = false;
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const state = this.read(); const result = await change(state); if (this.failSettlement && state.jobs.some(job => job.execution?.attempts.some((a: any) => a.status === 'verified'))) { this.failSettlement = false; throw new Error('Synthetic settlement loss'); } this.state = state; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const rules = new IntlCalendarRules({ timeZones: ['UTC', 'America/New_York'], minYear: 2024, maxYear: 2026, maxCachedLocalTimes: 128 });
const bounds = { maxNominalSlots: 20, maxCalendarDays: 400 };
function calendar(patch: Partial<CalendarDefinition> = {}): CalendarDefinition { return { version: 1, basis: 'calendar', timeZone: 'UTC', rulesRevision: rules.revision, effectiveFrom: '2024-01-01T00:00:00.000Z', recurrence: { kind: 'daily', startDate: '2024-01-01', at: '09:00', everyDays: 1 }, dst: { gap: 'reject', overlap: 'reject' }, excludedResolvedDates: [], holidays: { kind: 'include' }, missed: { kind: 'catch-up', maxPerPass: 2, overflow: 'retain' }, overlap: 'defer', identityBasis: 'local-date', stop: { until: '2024-01-06T00:00:00.000Z', maxNominalOccurrences: 5 }, revisionPolicy: 'idle-only', ...patch }; }
const plan: GoalPlan = { runnerVersion: '1', steps: [{ id: 'inspect', provider: 'synthetic', input: { record: 'synthetic' }, reserveMinor: '10', modelUnits: 0, durationMs: 1000, actionExposureMinor: '0', modelRequired: false, dependencies: [] }], children: [], obligations: [{ id: 'inspect', description: 'Inspect the requested synthetic record', requiredStepIds: ['inspect'] }] };
const goal: GoalRunner = { type: 'calendar-synthetic', version: '1', validate: input => input, plan: () => plan, deliver: () => ({ synthetic: true }), release: () => true };
function settlement(request: ProviderRequest): ProviderSettlement { return { result: { value: request.step.input, informationClass: 'computation', evidenceIds: ['synthetic-proof'], sourceTainted: false }, spentMinor: '10', modelUnits: 0, durationMs: 1, actionExposureMinor: '0' }; }
function setup(at = '2024-01-01T09:00:00.000Z') {
  const store = new Store(); store.state.policy.autonomy = true; let clock = Date.parse(at); const calls: string[] = []; const saved = new Map<string, ProviderSettlement>();
  const provider: GoalProvider = { id: 'synthetic', kind: 'read-only', transport: 'local', model: false, dispatch: async request => { calls.push(request.key); const value = settlement(request); saved.set(request.key, value); return value; }, reconcile: async request => saved.has(request.key) ? { outcome: 'verified', id: `proof:${request.key}`, settlement: saved.get(request.key)! } : { outcome: 'unknown' } };
  const jobs = new JobService(store, { clock: () => clock, calendarRules: rules, calendarBounds: bounds, deliverableGuard: () => true });
  const options = { workerId: 'synthetic-worker', maxActiveJobs: 10, leaseMs: 1000, networkAvailable: () => true };
  const runner = new DurableJobRunner(jobs, [goal], [provider], options);
  const config = { type: goal.type, goal: 'Inspect explicitly scheduled synthetic records', input: {}, budgetMinor: '50', reserveMinor: '10', limits: { modelUnits: 0, durationMs: 5000, actionExposureMinor: '0' }, stopRule: { maxRuns: 5, deadline: '2024-01-07T00:00:00.000Z' }, calendar: calendar() };
  return { store, jobs, runner, config, calls, saved, provider, options, now: () => clock, at: (time: string) => { clock = Date.parse(time); }, restart: () => new DurableJobRunner(jobs, [goal], [provider], options) };
}

test('calendar creation requires explicit ports and excludes ambiguous legacy interval settings', async () => {
  const f = setup(); await assert.rejects(new JobService(f.store, { clock: f.jobs.clock }).create(owner, f.config), { code: 'CALENDAR_RULES_REQUIRED' });
  await assert.rejects(f.runner.create(owner, { ...f.config, intervalMs: 60000 }), { code: 'AMBIGUOUS_JOB_SCHEDULE' });
  const job = await f.runner.create(owner, f.config); assert.equal(job.calendar!.definition.timeZone, 'UTC'); assert.equal(job.calendar!.revision, 1); assert.equal(job.calendar!.objectiveRevision, 1);
});

test('claim, budget reservation and owner acceptance persist one calendar identity atomically', async () => {
  const f = setup(); const job = await f.runner.create(owner, f.config);
  const race = await Promise.allSettled([f.jobs.acquire(owner, job.id, 'left'), f.jobs.acquire(owner, job.id, 'right')]); assert.equal(race.filter(x => x.status === 'fulfilled').length, 1);
  let raw = f.store.state.jobs[0]; assert.equal(raw.reservedMinor, '10'); assert.equal(raw.calendar.records.length, 1); const id = raw.calendar.current;
  const restart = f.restart(); await restart.recoverInterrupted(owner); const delivered = await restart.run(owner, job.id);
  assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.calendar!.records[0].status, 'delivered'); assert.equal(delivered.execution!.calendar!.occurrenceId, id); assert.equal((delivered.deliverable as any).calendar.occurrenceId, id); assert.ok(f.calls[0].includes(`:occurrence:${id}:`));
  assert.equal((await restart.run(owner, job.id)).status, 'awaiting-acceptance'); assert.equal(f.calls.length, 1); await f.jobs.accept(owner, job.id, true);
  raw = f.store.state.jobs[0]; assert.equal(raw.calendar.records[0].status, 'accepted'); assert.equal(raw.calendar.current, undefined); assert.equal(raw.archivedExecutions.length, 1);
  assert.equal((await restart.run(owner, job.id)).status, 'scheduled'); assert.equal(f.calls.length, 1); assert.equal(raw.spentMinor, '10');
});

test('restart before execution initialization preserves admitted slot past grace and future pause', async () => {
  const f = setup(); const job = await f.runner.create(owner, { ...f.config, calendar: calendar({ missed: { kind: 'skip', graceMs: 0 } }) });
  const admitted = await f.jobs.acquire(owner, job.id, 'crashed'); const id = admitted.calendar!.current; await f.jobs.pauseCalendar(owner, job.id);
  f.at('2024-01-03T09:00:00.000Z'); const restart = f.restart(); await restart.recoverInterrupted(owner); assert.equal(f.store.state.jobs[0].reservedMinor, '0');
  const delivered = await restart.run(owner, job.id); assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.execution!.scheduledFor, '2024-01-01T09:00:00.000Z'); assert.equal(delivered.execution!.calendar!.occurrenceId, id); assert.equal(f.calls.length, 1);
  await f.jobs.accept(owner, job.id, true); assert.deepEqual(await restart.tick(owner, { awake: true, windowOpen: true, backgroundEnabled: true }), []);
  await f.jobs.resumeCalendar(owner, job.id); const second = await restart.run(owner, job.id); assert.equal(second.execution!.scheduledFor, '2024-01-03T09:00:00.000Z'); assert.equal(second.calendar!.records.find(x => x.requestedLocal === '2024-01-02T09:00')!.reason, 'missed-grace');
});

test('future pause leaves current uncertainty and readback authority intact', async () => {
  const f = setup(); const job = await f.runner.create(owner, f.config); f.store.failSettlement = true; const unknown = await f.runner.run(owner, job.id);
  assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.reservedMinor, '10'); const key = unknown.execution!.attempts[0].key;
  await f.jobs.pauseCalendar(owner, job.id); const readback = await f.restart().reconcile(owner, job.id); assert.equal(readback.reservedMinor, '0'); assert.equal(readback.spentMinor, '10'); assert.equal(readback.execution!.attempts[0].key, key);
  const result = await f.runner.run(owner, job.id); assert.equal(result.status, 'awaiting-acceptance'); assert.equal(f.calls.length, 1);
});

test('coalesced execution and output retain the exact admitted periods across crash, readback and later due slots', async () => {
  const f = setup('2024-01-03T09:00:00.000Z');
  const job = await f.runner.create(owner, { ...f.config, calendar: calendar({ missed: { kind: 'coalesce' } }) });
  const representedIds = ['2024-01-01', '2024-01-02', '2024-01-03'].map(period => digest({ jobId: job.id, period, fold: 0 }));
  const admitted = await f.jobs.acquire(owner, job.id, 'synthetic-crashed-worker');
  assert.equal(admitted.execution, undefined);
  assert.equal(admitted.calendar!.current, representedIds[2]);
  assert.deepEqual(admitted.calendar!.records.find(record => record.id === representedIds[2])!.representedIds, representedIds);
  assert.deepEqual(admitted.calendar!.records.filter(record => record.status === 'coalesced').map(record => record.id), representedIds.slice(0, 2));

  f.at('2024-01-04T09:00:00.000Z');
  const restart = f.restart(); await restart.recoverInterrupted(owner); f.store.failSettlement = true;
  const unknown = await restart.run(owner, job.id);
  assert.equal(unknown.status, 'outcome-unknown');
  assert.equal(unknown.execution!.scheduledFor, '2024-01-03T09:00:00.000Z');
  assert.deepEqual(unknown.execution!.calendar!.representedIds, representedIds);
  const key = unknown.execution!.attempts[0].key;
  assert.equal(key, `${job.id}:revision:1:occurrence:${representedIds[2]}:step:inspect`);

  const recovered = f.restart(); await recovered.recoverInterrupted(owner);
  assert.equal((await recovered.run(owner, job.id)).status, 'outcome-unknown');
  const readback = await recovered.reconcile(owner, job.id);
  assert.equal(readback.execution!.attempts[0].key, key);
  assert.deepEqual(readback.execution!.calendar!.representedIds, representedIds);
  const delivered = await recovered.run(owner, job.id);
  assert.equal(delivered.status, 'awaiting-acceptance');
  const output = delivered.deliverable as { calendar: NonNullable<GoalExecution['calendar']>; result: { synthetic: boolean } };
  assert.equal(output.result.synthetic, true);
  assert.deepEqual(output.calendar, delivered.execution!.calendar);
  assert.deepEqual(output.calendar.representedIds, representedIds);
  assert.equal(output.calendar.occurrenceId, representedIds[2]);
  assert.equal(f.calls.length, 1);
  assert.equal(delivered.spentMinor, '10'); assert.equal(delivered.reservedMinor, '0');

  delivered.execution!.calendar!.representedIds!.push('caller-mutated-view');
  output.calendar.representedIds!.push('caller-mutated-output');
  const reread = f.jobs.list(owner)[0];
  assert.deepEqual(reread.execution!.calendar!.representedIds, representedIds);
  assert.deepEqual((reread.deliverable as typeof output).calendar.representedIds, representedIds);
  await f.jobs.accept(owner, job.id, true);
  assert.deepEqual(f.jobs.list(owner)[0].archivedExecutions![0].calendar!.representedIds, representedIds);
  const next = await recovered.run(owner, job.id);
  const laterId = digest({ jobId: job.id, period: '2024-01-04', fold: 0 });
  assert.deepEqual(next.execution!.calendar!.representedIds, [laterId]);
  assert.equal(f.calls.length, 2);
});

test('prospective coalescing of a retained deferred business period persists its represented identity', async () => {
  const f = setup('2024-01-03T09:00:00.000Z');
  const job = await f.runner.create(owner, { ...f.config, calendar: calendar({ missed: { kind: 'catch-up', maxPerPass: 1, overflow: 'retain' } }) });
  const first = await f.runner.run(owner, job.id);
  const deferred = first.calendar!.records.find(record => record.requestedLocal === '2024-01-03T09:00')!;
  assert.equal(deferred.status, 'deferred'); assert.equal(deferred.representedIds, undefined);
  await f.jobs.accept(owner, job.id, true);
  const revised = calendar({ effectiveFrom: '2024-01-03T09:01:00.000Z',
    recurrence: { kind: 'daily', startDate: '2024-01-01', at: '11:00', everyDays: 1 }, missed: { kind: 'coalesce' } });
  await f.jobs.configureCalendar(owner, job.id, revised, 1, 1, 'replace-immediately');
  f.at('2024-01-03T11:00:00.000Z');
  const delivered = await f.restart().run(owner, job.id);
  const record = delivered.calendar!.records.find(value => value.id === deferred.id)!;
  assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(record.status, 'delivered');
  assert.equal(record.requestedLocal, '2024-01-03T11:00'); assert.equal(record.scheduleRevision, 2);
  assert.deepEqual(record.representedIds, [deferred.id]);
  assert.equal(delivered.execution!.calendar!.occurrenceId, deferred.id);
  assert.deepEqual(delivered.execution!.calendar!.representedIds, [deferred.id]);
  assert.deepEqual((delivered.deliverable as { calendar: NonNullable<GoalExecution['calendar']> }).calendar, delivered.execution!.calendar);
  assert.equal(f.calls[1], `${job.id}:revision:1:occurrence:${deferred.id}:step:inspect`);
});

test('early mandate expiry preserves coalesced unknown exposure and allows its original readback', async () => {
  const f = setup('2024-01-03T09:00:00.000Z');
  const job = await f.runner.create(owner, { ...f.config, calendar: calendar({ missed: { kind: 'coalesce' } }),
    stopRule: { maxRuns: 5, deadline: '2024-01-04T09:00:00.000Z' } });
  f.store.failSettlement = true; const unknown = await f.runner.run(owner, job.id);
  assert.equal(unknown.status, 'outcome-unknown');
  const records = unknown.calendar!.records; const key = unknown.execution!.attempts[0].key;
  const representedIds = unknown.execution!.calendar!.representedIds;
  assert.equal(representedIds!.length, 3);
  f.at('2024-01-05T09:00:00.000Z'); const restart = f.restart(); await restart.recoverInterrupted(owner);
  const waiting = await restart.run(owner, job.id);
  assert.equal(waiting.status, 'outcome-unknown'); assert.equal(waiting.reservedMinor, '10'); assert.equal(waiting.spentMinor, '0');
  assert.deepEqual(waiting.calendar!.records, records);
  const readback = await restart.reconcile(owner, job.id);
  assert.equal(readback.execution!.attempts[0].key, key); assert.equal(readback.reservedMinor, '0'); assert.equal(readback.spentMinor, '10');
  const stopped = await restart.run(owner, job.id);
  assert.equal(stopped.status, 'stopped'); assert.deepEqual(stopped.calendar!.records.slice(0, 3), records);
  assert.deepEqual(stopped.execution!.calendar!.representedIds, representedIds);
  assert.equal(stopped.calendar!.current, records.find(record => record.status === 'admitted')!.id);
  assert.equal(stopped.calendar!.records[3].requestedLocal, '2024-01-04T09:00');
  assert.equal(stopped.calendar!.records[3].status, 'skipped'); assert.equal(stopped.calendar!.records[3].reason, 'mandate-expired');
  assert.equal(stopped.deliverable, undefined); assert.equal(f.calls.length, 1);
});

test('permitted persisted calendar journals do not inherit the job input payload ceiling on repeat admission', async () => {
  const day = 86400000; const start = Date.parse('2024-01-01T00:00:00.000Z'); const until = start + 10000 * day;
  const f = setup(new Date(until - day + 9 * 3600000).toISOString());
  // Explicit fixed-UTC fixture rules keep this 10,000-slot journal test independent of ICU search/cache costs.
  const fixedUtc: CalendarRules = { revision: 'synthetic-fixed-utc-2024-2052', minYear: 2024, maxYear: 2052,
    canonicalZone: zone => { assert.equal(zone, 'UTC'); return zone; },
    localAt: (instant, zone) => { assert.equal(zone, 'UTC'); return new Date(instant).toISOString().slice(0, 16); },
    candidates: (local, zone) => { assert.equal(zone, 'UTC'); return [Date.parse(`${local}:00.000Z`)]; } };
  f.jobs.calendarRules = fixedUtc; f.jobs.calendarBounds = { maxNominalSlots: 10000, maxCalendarDays: 10000 };
  const job = await f.runner.create(owner, { ...f.config,
    calendar: calendar({ rulesRevision: fixedUtc.revision, stop: { until: new Date(until).toISOString(), maxNominalOccurrences: 10000 },
      missed: { kind: 'catch-up', maxPerPass: 1, overflow: 'retain' } }),
    stopRule: { maxRuns: 5, deadline: new Date(until + day).toISOString() } });
  const first = await f.runner.run(owner, job.id);
  assert.equal(first.status, 'awaiting-acceptance'); assert.equal(first.calendar!.records.length, 10000);
  assert.ok(Buffer.byteLength(JSON.stringify(first.calendar)) > 2 * 1024 * 1024);
  await f.jobs.accept(owner, job.id, true);
  const second = await f.restart().run(owner, job.id);
  assert.equal(second.status, 'awaiting-acceptance'); assert.equal(second.calendar!.records.length, 10000);
  assert.equal(second.execution!.scheduledFor, '2024-01-02T09:00:00.000Z');
  assert.equal(second.calendar!.records.filter(record => record.status === 'accepted').length, 1);
  assert.equal(second.calendar!.records.filter(record => record.status === 'delivered').length, 1);
  assert.equal(second.calendar!.records.filter(record => record.status === 'deferred').length, 9998);
  assert.equal(second.spentMinor, '20'); assert.equal(second.reservedMinor, '0'); assert.equal(f.calls.length, 2);
});

test('defer retains missed periods while skip logs only periods due during active acceptance', async () => {
  for (const overlap of ['defer', 'skip'] as const) {
    const f = setup(); const job = await f.runner.create(owner, { ...f.config, calendar: calendar({ overlap }) }); await f.runner.run(owner, job.id); f.at('2024-01-03T09:00:00.000Z'); await f.jobs.accept(owner, job.id, true);
    const next = await f.runner.run(owner, job.id);
    if (overlap === 'defer') { assert.equal(next.execution!.scheduledFor, '2024-01-02T09:00:00.000Z'); assert.equal(f.calls.length, 2); }
    else { assert.equal(next.status, 'scheduled'); assert.equal(next.nextRunAt, '2024-01-04T09:00:00.000Z'); assert.equal(f.calls.length, 1); assert.equal(next.calendar!.records.filter(x => x.reason === 'active-run-overlap').length, 2); }
  }
  const f = setup('2024-01-03T09:00:00.000Z'); const job = await f.runner.create(owner, { ...f.config, calendar: calendar({ overlap: 'skip' }) }); await f.runner.run(owner, job.id); await f.jobs.accept(owner, job.id, true);
  assert.equal((await f.runner.run(owner, job.id)).execution!.scheduledFor, '2024-01-02T09:00:00.000Z');
});

test('prospective schedule revisions retain business tombstones and invalidate exact approval', async () => {
  const f = setup(); const job = await f.runner.create(owner, { ...f.config, requiresApproval: true }); await f.jobs.approve(owner, job.id, job.digest); await f.runner.run(owner, job.id); await f.jobs.accept(owner, job.id, true);
  f.at('2024-01-01T10:00:00.000Z'); const definition = calendar({ effectiveFrom: '2024-01-01T10:00:00.000Z', recurrence: { kind: 'daily', startDate: '2024-01-01', at: '11:00', everyDays: 1 } });
  const revised = await f.jobs.configureCalendar(owner, job.id, definition, 1, 1, 'replace-immediately'); assert.equal(revised.calendar!.revision, 2); assert.equal(revised.approval, undefined); assert.equal(revised.nextRunAt, '2024-01-02T11:00:00.000Z');
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, definition, 1, 1, 'replace-immediately'), { code: 'CALENDAR_REVISION_CHANGED' });
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, calendar(), 2, 1, 'replace-immediately'), { code: 'CALENDAR_RETROACTIVE_REVISION' });
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, { ...definition, identityBasis: 'local-date-time' }, 2, 1, 'replace-immediately'), { code: 'CALENDAR_IDENTITY_CHANGED' });
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, { ...definition, dst: { gap: 'skip', overlap: 'both' } }, 2, 1, 'replace-immediately'), { code: 'CALENDAR_IDENTITY_CHANGED' });
  assert.equal((await f.runner.run(owner, job.id)).status, 'approval-blocked'); f.at('2024-01-02T11:00:00.000Z'); await f.jobs.approve(owner, job.id, revised.digest); assert.equal((await f.runner.run(owner, job.id)).execution!.calendar!.scheduleRevision, 2);
});

test('active schedule edits fail rather than replacing admitted, delivered or uncertain identities', async () => {
  const f = setup(); const job = await f.runner.create(owner, f.config); await f.jobs.acquire(owner, job.id, 'active'); const next = calendar({ effectiveFrom: '2024-01-01T09:00:00.000Z' });
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, next, 1, 1, 'replace-immediately'), { code: 'CALENDAR_NOT_IDLE' }); await f.restart().recoverInterrupted(owner);
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, next, 1, 1, 'replace-immediately'), { code: 'CALENDAR_NOT_IDLE' }); await f.runner.run(owner, job.id);
  await assert.rejects(f.jobs.configureCalendar(owner, job.id, next, 1, 1, 'replace-immediately'), { code: 'CALENDAR_NOT_IDLE' });
});

test('changed objective keeps original readback then requires a newly reviewed schedule binding', async () => {
  const f = setup(); const job = await f.runner.create(owner, f.config); f.store.failSettlement = true; await f.runner.run(owner, job.id); const { calendar: oldDefinition, ...config } = f.config;
  const amended = await f.runner.amend(owner, job.id, { ...config, goal: 'Inspect a changed synthetic objective' }); assert.equal(amended.revision, 2); assert.equal(amended.calendar!.objectiveRevision, 1); assert.equal(amended.reservedMinor, '10');
  await f.runner.reconcile(owner, job.id); assert.equal(f.store.state.jobs[0].execution, undefined); assert.equal(f.store.state.jobs[0].archivedExecutions[0].objectiveRevision, 1);
  await f.jobs.resume(owner, job.id); const blocked = await f.runner.run(owner, job.id); assert.equal(blocked.status, 'runner-blocked'); assert.equal(f.calls.length, 1);
  const revised = await f.jobs.configureCalendar(owner, job.id, { ...oldDefinition, effectiveFrom: '2024-01-01T09:00:00.000Z' }, 1, 2, 'replace-immediately'); assert.equal(revised.calendar!.objectiveRevision, 2); assert.equal(revised.calendar!.records[0].status, 'obsolete');
  f.at('2024-01-02T09:00:00.000Z'); const delivered = await f.runner.run(owner, job.id); assert.equal(delivered.execution!.objectiveRevision, 2); assert.equal(f.calls.length, 2);
  await assert.rejects(f.runner.amend(owner, job.id, f.config), { code: 'CALENDAR_SEPARATE_REVISION' });
});

test('expired calendar or mandate cannot authorize catch-up and spent budget consumes no new occurrence', async () => {
  const expired = setup('2024-01-06T00:00:00.000Z'); const old = await expired.runner.create(owner, expired.config); assert.equal((await expired.runner.run(owner, old.id)).status, 'stopped'); assert.equal(expired.calls.length, 0); assert.equal(expired.store.state.jobs[0].reservedMinor, '0');
  const f = setup(); const job = await f.runner.create(owner, { ...f.config, budgetMinor: '10' }); await f.runner.run(owner, job.id); await f.jobs.accept(owner, job.id, true); f.at('2024-01-02T09:00:00.000Z'); const blocked = await f.runner.run(owner, job.id); assert.equal(blocked.status, 'budget-blocked'); assert.equal(blocked.calendar!.records.length, 1); assert.equal(blocked.calendar!.current, undefined); assert.equal(f.calls.length, 1);
  const deadline = setup(); const mandate = await deadline.runner.create(owner, deadline.config); deadline.at('2024-01-07T00:00:00.000Z'); assert.equal((await deadline.runner.run(owner, mandate.id)).status, 'stopped'); assert.equal(deadline.calls.length, 0);
});

test('calendar cutoff between child contributions blocks new dispatch and still permits readback', async () => {
  const f = setup(); const extended = { ...plan, steps: [plan.steps[0], { ...plan.steps[0], id: 'second' }], obligations: [{ id: 'both', description: 'Both synthetic contributions', requiredStepIds: ['inspect', 'second'] }] };
  const two = { ...goal, plan: () => extended }; const runner = new DurableJobRunner(f.jobs, [two], [f.provider], f.options);
  f.provider.dispatch = async request => { f.calls.push(request.key); const value = settlement(request); f.saved.set(request.key, value); f.at('2024-01-01T09:01:00.000Z'); return value; };
  const job = await runner.create(owner, { ...f.config, reserveMinor: '20', calendar: calendar({ stop: { until: '2024-01-01T09:01:00.000Z', maxNominalOccurrences: 1 } }) });
  const result = await runner.run(owner, job.id); assert.equal(result.status, 'stopped'); assert.equal(f.calls.length, 1); assert.equal(result.spentMinor, '10'); assert.equal(result.reservedMinor, '0');
  const uncertain = setup(); const one = await uncertain.runner.create(owner, { ...uncertain.config, calendar: calendar({ stop: { until: '2024-01-01T09:01:00.000Z', maxNominalOccurrences: 1 } }) }); uncertain.store.failSettlement = true; await uncertain.runner.run(owner, one.id); uncertain.at('2024-01-01T10:00:00.000Z'); const reconciled = await uncertain.runner.reconcile(owner, one.id); assert.equal(reconciled.spentMinor, '10'); assert.equal(reconciled.reservedMinor, '0'); assert.equal((await uncertain.runner.run(owner, one.id)).status, 'stopped'); assert.equal(uncertain.calls.length, 1);
});

test('awake/background host semantics and pause/resume retain calendar catch-up policy', async () => {
  const f = setup(); const job = await f.runner.create(owner, { ...f.config, background: true }); await f.jobs.pauseCalendar(owner, job.id); f.at('2024-01-03T09:00:00.000Z'); assert.deepEqual(await f.runner.tick(owner, { awake: true, windowOpen: false, backgroundEnabled: true }), []);
  await f.jobs.resumeCalendar(owner, job.id); assert.deepEqual(await f.runner.tick(owner, { awake: false, windowOpen: true, backgroundEnabled: true }), []); assert.deepEqual(await f.runner.tick(owner, { awake: true, windowOpen: false, backgroundEnabled: false }), []);
  const result = await f.runner.tick(owner, { awake: true, windowOpen: false, backgroundEnabled: true }); assert.equal(result[0].execution!.scheduledFor, '2024-01-01T09:00:00.000Z'); assert.equal(f.calls.length, 1);
});
