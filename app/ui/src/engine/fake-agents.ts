/**
 * The fake engine's answers for agent chat, instructions, standing orders and notes (Ink v2 wave 4, package 4B3), as
 * the engine's 4B1 and 4B2 answer them (platform/runtime/venture/agents/threads.ts, consent.ts, proposals.ts,
 * versions.ts, notes.ts, standing.ts, answer.ts): one thread per agent, the owner's words read by code ("from now on"
 * drafts a change to the agent's instructions; "remember that" drafts a note; a request on the floor goes to Today; a
 * request for work suggests a New order; a reply while the agent's run waits on the owner is its answer), the one chat
 * consent per business (asked only when an AI serves chats), versions that are never overwritten and Undo, and notes
 * that are corrected, forgotten (erased, so never undone) and undone. venture.agents.orders.list also answers the
 * version in use, the agent's steps and what Undo would do, read without writing, as the engine does (4B3).
 *
 * With only templates (Lumen's sample) nothing is sent and no consent is asked; a business with its own AI (Ledgerline's
 * Sonnet key) asks first. The fake never calls a model: a "from now on" change is the template patch the engine drafts
 * from the owner's own words, and a question gets the engine's template answer from the records.
 */

import {
  EngineError, type AgentMessageView, type AgentNoteChange, type AgentNoteLoad, type AgentNoteScope, type AgentNoteView, type AgentNotesView,
  type AgentProposalView, type AgentRunItem, type AgentSendResult, type AgentSuggestion, type AgentThreadItem, type AgentThreadView, type AgentView,
  type ChatConsentView, type ChatPart, type ClientLite, type DiffLine, type ImprovementStatusLite, type ModelStatusLite, type NoteChangeView,
  type PlaybookCheckId, type ProposalView, type RunDetail, type StandingOrdersView, type StandingOrderView, type StandingUndoView, type TeamListView,
} from './types';
import { MODEL_PRESETS } from './fixtures-business';
import type { W4DeskHost } from './fake-w4';

const AGENT_METHODS = new Set<string>([
  'venture.agents.thread.list', 'venture.agents.thread.send', 'venture.agents.proposal.decide', 'venture.agents.version.undo',
  'venture.agents.orders.list', 'venture.chats.consent', 'venture.agents.notes.list', 'venture.agents.notes.edit',
  'venture.agents.notes.forget', 'venture.agents.notes.undo',
]);

// The engine's words (agents/*.ts, delivery/harness/patches.ts).
const KEEPER_ID = 'keeper';
const KEEPER_IS_CODE = 'Keeper is code, not AI. It has no chat; its jobs are on Team.';
const NOT_FOUND = 'That agent was not found.';
const KEY_REFUSED = 'That looks like a key. Keys go in Connections, never in chat.';
const FLOOR_REPLY = 'That needs your approval on Today.';
const WORK_REPLY = 'I can start on that as a new order. Check the details in New order, then create it.';
const ANSWERED_LINE = 'I passed this on as your answer to my question. The next step waits for your approval on Today.';
const STANDING_REPLY = "You said 'from now on', so here is the change to my instructions.";
const NOTE_REPLY = 'Here is the note I would keep. Nothing is saved until you accept it.';
const NOTE_KEPT_LINE = "I'll keep this note. You can correct it, forget it or undo it in my notes.";
const NOTE_REJECTED_LINE = "You said no, so nothing was saved. I won't ask to keep these words again.";
const NOTE_SAID_NO = "You said no to keeping this note before, so I won't ask again. To keep it now, add it in my notes.";
const NOTE_WAITING = 'That note is waiting for your answer above.';
const NOTE_ALREADY = 'I already keep that note.';
const NOTE_ERASED_LINE = 'These words were erased: you asked Chausar to forget them.';
const FORGOTTEN_NOTE = 'A note you have forgotten since.';
const FORGET_LINE = "Forget erases these words. You can't undo it.";
const FORGET_FINAL = "Forget erased this note's words, so it can't be undone.";
const NOTE_CHANGED_LINE = 'This note changed since you opened it. Your draft is still here.';
const ERASED_MESSAGE = 'Erased: you asked me to forget these words.';
const FLOOR_REASON = 'Publishing, sending, money out and deleting always ask you first, at every posture. Chat does not change that.';
const MONEY_REASON = "Spend, prices and discounts are set by you in Money and Business, not by an agent's instructions.";
const CONTROLS_REASON = 'Tools, checks and limits are not changed from chat.';
const ALWAYS_LIMIT = 2000;
const MAX_NOTE = 600;

// What code reads in the owner's words (agents/standing.ts, agents/answer.ts, delivery/harness/patches.ts), shortened.
const STRONG_STANDING = [/\bfrom now on\b/i, /\bgoing forward\b/i, /\bfrom here on\b/i, /\bin (?:the )?future\b/i, /\bnext time\b/i, /अब से/u, /आगे से/u, /\bab se\b/i, /\baage se\b/i];
const WEAK_STANDING = [/\balways\b/i, /\bnever\b/i, /\bi(?:'d| would)? prefer\b/i, /हमेशा/u, /कभी\s+(?:भी\s+)?नहीं/u, /\bhamesha\b/i];
const NOTE_WORDS = [/\bremember\b/i, /\bkeep in mind\b/i, /\bnote that\b/i, /^\s*my\s+(?:[\p{L}\p{Nd}'-]+\s+){0,3}(?:is|are|was|has|have|changed)\b/iu, /याद\s+(?:रखना|रखें|रखिए|रखो)/u, /ध्यान\s+(?:रखना|रखें|रखिए|रखो)/u, /^\s*(?:मेरा|मेरी|मेरे)\s/u];
const QUESTION_WORD = /^\s*(?:(?:why|what|when|where|who|which|how|kya|kyun|kab|kaise|kaun|kahan)\b|(?:क्या|क्यों|कब|कैसे|कौन|कहाँ|कहां)(?=\s|[?？]|$))/iu;
const HELPING_VERB = /^\s*(?:did|does|do|is|are|was|were|has|have|had)\b/i;
const POLITE = /^\s*(?:can|could|would|will) you\b|\bplease\b/i;
const ENDS_ASKING = /[?？]\s*$/u;
const LEAD = /^\s*(?:from now on|going forward|from here on|in (?:the )?future|next time|अब से|आगे से|ab se|aage se)\s*[,:;]?\s*/iu;
const NOTE_LEAD = /^\s*(?:(?:please|also|and|ok|okay)[\s,]+)*(?:remember|keep\s+in\s+mind|please\s+note|note|याद\s+(?:रखना|रखें|रखिए|रखो)|ध्यान\s+(?:रखना|रखें|रखिए|रखो))(?:\s+(?:that|this|to|ki|कि))?(?:\s*[,:;.-]\s*|\s+|$)/iu;
const NOTE_TAIL = /[\s,;:.-]*(?:(?:please\s+)?remember(?:\s+(?:that|this|it))?|keep\s+(?:that|this|it)\s+in\s+mind|याद\s+(?:रखना|रखें|रखिए|रखो)|ध्यान\s+(?:रखना|रखें|रखिए|रखो))\s*[.!।]?\s*$/iu;
const FLOOR_WORDS: readonly RegExp[] = [
  /\b(?:publish\w*|go live|upload\w*|post (?:it|this|the))\b|पब्लिश|अपलोड|पोस्ट\s+कर/iu,
  /\b(?:send\w*|email\w*|whatsapp|message the client|reply to the client)\b|भेज/iu,
  /\b(?:invoic\w*|bill the client)\b/iu,
  /\b(?:pay|paid|payment|refund\w*|transfer\w*|spend\w*)\b|भुगतान|पेमेंट|रिफंड|खर्च/iu,
  /\b(?:discount\w*|(?:change|raise|lower|cut|drop|increase|decrease|set)\b[^.?!]*\bprices?)\b|कीमत|दाम|रेट|छूट/iu,
  /\b(?:delete|erase)\b|डिलीट|मिटा/iu,
];
const WORK_START = /^\s*(?:please\s+)?(?:cut|edit|make|draft|write|create|prepare|start|render|find|pick|build|redo|shorten|trim|do|translate|record|design|rework|fix|tidy|add|change|update|split|merge|caption|script|plan)\b/i;
const CONTROL: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(?:publish\w*|upload\w*|post\w*|send\w*|delete|refund\w*|pay\w*)\b|पब्लिश|अपलोड|भुगतान|डिलीट|भेज/iu, reason: FLOOR_REASON },
  { pattern: /\b(?:spend\w*|spent|budget\w*|prices?|pricing|discount\w*|fees?|charg(?:e|es|ed|ing)|rates?)\b|कीमत|दाम|रेट|छूट|खर्च|बजट/iu, reason: MONEY_REASON },
  { pattern: /\btools?\b|\bchecks?\b|\blimits?\b|\bpermissions?\b|\bposture\b|\bauto(?:matically)?[ -]approv\w*\b/i, reason: CONTROLS_REASON },
];
const KEYLIKE = /\bsk-[A-Za-z0-9_-]{16,}|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/;
const STATE_WORDS: Readonly<Record<RunDetail['state'], string>> = { active: 'in progress', waiting: 'waiting on you', done: 'done', failed: 'stopped with a failure' };
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

// The sample playbook's own words for the fixtures' steps: guidance lines and the checks each step's work must pass.
const GUIDANCE: Readonly<Record<string, readonly string[]>> = {
  cut: ['Keep the length the client asked for.', 'Take out long silences and repeated takes.'],
  shorts: ['Pick moments that make sense without the episode.', 'Render shorts in portrait.'],
  titles: ['Offer two titles and say which one you would pick.'],
  brief: ["Read the sponsor's brief before anything else."],
  match: ['Match by amount first, then by date and reference.'],
  draft: ['Use the client name exactly as it is on file.'],
};
const CHECKS: Readonly<Record<string, readonly PlaybookCheckId[]>> = {
  shorts: ['length-bounds', 'no-done-claims'],
  finish: ['required-sections', 'house-style', 'claims-grounded'],
  titles: ['no-numeric-prose'],
  thumbs: ['house-style'],
  gst: ['figures-resolve', 'receipts'],
  draft: ['figures-resolve', 'receipts'],
};
/** Steps the fixtures hold that check the agent's work, as the engine's verify step does. */
const VERIFY_STEPS = new Set(['finish', 'thumbs', 'gst']);

const clone = <T>(value: T): T => structuredClone(value);
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
const keyOf = (text: string) => tidy(text).toLowerCase();

type Snap = { text: string; hash: string; scope: AgentNoteScope; load: AgentNoteLoad };
interface Msg { id: string; agent: string; at: string; seq: number; from: AgentMessageView['from']; parts: ChatPart[]; suggestion?: AgentSuggestion; answered?: { runId: string }; proposalId?: string }
interface Prop {
  id: string; agent: string; at: string; seq: number; kind: 'instruction' | 'note' | 'import'; status: 'drafted' | 'accepted' | 'rejected'; quote: string; quoteKey: string; messageId: string;
  appliesTo: string; diff: DiffLine[]; fromVersion: number | null; toVersion: number | null; parentHash: string | null;
  note: { text: string; scope: AgentNoteScope; load: AgentNoteLoad } | null; patch: OwnerPatch | null; digest: string;
  /** 4J22b: an agent file's standing orders, and its persona set on Accept (export.ts decideImport). */
  imported?: { patches: OwnerPatch[]; accept: (() => void) | null };
}
interface OwnerPatch { id: string; agent: string; stepId: string; op: 'guidance.add' | 'guidance.remove'; value: string; quote: string }
interface Version { id: string; version: number; hash: string; at: string; origin: 'plan' | 'improvement' | 'owner'; parentId: string | null; patches: OwnerPatch[] }
interface Note { id: string; agent: string; scope: AgentNoteScope; load: AgentNoteLoad; text: string; quote: string | null; captured: string; hash: string; forgotten: boolean }
interface Change { id: string; agent: string; noteId: string; at: string; who: NoteChangeView['who']; before: Snap | null; after: Snap | null; undoOf: string | null }
interface Book {
  messages: Msg[]; proposals: Prop[]; versions: Version[]; inUse: string | null; notes: Note[]; changes: Change[];
  consent: { presetId: string; model: string | null; digest: string; at: string } | null;
  /** Runs whose turns carried notes (4B2's Recalled chip), by run id. */
  recalled: Record<string, string[]>;
}

/** A request on the floor drafted as a proposal for Today; the Chats desk keeps and raises it (fake-chief.ts). */
export type FloorDraft = (input: { title: string; line: string; agent: string; spends: boolean; sends: boolean }) => ProposalView;

export class FakeAgentsDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly floor: FloorDraft | null;
  private readonly books: Record<string, Book> = {};
  private seq = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean; floor?: FloorDraft } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
    this.floor = options.floor ?? null;
  }

  handles(method: string): boolean {
    return AGENT_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.agents.thread.list': return this.threadList(p);
      case 'venture.agents.thread.send': return this.threadSend(p);
      case 'venture.agents.proposal.decide': return this.decide(p);
      case 'venture.agents.version.undo': return this.undoVersion(p);
      case 'venture.agents.orders.list': { const body = exact(p, ['agent'], ['agent']); return this.ordersView(this.agent(id(body.agent, 'Agent'))); }
      case 'venture.chats.consent': return this.consent(p);
      case 'venture.agents.notes.list': return this.notesList(p);
      case 'venture.agents.notes.edit': return this.notesEdit(p);
      case 'venture.agents.notes.forget': return this.notesForget(p);
      case 'venture.agents.notes.undo': return this.notesUndo(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The business's records
  // ---------------------------------------------------------------------------------------------------------------

  /** A 64-character digest, the engine's shape, made from the fake's short one. */
  private hex(value: unknown): string {
    return Array.from({ length: 8 }, (_, part) => this.host.digest({ value, part })).join('').slice(0, 64);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}${this.host.digest({ prefix, seq: this.seq }).slice(0, 6)}`;
  }

  private book(): Book {
    const biz = this.host.current();
    const found = this.books[biz];
    if (found) return found;
    const made: Book = { messages: [], proposals: [], versions: [], inUse: null, notes: [], changes: [], consent: null, recalled: {} };
    this.books[biz] = made;
    // The version in use the practice desk holds (venture.improve.status), on which the owner's changes stack.
    const status = this.host.ask('venture.improve.status', {}) as ImprovementStatusLite;
    if (status.inUse) {
      made.versions.push({ id: status.inUse.playbookId, version: status.inUse.version, hash: status.inUse.hash, at: '2026-10-14T09:00:00.000Z', origin: status.inUse.origin, parentId: null, patches: [] });
      made.inUse = status.inUse.playbookId;
    }
    if (!this.fresh && biz === 'lumen') this.seedLumen(made);
    return made;
  }

  /** Lumen's sample: Editor keeps a note from the owner's words, and a change to its instructions waits for a decision. */
  private seedLumen(book: Book): void {
    const at = (time: string) => `2026-10-21T${time}:00.000Z`;
    const say = (time: string, from: Msg['from'], text: string): Msg => {
      this.seq += 1;
      const msg: Msg = { id: `amsg_seed${this.seq}`, agent: 'editor', at: at(time), seq: this.seq, from, parts: [{ kind: 'text', text }] };
      book.messages.push(msg);
      return msg;
    };
    const words = 'Remember that Nimbus Mics wants every file as MP4, never MOV.';
    const remember = say('09:40', 'owner', words);
    const note: Note = { id: 'note_seed1', agent: 'editor', scope: 'client:c-nimbus', load: 'topic', text: 'Nimbus Mics wants every file as MP4, never MOV.', quote: words, captured: '2026-10-21', hash: '', forgotten: false };
    note.hash = this.hex({ text: note.text, scope: note.scope, load: note.load });
    this.seq += 1;
    book.proposals.push({
      id: 'aprop_seed1', agent: 'editor', at: at('09:40'), seq: this.seq, kind: 'note', status: 'accepted', quote: words, quoteKey: keyOf(note.text), messageId: remember.id,
      appliesTo: "Editor reads this note when it works on Nimbus Mics's files and the note fits the order.", diff: [], fromVersion: null, toVersion: null, parentHash: null,
      note: { text: note.text, scope: note.scope, load: note.load }, patch: null, digest: this.hex('aprop_seed1'),
    });
    say('09:40', 'agent', NOTE_REPLY);
    book.notes.push(note);
    book.changes.push({ id: 'nchg_seed1', agent: 'editor', noteId: note.id, at: at('09:41'), who: 'proposal', before: null, after: snap(note), undoOf: null });
    say('09:41', 'agent', NOTE_KEPT_LINE);
    book.recalled['31'] = [note.id];
    const standing = "From now on, put the episode's name in the first line of every short's description.";
    const said = say('10:21', 'owner', standing);
    const current = this.current(book);
    if (current && this.storeInstruction(book, this.agent('editor'), current, said, standing)) say('10:21', 'agent', STANDING_REPLY);
  }

  private current(book: Book): Version | undefined {
    return book.versions.find((v) => v.id === book.inUse);
  }

  private agents(): AgentView[] {
    return (this.host.ask('venture.team.list', {}) as TeamListView).agents;
  }

  /** chatAgent: Keeper and code roles have no chat (AGENT_IS_CODE); an id not on this team is AGENT_NOT_FOUND. */
  private agent(agentId: string): AgentView {
    if (agentId === KEEPER_ID) throw new EngineError('AGENT_IS_CODE', KEEPER_IS_CODE);
    const found = this.agents().find((a) => a.id === agentId);
    if (!found) throw new EngineError('AGENT_NOT_FOUND', NOT_FOUND);
    if (found.kind === 'code') throw new EngineError('AGENT_IS_CODE', `${found.name} is code, not AI. It has no chat; its work shows in each run's steps.`);
    return found;
  }

  private runs(): RunDetail[] {
    return (this.host.runs?.() ?? []).filter((run) => run.businessId === this.host.current());
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The playbook in use
  // ---------------------------------------------------------------------------------------------------------------

  /** The guidance on a step in a version: the sample's own lines, then the owner's changes in order. */
  private guidance(version: Version, stepId: string): string[] {
    let lines = [...(GUIDANCE[stepId] ?? [])];
    for (const patch of version.patches) {
      if (patch.stepId !== stepId) continue;
      lines = patch.op === 'guidance.add' ? [...lines, patch.value] : lines.filter((line) => line !== patch.value);
    }
    return lines;
  }

  /**
   * venture.agents.orders.list (4B3): the standing orders, and what the panel reads beside them without writing: the
   * version in use (null before one is stored), rebuildDue (the fake's plans never change under a version), the agent's
   * own steps with their guidance and checks, and what Undo would do.
   */
  private ordersView(agent: AgentView): StandingOrdersView {
    const current = this.current(this.book());
    return {
      orders: this.orders(agent),
      playbook: current ? { id: current.id, version: current.version, hash: current.hash, origin: current.origin, at: current.at } : null,
      rebuildDue: false,
      steps: agent.steps.map((step) => ({ stepId: step.id, title: step.purpose, guidance: current ? this.guidance(current, step.id) : [...(GUIDANCE[step.id] ?? [])], checks: [...(CHECKS[step.id] ?? [])] })),
      undo: this.undoPlan(agent),
    };
  }

  /** What Undo would do now (versionUndoHandler): go back to the version the change was made from, or rebuild without it. */
  private undoPlan(agent: AgentView): StandingUndoView | null {
    const book = this.book();
    const current = this.current(book);
    const changes = (current?.patches ?? []).filter((patch) => patch.agent === agent.id);
    if (!current || changes.length === 0) return null;
    const change = changes.at(-1)!;
    const parent = book.versions.find((v) => v.id === current.parentId);
    const rest = current.patches.filter((patch) => patch.id !== change.id);
    return current.origin === 'owner' && current.patches.at(-1)?.id === change.id && parent && parent.patches.length === rest.length
      ? { kind: 'back', version: parent.version } : { kind: 'rebuild' };
  }

  /** An agent's steps whose guidance chat may change: its own work steps (not the floor, not a check). */
  private guided(agent: AgentView): AgentView['steps'] {
    return agent.steps.filter((step) => !step.floor && !VERIFY_STEPS.has(step.id));
  }

  private orders(agent: AgentView): StandingOrderView[] {
    const book = this.book();
    const current = this.current(book);
    if (!current) return [];
    const owned = new Set(agent.steps.map((step) => step.id));
    const orders: StandingOrderView[] = [];
    for (const patch of current.patches) {
      if (patch.agent !== agent.id || patch.op !== 'guidance.add' || !owned.has(patch.stepId) || !this.guidance(current, patch.stepId).includes(patch.value)) continue;
      const arrived = book.versions.filter((v) => v.patches.some((x) => x.id === patch.id)).sort((a, b) => a.version - b.version)[0] ?? current;
      const step = agent.steps.find((s) => s.id === patch.stepId)!;
      orders.push({ stepId: patch.stepId, step: step.purpose, text: patch.value, since: arrived.version, quote: patch.quote, at: arrived.at });
    }
    return orders;
  }

  /** A new version from the one in use and these patches; the old one stays stored and the business points at the new one. */
  private ownerVersion(book: Book, from: Version, patches: OwnerPatch[]): Version {
    const version = Math.max(0, ...book.versions.map((v) => v.version)) + 1;
    const made: Version = { id: `pb-${this.host.current()}-${version}`, version, hash: this.hex({ from: from.id, patches: patches.map((x) => x.id), version }), at: this.host.now(), origin: 'owner', parentId: from.id, patches };
    book.versions.push(made);
    book.inUse = made.id;
    return made;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The chat consent
  // ---------------------------------------------------------------------------------------------------------------

  private route(): { presetId: string; model: string | null; label: string; withKey: boolean } | null {
    const status = this.host.ask('venture.models.status', {}) as ModelStatusLite;
    const tier = status.tiers.main;
    if (!tier || tier.presetId === 'built-in-templates') return null;
    const preset = MODEL_PRESETS.find((x) => x.id === tier.presetId);
    return { presetId: tier.presetId, model: tier.model, label: preset?.label ?? tier.presetId, withKey: preset?.kind === 'anthropic-messages' || preset?.kind === 'openai-responses' };
  }

  /** 4C2: the one chat consent as it stands, for the Chats desk's thread list (venture.chief.threads carries it). */
  chatConsent(): ChatConsentView {
    return this.consentView();
  }

  private consentView(): ChatConsentView {
    const route = this.route();
    if (!route) return { state: 'not-needed', text: null, digest: null, at: null };
    const text = `Chats send your message and what Chausar reads to answer it (run steps, file names, figures with their receipts, the agent's notes; for a network search, your question as you typed it, your contacts' titles and companies with each contact's own name masked, and your notes and meeting titles with the full names of people in your network and of clients who are people masked; emails and phone numbers are masked everywhere) to ${route.label}${route.withKey ? ' with your key' : ''}. Keys, passphrases and bank or card numbers are never sent.`;
    const digest = this.hex(text);
    const last = this.book().consent;
    if (!last) return { state: 'needed', text, digest, at: null };
    const same = last.digest === digest && last.presetId === route.presetId && last.model === route.model;
    return { state: same ? 'given' : 'stale', text, digest, at: same ? last.at : null };
  }

  private consent(p: Record<string, unknown>): ChatConsentView {
    const body = exact(p, ['digest'], ['digest']);
    if (typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.digest)) throw invalid('Send the digest of the consent you read.');
    const view = this.consentView();
    const route = this.route();
    if (!route) return view;
    if (view.digest !== body.digest) throw new EngineError('APPROVAL_STALE', 'What chats send changed since you read it. Read it again.');
    if (view.state === 'given') return view;
    const at = this.host.now();
    this.book().consent = { presetId: route.presetId, model: route.model, digest: view.digest!, at };
    return { state: 'given', text: view.text, digest: view.digest, at };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The thread
  // ---------------------------------------------------------------------------------------------------------------

  private messageView(msg: Msg): AgentMessageView {
    return {
      id: msg.id, at: msg.at, from: msg.from, parts: clone(msg.parts), ...(msg.suggestion ? { suggestion: clone(msg.suggestion) } : {}),
      ...(msg.answered ? { answered: { ...msg.answered } } : {}), ...(msg.proposalId ? { proposalId: msg.proposalId } : {}),
    };
  }

  private proposalView(prop: Prop, agentName: string): AgentProposalView {
    const current = this.current(this.book());
    const stale = prop.status === 'drafted' && prop.kind === 'instruction' && (!current || current.hash !== prop.parentHash);
    return {
      id: prop.id, at: prop.at, agent: prop.agent, kind: prop.kind, status: stale ? 'stale' : prop.status, quote: prop.quote,
      title: prop.kind === 'instruction' ? `Proposed change to ${agentName}'s instructions` : prop.kind === 'import' ? `Import an agent file into ${agentName}?` : 'Save this note?',
      appliesTo: prop.appliesTo, diff: clone(prop.diff), fromVersion: prop.fromVersion, toVersion: prop.toVersion,
      note: prop.note ? { text: prop.note.text, scope: prop.note.scope } : null, digest: prop.digest,
      line: stale
        ? `This was drafted against version ${prop.fromVersion ?? 0}; version ${current?.version ?? 0} is in use now. Ask again and I will redraft it.`
        : prop.kind === 'note' ? (prop.quote ? `You said: '${prop.quote}'` : NOTE_ERASED_LINE) : null,
    };
  }

  private runItem(run: RunDetail, agent: AgentView): AgentRunItem {
    const book = this.book();
    const recalled = (book.recalled[run.runId] ?? []).flatMap((noteId) => {
      const note = book.notes.find((n) => n.id === noteId && n.agent === agent.id);
      if (!note) return [];
      return [note.forgotten ? { id: note.id, text: FORGOTTEN_NOTE, forgotten: true } : { id: note.id, text: note.text }];
    });
    const steps = clone(run.steps);
    return {
      runId: run.runId, at: run.startedAt, purpose: run.purpose, state: run.state, done: steps.filter((step) => step.state === 'done' && step.audited !== false).length,
      total: steps.length, steps, recalled,
    };
  }

  private items(agent: AgentView): { id: string; at: string; seq: number; item: AgentThreadItem }[] {
    const book = this.book();
    const items: { id: string; at: string; seq: number; item: AgentThreadItem }[] = [
      ...book.messages.filter((m) => m.agent === agent.id).map((m) => ({ id: m.id, at: m.at, seq: m.seq, item: { type: 'message' as const, message: this.messageView(m) } })),
      ...book.proposals.filter((x) => x.agent === agent.id).map((x) => ({ id: x.id, at: x.at, seq: x.seq, item: { type: 'proposal' as const, proposal: this.proposalView(x, agent.name) } })),
      ...this.runs().filter((run) => run.agent === agent.name).map((run) => ({ id: run.runId, at: run.startedAt, seq: 0, item: { type: 'run' as const, run: this.runItem(run, agent) } })),
    ];
    return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
  }

  private waiting(agent: AgentView): AgentThreadView['waiting'] {
    const run = [...this.runs()].reverse().find((r) => r.agent === agent.name && r.state === 'waiting' && r.question);
    return run?.question ? { runId: run.runId, rowId: run.question.id, question: run.question.text } : null;
  }

  private threadList(p: Record<string, unknown>): AgentThreadView {
    const body = exact(p, ['agent', 'before'], ['agent']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const all = this.items(agent);
    const end = body.before === undefined ? all.length : all.findIndex((entry) => entry.id === id(body.before, 'Before'));
    if (end < 0) throw invalid('That item is not in this thread.');
    const start = Math.max(0, end - 50);
    return {
      agent: { id: agent.id, name: agent.name, role: agent.role }, items: all.slice(start, end).map((entry) => entry.item),
      waiting: this.waiting(agent), more: start > 0, consent: this.consentView(),
    };
  }

  private put(book: Book, agent: string, from: Msg['from'], text: string, extra: Partial<Msg> = {}): Msg {
    this.seq += 1;
    const msg: Msg = { id: this.nextId('amsg'), agent, at: this.host.now(), seq: this.seq, from, parts: [{ kind: 'text', text }], ...extra };
    book.messages.push(msg);
    this.host.emit({ type: 'agent.message', businessId: this.host.current(), at: msg.at });
    return msg;
  }

  private asItem(msg: Msg): AgentThreadItem {
    return { type: 'message', message: this.messageView(msg) };
  }

  private threadSend(p: Record<string, unknown>): AgentSendResult {
    const body = exact(p, ['agent', 'text'], ['agent', 'text']);
    const agentId = id(body.agent, 'Agent');
    if (typeof body.text !== 'string' || tidy(body.text).length < 1 || body.text.length > 2000) throw invalid('Your message must be between 1 and 2000 characters.');
    const words = body.text.trim();
    if (KEYLIKE.test(words)) throw new EngineError('CHAT_KEY_REFUSED', KEY_REFUSED);
    const agent = this.agent(agentId);
    const consent = this.consentView();
    if (consent.state === 'needed') throw new EngineError('CHAT_CONSENT_REQUIRED', consent.text ?? '');
    if (consent.state === 'stale') throw new EngineError('CHAT_CONSENT_STALE', `Your AI connection changed since you agreed, so chats wait until you agree again. ${consent.text ?? ''}`);
    const book = this.book();
    const kind = standingClass(words);

    if (kind === 'standing') {
      const control = CONTROL.find((item) => item.pattern.test(words))?.reason ?? null;
      const current = this.current(book);
      if (!control && !current) throw new EngineError('BLUEPRINT_NOT_ACCEPTED', 'Accept a plan first. The playbook is made from it.');
      const said = this.put(book, agent.id, 'owner', words);
      if (control) return { added: [this.asItem(said), this.asItem(this.put(book, agent.id, 'agent', `I can't take that as an instruction: ${control}`))], line: null };
      const prop = this.storeInstruction(book, agent, current!, said, words);
      if (!prop) return { added: [this.asItem(said), this.asItem(this.put(book, agent.id, 'agent', "I can't take that as an instruction: That did not make a change to my instructions."))], line: null };
      const reply = this.put(book, agent.id, 'agent', STANDING_REPLY);
      return { added: [this.asItem(said), { type: 'proposal', proposal: this.proposalView(prop, agent.name) }, this.asItem(reply)], line: null };
    }
    if (kind === 'note') return this.noteRequest(book, agent, words);

    const waiting = this.waiting(agent);
    if (waiting && !onlyAsks(words)) {
      const said = this.put(book, agent.id, 'owner', words, { answered: { runId: waiting.runId } });
      this.answerRun(waiting.runId);
      return { added: [this.asItem(said)], line: ANSWERED_LINE };
    }
    if (!onlyAsks(words) && FLOOR_WORDS.some((pattern) => pattern.test(words))) {
      const said = this.put(book, agent.id, 'owner', words);
      const proposalId = this.raiseFloor(agent, words);
      return { added: [this.asItem(said), this.asItem(this.put(book, agent.id, 'agent', FLOOR_REPLY, proposalId ? { proposalId } : {}))], line: null };
    }
    if (!onlyAsks(words) && (POLITE.test(words) || WORK_START.test(words))) {
      const said = this.put(book, agent.id, 'owner', words);
      const reply = this.put(book, agent.id, 'agent', WORK_REPLY, { suggestion: { kind: 'order', offerId: this.offerFor(words), request: words } });
      return { added: [this.asItem(said), this.asItem(reply)], line: null };
    }
    const said = this.put(book, agent.id, 'owner', words);
    const reply = this.put(book, agent.id, 'agent', '', { parts: this.templateAnswer(agent, waiting) });
    return { added: [this.asItem(said), this.asItem(reply)], line: null };
  }

  /** The engine's template answer: plain facts from the records, with only templates serving chats. */
  private templateAnswer(agent: AgentView, waiting: AgentThreadView['waiting']): ChatPart[] {
    const lines: string[] = [];
    if (waiting) lines.push(`I am waiting on your answer: ${waiting.question}`);
    const latest = [...this.runs()].filter((run) => run.agent === agent.name).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
    lines.push(latest ? `My latest run, ${latest.purpose}, is ${STATE_WORDS[latest.state]}.` : 'I have not worked on an order yet.');
    const orders = this.orders(agent).length;
    if (orders) lines.push(`I follow ${orders} standing ${orders === 1 ? 'order' : 'orders'} from you.`);
    lines.push('Connect your AI in Connections to ask me questions in your own words.');
    return lines.map((text) => ({ kind: 'text', text }));
  }

  private offerFor(words: string): string | null {
    const plan = this.host.ask('venture.blueprint.get', {}) as { blueprint: { offers: { id: string; name: { value: string } | string }[] } } | null;
    const offers = plan?.blueprint.offers ?? [];
    const lower = words.toLowerCase();
    const named = offers.filter((offer) => lower.includes((typeof offer.name === 'string' ? offer.name : offer.name.value).toLowerCase()));
    if (named.length === 1) return named[0]!.id;
    return offers.length === 1 ? offers[0]!.id : null;
  }

  /**
   * A request on the floor: nothing is done from chat. The engine drafts it (kind start-work) and raises it to Today at
   * once; the Chats desk keeps the proposal and its card (fake-chief.ts), and the agent's reply names it.
   */
  private raiseFloor(agent: AgentView, words: string): string | null {
    if (!this.floor) return null;
    const drafted = this.floor({
      title: words.length > 120 ? `${words.slice(0, 119)}…` : words, agent: agent.id, spends: /\b(?:pay|spend\w*|refund\w*)\b/i.test(words), sends: true,
      line: 'Publishing, sending, money and prices always ask you first. Nothing changes until you approve.',
    });
    this.host.ask('venture.proposals.raise', { id: drafted.id });
    return drafted.id;
  }

  /** A reply while the run waits on the owner's question is its answer: the question closes and the Today card goes. */
  private answerRun(runId: string): void {
    const run = this.runs().find((r) => r.runId === runId);
    if (!run) return;
    delete run.question;
    for (const step of run.steps) if (step.state === 'waiting') step.state = 'done';
    this.host.setRows(this.host.rows().filter((row) => !(row.kind === 'question' && row.viewRef?.kind === 'run' && row.viewRef.id === runId)));
    this.host.emit({ type: 'run.step', businessId: this.host.current(), runId, at: this.host.now() });
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
  }

  /** storeInstruction: the template patch from the owner's words, on the agent's first guided step, as a drafted proposal. */
  private storeInstruction(book: Book, agent: AgentView, playbook: Version, said: Msg, words: string): Prop | null {
    const step = this.guided(agent)[0];
    const value = standingValue(words);
    if (!step || !value) return null;
    const before = this.guidance(playbook, step.id);
    if (before.includes(value)) return null;
    const patch: OwnerPatch = { id: this.nextId('patch'), agent: agent.id, stepId: step.id, op: 'guidance.add', value, quote: words };
    const toVersion = Math.max(0, ...book.versions.map((v) => v.version)) + 1;
    this.seq += 1;
    const prop: Prop = {
      id: this.nextId('aprop'), agent: agent.id, at: said.at, seq: this.seq, kind: 'instruction', status: 'drafted', quote: words, quoteKey: keyOf(words), messageId: said.id,
      appliesTo: `Applies to "${step.purpose}" from the next run.`, diff: [...before.map((text) => ({ op: 'same' as const, text })), { op: 'add', text: value }],
      fromVersion: playbook.version, toVersion, parentHash: playbook.hash, note: null, patch, digest: '',
    };
    prop.digest = this.hex({ id: prop.id, patch, toVersion, parent: prop.parentHash });
    book.proposals.push(prop);
    return prop;
  }

  private clients(): ClientLite[] {
    return this.host.ask('venture.client.list', {}) as ClientLite[];
  }

  private noteRequest(book: Book, agent: AgentView, words: string): AgentSendResult {
    const said = this.put(book, agent.id, 'owner', words);
    const text = noteValue(words);
    const reply = (line: string): AgentSendResult => ({ added: [this.asItem(said), this.asItem(this.put(book, agent.id, 'agent', line))], line: null });
    if (text.length < 2) return reply("I can't keep that as a note: Tell me what to remember in a few words.");
    const key = keyOf(text);
    const mine = book.proposals.filter((x) => x.agent === agent.id && x.kind === 'note');
    if (mine.some((x) => x.status === 'rejected' && x.quoteKey === key)) return reply(NOTE_SAID_NO);
    if (mine.some((x) => x.status === 'drafted' && x.quoteKey === key)) return reply(NOTE_WAITING);
    if (book.notes.some((n) => n.agent === agent.id && !n.forgotten && keyOf(n.text) === key)) return reply(NOTE_ALREADY);
    const client = this.clients().find((c) => words.toLowerCase().includes(c.name.toLowerCase())) ?? null;
    const scope: AgentNoteScope = client ? `client:${client.id}` : 'agent';
    const load: AgentNoteLoad = client ? 'topic' : 'always';
    const room = this.room(book, agent, { text, scope, load }, null);
    if (room) return reply(`I can't keep that as a note: ${room}`);
    this.seq += 1;
    const prop: Prop = {
      id: this.nextId('aprop'), agent: agent.id, at: said.at, seq: this.seq, kind: 'note', status: 'drafted', quote: words, quoteKey: key, messageId: said.id,
      appliesTo: client ? `${agent.name} reads this note when it works on ${client.name}'s files and the note fits the order.` : `${agent.name} reads this note whenever it works on an order's files.`,
      diff: [], fromVersion: null, toVersion: null, parentHash: null, note: { text, scope, load }, patch: null, digest: '',
    };
    prop.digest = this.hex({ id: prop.id, note: prop.note, quote: words });
    book.proposals.push(prop);
    const answer = this.put(book, agent.id, 'agent', NOTE_REPLY);
    return { added: [this.asItem(said), { type: 'proposal', proposal: this.proposalView(prop, agent.name) }, this.asItem(answer)], line: null };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Decisions and versions
  // ---------------------------------------------------------------------------------------------------------------

  private decide(p: Record<string, unknown>): { proposal: AgentProposalView; line: string; playbook?: { id: string; version: number } } {
    const body = exact(p, ['id', 'digest', 'decision'], ['id', 'digest', 'decision']);
    const proposalId = id(body.id, 'Proposal');
    if (typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.digest)) throw invalid('Send the digest of the change you read.');
    if (body.decision !== 'accept' && body.decision !== 'reject') throw invalid('Choose accept or reject.');
    const book = this.book();
    const prop = book.proposals.find((x) => x.id === proposalId);
    if (!prop) throw invalid('That change was not found.');
    if (prop.status !== 'drafted') throw new EngineError('PROPOSAL_DECIDED', 'You already decided this change.');
    if (prop.digest !== body.digest) throw new EngineError('APPROVAL_STALE', 'This change is not the one you read. Read it again.');
    const agent = this.agent(prop.agent);
    if (prop.kind === 'note') {
      if (body.decision === 'reject') {
        prop.status = 'rejected';
        return { proposal: this.proposalView(prop, agent.name), line: NOTE_REJECTED_LINE };
      }
      const room = this.room(book, agent, prop.note!, null);
      if (room) throw new EngineError('NOTES_FULL', room);
      const note: Note = { id: this.nextId('note'), agent: agent.id, scope: prop.note!.scope, load: prop.note!.load, text: prop.note!.text, quote: prop.quote, captured: this.host.now().slice(0, 10), hash: '', forgotten: false };
      note.hash = this.hex({ text: note.text, scope: note.scope, load: note.load });
      book.notes.push(note);
      this.change(book, { agent: agent.id, noteId: note.id, who: 'proposal', before: null, after: snap(note), undoOf: null });
      prop.status = 'accepted';
      this.put(book, agent.id, 'agent', NOTE_KEPT_LINE);
      return { proposal: this.proposalView(prop, agent.name), line: NOTE_KEPT_LINE };
    }
    if (prop.kind === 'import') return this.decideImport(book, prop, agent, body.decision as 'accept' | 'reject');
    const current = this.current(book);
    if (!current || current.hash !== prop.parentHash) {
      throw new EngineError('PROPOSAL_STALE', `This was drafted against version ${prop.fromVersion ?? 0}; version ${current?.version ?? 0} is in use now. Ask again and I will redraft it.`);
    }
    if (body.decision === 'reject') {
      prop.status = 'rejected';
      return { proposal: this.proposalView(prop, agent.name), line: 'You said no, so nothing changed.' };
    }
    const made = this.ownerVersion(book, current, [...current.patches, prop.patch!]);
    prop.status = 'accepted';
    prop.toVersion = made.version;
    const going = this.runs().filter((run) => run.state === 'waiting' || run.state === 'active');
    const kept = going.length === 1 ? `Run ${going[0]!.runId} keeps` : `Runs ${going.slice(0, -1).map((r) => r.runId).join(', ')} and ${going.at(-1)?.runId ?? ''} keep`;
    const line = going.length === 0 ? `Version ${made.version} is in use now. You can undo it.` : `Version ${made.version} is in use from the next run. ${kept} version ${current.version}.`;
    this.put(book, agent.id, 'agent', line);
    return { proposal: this.proposalView(prop, agent.name), line, playbook: { id: made.id, version: made.version } };
  }

  /**
   * 4J22b: an agent file the owner imported (agents/export.ts agentsImportHandler), stored as a drafted proposal of kind
   * 'import' in the agent's chat with the engine's reply; nothing changes until it is accepted (decideImport).
   */
  draftImport(input: { agent: string; orders: { stepId: string; text: string }[]; persona: unknown; personaLines: DiffLine[]; skipped: string[]; onAccept: (() => void) | null }): AgentProposalView {
    const book = this.book();
    const agent = this.agent(input.agent);
    const current = this.current(book);
    const said = this.put(book, agent.id, 'agent', 'You imported an agent file. Here is what it would change. Nothing changes until you accept it.');
    const patches: OwnerPatch[] = input.orders.map((order) => ({ id: this.nextId('patch'), agent: agent.id, stepId: order.stepId, op: 'guidance.add', value: order.text, quote: order.text }));
    this.seq += 1;
    const prop: Prop = {
      id: this.nextId('aprop'), agent: agent.id, at: said.at, seq: this.seq, kind: 'import', status: 'drafted', quote: 'An agent file you imported.', quoteKey: keyOf('An agent file you imported.'),
      messageId: said.id, appliesTo: `Applies to ${agent.name} from the next run.${input.skipped.length ? ` Left out: ${input.skipped.join(' ')}` : ''}`,
      diff: [...patches.map((patch) => ({ op: 'add' as const, text: patch.value })), ...input.personaLines],
      fromVersion: current?.version ?? null, toVersion: patches.length ? Math.max(0, ...book.versions.map((v) => v.version)) + 1 : null, parentHash: current?.hash ?? null,
      note: null, patch: null, digest: '', imported: { patches, accept: input.onAccept },
    };
    prop.digest = this.hex({ id: prop.id, patches: patches.map((patch) => patch.value), persona: input.persona, parent: prop.parentHash });
    book.proposals.push(prop);
    return this.proposalView(prop, agent.name);
  }

  /** 4J22b: an agent says something in its own chat (a persona version set, export.ts and persona.ts). */
  say(agentId: string, text: string): void {
    this.put(this.book(), agentId, 'agent', text);
  }

  /** export.ts decideImport: Accept writes one new version with the file's orders, and the persona version; Reject changes nothing. */
  private decideImport(book: Book, prop: Prop, agent: AgentView, decision: 'accept' | 'reject'): { proposal: AgentProposalView; line: string; playbook?: { id: string; version: number } } {
    if (decision === 'reject') {
      prop.status = 'rejected';
      return { proposal: this.proposalView(prop, agent.name), line: 'You said no, so nothing changed.' };
    }
    const current = this.current(book);
    const patches = prop.imported?.patches ?? [];
    const made = patches.length && current ? this.ownerVersion(book, current, [...current.patches, ...patches]) : null;
    prop.imported?.accept?.();
    prop.status = 'accepted';
    prop.toVersion = made?.version ?? null;
    const line = made ? `Version ${made.version} is in use from the next run, with the orders from the file. You can undo it.` : 'The persona from the file is in use from the next run. You can undo it.';
    this.put(book, agent.id, 'agent', line);
    return { proposal: this.proposalView(prop, agent.name), line, ...(made ? { playbook: { id: made.id, version: made.version } } : {}) };
  }

  private undoVersion(p: Record<string, unknown>): { playbookId: string; version: number; line: string } {
    const body = exact(p, ['agent', 'digest'], ['agent', 'digest']);
    const agent = this.agent(id(body.agent, 'Agent'));
    if (typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.digest)) throw invalid('Send the digest of the version you saw in use.');
    const book = this.book();
    const current = this.current(book);
    const changes = (current?.patches ?? []).filter((patch) => patch.agent === agent.id);
    if (!current || changes.length === 0) throw new EngineError('UNDO_NOTHING', `${agent.name} has no change from you in use, so there is nothing to undo.`);
    if (current.hash !== body.digest) throw new EngineError('APPROVAL_STALE', 'The version in use changed since you read it. Read it again.');
    const change = changes.at(-1)!;
    const rest = current.patches.filter((patch) => patch.id !== change.id);
    const parent = book.versions.find((v) => v.id === current.parentId);
    if (current.origin === 'owner' && current.patches.at(-1)?.id === change.id && parent && parent.patches.length === rest.length) {
      book.inUse = parent.id;
      return { playbookId: parent.id, version: parent.version, line: `Back to version ${parent.version}. Version ${current.version} stays stored.` };
    }
    const made = this.ownerVersion(book, current, rest);
    const later = current.patches.findIndex((patch) => patch.id === change.id) < current.patches.length - 1;
    return { playbookId: made.id, version: made.version, line: `Version ${made.version} is in use without that change.${later ? ' Your later changes stay.' : ''}` };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------------------------------------------

  private room(book: Book, agent: AgentView, next: { text: string; scope: AgentNoteScope; load: AgentNoteLoad }, replacing: string | null): string | null {
    if (next.load !== 'always') return null;
    const others = book.notes.filter((n) => n.agent === agent.id && !n.forgotten && n.id !== replacing && n.load === 'always');
    const used = others.reduce((sum, n) => sum + n.text.length, 0);
    return used + next.text.length <= ALWAYS_LIMIT ? null : `The notes ${agent.name} always reads are full: 2,000 characters in all. Shorten or forget one first.`;
  }

  private change(book: Book, input: Omit<Change, 'id' | 'at'>): Change {
    const made: Change = { id: this.nextId('nchg'), at: this.host.now(), ...input };
    book.changes.push(made);
    return made;
  }

  private undone(book: Book, agent: string): Set<string> {
    const undone = new Set<string>();
    for (const change of book.changes.filter((c) => c.agent === agent).reverse()) if (change.undoOf && !undone.has(change.id)) undone.add(change.undoOf);
    return undone;
  }

  private changeView(change: Change, undone: ReadonlySet<string>): NoteChangeView {
    const line = change.who === 'proposal' ? 'Saved from your words.'
      : change.who === 'undo' ? (change.after === null ? 'Undo took the note away. Its words are erased.' : change.before === null ? 'Undo put the note back.' : 'Undo put the earlier words back.')
        : change.before === null ? 'You added a note.'
          : change.after === null ? 'You forgot a note. Its words are erased. Instructions you approved and your other messages keep their words.' : 'You corrected a note.';
    return { id: change.id, noteId: change.noteId, at: change.at, who: change.who, line, undone: undone.has(change.id), erases: change.before === null };
  }

  private noteView(note: Note): AgentNoteView {
    return { id: note.id, scope: note.scope, load: note.load, text: note.text, source: note.quote ? `You said: '${note.quote}'` : 'You wrote this note.', captured: note.captured, hash: note.hash };
  }

  private changed(book: Book, note: Note, change: Change): AgentNoteChange {
    return { note: note.forgotten ? null : this.noteView(note), change: this.changeView(change, this.undone(book, change.agent)) };
  }

  private notesList(p: Record<string, unknown>): AgentNotesView {
    const body = exact(p, ['agent'], ['agent']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const book = this.book();
    const notes = book.notes.filter((n) => n.agent === agent.id && !n.forgotten);
    const undone = this.undone(book, agent.id);
    return {
      notes: notes.map((n) => this.noteView(n)), changes: book.changes.filter((c) => c.agent === agent.id).reverse().map((c) => this.changeView(c, undone)),
      usedChars: notes.filter((n) => n.load === 'always').reduce((sum, n) => sum + n.text.length, 0), limitChars: ALWAYS_LIMIT, forgetLine: FORGET_LINE,
    };
  }

  private notesEdit(p: Record<string, unknown>): AgentNoteChange {
    const body = exact(p, ['agent', 'noteId', 'text', 'basedOn'], ['agent', 'text']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const noteId = body.noteId === undefined ? null : id(body.noteId, 'Note');
    const basedOn = typeof body.basedOn === 'string' && body.basedOn.length > 0 ? body.basedOn : null;
    if (noteId === null && basedOn !== null) throw invalid('A new note is not based on another one.');
    if (noteId !== null && basedOn === null) throw invalid('Send the version of the note you corrected.');
    if (typeof body.text !== 'string' || tidy(body.text).length < 2) throw invalid('Tell me what to remember in a few words.');
    if (body.text.length > MAX_NOTE) throw invalid(`A note is at most ${MAX_NOTE} characters.`);
    const book = this.book();
    const current = noteId === null ? null : book.notes.find((n) => n.id === noteId && n.agent === agent.id) ?? null;
    if (noteId !== null) {
      if (!current) throw invalid('That note was not found.');
      if (current.forgotten || current.hash !== basedOn) throw new EngineError('NOTE_CHANGED', NOTE_CHANGED_LINE);
    }
    const text = tidy(body.text);
    const client = this.clients().find((c) => text.toLowerCase().includes(c.name.toLowerCase())) ?? null;
    const scope: AgentNoteScope = client ? `client:${client.id}` : current?.scope ?? 'agent';
    const load: AgentNoteLoad = scope === 'agent' ? 'always' : 'topic';
    if (current && current.text === text && current.scope === scope) throw invalid('That is the note as it is now.');
    const room = this.room(book, agent, { text, scope, load }, current?.id ?? null);
    if (room) throw new EngineError('NOTES_FULL', room);
    const hash = this.hex({ text, scope, load });
    const before = current ? snap(current) : null;
    const note: Note = current ?? { id: this.nextId('note'), agent: agent.id, scope, load, text, quote: null, captured: this.host.now().slice(0, 10), hash, forgotten: false };
    Object.assign(note, { scope, load, text, hash });
    if (!current) book.notes.push(note);
    const change = this.change(book, { agent: agent.id, noteId: note.id, who: 'owner', before, after: snap(note), undoOf: null });
    return this.changed(book, note, change);
  }

  /** Forget erases the note's words everywhere Chausar kept them (eraseNote), so it cannot be undone. */
  private erase(book: Book, note: Note): void {
    const key = keyOf(note.text);
    for (const change of book.changes.filter((c) => c.noteId === note.id)) {
      if (change.before) change.before = { ...change.before, text: '', hash: '' };
      if (change.after) change.after = { ...change.after, text: '', hash: '' };
    }
    for (const prop of book.proposals.filter((x) => x.kind === 'note' && x.agent === note.agent && x.note && keyOf(x.note.text) === key)) {
      for (const msg of book.messages) if (msg.id === prop.messageId) msg.parts = [{ kind: 'text', text: ERASED_MESSAGE }];
      prop.quote = '';
      prop.note = { ...prop.note!, text: '' };
    }
    Object.assign(note, { text: '', hash: '', forgotten: true, quote: null });
  }

  private notesForget(p: Record<string, unknown>): AgentNoteChange {
    const body = exact(p, ['agent', 'noteId'], ['agent', 'noteId']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const book = this.book();
    const note = book.notes.find((n) => n.id === id(body.noteId, 'Note') && n.agent === agent.id && !n.forgotten);
    if (!note) throw invalid('That note was not found.');
    const change = this.change(book, { agent: agent.id, noteId: note.id, who: 'owner', before: snap(note), after: null, undoOf: null });
    this.erase(book, note);
    return this.changed(book, note, change);
  }

  private notesUndo(p: Record<string, unknown>): AgentNoteChange {
    const body = exact(p, ['agent', 'changeId'], ['agent', 'changeId']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const book = this.book();
    const change = book.changes.find((c) => c.id === id(body.changeId, 'Change') && c.agent === agent.id);
    if (!change) throw invalid('That change was not found.');
    const note = book.notes.find((n) => n.id === change.noteId);
    if (!note) throw invalid('That note was not found.');
    if (note.forgotten || (change.before !== null && change.before.text === '')) throw new EngineError('UNDO_NOTHING', FORGET_FINAL);
    if (this.undone(book, agent.id).has(change.id)) throw new EngineError('UNDO_NOTHING', 'You already undid that change.');
    const now = snap(note);
    if (change.after === null || now.hash !== change.after.hash) throw new EngineError('NOTE_CHANGED', 'This note changed after that. Undo the later change first.');
    if (change.before) {
      const room = this.room(book, agent, change.before, note.id);
      if (room) throw new EngineError('NOTES_FULL', room);
    }
    const made = this.change(book, { agent: agent.id, noteId: note.id, who: 'undo', before: now, after: change.before, undoOf: change.id });
    if (change.before) Object.assign(note, { text: change.before.text, hash: change.before.hash, scope: change.before.scope, load: change.before.load });
    else this.erase(book, note);
    return this.changed(book, note, made);
  }
}

function snap(note: Note): Snap {
  return { text: note.text, hash: note.hash, scope: note.scope, load: note.load };
}

/** The engine's exactPayload: one plain object with the required fields and nothing else. */
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!Object.keys(p).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(p, key))) throw invalid('Send the required fields and nothing else.');
  return p;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}

function onlyAsks(text: string): boolean {
  if (QUESTION_WORD.test(text)) return true;
  if (!ENDS_ASKING.test(text)) return false;
  return HELPING_VERB.test(text) || !POLITE.test(text);
}

/** detectStanding: "from now on" is always standing; else "remember" makes a note; else "always", "never", "I prefer". */
function standingClass(text: string): 'standing' | 'note' | null {
  if (STRONG_STANDING.some((pattern) => pattern.test(text))) return 'standing';
  if (onlyAsks(text)) return null;
  if (NOTE_WORDS.some((pattern) => pattern.test(text))) return 'note';
  if (WEAK_STANDING.some((pattern) => pattern.test(text))) return 'standing';
  return null;
}

function sentence(rest: string): string {
  if (!rest) return '';
  const first = rest.charAt(0).toUpperCase() + rest.slice(1);
  return /[\p{Script=Latin}\p{Nd}]$/u.test(first) ? `${first}.` : first;
}

const standingValue = (text: string): string => sentence(tidy(text).replace(LEAD, '').trim());
const noteValue = (text: string): string => sentence(tidy(text).replace(NOTE_LEAD, '').replace(NOTE_TAIL, '').trim());
