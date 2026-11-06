// Wave 6, 6E2 and 6E3: the fake engine's lesson and booking desks answer like the engine. They run the engine's own
// cores, so codes, words and digests match; fees and deposits go through the fake money's invoices, the deposit pays
// through the invoice's How to pay UPI link, and a message is handed to the owner, never sent.
import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

async function business() {
  const client = createFakeClient(new FakeEngine());
  const orders = await client.request('venture.order.list', {});
  const order = orders.find(row => row.status !== 'cancelled' && !row.internal)!;
  const clients = await client.request('venture.client.list', {});
  const guardian = clients.find(row => row.id === order.clientId)!;
  return { client, order, guardian };
}

describe('fake lesson desk (6E2)', () => {
  it('keeps a batch with code counts, refuses stale digests and hands a parent message to the owner', async () => {
    const { client, order, guardian } = await business();
    const lesson = { playbook: 'lesson-desk' as const, kind: 'batch' };
    const made = await client.request('venture.desk.act', { ...lesson, id: 'new', action: 'create', payload: { name: 'Class 8 maths', subject: 'Maths', days: ['mon', 'wed'], time: '17:00', minutes: 60 } });
    const id = made.id;
    const get = () => client.request('venture.desk.get', { ...lesson, id });
    const act = async (action: string, payload: unknown) => client.request('venture.desk.act', { ...lesson, id, action, payload, digest: (await get()).digest });
    await act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: guardian.id, orderId: order.id });
    await act('session', { on: '2026-10-26', topic: 'Fractions' });
    const item = (await get()).item as any;
    await act('attendance', { sessionId: item.sessions[0].id, marks: { l1: 'present' } });
    const view = (await get()).item as any;
    expect(view.learners[0].attendance.line).toBe('Attended 1 of 1 classes.');
    expect(view.learners[0].consent.state).toBe('needed');
    await expect(client.request('venture.desk.act', { ...lesson, id, action: 'session', payload: { on: '2026-10-27', topic: 'x' }, digest: 'stale' })).rejects.toMatchObject({ code: 'APPROVAL_CHANGED' });
    await expect(act('attendance', { sessionId: item.sessions[0].id, marks: { l9: 'present' } })).rejects.toMatchObject({ code: 'LESSON_LEARNER_NOT_FOUND', message: 'Choose a learner in this batch.' });
    await act('progress', { learnerId: 'l1', note: 'Good work.', channel: 'whatsapp', phone: '+919812345678' });
    const message = ((await get()).item as any).messages[0];
    expect(message.text).toContain('Attended 1 of 1 classes.');
    const handed = await act('handoff', { messageId: message.id }) as any;
    expect(handed.result.handoff.url).toMatch(/^https:\/\/wa\.me\/919812345678\?text=/);
    expect(handed.line).toMatch(/sends nothing/i);
    expect(((await get()).item as any).messages[0].handedOffAt).toBeTruthy();
  });

  it('a fee is an invoice drafted on the learner\'s order by the money desk', async () => {
    const { client, order, guardian } = await business();
    const lesson = { playbook: 'lesson-desk' as const, kind: 'batch' };
    const id = (await client.request('venture.desk.act', { ...lesson, id: 'new', action: 'create', payload: { name: 'Yoga', subject: 'Yoga', days: ['sat'], time: '07:00', minutes: 60 } })).id;
    const get = () => client.request('venture.desk.get', { ...lesson, id });
    const act = async (action: string, payload: unknown) => client.request('venture.desk.act', { ...lesson, id, action, payload, digest: (await get()).digest });
    await act('add-learner', { name: 'Meera Iyer', minor: false, guardianClientId: guardian.id, orderId: order.id });
    const billed = await act('fee', { learnerId: 'l1' }) as any;
    const invoice = await client.request('venture.invoice.get', { invoiceId: billed.result.invoiceId });
    expect(invoice.invoice.orderId).toBe(order.id);
    const fee = ((await get()).item as any).learners[0].fees.find((row: any) => row.invoiceId === invoice.invoice.id);
    expect(fee.total).toBe(invoice.figures.find(row => row.key === 'total')!.display);
  });
});

describe('fake booking desk (6E3)', () => {
  it('slots, a quote from the order receipt, a deposit invoice with its UPI link, and a reminder handed to the owner', async () => {
    const { client, order, guardian } = await business();
    await client.request('venture.billing.set', { upiId: 'asha.salon@okaxis', payeeName: 'Asha Salon' });
    const slot = { playbook: 'booking-desk' as const, kind: 'slot' };
    const booking = { playbook: 'booking-desk' as const, kind: 'booking' };
    const slotId = (await client.request('venture.desk.act', { ...slot, id: 'new', action: 'add', payload: { start: '2026-11-05T10:00', minutes: 90 } })).id;
    await expect(client.request('venture.desk.act', { ...slot, id: 'new', action: 'add', payload: { start: '2026-11-05T11:00', minutes: 60 } })).rejects.toMatchObject({ code: 'BOOKING_SLOT_CLASH' });
    const id = (await client.request('venture.desk.act', { ...booking, id: 'new', action: 'intake', payload: { clientId: guardian.id, request: 'AC service at home', address: 'Baner, Pune', phone: '+919812345678' } })).id;
    const get = () => client.request('venture.desk.get', { ...booking, id });
    const act = async (action: string, payload: unknown) => client.request('venture.desk.act', { ...booking, id, action, payload, digest: (await get()).digest });
    await expect(act('deposit', { percent: '25' })).rejects.toMatchObject({ code: 'BOOKING_QUOTE_REQUIRED' });
    await act('quote', { orderId: order.id });
    expect(((await get()).item as any).quote.total).toBeTruthy();
    await act('hold', { slotId });
    await act('deposit', { percent: '25' });
    const drafted = ((await get()).item as any).deposit;
    expect(drafted.status).toBe('draft');
    await act('issue-deposit', { invoiceDigest: drafted.digest });
    const issued = ((await get()).item as any).deposit;
    expect(issued.status).toBe('issued');
    expect(issued.upi.link).toMatch(/^upi:\/\/pay\?pa=asha\.salon@okaxis/);
    await act('remind', { kind: 'deposit', channel: 'whatsapp' });
    const message = ((await get()).item as any).messages[0];
    // B2 fix round 1: the desk shows the owner form; the message to the client quotes the exact form, as the engine does.
    expect(issued.balance).toBe('₹7,500');
    expect(message.text).toContain('deposit of INR 7,500.00 for invoice');
    expect(message.text).toContain(issued.upi.link);
    const handed = await act('handoff', { messageId: message.id }) as any;
    expect(handed.result.handoff.url).toMatch(/^https:\/\/wa\.me\/919812345678/);
    await act('confirm', {});
    expect(((await client.request('venture.desk.get', { ...slot, id: slotId })).item as any).state).toBe('booked');
  });
});
