/**
 * The fake engine's answers for Chats with Chausar as chief of staff, its proposals and the Start page's fit (Ink v2
 * wave 4, 4C2, from the engine's 4C1: platform/runtime/venture/chief/*). The shapes, codes and engine lines are the
 * engine's: threads grouped by when they last moved on the owner's calendar (Kolkata, weeks from Monday); keys and id
 * numbers refused before anything is kept (CHAT_KEY_REFUSED); the one chat consent per business as the agents' desk
 * keeps it, carried on the thread list (CHAT_CONSENT_REQUIRED, CHAT_CONSENT_STALE; with no agents' desk it is needed,
 * never taken as given); a business that opens with its passphrase never read; one that opens with this computer answered from what was
 * saved when it was last open (4J6, the figures fake-across.ts serves); one agent named first gets the words in its own
 * chat, two make the chief ask which; anything else answered from the books, every figure with its receipt, and a
 * number the fake's "AI" writes labelled a model estimate. Proposals are drafted with "This becomes a card on Today for
 * your approval.", become a Today row of kind 'proposal' only through venture.proposals.raise, and are decided there.
 *
 * The fake has no AI judgement: its answers come from fixed rules, and its fit is always the social media agency (the
 * sample studio's titles and hooks carry over), labelled a model estimate as the engine's is.
 */

import {
  EngineError, type ChatConsentView, type ChatPart, type ChiefCounted, type ChiefFit, type ChiefLineAmount, type ChiefMessageView, type ChiefSendResult, type ChiefThreadSummary, type ChiefThreadView,
  type ChiefThreadsView, type InvoiceLite, type OrderLite, type ProposalKind, type ProposalStatus, type ProposalView, type QueueAction, type QueueRow,
} from './types';
import { BOOKS } from './fixtures';
import { fakeWays } from './fake-start';
import type { W4DeskHost } from './fake-w4';

const CHIEF_METHODS = new Set<string>([
  'venture.chief.threads', 'venture.chief.thread.list', 'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.chief.fit',
  'venture.proposals.raise', 'venture.proposals.dismiss',
]);

/** The engine's words (chief/gate.ts, chief/proposals.ts, agents/threads.ts), word for word. */
const TODAY_LINE = 'This becomes a card on Today for your approval.';
const NOTHING_CHANGES = 'Nothing changes until you approve.';
const KEY_REFUSED = 'That looks like a key. Keys go in Connections, never in chat.';
const ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Chats never send those, so nothing was sent or kept.';
const NOT_FOUND = 'That proposal was not found.';
const DECIDED = 'This proposal was decided already.';
const PAGE = 50;
const GROUPS = [
  { key: 'pinned', label: 'Pinned' }, { key: 'today', label: 'Today' }, { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' }, { key: 'earlier', label: 'Earlier' },
] as const;
type GroupKey = (typeof GROUPS)[number]['key'];
const LINES: Partial<Record<ProposalKind, string>> = {
  'start-run': 'This starts a run on your AI for this order. Each step that needs you still asks first.',
  'draft-invoice': 'Chausar drafts the invoice from your price. You issue it from Today.',
  'draft-reminder': 'Chausar drafts a payment reminder. You send it yourself.',
  quote: 'Chausar works out the price with its receipt. Nothing is sent.',
  'outreach-draft': 'Chausar drafts the note. You send it yourself.',
};
/** What an approved proposal did (chief/proposals.ts doneLine). */
const DONE: Partial<Record<ProposalKind, string>> = {
  'start-run': 'Started. Follow it on Work.',
  'draft-invoice': 'Drafted. The invoice waits on Today for you to issue it.',
  quote: 'Worked out. The quote has its receipt.',
  'next-step': 'Next step set.',
};
/** The agents the fake's sample businesses chat with, by the name an owner writes. */
const AGENT_NAMES: Readonly<Record<string, readonly { id: string; name: string }[]>> = {
  lumen: [{ id: 'editor', name: 'Editor' }, { id: 'researcher', name: 'Researcher' }, { id: 'producer', name: 'Producer' }, { id: 'publisher', name: 'Publisher' }],
};
/** Words that show a question is about a business (chief/threads.ts BUSINESS_CUE, its English part). */
const BUSINESS_CUE = /\b(?:business(?:es)?|company|shop|store|studio|agency|firm|brand|channel|practice|doing|going|invoic\w*|money|sales?|revenue|earn\w*|income|profit\w*|owe[sd]?|paid|pay(?:ment)?s?|clients?|orders?|runs?|team|spend\w*|spent|month|week)\b/i;
/** A key, and a card, bank or id number, as far as the fake knows them (core/secrets.ts and agents/threads.ts find more). */
const KEY = /\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/;
const ID_NUMBER = /\b\d{4}[ -]?\d{4}[ -]?\d{4}(?:[ -]?\d{4})?\b/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Drafted = { kind: ProposalKind; title: string; line: string; agent: string | null; spends: boolean; sends: boolean };
/** target: what the proposal acts on (an invoice by its number, or an order), for its gate; the engine keeps it in the proposal's input. */
interface HeldProposal extends Drafted {
  id: string; at: string; status: ProposalStatus; raisedAt: string | null; outcome: string | null; digest: string; target?: { invoice?: string; order?: string };
}
interface HeldMessage {
  id: string; at: string; from: 'owner' | 'chief'; text: string; parts: ChatPart[]; proposalIds: string[]; routedTo: string | null;
  worked: ChiefMessageView['worked']; dropped: string[]; read: boolean; counted?: ChiefCounted | null;
}
interface HeldThread { id: string; title: string; pinned: boolean; lastAt: string; messages: HeldMessage[] }
interface Held { threads: HeldThread[]; proposals: HeldProposal[] }
type Reply = { parts: ChatPart[]; ask?: string; routedTo?: string; worked?: ChiefMessageView['worked']; proposals?: (Drafted & { target?: HeldProposal['target'] })[] };

/** The owner's calendar day of an instant, in Kolkata (UTC+05:30), as the sample businesses are in India. */
const dayOf = (iso: string): string => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Monday of the week a day falls in. */
const mondayOf = (day: string): string => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const short = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const plainOf = (parts: readonly ChatPart[]): string => parts.map((part) => (part.kind === 'figure' ? part.display : part.text)).join(' ');
const said = (text: string): ChatPart[] => [{ kind: 'text', text }];
/** A message as one short line with each receipted figure where it stands, never cut inside one (chief/threads.ts lastLineOf). */
function lastLineOf(parts: readonly ChatPart[]): { lastLine: string; amounts: ChiefLineAmount[] } {
  const most = 120;
  let text = '';
  const amounts: ChiefLineAmount[] = [];
  for (const part of parts) {
    const words = (part.kind === 'figure' ? part.display : part.text).replace(/\s+/g, ' ').trim();
    if (!words) continue;
    if (text) text += ' ';
    if (part.kind === 'figure') amounts.push({ text: words, start: text.length, length: words.length, receiptId: part.receiptId });
    text += words;
  }
  if (text.length <= most) return { lastLine: text, amounts };
  const room = text.slice(0, most - 3);
  const space = room.lastIndexOf(' ');
  let cut = space > most / 2 ? space : room.length;
  const inside = amounts.find((amount) => amount.start < cut && cut < amount.start + amount.length);
  if (inside) cut = inside.start;
  const kept = text.slice(0, cut).trimEnd();
  return { lastLine: `${kept}...`, amounts: amounts.filter((amount) => amount.start + amount.length <= kept.length) };
}
/** '22 Oct 2026, 18:00' in Kolkata, as the engine's asOfWords says it. */
function asOfWords(iso: string): string {
  const local = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return `${local.slice(8, 10)} ${MONTHS[Number(local.slice(5, 7)) - 1]!.slice(0, 3)} ${local.slice(0, 4)}, ${local.slice(11, 16)}`;
}

export class FakeChiefDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly held = new Map<string, Held>();
  private seq = 1;

  /** The one chat consent per business, as the agents' desk keeps it (fake-agents.ts chatConsent). */
  private readonly consentOf: (() => ChatConsentView) | null;

  constructor(host: W4DeskHost, options: { fresh?: boolean; consent?: () => ChatConsentView } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
    this.consentOf = options.consent ?? null;
    if (!this.fresh) this.held.set('lumen', this.sample());
  }

  handles(method: string): boolean {
    return CHIEF_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.chief.threads': return this.threads(p);
      case 'venture.chief.thread.list': return this.list(p);
      case 'venture.chief.thread.send': return this.send(p);
      case 'venture.chief.thread.pin': return this.pin(p);
      case 'venture.chief.fit': return this.fit(p);
      case 'venture.proposals.raise': return this.raise(p);
      case 'venture.proposals.dismiss': return this.dismiss(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /**
   * A decision on a proposal's card on Today (fake.ts decide hands 'proposal:' rows here): Not now dismisses it,
   * Approve does what its kind does and says so in the engine's words. Null for any other row.
   */
  decide(row: QueueRow, action: QueueAction['id']): string | null {
    if (!row.id.startsWith('proposal:')) return null;
    const proposal = this.held.get(row.businessId)?.proposals.find((item) => row.id.startsWith(`proposal:${item.id}:`));
    if (!proposal || proposal.status !== 'raised') return 'This is no longer here.';
    if (action === 'approve' && this.gate(proposal)) throw new EngineError('APPROVAL_STALE', 'This changed since you saw it. Here is the new version.');
    if (action === 'deny') {
      proposal.status = 'dismissed';
      proposal.outcome = 'Not now.';
      return 'Not now. Nothing changed.';
    }
    proposal.status = 'approved';
    proposal.outcome = DONE[proposal.kind] ?? 'Drafted. Open it to send it yourself.';
    return proposal.outcome;
  }

  /**
   * 4E4: a proposal drafted from the owner's notes after a call (the engine's network/meeting.ts drafts it with
   * draftProposal), kept here so it is raised and decided like any other. needsDay: a next step whose notes wrote no
   * day, so its card on Today asks for the day as Approve's answer (chief/rows.ts needs).
   */
  draftFromMeeting(input: { kind: 'next-step' | 'outreach-draft'; title: string; line: string; needsDay: boolean }): ProposalView {
    const drafted: Drafted = { kind: input.kind, title: input.title, line: input.line, agent: null, spends: false, sends: false };
    const kept: HeldProposal = { ...drafted, id: `proposal-${this.seq++}`, at: this.host.now(), status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(drafted) };
    this.mine().proposals.push(kept);
    if (input.needsDay) this.undated.add(kept.id);
    return this.proposalView(kept);
  }

  /**
   * 4B3: a request on the floor in an agent's chat (agents/threads.ts floorRequest drafts it with draftProposal, kind
   * start-work, and raises it at once), kept here so its card on Today is raised and decided like any other.
   */
  draftFromAgent(input: { title: string; line: string; agent: string; spends: boolean; sends: boolean }): ProposalView {
    const drafted: Drafted = { kind: 'start-work', title: input.title, line: input.line, agent: input.agent, spends: input.spends, sends: input.sends };
    const kept: HeldProposal = { ...drafted, id: `proposal-${this.seq++}`, at: this.host.now(), status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(drafted) };
    this.mine().proposals.push(kept);
    return this.proposalView(kept);
  }

  /**
   * 4J22b: an idea's Start (agents/ideas.ts drafts it with draftProposal, source 'idea'), kept here unraised, so it
   * reaches Today only through venture.proposals.raise, gated on what it acts on like any other.
   */
  draftFromIdea(input: { kind: ProposalKind; title: string; line: string; agent: string | null; spends: boolean; sends: boolean; target: { invoice?: string; order?: string } }): ProposalView {
    const drafted: Drafted = { kind: input.kind, title: input.title, line: LINES[input.kind] ?? input.line, agent: input.agent, spends: input.spends, sends: input.sends };
    const kept: HeldProposal = { ...drafted, id: `proposal-${this.seq++}`, at: this.host.now(), status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(drafted), target: { ...input.target } };
    this.mine().proposals.push(kept);
    return this.proposalView(kept);
  }

  /** 4E4: the proposals from meeting notes that wrote no day. */
  private readonly undated = new Set<string>();

  // ---------------------------------------------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------------------------------------------

  private mine(): Held {
    const current = this.host.current();
    if (!current) throw new EngineError('VAULT_LOCKED', 'Open a business first.');
    let held = this.held.get(current);
    if (!held) { held = { threads: [], proposals: [] }; this.held.set(current, held); }
    return held;
  }

  private summary(thread: HeldThread): ChiefThreadSummary {
    const last = thread.messages.filter((message) => message.from === 'chief').at(-1) ?? thread.messages.at(-1);
    return {
      id: thread.id, title: thread.title, pinned: thread.pinned, lastAt: thread.lastAt, ...(last ? lastLineOf(last.parts) : { lastLine: '', amounts: [] }),
      unread: thread.messages.filter((message) => message.from === 'chief' && !message.read).length,
    };
  }

  private proposalView(proposal: HeldProposal): ProposalView {
    const line = proposal.status === 'drafted' ? TODAY_LINE
      : proposal.status === 'raised' ? `On Today. ${NOTHING_CHANGES}`
        : proposal.status === 'dismissed' ? 'You said not now.'
          : proposal.outcome ?? (proposal.status === 'approved' ? 'Approved.' : 'This could not go ahead.');
    return {
      id: proposal.id, at: proposal.at, kind: proposal.kind, status: proposal.status, title: proposal.title, line, what: proposal.line, agent: proposal.agent,
      rowId: proposal.status === 'raised' ? this.rowId(proposal) : null, digest: proposal.digest, secondAsk: proposal.spends || proposal.sends,
    };
  }

  private messageView(message: HeldMessage): ChiefMessageView {
    const held = this.mine();
    const routed = message.routedTo ? (AGENT_NAMES[this.host.current()] ?? []).find((agent) => agent.id === message.routedTo) : undefined;
    return {
      id: message.id, at: message.at, from: message.from, parts: structuredClone(message.parts),
      proposals: message.proposalIds.flatMap((id) => { const found = held.proposals.find((item) => item.id === id); return found ? [this.proposalView(found)] : []; }),
      routedTo: message.routedTo ? { agent: message.routedTo, name: routed?.name ?? message.routedTo } : null,
      worked: structuredClone(message.worked), dropped: [...message.dropped], counted: message.counted ? structuredClone(message.counted) : null,
    };
  }

  /** venture.chief.threads: pinned first, then by when each last moved, newest first; empty groups left out. */
  private threads(p: Record<string, unknown>): ChiefThreadsView {
    if (Object.keys(p).length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const today = dayOf(this.host.now());
    const monday = mondayOf(today);
    const groupOf = (thread: HeldThread): GroupKey => {
      if (thread.pinned) return 'pinned';
      const day = dayOf(thread.lastAt);
      if (day === today) return 'today';
      if (day >= monday) return 'this-week';
      return day >= addDays(monday, -7) ? 'last-week' : 'earlier';
    };
    const threads = [...this.mine().threads].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return {
      groups: GROUPS.map((group) => ({ key: group.key, label: group.label, threads: threads.filter((thread) => groupOf(thread) === group.key).map((thread) => this.summary(thread)) }))
        .filter((group) => group.threads.length > 0),
      consent: this.consent(),
    };
  }

  private threadOf(id: unknown): HeldThread {
    const thread = typeof id === 'string' ? this.mine().threads.find((item) => item.id === id) : undefined;
    if (!thread) throw new EngineError('INVALID_VENTURE_REQUEST', 'That chat was not found.');
    return thread;
  }

  /** venture.chief.thread.list: the newest page of fifty, oldest first; reading it marks the chief's answers read. */
  private list(p: Record<string, unknown>): ChiefThreadView {
    const thread = this.threadOf(p.threadId);
    for (const message of thread.messages) message.read = true;
    const end = typeof p.before === 'string' ? thread.messages.findIndex((message) => message.id === p.before) : thread.messages.length;
    if (end < 0) throw new EngineError('INVALID_VENTURE_REQUEST', 'That message is not in this chat.');
    const start = Math.max(0, end - PAGE);
    return { thread: this.summary(thread), messages: thread.messages.slice(start, end).map((message) => this.messageView(message)), more: start > 0 };
  }

  private pin(p: Record<string, unknown>): { thread: ChiefThreadSummary } {
    if (typeof p.pinned !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'pinned must be true or false.');
    const thread = this.threadOf(p.threadId);
    thread.pinned = p.pinned;
    return { thread: this.summary(thread) };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The owner's words
  // ---------------------------------------------------------------------------------------------------------------

  /** The one chat consent as it stands (the agents' desk keeps it; it needs no agent). Without that desk it is needed. */
  private consent(): ChatConsentView {
    return this.consentOf ? this.consentOf() : { state: 'needed', text: 'Chats send your message and what Chausar reads to answer it to your AI.', digest: '0'.repeat(64), at: null };
  }

  /** Refuses before anything is kept while the consent is needed or stale, in the engine's words (agents/consent.ts). */
  private requireConsent(): void {
    const consent = this.consent();
    if (consent.state === 'needed') throw new EngineError('CHAT_CONSENT_REQUIRED', consent.text ?? '');
    if (consent.state === 'stale') throw new EngineError('CHAT_CONSENT_STALE', `Your AI connection changed since you agreed, so chats wait until you agree again. ${consent.text ?? ''}`);
  }

  /** venture.chief.thread.send: the owner's words and the chief's reply, in a new chat or the one named. */
  private send(p: Record<string, unknown>): ChiefSendResult {
    if (Object.keys(p).some((key) => key !== 'text' && key !== 'threadId')) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const words = typeof p.text === 'string' ? p.text.replace(/\s+/g, ' ').trim() : '';
    if (!words || words.length > 2000) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your message is from 1 to 2,000 characters.');
    if (KEY.test(words)) throw new EngineError('CHAT_KEY_REFUSED', KEY_REFUSED);
    if (ID_NUMBER.test(words)) throw new EngineError('CHAT_KEY_REFUSED', ID_REFUSED);
    const existing = p.threadId === undefined ? null : this.threadOf(p.threadId);
    this.requireConsent();

    const reply = this.otherBusiness(words) ?? this.routed(words) ?? this.answer(words);
    const held = this.mine();
    const now = this.host.now();
    const thread: HeldThread = existing ?? { id: `chiefthread-${this.seq++}`, title: short(words, 80), pinned: false, lastAt: now, messages: [] };
    if (!existing) held.threads.push(thread);
    const owner: HeldMessage = { id: `chiefmsg-${this.seq++}`, at: now, from: 'owner', text: words, parts: said(words), proposalIds: [], routedTo: reply.routedTo ?? null, worked: [], dropped: [], read: true };
    const proposalIds = (reply.proposals ?? []).map(({ target, ...drafted }) => {
      const kept: HeldProposal = { ...drafted, id: `proposal-${this.seq++}`, at: now, status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(drafted), ...(target ? { target } : {}) };
      held.proposals.push(kept);
      return kept.id;
    });
    const chief: HeldMessage = {
      id: `chiefmsg-${this.seq++}`, at: now, from: 'chief', text: plainOf(reply.parts), parts: reply.parts, proposalIds,
      routedTo: reply.routedTo ?? null, worked: reply.worked ?? [], dropped: [], read: false,
    };
    thread.messages.push(owner, chief);
    thread.lastAt = now;
    this.host.emit({ type: 'chief.message', businessId: this.host.current(), at: now });
    return { thread: this.summary(thread), added: [this.messageView(owner), this.messageView(chief)], ask: reply.ask ?? null };
  }

  /** Another business on this computer the words name: a locked one is never read; else what was saved when it was last open. */
  private otherBusiness(words: string): Reply | null {
    if (!BUSINESS_CUE.test(words)) return null;
    const lower = words.toLowerCase();
    for (const business of this.host.businesses?.() ?? []) {
      if (business.id === this.host.current() || business.name.length < 5 || !lower.includes(business.name.toLowerCase())) continue;
      if (business.opens !== 'with-this-computer') return { parts: said(`${business.name} is locked. Open it to ask about it.`) };
      const across = this.host.ask('venture.money.across', {}) as {
        businesses: { businessId: string; asOf: string | null; invoiced: string | null; received: string | null; owed: string | null; receipts?: { invoiced: string; received: string; owed: string } }[];
      };
      const saved = across.businesses.find((item) => item.businessId === business.id);
      if (!saved?.asOf || !saved.receipts || saved.invoiced === null || saved.received === null || saved.owed === null) {
        return { parts: said(`Chausar has nothing saved about ${business.name} yet. Open it once to ask about it.`) };
      }
      return {
        parts: [
          { kind: 'text', text: `${business.name}, as of ${asOfWords(saved.asOf)}, when you last opened it:` },
          { kind: 'text', text: 'Invoiced this month' }, { kind: 'figure', receiptId: saved.receipts.invoiced, key: 'total', display: saved.invoiced },
          { kind: 'text', text: 'Received this month' }, { kind: 'figure', receiptId: saved.receipts.received, key: 'total', display: saved.received },
          { kind: 'text', text: 'Clients owe' }, { kind: 'figure', receiptId: saved.receipts.owed, key: 'total', display: saved.owed },
          { kind: 'text', text: `Open ${business.name} to see its own receipts.` },
        ],
      };
    }
    return null;
  }

  /** One agent named first (or with an @) gets the words in its chat; two named make the chief ask which, never guess (A15). */
  private routed(words: string): Reply | null {
    const agents = AGENT_NAMES[this.host.current()] ?? [];
    const named = agents.filter((agent) => new RegExp(`(?:^|[^\\p{L}])@?${agent.name}(?![\\p{L}])`, 'iu').test(words));
    if (named.length > 1) {
      const question = `Which agent: ${named.map((agent) => agent.name).join(' or ')}?`;
      return { parts: said(question), ask: question };
    }
    const agent = named[0];
    if (!agent || !(new RegExp(`^@?${agent.name}(?![\\p{L}])`, 'iu').test(words) || new RegExp(`@${agent.name}(?![\\p{L}])`, 'iu').test(words))) return null;
    return { parts: said(`Sent to ${agent.name}. The reply is in ${agent.name}'s chat.`), routedTo: agent.id };
  }

  /** The fake's own answer from the books: what was billed and received, each with its receipt, and a step when money is owed. */
  private answer(words: string): Reply {
    const books = BOOKS[this.host.current()] ?? BOOKS.lumen!;
    const billed = books.figures.find((figure) => figure.operation === 'billed');
    const received = books.figures.find((figure) => figure.operation === 'received');
    const month = MONTHS[Number(books.period.from.slice(5, 7)) - 1]!;
    const parts: ChatPart[] = [{ kind: 'text', text: `Here is where ${month} stands. You have billed` }];
    const worked: ChiefMessageView['worked'] = [];
    if (billed) {
      parts.push({ kind: 'figure', receiptId: billed.receiptId, key: 'total', display: billed.display });
      worked.push({ label: `Billed in ${month}`, value: billed.display, receiptId: billed.receiptId });
    }
    parts.push({ kind: 'text', text: 'and received' });
    if (received) {
      parts.push({ kind: 'figure', receiptId: received.receiptId, key: 'total', display: received.display });
      worked.push({ label: `Received in ${month}`, value: received.display, receiptId: received.receiptId });
    }
    const open = books.openInvoices[0];
    const proposals: NonNullable<Reply['proposals']> = [];
    if (open && /\b(?:owe[sd]?|late|remind\w*|pay\w*|due|unpaid|open)\b/i.test(words)) {
      parts.push({ kind: 'text', text: `${open.clientName} has not paid invoice ${open.number} yet.` });
      proposals.push({ kind: 'draft-reminder', title: `Draft a payment reminder for invoice ${open.number}`, line: LINES['draft-reminder']!, agent: null, spends: false, sends: false, target: { invoice: open.number } });
    }
    if (/\bviews?\b/i.test(words)) parts.push({ kind: 'estimate', text: 'Your last 30 videos got about 18,000 views each in their first 30 days.' });
    return { parts, worked, proposals };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Proposals and their Today cards
  // ---------------------------------------------------------------------------------------------------------------

  /** A card's id: its proposal, its digest and the facts it acts on, so a change to either makes a new card (chief/gate.ts rowVersion). */
  private rowId(proposal: HeldProposal): string {
    return `proposal:${proposal.id}:${proposal.digest.slice(0, 12)}-${this.host.digest(this.facts(proposal)).slice(0, 12)}`;
  }

  /** What a proposal acts on, as it stands now: its invoice's status, or its order's. */
  private facts(proposal: HeldProposal): unknown {
    if (proposal.target?.invoice) {
      const invoice = (this.host.ask('venture.invoice.list', {}) as InvoiceLite[]).find((item) => item.number === proposal.target!.invoice);
      return { invoice: invoice?.status ?? null };
    }
    if (proposal.target?.order) {
      const order = (this.host.ask('venture.order.list', {}) as OrderLite[]).find((item) => item.id === proposal.target!.order);
      return { order: order?.status ?? null };
    }
    return null;
  }

  /** Why a proposal cannot go ahead now, in the engine's words (chief/gate.ts targetOf), or null when it can. */
  private gate(proposal: HeldProposal): string | null {
    const facts = this.facts(proposal) as { invoice?: string | null; order?: string | null } | null;
    if (!facts) return null;
    if ('invoice' in facts) return facts.invoice === null ? 'that invoice was not found.' : facts.invoice === 'issued' || facts.invoice === 'part-paid' ? null : 'this invoice has nothing left to pay.';
    if ('order' in facts) return facts.order === null ? 'that order was not found.' : facts.order === 'open' ? null : 'this order is no longer open.';
    return null;
  }

  /** A raised proposal's card as the engine lists it (chief/rows.ts proposalRow): Not now and Approve, or only Dismiss once the gate fails. */
  private row(proposal: HeldProposal): QueueRow {
    const reason = this.gate(proposal);
    const line = proposal.line.trim();
    const approve: QueueAction = { id: 'approve', label: 'Approve', primary: true, ...(proposal.spends || proposal.sends ? { secondAsk: true } : {}) };
    const seed = {
      id: this.rowId(proposal), businessId: this.host.current(), businessName: this.businessName(), kind: 'proposal' as QueueRow['kind'], createdAt: proposal.raisedAt ?? proposal.at,
      title: proposal.title, ...(proposal.agent ? { agent: proposal.agent } : {}),
      ...(reason
        ? { line: `This can't go ahead now: ${reason}`, actions: [{ id: 'deny', label: 'Dismiss', primary: true }] as QueueAction[] }
        : {
          line: line.includes(NOTHING_CHANGES) ? line : `${line} ${NOTHING_CHANGES}`, actions: [{ id: 'deny', label: 'Not now', primary: false }, approve] as QueueAction[],
          // 4E4: a next step from meeting notes with no day asks for the day when it is approved.
          ...(this.undated.has(proposal.id) ? { needs: { answer: 'day' as const, line: 'Pick the day for this step, then approve.' } } : {}),
        }),
    };
    return { ...seed, digest: this.host.digest(seed) };
  }

  /**
   * Today's proposal cards as they stand (fake.ts queueList calls this before it lists): each raised proposal's card is
   * made again from what it acts on now, so one whose invoice was paid or whose order closed offers only Dismiss.
   */
  syncRows(): void {
    const current = this.host.current();
    const held = current ? this.held.get(current) : undefined;
    if (!held) return;
    let rows = this.host.rows();
    for (const proposal of held.proposals.filter((item) => item.status === 'raised')) {
      const fresh = this.row(proposal);
      const old = rows.find((row) => row.id.startsWith(`proposal:${proposal.id}:`));
      if (old?.id === fresh.id) continue;
      rows = [...rows.filter((row) => !row.id.startsWith(`proposal:${proposal.id}:`)), fresh];
    }
    if (rows !== this.host.rows()) this.host.setRows(rows);
  }

  private proposalOf(p: Record<string, unknown>): HeldProposal {
    if (Object.keys(p).some((key) => key !== 'id') || typeof p.id !== 'string') throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const proposal = this.mine().proposals.find((item) => item.id === p.id);
    if (!proposal) throw new EngineError('INVALID_VENTURE_REQUEST', NOT_FOUND);
    return proposal;
  }

  /** venture.proposals.raise: a drafted proposal becomes a card on Today, announced once; a raised one answers with its card. */
  private raise(p: Record<string, unknown>): { proposal: ProposalView; rowId: string | null; line: string } {
    const proposal = this.proposalOf(p);
    if (proposal.status === 'raised') return { proposal: this.proposalView(proposal), rowId: this.rowId(proposal), line: 'It is on Today already.' };
    if (proposal.status !== 'drafted') throw new EngineError('PROPOSAL_DECIDED', DECIDED);
    const reason = this.gate(proposal);
    if (reason) throw new EngineError('APPROVAL_STALE', `This changed since Chausar drafted it: ${reason} Ask Chausar again.`);
    const at = this.host.now();
    proposal.status = 'raised';
    proposal.raisedAt = at;
    this.host.setRows([...this.host.rows(), this.row(proposal)]);
    this.host.emit({ type: 'proposal.created', businessId: this.host.current(), at });
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at });
    return { proposal: this.proposalView(proposal), rowId: this.rowId(proposal), line: 'On Today for your approval.' };
  }

  /** venture.proposals.dismiss: a drafted or raised proposal is set aside, its card goes, and nothing changes. */
  private dismiss(p: Record<string, unknown>): { proposal: ProposalView } {
    const proposal = this.proposalOf(p);
    if (proposal.status !== 'drafted' && proposal.status !== 'raised') throw new EngineError('PROPOSAL_DECIDED', DECIDED);
    const wasRaised = proposal.status === 'raised';
    proposal.status = 'dismissed';
    proposal.outcome = 'Not now.';
    if (wasRaised) {
      this.host.setRows(this.host.rows().filter((row) => !row.id.startsWith(`proposal:${proposal.id}:`)));
      this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    }
    return { proposal: this.proposalView(proposal) };
  }

  private businessName(): string {
    return this.host.businesses?.().find((business) => business.id === this.host.current())?.name ?? this.host.current();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The fit on Start
  // ---------------------------------------------------------------------------------------------------------------

  /** venture.chief.fit: one way from venture.playbooks.list, labelled a model estimate; null when it is not listed. */
  private fit(p: Record<string, unknown>): ChiefFit | null {
    if (Object.keys(p).length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    this.mine();
    const way = fakeWays({}, null).ways.find((item) => item.playbook === 'social-agency');
    return way ? { wayId: way.id, line: 'Your team already writes titles and hooks, and that carries over to posts for local shops.', estimate: true } : null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The sample business's chats
  // ---------------------------------------------------------------------------------------------------------------

  /** Lumen Studio's chats, each as the engine would have stored it: one today, one this week, one last week. */
  private sample(): Held {
    const now = Date.parse(this.host.now());
    const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    const books = BOOKS.lumen!;
    const billed = books.figures.find((figure) => figure.operation === 'billed')!;
    const received = books.figures.find((figure) => figure.operation === 'received')!;
    const draft = (id: string, kind: ProposalKind, title: string, spends: boolean, at: string, target: HeldProposal['target']): HeldProposal => {
      const base: Drafted = { kind, title, line: LINES[kind]!, agent: null, spends, sends: false };
      return { ...base, id, at, status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(base), target };
    };
    const message = (id: string, at: string, from: 'owner' | 'chief', parts: ChatPart[], extra: Partial<HeldMessage> = {}): HeldMessage => ({
      id, at, from, text: plainOf(parts), parts, proposalIds: [], routedTo: null, worked: [], dropped: [], read: true, ...extra,
    });
    const billedAt = ago(2);
    const titlesAt = ago(50);
    const trailerAt = ago(9 * 24);
    const proposals = [
      draft('proposal-reminder-0039', 'draft-reminder', 'Draft a payment reminder for invoice INV-0039', false, billedAt, { invoice: 'INV-0039' }),
      draft('proposal-run-boat-14', 'start-run', "Start work on Boat Audio's order", true, billedAt, { order: 'o-boat-14' }),
    ];
    return {
      proposals,
      threads: [
        {
          id: 'chiefthread-billed', title: 'How much have we billed this month?', pinned: false, lastAt: billedAt,
          messages: [
            message('chiefmsg-billed-1', billedAt, 'owner', said('How much have we billed this month?')),
            message('chiefmsg-billed-2', billedAt, 'chief', [
              { kind: 'text', text: 'This month you have billed' }, { kind: 'figure', receiptId: billed.receiptId, key: 'total', display: billed.display },
              { kind: 'text', text: 'and received' }, { kind: 'figure', receiptId: received.receiptId, key: 'total', display: received.display },
              { kind: 'text', text: "Boat Audio has not paid invoice INV-0039 yet, and episode 14's order is still open." },
            ], {
              proposalIds: proposals.map((proposal) => proposal.id), read: false,
              worked: [{ label: 'Billed in October', value: billed.display, receiptId: billed.receiptId }, { label: 'Received in October', value: received.display, receiptId: received.receiptId }],
            }),
          ],
        },
        {
          id: 'chiefthread-titles', title: 'How are the titles for episode 15 doing?', pinned: false, lastAt: titlesAt,
          messages: [
            message('chiefmsg-titles-1', titlesAt, 'owner', said('How are the titles for episode 15 doing?')),
            message('chiefmsg-titles-2', titlesAt, 'chief', [
              { kind: 'text', text: 'Researcher checked three titles against your last videos.' },
              { kind: 'estimate', text: 'Option B should get about 18,000 views in its first 30 days.' },
              { kind: 'text', text: 'Researcher waits for you to pick one on Today.' },
            ]),
          ],
        },
        {
          id: 'chiefthread-trailer', title: '@Editor cut a short trailer for episode 14', pinned: false, lastAt: trailerAt,
          messages: [
            message('chiefmsg-trailer-1', trailerAt, 'owner', said('@Editor cut a short trailer for episode 14'), { routedTo: 'editor' }),
            message('chiefmsg-trailer-2', trailerAt, 'chief', said("Sent to Editor. The reply is in Editor's chat."), { routedTo: 'editor' }),
          ],
        },
      ],
    };
  }
}
