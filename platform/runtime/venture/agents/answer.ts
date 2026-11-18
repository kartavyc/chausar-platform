// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1, catalogue A2): what an agent does with the owner's
// words. Code decides what they ask for: a question gets one answer; a request for work suggests a prefilled New
// order and creates nothing; a request that lands on the floor (publish, send, money, prices, deleting) becomes a
// drafted proposal for Today. An answer is typed parts written from the agent's own facts (its last runs, the order
// files' names, its notes and standing orders): a figure only by a receipt those facts hold, and any number of the
// agent's own labelled a model estimate (estimate.ts: a number it was given is not). With templates only, code answers.
// Nothing the consent promises is never sent reaches the AI: card, bank account, Aadhaar and one-time code numbers are
// screened out of every fact, and client file names and the run's question pass the untrusted screen first.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { securitiesAdviceIn } from '../policy/securities-guard.ts';
import type { AgentWaiting, ChatPart, Json, ModelTask, RunDetail, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, listRecords, tidyWords } from '../records.ts';
import { digitCopy, screenReadback } from '../core/secrets.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { plainHindi } from '../delivery/harness/patches.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { deliveryRunDetails } from '../views/runs.ts';
import { short } from '../views/shared.ts';
import { requireChatConsent, type ChatRoute } from './consent.ts';
import { standingOrders } from './versions.ts';
import { onlyAsks } from './standing.ts';
import type { ChatAgent } from './roles.ts';
import { usableNoteText } from './recall.ts';
import { assertAgentAnswerCurrent } from '../agent-runtime/native-job.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import { hiredFacts } from './hired-facts.ts';
import { citedCounts, givenWords, ownFigure } from './estimate.ts';

// ---------------------------------------------------------------------------
// One chat call: preview, then the send the owner's message in the app approves, under the chat consent
// ---------------------------------------------------------------------------

const SHAPE_ERRORS: ReadonlySet<string> = new Set(['MODEL_OUTPUT_REJECTED', 'MODEL_REFUSAL', 'MODEL_INCOMPLETE']);
const CHANGED_ROUTE = 'Your AI connection changed while Chausar was getting ready to send, so nothing was sent. Read what chats send, then agree again.';
/** Fields that hold Chausar's own ids, which the id screen must not touch. */
const ID_FIELDS: ReadonlySet<string> = new Set(['runId', 'receiptId', 'key', 'id']);
/**
 * An account number after its label ("bank account 123456789012", "a/c no. 0123 4567 8901", "acct no ...", "खाता
 * संख्या ..."), with or without an IFSC near it, read on the screen's copy (nothing invisible, every digit 0 to 9).
 */
const LABELLED_ACCOUNT = /(?:\ba\/c|\bacc(?:oun)?t|\baccount|खाता)\s*(?:no\.?|number|num|#|संख्या|नंबर|नं\.?)?\s*[:-]?\s*\d(?:[\s./-]{0,2}\d){8,17}(?!\d)/iu;
/** What a fact becomes when it still holds an id after the screen: nothing of it is sent. */
const HELD_FACT = '[left out: it held an id number]';

/**
 * True when words hold a number the chat consent promises is never sent: a card, bank account, Aadhaar or one-time
 * code number as the shared screen finds them however they are written (core/secrets.ts screenReadback), or an
 * account number after its label.
 */
export function holdsIdNumber(text: string): boolean {
  const found = screenReadback(text).found;
  return found.some(kind => kind === 'card' || kind === 'bank-account' || kind === 'aadhaar' || kind === 'otp') || LABELLED_ACCOUNT.test(digitCopy(text));
}

/**
 * Every string in a chat's input with card, bank account, Aadhaar, one-time code, PAN and key numbers taken out by the
 * shared screen; a string that still holds one (an account after its label) is left out whole.
 */
export function screenFacts(value: Json, field: string | null = null): Json {
  if (typeof value === 'string') {
    if (field !== null && ID_FIELDS.has(field)) return value;
    const screened = screenReadback(value).text;
    return holdsIdNumber(screened) ? HELD_FACT : screened;
  }
  if (Array.isArray(value)) return value.map(item => screenFacts(item, null));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, screenFacts(item as Json, key)]));
  return value;
}

/**
 * One call to the owner's AI for a chat. Client data never goes on standing consent: the task is previewed (the exact
 * payload recorded, its facts screened of id numbers) and sent once under the owner's own message in the app. The
 * consent is read again right before the send, and the preview must go to the AI the consent names (preset and
 * model); otherwise nothing is sent (CHAT_CONSENT_STALE). Null with templates only, or when the answer came back in a
 * shape Chausar refuses; the caller then answers from code.
 */
export async function chatCall<T>(deps: VentureDeps, ctx: Context, route: ChatRoute | null, task: ModelTask<T>, guard?: () => void): Promise<{ value: T; callId: string | null } | null> {
  if (!route) return null;
  guard?.();
  const preview = await deps.models.preview(ctx, { ...task, input: screenFacts(task.input) });
  if (!preview) return null;
  const beforeDispatch = () => {
    const { state, venture } = readAs(deps, ctx, 'prepare');
    const now = requireChatConsent(deps, ctx, state, venture);
    check(now && now.presetId === route.presetId && now.model === route.model && now.connectionId === route.connectionId, 'CHAT_CONSENT_STALE', CHANGED_ROUTE);
    check(preview.presetId === route.presetId && preview.model === route.model, 'CHAT_CONSENT_STALE', CHANGED_ROUTE);
    guard?.();
  };
  beforeDispatch();
  try {
    const outcome = await deps.models.runPreview(ctx, preview.callId, preview.digest, task.validate, { beforeDispatch });
    beforeDispatch();
    return { value: outcome.value, callId: outcome.callId };
  } catch (error) {
    if (error instanceof Error && SHAPE_ERRORS.has((error as { code?: string }).code ?? '')) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// What the words ask for, by code
// ---------------------------------------------------------------------------

/** A request on the always-ask floor: what it touches, the floor step it lands on, and whether it spends or sends. */
export type FloorRequest = { kind: 'floor'; stepId: string | null; spends: boolean; sends: boolean };
export type Intent = { kind: 'question' } | { kind: 'work' } | FloorRequest;

type FloorWord = { pattern: RegExp; stem: string | null; spends: boolean; sends: boolean };
/**
 * Words that put a request on the floor: anything published or sent to a client or the public, money out or spent, a
 * price change, or deleting. Matched on the words without the nukta. Hindi twins: पब्लिश, अपलोड, पोस्ट (publish,
 * upload, post); भेज (send); भुगतान, पेमेंट, रिफंड, खर्च (pay, refund, spend); कीमत, दाम, रेट, छूट, डिस्काउंट (price,
 * rate, discount); डिलीट, मिटा (delete).
 */
const FLOOR_WORDS: readonly FloorWord[] = Object.freeze([
  { pattern: /\b(?:publish\w*|go live|put (?:it|them) live|upload\w*|post (?:it|this|the)|post kar\w*|schedul\w* the post)\b|\bshare\b[^.]{0,40}\b(?:instagram|youtube|facebook|linkedin|twitter|tiktok|reels?)\b|पब्लिश|अपलोड|पोस्ट\s+कर/iu, stem: 'publish', spends: false, sends: true },
  { pattern: /\b(?:send\w*|email\w*|e-mail\w*|mail (?:it|this|the)|whatsapp|message the client|reply to the client|bhej\s+(?:do|dena|dein|dijiye))\b|भेज/iu, stem: 'send', spends: false, sends: true },
  { pattern: /\b(?:invoic\w*|bill the client)\b|इनवॉइस|बिल\s+भेज/iu, stem: null, spends: false, sends: true },
  { pattern: /\b(?:pay|paid|payment|refund\w*|transfer\w*|charg(?:e|es|ing)|spend\w*)\b|भुगतान|पेमेंट|रिफंड|खर्च/iu, stem: null, spends: true, sends: false },
  { pattern: /\b(?:discount\w*|(?:change|raise|lower|cut|drop|increase|decrease|set)\b[^.?!]*\bprices?)\b|कीमत|दाम|रेट|छूट|डिस्काउंट/iu, stem: null, spends: false, sends: false },
  { pattern: /\b(?:delete|remove the file|erase)\b|डिलीट|मिटा/iu, stem: null, spends: false, sends: false },
]);
/** Words at the start that ask for work (English), and Hindi requests that end in an asking verb (बनाओ, करो, कर दो, लिखो ...). */
const WORK_START = /^\s*(?:please\s+)?(?:cut|edit|make|draft|write|create|prepare|start|render|find|pick|build|redo|shorten|trim|do|translate|record|design|rework|fix|tidy|add|change|update|split|merge|caption|script|plan)\b/i;
const WORK_HINDI = /(?:बनाओ|बना दो|बनाइए|काटो|काट दो|लिखो|लिख दो|करो|कर दो|करिए|कीजिए|तैयार करो|शुरू करो)\s*[।.!]?\s*$/u;
const POLITE = /^\s*(?:can|could|would|will) you\b|\bplease\b/i;

/**
 * What the owner's words ask for, by code. A question that only asks is a question; else words that touch the floor
 * make a floor request (on the floor step they name, when the playbook has one); else a request for work; else a
 * question. steps: the team's steps, to find the floor step.
 */
export function intentOf(text: string, steps: readonly { id: string; kind: string; title: string }[]): Intent {
  if (onlyAsks(text)) return { kind: 'question' };
  const plain = plainHindi(text);
  const floor = FLOOR_WORDS.find(word => word.pattern.test(plain));
  if (floor) {
    const outside = steps.filter(step => step.kind === 'operator');
    const named = floor.stem ? outside.find(step => step.title.toLowerCase().includes(floor.stem!)) ?? (floor.sends ? outside[0] : undefined) : undefined;
    return { kind: 'floor', stepId: named?.id ?? null, spends: floor.spends, sends: floor.sends };
  }
  if (POLITE.test(text) || WORK_START.test(text) || WORK_HINDI.test(text)) return { kind: 'work' };
  return { kind: 'question' };
}

/** The offer a request for work names: the offer whose name the words hold, the only offer, or null when unsure. */
export function offerFor(state: State, venture: VentureRecord, text: string): string | null {
  const offers = acceptedBlueprintOrNull(state, venture)?.offers ?? [];
  const lower = text.toLowerCase();
  const named = offers.filter(offer => lower.includes(offer.name.value.toLowerCase()));
  if (named.length === 1) return named[0].id;
  return offers.length === 1 ? offers[0].id : null;
}

// ---------------------------------------------------------------------------
// The agent's own facts
// ---------------------------------------------------------------------------

/** Stored owner-visible history, including jobs whose sources have since changed. Erasure happens in the records. */
export function agentRunHistory(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent): { detail: RunDetail; steps: RunDetail['steps'] }[] {
  return deliveryRunDetails(deps, state, venture).flatMap(detail => {
    const steps = detail.steps.filter(step => agent.stepIds.includes(step.id));
    return steps.length ? [{ detail, steps }] : [];
  });
}

/** Only currently authorized runs may contribute client context to another AI call. */
export function agentRuns(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent): { detail: RunDetail; steps: RunDetail['steps'] }[] {
  return agentRunHistory(deps, state, venture, agent).filter(({ detail }) => {
    const record = listRecords(state, 'venture-delivery-run', venture.id).find(run => run.id === detail.runId);
    const order = record && listRecords(state, 'venture-order', venture.id).find(order => order.id === record.orderId);
    if (!record || !order) return false;
    try {
      requireClientAiConsent(state, venture.id, order.clientId);
      if (record.agentJob) assertAgentAnswerCurrent(state, record);
    } catch { return false; }
    return true;
  });
}

/** The question this agent's run waits on the owner for, kept in one fixed place: the newest one, or null. */
export function waitingOn(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent): AgentWaiting | null {
  for (const record of listRecords(state, 'venture-delivery-run', venture.id).reverse()) {
    if (record.status !== 'needs-answer' || !record.agentJob?.pendingFacts || record.agentJob.scope.agentId !== agent.id) continue;
    try { assertAgentAnswerCurrent(state, record); } catch { continue; }
    const detail = deliveryRunDetails(deps, state, venture).find(item => item.runId === record.id);
    if (!detail?.question) continue;
    return { runId: record.id, rowId: detail.question.id, question: detail.question.text };
  }
  return null;
}

type Figure = { receiptId: string; key: string; label: string; display: string };

/** Figures this agent's facts hold, each with its receipt: its runs' order totals and the work receipts its runs made. */
function figuresOf(state: State, venture: VentureRecord, runIds: readonly string[]): Figure[] {
  const figures: Figure[] = [];
  const runs = listRecords(state, 'venture-delivery-run', venture.id).filter(run => runIds.includes(run.id));
  const orders = listRecords(state, 'venture-order', venture.id);
  for (const run of runs) {
    const order = orders.find(item => item.id === run.orderId);
    const price = order ? listRecords(state, 'venture-price-receipt', venture.id).find(item => item.id === order.priceReceiptId) : undefined;
    for (const figure of price?.figures ?? []) if (figure.key === 'total') figures.push({ receiptId: price!.id, key: figure.key, label: figure.label, display: figure.display });
    for (const id of run.harness?.workReceiptIds ?? []) {
      const receipt = listRecords(state, 'venture-work-receipt', venture.id).find(item => item.id === id);
      for (const figure of receipt?.figures ?? []) figures.push({ receiptId: receipt!.id, key: figure.key, label: figure.label, display: figure.display });
    }
  }
  return figures;
}

/**
 * Outside words (a client's file name, the question a run's agent wrote after reading the client's files) as the chat
 * may send them: through the untrusted screen in enforce mode, whatever the business's own mode, so words aimed at the
 * agent or a checker, or hidden characters, hold the item and it is dropped (null). The owner's releases still count.
 */
function outsideWords(state: State, venture: VentureRecord, text: string): string | null {
  return screenUntrusted({ source: 'client-file', text }, { mode: 'enforce', released: screenSettingOf(state, venture.id).released }).text;
}

/** What the agent answers from: its last five runs, the files of their orders by name, its notes, its standing orders, and the receipted figures. */
function factsOf(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent) {
  const runs = agentRuns(deps, state, venture, agent).slice(0, 5);
  const runRecords = listRecords(state, 'venture-delivery-run', venture.id).filter(run => runs.some(item => item.detail.runId === run.id));
  const orderIds = new Set(runRecords.map(run => run.orderId));
  const files = listRecords(state, 'venture-upload', venture.id).filter(upload => upload.scope.kind === 'order' && orderIds.has(upload.scope.orderId))
    .flatMap(upload => { const name = outsideWords(state, venture, upload.name); return name === null ? [] : [name]; });
  // 4B2: each note read through its masks again, and one that now fails the note rules left out (recall.ts usableNoteText).
  const notes = listRecords(state, 'venture-agent-note', venture.id).filter(note => note.agent === agent.id)
    .flatMap(note => { const text = usableNoteText(note); return text === null ? [] : [text]; });
  return {
    runs: runs.map(({ detail, steps }) => ({ runId: detail.runId, purpose: detail.purpose, state: detail.state, steps: steps.map(step => ({ purpose: step.purpose, state: step.state })) })),
    files, notes, standingOrders: standingOrders(state, venture, agent).map(order => order.text), figures: figuresOf(state, venture, runs.map(item => item.detail.runId)),
  };
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** A figure the answer cites: one of the figures given, by its receipt and key. */
export type CitedFigure = { receiptId: string; key: string };
/**
 * What the AI writes for a chat: its words, as one piece of plain writing, and the receipts it cites. No typed parts
 * (founder, 11 Nov 2026): the earlier shape made every sentence carry two empty fields, and Claude Code 2.1.321
 * answered an ordinary message without them, so its own schema check failed the whole call (seen live that day).
 */
export type AnswerOutput = { reply: string; figures: CitedFigure[] };

/** One earlier message of a chat as the AI is given it: the owner's words, its own reply, or a brief Chausar passed on. */
export type ChatTurn = { from: 'owner' | 'you' | 'chausar'; text: string };
/** How much of a chat the AI is given: the newest messages, each cut to a length, within a total. */
const HISTORY_TURNS = 12;
const HISTORY_TURN_CHARS = 1500;
const HISTORY_CHARS = 8000;
/**
 * Conversation memory: the earlier messages of one chat, oldest first, so a follow-up means something (until 11 Nov
 * 2026 every message was answered on its own). Only the newest twelve, each cut to a length. Nothing written before a
 * client last withdrew their AI permission is given again: a reply from then may hold that client's details. The chat
 * consent names these messages, and the facts screen (screenFacts) reads them like every other word sent.
 */
export function chatHistory(state: State, venture: VentureRecord, messages: readonly { at: string; from: string; text: string }[]): ChatTurn[] {
  const withdrawn = listRecords(state, 'venture-client', venture.id).reduce((latest, client) => { const at = client.aiConsent?.withdrawnAt ?? ''; return at > latest ? at : latest; }, '');
  const kept: ChatTurn[] = [];
  let room = HISTORY_CHARS;
  for (const message of [...messages].reverse()) {
    if (kept.length >= HISTORY_TURNS || (withdrawn && message.at <= withdrawn)) break;
    const words = message.text.trim();
    if (!words) continue;
    const text = words.length > HISTORY_TURN_CHARS ? `${words.slice(0, HISTORY_TURN_CHARS - 3)}...` : words;
    if (text.length > room) break;
    room -= text.length;
    kept.unshift({ from: message.from === 'owner' ? 'owner' : message.from === 'chausar' ? 'chausar' : 'you', text });
  }
  return kept;
}

/**
 * What the owner's words lead to besides the agent's answer, by code (intentOf): a New order button under the reply, or
 * a proposal on Today. The AI is told, so it can talk about the request truthfully.
 */
export type ChatRequest = 'work' | 'needs-approval';

/**
 * The agent talks (founder, 11 Nov 2026): no word limit, a question back when it needs one, and its own numbers kept,
 * shown as model estimates. What it may not do is unchanged and is held by code, not by cutting its words: nothing is
 * published, sent, paid or priced from chat, whatever the answer says.
 */
export const ANSWER_INSTRUCTIONS = [
  'You are one agent of a small business the owner runs with Chausar. The owner is talking to you. Talk back as a capable colleague would, in plain words, in the language of question (in English when the owner wrote in English, in Hindi only when they wrote in Hindi): answer as fully as the message needs, and ask the owner a question when you need to know more.',
  'Draw on the facts given: what the business is (business.about, the owner\'s own words), your runs and their steps, the file names, your notes and the standing orders the owner gave you. history, when given, holds the earlier messages of this chat, oldest first: use it to follow what the owner means. Say so when you do not know something; never claim work the runs do not show.',
  'When one of the figures given fits, cite it in figures by its receiptId and key, so the owner sees it with its receipt beside your words. Any number or amount you write yourself is shown to the owner as a model estimate, so say when you are estimating.',
  // What an agent can do itself, and where the rest really starts (found live, 14 Nov 2026: "I'll find prospects in Pune").
  // Seen on Windows, 15 Nov 2026: the agent sent the owner to Clients while a search card was already on Today (searchWaiting).
  'In this chat you work only from the facts given: you cannot search the web, look anything up, find customers or contact anyone, so never say you will. A search for possible customers is its own step: the owner starts it from Clients, under Find customers, and approves it before it runs, or Chausar proposes it on Today. When searchWaiting is given, that search already waits on Today for the owner\'s approval: name it and send the owner to Today, not to Clients. When asked for one, say that, and say what you can do with the list once it is there, such as keep it in order or draft a first message for the owner to send.',
  // Found live, 15 Nov 2026: "I'll prepare subtitle drafts from your video files", on a computer with no transcription.
  'You are given only the names of files, never what is inside a file, and you cannot open, hear or watch one here: never say you will make subtitles, a transcript or an edit from a file. Work on a client\'s files starts as an order, where each step that needs the owner asks first.',
  'You cannot publish, send, pay, change a price or start an order from this chat, so never say you did. When request is "work", say how you would go about it and what you need; Chausar shows a New order button under your reply. When request is "needs-approval", say what you would do; Chausar puts it on Today for the owner to approve.',
  'Write what you say in reply as plain text, in short paragraphs when it helps: no markdown, asterisks or bullet marks. Leave figures empty when you cite none.',
].join(' ');
/** Bounds of the transport, never of the conversation: far above what an answer needs. */
const MAX_REPLY_CHARS = 16_000;
const MAX_FIGURES = 40;
const MAX_PARTS = 40;

/** Exported so a test holds it to the model schema rule (models/schema.ts) every real call is checked against. */
export const ANSWER_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['reply', 'figures'],
  properties: {
    reply: { type: 'string', description: 'What you say to the owner, in plain words.' },
    figures: {
      type: 'array', description: 'The figures given that you cite; empty when you cite none.',
      items: {
        type: 'object', additionalProperties: false, required: ['receiptId', 'key'],
        properties: { receiptId: { type: 'string', description: 'The receiptId of one of the figures given.' }, key: { type: 'string', description: 'The key of that figure.' } },
      },
    },
  },
};

const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const rejected = (message: string): never => { throw new ChausarError('MODEL_OUTPUT_REJECTED', message); };

const closedRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** The answer's shape: the reply's words, with no hidden characters, and the figures it cites, each closed. */
export function validateAnswer(raw: unknown): AnswerOutput {
  if (!closedRecord(raw, ['reply', 'figures'])) return rejected('The answer was not a reply and its figures.');
  const { reply, figures } = raw;
  if (typeof reply !== 'string' || !reply.trim() || reply.length > MAX_REPLY_CHARS || HIDDEN.test(reply)) return rejected('The reply was not plain text.');
  // W6 6E7 (D49): an answer that gives securities advice is refused, so the template answer is used.
  if (securitiesAdviceIn(reply)) return rejected('The answer gave securities advice, which Chausar never gives.');
  if (!Array.isArray(figures) || figures.length > MAX_FIGURES) return rejected('The answer cited too many figures.');
  return {
    reply,
    figures: figures.map(item => {
      if (!closedRecord(item, ['receiptId', 'key']) || typeof item.receiptId !== 'string' || typeof item.key !== 'string' || item.receiptId.length > 200 || item.key.length > 60 || HIDDEN.test(item.receiptId) || HIDDEN.test(item.key)) return rejected('A cited figure had the wrong shape.');
      return { receiptId: item.receiptId, key: item.key };
    }),
  };
}

/**
 * The reply as the thread shows it: one part for each paragraph, so only a paragraph that states a number is labelled an
 * estimate. Past the most parts a message holds, the rest stay together in the last one; nothing is cut.
 */
export function paragraphsOf(reply: string, limit = MAX_PARTS): string[] {
  const lines = tidyWords(reply, true).split('\n').filter(Boolean);
  return lines.length <= limit ? lines : [...lines.slice(0, limit - 1), lines.slice(limit - 1).join(' ')];
}

const COUNT_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
/** The engine's line for figures the answer left out, counted by code. */
export function leftOutLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'One figure was left out: it had no receipt.' : `${COUNT_WORDS[count - 1] ?? String(count)} figures were left out: they had no receipt.`;
}

/**
 * Code labels the answer before it is stored, and cuts none of the AI's words: a paragraph that holds a number or an
 * amount of the agent's own (agents/estimate.ts ownFigure: Hindi number words too) is kept whole as an estimate part,
 * labelled a model estimate; any other paragraph is plain words. A number the agent was given is not its estimate: the
 * owner's own figure repeated back, a receipted figure, a count in its facts. A cited figure the agent's facts hold
 * follows the words, with that receipt's own display (never the model's); one naming a receipt Chausar does not hold
 * has nothing to show and is counted as left out. question: the owner's own words. given: the rest of what the agent
 * was given (estimate.ts givenWords over the task's input).
 */
export function checkedParts(output: AnswerOutput, figures: readonly Figure[], question: string, given: readonly string[] = []): { parts: ChatPart[]; leftOut: number } {
  const parts: ChatPart[] = [];
  let leftOut = 0;
  // What the agent was given: the owner's words, what the caller passes of the task's input, and the receipted figures.
  const citedShown = output.figures.flatMap(cited => { const found = figures.find(item => item.receiptId === cited.receiptId && item.key === cited.key); return found ? [found.display] : []; });
  const known = [question, ...given, ...figures.map(figure => figure.display), ...citedCounts(citedShown)];
  for (const words of paragraphsOf(output.reply)) {
    parts.push(ownFigure(words, known) ? { kind: 'estimate', text: words } : { kind: 'text', text: words });
  }
  const shown = new Set<string>();
  for (const cited of output.figures) {
    const found = figures.find(item => item.receiptId === cited.receiptId && item.key === cited.key);
    if (!found) { leftOut += 1; continue; }
    const id = `${found.receiptId}\u0000${found.key}`;
    if (shown.has(id)) continue;
    shown.add(id);
    parts.push({ kind: 'figure', receiptId: found.receiptId, key: found.key, display: found.display });
  }
  return { parts, leftOut };
}

const STATE_WORDS: Readonly<Record<RunDetail['state'], string>> = { active: 'in progress', waiting: 'waiting on you', done: 'done', failed: 'stopped with a failure' };

/** The answer code writes with templates only, or when the AI's answer did not pass: plain facts from the records. */
export function templateAnswer(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent, waiting: AgentWaiting | null): ChatPart[] {
  const lines: string[] = [];
  if (waiting) lines.push(`I am waiting on your answer: ${short(waiting.question, 200)}`);
  // This code-only answer stays with the owner; AI context uses agentRuns instead.
  const latest = agentRunHistory(deps, state, venture, agent)[0];
  lines.push(latest ? `My latest run, ${short(latest.detail.purpose, 120)}, is ${STATE_WORDS[latest.detail.state]}.` : 'I have not worked on an order yet.');
  const orders = standingOrders(state, venture, agent).length;
  if (orders) lines.push(`I follow ${orders} standing ${orders === 1 ? 'order' : 'orders'} from you.`);
  lines.push('Connect your AI in Connections to ask me questions in your own words.');
  return lines.map(text => ({ kind: 'text', text }));
}

export type Answer = { parts: ChatPart[]; author: 'model' | 'template'; callId: string | null; line: string | null; suggestion?: { kind: 'connect-ai' } };

/**
 * The search for possible customers that waits on Today for the owner's approval (a raised find-customers proposal:
 * customers/find-methods.ts), by its card's own title, or null. The newest when several wait. The agent in chat is
 * given it, so it names the card that is there and does not send the owner off to start another.
 */
export function searchWaitingOf(state: State, ventureId: string): string | null {
  return listRecords(state, 'venture-proposal', ventureId).filter(item => item.proposalKind === 'find-customers' && item.status === 'raised').at(-1)?.title ?? null;
}

/**
 * One answer to the owner's question: the AI's typed parts from the agent's facts, checked by code (chatCall), or the
 * template answer with templates only or when the AI's answer came back in a shape Chausar refuses.
 */
export async function answerQuestion(deps: VentureDeps, ctx: Context, route: ChatRoute | null, input: { state: State; venture: VentureRecord; agent: ChatAgent; question: string; waiting: AgentWaiting | null; request?: ChatRequest }): Promise<Answer> {
  const { state, venture, agent, question, waiting, request } = input;
  const facts = factsOf(deps, state, venture, agent);
  // The earlier messages of this agent's chat; a job's progress lines (runId) are not part of the conversation.
  const history = chatHistory(state, venture, listRecords(state, 'venture-agent-message', venture.id).filter(message => message.agent === agent.id && !message.runId));
  // C7: a hired agent answers only from what its hire says it reads.
  if (agent.hired) {
    const read = await hiredFacts(deps, ctx, agent);
    Object.assign(facts, { reads: read.reads, figures: read.figures, duties: agent.hired.role?.duties ?? [] });
  }
  const included = new Set([...facts.runs.map(run => run.runId), ...(waiting ? [waiting.runId] : [])]);
  const contextRuns = listRecords(state, 'venture-delivery-run', venture.id).filter(run => included.has(run.id)).map(run => {
    const order = listRecords(state, 'venture-order', venture.id).find(order => order.id === run.orderId)!;
    const consent = requireClientAiConsent(state, venture.id, order.clientId);
    return { run, clientId: order.clientId, consentId: consent.id, consentRevision: consent.revision };
  });
  const guard = () => {
    const fresh = readAs(deps, ctx, 'prepare');
    for (const binding of contextRuns) {
      const expected = binding.run;
      const current = listRecords(fresh.state, 'venture-delivery-run', venture.id).find(run => run.id === expected.id);
      const order = current && listRecords(fresh.state, 'venture-order', venture.id).find(order => order.id === current.orderId);
      check(current && order && current.orderId === expected.orderId && order.clientId === binding.clientId, 'JOB_SOURCE_CHANGED', 'The client work changed before this chat finished.');
      requireClientAiConsent(fresh.state, venture.id, binding.clientId, binding);
      if (!expected.agentJob) continue;
      check(current?.agentJob && digest(current.agentJob.scope) === digest(expected.agentJob!.scope)
        && current.agentJob.sourceDigest === expected.agentJob!.sourceDigest
        && digest(current.agentJob.pendingFacts ?? null) === digest(expected.agentJob!.pendingFacts ?? null), 'JOB_SOURCE_CHANGED', 'The client work changed before this chat finished.');
      assertAgentAnswerCurrent(fresh.state, current);
    }
  };
  // The run's question was written by an agent that read the client's files: outside words, screened like a file name.
  const asked = waiting ? outsideWords(state, venture, waiting.question) : null;
  const searchWaiting = searchWaitingOf(state, venture.id);
  const task: ModelTask<AnswerOutput> = {
    purpose: 'agent-chat', instructions: ANSWER_INSTRUCTIONS,
    // The business in the owner's own words (the idea kept at onboarding), so the agent knows what it works for.
    input: { business: { name: venture.workingName, about: venture.idea }, agent: { name: agent.name, job: agent.job }, question, ...(request ? { request } : {}), ...(history.length ? { history } : {}), ...(searchWaiting ? { searchWaiting } : {}), waiting: asked, ...facts } as unknown as Json,
    schemaName: 'venture-agent-answer', schema: ANSWER_SCHEMA, validate: validateAnswer, containsClientData: true, maxOutputTokens: 2048,
  };
  const answered = await chatCall(deps, ctx, route, task, guard);
  if (!answered) {
    const line = route ? "Your AI's answer did not pass Chausar's checks, so this is what Chausar can say from its records." : null;
    // C5 task 5: with no AI the reply's tail says to connect one, and code puts the button under it.
    return { parts: templateAnswer(deps, state, venture, agent, waiting), author: 'template', callId: null, line, ...(route ? {} : { suggestion: { kind: 'connect-ai' as const } }) };
  }
  // Everything the agent was given but Chausar's own ids: a number from there, repeated back, is not the agent's estimate.
  const { parts, leftOut } = checkedParts(answered.value, facts.figures, question, givenWords(task.input));
  const kept = parts.length ? parts : [{ kind: 'text' as const, text: 'I could not answer that with figures I can prove. Ask me another way.' }];
  return { parts: kept, author: 'model', callId: answered.callId, line: leftOutLine(leftOut) };
}
