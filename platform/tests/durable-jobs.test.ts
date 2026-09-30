import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';
import { DurableJobRunner } from '../runtime/job-runner.ts';
import type { GoalRunner, GoalProvider, ProviderRequest, Reconciliation } from '../runtime/job-runner.ts';
import type { GoalPlan, GoalStep, ProviderSettlement, StepResult, Json } from '../runtime/job-protocol.ts';
import { calculationGoal, evidenceGoal } from '../runtime/job-goals.ts';
import { ActionService } from '../runtime/actions.ts';

class Store implements StateStore {
  state = initialState('Synthetic mandates', true); queue = Promise.resolve();
  failSettlement = false;
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => { const state = this.read(); const result = await change(state); if (this.failSettlement && state.jobs.some(job => job.execution?.attempts.some((attempt: any) => attempt.status === 'verified'))) { this.failSettlement = false; throw new Error('Synthetic commit loss'); } this.state = state; return result; }); this.queue = run.then(() => {}, () => {}); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
function step(id: string, patch: Partial<GoalStep> = {}): GoalStep { return { id, provider: 'synthetic', input: { record: id }, reserveMinor: '30', modelUnits: 0, durationMs: 1000, actionExposureMinor: '0', modelRequired: false, dependencies: [], ...patch }; }
function settlement(request: ProviderRequest, patch: Partial<StepResult> = {}): ProviderSettlement { return { result: { value: request.step.input, informationClass: 'computation', evidenceIds: [`proof-${request.step.id}`], sourceTainted: false, ...patch }, spentMinor: '12', modelUnits: 0, durationMs: 1, actionExposureMinor: '0' }; }
const release = () => true;
const generic: GoalRunner<{ plan: GoalPlan }> = { type: 'synthetic-goal', version: '1', validate: input => input as { plan: GoalPlan }, plan: input => input.plan, deliver: (_input, results) => results as unknown as Json, release };
function plan(steps: GoalStep[], children: GoalPlan['children'] = []): GoalPlan { return { runnerVersion: '1', steps, children, obligations: steps.map(item => ({ id: item.id, description: `Requested outcome ${item.id}`, requiredStepIds: [item.id] })) }; }
function setup() {
  const store = new Store(); store.state.policy.autonomy = true; let clock = Date.parse('2026-10-01T00:00:00.000Z'); let online = true; const calls: string[] = []; const saved = new Map<string, ProviderSettlement>();
  const provider: GoalProvider = { id: 'synthetic', kind: 'read-only', transport: 'local', model: false, authorize: () => {}, dispatch: async request => { calls.push(request.key); const result = settlement(request); saved.set(request.key, result); return result; }, reconcile: async request => saved.has(request.key) ? { outcome: 'verified', id: `readback-${request.key}`, settlement: saved.get(request.key)! } : { outcome: 'unknown' } };
  const jobs = new JobService(store, { clock: () => clock, deliverableGuard: () => true });
  const options = { workerId: 'synthetic-worker', maxActiveJobs: 5, leaseMs: 1000, networkAvailable: () => online };
  const runners = [generic, calculationGoal({ providerId: 'synthetic', release }), evidenceGoal({ providerId: 'synthetic', release })];
  const host = new DurableJobRunner(jobs, runners, [provider], options);
  const config = { type: 'synthetic-goal', goal: 'Return synthetic requested work', input: { plan: plan([step('first'), step('second')]) }, budgetMinor: '120', reserveMinor: '60', limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' }, stopRule: { maxRuns: 3, deadline: '2026-10-02T00:00:00.000Z' }, intervalMs: 60000, nextRunAt: '2026-10-01T00:00:00.000Z', graceMs: 0 };
  return { store, jobs, host, options, runners, provider, calls, saved, config, advance: (ms: number) => { clock += ms; }, online: (value: boolean) => { online = value; } };
}

test('generic calculation and evidence goals run with explicit providers and await their owner', async () => {
  const f = setup(); const config = { ...f.config, type: 'calculation-set', input: { requests: [{ id: 'revenue', input: { operation: 'net_sales' }, reserveMinor: '30', durationMs: 1000 }] } };
  const job = await f.host.create(owner, config); assert.equal(job.background, false); const delivered = await f.host.run(owner, job.id);
  assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.spentMinor, '12'); assert.equal(delivered.reservedMinor, '0'); assert.equal(f.calls.length, 1); assert.ok((delivered.deliverable as any).result.calculations[0].evidenceIds.length);
  await assert.rejects(f.jobs.approve(owner, job.id, job.digest), { code: 'INVALID_JOB_STATE' }); assert.equal((await f.jobs.accept(owner, job.id)).status, 'accepted');
  f.provider.dispatch = async request => { f.calls.push(request.key); return settlement(request, { informationClass: 'observation' }); };
  const review = await f.host.create(owner, { ...f.config, type: 'evidence-review', input: { records: [{ id: 'invoice-proof', input: { receipt: 'synthetic-receipt' }, reserveMinor: '30', durationMs: 1000 }] } });
  assert.equal(review.plan!.children.length, 1); assert.equal((await f.host.run(owner, review.id)).status, 'awaiting-acceptance');
});

test('lost settlement commit recovers by readback and reuses verified steps without duplicate cost or dispatch', async () => {
  const f = setup(); const job = await f.host.create(owner, f.config); f.store.failSettlement = true;
  const unknown = await f.host.run(owner, job.id); assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.reservedMinor, '60'); assert.equal(unknown.spentMinor, '0');
  const restarted = new DurableJobRunner(f.jobs, f.runners, [f.provider], f.options); const resolved = await restarted.reconcile(owner, job.id); assert.equal(resolved.spentMinor, '12'); assert.equal(resolved.reservedMinor, '0');
  const delivered = await restarted.run(owner, job.id); assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.spentMinor, '24'); assert.equal(f.calls.length, 2); assert.equal(new Set(f.calls).size, 2);
  await assert.rejects(restarted.reconcile(owner, job.id), { code: 'INVALID_JOB_STATE' }); assert.equal(f.store.state.jobs[0].spentMinor, '24');
});

test('recovery before dispatch releases the reservation and keeps the original occurrence', async () => {
  const f = setup(); const job = await f.host.create(owner, f.config); await f.jobs.acquire(owner, job.id, 'crashed-worker');
  const restart = new DurableJobRunner(f.jobs, f.runners, [f.provider], f.options); assert.deepEqual((await restart.recoverInterrupted(owner)).recovered, [job.id]);
  assert.equal(f.store.state.jobs[0].reservedMinor, '0'); f.advance(180000); const delivered = await restart.run(owner, job.id); assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal((delivered.deliverable as any).scheduledFor, job.nextRunAt);
});

test('expired dispatched leases retain uncertain exposure and fence stale workers', async () => {
  const f = setup(); const job = await f.host.create(owner, f.config);
  f.provider.dispatch = async () => { f.advance(1001); throw new Error('Synthetic connection loss'); };
  const unresolved = await f.host.run(owner, job.id); assert.equal(unresolved.status, 'outcome-unknown'); assert.equal(unresolved.reservedMinor, '60');
  assert.equal((await f.host.run(owner, job.id)).status, 'outcome-unknown'); assert.equal(f.store.state.jobs[0].execution.attempts.length, 1);
  assert.equal((await f.host.reconcile(owner, job.id)).reservedMinor, '60');
});

test('background and missed-occurrence policies follow explicit host state', async () => {
  const f = setup(); const foreground = await f.host.create(owner, f.config); const background = await f.host.create(owner, { ...f.config, background: true });
  assert.deepEqual(await f.host.tick(owner, { awake: false, windowOpen: true, backgroundEnabled: true }), []);
  assert.deepEqual(await f.host.tick(owner, { awake: true, windowOpen: false, backgroundEnabled: false }), []);
  const ran = await f.host.tick(owner, { awake: true, windowOpen: false, backgroundEnabled: true }); assert.deepEqual(ran.map(job => job.id), [background.id]); assert.equal(f.store.state.jobs.find(job => job.id === foreground.id).status, 'scheduled');
  const skip = await f.host.create(owner, { ...f.config, catchup: 'skip' }); f.advance(180000); const result = await f.host.run(owner, skip.id); assert.equal(result.status, 'scheduled'); assert.equal(result.nextRunAt, '2026-10-01T00:04:00.000Z');
  const latest = await f.host.run(owner, foreground.id); assert.equal(latest.runs, 1); await f.jobs.accept(owner, foreground.id, true); assert.equal(f.store.state.jobs.find(job => job.id === foreground.id).nextRunAt, '2026-10-01T00:04:00.000Z');
});

test('an exhausted shared budget admits no additional child calls', async () => {
  const f = setup(); f.provider.dispatch = async request => { f.calls.push(request.key); return { ...settlement(request), spentMinor: '30' }; };
  const job = await f.host.create(owner, { ...f.config, budgetMinor: '60', input: { plan: plan([step('first', { childTaskId: 'left' }), step('second', { childTaskId: 'right' })], [{ id: 'left', goal: 'Review the left contribution', requiredStepIds: ['first'] }, { id: 'right', goal: 'Review the right contribution', requiredStepIds: ['second'] }]) } });
  const delivered = await f.host.run(owner, job.id); assert.equal(delivered.spentMinor, '60'); await f.jobs.accept(owner, job.id, true); assert.equal(f.store.state.jobs[0].archivedExecutions[0].attempts.length, 2); f.advance(60000); assert.equal((await f.host.run(owner, job.id)).status, 'budget-blocked'); assert.equal(f.calls.length, 2);
});

test('typed evidence dependencies reject plausible hypothesis substitution before child dispatch', async () => {
  const f = setup(); f.provider.dispatch = async request => { f.calls.push(request.key); return settlement(request, { informationClass: 'hypothesis' }); };
  const job = await f.host.create(owner, { ...f.config, input: { plan: plan([step('first'), step('second', { childTaskId: 'child', dependencies: [{ stepId: 'first', informationClass: 'computation', evidenceRequired: true }] })], [{ id: 'child', goal: 'Compute a verified child contribution', requiredStepIds: ['second'] }]) } });
  const blocked = await f.host.run(owner, job.id); assert.equal(blocked.status, 'runner-blocked'); assert.equal(blocked.runs, 0); assert.equal(f.calls.length, 1); assert.equal(blocked.ledger.at(-1)!.reason, 'JOB_DEPENDENCY_UNSATISFIED');
  assert.deepEqual(f.host.progress(owner, job.id).children[0].missingStepIds, ['second']); assert.deepEqual(f.host.progress(owner, job.id).obligations[1].missingStepIds, ['second']);
  const leased = await f.jobs.acquire(owner, (await f.host.create(owner, f.config)).id, 'manual-worker'); await assert.rejects(f.jobs.complete(owner, leased.id, leased.lease!, { falseSuccess: true }, '0'), { code: 'JOB_INCOMPLETE' });
});

test('model routes, transport health and outside-text egress are checked before provider invocation', async () => {
  const f = setup(); const remote: GoalProvider = { ...f.provider, id: 'remote', transport: 'remote', model: true }; const host = new DurableJobRunner(f.jobs, f.runners, [f.provider, remote], f.options);
  const modelStep = step('second', { provider: 'remote', modelRequired: true, routeId: 'qualified-route' });
  const untested = await host.create(owner, { ...f.config, input: { plan: plan([modelStep]) } }); assert.equal((await host.run(owner, untested.id)).ledger.at(-1)!.reason, 'UNQUALIFIED_JOB_ROUTE'); assert.equal(f.calls.length, 0);
  f.online(false); const offline = await host.create(owner, { ...f.config, testedRoutes: ['qualified-route'], input: { plan: plan([step('first'), modelStep]) } }); assert.equal((await host.run(owner, offline.id)).ledger.at(-1)!.reason, 'JOB_NETWORK_UNAVAILABLE'); assert.equal(f.calls.length, 1);
  f.online(true); f.provider.dispatch = async request => { f.calls.push(request.key); return settlement(request, { sourceTainted: true }); }; const tainted = await host.create(owner, { ...f.config, testedRoutes: ['qualified-route'], input: { plan: plan([step('first'), modelStep]) } }); assert.equal((await host.run(owner, tainted.id)).ledger.at(-1)!.reason, 'TAINTED_JOB_EGRESS'); assert.equal(f.calls.length, 2);
});

test('action steps create exact previews without approving or executing external messages', async () => {
  const f = setup(); let sent = 0;
  const actions = new ActionService(f.store, [{ id: 'synthetic-mail', title: 'Synthetic mail', operations: { send: { title: 'Send', description: 'Synthetic outside message', impact: 'message', idempotency: 'Stable key', readback: 'Synthetic ledger', validate: value => value as Record<string, unknown>, execute: async () => { sent++; return {}; }, reconcile: async () => ({ verified: true, businessSuccess: true }) } } }]);
  const host = new DurableJobRunner(f.jobs, [generic], [{ id: 'preview', kind: 'prepare-action', transport: 'local', model: false }], { ...f.options, actions });
  const job = await host.create(owner, { ...f.config, allowedActions: ['synthetic-mail.send'], input: { plan: plan([step('reminder', { provider: 'preview', input: { connector: 'synthetic-mail', operation: 'send', payload: { text: 'Synthetic fixture only' } } })]) } });
  const delivered = await host.run(owner, job.id); assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(sent, 0); assert.equal(f.store.state.actions[0].status, 'prepared'); assert.equal(f.store.state.actions[0].approval, undefined); assert.equal(f.store.state.actions[0].attempts.length, 0);
});

test('objective amendments preserve original uncertain scope and invalidate old delivered output', async () => {
  const f = setup(); const job = await f.host.create(owner, f.config); f.store.failSettlement = true; await f.host.run(owner, job.id);
  const revised = await f.host.amend(owner, job.id, { ...f.config, goal: 'Return a new explicit synthetic objective', input: { plan: plan([step('replacement')]) } }); assert.equal(revised.revision, 2); assert.equal(revised.status, 'outcome-unknown'); assert.equal(revised.reservedMinor, '60');
  const reconciled = await f.host.reconcile(owner, job.id); assert.equal(reconciled.status, 'paused'); assert.equal(reconciled.execution, undefined); assert.equal(reconciled.archivedExecutions![0].objectiveRevision, 1); assert.equal(reconciled.spentMinor, '12');
  await f.jobs.resume(owner, job.id); const result = await f.host.run(owner, job.id); assert.equal((result.deliverable as any).objectiveRevision, 2); assert.equal(f.calls.length, 2);
});

test('admission requires one-level children, covered obligations and an explicit active-job ceiling', async () => {
  const f = setup(); await assert.rejects(f.host.create(owner, { ...f.config, input: { plan: { ...plan([step('first')]), obligations: [{ id: 'missing', description: 'Unplanned requested work', requiredStepIds: ['absent'] }] } } }), { code: 'UNASSIGNED_JOB_OBLIGATION' });
  const nested = { id: 'child', goal: 'Synthetic child task', requiredStepIds: ['first'], children: [] }; await assert.rejects(f.host.create(owner, { ...f.config, input: { plan: plan([step('first', { childTaskId: 'child' })], [nested]) } }), { code: 'INVALID_CHILD_TASK' });
  const host = new DurableJobRunner(f.jobs, f.runners, [f.provider], { ...f.options, maxActiveJobs: 1 }); const attempts = await Promise.allSettled([host.create(owner, f.config), host.create(owner, f.config)]); assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.store.state.jobs.length, 1);
});

test('revoked evidence blocks resume and run deadline stops the next step while preserving charged cost', async () => {
  const f = setup(); let allowed = true; const runner = { ...generic, release: () => allowed }; const host = new DurableJobRunner(f.jobs, [runner], [f.provider], f.options);
  const job = await host.create(owner, f.config); f.provider.dispatch = async request => { f.calls.push(request.key); f.advance(10000); return settlement(request); };
  const stopped = await host.run(owner, job.id); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.spentMinor, '12'); assert.equal(stopped.reservedMinor, '0'); assert.equal(f.calls.length, 1);
  allowed = false; assert.equal(host.canRelease(owner, f.store.state.jobs[0]), false);
});

test('offline local contributions continue and network-wait resumes once under the original occurrence', async () => {
  const f = setup(); let remoteCalls = 0;
  const remote: GoalProvider = { ...f.provider, id: 'remote-read', transport: 'remote', dispatch: async request => { remoteCalls++; return settlement(request); } };
  const host = new DurableJobRunner(f.jobs, f.runners, [f.provider, remote], f.options); f.online(false);
  const job = await host.create(owner, { ...f.config, input: { plan: plan([step('remote', { provider: 'remote-read' }), step('local')]) } });
  const waiting = await host.run(owner, job.id); assert.equal(waiting.status, 'network-wait'); assert.equal(remoteCalls, 0); assert.equal(f.calls.length, 1); assert.equal(waiting.spentMinor, '12');
  assert.deepEqual(await host.tick(owner, { awake: true, windowOpen: true, backgroundEnabled: false }), []);
  f.online(true); const delivered = await host.tick(owner, { awake: true, windowOpen: true, backgroundEnabled: false }); assert.equal(delivered[0].status, 'awaiting-acceptance'); assert.equal(delivered[0].spentMinor, '24'); assert.equal(remoteCalls, 1); assert.equal(f.calls.length, 1); assert.equal((delivered[0].deliverable as any).scheduledFor, job.nextRunAt);
});

test('an unresponsive provider hits its admitted deadline, aborts and retains unresolved consumption', async t => {
  const f = setup(); let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }); let signal: AbortSignal | undefined;
  f.provider.dispatch = async request => { signal = request.signal; enter(); return new Promise<ProviderSettlement>(() => {}); };
  const job = await f.host.create(owner, f.config); t.mock.timers.enable({ apis: ['setTimeout'] }); const run = f.host.run(owner, job.id); await entered; t.mock.timers.tick(1000);
  const timedOut = await run; assert.equal(timedOut.status, 'outcome-unknown'); assert.equal(timedOut.reservedMinor, '60'); assert.equal(timedOut.spentMinor, '0'); assert.equal(signal!.aborted, true); assert.equal(timedOut.execution!.attempts[0].reason, 'JOB_PROVIDER_TIMEOUT');
  assert.equal((await f.host.reconcile(owner, job.id)).reservedMinor, '60');
});

test('remote provider authorization is explicit and revocation stops dispatch at the final boundary', async () => {
  const f = setup(); await assert.throws(() => new DurableJobRunner(f.jobs, f.runners, [{ ...f.provider, transport: 'remote', authorize: undefined }], f.options), { code: 'INVALID_JOB_PROVIDER' });
  let authorizations = 0; const provider: GoalProvider = { ...f.provider, transport: 'remote', authorize: (_state, _context, _request, mode) => { if (mode === 'dispatch' && ++authorizations === 2) throw Object.assign(new Error('Synthetic egress approval revoked'), { code: 'APPROVAL_REQUIRED' }); } };
  const host = new DurableJobRunner(f.jobs, f.runners, [provider], f.options); const job = await host.create(owner, f.config); const blocked = await host.run(owner, job.id); assert.equal(f.calls.length, 0); assert.equal(blocked.status, 'outcome-unknown'); assert.equal(blocked.reservedMinor, '60');
});

test('owner revocation with uncertain dispatched work records a retained reconciliation obligation', async () => {
  const f = setup(); const job = await f.host.create(owner, f.config);
  f.provider.dispatch = async () => { f.store.state.members[0].epoch += 1; throw new Error('Synthetic transport interruption'); };
  await assert.rejects(f.host.run(owner, job.id), { code: 'ACCESS_REVOKED' }); const saved = f.store.state.jobs[0]; assert.equal(saved.status, 'revoked'); assert.equal(saved.reservedMinor, '60'); assert.equal(saved.execution.attempts[0].status, 'unknown'); assert.equal(saved.execution.afterReconcile, 'revoked');
  const redacted = f.jobs.view({ ...owner, epoch: 2 }, saved); assert.equal(redacted.plan, undefined); assert.equal(redacted.input, undefined); assert.equal(redacted.execution, undefined);
});
