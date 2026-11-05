// Chausar venture launcher, core (one-shot B1, A3 notes line 51): the one line of a plan kept from About you. The card
// shows a name and up to three offers but no one line, so the kept plan used to keep the template's ("A creative studio
// where an agent drafts briefs and notes, and you do the craft."), which Today shows under the plan row. Code makes the
// line from the offers kept: their names in one sentence, within the 160 characters a one line may hold. Pure, with no
// imports, so the fake engine makes the same line.

/** The most a plan's one line may hold (blueprint.ts singleLine max for oneLiner). */
export const SHOWN_LINE_MAX = 160;

/** The names in one sentence, each as the owner kept it (B1 fix round 1: "Shopify store setup" stays capitalised). */
function sentence(names: readonly string[]): string {
  const body = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${body.replace(/[.\s]+$/, '')}.`;
}

/** One name too long for the line, cut at the last whole word that fits. */
function cutAtWord(name: string): string {
  const room = SHOWN_LINE_MAX - 1;
  if (name.length <= room) return sentence([name]);
  const space = name.lastIndexOf(' ', room);
  return sentence([name.slice(0, space > 0 ? space : room)]);
}

/**
 * "Birthday party photography, Shop product photos and Monthly photo support." Later offers go first if it is long.
 * No offers make no line (''), and the caller keeps the line it had.
 */
export function shownLine(names: readonly string[]): string {
  const clean = names.map(name => name.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (clean.length === 0) return '';
  for (let count = clean.length; count > 1; count--) {
    const line = sentence(clean.slice(0, count));
    if (line.length <= SHOWN_LINE_MAX) return line;
  }
  return cutAtWord(clean[0]!);
}
