// The fake engine's booking desk (wave 6, package 6E3): the engine's own core (playbooks/booking-desk/core.ts) over
// in-memory slots and bookings, so codes, words and digests match the engine. The quote is the order's own price
// receipt, the deposit is the fake money's advance invoice with its How to pay UPI link, and a reminder is handed to the
// owner after the exact digest is approved. Nothing is sent and no money moves.
import { check } from '../../../../platform/runtime/portable';
import { ownerHandoff } from '../../../../platform/runtime/venture/playbooks/kit/owner-message';
import { idOf } from '../../../../platform/runtime/venture/playbooks/lesson-desk/core';
import {
  BOOKING_PLAYBOOK, bookingAct, bookingDigest, bookingHandedOff, bookingMessageOf, bookingRequest, bookingRow, bookingView, closeSlot, depositPart, exact,
  newBooking, newSlot, slotDigest, slotView, type BookingWorld, type Held,
} from '../../../../platform/runtime/venture/playbooks/booking-desk/core';
import type { BookingBody, BookingSlotBody } from '../../../../platform/runtime/venture/playbooks/booking-desk/records';
import { EngineError, type ClientLite, type InvoiceViewLite, type OrderLite } from './types';
import type { FakeDeskKind, FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';

const CHANGED = 'Read the booking again before you change it.';

export function fakeBookingWorld(host: W4DeskHost): BookingWorld {
  const orders = () => host.ask('venture.order.list', {}) as OrderLite[];
  return {
    client(id) { const client = (host.ask('venture.client.list', {}) as ClientLite[]).find(row => row.id === id && !row.self); return client ? { id: client.id, name: client.name, email: client.email } : null; },
    order(id) { const order = orders().find(row => row.id === id); return order ? { id: order.id, clientId: order.clientId, status: order.status } : null; },
    quote(orderId) {
      const order = orders().find(row => row.id === orderId);
      const receipt = order ? host.receipt?.(order.priceReceiptId) : undefined;
      const total = receipt?.figures.find(item => item.key === 'total')?.display;
      return receipt && total ? { receiptId: receipt.id, total } : null;
    },
    invoice(id) {
      let view: InvoiceViewLite;
      try { view = host.ask('venture.invoice.get', { invoiceId: id }) as InvoiceViewLite; } catch { return null; }
      const figure = (key: string) => view.figures.find(item => item.key === key)?.display ?? '';
      const upi = view.howToPay?.upi ?? null;
      return { invoiceId: view.invoice.id, number: view.invoice.number, status: view.invoice.status, total: figure('total'), balance: figure('balance'), receiptId: view.invoice.priceReceiptId, digest: view.invoice.digest, upi: upi ? { link: upi.link, amount: upi.amount } : null };
    },
  };
}

export function fakeBookingDeskDesk(host: W4DeskHost): FakePlaybookDesk {
  const spaces = new Map<string, { slots: Map<string, BookingSlotBody>; bookings: Map<string, BookingBody> }>();
  let seq = 0, journals = 0;
  const space = () => { let held = spaces.get(host.current()); if (!held) { held = { slots: new Map(), bookings: new Map() }; spaces.set(host.current(), held); } return held; };
  const slots = (): Held<BookingSlotBody>[] => [...space().slots].map(([id, body]) => ({ id, body })).sort((a, b) => a.body.start.localeCompare(b.body.start) || a.id.localeCompare(b.id));
  const bookings = (): Held<BookingBody>[] => [...space().bookings].map(([id, body]) => ({ id, body }));
  const emit = () => host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() } as never);
  const run = <T>(work: () => T): T => { try { return work(); } catch (error) { const e = error as Error & { code?: string }; throw e instanceof EngineError ? e : new EngineError(e.code ?? 'INVALID_VENTURE_REQUEST', e.message); } };
  const findSlot = (id: string) => { const slot = space().slots.get(id); check(slot, 'BOOKING_SLOT_NOT_FOUND', 'Choose one of your slots.'); return slot; };
  const findBooking = (id: string) => { const booking = space().bookings.get(id); check(booking, 'BOOKING_NOT_FOUND', 'That booking was not found.'); return booking; };
  const slot: FakeDeskKind = {
    list: raw => run(() => { bookingRequest(raw, 'list'); return { playbook: BOOKING_PLAYBOOK, kind: 'slot', rows: slots().map(item => slotView(item.id, item.body, bookings())), line: 'Your open times. A booking holds one.' }; }),
    get: raw => run(() => { const p = bookingRequest(raw, 'get'), id = idOf(p.id, 'Slot'), body = findSlot(id); return { playbook: BOOKING_PLAYBOOK, kind: 'slot', item: slotView(id, body, bookings()), digest: slotDigest(id, body, bookings()) }; }),
    act: raw => run(() => {
      const p = bookingRequest(raw, 'act');
      if (p.action === 'add') {
        check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Add a slot with the id new.');
        const body = newSlot(p.payload, slots()), id = `bookslot_fake${++seq}`;
        space().slots.set(id, body); emit();
        return { playbook: BOOKING_PLAYBOOK, kind: 'slot', id, result: { slotId: id }, line: 'Slot added.' };
      }
      check(p.action === 'close', 'INVALID_VENTURE_REQUEST', 'Choose a slot action.');
      exact(p.payload, []);
      const id = idOf(p.id, 'Slot'), body = findSlot(id);
      check(p.digest === slotDigest(id, body, bookings()), 'APPROVAL_CHANGED', 'Read the slot again before you change it.');
      space().slots.set(id, closeSlot(id, body, bookings())); emit();
      return { playbook: BOOKING_PLAYBOOK, kind: 'slot', id, result: {}, line: 'Slot closed.' };
    }),
  };
  const booking: FakeDeskKind = {
    list: raw => run(() => { bookingRequest(raw, 'list'); const world = fakeBookingWorld(host); return { playbook: BOOKING_PLAYBOOK, kind: 'booking', rows: bookings().map(item => bookingRow(item.id, item.body, world, slots())), line: 'Your bookings, newest last.' }; }),
    get: raw => run(() => { const p = bookingRequest(raw, 'get'), id = idOf(p.id, 'Booking'), body = findBooking(id); return { playbook: BOOKING_PLAYBOOK, kind: 'booking', item: structuredClone(bookingView(id, body, fakeBookingWorld(host), slots())), digest: bookingDigest(body) }; }),
    act: raw => run(() => {
      const p = bookingRequest(raw, 'act');
      const action = typeof p.action === 'string' ? p.action : '';
      const world = fakeBookingWorld(host);
      if (action === 'intake') {
        check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Take a new enquiry with the id new.');
        const body = newBooking(p.payload, world), id = `booking_fake${++seq}`;
        space().bookings.set(id, body); emit();
        return { playbook: BOOKING_PLAYBOOK, kind: 'booking', id, result: { bookingId: id }, line: 'Enquiry saved. Quote it from an order with your price.' };
      }
      const id = idOf(p.id, 'Booking'), body = findBooking(id);
      check(p.digest === bookingDigest(body), 'APPROVAL_CHANGED', CHANGED);
      if (action === 'handoff') {
        const message = bookingMessageOf(body, p.payload), link = ownerHandoff(message);
        if (message.handedOffAt) return { playbook: BOOKING_PLAYBOOK, kind: 'booking', id, result: { messageId: message.id, handoff: link, replayed: true }, line: link.line };
        space().bookings.set(id, bookingHandedOff(body, message.id, host.now(), `journal_fake${++journals}`)); emit();
        return { playbook: BOOKING_PLAYBOOK, kind: 'booking', id, result: { messageId: message.id, handoff: link }, line: link.line };
      }
      if (action === 'issue-deposit') {
        const b = exact(p.payload, ['invoiceDigest']);
        check(body.depositInvoiceId, 'BOOKING_DEPOSIT_REQUIRED', 'Draft the deposit invoice first.');
        const issued = host.ask('venture.invoice.issue', { invoiceId: body.depositInvoiceId, digest: b.invoiceDigest }) as InvoiceViewLite;
        emit();
        return { playbook: BOOKING_PLAYBOOK, kind: 'booking', id, result: { invoiceId: issued.invoice.id, number: issued.invoice.number }, line: 'Deposit invoice issued. Send the client its UPI link.' };
      }
      if (action === 'deposit') {
        const part = depositPart(p.payload);
        check(body.status !== 'done' && body.status !== 'cancelled', 'BOOKING_CLOSED', 'This booking is finished. Make a new one.');
        check(body.orderId, 'BOOKING_QUOTE_REQUIRED', 'Quote the booking from an order with your price first.');
        const existing = body.depositInvoiceId ? world.invoice(body.depositInvoiceId) : null;
        check(!existing || existing.status === 'draft' || existing.status === 'void', 'BOOKING_DEPOSIT_EXISTS', 'The deposit invoice is issued already. See it in Money.');
        const view = host.ask('venture.invoice.prepare', { orderId: body.orderId, part }) as InvoiceViewLite;
        space().bookings.set(id, { ...body, depositInvoiceId: view.invoice.id }); emit();
        return { playbook: BOOKING_PLAYBOOK, kind: 'booking', id, result: { invoiceId: view.invoice.id }, line: 'Deposit invoice drafted from the quote. Check it, then issue it.' };
      }
      const outcome = bookingAct(id, body, action, p.payload, world, slots(), bookings());
      space().bookings.set(id, outcome.booking); emit();
      return { playbook: BOOKING_PLAYBOOK, kind: 'booking', id, result: structuredClone(outcome.result), line: outcome.line };
    }),
  };
  return {
    playbook: BOOKING_PLAYBOOK,
    kinds: { slot, booking },
    forgetPeople(people) {
      const clientIds = new Set(people.flatMap(person => person.clientId ? [person.clientId] : []));
      const handles = people.flatMap(person => [...person.names, ...person.emails, ...person.phones]).filter(handle => handle.length >= 3).map(handle => handle.toLowerCase());
      let changed = false;
      for (const [id, body] of space().bookings) {
        const text = JSON.stringify(body).toLowerCase();
        if (clientIds.has(body.clientId) || handles.some(handle => text.includes(handle))) { space().bookings.delete(id); changed = true; }
      }
      if (changed) emit();
    },
  };
}
