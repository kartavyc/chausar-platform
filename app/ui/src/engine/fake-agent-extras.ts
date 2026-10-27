/**
 * The fake engine's answers for the agent extras (Ink v2 wave 4, package 4J22b), from the engine's 4J17 and 4J18:
 * the business's voice (agents/voice.ts), an agent's persona and skills (persona.ts, skills.ts), the agent file
 * (export.ts), what the AI knows (knowledge.ts), ideas and who is waiting on you (ideas.ts), and the capability page
 * (capabilities.ts). Codes, shapes and lines are the engine's, word for word where the engine fixes them.
 *
 * Every voice and persona change is a new version, kept, and the view's undo is the one to set to go back. Learning a
 * voice is code, no model: the last text is held out and the voice is checked only when it passes. A persona test runs
 * on the practice clients with the built-in templates (Lumen's sample has no AI of its own), so it costs nothing. The
 * fake reads no web: a link source is read from its sample pages (SAMPLE_PAGES); any other address does not answer.
 * Ideas come from the fake's own records by the engine's three rules; Start drafts a proposal through the Chats desk
 * (not raised), Dismiss is kept. Who is waiting on you: orders and unhandled mail, newest first.
 * An agent file import is a proposal in the agent's chat through the agents' desk; nothing changes until it is accepted.
 */

import {
  EngineError, type AgentProposalView, type AgentView, type BlueprintViewLite, type CapabilityItemView, type CapabilityPageView,
  type ClientLite, type DeliveryLite, type DiffLine, type IdeaView, type KnowledgeSourceInput, type KnowledgeSourceView, type ModelStatusLite,
  type OrderLite, type PersonaFields, type PersonaView, type ProposalKind, type ProposalView, type RunDetail, type StandingOrdersView, type TeamListView,
  type UploadLite, type VoiceInput, type VoiceSections, type VoiceView, type PipelineIdeaView,
} from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4J22B_METHODS: readonly string[] = [
  'venture.voice.get', 'venture.voice.set', 'venture.voice.learn',
  'venture.persona.get', 'venture.persona.set', 'venture.persona.test',
  'venture.agents.export', 'venture.agents.import',
  'venture.knowledge.list', 'venture.knowledge.add', 'venture.knowledge.remove', 'venture.knowledge.test',
  'venture.ideas.list', 'venture.ideas.start', 'venture.ideas.dismiss',
  'venture.agents.capabilities',
];

/** What the other desks do for this one: draft a proposal from an idea (Chats), and an import in the agent's chat (agents). */
export interface AgentExtrasHooks {
  draftIdea?: (input: { kind: ProposalKind; title: string; line: string; agent: string | null; spends: boolean; sends: boolean; target: { invoice?: string; order?: string } }) => ProposalView;
  draftImport?: (input: { agent: string; orders: { stepId: string; text: string }[]; persona: PersonaFields | null; personaLines: DiffLine[]; skipped: string[]; onAccept: (() => void) | null }) => AgentProposalView;
  say?: (agent: string, text: string) => void;
  /** Mail the owner answers themselves that is not handled yet (the pipeline desk's inbound records). */
  waitingMail?: () => { id: string; who: string; date: string }[];
  /** 5A3: the idea pipeline on the same list (fake-kit-rules.ts). */
  pipelineIdeas?: () => PipelineIdeaView[];
}

// ---------------------------------------------------------------------------------------------------------------
// The engine's words
// ---------------------------------------------------------------------------------------------------------------

const KEY_REFUSED = "That looks like a key. Keys go in Connections, never in your voice or an agent's persona.";
const ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Chausar never keeps those here, so nothing was saved.';
const VOICE_NONE = 'You have no voice yet. Write one in your own words, or learn one from three to ten of your own texts.';
const LANGUAGE_WORDS = { en: 'English', hi: 'Hindi' } as const;
const VOICE_CHANNELS = ['email', 'whatsapp', 'instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts', 'youtube'];
const SECTIONS = ['audience', 'howITalk', 'neverUse', 'wordsIUse', 'willNotClaim', 'format'] as const;
type SectionId = (typeof SECTIONS)[number];
const SECTION_LINES: Readonly<Record<SectionId, number>> = { audience: 6, howITalk: 12, neverUse: 60, wordsIUse: 30, willNotClaim: 20, format: 8 };
const SECTION_CHARS: Readonly<Record<SectionId, number>> = { audience: 200, howITalk: 200, neverUse: 60, wordsIUse: 60, willNotClaim: 200, format: 200 };

const NO_PERSONA: PersonaFields = { tone: null, replyLength: null, greeting: null, handOffLine: null, blockedTopics: [], signOff: null };
const FIELD_WORDS = { tone: 'tone', greeting: 'greeting', handOffLine: 'hand-off line', signOff: 'sign-off', blockedTopics: 'blocked topic' } as const;
const FIELD_CHARS = { tone: 160, greeting: 80, handOffLine: 200, signOff: 80 } as const;
const PERSONA_TAIL = "A persona sets only how the agent talks; it comes after Chausar's rules and never changes them.";
const SCENARIO_TITLES = ['A clear request', 'A messy request', 'A pushy client'];
const LENGTH_WORDS = { short: 'Thanks for writing. I will keep this short.', medium: 'Thanks for writing. Here is how I would start.', long: 'Thanks for writing. Let me walk you through how I would start, step by step.' } as const;

const KNOWLEDGE_LINE = "Agents read the sources that share words with an order's request, as background they can't take as instructions. Test a question to see which source would answer it.";
const REMOVED_LINE = 'Removed. Chausar no longer keeps its words.';
const ERASED_LINE = 'Some words were erased: you asked Chausar to forget them.';
const WEB_SOURCE_LINE = 'One site only: not confirmed elsewhere.';
const TWICE = 'You added this source already.';
/** The fake's web: the pages a link source can be read from, by address (the sample's own words). */
const SAMPLE_PAGES: Readonly<Record<string, { title: string; text: string }>> = {
  'https://example.com/recording-checklist': { title: 'Recording checklist', text: 'Check the mic level before recording. Record ten seconds of room tone.' },
  'https://example.com/delivery-times': { title: 'Delivery times', text: 'Episodes are edited within five working days. Shorts follow two days after the episode.' },
  'https://example.com/blank': { title: '', text: '' },
};

const STARTED_LINE = 'Drafted. Put it on Today when you are ready: nothing changes until you approve it there.';
const DISMISSED_LINE = "Dismissed. Chausar won't suggest this again.";
const RETIRED = 'This idea no longer holds: what it was based on changed. Nothing was started.';

const NOT_A_FILE = 'That is not an agent file from Chausar. Export one from an agent, then import that file.';

// The capability page's words (agents/capabilities.ts).
const TEAM_LINE = "The order's AI team shares one tool list: every agent that works on the order's files can use each tool here, and Chausar's code refuses any other. Whatever is on, anything that sends, spends, posts or changes a price still waits for your approval.";
const APPROVAL = 'Anything that sends, spends, posts or changes a price still waits for your approval.';
const NO_TOOLS_LINE = `It holds no tools of its own: it works from what the team found. ${APPROVAL}`;
const PROVIDER = 'Send each step, with what it reads, to your own AI provider: your key or the CLI you set up.';
const NO_CLI = 'neither Claude Code nor Codex is set up on this computer.';
const TOOL_WORDS = {
  'files.list': 'The list of files the client sent with the order.',
  'files.read': 'The files the client sent with the order: tables, PDF text and transcript lines.',
  'dictionary.browse': 'Your business dictionary: its terms, offers, steps and settings.',
  'handoff.client': 'Ask the client a question. You pass it on: nothing reaches the client without you.',
  'handoff.owner': 'Ask you a question and wait for your answer.',
  'agent.delegate': 'Hand a big job to your own Claude Code or Codex on this computer, only after you approve its brief.',
} as const;
const INPUT_WORDS = {
  request: "The client's request on the order and the offer it is for.",
  files: 'The names and kinds of the files on the order.',
  answers: 'Your answers to the questions the team asked, and the client answers you passed on.',
  notes: 'The notes of the agents working on the order, as background that grants nothing.',
  knowledge: 'Sources from what the AI knows that share words with the order, as background. They can include work you accepted for other clients.',
  proven: "What the team's tools proved on the order, and the team's note on each step.",
  verify: 'The draft, to run its checks.',
} as const;
const OUTBOX_MAIL = 'Propose an email for your approval. Nothing is sent: Chausar records it, and you send it yourself from your own mail app.';
const OUTBOX_LINK = 'Propose a payment link for your approval. Planned: no payment link connector is built, so the proposal is only recorded.';
const OFF_WORDS = {
  send: "Can't send anything to a client, a contact or the public.",
  money: "Can't move money or ask for it.",
  write: "Can't change your records, files or connected services.",
} as const;
const WRITE_TAIL = 'You check the draft before anything leaves Chausar.';
const JUDGE_ON = 'Code runs the checks, then an AI judge reads the draft on your own AI.';

/** What each sample step is, as the playbook's step kinds say (the fake's agents carry only id and purpose). */
const STEP_KIND: Readonly<Record<string, 'gather' | 'work' | 'write' | 'verify' | 'floor'>> = {
  cut: 'work', shorts: 'work', finish: 'verify', publish: 'floor', titles: 'write', thumbs: 'verify', brief: 'gather', price: 'floor', send: 'floor',
  post: 'floor', match: 'work', gst: 'verify', portal: 'floor', draft: 'write', issue: 'floor',
};
/** The floor reason each always-ask step carries (the flagship playbooks' own words). */
const FLOOR_LINE: Readonly<Record<string, string>> = {
  publish: 'Publishing always asks you first.', price: 'A price change always asks you first.', send: 'Sending to a client always asks you first.',
  portal: 'Anything on the GST portal always asks you first.', issue: 'Issuing an invoice always asks you first.', post: 'Posting always asks you first.',
};
/** Steps that need a connector mode this build does not have (connector truth: Instagram posting is planned). */
const NEEDS_PLANNED: Readonly<Record<string, string>> = { post: 'Instagram' };

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

const clone = <T>(value: T): T => structuredClone(value);
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
const sentence = (text: string) => { const words = text.trim(); return /[.!?]$/.test(words) ? words : `${words}.`; };
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const listWords = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The owner's calendar day of an instant, in Kolkata (the sample businesses are in India). */
const localDay = (iso: string): string => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
/** formatVentureDate, day-month-year: "28 Oct 2026". */
const dayWords = (day: string): string => `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const monthWords = (month: string): string => `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!p || typeof p !== 'object' || Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) throw invalid('Send the required fields and nothing else.');
  return p;
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw invalid(`${field} must be an id.`);
  return value;
}

/** A key, and a card, bank, Aadhaar or one-time code number, as far as the fake knows them (core/secrets.ts finds more). */
const KEY = /\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/;
const ID_NUMBER = /\b\d{4}[ -]?\d{4}[ -]?\d{4}(?:[ -]?\d{4})?\b/;
/** Words aimed at an agent or a checker (policy/untrusted.ts INJECTION and CHECKER, their plainest forms). */
const INJECTION = /\b(?:ignore|disregard|forget)\b[^.]{0,30}\b(?:previous|prior|above|earlier|all)\b[^.]{0,20}\b(?:instructions?|rules?|prompts?)\b|\byou are now\b|\bsystem prompt\b/i;
const CHECKER = /\b(?:mark|rate|score)\b[^.]{0,30}\b(?:as )?(?:passed|pass|approved|safe)\b|\bapprove every\b/i;

/** Common words learn and search leave out (playbooks/voice-match.ts VOICE_STOP_WORDS, the English and Hindi part). */
const STOP = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'yours', 'our', 'ours', 'all', 'any', 'can', 'has', 'have', 'had', 'was', 'were', 'will', 'with',
  'this', 'that', 'these', 'those', 'from', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'how', 'they', 'them', 'their', 'then', 'than', 'there',
  'here', 'into', 'out', 'about', 'over', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'too', 'very', 'just', 'also', 'now', 'its', 'one',
  'some', 'each', 'every', 'been', 'being', 'does', 'did', 'doing', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'let', 'get', 'got',
  'है', 'हैं', 'था', 'थे', 'का', 'की', 'के', 'में', 'से', 'को', 'और', 'यह', 'वह', 'ये', 'वे', 'पर', 'भी', 'तो', 'ही', 'कि', 'एक', 'हम', 'आप', 'नहीं', 'लिए',
]);
const DEVANAGARI = /\p{Script=Devanagari}/u;
const fold = (text: string) => text.normalize('NFKC').toLowerCase();
const wordsOf = (text: string): string[] => [...fold(text).matchAll(/[\p{L}\p{M}]+/gu)].map((match) => match[0])
  .filter((word) => !STOP.has(word) && (DEVANAGARI.test(word) ? word.length >= 2 : word.length >= 3));
/** A word compared with others: an English plural taken back to its one, as knowledge-recall.ts stem does. */
const stem = (word: string) => (!/^[a-z]+$/.test(word) ? word : word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word);
const stemsOf = (text: string) => new Set(wordsOf(text).map(stem));
const sentencesOf = (text: string): string[] => text.split(/[.!?।]+/u).map((item) => item.trim()).filter((item) => /\p{L}/u.test(item));

// ---------------------------------------------------------------------------------------------------------------
// What the desk keeps
// ---------------------------------------------------------------------------------------------------------------

interface VoiceRec { language: 'en' | 'hi'; channel: string | null; on: boolean; sections: VoiceSections; validated: boolean; version: number; draft: boolean; learned: { lines: string[]; line: string; from: number } | null }
interface PersonaRec { agent: string; persona: PersonaFields; version: number }
interface SourceRec { id: string; kind: KnowledgeSourceView['kind']; title: string; text: string; at: string; url: string | null; uploadId: string | null; runId: string | null; hid: string[]; held: string[]; removed: boolean }
interface Book { voices: VoiceRec[]; personas: PersonaRec[]; sources: SourceRec[]; ideas: Map<string, 'started' | 'dismissed'> }

const sections = (part: Partial<VoiceSections>): VoiceSections => ({ audience: [], howITalk: [], neverUse: [], wordsIUse: [], willNotClaim: [], format: [], ...part });

/** Lumen's sample: one English voice for every channel, at its second version; four sources, one held, one with words erased. */
function lumenBook(): Book {
  const v1 = sections({ audience: ['Podcasters and small studios'], howITalk: ['Plain and friendly'], neverUse: ['guaranteed'], willNotClaim: ['That a video will go viral'], format: ['Short sentences'] });
  const v2 = sections({ ...v1, howITalk: ['Plain and friendly', 'Opens with: "Hi there"'], neverUse: ['guaranteed', 'viral'], wordsIUse: ['episode', 'mic'] });
  return {
    voices: [
      { language: 'en', channel: null, on: true, sections: v1, validated: false, version: 1, draft: false, learned: null },
      { language: 'en', channel: null, on: true, sections: v2, validated: false, version: 2, draft: false, learned: null },
    ],
    personas: [],
    sources: [
      {
        id: 'know_sponsors', kind: 'text', title: 'How we work with sponsors', at: '2026-10-18T05:00:00.000Z', url: null, uploadId: null, runId: null, hid: [], held: [], removed: false,
        text: 'Sponsors book a mention a month ahead. Sponsors pay half when they book and half once the episode is public. A mention runs after the intro.',
      },
      {
        id: 'know_checklist', kind: 'link', title: 'Recording checklist', at: '2026-10-19T06:00:00.000Z', url: 'https://example.com/recording-checklist', uploadId: null, runId: null, hid: [], held: [], removed: false,
        text: 'Check the mic level before recording. Record ten seconds of room tone.',
      },
      {
        id: 'know_edit', kind: 'past-work', title: 'Accepted work: Episode edit', at: '2026-10-20T07:00:00.000Z', url: null, uploadId: null, runId: 'd-ep12-script', hid: [], held: [], removed: false,
        text: 'The intro was cut to the client\'s line. Erased: you asked Chausar to forget these words. The chapters follow the topics.',
      },
      {
        id: 'know_brief', kind: 'file', title: 'Sponsor brief notes', at: '2026-10-21T08:00:00.000Z', url: null, uploadId: 'u-brief-boat-14', runId: null,
        hid: ['a bank account number'], held: ['words aimed at an agent'], removed: false, text: 'Two mentions in episode 14.',
      },
    ],
    ideas: new Map(),
  };
}

export class FakeAgentExtras {
  private readonly host: W4DeskHost;
  private readonly fresh: boolean;
  private readonly hooks: AgentExtrasHooks;
  private readonly books = new Map<string, Book>();
  private seq = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean; hooks?: AgentExtrasHooks } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
    this.hooks = options.hooks ?? {};
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.voice.get': exact(p, []); return this.voiceView();
      case 'venture.voice.set': return this.voiceSet(p);
      case 'venture.voice.learn': return this.voiceLearn(p);
      case 'venture.persona.get': { const body = exact(p, ['agent']); return this.personaView(this.agent(id(body.agent, 'Agent'))); }
      case 'venture.persona.set': return this.personaSet(p);
      case 'venture.persona.test': return this.personaTest(p);
      case 'venture.agents.export': return this.exportFile(p);
      case 'venture.agents.import': return this.importFile(p);
      case 'venture.knowledge.list': exact(p, []); return this.knowledgeList();
      case 'venture.knowledge.add': return this.knowledgeAdd(p);
      case 'venture.knowledge.remove': return this.knowledgeRemove(p);
      case 'venture.knowledge.test': return this.knowledgeTest(p);
      case 'venture.ideas.list': exact(p, []); return { ideas: this.ideas().map(ideaView), waiting: this.waiting(), pipeline: this.hooks.pipelineIdeas?.() ?? [] };
      case 'venture.ideas.start': return this.ideaStart(p);
      case 'venture.ideas.dismiss': return this.ideaDismiss(p);
      case 'venture.agents.capabilities': { const body = exact(p, ['agent']); return this.capabilities(id(body.agent, 'Agent')); }
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private book(): Book {
    const current = this.host.current();
    if (!current) throw new EngineError('VAULT_LOCKED', 'Open a business first.');
    let book = this.books.get(current);
    if (!book) {
      book = !this.fresh && current === 'lumen' ? lumenBook() : { voices: [], personas: [], sources: [], ideas: new Map() };
      this.books.set(current, book);
    }
    return book;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}${this.host.digest({ prefix, seq: this.seq }).slice(0, 6)}`;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Voice (agents/voice.ts)
  // ---------------------------------------------------------------------------------------------------------------

  private inUse(): VoiceRec[] {
    const newest = new Map<string, VoiceRec>();
    for (const record of this.book().voices) {
      if (record.draft) continue;
      const key = `${record.language}|${record.channel ?? ''}`;
      const held = newest.get(key);
      if (!held || record.version >= held.version) newest.set(key, record);
    }
    return [...newest.values()].sort((a, b) => (a.language === b.language ? (a.channel ?? '').localeCompare(b.channel ?? '') : a.language === 'en' ? -1 : 1));
  }

  private openDraft(): VoiceRec | null {
    const voices = this.book().voices;
    const at = voices.findLastIndex((record) => record.draft);
    if (at < 0) return null;
    const draft = voices[at]!;
    return voices.slice(at + 1).some((record) => !record.draft && record.language === draft.language && record.channel === draft.channel) ? null : draft;
  }

  private voiceView(line?: string): VoiceView {
    const voices = this.inUse();
    const on = voices.filter((voice) => voice.on).length;
    const draft = this.openDraft();
    return {
      voices: voices.map((voice) => {
        const before = this.book().voices.filter((item) => !item.draft && item.language === voice.language && item.channel === voice.channel && item.version < voice.version).sort((a, b) => b.version - a.version)[0];
        return {
          language: voice.language, channel: voice.channel, on: voice.on, sections: clone(voice.sections), validated: voice.validated, version: voice.version,
          undo: before ? { language: before.language, channel: before.channel, on: before.on, sections: clone(before.sections) } : null,
        };
      }),
      line: line ?? (voices.length ? `${voices.length} ${voices.length === 1 ? 'voice' : 'voices'}, ${on} on. Every draft is checked against the voices that are on.` : VOICE_NONE),
      draft: draft ? { language: draft.language, channel: draft.channel, sections: clone(draft.sections), validated: draft.validated, learnedFrom: draft.learned?.from ?? 0, lines: [...(draft.learned?.lines ?? [])], line: draft.learned?.line ?? '' } : null,
    };
  }

  private voiceInput(value: unknown): Required<VoiceInput> {
    if (!value || typeof value !== 'object') throw invalid('Send one voice.');
    const body = exact(value as Record<string, unknown>, ['language', 'channel', 'on', 'sections'], ['language', 'on', 'sections']);
    if (body.language !== 'en' && body.language !== 'hi') throw invalid('Choose English or Hindi.');
    const channel = (body.channel ?? null) as string | null;
    if (channel !== null && !VOICE_CHANNELS.includes(channel)) throw invalid(`Choose every channel or one of: ${VOICE_CHANNELS.join(', ')}.`);
    if (typeof body.on !== 'boolean') throw invalid('Say whether this voice is on or off.');
    const raw = body.sections as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || SECTIONS.some((key) => !(key in raw)) || Object.keys(raw).some((key) => !(SECTIONS as readonly string[]).includes(key))) throw invalid('Send the required fields and nothing else.');
    const out = {} as VoiceSections;
    for (const key of SECTIONS) {
      const lines = raw[key];
      if (!Array.isArray(lines)) throw invalid('Each part of your voice is a list of lines.');
      if (lines.length > SECTION_LINES[key]) throw invalid(`Keep that part of your voice to ${SECTION_LINES[key]} lines or fewer.`);
      const kept: string[] = [];
      for (const item of lines) {
        if (typeof item !== 'string' || !item.trim()) throw invalid('A line of your voice is empty.');
        if (item.trim().length > SECTION_CHARS[key]) throw invalid(`A line of your voice is too long: keep each to ${SECTION_CHARS[key]} characters.`);
        const line = tidy(item);
        if (KEY.test(line)) throw new EngineError('CHAT_KEY_REFUSED', KEY_REFUSED);
        if (ID_NUMBER.test(line)) throw new EngineError('CHAT_KEY_REFUSED', ID_REFUSED);
        if (!kept.some((held) => held.toLowerCase() === line.toLowerCase())) kept.push(line);
      }
      out[key] = kept;
    }
    return { language: body.language, channel, on: body.on, sections: out };
  }

  /** venture.voice.set: a new version for its language and channel; validated only with the sections it was checked with. */
  private voiceSet(p: Record<string, unknown>): VoiceView {
    const body = exact(p, ['voice']);
    const input = this.voiceInput(body.voice);
    const book = this.book();
    const same = book.voices.filter((record) => !record.draft && record.language === input.language && record.channel === input.channel);
    const version = Math.max(0, ...same.map((record) => record.version)) + 1;
    const sameSections = (a: VoiceSections, b: VoiceSections) => SECTIONS.every((key) => a[key].length === b[key].length && a[key].every((line, at) => line === b[key][at]));
    const draft = this.openDraft();
    const current = this.inUse().find((record) => record.language === input.language && record.channel === input.channel);
    const source = [draft && draft.language === input.language && draft.channel === input.channel ? draft : null, current ?? null]
      .find((record) => record && record.validated && sameSections(record.sections, input.sections)) ?? null;
    book.voices.push({ language: input.language, channel: input.channel, on: input.on, sections: clone(input.sections), validated: !!source, version, draft: false, learned: source?.learned ?? null });
    const where = input.channel === null ? 'every channel' : input.channel;
    const back = version > 1 ? ` Version ${version - 1} is kept; undo sets it again.` : '';
    return this.voiceView(`Your ${LANGUAGE_WORDS[input.language]} voice for ${where} is version ${version}, ${input.on ? 'on' : 'off'}.${back}`);
  }

  /** venture.voice.learn: code learns a voice from three to ten texts, the last held out (learnVoice); kept as a draft. */
  private voiceLearn(p: Record<string, unknown>): VoiceView {
    const body = exact(p, ['samples']);
    if (!Array.isArray(body.samples) || body.samples.length < 3 || body.samples.length > 10) throw invalid('Add 3 to 10 of your own texts: mails, posts or what you said in a video.');
    const samples = (body.samples as unknown[]).map((sample) => {
      if (typeof sample !== 'string' || sample.trim().length < 20 || sample.length > 5000) throw invalid('Each text must be 20 to 5000 characters.');
      return sample.replace(/\r\n?/g, '\n').replace(KEY, '[hidden]').replace(ID_NUMBER, '[hidden]');
    });
    const learned = learnVoice(samples);
    const book = this.book();
    const current = this.inUse().find((record) => record.language === learned.language && record.channel === null);
    const record: VoiceRec = {
      language: learned.language, channel: null, on: true, validated: learned.passed, version: 0, draft: true,
      sections: sections({ audience: [...(current?.sections.audience ?? [])], howITalk: learned.howITalk, neverUse: [...(current?.sections.neverUse ?? [])], wordsIUse: learned.wordsIUse, willNotClaim: [...(current?.sections.willNotClaim ?? [])], format: learned.format }),
      learned: { lines: learned.lines, line: learned.line, from: learned.from },
    };
    const open = this.openDraft();
    if (open) book.voices.splice(book.voices.indexOf(open), 1, record); else book.voices.push(record);
    return this.voiceView(`Learned from ${learned.from} of your texts. ${learned.line} Nothing changes until you set it.`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Persona and skills (agents/persona.ts, skills.ts)
  // ---------------------------------------------------------------------------------------------------------------

  private agents(): AgentView[] {
    return (this.host.ask('venture.team.list', {}) as TeamListView).agents;
  }

  /** chatAgent: Keeper and code roles are AGENT_IS_CODE; an id not on the team is AGENT_NOT_FOUND. */
  private agent(agentId: string): AgentView {
    if (agentId === 'keeper') throw new EngineError('AGENT_IS_CODE', 'Keeper is code, not AI. It holds no tools; its jobs are on Team.');
    const found = this.agents().find((agent) => agent.id === agentId);
    if (!found) throw new EngineError('AGENT_NOT_FOUND', 'That agent was not found.');
    if (found.kind === 'code') throw new EngineError('AGENT_IS_CODE', `${found.name} is code, not AI. It has no chat; its work shows in each run's steps.`);
    return found;
  }

  /** agentSkills: one per step it does with the owner's AI (gather, question, work, write), with a starter that only asks. */
  private skills(agent: AgentView): PersonaView['skills'] {
    return agent.steps.filter((step) => ['gather', 'work', 'write'].includes(STEP_KIND[step.id] ?? 'work') && !step.floor).map((step) => {
      const name = tidy(step.purpose).split(',')[0]!.trim();
      const verb = lowerFirst(name).replace(/[.]$/, '');
      const starter = STEP_KIND[step.id] === 'gather' ? `What do you need from me before you ${verb}?` : `How would you ${verb} for my next order?`;
      return { name, line: sentence(tidy(step.purpose)), starter };
    });
  }

  private personaView(agent: AgentView, line?: string): PersonaView {
    const versions = this.book().personas.filter((record) => record.agent === agent.id).sort((a, b) => a.version - b.version);
    const current = versions.at(-1) ?? null;
    const before = versions.at(-2) ?? null;
    return {
      agent: agent.id, persona: clone(current?.persona ?? NO_PERSONA), skills: this.skills(agent),
      line: line ?? (current ? `Version ${current.version} is in use from ${agent.name}'s next run.` : `${agent.name} has no persona yet, so it talks the way its role says. Its role and the facts it uses stay the same whatever you set.`),
      version: current?.version ?? 0, undo: before ? clone(before.persona) : null,
    };
  }

  /** checkPersona: style only. A number, a change to the rules, or to the facts is PERSONA_FIELD_REFUSED. */
  private checkPersona(value: unknown): PersonaFields {
    if (!value || typeof value !== 'object') throw invalid('Send the persona.');
    const fields = ['tone', 'replyLength', 'greeting', 'handOffLine', 'blockedTopics', 'signOff'];
    const body = exact(value as Record<string, unknown>, fields);
    if (body.replyLength !== null && !['short', 'medium', 'long'].includes(body.replyLength as string)) throw invalid('Choose short, medium or long replies, or none.');
    if (!Array.isArray(body.blockedTopics) || body.blockedTopics.length > 12) throw invalid('List up to 12 topics the agent stays away from.');
    const refuse = (field: keyof typeof FIELD_WORDS, why: string) => new EngineError('PERSONA_FIELD_REFUSED', `The ${FIELD_WORDS[field]} ${why} ${PERSONA_TAIL}`);
    const check = (field: keyof typeof FIELD_WORDS, text: string) => {
      if (KEY.test(text)) throw new EngineError('CHAT_KEY_REFUSED', KEY_REFUSED);
      if (ID_NUMBER.test(text)) throw new EngineError('CHAT_KEY_REFUSED', ID_REFUSED);
      if (/\p{Nd}/u.test(text) || /%/.test(text) || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b/i.test(text)) throw refuse(field, "has a number. Numbers come from your plan and Chausar's calculator.");
      if (/\b(?:ignor\w*|overrid\w*|bypass\w*|rules?|instructions?|checks?|approv\w*|safety)\b/i.test(text)) throw refuse(field, "asks to change Chausar's rules, the checks or your approval.");
      if (field !== 'blockedTopics' && /\b(?:guarantee\w*|promis\w*|free of charge|for free|refunds?)\b/i.test(text)) throw refuse(field, 'changes what is true about the business: prices, promises and facts come from your plan.');
    };
    const one = (name: keyof typeof FIELD_CHARS): string | null => {
      const raw = body[name];
      if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) return null;
      if (typeof raw !== 'string') throw invalid(`The ${FIELD_WORDS[name]} must be words.`);
      if (tidy(raw).length > FIELD_CHARS[name]) throw invalid(`The ${FIELD_WORDS[name]} is too long: keep it to ${FIELD_CHARS[name]} characters.`);
      const text = tidy(raw);
      check(name, text);
      return text;
    };
    const persona: PersonaFields = { tone: one('tone'), replyLength: body.replyLength as PersonaFields['replyLength'], greeting: one('greeting'), handOffLine: one('handOffLine'), blockedTopics: [], signOff: one('signOff') };
    for (const item of body.blockedTopics as unknown[]) {
      if (typeof item !== 'string' || !item.trim()) throw invalid('A blocked topic is empty.');
      const topic = tidy(item);
      if (topic.length > 60) throw invalid('A blocked topic is too long: keep it to 60 characters.');
      check('blockedTopics', topic);
      if (!persona.blockedTopics.some((held) => held.toLowerCase() === topic.toLowerCase())) persona.blockedTopics.push(topic);
    }
    return persona;
  }

  /** writePersonaVersion: the next version, kept; the agent says so in its chat. */
  private writePersona(agent: AgentView, persona: PersonaFields, source: 'owner' | 'import'): PersonaRec {
    const versions = this.book().personas.filter((record) => record.agent === agent.id).sort((a, b) => a.version - b.version);
    const back = versions.length >= 2 && JSON.stringify(versions.at(-2)!.persona) === JSON.stringify(persona);
    const record: PersonaRec = { agent: agent.id, persona: clone(persona), version: (versions.at(-1)?.version ?? 0) + 1 };
    this.book().personas.push(record);
    const words = source === 'import' ? 'The persona from the agent file you accepted is' : back ? 'Going back, my earlier way of talking is' : 'Your changes to how I talk are';
    this.hooks.say?.(agent.id, `${words} version ${record.version}, in use from my next run. You can undo it in my persona.`);
    return record;
  }

  private personaSet(p: Record<string, unknown>): PersonaView {
    const body = exact(p, ['agent', 'persona']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const persona = this.checkPersona(body.persona);
    const record = this.writePersona(agent, persona, 'owner');
    const back = record.version > 1 ? ` Version ${record.version - 1} is kept; undo sets it again.` : '';
    return this.personaView(agent, `Version ${record.version} is in use from ${agent.name}'s next run.${back}`);
  }

  /** venture.persona.test: the unsaved persona's first reply to each practice client, with the built-in templates or the owner's AI. */
  private personaTest(p: Record<string, unknown>): { results: { scenario: string; reply: string }[]; cost: string; line: string } {
    const body = exact(p, ['agent', 'persona']);
    this.agent(id(body.agent, 'Agent'));
    const persona = this.checkPersona(body.persona);
    const status = this.host.ask('venture.models.status', {}) as ModelStatusLite;
    const templates = !status.tiers.main || status.tiers.main.presetId === 'built-in-templates';
    const reply = [persona.greeting ? `${persona.greeting}.` : 'Hello.', LENGTH_WORDS[persona.replyLength ?? 'medium'], persona.handOffLine ?? '', persona.signOff ?? ''].filter(Boolean).join(' ').replace(/\.\./g, '.');
    return {
      results: SCENARIO_TITLES.map((scenario) => ({ scenario, reply })),
      // The templates cost nothing; the fake's own AI is priced as the fake's model calls are (USD 0.0014 a reply).
      cost: templates ? 'USD 0.0000' : 'USD 0.0042',
      line: `Tried on ${SCENARIO_TITLES.length} practice clients with ${templates ? 'built-in templates' : 'your AI'}. Nothing was saved.`,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The agent file (agents/export.ts)
  // ---------------------------------------------------------------------------------------------------------------

  private orders(agent: AgentView): StandingOrdersView {
    return this.host.ask('venture.agents.orders.list', { agent: agent.id }) as StandingOrdersView;
  }

  /** A line with no client's name in it ("the client"), as the export's clean() keeps it. */
  private clean(text: string): string {
    let out = text;
    const names = (this.host.ask('venture.client.list', {}) as ClientLite[]).flatMap((client) => [client.name, ...client.name.split(/\s+/).filter((part) => part.length >= 3)]).sort((a, b) => b.length - a.length);
    for (const name of names) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), 'the client');
    return tidy(out.replace(/the client(?:\s+the client)+/g, 'the client'));
  }

  private exportFile(p: Record<string, unknown>): { fileName: string; text: string } {
    const body = exact(p, ['agent']);
    const agent = this.agent(id(body.agent, 'Agent'));
    const orders = this.orders(agent);
    const persona = this.personaView(agent).persona;
    const file = {
      format: 'chausar-agent', version: 1, agent: { id: agent.id, name: agent.name, job: this.clean(agent.role) }, flagship: null,
      steps: orders.steps.map((step) => ({ id: step.stepId, kind: STEP_KIND[step.stepId] ?? 'work', title: this.clean(step.title), guidance: step.guidance.map((line) => this.clean(line)) })),
      persona: { ...persona, tone: persona.tone && this.clean(persona.tone), greeting: persona.greeting && this.clean(persona.greeting), handOffLine: persona.handOffLine && this.clean(persona.handOffLine), signOff: persona.signOff && this.clean(persona.signOff), blockedTopics: persona.blockedTopics.map((topic) => this.clean(topic)) },
      standingOrders: orders.orders.map((order) => ({ stepId: order.stepId, text: this.clean(order.text) })),
    };
    return { fileName: `chausar-agent-${agent.id}.json`, text: JSON.stringify(file, null, 2) };
  }

  /** venture.agents.import: the file read as untrusted, for the agent with its id; a proposal in its chat, never a change. */
  private importFile(p: Record<string, unknown>): { proposal: AgentProposalView } {
    const body = exact(p, ['text']);
    if (typeof body.text !== 'string' || body.text.trim().length < 2 || body.text.length > 100_000) throw invalid(NOT_A_FILE);
    let raw: unknown;
    try { raw = JSON.parse(body.text); } catch { throw invalid(NOT_A_FILE); }
    const file = raw as { format?: unknown; version?: unknown; agent?: { id?: unknown }; steps?: unknown; persona?: unknown; standingOrders?: unknown } | null;
    if (!file || typeof file !== 'object' || file.format !== 'chausar-agent' || file.version !== 1) throw invalid(NOT_A_FILE);
    if (Object.keys(file).some((key) => !['format', 'version', 'agent', 'flagship', 'steps', 'persona', 'standingOrders'].includes(key))) throw invalid(`${NOT_A_FILE} It holds fields an agent file never has, such as tools, limits or a posture.`);
    if (!file.agent || typeof file.agent.id !== 'string' || !Array.isArray(file.standingOrders)) throw invalid(NOT_A_FILE);
    const screened = (text: string, field: string) => {
      if (INJECTION.test(text) || CHECKER.test(text)) throw new EngineError('UNTRUSTED_HELD', `The ${field} in this file has words aimed at an agent or a checker, or hidden characters, so nothing from it was imported.`);
      return tidy(text);
    };
    const agent = this.agent(id(file.agent.id, 'Agent'));
    const persona = this.checkPersona(file.persona);
    for (const field of ['tone', 'greeting', 'handOffLine', 'signOff'] as const) if (persona[field]) screened(persona[field]!, FIELD_WORDS[field]);
    const orders = this.orders(agent);
    const kept: { stepId: string; text: string }[] = [];
    const skipped: string[] = [];
    for (const order of file.standingOrders as { stepId?: unknown; text?: unknown }[]) {
      if (typeof order?.stepId !== 'string' || typeof order.text !== 'string') throw invalid(NOT_A_FILE);
      const text = screened(order.text, 'standing order');
      const step = orders.steps.find((item) => item.stepId === order.stepId);
      if (!step) { skipped.push(`"${text}" is for a step ${agent.name} does not do here.`); continue; }
      if (step.guidance.includes(text)) continue;
      kept.push({ stepId: order.stepId, text });
    }
    const current = this.personaView(agent).persona;
    const change = JSON.stringify(current) === JSON.stringify(persona) ? null : persona;
    if (!kept.length && !change) throw invalid(`This file holds nothing new for ${agent.name}.${skipped.length ? ` ${skipped[0]}` : ''}`);
    if (!this.hooks.draftImport) throw new EngineError('METHOD_NOT_ALLOWED', 'The fake engine does not answer venture.agents.import.');
    const parts = change ? [
      change.tone ? `tone "${change.tone}"` : null, change.replyLength ? `${change.replyLength} replies` : null, change.greeting ? `greeting "${change.greeting}"` : null,
      change.handOffLine ? `hand-off line "${change.handOffLine}"` : null, change.blockedTopics.length ? `stays away from ${change.blockedTopics.join(', ')}` : null,
      change.signOff ? `sign-off "${change.signOff}"` : null,
    ].filter((part): part is string => part !== null) : [];
    const personaLines: DiffLine[] = change ? [{ op: 'add', text: parts.length ? `How I talk: ${parts.join('; ')}.` : 'How I talk: no persona, the way my role says.' }] : [];
    const proposal = this.hooks.draftImport({ agent: agent.id, orders: kept, persona: change, personaLines, skipped, onAccept: change ? () => { this.writePersona(agent, change, 'import'); } : null });
    return { proposal };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // What the AI knows (agents/knowledge.ts)
  // ---------------------------------------------------------------------------------------------------------------

  private live(): SourceRec[] {
    return this.book().sources.filter((source) => !source.removed);
  }

  private clientOfOrder(orderId: string | null | undefined): string {
    const order = (this.host.ask('venture.order.list', {}) as OrderLite[]).find((item) => item.id === orderId);
    const client = order ? (this.host.ask('venture.client.list', {}) as ClientLite[]).find((item) => item.id === order.clientId) : undefined;
    return client?.name ?? 'a client';
  }

  private sourceView(record: SourceRec): KnowledgeSourceView {
    const day = dayWords(localDay(record.at));
    let lead: string;
    if (record.kind === 'text') lead = `Your own words, added ${day}.`;
    else if (record.kind === 'link') {
      let host: string | null = null;
      try { host = record.url ? new URL(record.url).hostname : null; } catch { host = null; }
      lead = `${host ? `From ${host}, read ${day}.` : `From a web page, read ${day}.`} ${WEB_SOURCE_LINE}`;
    } else if (record.kind === 'file') {
      const upload = (this.host.ask('venture.files.list', {}) as UploadLite[]).find((item) => item.id === record.uploadId);
      lead = `From ${record.title}, a file on ${this.clientOfOrder(upload?.scope.kind === 'order' ? upload.scope.orderId : null)}'s order, read ${day}.`;
    } else {
      const run = (this.host.ask('venture.delivery.list', {}) as DeliveryLite[]).find((item) => item.id === record.runId);
      lead = `Work you accepted for ${this.clientOfOrder(run?.orderId)}, kept ${day}.`;
    }
    const erased = /Erased: you asked Chausar to forget these words\.|someone you asked Chausar to forget/.test(`${record.title} ${record.text}`);
    const line = [
      lead, ...(record.hid.length ? [`Chausar hid what looked like ${listWords(record.hid)} in it.`] : []),
      ...(erased ? [ERASED_LINE] : []),
      ...(record.held.length ? [`Held: it has ${listWords(record.held)}, so agents never read the parts that hold them.`] : []),
    ].join(' ');
    return { id: record.id, kind: record.kind, title: record.title, at: record.at, line };
  }

  /** The questions agents handed to the owner that no source shares at least half the words of, a line a month. */
  private requests(): string[] {
    const sources = this.live().filter((source) => !source.held.length);
    const held = new Set(sources.flatMap((source) => [...stemsOf(`${source.title}\n${source.text}`)]));
    const months = new Map<string, string[]>();
    const runs = (this.host.runs?.() ?? []).filter((run: RunDetail) => run.businessId === this.host.current() && run.question);
    for (const run of runs) {
      const asked = stemsOf(run.question!.text);
      if (!asked.size) continue;
      const needed = Math.max(1, Math.ceil(asked.size / 2));
      if (sources.some((source) => [...stemsOf(`${source.title}\n${source.text}`)].filter((word) => asked.has(word)).length >= needed)) continue;
      const month = localDay(run.startedAt).slice(0, 7);
      months.set(month, [...(months.get(month) ?? []), run.question!.text]);
    }
    return [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3).map(([month, questions]) => {
      const n = questions.length;
      const missing = [...new Set(questions.flatMap((question) => wordsOf(question).filter((word) => !held.has(stem(word)))))].slice(0, 2);
      const about = missing.length ? ` about ${missing.join(' and ')}` : n === 1 ? ' that answers it' : ' that answer them';
      return `To answer ${n} ${n === 1 ? 'question' : 'questions'} from ${monthWords(month)} well, add ${n === 1 ? 'a file' : 'files'}${about}.`;
    });
  }

  private knowledgeList(): { sources: KnowledgeSourceView[]; requests: string[]; line: string } {
    return { sources: [...this.live()].reverse().map((record) => this.sourceView(record)), requests: this.requests(), line: KNOWLEDGE_LINE };
  }

  private knowledgeAdd(p: Record<string, unknown>): { source: KnowledgeSourceView } {
    const body = exact(p, ['source']);
    const input = body.source as KnowledgeSourceInput | null;
    if (!input || typeof input !== 'object') throw invalid('Send one source.');
    const live = this.live();
    if (live.length >= 200) throw invalid('What the AI knows holds 200 sources. Remove one first.');
    const base = { id: this.nextId('know'), at: this.host.now(), url: null, uploadId: null, runId: null, hid: [] as string[], held: [] as string[], removed: false };
    const screen = (text: string, thing: string, pronoun: string): { text: string; hid: string[] } => {
      if (INJECTION.test(text) || CHECKER.test(text)) throw new EngineError('UNTRUSTED_HELD', `${thing} ${thing === 'Those words' ? 'have' : 'has'} ${INJECTION.test(text) ? 'words aimed at an agent' : 'words aimed at a checker'}, so Chausar kept nothing from ${pronoun}.`);
      const hid: string[] = [];
      let out = text;
      if (KEY.test(out)) { hid.push('a key or a password'); out = out.replace(KEY, '[hidden]'); }
      if (ID_NUMBER.test(out)) { hid.push('a card number'); out = out.replace(ID_NUMBER, '[hidden]'); }
      return { text: out, hid };
    };
    let record: SourceRec;
    switch (input.kind) {
      case 'text': {
        const shape = exact(input as unknown as Record<string, unknown>, ['kind', 'title', 'text']);
        if (typeof shape.title !== 'string' || tidy(shape.title).length < 2 || tidy(shape.title).length > 120) throw invalid('The title must be 2 to 120 characters.');
        if (typeof shape.text !== 'string' || shape.text.trim().length < 2 || shape.text.length > 20_000) throw invalid('The text must be 2 to 20000 characters.');
        const title = screen(tidy(shape.title), 'Those words', 'them');
        const text = screen(shape.text.trim(), 'Those words', 'them');
        if (live.some((source) => source.kind === 'text' && source.text === text.text)) throw invalid(TWICE);
        record = { ...base, kind: 'text', title: title.text, text: text.text, hid: [...new Set([...title.hid, ...text.hid])] };
        break;
      }
      case 'link': {
        const shape = exact(input as unknown as Record<string, unknown>, ['kind', 'url']);
        let url: URL;
        try { url = new URL(String(shape.url)); } catch { throw invalid('Send the address of one web page.'); }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('Send the address of one web page.');
        if (/(?:^|\.)linkedin\.com$/i.test(url.hostname)) throw invalid("Chausar doesn't read profile pages.");
        if (live.some((source) => source.kind === 'link' && source.url === url.href)) throw invalid(TWICE);
        // The fake reads no web: its sample pages stand in for what the network guard would fetch. Any other address does
        // not answer (NET_FAILED), and a page with no words is refused, as knowledge.ts readSource refuses them.
        const page = SAMPLE_PAGES[url.href];
        if (!page) throw new EngineError('NET_FAILED', 'That page did not answer, so nothing was added.');
        if (!page.text.trim()) throw invalid('That page had no words Chausar could read, so nothing was added.');
        const words = screen(page.text, 'That page', 'it');
        record = { ...base, kind: 'link', title: page.title || url.hostname, text: words.text, url: url.href, hid: words.hid };
        break;
      }
      case 'file': {
        const shape = exact(input as unknown as Record<string, unknown>, ['kind', 'uploadId']);
        const upload = (this.host.ask('venture.files.list', {}) as UploadLite[]).find((item) => item.id === shape.uploadId && item.scope.kind !== 'practice');
        if (!upload) throw invalid('That file was not found.');
        if (live.some((source) => source.kind === 'file' && source.uploadId === upload.id)) throw invalid(TWICE);
        record = { ...base, kind: 'file', title: this.clean(upload.name), text: '', uploadId: upload.id };
        break;
      }
      case 'past-work': {
        const shape = exact(input as unknown as Record<string, unknown>, ['kind', 'runId']);
        const run = (this.host.ask('venture.delivery.list', {}) as DeliveryLite[]).find((item) => item.id === shape.runId);
        if (!run || run.practice || (run.status !== 'accepted' && run.status !== 'edited')) throw invalid('Only work you accepted for a client can be a source.');
        if (live.some((source) => source.kind === 'past-work' && source.runId === run.id)) throw invalid(TWICE);
        const order = (this.host.ask('venture.order.list', {}) as OrderLite[]).find((item) => item.id === run.orderId);
        const plan = this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null;
        const offer = order ? plan?.blueprint.offers.find((item) => item.id === order.offerId)?.name.value : undefined;
        record = { ...base, kind: 'past-work', title: this.clean(`Accepted work: ${offer ?? 'an order'}`), text: this.clean(run.deliverable?.title ?? ''), runId: run.id };
        break;
      }
      default:
        throw invalid('A source is your own words, a web page, a file on an order or work you accepted.');
    }
    this.book().sources.push(record);
    return { source: this.sourceView(record) };
  }

  private knowledgeRemove(p: Record<string, unknown>): { removed: true; line: string } {
    const body = exact(p, ['id']);
    const record = this.book().sources.find((source) => source.id === id(body.id, 'Source') && !source.removed);
    if (!record) throw invalid('That source was not found.');
    Object.assign(record, { title: '', text: '', url: null, removed: true });
    return { removed: true, line: REMOVED_LINE };
  }

  /** venture.knowledge.test: the sources that share words with the question, the most first, each with its best sentence. No model. */
  private knowledgeTest(p: Record<string, unknown>): { hits: { sourceId: string; title: string; line: string }[]; line: string } {
    const body = exact(p, ['question']);
    if (typeof body.question !== 'string' || body.question.trim().length < 2 || body.question.length > 300) throw invalid('The question must be 2 to 300 characters.');
    const asked = stemsOf(body.question);
    const scored = this.live().filter((source) => !source.held.length).map((source) => {
      const shared = [...stemsOf(`${source.title}\n${source.text}`)].filter((word) => asked.has(word)).length;
      const best = [source.title, ...sentencesOf(source.text)].map((part) => ({ part, n: [...stemsOf(part)].filter((word) => asked.has(word)).length })).sort((a, b) => b.n - a.n)[0];
      return { source, shared, line: sentence(best?.part ?? source.title) };
    }).filter((item) => item.shared > 0).sort((a, b) => b.shared - a.shared).slice(0, 5);
    const n = scored.length;
    return {
      hits: scored.map((item) => ({ sourceId: item.source.id, title: item.source.title, line: item.line })),
      line: n ? `${n} ${n === 1 ? 'source shares' : 'sources share'} words with your question.` : 'No source shares words with this question. Add a source about it.',
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Ideas and who is waiting on you (agents/ideas.ts)
  // ---------------------------------------------------------------------------------------------------------------

  /** The three rules over the fake's records, in rule order; ones started or dismissed are never offered again. */
  private ideas(): (IdeaView & { action: { kind: ProposalKind; target: { invoice?: string; order?: string } } })[] {
    const today = localDay(this.host.now());
    const clients = new Map((this.host.ask('venture.client.list', {}) as ClientLite[]).map((client) => [client.id, client.name] as const));
    const orders = this.host.ask('venture.order.list', {}) as OrderLite[];
    const invoices = (this.host.ask('venture.invoice.list', {}) as { orderId: string; number: string | null; status: string; clientId: string; dueDate: string | null; id: string }[]);
    const runs = this.host.ask('venture.delivery.list', {}) as DeliveryLite[];
    const plan = this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null;
    const offerOf = (order: OrderLite) => plan?.blueprint.offers.find((item) => item.id === order.offerId)?.name.value ?? 'the service';
    const decided = this.book().ideas;
    const make = (rule: string, ids: string[]) => `idea_${this.host.digest({ rule, ids }).slice(0, 24)}`;
    const out: ReturnType<FakeAgentExtras['ideas']> = [];
    for (const order of [...orders].reverse()) {
      const client = clients.get(order.clientId);
      if (order.status !== 'delivered' || !order.deliveredOn || !client || invoices.some((invoice) => invoice.orderId === order.id && invoice.status !== 'void')) continue;
      const offer = offerOf(order), on = dayWords(order.deliveredOn);
      out.push({ id: make('invoice-delivered', [order.id]), title: `Invoice ${client} for ${offer}`, reason: `You marked this order delivered on ${on}, and it has no invoice yet.`, evidence: [{ id: order.id, line: `${offer} for ${client}, delivered ${on}.` }], prompt: `Draft the invoice for ${client}'s order from your price. You issue it from Today.`, action: { kind: 'draft-invoice', target: { order: order.id } } });
    }
    for (const invoice of [...invoices].reverse()) {
      const client = clients.get(invoice.clientId);
      // Issued or part-paid: not paid in full (a paid invoice's status is 'paid').
      if (!client || !invoice.number || !invoice.dueDate || (invoice.status !== 'issued' && invoice.status !== 'part-paid') || invoice.dueDate >= today) continue;
      const due = dayWords(invoice.dueDate);
      out.push({ id: make('remind-overdue', [invoice.id]), title: `Remind ${client} about ${invoice.number}`, reason: `${invoice.number} was due on ${due} and is not paid in full.`, evidence: [{ id: invoice.id, line: `${invoice.number} for ${client}, due ${due}.` }], prompt: `Draft a payment reminder for ${invoice.number}. You send it yourself.`, action: { kind: 'draft-reminder', target: { invoice: invoice.number } } });
    }
    for (const order of [...orders].reverse()) {
      const client = clients.get(order.clientId);
      if (order.status !== 'open' || !client || runs.some((run) => run.orderId === order.id)) continue;
      const came = localDay(order.at);
      if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${came}T00:00:00Z`) < 86_400_000) continue;
      const offer = offerOf(order), on = dayWords(came);
      out.push({ id: make('start-order', [order.id]), title: `Start work on ${client}'s order`, reason: `${client} ordered ${offer} on ${on}, and no run has started.`, evidence: [{ id: order.id, line: `${offer} for ${client}, ordered ${on}.` }], prompt: `Start a run on your AI for ${client}'s order. Each step that needs you still asks first.`, action: { kind: 'start-run', target: { order: order.id } } });
    }
    return out.filter((idea) => !decided.has(idea.id)).slice(0, 10);
  }

  /**
   * waitingOnYou: real records only, newest first. Each order (not cancelled) with a stage that waits on the owner, by
   * its own stage steps, dated by its newest run (else when it came in); and each message Chausar leaves for the owner
   * to answer (owner-reply, bot-question) that is not handled yet. At most twenty.
   */
  private waiting(): { id: string; recordId: string; line: string }[] {
    const clients = new Map((this.host.ask('venture.client.list', {}) as ClientLite[]).map((client) => [client.id, client.name] as const));
    const runs = this.host.ask('venture.delivery.list', {}) as DeliveryLite[];
    const items: { at: string; view: { id: string; recordId: string; line: string } }[] = [];
    for (const order of this.host.ask('venture.order.list', {}) as OrderLite[]) {
      const client = clients.get(order.clientId);
      const whats = order.waitsOnYou?.items.map((item) => item.what) ?? [];
      if (order.status === 'cancelled' || !client || !whats.length) continue;
      const at = runs.filter((run) => run.orderId === order.id).reduce((newest, run) => (run.at > newest ? run.at : newest), order.at);
      items.push({ at, view: { id: `waiting:order:${order.id}`, recordId: order.id, line: `For ${client}: ${listWords(whats)} ${whats.length === 1 ? 'waits' : 'wait'} on you.` } });
    }
    for (const mail of this.hooks.waitingMail?.() ?? []) {
      items.push({ at: mail.date, view: { id: `waiting:mail:${mail.id}`, recordId: mail.id, line: `${mail.who} wrote on ${dayWords(localDay(mail.date))} and waits for your reply.` } });
    }
    return items.map((item, index) => ({ ...item, index })).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.index - b.index)).slice(0, 20).map((item) => item.view);
  }

  private ideaToDecide(p: Record<string, unknown>) {
    const body = exact(p, ['id']);
    const ideaId = id(body.id, 'Idea');
    const kept = this.book().ideas.get(ideaId);
    if (kept) throw new EngineError('ALREADY_DECIDED', kept === 'dismissed' ? 'You dismissed this idea already.' : 'You started this idea already.');
    const idea = this.ideas().find((item) => item.id === ideaId);
    if (!idea) throw new EngineError('IDEA_RETIRED', RETIRED);
    return idea;
  }

  /** venture.ideas.start: drafts the idea's proposal (source idea), not raised: it reaches Today only when the owner raises it. */
  private ideaStart(p: Record<string, unknown>): { proposal: ProposalView | null; suggestion: null; line: string } {
    const idea = this.ideaToDecide(p);
    if (!this.hooks.draftIdea) throw new EngineError('IDEA_RETIRED', RETIRED);
    const spends = idea.action.kind === 'start-run';
    const proposal = this.hooks.draftIdea({ kind: idea.action.kind, title: idea.title, line: idea.prompt, agent: null, spends, sends: false, target: idea.action.target });
    this.book().ideas.set(idea.id, 'started');
    return { proposal, suggestion: null, line: STARTED_LINE };
  }

  private ideaDismiss(p: Record<string, unknown>): { dismissed: true; line: string } {
    const idea = this.ideaToDecide(p);
    this.book().ideas.set(idea.id, 'dismissed');
    return { dismissed: true, line: DISMISSED_LINE };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The capability page (agents/capabilities.ts)
  // ---------------------------------------------------------------------------------------------------------------

  private capabilities(agentId: string): CapabilityPageView {
    const agent = this.agent(agentId);
    const kinds = agent.steps.map((step) => STEP_KIND[step.id] ?? 'work');
    const acts = kinds.some((kind) => kind === 'gather' || kind === 'work');
    const writes = kinds.includes('write');
    const item = (list: CapabilityItemView['list'], key: string, state: CapabilityItemView['state'], line: string): CapabilityItemView => ({ list, key, state, line });
    const items: CapabilityItemView[] = [];
    // What it can see: the team's read tools (for a role in the act loop), then what each turn carries.
    if (acts) for (const name of ['files.list', 'files.read', 'dictionary.browse'] as const) items.push(item('see', `tool:${name}`, 'reads', TOOL_WORDS[name]));
    const inputs = [...new Set([...(acts ? ['request', 'files', 'answers', 'notes', 'knowledge'] : []), ...(writes ? ['request', 'proven', 'answers', 'knowledge'] : []), ...(kinds.includes('verify') ? ['verify'] : [])])] as (keyof typeof INPUT_WORDS)[];
    for (const key of inputs) items.push(item('see', `input:${key}`, 'reads', INPUT_WORDS[key]));
    if (!items.length) items.push(item('see', 'nothing', 'off', 'Nothing: none of its steps gives it anything to read.'));
    // What it can do: its steps as they really are, then the team's tools, then where each step is sent.
    for (const step of agent.steps) {
      const kind = STEP_KIND[step.id] ?? 'work';
      const lines = [sentence(step.purpose)];
      if (kind === 'write') lines.push(WRITE_TAIL);
      if (kind === 'verify') lines.push(JUDGE_ON);
      const planned = NEEDS_PLANNED[step.id];
      if (planned) { items.push(item('do', `step:${step.id}`, 'planned', [...lines, `Planned: it needs ${planned} to write, which this build does not do yet.`].join(' '))); continue; }
      if (FLOOR_LINE[step.id]) lines.push(FLOOR_LINE[step.id]!);
      items.push(item('do', `step:${step.id}`, 'works', lines.join(' ')));
    }
    if (acts) {
      items.push(item('do', 'tool:handoff.client', 'hands-off', TOOL_WORDS['handoff.client']), item('do', 'tool:handoff.owner', 'works', TOOL_WORDS['handoff.owner']));
      items.push(item('do', 'outbox:mail-app', 'records', OUTBOX_MAIL), item('do', 'outbox:payment-link', 'planned', OUTBOX_LINK));
    }
    // Only a role with a step its AI does sends anything to the owner's provider (thinks, in capabilities.ts).
    if (kinds.some((kind) => kind !== 'floor')) items.push(item('do', 'model:provider', 'works', PROVIDER));
    // What is off: what nothing it does reaches, and the team tools this computer cannot run.
    const off = [item('off', 'effect:send', 'off', OFF_WORDS.send), item('off', 'effect:money', 'off', OFF_WORDS.money), ...(acts ? [] : [item('off', 'effect:write', 'off', OFF_WORDS.write)])];
    if (!kinds.some((kind) => kind !== 'floor')) off.push(item('off', 'effect:egress', 'off', "Can't take data off this computer or hand it to another program."));
    if (acts) off.push(item('off', 'cli:agent.delegate', 'off', `${TOOL_WORDS['agent.delegate']} Off here: ${NO_CLI}`));
    items.push(...off);
    const of = (list: CapabilityItemView['list']) => items.filter((entry) => entry.list === list).map((entry) => entry.line);
    return { agent: agent.id, canSee: of('see'), canDo: of('do'), off: of('off'), items, line: acts ? TEAM_LINE : NO_TOOLS_LINE };
  }
}

const ideaView = (idea: IdeaView): IdeaView => ({ id: idea.id, title: idea.title, reason: idea.reason, evidence: idea.evidence.map((item) => ({ ...item })), prompt: idea.prompt });

/**
 * learnVoice (agents/voice.ts): the last text held out; words in at least two of the rest are words I use; opening and
 * closing lines said the same way in two are kept; sentence length read; the held-out text passes when it uses at
 * least half of those words and its sentences run between half and twice as long.
 */
function learnVoice(samples: readonly string[]): { language: 'en' | 'hi'; howITalk: string[]; wordsIUse: string[]; format: string[]; lines: string[]; passed: boolean; line: string; from: number } {
  const letters = samples.join(' ').match(/\p{L}/gu) ?? [];
  const language: 'en' | 'hi' = letters.filter((letter) => DEVANAGARI.test(letter)).length * 2 > letters.length ? 'hi' : 'en';
  const shape = (text: string) => {
    const lines = text.split('\n').map((line) => tidy(line)).filter(Boolean);
    if (lines.length >= 3) return { opener: lines[0]!, closer: lines.at(-1)!, body: lines.slice(1, -1).join('\n') };
    if (lines.length === 2) return { opener: lines[0]!, closer: null, body: lines[1]! };
    return { opener: null, closer: null, body: lines.join('\n') };
  };
  const train = samples.slice(0, -1).map(shape);
  const held = shape(samples.at(-1)!);
  const counts = new Map<string, number>();
  const spread = new Map<string, number>();
  for (const one of train) {
    const words = wordsOf(one.body);
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const word of new Set(words)) spread.set(word, (spread.get(word) ?? 0) + 1);
  }
  const wordsIUse = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).filter(([word]) => (spread.get(word) ?? 0) >= 2).slice(0, 8).map(([word]) => word);
  const repeated = (lines: (string | null)[]) => {
    const seen = new Map<string, { text: string; count: number }>();
    for (const line of lines) { if (!line || line.length > 160) continue; const key = fold(line); seen.set(key, { text: seen.get(key)?.text ?? line, count: (seen.get(key)?.count ?? 0) + 1 }); }
    return [...seen.values()].filter((item) => item.count >= 2).map((item) => item.text);
  };
  const openers = repeated(train.map((one) => one.opener));
  const closers = repeated(train.map((one) => one.closer));
  const lines = [...new Set([...openers, ...closers, ...repeated(train.flatMap((one) => one.body.split('\n')))])].slice(0, 6);
  const hi = language === 'hi';
  const howITalk = [...openers.slice(0, 2).map((line) => (hi ? `शुरुआत: "${line}"` : `Opens with: "${line}"`)), ...closers.slice(0, 2).map((line) => (hi ? `अंत: "${line}"` : `Signs off with: "${line}"`))];
  const average = (texts: string[]) => { const all = texts.flatMap(sentencesOf); return all.length ? all.reduce((sum, item) => sum + item.split(/\s+/).length, 0) / all.length : 0; };
  const mean = average(train.map((one) => one.body));
  const size = mean <= 12 ? 0 : mean <= 20 ? 1 : 2;
  const format = [hi ? ['छोटे वाक्य', 'मध्यम लंबाई के वाक्य', 'लंबे वाक्य'][size]! : ['Short sentences', 'Sentences of medium length', 'Long sentences'][size]!];
  const heldWords = new Set(wordsOf(held.body));
  const shared = wordsIUse.filter((word) => heldWords.has(word)).length;
  const heldMean = average([held.body]);
  const wordsOk = wordsIUse.length > 0 && shared * 2 >= wordsIUse.length;
  const lengthOk = mean > 0 && heldMean >= mean / 2 && heldMean <= mean * 2;
  const passed = wordsOk && lengthOk;
  const line = passed
    ? `Checked on your last text, which it did not learn from: it uses ${shared} of your ${wordsIUse.length} words, with sentences like yours.`
    : `Checked on your last text, which it did not learn from: it did not sound like the others (${!wordsOk ? `it uses ${shared} of your ${wordsIUse.length} words` : 'its sentences run another length'}). Add texts that sound like you, then learn again.`;
  return { language, howITalk, wordsIUse, format, lines, passed, line, from: train.length };
}
