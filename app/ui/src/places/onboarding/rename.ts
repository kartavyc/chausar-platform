/**
 * One-shot A3 (S1): a rename the owner asks for in the About you chat, read by code. The AI read names a field and its
 * offers, never a business, so "Please call the business Pune Frames Studio." used to go to the AI again and the card
 * kept the field's name. Only a request to call, name or rename the business, with a name of 2 to 60 characters that
 * starts with a capital letter, a digit or a quote, counts; anything else goes to the AI as before.
 */

const ASK = /^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:call|name)\s+(?:it|this|the business|my business|this business|the studio|my studio|the shop|my shop)\s+(?:as\s+)?|rename\s+(?:it|this|the business|my business|this business)\s+(?:to\s+|as\s+)?|change\s+(?:the|its|my business(?:'s)?)\s+name\s+to\s+)(.+?)\s*$/iu;
const QUOTED = /^["'“‘](.+?)["'”’]$/u;
const NAME_MIN = 2;
const NAME_MAX = 60;

/** The name a chat message asks for, or null when it asks for no rename. */
export function renameIn(message: string): string | null {
  const asked = ASK.exec(message.replace(/\s+/g, ' ').trim());
  if (!asked) return null;
  let name = asked[1]!.replace(/[.!?]+$/u, '').trim();
  const quoted = QUOTED.exec(name);
  if (quoted) name = quoted[1]!.trim();
  else if (!/^[\p{Lu}\p{Nd}]/u.test(name)) return null;
  if (name.length < NAME_MIN || name.length > NAME_MAX || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  return name;
}
