// Existing measured history is the only source of duration estimates. Native jobs expose their scoped identity,
// never fabricated working times or retired fixed-turn caps; planned connectors cannot be silently substituted.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlaybookRecord, RunSummary } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { call, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup } from './venture-views-env.ts';
import * as controls from './venture-run-controls-env.ts';
import { consentForOrder } from './fixtures/venture/scripted-agent.ts';

const minutes = (n: number) => n * 60_000;

test('estimates: "Usually 3 to 5 min" from the last five finished runs of the same playbook steps, only once three finished', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as PlaybookRecord;
  const finished = async (worked: number, hash = playbook.hash) => {
    env.advance(1000);
    return seedRun(env, order, { status: 'accepted', playbookId: playbook.id, playbookHash: hash, harness: harness({ phase: 'done', workedMs: worked }) });
  };
  await finished(minutes(3));
  await finished(minutes(5));
  await finished(minutes(30), 'another-hash');
  env.advance(1000);
  const live = await seedRun(env, order, { status: 'waiting-for-you', playbookId: playbook.id, playbookHash: playbook.hash, harness: harness() });
  const summary = async () => (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', {})).runs.find(item => item.runId === live.id)!;
  assert.equal((await summary()).usually, undefined, 'two finished runs are not enough');

  await finished(minutes(4));
  assert.equal((await summary()).usually, 'Usually 3 to 5 min');
  assert.equal((await call<{ usually?: string }>(env, 'venture.runs.get', { runId: live.id })).usually, 'Usually 3 to 5 min');
  for (let i = 0; i < 3; i += 1) await finished(minutes(4) + 20_000);
  assert.equal((await summary()).usually, 'Usually 4 to 5 min', 'the last five only');
  await finished(minutes(4));
  assert.equal((await summary()).usually, 'Usually 4 min');
  const done = (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', { state: 'done' })).runs;
  assert.ok(done.every(item => item.usually === undefined), 'a finished run carries no estimate');
});

test('native job identity stays bound to its original order and exposes no retired fixed-turn scope', async () => {
  const env = await controls.setup(), run = await controls.startNativeDraft(env);
  assert.equal(run.status, 'ready-for-review');
  const original = structuredClone(controls.record(env, run.id).agentJob!.scope);
  assert.equal(original.orderId, run.orderId);
  assert.equal(original.runId, run.id);
  const detail = await controls.getRun(env, run.id);
  assert.equal(detail.scope, undefined);
  assert.equal(detail.usually, undefined, 'no duration estimate without measured comparable history');
  await ventureAction(env.deps, controls.owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'shadow' }); });
  assert.deepEqual(controls.record(env, run.id).agentJob!.scope, original);
});

test('a step that needs a connector that is only planned refuses the run to start, and nothing is put in its place', async () => {
  const env = await controls.setup();
  const order = await controls.orderWithFiles(env);
  const playbook = await controls.call<PlaybookRecord>(env, 'venture.delivery.playbook');
  await ventureAction(env.deps, controls.owner, 'prepare', 'seed.needs', tx => {
    const current = tx.find('venture-playbook', playbook.id)!;
    tx.replace({ ...current, steps: current.steps.map(step => step.kind === 'work' ? { ...step, needs: [{ connector: 'linkedin', mode: 'write' as const }] } : step) });
  });
  await consentForOrder(env.deps, controls.owner, order.id);
  await assert.rejects(controls.call(env, 'venture.delivery.run', { orderId: order.id }), (error: any) => {
    assert.equal(error.code, 'RUN_CAPABILITY_MISSING');
    assert.equal(error.message, 'This job needs posting to LinkedIn, which is planned. Nothing was put in its place.');
    return true;
  });
  assert.deepEqual(listRecords(env.store.read(), 'venture-delivery-run'), []);
  assert.equal(env.models.previewed.length, 0);
  // A step done by you never stops the agent's run.
  await ventureAction(env.deps, controls.owner, 'prepare', 'seed.needs', tx => {
    const current = tx.find('venture-playbook', playbook.id)!;
    tx.replace({ ...current, steps: current.steps.map(step => step.kind === 'work' ? { ...step, needs: undefined } : step.id === 'send' ? { ...step, needs: [{ connector: 'linkedin', mode: 'write' as const }] } : step) });
  });
  const run = await controls.startNativeDraft(env, { order });
  assert.equal(run.status, 'ready-for-review');
});
