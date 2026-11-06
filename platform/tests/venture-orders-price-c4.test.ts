// One-shot C4 task 11: the order list carries each order's price as the receipt's own figure, so Work can show it
// with its receipt mark. The view's display is the receipt's total, never worked out again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { business, PLAIN_IDEA } from './venture-judge-helpers.ts';

test('order list: each order carries its price, the receipt total with the receipt id', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Please look at my pricing for the new line.' });
  const rows = await env.call('venture.order.list');
  const row = rows.find((item: { id: string }) => item.id === order.id);
  assert.ok(row.price, 'the order row carries its price');
  assert.equal(row.price.receiptId, order.priceReceiptId);
  const receipt = await env.call('venture.receipt.get', { id: order.priceReceiptId });
  const total = receipt.figures.find((figure: { key: string }) => figure.key === 'total');
  assert.equal(row.price.display, total.display, 'the view price is the receipt total, as the receipt says it');
});
