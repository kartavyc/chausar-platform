import test from 'node:test';
import assert from 'node:assert/strict';
import { zohoBooksAdapters } from '../runtime/writeback/systems/zoho-books.ts';
import { ZohoBooksFake, zohoSeed } from '../fakes/zoho-books/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

function setup() {
  const fake = new ZohoBooksFake();
  const ctx = fakeContext(fake, practiceConnection('zoho-books', { organizationId: zohoSeed.organizationId, dataCenter: 'in' }), { accessToken: zohoSeed.token });
  return { fake, ctx };
}
const customer = '460000000001001', vendor = '460000000001002', invoice = '460000000002001';

test('a draft invoice is created once, read back by its reference, and a repeat finds it instead of creating another', async () => {
  const { fake, ctx } = setup(); const adapter = zohoBooksAdapters['invoice.createDraft'];
  const payload = { customerId: customer, date: '2026-10-14', lines: [{ name: 'Packing boxes', quantity: 3, rateMinor: '25050' }] };
  const first = await cycle(adapter, ctx, payload, 'effect-key-invoice-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.deepEqual((first.observation as any).observed.lines, [{ name: 'Packing boxes', quantity: 3, rateMinor: '25050' }]);
  assert.equal((first.observation as any).observed.totalMinor, '75150');
  assert.equal((first.observation as any).observed.status, 'draft');
  const again = await cycle(adapter, ctx, payload, 'effect-key-invoice-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(again.receipt, null);
  assert.equal(fake.invoices.length, 2);
});

test('a lost reply after commit is settled by reading back, never by sending again', async () => {
  const { fake, ctx } = setup(); const adapter = zohoBooksAdapters['payment.record'];
  fake.fault('drop-after-commit');
  const result = await cycle(adapter, ctx, { customerId: customer, invoiceId: invoice, amountMinor: '60000', date: '2026-10-14', mode: 'banktransfer', bankReference: 'UTR123' }, 'effect-key-pay-1');
  assert.equal(result.doError, 'FAKE_CONNECTION_LOST');
  assert.equal(result.observation.outcome, 'confirmed-applied');
  assert.equal(fake.payments.length, 1);
  assert.equal((fake.snapshot() as any).invoices[0].balance, 400);
});

test('a payment larger than the balance is refused at prepare', async () => {
  const { ctx } = setup();
  await assert.rejects(cycle(zohoBooksAdapters['payment.record'], ctx, { customerId: customer, invoiceId: invoice, amountMinor: '100001', date: '2026-10-14', mode: 'upi' }, 'effect-key-pay-2'), { code: 'WRITE_PRECONDITION_FAILED' });
});

test('a payment reminder carries its reference, is read back from the comments, and is not sent twice', async () => {
  const { fake, ctx } = setup(); const adapter = zohoBooksAdapters['invoice.paymentReminder'];
  const payload = { invoiceId: invoice, to: ['accounts@asha.example'], subject: 'Invoice INV-000101 is due', body: 'Please pay the balance using the invoice link.' };
  const first = await cycle(adapter, ctx, payload, 'effect-key-rem-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.match((first.preparation.preview as any).asWritten, /Ref: CHS-/);
  const again = await cycle(adapter, ctx, payload, 'effect-key-rem-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(fake.comments.length, 1);
});

test('a contact change refuses when the contact changed after the preview', async () => {
  const { fake, ctx } = setup(); const adapter = zohoBooksAdapters['contact.update'];
  const payload = adapter.validate({ contactId: customer, changes: { email: 'new@asha.example' } });
  const preparation = await adapter.prepare(ctx, payload, 'effect-key-contact-1');
  assert.deepEqual((preparation.preview as any).fields, [{ name: 'email', before: 'accounts@asha.example', after: 'new@asha.example' }]);
  fake.contacts[0].email = 'someone-else@asha.example';
  await assert.rejects(adapter.do(ctx, payload, preparation, 'effect-key-contact-1'), { code: 'WRITE_PRECONDITION_FAILED' });
});

test('contacts and photo bills are created once and a duplicate bill number is refused', async () => {
  const { ctx } = setup();
  const contact = await cycle(zohoBooksAdapters['contact.create'], ctx, { name: 'Chitra Stores (synthetic)', type: 'customer', email: 'hello@chitra.example' }, 'effect-key-contact-2');
  assert.equal(contact.observation.outcome, 'confirmed-applied');
  const bill = { vendorId: vendor, billNumber: 'BP-77', date: '2026-10-10', lines: [{ name: 'Cartons', quantity: 10, rateMinor: '1200' }] };
  assert.equal((await cycle(zohoBooksAdapters['bill.createFromPhoto'], ctx, bill, 'effect-key-bill-1')).observation.outcome, 'confirmed-applied');
  await assert.rejects(cycle(zohoBooksAdapters['bill.createFromPhoto'], ctx, bill, 'effect-key-bill-2'), { code: 'WRITE_PRECONDITION_FAILED' });
});

test('wrong credentials and unknown fields are refused with fixed codes', async () => {
  const { fake } = setup();
  const ctx = fakeContext(fake, practiceConnection('zoho-books', { organizationId: zohoSeed.organizationId, dataCenter: 'in' }), { accessToken: 'wrong' });
  await assert.rejects(cycle(zohoBooksAdapters['invoice.createDraft'], ctx, { customerId: customer, date: '2026-10-14', lines: [{ name: 'X', quantity: 1, rateMinor: '100' }] }, 'effect-key-x-1'), { code: 'WRITE_AUTH_REFUSED' });
  assert.throws(() => zohoBooksAdapters['invoice.createDraft'].validate({ customerId: customer, date: '2026-10-14', lines: [{ name: 'X', quantity: 1, rateMinor: '1.50' }] }), { code: 'INVALID_AMOUNT' });
  assert.throws(() => zohoBooksAdapters['invoice.createDraft'].validate({ customerId: customer, date: '2026-10-14', lines: [], send: true }), { code: 'INVALID_WRITE_PAYLOAD' });
});
