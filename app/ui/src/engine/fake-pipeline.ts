/**
 * The fake engine's answers for the pipeline, follow-ups, drafts and handoffs, the read-only mailbox, the calendar
 * address and "after a call" (Ink v2 wave 4, package 4E4), as the engine's 4E1 to 4E3 give them
 * (platform/runtime/venture/network/pipeline-methods.ts, followup-rows.ts, outreach.ts, handoff.ts, governor.ts,
 * mailbox.ts, inbound-rows.ts, calendar-feed.ts, meeting.ts): same codes, shapes, order and words. The cards are the
 * people desk's own (fake-people.ts, which adds them with venture.pipeline.add) plus each lead of the lead list that has
 * no card yet, as the engine reads its leads into the board. The sample cards and dates are this fake's.
 *
 * Today's follow-up and reply rows and the "Add notes" notice are kept in the shared rows (syncRows, called before
 * every queue list), so a follow-up comes due as the fake's clock moves. The fake reads meeting notes with a small table
 * instead of the owner's AI: it is a sample, never a model. Nothing here sends anything: a handoff is a link.
 */

import {
  EngineError, type CalendarFeedView, type FollowupView, type InboundTriage, type InboundView, type LawfulBasis, type LeadView, type LostReason,
  type MailboxView, type OutreachChannel, type OutreachHandoff, type OutreachKind, type OutreachSentChannel, type OutreachView, type PipelineCardView, type PipelineQuoteView,
  type PipelineStage, type PipelineView, type ProposalView, type QueueAction, type QueueRow, type ReceiptLite, type StatTileView, type TieBand, type WarmPathView,
} from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4E4_METHODS: readonly string[] = [
  'venture.pipeline.list', 'venture.pipeline.followups', 'venture.pipeline.setNext', 'venture.pipeline.move', 'venture.pipeline.settings',
  'venture.outreach.draft', 'venture.outreach.open', 'venture.outreach.sent', 'venture.outreach.restricted',
  'venture.mailbox.connect', 'venture.mailbox.disconnect', 'venture.mailbox.sync', 'venture.inbound.list', 'venture.inbound.confirm',
  'venture.network.calendar', 'venture.meeting.digest',
];

/** What the pipeline desk reads about one person of the network (fake-people.ts). */
export interface PipelinePerson {
  id: string; name: string; company: string | null; band: TieBand | null; emails: string[]; phone: string | null; linkedin: string | null; paths: WarmPathView[];
}
/** The people desk as the pipeline desk uses it. */
export interface PipelinePeople {
  liveCards(): PipelineCardView[];
  contact(id: string): PipelinePerson | null;
  allContacts(): PipelinePerson[];
}
/** A drafted proposal from meeting notes, kept by the chief's desk (fake-chief.ts) so it is raised and decided there. */
export interface MeetingDrafts {
  draftFromMeeting(input: { kind: 'next-step' | 'outreach-draft'; title: string; line: string; needsDay: boolean }): ProposalView;
}

const STAGES: readonly PipelineStage[] = ['found', 'asked', 'talking', 'proposal', 'won', 'lost', 'not-now'];
const RANK: Readonly<Record<PipelineStage, number>> = { found: 0, asked: 1, talking: 2, proposal: 3, won: 4, lost: 4, 'not-now': 4 };
const CLOSED: ReadonlySet<PipelineStage> = new Set(['won', 'lost', 'not-now']);
const STAGE_LABEL: Readonly<Record<PipelineStage, string>> = { found: 'Found', asked: 'Asked', talking: 'Talking', proposal: 'Proposal', won: 'Won', lost: 'Lost', 'not-now': 'Not now' };
const STAGE_SUB: Readonly<Record<PipelineStage, string>> = {
  found: 'Not asked yet', asked: 'You sent the first note', talking: 'They wrote back', proposal: 'A price is with them', won: 'Now your clients',
  lost: 'It did not go ahead', 'not-now': 'Ask again later',
};
const DRAFT_WORDS: Readonly<Record<OutreachKind, string>> = {
  'intro-request': 'Intro', 'double-opt-in': 'Double opt-in intro', 'connection-note': 'Connection note', 'follow-up': 'Follow-up', reply: 'Reply', 'cold-email': 'Cold email', reminder: 'Reminder',
};
const CHANNEL_WORDS: Readonly<Record<OutreachChannel, string>> = { email: 'Mail', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' };
const CHANNEL_APP: Readonly<Record<OutreachChannel, string>> = { email: 'your mail app', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' };
const WHO_RESTRICTED: Readonly<Record<OutreachChannel, string>> = { email: 'your mail provider', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' };
const SENT_OF: Readonly<Record<OutreachChannel, OutreachSentChannel>> = { email: 'own-mailbox', linkedin: 'linkedin', whatsapp: 'whatsapp' };
const SENT_WORDS: Readonly<Record<OutreachChannel, string>> = { email: 'This draft goes from your own mailbox.', linkedin: 'This draft goes on LinkedIn.', whatsapp: 'This draft goes on WhatsApp.' };
const CHANNEL_PHRASE: Readonly<Record<OutreachSentChannel, string>> = { 'own-mailbox': ' by email', linkedin: ' on LinkedIn', whatsapp: ' on WhatsApp', phone: ' by phone' };
const OPEN_LABEL: Readonly<Record<OutreachChannel, string>> = { email: 'Open in Mail', linkedin: 'Open in LinkedIn', whatsapp: 'Open WhatsApp' };
const WARM: ReadonlySet<TieBand> = new Set(['close', 'know-well', 'know']);
const BANDS: readonly TieBand[] = ['close', 'know-well', 'know', 'met-once', 'cold'];
const LOST_REASONS: readonly LostReason[] = ['no-budget', 'no-reply', 'chose-someone-else', 'not-a-fit', 'timing', 'other'];
const LOST_WORDS: Readonly<Record<LostReason, string>> = {
  'no-budget': 'no budget', 'no-reply': 'no reply', 'chose-someone-else': 'they chose someone else', 'not-a-fit': 'not a fit', timing: 'the timing', other: 'another reason', 'opted-out': 'they opted out',
};
const KINDS: readonly OutreachKind[] = ['intro-request', 'double-opt-in', 'connection-note', 'follow-up', 'reply', 'cold-email'];
const BASES: readonly LawfulBasis[] = ['they-wrote-first', 'existing-contact', 'public-business-contact'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const BLOCKED_LINE = 'This person asked not to be contacted, or is on your blocklist.';
const blockedLine = (name: string) => `${name} asked not to be contacted, or is on your blocklist.`;
const COUNTED_LINE = 'Chausar sends nothing here, and counts only the notes you mark as sent.';
const NOTE_CAP_LINE = 'Free accounts get only a few personal notes a month. LinkedIn has not said how many.';
const UNSUBSCRIBE = 'To stop these emails, reply with the word unsubscribe and we will not write to you again.';
const WHATSAPP_COLD = 'WhatsApp is for people you know. Write cold messages by email.';
const TEMPLATE_LINE = 'Drafted by Chausar. Read it, then send it yourself.';
const MAX_HANDOFF_URL = 30_000;
const HOSTED_MAILBOX = 'Connect your mailbox in the desktop app. It reads your mail on your computer.';
const HOSTED_CALENDAR = 'Set your calendar address in the desktop app. It reads your calendar on your computer.';
const NOT_CONNECTED = 'Your mailbox is not connected. Connect it under Connections to read replies.';
const OAUTH_ONLY = 'This account only allows Google or Microsoft sign-in, so it can\'t connect this way. Use an app password, or keep recording replies by hand.';
const LOGIN_FAILED = 'The mail server did not accept this address and app password. Check both, and use an app password from your mail account\'s security settings.';
const CALENDAR_HTTPS = 'Use your calendar\'s private address, the one that starts with https:// or webcal:// and ends in .ics.';
const CALENDAR_REMOVED = 'No calendar address. Chausar reads no calendar.';
const BOT_ANSWER = 'I use an AI assistant to help draft messages, and I read and send every one myself.';
const MEETING_NO_DATE = 'No day was written in your notes, so you choose it when you approve.';
const MEETING_DRAFTED = 'Drafted for you to approve. Nothing changes until you do.';
const NOTES_WINDOW_MS = 48 * 60 * 60_000;
/** The sample's quote receipt (Leela's edit rate), served by receipt(). */
const QUOTE_RECEIPT = 'R-pipe-quote-leela';
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'icloud.com', 'zoho.com']);
const WARM_BANDS: ReadonlySet<TieBand> = WARM;
const DRAFT_CHOICES: readonly { kind: OutreachKind; channel: OutreachChannel }[] = (['intro-request', 'double-opt-in', 'connection-note', 'follow-up', 'reply', 'cold-email'] as const)
  .flatMap((kind) => (['email', 'linkedin', 'whatsapp'] as const).filter((channel) => (kind !== 'connection-note' || channel === 'linkedin') && (kind !== 'cold-email' || channel === 'email'))
    .map((channel) => ({ kind, channel })));

// ---------------------------------------------------------------------------------------------------------------------
// Days, as the engine reads them in India (UTC+05:30)
// ---------------------------------------------------------------------------------------------------------------------

const IST_MS = 330 * 60_000;
const localDay = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);
const localTime = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(11, 16);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const weekday = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const longDay = (day: string) => `${shortDay(day)} ${day.slice(0, 4)}`;
const lateWords = (due: string, today: string) => { const late = daysBetween(due, today); return late <= 0 ? null : `${late} ${late === 1 ? 'day' : 'days'} late`; };
/** The next sending day on or after a day: Monday to Friday, the engine's default. */
const sendingDay = (day: string) => { let at = day; while (weekday(at) > 5) at = addDays(at, 1); return at; };
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------------------------
// What the desk keeps
// ---------------------------------------------------------------------------------------------------------------------

interface Touch { what: 'sent' | 'reply'; on: string; channel: OutreachSentChannel | null; kind: OutreachKind | null }
interface CardState {
  stage: PipelineStage;
  history: { to: PipelineStage; at: string }[];
  touches: Touch[];
  /** The owner's own next step. */
  next: { text: string; due: string } | null;
  askAgainFrom: string | null;
  lostReason: LostReason | null;
  basis: LawfulBasis | null;
  trigger: string;
  score: PipelineCardView['score'];
  /** 4E4: the quote a Proposal card rests on, and the client a Won card made. */
  quote?: { value: string; receiptId: string } | null;
  client?: { name: string; line: string } | null;
}
interface Draft {
  id: string; cardId: string; personId: string | null; kind: OutreachKind; channel: OutreachChannel; toName: string; to: string;
  subject: string | null; text: string; blurb: string | null; footer: { unsubscribe: string; postalAddress: string } | null;
  lints: { rule: string; line: string }[]; limit: number | null; at: string; sent: { at: string; channel: OutreachSentChannel } | null; digest: string;
  language: 'en' | 'hi';
}
interface Inbound {
  id: string; from: string; date: string; subject: string; triage: InboundTriage; cardId: string | null; candidate: string | null; name: string;
  company: string | null; topics: ('price' | 'contract' | 'meeting' | 'buying')[]; processed: boolean; line: string;
  /** opt-out: what it left for the owner (inbound.ts optOut); bounce: the dead domain to ask about and the address. */
  optOut?: { close: string[]; block: string[] }; domainAsk?: string | null; bounced?: string;
}
interface Mailbox { host: string; port: number; user: string; status: 'connected' | 'disconnected'; lastSync: string | null; password: boolean; synced: number }
interface CallEvent { id: string; endAt: string; personIds: string[]; notesAt: string | null; declined: boolean }
interface Feed { host: string; lastRead: string; line: string; events: CallEvent[] }
interface Desk {
  states: Map<string, CardState>;
  drafts: Draft[];
  inbound: Inbound[];
  mailbox: Mailbox | null;
  feed: Feed | null;
  holds: Partial<Record<OutreachChannel, { until: string; line: string }>>;
  postal: string | null;
  /** The follow-up rows the owner said they sent, by row id, so the row does not come back. */
  followupsDone: Set<string>;
  /** The desk's blocklist (customers/leads.ts Blocklist): addresses and whole domains no draft, handoff or new card reaches. */
  blocklist: { emails: Set<string>; domains: Set<string> };
  /** The business's quotes (price receipts on an offer), oldest first; the board lists them newest first. */
  quotes: (PipelineQuoteView & { explanation: string })[];
}

type Card = { view: PipelineCardView; state: CardState; lead: LeadView | null };

/** Whether the dev page asks for the "due" sample (`?due`): follow-ups late, replies and a call waiting on Today. */
function devAsksDue(): boolean {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has('due'); } catch { return false; }
}

const digestOf = (value: unknown) => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `d${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export class FakePipelineDesk {
  private readonly host: W4DeskHost;
  private readonly people: PipelinePeople;
  private readonly meetings: MeetingDrafts;
  private readonly desks = new Map<string, Desk>();
  private seq = 0;

  constructor(host: W4DeskHost, people: PipelinePeople, meetings: MeetingDrafts, options: { fresh?: boolean; due?: boolean } = {}) {
    this.host = host;
    this.people = people;
    this.meetings = meetings;
    if (!options.fresh) this.seed(options.due ?? devAsksDue());
  }

  handles(method: string): boolean {
    return FAKE_4E4_METHODS.includes(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.pipeline.list': return this.list(p);
      case 'venture.pipeline.followups': return this.followups();
      case 'venture.pipeline.setNext': return this.setNext(p);
      case 'venture.pipeline.move': return this.move(p);
      case 'venture.pipeline.settings': return { weekdays: [1, 2, 3, 4, 5], sendTime: '09:00', caps: { newPerDay: 10, perWeek: 40 }, scoreRules: [], line: 'Your pipeline settings.' };
      case 'venture.outreach.draft': return this.draft(p);
      case 'venture.outreach.open': return this.open(p);
      case 'venture.outreach.sent': return this.sent(p);
      case 'venture.outreach.restricted': return this.restricted(p);
      case 'venture.mailbox.connect': return this.connect(p);
      case 'venture.mailbox.disconnect': return this.disconnect();
      case 'venture.mailbox.sync': return this.sync();
      case 'venture.inbound.list': return { items: this.desk().inbound.map((item) => this.inboundView(item)) };
      case 'venture.inbound.confirm': return this.confirm(p);
      case 'venture.network.calendar': return this.calendar(p);
      case 'venture.meeting.digest': return this.digest(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The sample
  // -------------------------------------------------------------------------------------------------------------------

  private seed(due: boolean) {
    const desk = this.desk('lumen');
    const today = localDay(this.host.now());
    const at = (day: string, time = '05:30') => `${day}T${time}:00.000Z`;
    const cards = this.people.liveCards();
    const add = (personId: string, state: CardState) => {
      const person = this.people.contact(personId);
      if (!person) return;
      const id = `opp_seed_${personId.replace('person_', '')}`;
      cards.push({
        id, personId, name: person.name, initials: initials(person.name), company: person.company, stage: state.stage, band: person.band,
        dots: person.band ? BANDS.length - BANDS.indexOf(person.band) : 0, path: null, next: null, draft: null, business: 'Lumen Studio', trigger: state.trigger, score: null, timeline: [],
        draftId: null, draftChannel: null, outreach: [], basis: null, quote: null, client: null,
      });
      desk.states.set(id, state);
    };
    const tara = due ? addDays(today, -7) : addDays(today, -1);
    add('person_tara', {
      stage: 'asked', history: [{ to: 'found', at: at(addDays(tara, -3)) }, { to: 'asked', at: at(tara) }], touches: [{ what: 'sent', on: tara, channel: 'own-mailbox', kind: 'follow-up' }],
      next: null, askAgainFrom: null, lostReason: null, basis: null, trigger: 'LinkedIn connections, Connections.csv, line 14',
      score: { bucket: 'warm', reasons: ['Title contains "partnerships": +20', 'Knows you well: +15'] },
    });
    add('person_kabir', {
      stage: 'found', history: [{ to: 'found', at: at(addDays(today, -2)) }], touches: [], next: null, askAgainFrom: null, lostReason: null, basis: null,
      trigger: 'From your search "founders in audio"', score: null,
    });
    add('person_nisha', {
      stage: 'found', history: [{ to: 'found', at: at(addDays(today, -2)) }], touches: [], next: null, askAgainFrom: null, lostReason: null, basis: null,
      trigger: 'From your search "founders in audio"', score: null,
    });
    const vikram = addDays(today, -8);
    add('person_vikram', {
      stage: 'talking', history: [{ to: 'found', at: at(addDays(vikram, -2)) }, { to: 'asked', at: at(vikram) }, { to: 'talking', at: at(addDays(today, -3)) }],
      touches: [{ what: 'sent', on: vikram, channel: 'linkedin', kind: 'follow-up' }, { what: 'reply', on: addDays(today, -3), channel: null, kind: null }],
      next: { text: 'Call about the explainer series', due: addDays(today, due ? 0 : 3) }, askAgainFrom: null, lostReason: null, basis: null, trigger: 'You added them.', score: null,
    });
    // Two quotes made from the price list: Leela's monthly edits, and a set of short reels nobody is on yet.
    desk.quotes.push(
      { receiptId: QUOTE_RECEIPT, offer: 'Monthly edits', quantity: '1', value: '₹18,000', at: at(addDays(today, -3)), explanation: 'The quote for monthly edits, worked out from your price list.' },
      { receiptId: 'R-pipe-quote-reel', offer: 'Short reel', quantity: '4', value: '₹9,600', at: at(addDays(today, -1)), explanation: 'The quote for four short reels, worked out from your price list.' },
    );
    const leela = addDays(today, -12);
    add('person_leela', {
      stage: 'proposal', history: [{ to: 'found', at: at(addDays(leela, -1)) }, { to: 'asked', at: at(leela) }, { to: 'talking', at: at(addDays(leela, 2)) }, { to: 'proposal', at: at(addDays(today, -2)) }],
      touches: [{ what: 'sent', on: leela, channel: 'own-mailbox', kind: 'follow-up' }, { what: 'reply', on: addDays(leela, 2), channel: null, kind: null }],
      next: { text: 'Hear back on the edit rate', due: addDays(today, 4) }, askAgainFrom: null, lostReason: null, basis: null, trigger: 'You added them.', score: null,
      quote: { value: '₹18,000', receiptId: QUOTE_RECEIPT },
    });
    const won = today.slice(8) >= '05' ? addDays(today, -4) : today;
    add('person_pooja', {
      stage: 'won', history: [{ to: 'found', at: at(addDays(won, -30)) }, { to: 'asked', at: at(addDays(won, -28)) }, { to: 'talking', at: at(addDays(won, -20)) }, { to: 'won', at: at(won) }],
      touches: [{ what: 'sent', on: addDays(won, -28), channel: 'own-mailbox', kind: 'follow-up' }, { what: 'reply', on: addDays(won, -20), channel: null, kind: null }],
      next: null, askAgainFrom: null, lostReason: null, basis: null, trigger: 'You added them.', score: null,
      client: { name: 'Nimbus Mics', line: `Now a client since ${shortDay(won)}.` },
    });
    const sana = addDays(today, -40);
    add('person_sana', {
      stage: 'not-now', history: [{ to: 'found', at: at(addDays(sana, -1)) }, { to: 'asked', at: at(sana) }, { to: 'not-now', at: at(addDays(today, -10)) }],
      touches: [{ what: 'sent', on: sana, channel: 'own-mailbox', kind: 'follow-up' }, { what: 'sent', on: addDays(sana, 5), channel: 'own-mailbox', kind: 'follow-up' }],
      next: null, askAgainFrom: addDays(today, 20), lostReason: null, basis: null, trigger: 'LinkedIn connections, Connections.csv, line 53', score: null,
    });
    // Drafts waiting: a nudge to Tara by mail and an intro to Kabir through Tara.
    const taraCard = 'opp_seed_tara';
    desk.drafts.push(this.makeDraft({
      cardId: taraCard, personId: 'person_tara', kind: 'follow-up', channel: 'email', toName: 'Tara Iyer', to: 'tara@kettleaudio.example', subject: 'Following up',
      text: `Hi Tara, just following up on my note of ${shortDay(tara)}. No pressure at all if now is not a good time.`, blurb: null, footer: null, at: at(addDays(tara, 1), '04:00'),
    }));
    desk.drafts.push(this.makeDraft({
      cardId: 'opp_seed_kabir', personId: 'person_tara', kind: 'intro-request', channel: 'email', toName: 'Tara Iyer', to: 'tara@kettleaudio.example', subject: 'An introduction to Kabir Sethi?',
      text: 'Hi Tara, I hope you are well. Would you be open to introducing me to Kabir Sethi at Kettle Audio? I would like a short conversation with Kabir. There is a short note below that you can forward. If now is not a good time, or you would rather not, just say so. That is completely fine.',
      blurb: 'Lumen Studio is a small business that offers mic reviews and sponsored videos. Its owner would like a short conversation with Kabir. It would be a short conversation about Kabir\'s work. Nothing is being sold in this note. If Kabir would rather not, that is completely fine.',
      footer: null, at: at(addDays(today, -1), '04:00'),
    }));
    if (due) {
      // The mailbox read an hour ago, with two replies that wait on the owner, and a call with Kabir that ended this morning.
      const now = this.host.now();
      desk.mailbox = { host: 'imap.zoho.in', port: 993, user: 'owner@lumenstudio.example', status: 'connected', lastSync: new Date(Date.parse(now) - 3_600_000).toISOString(), password: true, synced: 1 };
      desk.inbound.push(...this.sampleMail(now));
      desk.feed = { host: 'calendar.google.com', lastRead: new Date(Date.parse(now) - 4 * 3_600_000).toISOString(), line: 'Read this morning: 1 call with people you know lately or today.', events: [{ id: 'calevent_kabir', endAt: new Date(Date.parse(now) - 2 * 3_600_000).toISOString(), personIds: ['person_kabir'], notesAt: null, declined: false }] };
    }
  }

  /** The two replies a first read of the sample mailbox finds: Tara asks about pricing, and an unsure match for Kabir. */
  private sampleMail(now: string): Inbound[] {
    const when = new Date(Date.parse(now) - 2 * 3_600_000).toISOString();
    const on = longDay(localDay(when));
    return [
      {
        id: `inbound_${(this.seq += 1)}`, from: 'tara@kettleaudio.example', date: when, subject: 'Re: Following up', triage: 'owner-reply', cardId: 'opp_seed_tara', candidate: null,
        name: 'Tara Iyer', company: 'Kettle Audio', topics: ['price'], processed: false, line: `Tara asked about pricing. Reply yourself. Mail of ${on}.`,
      },
      {
        id: `inbound_${(this.seq += 1)}`, from: 'k.sethi@mail.example', date: when, subject: 'Mic reviews', triage: 'unmatched', cardId: null, candidate: 'opp_seed_kabir',
        name: 'Kabir Sethi', company: 'Kettle Audio', topics: [], processed: false, line: 'Chausar was not sure enough to attach this to a card, so it asks you.',
      },
    ];
  }

  /**
   * What a second read of the sample mailbox finds (inbound.ts writeInbound): Tara asks, from her own Gmail, not to be
   * contacted (the address it came from is blocked at once; her work address and her open card wait for the owner,
   * since the mail cannot be proved hers), and a delivery report says rediffmail.com takes no mail.
   */
  private secondMail(now: string): Inbound[] {
    const when = new Date(Date.parse(now) - 30 * 60_000).toISOString();
    return [
      {
        id: `inbound_${(this.seq += 1)}`, from: 'tara.iyer@gmail.com', date: when, subject: 'Please remove me', triage: 'opt-out', cardId: null, candidate: null,
        name: 'Tara Iyer', company: 'Kettle Audio', topics: [], processed: false, line: 'Tara asked not to be contacted from tara.iyer@gmail.com. Blocked tara.iyer@gmail.com.',
        optOut: { close: ['opp_seed_tara'], block: ['tara@kettleaudio.example'] },
      },
      {
        id: `inbound_${(this.seq += 1)}`, from: 'mailer-daemon@zoho.in', date: when, subject: 'Undelivered mail', triage: 'bounce', cardId: null, candidate: null,
        name: 'nisha.rao@rediffmail.com', company: null, topics: [], processed: false, line: 'A delivery report.', domainAsk: 'rediffmail.com', bounced: 'nisha.rao@rediffmail.com',
      },
    ];
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Reading the board
  // -------------------------------------------------------------------------------------------------------------------

  private desk(id = this.host.current()): Desk {
    let desk = this.desks.get(id);
    if (!desk) {
      desk = { states: new Map(), drafts: [], inbound: [], mailbox: null, feed: null, holds: {}, postal: null, followupsDone: new Set(), blocklist: { emails: new Set(), domains: new Set() }, quotes: [] };
      this.desks.set(id, desk);
    }
    return desk;
  }

  private today(): string { return localDay(this.host.now()); }

  /** Adds an address or a whole domain to the open business's blocklist (customers/leads.ts addToBlocklist). */
  private block(value: string) {
    const entry = value.trim().toLowerCase();
    if (!entry) return;
    const list = this.desk().blocklist;
    if (entry.includes('@')) list.emails.add(entry); else list.domains.add(entry);
  }

  /** Whether the blocklist covers an address, or its domain (customers/leads.ts isBlocked). */
  isBlocked(value: string | null | undefined): boolean {
    const entry = (value ?? '').trim().toLowerCase();
    if (!entry) return false;
    const list = this.desk().blocklist;
    return entry.includes('@') ? list.emails.has(entry) || list.domains.has(entry.split('@')[1]!) : list.domains.has(entry);
  }

  /** Whether the blocklist covers a person in the network: any of their addresses (customers/leads.ts personOnBlocklist). */
  personBlocked(personId: string): boolean {
    const person = this.people.contact(personId);
    return !!person && person.emails.some((email) => this.isBlocked(email));
  }

  /** Whether a card is blocked: its lead was blocked, or its lead's or person's address is on the blocklist (pipeline.ts). */
  private cardBlocked(card: Card): boolean {
    if (card.lead) return card.lead.status === 'blocked' || this.isBlocked(card.lead.email);
    return this.personBlocked(card.view.personId);
  }

  private businessName(): string {
    return this.host.businesses?.().find((item) => item.id === this.host.current())?.name ?? this.host.current();
  }

  private leads(): LeadView[] {
    try { return (this.host.ask('venture.leads.list', {}) as { leads: LeadView[] }).leads; } catch { return []; }
  }

  /** A lead's own stage on the board (customers/leads.ts leadToOpportunity): new to Found, drafted and contacted to Asked. */
  private leadStage(lead: LeadView): PipelineStage {
    const reached = lead.status === 'blocked' ? [...lead.moves].reverse().find((move) => move.to === 'blocked')?.from ?? 'new' : lead.status;
    return ({ new: 'found', drafted: 'asked', contacted: 'asked', replied: 'talking', won: 'won', lost: 'lost', blocked: 'found' } as const)[reached];
  }

  /** The state of a card: kept, or (for a card the people desk just added, or a lead) read from what it is. */
  private stateOf(view: PipelineCardView, lead: LeadView | null): CardState {
    const desk = this.desk();
    const kept = desk.states.get(view.id);
    if (kept) return kept;
    if (lead) {
      const stage = this.leadStage(lead);
      const touches: Touch[] = lead.sends.map((send) => ({ what: 'sent', on: localDay(send.sentAt), channel: 'own-mailbox', kind: 'cold-email' }));
      return {
        stage, history: [{ to: 'found', at: lead.addedAt }, ...(stage !== 'found' ? [{ to: stage, at: lead.sends.at(-1)?.sentAt ?? lead.addedAt }] : [])],
        touches, next: null, askAgainFrom: null, lostReason: null, basis: null, trigger: `Found on ${this.where(lead.sourceUrl)}`, score: null,
      };
    }
    const state: CardState = { stage: view.stage, history: [{ to: 'found', at: this.host.now() }], touches: [], next: null, askAgainFrom: null, lostReason: null, basis: null, trigger: view.trigger, score: null };
    desk.states.set(view.id, state);
    return state;
  }

  private where(url: string): string {
    try { const parsed = new URL(url); return `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}`; } catch { return 'a web page'; }
  }

  /** Every card of the open business: the people desk's, then each lead with no card yet. */
  private cards(): Card[] {
    const cards: Card[] = this.people.liveCards().map((view) => ({ view, state: this.stateOf(view, null), lead: null }));
    for (const lead of this.leads()) {
      if (cards.some((card) => card.view.id === lead.id)) continue;
      const kept = this.desk().states.get(lead.id);
      const view: PipelineCardView = {
        id: lead.id, personId: lead.id, name: lead.name, initials: initials(lead.name), company: lead.company, stage: 'found', band: null, dots: 0, path: null,
        next: null, draft: null, business: this.businessName(), trigger: '', score: null, timeline: [],
        draftId: null, draftChannel: null, outreach: [], basis: null, quote: null, client: null,
      };
      cards.push({ view, state: kept ?? this.stateOf(view, lead), lead });
    }
    for (const card of cards) this.refresh(card);
    return cards;
  }

  private findCard(id: unknown): Card {
    const card = this.cards().find((item) => item.view.id === id);
    if (!card) throw new EngineError('INVALID_VENTURE_REQUEST', 'This card is not in your pipeline.');
    return card;
  }

  /** The nudge a card's sequence plans next, or null: two nudges, then it parks. */
  private plan(state: CardState): { kind: 'nudge'; step: number; due: string; channel: OutreachChannel | null } | { kind: 'park'; on: string } | null {
    if (state.stage !== 'asked') return null;
    const sent = state.touches.filter((touch) => touch.what === 'sent');
    const first = sent[0];
    if (!first || state.touches.some((touch) => touch.what === 'reply')) return null;
    const channel: OutreachChannel | null = first.channel === 'own-mailbox' ? 'email' : first.channel === 'linkedin' || first.channel === 'whatsapp' ? first.channel : null;
    const intro = first.kind === 'intro-request';
    const gaps = intro ? [7] : channel === 'email' ? [5, 5] : [4, 10];
    const step = sent.length - 1;
    const last = sent.at(-1)!;
    if (step >= gaps.length) return { kind: 'park', on: addDays(last.on, 10) };
    return { kind: 'nudge', step, due: sendingDay(addDays(last.on, gaps[step]!)), channel };
  }

  private nextOf(state: CardState, today: string): PipelineCardView['next'] {
    if (state.stage === 'not-now') return state.askAgainFrom ? { text: 'Ask again', due: state.askAgainFrom, line: `Ask again from ${shortDay(state.askAgainFrom)}`, late: false } : null;
    if (CLOSED.has(state.stage)) return null;
    const plan = this.plan(state);
    const own = state.next;
    const fromPlan = plan?.kind === 'nudge' ? { text: plan.step === 0 ? 'Follow up' : 'Follow up again', due: plan.due, owner: false }
      : plan?.kind === 'park' ? { text: 'Parks as Not now if there is no reply', due: plan.on, owner: false } : null;
    const pick = own && (!fromPlan || own.due < fromPlan.due) ? { ...own, owner: true } : fromPlan;
    if (!pick) return null;
    const late = pick.due < today ? `, ${lateWords(pick.due, today)}` : '';
    const line = pick.owner ? (pick.due === today ? `${pick.text}, due today` : `${pick.text}, due ${shortDay(pick.due)}${late}`)
      : plan?.kind === 'park' ? `Parks as Not now on ${shortDay(pick.due)} if there is no reply`
        : pick.due === today ? `${pick.text} today` : `${pick.text} ${shortDay(pick.due)}${late}`;
    return { text: pick.text, due: pick.due, line, late: plan?.kind !== 'park' && pick.due < today };
  }

  private unsent(card: Card): { id: string; kind: OutreachKind; channel: OutreachChannel; at: string }[] {
    const drafts = this.desk().drafts.filter((draft) => draft.cardId === card.view.id && !draft.sent).map((draft) => ({ id: draft.id, kind: draft.kind, channel: draft.channel, at: draft.at }));
    if (card.lead) {
      const sent = new Set(card.lead.sends.map((send) => send.draftId));
      for (const draft of card.lead.drafts) if (!sent.has(draft.id)) drafts.push({ id: draft.id, kind: 'cold-email', channel: 'email', at: draft.at });
    }
    return drafts.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /** Brings a card's view up to date from its state, in the engine's words (pipeline-methods.ts cardView). */
  private refresh(card: Card) {
    const { view, state } = card;
    const today = this.today();
    const person = card.lead ? null : this.people.contact(view.personId);
    const blocked = this.cardBlocked(card);
    const [draft] = this.unsent(card);
    const replies = state.touches.filter((touch) => touch.what === 'reply').map((touch) => touch.on).sort();
    const lastReply = replies.at(-1);
    view.stage = state.stage;
    view.trigger = state.trigger;
    view.business = this.businessName();
    // The best path first (network/paths.ts warmPaths): a confirmed connector, a direct tie that is more than cold,
    // then a possible path through someone, then whatever there is.
    const paths = person?.paths ?? [];
    view.path = paths.find((path) => path.confirmed && path.via) ?? paths.find((path) => !path.via && path.strength !== 'cold') ?? paths.find((path) => path.via) ?? paths[0] ?? null;
    view.next = blocked ? null : this.nextOf(state, today);
    view.draft = draft ? `${DRAFT_WORDS[draft.kind]} drafted, for ${CHANNEL_WORDS[draft.channel]}` : null;
    view.draftId = draft?.id ?? null;
    view.draftChannel = draft?.channel ?? null;
    view.score = state.score;
    view.timeline = this.timeline(state, today);
    // Per kind and channel, cold (customers/leads.ts coldOutreach, with the tie of whoever it goes to) and needs its basis.
    const connector = paths.find((path) => path.confirmed && path.via && this.people.contact(path.via.id) && !this.personBlocked(path.via.id));
    const through = connector?.via ? this.people.contact(connector.via.id)?.band ?? null : null;
    const own = person?.band ?? null;
    view.outreach = DRAFT_CHOICES.map(({ kind, channel }) => {
      const band = kind === 'intro-request' ? through : own;
      const cold = channel === 'email' && (kind === 'cold-email' || band === null || !WARM_BANDS.has(band));
      return { kind, channel, cold, needsBasis: cold && (kind === 'intro-request' || !state.basis) };
    });
    view.basis = state.basis;
    view.quote = state.stage === 'proposal' ? state.quote ?? null : null;
    view.client = state.stage === 'won' ? state.client ?? null : null;
    if (blocked) view.blocked = BLOCKED_LINE; else delete view.blocked;
    if (lastReply && !CLOSED.has(state.stage)) {
      const days = Math.max(0, daysBetween(lastReply, today));
      const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      view.thread = days < 7 ? { age: 'alive', days, line: `Alive: they wrote ${when}.` } : days <= 21 ? { age: 'cooling', days, line: `Cooling: they wrote ${when}.` } : { age: 'presumed-dead', days, line: `Presumed dead: they wrote ${when}.` };
    } else delete view.thread;
  }

  private timeline(state: CardState, today: string): PipelineCardView['timeline'] {
    const sent = state.touches.filter((touch) => touch.what === 'sent');
    const newest = sent.at(-1);
    const items: PipelineCardView['timeline'] = state.touches.map((touch) => (touch.what === 'sent'
      ? {
        what: 'sent' as const, at: touch.on, estimated: false,
        line: `${sent.indexOf(touch) === 0 ? 'First note' : 'Follow-up'} sent${touch.channel ? CHANNEL_PHRASE[touch.channel] : ''}, ${shortDay(touch.on)}.${touch === newest ? ' Chausar doesn\'t track opens.' : ''}`,
      }
      : { what: 'reply' as const, at: touch.on, line: `They wrote back, ${shortDay(touch.on)}.`, estimated: false }));
    const plan = this.plan(state);
    if (plan?.kind === 'nudge') {
      items.push({ what: 'scheduled', at: plan.due, line: `${plan.step === 0 ? 'Follow up' : 'Follow up again'} ${shortDay(plan.due)}${plan.due < today ? `, ${lateWords(plan.due, today)}` : ''}`, estimated: false });
      const gaps = plan.channel === 'email' ? [5, 5] : [4, 10];
      if (plan.step + 1 < gaps.length) {
        const later = sendingDay(addDays(plan.due, gaps[plan.step + 1]!));
        items.push({ what: 'projected', at: later, line: `Second follow-up about ${shortDay(later)}, estimated`, estimated: true });
      } else {
        const park = addDays(plan.due, 10);
        items.push({ what: 'projected', at: park, line: `Parks as Not now about ${shortDay(park)} if there is no reply, estimated`, estimated: true });
      }
    } else if (plan?.kind === 'park') {
      items.push({ what: 'scheduled', at: plan.on, line: `Parks as Not now on ${shortDay(plan.on)} if there is no reply`, estimated: false });
    }
    return items.map(({ what, at, line, estimated }) => ({ what, at, line, estimated })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  /** venture.pipeline.list { filter? }: seven columns, four tiles with receipts, how people moved, and the forecast. */
  private list(p: Record<string, unknown>): PipelineView {
    if (p.filter !== undefined && p.filter !== 'due' && p.filter !== 'draft') throw new EngineError('INVALID_VENTURE_REQUEST', 'Filter by due or by draft, or not at all.');
    const today = this.today();
    const cards = this.cards();
    const soon = addDays(today, 2);
    const shown = cards.filter((card) => {
      if (p.filter === 'due') return !!card.view.next && card.view.next.text !== 'Ask again' && card.view.next.due <= soon;
      if (p.filter === 'draft') return !CLOSED.has(card.state.stage) && this.unsent(card).length > 0;
      return true;
    });
    const byNext = (a: Card, b: Card) => (a.view.next?.due ?? '9999') < (b.view.next?.due ?? '9999') ? -1 : (a.view.next?.due ?? '9999') > (b.view.next?.due ?? '9999') ? 1 : 0;
    const columns = STAGES.map((stage) => {
      const inStage = shown.filter((card) => card.state.stage === stage).sort(byNext);
      return { stage, label: STAGE_LABEL[stage], sub: STAGE_SUB[stage], count: inStage.length, folded: stage === 'lost' || stage === 'not-now', cards: structuredClone(inStage.map((card) => card.view)) };
    });
    const weekStart = addDays(today, 1 - weekday(today)), weekEnd = addDays(weekStart, 6), month = `${today.slice(0, 8)}01`;
    const open = cards.filter((card) => !CLOSED.has(card.state.stage));
    const nexts = open.map((card) => card.view.next).filter((next): next is NonNullable<typeof next> => !!next && next.due <= weekEnd);
    const drafts = open.flatMap((card) => this.unsent(card));
    const moves = cards.flatMap((card) => card.state.history.slice(1).filter((move) => !['lost', 'not-now', 'found'].includes(move.to) && localDay(move.at) >= weekStart && localDay(move.at) <= today));
    const wonNames = cards.filter((card) => card.state.history.some((move) => move.to === 'won' && localDay(move.at) >= month && localDay(move.at) <= today)).map((card) => card.view.name);
    const tally = (parts: [string, number][], empty: string) => { const said = parts.filter(([, n]) => n > 0).map(([words, n]) => words.replace('{n}', String(n))); return said.length ? said.join(', ') : empty; };
    const tile = (id: string, label: string, value: number, line: string): StatTileView => ({ id, label, value: String(value), line, receiptId: `R-pipe-${id}-${this.host.current()}` });
    const tiles = [
      tile('next-steps', 'Next steps this week', nexts.length, `${nexts.filter((next) => next.due < today).length} late, ${nexts.filter((next) => next.due === today).length} today, ${nexts.filter((next) => next.due > today).length} later`),
      tile('drafts', 'Drafts to send', drafts.length, tally((['email', 'linkedin', 'whatsapp'] as const).map((channel) => [`{n} for ${CHANNEL_WORDS[channel]}`, drafts.filter((draft) => draft.channel === channel).length]), 'None waiting')),
      tile('moved', 'Moved forward this week', moves.length, tally((['asked', 'talking', 'proposal', 'won'] as const).map((stage) => [`{n} to ${STAGE_LABEL[stage]}`, moves.filter((move) => move.to === stage).length]), 'None yet')),
      tile('won', 'Won this month', wonNames.length, wonNames.length ? wonNames.slice(0, 3).join(', ') : 'None yet'),
    ];
    const from = addDays(today, -89);
    const funnel = STAGES.map((stage) => {
      const reached = cards.filter((card) => card.state.history.some((move) => move.to === stage && localDay(move.at) >= from));
      const movedOn = reached.filter((card) => card.state.history.some((move) => RANK[move.to] > RANK[stage] && !['lost', 'not-now'].includes(move.to)));
      const movedOnPermille = CLOSED.has(stage) || reached.length === 0 ? null : Math.floor((movedOn.length * 1000) / reached.length);
      return { stage, reached: reached.length, movedOnPermille, receiptId: `R-pipe-funnel-${stage}-${this.host.current()}`, reachedPermille: 0, share: movedOnPermille === null ? null : `${Math.floor(movedOnPermille / 10)}%` };
    });
    const most = Math.max(0, ...funnel.map((item) => item.reached));
    for (const item of funnel) item.reachedPermille = most ? Math.floor((item.reached * 1000) / most) : 0;
    const closed = cards.filter((card) => CLOSED.has(card.state.stage) && card.state.history.some((move) => CLOSED.has(move.to) && localDay(move.at) >= from)).length;
    const quotes = [...this.desk().quotes].reverse().map(({ explanation: _, ...quote }) => quote);
    return { columns, tiles, funnel, forecast: { line: `Not enough history yet: ${plural(closed, 'card', 'cards')} closed in the last 90 days, and a forecast needs 10.` }, quotes };
  }

  /** The count receipts the board's tiles and "How people moved" stand on. */
  receipt(id: string): ReceiptLite | undefined {
    const quote = this.desk().quotes.find((item) => item.receiptId === id);
    if (quote) return { id, at: quote.at, stale: false, figures: [{ key: 'taxable', label: 'Before tax', display: quote.value }], explanation: quote.explanation };
    if (!id.startsWith('R-pipe-')) return undefined;
    const funnel = /^R-pipe-funnel-([a-z-]+)-/.exec(id);
    const words = funnel ? `How many cards reached ${STAGE_LABEL[funnel[1] as PipelineStage] ?? 'this stage'} in the last 90 days, and how many of them moved on` : 'How many cards this tile counts';
    return { id, at: this.host.now(), figures: [], stale: false, explanation: `${words}, counted by Chausar's code from each card's own history, never by AI.` };
  }

  /** The follow-up schedule now: due (today or late, on a sending day) and later. */
  private schedule(): { due: { card: Card; view: FollowupView; daysLate: number }[]; later: FollowupView[] } {
    const today = this.today();
    const due: { card: Card; view: FollowupView; daysLate: number }[] = [];
    const later: FollowupView[] = [];
    for (const card of this.cards()) {
      const plan = this.plan(card.state);
      if (plan?.kind !== 'nudge' || this.cardBlocked(card)) continue;
      const draft = this.unsent(card).find((item) => item.kind === 'follow-up' || item.kind === 'cold-email') ?? null;
      const text = plan.step === 0 ? 'Follow up' : 'Follow up again';
      const words = plan.due === today ? `${text} today` : `${text} ${shortDay(plan.due)}${plan.due < today ? `, ${lateWords(plan.due, today)}` : ''}`;
      const drafted = draft ? ` Nudge drafted for ${CHANNEL_WORDS[draft.channel]}.` : '';
      const view: FollowupView = {
        cardId: card.view.id, name: card.view.name, company: card.view.company, line: `${words}.${drafted}`, due: plan.due, late: plan.due < today,
        channel: draft?.channel ?? plan.channel, draftId: draft?.id ?? null,
      };
      if (plan.due > today) { later.push(view); continue; }
      if (weekday(today) > 5) { later.push({ ...view, line: `${words}. Today is not one of your sending days.` }); continue; }
      due.push({ card, view, daysLate: Math.max(0, daysBetween(plan.due, today)) });
    }
    due.sort((a, b) => (a.view.due < b.view.due ? -1 : a.view.due > b.view.due ? 1 : 0));
    return { due, later };
  }

  private followups(): { due: FollowupView[]; later: FollowupView[] } {
    const { due, later } = this.schedule();
    return { due: due.map((item) => item.view), later };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The owner's writes on the board
  // -------------------------------------------------------------------------------------------------------------------

  private announce() {
    this.host.emit({ type: 'pipeline.changed', businessId: this.host.current(), at: this.host.now() });
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
  }

  private closedLine(state: CardState): string {
    if (state.stage === 'won') return 'This card is won, so it stays as it is.';
    if (state.stage === 'lost') return 'This card is lost, so it stays as it is.';
    return state.askAgainFrom ? `This card is Not now. Ask again from ${longDay(state.askAgainFrom)} to start a new card.` : 'This card is Not now. Ask again to start a new card.';
  }

  /** Keeps a lead's card once the owner changes it, so its state stays. */
  private keep(card: Card) {
    this.desk().states.set(card.view.id, card.state);
  }

  private setNext(p: Record<string, unknown>) {
    const card = this.findCard(p.id);
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    if (text.length < 1 || text.length > 200 || /[\r\n]/.test(text)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The next step must be one line of 1 to 200 characters.');
    if (typeof p.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.due)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The day must be a date like 2026-10-23.');
    if (CLOSED.has(card.state.stage)) throw new EngineError('PIPELINE_STAGE_CLOSED', this.closedLine(card.state));
    if (this.cardBlocked(card)) throw new EngineError('PIPELINE_BLOCKED', BLOCKED_LINE);
    if (p.due < this.today()) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose today or a later day.');
    card.state.next = { text, due: p.due };
    this.keep(card);
    this.refresh(card);
    this.announce();
    return { card: structuredClone(card.view), line: `Next step set for ${longDay(p.due)}.` };
  }

  /** venture.pipeline.move: forward only, with the evidence the stage needs (pipeline.ts moveCard). */
  private move(p: Record<string, unknown>) {
    const card = this.findCard(p.id);
    const to = p.stage as PipelineStage;
    if (!STAGES.includes(to)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose one of the pipeline stages.');
    const reason = p.reason as LostReason | undefined;
    if (reason !== undefined && !LOST_REASONS.includes(reason)) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose one of the reasons: no budget, no reply, they chose someone else, not a fit, the timing, or another reason.');
    }
    const evidence = (p.evidence ?? null) as { kind?: string; on?: string; text?: string } | null;
    const { state } = card;
    if (CLOSED.has(state.stage)) throw new EngineError('PIPELINE_STAGE_CLOSED', this.closedLine(state));
    if (RANK[to] <= RANK[state.stage]) throw new EngineError('PIPELINE_STAGE_BACKWARD', 'A card only moves forward. Move it to a later stage.');
    if (to !== 'lost' && to !== 'not-now' && this.cardBlocked(card)) throw new EngineError('PIPELINE_BLOCKED', BLOCKED_LINE);
    if (reason !== undefined && to !== 'lost') throw new EngineError('INVALID_VENTURE_REQUEST', 'A reason is only for Lost.');
    const today = this.today();
    const pastDay = (day: string | undefined) => { if (!day || day > today) throw new EngineError('INVALID_VENTURE_REQUEST', 'That day cannot be in the future.'); return day; };
    let line: string;
    if (to === 'asked') {
      if (!(evidence?.kind === 'note' && evidence.on)) throw new EngineError('PIPELINE_EVIDENCE_REQUIRED', 'Asked needs a recorded send: tap I sent it after you send, or say the day you sent it.');
      state.touches.push({ what: 'sent', on: pastDay(evidence.on), channel: null, kind: null });
      state.stage = 'asked';
      const plan = this.plan(state);
      line = plan?.kind === 'nudge' ? `Moved to Asked. Follow up ${shortDay(plan.due)}.` : 'Moved to Asked.';
    } else if (to === 'talking') {
      if (!(evidence?.kind === 'reply' || (evidence?.kind === 'note' && evidence.on))) throw new EngineError('PIPELINE_EVIDENCE_REQUIRED', 'Talking needs their reply: their message, or the day they wrote back.');
      const on = evidence.on ? pastDay(evidence.on) : today;
      const following = this.plan(state)?.kind === 'nudge';
      state.touches.push({ what: 'reply', on, channel: null, kind: null });
      line = following ? 'Moved to Talking. Follow-ups stopped.' : 'Moved to Talking.';
    } else if (to === 'proposal') {
      if (evidence?.kind === 'quote') {
        const receipt = typeof (evidence as { id?: unknown }).id === 'string' ? this.receipt((evidence as { id: string }).id) : undefined;
        const figure = receipt?.figures.find((item) => item.key === 'taxable') ?? receipt?.figures.find((item) => item.key === 'total');
        if (!receipt) throw new EngineError('PIPELINE_EVIDENCE_REQUIRED', 'Choose the quote you sent, or note what you offered.');
        // Only a quote on an offer is a Proposal's evidence (pipeline.ts): any other receipt is refused.
        if (!figure || !this.desk().quotes.some((item) => item.receiptId === receipt.id)) {
          throw new EngineError('PIPELINE_NOT_A_QUOTE', 'That receipt is for an order or an invoice, not a quote. Choose a quote you made, or note what you offered.');
        }
        state.quote = { value: figure.display, receiptId: receipt.id };
      } else {
        if (!(evidence?.kind === 'note' && evidence.text)) throw new EngineError('PIPELINE_EVIDENCE_REQUIRED', 'Proposal needs the quote you sent, or a note of what you offered.');
        state.quote = null;
      }
      line = 'Moved to Proposal.';
    } else if (to === 'won') {
      if (evidence !== null && evidence.kind !== 'client') throw new EngineError('PIPELINE_EVIDENCE_REQUIRED', 'Won links a client: choose one, or Chausar makes one from this card.');
      const client = this.host.ask('venture.client.add', { name: card.view.company ?? card.view.name }) as { name: string };
      state.client = { name: client.name, line: `Now a client since ${shortDay(today)}.` };
      line = `Won. ${firstOf(client.name)} is now your client.`;
    } else if (to === 'lost') {
      if (!reason) throw new EngineError('PIPELINE_EVIDENCE_REQUIRED', 'Choose why: no budget, no reply, they chose someone else, not a fit, the timing, or another reason.');
      if (evidence !== null) throw new EngineError('INVALID_VENTURE_REQUEST', 'Lost takes a reason only.');
      state.lostReason = reason;
      state.askAgainFrom = addDays(today, 30);
      line = `Moved to Lost: ${LOST_WORDS[reason]}.`;
    } else {
      if (evidence !== null) throw new EngineError('INVALID_VENTURE_REQUEST', 'Not now takes nothing more.');
      state.askAgainFrom = addDays(today, 30);
      line = `Moved to Not now. Ask again from ${longDay(state.askAgainFrom)}.`;
    }
    state.stage = to;
    state.history.push({ to, at: this.host.now() });
    this.keep(card);
    this.refresh(card);
    this.announce();
    return { card: structuredClone(card.view), line };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Drafts and handoffs
  // -------------------------------------------------------------------------------------------------------------------

  private makeDraft(input: Omit<Draft, 'id' | 'lints' | 'limit' | 'sent' | 'digest' | 'language'> & { lints?: Draft['lints']; limit?: number | null; language?: 'en' | 'hi' }): Draft {
    const id = `outreach_${(this.seq += 1)}`;
    const draft: Draft = { lints: [], limit: null, language: 'en', ...input, id, sent: null, digest: '' };
    draft.digest = digestOf({ id, kind: draft.kind, channel: draft.channel, to: draft.to, subject: draft.subject, text: draft.text, blurb: draft.blurb, footer: draft.footer });
    return draft;
  }

  private sendLine(channel: OutreachChannel): string {
    const does = channel === 'linkedin' ? 'It copies the text and opens the LinkedIn profile' : `It opens ${CHANNEL_APP[channel]} with the text filled in`;
    return `Chausar never sends. ${does}, and counts only the notes you mark as sent.`;
  }

  private draftView(draft: Draft): OutreachView {
    return {
      id: draft.id, opportunityId: draft.cardId, kind: draft.kind, channel: draft.channel, to: `${draft.toName}, ${draft.to}`, subject: draft.subject, text: draft.text, blurb: draft.blurb,
      footer: draft.footer ? { ...draft.footer } : null, lints: draft.lints.map((lint) => ({ ...lint })),
      counter: draft.kind === 'connection-note' ? { used: [...draft.text].length, limit: draft.limit ?? 200 } : null,
      sent: draft.sent ? { ...draft.sent } : null, digest: draft.digest, author: 'template', language: draft.language, accepted: null, line: this.sendLine(draft.channel),
      blurbSentences: draft.blurb ? draft.blurb.trim().split(/(?<=[.!?\u0964])\s+/u).filter((part) => part.trim().length > 0).length : null,
    };
  }

  /** The person sheet's drafts (network/methods.ts networkPerson): to them or on their cards, newest first. */
  draftsOf(personId: string): OutreachView[] {
    const cards = new Set(this.people.liveCards().filter((card) => card.personId === personId).map((card) => card.id));
    return this.desk().drafts.filter((draft) => draft.personId === personId || cards.has(draft.cardId))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map((draft) => this.draftView(draft));
  }

  /**
   * 4J22b: mail Chausar leaves for the owner to answer and that is not handled yet (agents/ideas.ts waitingOnYou): who
   * wrote (the person, else the address) and when, for "Who is waiting on you".
   */
  waitingMail(): { id: string; who: string; date: string }[] {
    return this.desk().inbound.filter((item) => !item.processed && (item.triage === 'owner-reply' || item.triage === 'bot-question'))
      .map((item) => ({ id: item.id, who: item.cardId ? item.name : item.from, date: item.date }));
  }

  /** The network sources' mailbox and calendar state (network/methods.ts networkSources); null on the hosted app. */
  reads(): { mailbox: MailboxView | null; calendar: CalendarFeedView | null } {
    if (this.host.hosted()) return { mailbox: null, calendar: null };
    const desk = this.desk();
    return { mailbox: this.mailboxView(desk.mailbox), calendar: this.calendarView(desk.feed) };
  }

  /** venture.outreach.draft: one draft on a card, by Chausar's own template here (the sample has no AI). Nothing is sent. */
  private draft(p: Record<string, unknown>): { draft: OutreachView; line: string } {
    const kind = p.kind as OutreachKind;
    if (kind === 'reminder') throw new EngineError('INVALID_VENTURE_REQUEST', 'A reminder is drafted from its invoice.');
    if (!KINDS.includes(kind)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose what to draft: an intro request, a double opt-in intro, a connection note, a follow-up, a reply or a cold email.');
    const channel = p.channel as OutreachChannel;
    if (!['email', 'linkedin', 'whatsapp'].includes(channel)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose mail, LinkedIn or WhatsApp.');
    if (kind === 'connection-note' && channel !== 'linkedin') throw new EngineError('INVALID_VENTURE_REQUEST', 'A connection note goes on LinkedIn.');
    if (kind === 'cold-email' && channel !== 'email') throw new EngineError('INVALID_VENTURE_REQUEST', 'A cold email goes by email.');
    const basis = (p.basis as LawfulBasis | undefined) ?? null;
    if (basis !== null && !BASES.includes(basis)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose the lawful basis: they wrote first, an existing contact, or a public business contact.');
    const limit = p.limit === undefined ? 200 : p.limit;
    if (p.limit !== undefined && (kind !== 'connection-note' || (limit !== 200 && limit !== 300))) throw new EngineError('INVALID_VENTURE_REQUEST', "A connection note's limit is 200 characters, or 300 with LinkedIn Premium.");
    if ((p.introduce === undefined) !== (kind !== 'double-opt-in')) throw new EngineError('INVALID_VENTURE_REQUEST', kind === 'double-opt-in' ? 'Choose who you are introducing.' : 'Only a double opt-in introduces someone.');
    const card = this.findCard(p.opportunityId);
    if (CLOSED.has(card.state.stage)) throw new EngineError('PIPELINE_STAGE_CLOSED', this.closedLine(card.state));
    if (this.cardBlocked(card)) throw new EngineError('OUTREACH_BLOCKED', BLOCKED_LINE);
    const person = card.lead ? null : this.people.contact(card.view.personId);
    let recipient = person;
    let other: PipelinePerson | null = null;
    if (kind === 'intro-request') {
      const paths = person?.paths ?? [];
      // The first confirmed connector who is not blocked (outreach.ts planDraft); only blocked ones refuse it as blocked.
      const connectors = paths.filter((path) => path.confirmed && path.via && this.people.contact(path.via.id));
      const confirmed = connectors.find((path) => !this.personBlocked(path.via!.id));
      if (!confirmed) {
        if (connectors.length) throw new EngineError('OUTREACH_BLOCKED', blockedLine(connectors[0]!.via!.name));
        const possible = paths.find((path) => !path.confirmed && path.via);
        throw new EngineError('OUTREACH_NO_CONFIRMED_PATH', `No confirmed path to ${card.view.name}. Write to them yourself${possible ? `, or first ask ${possible.via!.name} whether they know each other` : ''}.`);
      }
      recipient = this.people.contact(confirmed.via!.id);
      other = person;
    }
    const name = recipient?.name ?? card.view.name;
    let address: string | null;
    if (channel === 'email') {
      address = card.lead && kind !== 'intro-request' ? card.lead.email : recipient?.emails[0] ?? null;
      if (!address) throw new EngineError('INVALID_VENTURE_REQUEST', `Chausar has no email address for ${name}. Choose WhatsApp or LinkedIn, or add their email.`);
    } else if (channel === 'linkedin') {
      address = recipient?.linkedin ?? null;
      if (!address) throw new EngineError('OUTREACH_NO_PROFILE', `Chausar has no LinkedIn page for ${name}. Import your LinkedIn connections, or write by email.`);
    } else {
      address = recipient?.phone ?? null;
      if (!address) throw new EngineError('OUTREACH_NO_PHONE', `Chausar has no phone number for ${name}. Import your phone's contacts, or write by email.`);
    }
    if (this.isBlocked(address) || (recipient && this.personBlocked(recipient.id))) throw new EngineError('OUTREACH_BLOCKED', blockedLine(name));
    const band = recipient?.band ?? null;
    const wroteFirst = basis === 'they-wrote-first' || card.state.touches.some((touch) => touch.what === 'reply');
    if (kind === 'reply' && !wroteFirst) throw new EngineError('INVALID_VENTURE_REQUEST', `A reply answers someone who wrote to you, and Chausar sees nothing from ${name} yet. Draft a follow-up, or say they wrote first.`);
    if (channel === 'whatsapp' && !(band && WARM.has(band)) && !wroteFirst) throw new EngineError('OUTREACH_WHATSAPP_COLD', WHATSAPP_COLD);
    const cold = channel === 'email' && (kind === 'cold-email' || band === null || !WARM.has(band));
    const desk = this.desk();
    let footer: Draft['footer'] = null;
    if (cold) {
      const kept = basis ?? card.state.basis;
      if (!kept) throw new EngineError('OUTREACH_BASIS_REQUIRED', 'A cold email needs its lawful basis: they wrote first, an existing contact, or a public business contact.');
      const postal = typeof p.postalAddress === 'string' && p.postalAddress.trim() ? p.postalAddress.trim() : desk.postal;
      if (!postal) throw new EngineError('LEADS_ADDRESS_MISSING', 'Add your postal address. Every outreach email carries it.');
      desk.postal = postal;
      footer = { unsubscribe: UNSUBSCRIBE, postalAddress: postal };
      card.state.basis = kept;
    }
    const about = typeof p.about === 'string' && p.about.trim() ? `${p.about.trim().replace(/[.!?]?$/, '.')}` : null;
    const business = this.businessName();
    const first = firstOf(name);
    const lastSent = card.state.touches.filter((touch) => touch.what === 'sent').at(-1)?.on;
    let subject: string | null = channel === 'email' ? `Hello from ${business}` : null;
    let text: string;
    let blurb: string | null = null;
    if (kind === 'intro-request') {
      subject = channel === 'email' ? `An introduction to ${other!.name}?` : null;
      text = `Hi ${first}, I hope you are well. Would you be open to introducing me to ${other!.name}${other!.company ? ` at ${other!.company}` : ''}? ${about ?? `I would like a short conversation with ${firstOf(other!.name)}.`} There is a short note below that you can forward. If now is not a good time, or you would rather not, just say so. That is completely fine.`;
      blurb = `${business} is a small business. Its owner would like a short conversation with ${firstOf(other!.name)}. It would be a short conversation about ${firstOf(other!.name)}'s work. Nothing is being sold in this note. If ${firstOf(other!.name)} would rather not, that is completely fine.`;
    } else if (kind === 'connection-note') {
      text = `Hi ${first}, ${about ?? `I run ${business}.`} It would be good to connect here.`;
    } else if (kind === 'follow-up') {
      if (lastSent) { subject = channel === 'email' ? 'Following up' : null; text = `Hi ${first}, just following up on my note of ${shortDay(lastSent)}. ${about ?? ''}No pressure at all if now is not a good time.`.replace(/ {2,}/g, ' '); }
      else text = `Hi ${first}, I hope you are well. ${about ?? 'I wanted to get in touch.'}`;
    } else if (kind === 'reply') {
      subject = channel === 'email' ? 'Thank you' : null;
      text = `Hi ${first}, thank you for getting back to me. ${about ?? 'I am happy to answer any questions you have.'}`;
    } else if (kind === 'double-opt-in') {
      const introduced = this.people.contact(String(p.introduce));
      if (!introduced || introduced.id === card.view.personId) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose someone else in your network to introduce.');
      if (this.personBlocked(introduced.id)) throw new EngineError('OUTREACH_BLOCKED', blockedLine(introduced.name));
      subject = channel === 'email' ? `An introduction to ${introduced.name}?` : null;
      text = `Hi ${first}, I'd like to introduce you to ${introduced.name}${introduced.company ? ` from ${introduced.company}` : ''}. ${about ?? ''}Would you be open to it? If not, just say so. That is completely fine.`.replace(/ {2,}/g, ' ');
      blurb = `${first}, meet ${firstOf(introduced.name)}. ${firstOf(introduced.name)}, meet ${first}. I will leave you both to take it from here.`;
    } else {
      subject = `A note from ${business}`;
      text = `Hi ${first},\n\nI run ${business}.${card.lead ? ` I found ${card.view.company ?? 'your details'} on ${this.where(card.lead.sourceUrl)}.` : ''} ${about ?? ''}If this is not useful to you, there is no need to reply.`.replace(/ {2,}/g, ' ');
    }
    if (kind === 'connection-note' && [...text].length > (limit as number)) {
      throw new EngineError('OUTREACH_TOO_LONG', `This note is ${[...text].length} characters; your limit is ${limit}. Shorten your words and draft it again.`);
    }
    const lints: Draft['lints'] = [];
    if (kind === 'connection-note') lints.push({ rule: 'note-cap', line: NOTE_CAP_LINE });
    if (!lastSent && /https?:\/\//.test(text)) lints.push({ rule: 'first-touch-link', line: 'A link in a first note can look like spam. Send it once they write back.' });
    const body = footer ? `${text}\n\n--\n${business}, ${footer.postalAddress}\n${footer.unsubscribe}` : text;
    const draft = this.makeDraft({
      cardId: card.view.id, personId: recipient?.id ?? null, kind, channel, toName: name, to: address, subject, text: body, blurb, footer, lints,
      limit: kind === 'connection-note' ? (limit as number) : null, at: this.host.now(), language: p.language === 'hi' ? 'hi' : 'en',
    });
    desk.drafts.push(draft);
    this.keep(card);
    this.refresh(card);
    this.announce();
    return { draft: this.draftView(draft), line: TEMPLATE_LINE };
  }

  private mailto(to: string, subject: string | null, body: string): string {
    const query = [...(subject ? [`subject=${encodeURIComponent(subject)}`] : []), `body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`].join('&');
    return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?${query}`;
  }

  private copyInstead(channel: 'email' | 'whatsapp', to: string, subject: string | null, text: string): OutreachHandoff {
    const where = channel === 'email' ? `Copy the text into a new email to ${to}.` : `Copy the text into a WhatsApp chat with ${to}.`;
    return { action: 'copy', to, subject, text, line: `This is too long to open in ${CHANNEL_APP[channel]} in one link. ${where} ${COUNTED_LINE}` };
  }

  /** venture.outreach.open: one handoff to the owner's own app; nothing is sent or recorded. */
  private open(p: Record<string, unknown>): OutreachHandoff {
    const desk = this.desk();
    const now = this.host.now();
    const draft = desk.drafts.find((item) => item.id === p.draftId);
    if (!draft) {
      for (const lead of this.leads()) {
        const own = lead.drafts.find((item) => item.id === p.draftId);
        if (!own) continue;
        const sent = lead.sends.find((send) => send.draftId === own.id);
        if (sent) throw new EngineError('ALREADY_DECIDED', `You already sent this, on ${longDay(localDay(sent.sentAt))}.`);
        if (lead.status === 'blocked' || this.isBlocked(own.to)) throw new EngineError('OUTREACH_BLOCKED', blockedLine(lead.name));
        this.governed('email', now);
        const url = this.mailto(own.to, own.subject, own.text);
        return url.length > MAX_HANDOFF_URL ? this.copyInstead('email', own.to, own.subject, own.text) : { action: 'mailto', url, line: `Opens your mail app with the text filled in. ${COUNTED_LINE}` };
      }
      throw new EngineError('INVALID_VENTURE_REQUEST', 'This draft is not in this business.');
    }
    if (draft.sent) throw new EngineError('ALREADY_DECIDED', `You already sent this, on ${longDay(localDay(draft.sent.at))}.`);
    const card = this.cards().find((item) => item.view.id === draft.cardId);
    if (card && CLOSED.has(card.state.stage)) throw new EngineError('PIPELINE_STAGE_CLOSED', this.closedLine(card.state));
    if (card && this.cardBlocked(card) && draft.personId === card.view.personId) throw new EngineError('OUTREACH_BLOCKED', blockedLine(draft.toName));
    if (this.isBlocked(draft.to) || (draft.personId && this.personBlocked(draft.personId))) throw new EngineError('OUTREACH_BLOCKED', blockedLine(draft.toName));
    this.governed(draft.channel, now);
    const text = draft.kind === 'intro-request' && draft.blurb ? `${draft.text}\n\nA note you can forward:\n${draft.blurb}` : draft.text;
    if (draft.channel === 'linkedin') {
      const what = draft.kind === 'connection-note' ? 'Copy the note, then open the profile and paste it into Connect.' : 'Copy the message, then open the profile and paste it into Message.';
      return { action: 'linkedin', profileUrl: draft.to, text, line: `${what} ${COUNTED_LINE}` };
    }
    if (draft.channel === 'email') {
      const url = this.mailto(draft.to, draft.subject, text);
      return url.length > MAX_HANDOFF_URL ? this.copyInstead('email', draft.to, draft.subject, text) : { action: 'mailto', url, line: `Opens your mail app with the text filled in. ${COUNTED_LINE}` };
    }
    const url = new URL(`https://wa.me/${draft.to.slice(1)}?text=${encodeURIComponent(text)}`).href;
    return url.length > MAX_HANDOFF_URL ? this.copyInstead('whatsapp', draft.to, null, text) : { action: 'whatsapp', url, line: `Opens WhatsApp with the text filled in. ${COUNTED_LINE}` };
  }

  /** The send governor's pause: a channel the owner said was restricted stays shut until its day (CHANNEL_FROZEN). */
  private governed(channel: OutreachChannel, now: string) {
    const hold = this.desk().holds[channel];
    if (hold && hold.until > now) throw new EngineError('CHANNEL_FROZEN', hold.line);
  }

  /** Records one send on a card: Found moves to Asked and the follow-ups start. */
  private recordSend(card: Card, on: string, channel: OutreachSentChannel | null, kind: OutreachKind | null) {
    card.state.touches.push({ what: 'sent', on, channel, kind });
    if (card.state.stage === 'found') { card.state.stage = 'asked'; card.state.history.push({ to: 'asked', at: this.host.now() }); }
    this.keep(card);
    this.refresh(card);
  }

  private afterSend(card: Card | undefined): string {
    if (!card) return 'Recorded.';
    const plan = this.plan(card.state);
    if (plan?.kind === 'nudge') return `Recorded. Next follow-up ${shortDay(plan.due)}.`;
    if (plan?.kind === 'park') return `Recorded. If there is no reply by ${shortDay(plan.on)}, the card parks as Not now.`;
    return 'Recorded.';
  }

  /** venture.outreach.sent: the owner sent one draft themselves, on its own channel or by phone. */
  private sent(p: Record<string, unknown>) {
    const now = this.host.now();
    if (typeof p.at !== 'string' || !Number.isFinite(Date.parse(p.at))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the time you sent it.');
    const channel = p.channel as OutreachSentChannel;
    if (!['own-mailbox', 'linkedin', 'whatsapp', 'phone'].includes(channel)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Say how you sent it: from your own mailbox, on LinkedIn, on WhatsApp or by phone.');
    const draft = this.desk().drafts.find((item) => item.id === p.draftId);
    if (!draft) {
      const lead = this.leads().find((item) => item.drafts.some((own) => own.id === p.draftId));
      if (!lead) throw new EngineError('INVALID_VENTURE_REQUEST', 'This draft is not in this business.');
      if (channel !== 'own-mailbox') throw new EngineError('INVALID_VENTURE_REQUEST', "A lead's email goes from your own mailbox.");
      this.host.ask('venture.leads.recordSend', { leadId: lead.id, draftId: p.draftId, sentAt: p.at });
      const card = this.cards().find((item) => item.view.id === lead.id);
      this.announce();
      const own = lead.drafts.find((item) => item.id === p.draftId)!;
      return {
        draft: { id: own.id, opportunityId: lead.id, kind: 'cold-email', channel: 'email', to: `${lead.name}, ${own.to}`, subject: own.subject, text: own.text, blurb: null, footer: { unsubscribe: own.footer.unsubscribe, postalAddress: own.footer.postalAddress }, lints: [], counter: null, sent: { at: new Date(Date.parse(p.at)).toISOString(), channel }, digest: own.digest, author: 'owner', language: 'en', accepted: null, line: this.sendLine('email') } satisfies OutreachView,
        card: card ? structuredClone(card.view) : null, line: this.afterSend(card),
      };
    }
    if (draft.sent) throw new EngineError('ALREADY_DECIDED', `You already sent this, on ${longDay(localDay(draft.sent.at))}.`);
    if (channel !== SENT_OF[draft.channel] && channel !== 'phone') throw new EngineError('INVALID_VENTURE_REQUEST', `${SENT_WORDS[draft.channel]} Mark it sent from there, or by phone if you called instead.`);
    const sentAt = Date.parse(p.at);
    if (sentAt < Date.parse(draft.at) || sentAt > Date.parse(now)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The send time must be after the draft and not in the future.');
    draft.sent = { at: new Date(sentAt).toISOString(), channel };
    const card = this.cards().find((item) => item.view.id === draft.cardId);
    if (card) this.recordSend(card, localDay(draft.sent.at), channel, draft.kind);
    this.announce();
    return { draft: this.draftView(draft), card: card ? structuredClone(card.view) : null, line: this.afterSend(card) };
  }

  private restricted(p: Record<string, unknown>) {
    const channel = p.channel as OutreachChannel;
    if (!['email', 'linkedin', 'whatsapp'].includes(channel)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose mail, LinkedIn or WhatsApp.');
    const until = new Date(Date.parse(this.host.now()) + 72 * 3_600_000).toISOString();
    const line = `You said ${WHO_RESTRICTED[channel]} restricted your account. Don't reconnect for 3 days. Chausar opens ${CHANNEL_APP[channel]} again on ${longDay(localDay(until))}.`;
    this.desk().holds[channel] = { until, line };
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    return { channel, until, line };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The mailbox, the calendar address and "after a call" (desktop only)
  // -------------------------------------------------------------------------------------------------------------------

  private mailboxView(box: Mailbox | null): MailboxView {
    if (!box || box.status === 'disconnected') return { connected: false, host: box?.host ?? null, user: box?.user ?? null, lastSync: box?.lastSync ?? null, line: 'Not connected. Chausar reads no mail.', needsPassword: false };
    if (!box.password) return { connected: true, host: box.host, user: box.user, lastSync: box.lastSync, line: 'Chausar keeps your app password only while the app is open. Type it again under Connections to read new mail.', needsPassword: true };
    const when = box.lastSync ? `Last read ${longDay(localDay(box.lastSync))} at ${localTime(box.lastSync)}.` : 'Not read yet.';
    return { connected: true, host: box.host, user: box.user, lastSync: box.lastSync, line: `Reading ${box.user} on ${box.host}, read-only. ${when} Chausar never sends mail or marks it read.`, needsPassword: false };
  }

  private connect(p: Record<string, unknown>): MailboxView {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED_MAILBOX);
    const host = typeof p.host === 'string' ? p.host.trim().toLowerCase() : '';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Type the mail server\'s name, like imap.gmail.com, with no https:// or slashes.');
    const port = Number(p.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new EngineError('INVALID_VENTURE_REQUEST', 'The port must be a whole number from 1 to 65535.');
    const user = typeof p.user === 'string' ? p.user.trim() : '';
    if (user.length < 3) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your mail address must be one line of 3 to 254 characters.');
    const password = p.appPassword;
    if (typeof password !== 'string' || password.length < 1 || password.length > 256 || /[\r\n]/.test(password)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Type the app password your mail account gave you, on one line.');
    // Microsoft's servers ask for their own sign-in; the sample says so the way the engine reads the server's answer.
    if (/outlook|office365|hotmail|live\.com/.test(host)) throw new EngineError('MAILBOX_OAUTH_ONLY', OAUTH_ONLY);
    if (password === 'wrong') throw new EngineError('MAILBOX_LOGIN_FAILED', LOGIN_FAILED);
    const desk = this.desk();
    const same = desk.mailbox && desk.mailbox.host === host && desk.mailbox.user.toLowerCase() === user.toLowerCase();
    desk.mailbox = { host, port, user, status: 'connected', lastSync: same ? desk.mailbox!.lastSync : null, password: true, synced: same ? desk.mailbox!.synced : 0 };
    return this.mailboxView(desk.mailbox);
  }

  private disconnect(): MailboxView {
    const desk = this.desk();
    if (!desk.mailbox) return this.mailboxView(null);
    desk.mailbox = { ...desk.mailbox, status: 'disconnected', password: false };
    return { ...this.mailboxView(desk.mailbox), line: 'Disconnected. Mail Chausar already read stays with your pipeline; nothing more is read.' };
  }

  private sync() {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED_MAILBOX);
    const desk = this.desk();
    const box = desk.mailbox;
    if (!box || box.status !== 'connected') throw new EngineError('MAILBOX_NOT_CONNECTED', NOT_CONNECTED);
    if (!box.password) throw new EngineError('MAILBOX_NOT_CONNECTED', 'Chausar keeps your app password only while the app is open. Type it again under Connections to read new mail.');
    const now = this.host.now();
    const added = this.host.current() !== 'lumen' ? [] : box.synced === 0 ? this.sampleMail(now) : box.synced === 1 ? this.secondMail(now) : [];
    desk.inbound.push(...added);
    // The address an opt-out came from, and an address that bounced, are blocked at once (inbound.ts applyOptOut).
    for (const item of added) {
      if (item.triage === 'opt-out') this.block(item.from);
      if (item.bounced) this.block(item.bounced);
    }
    box.synced += 1;
    box.lastSync = now;
    const needs = added.filter((item) => !item.processed).length;
    const line = added.length ? `${plural(added.length, 'new message', 'new messages')} from people you know: ${needs} ${needs === 1 ? 'needs' : 'need'} you on Today.` : 'No new mail from people in your network or pipeline.';
    if (needs) this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: now });
    return { mailbox: this.mailboxView(box), added: added.length, line };
  }

  private inboundView(item: Inbound): InboundView {
    const card = item.cardId ? this.people.liveCards().find((view) => view.id === item.cardId) : undefined;
    return { id: item.id, from: item.from, date: item.date, subject: item.subject, triage: item.triage, matched: card ? { opportunityId: card.id, name: card.name } : null, line: item.line };
  }

  private confirm(p: Record<string, unknown>) {
    const item = this.desk().inbound.find((one) => one.id === p.id);
    if (!item) throw new EngineError('INVALID_VENTURE_REQUEST', 'This message is not in this business.');
    this.findCard(p.opportunityId);
    item.cardId = String(p.opportunityId);
    item.triage = 'talking';
    item.candidate = null;
    return { item: this.inboundView(item) };
  }

  private calendarView(feed: Feed | null): CalendarFeedView {
    if (!feed) return { set: false, host: null, lastRead: null, line: CALENDAR_REMOVED, nextRead: null };
    // The next morning read: six on the owner's clock, the day after the last read (calendar-feed.ts nextMorningRead).
    const now = this.host.now();
    const today = localDay(now);
    const day = localDay(feed.lastRead) >= today ? addDays(today, 1) : today;
    const at = new Date(Date.parse(`${day}T06:00:00.000Z`) - IST_MS).toISOString();
    return { set: true, host: feed.host, lastRead: feed.lastRead, line: feed.line, nextRead: at < now ? now : at };
  }

  private calendar(p: Record<string, unknown>): CalendarFeedView {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED_CALENDAR);
    const desk = this.desk();
    if (p.url === '') {
      desk.feed = null;
      this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
      return this.calendarView(null);
    }
    const raw = typeof p.url === 'string' ? p.url.trim().replace(/^webcals?:\/\//i, 'https://') : '';
    if (!raw) throw new EngineError('INVALID_VENTURE_REQUEST', CALENDAR_HTTPS);
    let url: URL;
    try { url = new URL(raw); } catch { throw new EngineError('NET_URL_REFUSED', CALENDAR_HTTPS); }
    if (url.protocol !== 'https:') throw new EngineError('NET_URL_REFUSED', CALENDAR_HTTPS);
    const now = this.host.now();
    // The sample calendar holds one call with Kabir Sethi that ended two hours ago.
    const events: CallEvent[] = this.host.current() === 'lumen' && this.people.contact('person_kabir')
      ? [{ id: 'calevent_kabir', endAt: new Date(Date.parse(now) - 2 * 3_600_000).toISOString(), personIds: ['person_kabir'], notesAt: null, declined: false }] : [];
    desk.feed = { host: url.hostname, lastRead: now, line: `Read just now: ${events.length ? plural(events.length, 'call', 'calls') : 'no calls'} with people you know lately or today.`, events };
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: now });
    return this.calendarView(desk.feed);
  }

  /**
   * venture.meeting.digest: the people the notes name, and each written next step and promised intro as a drafted
   * proposal. The sample reads notes with a small table (a line that says introduce or connect is an intro; a line that
   * starts with send, call, share, follow up or meet is a step), never a model; a day is kept only when the notes write it.
   */
  private digest(p: Record<string, unknown>) {
    const notes = typeof p.notes === 'string' ? p.notes.trim() : '';
    if (notes.length < 1 || notes.length > 20_000) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your notes must be 1 to 20,000 characters.');
    if (/\b(sk-[A-Za-z0-9]{8,}|\d{4}\s?\d{4}\s?\d{4})\b/.test(notes)) throw new EngineError('CHAT_KEY_REFUSED', 'That looks like a key or an id number. Notes never carry those, so nothing was read.');
    const desk = this.desk();
    const eventId = typeof p.eventId === 'string' ? p.eventId : null;
    const event = eventId ? desk.feed?.events.find((item) => item.id === eventId) : undefined;
    if (eventId && !event) throw new EngineError('INVALID_VENTURE_REQUEST', 'That call is not one Chausar has from your calendar.');
    if (event) event.notesAt = this.host.now();
    const contacts = this.people.allContacts();
    const people = contacts.filter((person) => notes.toLowerCase().includes(firstOf(person.name).toLowerCase())).map((person) => ({ name: person.name, personId: person.id }));
    for (const id of event?.personIds ?? []) {
      const person = this.people.contact(id);
      if (person && !people.some((item) => item.personId === id)) people.unshift({ name: person.name, personId: id });
    }
    const year = this.today().slice(0, 4);
    const months: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const lines = notes.split(/\n|(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
    const proposals: ProposalView[] = [];
    const steps: { text: string; person: string | null; due: string | null; proposalId: string | null; line: string }[] = [];
    const cards = this.people.liveCards();
    for (const line of lines) {
      const intro = /\b(introduce|connect you with|intro)\b/i.test(line);
      const step = /^(send|call|share|follow up|meet|email|write)\b/i.test(line);
      if (!intro && !step) continue;
      const who = people.find((person) => line.toLowerCase().includes(firstOf(person.name).toLowerCase())) ?? people[0] ?? null;
      const card = who ? cards.find((item) => item.personId === who.personId && !CLOSED.has(item.stage)) : undefined;
      const written = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(line);
      const due = written ? `${year}-${months[written[2]!.toLowerCase()]}-${written[1]!.padStart(2, '0')}` : null;
      const name = who?.name ?? 'This person';
      const missing = `${name} has no open card in your pipeline. Add them first, then raise this.`;
      const text = line.replace(/[.!?]$/, '');
      const proposal = this.meetings.draftFromMeeting(intro
        ? { kind: 'outreach-draft', title: `Draft a note to ${firstOf(name)} about the intro`, line: card ? `From your notes after the call: "${line.slice(0, 160)}"` : missing, needsDay: false }
        : {
          kind: 'next-step', title: `Next step for ${name}: ${text}`.slice(0, 160),
          line: !card ? missing : due ? `Due ${longDay(due)}, as your notes say. Approve it on Today to put it on ${firstOf(name)}'s card.` : `No day in your notes: give the day when you approve it on Today, and it goes on ${firstOf(name)}'s card.`,
          needsDay: !!card && !due,
        });
      proposals.push(proposal);
      steps.push({ text, person: card?.name ?? who?.name ?? null, due, proposalId: proposal.id, line: !card ? missing : !intro && !due ? MEETING_NO_DATE : MEETING_DRAFTED });
    }
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    const line = proposals.length ? `Drafted ${plural(proposals.length, 'proposal', 'proposals')} from your notes. Raise each to Today to approve it.` : 'Nothing to draft from your notes.';
    return { people, proposals, steps, line };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Today's rows
  // -------------------------------------------------------------------------------------------------------------------

  /** Today's follow-up and reply rows and "Add notes" notices, as the engine lists them now (followup-rows.ts, inbound-rows.ts). */
  syncRows(): void {
    if (!this.host.current()) return;
    const mine = (row: QueueRow) => row.id.startsWith('followup:') || row.id.startsWith('reply:') || row.id.startsWith('meeting:');
    const rows = this.rowsNow().map((row) => ({ ...row, digest: this.host.digest(row) }) as QueueRow);
    const kept = this.host.rows().filter((row) => !mine(row) || row.businessId !== this.host.current());
    this.host.setRows([...kept, ...rows]);
  }

  private rowsNow(): Omit<QueueRow, 'digest'>[] {
    const desk = this.desk();
    const today = this.today();
    const business = { businessId: this.host.current(), businessName: this.businessName() };
    const action = (id: QueueAction['id'], label: string, primary: boolean): QueueAction => ({ id, label, primary });
    const rows: Omit<QueueRow, 'digest'>[] = [];
    for (const { card, view, daysLate } of this.schedule().due) {
      const id = `followup:${card.view.id}:${view.due}`;
      if (desk.followupsDone.has(id)) continue;
      const lateness = daysLate === 0 ? 'due today' : lateWords(view.due, today)!;
      const draft = view.draftId ? desk.drafts.find((item) => item.id === view.draftId) ?? null : null;
      rows.push({
        ...business, id, kind: 'followup', createdAt: `${view.due}T00:00:00.000Z`, title: `Follow up with ${card.view.name}`,
        line: `${card.view.name}${card.view.company ? `, ${card.view.company}` : ''}: follow-up is ${lateness}. ${view.draftId ? `Nudge drafted for ${CHANNEL_WORDS[view.channel ?? 'email']}.` : 'No nudge drafted yet.'}`,
        actions: [action('sent', 'I sent it', false), action('open', view.draftId && view.channel ? OPEN_LABEL[view.channel] : 'Open the card', true)],
        followup: { cardId: card.view.id, name: card.view.name, company: card.view.company, due: view.due, daysLate, channel: draft?.channel ?? view.channel, draftId: view.draftId },
      });
    }
    for (const item of desk.inbound) {
      if (item.processed) continue;
      const on = longDay(localDay(item.date));
      const card = item.cardId ? this.people.liveCards().find((view) => view.id === item.cardId) : undefined;
      const parts = (reason: NonNullable<QueueRow['reply']>['reason'], opportunityId: string | null) => ({
        inboundId: item.id, reason, name: item.name, company: item.company, opportunityId, eventId: null, topics: item.topics, from: item.from, subject: item.subject,
        draft: reason === 'bot-question' ? BOT_ANSWER : null,
      });
      if (item.triage === 'opt-out') {
        const pending = item.optOut ?? { close: [], block: [] };
        const close = pending.close.filter((id) => { const open = this.people.liveCards().find((view) => view.id === id); return !!open && !CLOSED.has(open.stage); });
        const block = pending.block;
        if (!close.length && !block.length) continue;
        const closeWords = close.length === 1 ? 'the card' : `their ${close.length} cards`;
        const title = block.length
          ? `${firstOf(item.name)} asked not to be contacted. Block ${block.join(' and ')}${close.length ? ` and close ${closeWords} too` : ' too'}?`
          : `${firstOf(item.name)} asked not to be contacted. Close ${closeWords} as Lost?`;
        rows.push({
          ...business, id: `reply:${item.id}:optout.${close.join('.')}.${block.length}`, kind: 'reply', createdAt: item.date, title, line: `${item.line} Mail of ${on}.`,
          actions: [action('approve', block.length ? (close.length ? 'Block and close' : 'Block them too') : 'Close as Lost', true), action('deny', block.length ? 'Not now' : 'Keep the card', false)],
          reply: parts('opt-out', close[0] ?? null),
        });
        continue;
      }
      if (item.triage === 'bounce') {
        if (!item.domainAsk) continue;
        const address = item.bounced ?? item.domainAsk;
        const warning = FREE_MAIL.has(item.domainAsk) ? `${item.domainAsk} is a free mail service many people use. Blocking it blocks all of them.` : `No one else in your network uses ${item.domainAsk}.`;
        rows.push({
          ...business, id: `reply:${item.id}:domain.${item.domainAsk}`, kind: 'reply', createdAt: item.date, title: `${item.domainAsk} takes no mail. Block the whole domain?`,
          line: `Mail to ${address} could not be delivered on ${on}, and ${address} is blocked. ${warning}`,
          actions: [action('approve', 'Block the domain', true), action('deny', 'Only the address', false)],
          reply: { ...parts('bounce-domain', null), name: address, company: null, from: null, subject: null },
        });
        continue;
      }
      if (item.triage === 'unmatched' && item.candidate) {
        const candidate = this.people.liveCards().find((view) => view.id === item.candidate);
        if (!candidate) continue;
        rows.push({
          ...business, id: `reply:${item.id}:confirm.${candidate.id}.1`, kind: 'reply', createdAt: item.date, title: `Is this from ${firstOf(item.name)}${candidate.company ? ` about ${candidate.company}` : ''}?`,
          line: `Mail from ${item.from} on ${on}. Chausar was not sure enough to attach it to a card, so it asks you.`,
          actions: [action('approve', 'Yes, it is', true), action('deny', 'No', false)], reply: parts('confirm', candidate.id),
        });
      } else if (item.triage === 'owner-reply' || item.triage === 'bot-question') {
        const before = !!card && RANK[card.stage] < RANK.talking && !CLOSED.has(card.stage);
        rows.push({
          ...business, id: `reply:${item.id}:${item.triage}.${card?.id ?? 'none'}.${card?.stage ?? 'none'}`, kind: 'reply', createdAt: item.date,
          title: item.triage === 'owner-reply' ? `${firstOf(item.name)} asked about pricing. Reply yourself.` : `${firstOf(item.name)} asked if you are a bot. A reply is drafted.`,
          line: item.triage === 'owner-reply' ? `Mail from ${item.from} on ${on}. Chausar leaves this one to you.` : `Drafted reply: "${BOT_ANSWER}" Send it yourself from your own mail.`,
          actions: [action('open', 'Reply in Mail', true), before ? action('approve', 'Move to Talking', false) : action('deny', 'Done', false)], reply: parts(item.triage, card?.id ?? null),
        });
      } else if (item.triage === 'talking' && card && RANK[card.stage] < RANK.talking && !CLOSED.has(card.stage)) {
        rows.push({
          ...business, id: `reply:${item.id}:talking.${card.id}.${card.stage}`, kind: 'reply', createdAt: item.date, title: `${firstOf(item.name)} wrote back. Move the card to Talking?`,
          line: `Mail from ${item.from} on ${on}, matched to ${card.name}${card.company ? ` (${card.company})` : ''}. Nothing moves until you say so.`,
          actions: [action('approve', 'Move to Talking', true), action('deny', 'Not now', false)], reply: parts('talking', card.id),
        });
      }
    }
    const nowMs = Date.parse(this.host.now());
    for (const event of desk.feed?.events ?? []) {
      const end = Date.parse(event.endAt);
      if (event.notesAt || event.declined || end > nowMs || nowMs - end > NOTES_WINDOW_MS) continue;
      const names = event.personIds.map((id) => this.people.contact(id)?.name).filter((name): name is string => !!name);
      if (!names.length) continue;
      const who = names.length === 1 ? firstOf(names[0]!) : names.length === 2 ? `${firstOf(names[0]!)} and ${firstOf(names[1]!)}` : `${firstOf(names[0]!)} and ${names.length - 1} others`;
      rows.push({
        ...business, id: `meeting:${event.id}:${event.endAt.replace(/[^0-9]/g, '')}`, kind: 'notice', createdAt: event.endAt, title: `Add notes from your call with ${who}?`,
        line: `The call ended at ${localTime(event.endAt)}. Paste your notes, and Chausar drafts the next steps for you to approve.`,
        actions: [action('open', 'Add notes', true), action('deny', 'No notes', false)],
        reply: { inboundId: null, reason: 'meeting-notes', name: names[0]!, company: null, opportunityId: null, eventId: event.id, topics: [], from: null, subject: null, draft: null },
      });
    }
    return rows;
  }

  /** A decision on one of this desk's Today rows, in the engine's words; null for any other row. */
  decide(row: QueueRow, action: QueueAction['id']): string | null {
    const desk = this.desk();
    if (row.id.startsWith('followup:')) {
      if (action !== 'sent') throw new EngineError('INVALID_VENTURE_REQUEST', 'A follow-up offers Open and I sent it.');
      const card = this.cards().find((item) => item.view.id === row.followup?.cardId);
      if (!card) return 'This follow-up is no longer due.';
      const draft = row.followup?.draftId ? desk.drafts.find((item) => item.id === row.followup!.draftId) : undefined;
      const channel: OutreachSentChannel | null = draft ? SENT_OF[draft.channel] : row.followup?.channel ? SENT_OF[row.followup.channel] : null;
      if (draft) draft.sent = { at: this.host.now(), channel: channel! };
      desk.followupsDone.add(row.id);
      this.recordSend(card, this.today(), channel, 'follow-up');
      return this.afterSend(card);
    }
    if (row.id.startsWith('meeting:')) {
      const event = desk.feed?.events.find((item) => item.id === row.reply?.eventId);
      if (event) event.declined = true;
      return 'No notes for this call. Chausar will not ask again.';
    }
    if (!row.id.startsWith('reply:')) return null;
    const item = desk.inbound.find((one) => one.id === row.reply?.inboundId);
    if (!item) return 'This was resolved elsewhere.';
    item.processed = true;
    const reason = row.reply?.reason;
    if (reason === 'opt-out' || reason === 'bounce-domain') {
      if (action === 'deny') return reason === 'bounce-domain' ? 'Only the address stays blocked. The domain is not.' : 'Nothing more was blocked or closed. The address it came from stays blocked.';
      if (reason === 'bounce-domain') { const domain = item.domainAsk; item.domainAsk = null; if (domain) this.block(domain); return `Blocked ${domain}.`; }
      const pending = item.optOut ?? { close: [], block: [] };
      for (const value of pending.block) this.block(value);
      let closed = 0;
      for (const id of pending.close) {
        const open = this.cards().find((one) => one.view.id === id);
        if (!open || CLOSED.has(open.state.stage)) continue;
        open.state.stage = 'lost'; open.state.lostReason = 'opted-out'; open.state.history.push({ to: 'lost', at: this.host.now() });
        this.keep(open); this.refresh(open); closed += 1;
      }
      item.optOut = { close: [], block: [] };
      const done = [pending.block.length ? `blocked ${pending.block.join(' and ')}` : '', closed ? `closed ${closed === 1 ? 'the card' : `${closed} cards`} as Lost` : ''].filter(Boolean).join(' and ');
      this.host.emit({ type: 'pipeline.changed', businessId: this.host.current(), at: this.host.now() });
      return done ? `${done[0]!.toUpperCase()}${done.slice(1)}.` : 'Nothing more to do: that was done already.';
    }
    if (reason === 'confirm') {
      if (action === 'deny') return 'Kept apart from your cards. Nothing moved.';
      item.cardId = row.reply!.opportunityId;
      const card = this.cards().find((one) => one.view.id === item.cardId);
      return `Attached to ${card?.view.name ?? item.name}'s card.`;
    }
    if (action === 'deny') return 'Done. The card stays where it is.';
    const card = this.cards().find((one) => one.view.id === item.cardId);
    if (!card) return 'Done. The card stays where it is.';
    card.state.touches.push({ what: 'reply', on: localDay(item.date), channel: null, kind: null });
    card.state.stage = 'talking';
    card.state.history.push({ to: 'talking', at: this.host.now() });
    this.keep(card);
    this.refresh(card);
    this.host.emit({ type: 'pipeline.changed', businessId: this.host.current(), at: this.host.now() });
    return `Moved ${card.view.name} to Talking: they wrote back on ${longDay(localDay(item.date))}.`;
  }
}

