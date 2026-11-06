// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1, catalogue A3): code, not a model, spots a standing
// request in the owner's words. "From now on", "always", "never" and "I prefer" (and their Hindi twins) are standing:
// the agent drafts a change to its instructions. "Remember that", "keep in mind" and "my ... is" (and their Hindi
// twins) are notes, which 4B2 turns into note proposals. A question is neither, even when it says "always". The Hindi
// and Hinglish patterns are a fixed list here, each with an English twin in venture-agent-standing.test.ts.

/** 'standing': a change to how the agent works; 'note': something to remember (4B2); null: neither. */
export type StandingClass = 'standing' | 'note';

/**
 * Phrases that always mean "from now on", in English, Hindi and Hinglish (अब से, ab se: from now on; आगे से, aage se:
 * going forward).
 */
const STRONG_STANDING: readonly RegExp[] = Object.freeze([
  /\bfrom now on\b/i, /\bgoing forward\b/i, /\bfrom here on\b/i, /\bin (?:the )?future\b/i, /\bnext time\b/i,
  /अब से/u, /आगे से/u, /\bab se\b/i, /\baage se\b/i,
]);
/** Words that make a standing request outside a question (हमेशा, hamesha: always; कभी नहीं, kabhi nahi: never). */
const WEAK_STANDING: readonly RegExp[] = Object.freeze([
  /\balways\b/i, /\bnever\b/i, /\bi(?:'d| would)? prefer\b/i, /\b(?:don't|do not) ever\b/i,
  /हमेशा/u, /कभी\s+(?:भी\s+)?नहीं/u, /\bhamesha\b/i, /\bkabhi\s+(?:bhi\s+)?nahi?n?\b/i,
]);
/**
 * Words that ask the agent to remember a fact (याद रखना, yaad rakhna: remember; ध्यान रखना, dhyan rakhna: keep in
 * mind; मेरा, मेरी, मेरे: my).
 */
const NOTE: readonly RegExp[] = Object.freeze([
  /\bremember\b/i, /\bkeep in mind\b/i, /\bnote that\b/i, /^\s*my\s+(?:[\p{L}\p{Nd}'-]+\s+){0,3}(?:is|are|was|has|have|changed)\b/iu,
  /याद\s+(?:रखना|रखें|रखिए|रखो)/u, /ध्यान\s+(?:रखना|रखें|रखिए|रखो)/u, /^\s*(?:मेरा|मेरी|मेरे)\s/u,
  /\byaad\s+(?:rakhna|rakho|rakhein|rakhen|rakhiye|rakhiyega)\b/i, /\bdhyan\s+(?:rakhna|rakho|rakhein|rakhen|rakhiye)\b/i,
]);
/** A question word at the start: why, what, how ... (क्या, क्यों, कब, कैसे, कौन, कहाँ; kya, kyun, kab, kaise, kaun, kahan). */
const QUESTION_WORD = /^\s*(?:(?:why|what|when|where|who|whom|whose|which|how|kya|kyun|kyon|kab|kaise|kaun|kahan)\b|(?:क्या|क्यों|कब|कैसे|कौन|कहाँ|कहां)(?=\s|[?？]|$))/iu;
/** A helping verb at the start (do, is, have ...): a question only with a question mark ("Do always add captions." asks for work). */
const HELPING_VERB = /^\s*(?:did|does|do|is|are|was|were|has|have|had)\b/i;
/** A polite request phrased as a question ("Can you always add captions?") still asks for work. */
const POLITE = /^\s*(?:can|could|would|will) you\b|\bplease\b/i;
const ENDS_ASKING = /[?？]\s*$/u;

/**
 * True when the words only ask something: a question word at the start, a helping verb at the start of words that
 * end with a question mark, or a question mark at the end of words that are not a polite request.
 */
export function onlyAsks(text: string): boolean {
  if (QUESTION_WORD.test(text)) return true;
  if (!ENDS_ASKING.test(text)) return false;
  return HELPING_VERB.test(text) || !POLITE.test(text);
}

/**
 * The class of the owner's words, by code: a standing request, a note, or neither (null). "From now on" (and its Hindi
 * twins) is always standing; else "remember" and "my ... is" make a note; else "always", "never" and "I prefer" make a
 * standing request, unless the words only ask a question.
 */
export function detectStanding(text: string): StandingClass | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (STRONG_STANDING.some(pattern => pattern.test(text))) return 'standing';
  if (onlyAsks(text)) return null;
  if (NOTE.some(pattern => pattern.test(text))) return 'note';
  if (WEAK_STANDING.some(pattern => pattern.test(text))) return 'standing';
  return null;
}

/** Leading words that only say "from now on": the instruction is what follows them. */
const LEAD = /^\s*(?:from now on|going forward|from here on|in (?:the )?future|next time|अब से|आगे से|ab se|aage se)\s*[,:;]?\s*/iu;

/**
 * The owner's sentence as a standing order in their own words, tidied: the leading "from now on" dropped, spaces
 * collapsed, the first letter capitalised and a full stop added after English words. No word is added or changed.
 */
export function standingValue(text: string): string {
  const rest = text.replace(/\s+/g, ' ').trim().replace(LEAD, '').trim();
  if (!rest) return '';
  const first = rest.charAt(0).toUpperCase() + rest.slice(1);
  return /[\p{Script=Latin}\p{Nd}]$/u.test(first) ? `${first}.` : first;
}
