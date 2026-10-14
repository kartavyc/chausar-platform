import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import { Engine } from '../runtime/engine.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods } from '../runtime/work-books/work.ts';
import { monthEndDefinition, indiaDate } from '../runtime/work-books/work-jobs-calendar.ts';

// Every value here is synthetic. Other lanes (jobsx.*, session.*) are stubbed through
// `hasMethod` and the host dispatcher, never read from the real registry.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic jobs-ext shop', true); }
  read() { return this.state; }
  private tail: Promise<unknown> = Promise.resolve();
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; });
    this.tail = run.catch(() => undefined); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
type Handler = (payload: any, ctx: Context) => unknown;

function fixture(handlers: Record<string, Handler> = {}, calculatorReceipt?: (ctx: Context, id: string) => unknown) {
  const store = new TestStore();
  store.state.members.push({ id: 'viewer', name: 'Vee Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }, { id: 'accountant', name: 'Asha Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  const actions = new ActionService(store, []); const jobs = new JobService(store);
  const calculator = { receipt: (ctx: Context, id: string) => { if (!calculatorReceipt) throw new ChausarError('RECEIPT_NOT_FOUND', 'No.'); return calculatorReceipt(ctx, id); }, catalog: () => [] };
  const calls: { method: string; payload: any }[] = [];
  const host = (ctx: Context): ModuleHost => ({
    store, services: { actions, jobs, calculator }, demo: true, directory: '/tmp/x', options: { hasMethod: (name: string) => Object.hasOwn(handlers, name) },
    async call(method, payload) {
      calls.push({ method, payload });
      if (Object.hasOwn(handlers, method)) return handlers[method](payload, ctx);
      if (method === 'jobs.create') return jobs.create(ctx, payload as any);
      if (method === 'jobs.cancel') return jobs.cancel(ctx, payload.id as string);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    },
  });
  const request = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = workMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  const brief = async () => (await request(owner, 'approvals.proposeJob', { templateId: 'daily-brief' })).id.slice(4) as string;
  return { store, calls, request, brief };
}

test('WK-16: a step for a person leads the time line, says who, and only jobs-ext marks it done', async () => {
  const marked = new Set<string>();
  const view = () => ({ steps: [
    { id: 'file-gst', kind: 'person', what: 'File the GST return on the portal.', who: { memberId: 'owner' }, done: marked.has('file-gst'), doneAt: marked.has('file-gst') ? '2026-10-14T10:00:00.000Z' : null, doneBy: marked.has('file-gst') ? 'Owner' : null },
    { id: 'call-customer', kind: 'person', what: 'Call the customer about the late invoice.', who: { memberId: 'accountant', name: 'Asha Accountant' }, done: false },
    { id: 'not-a-person', kind: 'model', what: 'Ignored.' },
  ] });
  const f = fixture({ 'jobsx.get': view, 'jobsx.personStep.done': p => { marked.add(p.stepId); return { ok: true }; } });
  const id = await f.brief();
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual(sheet.timeline.slice(0, 2).map((s: any) => [s.kind, s.stepId, s.who.kind, s.who.memberId, s.done, s.canDone]), [
    ['person', 'file-gst', 'you', 'owner', false, true],
    ['person', 'call-customer', 'person', 'accountant', false, true],
  ]);
  assert.equal(sheet.timeline[1].who.name, 'Asha Accountant');
  assert.equal(sheet.timeline[0].event, 'person-step'); assert.equal(sheet.timeline[0].needsModel, false);
  assert.equal(sheet.timeline.some((s: any) => s.stepId === 'not-a-person'), false);
  assert.equal(sheet.manage.personStep, 'jobsx');
  // The core shows an accountant no job of the owner's, so it cannot mark the owner's step.
  await assert.rejects(f.request(accountant, 'approvals.personStepDone', { jobId: id, stepId: 'file-gst' }), code('NOT_FOUND'));
  await assert.rejects(f.request(viewer, 'approvals.personStepDone', { jobId: id, stepId: 'file-gst' }), code('FORBIDDEN'));
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'nope' }), code('NOT_FOUND'));
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'file-gst', extra: 1 }), code('INVALID_JOB_CHANGE'));
  assert.deepEqual(await f.request(owner, 'approvals.personStepDone', { jobId: `job:${id}`, stepId: 'file-gst' }), { jobId: id, stepId: 'file-gst', done: true });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.personStep.done').map(c => c.payload), [{ jobId: id, stepId: 'file-gst' }]);
  const after = await f.request(owner, 'approvals.job', { id });
  const done = after.timeline.find((s: any) => s.stepId === 'file-gst');
  assert.equal(done.done, true); assert.equal(done.canDone, false); assert.equal(after.timeline.at(-1).stepId, 'file-gst');
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'file-gst' }), code('PERSON_STEP_ALREADY_DONE'));
  // The core shows a viewer no job of the owner's at all.
  await assert.rejects(f.request(viewer, 'approvals.job', { id }), code('NOT_FOUND'));
});

test('WK-16: without jobs-ext a plan step for a person waits and is never marked done by itself', async () => {
  const f = fixture();
  const id = await f.brief();
  await f.store.update(state => {
    const job = state.jobs.find((j: any) => j.id === id);
    job.plan = { runnerVersion: '1', steps: [{ id: 'sign', provider: 'person', input: { what: 'Sign the bank form.', memberId: 'owner' } }], children: [], obligations: [] };
  });
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual([sheet.timeline[0].stepId, sheet.timeline[0].done, sheet.timeline[0].who.kind], ['sign', false, 'you']);
  assert.equal(sheet.manage.personStep, 'not-built');
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'sign' }), code('PERSON_STEP_NOT_BUILT'));
  assert.equal((await f.request(owner, 'approvals.job', { id })).timeline[0].done, false);
  // A ledger record of the step being done (written by the owning lane) is read as done.
  await f.store.update(state => { state.jobs.find((j: any) => j.id === id).ledger.push({ at: '2026-10-14T11:00:00.000Z', event: 'person-step-done', stepId: 'sign', by: 'Owner' }); });
  const done = (await f.request(owner, 'approvals.job', { id })).timeline.find((s: any) => s.stepId === 'sign');
  assert.deepEqual([done.done, done.doneAt, done.doneBy], [true, '2026-10-14T11:00:00.000Z', 'Owner']);
});

test('WK-08: the measure is the calculation receipts the job names; an unreadable one is a gap; none means null', async () => {
  const receipt = (id: string, asOf: string, valueMinor: string, operation = 'aging') => ({ id, memberId: 'owner', epoch: 1, operation, asOf, valueMinor, figures: [{ key: 'total', label: 'Receivable aging', minor: valueMinor, display: '', unit: 'money' }] });
  const readable: Record<string, any> = { r1: receipt('r1', '2026-08-31T12:30:00.000Z', '120000'), r3: receipt('r3', '2026-09-30T12:30:00.000Z', '90000'), other: receipt('other', '2026-09-30T12:30:00.000Z', '7', 'billed') };
  const f = fixture({}, (_ctx, id) => { if (!readable[id]) throw new ChausarError('RECEIPT_FORBIDDEN', 'No.'); return structuredClone(readable[id]); });
  const id = await f.brief();
  assert.equal((await f.request(owner, 'approvals.job', { id })).measure, null);
  await f.store.update(state => {
    state.receipts.push(...Object.values(readable) as any[], { id: 'r2', memberId: 'someone-else' } as any);
    const job = state.jobs.find((j: any) => j.id === id);
    job.archivedExecutions = [{ scheduledFor: '2026-08-31T12:30:00.000Z', attempts: [{ settlement: { result: { evidenceIds: ['r1', 'not-a-receipt'] } } }] },
      { scheduledFor: '2026-09-15T12:30:00.000Z', attempts: [{ settlement: { result: { evidenceIds: ['r2'] } } }] }];
    job.deliverable = { scheduledFor: '2026-09-30T12:30:00.000Z', result: { calculations: [{ id: 'owed', value: { receiptId: 'r3' } }, { id: 'billed', value: { receiptId: 'other' } }] } };
    job.input = { measure: { goalMinor: '50000' } };
  });
  const m = (await f.request(owner, 'approvals.job', { id })).measure;
  assert.equal(m.name, 'Receivable aging'); assert.deepEqual(m.goal, { minor: '50000' }); assert.equal(m.goalReceiptId, null);
  assert.deepEqual(m.points, [
    { at: '2026-08-31T12:30:00.000Z', value: { minor: '120000' }, receiptId: 'r1' },
    { at: '2026-09-15T12:30:00.000Z', value: { missing: 'withheld' }, receiptId: 'r2' },
    { at: '2026-09-30T12:30:00.000Z', value: { minor: '90000' }, receiptId: 'r3' },
  ]);
});

test('WK-08: a goal declared by jobs-ext with its receipt is used; without one the goal is absent', async () => {
  const f = fixture({ 'jobsx.get': () => ({ measure: { name: 'What customers owe', goal: { minor: '40000' }, goalReceiptId: 'goal-r', operation: 'aging', receiptIds: ['r1'] } }) },
    () => ({ id: 'r1', operation: 'aging', asOf: '2026-08-31T12:30:00.000Z', valueMinor: '1', figures: [] }));
  const id = await f.brief();
  await f.store.update(state => { state.receipts.push({ id: 'r1' } as any); });
  const m = (await f.request(owner, 'approvals.job', { id })).measure;
  assert.deepEqual([m.name, m.goal, m.goalReceiptId, m.points.length], ['What customers owe', { minor: '40000' }, 'goal-r', 1]);
  const g = fixture({}, () => ({ id: 'r1', operation: 'aging', asOf: '2026-08-31T12:30:00.000Z', valueMinor: '1', figures: [] }));
  const id2 = await g.brief();
  await g.store.update(state => { state.receipts.push({ id: 'r1' } as any); state.jobs[0].ledger.push({ at: '2026-08-31T12:30:00.000Z', event: 'note', receiptId: 'r1' } as any); });
  assert.deepEqual((await g.request(owner, 'approvals.job', { id: id2 })).measure.goal, { missing: 'absent' });
});

test('Edit, Delete and the missed-run rule go to jobs-ext when installed', async () => {
  const f = fixture({ 'jobsx.edit': () => ({ ok: true }), 'jobsx.delete': () => ({ ok: true }) });
  const id = await f.brief();
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual(sheet.manage, { edit: 'jobsx', delete: 'jobsx', missedRule: 'jobsx', personStep: 'not-built' });
  assert.deepEqual(await f.request(owner, 'approvals.editJob', { id, config: { budgetMinor: '7000', maxRuns: 5, missedRun: 'skip' } }), { id: `job:${id}`, via: 'jobsx' });
  assert.deepEqual(await f.request(owner, 'approvals.setMissedRule', { id, rule: 'run-once-on-wake' }), { id: `job:${id}`, missedRun: 'run-once-on-wake', via: 'jobsx' });
  assert.deepEqual(await f.request(owner, 'approvals.deleteJob', { id }), { id, state: 'deleted', note: null });
  assert.deepEqual(f.calls.filter(c => c.method.startsWith('jobsx.') && c.method !== 'jobsx.get').map(c => [c.method, c.payload]), [
    ['jobsx.edit', { id, config: { budgetMinor: '7000', maxRuns: 5, missedRun: 'skip' } }],
    ['jobsx.edit', { id, config: { missedRun: 'run-once-on-wake' } }],
    ['jobsx.delete', { id }],
  ]);
  for (const config of [{}, { budgetMinor: '0' }, { maxRuns: 0 }, { missedRun: 'run-all' }, { goal: 'x' }])
    await assert.rejects(f.request(owner, 'approvals.editJob', { id, config }), (e: any) => ['INVALID_JOB_CHANGE', 'INVALID_BUDGET', 'STOP_RULE_REQUIRED', 'INVALID_SCHEDULE'].includes(e.code));
  await assert.rejects(f.request(accountant, 'approvals.editJob', { id, config: { maxRuns: 2 } }), code('FORBIDDEN'));
  await assert.rejects(f.request(owner, 'approvals.deleteJob', { id: 'job_missing' }), code('NOT_FOUND'));
});

test('without jobs-ext a read-only brief cannot be edited, and Delete cancels it and keeps its record', async () => {
  const f = fixture();
  const id = await f.brief();
  assert.deepEqual((await f.request(owner, 'approvals.job', { id })).manage, { edit: 'not-built', delete: 'cancel', missedRule: 'not-built', personStep: 'not-built' });
  await assert.rejects(f.request(owner, 'approvals.editJob', { id, config: { maxRuns: 3 } }), code('JOB_EDIT_NOT_BUILT'));
  await assert.rejects(f.request(owner, 'approvals.setMissedRule', { id, rule: 'skip' }), code('MISSED_RULE_NOT_BUILT'));
  assert.deepEqual(await f.request(owner, 'approvals.deleteJob', { id: `job:${id}` }), { id, state: 'cancelled', note: 'cancel-keeps-record' });
  assert.equal(f.store.read().jobs.find((j: any) => j.id === id)?.status, 'cancelled');
  await assert.rejects(f.request(owner, 'approvals.deleteJob', { id }), code('INVALID_JOB_STATE'));
  await assert.rejects(f.request(owner, 'approvals.editJob', { id, config: { maxRuns: 3 } }), code('INVALID_JOB_STATE'));
});

test('WK-14: driving answers not built without session.*, and passes a checked session through when it is installed', async () => {
  const none = fixture();
  assert.deepEqual(await none.request(viewer, 'approvals.drivingStatus'), { available: false, rules: { windows: 1, mode: 'read-export', typesSecrets: false } });
  assert.equal((await none.request(owner, 'approvals.drivingStart', { windowId: 'w1' })).available, false);
  assert.equal((await none.request(owner, 'approvals.drivingStop')).available, false);
  await assert.rejects(none.request(owner, 'approvals.drivingStart', {}), code('INVALID_DRIVING_REQUEST'));
  await assert.rejects(none.request(accountant, 'approvals.drivingStart', { windowId: 'w1' }), code('FORBIDDEN'));

  let state: any = { state: 'idle', window: null, steps: [] };
  const f = fixture({
    'session.status': () => state, 'session.windows': () => ({ windows: [{ id: 'w1', title: 'Tally Prime', app: 'tally' }] }),
    'session.start': p => (state = { state: 'driving', window: { id: p.windowId, title: 'Tally Prime' }, steps: [{ at: '2026-10-14T10:00:00.000Z', text: 'Open the day book', state: 'done' }] }),
    'session.resume': () => (state = { ...state, state: 'driving' }), 'session.stop': () => (state = { ...state, state: 'stopped' }),
  });
  const status = await f.request(owner, 'approvals.drivingStatus');
  assert.deepEqual([status.available, status.status.state, status.windows], [true, 'idle', [{ id: 'w1', title: 'Tally Prime', app: 'tally' }]]);
  const started = await f.request(owner, 'approvals.drivingStart', { windowId: 'w1' });
  assert.deepEqual([started.status.state, started.status.window, started.status.steps.length], ['driving', { id: 'w1', title: 'Tally Prime' }, 1]);
  assert.deepEqual(f.calls.find(c => c.method === 'session.start')!.payload, { windowId: 'w1', mode: 'read-export', typesSecrets: false });
  state = { ...state, state: 'paused-by-you' };
  assert.equal((await f.request(owner, 'approvals.drivingContinue')).status.state, 'driving');
  assert.equal((await f.request(accountant, 'approvals.drivingStop')).status.state, 'stopped');
  const bad = fixture({ 'session.status': () => ({ state: 'typing-password', steps: [] }), 'session.start': () => ({ state: 'driving', window: { id: 'other', title: 'Bank' }, steps: [] }) });
  await assert.rejects(bad.request(owner, 'approvals.drivingStatus'), code('INVALID_SESSION_REPLY'));
  await assert.rejects(bad.request(owner, 'approvals.drivingStart', { windowId: 'w1' }), code('SESSION_WINDOW_CHANGED'));
});

test('the month-end calendar is the last day of each month at 18:00 India time', () => {
  const at = Date.parse('2026-10-14T05:00:00.000Z');
  const d = monthEndDefinition({ rulesRevision: 'rules-1' }, at, at + 366 * 86_400_000, 12, 'skip');
  assert.deepEqual(d.recurrence, { kind: 'monthly', startDate: '2026-10-14', at: '18:00', dayOfMonth: 31, everyMonths: 1, missingDate: 'last-day' });
  assert.equal(d.timeZone, 'Asia/Kolkata'); assert.equal(d.identityBasis, 'local-month'); assert.equal(d.stop.maxNominalOccurrences, 12);
  assert.equal(d.effectiveFrom, '2026-10-14T05:01:00.000Z'); assert.deepEqual(d.missed, { kind: 'skip', graceMs: 6 * 3_600_000 });
  assert.deepEqual(monthEndDefinition({ rulesRevision: 'r' }, at, at + 86_400_000 * 30, 1, 'run-once-on-wake').missed, { kind: 'coalesce' });
  assert.equal(indiaDate(Date.parse('2026-10-31T19:00:00.000Z')), '2026-11-01');
});

const csv = 'id,kind,date,amount,currency,branch\nsyn-inv-1,invoice,2026-09-02,1234.50,INR,main\n';
const recipe = { version: 1, id: 'synthetic-month-end-csv-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Month End', branches: ['main'] },
  bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }],
  allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' };

async function realEngine(t: any, calendar: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-books-month-end-'));
  const rules = new IntlCalendarRules({ timeZones: ['Asia/Kolkata'], minYear: 2026, maxYear: 2040, maxCachedLocalTimes: 64 });
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'work-books': { hasMethod: () => false } },
    durableJobs: { workerId: 'synthetic-month-end', maxActiveJobs: 4, leaseMs: 1000, networkAvailable: () => false, clock: () => Date.now() },
    ...(calendar ? { jobCalendar: { rules, bounds: { maxNominalSlots: 24, maxCalendarDays: 800 } } } : {}) });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Month End', passphrase: 'Synthetic month-end passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  await engine.request('sources.import', { sourceId: 'synthetic-month-end', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 1, amountMinor: '123450' } });
  return engine;
}

test('real engine with calendar rules: the month-end brief runs on the core calendar, and its missed-run rule and budget are edited by the core', async t => {
  const engine = await realEngine(t, true);
  assert.deepEqual((await engine.request('approvals.jobTemplates', {})).monthEnd, { available: true });
  const proposed = await engine.request('approvals.proposeJob', { templateId: 'month-end-brief', missedRun: 'skip' });
  assert.equal(proposed.schedule, 'month-end');
  const raw = proposed.id.slice(4);
  const job = (await engine.request('jobs.list', {})).find((j: any) => j.id === raw);
  assert.equal(job.type, 'calculation-set'); assert.match(job.calendar.definition.timeZone, /^Asia\/(Kolkata|Calcutta)$/); // the rules may name the canonical zone
  const next = new Date(job.nextRunAt);
  assert.equal(job.nextRunAt.slice(11), '12:30:00.000Z', '18:00 in India');
  assert.equal(next.getUTCDate(), new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate(), 'the last day of the month');
  const sheet = await engine.request('approvals.job', { id: proposed.id });
  assert.deepEqual(sheet.schedule, { kind: 'calendar', rule: 'month-end', at: '18:00', timeZone: job.calendar.definition.timeZone, paused: false });
  assert.equal(sheet.missedRun, 'skip'); assert.equal(sheet.measure, null);
  assert.deepEqual(sheet.manage, { edit: 'core', delete: 'cancel', missedRule: 'core', personStep: 'not-built' });
  const queued = await engine.request('approvals.get', { id: proposed.id });
  await engine.request('approvals.approve', { id: proposed.id, digest: queued.digest });

  assert.deepEqual(await engine.request('approvals.setMissedRule', { id: raw, rule: 'run-once-on-wake' }), { id: proposed.id, missedRun: 'run-once-on-wake', via: 'core' });
  const after = await engine.request('approvals.job', { id: raw });
  assert.equal(after.missedRun, 'run-once-on-wake');
  assert.ok((await engine.request('approvals.list', {})).items.some((i: any) => i.id === proposed.id), 'the change waits for a new approval');

  assert.deepEqual(await engine.request('approvals.editJob', { id: raw, config: { budgetMinor: '30000', maxRuns: 6 } }), { id: proposed.id, via: 'core' });
  const edited = (await engine.request('jobs.list', {})).find((j: any) => j.id === raw);
  assert.deepEqual([edited.budgetMinor, edited.stopRule.maxRuns, edited.calendar.definition.missed.kind], ['30000', 6, 'coalesce']);
  assert.deepEqual(await engine.request('approvals.deleteJob', { id: raw }), { id: raw, state: 'cancelled', note: 'cancel-keeps-record' });
});

test('real engine without calendar rules: month-end refuses CALENDAR_SCHEDULE_UNAVAILABLE and every 30 days is chosen explicitly', async t => {
  const engine = await realEngine(t, false);
  assert.deepEqual((await engine.request('approvals.jobTemplates', {})).monthEnd, { available: false });
  await assert.rejects(engine.request('approvals.proposeJob', { templateId: 'month-end-brief' }), code('CALENDAR_SCHEDULE_UNAVAILABLE'));
  await assert.rejects(engine.request('approvals.proposeJob', { templateId: 'daily-brief', schedule: 'every-30-days' }), code('INVALID_JOB_PROPOSAL'));
  const proposed = await engine.request('approvals.proposeJob', { templateId: 'month-end-brief', schedule: 'every-30-days' });
  assert.equal(proposed.schedule, 'every-30-days');
  const sheet = await engine.request('approvals.job', { id: proposed.id });
  assert.deepEqual(sheet.schedule, { kind: 'interval', everyDays: 30, everyMs: 30 * 86_400_000 });
  assert.equal(engine.vault!.read().jobs.length, 1);
});
