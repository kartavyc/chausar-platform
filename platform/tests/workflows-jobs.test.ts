import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';
class Store implements StateStore {
  state: State = initialState('Jobs', true); queue = Promise.resolve(); read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const state = structuredClone(this.state); const result = await change(state); this.state = state; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
function setup() { const store = new Store(); store.state.policy.autonomy = true; let clock = Date.parse('2026-10-01T00:00:00.000Z'); const jobs = new JobService(store, { clock: () => clock }); const config = { goal: 'Prepare the owner daily brief', budgetMinor: '1000', reserveMinor: '500', stopRule: { maxRuns: 2, deadline: '2026-10-02T00:00:00.000Z' }, nextRunAt: '2026-10-01T00:00:00.000Z', intervalMs: 60000 }; return { store, jobs, config, advance: (ms: number) => { clock += ms; } }; }
test('a mandate requires a concrete owner, positive budget and stop rule', async () => {
  const f = setup(); await assert.rejects(f.jobs.create(owner, { ...f.config, budgetMinor: '0' }), { code: 'INVALID_BUDGET' });
  await assert.rejects(f.jobs.create(owner, { ...f.config, stopRule: { maxRuns: 0, deadline: f.config.stopRule.deadline } }), { code: 'STOP_RULE_REQUIRED' });
  await assert.rejects(f.jobs.create({ ...owner, sourceTainted: true }, f.config), { code: 'TAINTED_JOB' });
});
test('concurrent workers acquire one durable reservation, and costs cannot exceed it', async () => {
  const f = setup(); const job = await f.jobs.create(owner, f.config);
  const attempts = await Promise.allSettled([f.jobs.acquire(owner, job.id, 'worker1'), f.jobs.acquire(owner, job.id, 'worker2')]); assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  const running = f.store.state.jobs[0]; assert.equal(running.reservedMinor, '500'); await f.jobs.charge(owner, job.id, running.lease, '200');
  await assert.rejects(f.jobs.charge(owner, job.id, running.lease, '301'), { code: 'BUDGET_EXCEEDED' });
  const delivered = await f.jobs.complete(owner, job.id, running.lease, { summary: 'Verified brief' }, '350'); assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.spentMinor, '350'); assert.equal(delivered.reservedMinor, '0');
  await assert.rejects(f.jobs.acquire(owner, job.id, 'worker3'), { code: 'JOB_NOT_RUNNABLE' }); assert.equal((await f.jobs.accept(owner, job.id)).status, 'accepted');
});
test('expired leases are reclaimed with fencing, preserving spent cost and rejecting stale delivery', async () => {
  const f = setup(); const job = await f.jobs.create(owner, f.config); const first = await f.jobs.acquire(owner, job.id, 'worker1', 1000); await f.jobs.charge(owner, job.id, first.lease!, '100'); f.advance(1001);
  const next = await f.jobs.acquire(owner, job.id, 'worker2', 1000); assert.ok(next.lease!.fence > first.lease!.fence); assert.equal(next.spentMinor, '100'); assert.equal(next.reservedMinor, '500');
  await assert.rejects(f.jobs.complete(owner, job.id, first.lease!, { stale: true }, '0'), { code: 'STALE_LEASE' });
  const complete = await f.jobs.complete(owner, job.id, next.lease!, { fresh: true }, '200'); assert.equal(complete.spentMinor, '300'); assert.equal(complete.reservedMinor, '0');
});
test('pausing fences running work and acceptance is a separate human step', async () => {
  const f = setup(); const job = await f.jobs.create(owner, f.config); const first = await f.jobs.acquire(owner, job.id, 'worker1'); const paused = await f.jobs.pause(owner, job.id); assert.equal(paused.reservedMinor, '0');
  await assert.rejects(f.jobs.complete(owner, job.id, first.lease!, { stale: true }, '0'), { code: 'STALE_LEASE' }); await f.jobs.resume(owner, job.id);
  const next = await f.jobs.acquire(owner, job.id, 'worker2'); await f.jobs.complete(owner, job.id, next.lease!, { fresh: true }, '0');
  await assert.rejects(f.jobs.accept({ ...owner, sourceTainted: true }, job.id), { code: 'APP_ACCEPTANCE_REQUIRED' }); assert.equal((await f.jobs.accept(owner, job.id, true)).status, 'scheduled');
});
test('autonomy disabled and missing exact mandate approval block work without spending', async () => {
  const f = setup(); const job = await f.jobs.create(owner, { ...f.config, requiresApproval: true }); assert.equal((await f.jobs.acquire(owner, job.id, 'worker')).status, 'approval-blocked');
  await f.jobs.approve(owner, job.id, job.digest); f.store.state.policy.autonomy = false; assert.equal((await f.jobs.acquire(owner, job.id, 'worker')).status, 'approval-blocked'); assert.equal(f.store.state.jobs[0].spentMinor, '0');
});
test('skip and latest catch-up rules are deterministic after sleep', async () => {
  const f = setup(); const skip = await f.jobs.create(owner, { ...f.config, catchup: 'skip', graceMs: 100 }); const latest = await f.jobs.create(owner, { ...f.config, catchup: 'latest' }); f.advance(180000);
  const skipped = await f.jobs.acquire(owner, skip.id, 'skip-worker'); assert.equal(skipped.status, 'scheduled'); assert.equal(skipped.nextRunAt, '2026-10-01T00:04:00.000Z'); assert.equal(skipped.runs, 0);
  const caught = await f.jobs.acquire(owner, latest.id, 'latest-worker'); assert.equal(caught.status, 'running'); assert.equal(caught.runs, 0);
});
test('job owner revocation and exhausted budget stop later worker execution', async () => {
  const f = setup(); const job = await f.jobs.create(owner, { ...f.config, budgetMinor: '500' }); const acquired = await f.jobs.acquire(owner, job.id, 'worker'); await f.jobs.complete(owner, job.id, acquired.lease!, { result: 'done' }, '500'); await f.jobs.accept(owner, job.id, true); f.advance(60000); assert.equal((await f.jobs.acquire(owner, job.id, 'worker')).status, 'budget-blocked');
  f.store.state.members.push({ id: 'owner2', name: 'Second owner', role: 'owner', epoch: 1, active: true, branches: ['*'] }); f.store.state.members[0].epoch += 1; const revoked = await f.jobs.acquire({ memberId: 'owner2', role: 'owner', epoch: 1 }, job.id, 'worker'); assert.equal(revoked.status, 'revoked');
});
test('an empty sourceIds list never shares another member’s goals, budgets or saved brief', async () => {
  const f = setup(); f.store.state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }, { id: 'scoped-cofounder', name: 'Scoped cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['Mumbai'] });
  const job = await f.jobs.create(owner, { ...f.config, sourceIds: [] }); const acquired = await f.jobs.acquire(owner, job.id, 'owner-worker'); await f.jobs.complete(owner, job.id, acquired.lease!, { globalRevenueMinor: '99999999' }, '0');
  assert.deepEqual(f.jobs.list({ memberId: 'viewer', role: 'viewer', epoch: 1 }), []);
  assert.deepEqual(f.jobs.list({ memberId: 'scoped-cofounder', role: 'cofounder', epoch: 1 }), []);
  assert.equal(f.jobs.list(owner).length, 1); assert.equal(f.jobs.list(owner)[0].deliverable, undefined);
});
test('workspace owners do not see another owner’s job metadata or deliverable through list', async () => {
  const f = setup(); const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1 }; f.store.state.members.push({ id: cofounder.memberId, name: 'Cofounder', role: cofounder.role, active: true, epoch: 1, branches: ['Mumbai'] });
  const job = await f.jobs.create(cofounder, { ...f.config, goal: 'Private scoped financial brief' }); const acquired = await f.jobs.acquire(cofounder, job.id, 'scoped-worker'); await f.jobs.complete(cofounder, job.id, acquired.lease!, { scopedFigure: '12345' }, '0');
  assert.deepEqual(f.jobs.list(owner), []); assert.equal(f.jobs.list(cofounder)[0].deliverable, undefined);
});
test('deliverable guard rechecks the current owner’s receipt scope and fails closed on deny or error', async () => {
  const f = setup(); const job = await f.jobs.create(owner, f.config); const acquired = await f.jobs.acquire(owner, job.id, 'worker'); await f.jobs.complete(owner, job.id, acquired.lease!, { receiptId: 'private-receipt' }, '0');
  const allow = new JobService(f.store, { deliverableGuard: (context, saved) => context.memberId === saved.ownerId && (saved.deliverable as any).receiptId === 'private-receipt' }); assert.deepEqual(allow.list(owner)[0].deliverable, { receiptId: 'private-receipt' });
  const deny = new JobService(f.store, { deliverableGuard: () => false }); assert.equal(deny.list(owner)[0].deliverable, undefined);
  const error = new JobService(f.store, { deliverableGuard: () => { throw new Error('Receipt permission revoked'); } }); assert.equal(error.list(owner)[0].deliverable, undefined);
  f.store.state.members[0].epoch += 1; assert.deepEqual(allow.list({ ...owner, epoch: 2 }), []);
});
test('saved job IDs cannot bypass a revoked deliverable guard through accept or administrative mutations', async () => {
  const f = setup(); let receiptAllowed = true; const guarded = new JobService(f.store, { clock: f.jobs.clock, deliverableGuard: () => receiptAllowed });
  const job = await guarded.create(owner, f.config); const acquired = await guarded.acquire(owner, job.id, 'worker'); assert.ok((await guarded.complete(owner, job.id, acquired.lease!, { sensitiveMinor: '123456' }, '0')).deliverable);
  receiptAllowed = false; const accepted = await guarded.accept(owner, job.id); assert.equal(accepted.deliverable, undefined); assert.deepEqual(f.store.state.jobs[0].deliverable, { sensitiveMinor: '123456' });
  f.store.state.members.push({ id: 'owner2', name: 'Owner two', role: 'owner', active: true, epoch: 1, branches: ['*'] }); receiptAllowed = true;
  f.store.state.jobs[0].status = 'scheduled'; const paused = await guarded.pause({ memberId: 'owner2', role: 'owner', epoch: 1 }, job.id); assert.equal(paused.deliverable, undefined);
});
