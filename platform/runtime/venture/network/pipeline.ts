// Chausar venture launcher, network (Ink v2 wave 4, package 4E1): the pipeline's rules (Happenstance's "half they leave
// out", catalogue C6, C7, C13). A card runs Found, Asked, Talking, Proposal, Won, Lost, Not now and only moves forward:
// won, lost and not-now are terminal, and asking again (after a Lost or Not now card's 30 days) makes a new card linked
// to the old one, whose history stays. Each move rests on its evidence (a recorded send, their reply, a quote or a
// note, a client, a reason); Won links a client already here (by email, then name) or makes one in the same
// transaction; a person on the blocklist is refused. Every card names what made it, and may carry per-factor votes.
//
// Existing leads map in without being copied: a lead with no card here reads as one (customers/leads.ts
// leadToOpportunity), or joins the card of the network person with its email. Its card is stored when its first send
// is recorded or the owner first moves it, with its lead and the lead's mapped history; the lead follows the card's
// moves where the lead has a stage for them, and the lead's own later moves and sends reach the card when read.
// Follow-ups come from the card's copied sequence and its touches (followups.ts); an unanswered card parks as Not now
// on its day (from the touches up to then), worked out when read and kept on the next write. Chausar never sends:
// a send is the owner's own record ("I sent it"), and recordCardSend is the one way a send reaches a card (4E2's
// venture.outreach.sent calls it too).
import { check, type State } from '../../contracts.ts';
import { LOST_REASONS } from '../contracts.ts';
import type {
  CardTouch, CardVote, ClientRecord, FollowupSequence, IsoDate, IsoTime, LeadRecord, LostReason, OpportunityRecord, OpportunityTrigger, OutreachChannel,
  OutreachKind, OutreachSentChannel, PersonRecord, PipelineEvidenceInput, PipelineSettingsRecord, PipelineStage, StageMove, VentureRecord,
} from '../contracts.ts';
import { activateTerm, formatVentureDate, listRecords, type VentureTx } from '../records.ts';
import { localDayAt, localTimeAt } from '../local-day.ts';
import { isBlocked, leadToOpportunity, leadWhere, moveLead, onBlocklist, personOnBlocklist, type Blocklist, type Lead } from '../customers/leads.ts';
import { receiptFigure } from '../money/quote.ts';
import { recordOwnerFields } from '../evidence/ledger.ts';
import { ASK_AGAIN_DAYS, DEFAULT_PIPELINE_SETTINGS, addDays, followupPlan, sequenceFor, settledPark, shortDay } from './followups.ts';
import { KIND_LABEL } from './people.ts';
import { listPeople } from './store.ts';
import { count, fold } from './text.ts';
import { followupHolds } from './bounces.ts';

/** Forward order; the three terminal stages share the last rank. */
export const STAGE_RANK: Readonly<Record<PipelineStage, number>> = Object.freeze({ found: 0, asked: 1, talking: 2, proposal: 3, won: 4, lost: 4, 'not-now': 4 });
export const CLOSED_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>(['won', 'lost', 'not-now']);
export const STAGE_LABEL: Readonly<Record<PipelineStage, string>> = Object.freeze({
  found: 'Found', asked: 'Asked', talking: 'Talking', proposal: 'Proposal', won: 'Won', lost: 'Lost', 'not-now': 'Not now',
});
/** The reasons the owner picks for Lost. "Opted out" comes only from the person's own words (4E3). */
export const OWNER_LOST_REASONS: readonly LostReason[] = LOST_REASONS.filter(reason => reason !== 'opted-out');
export const REASON_WORDS: Readonly<Record<LostReason, string>> = Object.freeze({
  'no-budget': 'no budget', 'no-reply': 'no reply', 'chose-someone-else': 'they chose someone else', 'not-a-fit': 'not a fit', timing: 'the timing',
  other: 'another reason', 'opted-out': 'they asked not to be contacted',
});
export const BLOCKED_LINE = 'This person asked not to be contacted, or is on your blocklist.';
const NO_SOURCE = 'No source, no lead. Say where this person came from.';
/** Inbound mail that counts as their reply: not an auto-reply, a bounce, mail nobody matched, or a one-word thanks (4E3). */
const NOT_A_REPLY: ReadonlySet<string> = new Set(['auto-reply', 'bounce', 'unmatched', 'thanks']);

/** A card as the board and the rules read it: a stored card with its lead's later news, or a lead with no card yet. */
export type Card = {
  id: string;
  /** The id Today's follow-up rows know the card by: its lead's for a card that began as a lead, so a row survives the card being stored. */
  key: string;
  stored: OpportunityRecord | null;
  lead: LeadRecord | null;
  person: PersonRecord | null;
  personId: string;
  createdAt: IsoTime;
  stage: PipelineStage;
  history: StageMove[];
  touches: CardTouch[];
  sequence: FollowupSequence | null;
  next: { text: string; due: IsoDate } | null;
  trigger: OpportunityTrigger;
  blocked: boolean;
  clientId: string | null;
  lostReason: LostReason | null;
  askAgainFrom: IsoDate | null;
  linkedFrom: string | null;
  leadId: string | null;
  votes: CardVote[];
  /** The newest send to the same person on another of their cards. */
  lastToPerson: IsoDate | null;
  /** 4E3: no follow-up before this day: a week after an automatic reply, or the end of a delivery delay on their address. */
  holdUntil?: IsoDate | null;
  name: string;
  company: string | null;
  emails: string[];
};

/** The owner's pipeline settings, or the defaults before they change any. */
export function pipelineSettings(state: State, ventureId: string): Pick<PipelineSettingsRecord, 'weekdays' | 'sendTime' | 'caps' | 'scoreRules'> {
  const record = listRecords(state, 'venture-pipeline-settings', ventureId)[0];
  return record ?? structuredClone(DEFAULT_PIPELINE_SETTINGS) as Pick<PipelineSettingsRecord, 'weekdays' | 'sendTime' | 'caps' | 'scoreRules'>;
}

/** The business's blocklist, as the lead rules keep it. */
export function blocklistOf(state: State, ventureId: string): Blocklist {
  const settings = listRecords(state, 'venture-lead-settings', ventureId)[0];
  return { emails: new Set(settings?.blockedEmails ?? []), domains: new Set(settings?.blockedDomains ?? []), handles: new Set(settings?.blockedHandles ?? []) }; // handles: 4E2
}

const asLead = (record: LeadRecord): Lead => ({ ...record, moves: record.moves ?? [], id: record.id }) as Lead;

/** Sends as touches, in day order: the first is the first note, the rest follow-ups. */
function ordered(touches: CardTouch[]): CardTouch[] {
  const sorted = [...touches].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let first = true;
  return sorted.map(touch => {
    if (touch.what !== 'sent') return touch;
    const kind = first ? 'first' as const : 'nudge' as const;
    first = false;
    return touch.kind === kind ? touch : { ...touch, kind };
  });
}

type ReadContext = {
  venture: VentureRecord; asOf: IsoDate; settings: ReturnType<typeof pipelineSettings>; blocklist: Blocklist;
  inbound: ReadonlyMap<string, { id: string; on: IsoDate; at: IsoTime }[]>;
  holds?: ReturnType<typeof followupHolds>;
};

/** The instant a day starts where the business is: 20 Oct in India is 19 Oct 18:30 UTC. */
export function localMidnight(day: IsoDate, venture: Pick<VentureRecord, 'country'>): IsoTime {
  const guess = Date.parse(`${day}T00:00:00.000Z`);
  const offset = localTimeAt(new Date(guess), venture.country).slice(-6);
  const minutes = (offset.startsWith('-') ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return new Date(guess - minutes * 60_000).toISOString();
}

/** The plan input of a card: its stage, sequence, touches, block and the newest send to the same person on another card. */
export const planInput = (card: Pick<Card, 'stage' | 'sequence' | 'touches' | 'blocked' | 'lastToPerson' | 'holdUntil'>) =>
  ({ stage: card.stage, sequence: card.sequence, touches: card.touches, blocked: card.blocked, lastToPerson: card.lastToPerson, holdUntil: card.holdUntil ?? null });
/** What a card's sequence says comes next (followups.ts), reading the person's other cards too. */
export const planOf = (card: Pick<Card, 'stage' | 'sequence' | 'touches' | 'blocked' | 'lastToPerson' | 'holdUntil'>) => followupPlan(planInput(card));

/** One card before the park: the stored fields, then its lead's later news, its matched replies and the blocklist. */
function effective(stored: OpportunityRecord | null, lead: LeadRecord | null, person: PersonRecord | null, read: ReadContext): Card {
  const { venture } = read;
  const mapped = lead ? leadToOpportunity(asLead(lead)) : null;
  const leadTouches = (mapped?.sends ?? []).map((send): CardTouch => ({
    what: 'sent', on: localDayAt(send.sentAt, venture.country), at: send.recordedAt, kind: null, channel: send.channel, ref: send.draftId, by: send.recordedBy,
  }));
  let stage: PipelineStage, history: StageMove[], touches: CardTouch[];
  if (stored) {
    stage = stored.stage;
    history = [...stored.history];
    touches = [...(stored.touches ?? [])];
    // The lead's own later moves (its methods still work) reach the card when they move it forward.
    for (const move of mapped?.history ?? []) {
      if (move.from === null || history.some(item => item.to === move.to && item.at === move.at)) continue;
      if (CLOSED_STAGES.has(stage) || STAGE_RANK[move.to] <= STAGE_RANK[stage]) continue;
      history.push({ ...move, from: stage });
      stage = move.to;
    }
    for (const touch of leadTouches) if (!touches.some(item => item.what === 'sent' && item.ref === touch.ref)) touches.push(touch);
  } else {
    stage = mapped!.stage;
    history = mapped!.history;
    touches = leadTouches;
  }
  const id = stored?.id ?? lead!.id;
  const leadId = stored?.leadId ?? lead?.id ?? null;
  // Replies 4E3 matched to the card, by its own id or (before it was stored) its lead's.
  for (const reply of [...(read.inbound.get(id) ?? []), ...(leadId && leadId !== id ? read.inbound.get(leadId) ?? [] : [])]) {
    if (!touches.some(item => item.what === 'reply' && item.ref === reply.id)) touches.push({ what: 'reply', on: reply.on, at: reply.at, kind: null, channel: null, ref: reply.id, by: 'mail' });
  }
  touches = ordered(touches);
  const firstSend = touches.find(touch => touch.what === 'sent');
  const sequence = stored?.sequence ?? (firstSend ? sequenceFor(null, firstSend.channel, read.settings, firstSend.at) : null);
  const emails = [...new Set([...(person?.handles.emails ?? []), ...(lead?.email ? [lead.email.toLowerCase()] : [])])];
  const blocked = (lead ? lead.status === 'blocked' || onBlocklist(lead, read.blocklist) : false) || emails.some(email => isBlocked(read.blocklist, email))
    || (!!person && personOnBlocklist(read.blocklist, person.handles)); // 4E2: a phone or LinkedIn page on the blocklist too
  const beganAsLead = !!leadId && (!stored || (stored.trigger.kind === 'lead' && stored.trigger.ref === stored.leadId));
  // 4E3: the latest hold an automatic reply (by the card's own id or its lead's) or a delivery delay on its address puts on it.
  const holds = [read.holds?.byCard.get(id), leadId ? read.holds?.byCard.get(leadId) : undefined, ...emails.map(email => read.holds?.byAddress.get(email))]
    .filter((day): day is IsoDate => !!day).sort();
  return {
    id, key: beganAsLead ? leadId! : id, stored, lead, person, personId: stored?.personId ?? person?.id ?? lead!.id, createdAt: stored?.at ?? lead!.addedAt, stage, history,
    touches, sequence, next: stored?.next ?? null,
    trigger: stored?.trigger ?? { kind: 'lead', ref: lead!.id, line: `Found on ${leadWhere(lead!.sourceUrl)}` },
    blocked, clientId: stored?.clientId ?? null, lostReason: stored?.lostReason ?? null, askAgainFrom: stored?.askAgainFrom ?? null,
    linkedFrom: stored?.linkedFrom ?? null, leadId, votes: stored?.votes ?? [], lastToPerson: null, holdUntil: holds.at(-1) ?? null,
    name: person?.name ?? lead?.name ?? 'Someone', company: person?.role?.company ?? lead?.company ?? null, emails,
  };
}

/** A card that has waited past its park day without a reply parks as Not now, as of the day read (stored on the next write). */
function withPark(card: Card, read: ReadContext): Card {
  if (card.stage !== 'asked') return card;
  const park = settledPark(planInput(card));
  if (!park || read.asOf < park.on) return card;
  return {
    ...card, stage: 'not-now', askAgainFrom: park.askAgainFrom,
    history: [...card.history, {
      from: 'asked', to: 'not-now', at: localMidnight(park.on, read.venture), by: 'chausar',
      evidence: { kind: 'reason', id: null, line: `No reply after the last follow-up. Ask again from ${formatVentureDate(park.askAgainFrom, read.venture.country.dateOrder)}.` },
    }],
  };
}

/**
 * Every card of a business as of a day, oldest first: the stored cards (one whose person and lead are both gone, as after
 * a Forget, is left out), then each lead that has no card yet. A lead whose email is someone in the network is that
 * person's card: it joins their newest card that has no lead, or reads as their card when they have none.
 */
export function cardsOf(state: State, venture: VentureRecord, asOf: IsoDate): Card[] {
  const people = new Map(listPeople(state, venture.id).map(person => [person.id, person]));
  const byEmail = new Map<string, PersonRecord>();
  for (const person of people.values()) for (const email of person.handles.emails) if (!byEmail.has(email)) byEmail.set(email, person);
  const leads = listRecords(state, 'venture-lead', venture.id);
  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  const inbound = new Map<string, { id: string; on: IsoDate; at: IsoTime }[]>();
  for (const message of listRecords(state, 'venture-inbound', venture.id)) {
    // 4E3: a one-word thanks, or a reply the owner set aside (Done, Not now), does not stop the follow-ups.
    if (!message.matched || NOT_A_REPLY.has(message.triage) || message.handled?.how === 'done') continue;
    const list = inbound.get(message.matched.opportunityId) ?? [];
    list.push({ id: message.id, on: localDayAt(message.date, venture.country), at: message.at });
    inbound.set(message.matched.opportunityId, list);
  }
  const read: ReadContext = {
    venture, asOf, settings: pipelineSettings(state, venture.id), blocklist: blocklistOf(state, venture.id), inbound,
    holds: followupHolds(listRecords(state, 'venture-inbound', venture.id), venture),
  };
  const cards: Card[] = [];
  const linked = new Set<string>();
  const stored = listRecords(state, 'venture-opportunity', venture.id);
  for (const record of stored) if (record.leadId) linked.add(record.leadId);
  /** Each person's newest stored card that has no lead yet: where a lead with their email joins. */
  const joinable = new Map<string, number>();
  for (const record of stored) {
    const lead = record.leadId ? leadById.get(record.leadId) ?? null : null;
    const person = people.get(record.personId) ?? null;
    if (!person && !lead) continue;
    if (person && !record.leadId) joinable.set(person.id, cards.length);
    cards.push(effective(record, lead, person, read));
  }
  for (const lead of leads) {
    if (linked.has(lead.id)) continue;
    const person = (lead.email && byEmail.get(lead.email.toLowerCase())) || null;
    const at = person ? joinable.get(person.id) : undefined;
    if (at !== undefined) {
      cards[at] = effective(cards[at].stored, lead, person, read);
      joinable.delete(person!.id);
      continue;
    }
    cards.push(effective(null, lead, person, read));
  }
  // The newest send to each person, card by card, so a follow-up keeps 7 days from a touch on another of their cards.
  const sends = new Map<string, { id: string; on: IsoDate }[]>();
  for (const card of cards) {
    const last = card.touches.filter(touch => touch.what === 'sent').map(touch => touch.on).sort().at(-1);
    if (last) sends.set(card.personId, [...(sends.get(card.personId) ?? []), { id: card.id, on: last }]);
  }
  return cards.map(card => {
    const others = (sends.get(card.personId) ?? []).filter(item => item.id !== card.id).map(item => item.on).sort();
    return withPark({ ...card, lastToPerson: others.at(-1) ?? null }, read);
  });
}

/** One card by its id, or by its lead's id (a lead's card answers to both once stored). */
export function findCard(cards: readonly Card[], id: string): Card | undefined {
  return cards.find(card => card.id === id) ?? cards.find(card => card.leadId === id);
}

/** The owner's day now, in the business's country. */
const todayOf = (tx: VentureTx) => localDayAt(tx.now, tx.venture!.country);

/** The card a write acts on, read from the transaction's own state; refuses an unknown id. */
export function cardForWrite(tx: VentureTx, id: string): Card {
  const card = findCard(cardsOf(tx.state, tx.venture!, todayOf(tx)), id);
  check(card, 'INVALID_VENTURE_REQUEST', 'This card is not in your pipeline.');
  return card;
}

/** Why a terminal card cannot move. */
export function closedLine(card: Pick<Card, 'stage' | 'askAgainFrom'>, venture: VentureRecord): string {
  if (card.stage === 'won') return 'This card is won, so it stays as it is.';
  if (card.stage === 'lost') return 'This card is lost, so it stays as it is.';
  return card.askAgainFrom
    ? `This card is Not now. Ask again from ${formatVentureDate(card.askAgainFrom, venture.country.dateOrder)} to start a new card.`
    : 'This card is Not now. Ask again to start a new card.';
}

/**
 * Writes a card as it reads now (with its lead's news, matched replies and a park that came due): replaces the stored
 * card, or stores a lead's card for the first time. Answers the stored record.
 */
export function storeCard(tx: VentureTx, card: Card): OpportunityRecord {
  const sends = card.touches.filter(touch => touch.what === 'sent').length;
  const fields = {
    personId: card.personId, stage: card.stage, history: card.history, next: card.next, sequence: card.sequence, nudges: Math.max(0, sends - 1),
    clientId: card.clientId, lostReason: card.lostReason, askAgainFrom: card.askAgainFrom, touches: card.touches, leadId: card.leadId,
    ...(card.votes.length ? { votes: card.votes } : {}),
  };
  const record = card.stored
    ? tx.replace<OpportunityRecord>({ ...card.stored, ...fields })
    : tx.put<OpportunityRecord>({ ...tx.base('venture-opportunity'), ...fields, trigger: card.trigger, linkedFrom: card.linkedFrom, basis: null });
  card.stored = record;
  card.id = record.id;
  return record;
}

/**
 * Stores a lead's card when the lead's first send is recorded (customers/lead-methods.ts), so the sequence is copied
 * with the sending days of that day and a later change to the settings never moves follow-ups already in flight. A
 * lead that already has a card, or is not in this business, changes nothing.
 */
export function ensureLeadCard(tx: VentureTx, leadId: string): void {
  const card = findCard(cardsOf(tx.state, tx.venture!, todayOf(tx)), leadId);
  if (!card || card.stored || !card.touches.some(touch => touch.what === 'sent')) return;
  const record = storeCard(tx, card);
  announce(tx, record.id);
}

/** Announces a change: the board (ids only) and Today, whose follow-up rows read the cards. */
export function announce(tx: VentureTx, id: string): void {
  tx.emit('pipeline.changed', { id });
  tx.emit('queue.changed', {});
}

const CHANNEL_PHRASE: Readonly<Record<OutreachSentChannel, string>> = Object.freeze({
  'own-mailbox': ' by email', linkedin: ' on LinkedIn', whatsapp: ' on WhatsApp', phone: ' by phone',
});
/** ' on WhatsApp', ' by email', or nothing when the owner did not say how. */
export const channelPhrase = (channel: OutreachSentChannel | null) => (channel ? CHANNEL_PHRASE[channel] : '');

type SendInput = { on: IsoDate; channel: OutreachSentChannel | null; outreachKind: OutreachKind | null; ref: string | null; by: string };

/**
 * Adds one send to a card in memory: the first copies the sequence onto the card (unless it already holds one) and,
 * with move, takes a Found card to Asked with the send as its evidence.
 */
function addSend(card: Card, input: SendInput, tx: VentureTx, move: boolean): void {
  const first = !card.touches.some(touch => touch.what === 'sent');
  card.touches = ordered([...card.touches, { what: 'sent', on: input.on, at: tx.now, kind: first ? 'first' : 'nudge', channel: input.channel, ref: input.ref, by: input.by }]);
  if (first && !card.stored?.sequence) card.sequence = sequenceFor(input.outreachKind, input.channel, pipelineSettings(tx.state, tx.venture!.id), tx.now);
  if (move && card.stage === 'found') {
    card.history = [...card.history, { from: 'found', to: 'asked', at: tx.now, by: input.by, evidence: { kind: 'send', id: input.ref, line: `You sent the first note${channelPhrase(input.channel)}.` } }];
    card.stage = 'asked';
  }
  if (card.next && card.next.due <= input.on) card.next = null;
}

/**
 * Records one send the owner made themselves on a card (their "I sent it"; 4E2's venture.outreach.sent calls this):
 * on, the owner's day they sent it; channel, how. The first send copies the sequence onto the card and moves a Found
 * card to Asked; later ones are follow-ups. Refuses a closed card and a blocked person. Chausar never sends anything.
 * Emits pipeline.changed (the card's id) and queue.changed. Answers the stored card.
 */
export function recordCardSend(tx: VentureTx, cardId: string, input: SendInput): OpportunityRecord {
  const card = cardForWrite(tx, cardId);
  check(!CLOSED_STAGES.has(card.stage), 'PIPELINE_STAGE_CLOSED', closedLine(card, tx.venture!));
  check(!card.blocked, 'PIPELINE_BLOCKED', BLOCKED_LINE);
  check(/^\d{4}-\d{2}-\d{2}$/.test(input.on) && input.on <= todayOf(tx), 'INVALID_VENTURE_REQUEST', 'The day it was sent cannot be in the future.');
  addSend(card, input, tx, true);
  const record = storeCard(tx, card);
  announce(tx, record.id);
  return record;
}

/** What a move gets from the owner: a reason (Lost only) and its evidence. */
export type MoveInput = { reason: LostReason | null; evidence: PipelineEvidenceInput | null; by: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The client a Won card links: one named, the person's own, a client already here with one of the card's emails (in
 * any case), then one with the card's name; else a new one made from the card in this transaction, kept the way
 * venture.client.add keeps a client (its evidence rows, its term and its event).
 */
function wonClient(tx: VentureTx, card: Card, evidence: PipelineEvidenceInput | null): { client: ClientRecord; made: boolean } {
  check(evidence === null || evidence.kind === 'client', 'PIPELINE_EVIDENCE_REQUIRED', 'Won links a client: choose one, or Chausar makes one from this card.');
  const known = evidence?.id ?? card.clientId ?? card.person?.clientId ?? null;
  if (known) {
    const client = tx.find('venture-client', known);
    check(client, 'PIPELINE_EVIDENCE_REQUIRED', 'That client is not in this business.');
    return { client, made: false };
  }
  const clients = tx.list('venture-client');
  const emails = new Set(card.emails.map(email => email.toLowerCase()));
  const same = clients.find(client => !!client.email && emails.has(client.email.trim().toLowerCase()))
    ?? clients.find(client => fold(client.name) !== '' && fold(client.name) === fold(card.name));
  if (same) return { client: same, made: false };
  const name = card.name.trim().slice(0, 120);
  check(name.length >= 2, 'PIPELINE_EVIDENCE_REQUIRED', 'Add the client first, then mark this card won with them.');
  const email = card.emails.find(item => item.length <= 200 && EMAIL.test(item)) ?? null;
  const client = tx.put<ClientRecord>({ ...tx.base('venture-client'), name, email, countryCode: null, taxId: null, stateCode: null, note: null });
  recordOwnerFields(tx, `client:${client.id}`, { name, email, countryCode: null, taxId: null, stateCode: null, note: null });
  activateTerm(tx, 'client', { recordId: client.id, kind: 'venture-client' });
  tx.emit('client-added', { clientId: client.id });
  return { client, made: true };
}

/** The lead a card follows takes the move too, where the lead has a stage for it and its own rules allow it. */
function moveLeadToo(tx: VentureTx, card: Card, to: PipelineStage, cardId: string, by: string): void {
  if (!card.lead) return;
  const stage = to === 'talking' ? 'replied' : to === 'won' ? 'won' : to === 'lost' ? 'lost' : null;
  if (!stage) return;
  const lead = tx.find('venture-lead', card.lead.id);
  if (!lead) return;
  let moved: Lead;
  try {
    moved = moveLead(asLead(lead), stage, { evidence: { kind: stage === 'replied' ? 'reply' : 'outcome', id: cardId }, by, at: tx.now });
  } catch {
    return; // the lead is closed, blocked or already past it: it keeps its own stage
  }
  const { id: _id, ...fields } = moved;
  tx.replace<LeadRecord>({ ...lead, ...fields });
}

/**
 * Moves a card forward with its evidence and answers the stored card and the line to show. Asked: the owner's word of
 * the day they sent it (a send with no channel). Talking: their message (inbound mail from them or matched to the card)
 * or the owner's word of the day they wrote back. Proposal: a quote receipt, or a note of what was offered. Won: a
 * client, linked or made now. Lost: one of the owner's reasons. Not now: "Ask again from" 30 days on.
 */
export function moveCard(tx: VentureTx, card: Card, to: PipelineStage, input: MoveInput): { record: OpportunityRecord; line: string } {
  const venture = tx.venture!, order = venture.country.dateOrder, today = todayOf(tx);
  const date = (day: IsoDate) => formatVentureDate(day, order);
  check(!CLOSED_STAGES.has(card.stage), 'PIPELINE_STAGE_CLOSED', closedLine(card, venture));
  check(STAGE_RANK[to] > STAGE_RANK[card.stage], 'PIPELINE_STAGE_BACKWARD', 'A card only moves forward. Move it to a later stage.');
  check(to === 'lost' || to === 'not-now' || !card.blocked, 'PIPELINE_BLOCKED', BLOCKED_LINE);
  check(input.reason === null || to === 'lost', 'INVALID_VENTURE_REQUEST', 'A reason is only for Lost.');
  const evidence = input.evidence;
  const from = card.stage;
  const following = planOf(card) !== null;
  const pastDay = (day: IsoDate | undefined) => { check(day && day <= today, 'INVALID_VENTURE_REQUEST', 'That day cannot be in the future.'); return day; };
  const noted = (text: string | undefined) => (text ? `: ${text}` : '.');
  let moveEvidence: StageMove['evidence'];
  let line: string;
  switch (to) {
    case 'asked': {
      check(evidence?.kind === 'note' && evidence.on, 'PIPELINE_EVIDENCE_REQUIRED', 'Asked needs a recorded send: tap I sent it after you send, or say the day you sent it.');
      const on = pastDay(evidence.on);
      addSend(card, { on, channel: null, outreachKind: null, ref: null, by: input.by }, tx, false);
      moveEvidence = { kind: 'send', id: null, line: `You said you sent it on ${date(on)}${noted(evidence.text)}` };
      const plan = followupPlan({ ...planInput(card), stage: 'asked' });
      line = plan?.kind === 'nudge' ? `Moved to Asked. Follow up ${shortDay(plan.due, order)}.` : 'Moved to Asked.';
      break;
    }
    case 'talking': {
      check(evidence?.kind === 'reply' || (evidence?.kind === 'note' && evidence.on), 'PIPELINE_EVIDENCE_REQUIRED', 'Talking needs their reply: their message, or the day they wrote back.');
      if (evidence.kind === 'reply') {
        const message = evidence.id ? tx.find('venture-inbound', evidence.id) : undefined;
        const matchedTo = message?.matched?.opportunityId;
        check(message && ((!!matchedTo && (matchedTo === card.id || matchedTo === card.leadId)) || card.emails.includes(message.from.trim().toLowerCase())),
          'PIPELINE_EVIDENCE_REQUIRED', 'That message is not from them.');
        const on = localDayAt(message.date, venture.country);
        card.touches = ordered([...card.touches.filter(item => !(item.what === 'reply' && item.ref === message.id)), { what: 'reply', on, at: tx.now, kind: null, channel: null, ref: message.id, by: input.by }]);
        moveEvidence = { kind: 'reply', id: message.id, line: `They wrote back on ${date(on)}.` };
      } else {
        const on = pastDay(evidence.on);
        card.touches = ordered([...card.touches, { what: 'reply', on, at: tx.now, kind: null, channel: null, ref: null, by: input.by }]);
        moveEvidence = { kind: 'reply', id: null, line: `You said they wrote back on ${date(on)}${noted(evidence.text)}` };
      }
      line = following ? 'Moved to Talking. Follow-ups stopped.' : 'Moved to Talking.';
      break;
    }
    case 'proposal': {
      if (evidence?.kind === 'quote') {
        const receipt = evidence.id ? tx.find('venture-price-receipt', evidence.id) : undefined;
        check(receipt, 'PIPELINE_EVIDENCE_REQUIRED', 'Choose the quote you sent, or note what you offered.');
        // 4E4: only a quote on an offer is a Proposal's evidence; an order's or an invoice's price receipt is not one.
        check(receipt.subject.type === 'offer', 'PIPELINE_NOT_A_QUOTE',
          'That receipt is for an order or an invoice, not a quote. Choose a quote you made, or note what you offered.');
        const amount = receiptFigure(receipt, 'taxable') ?? receiptFigure(receipt, 'total');
        moveEvidence = { kind: 'quote', id: receipt.id, line: `A quote of ${amount?.display ?? 'the amount on its receipt'}${receiptFigure(receipt, 'taxable') ? ' before tax' : ''}.` };
      } else {
        check(evidence?.kind === 'note' && evidence.text, 'PIPELINE_EVIDENCE_REQUIRED', 'Proposal needs the quote you sent, or a note of what you offered.');
        moveEvidence = { kind: 'owner', id: null, line: `You noted: ${evidence.text}` };
      }
      line = 'Moved to Proposal.';
      break;
    }
    case 'won': {
      const { client, made } = wonClient(tx, card, evidence);
      card.clientId = client.id;
      if (card.person && !card.person.clientId) {
        const person = tx.find('venture-person', card.person.id);
        if (person && !person.clientId) tx.replace<PersonRecord>({ ...person, clientId: client.id });
      }
      moveEvidence = { kind: 'client', id: client.id, line: made ? `${client.name} became your client.` : `Linked to your client ${client.name}.` };
      line = made ? `Won. ${firstName(client.name)} is now your client.` : `Won, linked to your client ${client.name}.`;
      break;
    }
    case 'lost': {
      check(input.reason, 'PIPELINE_EVIDENCE_REQUIRED', 'Choose why: no budget, no reply, they chose someone else, not a fit, the timing, or another reason.');
      check(evidence === null, 'INVALID_VENTURE_REQUEST', 'Lost takes a reason only.');
      card.lostReason = input.reason;
      card.askAgainFrom = addDays(today, ASK_AGAIN_DAYS); // Lost is terminal: asking again waits as it does after Not now
      moveEvidence = { kind: 'reason', id: null, line: `Lost: ${REASON_WORDS[input.reason]}.` };
      line = `Moved to Lost: ${REASON_WORDS[input.reason]}.`;
      break;
    }
    default: { // not-now
      check(evidence === null, 'INVALID_VENTURE_REQUEST', 'Not now takes nothing more.');
      card.askAgainFrom = addDays(today, ASK_AGAIN_DAYS);
      moveEvidence = { kind: 'owner', id: null, line: `You chose Not now. Ask again from ${date(card.askAgainFrom)}.` };
      line = `Moved to Not now. Ask again from ${date(card.askAgainFrom)}.`;
    }
  }
  card.history = [...card.history, { from, to, at: tx.now, by: input.by, evidence: moveEvidence }];
  card.stage = to;
  const record = storeCard(tx, card);
  moveLeadToo(tx, card, to, record.id, input.by);
  announce(tx, record.id);
  return { record, line };
}

/** The owner's own next step on an open card, due today or later. */
export function setNextStep(tx: VentureTx, card: Card, next: { text: string; due: IsoDate }): OpportunityRecord {
  check(!CLOSED_STAGES.has(card.stage), 'PIPELINE_STAGE_CLOSED', closedLine(card, tx.venture!));
  check(!card.blocked, 'PIPELINE_BLOCKED', BLOCKED_LINE);
  check(next.due >= todayOf(tx), 'INVALID_VENTURE_REQUEST', 'Choose today or a later day.');
  card.next = next;
  const record = storeCard(tx, card);
  announce(tx, record.id);
  return record;
}

/**
 * What made a card, checked against the records: the owner; a file row the person came from (the earliest when no row
 * is named); a search or a saved search they are in; a lead in the list. Without one, there is no card.
 */
export function triggerOf(tx: VentureTx, person: PersonRecord, input: { kind: OpportunityTrigger['kind']; ref: string | null }): OpportunityTrigger {
  if (input.kind === 'owner') return { kind: 'owner', ref: null, line: 'You added them.' };
  if (input.kind === 'import') {
    const facts = person.facts.filter(fact => fact.source.importId && fact.source.row !== null);
    const fact = input.ref === null ? facts.slice().sort((a, b) => (a.source.importId! < b.source.importId! ? -1 : 1))[0]
      : facts.find(item => (input.ref!.includes(':') ? `${item.source.importId}:${item.source.row}` === input.ref : item.source.importId === input.ref));
    check(fact, 'PIPELINE_TRIGGER_REQUIRED', input.ref === null ? NO_SOURCE : 'That file row is not this person\'s.');
    const file = tx.find('venture-network-import', fact.source.importId!);
    check(file, 'PIPELINE_TRIGGER_REQUIRED', NO_SOURCE);
    return { kind: 'import', ref: `${file.id}:${fact.source.row}`, line: `${KIND_LABEL[file.importKind]}, ${file.fileName}, line ${count(fact.source.row ?? 0)}` };
  }
  if (input.kind === 'search' || input.kind === 'saved-search') {
    check(input.ref, 'PIPELINE_TRIGGER_REQUIRED', 'Name the search this person came from.');
    const search = tx.find('venture-network-search', input.ref);
    check(search && search.results.some(result => result.personId === person.id), 'PIPELINE_TRIGGER_REQUIRED', 'This person is not in that search.');
    if (input.kind === 'saved-search') {
      check(search.saved, 'PIPELINE_TRIGGER_REQUIRED', 'That search is not saved.');
      return { kind: 'saved-search', ref: search.id, line: `From your saved search "${search.saved.name}"` };
    }
    const text = search.text.length > 60 ? `${search.text.slice(0, 59).trimEnd()}...` : search.text;
    return { kind: 'search', ref: search.id, line: `From your search "${text}"` };
  }
  check(input.ref, 'PIPELINE_TRIGGER_REQUIRED', 'Name the lead this person came from.');
  const lead = tx.find('venture-lead', input.ref);
  check(lead, 'PIPELINE_TRIGGER_REQUIRED', 'That lead is not in your list.');
  // The lead's email must be this person's: not someone else's in the network, and one of theirs when they have any.
  const email = lead.email?.toLowerCase() ?? null;
  if (email) {
    const owner = tx.list('venture-person').find(item => item.handles.emails.includes(email));
    check(!owner || owner.id === person.id, 'PIPELINE_TRIGGER_REQUIRED', `That lead's email is ${owner?.name ?? 'someone else'}'s, not ${person.name}'s.`);
    check(!person.handles.emails.length || person.handles.emails.includes(email), 'PIPELINE_TRIGGER_REQUIRED', `That lead's email is not one of ${person.name}'s.`);
  }
  return { kind: 'lead', ref: lead.id, line: `Found on ${leadWhere(lead.sourceUrl)}` };
}

/** Whether the blocklist covers a person's emails. */
export function personBlocked(state: State, ventureId: string, person: PersonRecord): boolean {
  return personOnBlocklist(blocklistOf(state, ventureId), person.handles); // 4E2: emails, phones and the LinkedIn page
}

/** What comes next on a card: a follow-up from its sequence, the owner's own step, the day it parks, or Ask again. */
export type NextStep = { kind: 'nudge' | 'other-path' | 'park' | 'ask-again' | 'owner'; text: string; due: IsoDate; step: number | null; channel: OutreachChannel | null };

/**
 * The next step a card shows: on a Not now card, Ask again from its day; on an open card that is not blocked, the earlier
 * of the sequence's next step and the owner's own (the sequence's on a tie). Null on Won and Lost.
 */
export function nextStepOf(card: Card): NextStep | null {
  if (card.stage === 'not-now') return card.askAgainFrom ? { kind: 'ask-again', text: 'Ask again', due: card.askAgainFrom, step: null, channel: null } : null;
  if (CLOSED_STAGES.has(card.stage) || card.blocked) return null;
  const plan = planOf(card);
  const fromPlan: NextStep | null = !plan ? null
    : plan.kind === 'nudge' ? { kind: 'nudge', text: plan.step === 0 ? 'Follow up' : 'Follow up again', due: plan.due, step: plan.step, channel: plan.channel }
      : plan.kind === 'other-path' ? { kind: 'other-path', text: 'Try another path, or Not now', due: plan.due, step: null, channel: null }
        : { kind: 'park', text: 'Parks as Not now if there is no reply', due: plan.on, step: null, channel: null };
  const own: NextStep | null = card.next ? { kind: 'owner', text: card.next.text, due: card.next.due, step: null, channel: null } : null;
  if (!fromPlan || !own) return fromPlan ?? own;
  return own.due < fromPlan.due ? own : fromPlan;
}

/** One draft waiting to be sent from a card: a 4E2 draft, or a lead's email draft that was never recorded as sent. */
export type CardDraft = { id: string; kind: OutreachKind; channel: OutreachChannel; at: IsoTime };

/** A card's drafts not sent yet, newest first. */
export function unsentDrafts(state: State, venture: VentureRecord, card: Card): CardDraft[] {
  const drafts: CardDraft[] = [];
  if (card.stored) {
    for (const draft of listRecords(state, 'venture-outreach', venture.id)) {
      if (draft.opportunityId === card.stored.id && !draft.sent) drafts.push({ id: draft.id, kind: draft.outreachKind, channel: draft.channel, at: draft.at });
    }
  }
  if (card.lead) {
    const sent = new Set(card.lead.sends.map(send => send.draftId));
    for (const draft of card.lead.drafts) if (!sent.has(draft.id)) drafts.push({ id: draft.id, kind: 'cold-email', channel: 'email', at: draft.at });
  }
  return drafts.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export const DRAFT_WORDS: Readonly<Record<OutreachKind, string>> = Object.freeze({
  'intro-request': 'Intro', 'double-opt-in': 'Double opt-in intro', 'connection-note': 'Connection note', 'follow-up': 'Follow-up', reply: 'Reply',
  'cold-email': 'Cold email', reminder: 'Reminder',
});
export const CHANNEL_WORDS: Readonly<Record<OutreachChannel, string>> = Object.freeze({ email: 'Mail', linkedin: 'LinkedIn', whatsapp: 'WhatsApp' });
