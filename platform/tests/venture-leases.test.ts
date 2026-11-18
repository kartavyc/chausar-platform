// Native session recovery after restart, without per-turn leases or automatic replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, seedBlueprint, seedOrder, seedRun, harness, owner } from './venture-views-env.ts';
import { recoverLeases } from '../runtime/venture/delivery/leases.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { registerAgentJob } from '../runtime/venture/agent-runtime/lifecycle.ts';
import { launchAgentWork, waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { runsGetHandler } from '../runtime/venture/views/runs.ts';
import { queueListHandler } from '../runtime/venture/views/queue.ts';
import { finishJob, handOver } from '../runtime/venture/delivery/run-machine.ts';

async function fixture() {
  const env = await setup(), { client, order } = await seedOrder(env, await seedBlueprint(env));
  const run = await seedRun(env, order, {});
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: consent.disclosureDigest });
  const job = await createNativeJob(env.deps, owner, run.id, { agentId: 'delivery', sections: ['Reply'], check: () => undefined });
  let dispatches = 0;
  env.deps.agentRoute = async () => { dispatches++; throw new Error('Recovery must never open an AI session'); };
  return { ...env, run, job, dispatches: () => dispatches };
}

test('opening a vault interrupts an orphan native session, keeps its evidence and never sends it again', async t => {
  const env = await fixture(); t.after(() => env.job.close());
  await ventureAction(env.deps, owner, 'prepare', 'test.orphan', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, agentJob: { ...run.agentJob!, messages: [{ id: 'saved', text: 'Saved work note.', label: 'model-estimate' }], tools: [{ id: 'read', name: 'read_order', status: 'done' }], ownerNotes: [{ text: 'Keep the draft short.', at: tx.now, by: owner.memberId }] } });
  });
  const sends = env.dispatches();
  await sweepWholeJournal(env.deps, owner, 1);
  const stored = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stored.status, 'stopped');
  assert.equal(stored.stopped?.reason, 'interrupted');
  assert.match(stored.stopped?.line ?? '', /Interrupted/);
  assert.equal(stored.agentJob!.messages[0].text, 'Saved work note.');
  assert.equal(stored.agentJob!.tools[0].status, 'done');
  assert.equal(stored.preview, null);
  assert.equal(env.dispatches(), sends);
  const detail = await runsGetHandler(env.deps, owner, { runId: env.run.id });
  assert.match(detail.stop?.line ?? '', /Interrupted/);
  assert.equal(detail.agentProgress?.canResume, true);
  const queue = await queueListHandler(env.deps, owner, { scope: 'current' });
  const row = queue.rows.find(row => row.viewRef?.id === env.run.id);
  assert.match(row?.line ?? '', /Interrupted/);
  assert.ok(row?.actions.some(action => action.id === 'resume'));
  await sweepWholeJournal(env.deps, owner, 1);
  assert.equal(env.dispatches(), sends, 'a repeated recovery never restarts AI work');
});

test('a recovery sweep leaves a registered current session alone', async t => {
  const env = await fixture(); t.after(() => env.job.close());
  let interrupted = false;
  t.after(registerAgentJob(env.store, env.job.capability.scope, () => { interrupted = true; }));
  await sweepWholeJournal(env.deps, owner, 1);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'working');
  assert.equal(interrupted, false);
});

test('a finished native draft waiting for review survives restart without being called interrupted', async t => {
  const env = await fixture(); t.after(() => env.job.close());
  await ventureAction(env.deps, owner, 'prepare', 'test.finished', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace(finishJob(handOver({ ...run, renderedText: run.renderedText ?? 'Draft', agentJob: { ...run.agentJob!, draftDigest: run.agentJob!.draftDigest ?? 'draft' } })));
  });
  await sweepWholeJournal(env.deps, owner, 1);
  const stored = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stored.status, 'ready-for-review');
  assert.equal(stored.stopped, undefined);
});

test('recovery preserves an unanswered durable question and work launching before session registration', async t => {
  const env = await fixture(); t.after(() => env.job.close());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  launchAgentWork(env.store, env.run.id, () => held);
  await sweepWholeJournal(env.deps, owner, 1);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'working');
  release(); await waitForAgentWork(env.store, env.run.id);
  await ventureAction(env.deps, owner, 'prepare', 'test.question', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, status: 'needs-answer', agentJob: { ...run.agentJob!, pendingFacts: { digest: 'question-digest', missing: [], question: 'Which period do these books cover?', callId: 'calc-question', at: tx.now } } });
  });
  await sweepWholeJournal(env.deps, owner, 1);
  const stored = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stored.status, 'needs-answer');
  assert.equal(stored.agentJob!.pendingFacts!.question, 'Which period do these books cover?');
  assert.equal(stored.stopped, undefined);
});

test('opening a vault leaves no run alive without a session: a job that never opened, and a draft whose job never finished, are interrupted', async () => {
  const env = await setup(), plan = await seedBlueprint(env);
  const orders = [await seedOrder(env, plan), await seedOrder(env, plan), await seedOrder(env, plan)].map(item => item.order);
  // Chausar closed between storing the run and opening its AI job: the older sweep left this one working for ever.
  const unopened = await seedRun(env, orders[0], {});
  const unfinished = await seedRun(env, orders[1], { status: 'finishing', renderedText: 'Draft' });
  const ready = await seedRun(env, orders[2], { status: 'ready-for-review', servedBy: 'template', renderedText: 'Outline' });
  assert.deepEqual(await recoverLeases(env.deps, owner, 30 * 60_000), [], 'an ordinary tick cuts nothing, so startup work is safe');
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', unopened.id)!.status, 'working');
  await sweepWholeJournal(env.deps, owner, 1);
  const read = (id: string) => findRecord(env.store.read(), 'venture-delivery-run', id)!;
  assert.deepEqual([read(unopened.id).status, read(unopened.id).stopped?.reason], ['stopped', 'interrupted']);
  assert.deepEqual([read(unfinished.id).status, read(unfinished.id).stopped?.reason, read(unfinished.id).renderedText], ['stopped', 'interrupted', 'Draft'], 'the draft it handed over is kept');
  assert.equal(read(ready.id).status, 'ready-for-review', 'a draft waiting for the verdict is not a job');
  assert.deepEqual(await recoverLeases(env.deps, owner, 1), [], 'nothing is interrupted twice');
});

test('opening a vault stores an older build\'s runs as runs of today, and marks a stopped run a newer job replaced', async () => {
  const env = await setup(), { order } = await seedOrder(env, await seedBlueprint(env));
  const raw = (id: string) => env.store.read().conversations.find((record: any) => record?.id === id) as any;
  // Written as the older build wrote them: no lifecycle stamp, the old words, the booleans that told states apart.
  const old = async (fields: Record<string, unknown>) => (await seedRun(env, order, { lifecycle: undefined, ...fields } as never)).id;
  const stoppedFirst = await old({ status: 'stopped' });
  env.advance(1000);
  const accepted = await old({ status: 'accepted', verdict: { choice: 'accepted', reason: null, at: env.now() } });
  env.advance(1000);
  const loop = await old({ status: 'waiting-for-you', callId: 'call_old', preview: { callId: 'call_old' }, harness: harness({ phase: 'act' }) });
  assert.equal(raw(loop).status, 'waiting-for-you', 'stored as the older build left it');
  await sweepWholeJournal(env.deps, owner, 1);
  assert.deepEqual([raw(stoppedFirst).status, raw(stoppedFirst).stopped.reason, raw(stoppedFirst).lifecycle], ['stopped', 'superseded', 2], 'a newer run of the order exists, and that is now stored');
  assert.deepEqual([raw(accepted).status, raw(accepted).lifecycle, raw(accepted).verdict.choice], ['accepted', 2, 'accepted']);
  assert.deepEqual([raw(loop).status, raw(loop).stopped.reason, raw(loop).lifecycle, raw(loop).preview], ['stopped', 'old-build', 2, null], 'the old loop cannot go on in this build');
  const queue = await queueListHandler(env.deps, owner, { scope: 'current' });
  const row = queue.rows.find(item => item.viewRef?.id === loop);
  assert.match(row?.line ?? '', /older version of Chausar/);
  assert.deepEqual(row?.actions.map(action => action.id), ['run-again'], 'it offers a fresh job, never a resume');
});
