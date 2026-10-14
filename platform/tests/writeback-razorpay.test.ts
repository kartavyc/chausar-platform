import test from 'node:test';
import assert from 'node:assert/strict';
import { razorpayAdapters } from '../runtime/writeback/systems/razorpay.ts';
import { RazorpayFake, razorpaySeed } from '../fakes/razorpay/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

const clock = () => '2026-10-14T09:00:00.000Z';
function setup(secret = { keyId: razorpaySeed.keyId, keySecret: razorpaySeed.keySecret }) {
  const fake = new RazorpayFake(razorpaySeed, clock);
  const ctx = fakeContext(fake, practiceConnection('razorpay', {}), secret, clock);
  return { fake, ctx };
}
const fresh = 'pay_SYNTH00000001A', partial = 'pay_SYNTH00000002B', held = 'pay_SYNTH00000003C';
const link = { amountMinor: '150000', description: 'October order (synthetic)', customer: { name: 'Asha Traders (synthetic)', email: 'accounts@asha.example', contact: '919000000001' }, expireBy: '2026-10-21T09:00:00Z' };

test('a payment link is created once with notifications off, read back by its reference, and a repeat finds it', async () => {
  const { fake, ctx } = setup(); const adapter = razorpayAdapters['paymentLink.create'];
  const first = await cycle(adapter, ctx, link, 'effect-key-link-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.deepEqual((first.observation as any).observed, { reference_id: first.preparation.postconditions.reference_id, amountMinor: '150000', currency: 'INR', description: 'October order (synthetic)', status: 'created' });
  assert.equal((first.observation as any).businessSuccess, true);
  assert.deepEqual(fake.paymentLinks[0].notify, { sms: false, email: false });
  assert.equal(fake.paymentLinks[0].reminder_enable, false); assert.equal(fake.paymentLinks[0].amount, 150000); assert.equal(fake.paymentLinks[0].customer.contact, '+919000000001');
  const again = await cycle(adapter, ctx, link, 'effect-key-link-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(again.receipt, null);
  assert.equal(fake.paymentLinks.length, 1);
  await assert.rejects(adapter.do(ctx, adapter.validate(link), first.preparation, 'effect-key-link-1'), { code: 'WRITE_SYSTEM_REFUSED' });
  assert.equal(fake.paymentLinks.length, 1);
});

test('a notify field anywhere in a payment link is refused', () => {
  const adapter = razorpayAdapters['paymentLink.create'];
  assert.throws(() => adapter.validate({ ...link, notify: { sms: true } }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => adapter.validate({ ...link, customer: { ...link.customer, notify: false } }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => adapter.validate({ ...link, reminder_enable: true }), { code: 'INVALID_WRITE_PAYLOAD' });
});

test('a lost refund reply after commit is settled by reading back, with exactly one refund', async () => {
  const { fake, ctx } = setup(); const adapter = razorpayAdapters['refund.create'];
  fake.fault('drop-after-commit');
  const payload = { paymentId: fresh, amountMinor: '50000', note: 'Damaged carton (synthetic)' };
  const result = await cycle(adapter, ctx, payload, 'effect-key-refund-1');
  assert.equal(result.doError, 'FAKE_CONNECTION_LOST');
  assert.equal(result.observation.outcome, 'confirmed-applied');
  assert.deepEqual((result.observation as any).observed, { receipt: result.preparation.postconditions.receipt, amountMinor: '50000', payment_id: fresh, status: 'processed' });
  const again = await cycle(adapter, ctx, payload, 'effect-key-refund-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(again.receipt, null);
  assert.equal(fake.refunds.filter(r => r.payment_id === fresh).length, 1);
  assert.equal(fake.payments[0].amount_refunded, 50000);
});

test('the refund idempotency header returns the same refund when the same key is sent again', async () => {
  const { fake, ctx } = setup(); const adapter = razorpayAdapters['refund.create'];
  const payload = adapter.validate({ paymentId: fresh, amountMinor: '20000' });
  const preparation = await adapter.prepare(ctx, payload, 'effect-key-refund-2');
  fake.fault('drop-after-commit');
  await assert.rejects(adapter.do(ctx, payload, preparation, 'effect-key-refund-2'), { code: 'FAKE_CONNECTION_LOST' });
  const raw = await ctx.http({ method: 'POST', url: `https://api.razorpay.com/v1/payments/${fresh}/refund`, headers: { authorization: `Basic ${Buffer.from(`${razorpaySeed.keyId}:${razorpaySeed.keySecret}`).toString('base64')}`, 'x-refund-idempotency': 'effect-key-refund-2', 'content-type': 'application/json' }, body: JSON.stringify(preparation.command) });
  assert.equal(raw.status, 200);
  assert.equal(fake.refunds.filter(r => r.payment_id === fresh).length, 1);
  assert.equal(JSON.parse(raw.body).id, fake.refunds.find(r => r.payment_id === fresh)!.id);
});

test('a refund above what is left, or on a payment not captured, is refused at prepare', async () => {
  const { ctx } = setup(); const adapter = razorpayAdapters['refund.create'];
  await assert.rejects(cycle(adapter, ctx, { paymentId: partial, amountMinor: '50001' }, 'effect-key-refund-3'), { code: 'WRITE_PRECONDITION_FAILED' });
  assert.equal((await cycle(adapter, ctx, { paymentId: partial, amountMinor: '50000' }, 'effect-key-refund-4')).observation.outcome, 'confirmed-applied');
  await assert.rejects(cycle(adapter, ctx, { paymentId: held, amountMinor: '100' }, 'effect-key-refund-5'), { code: 'WRITE_PRECONDITION_FAILED' });
});

test('a refund refuses when the payment changed between prepare and do', async () => {
  const { fake, ctx } = setup(); const adapter = razorpayAdapters['refund.create'];
  const payload = adapter.validate({ paymentId: partial, amountMinor: '40000' });
  const preparation = await adapter.prepare(ctx, payload, 'effect-key-refund-6');
  assert.deepEqual((preparation.preview as any).fields[2], { name: 'Left to refund', before: '₹500.00', after: '₹100.00' });
  fake.payments[1].amount_refunded = 60000;
  await assert.rejects(adapter.do(ctx, payload, preparation, 'effect-key-refund-6'), { code: 'WRITE_PRECONDITION_FAILED' });
  assert.equal(fake.refunds.length, 1);
});

test('wrong credentials and float-looking amounts are refused with fixed codes', async () => {
  const { ctx } = setup({ keyId: razorpaySeed.keyId, keySecret: 'wrong' });
  await assert.rejects(cycle(razorpayAdapters['paymentLink.create'], ctx, link, 'effect-key-x-1'), { code: 'WRITE_AUTH_REFUSED' });
  await assert.rejects(cycle(razorpayAdapters['refund.create'], setup({ keyId: razorpaySeed.keyId } as any).ctx, { paymentId: fresh, amountMinor: '100' }, 'effect-key-x-2'), { code: 'WRITE_CREDENTIALS_UNAVAILABLE' });
  for (const amountMinor of ['1500.00', '1.5', 1500, '-100', '0', '1e5', '9999999999999999']) {
    assert.throws(() => razorpayAdapters['refund.create'].validate({ paymentId: fresh, amountMinor }), { code: 'INVALID_AMOUNT' });
    assert.throws(() => razorpayAdapters['paymentLink.create'].validate({ ...link, amountMinor }), { code: 'INVALID_AMOUNT' });
  }
  assert.throws(() => razorpayAdapters['refund.create'].validate({ paymentId: 'order_123', amountMinor: '100' }), { code: 'INVALID_WRITE_PAYLOAD' });
});
