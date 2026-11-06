// The run sheet's measured facts (Ink v2 wave 4, 4F1; W3's U6 and U7, catalogue O21): "Usually 3 to 5 min" only once
// three runs of the same playbook steps finished, from their measured working time; the run's scope frozen when it
// starts; a step that needs a connector that is only planned refuses the run to start; and each tool call's progress
// as an event with ids only, then its state and measured time on the tool line.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunView, PlaybookRecord, RunSummary } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { runEventFromActor } from '../runtime/venture/views/events.ts';
import { call, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup } from './venture-views-env.ts';
import * as controls from './venture-run-controls-env.ts';

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

test('measured working time: the time each approved turn took is added, never the time it waited for you', async () => {
  const env = await controls.setup();
  let run = await controls.startRun(env, [controls.READ, controls.DONE]);
  env.advance(minutes(20));
  env.models.inFlight = async () => { env.advance(minutes(2)); };
  run = await controls.approve(env, run);
  assert.equal(controls.record(env, run.id).harness!.workedMs, minutes(2));
});

test('scope: frozen on the record when the run starts and read back from runs.get; a later change does not move it', async () => {
  const env = await controls.setup();
  const run = await controls.startRun(env, [controls.READ, controls.DONE]);
  const stored = controls.record(env, run.id);
  assert.ok(stored.scope);
  assert.deepEqual(stored.scope!.tools, stored.harness!.grant);
  assert.equal(stored.scope!.posture, 'approve-each');
  const detail = await controls.getRun(env, run.id);
  assert.ok(detail.scope);
  assert.equal(detail.scope!.tools.length, stored.harness!.grant.length);
  assert.ok(detail.scope!.tools.includes('Read a client file'));
  assert.ok(detail.scope!.tools.includes('Matched the bank statement to the bills'));
  assert.equal(detail.scope!.cap, 'USD 0.2500');
  assert.equal(detail.scope!.posture, 'approve-each');
  assert.equal(detail.scope!.line, `Set when it started: ${detail.scope!.tools.length} tools, ${detail.scope!.actions.length === 1 ? '1 outside action' : `${detail.scope!.actions.length} outside actions`} it may propose for your approval, a spend cap of USD 0.2500, at approve each.`);
  await ventureAction(env.deps, controls.owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'shadow' }); });
  assert.equal((await controls.getRun(env, run.id)).scope!.posture, 'approve-each', 'frozen');
});

test('a step that needs a connector that is only planned refuses the run to start, and nothing is put in its place', async () => {
  const env = await controls.setup();
  const order = await controls.orderWithFiles(env);
  const playbook = await controls.call<PlaybookRecord>(env, 'venture.delivery.playbook');
  await ventureAction(env.deps, controls.owner, 'prepare', 'seed.needs', tx => {
    const current = tx.find('venture-playbook', playbook.id)!;
    tx.replace({ ...current, steps: current.steps.map(step => step.kind === 'work' ? { ...step, needs: [{ connector: 'linkedin', mode: 'write' as const }] } : step) });
  });
  controls.scriptTurns(env, [controls.READ]);
  await assert.rejects(controls.call(env, 'venture.delivery.run', { orderId: order.id }), (error: any) => {
    assert.equal(error.code, 'RUN_CAPABILITY_MISSING');
    assert.equal(error.message, 'This run needs posting to LinkedIn, which is planned. Nothing was put in its place.');
    return true;
  });
  assert.deepEqual(listRecords(env.store.read(), 'venture-delivery-run'), []);
  assert.equal(env.models.previewed.length, 0);
  // A step done by you never stops the agent's run.
  await ventureAction(env.deps, controls.owner, 'prepare', 'seed.needs', tx => {
    const current = tx.find('venture-playbook', playbook.id)!;
    tx.replace({ ...current, steps: current.steps.map(step => step.kind === 'work' ? { ...step, needs: undefined } : step.id === 'send' ? { ...step, needs: [{ connector: 'linkedin', mode: 'write' as const }] } : step) });
  });
  const run = await controls.call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(run.status, 'waiting-for-you');
});

test('per-call progress: each call sends run.call with ids and its state only; tool lines carry the state and measured time', async () => {
  const env = await controls.setup();
  let run = await controls.startRun(env, [controls.READ, controls.BROKEN, controls.DONE]);
  run = await controls.approve(env, run);
  const events = listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'run.call').sort((a, b) => a.seq - b.seq);
  assert.deepEqual(events.map(event => [(event.data as any).callId, (event.data as any).state]), [
    ['t1.1', 'start'], ['t1.1', 'done'], ['t1.2', 'start'], ['t1.2', 'done'], ['t1.3', 'start'], ['t1.3', 'done'],
  ]);
  for (const event of events) assert.deepEqual(Object.keys(event.data as object).sort(), ['callId', 'modelCallId', 'runId', 'state']);
  const frame = runEventFromActor({ seq: events[0].seq, name: events[0].name, data: events[0].data, at: events[0].at }, 'main')!;
  assert.deepEqual(Object.keys(frame).filter(key => !['at', 'businessId', 'runId', 'seq', 'type'].includes(key)), [], 'a frame carries ids only');
  assert.equal(frame.type, 'run.call');

  env.models.inFlight = async () => { env.advance(5000); };
  run = await controls.approve(env, run);
  const detail = await controls.getRun(env, run.id);
  const lines = detail.steps.flatMap(step => step.tools ?? []);
  assert.deepEqual(lines.slice(0, 3).map(line => [line.state, line.ms]), [['done', 0], ['done', 0], ['done', 0]]);
  assert.deepEqual(lines.slice(3).map(line => line.state), ['error', 'error']);
  const errors = listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'run.call' && (event.data as any).state === 'error');
  assert.equal(errors.length, 2);
});
