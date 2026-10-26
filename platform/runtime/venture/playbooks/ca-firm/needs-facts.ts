// AI-native CA firm (Ink v2 wave 4, package 4J16, catalogue CA8): the NEEDS_FACTS loop. A calculator short of a fact
// only the client knows (the regime they chose, whether they were resident, their age band, what they earned, the date
// they filed, the month or GSTIN a GST working is for, the kind of a payee or the date of a payment) refuses with
// NEEDS_FACTS and the list of what is missing, before it works any figure: it never guesses one. A case the calculator
// does not model is still NOT_MODELLED first (that goes to the CA), and a value that is there but written wrong stays
// TAX_INPUT_INVALID, the agent's to fix. In the harness the refusal ends the agent's turn as a hand-off to the client
// whose words Chausar writes from the list (needsFactsHandoff, called in loop.ts applyTurn), in Hindi for a client who
// writes in Hindi, never the model's words. That question never times out into a guess: it carries needsFacts, which
// the timed questions skip (delivery/timed-questions.ts), and a fact the client was asked for may not be filled in
// until a question that asked the client for that very fact was really answered (guessedFacts, read by
// delivery/harness/tools-ca.ts). A
// payee's name from the client's files passes the untrusted screen before it is put in a question; one the screen
// flags is left out ("the payee"). W5's CA deepening builds on it.
// The Hindi is machine-drafted and needs a native reviewer (HINDI_REVIEW); 4Z adds it to the review list.
// Idea taken, code written here: Invaro/opentax-engine (AGPL-3.0, ideas only), whose errors list the missing inputs.
import { ChausarError } from '../../../contracts.ts';
import type { HandoffRequest, Json, ToolCallRecord } from '../../contracts.ts';
import { screenUntrusted } from '../../policy/untrusted.ts';

export const HINDI_REVIEW = 'machine-drafted, needs a native reviewer';

/** The facts a CA calculator may be short of, in the order they are asked. */
export const FACT_FIELDS = ['regime', 'residency', 'ageBand', 'income', 'filedOn', 'gstin', 'period', 'payeeKind', 'paymentDate'] as const;
export type FactField = typeof FACT_FIELDS[number];
/** One missing fact; about: whom or what it is about, such as a payee's name, when there are several. */
export type MissingFact = { field: FactField; about?: string };
export type FactsLanguage = 'en' | 'hi';

/** How each fact is asked, as part of one sentence to the client. {about} is the payee it is about. No digits. */
const ASK: Readonly<Record<FactField, Record<FactsLanguage, string>>> = Object.freeze({
  regime: { en: 'whether you chose the new tax regime or the old one for the year', hi: 'इस साल के लिए आपने नई टैक्स व्यवस्था चुनी या पुरानी' },
  residency: { en: 'whether you were resident in India for the year', hi: 'क्या इस साल आप भारत के निवासी थे' },
  ageBand: { en: 'your date of birth, so the right age band is used', hi: 'आपकी जन्मतिथि, ताकि सही उम्र वर्ग लगे' },
  income: { en: 'what you earned in the year: salary, interest, or a business or profession', hi: 'इस साल आपकी कमाई किससे हुई: तनख़्वाह, ब्याज, या कोई कारोबार या पेशा' },
  filedOn: { en: 'the date you filed your return, or plan to file it', hi: 'आपने रिटर्न किस तारीख़ को भरा, या कब भरने वाले हैं' },
  gstin: { en: 'the GSTIN of the business', hi: 'बिज़नेस का GSTIN' },
  period: { en: 'which month the GST working is for', hi: 'GST का हिसाब किस महीने का है' },
  payeeKind: { en: 'what kind of payee {about} is: a person, a family business (HUF), a company, a firm or something else', hi: '{about} किस तरह के हैं: व्यक्ति, HUF, कंपनी, फ़र्म या कुछ और' },
  paymentDate: { en: 'the date of the payment to {about}', hi: '{about} को भुगतान किस तारीख़ को हुआ' },
});
const LEAD: Readonly<Record<FactsLanguage, string>> = { en: 'To work this out I need', hi: 'यह हिसाब लगाने के लिए मुझे जानना है' };
const AND: Readonly<Record<FactsLanguage, string>> = { en: 'and', hi: 'और' };
const END: Readonly<Record<FactsLanguage, string>> = { en: 'Could you tell me?', hi: 'क्या आप बता सकते हैं?' };
/** The longest question a hand-off keeps (loop.ts cuts at 300). */
const MAX_QUESTION = 300;
/** How long the refusal lasts: asking again before the client answers gives the same answer. */
export const NEEDS_FACTS_UNTIL = 'the client answers';

/** A payee with no name given, or a name the screen flagged, is "the payee" (भुगतान पाने वाले). */
const SOMEONE: Readonly<Record<FactsLanguage, string>> = { en: 'the payee', hi: 'भुगतान पाने वाले' };
const fill = (words: string, about: string | undefined, language: FactsLanguage) => words.replace('{about}', about ?? SOMEONE[language]);

/**
 * A name from the client's files as a question may carry it: through the untrusted screen (enforce), short, one line.
 * Anything the screen does not pass as clean is left out, so the question says "the payee" instead.
 */
export function safeAbout(about: unknown): string | undefined {
  if (typeof about !== 'string' || !about.trim()) return undefined;
  try {
    const screened = screenUntrusted({ source: 'client-file', text: about.slice(0, 200) }, { mode: 'enforce', keep: ['pan'] });
    if (screened.status !== 'clean' || !screened.text) return undefined;
    const words = screened.text.replace(/\s+/g, ' ').trim().slice(0, 60);
    return words || undefined;
  } catch {
    return undefined;
  }
}

function joined(parts: readonly string[], language: FactsLanguage): string {
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts.slice(0, -1).join('; ')}; ${AND[language]} ${parts.at(-1)}`;
}

/**
 * The question for the client, in plain words from the fixed list: "To work this out I need whether you were resident
 * in India for the year; and your date of birth ... Could you tell me?" At most three facts are named and the rest are
 * counted, so it stays one short message. No figure is ever in it.
 */
export function factsQuestion(missing: readonly MissingFact[], language: FactsLanguage = 'en'): string {
  const known = missing.filter(item => Object.hasOwn(ASK, item.field));
  const shown = known.slice(0, 3).map(item => fill(ASK[item.field][language], item.about, language));
  const more = known.length - shown.length;
  const tail = more > 0 ? (language === 'en' ? ` (and ${more === 1 ? 'one more thing' : 'a few more things'} after that)` : ' (और उसके बाद कुछ और बातें)') : '';
  const sentence = `${LEAD[language]} ${joined(shown, language)}${tail}. ${END[language]}`;
  return sentence.length <= MAX_QUESTION ? sentence : `${sentence.slice(0, MAX_QUESTION - 1).trimEnd()}?`;
}

/** The missing facts in English words, one after another: "whether you were resident in India for the year; ...". */
export function factsWords(missing: readonly MissingFact[]): string {
  return missing.filter(item => Object.hasOwn(ASK, item.field)).map(item => fill(ASK[item.field].en, item.about, 'en')).join('; ');
}

/** The refusal's words for the agent: what is missing, and that it must ask, not guess. */
function refusalWords(engine: string, missing: readonly MissingFact[]): string {
  const asked = missing.map(item => fill(ASK[item.field].en, item.about, 'en')).join('; ');
  return `The ${engine} needs facts only the client can give: ${asked}. Chausar asks the client; no figure is worked until they answer.`;
}

/**
 * Throws NEEDS_FACTS for the facts missing, when any is: details carry the list (field and a screened about), retry
 * false until the client answers, and the client's question in English and Hindi. engine: the working's name in words.
 */
export function requireFacts(engine: string, missing: readonly MissingFact[]): void {
  if (!missing.length) return;
  const seen = new Set<string>();
  const ordered = [...missing].map(item => ({ field: item.field, about: safeAbout(item.about) }))
    .sort((a, b) => FACT_FIELDS.indexOf(a.field) - FACT_FIELDS.indexOf(b.field))
    .filter(item => { const key = `${item.field}\n${item.about ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const listed: Json[] = ordered.map((item): Json => (item.about === undefined ? { field: item.field } : { field: item.field, about: item.about }));
  const details: Json = {
    retry: false, until: NEEDS_FACTS_UNTIL,
    missing: listed,
    question: { en: factsQuestion(ordered, 'en'), hi: factsQuestion(ordered, 'hi') },
  };
  throw Object.assign(new ChausarError('NEEDS_FACTS', refusalWords(engine, ordered)), { details });
}

/** True when a fact is absent: not given at all, null, or empty text. A zero or a false is a fact, not a gap. */
export function absent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** The missing facts a NEEDS_FACTS refusal's details list, read again; names screened again. */
export function missingOf(details: unknown): MissingFact[] {
  const list = (details as { missing?: unknown } | null | undefined)?.missing;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is MissingFact => !!item && typeof item === 'object' && (FACT_FIELDS as readonly string[]).includes((item as MissingFact).field))
    .map(item => { const about = safeAbout(item.about); return about === undefined ? { field: item.field } : { field: item.field, about }; });
}

/** A hand-off a NEEDS_FACTS refusal made: to the client, in Chausar's words, and it never times out. */
export type FactsHandoff = { to: 'client'; question: string; needsFacts: true };

/**
 * The hand-off a NEEDS_FACTS refusal makes (loop.ts applyTurn): to the client, with Chausar's question from the list,
 * in Hindi when the refusal says the client writes in Hindi (details.language, set by tools-ca.ts). Null for any other
 * error, or one without the list, so nothing else ever becomes a question.
 */
export function needsFactsHandoff(error: { code: string; message: string; details?: Json }): FactsHandoff | null {
  if (error.code !== 'NEEDS_FACTS') return null;
  const details = error.details as { language?: unknown } | null | undefined;
  if (!details || typeof details !== 'object') return null;
  const missing = missingOf(details);
  return missing.length ? { to: 'client', question: factsQuestion(missing, details.language === 'hi' ? 'hi' : 'en'), needsFacts: true } : null;
}

/** The tool input fields that give each fact. A fact read from a table column (a payee's kind, a date) is the client's file. */
export const FACT_INPUTS: Readonly<Partial<Record<FactField, readonly string[]>>> = Object.freeze({
  regime: ['regime'], residency: ['residency'], ageBand: ['ageBand'], income: ['salary', 'otherIncome', 'businessIncome', 'presumptive'],
  filedOn: ['filedOn'], gstin: ['gstin'], period: ['period'],
  // A payee's kind and a payment's date are read from table columns (tax.tds payments.payeeKind, payments.date).
  payeeKind: ['payments.payeeKind'], paymentDate: ['payments.date'],
});

/** A tool input field by its dotted path, such as payments.payeeKind. */
function inputAt(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), input);
}

/**
 * Whether a question to the client asked for this fact and was really answered: one of Chausar's questions (it
 * carries the fact's own words, in English or Hindi) asked at or after the refusal, with an answer that is not a
 * timeout. An agent's own question, or a question about another fact, unlocks nothing.
 */
function askedAndAnswered(handoffs: readonly HandoffRequest[], item: MissingFact, since: number): boolean {
  const words = (['en', 'hi'] as const).map(language => fill(ASK[item.field][language], item.about, language));
  return handoffs.some(handoff => handoff.to === 'client' && handoff.turn >= since && handoff.answer !== null && handoff.answeredBy !== null
    && handoff.answeredBy !== 'timeout' && words.some(asked => handoff.question.includes(asked)));
}

/**
 * The facts a tool call now fills in that an earlier call of the same tool in this run was refused NEEDS_FACTS for,
 * unless a question that asked the client for that fact was really answered since (askedAndAnswered): the agent would
 * be guessing them, so they are asked again. Empty when nothing is guessed.
 */
export function guessedFacts(calls: readonly ToolCallRecord[], handoffs: readonly HandoffRequest[], tool: string, input: Record<string, unknown>): MissingFact[] {
  const guessed: MissingFact[] = [];
  for (const call of calls) {
    if (call.tool !== tool || call.envelope.ok || call.envelope.error.code !== 'NEEDS_FACTS') continue;
    for (const item of missingOf(call.envelope.error.details)) {
      if (askedAndAnswered(handoffs, item, call.turn)) continue;
      const keys = FACT_INPUTS[item.field];
      if (keys?.some(key => !absent(inputAt(input, key))) && !guessed.some(found => found.field === item.field)) guessed.push({ field: item.field });
    }
  }
  return guessed;
}
