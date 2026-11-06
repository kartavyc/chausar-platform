// Chausar venture launcher, network (Ink v2 wave 4, package 4E3): Today's 'reply' rows for inbound mail that needs the
// owner, and the 'notice' rows that ask for notes after a call. A reply row is a match to confirm ("Is this from Priya
// about Acme?"), a reply that may move its card to Talking (nothing moves until the owner says so), a reply the owner
// writes themselves (price, a contract, a meeting or buying, with a code-built line), "are you a bot" with the one
// fixed honest answer drafted, what an opt-out left for the owner (close an unproved card, block the person's other
// addresses), or a dead domain to block whole. A message whose row can no longer be is marked processed (on each sync
// and the journal sweep's tick), so processed false means unread. Each row carries its parts (who, why, the card, the
// topics, the address and screened subject for the handoff) so the screen can say it in its own words and in Hindi.
// Rows are read from records only;
// decisions come through views/queue-w4.ts (decideReply) and check, inside their transaction, that the row the owner
// saw is still the row. Chausar never sends: "Reply in Mail" is the owner's own mail app.
import { check, type Context, type State } from '../../contracts.ts';
import type { CalendarFeedRecord, InboundRecord, QueueAction, QueueReply, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, formatVentureDate, listRecords, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt, localTimeAt } from '../local-day.ts';
import type { W4Decision, W4Outcome, W4RowItem } from '../views/queue-w4.ts';
import { cardForWrite, cardsOf, CLOSED_STAGES, findCard, moveCard, STAGE_RANK, type Card } from './pipeline.ts';
import { listPeople } from './store.ts';
import { applyDomainBlock, applyOptOut, BOT_ANSWER, BOT_ANSWER_HI, confirmInbound, domainWarning, firstOf, moreTopics, ownerReplyTitle } from './inbound.ts';

const action = (id: QueueAction['id'], label: string, primary: boolean): QueueAction => ({ id, label, primary });
/** A row id's version part as views/queue.ts writes it: identifier characters only, at most 80. */
const part = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
/** How long after a call ends Today asks for notes. */
export const NOTES_WINDOW_MS = 48 * 60 * 60_000;
export const STALE = 'This changed since you opened it.';
export const GONE = 'This was resolved elsewhere.';

/** The fixed answer to "are you a bot", in the reply's language. */
export const botAnswerFor = (record: Pick<InboundRecord, 'hindi'>) => (record.hindi ? BOT_ANSWER_HI : BOT_ANSWER);

function personOf(state: State, venture: VentureRecord, id: string | null | undefined) {
  return id ? listPeople(state, venture.id).find(person => person.id === id) : undefined;
}

/** The row one unprocessed message makes now, or null when nothing about it waits on the owner any more. */
function replyRow(state: State, venture: VentureRecord, record: InboundRecord, cards: readonly Card[]): W4RowItem | null {
  if (record.processed) return null;
  const order = venture.country.dateOrder;
  const on = formatVentureDate(localDayAt(record.date, venture.country), order);
  const person = personOf(state, venture, record.personId);
  const subject = `reply:${record.id}`;
  const parts = (reason: QueueReply['reason'], card: Card | null, name: string, company: string | null): QueueReply => ({
    inboundId: record.id, reason, name, company, opportunityId: card?.id ?? null, eventId: null, topics: record.topics ?? [], from: record.from,
    subject: record.subject, draft: reason === 'bot-question' ? botAnswerFor(record) : null,
  });
  if (record.triage === 'opt-out') {
    // What an opt-out left for the owner: closing cards it could not prove, blocking the person's other addresses.
    const pending = record.optOut ?? { blocked: [], close: [], block: [] };
    const close = pending.close.filter(id => { const card = findCard(cards, id); return !!card && !CLOSED_STAGES.has(card.stage); });
    const block = pending.block;
    if (!close.length && !block.length) return null;
    const name = person?.name ?? record.from;
    const closeWords = close.length === 1 ? 'the card' : `their ${close.length} cards`;
    const title = block.length
      ? `${firstOf(name)} asked not to be contacted. Block ${block.join(' and ')}${close.length ? ` and close ${closeWords} too` : ' too'}?`
      : `${firstOf(name)} asked not to be contacted. Close ${closeWords} as Lost?`;
    const yes = block.length ? (close.length ? 'Block and close' : 'Block them too') : 'Close as Lost';
    return {
      kind: 'reply', subject, version: `optout.${close.join('.')}.${block.length}`, createdAt: record.date, title,
      line: `${record.line} Mail of ${on}.`,
      actions: [action('approve', yes, true), action('deny', block.length ? 'Not now' : 'Keep the card', false)],
      reply: parts('opt-out', close[0] ? findCard(cards, close[0]) ?? null : null, name, person?.role?.company ?? null),
    };
  }
  if (record.triage === 'bounce') {
    if (!record.domainAsk) return null;
    const address = record.bounces?.find(item => item.scope === 'domain' && item.address.endsWith(`@${record.domainAsk}`))?.address ?? record.domainAsk;
    return {
      kind: 'reply', subject, version: `domain.${record.domainAsk}`, createdAt: record.date, title: `${record.domainAsk} takes no mail. Block the whole domain?`,
      line: `Mail to ${address} could not be delivered on ${on}, and ${address} is blocked. ${domainWarning(state, venture, record.domainAsk, address)}`,
      actions: [action('approve', 'Block the domain', true), action('deny', 'Only the address', false)],
      reply: { ...parts('bounce-domain', null, address, null), from: null, subject: null },
    };
  }
  if (!record.matched && record.candidates?.length) {
    const card = findCard(cards, record.candidates[0].opportunityId);
    if (!card || CLOSED_STAGES.has(card.stage)) return null;
    const name = person?.name ?? card.name;
    const about = card.company ? ` about ${card.company}` : card.name !== name ? ` about ${card.name}` : '';
    return {
      kind: 'reply', subject, version: `confirm.${card.id}.${record.candidates.length}`, createdAt: record.date,
      title: `Is this from ${firstOf(name)}${about}?`, line: `Mail from ${record.from} on ${on}. Chausar was not sure enough to attach it to a card, so it asks you.`,
      actions: [action('approve', 'Yes, it is', true), action('deny', 'No', false)], reply: parts('confirm', card, name, card.company),
    };
  }
  const card = record.matched ? findCard(cards, record.matched.opportunityId) ?? null : null;
  const name = person?.name ?? card?.name ?? record.from;
  const company = person?.role?.company ?? card?.company ?? null;
  const before = !!card && !CLOSED_STAGES.has(card.stage) && STAGE_RANK[card.stage] < STAGE_RANK.talking;
  const version = `${record.triage}.${card?.id ?? 'none'}.${card?.stage ?? 'none'}`;
  const reply = (reason: QueueReply['reason']) => parts(reason, card, name, company);
  const second = before ? action('approve', 'Move to Talking', false) : action('deny', 'Done', false);
  const navigate = `Reply to ${firstOf(name)} from your own mail app. Chausar never sends mail.`;
  if (record.triage === 'owner-reply') {
    return {
      kind: 'reply', subject, version, createdAt: record.date, title: ownerReplyTitle(name, record.topics ?? []),
      line: `Mail from ${record.from} on ${on}.${moreTopics(record.topics ?? [])} Chausar leaves this one to you.`,
      actions: [action('open', 'Reply in Mail', true), second], navigate, reply: reply('owner-reply'),
    };
  }
  if (record.triage === 'bot-question') {
    return {
      kind: 'reply', subject, version, createdAt: record.date, title: `${firstOf(name)} asked if you are a bot. A reply is drafted.`,
      line: `Drafted reply: "${botAnswerFor(record)}" Send it yourself from your own mail.`,
      actions: [action('open', 'Reply in Mail', true), second], navigate, reply: reply('bot-question'),
    };
  }
  if (!before || !card) return null;
  return {
    kind: 'reply', subject, version, createdAt: record.date, title: `${firstOf(name)} wrote back. Move the card to Talking?`,
    line: `Mail from ${record.from} on ${on}, matched to ${card.name}${card.company ? ` (${card.company})` : ''}. Nothing moves until you say so.`,
    actions: [action('approve', 'Move to Talking', true), action('deny', 'Not now', false)], reply: reply('talking'),
  };
}

/** "Rahul", "Rahul and Asha", "Rahul and 2 others". */
function whoWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'someone';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/** The calls that ended in the last 48 hours with people in the network, whose notes the owner has not added or declined. */
export function callsAwaitingNotes(state: State, venture: VentureRecord, nowMs: number): { event: CalendarFeedRecord['events'][number]; names: string[] }[] {
  const feed = listRecords(state, 'venture-calendar-feed', venture.id).at(-1);
  if (!feed || feed.status !== 'set') return [];
  const people = new Map(listPeople(state, venture.id).map(person => [person.id, person]));
  return feed.events.flatMap(event => {
    const end = Date.parse(event.endAt);
    if (event.notesAt || event.declined || end > nowMs || nowMs - end > NOTES_WINDOW_MS) return [];
    const names = event.personIds.map(id => people.get(id)?.name).filter((name): name is string => !!name);
    return names.length ? [{ event, names }] : [];
  });
}

/** The open business's reply rows and after-a-call notices, from records only. */
export function replyRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  // Days and times are the owner's local ones, so a business still in its interview (no country yet) has no rows here.
  if (!venture.country) return [];
  const now = deps.clock();
  const cards = cardsOf(state, venture, localDayAt(now, venture.country));
  const rows: W4RowItem[] = [];
  for (const record of listRecords(state, 'venture-inbound', venture.id) as InboundRecord[]) {
    const row = replyRow(state, venture, record, cards);
    if (row) rows.push(row);
  }
  for (const { event, names } of callsAwaitingNotes(state, venture, now.getTime())) {
    const first = names.map(firstOf);
    rows.push({
      kind: 'notice', subject: `meeting:${event.id}`, version: event.endAt.replace(/[^0-9]/g, ''), createdAt: event.endAt,
      title: `Add notes from your call with ${whoWords(first)}?`,
      line: `The call ended at ${localTimeAt(event.endAt, venture.country).slice(11, 16)}. Paste your notes, and Chausar drafts the next steps for you to approve.`,
      actions: [action('open', 'Add notes', true), action('deny', 'No notes', false)], navigate: 'Add your notes from the call in the notes sheet on Today.',
      reply: { inboundId: null, reason: 'meeting-notes', name: names[0], company: null, opportunityId: null, eventId: event.id, topics: [], from: null, subject: null, draft: null },
    });
  }
  return rows;
}

/**
 * Marks processed, in the caller's transaction, every message whose row can no longer exist (its card moved on or
 * closed, its pending step done elsewhere), so processed false always means something waits on the owner (4G2 counts
 * these as unread). Answers how many it marked. A business with no country yet has no rows, and nothing is marked.
 */
export function settleInboundIn(tx: VentureTx): number {
  const venture = tx.venture;
  if (!venture?.country) return 0;
  const cards = cardsOf(tx.state, venture, localDayAt(tx.now, venture.country));
  let settled = 0;
  for (const record of tx.list('venture-inbound') as InboundRecord[]) {
    if (record.processed || replyRow(tx.state, venture, record, cards)) continue;
    tx.replace<InboundRecord>({ ...record, processed: true });
    settled += 1;
  }
  return settled;
}

/** The same from the journal sweep's tick: written only when some message needs it, so an idle business is not rewritten. */
export async function settleInbound(deps: VentureDeps, ctx: Context): Promise<void> {
  try {
    const state = deps.store.read();
    const venture = currentVenture(state);
    if (!venture?.country) return;
    const cards = cardsOf(state, venture, localDayAt(deps.clock(), venture.country));
    const due = (listRecords(state, 'venture-inbound', venture.id) as InboundRecord[]).some(record => !record.processed && !replyRow(state, venture, record, cards));
    if (!due) return;
    await ventureAction(deps, ctx, 'prepare', 'inbound.settle', tx => { if (settleInboundIn(tx)) tx.emit('queue.changed', {}); });
  } catch {
    // The next tick tries again; nothing about a reply is lost by waiting.
  }
}

/** The row id a message's row has now, as views/queue.ts gives it, or null when it has none. */
function currentRowId(tx: VentureTx, record: InboundRecord): string | null {
  const venture = tx.venture!;
  const row = replyRow(tx.state, venture, record, cardsOf(tx.state, venture, localDayAt(tx.now, venture.country)));
  return row ? `${row.subject}:${part(row.version)}` : null;
}

/** "No notes" on an after-a-call notice: Today stops asking about that call. */
async function declineNotes(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  check(decision.action === 'deny', 'INVALID_VENTURE_REQUEST', 'This card offers Add notes and No notes.');
  const eventId = decision.subject.slice('meeting:'.length);
  return ventureAction(deps, ctx, 'approve', 'meeting.decline', tx => {
    const feed = tx.list('venture-calendar-feed').at(-1);
    const event = feed?.events.find(item => item.id === eventId);
    check(feed && event && !event.notesAt && !event.declined, 'APPROVAL_STALE', GONE);
    tx.replace<CalendarFeedRecord>({ ...feed, events: feed.events.map(item => (item.id === eventId ? { ...item, declined: true } : item)) });
    tx.emit('queue.changed', {});
    return { line: 'No notes for this call. Chausar will not ask again.' };
  });
}

/**
 * A decision on a reply row, inside one transaction that first checks the row the owner saw is still the row. On a
 * match to confirm: Yes attaches the mail to that card (its triage then stands); No keeps it apart from every card. On
 * a reply: Move to Talking moves the card with the mail as its evidence; Done or Not now leaves the card as it is.
 */
export async function decideReplyRow(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  if (decision.subject.startsWith('meeting:')) return declineNotes(deps, ctx, decision);
  const id = decision.subject.slice('reply:'.length);
  check(decision.action === 'approve' || decision.action === 'deny', 'INVALID_VENTURE_REQUEST', 'This card offers its two answers only.');
  return ventureAction(deps, ctx, 'approve', 'inbound.decide', tx => {
    const record = tx.find('venture-inbound', id) as InboundRecord | undefined;
    check(record && !record.processed, 'APPROVAL_STALE', GONE);
    check(currentRowId(tx, record) === decision.row.id, 'APPROVAL_STALE', STALE);
    const reason = decision.row.reply?.reason;
    if (reason === 'opt-out' || reason === 'bounce-domain') {
      if (decision.action === 'deny') {
        tx.replace<InboundRecord>({ ...record, processed: true, ...(reason === 'bounce-domain' ? { domainAsk: null } : {}), handled: { how: 'done', at: tx.now, by: ctx.memberId } });
        tx.emit('queue.changed', {});
        return { line: reason === 'bounce-domain' ? 'Only the address stays blocked. The domain is not.' : 'Nothing more was blocked or closed. The address it came from stays blocked.' };
      }
      return { line: reason === 'opt-out' ? applyOptOut(tx, record, ctx.memberId) : applyDomainBlock(tx, record, ctx.memberId) };
    }
    if (reason === 'confirm') {
      const cardId = decision.row.reply!.opportunityId!;
      if (decision.action === 'deny') {
        const { candidates: _candidates, ...rest } = record;
        tx.replace<InboundRecord>({ ...rest, processed: true, handled: { how: 'not-them', at: tx.now, by: ctx.memberId }, line: 'You said this mail is not about a card in your pipeline.' });
        tx.emit('queue.changed', {});
        return { line: 'Kept apart from your cards. Nothing moved.' };
      }
      const confirmed = confirmInbound(tx, record.id, cardId, ctx.memberId);
      const card = cardForWrite(tx, cardId);
      return { line: confirmed.processed ? `Attached to ${card.name}'s card.` : `Attached to ${card.name}'s card. ${confirmed.line}` };
    }
    if (decision.action === 'deny') {
      tx.replace<InboundRecord>({ ...record, processed: true, handled: { how: 'done', at: tx.now, by: ctx.memberId } });
      tx.emit('queue.changed', {});
      return { line: 'Done. The card stays where it is.' };
    }
    check(record.matched, 'APPROVAL_STALE', STALE);
    const card = cardForWrite(tx, record.matched.opportunityId);
    const moved = moveCard(tx, card, 'talking', { reason: null, evidence: { kind: 'reply', id: record.id }, by: ctx.memberId });
    tx.replace<InboundRecord>({ ...record, processed: true, handled: { how: 'moved', at: tx.now, by: ctx.memberId } });
    return { line: moved.line };
  });
}
