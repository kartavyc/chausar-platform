// C7 task 9 (the module half): the event relay, reading what came in. A payment or a booking reaches Chausar through an
// ntfy-style topic of the owner's own (the same kind of address as the phone alert relay, notify/relay.ts), since the
// desktop has no address of its own and there is no Chausar server. Chausar reads it only while open: one GET of the
// topic's poll form through the network guard, redirects refused, at most 256 KB. From each message only ids are kept:
// a Razorpay payment.captured keeps the payment id, a Cal.com booking created or cancelled keeps the booking uid.
// Everything else (payer emails and phones, attendee names, titles) is dropped before anything is stored, and every
// event is confirmed at its source with the owner's own keys before anything runs (event-confirm.ts). The address is
// never in a record, an event or a refusal: only its host is. The method (venture.events.relay.set), the record kind in
// contracts.ts and the fake wait for the main lane.
import { ChausarError, check } from '../../contracts.ts';
import { guardedFetch, type NetResolver, type PinnedSender } from '../core/net-guard.ts';
import { relayAddress } from '../notify/relay.ts';
import type { IsoTime } from '../contracts.ts';

export type EventSource = 'razorpay' | 'cal-com';
export type EventKind = 'payment' | 'booking' | 'booking-cancelled';
/** One event as read from the relay: ids only. relayId is the relay's own message id, for reading on from there. */
export type RelayEvent = { source: EventSource; kind: EventKind; ref: string; receivedAt: IsoTime; relayId: string };
export type EventState = 'new' | 'confirmed' | 'refused' | 'drafted' | 'missed';
/** The fields of the venture-event record (moved into contracts.ts when the main lane wires the method). */
export type VentureEventFields = { source: EventSource; kind: EventKind; ref: string; receivedAt: IsoTime; state: EventState; line: string };
export type RelayNet = { resolve?: NetResolver; send?: PinnedSender };
export type RelayPage = { host: string; events: RelayEvent[]; lastId: string | null; skipped: { notJson: number; tooBig: number; other: number; repeated: number } };

export const RELAY_PAGE_BYTES = 256 * 1024;
const MESSAGE_BYTES = 64 * 1024;
const RELAY_TIMEOUT_MS = 15_000;
const PAY_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const BOOKING_UID = /^[A-Za-z0-9_-]{6,64}$/;
const CAL_EVENTS: Readonly<Record<string, EventKind>> = Object.freeze({ BOOKING_CREATED: 'booking', BOOKING_CANCELLED: 'booking-cancelled' });

export const EVENT_RELAY_WORDS = Object.freeze({
  address: 'Give the relay as one https address of your own, like an ntfy topic, outside this computer and its network.',
  read: 'Chausar could not read your relay just now. Nothing was taken from it; it tries again next time.',
  big: 'Your relay sent more than Chausar reads at once. Nothing was taken from it.',
  hosted: 'Events come in through a relay on the desktop app only.',
  lines: Object.freeze({ payment: 'A payment came in through your relay.', booking: 'A booking came in through your relay.', 'booking-cancelled': 'A booking was cancelled, through your relay.' }),
});

const refused = (words: string) => new ChausarError('EVENT_RELAY_REFUSED', words);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The relay works on the desktop app only. */
export function assertRelayHost(host: string): void {
  check(host !== 'hosted-web', 'TIER_UNAVAILABLE', EVENT_RELAY_WORDS.hosted);
}

/** The owner's address, checked (https, no name or password, never inside this network), or EVENT_RELAY_REFUSED. */
function checkedAddress(address: string): URL {
  try { return new URL(relayAddress(address)); } catch { throw refused(EVENT_RELAY_WORDS.address); }
}

/** The topic's poll form: <address>/json?poll=1&since=<unix seconds or all>. */
export function relayPollUrl(address: string, since: IsoTime | null): string {
  const url = checkedAddress(address), at = since === null ? NaN : Date.parse(since);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/json`;
  url.search = `poll=1&since=${Number.isFinite(at) ? Math.floor(at / 1000) : 'all'}`;
  return url.href;
}

/** The one key an event is kept under, so the same payment or booking is kept once. */
export function eventKey(event: Pick<RelayEvent, 'source' | 'kind' | 'ref'>): string {
  return `${event.source}:${event.kind}:${event.ref}`;
}

/** The ids of one message body, or why it was skipped. */
function idsOf(body: string): Pick<RelayEvent, 'source' | 'kind' | 'ref'> | 'notJson' | 'tooBig' | 'other' {
  if (body.length > MESSAGE_BYTES) return 'tooBig';
  let value: unknown;
  try { value = JSON.parse(body); } catch { return 'notJson'; }
  if (!plain(value)) return 'other';
  if (value.event === 'payment.captured') {
    const id = plain(value.payload) && plain(value.payload.payment) && plain(value.payload.payment.entity) ? value.payload.payment.entity.id : undefined;
    return typeof id === 'string' && PAY_ID.test(id) ? { source: 'razorpay', kind: 'payment', ref: id } : 'other';
  }
  if (typeof value.triggerEvent === 'string' && CAL_EVENTS[value.triggerEvent]) {
    const uid = plain(value.payload) ? value.payload.uid : undefined;
    return typeof uid === 'string' && BOOKING_UID.test(uid) ? { source: 'cal-com', kind: CAL_EVENTS[value.triggerEvent], ref: uid } : 'other';
  }
  return 'other';
}

/**
 * Reads the relay once. net is the network guard's resolver and sender (stand-ins in tests). seen holds the keys of
 * events already kept, so a message the relay sends again is counted as repeated, not kept twice.
 */
export async function readRelay(net: RelayNet, address: string, options: { since: IsoTime | null; seen?: ReadonlySet<string> }): Promise<RelayPage> {
  const url = relayPollUrl(address, options.since), host = new URL(url).host;
  let answer;
  try {
    answer = await guardedFetch({ url, method: 'GET', headers: { accept: 'application/x-ndjson' }, maxBytes: RELAY_PAGE_BYTES, maxRedirects: 0, timeoutMs: RELAY_TIMEOUT_MS }, { resolve: net.resolve, send: net.send });
  } catch (error: any) {
    throw refused(typeof error?.code === 'string' && /^NET_(?:URL|ADDRESS)/.test(error.code) ? EVENT_RELAY_WORDS.address : EVENT_RELAY_WORDS.read);
  }
  if (answer.status !== 200) throw refused(EVENT_RELAY_WORDS.read);
  if (answer.body.length > RELAY_PAGE_BYTES) throw refused(EVENT_RELAY_WORDS.big);
  const page: RelayPage = { host, events: [], lastId: null, skipped: { notJson: 0, tooBig: 0, other: 0, repeated: 0 } };
  const kept = new Set(options.seen ?? []);
  for (const line of answer.body.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let item: unknown;
    try { item = JSON.parse(line); } catch { page.skipped.notJson++; continue; }
    if (!plain(item) || item.event !== 'message') continue;
    if (typeof item.id === 'string' && item.id.length <= 64) page.lastId = item.id;
    if (typeof item.message !== 'string') { page.skipped.other++; continue; }
    const ids = idsOf(item.message);
    if (typeof ids === 'string') { page.skipped[ids]++; continue; }
    const key = eventKey(ids);
    if (kept.has(key)) { page.skipped.repeated++; continue; }
    kept.add(key);
    const time = typeof item.time === 'number' && Number.isFinite(item.time) && item.time > 0 ? new Date(item.time * 1000) : null;
    page.events.push({ ...ids, receivedAt: time && Number.isFinite(time.getTime()) ? time.toISOString() : new Date().toISOString(), relayId: typeof item.id === 'string' ? item.id.slice(0, 64) : '' });
  }
  return page;
}

/** The fields of the record an event is kept as, new and unconfirmed. No address, no host, no payer. */
export function eventRecordOf(event: RelayEvent): VentureEventFields {
  return { source: event.source, kind: event.kind, ref: event.ref, receivedAt: event.receivedAt, state: 'new', line: EVENT_RELAY_WORDS.lines[event.kind] };
}
