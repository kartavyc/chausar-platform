import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';
import { DurableJobRunner } from '../runtime/job-runner.ts';
import type { GoalProvider, GoalRunner, ProviderRequest } from '../runtime/job-runner.ts';
import type { GoalPlan, ProviderSettlement } from '../runtime/job-protocol.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import type { CalendarRules } from '../runtime/calendar-zone.ts';
import type { CalendarBounds, CalendarDefinition } from '../runtime/calendar.ts';

class ReviewStore implements StateStore {
  state = initialState('Synthetic calendar review', true);
  private queue = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const snapshot = this.read(); const value = await change(snapshot); this.state = snapshot; return value;
    });
    this.queue = operation.then(() => {}, () => {}); return operation;
  }
}

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const rules = new IntlCalendarRules({ timeZones: ['UTC', 'America/New_York'], minYear: 2024, maxYear: 2026, maxCachedLocalTimes: 128 });
const bounds: CalendarBounds = { maxNominalSlots: 20, maxCalendarDays: 400 };
function definition(patch: Partial<CalendarDefinition> = {}): CalendarDefinition {
  return {
    version: 1, basis: 'calendar', timeZone: 'UTC', rulesRevision: rules.revision, effectiveFrom: '2024-01-01T00:00:00.000Z',
    recurrence: { kind: 'daily', startDate: '2024-01-01', at: '09:00', everyDays: 1 }, dst: { gap: 'reject', overlap: 'reject' },
    excludedResolvedDates: [], holidays: { kind: 'include' }, missed: { kind: 'catch-up', maxPerPass: 2, overflow: 'retain' },
    overlap: 'defer', identityBasis: 'local-date', stop: { until: '2024-01-06T00:00:00.000Z', maxNominalOccurrences: 5 },
    revisionPolicy: 'idle-only', ...patch,
  };
}
const plan: GoalPlan = {
  runnerVersion: 'review-1', steps: [{ id: 'review', provider: 'synthetic-review', input: { synthetic: true }, reserveMinor: '10', modelUnits: 0,
    durationMs: 1000, actionExposureMinor: '0', modelRequired: false, dependencies: [] }], children: [],
  obligations: [{ id: 'review', description: 'Produce the requested synthetic proof.', requiredStepIds: ['review'] }],
};
const goal: GoalRunner = {
  type: 'calendar-review', version: 'review-1', validate: value => value, plan: () => structuredClone(plan),
  deliver: () => ({ synthetic: true }), release: () => true,
};
function result(request: ProviderRequest): ProviderSettlement {
  return { result: { value: request.step.input, informationClass: 'computation', evidenceIds: ['synthetic-proof'], sourceTainted: false },
    spentMinor: '10', modelUnits: 0, durationMs: 1, actionExposureMinor: '0' };
}
function fixture() {
  const store = new ReviewStore(); store.state.policy.autonomy = true; let instant = Date.parse('2024-01-01T08:00:00.000Z');
  const calls: string[] = [];
  const provider: GoalProvider = { id: 'synthetic-review', kind: 'read-only', transport: 'local', model: false,
    dispatch: async request => { calls.push(request.key); return result(request); }, reconcile: async () => ({ outcome: 'unknown' }) };
  const options = { workerId: 'synthetic-calendar-review', maxActiveJobs: 10, leaseMs: 1000, networkAvailable: () => true };
  const ports = { calendarRules: rules, calendarBounds: bounds };
  const jobs = new JobService(store, { clock: () => instant, deliverableGuard: () => true, ...ports });
  const runner = new DurableJobRunner(jobs, [goal], [provider], options);
  const config = { type: goal.type, goal: 'Produce an explicitly scheduled synthetic proof.', input: {}, budgetMinor: '50', reserveMinor: '10',
    limits: { modelUnits: 0, durationMs: 5000, actionExposureMinor: '0' }, stopRule: { maxRuns: 5, deadline: '2024-01-07T00:00:00.000Z' },
    calendar: definition() };
  const restart = (replacement: { calendarRules?: CalendarRules; calendarBounds?: CalendarBounds } = ports) => {
    const service = new JobService(store, { clock: () => instant, deliverableGuard: () => true, ...replacement });
    return new DurableJobRunner(service, [goal], [provider], options);
  };
  return { store, jobs, runner, config, calls, restart, at: (value: string) => { instant = Date.parse(value); } };
}
function assertBlocked(f: ReturnType<typeof fixture>, code: string) {
  const saved = f.store.state.jobs[0]; assert.equal(saved.status, 'runner-blocked');
  assert.ok(saved.ledger.some((entry: { event: string; reason?: string }) => entry.event === 'blocked' && entry.reason === code));
  assert.equal(saved.calendar.records.length, 0); assert.equal(saved.calendar.current, undefined);
  assert.equal(saved.reservedMinor, '0'); assert.equal(saved.spentMinor, '0'); assert.equal(saved.runs, 0);
  assert.equal(saved.lease, undefined); assert.equal(saved.execution, undefined); assert.equal(f.calls.length, 0);
}

test('calendar review: restart with changed rules pins a visible block before any claim or reservation', async () => {
  const f = fixture(); const job = await f.runner.create(owner, f.config); f.at('2024-01-01T09:00:00.000Z');
  const changed: CalendarRules = { revision: `${rules.revision}:synthetic-changed`, minYear: rules.minYear, maxYear: rules.maxYear,
    canonicalZone: zone => rules.canonicalZone(zone), localAt: (instant, zone) => rules.localAt(instant, zone), candidates: (local, zone) => rules.candidates(local, zone) };
  const restart = f.restart({ calendarRules: changed, calendarBounds: bounds }); await restart.recoverInterrupted(owner);
  assert.equal((await restart.run(owner, job.id)).status, 'runner-blocked'); assertBlocked(f, 'CALENDAR_RULES_CHANGED');
});

test('calendar review: a missing installed zone becomes a visible qualification block after restart', async () => {
  const f = fixture(); const job = await f.runner.create(owner, { ...f.config, calendar: definition({ timeZone: 'America/New_York', effectiveFrom: '2024-01-01T05:00:00.000Z' }) });
  f.at('2024-01-01T14:00:00.000Z');
  const utcOnly = new IntlCalendarRules({ timeZones: ['UTC'], minYear: 2024, maxYear: 2026, maxCachedLocalTimes: 128 });
  await f.restart({ calendarRules: utcOnly, calendarBounds: bounds }).run(owner, job.id); assertBlocked(f, 'CALENDAR_ZONE_UNSUPPORTED');
});

test('calendar review: missing or reduced evaluation bounds block visibly without consuming an occurrence', async () => {
  for (const replacement of [
    { calendarRules: rules, expected: 'CALENDAR_RULES_REQUIRED' },
    { calendarRules: rules, calendarBounds: { maxNominalSlots: 20, maxCalendarDays: 2 }, expected: 'CALENDAR_EVALUATION_LIMIT' },
  ]) {
    const f = fixture(); const job = await f.runner.create(owner, f.config); f.at('2024-01-01T09:00:00.000Z');
    const { expected, ...ports } = replacement; await f.restart(ports).run(owner, job.id); assertBlocked(f, expected);
  }
});

test('calendar review: an explicit malformed calendar cannot select the legacy interval defaults', async () => {
  for (const calendar of [null, false, 0]) {
    const f = fixture();
    await assert.rejects(f.runner.create(owner, { ...f.config, calendar } as any), { code: 'INVALID_CALENDAR' });
    assert.equal(f.store.state.jobs.length, 0); assert.equal(f.calls.length, 0);
  }
});

test('calendar review: future once holidays and exclusions remain scheduled until their skipped audit is due', async () => {
  for (const reason of ['holiday', 'excluded'] as const) {
    const f = fixture(); const due = '2024-01-03T09:00:00.000Z';
    const calendar = definition({ recurrence: { kind: 'once', atLocal: '2024-01-03T09:00' },
      stop: { until: '2024-01-04T00:00:00.000Z', maxNominalOccurrences: 1 },
      excludedResolvedDates: reason === 'excluded' ? ['2024-01-03'] : [],
      holidays: reason === 'holiday' ? { kind: 'skip', calendarId: 'synthetic-calendar', revision: '1', dates: ['2024-01-03'],
        coverage: { from: '2024-01-01', to: '2024-01-04' }, basis: 'resolved-local-date' } : { kind: 'include' } });
    const job = await f.runner.create(owner, { ...f.config, calendar }); assert.equal(job.nextRunAt, due);
    const before = await f.runner.run(owner, job.id); assert.equal(before.status, 'scheduled'); assert.equal(before.nextRunAt, due);
    assert.equal(before.calendar!.records.length, 0); assert.equal(f.calls.length, 0);
    f.at(due); const skipped = await f.restart().run(owner, job.id);
    assert.equal(skipped.status, 'stopped'); assert.equal(skipped.calendar!.records.length, 1);
    assert.equal(skipped.calendar!.records[0].status, 'skipped'); assert.equal(skipped.calendar!.records[0].reason, reason);
    assert.equal(skipped.calendar!.records[0].instant, due); assert.equal(skipped.reservedMinor, '0'); assert.equal(f.calls.length, 0);
  }
});

test('calendar review: expiry records skipped periods while authorizing no catch-up dispatch', async () => {
  for (const current of ['2024-01-06T00:00:00.000Z', '2027-01-01T00:00:00.000Z']) {
    const f = fixture(); const job = await f.runner.create(owner, { ...f.config, stopRule: { maxRuns: 5, deadline: '2028-01-01T00:00:00.000Z' } });
    f.at(current); const stopped = await f.restart().run(owner, job.id);
    assert.equal(stopped.status, 'stopped'); assert.equal(stopped.calendar!.records.length, 5);
    assert.ok(stopped.calendar!.records.every(record => record.status === 'skipped' && record.reason === 'schedule-expired'));
    assert.equal(stopped.calendar!.current, undefined); assert.equal(stopped.reservedMinor, '0'); assert.equal(stopped.spentMinor, '0');
    assert.equal(stopped.lease, undefined); assert.equal(stopped.execution, undefined); assert.equal(f.calls.length, 0);
  }
});

test('calendar review: clock crossing either cutoff during rules evaluation stops before admission or reservation', async () => {
  for (const cutoff of ['mandate', 'calendar'] as const) {
    const f = fixture();
    const until = cutoff === 'calendar' ? '2024-01-01T09:01:00.000Z' : '2024-01-01T09:02:00.000Z';
    const deadline = cutoff === 'mandate' ? '2024-01-01T09:01:00.000Z' : '2024-01-01T09:02:00.000Z';
    const job = await f.runner.create(owner, { ...f.config, stopRule: { maxRuns: 5, deadline },
      calendar: definition({ stop: { until, maxNominalOccurrences: 1 } }) });
    f.at('2024-01-01T09:00:00.000Z');
    let advanced = false;
    f.jobs.calendarRules = { revision: rules.revision, minYear: rules.minYear, maxYear: rules.maxYear,
      canonicalZone: zone => rules.canonicalZone(zone), localAt: (instant, zone) => rules.localAt(instant, zone),
      candidates: (local, zone) => {
        const result = rules.candidates(local, zone);
        if (!advanced) { advanced = true; f.at(cutoff === 'mandate' ? deadline : until); }
        return result;
      } };
    const stopped = await f.jobs.acquire(owner, job.id, 'synthetic-slow-calendar-rules');
    assert.equal(advanced, true); assert.equal(stopped.status, 'stopped');
    assert.ok(stopped.ledger.some(entry => entry.event === (cutoff === 'mandate' ? 'stop-rule' : 'calendar-expired')));
    assert.equal(stopped.calendar!.records.length, 1);
    assert.equal(stopped.calendar!.records[0].status, 'skipped');
    assert.equal(stopped.calendar!.records[0].reason, cutoff === 'mandate' ? 'mandate-expired' : 'schedule-expired');
    assert.equal(stopped.calendar!.current, undefined);
    assert.equal(stopped.fence, 0); assert.equal(stopped.lease, undefined); assert.equal(stopped.execution, undefined);
    assert.equal(stopped.reservedMinor, '0'); assert.equal(stopped.spentMinor, '0'); assert.equal(stopped.runs, 0);
    assert.ok(stopped.ledger.every(entry => !['reserved', 'calendar-admitted'].includes(entry.event)));
    assert.equal(f.calls.length, 0);
  }
});

test('calendar review: elapsed mandate also rechecks its deadline after identity validation', async () => {
  const f = fixture(); const { calendar: unused, ...config } = f.config;
  const job = await f.runner.create(owner, { ...config, stopRule: { maxRuns: 5, deadline: '2024-01-01T09:01:00.000Z' },
    nextRunAt: '2024-01-01T09:00:00.000Z', intervalMs: 86400000, catchup: 'latest', graceMs: 60000 });
  f.at('2024-01-01T09:00:00.000Z');
  const identity = f.jobs.identity.bind(f.jobs);
  f.jobs.identity = value => { const result = identity(value); f.at('2024-01-01T09:01:00.000Z'); return result; };
  const stopped = await f.jobs.acquire(owner, job.id, 'synthetic-slow-identity');
  assert.equal(stopped.status, 'stopped'); assert.ok(stopped.ledger.some(entry => entry.event === 'stop-rule'));
  assert.equal(stopped.calendar, undefined); assert.equal(stopped.fence, 0); assert.equal(stopped.lease, undefined);
  assert.equal(stopped.reservedMinor, '0'); assert.equal(stopped.spentMinor, '0'); assert.equal(stopped.runs, 0);
  assert.ok(stopped.ledger.every(entry => entry.event !== 'reserved')); assert.equal(f.calls.length, 0);
});

test('calendar review: cutoff during decision preparation applies only a stopped audit and no candidate claim', async () => {
  for (const cutoff of ['mandate', 'calendar'] as const) {
    const f = fixture(); const expiry = '2024-01-03T09:01:00.000Z';
    const job = await f.runner.create(owner, { ...f.config,
      stopRule: { maxRuns: 5, deadline: cutoff === 'mandate' ? expiry : '2024-01-07T00:00:00.000Z' },
      calendar: definition({ missed: { kind: 'coalesce' },
        stop: { until: cutoff === 'calendar' ? expiry : '2024-01-06T00:00:00.000Z', maxNominalOccurrences: 5 } }) });
    f.at('2024-01-03T09:00:00.000Z');
    const evaluate = f.jobs.calendarEvaluation.bind(f.jobs); const timestamp = f.jobs.timestamp.bind(f.jobs);
    let firstEvaluation = true; let pendingAuditWrite = false; let advanced = false;
    f.jobs.calendarEvaluation = (value, at) => {
      const result = evaluate(value, at);
      if (firstEvaluation) { firstEvaluation = false; pendingAuditWrite = true; }
      return result;
    };
    f.jobs.timestamp = () => {
      if (pendingAuditWrite) { pendingAuditWrite = false; advanced = true; f.at(expiry); }
      return timestamp();
    };
    const stopped = await f.jobs.acquire(owner, job.id, 'synthetic-slow-audit-preparation');
    assert.equal(advanced, true); assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.calendar!.records.length, 3);
    assert.ok(stopped.calendar!.records.every(record => record.status === 'skipped' && record.reason === `${cutoff === 'mandate' ? 'mandate' : 'schedule'}-expired`));
    assert.equal(stopped.calendar!.current, undefined); assert.equal(stopped.fence, 0); assert.equal(stopped.lease, undefined);
    assert.equal(stopped.execution, undefined); assert.equal(stopped.reservedMinor, '0'); assert.equal(stopped.spentMinor, '0');
    assert.ok(stopped.ledger.every(entry => !['reserved', 'calendar-admitted'].includes(entry.event))); assert.equal(f.calls.length, 0);
  }
});

test('calendar review: early mandate expiry skips unclaimed coalesce and retained intent only within its cutoff', async () => {
  const policies: CalendarDefinition['missed'][] = [{ kind: 'coalesce' }, { kind: 'catch-up', maxPerPass: 1, overflow: 'retain' }];
  for (const missed of policies) {
    const f = fixture();
    const job = await f.runner.create(owner, { ...f.config, calendar: definition({ missed }),
      stopRule: { maxRuns: 5, deadline: '2024-01-03T09:00:00.000Z' } });
    f.at('2024-01-01T09:00:00.000Z'); await f.runner.run(owner, job.id); await f.jobs.accept(owner, job.id, true);
    const historical = f.jobs.list(owner)[0].calendar!.records[0];
    assert.equal(historical.status, 'accepted');
    f.at('2024-01-05T09:00:00.000Z');
    const stopped = await f.jobs.acquire(owner, job.id, 'synthetic-late-wake');
    assert.equal(stopped.status, 'stopped');
    assert.deepEqual(stopped.calendar!.records[0], historical);
    assert.deepEqual(stopped.calendar!.records.slice(1).map(record => ({ local: record.requestedLocal, status: record.status, reason: record.reason })).sort((a, b) => a.local.localeCompare(b.local)), [
      { local: '2024-01-02T09:00', status: 'skipped', reason: 'mandate-expired' },
      { local: '2024-01-03T09:00', status: 'skipped', reason: 'mandate-expired' },
    ]);
    assert.equal(stopped.calendar!.current, undefined);
    assert.equal(stopped.lease, undefined); assert.equal(stopped.reservedMinor, '0'); assert.equal(stopped.spentMinor, '10');
    assert.equal(stopped.runs, 1); assert.equal(f.calls.length, 1);
  }
});

test('calendar review: immediate replacement requires explicit policy and preserves the retired rule across a blackout', async () => {
  const f = fixture(); const job = await f.runner.create(owner, f.config);
  const next = definition({ effectiveFrom: '2024-01-04T00:00:00.000Z', recurrence: { kind: 'daily', startDate: '2024-01-04', at: '10:00', everyDays: 1 },
    stop: { until: '2024-01-06T00:00:00.000Z', maxNominalOccurrences: 2 } });
  await assert.rejects(() => Reflect.apply(f.jobs.configureCalendar, f.jobs, [owner, job.id, next, 1, 1]), { code: 'CALENDAR_REVISION_POLICY_REQUIRED' });
  assert.equal(f.store.state.jobs[0].calendar.revision, 1);
  const revised = await f.jobs.configureCalendar(owner, job.id, next, 1, 1, 'replace-immediately');
  assert.equal(revised.calendar!.revision, 2); assert.equal(revised.nextRunAt, '2024-01-04T10:00:00.000Z');
  assert.equal(revised.calendar!.retiredDefinitions.length, 1);
  assert.deepEqual(revised.calendar!.retiredDefinitions[0], { definition: job.calendar!.definition, revision: 1, objectiveRevision: 1, replacedAt: '2024-01-01T08:00:00.000Z' });
  assert.ok(revised.ledger.some(entry => entry.event === 'calendar-revised' && entry.reason?.includes('replace-immediately') && entry.reason.includes(next.effectiveFrom)));
  f.at('2024-01-02T09:00:00.000Z'); const blackout = await f.restart().run(owner, job.id);
  assert.equal(blackout.status, 'scheduled'); assert.equal(blackout.calendar!.records.length, 0); assert.equal(f.calls.length, 0);
  assert.equal(blackout.nextRunAt, '2024-01-04T10:00:00.000Z');
  f.at('2024-01-04T10:00:00.000Z'); const delivered = await f.restart().run(owner, job.id);
  assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.execution!.calendar!.scheduleRevision, 2); assert.equal(f.calls.length, 1);
});
