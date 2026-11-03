// Wave 6 money (6D4): a client abroad is invoiced in their own currency at a price the owner types in it. Nothing is
// converted (D15a, D26). An Indian business bills the export zero-rated under its LUT, as the GST code already does; an
// export without an LUT would owe IGST in rupees, so a foreign-currency invoice is refused with the way out.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, ClientRecord, InvoiceView, OrderRecord, PriceReceiptRecord } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { goalBusiness, type GoalEnv } from './venture-goals-helpers.ts';
import { code, owner } from './venture-views-env.ts';

/** Confirms the Letter of Undertaking on the accepted plan, digested the way the plan is. */
async function confirmLut(env: GoalEnv) {
  await ventureAction(env.deps, owner, 'admin', 'seed.lut', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.status === 'accepted') as BlueprintRecord;
    const next: BlueprintRecord = { ...plan, backOffice: { ...plan.backOffice, lutConfirmed: true }, digest: '' };
    const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = next;
    next.digest = digest(rest);
    tx.replace(next);
  });
}

async function usClient(env: GoalEnv) {
  return env.money<ClientRecord>('venture.client.add', { name: 'Hudson Bakery', email: 'books@hudson.example', countryCode: 'US' });
}

test('a client abroad is billed in their currency, zero-rated under the LUT, and nothing is converted', async () => {
  const env = await goalBusiness();
  const client = await usClient(env);
  const ask = { clientId: client.id, offerId: 'offer_1', request: 'Close our books for October.', quantity: '2', currency: 'USD', unitPrice: '1,200.50' };
  await assert.rejects(env.money('venture.order.create', ask), code('FOREIGN_NEEDS_LUT'));
  await confirmLut(env);
  await assert.rejects(env.money('venture.order.create', { ...ask, currency: 'INR' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.order.create', { ...ask, currency: 'XYZ' }), code('INVALID_CURRENCY'));
  await assert.rejects(env.money('venture.order.create', { ...ask, unitPrice: undefined }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.order.create', { ...ask, clientId: env.client.id }), code('INVALID_VENTURE_REQUEST'));

  // 2 x USD 1,200.50 = USD 2,401.00, zero-rated: total 240100 cents.
  const order = await env.money<OrderRecord>('venture.order.create', ask);
  assert.deepEqual(order.foreignPrice, { currency: 'USD', unitPriceMinor: '120050' });
  const priced = listRecords(env.store.read(), 'venture-price-receipt').find(r => r.id === order.priceReceiptId) as PriceReceiptRecord;
  assert.deepEqual([priced.currency, priced.totalMinor, priced.inputs.taxTreatment, priced.inputs.currencyBy], ['USD', '240100', 'zero-rated-lut', 'order']);

  const draft = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id });
  assert.equal(draft.invoice.currency, 'USD');
  assert.equal(draft.invoice.totalMinor, '240100');
  assert.deepEqual(draft.invoice.taxLines, [{ label: 'GST, zero-rated export under LUT', rateBps: '0', minor: '0' }]);
  assert.equal(draft.invoice.placeOfSupply, 'Outside India (export of services)');
  assert.match(draft.documentText, /2 x USD 1,200\.50  USD 2,401\.00/);
  assert.ok(draft.notes.some(note => note.startsWith('This invoice is in USD. Chausar does not convert it')));
  const issued = await env.money<InvoiceView>('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  assert.equal(issued.invoice.number, 'INV-0001');
  const paid = await env.money<InvoiceView>('venture.payment.record', { invoiceId: issued.invoice.id, amount: '2401.00', receivedOn: '2026-10-23', method: 'bank-transfer' });
  assert.equal(paid.invoice.status, 'paid');
  assert.equal(paid.payments[0]!.currency, 'USD');
});

test('a foreign invoice shows bank details with SWIFT, never a rupee UPI link, and can be billed in parts', async () => {
  const env = await goalBusiness();
  await confirmLut(env);
  await env.money('venture.billing.set', { upiId: 'ledger.cafe@okaxis', bank: { accountName: 'Ledger Cafe Books', accountNumber: '000123456789', ifsc: 'HDFC0001234', swift: 'HDFCINBB' } });
  const client = await usClient(env);
  const order = await env.money<OrderRecord>('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Close our books for October.', currency: 'USD', unitPrice: '2401' });
  // Advance 50% of USD 2,401.00: 240100 x 5000 / 10000 = 120050, no tax under the LUT.
  const advance = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id, part: { kind: 'advance', percent: '50' } });
  assert.equal(advance.invoice.totalMinor, '120050');
  assert.equal(advance.invoice.currency, 'USD');
  const issued = await env.money<InvoiceView>('venture.invoice.issue', { invoiceId: advance.invoice.id, digest: advance.invoice.digest });
  assert.equal(issued.howToPay?.upi, null);
  assert.equal(issued.howToPay?.upiNote, 'UPI takes rupees only, so this invoice in USD shows your bank details instead.');
  assert.match(issued.documentText, /IFSC HDFC0001234, SWIFT HDFCINBB/);
  assert.ok(!issued.documentText.includes('upi://'));
  const rest = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id });
  assert.equal(rest.invoice.totalMinor, '120050');
});
