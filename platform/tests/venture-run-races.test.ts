// Run controls under races (Ink v2 wave 4, 4F1 review): a Force stop and a Resume while the cut turn is still out, two
// steer notes at once, a Stop between an approval's checks and its claim, a steer overlapping an approval, the run.call
// events of a cut turn, and the readback screen on the owner's notes. In every case the owner's words reach exactly one
// turn's text, nothing goes out twice, and the journal says honestly whether a call went out.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { DeliveryRunView, RunControlResult, RunDetail } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import {
  DONE, READ, RECONCILE, approve, call, code, decide, controlRow, getRun, record, setup, startRun, stop, turnOf,
} from './venture-run-controls-env.ts';
import * as views from './venture-views-env.ts';

const PYTHON = 'def transform(row):\n    return {"kind": "supplies"}';
const TWO_SANDBOX = turnOf('Two sandbox runs', [['sandbox.python', { table: 'f2', code: PYTHON }], ['sandbox.python', { table: 'f2', code: PYTHON }]]);
const journalOf = (env: Awaited<ReturnType<typeof setup>>, subject: string) =>
  listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.subject === subject);

test('force stop then resume while the cut turn is out: resume waits, the cut turn runs nothing more, its send stays sent and its cost counts', async () => {
  const env = await setup();
  const run = await startRun(env, [TWO_SANDBOX, DONE]);
  let refused: unknown = null;
  env.container = async () => {
    await stop(env, run.id, true);
    refused = await call(env, 'venture.runs.resume', { runId: run.id }).then(() => null, error => error);
  };
  const after = await approve(env, run);
  assert.equal((refused as { code?: string } | null)?.code, 'RUN_NOT_STOPPED', 'resume waits for the cut step to come back');
  assert.match((refused as Error).message, /still coming back/);
  assert.equal(env.containerRuns, 1, 'the second call of the cut turn never ran');
  assert.equal(after.status, 'stopped');
  const stored = record(env, run.id);
  assert.equal(stored.harness!.used.costMicros, '200', 'what the cut call cost counts');
  assert.deepEqual(journalOf(env, `${run.id}:${run.callId}`).map(entry => entry.state), ['applied'], 'the cut call went out and the journal says so');
  // Once it came back, Resume goes on, and keeps the cost.
  const resumed = await call<RunControlResult>(env, 'venture.runs.resume', { runId: run.id });
  assert.equal(resumed.line, 'Resumed. Approve the next step when you are ready.');
  assert.equal(record(env, run.id).harness!.used.costMicros, '200');
});

test('two steer notes at once: each reaches exactly one turn text, and none is marked picked up without being in it', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, RECONCILE, DONE]);
  await Promise.all([
    call(env, 'venture.runs.steer', { runId: run.id, text: 'NOTE-ALPHA use the cafe account.' }),
    call(env, 'venture.runs.steer', { runId: run.id, text: 'NOTE-BRAVO skip the bills.' }),
  ]);
  const live = record(env, run.id);
  const inText = ['NOTE-ALPHA', 'NOTE-BRAVO'].filter(note => live.preview!.payloadText.includes(note));
  assert.ok(inText.length >= 1);
  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  const sheet = (await getRun(env, run.id)).steer!;
  for (const note of sheet) {
    const tag = note.text.slice(0, 10);
    assert.equal(note.line, inText.includes(tag) ? 'Picked up in turn 1' : 'Sent. Waiting for the agent to pick it up.', tag);
    if (!inText.includes(tag)) assert.ok(run.preview!.payloadText.includes(tag), `${tag} rides with the next turn`);
  }
});

test('a stop between an approval and its claim releases the call: nothing is sent or charged, and the journal says not sent', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, RECONCILE, DONE]);
  const original = env.models.runPreview.bind(env.models);
  let line = '';
  (env.models as unknown as { runPreview: unknown }).runPreview = async (...args: Parameters<typeof original>) => {
    (env.models as unknown as { runPreview: unknown }).runPreview = original;
    line = (await stop(env, run.id)).line;
    return original(...args);
  };
  const sent = env.models.sent;
  await assert.rejects(approve(env, run), code('APPROVAL_STALE'));
  assert.equal(line, 'Stopped by you. Finished steps are kept.');
  assert.equal(env.models.sent, sent, 'nothing was sent');
  assert.equal(record(env, run.id).status, 'stopped');
  assert.equal(record(env, run.id).harness!.used.costMicros, '0');
  assert.deepEqual(journalOf(env, `${run.id}:${run.callId}`).map(entry => entry.state), ['rejected']);
});

test('a steer overlapping an approval leaves the turn in flight alone: the note waits for the next turn', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, RECONCILE, DONE]);
  const original = env.models.preview.bind(env.models);
  let approving: Promise<DeliveryRunView> | null = null;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let out!: () => void;
  const isOut = new Promise<void>(resolve => { out = resolve; });
  (env.models as unknown as { preview: unknown }).preview = async (...args: Parameters<typeof original>) => {
    (env.models as unknown as { preview: unknown }).preview = original;
    env.models.inFlight = async () => { out(); await held; };
    approving = approve(env, run);
    await isOut;
    return original(...args);
  };
  await call(env, 'venture.runs.steer', { runId: run.id, text: 'NOTE-X please.' });
  const mid = record(env, run.id);
  assert.equal(mid.callId, run.callId, 'the turn in flight keeps its call');
  release();
  const done = await approving!;
  assert.equal(done.status, 'waiting-for-you');
  assert.deepEqual(journalOf(env, `${run.id}:${run.callId}`).map(entry => entry.state), ['applied']);
  const stored = record(env, run.id);
  assert.deepEqual([stored.harness!.used.turns, stored.harness!.used.costMicros], [1, '200']);
  assert.ok(stored.preview!.payloadText.includes('NOTE-X please.'), 'the note rides with the next turn');
  assert.equal((await getRun(env, run.id)).steer![0].line, 'Sent. Waiting for the agent to pick it up.');
});

test('the run sheet shows only the calls of the turn out now, matched by its model call, never a cut turn\'s', async () => {
  const env = await setup();
  const CUT = turnOf('Sort the bills', [['files.list', {}], ['sandbox.python', { table: 'f2', code: PYTHON }], ['files.read', { target: 'f1', part: 'sample' }]]);
  const REDO = turnOf('Sort the bills again', [['sandbox.python', { table: 'f2', code: PYTHON }], ['files.list', {}]]);
  const run = await startRun(env, [CUT, REDO, DONE]);
  env.container = async () => { await stop(env, run.id, true); };
  await approve(env, run);
  await call(env, 'venture.runs.resume', { runId: run.id });
  const live = record(env, run.id);
  let sheet: RunDetail | null = null;
  env.container = async () => { sheet = await getRun(env, run.id); };
  await approve(env, { ...run, preview: live.preview, callId: live.callId });
  assert.deepEqual(sheet!.live, [{ callId: 't1.1', state: 'start' }]);
  const events = listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'run.call');
  for (const event of events) assert.deepEqual(Object.keys(event.data as object).sort(), ['callId', 'modelCallId', 'runId', 'state'], 'ids only');
});

test('notes and Continue words pass the readback screen: card, Aadhaar, bank account and OTP never reach the agent', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, RECONCILE, DONE]);
  const card = ['4111', '1111', '1111', '1111'].join(' ');
  await call(env, 'venture.runs.steer', { runId: run.id, text: `Pay with card ${card}, the OTP is 482913.` });
  const text = record(env, run.id).preview!.payloadText;
  assert.ok(!text.includes(card) && text.includes('[redacted card number]'));
  assert.ok(!text.includes('482913') && text.includes('[redacted OTP]'));

  await call(env, 'venture.runs.roundGate', { runId: run.id, on: true });
  const live = record(env, run.id);
  await approve(env, { ...run, preview: live.preview, callId: live.callId });
  const row = (await controlRow(env, run.id))!;
  await decide(env, row, 'continue', `Use card ${card} for the fee.`);
  const next = record(env, run.id).preview!.payloadText;
  assert.ok(!next.includes(card) && next.includes('[redacted card number]'));
});

test('pause and away cover rehearsals and the improvement loop too: no phone or agent caller spends meanwhile', async () => {
  const env = await views.setup();
  await views.seedBlueprint(env);
  const phone: Context = views.phone;
  const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
  const run = (method: string, ctx: Context, payload: unknown = {}) => (delivery as Record<string, (d: unknown, c: Context, p: unknown) => Promise<unknown>>)[method](env.deps, ctx, payload);
  await views.call(env, 'venture.business.pause', { paused: true });
  await assert.rejects(run('venture.simulation.run', phone, { useTemplate: true }), code('BUSINESS_PAUSED'));
  await assert.rejects(run('venture.simulation.run', views.owner, { useTemplate: true }), code('BUSINESS_PAUSED'));
  await assert.rejects(run('venture.improve.run', agent), code('BUSINESS_PAUSED'));
  await views.call(env, 'venture.business.pause', { paused: false });
  await views.call(env, 'venture.away.set', { from: '2026-10-15', to: '2026-10-20' });
  await assert.rejects(run('venture.simulation.run', agent, { useTemplate: true }), code('BUSINESS_PAUSED'));
  await assert.rejects(run('venture.improve.run', phone), code('BUSINESS_PAUSED'));
});
