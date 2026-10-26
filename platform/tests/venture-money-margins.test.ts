// Ink v2 wave 4, package 4J4 (M8, M13, M14): cost and margin per client. Each client's invoices issued in the month,
// before tax and less credit notes, against the AI and tool spend of their orders (a paid call to its run, the run to
// its order, the order to its client), in one currency only: the spend at the owner's rupee rate, labelled with it, or
// "Not counted: no rupee rate set". Each figure has its own receipt; calls no order can claim are left out and the total
// says how many. Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, MarginsView, OrderRecord, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';
import { paidCall } from './venture-money-env.ts';
import { code, owner } from './venture-views-env.ts';

/** A delivery run for an order, as the delivery package writes one (only what the tag reads matters here). */
async function runFor(env: GoalEnv, orderId: string, callId: string | null) {
  return ventureAction(env.deps, owner, 'admin', 'seed.run', tx => tx.put({ ...tx.base('venture-delivery-run'), orderId, callId, status: 'ready-for-review', harness: null } as unknown as DeliveryRunRecord));
}

/**
 * Cafe Aroma Demo: one month invoiced on 5 Oct, 1975000 (INR 19,750.00) before tax. Its order's run made two paid
 * calls: US$1.50 charged to the run, and US$0.50 by the run's model call. At 83.50 per $1:
 * 1500000 x 835000 = 1,252,500,000,000, + 50,000,000, / 100,000,000 = 12525; 500000 x 835000 = 417,500,000,000 -> 4175.
 * Spend 12525 + 4175 = 16700 (INR 167.00); margin 1975000 - 16700 = 1958300 (INR 19,583.00).
 * Lotus Salon: an order with a run that spent US$1.00 (8350), nothing invoiced yet: margin 0 - 8350 = -8350.
 * One call of US$0.20 no order can claim.
 */
async function margins() {
  const env = await goalBusiness();
  const aroma = await invoice(env, '1', '2026-10-05');
  const run = await runFor(env, aroma.invoice.orderId, 'call_aroma');
  await paidCall(env, '1500000', 'settled', run.id);
  await ventureAction(env.deps, owner, 'admin', 'seed.call', tx => { tx.put({ ...tx.base('venture-spend'), key: 'model:call_aroma', item: 'model:anthropic', label: 'Draft', agent: null, connector: 'anthropic', payer: 'connection:conn_1', draftDigest: 'd', rate: null, reservedMicros: '500000', settledMicros: '500000', settledBy: 'usage', phase: 'settled', quoteId: null, ref: null, refusal: null, settledAt: tx.now } as never); });
  const lotus = await env.money<{ id: string }>('venture.client.add', { name: 'Lotus Salon', countryCode: 'IN', stateCode: '27' });
  const order = await env.money<OrderRecord>('venture.order.create', { clientId: lotus.id, offerId: 'offer_1', quantity: '1', request: 'Books for the salon.' });
  const lotusRun = await runFor(env, order.id, null);
  await paidCall(env, '1000000', 'settled', lotusRun.id);
  await paidCall(env, '200000');
  return { env, aroma, lotus };
}

test('margins: per client, invoiced before tax less the spend of their orders at the owner\'s rate, each figure with its receipt', async () => {
  const { env, lotus } = await margins();
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const view = await env.money<MarginsView>('venture.money.margins', { month: '2026-10' });
  assert.deepEqual(view.rows.map(row => [row.client, row.invoiced.display, row.spend?.display, row.margin?.display, row.note]), [
    ['Cafe Aroma Demo', 'INR 19,750.00', 'INR 167.00', 'INR 19,583.00', null],
    ['Lotus Salon', 'INR 0.00', 'INR 83.50', 'INR -83.50', null],
  ]);
  const aroma = view.rows[0];
  for (const figure of [aroma.invoiced, aroma.spend, aroma.margin]) assert.deepEqual([figure?.kind, figure?.source], ['calculated', { from: 'receipt', receiptId: figure?.receiptId }]);
  assert.deepEqual(aroma.spend?.uses, ['₹83.50 per $1 (your rate, set 23 Oct 2026)']);
  const spend = await env.money<SumReceiptRecord>('venture.receipt.get', { id: aroma.spend!.receiptId });
  assert.deepEqual([spend.subject, spend.totalMinor, spend.addends.map(addend => addend.amount)],
    [{ type: 'margin', month: '2026-10', clientId: aroma.clientId, part: 'spend' }, '16700', ['12525', '4175']]);
  const margin = await env.money<SumReceiptRecord>('venture.receipt.get', { id: aroma.margin!.receiptId });
  assert.deepEqual([margin.totalMinor, margin.addends.map(addend => addend.amount)], ['1958300', ['1975000', '-12525', '-4175']]);
  assert.equal(view.rows[1].clientId, lotus.id);
  assert.deepEqual(view.basis.notCounted, { count: 1, line: '1 not counted: 1 paid call no order can claim' });
  assert.equal(view.line, 'October 2026: invoiced before tax, less the AI and tool spend of each client\'s orders at ₹83.50 per $1 (your rate, set 23 Oct 2026).');
});

test('margins without a rupee rate keep one currency: the spend and margin are not counted, and say so', async () => {
  const { env } = await margins();
  const view = await env.money<MarginsView>('venture.money.margins', { month: '2026-10' });
  assert.deepEqual(view.rows.map(row => [row.invoiced.display, row.spend, row.margin, row.note]), [
    ['INR 19,750.00', null, null, 'Not counted: no rupee rate set'],
    ['INR 0.00', null, null, 'Not counted: no rupee rate set'],
  ]);
  assert.deepEqual(view.basis.notCounted, { count: 4, line: '4 not counted: 4 paid calls with no rupee rate set' });
  const empty = await env.money<MarginsView>('venture.money.margins', { month: '2026-08' });
  assert.deepEqual(empty.rows, []);
  await assert.rejects(env.money('venture.money.margins', {}), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.money.margins', { month: '2026-13' }), code('INVALID_VENTURE_REQUEST'));
});
