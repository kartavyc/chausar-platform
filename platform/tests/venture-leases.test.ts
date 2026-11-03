// Native session recovery after restart, without per-turn leases or automatic replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, seedBlueprint, seedOrder, seedRun, owner } from './venture-views-env.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { registerAgentJob } from '../runtime/venture/agent-runtime/lifecycle.ts';
import { launchAgentWork, waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { runsGetHandler } from '../runtime/venture/views/runs.ts';
import { queueListHandler } from '../runtime/venture/views/queue.ts';

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
  assert.match(stored.interrupted?.line ?? '', /Interrupted/);
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
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'waiting-for-you');
  assert.equal(interrupted, false);
});

test('a finished native draft waiting for review survives restart without being called interrupted', async t => {
  const env = await fixture(); t.after(() => env.job.close());
  await ventureAction(env.deps, owner, 'prepare', 'test.finished', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, status: 'ready-for-review', agentJob: { ...run.agentJob!, reviewReady: true } });
  });
  await sweepWholeJournal(env.deps, owner, 1);
  const stored = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stored.status, 'ready-for-review');
  assert.equal(stored.interrupted, undefined);
});

test('recovery preserves an unanswered durable question and work launching before session registration', async t => {
  const env = await fixture(); t.after(() => env.job.close());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  launchAgentWork(env.store, env.run.id, () => held);
  await sweepWholeJournal(env.deps, owner, 1);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'waiting-for-you');
  release(); await waitForAgentWork(env.store, env.run.id);
  await ventureAction(env.deps, owner, 'prepare', 'test.question', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, status: 'needs-answer', agentJob: { ...run.agentJob!, pendingFacts: { digest: 'question-digest', missing: [], question: 'Which period do these books cover?', callId: 'calc-question', at: tx.now } } });
  });
  await sweepWholeJournal(env.deps, owner, 1);
  const stored = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stored.status, 'needs-answer');
  assert.equal(stored.agentJob!.pendingFacts!.question, 'Which period do these books cover?');
  assert.equal(stored.interrupted, undefined);
});
