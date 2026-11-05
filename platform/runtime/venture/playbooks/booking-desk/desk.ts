// Chausar playbook: the booking desk on Work (wave 6, package 6E3), through venture.desk.list, .get and .act with kinds
// 'slot' and 'booking'. The pure transitions are core.ts (shared with the fake engine); this file reads and writes the
// records, drafts the deposit as an advance invoice with the existing invoice code (money/invoices.ts draftInvoiceIn,
// 6D1), issues it through the existing exact-approval issue (venture.invoice.issue), reads its How to pay UPI link (6D2)
// and hands an approved reminder to the owner through the action journal (owner.handoff). Chausar sends nothing and
// takes no money itself. Written for Chausar; nothing here is learned from an outside source.
import { formatMinor } from '../../../currency.ts';
import { formatMoney } from '../../../owner-format.ts';
import { check, type Context, type State } from '../../../contracts.ts';
import type { DeskHandlers, DeskKindTypes } from '../desk-types.ts';
import type { BookingRecord, BookingSlotRecord, VentureDeps, VentureRecord } from '../../contracts.ts';
import { listRecords, readVenture, requireAppChannel, ventureAction } from '../../records.ts';
import { journalled } from '../../journal/journal.ts';
import { draftInvoiceIn, invoiceView, issueInvoice } from '../../money/invoices.ts';
import { partAskOf } from '../../money/invoice-parts.ts';
import { ownerHandoff } from '../kit/owner-message.ts';
import { idOf } from '../lesson-desk/core.ts';
import {
  BOOKING_PLAYBOOK, bookingAct, bookingDigest, bookingHandedOff, bookingMessageOf, bookingRequest, bookingRow, bookingView, closeSlot, depositPart, exact,
  newBooking, newSlot, slotDigest, slotView, type BookingWorld, type Held,
} from './core.ts';
import type { BookingBody, BookingSlotBody } from './records.ts';

/** Two record kinds: the owner's open times, and the bookings that hold them. */
export type BookingDeskDeskTypes = { slot: DeskKindTypes; booking: DeskKindTypes };
const playbook = BOOKING_PLAYBOOK;
const CHANGED = 'Read the booking again before you change it.';

export function bookingWorld(state: State, venture: VentureRecord, deps: Pick<VentureDeps, 'storage' | 'host' | 'clock'>): BookingWorld {
  return {
    client(id) { const client = listRecords(state, 'venture-client', venture.id).find(row => row.id === id && !row.self); return client ? { id: client.id, name: client.name, email: client.email } : null; },
    order(id) { const order = listRecords(state, 'venture-order', venture.id).find(row => row.id === id); return order ? { id: order.id, clientId: order.clientId, status: order.status } : null; },
    quote(orderId) {
      const order = listRecords(state, 'venture-order', venture.id).find(row => row.id === orderId);
      const receipt = order && listRecords(state, 'venture-price-receipt', venture.id).find(row => row.id === order.priceReceiptId);
      return receipt ? { receiptId: receipt.id, total: formatMoney(receipt.totalMinor, receipt.currency) } : null;
    },
    invoice(id) {
      const invoice = listRecords(state, 'venture-invoice', venture.id).find(row => row.id === id);
      if (!invoice) return null;
      const upi = invoiceView(state, venture, invoice, deps).howToPay?.upi ?? null;
      return {
        invoiceId: invoice.id, number: invoice.number, status: invoice.status, total: formatMoney(invoice.totalMinor, invoice.currency),
        // B2: the balance stays exact, as the deposit message to the client quotes it.
        balance: formatMinor(invoice.balanceMinor, invoice.currency), receiptId: invoice.priceReceiptId, digest: invoice.digest,
        upi: upi ? { link: upi.link, amount: upi.amount } : null,
      };
    },
  };
}

const slotsOf = (rows: readonly BookingSlotRecord[]): Held<BookingSlotBody>[] => rows.map(row => ({ id: row.id, body: row.slot })).sort((a, b) => a.body.start.localeCompare(b.body.start) || a.id.localeCompare(b.id));
const bookingsOf = (rows: readonly BookingRecord[]): Held<BookingBody>[] => rows.map(row => ({ id: row.id, body: row.booking }));

function found<T extends { id: string }>(rows: readonly T[], id: string, code: string, words: string): T {
  const row = rows.find(item => item.id === id);
  check(row, code, words);
  return row;
}

async function handoff(deps: VentureDeps, ctx: Context, id: string, p: Record<string, unknown>) {
  const { state, venture } = readVenture(deps, ctx);
  const record = found(listRecords(state, 'venture-booking', venture.id), id, 'BOOKING_NOT_FOUND', 'That booking was not found.');
  check(p.digest === bookingDigest(record.booking), 'APPROVAL_CHANGED', CHANGED);
  const message = bookingMessageOf(record.booking, p.payload);
  const link = ownerHandoff(message);
  if (message.handedOffAt) return { playbook, kind: 'booking', id, result: { messageId: message.id, handoff: link, replayed: true }, line: link.line };
  const flat = message.text.replace(/\s+/g, ' ').trim(), shown = flat.length <= 220;
  await journalled(deps, ctx, {
    action: 'owner.handoff', operation: 'booking-reminder', subject: `booking:${id}:${message.id}`, target: message.channel === 'email' ? 'Your mail app' : 'WhatsApp',
    actionDigest: message.digest, descriptionComplete: shown,
    line: `Hand this exact reminder to you to send yourself: ${shown ? flat : `${flat.slice(0, 220)}...`}`,
  }, async handle => {
    await ventureAction(deps, ctx, 'approve', 'booking.handoff', tx => {
      const current = found(tx.list('venture-booking'), id, 'BOOKING_NOT_FOUND', 'That booking was not found.');
      check(bookingDigest(current.booking) === p.digest, 'APPROVAL_CHANGED', CHANGED);
      tx.replace<BookingRecord>({ ...current, booking: bookingHandedOff(current.booking, message.id, tx.now, handle.entry.id) });
      handle.settleIn(tx, link.line);
      tx.emit('desk.changed', { playbook });
    });
    return { outcome: 'applied' as const, line: link.line, value: link };
  });
  return { playbook, kind: 'booking', id, result: { messageId: message.id, handoff: link }, line: link.line };
}

/** Issues the deposit through the existing exact-approval invoice issue, bound to the invoice digest the owner saw. */
async function issueDeposit(deps: VentureDeps, ctx: Context, id: string, p: Record<string, unknown>) {
  const { state, venture } = readVenture(deps, ctx);
  const record = found(listRecords(state, 'venture-booking', venture.id), id, 'BOOKING_NOT_FOUND', 'That booking was not found.');
  check(p.digest === bookingDigest(record.booking), 'APPROVAL_CHANGED', CHANGED);
  const b = exact(p.payload, ['invoiceDigest']);
  check(record.booking.depositInvoiceId, 'BOOKING_DEPOSIT_REQUIRED', 'Draft the deposit invoice first.');
  const issued = await issueInvoice(deps, ctx, { invoiceId: record.booking.depositInvoiceId, digest: b.invoiceDigest });
  return { playbook, kind: 'booking', id, result: { invoiceId: issued.invoice.id, number: issued.invoice.number }, line: 'Deposit invoice issued. Send the client its UPI link.' };
}

export const BOOKING_DESK_DESK: DeskHandlers = {
  slot: {
    async list(deps, ctx, raw) {
      bookingRequest(raw, 'list');
      const { state, venture } = readVenture(deps, ctx);
      const bookings = bookingsOf(listRecords(state, 'venture-booking', venture.id));
      return { playbook, kind: 'slot', rows: slotsOf(listRecords(state, 'venture-booking-slot', venture.id)).map(item => slotView(item.id, item.body, bookings)), line: 'Your open times. A booking holds one.' } as never;
    },
    async get(deps, ctx, raw) {
      const p = bookingRequest(raw, 'get');
      const { state, venture } = readVenture(deps, ctx);
      const record = found(listRecords(state, 'venture-booking-slot', venture.id), idOf(p.id, 'Slot'), 'BOOKING_SLOT_NOT_FOUND', 'Choose one of your slots.');
      const bookings = bookingsOf(listRecords(state, 'venture-booking', venture.id));
      return { playbook, kind: 'slot', item: slotView(record.id, record.slot, bookings), digest: slotDigest(record.id, record.slot, bookings) } as never;
    },
    async act(deps, ctx, raw) {
      requireAppChannel(ctx, 'venture.desk.act');
      const p = bookingRequest(raw, 'act');
      return ventureAction(deps, ctx, 'approve', 'booking.desk', tx => {
        const bookings = bookingsOf(tx.list('venture-booking'));
        if (p.action === 'add') {
          check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Add a slot with the id new.');
          const slot = newSlot(p.payload, slotsOf(tx.list('venture-booking-slot')));
          const record = tx.put<BookingSlotRecord>({ ...tx.base('venture-booking-slot'), slot });
          tx.emit('desk.changed', { playbook });
          return { playbook, kind: 'slot', id: record.id, result: { slotId: record.id }, line: 'Slot added.' };
        }
        check(p.action === 'close', 'INVALID_VENTURE_REQUEST', 'Choose a slot action.');
        exact(p.payload, []);
        const record = found(tx.list('venture-booking-slot'), idOf(p.id, 'Slot'), 'BOOKING_SLOT_NOT_FOUND', 'Choose one of your slots.');
        check(p.digest === slotDigest(record.id, record.slot, bookings), 'APPROVAL_CHANGED', 'Read the slot again before you change it.');
        tx.replace<BookingSlotRecord>({ ...record, slot: closeSlot(record.id, record.slot, bookings) });
        tx.emit('desk.changed', { playbook });
        return { playbook, kind: 'slot', id: record.id, result: {}, line: 'Slot closed.' };
      }) as never;
    },
  },
  booking: {
    async list(deps, ctx, raw) {
      bookingRequest(raw, 'list');
      const { state, venture } = readVenture(deps, ctx);
      const world = bookingWorld(state, venture, deps), slots = slotsOf(listRecords(state, 'venture-booking-slot', venture.id));
      return { playbook, kind: 'booking', rows: listRecords(state, 'venture-booking', venture.id).map(row => bookingRow(row.id, row.booking, world, slots)), line: 'Your bookings, newest last.' } as never;
    },
    async get(deps, ctx, raw) {
      const p = bookingRequest(raw, 'get');
      const { state, venture } = readVenture(deps, ctx);
      const record = found(listRecords(state, 'venture-booking', venture.id), idOf(p.id, 'Booking'), 'BOOKING_NOT_FOUND', 'That booking was not found.');
      return { playbook, kind: 'booking', item: bookingView(record.id, record.booking, bookingWorld(state, venture, deps), slotsOf(listRecords(state, 'venture-booking-slot', venture.id))), digest: bookingDigest(record.booking) } as never;
    },
    async act(deps, ctx, raw) {
      requireAppChannel(ctx, 'venture.desk.act');
      const p = bookingRequest(raw, 'act');
      const action = typeof p.action === 'string' ? p.action : '';
      if (action === 'intake') {
        check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Take a new enquiry with the id new.');
        return ventureAction(deps, ctx, 'approve', 'booking.desk', tx => {
          const booking = newBooking(p.payload, bookingWorld(tx.state, tx.venture!, deps));
          const record = tx.put<BookingRecord>({ ...tx.base('venture-booking'), booking });
          tx.emit('desk.changed', { playbook });
          return { playbook, kind: 'booking', id: record.id, result: { bookingId: record.id }, line: 'Enquiry saved. Quote it from an order with your price.' };
        }) as never;
      }
      const id = idOf(p.id, 'Booking');
      if (action === 'handoff') return handoff(deps, ctx, id, p) as never;
      if (action === 'issue-deposit') return issueDeposit(deps, ctx, id, p) as never;
      return ventureAction(deps, ctx, 'approve', 'booking.desk', tx => {
        const record = found(tx.list('venture-booking'), id, 'BOOKING_NOT_FOUND', 'That booking was not found.');
        check(p.digest === bookingDigest(record.booking), 'APPROVAL_CHANGED', CHANGED);
        const world = bookingWorld(tx.state, tx.venture!, deps);
        if (action === 'deposit') {
          const part = depositPart(p.payload);
          check(record.booking.status !== 'done' && record.booking.status !== 'cancelled', 'BOOKING_CLOSED', 'This booking is finished. Make a new one.');
          check(record.booking.orderId, 'BOOKING_QUOTE_REQUIRED', 'Quote the booking from an order with your price first.');
          const existing = record.booking.depositInvoiceId ? world.invoice(record.booking.depositInvoiceId) : null;
          check(!existing || existing.status === 'draft' || existing.status === 'void', 'BOOKING_DEPOSIT_EXISTS', 'The deposit invoice is issued already. See it in Money.');
          const order = tx.find('venture-order', record.booking.orderId)!;
          const currency = tx.find('venture-price-receipt', order.priceReceiptId)?.currency ?? 'INR';
          const invoice = draftInvoiceIn(tx, { orderId: order.id, dueInDays: null, issueDate: null, part: partAskOf(part, currency), reminderDays: null });
          tx.replace<BookingRecord>({ ...record, booking: { ...record.booking, depositInvoiceId: invoice.id } });
          tx.emit('desk.changed', { playbook });
          return { playbook, kind: 'booking', id, result: { invoiceId: invoice.id }, line: 'Deposit invoice drafted from the quote. Check it, then issue it.' };
        }
        const outcome = bookingAct(id, record.booking, action, p.payload, world, slotsOf(tx.list('venture-booking-slot')), bookingsOf(tx.list('venture-booking')));
        tx.replace<BookingRecord>({ ...record, booking: outcome.booking });
        tx.emit('desk.changed', { playbook });
        return { playbook, kind: 'booking', id, result: outcome.result, line: outcome.line };
      }) as never;
    },
  },
};
