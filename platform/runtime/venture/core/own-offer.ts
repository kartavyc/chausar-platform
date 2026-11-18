// Chausar venture launcher, core: work outside the listed fields when no AI is connected (seen in the real app, 15 Nov
// 2026). The keyword reader knows only the listed fields, so a potter who continued without an AI was told Chausar
// could not tell the field, and the closest field gave a template plan selling video edits. Now words that are clear
// enough to keep and match no field are the plan's idea as the owner wrote them, with no field, and the owner names
// what they sell on the card. Code never invents an offer: at most one row is taken, word for word, from the owner's
// own sentence where that is safe ("I make pottery by hand" gives "Pottery"); anywhere else the list starts empty.
// The way to earn and the team stay the AI's: there is none without one.
// This file imports no engine store code, so the app's fake engine answers from the same functions.
import { hardStopIn } from '../policy/hard-stop-words.ts';
import { securitiesAdviceIn } from '../policy/securities-guard.ts';
import type { FamilyOffer } from './first-run-types.ts';

/** venture.preview and venture.create take ideas of 10 to 2000 characters. */
const IDEA_MIN = 10;
const IDEA_MAX = 2000;
/** Clear enough to keep: at least this many words of two letters or more. One word, or loose letters, is not work. */
const WORDS_MIN = 2;

/** The owner's own words as the idea a plan starts from, tidied and never rewritten; null when there is too little to keep. */
export function ownIdea(text: string): string | null {
  const words = text.replace(/\s+/g, ' ').trim();
  if (words.length < IDEA_MIN) return null;
  if ((words.match(/\p{L}{2,}/gu) ?? []).length < WORDS_MIN) return null;
  return words.slice(0, IDEA_MAX).trim();
}

/** Verbs of making and selling a thing: what follows one is the thing. Nothing wider: "I do", "I run", "I want" say no such thing. */
const MAKES = 'make|sell|bake|repair|fix|grow|stitch|sew|cook|craft|weave|build|paint|print';
const SENTENCE = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])(?:I|we)\s+(?:also\s+|mostly\s+|mainly\s+)?(?:${MAKES})\s+([^,.;:!?()\n]+)`, 'iu');
/** Where the thing ends and the rest of the sentence begins. */
const ENDS = new Set([
  'and', 'or', 'for', 'to', 'in', 'at', 'from', 'with', 'by', 'on', 'that', 'which', 'who', 'when', 'because', 'so', 'but', 'mostly', 'mainly', 'as', 'near', 'around', 'online', 'every', 'since',
  'what', 'whatever', 'how', 'where', 'if', 'than', 'like', 'such', 'about', 'over', 'under', 'between', 'through', 'via', 'per',
]);
/**
 * A first word that names no thing: an article, a pronoun, a negation, an idiom ("make sure", "make a living"), a vague
 * word or an adverb ("sell well", and any word ending in "ly": "sell directly").
 */
const NOT_A_THING = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'it', 'this', 'that', 'these', 'those', 'them', 'things', 'thing', 'stuff', 'something', 'anything', 'everything', 'nothing',
  'not', 'no', 'sure', 'money', 'sense', 'do', 'up', 'out', 'all', 'many', 'some', 'most', 'lots', 'different', 'various', 'people', 'time', 'ends', 'use', 'good', 'more',
  'well', 'only', 'also', 'both', 'just', 'here', 'there', 'everywhere', 'now', 'too', 'very', 'always', 'often', 'sometimes', 'offline',
]);
const notAThing = (word: string) => NOT_A_THING.has(word) || word.endsWith('ly');
/** A longer run of words is a sentence, not a name: no row is taken from it, and it is never cut short. */
const NAME_WORDS_MAX = 4;
const NAME_MAX = 60;
/** A word of an offer name: letters, with a hyphen or an apostrophe inside. A digit or a currency sign is never one. */
const WORD = /^\p{L}+(?:[-'’]\p{L}+)*$/u;

/**
 * One offer taken from the owner's own words, or null. Only from a sentence that says what they make or sell ("I make
 * pottery by hand", "We sell handmade soaps"): the few words right after the verb, as written, with a capital.
 * Null whenever that is not plainly a thing (an idiom, a vague word, an amount) or the sentence trips a hard stop: the
 * owner then types the offer themselves. The line is always empty; code writes no description.
 */
export function ownOfferFrom(text: string): FamilyOffer | null {
  if (securitiesAdviceIn(text) || hardStopIn(text)) return null;
  const found = SENTENCE.exec(text.replace(/\s+/g, ' '));
  if (!found) return null;
  const words: string[] = [];
  for (const word of found[1]!.trim().split(' ')) {
    if (ENDS.has(word.toLowerCase())) break;
    if (!WORD.test(word) || words.length >= NAME_WORDS_MAX) return null;
    words.push(word);
  }
  if (!words.length || notAThing(words[0]!.toLowerCase())) return null;
  const name = words.join(' ');
  if (name.length < 2 || name.length > NAME_MAX) return null;
  return { name: `${name[0]!.toUpperCase()}${name.slice(1)}`, line: '' };
}

/** Verbs that say the owner can do, make or sell one more thing: what follows one, after "also", is that thing. */
const ALSO = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])(?:I|we)\s+(?:can\s+)?also\s+(?:can\s+)?(?:know|speak|do|offer|teach|write|translate|design|edit|${MAKES})\s+([^,.;:!?()\n]+)`, 'iu');

/**
 * A skill, language or product the owner adds in a follow-up ("I also know Marathi", "We also make planters"), in
 * their own words, or null. The same care as ownOfferFrom: only the few words right after the verb, and null whenever
 * that is not plainly a thing (an idiom, a clause, an amount, a hard stop). About you asks whether to offer it when the
 * AI's answer neither offered it nor asked (core/about-reply.ts): a new skill is never only filed away.
 */
export function alsoOffered(text: string): string | null {
  if (securitiesAdviceIn(text) || hardStopIn(text)) return null;
  const found = ALSO.exec(text.replace(/\s+/g, ' '));
  if (!found) return null;
  const words: string[] = [];
  for (const word of found[1]!.trim().split(' ')) {
    if (ENDS.has(word.toLowerCase())) break;
    if (!WORD.test(word) || words.length >= NAME_WORDS_MAX) return null;
    words.push(word);
  }
  if (!words.length || notAThing(words[0]!.toLowerCase())) return null;
  return words.join(' ');
}
