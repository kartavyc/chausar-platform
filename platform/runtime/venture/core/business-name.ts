// Chausar venture launcher, core: the business name your AI proposes in About you (founder, 14 Nov 2026). For work
// outside the listed fields the name used to be the built-in plan's label, so a potter's business was "Service
// business" everywhere. The AI read now proposes a short plain name from the owner's own words ("Koregaon Park
// Pottery"), and code keeps it only when it is short, plain and claims nothing. It is a suggestion in the Name box: the
// owner types over it, the owner's own name always wins, and with no AI the plan's label stays as before.
//
// Seen in the real app on Windows (15 Nov 2026): a potter's business was still "Service business" everywhere. The AI's
// answers are not stored, so which of two things happened cannot be told: it gave no name, or one the check refused.
// Either way nothing stood in for it, the Name box fell back to the plan's label, and the window then sent that label
// back as the plan's name with every follow-up, where the AI is told to return the name word for word. Now a read that
// found something to sell always has a name: the AI's when it passes, else the card's own, else a plain one code builds
// from the owner's own words (fallbackBusinessName). A plan's label is never a name (ownBusinessName).
// This file imports no engine store code, so the app's fake engine checks a name with the same keptBusinessName.
import { hardStopIn } from '../policy/hard-stop-words.ts';
import { securitiesAdviceIn } from '../policy/securities-guard.ts';
import { ownOfferFrom } from './own-offer.ts';

const NAME_MIN = 2;
const NAME_MAX = 40;
const WORDS_MAX = 5;
/** A link or a web address, a digit, a currency sign or a control character: a name is words. */
const NOT_IN_A_NAME = /[\p{N}\p{Sc}\u0000-\u001F\u007F]|:\/\/|www\.|\.[a-z]{2,}(?:\/|$|\s)/iu;
/** A claim about quality, rank, results or standing: Chausar never puts one in the owner's mouth. */
const CLAIM = /\b(?:best|top|leading|finest|cheapest|number\s+one|no\.?\s*one|guarante\w*|assured|promis\w*|certified|licen[cs]ed|registered|accredited|official|approved|authori[sz]ed|award\w*|trusted|expert\w*|premium|world\s*class|government|govt)\b/i;
/** A legal form: nobody registered this business as one. */
const LEGAL_FORM = /\b(?:pvt|private\s+limited|ltd|limited|llp|llc|inc|incorporated|corp|corporation|plc|bank)\b\.?/i;

/**
 * The proposed name as it is kept, or null: two to forty characters in at most five words, on one line, with no link,
 * digit or amount, no claim, no legal form and no hard-stop phrase. Spaces are tidied. Anything else keeps no name and
 * the read stands without one.
 */
export function keptBusinessName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\r\n\t]/.test(value.trim())) return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX || name.split(' ').length > WORDS_MAX) return null;
  if (NOT_IN_A_NAME.test(name) || CLAIM.test(name) || LEGAL_FORM.test(name)) return null;
  if (hardStopIn(name) || securitiesAdviceIn(name)) return null;
  return name;
}

const folded = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A name as the plan may hold it, or null: one that passes keptBusinessName and is not a plan's own label (labels: the
 * built-in plans' labels, "Service business", "Creative studio"). A label is what a screen shows when nobody named the
 * business; sent back as the card's name it is still no name.
 */
export function ownBusinessName(value: unknown, labels: readonly string[]): string | null {
  const name = keptBusinessName(value);
  return name && !isPlanLabel(name, labels) ? name : null;
}

/** Whether a name is only a plan's own label, whatever its case and spacing. */
export function isPlanLabel(name: string, labels: readonly string[]): boolean {
  return labels.some(label => folded(label) === folded(name));
}

/**
 * A plain name built by code from the owner's own words, for when the AI gave none that passes: the work they named
 * ("I make pottery by hand" gives "Pottery", core/own-offer.ts), else the first offer whose name passes the name check.
 * Never a label and never invented; null when there is nothing to name it from, and the owner types it.
 */
export function fallbackBusinessName(said: string, offers: readonly { name: string }[]): string | null {
  for (const words of [ownOfferFrom(said)?.name, ...offers.map(offer => offer.name)]) {
    const name = keptBusinessName(words);
    if (name) return name;
  }
  return null;
}
