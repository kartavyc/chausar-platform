// Chausar venture launcher, core: one voice for words the AI writes about the owner (founder, 14 Nov 2026). Every
// screen speaks to the owner as "you". An agent's job and duties, and the way to earn, were written by the AI in the
// owner's own voice ("Drafts sales materials for my approval", "contacts I provide"), which reads oddly on Team and on
// the plan. The AI is now asked to say "you" (core/about.ts), and this turns whatever still comes out as "I", "me" or
// "my". Words the owner types themselves are never turned: they stay as typed, and the hire check
// (agents/hire-check-core.ts) reads the owner as "me" or "you" alike. An owner who works with a helper says "we": that
// is turned too, so one sentence never speaks in two voices.
// Pure and safe to run twice: words already in the "you" voice come back unchanged. The fake engine uses it too.

/** The owner's first person, most specific first: a verb that changes with the person, then the plain words. */
const TURNS: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/\bI am\b/g, 'you are'], [/\bI'm\b/g, "you're"], [/\bI was\b/g, 'you were'], [/\bI've\b/g, "you've"], [/\bI'll\b/g, "you'll"], [/\bI'd\b/g, "you'd"],
  [/\bmyself\b/gi, 'yourself'], [/\bmy\b/gi, 'your'], [/\bme\b/gi, 'you'], [/\bI\b/g, 'you'],
] as const);
/**
 * The owner's "we" (seen on Windows, 15 Nov 2026: "It is just you and one helper, we can do about six visits a day":
 * an owner with a helper says "we", and half the sentence was turned). "We are" and "we were" need no rule of their
 * own: "you are" and "you were" are the same verbs.
 */
const PLURAL: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/\bourselves\b/gi, 'yourselves'], [/\bours\b/gi, 'yours'], [/\bour\b/gi, 'your'], [/\bus\b/gi, 'you'], [/\bwe\b/gi, 'you'],
] as const);

/** Whether a word at this place starts a sentence: the start of the words, or after a full stop, a question or a colon. */
const startsSentence = (text: string, at: number) => /(?:^|[.!?:]\s+)$/.test(text.slice(0, at));

/**
 * The words with the owner's "I", "me", "my" and "myself", and "we", "us", "our" and "ours", said to the owner: "you",
 * "your", "yourself". team: the words are what the AI team does, where a "we" is the team speaking of itself, not the
 * owner; there only the singular is turned.
 */
export function ownerVoice(words: string, options: { team?: boolean } = {}): string {
  let out = words;
  for (const [pattern, to] of options.team ? TURNS : [...TURNS, ...PLURAL]) {
    out = out.replace(pattern, (found: string, at: number, whole: string) => {
      const capital = found !== 'I' && !found.startsWith('I ') && !found.startsWith("I'") ? /^\p{Lu}/u.test(found) : startsSentence(whole, at);
      return capital ? `${to[0]!.toUpperCase()}${to.slice(1)}` : to;
    });
  }
  return out;
}
