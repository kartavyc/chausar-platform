import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import type { Job } from '../runtime/jobs.ts';
import { DurableJobRunner } from '../runtime/job-runner.ts';
import type { GoalRunner, GoalProvider, ProviderRequest } from '../runtime/job-runner.ts';
import { validatePlan } from '../runtime/job-protocol.ts';
import type { GoalPlan, GoalStep, ProviderSettlement, Json } from '../runtime/job-protocol.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { Engine } from '../runtime/engine.ts';
import { jobMethods } from '../runtime/core-sync-jobs/jobs-methods.ts';
import { desktopJobOptions } from '../runtime/core-sync-jobs/desktop-jobs.ts';

class Store implements StateStore {
  state = initialState('Synthetic core jobs', true); queue = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => { const state = this.read(); const result = await change(state); this.state = state; return result; }); this.queue = run.then(() => {}, () => {}); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const step = (id: string, patch: Partial<GoalStep> = {}): GoalStep => ({ id, provider: 'synthetic', input: { record: id }, reserveMinor: '30', modelUnits: 0, durationMs: 1000, actionExposureMinor: '0', modelRequired: false, dependencies: [], ...patch });
const person = (id: string, what: string, patch: Partial<GoalStep> = {}): GoalStep => step(id, { provider: 'person', input: { what }, reserveMinor: '0', ...patch });
const plan = (steps: GoalStep[], children: GoalPlan['children'] = []): GoalPlan => ({ runnerVersion: '1', steps, children, obligations: steps.map(item => ({ id: item.id, description: `Requested outcome ${item.id}`, requiredStepIds: [item.id] })) });
const after = (stepId: string, informationClass: 'computation' | 'observation') => [{ stepId, informationClass, evidenceRequired: true }];

function setup() {
  const store = new Store(); store.state.policy.autonomy = true;
  store.state.members.push({ id: 'cofounder', name: 'Synthetic Cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] } as any);
  let clock = Date.parse('2026-10-01T00:00:00.000Z'); const calls: string[] = []; let revoked = new Set<string>();
  const provider: GoalProvider = { id: 'synthetic', kind: 'read-only', transport: 'local', model: false, authorize: () => {},
    dispatch: async (request: ProviderRequest): Promise<ProviderSettlement> => { calls.push(request.step.id); clock += 250; return { result: { value: request.step.input, informationClass: 'computation', evidenceIds: [`proof-${request.step.id}`], sourceTainted: false }, spentMinor: '12', modelUnits: 0, durationMs: 7, actionExposureMinor: '0' }; },
    reconcile: async () => ({ outcome: 'unknown' }) };
  const runner: GoalRunner<{ plan: GoalPlan }> = { type: 'synthetic-goal', version: '1', validate: input => input as { plan: GoalPlan }, plan: input => input.plan, deliver: (_input, results) => results as unknown as Json, release: (_context, result) => !result.evidenceIds.some(id => revoked.has(id)) };
  const jobs = new JobService(store, { clock: () => clock, deliverableGuard: () => true });
  const options = { workerId: 'synthetic-worker', maxActiveJobs: 10, leaseMs: 1000, networkAvailable: () => false };
  const runnerHost = new DurableJobRunner(jobs, [runner], [provider], options);
  const config = { type: 'synthetic-goal', goal: 'Return synthetic requested work', input: { plan: plan([step('first')]) }, budgetMinor: '120', reserveMinor: '60', limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' }, stopRule: { maxRuns: 3, deadline: '2026-10-05T00:00:00.000Z' }, intervalMs: 60000, nextRunAt: '2026-10-01T00:00:00.000Z', graceMs: 0 };
  const host = (services: Record<string, unknown> = { jobs, jobRunner: runnerHost }): ModuleHost => ({ store, services, demo: true, directory: '', options: {}, call: async () => { throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } });
  const request = async (ctx: Context, method: string, payload: Record<string, unknown>, services?: Record<string, unknown>): Promise<any> => {
    const spec = jobMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(services));
  };
  return { store, jobs, runner, provider, options, host: runnerHost, calls, config, request, advance: (ms: number) => { clock += ms; }, now: () => clock, revoke: (id: string) => { revoked = new Set([...revoked, id]); } };
}
const personPlan = () => plan([step('first', { childTaskId: 'left' }), person('call', 'Call the synthetic customer about the overdue invoice', { childTaskId: 'right', dependencies: after('first', 'computation') }), step('last', { dependencies: after('call', 'observation') })],
  [{ id: 'left', goal: 'Compute the synthetic left contribution', requiredStepIds: ['first'] }, { id: 'right', goal: 'A person calls the synthetic customer', requiredStepIds: ['call'] }]);

test('a step for a person is never dispatched: the job waits, only its owner marks it done, and the wait is outside the wall-time ceiling', async () => {
  const f = setup(); const job = await f.host.create(owner, { ...f.config, input: { plan: personPlan() } });
  const waiting = await f.host.run(owner, job.id);
  assert.equal(waiting.status, 'runner-blocked'); assert.deepEqual(f.calls, ['first']); assert.equal(waiting.lease, undefined); assert.equal(waiting.reservedMinor, '0');
  assert.deepEqual({ ...waiting.ledger.at(-1), at: undefined }, { at: undefined, event: 'blocked', reason: 'PERSON_STEP_WAITING', stepId: 'call' });
  const open = await f.request(owner, 'jobs.childResults', { id: job.id });
  assert.equal(open.open, true); assert.deepEqual(open.children.map((c: any) => [c.id, c.state, c.missingStepIds]), [['left', 'done', []], ['right', 'waiting-for-person', ['call']]]);
  assert.deepEqual(open.children[0].results, [{ stepId: 'first', informationClass: 'computation', evidenceIds: ['proof-first'], value: { record: 'first' } }]);
  assert.deepEqual(await f.host.tick(owner, { awake: true, windowOpen: true, backgroundEnabled: false }), [], 'the job does not mark the step done by itself');

  f.advance(20000); // longer than the plan's 10 s wall-time ceiling
  const g = f, second = job;
  await assert.rejects(g.request({ ...owner, channel: 'phone' }, 'jobs.personStep.done', { id: second.id, stepId: 'call' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(g.request({ ...owner, sourceTainted: true }, 'jobs.personStep.done', { id: second.id, stepId: 'call' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(g.request(cofounder, 'jobs.personStep.done', { id: second.id, stepId: 'call' }), code('JOB_OWNER_REQUIRED'));
  await assert.rejects(g.request(owner, 'jobs.personStep.done', { id: second.id, stepId: 'missing' }), code('PERSON_STEP_NOT_FOUND'));
  await assert.rejects(g.request(owner, 'jobs.personStep.done', { id: second.id, stepId: 'first' }), code('PERSON_STEP_NOT_FOUND'));
  await assert.rejects(g.request(owner, 'jobs.personStep.done', { id: second.id, stepId: 'call', extra: 1 }), code('INVALID_REQUEST'));

  const done: Job = await g.request(owner, 'jobs.personStep.done', { id: second.id, stepId: 'call' });
  assert.equal(done.status, 'scheduled'); assert.equal(done.execution!.personWaitMs, 20000);
  const mark = done.ledger.find(entry => entry.event === 'person-step-done')!; assert.deepEqual([mark.stepId, mark.by, mark.revision], ['call', 'owner', 1]);
  assert.deepEqual(g.store.state.activity.filter((entry: any) => entry.event === 'job.person-step-done').map((entry: any) => entry.details), [{ jobId: second.id, stepId: 'call', memberId: 'owner' }]);
  await assert.rejects(g.request(owner, 'jobs.personStep.done', { id: second.id, stepId: 'call' }), code('PERSON_STEP_ALREADY_DONE'));

  const [delivered] = await g.host.tick(owner, { awake: true, windowOpen: true, backgroundEnabled: false });
  assert.equal(delivered.status, 'awaiting-acceptance', 'the person wait does not exhaust the wall-time ceiling'); assert.deepEqual(g.calls, ['first', 'last']);
  const result = (delivered.deliverable as any).result.call;
  assert.deepEqual(result, { value: { kind: 'person-step-done', by: 'owner', at: mark.at }, informationClass: 'observation', evidenceIds: [`person:${second.id}:1:call`], sourceTainted: false });
  const closed = await g.request(owner, 'jobs.childResults', { id: second.id });
  assert.equal(closed.open, false); assert.deepEqual(closed.children[1].results[0].value, result.value);
  await g.jobs.accept(owner, second.id);
  await assert.rejects(g.request(owner, 'jobs.personStep.done', { id: second.id, stepId: 'call' }), code('INVALID_JOB_STATE'));
});

test('a step marked done before the job reaches it settles without waiting; a cancelled job refuses the mark', async () => {
  const f = setup(); const job = await f.host.create(owner, { ...f.config, input: { plan: personPlan() } });
  const early: Job = await f.request(owner, 'jobs.personStep.done', { id: job.id, stepId: 'call' }); assert.equal(early.status, 'scheduled');
  const delivered = await f.host.run(owner, job.id); assert.equal(delivered.status, 'awaiting-acceptance'); assert.deepEqual(f.calls, ['first', 'last']);
  assert.ok(!delivered.ledger.some(entry => entry.reason === 'PERSON_STEP_WAITING'));
  const other = await f.host.create(owner, { ...f.config, input: { plan: personPlan() } }); await f.host.cancel(owner, other.id);
  await assert.rejects(f.request(owner, 'jobs.personStep.done', { id: other.id, stepId: 'call' }), code('INVALID_JOB_STATE'));
});

test('a person step needs what to do, no model and no provider of that name', () => {
  const limits = { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' };
  validatePlan(plan([person('call', 'Call the synthetic customer', { input: { what: 'Call', memberId: 'cofounder', who: 'Synthetic Cofounder' } })]), '60', limits);
  for (const bad of [{ what: '' }, { what: 'x'.repeat(501) }, { what: 'Call', extra: true }, { memberId: 'owner' }, null]) assert.throws(() => validatePlan(plan([person('call', 'x', { input: bad as Json })]), '60', limits), code('INVALID_PERSON_STEP'));
  assert.throws(() => validatePlan(plan([person('call', 'Call', { modelRequired: true, routeId: 'route' })]), '60', limits), code('INVALID_PERSON_STEP'));
  const f = setup(); assert.throws(() => new DurableJobRunner(f.jobs, [f.runner], [{ ...f.provider, id: 'person' }], f.options), code('INVALID_JOB_PROVIDER'));
});

test('child results release only what the runner still releases; a missing child keeps the job open and is named', async () => {
  const f = setup(); const job = await f.host.create(owner, { ...f.config, input: { plan: plan([step('first', { childTaskId: 'left' }), step('second', { childTaskId: 'right' })], [{ id: 'left', goal: 'Compute the synthetic left contribution', requiredStepIds: ['first'] }, { id: 'right', goal: 'Compute the synthetic right contribution', requiredStepIds: ['second'] }]) } });
  await f.host.run(owner, job.id); f.revoke('proof-second');
  const reply = await f.request(owner, 'jobs.childResults', { id: job.id });
  assert.deepEqual(reply, { jobId: job.id, objectiveRevision: 1, open: true, children: [
    { id: 'left', goal: 'Compute the synthetic left contribution', state: 'done', missingStepIds: [], results: [{ stepId: 'first', informationClass: 'computation', evidenceIds: ['proof-first'], value: { record: 'first' } }] },
    { id: 'right', goal: 'Compute the synthetic right contribution', state: 'missing', missingStepIds: ['second'], results: [] }] });
  await assert.rejects(f.request(cofounder, 'jobs.childResults', { id: job.id }), code('JOB_OWNER_REQUIRED'));
  const brief = await f.jobs.create(owner, { goal: 'A synthetic read-only brief', budgetMinor: '10', stopRule: { maxRuns: 1, deadline: '2026-10-05T00:00:00.000Z' } });
  assert.deepEqual(await f.request(owner, 'jobs.childResults', { id: brief.id }), { jobId: brief.id, objectiveRevision: 1, open: false, children: [] });
  assert.deepEqual(await f.request(owner, 'jobs.childResults', { id: brief.id }, { jobs: f.jobs }), { jobId: brief.id, objectiveRevision: 1, open: false, children: [] });
  await assert.rejects(f.request(owner, 'jobs.childResults', { id: job.id }, { jobs: f.jobs }), code('JOB_POLICY_REQUIRED'));
});

test('the ledger records run and step durations, and the meters count clock time and the named actions\' exposure', async () => {
  const f = setup(); const job = await f.host.create(owner, { ...f.config, input: { plan: plan([step('first'), step('second')]) } });
  assert.deepEqual(await f.request(owner, 'jobs.meters', { id: job.id }), { jobId: job.id, clockMs: null, exposureMinor: null, actions: [], reviewOn: null });
  const delivered = await f.host.run(owner, job.id);
  const verified = delivered.ledger.filter(entry => entry.event === 'step-verified'); assert.deepEqual(verified.map(entry => [entry.stepId, entry.durationMs]), [['first', 7], ['second', 7]]);
  assert.equal(delivered.ledger.find(entry => entry.event === 'delivered')!.durationMs, 500);
  assert.equal((await f.request(owner, 'jobs.meters', { id: job.id })).clockMs, 500);
  await assert.rejects(f.request(cofounder, 'jobs.meters', { id: job.id }), code('JOB_OWNER_REQUIRED'));

  let sent = 0;
  const actions = new ActionService(f.store, [{ id: 'synthetic-mail', title: 'Synthetic mail', operations: { send: { title: 'Send', description: 'Synthetic outside message', impact: 'money', idempotency: 'Stable key', readback: 'Synthetic ledger', validate: value => value as Record<string, unknown>, execute: async () => { sent++; return {}; }, reconcile: async () => ({ verified: true, businessSuccess: true }) } } }]);
  const host = new DurableJobRunner(f.jobs, [f.runner], [{ id: 'preview', kind: 'prepare-action', transport: 'local', model: false }], { ...f.options, actions });
  const pay = await host.create(owner, { ...f.config, allowedActions: ['synthetic-mail.send'], input: { plan: plan([step('pay', { provider: 'preview', input: { connector: 'synthetic-mail', operation: 'send', payload: { amountMinor: '125000', text: 'Synthetic fixture only' } } })]) } });
  assert.deepEqual(pay.actions, ['synthetic-mail.send'], 'a plan job names its allowed actions by default');
  const prepared = await host.run(owner, pay.id); assert.equal(sent, 0);
  const preview = prepared.ledger.find(entry => entry.event === 'step-verified')!; assert.equal(preview.actionId, f.store.state.actions[0].id); assert.equal(preview.durationMs, 0);
  assert.deepEqual(await f.request(owner, 'jobs.meters', { id: pay.id, }, { jobs: f.jobs }), { jobId: pay.id, clockMs: 0, exposureMinor: '125000', actions: ['synthetic-mail.send'], reviewOn: null });
});

test('named actions are validated and enter the digest only when present; the review date is not authority', async () => {
  const f = setup();
  const brief = await f.jobs.create(owner, { goal: 'A synthetic read-only brief', budgetMinor: '10', stopRule: { maxRuns: 1, deadline: '2026-10-05T00:00:00.000Z' } });
  assert.equal(Object.hasOwn(brief, 'actions'), false); assert.equal(Object.hasOwn(brief, 'reviewOn'), false); assert.equal(brief.digest, f.jobs.identity(brief));
  const named = await f.host.create(owner, { ...f.config, actions: ['b-books.pay', 'a-mail.send', 'b-books.pay'], reviewOn: '2026-12-31' });
  assert.deepEqual(named.actions, ['a-mail.send', 'b-books.pay']); assert.equal(named.reviewOn, '2026-12-31');
  const { actions: _actions, ...withoutActions } = named; assert.notEqual(f.jobs.identity(withoutActions as Job), named.digest);
  assert.equal(f.jobs.identity({ ...named, reviewOn: '2027-01-01' }), named.digest);
  for (const bad of [['Mail.send'], ['mail'], ['mail.send now'], Array.from({ length: 51 }, (_, i) => `c${i}.send`), 'mail.send']) await assert.rejects(f.host.create(owner, { ...f.config, actions: bad as string[] }), code('INVALID_JOB_ACTIONS'));
  for (const bad of ['2026-02-30', '2026-13-01', '31-12-2026', '']) await assert.rejects(f.host.create(owner, { ...f.config, reviewOn: bad }), code('INVALID_REVIEW_DATE'));

  const gated = await f.host.create(owner, { ...f.config, requiresApproval: true }); await f.jobs.approve(owner, gated.id, gated.digest);
  const set: Job = await f.request(owner, 'jobs.review.set', { id: gated.id, reviewOn: '2027-03-31' });
  assert.equal(set.reviewOn, '2027-03-31'); assert.equal(set.digest, gated.digest); assert.deepEqual({ ...set.ledger.at(-1), at: undefined }, { at: undefined, event: 'review-date-set', reason: '2027-03-31' });
  await assert.rejects(f.request({ ...owner, channel: 'phone' }, 'jobs.review.set', { id: gated.id, reviewOn: null }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(f.request({ ...owner, sourceTainted: true }, 'jobs.review.set', { id: gated.id, reviewOn: null }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(f.request(cofounder, 'jobs.review.set', { id: gated.id, reviewOn: null }), code('JOB_OWNER_REQUIRED'));
  await assert.rejects(f.request(owner, 'jobs.review.set', { id: gated.id, reviewOn: '2027-02-29' }), code('INVALID_REVIEW_DATE'));
  await assert.rejects(f.request(owner, 'jobs.review.set', { id: gated.id }), code('INVALID_REVIEW_DATE'));
  assert.equal((await f.request(owner, 'jobs.meters', { id: gated.id })).reviewOn, '2027-03-31');
  const cleared: Job = await f.request(owner, 'jobs.review.set', { id: gated.id, reviewOn: null }); assert.equal(Object.hasOwn(cleared, 'reviewOn'), false);
  assert.equal((await f.host.run(owner, gated.id)).status, 'awaiting-acceptance', 'the approval still matches after a review-date change');
});

const csv = 'id,kind,date,amount,currency,branch\nsyn-inv-1,invoice,2026-09-02,1234.50,INR,main\n';
const recipe = { version: 1, id: 'synthetic-core-jobs-csv-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Core Jobs', branches: ['main'] },
  bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }],
  allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' };

test('desktop job options: an explicit environment policy wins, else one local worker with no network', () => {
  const fallback = desktopJobOptions({});
  assert.deepEqual({ ...fallback.durableJobs, networkAvailable: undefined }, { workerId: 'desktop', maxActiveJobs: 8, leaseMs: 60000, networkAvailable: undefined }); assert.equal(fallback.durableJobs.networkAvailable(), false);
  assert.equal(fallback.jobCalendar.rules.canonicalZone('Asia/Kolkata').startsWith('Asia/'), true); assert.deepEqual([fallback.jobCalendar.rules.minYear, fallback.jobCalendar.rules.maxYear], [2024, 2040]);
  assert.equal(desktopJobOptions({ CHAUSAR_JOB_WORKER_ID: 'synthetic-host', CHAUSAR_JOB_MAX_ACTIVE: '2', CHAUSAR_JOB_LEASE_MS: '5000' }).durableJobs.workerId, 'synthetic-host');
  assert.throws(() => desktopJobOptions({ CHAUSAR_JOB_WORKER_ID: 'synthetic-host' }), code('INVALID_JOB_RUNNER'));
});

test('the installed app with desktop job options runs the month-end brief on the core calendar and serves the core job methods', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-sync-jobs-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'work-books': { hasMethod: () => false } }, ...desktopJobOptions({}) });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Core Jobs', passphrase: 'Synthetic core jobs passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  await engine.request('sources.import', { sourceId: 'synthetic-core-jobs', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 1, amountMinor: '123450' } });
  const types = await engine.request('jobs.types', {});
  assert.ok(types.types.includes('calculation-set')); assert.equal(types.configured, true); assert.equal(types.calendar.configured, true);
  assert.deepEqual((await engine.request('approvals.jobTemplates', {})).monthEnd, { available: true });
  const proposed = await engine.request('approvals.proposeJob', { templateId: 'month-end-brief' }); assert.equal(proposed.schedule, 'month-end');
  const raw = proposed.id.slice(4); const job = (await engine.request('jobs.list', {})).find((item: any) => item.id === raw);
  assert.equal(job.type, 'calculation-set'); assert.ok(job.calendar); assert.deepEqual(job.actions, []);

  const ctx = engine.context; const host = engine.moduleHost('core-sync-jobs', ctx);
  assert.deepEqual(await jobMethods['jobs.meters'].handler(ctx, { id: raw }, host), { jobId: raw, clockMs: null, exposureMinor: null, actions: [], reviewOn: null });
  const reviewed = await jobMethods['jobs.review.set'].handler(ctx, { id: raw, reviewOn: '2027-03-31' }, host) as Job; assert.equal(reviewed.reviewOn, '2027-03-31'); assert.equal(reviewed.digest, job.digest);
  assert.deepEqual(await jobMethods['jobs.childResults'].handler(ctx, { id: raw }, host), { jobId: raw, objectiveRevision: 1, open: false, children: [] });
  await assert.rejects(Promise.resolve().then(() => jobMethods['jobs.personStep.done'].handler(ctx, { id: raw, stepId: 'owed-at-month-end' }, host)), code('PERSON_STEP_NOT_FOUND'));
});
