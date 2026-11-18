// Chausar venture launcher, core: an offer rename the owner asks for in About you, read by code (seen in the real app
// on Windows, 15 Nov 2026). "Call the first offer Cafe mug sets, and I do not sell to hotels yet." was left to the AI,
// which added "Cafe mug sets" as a new offer, kept the first one as it was and took another out: the reply said "I
// added the offer Cafe mug sets". A rename names its offer by its place on the card (first, second, third, last) or by
// its exact name, so code can read it and apply it to that offer whatever the AI answers (core/about-before.ts
// cardOffersKept), and say "I renamed A to B" (core/about-reply.ts). Only what is safely read counts: any other wording
// is left to the AI, as before. The rest of the message still goes to the AI and is read for the other offers.
// This file imports nothing of the engine, so the app's fake engine and the first run read a rename the same way.

/** at: the offer's place among the offers still kept on the card. to: its new name, as the owner wrote it. */
export type OfferRename = { at: number; to: string };

const PLACES: Readonly<Record<string, number>> = Object.freeze({ first: 0, '1st': 0, top: 0, second: 1, '2nd': 1, third: 2, '3rd': 2, last: -1 });
const PLACE = `(${Object.keys(PLACES).join('|')})`;
const THING = '(?:offer|one|service|product|item)';
/**
 * Where a new name stops: a comma or another stop, the end, " and " or " but " when a request or a new sentence follows
 * ("and I", "and add"), so "Mugs and bowls" stays whole; " instead", " please".
 */
const NAME = String.raw`["'“‘]?([^"“”‘’.,;!?\n]+?)["'”’]?(?=\s*(?:[.,;!?\n]|$)|\s+(?:and|but)\s+(?:I|we|also|please|then|add|remove|drop|take|call|rename|name|change|make|keep|do|don't|the|my)\b|\s+instead\b|\s+please\b)`;
/** "Call the first offer X", "Rename my second one to X", "Change the name of the last offer to X". */
const BY_PLACE = new RegExp(String.raw`\b(?:(?:call|name|rename|title)\s+(?:the|my)\s+${PLACE}\s+${THING}\s+(?:as\s+|to\s+)?|change\s+the\s+name\s+of\s+(?:the|my)\s+${PLACE}\s+${THING}\s+to\s+)${NAME}`, 'iu');
/** A digit, a currency sign or a link is never in an offer's name (core/about.ts): such a rename is not read by code. */
const NOT_IN_A_NAME = /[\p{N}\p{Sc}]|:\/\/|[\u0000-\u001F\u007F]/u;
const NAME_MIN = 2;
const NAME_MAX = 60;

const fold = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

/** "Rename A to B", "Call the offer A as B", "Change A to B", where A is exactly a name on the card. */
function byName(names: readonly string[]): RegExp | null {
  const listed = names.filter(name => name.trim().length >= NAME_MIN).sort((a, b) => b.length - a.length).map(name => escaped(name.trim()));
  if (!listed.length) return null;
  return new RegExp(String.raw`\b(?:rename|change|call)\s+(?:(?:the|my)\s+offer\s+|the\s+name\s+of\s+)?["'“‘]?(${listed.join('|')})["'”’]?\s+(?:to|as|into)\s+${NAME}`, 'iu');
}

/**
 * The renames one message asks for, each read once, and the rest of the message without them. live: the offers still
 * kept on the card, in order. A rename counts only when its offer is there, the new name is plain words of an offer's
 * length, and no other offer on the card already has that name; else it is left in the rest, for the AI.
 */
export function renamesAsked(said: string, live: readonly { name: string }[]): { renames: OfferRename[]; rest: string } {
  const renames: OfferRename[] = [];
  let rest = said.replace(/\s+/g, ' ').trim();
  if (!rest || !live.length) return { renames, rest: said };
  const named = byName(live.map(offer => offer.name));
  let from = 0;
  for (let guard = 0; guard < live.length + 2; guard += 1) {
    const tail = rest.slice(from);
    const place = BY_PLACE.exec(tail);
    const exact = named ? named.exec(tail) : null;
    const found = place && (!exact || place.index <= exact.index) ? place : exact;
    if (!found) break;
    let at: number;
    if (found === place) {
      const word = (found[1] ?? found[2])!.toLowerCase();
      at = PLACES[word]! < 0 ? live.length - 1 : PLACES[word]!;
    } else at = live.findIndex(offer => fold(offer.name) === fold(found[1]!));
    const written = found.at(-1)!.replace(/\s+/g, ' ').trim();
    const to = written ? `${written[0]!.toUpperCase()}${written.slice(1)}` : '';
    const usable = at >= 0 && at < live.length && to.length >= NAME_MIN && to.length <= NAME_MAX && !NOT_IN_A_NAME.test(to)
      && !live.some(offer => fold(offer.name) === fold(to)) && !renames.some(rename => rename.at === at || fold(rename.to) === fold(to));
    const start = from + found.index, end = start + found[0].length;
    if (!usable) { from = end; continue; }
    renames.push({ at, to });
    rest = `${rest.slice(0, start)}${rest.slice(end)}`;
    from = start;
  }
  if (!renames.length) return { renames, rest: said };
  // What is left reads as a message of its own: no stop or joining comma left where the rename stood.
  return { renames, rest: rest.replace(/\s+([.,;!?])/g, '$1').replace(/^[\s.,;!?]+/, '').replace(/([.!?])[\s.,;!?]+/g, '$1 ').replace(/^(?:please|instead)\b[\s.,;!?]*/i, '').replace(/\s+/g, ' ').trim() };
}
