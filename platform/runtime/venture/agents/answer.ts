// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1, catalogue A2): what an agent does with the owner's
// words. Code decides what they ask for: a question gets one answer; a request for work suggests a prefilled New
// order and creates nothing; a request that lands on the floor (publish, send, money, prices, deleting) becomes a
// drafted proposal for Today. An answer is typed parts written from the agent's own facts (its last runs, the order
// files' names, its notes and standing orders): a figure only by a receipt those facts hold, any other number labelled
// a model estimate, and words that state money without a receipt left out. With templates only, code answers.
// Nothing the consent promises is never sent reaches the AI: card, bank account, Aadhaar and one-time code numbers are
// screened out of every fact, and client file names and the run's question pass the untrusted screen first.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type { AgentWaiting, ChatPart, Json, ModelTask, RunDetail, VentureDeps, VentureRecord } from '../contracts.ts';
import { copiedTokens, listRecords, modelNumbers, tidyWords } from '../records.ts';
import { digitCopy, screenReadback } from '../core/secrets.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { hindiNumberWords, plainHindi, statesMoney } from '../delivery/harness/patches.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { deliveryRunDetails } from '../views/runs.ts';
import { short } from '../views/shared.ts';
import { requireChatConsent, type ChatRoute } from './consent.ts';
import { standingOrders } from './versions.ts';
import { onlyAsks } from './standing.ts';
import type { ChatAgent } from './roles.ts';
import { usableNoteText } from './recall.ts';

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
export async function chatCall<T>(deps: VentureDeps, ctx: Context, route: ChatRoute | null, task: ModelTask<T>): Promise<{ value: T; callId: string | null } | null> {
  if (!route) return null;
  const preview = await deps.models.preview(ctx, { ...task, input: screenFacts(task.input) });
  if (!preview) return null;
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const now = requireChatConsent(deps, ctx, state, venture);
  check(now && now.presetId === route.presetId && now.model === route.model && now.connectionId === route.connectionId, 'CHAT_CONSENT_STALE', CHANGED_ROUTE);
  check(preview.presetId === route.presetId && preview.model === route.model, 'CHAT_CONSENT_STALE', CHANGED_ROUTE);
  try {
    const outcome = await deps.models.runPreview(ctx, preview.callId, preview.digest, task.validate);
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

/** The runs this agent owned a step in, newest first, with only its own steps. */
export function agentRuns(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent): { detail: RunDetail; steps: RunDetail['steps'] }[] {
  return deliveryRunDetails(deps, state, venture).flatMap(detail => {
    const steps = detail.steps.filter(step => agent.stepIds.includes(step.id));
    return steps.length ? [{ detail, steps }] : [];
  });
}

/** The question this agent's run waits on the owner for, kept in one fixed place: the newest one, or null. */
export function waitingOn(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent): AgentWaiting | null {
  for (const record of listRecords(state, 'venture-delivery-run', venture.id).reverse()) {
    const harness = record.harness;
    if (record.status !== 'needs-answer' || harness?.phase !== 'needs-answer') continue;
    const index = harness.handoffs.findLastIndex(handoff => handoff.answer === null);
    if (index < 0) continue;
    // The role that asked: the turn's role when the harness recorded it, else the role that owns the question step.
    const role = harness.turns.find(turn => turn.turn === harness.handoffs[index].turn)?.role;
    const asks = role ? role === agent.id : agent.steps.some(step => step.kind === 'question');
    if (!asks) continue;
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

type RawPart = { kind: 'text' | 'figure'; text: string; receiptId: string; key: string };
export type AnswerOutput = { parts: RawPart[] };

const ANSWER_INSTRUCTIONS = [
  'You are one agent of a small business the owner runs with Chausar. The owner asks you about your work. Answer briefly, in plain words, from the facts given only: your runs and their steps, the file names, your notes and the standing orders the owner gave you.',
  'Give every amount, count or total as a figure part that names one of the figures given, by its receiptId and key; never write money in words. Any other number you write is shown to the owner as a model estimate.',
  'Never claim work the runs do not show. Never say you will publish, send, pay or change a price: those wait for the owner on Today.',
  'Use text parts for words, with receiptId and key empty; use figure parts with text empty.',
].join(' ');

const ANSWER_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['parts'],
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'text', 'receiptId', 'key'],
        properties: {
          kind: { type: 'string', enum: ['text', 'figure'] }, text: { type: 'string' },
          receiptId: { type: 'string', description: 'For a figure part: the receiptId of one of the figures given.' },
          key: { type: 'string', description: 'For a figure part: the key of that figure.' },
        },
      },
    },
  },
};

const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const rejected = (message: string): never => { throw new ChausarError('MODEL_OUTPUT_REJECTED', message); };

/** The answer's shape: one to eight parts, each closed, short and with no hidden characters. */
export function validateAnswer(raw: unknown): AnswerOutput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || !Array.isArray((raw as { parts?: unknown }).parts)) return rejected('The answer was not a list of parts.');
  const parts = (raw as { parts: unknown[] }).parts;
  if (parts.length < 1 || parts.length > 8) return rejected('The answer had too few or too many parts.');
  return {
    parts: parts.map(part => {
      const item = part as Record<string, unknown>;
      if (!item || typeof item !== 'object' || Object.keys(item).length !== 4 || (item.kind !== 'text' && item.kind !== 'figure')) return rejected('A part of the answer had the wrong shape.');
      for (const field of ['text', 'receiptId', 'key']) if (typeof item[field] !== 'string' || (item[field] as string).length > 600 || HIDDEN.test(item[field] as string)) return rejected('A part of the answer was not plain short text.');
      return { kind: item.kind, text: item.text as string, receiptId: item.receiptId as string, key: item.key as string };
    }),
  };
}

const COUNT_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
/** The engine's line for figures the answer left out, counted by code. */
export function leftOutLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'One figure was left out: it had no receipt.' : `${COUNT_WORDS[count - 1] ?? String(count)} figures were left out: they had no receipt.`;
}

/**
 * Code checks every part before it is stored: a figure part must name a figure the agent's facts hold (its display
 * comes from the receipt, never the model), else it is left out; words that state money (a currency code, sign or name,
 * Hindi रुपये and रु included) are left out; any other number in words, Hindi number words too, becomes an estimate
 * part, labelled a model estimate. question: the owner's own words, whose names (B2B, Web3) may be copied.
 */
export function checkedParts(output: AnswerOutput, figures: readonly Figure[], question: string): { parts: ChatPart[]; leftOut: number } {
  const parts: ChatPart[] = [];
  let leftOut = 0;
  for (const part of output.parts) {
    if (part.kind === 'figure') {
      const found = figures.find(item => item.receiptId === part.receiptId && item.key === part.key);
      if (found) parts.push({ kind: 'figure', receiptId: found.receiptId, key: found.key, display: found.display });
      else leftOut += 1;
      continue;
    }
    const words = tidyWords(part.text);
    if (!words) continue;
    if (statesMoney(words, question)) { leftOut += 1; continue; }
    const counted = modelNumbers(words, copiedTokens(question)) || hindiNumberWords(words).length > 0;
    parts.push(counted ? { kind: 'estimate', text: words } : { kind: 'text', text: words });
  }
  return { parts, leftOut };
}

const STATE_WORDS: Readonly<Record<RunDetail['state'], string>> = { active: 'in progress', waiting: 'waiting on you', done: 'done', failed: 'stopped with a failure' };

/** The answer code writes with templates only, or when the AI's answer did not pass: plain facts from the records. */
export function templateAnswer(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent, waiting: AgentWaiting | null): ChatPart[] {
  const lines: string[] = [];
  if (waiting) lines.push(`I am waiting on your answer: ${short(waiting.question, 200)}`);
  const latest = agentRuns(deps, state, venture, agent)[0];
  lines.push(latest ? `My latest run, ${short(latest.detail.purpose, 120)}, is ${STATE_WORDS[latest.detail.state]}.` : 'I have not worked on an order yet.');
  const orders = standingOrders(state, venture, agent).length;
  if (orders) lines.push(`I follow ${orders} standing ${orders === 1 ? 'order' : 'orders'} from you.`);
  lines.push('Connect your AI in Connections to ask me questions in your own words.');
  return lines.map(text => ({ kind: 'text', text }));
}

export type Answer = { parts: ChatPart[]; author: 'model' | 'template'; callId: string | null; line: string | null };

/**
 * One answer to the owner's question: the AI's typed parts from the agent's facts, checked by code (chatCall), or the
 * template answer with templates only or when the AI's answer came back in a shape Chausar refuses.
 */
export async function answerQuestion(deps: VentureDeps, ctx: Context, route: ChatRoute | null, input: { state: State; venture: VentureRecord; agent: ChatAgent; question: string; waiting: AgentWaiting | null }): Promise<Answer> {
  const { state, venture, agent, question, waiting } = input;
  const facts = factsOf(deps, state, venture, agent);
  // The run's question was written by an agent that read the client's files: outside words, screened like a file name.
  const asked = waiting ? outsideWords(state, venture, waiting.question) : null;
  const task: ModelTask<AnswerOutput> = {
    purpose: 'agent-chat', instructions: ANSWER_INSTRUCTIONS,
    input: { agent: { name: agent.name, job: agent.job }, question, waiting: asked, ...facts } as unknown as Json,
    schemaName: 'venture-agent-answer', schema: ANSWER_SCHEMA, validate: validateAnswer, containsClientData: true, maxOutputTokens: 1024,
  };
  const answered = await chatCall(deps, ctx, route, task);
  if (!answered) {
    const line = route ? "Your AI's answer did not pass Chausar's checks, so this is what Chausar can say from its records." : null;
    return { parts: templateAnswer(deps, state, venture, agent, waiting), author: 'template', callId: null, line };
  }
  const { parts, leftOut } = checkedParts(answered.value, facts.figures, question);
  const kept = parts.length ? parts : [{ kind: 'text' as const, text: 'I could not answer that with figures I can prove. Ask me another way.' }];
  return { parts: kept, author: 'model', callId: answered.callId, line: leftOutLine(leftOut) };
}
