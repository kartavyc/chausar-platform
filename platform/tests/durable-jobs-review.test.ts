import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';
import { ActionService } from '../runtime/actions.ts';
import type { JobConfig } from '../runtime/jobs.ts';
import { DurableJobRunner } from '../runtime/job-runner.ts';
import type { GoalProvider, GoalRunner, ProviderRequest, Reconciliation, RunnerOptions } from '../runtime/job-runner.ts';
import type { GoalPlan, GoalStep, Json, ProviderSettlement } from '../runtime/job-protocol.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const origin = Date.parse('2026-10-01T00:00:00.000Z');

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

class SyntheticStore implements StateStore {
  state = initialState('Independent synthetic durable job review', true);
  private queue = Promise.resolve();
  afterCommit?: (state: State) => void | Promise<void>;
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const committed = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await change(draft);
      this.state = draft;
      return result;
    });
    this.queue = committed.then(() => {}, () => {});
    // A lost/delayed acknowledgement does not hold the committed store's writer queue.
    return committed.then(async result => { await this.afterCommit?.(this.read()); return result; });
  }
}

function step(id = 'observe', provider = 'synthetic-read', reserveMinor = '100', dependencies: GoalStep['dependencies'] = []): GoalStep {
  return { id, provider, input: { synthetic: true, record: id }, reserveMinor, modelUnits: 0, durationMs: 10000, actionExposureMinor: '0', modelRequired: false, dependencies };
}

function plan(steps: GoalStep[] = [step()]): GoalPlan {
  return { runnerVersion: 'synthetic-v1', steps, children: [], obligations: [{ id: 'requested-result', description: 'Account for every explicitly requested synthetic result.', requiredStepIds: steps.map(item => item.id) }] };
}

function settlement(spentMinor = '40', sourceTainted = false): ProviderSettlement {
  return { result: { value: { syntheticValue: 'verified-record' }, informationClass: 'observation', evidenceIds: ['synthetic-evidence'], sourceTainted }, spentMinor, modelUnits: 0, durationMs: 1, actionExposureMinor: '0' };
}

function syntheticProvider(options: {
  id?: string;
  transport?: 'local' | 'remote';
  dispatch?: (request: ProviderRequest) => Promise<ProviderSettlement>;
  reconcile?: (request: ProviderRequest) => Promise<Reconciliation>;
} = {}) {
  const dispatches: ProviderRequest[] = [];
  const readbacks: ProviderRequest[] = [];
  const provider: GoalProvider = {
    id: options.id ?? 'synthetic-read', kind: 'read-only', transport: options.transport ?? 'remote', model: false, authorize: () => {},
    dispatch: async request => { dispatches.push(request); return options.dispatch ? options.dispatch(request) : settlement(); },
    reconcile: async request => { readbacks.push(request); return options.reconcile ? options.reconcile(request) : { outcome: 'unknown' }; },
  };
  return { provider, dispatches, readbacks };
}

function fixture(providers: GoalProvider[], planned = plan(), options: Partial<RunnerOptions> = {}) {
  const store = new SyntheticStore(); store.state.policy.autonomy = true;
  let clock = origin; let releaseAllowed = true; let online = true;
  const jobs = new JobService(store, { clock: () => clock, deliverableGuard: () => releaseAllowed });
  const goal: GoalRunner<Json> = {
    type: 'synthetic-review', version: 'synthetic-v1', validate: value => value as Json, plan: () => structuredClone(planned),
    deliver: (_input, results) => ({ values: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, result.value])) }),
    release: () => releaseAllowed,
  };
  const runnerOptions: RunnerOptions = { workerId: 'synthetic-review-worker', maxActiveJobs: 5, leaseMs: 1000, networkAvailable: () => online, ...options };
  const runner = new DurableJobRunner(jobs, [goal], providers, runnerOptions);
  const reserve = String(planned.steps.reduce((sum, item) => sum + BigInt(item.reserveMinor), 0n));
  const config: Omit<JobConfig, 'plan'> & { type: string } = {
    type: goal.type, goal: 'Produce the explicitly requested synthetic observations.', input: { synthetic: true }, budgetMinor: String(BigInt(reserve) * 3n), reserveMinor: reserve,
    limits: { modelUnits: 0, durationMs: 100000, actionExposureMinor: '0' }, stopRule: { maxRuns: 3, deadline: '2026-10-02T00:00:00.000Z' },
    nextRunAt: '2026-10-01T00:00:00.000Z', intervalMs: 1000, graceMs: 0, background: false, allowedActions: [], testedRoutes: [], sourceIds: [],
  };
  return { store, jobs, goal, runner, runnerOptions, config, advance: (ms: number) => { clock += ms; }, allowRelease: (allowed: boolean) => { releaseAllowed = allowed; }, setOnline: (available: boolean) => { online = available; } };
}

test('review: cancellation retains uncertain remote exposure until authoritative readback', async () => {
  const entered = deferred<void>(); const response = deferred<ProviderSettlement>(); let answer: Reconciliation = { outcome: 'unknown' };
  const port = syntheticProvider({ dispatch: async () => { entered.resolve(undefined); return response.promise; }, reconcile: async () => answer });
  const f = fixture([port.provider]); const created = await f.runner.create(owner, f.config);
  const running = f.runner.run(owner, created.id); await entered.promise;
  const cancelled = await f.runner.cancel(owner, created.id);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.reservedMinor, '100'); assert.equal(cancelled.spentMinor, '0');
  assert.equal(cancelled.execution!.attempts[0].status, 'unknown');
  assert.equal((await f.runner.reconcile(owner, created.id)).reservedMinor, '100');
  answer = { outcome: 'verified', id: 'synthetic-authoritative-readback', settlement: settlement() };
  const reconciled = await f.runner.reconcile(owner, created.id);
  assert.equal(reconciled.status, 'cancelled'); assert.equal(reconciled.spentMinor, '40'); assert.equal(reconciled.reservedMinor, '0'); assert.equal(reconciled.runs, 0);
  response.resolve(settlement()); const late = await running;
  assert.equal(late.status, 'cancelled'); assert.equal(late.spentMinor, '40'); assert.equal(late.runs, 0); assert.equal(port.dispatches.length, 1);
});

test('review: a late response after cancellation cannot dispatch the next step or revive completion', async () => {
  const entered = deferred<void>(); const response = deferred<ProviderSettlement>();
  const first = syntheticProvider({ dispatch: async () => { entered.resolve(undefined); return response.promise; } });
  const next = syntheticProvider({ id: 'synthetic-next' });
  const f = fixture([first.provider, next.provider], plan([step(), step('next', 'synthetic-next', '100', [{ stepId: 'observe', informationClass: 'observation', evidenceRequired: true }])]));
  const job = await f.runner.create(owner, f.config); const pending = f.runner.run(owner, job.id); await entered.promise;
  await f.runner.cancel(owner, job.id); assert.equal(f.store.read().jobs[0].reservedMinor, '200');
  response.resolve(settlement()); const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(result.spentMinor, '40'); assert.equal(result.reservedMinor, '0'); assert.equal(result.runs, 0);
  assert.equal(next.dispatches.length, 0); assert.equal(result.deliverable, undefined);
});

test('review: cancellation applied after durable admission but before provider dispatch prevents transmission', async () => {
  const admitted = deferred<void>(); const acknowledgement = deferred<void>(); let gated = false;
  const port = syntheticProvider(); const f = fixture([port.provider]); const job = await f.runner.create(owner, f.config);
  f.store.afterCommit = snapshot => {
    if (!gated && snapshot.jobs[0].execution?.attempts.some((attempt: { status: string }) => attempt.status === 'dispatched')) {
      gated = true; admitted.resolve(undefined); return acknowledgement.promise;
    }
  };
  const pending = f.runner.run(owner, job.id); await admitted.promise;
  const cancelled = await f.runner.cancel(owner, job.id); assert.equal(cancelled.status, 'cancelled');
  acknowledgement.resolve(undefined); const result = await pending;
  assert.equal(port.dispatches.length, 0, 'An applied cancellation must be checked again at actual provider dispatch.');
  assert.equal(result.status, 'cancelled'); assert.equal(result.runs, 0);
});

test('review: concurrent worker instances reserve once and dispatch one logical occurrence', async () => {
  const entered = deferred<void>(); const response = deferred<ProviderSettlement>();
  const port = syntheticProvider({ dispatch: async () => { entered.resolve(undefined); return response.promise; } }); const f = fixture([port.provider]);
  const competitor = new DurableJobRunner(f.jobs, [f.goal], [port.provider], { ...f.runnerOptions, workerId: 'second-synthetic-worker' });
  const job = await f.runner.create(owner, f.config); const pending = f.runner.run(owner, job.id); await entered.promise;
  await competitor.run(owner, job.id);
  assert.equal(port.dispatches.length, 1); assert.equal(f.store.read().jobs[0].reservedMinor, '100');
  response.resolve(settlement()); const result = await pending;
  assert.equal(result.status, 'awaiting-acceptance'); assert.equal(result.spentMinor, '40'); assert.equal(result.reservedMinor, '0'); assert.equal(result.runs, 1);
});

test('review: simultaneous mandate creation enforces the active-job ceiling atomically', async () => {
  const port = syntheticProvider(); const f = fixture([port.provider], plan(), { maxActiveJobs: 1 });
  const results = await Promise.allSettled([f.runner.create(owner, f.config), f.runner.create(owner, f.config)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejection.reason.code, 'ACTIVE_JOB_LIMIT'); assert.equal(f.store.read().jobs.length, 1);
});

test('review: restart and lease expiry preserve dispatched identity without a second remote call', async () => {
  const entered = deferred<void>(); const response = deferred<ProviderSettlement>();
  const port = syntheticProvider({ dispatch: async () => { entered.resolve(undefined); return response.promise; } }); const f = fixture([port.provider]);
  const replacement = new DurableJobRunner(f.jobs, [f.goal], [port.provider], { ...f.runnerOptions, workerId: 'restarted-synthetic-worker' });
  const job = await f.runner.create(owner, f.config); const pending = f.runner.run(owner, job.id); await entered.promise;
  const key = f.store.read().jobs[0].execution!.attempts[0].key; f.advance(1001);
  const recovered = await replacement.recoverInterrupted(owner); assert.deepEqual(recovered.recovered, [job.id]);
  const blocked = await replacement.run(owner, job.id); assert.equal(blocked.status, 'outcome-unknown'); assert.equal(blocked.reservedMinor, '100'); assert.equal(port.dispatches.length, 1);
  response.resolve(settlement()); await pending;
  const delivered = await replacement.run(owner, job.id);
  assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.spentMinor, '40'); assert.equal(delivered.runs, 1);
  assert.equal(port.dispatches.length, 1); assert.equal(f.store.read().jobs[0].execution!.attempts[0].key, key);
});

test('review: concurrent verified readback replay settles and charges exactly once', async () => {
  const port = syntheticProvider({ dispatch: async () => { throw new Error('Synthetic lost response after provider admission'); }, reconcile: async () => ({ outcome: 'verified', id: 'synthetic-readback-proof', settlement: settlement() }) });
  const f = fixture([port.provider]); const job = await f.runner.create(owner, f.config);
  assert.equal((await f.runner.run(owner, job.id)).status, 'outcome-unknown');
  await Promise.all([f.runner.reconcile(owner, job.id), f.runner.reconcile(owner, job.id)]);
  const saved = f.store.read().jobs[0]; assert.equal(saved.spentMinor, '40'); assert.equal(saved.reservedMinor, '0'); assert.equal(port.dispatches.length, 1);
  assert.equal(saved.ledger.filter((entry: { event: string }) => entry.event === 'step-verified').length, 1);
  assert.equal((await f.runner.run(owner, job.id)).runs, 1); assert.equal(port.dispatches.length, 1);
});

test('review: cost exhaustion blocks a later accepted occurrence before provider admission', async () => {
  const port = syntheticProvider({ dispatch: async () => settlement('100') }); const f = fixture([port.provider]);
  const job = await f.runner.create(owner, { ...f.config, budgetMinor: '100' });
  assert.equal((await f.runner.run(owner, job.id)).status, 'awaiting-acceptance'); await f.jobs.accept(owner, job.id, true); f.advance(1000);
  const blocked = await f.runner.run(owner, job.id);
  assert.equal(blocked.status, 'budget-blocked'); assert.equal(blocked.spentMinor, '100'); assert.equal(blocked.reservedMinor, '0'); assert.equal(port.dispatches.length, 1);
});

test('review: revoked intermediate evidence blocks restart and is withheld from every job view', async () => {
  const first = syntheticProvider({ transport: 'local' }); const next = syntheticProvider({ id: 'synthetic-next', transport: 'remote' });
  const f = fixture([first.provider, next.provider], plan([step(), step('next', 'synthetic-next', '100', [{ stepId: 'observe', informationClass: 'observation', evidenceRequired: true }])])); f.setOnline(false);
  const job = await f.runner.create(owner, f.config); const blocked = await f.runner.run(owner, job.id);
  assert.equal(blocked.status, 'network-wait'); assert.equal(first.dispatches.length, 1); assert.equal(next.dispatches.length, 0);
  assert.equal(blocked.execution!.attempts[0].settlement, undefined); assert.ok(f.store.read().jobs[0].execution!.attempts[0].settlement);
  f.allowRelease(false); f.setOnline(true); await f.jobs.resume(owner, job.id);
  const denied = await f.runner.run(owner, job.id);
  assert.equal(denied.status, 'runner-blocked'); assert.equal(denied.deliverable, undefined); assert.equal(denied.execution!.attempts[0].settlement, undefined); assert.equal(next.dispatches.length, 0);
});

test('review: reading outside text cannot dispatch a later remote read without human review', async () => {
  const first = syntheticProvider({ transport: 'local', dispatch: async () => settlement('40', true) }); const next = syntheticProvider({ id: 'synthetic-next' });
  const f = fixture([first.provider, next.provider], plan([step(), step('next', 'synthetic-next', '100', [{ stepId: 'observe', informationClass: 'observation', evidenceRequired: true }])]));
  const job = await f.runner.create(owner, f.config); const result = await f.runner.run(owner, job.id);
  assert.equal(result.status, 'runner-blocked'); assert.equal(next.dispatches.length, 0); assert.equal(result.spentMinor, '40');
  assert.ok(result.ledger.some(entry => entry.reason === 'TAINTED_JOB_EGRESS'));
});

test('review: exact mandate approval cannot bypass pending or rejected deliverable acceptance', async () => {
  const port = syntheticProvider(); const f = fixture([port.provider]); const job = await f.runner.create(owner, { ...f.config, requiresApproval: true });
  await f.jobs.approve(owner, job.id, job.digest); const delivered = await f.runner.run(owner, job.id); assert.equal(delivered.status, 'awaiting-acceptance');
  await assert.rejects(f.jobs.approve(owner, job.id, delivered.digest), { code: 'INVALID_JOB_STATE' });
  await f.jobs.reject(owner, job.id, 'The delivered synthetic observation does not satisfy the requested result.');
  await assert.rejects(f.jobs.resume(owner, job.id), { code: 'INVALID_JOB_STATE' });
  await assert.rejects(f.jobs.approve(owner, job.id, delivered.digest), { code: 'INVALID_JOB_STATE' });
  assert.equal(f.store.read().jobs[0].runs, 1); assert.equal(port.dispatches.length, 1);
});

test('review: a workspace administrator cannot accept another pinned owner result', async () => {
  const port = syntheticProvider(); const f = fixture([port.provider]);
  const other: Context = { memberId: 'synthetic-cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
  f.store.state.members.push({ id: other.memberId, name: 'Synthetic cofounder', role: other.role, active: true, epoch: 1, branches: ['*'] });
  const job = await f.runner.create(other, f.config); await f.runner.run(other, job.id);
  await assert.rejects(f.jobs.accept(owner, job.id), { code: 'JOB_OWNER_REQUIRED' });
  assert.deepEqual(f.jobs.list(owner), []); assert.equal((await f.jobs.accept(other, job.id)).status, 'accepted');
});

test('review: an amendment cannot expose a revoked original-source payload through archived executions', async () => {
  const port = syntheticProvider({ transport: 'local' }); const f = fixture([port.provider]);
  f.goal.plan = input => {
    const planned = plan(); planned.steps[0].input = input;
    return planned;
  };
  const job = await f.runner.create(owner, { ...f.config, input: { text: 'synthetic-private-old-source-text' }, sourceIds: ['old-source'] });
  await f.runner.run(owner, job.id);
  await f.runner.amend(owner, job.id, { ...f.config, input: { text: 'synthetic-current-source-text' }, sourceIds: ['current-source'] });
  f.store.state.policy.allowedSources = ['current-source'];
  const views = f.jobs.list(owner);
  assert.equal(views.length, 1, 'The current amended objective is still readable.');
  assert.ok(f.store.read().jobs[0].archivedExecutions?.length, 'Original evidence stays durably recorded.');
  assert.equal(JSON.stringify(views).includes('synthetic-private-old-source-text'), false, 'Saved original-source step inputs require their original current source grant.');
});

test('review: an unresolved original-source payload is withheld after narrower amendment and revocation', async () => {
  const entered = deferred<void>(); const response = deferred<ProviderSettlement>();
  const port = syntheticProvider({ dispatch: async () => { entered.resolve(undefined); return response.promise; } }); const f = fixture([port.provider]);
  f.goal.plan = input => { const planned = plan(); planned.steps[0].input = input; return planned; };
  const job = await f.runner.create(owner, { ...f.config, input: { text: 'synthetic-private-in-flight-text' }, sourceIds: ['old-source'] });
  const pending = f.runner.run(owner, job.id); await entered.promise;
  await f.runner.amend(owner, job.id, { ...f.config, input: { text: 'synthetic-current-source-text' }, sourceIds: ['current-source'] });
  f.store.state.policy.allowedSources = ['current-source'];
  const serialized = JSON.stringify(f.jobs.list(owner));
  // Always finish the synthetic in-flight call even if this privacy assertion regresses.
  response.resolve(settlement()); await pending;
  assert.equal(serialized.includes('synthetic-private-in-flight-text'), false);
  assert.equal(port.dispatches.length, 1);
});

test('review: original action-preview readback survives removal of the amended write catalogue', async () => {
  const previewStep = step('preview', 'synthetic-preview');
  previewStep.input = { connector: 'synthetic-local', operation: 'draft', payload: { text: 'Synthetic local preview only.' } };
  const f = fixture([], plan([previewStep])); let sends = 0;
  const actions = new ActionService(f.store, [{ id: 'synthetic-local', title: 'Synthetic local review connector', operations: {
    draft: {
      title: 'Prepare a synthetic draft', description: 'Review evidence only.', impact: 'reversible', idempotency: 'Exact synthetic operation identity.', readback: 'Inspect the stored prepared action.',
      validate: payload => payload as Record<string, unknown>,
      execute: async () => { sends += 1; throw new Error('This review test must never execute an action.'); },
      reconcile: async () => ({ verified: false, businessSuccess: false, absent: true }),
    },
  } }]);
  const host = new DurableJobRunner(f.jobs, [f.goal], [{ id: 'synthetic-preview', kind: 'prepare-action', transport: 'local', model: false }], { ...f.runnerOptions, actions });
  const created = await host.create(owner, { ...f.config, allowedActions: ['synthetic-local.draft'] });
  let lostAcknowledgement = false;
  f.store.afterCommit = snapshot => {
    if (!lostAcknowledgement && snapshot.actions.length === 1) { lostAcknowledgement = true; throw new Error('Synthetic acknowledgement lost after local action preparation committed.'); }
  };
  const unknown = await host.run(owner, created.id); f.store.afterCommit = undefined;
  assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.reservedMinor, '100'); assert.equal(f.store.read().actions.length, 1);
  await host.amend(owner, created.id, { ...f.config, goal: 'Produce a different synthetic result with no action permission.', allowedActions: [] });
  const resolved = await host.reconcile(owner, created.id);
  assert.equal(resolved.status, 'paused'); assert.equal(resolved.reservedMinor, '0'); assert.equal(f.store.read().actions.length, 1); assert.equal(sends, 0);
  assert.equal(f.store.read().jobs[0].archivedExecutions?.[0].attempts[0].status, 'verified');
});
