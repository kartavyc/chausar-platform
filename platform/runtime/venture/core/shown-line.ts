// Chausar venture launcher, core (one-shot B1, A3 notes line 51): the one line of a plan kept from About you. The card
// shows a name and up to three offers but no one line, so the kept plan used to keep the template's ("A creative studio
// where an agent drafts briefs and notes, and you do the craft."), which Today shows under the plan row. Code makes the
// line from the offers kept: their names in one sentence, within the 160 characters a one line may hold. Pure, with no
// imports, so the fake engine makes the same line.

/** The most a plan's one line may hold (blueprint.ts singleLine max for oneLiner). */
export const SHOWN_LINE_MAX = 160;

/** A later name starts lower case, unless its first word is an acronym ("GST returns"). */
function midSentence(name: string): string {
  const first = name.split(/\s+/)[0] ?? '';
  return first.length > 1 && first === first.toUpperCase() ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

function sentence(names: readonly string[]): string {
  const parts = names.map((name, index) => (index === 0 ? name : midSentence(name)));
  const body = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${body.replace(/[.\s]+$/, '')}.`;
}

/** "Birthday party photography, shop product photos and monthly photo support." Later offers go first if it is long. */
export function shownLine(names: readonly string[]): string {
  const clean = names.map(name => name.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (let count = clean.length; count > 1; count--) {
    const line = sentence(clean.slice(0, count));
    if (line.length <= SHOWN_LINE_MAX) return line;
  }
  return sentence(clean.slice(0, 1)).slice(0, SHOWN_LINE_MAX);
}
