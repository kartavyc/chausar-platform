// Chausar venture launcher, network (Ink v2 wave 4, package 4E2): the send governor for the owner's own accounts
// (catalogue C14). It never sends and never hides anything: it decides only whether Chausar opens the owner's app for
// one more message today. Per lane, a daily cap the owner may lower but never raise (LinkedIn notes 10 a day and 50 a
// week, LinkedIn messages 20, WhatsApp 20, email 30); a warm-up from the first recorded send on that lane (25, 40, 60,
// 80, then 100 percent of the cap over five weeks); the owner's sending days for first notes and follow-ups (a reply
// or an invoice reminder opens any day); and a pause of 72 hours when the owner says the platform restricted the
// account, kept as a block on that channel, so LinkedIn posting holds too, with a Today notice. It counts every send
// the owner recorded ("I sent it"), whether or not Chausar opened the app for it, so the owner is warned before
// sending more by hand. A send counts in its draft's own lane whatever the owner marked (a call on an email draft is
// an email), and any LinkedIn draft to someone who is not a connection counts as a connection note. Invoice reminders
// count but are never held by a cap; mail to an address a delivery report held (4E3's suppressedUntil) waits until
// then. The caps and the warm-up are Chausar's own choices, from 10xconnect's caps and warm-up ideas.
import { check, type Context, type State } from '../../contracts.ts';
import type {
  ChannelHoldRecord, IsoDate, IsoTime, OutreachChannel, OutreachKind, OutreachLane, OutreachRecord, OutreachSentChannel, PersonRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, listRecords, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { suppressedUntil } from './bounces.ts';
import { addDays, daysBetween, isoWeekday, nextAllowedDay, shortDay, weekStart } from './followups.ts';
import { cardsOf, pipelineSettings } from './pipeline.ts';

export const OUTREACH_LANES: readonly OutreachLane[] = Object.freeze(['linkedin-note', 'linkedin-message', 'whatsapp', 'email']);
/** Chausar's own caps per lane: the loosest it ever opens at. */
export const HOUSE_CAPS: Readonly<Record<OutreachLane, { day: number; week: number | null }>> = Object.freeze({
  'linkedin-note': { day: 10, week: 50 }, 'linkedin-message': { day: 20, week: null }, whatsapp: { day: 20, week: null }, email: { day: 30, week: null },
});
/** The share of each cap in the first, second, third, fourth and fifth week from the lane's first recorded send. */
export const WARMUP_PERCENT: readonly number[] = Object.freeze([25, 40, 60, 80, 100]);
/** How long a restricted account's channel stays paused. */
export const PAUSE_HOURS = 72;
/** Kinds that open on any day: answering someone who wrote, and a client's invoice reminder. */
const ANY_DAY: ReadonlySet<OutreachKind> = new Set<OutreachKind>(['reply', 'reminder']);

const WORDS: Readonly<Record<OutreachLane, readonly [string, string]>> = Object.freeze({
  'linkedin-note': ['LinkedIn note', 'LinkedIn notes'], 'linkedin-message': ['LinkedIn message', 'LinkedIn messages'],
  whatsapp: ['WhatsApp message', 'WhatsApp messages'], email: ['email', 'emails'],
});
/** The app Chausar opens for a channel, in a line's words. */
export const CHANNEL_APP: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'your mail app', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' });
/** The channel's connector, which a pause holds (LinkedIn's is the posting connector's too). */
export const CHANNEL_CONNECTOR: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'mail-app', linkedin: 'linkedin', whatsapp: 'whatsapp' });
const CHANNEL_SITE: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'your mail provider', linkedin: 'linkedin.com', whatsapp: 'whatsapp.com' });
const WHO_RESTRICTED: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'your mail provider', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' });
const WEEK_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];

const counted = (n: number, lane: OutreachLane) => `${n} ${WORDS[lane][n === 1 ? 0 : 1]}`;

/** The lane a send or a draft counts in: LinkedIn notes apart from other LinkedIn messages; a call counts in none. */
export function laneOf(kind: OutreachKind | null, channel: OutreachChannel | OutreachSentChannel | null): OutreachLane | null {
  if (channel === 'email' || channel === 'own-mailbox') return 'email';
  if (channel === 'whatsapp') return 'whatsapp';
  if (channel === 'linkedin') return kind === 'connection-note' ? 'linkedin-note' : 'linkedin-message';
  return null;
}

/** The warm-up share of a cap in percent: 25 before any send and in the first week, rising each week to 100. */
export function warmupPercent(firstOn: IsoDate | null, today: IsoDate): number {
  if (!firstOn) return WARMUP_PERCENT[0];
  const week = Math.floor(Math.max(0, daysBetween(firstOn, today)) / 7);
  return WARMUP_PERCENT[Math.min(week, WARMUP_PERCENT.length - 1)];
}

/** Whether the network shows someone as one of the owner's LinkedIn connections (a fact from their Connections export). */
export const isConnection = (person: Pick<PersonRecord, 'facts'> | null | undefined): boolean => !!person?.facts.some(fact => fact.kind === 'connection');

/**
 * The lane a draft counts in, from its own channel (never the channel the owner marked it sent on, so marking a call
 * dodges no cap): a LinkedIn draft to someone in the network who is not a connection counts as a connection note,
 * since only a note reaches them there.
 */
export function draftLane(record: Pick<OutreachRecord, 'outreachKind' | 'channel' | 'personId'>, people: ReadonlyMap<string, PersonRecord>): OutreachLane {
  const person = record.personId ? people.get(record.personId) : undefined;
  if (record.channel === 'linkedin' && record.outreachKind !== 'connection-note' && (!person || !isConnection(person))) return 'linkedin-note';
  return laneOf(record.outreachKind, record.channel)!;
}

/** The people of a business by id, for draftLane. */
export const peopleById = (state: State, venture: VentureRecord): Map<string, PersonRecord> =>
  new Map(listRecords(state, 'venture-person', venture.id).map(person => [person.id, person]));

/**
 * Every send the owner recorded, by lane and day (id: the draft, or the touch's own ref): drafts marked sent, in their
 * draft's lane, and sends recorded on a card without one of those drafts (a lead's email, a follow-up sent with no
 * draft). A send with no draft whose channel the owner did not say, or a call, counts in none.
 */
export function laneSends(state: State, venture: VentureRecord, today: IsoDate): { lane: OutreachLane; on: IsoDate; id: string | null }[] {
  const sends: { lane: OutreachLane; on: IsoDate; id: string | null }[] = [];
  if (!venture.country) return sends;
  const drafts = new Set<string>();
  const people = peopleById(state, venture);
  for (const draft of listRecords(state, 'venture-outreach', venture.id)) {
    if (!draft.sent) continue;
    drafts.add(draft.id);
    sends.push({ lane: draftLane(draft, people), on: localDayAt(draft.sent.at, venture.country), id: draft.id });
  }
  for (const card of cardsOf(state, venture, today)) {
    for (const touch of card.touches) {
      if (touch.what !== 'sent' || (touch.ref && drafts.has(touch.ref))) continue;
      const lane = laneOf(null, touch.channel);
      if (lane) sends.push({ lane, on: touch.on, id: touch.ref });
    }
  }
  return sends;
}

export type LaneLimits = { day: number; week: number | null; percent: number; house: { day: number; week: number | null }; owner: number | null };

function limitsFrom(state: State, venture: VentureRecord, lane: OutreachLane, today: IsoDate, sends: readonly { lane: OutreachLane; on: IsoDate }[]): LaneLimits {
  const house = HOUSE_CAPS[lane];
  const owner = pipelineSettings(state, venture.id).caps.channels?.[lane] ?? null;
  const firstOn = sends.filter(send => send.lane === lane).map(send => send.on).sort()[0] ?? null;
  const percent = warmupPercent(firstOn, today);
  const share = (cap: number) => Math.max(1, Math.floor((cap * percent) / 100));
  return { day: share(owner === null ? house.day : Math.min(owner, house.day)), week: house.week === null ? null : share(house.week), percent, house: { ...house }, owner };
}

/** A lane's caps today: Chausar's own, the owner's lower one, and the warm-up share of the lower of the two. */
export function laneLimits(state: State, venture: VentureRecord, lane: OutreachLane, today: IsoDate): LaneLimits {
  return limitsFrom(state, venture, lane, today, laneSends(state, venture, today));
}

/** How many sends a lane has today and this week (Monday to Sunday), with its caps. */
function laneToday(state: State, venture: VentureRecord, lane: OutreachLane, today: IsoDate) {
  const sends = laneSends(state, venture, today);
  const week = weekStart(today);
  const mine = sends.filter(send => send.lane === lane);
  return {
    limits: limitsFrom(state, venture, lane, today, sends),
    day: mine.filter(send => send.on === today).length,
    week: mine.filter(send => send.on >= week && send.on <= today).length,
  };
}

/** The live pause on a channel: a block (the owner's word, or one the posting browser met) inside its 72 hours. */
export function channelPause(state: State, venture: VentureRecord, channel: OutreachChannel, now: IsoTime): ChannelHoldRecord | null {
  return listRecords(state, 'venture-channel-hold', venture.id)
    .filter(hold => hold.connectorId === CHANNEL_CONNECTOR[channel] && hold.cause === 'blocked' && hold.until !== null && Date.parse(hold.until) > Date.parse(now))
    .at(-1) ?? null;
}

/**
 * Why Chausar does not open the owner's app for this message now, or null: the channel's pause (CHANNEL_FROZEN, its
 * own line); mail to an address a delivery report held (OUTREACH_BLOCKED, until the hold ends); a day the owner does
 * not send on, for first notes and follow-ups; or the lane's daily or weekly cap reached (both OUTREACH_DAILY_CAP). An
 * invoice reminder is held by none of the caps. lane: the draft's own (draftLane).
 */
export function openRefusal(state: State, venture: VentureRecord, input: { kind: OutreachKind; channel: OutreachChannel; lane: OutreachLane; to: string | null; now: IsoTime }): {
  code: 'CHANNEL_FROZEN' | 'OUTREACH_DAILY_CAP' | 'OUTREACH_BLOCKED'; line: string;
} | null {
  const pause = channelPause(state, venture, input.channel, input.now);
  if (pause) return { code: 'CHANNEL_FROZEN', line: pause.line };
  if (!venture.country) return null;
  const today = localDayAt(input.now, venture.country);
  const order = venture.country.dateOrder;
  const held = input.channel === 'email' && input.to ? suppressedUntil(state, venture.id, input.to, today) : null;
  if (held) return { code: 'OUTREACH_BLOCKED', line: `Mail to ${input.to} came back undelivered, so Chausar holds mail to it until ${formatVentureDate(held, order)}.` };
  const app = CHANNEL_APP[input.channel];
  const weekdays = pipelineSettings(state, venture.id).weekdays;
  if (!ANY_DAY.has(input.kind) && !weekdays.includes(isoWeekday(today))) {
    return { code: 'OUTREACH_DAILY_CAP', line: `Today is not one of your sending days. Chausar opens ${app} for this again on ${shortDay(nextAllowedDay(addDays(today, 1), weekdays), order)}.` };
  }
  if (input.kind === 'reminder') return null;
  const lane = input.lane;
  const { limits, day, week } = laneToday(state, venture, lane, today);
  const cap = limits.owner === null ? limits.house.day : Math.min(limits.owner, limits.house.day);
  const warming = limits.percent < 100 ? ` while this account warms up (${limits.percent} percent of ${cap} a day in its ${WEEK_WORDS[WARMUP_PERCENT.indexOf(limits.percent)]} week)` : '';
  if (day >= limits.day) return { code: 'OUTREACH_DAILY_CAP', line: `You've sent ${counted(day, lane)} today, your limit${warming}. Chausar opens ${app} again tomorrow.` };
  if (limits.week !== null && week >= limits.week) return { code: 'OUTREACH_DAILY_CAP', line: `You've sent ${counted(week, lane)} this week, your limit${warming}. Chausar opens ${app} again on Monday.` };
  return null;
}

/**
 * After a recorded send: a sentence when it reached the lane's cap for today or went past it, else nothing. A
 * reminder (no cap holds it) and a business still in its interview get nothing.
 */
export function sentLimitLine(state: State, venture: VentureRecord, lane: OutreachLane, today: IsoDate, kind: OutreachKind | null = null): string {
  if (kind === 'reminder' || !venture.country) return '';
  const { limits, day } = laneToday(state, venture, lane, today);
  if (day === limits.day) return ` That reaches your limit of ${counted(limits.day, lane)} for today.`;
  if (day > limits.day) return ` That makes ${counted(day, lane)} today, over your limit of ${limits.day}.`;
  return '';
}

/**
 * The owner's lower daily caps per lane (venture.pipeline.settings caps.channels): each a whole number from 1 up to
 * Chausar's own cap; a higher one is refused, naming Chausar's own limit.
 */
export function channelCapsInput(value: unknown): Partial<Record<OutreachLane, number>> {
  const given = exactPayload(value, OUTREACH_LANES);
  const caps: Partial<Record<OutreachLane, number>> = {};
  for (const lane of OUTREACH_LANES) {
    const cap = given[lane];
    if (cap === undefined) continue;
    check(Number.isInteger(cap) && (cap as number) >= 1, 'INVALID_VENTURE_REQUEST', `A daily limit for ${WORDS[lane][1]} is a whole number from 1.`);
    check((cap as number) <= HOUSE_CAPS[lane].day, 'INVALID_VENTURE_REQUEST', `Chausar's own limit for ${WORDS[lane][1]} is ${HOUSE_CAPS[lane].day} a day. You can only make it lower.`);
    caps[lane] = cap as number;
  }
  return caps;
}

/**
 * The owner says the platform restricted the account (venture.outreach.restricted): the channel is paused for 72
 * hours from now, kept as a block on its connector. Answers the stored hold.
 */
export function restrictChannel(tx: VentureTx, channel: OutreachChannel): ChannelHoldRecord {
  const venture = tx.venture!;
  const until = new Date(Date.parse(tx.now) + PAUSE_HOURS * 3_600_000).toISOString();
  const when = venture.country ? formatVentureDate(localDayAt(until, venture.country), venture.country.dateOrder) : until.slice(0, 10);
  const line = `You said ${WHO_RESTRICTED[channel]} restricted your account. Don't reconnect for 3 days. Chausar opens ${CHANNEL_APP[channel]} again on ${when}.`;
  const hold = tx.put<ChannelHoldRecord>({
    ...tx.base('venture-channel-hold'), connectorId: CHANNEL_CONNECTOR[channel], site: CHANNEL_SITE[channel], cause: 'blocked', line, until, postId: null, clearedAt: null, clearedBy: null,
  });
  tx.emit('queue.changed', {});
  return hold;
}

const PAUSED_TITLE: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'Your mail app is paused', linkedin: 'LinkedIn is paused', whatsapp: 'WhatsApp is paused' });

/** Today's notices for paused channels: one per live block on mail, LinkedIn or WhatsApp, with Open and Later. */
export function pauseNotices(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const now = deps.clock().toISOString();
  const country = venture.country;
  if (!country) return []; // a business still in its interview has no outreach yet
  return (['linkedin', 'whatsapp', 'email'] as const).flatMap(channel => {
    const hold = channelPause(state, venture, channel, now);
    if (!hold) return [];
    const until = formatVentureDate(localDayAt(hold.until!, country), country.dateOrder);
    return [{
      kind: 'notice' as const, subject: `outreach-pause:${hold.id}`, version: hold.id, createdAt: hold.at, title: PAUSED_TITLE[channel], line: hold.line,
      actions: [{ id: 'open' as const, label: 'Open the pipeline', primary: true }, { id: 'later' as const, label: 'Later', primary: false }],
      navigate: `Drafts for ${CHANNEL_APP[channel]} wait until ${until}. Open Clients, Pipeline.`,
    }];
  });
}
