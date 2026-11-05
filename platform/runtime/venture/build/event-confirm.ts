// C7 task 10: each event the relay brought in (event-relay.ts) is confirmed at its source with the owner's own keys
// before anything runs. The relay is a public topic anyone who knows it could post to, so its ids are only a hint:
//   Razorpay: GET the payment by id with the owner's keys (billing.ts razorpayKeys); it must be captured on that account,
//             and it is matched to an invoice through the invoice's payment link (GET the link, money/razorpay.ts
//             linkAnswer), which names the client. Nothing is recorded as paid here: the link check stays the one place
//             that records payments, so a confirmed event only carries facts (client, invoice number, amount, the
//             payment's receipt key, and whether the link check already recorded it).
//   Cal.com:  GET the booking by uid with the owner's Cal.com API key (saved in protected storage like the Razorpay keys;
//             the saving is main-lane wiring). Its start time and title are kept; the attendee is matched to a client by
//             email in code, else "a new person" with no name kept. The title passes the untrusted screen: words aimed
//             at the AI hold the event for the owner and nothing runs.
// Only api.razorpay.com and api.cal.com are ever asked. Fixture-tested against the public API docs' shapes until the
// founder runs one with test-mode keys; the screens say so.
import { screenUntrusted } from '../policy/untrusted.ts';
import { linkAnswer } from '../money/razorpay.ts';
import type { PaymentHttp } from '../money/billing-types.ts';
import type { IsoTime } from '../contracts.ts';
import type { EventKind, EventSource } from './event-relay.ts';

export type ConfirmHttp = PaymentHttp;
/** An invoice as the match needs it: its number, its client and its payment link, if it has one. */
export type InvoiceLink = { invoiceId: string; number: string; clientId: string | null; clientName: string | null; payLink: { id: string; currency: string; recordedPaymentIds: readonly string[] } | null };
export type KnownClient = { id: string; name: string; email: string | null };
export type PaymentFacts = { clientId: string | null; client: string | null; invoiceId: string; invoice: string; amountMinor: string; currency: string; receiptKey: string; recorded: boolean };
export type BookingFacts = { start: IsoTime; eventType: string; clientId: string | null; client: string };
type Refused = { state: 'refused'; source: EventSource; kind: EventKind; ref: string; code: 'EVENT_NOT_CONFIRMED'; line: string; held: boolean };
export type ConfirmedEvent =
  | { state: 'confirmed'; source: 'razorpay'; kind: 'payment'; ref: string; facts: PaymentFacts }
  | { state: 'confirmed'; source: 'cal-com'; kind: 'booking' | 'booking-cancelled'; ref: string; facts: BookingFacts }
  | Refused;

const RAZORPAY = 'https://api.razorpay.com/v1';
const CALCOM = 'https://api.cal.com/v2/bookings';
const CAL_API_VERSION = '2024-08-13';
const PAY_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const BOOKING_UID = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_LINKS = 20;
const MAX_TITLE = 200;
export const NEW_PERSON = 'a new person';
const TIMEOUT_MS = 20_000;
/** The most of one answer the real call reads (review round 1, LOW-6). */
export const CONFIRM_ANSWER_BYTES = 1024 * 1024;
const tooBig = () => Object.assign(new Error('The service answered more than Chausar reads.'), { code: 'EVENT_ANSWER_TOO_BIG' });

export const CONFIRM_WORDS = Object.freeze({
  noRazorpay: 'Razorpay is not connected, so this payment could not be checked. Nothing ran.',
  noCalcom: 'Cal.com is not connected, so this booking could not be checked. Nothing ran.',
  unknownPayment: 'Razorpay does not know this payment on your account. Nothing ran.',
  notCaptured: 'Razorpay says this payment is not captured yet. Nothing ran.',
  noInvoice: 'No invoice of yours has this payment on its payment link. Nothing ran.',
  unreachable: 'Chausar could not reach the service to check this event. Nothing ran; it is checked again next time.',
  unknownBooking: 'Cal.com does not know this booking on your account. Nothing ran.',
  wrongState: 'Cal.com says this booking is in another state than the event said. Nothing ran.',
  odd: 'The event did not look like a payment or a booking. Nothing ran.',
  held: 'This booking had words aimed at the AI, so it is held for you to look at. Nothing ran.',
});

/** The real HTTPS call, with a time limit and no redirects. Only the two services' own addresses are asked. */
export const confirmFetch: ConfirmHttp = async request => {
  if (!request.url.startsWith(`${RAZORPAY}/`) && !request.url.startsWith(`${CALCOM}/`)) throw new Error('Only Razorpay and Cal.com are asked.');
  const answer = await fetch(request.url, { method: request.method, headers: request.headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const declared = answer.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > CONFIRM_ANSWER_BYTES)) { await answer.body?.cancel().catch(() => {}); throw tooBig(); }
  const reader = answer.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CONFIRM_ANSWER_BYTES) { await reader.cancel().catch(() => {}); throw tooBig(); }
      chunks.push(value);
    }
  }
  return { status: answer.status, body: Buffer.concat(chunks).toString('utf8') };
};

const refuse = (source: EventSource, kind: EventKind, ref: string, line: string, held = false): Refused => ({ state: 'refused', source, kind, ref, code: 'EVENT_NOT_CONFIRMED', line, held });
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function parsed(body: string): unknown { try { return JSON.parse(body); } catch { return null; } }
async function ask(http: ConfirmHttp, url: string, headers: Record<string, string>): Promise<{ status: number; body: string } | null> {
  try { return await http({ method: 'GET', url, headers }); } catch { return null; }
}

/** Confirms a Razorpay payment id: captured on the owner's account, and on the payment link of one of their invoices. */
export async function confirmRazorpayPayment(http: ConfirmHttp, keys: { keyId: string; keySecret: string } | null, ref: string, invoices: readonly InvoiceLink[]): Promise<ConfirmedEvent> {
  const no = (line: string) => refuse('razorpay', 'payment', ref, line);
  if (typeof ref !== 'string' || !PAY_ID.test(ref)) return no(CONFIRM_WORDS.odd);
  if (!keys) return no(CONFIRM_WORDS.noRazorpay);
  const headers = { authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`, 'utf8').toString('base64')}` };
  const answer = await ask(http, `${RAZORPAY}/payments/${ref}`, headers);
  if (!answer) return no(CONFIRM_WORDS.unreachable);
  if (answer.status === 400 || answer.status === 404) return no(CONFIRM_WORDS.unknownPayment);
  if (answer.status < 200 || answer.status > 299) return no(CONFIRM_WORDS.unreachable);
  const payment = parsed(answer.body);
  if (!plain(payment) || payment.id !== ref || payment.entity !== 'payment' || !Number.isSafeInteger(payment.amount) || (payment.amount as number) <= 0 || typeof payment.currency !== 'string' || !/^[A-Z]{3}$/.test(payment.currency)) return no(CONFIRM_WORDS.unknownPayment);
  if (payment.status !== 'captured') return no(CONFIRM_WORDS.notCaptured);
  for (const invoice of invoices.filter(item => item.payLink && item.payLink.currency === payment.currency).slice(0, MAX_LINKS)) {
    const linked = await ask(http, `${RAZORPAY}/payment_links/${invoice.payLink!.id}`, headers);
    if (!linked || linked.status < 200 || linked.status > 299) continue;
    let link: ReturnType<typeof linkAnswer>;
    try { link = linkAnswer(linked.body); } catch { continue; }
    if (link.id !== invoice.payLink!.id || !link.payments.some(item => item.id === ref && item.status === 'captured')) continue;
    return {
      state: 'confirmed', source: 'razorpay', kind: 'payment', ref,
      facts: { clientId: invoice.clientId, client: invoice.clientName, invoiceId: invoice.invoiceId, invoice: invoice.number, amountMinor: String(payment.amount), currency: payment.currency, receiptKey: ref, recorded: invoice.payLink!.recordedPaymentIds.includes(ref) },
    };
  }
  return no(CONFIRM_WORDS.noInvoice);
}

/** Confirms a Cal.com booking uid with the owner's API key; the attendee is matched to a client by email in code. */
export async function confirmCalBooking(http: ConfirmHttp, apiKey: string | null, ref: string, kind: 'booking' | 'booking-cancelled', clients: readonly KnownClient[]): Promise<ConfirmedEvent> {
  const no = (line: string, held = false) => refuse('cal-com', kind, ref, line, held);
  if (typeof ref !== 'string' || !BOOKING_UID.test(ref)) return no(CONFIRM_WORDS.odd);
  if (!apiKey) return no(CONFIRM_WORDS.noCalcom);
  const answer = await ask(http, `${CALCOM}/${ref}`, { authorization: `Bearer ${apiKey}`, 'cal-api-version': CAL_API_VERSION });
  if (!answer) return no(CONFIRM_WORDS.unreachable);
  if (answer.status === 400 || answer.status === 404) return no(CONFIRM_WORDS.unknownBooking);
  if (answer.status < 200 || answer.status > 299) return no(CONFIRM_WORDS.unreachable);
  const body = parsed(answer.body), data = plain(body) && plain(body.data) ? body.data : null;
  if (!data || data.uid !== ref || typeof data.start !== 'string' || !Number.isFinite(Date.parse(data.start)) || typeof data.title !== 'string' || !data.title.trim() || data.title.length > MAX_TITLE) return no(CONFIRM_WORDS.unknownBooking);
  const cancelled = data.status === 'cancelled' || data.status === 'rejected';
  if (cancelled !== (kind === 'booking-cancelled')) return no(CONFIRM_WORDS.wrongState);
  const screened = screenUntrusted({ source: 'tool-output', text: data.title }, { mode: 'enforce' });
  if (screened.text === null || screened.status === 'quarantined' || screened.findings.some(finding => ['injection', 'checker', 'hidden', 'error'].includes(finding.kind))) return no(CONFIRM_WORDS.held, true);
  const emails = (Array.isArray(data.attendees) ? data.attendees : []).map(item => plain(item) && typeof item.email === 'string' ? item.email.trim().toLowerCase() : '').filter(Boolean);
  const client = clients.find(item => item.email && emails.includes(item.email.trim().toLowerCase())) ?? null;
  return {
    state: 'confirmed', source: 'cal-com', kind, ref,
    facts: { start: new Date(Date.parse(data.start)).toISOString(), eventType: screened.text.replace(/\s+/g, ' ').trim(), clientId: client?.id ?? null, client: client?.name ?? NEW_PERSON },
  };
}

/** One event from the relay, confirmed at its own source. */
export async function confirmEvent(
  http: ConfirmHttp,
  credentials: { razorpay: { keyId: string; keySecret: string } | null; calcom: string | null },
  event: { source: EventSource; kind: EventKind; ref: string },
  known: { invoices: readonly InvoiceLink[]; clients: readonly KnownClient[] },
): Promise<ConfirmedEvent> {
  if (event.source === 'razorpay' && event.kind === 'payment') return confirmRazorpayPayment(http, credentials.razorpay, event.ref, known.invoices);
  if (event.source === 'cal-com' && (event.kind === 'booking' || event.kind === 'booking-cancelled')) return confirmCalBooking(http, credentials.calcom, event.ref, event.kind, known.clients);
  return refuse(event.source, event.kind, event.ref, CONFIRM_WORDS.odd);
}
