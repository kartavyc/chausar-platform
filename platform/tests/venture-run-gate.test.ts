// The owner's gate after each round (Ink v2 wave 4, 4F1; catalogue O2): with the gate on, a run waits on Today after
// every round (or every few rounds) with what the round did, Continue or Stop. Continue can carry the owner's words
// into the next turn, used once. A limit asks "Allow 2 more turns?" once; failures and refusals ask at once; three
// rounds that end the same way stop the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunView, RunControlResult } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import {
  BROKEN, CLIENT, DONE, READ, RECONCILE, approve, call, code, controlRow, decide, getRun, lookAround, owner, phone, record, seedOrder, setup, startRun, stop,
} from './venture-run-controls-env.ts';

const gate = (env: Parameters<typeof call>[0], runId: string, on: boolean, every?: number) =>
  call<RunControlResult>(env, 'venture.runs.roundGate', every === undefined ? { runId, on } : { runId, on, every });

test('round gate: after each round the run waits on Today with what the round did; Continue carries words once; Stop stops', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, RECONCILE, READ, DONE]);
  await assert.rejects(gate(env, run.id, true, 4), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.runs.roundGate', { runId: run.id, on: true }, phone), code('APP_APPROVAL_REQUIRED'));
  const set = await gate(env, run.id, true);
  assert.equal(set.line, 'The run waits for you after every round.');
  assert.deepEqual(set.run.gate, { on: true, every: 1, waiting: null });

  run = await approve(env, run);
  const waiting = record(env, run.id);
  assert.deepEqual([waiting.status, waiting.callId, waiting.preview], ['waiting-for-you', null, null], 'nothing is previewed until you say');
  assert.equal(waiting.harness!.gate!.waiting!.reason, 'finished');
  const row = (await controlRow(env, run.id))!;
  assert.equal(row.kind, 'question');
  assert.equal(row.title, `Round 1 of the draft for ${CLIENT} is done: 3 tool calls, 0 failed. Continue or stop?`);
  assert.deepEqual(row.actions.map(item => [item.id, item.primary]), [['stop', false], ['continue', true]]);
  const sheet = await getRun(env, run.id);
  assert.equal(sheet.gate?.waiting?.line, 'Round 1 is done: 3 tool calls, 0 failed.');

  const continued = await decide(env, row, 'continue', 'Reconcile now, the files look complete.');
  assert.equal(continued.outcome, 'done');
  assert.equal(continued.line, 'The run goes on. Approve the next step when you are ready.');
  let live = record(env, run.id);
  assert.ok(live.preview!.payloadText.includes('Reconcile now, the files look complete.'), 'the words go into the next turn');
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  const second = (await controlRow(env, run.id))!;
  assert.equal(second.title, `Round 2 of the draft for ${CLIENT} is done: 1 tool call, 0 failed. Continue or stop?`);
  await decide(env, second, 'continue');
  live = record(env, run.id);
  assert.ok(!live.preview!.payloadText.includes('Reconcile now'), 'used once');

  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  const third = (await controlRow(env, run.id))!;
  const stopped = await decide(env, third, 'stop');
  assert.equal(stopped.line, 'Stopped by you. Finished steps are kept.');
  assert.equal(record(env, run.id).status, 'stopped');
});

test('round gate every 2 rounds; turned off it stops asking, and a gate cannot be set on a finished run', async () => {
  const env = await setup();
  // Reading turns that differ, so the repeat-failure breaker (4F2) does not take three of the same for a loop.
  let run = await startRun(env, [lookAround(0), lookAround(1), lookAround(2), DONE]);
  assert.equal((await gate(env, run.id, true, 2)).line, 'The run waits for you after every 2 rounds.');
  run = await approve(env, run);
  assert.equal(run.status, 'waiting-for-you');
  assert.ok(run.preview, 'round 1: no gate');
  run = await approve(env, run);
  assert.equal(record(env, run.id).harness!.gate!.waiting!.round, 2);
  // Turning the gate off goes on at once with the next turn.
  const off = await gate(env, run.id, false);
  assert.equal(off.line, 'The round gate is off.');
  const live = record(env, run.id);
  assert.ok(live.preview && live.harness!.gate!.waiting === null);
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  assert.ok(run.preview, 'no gate after round 3');
  const done = await ventureAction(env.deps, owner, 'prepare', 'seed.done', tx => tx.replace({ ...record(env, run.id), status: 'accepted' as const }));
  await assert.rejects(gate(env, done.id, true), code('RUN_NOT_RUNNING'));
});

test('round gate at a limit: "Allow 2 more turns?" raises the turns once, then the next limit writes it up', async () => {
  const env = await setup();
  let run = await startRun(env, [0, 1, 2, 3, 4, 5].map(lookAround));
  await gate(env, run.id, true, 5);
  for (let i = 0; i < 4; i += 1) {
    const live = record(env, run.id);
    if (live.preview) run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  }
  const limit = record(env, run.id);
  assert.equal(limit.harness!.gate!.waiting!.reason, 'limit');
  let row = (await controlRow(env, run.id))!;
  assert.equal(row.title, `The draft for ${CLIENT} used all its turns. Allow 2 more turns?`);
  assert.deepEqual(row.actions.map(item => [item.id, item.label]), [['stop', 'Stop'], ['continue', 'Allow 2 more turns']]);
  await decide(env, row, 'continue');
  let live = record(env, run.id);
  assert.deepEqual([live.harness!.limits.maxTurns, live.harness!.phase, live.harness!.gate!.extraTurns], [6, 'act', 2]);
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  // Round 5 is a fifth round, so the gate asks as usual.
  row = (await controlRow(env, run.id))!;
  assert.equal(record(env, run.id).harness!.gate!.waiting!.reason, 'finished');
  await decide(env, row, 'continue');
  live = record(env, run.id);
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  row = (await controlRow(env, run.id))!;
  assert.equal(record(env, run.id).harness!.gate!.waiting!.reason, 'limit');
  assert.equal(row.actions.find(item => item.id === 'continue')!.label, 'Write it up', 'the turns rise once');
  await decide(env, row, 'continue');
  live = record(env, run.id);
  assert.equal(live.harness!.limits.maxTurns, 6);
  assert.equal(live.harness!.phase, 'write');
  const { models } = env;
  assert.equal(models.previewed.at(-1)!.purpose, 'delivery');
});

test('round gate: failures ask at once, and three rounds that end the same way stop the run', async () => {
  const env = await setup();
  let run = await startRun(env, [BROKEN, BROKEN, BROKEN, DONE]);
  await gate(env, run.id, true, 5);
  run = await approve(env, run);
  let live = record(env, run.id);
  assert.equal(live.harness!.gate!.waiting!.reason, 'failures');
  let row = (await controlRow(env, run.id))!;
  assert.equal(row.title, `Round 1 of the draft for ${CLIENT} ended with 2 failures in a row: 2 tool calls, 2 failed. Continue or stop?`);
  assert.equal((await getRun(env, run.id)).gate?.waiting?.line, 'Round 1 ended with 2 failures in a row: 2 tool calls, 2 failed.');
  await decide(env, row, 'continue');
  live = record(env, run.id);
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  row = (await controlRow(env, run.id))!;
  await decide(env, row, 'continue');
  live = record(env, run.id);
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  live = record(env, run.id);
  assert.equal(live.status, 'stopped');
  const detail = await getRun(env, run.id);
  assert.deepEqual(detail.stop, { state: 'stopped', line: 'Stopped: three rounds ended the same way.' });
  const stoppedRow = (await controlRow(env, run.id))!;
  assert.equal(stoppedRow.line, 'Stopped: three rounds ended the same way.');
  await assert.rejects(stop(env, run.id), code('RUN_ALREADY_STOPPED'));
});

test('round gate: a one-step run has no rounds to gate', async () => {
  const env = await setup();
  const order = await seedOrder(env);
  env.models.respond.delivery = () => ({ title: 'x', sections: [], questionsForClient: [] });
  const run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(run.harness, undefined);
  await assert.rejects(gate(env, run.id, true), code('INVALID_VENTURE_REQUEST'));
});
