// Chausar venture launcher, agents (Ink v2 wave 4, package 4J17, catalogue A14): questions done well. An agent asks the
// owner through handoff.owner (delivery/harness/tools.ts) with one question, one question with two to four answers to
// pick from, or a round of two to eight related questions. Each question in a card carries the agent's best guess, so
// one short reply answers the lot ("1 A, 2 ok"); each answer says what it gains and what it costs, the agent's pick
// first; free text is always open, with an escape. Code checks every word before it is kept: the untrusted screen
// (words aimed at an agent or a checker, hidden characters), the money check (no number and no amount: the calculator
// does those), no approval riding inside the questions (QUESTION_HAS_APPROVAL: spending, sending, publishing and the
// like are Today cards of their own), and no question for a fact Chausar already holds (prices, the client's details,
// the business's name, tax registration, currency). The owner's reply is read by code: shorthand, "ok" for every guess,
// or their own words; the next act turn reads each answer beside its question (roundAnswers, wired in loop.ts).
import { ChausarError, type State } from '../../contracts.ts';
import type { HandoffChoice, HandoffRequest, Json, QuestionCard, QuestionItem, QuestionOption, VentureRecord } from '../contracts.ts';
import { assertNoMoney, findRecord, listRecords, modelWords, tidyWords } from '../records.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { plainHindi, statesMoney } from '../delivery/harness/patches.ts';
import { holdsHindiNumber } from './number-words.ts';

/** The escape every card offers: the owner can always write their own answer. */
export const QUESTION_ESCAPE = 'None of these: I will write my own answer.';
export const MIN_ROUND = 2;
export const MAX_ROUND = 8;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
const LABELS = ['A', 'B', 'C', 'D'] as const;
const CHARS = { question: 300, lead: 200, item: 200, guess: 120, option: 120, why: 120 } as const;
/** The most a card's whole text may run: what the run keeps of a question, and what Today shows. */
export const MAX_CARD_CHARS = 1200;

/** What the agent sent with handoff.owner: one question, with answers to pick from, or a round. */
export type AskInput = {
  question: string;
  guess?: string;
  options?: { text: string; gains: string; costs: string }[];
  round?: { text: string; guess: string; options?: { text: string; gains: string; costs: string }[] }[];
};
/** The business's records, for the facts Chausar holds; null where there are none to read (a test by hand). */
export type HeldFacts = { state: State; venture: VentureRecord } | null;
export type Asked = { question: string; choices?: HandoffChoice[]; card?: QuestionCard };

const refuse = (message: string): never => { throw new ChausarError('TOOL_INPUT_INVALID', message); };

// ---------------------------------------------------------------------------
// The checks, by code
// ---------------------------------------------------------------------------

const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/**
 * One piece of the agent's words, by the money check (no number, no amount). A card's words (its questions, guesses
 * and answers, which Today shows as they are) pass the untrusted screen first; a plain question is screened where it
 * is read, as before (the agent's thread and the queue label it as the agent's words).
 */
function words(value: unknown, field: string, max: number, allowed: readonly string[], screen = true): string {
  if (typeof value !== 'string' || !value.trim()) refuse(`The ${field} is empty. Ask in plain words.`);
  let text = value as string;
  if (screen) {
    const screened = screenUntrusted({ source: 'tool-output', text }, { mode: 'enforce' });
    if (screened.status === 'quarantined' || screened.text === null || screened.findings.some(item => item.kind === 'hidden' || item.kind === 'injection' || item.kind === 'checker')) {
      refuse(`The ${field} had words aimed at an agent or a checker, or hidden characters, so it was not asked. Ask in your own plain words.`);
    }
    text = screened.text!;
  }
  if (HIDDEN.test(text)) refuse(`The ${field} held hidden characters. Ask in plain words.`);
  if (tidyWords(text).length > max) refuse(`The ${field} is too long: keep it to ${max} characters.`);
  const money = `The ${field} held a number or an amount of money. Ask in words; amounts come from Chausar's calculator.`;
  let kept: string;
  try {
    kept = modelWords(text, field, max, { allowed, numbers: 'refuse' });
    assertNoMoney(kept, field, allowed);
  } catch {
    return refuse(money);
  }
  // Amounts in Hindi and Hinglish too: "दो हज़ार रुपये", "paanch sau rupaye", "do hazaar" (patches.ts statesMoney, number-words.ts).
  if (statesMoney(kept, '') || holdsHindiNumber(plainHindi(kept))) refuse(money);
  return kept;
}

const FLOOR_VERBS = 'send|email|mail|publish|post|upload|share|pay|spend|refund|charge|invoice|delete|erase|buy|go live|release';
/** Verbs that are an action only when someone asks leave to do them: "book" and "order" are nouns too. */
const LEAVE_VERBS = 'sign|book|order|bill';
/** The done forms of the action verbs, for "should it be sent". */
const DONE_VERBS = 'sent|emailed|mailed|published|posted|uploaded|shared|paid|spent|refunded|charged|invoiced|billed|deleted|erased|released|booked|signed|ordered|bought';
/** Words that ask the owner to approve something: an approval is its own Today card, never a question in a round. */
const HINDI_FLOOR = '(?:भेज|पब्लिश|पोस्ट|अपलोड|भुगतान|पेमेंट|खर्च|डिलीट|मिटा)';
const APPROVAL: readonly RegExp[] = Object.freeze([
  // The agent asks leave to act: "shall I send", "want me to post", "ready for me to publish" ("should the post open with" is not one).
  // After "I" or "we" asking leave, signing, booking, ordering and billing are actions too ("shall I bill the client").
  new RegExp(`\\b(?:(?:shall|should|can|could|may|do)\\s+(?:i|we|chausar)|(?:do you )?want me to|would you like me to|ready for me to|(?:ok|okay|alright|fine) (?:if|for) (?:i|we|me) to)\\b[^?]{0,60}\\b(?:${FLOOR_VERBS}|${LEAVE_VERBS})\\w*`, 'i'),
  // The action asked about without a person: "should it be sent now", "should the draft go to the client".
  new RegExp(`\\b(?:should|shall|can|could|may)\\s+(?:it|this|that|they|these|those|the\\s+[\\p{L}-]+)\\s+(?:be\\s+(?:${DONE_VERBS})|go\\s+(?:out|live|to))\\b`, 'iu'),
  // A plan stated, then asked about: "I will post it tonight, fine?".
  new RegExp(`\\b(?:i|we)(?:'ll|\\s+will|\\s+(?:am|are)\\s+going\\s+to|\\s+can)\\s+(?:${FLOOR_VERBS}|${LEAVE_VERBS})\\w*[^?]*\\?\\s*$`, 'i'),
  new RegExp(`\\b(?:ok|okay|alright|fine|good)\\s+(?:to|if (?:i|we))\\s+(?:${FLOOR_VERBS})\\w*`, 'i'),
  /\b(?:approv\w*|permission|sign[- ]?off|go[- ]?ahead|authori[sz]\w*|green light)\b/i,
  // Hinglish: bhej, bhej doon, post kar du (send, shall I send, shall I post).
  /\bbhej\w*\b|\b(?:post|upload|publish|share|pay|send|delete|invoice)\s+kar\s*(?:du|doon|dun|dein|den|de|doo|diya|dena|dijiye)\b/i,
  // Hindi: a floor verb with an asking ending (भेजूँ, भेज दूँ, पोस्ट करें, भुगतान कर दूँ ...), and approval words.
  new RegExp(`${HINDI_FLOOR}[^?]{0,30}(?:दूँ|दूं|दें|करूँ|करूं|करें|कर दूँ|कर दूं|दूँगा|दूंगा)|${HINDI_FLOOR}(?:ूँ|ूं|ें)|मंज़ूरी|मंजूरी|अनुमति|इजाज़त|इजाजत`, 'u'),
]);
/** An answer that is itself the action ("Send it now"): an option may not be one. Gains and costs may name an action. */
const IMPERATIVE = new RegExp(`^\\s*(?:yes,?\\s+)?(?:${FLOOR_VERBS})\\b`, 'i');

/** True when the words ask the owner to approve an action (spend, send, publish, delete and the like). */
export function asksApproval(text: string, imperative = true): boolean {
  return APPROVAL.some(pattern => pattern.test(text)) || (imperative && IMPERATIVE.test(text));
}

type FactRule = { pattern: RegExp; holds: (facts: NonNullable<HeldFacts>) => string | null };
/** Facts Chausar holds, and where: a question for one is refused with the place to look. */
const FACT_RULES: readonly FactRule[] = Object.freeze([
  {
    // The business's selling price only: "our price", "what to charge", "the client's fee". A frame rate or a TDS rate is not one.
    pattern: /\b(?:our|my|your|the business(?:'s|’s)?) (?:price|prices|pricing|rate card|fee|fees)\b|\bwhat (?:price|fee) (?:should|do|to|would|will|can)\b|\bwhat (?:to|should (?:i|we)|do (?:i|we)) charge\b|\bhow much (?:to|should (?:i|we)|do (?:i|we)|will (?:i|we)|can (?:i|we)) charge\b|\b(?:client|customer)(?:'s|s'|’s)? (?:fee|price|rate)\b|\b(?:price|fee|fees|charge) (?:for|of) (?:this|the) (?:order|job|work|episode|project|video|post)\b|\bhow much is (?:the|our|your|my) (?:fee|price|charge|rate)\b|हमारा दाम|हमारी कीमत|कितना चार्ज|\bkitna charge\b/i,
    holds: ({ state, venture }) => (acceptedBlueprintOrNull(state, venture) ? 'Chausar already holds your prices in your plan, and its calculator quotes them. Read them there.' : null),
  },
  {
    pattern: /\b(?:client|customer)(?:'s|s'|’s)?\s+(?:e-?mail|email address|name|country|gstin|gst number|tax id)\b|\bwho is the client\b/i,
    holds: ({ state, venture }) => (listRecords(state, 'venture-client', venture.id).length ? "Chausar already holds the client's details on the order. Read them there." : null),
  },
  {
    pattern: /\b(?:business|company|channel|brand|shop)(?:'s|’s)?\s+name\b|\bname of (?:your|the|my) (?:business|company|channel|brand|shop)\b/i,
    holds: ({ venture }) => (venture.workingName ? `Chausar already holds the business's name: ${venture.workingName}.` : null),
  },
  {
    pattern: /\b(?:gstin|gst number|gst registration|registered for gst|gst registered|tax registration|vat number)\b/i,
    holds: ({ venture }) => (venture.country ? "Chausar already holds the business's tax registration from its interview. Read it in Business." : null),
  },
  {
    pattern: /\b(?:which|what) currency\b/i,
    holds: ({ venture }) => (venture.country ? `Chausar already holds the business's country and currency: ${venture.country.name}, ${venture.country.currency}.` : null),
  },
  {
    pattern: /\bwhat did the client (?:ask|want|say|send)\b|\bclient(?:'s|’s)? (?:request|message|brief)\b/i,
    holds: () => "Chausar already holds the client's request on the order. Read it there.",
  },
]);

/** Where a fact the words ask for is already held, or null. Code, not a model. */
export function heldFact(text: string, facts: HeldFacts): string | null {
  if (!facts) return null;
  for (const rule of FACT_RULES) {
    if (!rule.pattern.test(text)) continue;
    const line = rule.holds(facts);
    if (line) return line;
  }
  return null;
}

/** The facts of the run's business, read from the vault the tool runs over. */
export function heldFacts(state: State | null, ventureId: string): HeldFacts {
  if (!state) return null;
  const venture = findRecord(state, 'venture-record', ventureId);
  return venture ? { state, venture } : null;
}

/** A fact Chausar holds is looked up first (what to charge is the plan's price), then an approval is refused. */
function asked(text: string, facts: HeldFacts, imperative = true): void {
  const held = heldFact(text, facts);
  if (held) refuse(`${held} Ask only what you cannot look up.`);
  if (asksApproval(text, imperative)) {
    throw new ChausarError('QUESTION_HAS_APPROVAL', 'An approval never rides inside a question. Spending, sending, publishing and changing a price each wait as their own card on Today, so ask only for facts or choices.');
  }
}

// ---------------------------------------------------------------------------
// Building the card
// ---------------------------------------------------------------------------

function optionsOf(raw: AskInput['options'], allowed: readonly string[], facts: HeldFacts): QuestionOption[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length < MIN_OPTIONS || raw.length > MAX_OPTIONS) refuse(`Offer ${MIN_OPTIONS} to ${MAX_OPTIONS} answers, your pick first, or none.`);
  // A gain or a cost is checked like the answer: no approval rides in it, and no fact Chausar holds.
  const why = (value: string, field: string) => { const kept = words(value, field, CHARS.why, allowed); asked(kept, facts, false); return kept; };
  return raw.map((option, index) => {
    if (!option || typeof option !== 'object' || typeof option.gains !== 'string' || typeof option.costs !== 'string') refuse('Each answer says what it gains and what it costs.');
    const text = words(option.text, 'answer', CHARS.option, allowed);
    asked(text, facts);
    return {
      label: LABELS[index], text, gains: why(option.gains, 'gain'), costs: why(option.costs, 'cost'), recommended: index === 0,
    };
  });
}

function itemOf(number: number, raw: { text: unknown; guess?: unknown; options?: AskInput['options'] }, allowed: readonly string[], facts: HeldFacts, guessFromPick: boolean): QuestionItem {
  const text = words(raw.text, 'question', CHARS.item, allowed);
  asked(text, facts);
  const options = optionsOf(raw.options, allowed, facts);
  const given = raw.guess === undefined || raw.guess === null || raw.guess === '' ? null : words(raw.guess, 'guess', CHARS.guess, allowed);
  if (given) asked(given, facts);
  const guess = given ?? (guessFromPick && options.length ? options[0].text : null);
  if (!guess) refuse('Each question in a round carries your best guess at the answer.');
  return { number, text, guess: guess!, options };
}

/** The one-line reply that takes every guess: the pick's letter, or "ok". */
/** A card's text within what the run keeps, or refused: ask fewer questions or shorter ones. */
function fitting(text: string): string {
  if (text.length > MAX_CARD_CHARS) refuse(`This card is too long to show: ${text.length} characters, more than ${MAX_CARD_CHARS}. Ask fewer questions, or shorter ones.`);
  return text;
}

function exampleOf(items: readonly QuestionItem[]): string {
  return items.map(item => `${item.number} ${item.options.length ? item.options[0].label : 'ok'}`).join(', ');
}

/** The question as the owner reads it on Today: the lead, each question with its guess and answers, and how to reply. */
export function cardText(card: QuestionCard): string {
  const items = card.items.map(item => {
    const options = item.options.length ? ` ${item.options.map(option => `${option.label}: ${option.text}`).join('; ')}.` : '';
    return `${card.items.length > 1 ? `${item.number}. ` : ''}${item.text} My guess: ${item.guess}.${options}`;
  });
  return [card.lead, ...items, `Reply in one line, like "${card.example}", or in your own words.`].filter(Boolean).join(' ');
}

/**
 * The question the agent asks, checked by code: words screened as untrusted and the money check, no approval inside,
 * no fact Chausar holds. One question with answers, or a round, becomes a card (and a question with answers gives
 * Today its choices, the pick first); a plain question stays a question. Refused with TOOL_INPUT_INVALID or
 * QUESTION_HAS_APPROVAL, which the agent reads as the call's error and asks again.
 */
export function askCard(input: AskInput, context: { allowed: readonly string[]; facts: HeldFacts }): Asked {
  const { allowed, facts } = context;
  if (input.round !== undefined) {
    if (!Array.isArray(input.round) || input.round.length < MIN_ROUND || input.round.length > MAX_ROUND) refuse(`A round asks ${MIN_ROUND} to ${MAX_ROUND} related questions; ask one on its own instead.`);
    if (input.options !== undefined || input.guess !== undefined) refuse('In a round, each question carries its own guess and answers.');
    const lead = words(input.question, 'lead line', CHARS.lead, allowed);
    asked(lead, facts);
    const items = input.round.map((item, index) => itemOf(index + 1, item ?? { text: '' }, allowed, facts, true));
    const card: QuestionCard = { round: 1, lead, items, freeText: true, escape: QUESTION_ESCAPE, example: exampleOf(items) };
    return { question: fitting(cardText(card)), card };
  }
  if (input.options !== undefined) {
    const item = itemOf(1, { text: input.question, guess: input.guess, options: input.options }, allowed, facts, true);
    const card: QuestionCard = { round: 1, lead: '', items: [item], freeText: true, escape: QUESTION_ESCAPE, example: exampleOf([item]) };
    const choices: HandoffChoice[] = item.options.map(option => ({ label: option.label, text: option.text, gains: option.gains, costs: option.costs, recommended: option.recommended }));
    return { question: `${item.text} My guess: ${item.guess}.`, choices, card };
  }
  const question = words(input.question, 'question', CHARS.question, allowed, false);
  asked(question, facts);
  if (input.guess !== undefined) {
    const guess = words(input.guess, 'guess', CHARS.guess, allowed, false);
    asked(guess, facts);
    return { question: `${question} My guess: ${guess}.` };
  }
  return { question };
}

// ---------------------------------------------------------------------------
// The owner's reply
// ---------------------------------------------------------------------------

export type ReadAnswer = { number: number; answer: string; by: 'option' | 'guess' | 'words' };
const EVERY_GUESS = /^\s*(?:ok(?:ay)?|all ok|all good|yes to all|go with your guesses|sab th?eek(?: hai)?|सब ठीक(?: है)?)\s*[.!।]?\s*$/iu;
const TAKE_GUESS = /^(?:ok(?:ay)?|guess|your guess|fine|th?eek|ठीक(?: है)?)$/iu;
const MARK = /(?:^|[\s,;])(\d{1,2})\s*[.:)-]?\s*/gu;

function answerOf(item: QuestionItem, value: string): ReadAnswer {
  const letter = /^([a-d])[.)]?$/i.exec(value);
  const option = letter ? item.options[LABELS.indexOf(letter[1].toUpperCase() as typeof LABELS[number])] : undefined;
  if (option) return { number: item.number, answer: option.text, by: 'option' };
  if (TAKE_GUESS.test(value)) return { number: item.number, answer: item.guess, by: 'guess' };
  return { number: item.number, answer: value, by: 'words' };
}

/**
 * The owner's reply to a card, read by code: "ok" takes every guess; a reply that starts with a question's number is
 * read as shorthand ("1 B, 2 no, 3 ok", "1a 2b"), a letter picking that answer, "ok" its guess, other words the answer
 * itself; whatever is left over, or a reply in the owner's own words, is free text, kept whole.
 */
export function parseReply(card: QuestionCard, reply: string): { answers: ReadAnswer[]; free: string | null } {
  const text = tidyWords(reply ?? '');
  if (!text) return { answers: [], free: null };
  if (EVERY_GUESS.test(text)) return { answers: card.items.map(item => ({ number: item.number, answer: item.guess, by: 'guess' as const })), free: null };
  if (card.items.length === 1 && !/^\d/.test(text)) {
    const value = text.replace(/[.!]$/, '');
    if (/^[a-d][.)]?$/i.test(value) || TAKE_GUESS.test(value)) return { answers: [answerOf(card.items[0], value)], free: null };
    return { answers: [], free: text };
  }
  if (!/^\d/.test(text)) return { answers: [], free: text };
  const marks = [...text.matchAll(MARK)];
  const answers: ReadAnswer[] = [];
  const left: string[] = [];
  marks.forEach((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length;
    const end = index + 1 < marks.length ? marks[index + 1].index ?? text.length : text.length;
    const [value, ...rest] = text.slice(start, end).split(/[,;\n]/);
    const item = card.items.find(entry => entry.number === Number(mark[1]));
    const clean = value.trim().replace(/[.!]$/, '');
    if (item && clean && !answers.some(answer => answer.number === item.number)) answers.push(answerOf(item, clean));
    else if (clean) left.push(`${mark[1]} ${clean}`);
    const more = rest.join(',').trim();
    if (more) left.push(more);
  });
  answers.sort((a, b) => a.number - b.number);
  return { answers, free: left.length ? left.join(', ') : null };
}

const brief = (text: string) => (text.length <= 40 ? text : `${text.slice(0, 39).trimEnd()}.`);

/** The submit button's words: the answer restated ("Send: 1 About twenty minutes, 2 no"), or "Send your answer" for free text. */
export function submitLabel(card: QuestionCard, reply: string): string {
  const read = parseReply(card, reply);
  if (!read.answers.length) return 'Send your answer';
  return `Send: ${read.answers.map(answer => `${answer.number} ${brief(answer.answer)}`).join(', ')}${read.free ? ', and your note' : ''}`;
}

/**
 * For the next act turn: each answered card's answers beside their questions, read from the owner's reply, with any
 * free text as a note. Empty when no card was answered (a question that timed out was not), so the input stays the same.
 */
export function roundAnswers(handoffs: readonly HandoffRequest[]): Record<string, Json> {
  const rounds = handoffs.filter(handoff => handoff.card && handoff.answer !== null && handoff.answeredBy !== 'timeout').map(handoff => {
    const card = handoff.card!;
    const read = parseReply(card, handoff.answer!);
    const answers = read.answers.map(answer => ({ number: answer.number, question: card.items.find(item => item.number === answer.number)!.text, answer: answer.answer }));
    return { round: card.round, answers, ...(read.free ? { note: read.free } : {}) };
  });
  return rounds.length ? { roundAnswers: rounds } : {};
}

