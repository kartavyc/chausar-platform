// Wave 6 money (6D1): configurable invoices. Several invoices per order (an advance, milestones, a part payment, the
// final one), due dates on orders and invoices, payment terms and reminder schedules, every amount BigInt with a receipt,
// and each invoice still issued only on the owner's approval of its exact digest. Amounts are worked out by hand.
//
// The goals business: ₹19,750 a month, GST 18% split CGST and SGST for a client in state 27:
// taxable 1975000, CGST 177750, SGST 177750, total 2330500.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceView, OrderRecord, PriceReceiptRecord } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { goalBusiness, type GoalEnv } from './venture-goals-helpers.ts';
import { code } from './venture-views-env.ts';

async function order(env: GoalEnv, extra: Record<string, unknown> = {}) {
  return env.money<OrderRecord>('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Close the month of books.', ...extra });
}
const issue = (env: GoalEnv, view: InvoiceView) => env.money<InvoiceView>('venture.invoice.issue', { invoiceId: view.invoice.id, digest: view.invoice.digest });

test('one final invoice due in 7 days is the default, and the owner can change the days', async () => {
  const env = await goalBusiness();
  const first = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: (await order(env)).id });
  assert.equal(first.invoice.issueDate, '2026-10-23');
  assert.equal(first.invoice.dueDate, '2026-10-30');
  assert.equal(first.invoice.dueInDays, 7);
  assert.equal(first.invoice.part, undefined, 'a whole-order invoice carries no part');
  assert.equal(first.invoice.totalMinor, '2330500');
  const billing = await env.money<{ settings: { dueInDays: number } }>('venture.billing.set', { dueInDays: 10 });
  assert.equal(billing.settings.dueInDays, 10);
  const second = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: (await order(env)).id });
  assert.equal(second.invoice.dueDate, '2026-11-02');
  await assert.rejects(env.money('venture.billing.set', { dueInDays: 91 }), code('INVALID_VENTURE_REQUEST'));
});

test('an advance, a milestone and the final invoice add up to the order exactly, each with its receipt', async () => {
  const env = await goalBusiness();
  const made = await order(env);
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: made.id, part: { kind: 'advance', percent: '100' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: made.id, part: { kind: 'final', percent: '10' } }), code('INVALID_VENTURE_REQUEST'));

  // Advance 30%: taxable 1975000 x 3000 / 10000 = 592500; CGST = SGST = (592500 x 1800 + 10000) / 20000 = 53325; total 699150.
  const advance = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: made.id, part: { kind: 'advance', percent: '30' } });
  assert.equal(advance.invoice.subtotalMinor, '592500');
  assert.deepEqual(advance.invoice.taxLines.map(line => line.minor), ['53325', '53325']);
  assert.equal(advance.invoice.totalMinor, '699150');
  assert.equal(advance.invoice.part?.kind, 'advance');
  assert.equal(advance.invoice.part?.shareBps, '3000');
  assert.equal(advance.invoice.part?.orderTotalMinor, '2330500');
  assert.equal(advance.invoice.lines[0]!.description, 'Monthly books: Advance');
  assert.equal(advance.receipt.totalMinor, '699150', 'the price receipt proves this invoice, not the whole order');
  assert.match(advance.receipt.explanation, /30% of the order/);
  const basis = listRecords(env.store.read(), 'venture-price-receipt').find(r => r.id === advance.invoice.part?.basisReceiptId) as PriceReceiptRecord;
  assert.equal(basis.totalMinor, '2330500');
  await assert.rejects(env.money('venture.invoice.issue', { invoiceId: advance.invoice.id, digest: 'stale0digest' }), code('APPROVAL_STALE'));
  const issuedAdvance = await issue(env, advance);
  assert.equal(issuedAdvance.invoice.number, 'INV-0001');
  assert.equal(listRecords(env.store.read(), 'venture-order').find(o => o.id === made.id)!.status, 'open', 'part billed: the order stays open');
  assert.deepEqual(issuedAdvance.billed && { billed: issuedAdvance.billed.billedMinor, left: issuedAdvance.billed.leftMinor }, { billed: '699150', left: '1631350' });

  // Milestone 40%: taxable 790000; CGST = SGST = (790000 x 1800 + 10000) / 20000 = 71100; total 932200.
  const milestone = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: made.id, part: { kind: 'milestone', label: 'Draft books delivered', percent: '40' } });
  assert.equal(milestone.invoice.totalMinor, '932200');
  assert.equal(milestone.invoice.part?.earlierMinor, '699150');
  assert.equal(milestone.invoice.part?.basisReceiptId, advance.invoice.part?.basisReceiptId, 'later parts cut from the same order receipt');
  assert.equal(milestone.invoice.lines[0]!.description, 'Monthly books: Draft books delivered');
  await issue(env, milestone);

  // 30% + 40% are billed; another 40% passes what is left.
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: made.id, part: { kind: 'advance', percent: '40' } }), code('ORDER_OVER_INVOICED'));
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: made.id, part: { kind: 'partial', amount: '6000' } }), code('ORDER_OVER_INVOICED'));

  // Final: the exact rest. taxable 1975000 - 592500 - 790000 = 592500; each half 177750 - 53325 - 71100 = 53325;
  // total 2330500 - 699150 - 932200 = 699150.
  const final = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: made.id });
  assert.equal(final.invoice.part?.kind, 'final');
  assert.equal(final.invoice.subtotalMinor, '592500');
  assert.deepEqual(final.invoice.taxLines.map(line => line.minor), ['53325', '53325']);
  assert.equal(final.invoice.totalMinor, '699150');
  assert.match(final.receipt.explanation, /less/);
  await issue(env, final);
  const invoices = listRecords(env.store.read(), 'venture-invoice').filter(i => i.orderId === made.id);
  assert.equal(invoices.reduce((sum, i) => sum + BigInt(i.totalMinor), 0n), 2330500n);
  assert.equal(listRecords(env.store.read(), 'venture-order').find(o => o.id === made.id)!.status, 'invoiced');
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: made.id }), code('QUOTE_ALREADY_INVOICED'));
});

test('a part payment of a typed amount before tax, and only one draft per order at a time', async () => {
  const env = await goalBusiness();
  const made = await order(env);
  // 5000.00 before tax: CGST = SGST = (500000 x 1800 + 10000) / 20000 = 45000; total 590000.
  const draft = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: made.id, part: { kind: 'partial', amount: '5,000' } });
  assert.equal(draft.invoice.totalMinor, '590000');
  assert.equal(draft.invoice.lines[0]!.description, 'Monthly books: Part payment');
  const again = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: made.id, part: { kind: 'advance', percent: '50' } });
  assert.equal(again.invoice.id, draft.invoice.id, 'a second prepare replaces the draft');
  assert.equal(listRecords(env.store.read(), 'venture-invoice').filter(i => i.orderId === made.id).length, 1);
  // A typed amount that is all that is left becomes the final cut.
  const whole = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: made.id, part: { kind: 'partial', amount: '19750' } });
  assert.equal(whole.invoice.part?.kind, 'final');
  assert.equal(whole.invoice.totalMinor, '2330500');
});

test('due dates on orders, payment terms on invoices and the reminder schedule are the owner\'s', async () => {
  const env = await goalBusiness();
  await assert.rejects(order(env, { dueDate: '2026-13-01' }), code('INVALID_VENTURE_REQUEST'));
  const dated = await order(env, { dueDate: '2026-11-20' });
  assert.equal(dated.dueDate, '2026-11-20');
  await env.money('venture.billing.set', { terms: 'Pay within the due date by UPI or bank transfer.', reminderDays: [5, 15] });
  const view = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: dated.id });
  assert.equal(view.invoice.dueDate, '2026-11-20', "the order's own due date");
  assert.equal(view.invoice.terms, 'Pay within the due date by UPI or bank transfer.');
  assert.match(view.documentText, /Terms: Pay within the due date by UPI or bank transfer\./);
  const issued = await issue(env, view);
  // Day 1 late is before the first reminder day the owner picked (5).
  env.advance(29 * 86_400_000); // 2026-11-21
  const late = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: issued.invoice.id });
  assert.match(late.next!.line, /A reminder is due on 25 Nov 2026/);
  // An invoice's own schedule wins over the business default.
  const own = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: (await order(env)).id, dueInDays: 0, reminderDays: [2] });
  assert.deepEqual(own.invoice.reminderDays, [2]);
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: (await order(env)).id, reminderDays: [0] }), code('INVALID_VENTURE_REQUEST'));
});

// C5 task 12: India-friendly payment defaults. The invoice view says which method to start from: the method of the
// business's newest payment, else UPI for a business in rupees, else bank transfer.
test('payment defaults: UPI for a rupee business with no payments, then the newest payment\'s method; bank transfer elsewhere', async () => {
  const env = await goalBusiness();
  const view = await issue(env, await env.money<InvoiceView>('venture.invoice.prepare', { orderId: (await order(env)).id }));
  assert.deepEqual(view.paymentDefaults, { method: 'upi' });
  const paid = await env.money<InvoiceView>('venture.payment.record', { invoiceId: view.invoice.id, amount: '₹1,000', receivedOn: '2026-10-23', method: 'cash' });
  assert.deepEqual(paid.paymentDefaults, { method: 'cash' });
  const { ventureAction } = await import('../runtime/venture/records.ts');
  const { owner } = await import('./venture-views-env.ts');
  await ventureAction(env.deps, owner, 'admin', 'test.usd', tx => {
    const venture = tx.venture!;
    tx.replace({ ...venture, country: { ...venture.country, currency: 'USD' } });
    for (const payment of listRecords(tx.state, 'venture-payment')) tx.replace({ ...payment, ventureId: 'elsewhere' });
  });
  const { paymentDefaultsOf } = await import('../runtime/venture/money/invoices.ts');
  const state = env.store.read();
  assert.deepEqual(paymentDefaultsOf(state, listRecords(state, 'venture-record')[0]!), { method: 'bank-transfer' });
});

// C5 task 13: "I charge GST" on Prices goes through venture.blueprint.update and the plan's own accept. On at 18 percent
// with a GSTIN, the next invoice is a TAX INVOICE with CGST and SGST (IGST across states) and the GSTIN; off, plain.
test('GST: switched on at 18 percent with a GSTIN the next invoice is a tax invoice, across states IGST; switched off, a plain invoice', async () => {
  const env = await goalBusiness();
  const { handlers: core } = await import('../runtime/venture/core/index.ts');
  const { owner } = await import('./venture-views-env.ts');
  const plan = async (patch: unknown) => {
    const updated = await (core as any)['venture.blueprint.update'](env.deps, owner, { patch }) as { blueprint: { digest: string } };
    await (core as any)['venture.blueprint.accept'](env.deps, owner, { digest: updated.blueprint.digest });
  };
  await plan({ taxRegistered: false });
  const off = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: (await order(env)).id });
  assert.equal(off.invoice.documentTitle, 'INVOICE');
  assert.equal(off.invoice.taxMinor, '0');
  await plan({ taxRegistered: true, taxRate: '18', taxId: '27ZZZZZ9999Z1Z8', sacCode: '998222' });
  const on = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: (await order(env)).id });
  assert.equal(on.invoice.documentTitle, 'TAX INVOICE');
  assert.equal(on.invoice.supplierTaxId, '27ZZZZZ9999Z1Z8');
  assert.deepEqual(on.invoice.taxLines.map(line => line.label), ['CGST at 9%', 'SGST at 9%']);
  const far = await env.money<{ id: string }>('venture.client.add', { name: 'Delhi Client', email: 'd@example.com', countryCode: 'IN', stateCode: '07' });
  const across = await env.money<OrderRecord>('venture.order.create', { clientId: far.id, offerId: 'offer_1', request: 'Close the month of books.' });
  const igst = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: across.id });
  assert.deepEqual(igst.invoice.taxLines.map(line => line.label), ['IGST at 18%']);
  await assert.rejects((core as any)['venture.blueprint.update'](env.deps, owner, { patch: { taxId: 'NOT-A-GSTIN' } }), code('INVALID_TAX_ID'));
});
