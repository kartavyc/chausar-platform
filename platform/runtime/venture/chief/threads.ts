// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1, catalogue A1, A15, K18, spec 5.4): Chats threads with
// Chausar as chief of staff, kept in the open business's vault. venture.chief.thread.send takes the owner's words: keys
// and card, bank, Aadhaar and one-time code numbers are refused before anything is stored; the chat consent must hold
// (unless only templates answer); a question about another business on this computer is answered by code without
// reading it; a message that names one agent goes to that agent's chat, and one that names two makes the chief ask
// which; anything else gets the chief's answer (answer.ts) with its proposals (proposals.ts). Every stored message
// emits chief.message with ids only. venture.chief.threads groups the threads by when they last moved.
import { check, type Context, type State } from '../../contracts.ts';
import type {
  ChatPart, ChiefLineAmount, ChiefMessageRecord, ChiefMessageView, ChiefSendResult, ChiefThreadGroupKey, ChiefThreadRecord, ChiefThreadSummary,
  ChiefThreadsView, ChiefThreadView, ProposalRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, identifier, listRecords, plainText, requireAppChannel, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { secretFindings } from '../core/secrets.ts';
import { readAs } from '../delivery/shared.ts';
import { localDayAt, ownerToday } from '../local-day.ts';
import { addDays, weekStart } from '../views/team-series.ts';
import { short } from '../views/shared.ts';
import { appendAgentMessage } from '../agents/store.ts';
import { holdsIdNumber, ID_REFUSED, KEY_REFUSED, threadSendHandler as agentThreadSend } from '../agents/threads.ts';
import { chatConsentState, requireChatConsent } from '../agents/consent.ts';
import { appendChiefMessage, draftProposal, type ChiefMessageInput } from './store.ts';
import { chiefAnswer, type ChiefAnswer } from './answer.ts';
import { agentNameOf, routeOf, teamAgents } from './routing.ts';
import { availableKinds, draftFromModel } from './proposals.ts';
import { proposalView } from './gate.ts';
import { OPEN_ONLY_LINE, savedAnswer } from './tools.ts';

const PAGE = 50;
const MAX_WORDS = 2000;
const GROUPS: readonly { key: ChiefThreadGroupKey; label: string }[] = Object.freeze([
  { key: 'pinned', label: 'Pinned' }, { key: 'today', label: 'Today' }, { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' }, { key: 'earlier', label: 'Earlier' },
]);

// ---------------------------------------------------------------------------
// Threads as the owner reads them
// ---------------------------------------------------------------------------

function messagesOf(state: State, venture: VentureRecord, threadId: string): ChiefMessageRecord[] {
  return listRecords(state, 'venture-chief-message', venture.id).filter(message => message.threadId === threadId);
}

/** The longest last line a thread shows in the list. */
const LAST_LINE = 120;

/**
 * A message as one short line, with each receipted figure it states and where (4C2 review): the parts joined by spaces,
 * cut near LAST_LINE at a space, never inside a figure, with "..." when cut. Only whole figures keep their place.
 */
export function lastLineOf(parts: readonly ChatPart[]): { lastLine: string; amounts: ChiefLineAmount[] } {
  let text = '';
  const amounts: ChiefLineAmount[] = [];
  for (const part of parts) {
    const words = (part.kind === 'figure' ? part.display : part.text).replace(/\s+/g, ' ').trim();
    if (!words) continue;
    if (text) text += ' ';
    if (part.kind === 'figure') amounts.push({ text: words, start: text.length, length: words.length, receiptId: part.receiptId });
    text += words;
  }
  if (text.length <= LAST_LINE) return { lastLine: text, amounts };
  const room = text.slice(0, LAST_LINE - 3);
  const space = room.lastIndexOf(' ');
  let cut = space > LAST_LINE / 2 ? space : room.length;
  const inside = amounts.find(amount => amount.start < cut && cut < amount.start + amount.length);
  if (inside) cut = inside.start;
  const kept = text.slice(0, cut).trimEnd();
  return { lastLine: `${kept}...`, amounts: amounts.filter(amount => amount.start + amount.length <= kept.length) };
}

function summaryOf(state: State, venture: VentureRecord, thread: ChiefThreadRecord): ChiefThreadSummary {
  const messages = messagesOf(state, venture, thread.id);
  const last = messages.filter(message => message.from === 'chief').at(-1) ?? messages.at(-1);
  return {
    id: thread.id, title: thread.title, pinned: thread.pinned, lastAt: thread.lastAt, ...(last ? lastLineOf(last.parts) : { lastLine: '', amounts: [] }),
    unread: messages.filter(message => message.from === 'chief' && !message.read).length,
  };
}

function messageView(state: State, venture: VentureRecord, record: ChiefMessageRecord): ChiefMessageView {
  const proposals = record.proposalIds.flatMap(id => {
    const found = listRecords(state, 'venture-proposal', venture.id).find(item => item.id === id);
    return found ? [proposalView(state, venture, found)] : [];
  });
  return {
    id: record.id, at: record.at, from: record.from, parts: record.parts, proposals,
    routedTo: record.routedTo ? { agent: record.routedTo, name: agentNameOf(state, venture, record.routedTo) } : null,
    worked: record.worked ?? [], dropped: record.dropped ?? [], counted: record.counted ?? null,
  };
}

function threadOf(state: State, venture: VentureRecord, threadId: string): ChiefThreadRecord {
  const thread = listRecords(state, 'venture-chief-thread', venture.id).find(item => item.id === threadId);
  check(thread, 'INVALID_VENTURE_REQUEST', 'That chat was not found.');
  return thread;
}

/** Which group a thread falls in on the owner's calendar: pinned, today, this week (from Monday), last week, or earlier. */
function groupOf(thread: ChiefThreadRecord, venture: VentureRecord, today: string): ChiefThreadGroupKey {
  if (thread.pinned) return 'pinned';
  const day = localDayAt(thread.lastAt, venture.country);
  const monday = weekStart(today);
  if (day === today) return 'today';
  if (day >= monday) return 'this-week';
  return day >= addDays(monday, -7) ? 'last-week' : 'earlier';
}

/**
 * venture.chief.threads {} (read): the open business's Chats threads, pinned first, then by when each last moved on the
 * owner's calendar, newest first, each with its last answer line and how many answers are unread. Empty groups are left
 * out. A routine's thread (4J13) shows only once routines post into one.
 */
export async function threadsHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChiefThreadsView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const today = ownerToday(deps.clock, venture.country);
  const threads = listRecords(state, 'venture-chief-thread', venture.id).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return {
    groups: GROUPS.map(group => ({ key: group.key, label: group.label, threads: threads.filter(thread => groupOf(thread, venture, today) === group.key).map(thread => summaryOf(state, venture, thread)) }))
      .filter(group => group.threads.length > 0),
    // 4C2 review: the one chat consent as it stands, so the screen shows exactly this text and agrees by this digest.
    consent: chatConsentState(deps, ctx, state, venture).view,
  };
}

/**
 * venture.chief.thread.list { threadId, before? } (read): one thread, newest page of fifty, oldest first; before names
 * the oldest message shown, for the page before it. Reading it marks the chief's answers read.
 */
export async function threadListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChiefThreadView> {
  const body = exactPayload(payload, ['threadId', 'before'], ['threadId']);
  const threadId = identifier(body.threadId, 'Chat');
  const before = body.before === undefined ? null : identifier(body.before, 'Before');
  let { state, venture } = readAs(deps, ctx, 'read');
  threadOf(state, venture, threadId);
  if (messagesOf(state, venture, threadId).some(message => message.from === 'chief' && !message.read)) {
    await ventureAction(deps, ctx, 'read', 'chief.read', tx => {
      for (const message of tx.list('venture-chief-message')) if (message.threadId === threadId && !message.read) tx.replace<ChiefMessageRecord>({ ...message, read: true });
    });
    ({ state, venture } = readAs(deps, ctx, 'read'));
  }
  const all = messagesOf(state, venture, threadId);
  const end = before === null ? all.length : all.findIndex(message => message.id === before);
  check(end >= 0, 'INVALID_VENTURE_REQUEST', 'That message is not in this chat.');
  const start = Math.max(0, end - PAGE);
  return { thread: summaryOf(state, venture, threadOf(state, venture, threadId)), messages: all.slice(start, end).map(message => messageView(state, venture, message)), more: start > 0 };
}

/** venture.chief.thread.pin { threadId, pinned } (prepare, app only): pins a thread to the top of Chats, or unpins it. */
export async function threadPinHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ thread: ChiefThreadSummary }> {
  requireAppChannel(ctx, 'venture.chief.thread.pin');
  const body = exactPayload(payload, ['threadId', 'pinned'], ['threadId', 'pinned']);
  const threadId = identifier(body.threadId, 'Chat');
  check(typeof body.pinned === 'boolean', 'INVALID_VENTURE_REQUEST', 'pinned must be true or false.');
  const pinned = body.pinned;
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'chief.pin', tx => {
    const thread = threadOf(tx.state, tx.venture!, threadId);
    const kept = tx.replace<ChiefThreadRecord>({ ...thread, pinned });
    return { thread: summaryOf(tx.state, tx.venture!, kept) };
  });
}

// ---------------------------------------------------------------------------
// The owner's words
// ---------------------------------------------------------------------------

/** What the chief says back, before it is stored: its parts and what came with them. */
type Reply = Partial<Omit<ChiefAnswer, 'author'>> & {
  parts: ChatPart[]; author: ChiefMessageRecord['author']; routedTo?: string | null; ask?: string | null;
  /** The proposal kinds the chief may draft now (proposals.ts availableKinds). */
  available?: readonly string[];
};

/** Stores one message and announces it with ids only. */
function put(tx: VentureTx, input: ChiefMessageInput): ChiefMessageRecord {
  const record = appendChiefMessage(tx, input);
  tx.emit('chief.message', { threadId: record.threadId, messageId: record.id });
  return record;
}

const plainOf = (parts: readonly ChatPart[]): string => parts.map(part => (part.kind === 'figure' ? part.display : part.text)).join(' ');
const said = (text: string): ChatPart[] => [{ kind: 'text', text }];

/**
 * Stores the owner's words and the chief's reply in one commit: a new thread (titled by the first question) or the one
 * named. The answer's proposals are checked against the vault as it is now: a brief is posted in the agent's chat at
 * once, any other kind is stored drafted for Today, and anything code refuses becomes a line under the answer.
 */
async function store(deps: VentureDeps, ctx: Context, threadId: string | null, words: string, reply: Reply): Promise<ChiefSendResult> {
  return ventureAction(deps, ctx, 'prepare', 'chief.thread.send', tx => {
    const venture = tx.venture!;
    const thread = threadId ? threadOf(tx.state, venture, threadId)
      : tx.put<ChiefThreadRecord>({ ...tx.base('venture-chief-thread'), title: short(tidyWords(words), 80), pinned: false, routine: null, lastAt: tx.now });
    const owner = put(tx, { threadId: thread.id, from: 'owner', text: words, author: 'owner', routedTo: reply.routedTo ?? null });
    let answer = put(tx, {
      threadId: thread.id, from: 'chief', text: plainOf(reply.parts), parts: reply.parts, author: reply.author,
      callIds: reply.callIds ?? [], receiptIds: reply.receiptIds ?? [], routedTo: reply.routedTo ?? null,
    });
    const parts = [...reply.parts];
    const dropped = [...(reply.dropped ?? [])];
    const proposalIds: string[] = [];
    for (const raw of reply.proposals ?? []) {
      const drafted = draftFromModel(tx.state, venture, raw, words, reply.available ?? []);
      if (drafted.kind === 'refused') { dropped.push(`One proposal was left out: ${drafted.reason}`); continue; }
      if (drafted.kind === 'brief') {
        const posted = appendAgentMessage(tx, { agent: drafted.agent.id, from: 'chausar', text: drafted.text, parts: drafted.parts, author: 'model' });
        tx.emit('agent.message', { agent: posted.agent, messageId: posted.id });
        parts.push({ kind: 'text', text: `I passed a brief to ${drafted.agent.name}.` });
        continue;
      }
      const proposal: ProposalRecord = draftProposal(tx, { ...drafted.input, threadId: thread.id, messageId: answer.id });
      proposalIds.push(proposal.id);
    }
    answer = tx.replace<ChiefMessageRecord>({ ...answer, text: plainOf(parts), parts, proposalIds, worked: reply.worked ?? [], dropped, counted: reply.counted ?? null });
    return {
      thread: summaryOf(tx.state, venture, tx.find('venture-chief-thread', thread.id)!),
      added: [messageView(tx.state, venture, owner), messageView(tx.state, venture, answer)], ask: reply.ask ?? null,
    };
  });
}

/** A business name long enough to tell apart from a client's first name or a word: five characters and four letters at least. */
const LONG_ENOUGH = (name: string) => name.length >= 5 && (name.match(/\p{L}/gu) ?? []).length >= 4;
/** Words that show a question is about a business: the business itself, its money, its work. English, Hinglish and Hindi. */
const BUSINESS_CUE = /\b(?:business(?:es)?|company|shop|store|studio|agency|firm|brand|channel|practice|doing|going|invoic\w*|money|sales?|revenue|earn\w*|income|profit\w*|owe[sd]?|paid|pay(?:ment)?s?|clients?|orders?|runs?|team|spend\w*|spent|month|week|kaisa|kaisi|kamai)\b|बिज़नेस|बिजनेस|कंपनी|दुकान|कमाई|बिक्री|पैसा|पैसे|इनवॉइस|कैसा|कैसी|महीने|हफ्ते/iu;

/**
 * Another business on this computer the words name, and what the chief says about it without reading it: only its
 * whole name, long enough not to be a client's first name or a word, and only in words that are about a business.
 */
async function otherBusiness(deps: VentureDeps, ctx: Context, words: string): Promise<ChatPart[] | null> {
  if (!BUSINESS_CUE.test(words)) return null;
  let refs: Awaited<ReturnType<NonNullable<VentureDeps['workspace']>['businesses']>> = [];
  try { refs = await deps.workspace?.businesses() ?? []; } catch { refs = []; }
  const open = deps.workspace?.current().id ?? null;
  const lower = words.toLowerCase();
  for (const ref of refs) {
    const name = ref.name?.trim() ?? '';
    if (ref.id === open || !LONG_ENOUGH(name)) continue;
    if (!new RegExp(`(?<![\\p{L}\\p{M}\\p{Nd}])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}\\p{Nd}])`, 'u').test(lower)) continue;
    // A business that opens with its passphrase, or whose key this computer lost, is never read until the owner opens it.
    if (ref.opens !== 'with-this-computer') return said(`${name} is locked. Open it to ask about it.`);
    // 4J6: one that opens with this computer is answered by code from what Chausar saved when it was last open.
    return await savedAnswer(deps, ctx, ref.id, name) ?? said(`${OPEN_ONLY_LINE} Open ${name} to ask about it.`);
  }
  return null;
}

/**
 * venture.chief.thread.send { threadId?, text } (prepare, app only): the owner asks Chausar. Keys and id numbers are
 * refused before anything is stored (CHAT_KEY_REFUSED); then the chat consent must hold, unless only templates answer.
 * A question naming another business on this computer is answered by code, from what Chausar saved when it was last
 * open (4J6) and never from its vault; a locked one is never read. One agent named
 * (an @name, or a leading name) gets the words in its own chat; two make the chief ask which, never guess (A15).
 * Anything else gets the chief's answer, every figure checked against a receipt. options.routine (4J13): a routine's
 * prompt the owner ran from Today; words routed to an agent go as a routine message there too (agents/threads.ts).
 */
export async function threadSendHandler(deps: VentureDeps, ctx: Context, payload: unknown, options: { routine?: boolean } = {}): Promise<ChiefSendResult> {
  requireAppChannel(ctx, 'venture.chief.thread.send');
  const body = exactPayload(payload, ['threadId', 'text'], ['text']);
  const threadId = body.threadId === undefined ? null : identifier(body.threadId, 'Chat');
  const words = plainText(body.text, 'Your message', { min: 1, max: MAX_WORDS });
  check(secretFindings(words).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(words), 'CHAT_KEY_REFUSED', ID_REFUSED);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  if (threadId) threadOf(state, venture, threadId);
  const route = requireChatConsent(deps, ctx, state, venture);

  const other = await otherBusiness(deps, ctx, words);
  if (other) {
    const receiptIds = [...new Set(other.flatMap(part => (part.kind === 'figure' ? [part.receiptId] : [])))];
    return store(deps, ctx, threadId, words, { parts: other, author: 'engine', ...(receiptIds.length ? { receiptIds } : {}) });
  }

  const routing = routeOf(state, venture, words);
  if (routing?.kind === 'ask') return store(deps, ctx, threadId, words, { parts: said(routing.question), author: 'engine', ask: routing.question });
  if (routing?.kind === 'agent') {
    await agentThreadSend(deps, ctx, { agent: routing.agent.id, text: routing.words }, options.routine ? { routine: true } : {});
    const name = routing.agent.name;
    return store(deps, ctx, threadId, words, { parts: said(`Sent to ${name}. The reply is in ${name}'s chat.`), author: 'engine', routedTo: routing.agent.id });
  }

  const kinds = await availableKinds();
  const answer = await chiefAnswer(deps, ctx, route, { state, venture, question: words, agents: teamAgents(state, venture), kinds });
  return store(deps, ctx, threadId, words, { ...answer, available: kinds.map(item => item.kind) });
}
