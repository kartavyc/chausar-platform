// C7 tasks 9 to 11: event triggers, a routine that starts on an event and only drafts. The relay address and the Cal.com
// key are held in protected storage, never in a record, an event or the journal; the business keeps only the relay's host.
// Each sweep (only while Chausar is open) reads the owner's relay, keeps ids only, confirms each event at its source with
// the owner's own keys, and makes one run per matching trigger, at most 10 per trigger per sweep; each run asks the agent
// with the blanks filled by code from the confirmed facts, and its answer can only be words, a draft or a proposal for
// Today. Events older than 24 hours when read are counted as missed. Setting a trigger up is the owner's approval of
// exactly which facts each event sends. Fixture-tested until the founder runs one with his own relay and test-mode keys.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type { IsoTime, RecordBase, RoutineRecord, RoutineSchedule, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { pinnedSend, systemResolver } from '../core/net-guard.ts';
import { formatMoment, formatMoney, ownerZone } from '../../owner-format.ts';
import { razorpayKeys } from '../money/billing.ts';
import { assertRelayHost, eventKey, eventRecordOf, readRelay, relayPollUrl, type EventKind, type EventSource, type EventState, type RelayEvent, type RelayNet } from './event-relay.ts';
import { confirmEvent, confirmFetch, CONFIRM_WORDS, NEW_PERSON, type BookingFacts, type ConfirmHttp, type InvoiceLink, type KnownClient, type PaymentFacts } from './event-confirm.ts';
import { relayAddress } from '../notify/relay.ts';

export const RELAY_CREDENTIAL = 'events:relay';
export const CALCOM_CREDENTIAL = 'events:calcom';
/** How long an event found when the app opens may still be drafted. */
export const EVENT_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_RUNS_PER_TRIGGER = 10;
const MAX_NEW_EVENTS = 200;

export type EventFacts = { clientId: string | null; client: string; invoice?: string; amount?: string; when: string; event: string };
export type RelayEventRecord = RecordBase<'venture-relay-event'> & {
  source: EventSource; eventKind: EventKind; ref: string; receivedAt: IsoTime; state: EventState; line: string;
  /** What the event's confirmation found, for the blanks. Never the payer's or attendee's own details beyond a client's name. */
  facts: EventFacts | null;
  /** The triggers that already ran for this event. */
  ranFor: string[];
};
export type RelayEventView = { id: string; source: EventSource; kind: EventKind; receivedAt: IsoTime; state: EventState; line: string };
export type EventsView = { relay: string | null; calKey: boolean; line: string; label: string; missed: number; events: RelayEventView[]; blanks: Readonly<Record<string, readonly string[]>> };

export const EVENT_WORDS = Object.freeze({
  closed: "Nothing fires while Chausar is closed. Events from the last 24 hours are drafted when you open it.",
  label: 'Tested with stand-ins until you run one with your own relay and test-mode keys.',
  missed: (count: number) => (count === 1 ? 'One event was too old to draft: it came in more than 24 hours before Chausar opened.' : `${count} events were too old to draft: they came in more than 24 hours before Chausar opened.`),
  noRelay: 'Set your relay address first: a trigger hears events only through it.',
  noSource: { razorpay: 'Connect Razorpay first: each payment is checked there before anything runs.', 'cal-com': 'Save your Cal.com key first: each booking is checked there before anything runs.' },
  blank: (blank: string) => `{${blank}} is not one of this event's blanks. Use only the blanks listed.`,
  needsClient: (client: string) => `Needs ${client}'s AI permission first.`,
  drafted: 'Drafted. It waits for you.',
  confirmed: 'Checked at its source.',
  noStore: 'Protected key storage is unavailable on this computer.',
});

/** Each event's blanks, filled by code from the confirmed facts. */
export const EVENT_BLANKS: Readonly<Record<EventKind, readonly string[]>> = Object.freeze({
  payment: ['client', 'invoice', 'amount', 'when'], booking: ['client', 'when', 'event'], 'booking-cancelled': ['client', 'when', 'event'],
});
export const FACT_WORDS: Readonly<Record<string, string>> = Object.freeze({ client: "the client's name", invoice: 'the invoice number', amount: 'the amount paid', when: 'the time', event: 'the event type' });
const EVENT_WHEN: Readonly<Record<EventKind, string>> = Object.freeze({ payment: 'When a payment comes in', booking: 'When a booking is made', 'booking-cancelled': 'When a booking is cancelled' });

export type EventSchedule = Extract<RoutineSchedule, { kind: 'event' }>;
export const eventWhen = (schedule: EventSchedule) => EVENT_WHEN[schedule.event];

/** The blanks a trigger's prompt uses, checked against its event; the facts it sends. */
export function triggerFacts(prompt: string, schedule: EventSchedule): string[] {
  const allowed = EVENT_BLANKS[schedule.event];
  const used = [...new Set([...prompt.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]!))];
  for (const blank of used) check(allowed.includes(blank), 'INVALID_VENTURE_REQUEST', EVENT_WORDS.blank(blank));
  return used;
}

/** Whether a trigger may be saved: the relay set, and its source connected. */
export function checkTrigger(venture: VentureRecord, schedule: EventSchedule): void {
  check(venture.eventRelay?.host, 'INVALID_VENTURE_REQUEST', EVENT_WORDS.noRelay);
  const connected = schedule.source === 'razorpay' ? !!venture.billing?.razorpay : venture.eventRelay?.calKey === true;
  check(connected, 'INVALID_VENTURE_REQUEST', EVENT_WORDS.noSource[schedule.source]);
}

export const fillBlanks = (prompt: string, facts: EventFacts): string => prompt.replace(/\{([a-zA-Z]+)\}/g, (_all, blank: string) => String((facts as Record<string, unknown>)[blank] ?? ''));

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

function viewOf(state: State, venture: VentureRecord): EventsView {
  const events = listRecords(state, 'venture-relay-event', venture.id);
  const missed = events.filter(event => event.state === 'missed').length;
  return {
    relay: venture.eventRelay?.host ?? null, calKey: venture.eventRelay?.calKey === true, line: EVENT_WORDS.closed, label: EVENT_WORDS.label, missed, blanks: EVENT_BLANKS,
    events: events.slice(-20).reverse().map(event => ({ id: event.id, source: event.source, kind: event.eventKind, receivedAt: event.receivedAt, state: event.state, line: event.line })),
  };
}

/** venture.events.get {} (read): the relay's host, the recent events and the line that says nothing fires while closed. */
export async function eventsGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<EventsView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return viewOf(state, venture);
}

/**
 * venture.events.relay.set { address } (approve, app only, desktop only): saves one https address of the owner's own, held
 * in protected storage; only its host stays on the business. null forgets it. Inside this computer or its network refuses.
 */
export async function eventsRelaySetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<EventsView> {
  requireAppChannel(ctx, 'venture.events.relay.set');
  const body = exactPayload(payload, ['address'], ['address']);
  assertRelayHost(deps.host);
  check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', EVENT_WORDS.noStore);
  const workspaceId = deps.store.read().workspace.id;
  let host: string | null = null;
  if (body.address === null) await deps.credentials.delete(workspaceId, RELAY_CREDENTIAL);
  else {
    let address: string;
    try { relayPollUrl(body.address as string, null); address = relayAddress(body.address); } catch (error: any) { throw error?.code === 'EVENT_RELAY_REFUSED' ? error : new ChausarError('EVENT_RELAY_REFUSED', 'Give the relay as one https address of your own, like an ntfy topic, outside this computer and its network.'); }
    await deps.credentials.set(workspaceId, RELAY_CREDENTIAL, address);
    host = new URL(address).host;
  }
  return ventureAction(deps, ctx, 'approve', 'events.relay', tx => {
    const venture = tx.touch({ eventRelay: { host, calKey: tx.venture!.eventRelay?.calKey === true, since: tx.venture!.eventRelay?.since ?? tx.now } });
    return viewOf(tx.state, venture);
  });
}

/** venture.events.calKey.set { key } (approve, app only): the owner's Cal.com API key, in protected storage; null forgets it. */
export async function eventsCalKeySetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<EventsView> {
  requireAppChannel(ctx, 'venture.events.calKey.set');
  const body = exactPayload(payload, ['key'], ['key']);
  assertRelayHost(deps.host);
  check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', EVENT_WORDS.noStore);
  const workspaceId = deps.store.read().workspace.id;
  if (body.key === null) await deps.credentials.delete(workspaceId, CALCOM_CREDENTIAL);
  else {
    check(typeof body.key === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(body.key.trim()), 'INVALID_VENTURE_REQUEST', 'Paste your whole Cal.com API key, with no spaces.');
    await deps.credentials.set(workspaceId, CALCOM_CREDENTIAL, (body.key as string).trim());
  }
  return ventureAction(deps, ctx, 'approve', 'events.calKey', tx => {
    const venture = tx.touch({ eventRelay: { host: tx.venture!.eventRelay?.host ?? null, calKey: body.key !== null, since: tx.venture!.eventRelay?.since ?? tx.now } });
    return viewOf(tx.state, venture);
  });
}

export const EVENT_HANDLERS = { 'venture.events.get': eventsGetHandler, 'venture.events.relay.set': eventsRelaySetHandler, 'venture.events.calKey.set': eventsCalKeySetHandler };

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/** Stand-ins for tests; the host passes none, so the real guard and the two services' own addresses are used. */
export type EventPorts = { net?: RelayNet; http?: ConfirmHttp };

function knownOf(state: State, venture: VentureRecord): { invoices: InvoiceLink[]; clients: KnownClient[] } {
  const clients = listRecords(state, 'venture-client', venture.id);
  const orders = listRecords(state, 'venture-order', venture.id);
  const invoices = listRecords(state, 'venture-invoice', venture.id).filter(invoice => invoice.payLink).map((invoice): InvoiceLink => {
    const order = orders.find(item => item.id === invoice.orderId);
    const client = order ? clients.find(item => item.id === order.clientId) : undefined;
    const link = invoice.payLink as unknown as { id: string; currency?: string; recordedPaymentIds?: string[] };
    return { invoiceId: invoice.id, number: invoice.number ?? invoice.id, clientId: client?.id ?? null, clientName: client?.name ?? null, payLink: { id: link.id, currency: link.currency ?? invoice.currency, recordedPaymentIds: link.recordedPaymentIds ?? [] } };
  });
  return { invoices, clients: clients.map(client => ({ id: client.id, name: client.name, email: client.email ?? null })) };
}

function factsOf(venture: VentureRecord, confirmed: PaymentFacts | BookingFacts, now: IsoTime): EventFacts {
  const zone = ownerZone(venture.country?.code, 'UTC');
  if ('invoice' in confirmed) return { clientId: confirmed.clientId, client: confirmed.client ?? NEW_PERSON, invoice: confirmed.invoice, amount: formatMoney(confirmed.amountMinor, confirmed.currency), when: formatMoment(now, zone), event: 'payment' };
  return { clientId: confirmed.clientId, client: confirmed.client, when: formatMoment(confirmed.start, zone), event: confirmed.eventType };
}

/** The triggers an event starts: on, set by the owner, for its source and kind. */
const triggersFor = (state: State, ventureId: string, event: Pick<RelayEventRecord, 'source' | 'eventKind'>): RoutineRecord[] =>
  listRecords(state, 'venture-routine', ventureId).filter(routine => routine.on && routine.removedAt === null && routine.setBy === 'owner' && routine.schedule.kind === 'event' && routine.schedule.source === event.source && routine.schedule.event === event.eventKind);

/**
 * The events' part of a sweep. Reads the relay, keeps what is new, confirms it at its source, then runs the triggers,
 * through runTrigger (routine-runner.ts), which sends and records each run. Never throws: a relay it cannot read is tried
 * again next time. Answers how many runs it made.
 */
export async function eventTick(deps: VentureDeps, ctx: Context, runTrigger: (routine: RoutineRecord, facts: EventFacts, dueAt: IsoTime) => Promise<unknown>, ports: EventPorts = deps.eventPorts ?? {}): Promise<number> {
  if (deps.host === 'hosted-web' || !deps.credentials) return 0;
  let venture = readVenture(deps, ctx).venture;
  if (!venture.eventRelay?.host) return 0;
  const workspaceId = deps.store.read().workspace.id;
  let address: string | null = null;
  try { address = await deps.credentials.get(workspaceId, RELAY_CREDENTIAL); } catch { return 0; }
  if (!address) return 0;
  const net: RelayNet = ports.net ?? { resolve: systemResolver, send: pinnedSend };
  const seen = new Set(listRecords(deps.store.read(), 'venture-relay-event', venture.id).map(event => eventKey({ source: event.source, kind: event.eventKind, ref: event.ref })));
  let page: Awaited<ReturnType<typeof readRelay>> | null = null;
  try { page = await readRelay(net, address, { since: venture.eventRelay.lastRead ?? null, seen }); } catch { page = null; }
  if (page) {
    const events: RelayEvent[] = page.events.slice(0, MAX_NEW_EVENTS);
    await ventureAction(deps, ctx, 'prepare', 'events.read', tx => {
      const nowMs = Date.parse(tx.now);
      for (const event of events) {
        const old = nowMs - Date.parse(event.receivedAt) > EVENT_WINDOW_MS;
        const { kind: eventKind, ...fields } = eventRecordOf(event);
        tx.put<RelayEventRecord>({ ...tx.base('venture-relay-event'), ...fields, eventKind, state: old ? 'missed' : 'new', line: old ? EVENT_WORDS.missed(1) : fields.line, facts: null, ranFor: [] });
      }
      tx.touch({ eventRelay: { ...tx.venture!.eventRelay!, lastRead: tx.now } });
    }).catch(() => undefined);
  }
  // Each new event is confirmed at its own source; one the service could not be reached for is tried again next time.
  const fresh = listRecords(deps.store.read(), 'venture-relay-event', venture.id).filter(event => event.state === 'new');
  if (fresh.length) {
    const state = deps.store.read();
    venture = readVenture(deps, ctx).venture;
    let calcom: string | null = null;
    try { calcom = await deps.credentials.get(workspaceId, CALCOM_CREDENTIAL); } catch { calcom = null; }
    const credentials = { razorpay: await razorpayKeys(deps, workspaceId), calcom };
    const known = knownOf(state, venture);
    for (const event of fresh) {
      const result = await confirmEvent(ports.http ?? confirmFetch, credentials, { source: event.source, kind: event.eventKind, ref: event.ref }, known);
      if (result.state === 'refused' && result.line === CONFIRM_WORDS.unreachable) continue;
      await ventureAction(deps, ctx, 'prepare', 'events.confirm', tx => {
        const live = tx.find('venture-relay-event', event.id);
        if (live?.state !== 'new') return;
        if (result.state === 'refused') tx.replace<RelayEventRecord>({ ...live, state: 'refused', line: result.line });
        else tx.replace<RelayEventRecord>({ ...live, state: 'confirmed', line: EVENT_WORDS.confirmed, facts: factsOf(tx.venture!, result.facts, live.receivedAt) });
        tx.emit('queue.changed', {});
      }).catch(() => undefined);
    }
  }
  // Runs, at most ten per trigger per sweep; the rest stay confirmed for the next sweep.
  let made = 0;
  const counted = new Map<string, number>();
  for (const event of listRecords(deps.store.read(), 'venture-relay-event', venture.id).filter(item => item.state === 'confirmed')) {
    const state = deps.store.read();
    const triggers = triggersFor(state, venture.id, event).filter(routine => !event.ranFor.includes(routine.id));
    let waiting = false;
    const ran: string[] = [];
    for (const routine of triggers) {
      const count = counted.get(routine.id) ?? 0;
      if (count >= MAX_RUNS_PER_TRIGGER) { waiting = true; continue; }
      counted.set(routine.id, count + 1);
      ran.push(routine.id);
      made += 1;
      await runTrigger(routine, event.facts!, event.receivedAt).catch(() => undefined);
    }
    await ventureAction(deps, ctx, 'prepare', 'events.ran', tx => {
      const live = tx.find('venture-relay-event', event.id);
      if (!live) return;
      tx.replace<RelayEventRecord>({ ...live, ranFor: [...live.ranFor, ...ran], ...(waiting ? {} : { state: 'drafted' as const, line: EVENT_WORDS.drafted }) });
    }).catch(() => undefined);
  }
  return made;
}
