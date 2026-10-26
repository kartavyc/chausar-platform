// Ink v2 wave 4, package 4G1 (O12, spec 5.7): the daily digest. At the hour the owner chose, in the business's time
// zone, code (never a model) writes one digest a day: how many things need the owner and of what kind, the runs that
// finished, and money ready to invoice from a sum receipt; or "Nothing needs you today.". An item already in an earlier
// digest is not listed again, only counted as still waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import type { Context } from '../runtime/contracts.ts';
import type { NotifyListView } from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/notify/index.ts';
import { notifyRefresh } from '../runtime/venture/notify/centre.ts';
import { digestLine, digestKind } from '../runtime/venture/notify/digest.ts';
import { owner, seedBlueprint, seedOrder, seedRun, setup, START, type Env } from './venture-views-env.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const digests = (env: Env) => listRecords(env.store.read(), 'venture-notify-digest', env.venture.id);
const list = (env: Env) => (handlers['venture.notify.list'] as (d: unknown, c: Context, p: unknown) => Promise<NotifyListView>)(env.deps, owner, {});
const settings = (env: Env, payload: unknown) => (handlers['venture.notify.settings'] as (d: unknown, c: Context, p: unknown) => Promise<unknown>)(env.deps, owner, payload);
/** Moves the clock to a time of day in India on the day after START (15 October, 15:30 in India). */
const toIndia = (env: Env, day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const target = Date.parse(`2026-10-${String(15 + day).padStart(2, '0')}T00:00:00.000Z`) + (h * 60 + m - 330) * MIN;
  env.advance(target - Date.parse(env.now()));
};

test('the digest line is code: counts by kind, runs finished and money ready to invoice, or nothing needs you', () => {
  assert.equal(digestLine({ kinds: ['approve', 'approve', 'approve', 'question', 'question'], stillWaiting: 0, runsFinished: 2, ready: 'INR 18,880.00' }),
    'Today: 5 need you (3 to approve, 2 questions). 2 runs finished. INR 18,880.00 is ready to invoice.');
  assert.equal(digestLine({ kinds: [], stillWaiting: 0, runsFinished: 0, ready: null }), 'Nothing needs you today.');
  assert.equal(digestLine({ kinds: ['question'], stillWaiting: 1, runsFinished: 1, ready: null }),
    'Today: 1 needs you (1 question). 1 of them is still waiting from before. 1 run finished.');
  assert.equal(digestLine({ kinds: ['setup', 'look', 'approve'], stillWaiting: 2, runsFinished: 0, ready: null }),
    'Today: 3 need you (1 to approve, 1 to set up, 1 to look at). 2 of them are still waiting from before.');
  assert.equal(digestLine({ kinds: [], stillWaiting: 0, runsFinished: 3, ready: null }), 'Nothing needs you today. 3 runs finished.');
  // What each row counts as: an answer is a question, setup is setup, an approve or issue is to approve, the rest to look at.
  assert.equal(digestKind({ kind: 'question', actions: [{ id: 'approve' }] }), 'question');
  assert.equal(digestKind({ kind: 'draft', actions: [{ id: 'answer' }] }), 'question');
  assert.equal(digestKind({ kind: 'setup', actions: [{ id: 'connect' }] }), 'setup');
  assert.equal(digestKind({ kind: 'invoice', actions: [{ id: 'issue' }] }), 'approve');
  assert.equal(digestKind({ kind: 'draft', actions: [{ id: 'later' }, { id: 'approve' }] }), 'approve');
  assert.equal(digestKind({ kind: 'draft', actions: [{ id: 'later' }, { id: 'run-again' }] }), 'look');
  assert.equal(digestKind({ kind: 'notice', actions: [{ id: 'open' }] }), 'look');
});

test('at the chosen hour in the business\'s time zone, once a day, never on the day the business was made, and never by a model', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await seedRun(env, order, { status: 'failed', callId: null });
  await notifyRefresh(env.deps, owner);
  assert.equal(digests(env).length, 0, '15 October is the day the business was made');
  // A run finished in the evening: the next morning's digest counts it.
  toIndia(env, 0, '18:00');
  const { order: second } = await seedOrder(env, plan);
  await seedRun(env, second, { status: 'accepted' }, ['run.done']);
  toIndia(env, 1, '07:59');
  await notifyRefresh(env.deps, owner);
  assert.equal(digests(env).length, 0, 'before 08:00 in India');
  toIndia(env, 1, '08:01');
  env.published.length = 0;
  const result = await notifyRefresh(env.deps, owner);
  const [made] = digests(env);
  assert.equal(result.digest, made.id);
  assert.equal(made.day, '2026-10-16');
  assert.equal(made.line, 'Today: 2 need you (1 to set up, 1 to look at). 1 run finished.');
  assert.equal(made.stillWaiting, 0);
  assert.equal(made.listed.length, 2);
  assert.equal(made.runIds.length, 1);
  assert.ok(env.published.flat().some(event => event.name === 'notify.new'), 'the centre changed');
  assert.ok(listRecords(env.store.read(), 'venture-notification', env.venture.id).every(record => record.digestOn === '2026-10-16'));
  const view = (await list(env)).digest!;
  assert.deepEqual([view.id, view.day, view.line, view.stillWaiting], [made.id, '2026-10-16', made.line, 0]);
  assert.deepEqual(view.items.map(item => item.title).sort(), ['Connect your AI', 'The draft for Cafe Aroma Demo failed']);
  assert.deepEqual(view.receiptIds, []);
  // Later the same day: no second digest.
  toIndia(env, 1, '20:00');
  await notifyRefresh(env.deps, owner);
  assert.equal(digests(env).length, 1);
  assert.equal(listRecords(env.store.read(), 'venture-model-call').length, 0, 'no model was asked');
});

test('the next day an item already in a digest is counted as still waiting, not listed again; money in the line comes from a receipt', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  await notifyRefresh(env.deps, owner);
  toIndia(env, 1, '08:00');
  await notifyRefresh(env.deps, owner);
  assert.equal(digests(env).length, 1);
  toIndia(env, 1, '12:00');
  const { order } = await seedOrder(env, plan);
  await seedRun(env, order, { status: 'failed', callId: null });
  toIndia(env, 2, '08:30');
  await notifyRefresh(env.deps, owner);
  const today = digests(env).find(record => record.day === '2026-10-17')!;
  assert.match(today.line, /^Today: 2 need you \(1 to set up, 1 to look at\)\. 1 of them is still waiting from before\./);
  assert.equal(today.stillWaiting, 1);
  const view = (await list(env)).digest!;
  assert.equal(view.id, today.id, 'the newest digest');
  assert.deepEqual(view.items.map(item => item.title), ['The draft for Cafe Aroma Demo failed'], 'only the new item is listed');
  // Every money figure in the line is a figure on a sum receipt the digest names.
  const receipts = listRecords(env.store.read(), 'venture-sum-receipt', env.venture.id).filter(receipt => view.receiptIds.includes(receipt.id));
  for (const figure of today.line.match(/INR [\d,]+\.\d{2}/g) ?? []) assert.ok(receipts.some(receipt => receipt.allowedNumbers.includes(figure)), figure);
});

test('no digest when the owner turned it off; a digest hour in quiet hours keeps the digest inside the app', async () => {
  const env = await setup();
  await settings(env, { digest: null });
  toIndia(env, 1, '09:00');
  await notifyRefresh(env.deps, owner);
  assert.equal(digests(env).length, 0);

  const quiet = await setup();
  await settings(quiet, { digest: { hour: 6 }, quietHours: { from: '22:00', to: '07:00' } });
  await notifyRefresh(quiet.deps, owner);
  toIndia(quiet, 1, '06:10');
  quiet.published.length = 0;
  await notifyRefresh(quiet.deps, owner);
  const [made] = digests(quiet);
  assert.equal(made.alertedAt, null, 'quiet hours: nothing goes outside');
  assert.deepEqual(quiet.published.flat().filter(event => event.name === 'notify.new').map(event => event.data), [{}]);
  assert.equal(Date.parse(START) < Date.parse(made.at), true);
});

test('money ready to invoice: a dated draft invoice puts its amount before tax in the line, from a sum receipt the digest names', async () => {
  // 23 October 2026, 15:30 in India; the business was made on the 15th. One draft invoice dated today, not issued.
  const env = await goalBusiness();
  await settings(env, { quietHours: null });
  const draft = await invoice(env, '1', '2026-10-23', true);
  await notifyRefresh(env.deps, owner);
  const [made] = digests(env);
  assert.equal(made.day, '2026-10-23');
  assert.match(made.line, / INR 19,750\.00 is ready to invoice\.$/);
  const view = (await list(env)).digest!;
  assert.equal(view.receiptIds.length, 1);
  const receipt = listRecords(env.store.read(), 'venture-sum-receipt', env.venture.id).find(item => item.id === view.receiptIds[0])!;
  assert.deepEqual(receipt.subject, { type: 'invoiced', month: '2026-10', which: 'ready' });
  assert.ok(receipt.allowedNumbers.includes('INR 19,750.00'));
  assert.deepEqual(receipt.addends.map(addend => addend.recordId), [draft.invoice.id]);
  assert.deepEqual(made.ready, { display: 'INR 19,750.00', receiptId: receipt.id });
});

test('the receipt is written only when a digest is surely due', async () => {
  const env = await goalBusiness();
  await settings(env, { digest: { hour: 18 } });
  await invoice(env, '1', '2026-10-23', true);
  await notifyRefresh(env.deps, owner);
  assert.equal(digests(env).length, 0, '15:30 is before 18:00');
  assert.equal(listRecords(env.store.read(), 'venture-sum-receipt', env.venture.id).filter(item => item.subject.type === 'invoiced').length, 0);
});
