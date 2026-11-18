// Chausar venture launcher, core: the reply the owner reads after a follow-up in About you (seen in the real app on
// Windows, 15 Nov 2026). The AI wrote the whole reply, and it said "I removed installation work from the plan" when
// installation was never in the plan (all that changed was one sentence added to what the owner does), asked the same
// unanswered question three times running, renamed an offer into a second subtitles offer without a word, and filed "I
// also know Marathi" under "You do" while saying the plan was ready.
//
// Code knows what changed: it has the card before and the answer after. So in a follow-up the reply is built here:
//   - what changed, said by code from the real difference (planChanges), never taken from the AI's word;
//   - then the AI's own next question (nextQuestion), which is all the AI is asked to write;
//   - a question already asked twice running is not asked a third time (askedTwice): the plan looks ready to keep;
//   - a rename that leaves two offers sounding like one is asked about, and so is a skill the owner added that the
//     answer neither offered nor asked about.
// A first reply (no card yet) stays the AI's own words: there is nothing to compare it with.
// This file imports no engine store code, so the app's fake engine builds a follow-up reply the same way.
import { sameThing, type AboutBefore, type AboutPlan, type AboutTurn } from './about-before.ts';
import { renamesAsked } from './offer-rename.ts';
import { DEFAULT_OFFER_UNIT, UNIT_WORDS, type OfferUnit } from './offer-units.ts';
import { alsoOffered } from './own-offer.ts';
import { WAY_FIELDS, type WayToEarn } from './way.ts';

/** The plan as the answer left it: what the card will show next. */
export type ReplyPlan = {
  offers: readonly { name: string; line: string; unit?: OfferUnit }[];
  way: WayToEarn | null;
  team: readonly { name: string; job: string; duties: readonly string[] }[];
};

export const READY_LINE = 'The plan looks ready to keep.';
const NOTHING_LINE = 'I did not change the plan.';
/** The parts of the way as the card names them. */
const PART_WORDS: Readonly<Record<typeof WAY_FIELDS[number] | 'firstWeek', string>> = Object.freeze({
  customer: 'who pays', reach: 'how you reach them', teamDoes: 'what your team does', youDo: 'what you do', firstWeek: 'the first week',
});
/** A sentence quoted back to the owner is short; a longer change is named, not quoted. */
const QUOTED_MAX = 160;

const fold = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const sentences = (text: string) => text.split(/(?<=[.!?;])\s+/).map(part => part.trim()).filter(Boolean);
const listed = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const ended = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** The sentences a part gained when nothing else in it changed: every old sentence is still there, in order. Else null. */
function gained(was: string, now: string): string[] | null {
  const old = sentences(was).map(fold);
  const fresh = sentences(now);
  const added = fresh.filter(part => !old.includes(fold(part)));
  if (!added.length || fresh.length - added.length !== old.length || !old.every(part => fresh.some(other => fold(other) === part))) return null;
  return added.join(' ').length <= QUOTED_MAX ? added : null;
}

/**
 * What changed between the card before and the answer after, as short sentences in the card's own words; one sentence
 * that says nothing changed when nothing did. Offers first (renamed, added, taken out, a line, a unit), then the way
 * (a part that only gained a sentence is quoted; one rewritten is named), then the team.
 * said: the owner's message. A rename it asks for in words code reads (core/offer-rename.ts) is said as that rename
 * wherever the renamed offer now stands, never as one offer added and another taken out.
 */
export function planChanges(before: AboutPlan, after: ReplyPlan, said = ''): string[] {
  const out: string[] = [];
  const live = before.offers.filter(offer => offer.kept);
  const named = (name: string) => after.offers.findIndex(offer => fold(offer.name) === fold(name));
  const taken = new Set<number>();
  const lines: string[] = [], units: string[] = [], removed: string[] = [];
  const renamed = new Set<number>();
  for (const rename of said ? renamesAsked(said, live).renames : []) {
    const at = named(rename.to);
    if (at < 0 || named(live[rename.at]!.name) >= 0) continue;
    taken.add(at);
    renamed.add(rename.at);
    out.push(`I renamed ${live[rename.at]!.name} to ${after.offers[at]!.name}.`);
  }
  live.forEach((was, index) => {
    if (renamed.has(index)) return;
    const at = named(was.name);
    if (at >= 0) {
      taken.add(at);
      const now = after.offers[at]!;
      if (fold(now.line) !== fold(was.line)) lines.push(was.name);
      if ((now.unit ?? DEFAULT_OFFER_UNIT) !== was.unit) units.push(`${was.name} is now charged ${UNIT_WORDS[now.unit ?? DEFAULT_OFFER_UNIT]}.`);
      return;
    }
    const there = after.offers[index];
    if (there && !live.some(offer => fold(offer.name) === fold(there.name)) && !taken.has(index)) { taken.add(index); out.push(`I renamed ${was.name} to ${there.name}.`); }
    else removed.push(was.name);
  });
  // An offer gone from its place and a new one elsewhere that names the same thing is one offer renamed and moved
  // ("Video subtitles" out, "Subtitles for creators" in first place), not one taken out and another added.
  for (const name of [...removed]) {
    const at = after.offers.findIndex((offer, index) => !taken.has(index) && sameThing(offer.name, name));
    if (at < 0) continue;
    taken.add(at);
    removed.splice(removed.indexOf(name), 1);
    out.push(`I renamed ${name} to ${after.offers[at]!.name}.`);
  }
  after.offers.forEach((offer, index) => { if (!taken.has(index)) out.push(`I added the offer ${offer.name}.`); });
  for (const name of removed) out.push(`I took out ${name}.`);
  if (lines.length) out.push(`I changed the line${lines.length > 1 ? 's' : ''} under ${listed(lines)}.`);
  out.push(...units);

  if (after.way && !before.way) out.push('I wrote how you earn.');
  else if (after.way && before.way) {
    const rewritten: string[] = [];
    for (const part of WAY_FIELDS) {
      if (fold(after.way[part]) === fold(before.way[part])) continue;
      const added = gained(before.way[part], after.way[part]);
      if (added) out.push(`I added to ${PART_WORDS[part]}: ${ended(added.join(' '))}`);
      else rewritten.push(PART_WORDS[part]);
    }
    if (after.way.firstWeek.map(fold).join('\n') !== before.way.firstWeek.map(fold).join('\n')) rewritten.push(PART_WORDS.firstWeek);
    if (rewritten.length) out.push(`I updated ${listed(rewritten)}.`);
  }

  const team = before.team.filter(agent => !agent.left);
  const joined: string[] = [], changed: string[] = [];
  for (const agent of after.team) {
    const was = team.find(item => fold(item.name) === fold(agent.name));
    if (!was) { if (!before.team.some(item => fold(item.name) === fold(agent.name))) joined.push(agent.name); }
    else if (fold(was.job) !== fold(agent.job) || was.duties.map(fold).join('\n') !== agent.duties.map(fold).join('\n')) changed.push(agent.name);
  }
  const gone = team.filter(was => !after.team.some(agent => fold(agent.name) === fold(was.name))).map(agent => agent.name);
  if (changed.length) out.push(`I changed what ${listed(changed)} ${changed.length > 1 ? 'do' : 'does'}.`);
  if (joined.length) out.push(`I added ${listed(joined)} to the team.`);
  if (gone.length) out.push(`I took ${listed(gone)} off the team.`);
  return out.length ? out : [NOTHING_LINE];
}

/** The question in a reply: its sentences that end in a question mark, each starting with a capital; null when it asks nothing. */
export function nextQuestion(reply: string | null | undefined): string | null {
  if (!reply) return null;
  const asked = sentences(reply.replace(/\s+/g, ' ')).filter(part => part.endsWith('?')).map(part => `${part[0]!.toUpperCase()}${part.slice(1)}`);
  return asked.length ? asked.join(' ') : null;
}

/** Words that carry no part of what a question asks. */
const ASK_WORDS = new Set(['what', 'which', 'when', 'where', 'who', 'how', 'why', 'would', 'should', 'could', 'will', 'can', 'did', 'does', 'are', 'you', 'your', 'the', 'and', 'for', 'with', 'each', 'that', 'this', 'have', 'has', 'want', 'like', 'under', 'from', 'into', 'about', 'they', 'them', 'their', 'any', 'also', 'often', 'much', 'many', 'most', 'please', 'tell']);
const askWords = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3 && !ASK_WORDS.has(word)).map(word => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)));
/** Whether two questions ask the same thing: most of the shorter one's words are in the other. */
function sameQuestion(a: string, b: string): boolean {
  const one = askWords(a), other = askWords(b);
  const small = Math.min(one.size, other.size);
  if (small < 2) return fold(a) === fold(b);
  const shared = [...one].filter(word => other.has(word)).length;
  return shared / small >= 0.7;
}

/**
 * Whether a question was already asked in each of the AI's last two turns: asked twice running and still not answered.
 * A third time is not asked. An earlier question the talk has moved on from does not count.
 */
export function askedTwice(turns: readonly AboutTurn[], question: string): boolean {
  const said = turns.filter(turn => turn.from === 'you').slice(-2);
  return said.length === 2 && said.every(turn => { const asked = nextQuestion(turn.text); return asked !== null && sentences(asked).some(part => sameQuestion(part, question)); });
}

/** The word an offer's name is about: the last word before "for", "with", "to" and the like ("Subtitles for creators": subtitles). */
function headWord(name: string): string {
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const stop = words.findIndex(word => ['for', 'with', 'to', 'in', 'of', 'by', 'from', 'and', 'on', 'at'].includes(word));
  const head = (stop > 0 ? words.slice(0, stop) : words).at(-1) ?? '';
  return head.length > 4 && head.endsWith('s') ? head.slice(0, -1) : head;
}

/**
 * A rename that left two offers sounding like one (the renamed offer's name is about the same word as another's:
 * "Subtitles for creators" beside "Video subtitles"): the two names, or null.
 */
function renameClash(before: AboutPlan, after: ReplyPlan): [string, string] | null {
  const live = before.offers.filter(offer => offer.kept);
  for (const [index, was] of live.entries()) {
    const now = after.offers[index];
    if (!now || after.offers.some(offer => fold(offer.name) === fold(was.name)) || live.some(offer => fold(offer.name) === fold(now.name))) continue;
    const head = headWord(now.name);
    const twin = head.length >= 4 ? after.offers.find((offer, at) => at !== index && headWord(offer.name) === head) : undefined;
    if (twin) return [now.name, twin.name];
  }
  return null;
}

const mentions = (text: string, thing: string) => thing.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3).some(word => fold(text).includes(word));

/**
 * The reply to a follow-up: what changed (planChanges), then one question, else that the plan looks ready. The
 * question is the AI's own (reply's question sentences), except that a rename clash is asked about first, and a skill,
 * language or product the owner just added ("I also know Marathi") is asked about when the answer put it in no offer
 * and the AI did not ask of it. A question asked twice running already is left out.
 */
export function followUpReply(input: { before: AboutBefore; said: string; after: ReplyPlan; reply: string | null | undefined }): string {
  const { before, said, after } = input;
  let question = nextQuestion(input.reply);
  const clash = renameClash(before.plan, after);
  const skill = alsoOffered(said);
  if (clash) question = `"${clash[0]}" and "${clash[1]}" now sound like one offer. Which one do you want to keep?`;
  else if (skill && !after.offers.some(offer => mentions(`${offer.name} ${offer.line}`, skill)) && !(question && mentions(question, skill))) question = `Do you want to offer ${skill} too?`;
  if (question && askedTwice(before.turns, question)) question = null;
  return [...planChanges(before.plan, after, said), question ?? READY_LINE].join(' ');
}
