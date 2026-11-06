// Leases (Ink v2 wave 4, package 4J13; catalogue H34): an approve call in flight holds a renewable lease on its run, a
// dated recheck with a reason; a second approval meanwhile finds the run held; when the engine dies the lease runs out
// and the run goes back to waiting, stopped with "Interrupted: Chausar stopped while this ran. Nothing was sent again."
// The call is never sent again; the finished steps and each cut step's state (running, done, error) survive the
// restart; Resume continues from there with a fresh preview that waits for approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, DeliveryRunView, RunLease } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { INTERRUPTED_LINE, LEASE_HOLDER, LEASE_MS, LEASE_REASON, heldHere, leaseDead, takeRunLease } from '../runtime/venture/delivery/leases.ts';
import { DONE, PYTHON, READ, RECONCILE, REPORT, START, approve, call, getRun, owner, queue, record, seedOrder, startRun, type Env, setup } from './venture-run-controls-env.ts';

/** What an engine that died with the run's call out left behind: its lease, the call claimed, two steps' events. */
async function crashedWith(env: Env, runId: string, takenAgoMs: number, claimed = true): Promise<RunLease> {
  const run = record(env, runId);
  const takenAt = new Date(env.deps.clock().getTime() - takenAgoMs).toISOString();
  const lease: RunLease = { holder: 'engine_dead', token: 'lease_dead', callId: run.callId!, takenAt, expiresAt: new Date(Date.parse(takenAt) + LEASE_MS).toISOString(), reason: LEASE_REASON };
  if (claimed) await env.store.update(state => { const call = state.conversations.find(item => item?.id === run.callId); if (call) call.status = 'dispatching'; });
  await ventureAction(env.deps, owner, 'prepare', 'test.crash', tx => {
    tx.replace<DeliveryRunRecord>({ ...tx.find('venture-delivery-run', runId)!, lease });
    tx.emit('run.call', { runId, callId: 't2.1', state: 'start', modelCallId: run.callId });
    tx.emit('run.call', { runId, callId: 't2.1', state: 'done', modelCallId: run.callId });
    tx.emit('run.call', { runId, callId: 't2.2', state: 'start', modelCallId: run.callId });
  });
  return lease;
}

test('an approved call holds a lease on its run while it is out, with its reason and expiry; it is gone once the call is back', async () => {
  const env = await setup();
  const run = await startRun(env, [PYTHON, DONE]);
  let during: DeliveryRunRecord | null = null;
  let second: unknown = null;
  let swept: string[] = [];
  let heldDuring = false;
  let lease2: unknown = null;
  env.container = async () => {
    during = record(env, run.id);
    // A second approval of the same step while it runs: refused, nothing more is sent.
    second = await approve(env, run).catch(error => error);
    heldDuring = heldHere(during!.lease!);
    // The lease itself refuses a second holder while this one lives.
    lease2 = await takeRunLease(env.deps, owner, run.id, run.callId!).catch(error => error);
    // A sweep while this process holds it, even one that treats every old lease as dead, leaves it alone.
    await routineTick(env.deps, owner, 1);
    swept = listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'run.stopped').map(event => String((event.data as { runId?: unknown }).runId));
  };
  const sent = env.models.sent;
  const after = await approve(env, run);
  const lease = during!.lease!;
  assert.deepEqual([lease.holder, lease.callId, lease.reason, lease.takenAt, lease.expiresAt], [LEASE_HOLDER, run.callId, LEASE_REASON, START, new Date(Date.parse(START) + LEASE_MS).toISOString()]);
  assert.equal(heldHere(lease), false, 'released once the call came back');
  assert.ok((second as { code?: string } | null)?.code, 'the second approval was refused');
  assert.equal(heldDuring, true, 'this process held it while the call was out');
  assert.equal((lease2 as { code?: string }).code, 'DELIVERY_NOT_WAITING');
  assert.equal((lease2 as Error).message, 'This step is already running. Wait for it to come back.');
  assert.equal(env.models.sent, sent + 1, 'the step was sent once');
  assert.deepEqual(swept, [], 'a lease this process holds is never taken for dead');
  assert.equal(after.status, 'waiting-for-you');
  assert.equal(record(env, run.id).lease ?? null, null);
});

test('the engine died with a call out: the lease runs out, the run goes back to waiting, nothing is sent again, Resume goes on', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, RECONCILE, DONE]);
  run = await approve(env, run); // the first turn finished and was stored
  const finished = record(env, run.id).harness!.toolCalls.map(item => [item.id, item.outcome]);
  const lease = await crashedWith(env, run.id, 0);
  const sent = env.models.sent;

  // Before the lease runs out, an ordinary sweep leaves the run as it is.
  env.advance(LEASE_MS - 1000);
  await routineTick(env.deps, owner);
  assert.equal(record(env, run.id).status, 'waiting-for-you');
  assert.ok(leaseDead(lease, env.deps.clock().getTime() + 2000));

  env.advance(2000);
  await routineTick(env.deps, owner);
  const stored = record(env, run.id);
  assert.deepEqual([stored.status, stored.callId, stored.preview, stored.lease], ['stopped', null, null, null]);
  assert.equal(stored.harness!.control?.line, INTERRUPTED_LINE);
  const earlier = finished.map(([callId, outcome]) => ({ callId: String(callId), state: outcome === 'succeeded' ? 'done' : outcome === 'cancelled' ? 'skipped' : 'error' }));
  assert.deepEqual(stored.interrupted?.steps, [...earlier, { callId: 't2.1', state: 'done' }, { callId: 't2.2', state: 'running' }], "each step's state survives");
  assert.deepEqual(stored.harness!.toolCalls.map(item => [item.id, item.outcome]), finished, 'the finished steps are kept as they were');
  const detail = await getRun(env, run.id);
  assert.deepEqual(detail.stop, { state: 'stopped', line: INTERRUPTED_LINE });
  assert.deepEqual(detail.interrupted, { at: stored.interrupted!.at, line: INTERRUPTED_LINE, steps: stored.interrupted!.steps }, 'the run sheet reads it');
  const row = (await queue(env)).rows.find(item => item.id.startsWith('runctl:') && item.viewRef?.id === run.id);
  assert.equal(row?.line, INTERRUPTED_LINE);
  assert.equal(env.models.sent, sent, 'nothing was sent again');
  // The old call can never be approved again.
  await assert.rejects(approve(env, run));
  assert.equal(env.models.sent, sent);

  // Resume continues from what was stored: a fresh preview of the cut step, waiting for approval.
  await call(env, 'venture.runs.resume', { runId: run.id });
  const resumed = record(env, run.id);
  assert.equal(resumed.status, 'waiting-for-you');
  assert.notEqual(resumed.callId, run.callId);
  assert.equal(env.models.sent, sent, 'resuming sends nothing until the owner approves');
  const done = await approve(env, { ...run, callId: resumed.callId, preview: resumed.preview });
  assert.equal(env.models.sent, sent + 1);
  assert.equal(done.status, 'waiting-for-you');
});

test('when a vault opens, a lease left by the engine before is dead at once; a stale lease on a run that moved on is only cleared', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, DONE]);
  // This engine died after taking the lease and before the call was claimed: the waiting preview is voided.
  await crashedWith(env, run.id, 1000, false);
  // The sweep when a vault opens: nothing of this process was in flight then.
  await sweepWholeJournal(env.deps, owner, 1);
  assert.equal(record(env, run.id).status, 'stopped');
  assert.equal(record(env, run.id).interrupted?.line, INTERRUPTED_LINE);
  const call = env.store.read().conversations.find(item => item?.id === run.callId) as { status?: string };
  assert.equal(call.status, 'expired', 'the preview the dead engine never claimed can never be sent');

  const env2 = await setup();
  run = await startRun(env2, [READ, DONE]);
  run = await approve(env2, run);
  const moved = record(env2, run.id);
  await ventureAction(env2.deps, owner, 'prepare', 'test.stale', tx => {
    tx.replace<DeliveryRunRecord>({ ...moved, lease: { holder: 'engine_dead', token: 'lease_old', callId: 'call_gone', takenAt: '2026-10-16T09:00:00.000Z', expiresAt: '2026-10-16T09:02:00.000Z', reason: LEASE_REASON } });
  });
  await routineTick(env2.deps, owner);
  const after = record(env2, run.id);
  assert.equal(after.lease, null);
  assert.deepEqual([after.status, after.callId, after.interrupted], [moved.status, moved.callId, undefined]);
});

test('a one-step run cut by a crash reads Interrupted on Today and the run sheet, never Stopped by you; Resume clears it', async () => {
  const env = await setup();
  const order = await seedOrder(env);
  env.models.respond.delivery = () => REPORT;
  const run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(record(env, run.id).harness ?? null, null, 'one step, no loop state');
  await crashedWith(env, run.id, 0);
  env.advance(LEASE_MS + 1000);
  await routineTick(env.deps, owner);
  const stored = record(env, run.id);
  assert.equal(stored.status, 'stopped');
  const detail = await getRun(env, run.id);
  assert.equal(detail.stop?.line, INTERRUPTED_LINE);
  assert.equal(detail.interrupted?.line, INTERRUPTED_LINE);
  const row = (await queue(env)).rows.find(item => item.id.startsWith('runctl:') && item.viewRef?.id === run.id);
  assert.equal(row?.line, INTERRUPTED_LINE);
  await call(env, 'venture.runs.resume', { runId: run.id });
  assert.equal(record(env, run.id).interrupted, undefined, 'the interruption is over once resumed');
  assert.equal((await getRun(env, run.id)).interrupted, undefined);
});
