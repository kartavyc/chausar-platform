// Ink v2 wave 4 (4J2, O5): send back with words. On a draft waiting for review the run gets a revision turn whose input
// begins "Revise this to: {text}", waiting for the owner's approval of that exact text, and the row leaves Today; on a
// plan or price row it is a No that keeps the words on its decision. Empty words, too many words and an old digest are
// refused. After failed checks, venture.delivery.fix makes a revision that names those checks, and once it lands the
// checks run again and the fix gets its status.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DecisionsView, DeliveryRunView, QueueDecision, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { REVISE_PREFIX } from '../runtime/venture/delivery/revise.ts';
import { call, code, owner, phone, record, seedOrder, setup, startRun, READ, DONE, approve, type Env } from './venture-run-controls-env.ts';

const part = (text: string) => ({ kind: 'text', text, ref: '' });
/** A one-step bookkeeping draft; first: the summary line. */
const report = (first: string, needs = 'Please send the bank statement.') => ({
  title: 'Your September books', questionsForClient: [], sections: [
    { heading: 'Summary', parts: [part(first)] },
    { heading: 'What we will do', parts: [part('We will match each payment to a bill.')] },
    { heading: 'What we need from you', parts: [part(needs)] },
    { heading: 'Next steps', parts: [part('The fee for the month is below.'), { kind: 'figure', text: '', ref: 'order.total' }] },
  ],
});

const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const view = <T>(env: Env, method: string, payload: unknown, ctx = owner) =>
  (views as Record<string, (deps: Env['deps'], ctx: typeof owner, payload: unknown) => Promise<T>>)[method](env.deps, ctx, payload);
const sendBack = (env: Env, row: QueueRow, text: string, ctx = owner) => view<QueueDecision>(env, 'venture.queue.sendBack', { rowId: row.id, digest: row.digest, text }, ctx);

/** A one-step draft waiting for review: the drafts the AI writes, in order (the last one repeats). */
async function readyDraft(drafts: unknown[] = [report('Here is the plan for your September books.')]) {
  const env = await setup();
  let next = 0;
  env.models.respond.delivery = () => drafts[Math.min(next++, drafts.length - 1)];
  const order = await seedOrder(env);
  const started = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  const run = await approve(env, started);
  assert.equal(run.status, 'ready-for-review');
  const [row] = (await queue(env)).rows.filter(item => item.kind === 'draft');
  assert.ok(row, 'the review row');
  return { env, run, row };
}

test('sendBack on a draft: a revision turn whose input begins "Revise this to: {text}", waiting for approval; the row leaves Today', async () => {
  const { env, run, row } = await readyDraft();
  const before = env.models.previewed.length;
  const decision = await sendBack(env, row, 'Make it shorter and warmer.');
  assert.equal(decision.outcome, 'done');
  assert.equal(decision.line, 'Sent back. The revision waits for your approval before anything goes to your AI.');
  assert.equal(env.models.previewed.length, before + 1, 'one new preview, nothing sent');
  const task = env.models.previewed.at(-1)!;
  const input = task.input as Record<string, unknown>;
  assert.equal(Object.keys(input)[0], 'revise', 'the owner\'s words come first');
  assert.equal(input.revise, `${REVISE_PREFIX}Make it shorter and warmer.`);
  assert.ok(String(input.revise).startsWith('Revise this to: '));
  assert.equal(input.previousDraft, run.renderedText, 'the draft it revises is beside the words');
  assert.equal(input.clientRequest !== undefined, true, 'the step\'s own input follows');
  const stored = record(env, run.id);
  assert.equal(stored.status, 'waiting-for-you');
  assert.equal(stored.revision?.by, 'send-back');
  assert.equal(stored.revision?.rowId, row.id);
  assert.equal(stored.renderedText, run.renderedText, 'the draft is kept until the revision lands');
  const after = (await queue(env)).rows;
  assert.ok(!after.some(item => item.id === row.id), 'the review row left Today');
  assert.ok(after.some(item => item.kind === 'quote' && item.viewRef?.id === run.id), 'the revision waits for the owner to send it to the AI');
  // The words are on the decision, and the decision reaches venture.decisions.list.
  const [click] = listRecords(env.store.read(), 'venture-queue-decision');
  assert.equal(click.rowId, row.id);
  assert.equal(click.action, 'deny');
  assert.equal(click.line, 'Sent back with your words: Make it shorter and warmer.');
  const { decisions } = await view<DecisionsView>(env, 'venture.decisions.list', {});
  assert.ok(decisions.some(item => item.subject === `run:${run.id}` && item.reason === click.line && item.who === 'owner'));
  // The revision lands once the owner approves it: a new draft on a new review row.
  env.models.respond.delivery = () => report('Here is a short plan for your September books.');
  const landed = await approve(env, (await call<DeliveryRunView[]>(env, 'venture.delivery.list', {})).find(item => item.id === run.id)!);
  assert.equal(landed.status, 'ready-for-review');
  assert.match(landed.renderedText ?? '', /a short plan/);
  assert.equal(record(env, run.id).revision ?? null, null);
  const review = (await queue(env)).rows.find(item => item.kind === 'draft');
  assert.ok(review && review.id !== row.id, 'a new review row');
});

test('sendBack refuses empty words, more than 300 characters, an old digest, and works only inside the app', async () => {
  const { env, run, row } = await readyDraft();
  await assert.rejects(sendBack(env, row, '   '), code('SEND_BACK_EMPTY'));
  await assert.rejects(sendBack(env, row, 'x'.repeat(301)), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(sendBack(env, row, 'Shorter', phone), code('APP_APPROVAL_REQUIRED'));
  const stale = await sendBack(env, { ...row, digest: 'a'.repeat(64) }, 'Shorter');
  assert.equal(stale.outcome, 'stale');
  assert.equal(stale.reason, 'APPROVAL_STALE');
  assert.equal(stale.latest?.id, row.id);
  assert.equal(record(env, run.id).status, 'ready-for-review', 'nothing changed');
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
  // 300 characters is fine; a second click on the same row is decided already.
  assert.equal((await sendBack(env, row, 'y'.repeat(300))).outcome, 'done');
  const again = await sendBack(env, row, 'Shorter');
  assert.equal(again.outcome, 'refused');
  assert.equal(again.reason, 'ALREADY_DECIDED');
});

test('sendBack on a plan or price row is a No that keeps the words on its decision; the plan stays a draft', async () => {
  const { env } = await readyDraft();
  // A new plan version with a changed price: Today's price row.
  const draft = await ventureAction(env.deps, owner, 'admin', 'seed.plan', tx => {
    const accepted = tx.list('venture-blueprint').at(-1)!;
    const offers = accepted.offers.map(offer => ({ ...offer, pricing: { ...offer.pricing, unitPriceMinor: '299900' } }));
    const stored = tx.put({ ...accepted, ...tx.base('venture-blueprint'), version: accepted.version + 1, offers, status: 'draft' as const, digest: 'draft-digest' });
    tx.touch({ blueprintId: stored.id });
    return stored;
  });
  const price = (await queue(env)).rows.find(item => item.kind === 'price' || item.kind === 'plan');
  assert.ok(price, 'the plan change row');
  const decision = await sendBack(env, price, 'Keep the old price for cafes.');
  assert.equal(decision.outcome, 'done');
  const click = listRecords(env.store.read(), 'venture-queue-decision').find(item => item.rowId === price.id)!;
  assert.equal(click.action, 'deny');
  assert.equal(click.line, 'Not accepted. Your words: Keep the old price for cafes.');
  assert.equal(listRecords(env.store.read(), 'venture-blueprint').find(item => item.id === draft.id)?.status, 'draft', 'nothing was accepted');
  assert.ok(!(await queue(env)).rows.some(item => item.id === price.id));
});

test('sendBack on a row that is neither a draft nor a plan change is refused in words', async () => {
  const { env, run } = await readyDraft();
  // Send it back once: the revision's send row (a quote row) is not a draft.
  const [row] = (await queue(env)).rows.filter(item => item.kind === 'draft');
  await sendBack(env, row, 'Shorter');
  const send = (await queue(env)).rows.find(item => item.viewRef?.id === run.id)!;
  assert.equal(send.kind, 'quote');
  const decision = await sendBack(env, send, 'Shorter still');
  assert.equal(decision.outcome, 'refused');
  assert.equal(decision.reason, 'NOT_OFFERED');
});

test('the agent loop goes back to its writing turn: the write task carries the words first, and the run lands for review again', async () => {
  const env = await setup();
  const started = await startRun(env, [READ, DONE]);
  env.models.respond.delivery = () => report('Here is what we found in your September files.');
  let run: DeliveryRunView = started;
  while (run.status === 'waiting-for-you') run = await approve(env, run);
  assert.equal(run.status, 'ready-for-review');
  assert.equal(record(env, run.id).harness?.phase, 'done');
  const [row] = (await queue(env)).rows.filter(item => item.kind === 'draft');
  assert.equal((await sendBack(env, row, 'Say what is left in plain words.')).outcome, 'done');
  const stored = record(env, run.id);
  assert.equal(stored.harness?.phase, 'write', 'back to the writing turn');
  const task = env.models.previewed.at(-1)!;
  assert.equal(task.purpose, 'delivery');
  assert.equal((task.input as Record<string, unknown>).revise, 'Revise this to: Say what is left in plain words.');
  assert.ok('proven' in (task.input as object), 'the writing turn\'s own input follows');
  const landed = await approve(env, (await call<DeliveryRunView[]>(env, 'venture.delivery.list', {})).find(item => item.id === run.id)!);
  assert.equal(landed.status, 'ready-for-review');
  assert.equal(record(env, run.id).harness?.phase, 'done');
  assert.equal(record(env, run.id).harness?.turns.filter(turn => turn.step === 'write').length, 2, 'the revision is a turn of the run');
});

test('the owner\'s words pass the shared screen before they reach the AI', async () => {
  const { env, row } = await readyDraft();
  const key = 'sk-ant-' + 'api03-' + 'A'.repeat(40);
  await sendBack(env, row, `Remove the key ${key} from the draft.`);
  const revise = String((env.models.previewed.at(-1)!.input as Record<string, unknown>).revise);
  assert.ok(!revise.includes(key), 'a key never goes to the AI');
});

test('delivery.fix after failed checks: a revision that names those checks; once it lands the fix reads Fixed', async () => {
  const { env, run } = await readyDraft([report('We reconciled your bank statement and filed your GST return.'), report('Here is the plan for your September books.')]);
  assert.ok(run.checks.some(item => item.check === 'no-done-claims' && !item.passed));
  await assert.rejects(call(env, 'venture.delivery.fix', { runId: run.id, checks: ['tone'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.delivery.fix', { runId: run.id, checks: [] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.delivery.fix', { runId: run.id, checks: 'all' }, phone), code('APP_APPROVAL_REQUIRED'));
  const fixing = await call<DeliveryRunView>(env, 'venture.delivery.fix', { runId: run.id, checks: 'all' });
  assert.equal(fixing.status, 'waiting-for-you');
  const revise = String((env.models.previewed.at(-1)!.input as Record<string, unknown>).revise);
  assert.ok(revise.startsWith('Revise this to: fix what these checks found.'));
  assert.match(revise, /no-done-claims/);
  assert.deepEqual(record(env, run.id).revision?.checks, ['no-done-claims']);
  const landed = await approve(env, fixing);
  assert.equal(landed.status, 'ready-for-review');
  assert.deepEqual(record(env, run.id).fix?.checks, ['no-done-claims']);
  assert.equal(record(env, run.id).fix?.status, 'fixed');
  const fixDecision = listRecords(env.store.read(), 'venture-decision').find(item => item.action === 'fix');
  assert.equal(fixDecision?.reason, 'You asked the agent to fix: no-done-claims.');
});

test('delivery.fix: a fix the checks still fail reads Not fixed; nothing to fix is refused', async () => {
  const claim = report('We reconciled your bank statement and filed your GST return.');
  const { env, run } = await readyDraft([claim, claim]);
  const landed = await approve(env, await call<DeliveryRunView>(env, 'venture.delivery.fix', { runId: run.id, checks: ['no-done-claims'] }));
  assert.equal(landed.status, 'ready-for-review');
  assert.equal(record(env, run.id).fix?.status, 'not-fixed');
  const clean = await readyDraft();
  await assert.rejects(call(clean.env, 'venture.delivery.fix', { runId: clean.run.id, checks: 'all' }), code('INVALID_VENTURE_REQUEST'));
});

test('no revision without an AI or while the business is paused; a refused send-back decides nothing', async () => {
  const { env, row, run } = await readyDraft();
  env.models.main = 'template';
  await assert.rejects(sendBack(env, row, 'Shorter'), code('NO_MODEL_CONNECTED'));
  env.models.main = 'model';
  await view(env, 'venture.business.pause', { paused: true });
  const [paused] = (await queue(env)).rows.filter(item => item.kind === 'draft');
  await assert.rejects(sendBack(env, paused, 'Shorter'), code('BUSINESS_PAUSED'));
  assert.equal(record(env, run.id).status, 'ready-for-review');
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
});

/** A new plan version with a changed price, so Today has a price row. */
async function priceChange(env: Env) {
  await ventureAction(env.deps, owner, 'admin', 'seed.plan', tx => {
    const accepted = tx.list('venture-blueprint').at(-1)!;
    const offers = accepted.offers.map(offer => ({ ...offer, pricing: { ...offer.pricing, unitPriceMinor: '299900' } }));
    const stored = tx.put({ ...accepted, ...tx.base('venture-blueprint'), version: accepted.version + 1, offers, status: 'draft' as const, digest: 'draft-digest' });
    tx.touch({ blueprintId: stored.id });
  });
  return (await queue(env)).rows.find(item => item.kind === 'price' || item.kind === 'plan')!;
}

test('the words kept on a decision are the screened words, never a key', async () => {
  const { env, row } = await readyDraft();
  const key = 'sk-ant-' + 'api03-' + 'B'.repeat(40);
  await sendBack(env, row, `Leave out ${key} please.`);
  const [click] = listRecords(env.store.read(), 'venture-queue-decision');
  assert.ok(!click.line.includes(key), click.line);
  const price = await priceChange(env);
  await sendBack(env, price, `Not with ${key}.`);
  assert.ok(!listRecords(env.store.read(), 'venture-queue-decision').find(item => item.rowId === price.id)!.line.includes(key));
});

test('undo of a plan send-back marks the decision undone and the same row comes back, to decide anew', async () => {
  const { env } = await readyDraft();
  const price = await priceChange(env);
  await sendBack(env, price, 'Not yet.');
  assert.ok(!(await queue(env)).rows.some(item => item.id === price.id));
  const undone = await view<{ restored: boolean; line: string }>(env, 'venture.queue.undo', { rowId: price.id });
  assert.deepEqual(undone, { restored: true, line: 'Restored until you edit this again.' });
  const decision = listRecords(env.store.read(), 'venture-queue-decision').find(item => item.rowId === price.id)!;
  assert.ok(decision.undoneAt, 'the decision is marked undone, not removed');
  const back = (await queue(env)).rows.find(item => item.id === price.id);
  assert.ok(back, 'the same row is on Today again');
  await assert.rejects(view(env, 'venture.queue.undo', { rowId: price.id }), code('UNDO_NOTHING'));
  const again = await sendBack(env, back, 'Still not yet.');
  assert.equal(again.outcome, 'done', again.line);
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').filter(item => item.rowId === price.id).length, 2);
});
