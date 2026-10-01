import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';
import { DurableJobRunner } from '../runtime/job-runner.ts';
import type { GoalProvider, GoalRunner, ProviderRequest } from '../runtime/job-runner.ts';
import type { GoalPlan, ProviderSettlement } from '../runtime/job-protocol.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
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
