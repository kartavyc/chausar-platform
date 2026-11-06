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

import { formatMoment, ownerZone } from '../../../../platform/runtime/owner-format';
import {
  EngineError, type ChatConsentView, type ChatPart, type ChiefCounted, type ChiefFit, type ChiefLineAmount, type ChiefMessageView, type ChiefSendResult, type ChiefThreadSummary, type ChiefThreadView,
  type ChiefThreadsView, type ChiefSettleResult, type ChiefSnoozeOption, type ChiefThreadState, type ChiefThreadStateInput, type ChiefThreadStateResult, type InvoiceLite, type OrderLite, type ProposalKind, type ProposalStatus, type ProposalView, type QueueAction, type QueueRow,
} from './types';
import { BOOKS } from './fixtures';
import { fakeWays } from './fake-start';
import type { W4DeskHost } from './fake-w4';

const CHIEF_METHODS = new Set<string>([
  'venture.chief.threads', 'venture.chief.thread.list', 'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.chief.fit',
  'venture.proposals.raise', 'venture.proposals.dismiss',
  // W6 6G1 (D42): a chat's state and the quiet days before one settles (chief/states.ts).
  'venture.chief.thread.state', 'venture.chief.settle.set',
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
  { key: 'last-week', label: 'Last week' }, { key: 'earlier', label: 'Earlier' }, { key: 'snoozed', label: 'Snoozed' },
] as const;
/** W6 6G1: chief/states.ts, word for word: the quiet days by default, the most the owner may choose, and the refusal. */
const SETTLE_DAYS = 7;
const MAX_SETTLE_DAYS = 365;
const WAITING_REFUSED = 'This chat is waiting for you. Answer it or decide its step first.';
const STATES: readonly ChiefThreadState[] = ['pinned', 'active', 'snoozed', 'settled'];
const PRESETS = ['later', 'tomorrow', 'next-week'] as const;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY_MS = 86_400_000;
const KOLKATA_MS = 330 * 60_000;
type GroupKey = (typeof GROUPS)[number]['key'];
const LINES: Partial<Record<ProposalKind, string>> = {
  'start-run': 'This starts a job on your AI for this order. Each step that needs you still asks first.',
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
  recordReport?:true;
  worked: ChiefMessageView['worked']; dropped: string[]; read: boolean; counted?: ChiefCounted | null;
  /** W6 6G1: the chief's question back, waiting for the owner until they write again. */
  ask?: string;
}
/** W6 6G1: snoozedUntil, settledAt and stateAt are the owner's snooze, Settle and last state change, as the engine keeps them. */
interface HeldThread { id: string; title: string; pinned: boolean; lastAt: string; messages: HeldMessage[]; snoozedUntil?: string | null; settledAt?: string | null; stateAt?: string | null }
interface Held { threads: HeldThread[]; proposals: HeldProposal[] }
type Reply = { parts: ChatPart[]; ask?: string; routedTo?: string; worked?: ChiefMessageView['worked']; proposals?: (Drafted & { target?: HeldProposal['target'] })[]; counted?: ChiefCounted };
/** One-shot A3 (S3), chief/answer.ts AI_FAILED_LEAD, word for word. */
export const AI_FAILED_LEAD = "Your AI couldn't answer this time, so here is what Chausar's records say.";

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
/** '22 Oct 2026, 6:00 pm' in India, as the engine's asOfWords says it (B2). */
function asOfWords(iso: string): string {
  return formatMoment(iso, ownerZone('IN', 'UTC'));
}

/** W6 6G1: a wake time in India as chief/states.ts wakeWords says it: '22 Oct 2026, 9:00 am'. */
function wakeWords(iso: string): string {
  return formatMoment(iso, ownerZone('IN', 'UTC'));
}

/** W6 6G1: the snooze choices now (chief/states.ts snoozeOptions): in three hours, tomorrow 09:00, next Monday 09:00, in Kolkata. */
function snoozeOptions(now: string): ChiefSnoozeOption[] {
  const nowMs = Date.parse(now);
  const today = dayOf(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const morning = (day: string) => new Date(Date.parse(`${day}T09:00:00.000Z`) - KOLKATA_MS).toISOString();
  const all: ChiefSnoozeOption[] = [
    { id: 'later', until: new Date(Math.floor((nowMs + 3 * 3_600_000) / 60_000) * 60_000).toISOString() },
    { id: 'tomorrow', until: morning(addDays(today, 1)) },
    { id: 'next-week', until: morning(addDays(today, ((8 - weekday) % 7) || 7)) },
  ];
  const seen = new Set<string>();
  return all.filter((option) => option.until > now).sort((a, b) => a.until.localeCompare(b.until)).filter((option) => !seen.has(option.until) && Boolean(seen.add(option.until)));
}

/** W6 6G1: a chat's state now (chief/states.ts stateOf): pinned; waiting is active; the owner's Settle; a snooze ahead; the quiet days. */
function stateOf(thread: HeldThread, waiting: boolean, now: string, days: number): Pick<ChiefThreadSummary, 'state' | 'snoozedUntil' | 'settled'> {
  const active = { state: 'active' as const, snoozedUntil: null, settled: null };
  if (thread.pinned) return { ...active, state: 'pinned' };
  if (waiting) return active;
  if (thread.settledAt) return { state: 'settled', snoozedUntil: null, settled: { at: thread.settledAt, by: 'owner' } };
  const nowMs = Date.parse(now);
  const until = thread.snoozedUntil ?? null;
  if (until && Date.parse(until) > nowMs) return { state: 'snoozed', snoozedUntil: until, settled: null };
  if (days > 0) {
    const due = Math.max(Date.parse(thread.lastAt), thread.stateAt ? Date.parse(thread.stateAt) : 0, until ? Date.parse(until) : 0) + days * DAY_MS;
    if (nowMs >= due) return { state: 'settled', snoozedUntil: null, settled: { at: new Date(due).toISOString(), by: 'auto' } };
  }
  return active;
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

  /** Private deterministic source report, stored only after the exact routine occurrence approval. */
  keepVaReport(routineId:string,title:string,text:string):void{const held=this.mine(),id='va-routine-'+routineId,now=this.host.now();let thread=held.threads.find(t=>t.id===id);if(!thread){thread={id,title,pinned:true,lastAt:now,messages:[]};held.threads.push(thread);}thread.lastAt=now;thread.messages.push({id:'va-report-'+(++this.seq),at:now,from:'chief',text,parts:said(text),proposalIds:[],routedTo:null,worked:[],dropped:[],read:false,recordReport:true});this.host.emit({type:'chief.message',businessId:this.host.current(),at:now});}
  eraseVaReports():void{for(const thread of this.mine().threads)thread.messages=thread.messages.filter(m=>!m.recordReport);}

  /**
   * Tests (one-shot A3, S3): the owner's AI call fails from now on, as chief/answer.ts meets it. reason: the failure's own
   * owner words (a named failure such as a used-up plan), or null for one with none (a time-out). Null turns it off.
   */
  failAi(failure: { reason: string | null } | null): void { this.aiFails = failure; }
  private aiFails: { reason: string | null } | null = null;

  handles(method: string): boolean {
    return CHIEF_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.chief.threads': return this.threads(p);
      case 'venture.chief.thread.list': return this.list(p);
      case 'venture.chief.thread.send': return this.send(p);
      case 'venture.chief.thread.pin': return this.pin(p);
      case 'venture.chief.thread.state': return this.setState(p);
      case 'venture.chief.settle.set': return this.settleSet(p);
      case 'venture.chief.fit': return this.fit(p);
      case 'venture.proposals.raise': return this.raise(p);
      case 'venture.proposals.dismiss': return this.dismiss(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', 'The sample business can\'t do that yet.');
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

  /**
   * W6 6H1: a mini app's proposal (apps/apps.ts drafts it with draftProposal, source 'app', and raises it at once), with
   * the app's own line, so its card is on Today and decided like any other. Returns its id and title.
   */
  draftFromApp(input: { kind: ProposalKind; title: string; line: string; target: { invoice?: string; order?: string } }): { id: string; title: string } {
    const drafted: Drafted = { kind: input.kind, title: input.title, line: input.line, agent: null, spends: false, sends: false };
    const kept: HeldProposal = { ...drafted, id: `proposal-${this.seq++}`, at: this.host.now(), status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(drafted), target: { ...input.target } };
    this.mine().proposals.push(kept);
    this.raise({ id: kept.id });
    return { id: kept.id, title: kept.title };
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
    const waiting = this.waiting(thread);
    return {
      id: thread.id, title: thread.title, pinned: thread.pinned, lastAt: thread.lastAt, ...(last ? lastLineOf(last.parts) : { lastLine: '', amounts: [] }),
      unread: thread.messages.filter((message) => message.from === 'chief' && !message.read).length,
      ...stateOf(thread, waiting, this.host.now(), this.settleDays()), waiting,
    };
  }

  /** W6 6G1: the owner's quiet days per business (chief/states.ts settleDaysOf), 7 until they choose. */
  private readonly settleDaysOf = new Map<string, number>();
  private settleDays(): number {
    return this.settleDaysOf.get(this.host.current()) ?? SETTLE_DAYS;
  }

  /** W6 6G1: a step in the chat waits for Start or approval, or the chief's question is the last word (chief/states.ts waitingOf). */
  private waiting(thread: HeldThread): boolean {
    const last = thread.messages.at(-1);
    if (last?.from === 'chief' && last.ask) return true;
    const ids = new Set(thread.messages.flatMap((message) => message.proposalIds));
    return this.mine().proposals.some((item) => ids.has(item.id) && (item.status === 'drafted' || item.status === 'raised'));
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
    // W6 6G1: snoozed chats come last; settled ones leave the groups for the archive.
    const groupOf = (thread: ChiefThreadSummary): GroupKey | null => {
      if (thread.state === 'settled') return null;
      if (thread.state === 'pinned') return 'pinned';
      if (thread.state === 'snoozed') return 'snoozed';
      const day = dayOf(thread.lastAt);
      if (day === today) return 'today';
      if (day >= monday) return 'this-week';
      return day >= addDays(monday, -7) ? 'last-week' : 'earlier';
    };
    const threads = [...this.mine().threads].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((thread) => this.summary(thread));
    return {
      groups: GROUPS.map((group) => ({ key: group.key, label: group.label, threads: threads.filter((thread) => groupOf(thread) === group.key) }))
        .filter((group) => group.threads.length > 0),
      consent: this.consent(),
      settled: threads.filter((thread) => thread.settled).sort((a, b) => b.settled!.at.localeCompare(a.settled!.at)),
      settleAfterDays: this.settleDays(),
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
    const summary = this.summary(thread);
    return {
      thread: summary, messages: thread.messages.slice(start, end).map((message) => this.messageView(message)), more: start > 0,
      snooze: summary.waiting ? [] : snoozeOptions(this.host.now()),
    };
  }

  /** venture.chief.thread.pin: the same as venture.chief.thread.state pinned or active (6G1 clears a snooze or a Settle). */
  private pin(p: Record<string, unknown>): { thread: ChiefThreadSummary } {
    if (typeof p.pinned !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'pinned must be true or false.');
    const thread = this.threadOf(p.threadId);
    Object.assign(thread, { pinned: p.pinned, snoozedUntil: null, settledAt: null, stateAt: this.host.now() });
    return { thread: this.summary(thread) };
  }

  /**
   * W6 6G1 venture.chief.thread.state (chief/states.ts): pins, unpins, snoozes or settles a chat, with the request that
   * undoes it exactly and the engine's words. A chat that waits for the owner cannot be snoozed or settled.
   */
  private setState(p: Record<string, unknown>): ChiefThreadStateResult {
    const bad = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
    if (Object.keys(p).some((key) => !['threadId', 'state', 'preset', 'until'].includes(key)) || p.threadId === undefined || p.state === undefined) throw bad('Send the required fields and nothing else.');
    if (typeof p.threadId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(p.threadId)) throw bad('Chat must be a known identifier.');
    if (typeof p.state !== 'string' || !(STATES as readonly string[]).includes(p.state)) throw bad('state is pinned, active, snoozed or settled.');
    const state = p.state as ChiefThreadState;
    if (state === 'snoozed') {
      if ((p.preset === undefined) === (p.until === undefined)) throw bad('A snooze takes a preset or a time.');
      if (p.preset !== undefined && !(typeof p.preset === 'string' && (PRESETS as readonly string[]).includes(p.preset))) throw bad('preset is later, tomorrow or next-week.');
      if (p.until !== undefined && !(typeof p.until === 'string' && INSTANT.test(p.until) && Number.isFinite(Date.parse(p.until)))) throw bad('Send the time like 2026-10-22T03:30:00.000Z.');
    } else if (p.preset !== undefined || p.until !== undefined) throw bad('Only a snooze takes a preset or a time.');
    const thread = this.threadOf(p.threadId);
    const now = this.host.now();
    const before = this.summary(thread);
    if ((state === 'snoozed' || state === 'settled') && before.waiting) throw bad(WAITING_REFUSED);
    let until: string | null = null;
    if (state === 'snoozed') {
      until = typeof p.until === 'string' ? p.until : snoozeOptions(now).find((option) => option.id === p.preset)?.until ?? null;
      if (!until || until <= now) throw bad('Pick a time that is still ahead.');
    }
    Object.assign(thread, { pinned: state === 'pinned', snoozedUntil: until, settledAt: state === 'settled' ? now : null, stateAt: now });
    const undo: ChiefThreadStateInput = before.state === 'snoozed' && before.snoozedUntil ? { threadId: thread.id, state: 'snoozed', until: before.snoozedUntil } : { threadId: thread.id, state: before.state };
    const line = state === 'pinned' ? 'Pinned to the top of your chats.'
      : state === 'snoozed' && until ? `Snoozed until ${wakeWords(until)}. It comes back early if it needs you.`
        : state === 'settled' ? 'Moved to old chats. It stays there until you open it again.' : 'Back in your chats.';
    return { thread: this.summary(thread), undo, line };
  }

  /** W6 6G1 venture.chief.settle.set (chief/states.ts): the quiet days, 0 (never) to 365, with the number before for Undo. */
  private settleSet(p: Record<string, unknown>): ChiefSettleResult {
    if (Object.keys(p).some((key) => key !== 'days') || p.days === undefined) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const days = p.days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_SETTLE_DAYS) throw new EngineError('INVALID_VENTURE_REQUEST', 'days is a whole number from 0 (never) to 365.');
    this.mine();
    const undo = this.settleDays();
    this.settleDaysOf.set(this.host.current(), days);
    return { days, undo, line: days === 0 ? 'Chats never settle on their own.' : `Chats settle after ${days} quiet ${days === 1 ? 'day' : 'days'}.` };
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

    const reply = this.otherBusiness(words) ?? this.routed(words) ?? (this.aiFails ? this.recordsAnswer(this.aiFails.reason) : this.answer(words));
    const held = this.mine();
    const now = this.host.now();
    const thread: HeldThread = existing ?? { id: `chiefthread-${this.seq++}`, title: short(words, 80), pinned: false, lastAt: now, messages: [] };
    if (!existing) held.threads.push(thread);
    // W6 6G1: the owner writing in a snoozed or settled chat brings it back.
    thread.snoozedUntil = null;
    thread.settledAt = null;
    const owner: HeldMessage = { id: `chiefmsg-${this.seq++}`, at: now, from: 'owner', text: words, parts: said(words), proposalIds: [], routedTo: reply.routedTo ?? null, worked: [], dropped: [], read: true };
    const proposalIds = (reply.proposals ?? []).map(({ target, ...drafted }) => {
      const kept: HeldProposal = { ...drafted, id: `proposal-${this.seq++}`, at: now, status: 'drafted', raisedAt: null, outcome: null, digest: this.host.digest(drafted), ...(target ? { target } : {}) };
      held.proposals.push(kept);
      return kept.id;
    });
    const chief: HeldMessage = {
      id: `chiefmsg-${this.seq++}`, at: now, from: 'chief', text: plainOf(reply.parts), parts: reply.parts, proposalIds,
      routedTo: reply.routedTo ?? null, worked: reply.worked ?? [], dropped: [], read: false, ...(reply.ask ? { ask: reply.ask } : {}),
      ...(reply.counted ? { counted: reply.counted } : {}),
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

  /**
   * One-shot A3 (S3), as chief/answer.ts recordsAnswer after a failed AI call: the plain lead, the failure's own words
   * when it has them, then what the records say (each figure after its label, with its receipt) and the counts by code
   * for the last three months. Never a figure the books do not hold.
   */
  private recordsAnswer(reason: string | null): Reply {
    const books = BOOKS[this.host.current()] ?? BOOKS.lumen!;
    const month = MONTHS[Number(books.period.from.slice(5, 7)) - 1]!;
    const shown = books.figures.filter((figure) => figure.operation === 'billed' || figure.operation === 'received').slice(0, 4);
    const parts: ChatPart[] = [{ kind: 'text', text: AI_FAILED_LEAD }, ...(reason ? [{ kind: 'text' as const, text: reason }] : [])];
    const worked: ChiefMessageView['worked'] = [];
    for (const figure of shown) {
      const label = `${figure.operation === 'billed' ? 'Billed' : 'Received'} in ${month}`;
      parts.push({ kind: 'text', text: `${label}:` }, { kind: 'figure', receiptId: figure.receiptId, key: 'total', display: figure.display });
      worked.push({ label, value: figure.display, receiptId: figure.receiptId });
    }
    return { parts, worked, counted: this.countedByCode() };
  }

  /** delivery/fallbacks.ts countedByCode, as far as the fake holds those records: each kind's count and the last three months. */
  private countedByCode(): ChiefCounted {
    const list = (method: string) => { try { return this.host.ask(method, {}) as { at?: string; createdAt?: string }[]; } catch { return []; } };
    const kinds: [string, { at?: string; createdAt?: string }[]][] = [
      ['clients', list('venture.client.list')], ['orders', list('venture.order.list')], ['invoices', list('venture.invoice.list')],
      ['runs', list('venture.delivery.list')], ['people', []], ['leads', []],
    ];
    const months: string[] = [];
    for (let day = dayOf(this.host.now()); months.length < 3; day = addDays(`${day.slice(0, 7)}-01`, -1)) months.unshift(day.slice(0, 7));
    const all = kinds.flatMap(([, records]) => records);
    return {
      entities: kinds.map(([kind, records]) => ({ kind, count: records.length })),
      months: months.map((month) => ({ month, count: all.filter((record) => { const at = record.at ?? record.createdAt; return typeof at === 'string' && dayOf(at).startsWith(month); }).length })),
    };
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
    // W6 6G1: six quiet days, so it is still in the list; the offer chat has been quiet past seven, so it settled on its own.
    const trailerAt = ago(6 * 24);
    const offerAt = ago(12 * 24);
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
        {
          id: 'chiefthread-offer', title: 'Which offer should the channel page lead with?', pinned: false, lastAt: offerAt,
          messages: [
            message('chiefmsg-offer-1', offerAt, 'owner', said('Which offer should the channel page lead with?')),
            message('chiefmsg-offer-2', offerAt, 'chief', said('Lead with long episode edits. Most of your orders are for those.')),
          ],
        },
      ],
    };
  }
}
