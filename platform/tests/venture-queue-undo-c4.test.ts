// One-shot C4 task 15: a draft's reject can be undone until the agent acts on it. Undoing returns the run to waiting on
// the owner exactly as it was, and withdraws the correction signal, so the improvement loop never learns from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunView, QueueDecision, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { correctionCases } from '../runtime/venture/delivery/corrections.ts';
import { listScenarios } from '../runtime/venture/delivery/scenarios.ts';
import { liveSignals } from '../runtime/venture/delivery/check-signals.ts';
import { call, code, record, seedOrder, setup, startNativeDraft, type Env } from './venture-run-controls-env.ts';

const part = (text: string) => ({ kind: 'text', text, ref: '' });
const report = (first: string) => ({
  title: 'Your September books', questionsForClient: [], sections: [
    { heading: 'Summary', parts: [part(first)] },
    { heading: 'What we will do', parts: [part('We will match each payment to a bill.')] },
    { heading: 'What we need from you', parts: [part('Please send the bank statement.')] },
    { heading: 'Next steps', parts: [part('The fee for the month is below.'), { kind: 'figure', text: '', ref: 'order.total' }] },
  ],
});

const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const draftRow = async (env: Env) => (await queue(env)).rows.find(item => item.kind === 'draft')!;
const reject = (env: Env, row: QueueRow) => call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'deny', viewed: true });
const undo = (env: Env, rowId: string) => call<{ restored: boolean; line: string }>(env, 'venture.queue.undo', { rowId });
const ventureId = (env: Env) => listRecords(env.store.read(), 'venture-delivery-run')[0]!.ventureId;

async function ready() {
  const env = await setup();
  const order = await seedOrder(env);
  const run = await startNativeDraft(env, { order, draft: () => report('Here is the plan for your September books.') });
  assert.equal(run.status, 'ready-for-review');
  const row = await draftRow(env);
  assert.ok(row, 'the review row');
  return { env, run, row, order };
}

test('reject then undo: the draft waits on the owner again as it was, and no signal remains', async () => {
  const { env, run, row } = await ready();
  const before = record(env, run.id);
  const said = await reject(env, row);
  assert.equal(said.outcome, 'done');
  assert.equal(said.line, 'Draft rejected. The agent learns from it.');
  assert.equal(record(env, run.id).status, 'rejected');
  assert.equal(liveSignals(env.store.read(), ventureId(env)).filter(signal => signal.source === 'owner-rejected').length, 1);

  const back = await undo(env, row.id);
  assert.equal(back.restored, true);
  assert.equal(back.line, 'Restored until you edit this again.');
  const restored = record(env, run.id);
  assert.equal(restored.status, 'ready-for-review');
  assert.equal(restored.verdict, before.verdict);
  assert.equal(restored.editedText, before.editedText);
  assert.equal(restored.practice, before.practice);
  assert.equal(restored.renderedText, before.renderedText);
  const again = await draftRow(env);
  assert.ok(again, 'the draft is back on Today');
  assert.notEqual(again.id, row.id, 'a new version');
  // No signal remains: nothing the improvement loop, rehearsal or the corrections read still has it.
  const state = env.store.read();
  assert.deepEqual(liveSignals(state, ventureId(env)).filter(signal => signal.source === 'owner-rejected'), []);
  assert.deepEqual(correctionCases(state, ventureId(env)).filter(item => item.source === 'owner-rejected'), []);
  assert.equal(listScenarios(state, ventureId(env), 'bookkeeping').some(scenario => scenario.id.includes('signal')), false);
  const decisions = listRecords(state, 'venture-decision').filter(item => item.subject === `run:${run.id}`);
  assert.equal(decisions.at(-1)!.reason, 'You took back the reject.');
  assert.equal(listRecords(state, 'venture-queue-decision').find(item => item.rowId === row.id)!.undoneAt !== null, true);
});

test('undoing a reject keeps the owner\'s own version', async () => {
  const { env, run, row } = await ready();
  const edited = await call<QueueDecision>(env, 'venture.queue.edit', { rowId: row.id, digest: row.digest, text: 'My own words for the client, as I want them.' });
  assert.equal(edited.outcome, 'done');
  const mine = await draftRow(env);
  await reject(env, mine);
  assert.equal(record(env, run.id).editedText, null);
  await undo(env, mine.id);
  assert.equal(record(env, run.id).editedText, 'My own words for the client, as I want them.');
});

test('reject, then a new run of the order: too late', async () => {
  const { env, row, order } = await ready();
  await reject(env, row);
  await startNativeDraft(env, { order, draft: () => report('A second try at your September books.') });
  await assert.rejects(() => undo(env, row.id), code('UNDO_TOO_LATE'));
});

test('reject, then the signal becomes a practice case: too late, since something learned from it', async () => {
  const { env, row } = await ready();
  await reject(env, row);
  const [signal] = liveSignals(env.store.read(), ventureId(env)).filter(item => item.source === 'owner-rejected');
  await call(env, 'venture.simulation.fromSignal', { signalId: signal!.id });
  await assert.rejects(() => undo(env, row.id), code('UNDO_TOO_LATE'));
});

test('a second press finds nothing to undo, and a draft can be rejected again', async () => {
  const { env, run, row } = await ready();
  await reject(env, row);
  await undo(env, row.id);
  await assert.rejects(() => undo(env, row.id), code('UNDO_NOTHING'));
  const again = await draftRow(env);
  const said = await reject(env, again);
  assert.equal(said.outcome, 'done');
  assert.equal(record(env, run.id).status, 'rejected');
  assert.equal(liveSignals(env.store.read(), ventureId(env)).filter(signal => signal.source === 'owner-rejected').length, 1);
});

test('Approve is not undone by this path: a draft that went on stays where it is', async () => {
  const { env, row } = await ready();
  const views = await call<DeliveryRunView[]>(env, 'venture.delivery.list', {});
  assert.ok(views.length > 0);
  await call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true }).then(decision => assert.equal(decision.outcome, 'done'));
  await assert.rejects(() => undo(env, row.id), (error: { code?: string }) => error.code === 'UNDO_NOTHING' || error.code === 'UNDO_OUTSIDE_EFFECT');
});
