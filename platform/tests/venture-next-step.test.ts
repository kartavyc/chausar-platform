// The next best step and the briefing (Ink v2 wave 4, package 4I1; W3's U1 ranking): Today's waiting rows ranked by the
// money at stake, read from receipts, then by the nearest deadline, then Today's own order. The step points at the
// row's primary action, which the owner takes, inside the app; "Goal after" is code. Clock: 23 October 2026, 15:30 in
// Asia/Kolkata. Every expected amount is worked out by hand in a comment, never by the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentVenture } from '../runtime/venture/records.ts';
import type { GoalView, MoneyOverview, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { nextBestStep, rankedRows } from '../runtime/venture/money/next-step.ts';
import { call, phone } from './venture-views-env.ts';
import { CLIENT, goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';

const get = (env: GoalEnv, ctx = undefined as typeof phone | undefined) => env.money<GoalView>('venture.goals.get', {}, ctx);
const todayRows = async (env: GoalEnv) => (await call<QueueList>(env, 'venture.queue.list', {})).rows;
const IN_APP = { inApp: true };

test('next best step: the waiting row with the most money at stake leads, with its receipted figure and the goal after it', async () => {
  const env = await goalBusiness();
  // Issued in October: 4 months, before tax 4 x 1975000 = 7900000.
  await invoice(env, '4', '2026-10-01');
  // Two drafts dated in October: 1 month (total with GST 2330500, INR 23,305.00) and 3 months
  // (before tax 3 x 1975000 = 5925000; total 3 x 2330500 = 6991500, INR 69,915.00).
  const small = await invoice(env, '1', '2026-10-23', true);
  const big = await invoice(env, '3', '2026-10-22', true);
  await env.money('venture.goals.set', { month: '2026-10', amountMinor: '15000000' });

  const view = await get(env);
  const rows = await todayRows(env);
  const rowOf = (made: typeof big) => rows.find(row => row.viewRef?.id === made.invoice.id)!;
  assert.deepEqual(view.next, {
    rowId: rowOf(big).id, title: `Invoice for ${CLIENT}`, agent: null, line: 'Open it, then choose Issue.',
    figure: { display: 'INR 69,915.00', receiptId: big.invoice.priceReceiptId },
    // 7900000 + 5925000 = 13825000; x 100 / 15000000 = 92.16, floored to 92.
    goalAfter: 'Goal after: 92%', goalAfterPercent: 92,
  });
  // The briefing keeps the same order: the money rows first, then the rest in Today's order, at most six.
  const rest = rows.filter(row => row.kind !== 'invoice').map(row => row.id);
  assert.ok(rest.length >= 1, 'Today has rows without money too');
  const order = [rowOf(big).id, rowOf(small).id, ...rest];
  assert.deepEqual(view.briefing, { rowIds: order.slice(0, 6), more: Math.max(0, order.length - 6) });
  // On the phone the owner can read the step but decides inside the app, and the step says so.
  assert.equal((await get(env, phone)).next?.line, 'Open it in the app, then choose Issue.');
});

test('next best step: no goal or a draft dated in another month has no "Goal after"; no rows gives no step', async () => {
  const env = await goalBusiness();
  // A September draft of 5 months (total 5 x 2330500 = 11652500, INR 116,525.00) outranks an October one of 1 month.
  const september = await invoice(env, '5', '2026-09-29', true);
  await invoice(env, '1', '2026-10-23', true);
  const unset = await get(env);
  assert.equal(unset.next?.figure?.display, 'INR 116,525.00');
  assert.equal(unset.next?.goalAfter, null, 'no goal, nothing to say after');
  assert.equal(unset.next?.goalAfterPercent, null);
  await env.money('venture.goals.set', { month: '2026-10', amountMinor: '15000000' });
  const set = await get(env);
  assert.equal(set.next?.rowId, (await todayRows(env)).find(row => row.viewRef?.id === september.invoice.id)?.id);
  assert.equal(set.next?.goalAfter, null, 'issuing a September invoice does not move October');

  const state = env.store.read();
  assert.deepEqual(nextBestStep(state, currentVenture(state)!, [], null, IN_APP), { next: null, briefing: null });
});

test('ranking: money from receipts only (change, then price), most first; then the nearest deadline; then Today\'s order', async () => {
  const env = await goalBusiness();
  // A draft of 1 month: total 2330500 (INR 23,305.00) on its price receipt.
  const draft = await invoice(env, '1', '2026-10-23', true);
  // An issued invoice of 2 months, unpaid: owed 2 x 2330500 = 4661000 (INR 46,610.00) on the overview's owed receipt;
  // AI spend is a sum receipt in micro-dollars, never money at stake here.
  await invoice(env, '2', '2026-10-20');
  const overview = await env.money<MoneyOverview>('venture.money.overview', {});
  const owedReceipt = overview.lines.find(line => line.id === 'owed')!.receiptId!;
  const spentReceipt = overview.lines.find(line => line.id === 'spent')!.receiptId!;

  const priceReceipt = draft.invoice.priceReceiptId;
  const row = (id: string, extra: Partial<QueueRow> = {}): QueueRow => ({
    id, businessId: 'main', businessName: 'Ledgerline', kind: 'question', title: `Row ${id}`, digest: 'd'.repeat(64), createdAt: '2026-10-23T09:00:00.000Z',
    actions: [{ id: 'later', label: 'Not now', primary: false }, { id: 'approve', label: 'Approve', primary: true }], ...extra,
  });
  const meta = (expiresAt: string) => ({ meta: { client: null, business: 'Ledgerline', at: '2026-10-23T09:00:00.000Z', expiresAt } });
  const owed = { change: { label: 'Owed', after: 'INR 46,610.00', receiptId: owedReceipt } };
  const rows: QueueRow[] = [
    // As much money as the owed row, and earlier in Today's order, but their primary is Read or Not now: never the step.
    row('read-first', { ...owed, actions: [{ id: 'later', label: 'Not now', primary: false }, { id: 'read', label: 'Read', primary: true }] }),
    row('later-only', { ...owed, actions: [{ id: 'later', label: 'Not now', primary: true }] }),
    row('plain'),
    row('later-deadline', meta('2026-10-23T12:00:00.000Z')),
    row('sooner-deadline', meta('2026-10-23T11:00:00.000Z')),
    row('no-receipt', { change: { label: 'It may cost', after: 'USD 0.1500' } }),
    row('estimate', { change: { label: 'Total', after: 'INR 23,305.00', receiptId: priceReceipt, estimate: true } }),
    row('change', { change: { label: 'Total', after: 'INR 23,305.00', receiptId: priceReceipt } }),
    row('price', { price: { display: 'INR 23,305.00', receiptId: priceReceipt, line: 'The price of this order.' }, ...meta('2026-10-24T09:00:00.000Z') }),
    row('missing', { change: { label: 'Total', after: 'INR 1.00', receiptId: 'price_missing' } }),
    row('owed', owed),
    row('spend', { change: { label: 'AI and tools', after: 'USD 0.0000', receiptId: spentReceipt } }),
  ];
  const state = env.store.read();
  const venture = currentVenture(state)!;
  // Money first, most first: the three rows of 4661000 in Today's order, then the two of 2330500 (the one with a
  // deadline first). Then the rows without money: the sooner deadline, the later one, then Today's own order.
  assert.deepEqual(rankedRows(state, venture, rows).map(item => item.row.id), [
    'read-first', 'later-only', 'owed', 'price', 'change', 'sooner-deadline', 'later-deadline', 'plain', 'no-receipt', 'estimate', 'missing', 'spend',
  ]);
  const { next, briefing } = nextBestStep(state, venture, rows, null, IN_APP);
  assert.deepEqual(next, {
    rowId: 'owed', title: 'Row owed', agent: null, line: 'Choose Approve.', figure: { display: 'INR 46,610.00', receiptId: owedReceipt }, goalAfter: null, goalAfterPercent: null,
  });
  // The briefing lists the waiting rows as ranked: six named, and 6 more.
  assert.deepEqual(briefing, { rowIds: ['read-first', 'later-only', 'owed', 'price', 'change', 'sooner-deadline'], more: 6 });
  // Off the app channel the step says to open it in the app.
  assert.equal(nextBestStep(state, venture, rows, null, { inApp: false }).next?.line, 'Open it in the app, then choose Approve.');
  // A row the owner must open first says so; one with fewer than six rows names them all.
  const viewed = nextBestStep(state, venture, [row('look', { viewRef: { kind: 'file', id: 'file_1' }, agent: 'Bookkeeping agent' })], null, IN_APP);
  assert.deepEqual([viewed.next?.line, viewed.next?.agent, viewed.next?.figure], ['Open it, then choose Approve.', 'Bookkeeping agent', null]);
  assert.deepEqual(viewed.briefing, { rowIds: ['look'], more: 0 });
  // Rows with no primary action the owner can take give no step, though the briefing still lists them.
  const none = nextBestStep(state, venture, rows.slice(0, 2), null, IN_APP);
  assert.deepEqual(none, { next: null, briefing: { rowIds: ['read-first', 'later-only'], more: 0 } });
});
