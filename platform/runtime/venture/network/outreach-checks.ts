// Chausar venture launcher, network (Ink v2 wave 4, package 4E2): the checks every outreach draft passes, in code,
// before the owner sees it (catalogue C9, C11, C21). Hard checks stop a draft: a service the owner said the business
// does not sell (OUTREACH_EXCLUDED_SERVICE), and for words the owner's AI wrote, a figure the facts it was given do not
// hold, an amount of money, a card, bank account, Aadhaar or one-time code number, a key, words meant for the AI (the
// prompt-leak lint, W1 H20), a word the house style keeps out, or a link or a site the facts and the owner's words do
// not hold; a draft that fails one becomes Chausar's own template draft instead. Advisory lints warn and block nothing:
// salesy words, a hard call to action, a link in a first touch, a LinkedIn note near its limit (and the line about free
// accounts' few notes), a touch too soon after the last, and on the final words of every draft (Chausar's templates
// too, which carry the owner's words) the prompt-leak lint and the house style.
// The lint ideas follow 10xconnect's composer guardrails and sequence lint (ideas only); the rules are written here.
import { check } from '../../contracts.ts';
import type { DateOrder, IsoDate, OutreachChannel, OutreachKind, VentureDeps } from '../contracts.ts';
import { assertNoMoney, houseStyleFindings, modelNumbers } from '../records.ts';
import { secretFindings } from '../core/secrets.ts';
import { holdsIdNumber } from '../agents/answer.ts';
import { hindiNumberWords } from '../delivery/harness/patches.ts';
import { promptLeakLine, promptLeaks } from '../playbooks/prompt-leak.ts';
import { addDays, daysBetween, shortDay } from './followups.ts';
import { fold } from './text.ts';

/**
 * 4J6 (C10): refuses (OUTREACH_BLOCKED) a draft to an address the never-contact list of the businesses on this computer
 * holds, as a keyed one-way check: someone another business's blocklist keeps out, or a person forgotten there. The
 * host's check refuses (TIER_UNAVAILABLE) when the list holds checks it cannot run. No list (the hosted app): no check.
 */
export async function refuseNeverContact(deps: VentureDeps, addresses: readonly (string | null | undefined)[], name: string): Promise<void> {
  const values = addresses.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  if (!values.length || !deps.workspace?.neverContact) return;
  check(!(await deps.workspace.neverContact.has(values)), 'OUTREACH_BLOCKED', `${name} is on the never-contact list of your businesses on this computer.`);
}

/** A connection note's limit: 200 characters on a free LinkedIn account, 300 on Premium. */
export const NOTE_LIMITS = [200, 300] as const;
export type NoteLimit = typeof NOTE_LIMITS[number];
export const NOTE_CAP_LINE = 'Free accounts get only a few personal notes a month. LinkedIn has not said how many.';
/** Days to wait after the last touch to one person before the next: 7, or 2 on WhatsApp. */
export const TOUCH_GAP_DAYS = 7;
export const WHATSAPP_GAP_DAYS = 2;

/** Characters as LinkedIn counts them: one per code point, so a Hindi letter and its sign are counted apart. */
export const characters = (text: string): number => [...text].length;

/** The sentences of a short text: split after a full stop, a question or exclamation mark, or the Devanagari danda. */
export const sentences = (text: string): string[] => text.trim().split(/(?<=[.!?।])\s+/u).filter(part => part.trim().length > 0);

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/giu;
const linksIn = (text: string): number => (text.match(LINK) ?? []).length;

/** The first service of the owner's list that a draft names (whole words, any case, marks folded), or null. */
export function excludedServiceIn(texts: readonly (string | null | undefined)[], excluded: readonly string[]): string | null {
  const body = ` ${fold(texts.filter(Boolean).join('\n'))} `;
  return excluded.find(service => fold(service) !== '' && body.includes(` ${fold(service)} `)) ?? null;
}

/** Refuses a draft that offers a service the owner said the business does not sell (C21, the profile of 4J9). */
export function refuseExcluded(texts: readonly (string | null | undefined)[], excluded: readonly string[]): void {
  const found = excludedServiceIn(texts, excluded);
  check(found === null, 'OUTREACH_EXCLUDED_SERVICE', `This offers ${found}, which you said you don't sell.`);
}

/** Every word and number of the facts a draft was written from, lower-cased: what the AI may copy as a figure. */
export function factTokens(facts: string): string[] {
  return [...new Set([...facts.matchAll(/[\p{L}\p{Nd}]+(?:[-./'’][\p{L}\p{Nd}]+)*/gu)].map(match => match[0].toLowerCase()))];
}

const SALESY_EN = ['guarantee', 'guaranteed', 'guarantees', 'limited time', 'act now', 'best price', 'lowest price', 'exclusive offer', 'special offer',
  "don't miss", 'do not miss', 'risk-free', 'risk free', 'once in a lifetime', 'buy now', 'hurry', 'amazing deal', 'huge discount', 'cheapest',
  'no obligation', 'game changer', 'game-changer', 'revolutionary'];
const SALESY_HI = ['गारंटी', 'सबसे सस्ता', 'सबसे सस्ती', 'जल्दी करें', 'अभी खरीदें', 'ऑफ़र', 'छूट'];
const HARD_ASKS: readonly RegExp[] = [
  /\b(?:book|schedule|set up|hop on|jump on) (?:a |an )?(?:quick )?(?:call|demo|meeting)\b[^.!?\n]{0,20}?\b(?:today|now|this week|asap|right away)\b/iu,
  /\b(?:call|reply|sign up|register|buy|order|pay)\b[^.!?\n]{0,12}?\b(?:now|today|asap|right away|immediately)\b/iu,
  /\bclick (?:here|the link|below)\b/iu,
  /अभी (?:कॉल|जवाब|खरीद)|तुरंत (?:कॉल|जवाब)/u,
];

const escaped = (word: string): string => word.replace(/[.*+?^$()|[\]\\{}]/g, match => `\\${match}`);
const SALESY_PATTERNS: readonly [string, RegExp][] = SALESY_EN.map(word => [word, new RegExp(`(?<![\\p{L}])${escaped(word)}(?![\\p{L}])`, 'u')]);

/** The salesy words of a text, in the order of the list. */
function salesyWords(text: string): string[] {
  const lower = text.toLowerCase();
  return [...SALESY_PATTERNS.filter(([, pattern]) => pattern.test(lower)).map(([word]) => word), ...SALESY_HI.filter(word => text.includes(word))];
}

const FIRST_PERSON = /(?:^|[^\p{L}'])(?:I|I'm|I've|I'd|I'll)(?![\p{L}'])|(?<![\p{L}])(?:[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)(?![\p{L}])|मैं|मेरा|मेरी|मेरे|मुझे/u;

/**
 * What is wrong with an intro request's forwardable blurb, or null: four or five sentences, in the third person, no
 * pitch and at most one link (Happenstance's house rules for a blurb the connector forwards).
 */
export function blurbProblem(blurb: string): string | null {
  const count = sentences(blurb).length;
  if (count < 4 || count > 5) return 'its blurb was not four or five sentences';
  if (linksIn(blurb) > 1) return 'its blurb had more than one link';
  if (FIRST_PERSON.test(blurb)) return 'its blurb was not written about you in the third person';
  if (salesyWords(blurb).length) return 'its blurb made a pitch';
  return null;
}

/** One piece of words the owner's AI wrote: what is wrong with it, or null. allowed: the tokens of the facts it was given. */
function wordsProblem(words: string, allowed: readonly string[]): string | null {
  if (!words) return null;
  if (holdsIdNumber(words)) return 'it held a card, bank account, Aadhaar or one-time code number';
  if (secretFindings(words).length) return 'it held something that looks like a key';
  try { assertNoMoney(words, 'draft', allowed); } catch { return 'it stated an amount of money'; }
  if (modelNumbers(words, allowed) || hindiNumberWords(words).length) return 'it had a figure your records do not hold';
  if (promptLeaks(words).length) return 'it had words meant for the AI, not for the person';
  if (houseStyleFindings(words).some(finding => finding.rule === 'banned-word')) return 'it used a word Chausar keeps out of drafts';
  return null;
}

const URL_IN = /\bhttps?:\/\/[^\s<>"']+/giu;
const HOST_IN = /(?<![\p{L}\p{N}.-])(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\p{L}\p{N}-])/giu;

/**
 * Whether words name a link or a site (a host, alone or in an address) that the facts do not hold, as a figure would
 * be: the AI may pass on a link the owner gave, never add its own.
 */
export function addsLink(words: string, facts: string): boolean {
  const known = facts.toLowerCase();
  const urls = [...words.matchAll(URL_IN)].map(match => match[0].replace(/[.,;:!?)\]]+$/u, '').toLowerCase());
  const hosts = [...words.matchAll(HOST_IN)].map(match => match[1].toLowerCase().replace(/^www\./, ''));
  return urls.some(url => !known.includes(url)) || hosts.some(host => !known.includes(host));
}

/**
 * What is wrong with a draft the owner's AI wrote, or null when it passes: each of its words (subject, text, blurb)
 * holds no id number, key, money or figure the facts do not hold, no link or site they do not hold, no words meant
 * for the AI and no banned word; a connection note keeps to its limit; an intro request's blurb keeps the blurb rules.
 */
export function aiDraftProblem(draft: { subject: string; text: string; blurb: string }, input: { kind: OutreachKind; facts: string; limit: number | null }): string | null {
  const allowed = factTokens(input.facts);
  for (const words of [draft.subject, draft.text, draft.blurb]) {
    const problem = wordsProblem(words, allowed);
    if (problem) return problem;
    if (addsLink(words, input.facts)) return 'it had a link or a site your records do not hold';
  }
  if (input.limit !== null && characters(draft.text) > input.limit) return 'it was longer than your limit';
  if (input.kind === 'intro-request') return blurbProblem(draft.blurb);
  return null;
}

export type DraftLint = {
  rule: 'salesy' | 'hard-cta' | 'first-touch-link' | 'note-near-limit' | 'note-cap' | 'touch-gap' | 'prompt-leak' | 'house-style'; line: string;
};

/**
 * The prompt-leak lint (W1 H20) and the house style on a draft's final words, whoever wrote them: Chausar's templates
 * carry the owner's own words, so a placeholder or a banned word can reach a draft that way too. Advisory: a warning.
 */
function finalWordsLints(words: readonly string[]): DraftLint[] {
  const lints: DraftLint[] = [];
  const leak = promptLeakLine(words.flatMap(item => promptLeaks(item)));
  if (leak) lints.push({ rule: 'prompt-leak', line: leak });
  const style = [...new Set(words.flatMap(item => houseStyleFindings(item)).map(finding => (finding.rule === 'em-dash' ? 'an em dash' : `"${finding.match}"`)))];
  if (style.length) lints.push({ rule: 'house-style', line: `House style: ${style.join(', ')}. Plain words read better.` });
  return lints;
}

/** How long ago a day was, in the words of a lint: today, yesterday, or on the day. */
function agoWords(on: IsoDate, today: IsoDate, order: DateOrder): string {
  const days = daysBetween(on, today);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `on ${shortDay(on, order)}`;
}

/**
 * The advisory lints of one draft (C11): warnings, never a refusal. firstTouch: the card has no send yet. lastTouch:
 * the newest send to this person on any of their cards, and their name. A reply is never too soon. also: the draft's
 * other final words (its subject and blurb), which the prompt-leak lint and the house style read with the text.
 */
export function draftLints(input: {
  kind: OutreachKind; channel: OutreachChannel; text: string; firstTouch: boolean; counter: { used: number; limit: number } | null;
  lastTouch: { on: IsoDate; name: string } | null; today: IsoDate; order: DateOrder; also?: readonly (string | null)[];
}): DraftLint[] {
  const lints: DraftLint[] = finalWordsLints([input.text, ...(input.also ?? []).filter((item): item is string => !!item)]);
  const salesy = salesyWords(input.text);
  if (salesy.length) lints.push({ rule: 'salesy', line: `Salesy words: ${salesy.join(', ')}. Plain words read better.` });
  const ask = HARD_ASKS.map(pattern => pattern.exec(input.text)?.[0]).find(Boolean);
  if (ask) lints.push({ rule: 'hard-cta', line: `A hard ask: "${ask}". Make it easy to say no.` });
  if (input.firstTouch && input.kind !== 'reply' && linksIn(input.text) > 0) {
    lints.push({ rule: 'first-touch-link', line: 'A link in a first note can look like spam. Send it once they write back.' });
  }
  if (input.counter) {
    if (input.counter.used * 10 >= input.counter.limit * 9) lints.push({ rule: 'note-near-limit', line: `${input.counter.used} of ${input.counter.limit} characters, close to your limit.` });
    lints.push({ rule: 'note-cap', line: NOTE_CAP_LINE });
  }
  if (input.lastTouch && input.kind !== 'reply') {
    const gap = input.channel === 'whatsapp' ? WHATSAPP_GAP_DAYS : TOUCH_GAP_DAYS;
    const until = addDays(input.lastTouch.on, gap);
    if (until > input.today) {
      lints.push({
        rule: 'touch-gap',
        line: `You last wrote to ${input.lastTouch.name} ${agoWords(input.lastTouch.on, input.today, input.order)}. ${input.channel === 'whatsapp' ? 'On WhatsApp, wait' : 'Wait'} until ${shortDay(until, input.order)}, or send anyway.`,
      });
    }
  }
  return lints;
}
