/**
 * One-shot A3 (S1): a rename the owner asks for in the About you chat, read by code. The AI read names a field and its
 * offers, never a business, so "Please call the business Pune Frames Studio." used to go to the AI again and the card
 * kept the field's name. Only a request to call, name or rename the business counts. A3 reviews (L2, L-d): the name
 * stops where the request goes on (see STOP), and is refused when it is longer than five words, does not start with
 * a capital letter, a digit or a quote, or starts with a pronoun or "I". What the message says after the name (rest)
 * still goes to the AI as usual, so "Call it Pune Frames, and add wedding shoots too" renames and asks for the shoots.
 */

const ASK = /^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:call|name)\s+(?:it|this|the business|my business|this business|the studio|my studio|the shop|my shop)\s+(?:as\s+)?|rename\s+(?:it|this|the business|my business|this business)\s+(?:to\s+|as\s+)?|change\s+(?:the|its|my business(?:'s)?)\s+name\s+to\s+)(.+?)\s*$/iu;
const QUOTED = /^["'“‘](.+?)["'”’](.*)$/u;
/**
 * Where a name stops: a comma or other stop; a full stop before a space or the end, except after Mr, Mrs, Ms, Dr, St
 * or a single capital (an initial); " and " or " but " only when a request follows ("and add", "but keep"), so
 * "Bread and Butter Bakery" stays whole; " instead".
 */
const STOP = /\s*(?:[,;!?]|(?<!\b(?:Mr|Mrs|Ms|Dr|St|\p{Lu}))\.(?=\s|$)|\s+(?:and|but)\s+(?=(?:add|keep|make|change|include|also|remove)\b)|\s+instead\b)/iu;
/** Words that start a sentence, never a business name. */
const NOT_A_NAME = /^(?:i|i'm|i'd|i'll|me|my|we|we're|you|your|he|she|they|it|it's|this|that|something|anything|whatever)\b/iu;
const NAME_MIN = 2;
const NAME_MAX = 60;
const WORDS_MAX = 5;

/** What one chat message asks: the new name, and the rest of the message for the AI (empty when there is none). */
export type Rename = { name: string; rest: string };

/** The rename a chat message asks for, or null when it asks for none. */
export function renameIn(message: string): Rename | null {
  const asked = ASK.exec(message.replace(/\s+/g, ' ').trim());
  if (!asked) return null;
  const tail = asked[1]!.trim();
  let name: string, rest: string;
  const quoted = QUOTED.exec(tail);
  if (quoted) {
    name = quoted[1]!.trim();
    rest = quoted[2]!;
  } else {
    const stop = STOP.exec(tail);
    name = (stop ? tail.slice(0, stop.index) : tail).trim();
    rest = stop ? tail.slice(stop.index) : '';
    if (!/^[\p{Lu}\p{Nd}]/u.test(name) || NOT_A_NAME.test(name)) return null;
  }
  if (name.length < NAME_MIN || name.length > NAME_MAX || name.split(/\s+/).length > WORDS_MAX || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  rest = rest.replace(/^[\s,;.!?]*(?:(?:and|but)\s+)?(?:instead\b)?[\s,;.!?]*/iu, '').trim();
  return { name, rest };
}
