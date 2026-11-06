import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';

// A real owner issues the exact invoice preview, then records a payment. No invoice is sent.
test('Money records invoice approval, payment and receipt-backed views', async t => {
  await recordScenario(t, 'money', async ({ rpc }) => {
    const client = await rpc.request('venture.client.add', { name: 'Sample Cafe', countryCode: 'IN' });
    const order = await rpc.request('venture.order.create', { clientId: client.id, offerId: 'offer_1', quantity: '1', request: 'Please prepare our monthly bookkeeping report.' });
    const preview = await rpc.request('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-11-06', dueInDays: 14 });
    assert.equal(preview.invoice.status, 'draft');
    const issued = await rpc.request('venture.invoice.issue', { invoiceId: preview.invoice.id, digest: preview.invoice.digest });
    assert.equal(issued.invoice.status, 'issued');
    assert.equal(issued.invoice.totalMinor, issued.receipt.totalMinor);
    const paid = await rpc.request('venture.payment.record', { invoiceId: issued.invoice.id, amount: '1000.00', receivedOn: '2026-11-06', method: 'upi' });
    assert.equal(paid.invoice.status, 'part-paid');
    assert.equal(paid.payments.length, 1);
    assert.equal(paid.payments[0].amountMinor, '100000');
    await rpc.request('venture.invoice.get', { invoiceId: issued.invoice.id });
    await rpc.request('venture.invoice.list', {});
    await rpc.request('venture.books.summary', { period: '2026-11' });
    await rpc.request('venture.money.flow', { months: 6 });
  });
});
