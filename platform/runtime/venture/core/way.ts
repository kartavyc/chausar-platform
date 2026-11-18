// Chausar venture launcher, core: the way to earn. About you used to end in up to three offers: what to sell, never how
// the owner earns from it. The owner's AI now also proposes the way, in five plain parts: who pays, how they are found
// and reached, what Chausar's team does, what only the owner does, and the first week in order. Code keeps a way only
// when it is whole, plain and names no price or link (prices are the owner's); a way that fails is dropped and the rest
// of the read stands. The kept way lives on the owner profile (core/owner.ts) and Chats plan from it.
//
// One rule comes with it (founder, 14 Nov 2026): customers are not looked for or written to until what is sold is
// ready, and then only with the owner's approval. offerReadiness (core/way-ready.ts) says, from the records, whether it
// is ready and what is still missing. For someone who makes a thing (a potter, a tiffin maker) that is the product and its price; for a
// service it is the offers as the owner wants them, each with the owner's price.
// This file imports no engine store code, so the app's fake engine checks a way with the same keptWay.
import type { Json } from '../../portable.ts';
import { securitiesAdviceIn } from '../policy/securities-guard.ts';

/** The four parts that are one line each; firstWeek is the fifth, a short list in order. */
export const WAY_FIELDS = Object.freeze(['customer', 'reach', 'teamDoes', 'youDo'] as const);
export type WayToEarn = { customer: string; reach: string; teamDoes: string; youDo: string; firstWeek: string[] };

const LINE_MAX = 400;
const STEP_MAX = 200;
const STEPS_MAX = 5;
/** A currency sign, a link or a control character: a way names no price (the owner sets every price) and sends nobody anywhere. */
const NOT_IN_A_WAY = /\p{Sc}|:\/\/|www\.|[\u0000-\u001F\u007F]/u;
/** Money written in words beside a number ("500 rupees", "Rs 500", "INR 500"): still a price. */
const PRICE_WORDS = /(?:\b(?:rs\.?|inr|usd|rupees?|dollars?)\s*\p{Nd})|(?:\p{Nd}\s*(?:rs\.?|inr|usd|rupees?|dollars?)\b)/iu;

/**
 * What the team can really do today, in the words the AI is given, so a way never promises what Chausar cannot run.
 * No digits: these are fixed words, not figures.
 */
export const WAY_CAPABILITIES: readonly string[] = Object.freeze([
  'Draft every message, quote, proposal and document for the owner to approve. The owner sends each one themselves.',
  'Find possible customers from public sources and from the contacts the owner brings in, as a list the owner checks first, once the owner turns that on.',
  'Keep the list of leads, follow ups, orders, invoices and payments, and remind the owner what is due.',
  'Draft the work for each order from the text the owner adds to it, for the owner to check. Audio, video and images need a tool the owner sets up first.',
  'Use a service the owner connects, such as email, a design tool or a lead tool, each only after the owner approves.',
]);

const line = { type: 'string' };
/**
 * The way as the AI writes it. Always an object (the model schema rule allows no null object): every part empty is how
 * the AI says it has too little to go on yet.
 */
export const WAY_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: [...WAY_FIELDS, 'firstWeek'],
  properties: { customer: line, reach: line, teamDoes: line, youDo: line, firstWeek: { type: 'array', items: line } },
} as unknown as Json;

/**
 * One line as a way keeps it, or null: plain words within max characters, with no price, no link and no investment
 * advice. The chief's own moves and its line for the day (chief/review.ts) are held to the same rule.
 */
export const plainLine = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const words = value.replace(/\s+/g, ' ').trim();
  if (!words || words.length > max || NOT_IN_A_WAY.test(words) || PRICE_WORDS.test(words) || securitiesAdviceIn(words)) return null;
  return words;
};

/** Words that only say a part is not known yet: a placeholder where a plan should be. */
const NOT_KNOWN = /\bnot\s+(?:yet\s+)?known\b|\bnot\s+known\s+yet\b|\bnot\s+yet\s+(?:decided|clear)\b|\bto\s+be\s+(?:decided|confirmed|determined)\b|\btbd\b/i;
/**
 * A way holds statements (seen live, 15 Nov 2026: "Not yet known; where will you find and reach founders?" was kept as
 * how the owner reaches customers, and stayed there beside the facts the owner then gave). Each sentence that is a
 * question, or only says something is not known yet, is taken out; what is left is the line, and nothing left is no
 * line. The question belongs in the AI's reply, where the owner can answer it.
 */
export function statedOnly(words: string): string {
  return words.split(/(?<=[.!?;])\s+/).filter(part => !part.trimEnd().endsWith('?') && !NOT_KNOWN.test(part)).join(' ').trim();
}

/**
 * A way as it is kept, or null: all four lines and one to five steps, each plain words with no price and no link, and
 * statements only (statedOnly). Anything else (a missing part, an extra one, an empty way, a line or a week that was
 * only questions) keeps nothing; the caller's read stands without a way.
 */
export function keptWay(value: unknown): WayToEarn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== WAY_FIELDS.length + 1 || ![...WAY_FIELDS, 'firstWeek'].every(key => Object.hasOwn(raw, key))) return null;
  const [customer, reach, teamDoes, youDo] = WAY_FIELDS.map(key => { const kept = plainLine(raw[key], LINE_MAX); return kept && statedOnly(kept); });
  if (!customer || !reach || !teamDoes || !youDo) return null;
  if (!Array.isArray(raw.firstWeek) || raw.firstWeek.length < 1 || raw.firstWeek.length > STEPS_MAX) return null;
  const steps = raw.firstWeek.map(step => plainLine(step, STEP_MAX));
  if (steps.some(step => step === null)) return null;
  // A step that is only a question is no step; a week of nothing else is no week.
  const firstWeek = (steps as string[]).map(statedOnly).filter(Boolean);
  if (!firstWeek.length) return null;
  return { customer, reach, teamDoes, youDo, firstWeek };
}
