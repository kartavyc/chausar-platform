// Wave 6, 6E3: the booking desk (intake, slots, quotes, deposits through the UPI link, reminders). The quote is the
// order's own price receipt; the deposit is an advance invoice on that order (6D1), paid through its How to pay UPI link
// (6D2); every amount a client sees comes from those code receipts, never from the AI. Reminders are drafted by fixed
// templates and handed to the owner through the action journal after exact approval; Chausar sends nothing.
import { formatMoney } from '../runtime/owner-format.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { formatMinor } from '../runtime/currency.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';

const slot = (id: string) => ({ playbook: 'booking-desk', kind: 'slot', id });
const booking = (id: string) => ({ playbook: 'booking-desk', kind: 'booking', id });

async function setup() {
  const env = await kitBusiness({ now: new Date('2026-11-01T05:00:00.000Z') });
  const call = env.call;
  const addSlot = async (start: string, minutes = 60) => (await call('venture.desk.act', { ...slot('new'), action: 'add', payload: { start, minutes, note: 'Home visit' } })).id as string;
  const getBooking = (id: string) => call('venture.desk.get', booking(id));
  const act = async (id: string, action: string, payload: unknown) => call('venture.desk.act', { ...booking(id), action, payload, digest: (await getBooking(id)).digest });
  const intake = async (request = 'Bridal makeup at home, two people') => (await call('venture.desk.act', { ...booking('new'), action: 'intake', payload: { clientId: env.client.id, request, address: 'Flat 4, Baner Road, Pune', phone: '+919812345678' } })).id as string;
  const order = await call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0]!.id, quantity: '2', request: 'Bridal makeup at home, two people' });
  return { env, call, addSlot, getBooking, act, intake, order };
}

test('6E3 the booking desk is a registered playbook with a kit definition and its own picks', () => {
  const entry = PLAYBOOK_REGISTRY.find(item => item.id === 'booking-desk');
  assert.ok(entry, 'registered');
  assert.equal(entry.label, 'Booking desk for local services');
  assert.equal(pickPlaybook('I run a home salon and take bookings by WhatsApp')?.id, 'booking-desk');
  const definition = PLAYBOOK_DEFINITIONS.find(item => item.registration.id === 'booking-desk');
  assert.ok(definition, 'defined');
  assert.ok(definition.offers.some(offer => offer.pilotable));
  assert.ok(definition.rules.some(rule => rule.id === 'deposit-is-an-invoice'));
});

test('6E3 slots: the owner adds open times; a clash is refused; a held slot cannot be closed or held twice', async () => {
  const f = await setup();
  const first = await f.addSlot('2026-11-05T10:00', 90);
  await assert.rejects(f.addSlot('2026-11-05T11:00', 60), { code: 'BOOKING_SLOT_CLASH' });
  const second = await f.addSlot('2026-11-05T11:30', 60);
  await assert.rejects(f.addSlot('2026-11-05T25:00'), { code: 'INVALID_VENTURE_REQUEST' });
  const list = await f.call('venture.desk.list', { playbook: 'booking-desk', kind: 'slot' });
  assert.deepEqual(list.rows.map((row: { id: string; state: string }) => [row.id, row.state]), [[first, 'open'], [second, 'open']]);
  const a = await f.intake(), b = await f.intake('Haircut at home');
  await f.act(a, 'hold', { slotId: first });
  await assert.rejects(f.act(b, 'hold', { slotId: first }), { code: 'BOOKING_SLOT_TAKEN' });
  const shown = await f.call('venture.desk.get', slot(first));
  await assert.rejects(f.call('venture.desk.act', { ...slot(first), action: 'close', payload: {}, digest: shown.digest }), { code: 'BOOKING_SLOT_TAKEN' });
  await f.act(a, 'release', {});
  const again = await f.call('venture.desk.get', slot(first));
  await f.call('venture.desk.act', { ...slot(first), action: 'close', payload: {}, digest: again.digest });
  assert.equal((await f.call('venture.desk.get', slot(first))).item.state, 'closed');
});

test('6E3 the quote is the order\'s own price receipt; the deposit is an advance invoice on that order, never a new money path', async () => {
  const f = await setup();
  const id = await f.intake();
  await assert.rejects(f.act(id, 'deposit', { percent: '25' }), { code: 'BOOKING_QUOTE_REQUIRED' });
  await f.act(id, 'quote', { orderId: f.order.id });
  const receipt = listRecords(f.env.store.read(), 'venture-price-receipt').find(row => row.id === f.order.priceReceiptId)!;
  const quoted = (await f.getBooking(id)).item;
  assert.deepEqual([quoted.status, quoted.quote.receiptId, quoted.quote.total], ['quoted', receipt.id, formatMoney(receipt.totalMinor, receipt.currency)]);
  await f.act(id, 'deposit', { percent: '25' });
  const view = (await f.getBooking(id)).item;
  const invoice = listRecords(f.env.store.read(), 'venture-invoice').find(row => row.id === view.deposit.invoiceId)!;
  assert.equal(invoice.orderId, f.order.id);
  assert.equal(invoice.part?.kind, 'advance');
  assert.equal(BigInt(invoice.totalMinor) * 4n, BigInt(receipt.totalMinor), 'a quarter of the quote, cut by the invoice code');
  assert.deepEqual([view.deposit.status, view.deposit.total], ['draft', formatMoney(invoice.totalMinor, invoice.currency)]);
  const other = await f.call('venture.order.create', { clientId: f.env.client.id, offerId: f.env.offers[0]!.id, request: 'Another job' });
  const second = await f.intake('Haircut at home');
  await f.act(second, 'quote', { orderId: other.id });
  await assert.rejects(f.act(second, 'quote', { orderId: f.order.id }), { code: 'BOOKING_ORDER_TAKEN' });
});

test('6E3 deposits are paid through the invoice\'s UPI link; reminders carry code amounts and are handed to the owner after exact approval', async () => {
  const f = await setup();
  await f.call('venture.billing.set', { upiId: 'asha.salon@okaxis', payeeName: 'Asha Salon' });
  const slotId = await f.addSlot('2026-11-05T10:00', 90);
  const id = await f.intake();
  await f.act(id, 'quote', { orderId: f.order.id });
  await f.act(id, 'hold', { slotId });
  await f.act(id, 'deposit', { percent: '25' });
  await assert.rejects(f.act(id, 'remind', { kind: 'deposit', channel: 'whatsapp' }), { code: 'BOOKING_DEPOSIT_NOT_ISSUED' });
  const drafted = (await f.getBooking(id)).item.deposit;
  await f.act(id, 'issue-deposit', { invoiceDigest: drafted.digest });
  const issued = (await f.getBooking(id)).item.deposit;
  const invoice = listRecords(f.env.store.read(), 'venture-invoice').find(row => row.id === issued.invoiceId)!;
  assert.equal(issued.status, 'issued');
  assert.match(issued.upi.link, /^upi:\/\/pay\?pa=asha\.salon@okaxis/);
  assert.match(issued.upi.link, new RegExp(`am=${(Number(invoice.balanceMinor) / 100).toFixed(2).replace('.', '\\.')}`));
  await f.act(id, 'remind', { kind: 'deposit', channel: 'whatsapp' });
  await f.act(id, 'remind', { kind: 'appointment', channel: 'email' });
  const [deposit, appointment] = (await f.getBooking(id)).item.messages;
  assert.ok(deposit.text.includes(formatMinor(invoice.balanceMinor, invoice.currency)), 'the amount is the invoice balance, formatted by code');
  assert.ok(deposit.text.includes(issued.upi.link));
  assert.equal(deposit.to, '+919812345678');
  assert.match(appointment.text, /5 Nov 2026 at 10:00/);
  assert.match(appointment.text, /Flat 4, Baner Road, Pune/);
  assert.doesNotMatch(appointment.text, /₹|INR/, 'an appointment reminder names no amount');
  const handed = await f.act(id, 'handoff', { messageId: deposit.id });
  assert.match(handed.result.handoff.url, /^https:\/\/wa\.me\/919812345678\?text=/);
  const entry = listRecords(f.env.store.read(), 'venture-journal-entry').find(row => row.action === 'owner.handoff')!;
  assert.deepEqual([entry.state, entry.actionDigest], ['applied', deposit.digest]);
  await f.act(id, 'confirm', {});
  assert.equal((await f.getBooking(id)).item.status, 'confirmed');
  assert.equal((await f.call('venture.desk.get', slot(slotId))).item.state, 'booked');
});

test('6E3 cancelling frees the slot; Forget removes the client\'s bookings', async () => {
  const f = await setup();
  const slotId = await f.addSlot('2026-11-05T10:00', 60);
  const id = await f.intake();
  await f.act(id, 'hold', { slotId });
  await f.act(id, 'cancel', {});
  assert.equal((await f.call('venture.desk.get', slot(slotId))).item.state, 'open');
  const kept = await f.intake();
  await f.act(kept, 'hold', { slotId });
  const { eraseBookings } = await import('../runtime/venture/playbooks/booking-desk/privacy.ts');
  await ventureAction(f.env.deps, owner, 'approve', 'fixture.forget', tx => { eraseBookings(tx, new Set([f.env.client.id]), new Set(), () => false); });
  const list = await f.call('venture.desk.list', { playbook: 'booking-desk', kind: 'booking' });
  assert.equal(list.rows.length, 0);
  assert.equal((await f.call('venture.desk.get', slot(slotId))).item.state, 'open');
});
