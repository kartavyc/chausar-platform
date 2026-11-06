// Chausar playbook: Booking desk core (wave 6, package 6E3). Pure transitions over slots and bookings, shared by the
// engine's desk (desk.ts) and the fake engine, so both answer with the same codes, words and digests. A quote is the
// linked order's own price receipt and a deposit is an advance invoice on that order (6D1), paid through its How to pay
// UPI link (6D2): the amounts in a reminder come from that invoice, formatted by code, never from a model. Reminders are
// fixed templates the owner approves word for word and sends from their own app. Portable: no Node built-ins.
// Written for Chausar; nothing here is learned from an outside source.
import { check, ChausarError, digest } from '../../../portable.ts';
import { validDate } from '../../../date-core.ts';
import { formatClock } from '../../../owner-format.ts';
import { formatMinor } from '../../../currency.ts';
import { messageDigest, ownerPhone, OWNER_CHANNELS } from '../kit/owner-message.ts';
import type { OwnerChannel } from '../kit/owner-message.ts';
import { exact, idOf, line, words } from '../lesson-desk/core.ts';
import type { BookingBody, BookingMessage, BookingSlotBody, BookingStatus } from '../../../../contract/venture/playbooks/booking-desk/records.ts';

export { exact } from '../lesson-desk/core.ts';
export const BOOKING_PLAYBOOK = 'booking-desk' as const;
const INVALID = 'INVALID_VENTURE_REQUEST';
const ACTIVE: readonly BookingStatus[] = ['held', 'confirmed', 'done'];
const MAX_MESSAGES = 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type SlotState = 'open' | 'held' | 'booked' | 'closed';
export type BookingInvoice = { invoiceId: string; number: string | null; status: string; total: string; balance: string; balanceMinor: string; currency: string; receiptId: string; digest: string; upi: { link: string; amount: string } | null };

/** What the desk reads beyond its own records: clients, orders, the quote receipt and the deposit invoice. */
export type BookingWorld = {
  client(id: string): { id: string; name: string; email: string | null } | null;
  order(id: string): { id: string; clientId: string; status: string } | null;
  quote(orderId: string): { receiptId: string; total: string } | null;
  invoice(id: string): BookingInvoice | null;
};
export type Held<T> = { id: string; body: T };

export const BOOKING_LINE = 'Quotes and deposits come from your prices and invoices. Reminders go out only when you send them yourself.';

export function bookingRequest(raw: unknown, op: 'list' | 'get' | 'act'): Record<string, unknown> {
  const allowed = op === 'list' ? ['playbook', 'kind', 'filter'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload', 'digest'];
  const required = op === 'list' ? ['playbook', 'kind'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload'];
  const p = exact(raw, allowed, required);
  check(p.playbook === BOOKING_PLAYBOOK && (p.kind === 'slot' || p.kind === 'booking'), INVALID, 'Choose a booking or a slot.');
  if (op === 'list') check(p.filter === undefined, INVALID, 'The list takes no filter.');
  return p;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

function startOf(value: unknown): string {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value) && validDate(value.slice(0, 10)), INVALID, 'Give the start like 2026-11-05T10:00.');
  return value;
}
/** Minutes from a fixed start, read from the owner's own clock words (no time zone is applied or guessed). */
const minuteOf = (start: string) => Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)), Number(start.slice(11, 13)), Number(start.slice(14, 16))) / 60_000;

export function slotState(slotId: string, slot: BookingSlotBody, bookings: readonly Held<BookingBody>[]): SlotState {
  if (slot.closed) return 'closed';
  const holder = bookings.find(item => item.body.slotId === slotId && ACTIVE.includes(item.body.status));
  return !holder ? 'open' : holder.body.status === 'held' ? 'held' : 'booked';
}

export function newSlot(payload: unknown, slots: readonly Held<BookingSlotBody>[]): BookingSlotBody {
  const b = exact(payload, ['start', 'minutes', 'note'], ['start', 'minutes']);
  const start = startOf(b.start);
  check(Number.isInteger(b.minutes) && (b.minutes as number) >= 15 && (b.minutes as number) <= 720, INVALID, 'A slot lasts 15 to 720 minutes.');
  const from = minuteOf(start), to = from + (b.minutes as number);
  const clash = slots.find(item => !item.body.closed && minuteOf(item.body.start) < to && from < minuteOf(item.body.start) + item.body.minutes);
  check(!clash, 'BOOKING_SLOT_CLASH', 'This time overlaps another open slot. Choose another time.');
  return { start, minutes: b.minutes as number, note: b.note === undefined || b.note === '' ? '' : line(b.note, 'Note', 120), closed: false };
}

export function closeSlot(slotId: string, slot: BookingSlotBody, bookings: readonly Held<BookingBody>[]): BookingSlotBody {
  check(slotState(slotId, slot, bookings) !== 'held' && slotState(slotId, slot, bookings) !== 'booked', 'BOOKING_SLOT_TAKEN', 'A booking holds this slot. Release or cancel it first.');
  return { ...slot, closed: true };
}

export const slotDigest = (slotId: string, slot: BookingSlotBody, bookings: readonly Held<BookingBody>[]) => digest({ slot, state: slotState(slotId, slot, bookings) });
export const slotView = (slotId: string, slot: BookingSlotBody, bookings: readonly Held<BookingBody>[]) => ({ id: slotId, start: slot.start, words: startWords(slot.start), minutes: slot.minutes, note: slot.note, state: slotState(slotId, slot, bookings) });

/** A start as reminders write it: "5 Nov 2026 at 10:00 am" (a wall time where the business is, on the 12-hour clock, B2). */
export function startWords(start: string): string {
  return `${Number(start.slice(8, 10))} ${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)} at ${formatClock(start.slice(11, 16))}`;
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export function newBooking(payload: unknown, world: BookingWorld): BookingBody {
  const b = exact(payload, ['clientId', 'request', 'address', 'phone'], ['clientId', 'request']);
  const clientId = idOf(b.clientId, 'Client');
  check(world.client(clientId), 'CLIENT_NOT_FOUND', 'Add this client first.');
  return {
    clientId, request: words(b.request, 'What the client asked for', 2000, 3), address: b.address === undefined || b.address === '' ? '' : line(b.address, 'Address', 200),
    phone: ownerPhone(b.phone), orderId: null, slotId: null, depositInvoiceId: null, status: 'enquiry', messages: [], seq: 0,
  };
}

export const bookingDigest = (booking: BookingBody) => digest(booking);

export type BookingActOutcome = { booking: BookingBody; result: unknown; line: string };

function open(booking: BookingBody): void {
  check(booking.status !== 'done' && booking.status !== 'cancelled', 'BOOKING_CLOSED', 'This booking is finished. Make a new one.');
}

/** Everything but intake, deposit, issue-deposit and handoff, which need the engine's invoices and journal. */
export function bookingAct(id: string, booking: BookingBody, action: string, payload: unknown, world: BookingWorld, slots: readonly Held<BookingSlotBody>[], bookings: readonly Held<BookingBody>[]): BookingActOutcome {
  if (action === 'quote') {
    const b = exact(payload, ['orderId']);
    open(booking);
    const orderId = idOf(b.orderId, 'Order');
    const order = world.order(orderId);
    check(order && order.status !== 'cancelled' && order.clientId === booking.clientId, 'BOOKING_ORDER_MISMATCH', "Choose an open order of this booking's client.");
    check(!bookings.some(item => item.id !== id && item.body.orderId === orderId && item.body.status !== 'cancelled'), 'BOOKING_ORDER_TAKEN', 'Another booking uses this order. Make a new order for this one.');
    check(booking.depositInvoiceId === null || booking.orderId === orderId, 'BOOKING_DEPOSIT_EXISTS', 'A deposit invoice is on the first order. Cancel this booking and start again to change the order.');
    check(world.quote(orderId), 'RECEIPT_NOT_FOUND', 'The price receipt of this order was not found.');
    return { booking: { ...booking, orderId, status: booking.status === 'enquiry' ? 'quoted' : booking.status }, result: { orderId }, line: "Quoted from the order's own price." };
  }
  if (action === 'hold') {
    const b = exact(payload, ['slotId']);
    check(booking.status === 'enquiry' || booking.status === 'quoted' || booking.status === 'held', 'BOOKING_CLOSED', 'Only a booking that is not confirmed yet can hold a slot.');
    const slot = slots.find(item => item.id === b.slotId);
    check(slot, 'BOOKING_SLOT_NOT_FOUND', 'Choose one of your slots.');
    const others = bookings.filter(item => item.id !== id);
    check(slotState(slot.id, slot.body, others) === 'open', 'BOOKING_SLOT_TAKEN', 'This slot is taken or closed. Choose another.');
    return { booking: { ...booking, slotId: slot.id, status: 'held' }, result: { slotId: slot.id }, line: `Slot held for ${startWords(slot.body.start)}.` };
  }
  if (action === 'release') {
    exact(payload, []);
    check(booking.status === 'held', 'BOOKING_NOT_HELD', 'This booking holds no slot.');
    return { booking: { ...booking, slotId: null, status: booking.orderId ? 'quoted' : 'enquiry' }, result: {}, line: 'Slot released.' };
  }
  if (action === 'confirm') {
    exact(payload, []);
    check(booking.status === 'held', 'BOOKING_NOT_HELD', 'Hold a slot before you confirm the booking.');
    return { booking: { ...booking, status: 'confirmed' }, result: {}, line: 'Booking confirmed. Send the client a reminder when you are ready.' };
  }
  if (action === 'done') {
    exact(payload, []);
    check(booking.status === 'confirmed', 'BOOKING_NOT_CONFIRMED', 'Confirm the booking before you mark it done.');
    return { booking: { ...booking, status: 'done' }, result: {}, line: 'Marked done.' };
  }
  if (action === 'cancel') {
    exact(payload, []);
    open(booking);
    return { booking: { ...booking, status: 'cancelled' }, result: {}, line: 'Booking cancelled. Its slot is open again; its invoices stay in Money.' };
  }
  if (action === 'remind') {
    const b = exact(payload, ['kind', 'channel', 'phone'], ['kind', 'channel']);
    open(booking);
    check(b.kind === 'appointment' || b.kind === 'deposit', INVALID, 'Choose an appointment or a deposit reminder.');
    check(typeof b.channel === 'string' && (OWNER_CHANNELS as readonly string[]).includes(b.channel), INVALID, 'Choose email or WhatsApp.');
    const channel = b.channel as OwnerChannel;
    const client = world.client(booking.clientId);
    check(client, 'CLIENT_NOT_FOUND', "This booking's client is no longer a client.");
    const to = channel === 'email' ? client.email : ownerPhone(b.phone) ?? booking.phone;
    let text: string;
    if (b.kind === 'appointment') {
      const slot = slots.find(item => item.id === booking.slotId);
      check(slot && (booking.status === 'held' || booking.status === 'confirmed'), 'BOOKING_SLOT_REQUIRED', 'Hold a slot before you remind the client of it.');
      text = [`Hello ${client.name},`, '', `This is a reminder of your booking on ${startWords(slot.body.start)} for ${booking.request.split('\n')[0]}.`, ...(booking.address ? [`Address: ${booking.address}`] : []), '', 'Reply here if you need to change it.'].join('\n');
    } else {
      const invoice = booking.depositInvoiceId ? world.invoice(booking.depositInvoiceId) : null;
      // Issued or part paid: money is still due on it (paid leaves nothing, a draft or a cancelled one asks nothing).
      check(invoice && invoice.number && (invoice.status === 'issued' || invoice.status === 'part-paid'), 'BOOKING_DEPOSIT_NOT_ISSUED', 'Issue the deposit invoice before you remind the client to pay it.');
      text = [`Hello ${client.name},`, '', `To confirm your booking, please pay the deposit of ${formatMinor(invoice.balanceMinor, invoice.currency)} for invoice ${invoice.number}.`, ...(invoice.upi ? [`Pay by UPI: ${invoice.upi.link}`] : ['The bank details are on the invoice.']), '', 'If you have already paid, thank you.'].join('\n');
    }
    check(booking.messages.length < MAX_MESSAGES, INVALID, 'This booking holds as many reminders as it can.');
    const seq = booking.seq + 1;
    const subject = channel === 'email' ? (b.kind === 'appointment' ? 'Your booking' : 'Deposit for your booking') : null;
    const draft = { kind: b.kind, channel, to, subject, text } as const;
    const message: BookingMessage = { id: `m${seq}`, ...draft, digest: messageDigest(draft), handedOffAt: null, journalId: null };
    return { booking: { ...booking, seq, messages: [...booking.messages, message] }, result: { messageId: message.id }, line: 'Saved for you to check. Nothing was sent.' };
  }
  throw new ChausarError(INVALID, 'Choose a booking desk action.');
}

export function bookingMessageOf(booking: BookingBody, payload: unknown): BookingMessage {
  const b = exact(payload, ['messageId']);
  const message = booking.messages.find(item => item.id === b.messageId);
  check(message, 'BOOKING_MESSAGE_NOT_FOUND', 'Choose a reminder on this booking.');
  check(message.digest === messageDigest(message), 'APPROVAL_CHANGED', 'This reminder changed. Read it again before you send it.');
  return message;
}

export function bookingHandedOff(booking: BookingBody, messageId: string, at: string, journalId: string): BookingBody {
  return { ...booking, messages: booking.messages.map(item => item.id === messageId ? { ...item, handedOffAt: at, journalId } : item) };
}

/** The deposit asked as an invoice part: an advance of the order, a share the owner typed. */
export function depositPart(payload: unknown): { kind: 'advance'; label: string; percent: string } {
  const b = exact(payload, ['percent']);
  check(typeof b.percent === 'string', INVALID, 'A deposit is a percent of the quote above 0 and below 100, like 25.');
  return { kind: 'advance', label: 'Deposit', percent: b.percent };
}

export function bookingRow(id: string, booking: BookingBody, world: BookingWorld, slots: readonly Held<BookingSlotBody>[]) {
  const slot = slots.find(item => item.id === booking.slotId);
  return { id, client: world.client(booking.clientId)?.name ?? null, request: booking.request.split('\n')[0]!.slice(0, 120), status: booking.status, start: slot && booking.status !== 'cancelled' ? slot.body.start : null };
}

export function bookingView(id: string, booking: BookingBody, world: BookingWorld, slots: readonly Held<BookingSlotBody>[]) {
  const slot = slots.find(item => item.id === booking.slotId);
  return {
    id, clientId: booking.clientId, client: world.client(booking.clientId)?.name ?? null, request: booking.request, address: booking.address, phone: booking.phone,
    status: booking.status, orderId: booking.orderId, slot: slot ? { id: slot.id, start: slot.body.start, minutes: slot.body.minutes, words: startWords(slot.body.start) } : null,
    quote: booking.orderId ? world.quote(booking.orderId) : null,
    deposit: booking.depositInvoiceId ? world.invoice(booking.depositInvoiceId) : null,
    messages: booking.messages, line: BOOKING_LINE,
  };
}
