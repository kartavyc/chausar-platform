// Chausar venture launcher, core: what came before a follow-up in About you (founder, 14 Nov 2026). Until then every
// message was read on its own, so "I can make about 200 pieces a month and I am in Koregaon Park" rebuilt the whole
// plan: offers and agents renamed, the city dropped, the new facts used nowhere. A follow-up now carries the talk so far
// (the owner's messages and the AI's replies, bounded as a chat is: agents/answer.ts chatHistory) and the plan as the
// owner sees it (the offers with the owner's own edits and unticks, the way, the team with any agent left out), so the
// AI refines the plan instead of writing a new one. Nothing is stored: the window holds the talk until the plan is kept.
//
// Code, not the AI, holds two things: the history's bounds, and the offers on the card, which are renamed or dropped
// only when the owner's new message speaks of them (an offer the owner typed: only when it speaks of that offer).
// This file imports no engine store code, so the app's fake engine checks a follow-up with the same aboutBefore.
import { ChausarError, type Json } from '../../portable.ts';
import { HIRE_READS, type HireRead } from '../agents/hire-check-core.ts';
import { isTeamDepartment, type TeamDepartment } from '../agents/team-proposal.ts';
import { isFamilyId, type FamilyId } from './families.ts';
import { professionOf } from './professions.ts';
import { keptWay, type WayToEarn } from './way.ts';
import { DEFAULT_OFFER_UNIT, isOfferUnit, speaksOfUnit, unitPart, type OfferUnit } from './offer-units.ts';
import { renamesAsked } from './offer-rename.ts';

export type AboutTurn = { from: 'owner' | 'you'; text: string };
/** kept: still ticked on the card. yours: the owner typed this name (a rename or an offer they added). unit: the unit the card prices it in. */
export type AboutPlanOffer = { name: string; line: string; kept: boolean; yours: boolean; unit: OfferUnit };
/** left: the owner left this agent out. department: the one on its card (absent on a card from a window that knows none). */
export type AboutPlanAgent = { name: string; job: string; duties: string[]; reads: HireRead[]; left: boolean; department?: TeamDepartment };
/** familyId, professionId: the field and the profession on the card, so a follow-up that names neither keeps them. */
export type AboutPlan = { familyId: FamilyId | null; professionId: string | null; name: string | null; offers: AboutPlanOffer[]; way: WayToEarn | null; team: AboutPlanAgent[] };
export type AboutBefore = { turns: AboutTurn[]; plan: AboutPlan };

/** How much of the talk the AI is given: the newest turns, each cut to a length, within a total (as chatHistory). */
export const ABOUT_HISTORY = Object.freeze({ turns: 12, turnChars: 1500, chars: 8000 });
/** Bounds of the request, never of the conversation: far above what a card holds. */
const TURNS_MAX = 80;
const TURN_MAX = 4000;
const OFFERS_MAX = 8;
const TEAM_MAX = 3;
const DUTIES_MAX = 5;
const IDEA_MAX = 2000;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINK = /https?:|www\./i;
const PROFILE_LINK = /linkedin\.com\//i;
const SHAPE = 'Send what came before as the turns so far and the plan on the card.';

const invalid = (message: string) => new ChausarError('INVALID_VENTURE_REQUEST', message);
function closed(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(SHAPE);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) throw invalid(SHAPE);
  return record;
}
function words(value: unknown, min: number, max: number, oneLine = true): string {
  if (typeof value !== 'string') throw invalid(SHAPE);
  const text = oneLine ? value.replace(/\s+/g, ' ').trim() : value.replace(/\r\n/g, '\n').trim();
  if (text.length < min || text.length > max || CONTROL.test(text)) throw invalid(SHAPE);
  return text;
}
function list(value: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw invalid(SHAPE);
  return value;
}
const flag = (value: unknown): boolean => { if (typeof value !== 'boolean') throw invalid(SHAPE); return value; };

/**
 * What came before, checked: exactly the turns and the plan. A turn is the owner's or the AI's ("you", as the AI is
 * told of its own words); an AI turn with a link is refused, as its reply was never kept with one. The plan's way must
 * still be a whole, plain way (keptWay). Anything else is INVALID_VENTURE_REQUEST and nothing is sent.
 */
export function aboutBefore(value: unknown): AboutBefore {
  const body = closed(value, ['turns', 'plan']);
  const turns = list(body.turns, TURNS_MAX, 1).map(item => {
    const turn = closed(item, ['from', 'text']);
    if (turn.from !== 'owner' && turn.from !== 'you') throw invalid(SHAPE);
    const text = words(turn.text, 1, TURN_MAX, false);
    if (turn.from === 'you' ? LINK.test(text) : PROFILE_LINK.test(text)) throw invalid(SHAPE);
    return { from: turn.from, text } as AboutTurn;
  });
  const plan = closed(body.plan, ['offers', 'way', 'team'], ['name', 'familyId', 'professionId']);
  const familyId = plan.familyId === undefined || plan.familyId === null ? null : plan.familyId;
  if (familyId !== null && !isFamilyId(familyId)) throw invalid(SHAPE);
  // A profession stands only as a catalogue profession of that field, as the read itself holds it.
  const profession = plan.professionId === undefined || plan.professionId === null ? null : professionOf(plan.professionId);
  if (plan.professionId !== undefined && plan.professionId !== null && (!profession || profession.id !== plan.professionId || profession.family !== familyId)) throw invalid(SHAPE);
  const offers = list(plan.offers, OFFERS_MAX).map(item => {
    const offer = closed(item, ['name', 'line', 'kept', 'yours'], ['unit']);
    // The unit the card shows (core/offer-units.ts); a card from a window that knows no units is per project.
    if (offer.unit !== undefined && !isOfferUnit(offer.unit)) throw invalid(SHAPE);
    return { name: words(offer.name, 2, 60), line: words(offer.line, 0, 200), kept: flag(offer.kept), yours: flag(offer.yours), unit: (offer.unit as OfferUnit | undefined) ?? DEFAULT_OFFER_UNIT };
  });
  const way = plan.way === null ? null : keptWay(plan.way);
  if (plan.way !== null && !way) throw invalid(SHAPE);
  const team = list(plan.team, TEAM_MAX).map(item => {
    const agent = closed(item, ['name', 'job', 'duties', 'reads', 'left'], ['department']);
    const reads = list(agent.reads, HIRE_READS.length);
    if (reads.some(read => !HIRE_READS.includes(read as HireRead)) || new Set(reads).size !== reads.length) throw invalid(SHAPE);
    if (agent.department !== undefined && !isTeamDepartment(agent.department)) throw invalid(SHAPE);
    return { name: words(agent.name, 1, 40), job: words(agent.job, 1, 120), duties: list(agent.duties, DUTIES_MAX, 1).map(duty => words(duty, 1, 160)), reads: reads as HireRead[], left: flag(agent.left), ...(agent.department ? { department: agent.department as TeamDepartment } : {}) };
  });
  const name = plan.name === undefined || plan.name === null ? null : words(plan.name, 1, 60);
  return { turns, plan: { familyId: familyId as FamilyId | null, professionId: profession?.id ?? null, name, offers, way, team } };
}

/** The talk as the AI is given it: the newest turns, oldest first, each cut to a length, within a total. */
export function aboutHistory(turns: readonly AboutTurn[]): AboutTurn[] {
  const kept: AboutTurn[] = [];
  let room = ABOUT_HISTORY.chars;
  for (const turn of [...turns].reverse()) {
    if (kept.length >= ABOUT_HISTORY.turns) break;
    const said = turn.text.trim();
    if (!said) continue;
    const text = said.length > ABOUT_HISTORY.turnChars ? `${said.slice(0, ABOUT_HISTORY.turnChars - 3)}...` : said;
    if (text.length > room) break;
    room -= text.length;
    kept.unshift({ from: turn.from, text });
  }
  return kept;
}

/**
 * What came before as the AI reads it: the bounded talk and the plan, with a mark only where the owner did something
 * (yours on an offer they typed, kept false on one they unticked, left on an agent they left out).
 */
export function beforeInput(before: AboutBefore): Json {
  const { plan } = before;
  return {
    turns: aboutHistory(before.turns),
    plan: {
      familyId: plan.familyId, professionId: plan.professionId, name: plan.name,
      offers: plan.offers.map(offer => ({ name: offer.name, line: offer.line, ...unitPart(offer.unit), ...(offer.kept ? {} : { kept: false }), ...(offer.yours ? { yours: true } : {}) })),
      way: plan.way,
      team: plan.team.map(agent => ({ name: agent.name, job: agent.job, duties: [...agent.duties], reads: [...agent.reads], ...(agent.department ? { department: agent.department } : {}), ...(agent.left ? { left: true } : {}) })),
    },
  } as unknown as Json;
}

/**
 * Everything the owner said, oldest first, one message to a line: the idea the plan starts from and the words country
 * evidence is copied from. Within the idea's length the first message always stays (it says what the work is) and so
 * does the newest; of the ones between, the newest that fit.
 */
export function saidSoFar(before: AboutBefore | null, text: string): string {
  const earlier = (before?.turns ?? []).filter(turn => turn.from === 'owner').map(turn => turn.text);
  if (!earlier.length) return text;
  const [first, ...between] = earlier;
  if (!text) return [first!, ...between].join('\n').slice(0, IDEA_MAX).trim();
  let room = IDEA_MAX - first!.length - text.length - 2;
  if (room < 0) return `${first!.slice(0, Math.max(0, IDEA_MAX - text.length - 1)).trim()}\n${text}`.slice(-IDEA_MAX).trim();
  const fit: string[] = [];
  for (const said of between.reverse()) {
    if (said.length + 1 > room) break;
    room -= said.length + 1;
    fit.unshift(said);
  }
  return [first!, ...fit, text].join('\n');
}

const fold = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const stem = (word: string) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word);
/** Whether the owner's message speaks of an offer: it says "offer", or holds a word of four letters or more of its name. */
function speaksOf(said: string, name: string): boolean {
  const heard = said.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem);
  if (heard.includes('offer')) return true;
  return name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4).map(stem).some(word => heard.some(other => other.startsWith(word) || (other.length >= 4 && word.startsWith(other))));
}

/** Small words a message and a line share by chance: no reason to change the line. */
const SMALL_WORDS = new Set(['with', 'from', 'your', 'that', 'this', 'they', 'them', 'their', 'there', 'each', 'have', 'will', 'want', 'about', 'into', 'only', 'also', 'more', 'most', 'some', 'when', 'what', 'where', 'which', 'than', 'then', 'does', 'been', 'make', 'made', 'work']);
const lineWords = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4 && !SMALL_WORDS.has(word)).map(stem);
/** Whether the owner's message bears on some words: they share a word of four letters or more that is not a small word. */
function bearsOn(said: string, line: string): boolean {
  const heard = lineWords(said);
  return lineWords(line).some(word => heard.some(other => other.startsWith(word) || word.startsWith(other)));
}

/** The words of an offer's name that say what it is: three letters or more ("mug"), without the joining words. */
const nameWords = (name: string) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3 && !['for', 'and', 'the', 'with', 'from', 'your'].includes(word)).map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));
/** Whether two offer names still name the same thing: they share such a word ("Handmade mugs", "Cafe mug sets"). */
export function sameThing(a: string, b: string): boolean {
  const other = nameWords(b);
  return nameWords(a).some(word => other.some(held => held.startsWith(word) || word.startsWith(held)));
}

/**
 * The card's offers when the owner asked for a rename code could read (core/offer-rename.ts; seen on Windows, 15 Nov
 * 2026: "Call the first offer Cafe mug sets" came back as a new offer beside the old one, with another offer gone).
 * Each kept offer holds its own place, and the answer is fitted to that:
 *   - the renamed offer takes the new name in its place. Its line and unit are the ones the answer wrote for the new
 *     name, wherever the answer put it; else the ones it left under the old name. The old line stays only while the new
 *     name still names the same thing. The answer's own rows for the old and the new name are used up by this.
 *   - every other kept offer is held as in any follow-up: the answer's row of that name stands, a new name in its place
 *     or its absence stands only when the rest of the message speaks of it, and otherwise it is put back as it was.
 *   - a row the answer added beside these stands only when the rest of the message speaks of it: a rename adds nothing.
 */
function renamedByCode<Offer extends { name: string; line: string; unit?: OfferUnit }>(live: readonly AboutPlanOffer[], renames: readonly { at: number; to: string }[], rest: string, answer: readonly Offer[], max: number): Offer[] {
  const used = new Set<number>();
  const slots: (Offer | null)[] = live.map(() => null);
  const row = (name: string) => answer.findIndex((offer, index) => !used.has(index) && fold(offer.name) === fold(name));
  const isNew = (offer: Offer) => !live.some(was => fold(was.name) === fold(offer.name)) && !renames.some(rename => fold(rename.to) === fold(offer.name));
  for (const rename of renames) {
    const was = live[rename.at]!;
    const wrote = row(rename.to);
    if (wrote >= 0) used.add(wrote);
    const old = row(was.name);
    if (old >= 0) used.add(old);
    // Neither name came back: a new name the answer put in this place is its own wording of the rename.
    const there = wrote < 0 && old < 0 && answer[rename.at] && !used.has(rename.at) && isNew(answer[rename.at]!) ? rename.at : -1;
    if (there >= 0) used.add(there);
    const source = answer[wrote >= 0 ? wrote : there >= 0 ? there : old];
    const written = source?.line ?? was.line;
    const line = fold(written) === fold(was.line) && !sameThing(rename.to, was.name) ? '' : written;
    const { unit: _unit, ...words } = (source ?? {}) as Offer;
    // The unit the answer gave the new name stands (a changed offer); with no row for it, the card's unit holds.
    slots[rename.at] = { ...words, name: rename.to, line, ...unitPart(wrote >= 0 || there >= 0 ? source!.unit : was.unit) } as Offer;
  }
  live.forEach((was, at) => {
    if (slots[at]) return;
    const same = row(was.name);
    if (same >= 0) { used.add(same); slots[at] = answer[same]!; return; }
    const there = answer[at];
    const fresh = there && !used.has(at) && isNew(there) ? there : null;
    const asked = speaksOf(rest, was.name) || (fresh !== null && !was.yours && speaksOf(rest, fresh.name));
    if (fresh) used.add(at);
    if (asked) slots[at] = fresh && was.line && fold(fresh.line) === fold(was.line) && !sameThing(fresh.name, was.name) ? { ...fresh, line: '' } : fresh;
    else slots[at] = { name: was.name, line: was.line || fresh?.line || '', ...unitPart(was.unit) } as Offer;
  });
  const added = answer.filter((offer, index) => !used.has(index) && isNew(offer) && speaksOf(rest, offer.name));
  return [...slots.filter((offer): offer is Offer => offer !== null), ...added].slice(0, max);
}

/**
 * The offers on the card hold through a follow-up. An offer still kept, which the answer renamed or dropped although
 * the new message says nothing of it, is put back as it was: in its place when the answer put a new name there, else
 * added while there is room (max). The answer stands when the message speaks of the offer (then the owner asked), and,
 * for an offer the AI wrote, when it speaks of the new name in its place (the owner asked for that). An offer the owner
 * typed is the owner's own: only a message that speaks of that offer changes it. A put-back offer with no line of its
 * own takes the line the answer wrote in its place.
 *
 * A rename that changes what the offer is (seen on Windows, 15 Nov 2026: "Call the first offer Subtitles for creators"
 * left "Translate scripts ... between Hindi and English" under it): when the new name shares no word with the old
 * name and the answer kept the old line word for word, that line is no longer about the offer, so it is taken out.
 * Code writes no line; the AI is told to write one for the new name, and a card with none shows the name alone.
 *
 * Lines (seen live, 15 Nov 2026: after "I do not sell to hotels yet" two untouched offers still said "for cafes and
 * hotels"): an offer that keeps its name keeps its line too, unless the message bears on what the card's offers say
 * (a word of any kept offer's name or line) or on who pays (the way's customer line). Then the lines the answer wrote
 * stand, so the AI can correct what the message made untrue, also where a line says it in other words ("hospitality
 * businesses" for hotels): code cannot judge what is true, only whether the message is about what is sold or who buys
 * it. A line reworded after a message about something else (a capacity, a place) is put back as it was.
 *
 * A rename the owner asked for in words code can read ("Call the first offer Cafe mug sets", "Rename A to B") is
 * applied by code to that offer (renamedByCode), and the word "offer" in it opens no other offer to change.
 */
export function cardOffersKept<Offer extends { name: string; line: string; unit?: OfferUnit }>(before: AboutBefore | null, message: string, offers: readonly Offer[], max = 3): Offer[] {
  if (!before) return [...offers];
  const live = before.plan.offers.filter(offer => offer.kept);
  // A rename the owner asked for by place or exact name is applied by code (renamedByCode); what the message says
  // beside it is what the other offers, their units and their lines are read against.
  const asked = renamesAsked(message, live);
  const said = asked.renames.length ? asked.rest : message;
  const out = asked.renames.length ? renamedByCode(live, asked.renames, said, offers, max) : [...offers];
  if (!asked.renames.length) live.forEach((was, at) => {
    if (out.some(offer => fold(offer.name) === fold(was.name))) return;
    const there = out[at];
    const fresh = there && !live.some(offer => fold(offer.name) === fold(there.name)) ? there : null;
    // The rename stands: its old line stays only while the new name still names the same thing.
    const renamed = fresh !== null && (speaksOf(said, was.name) || (!was.yours && speaksOf(said, fresh.name)));
    if (renamed && was.line && fold(fresh.line) === fold(was.line) && !sameThing(fresh.name, was.name)) out[at] = { ...fresh, line: '' };
    if (speaksOf(said, was.name)) return;
    if (fresh && !was.yours && speaksOf(said, fresh.name)) return;
    const own = { name: was.name, line: was.line || fresh?.line || '', ...unitPart(was.unit) } as Offer;
    if (fresh) out[at] = own;
    else if (out.length < max) out.splice(Math.min(at, out.length), 0, own);
  });
  // Units (core/offer-units.ts): the unit on the card is the owner's to set, so an offer that keeps its name keeps its
  // unit through a follow-up, unless the message speaks of how an offer is charged ("per piece", "monthly"). An offer
  // renamed at the owner's word is a changed offer: the unit the answer gives it stands ("Cafe mug sets", per set).
  if (!speaksOfUnit(said)) {
    live.forEach(was => {
      const at = out.findIndex(offer => fold(offer.name) === fold(was.name));
      if (at < 0 || (out[at]!.unit ?? DEFAULT_OFFER_UNIT) === was.unit) return;
      const { unit: _unit, ...rest } = out[at]!;
      out[at] = { ...rest, ...unitPart(was.unit) } as Offer;
    });
  }
  if (bearsOn(said, [...live.map(offer => `${offer.name} ${offer.line}`), before.plan.way?.customer ?? ''].join(' '))) return out;
  for (const was of live) {
    const at = out.findIndex(offer => fold(offer.name) === fold(was.name));
    if (at < 0 || !was.line || fold(out[at]!.line) === fold(was.line)) continue;
    out[at] = { ...out[at]!, line: was.line };
  }
  return out;
}

/**
 * The card's offers when no AI is connected: nobody but the owner changes them. base: what the read would show with no
 * card (a field's template offers, or the one row taken from the owner's words). While the field stays the same the
 * card holds whole: its kept offers, as they are. With a new field the rows the owner typed come first and the field's
 * templates follow, to max in all; a template row of the old field does not follow the owner into the new one.
 */
export function cardOffersHeld<Offer extends { name: string; line: string; unit?: OfferUnit }>(before: AboutBefore | null, familyId: FamilyId | null, base: readonly Offer[], max = 3): Offer[] {
  if (!before) return [...base];
  const live = before.plan.offers.filter(offer => offer.kept);
  const own = (offer: AboutPlanOffer) => ({ name: offer.name, line: offer.line, ...unitPart(offer.unit) } as Offer);
  if (before.plan.familyId === familyId) return live.length ? live.slice(0, max).map(own) : [...base];
  const mine = live.filter(offer => offer.yours).slice(0, max).map(own);
  return [...mine, ...base.filter(offer => !mine.some(kept => fold(kept.name) === fold(offer.name)))].slice(0, max);
}

/** Words that name the team at all: then the owner is speaking of who is on it. */
const TEAM_WORDS = new Set(['agent', 'agents', 'team']);
/** The owner says what they do not do, want or need: then one word of an agent's work is enough to be about that work. */
const SAYS_NO = /\b(?:no|not|never|none|nobody|without|stop|stopped|drop|remove|cancel|skip)\b|n't\b/i;
/**
 * Whether the owner's message speaks of an agent: it says "agent" or "team", holds the agent's whole name, or shares
 * two or more words with its job and duties. One shared word in a plain fact is by chance (seen live: "we can do
 * about six visits a day" beside an agent that tracks visits), so it is no reason for an agent to go. One shared word
 * is enough where the message says what the owner does not do or need (seen live: "I do not sell to hotels yet" and
 * an agent whose whole job was hotel leads).
 */
function speaksOfAgent(said: string, agent: { name: string; job?: string; duties?: readonly string[] }): boolean {
  const heard = said.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (heard.some(word => TEAM_WORDS.has(word))) return true;
  const name = agent.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (name.length > 0 && heard.some((_, at) => name.every((word, index) => heard[at + index] === word))) return true;
  const told = lineWords(said);
  const work = new Set(lineWords([agent.job ?? '', ...(agent.duties ?? [])].join(' ')));
  const shared = [...work].filter(word => told.some(other => other.startsWith(word) || word.startsWith(other))).length;
  return shared >= 2 || (shared >= 1 && SAYS_NO.test(said));
}

/**
 * The agents on the card hold through a follow-up, the way the offers do (seen on Windows, 15 Nov 2026: "I took Order
 * coordinator off the team" in reply to a message about capacity). An agent the owner has not left out, which the
 * answer dropped or put another agent in the place of although the new message says nothing of it or of its work, is
 * put back as it was: in its place when the answer put a new agent there, else added while there is room (max). The
 * answer stands when the message speaks of the agent, or of the new agent in its place (then the owner asked).
 * held: the card's agent as the team keeps it now (checked again against the hire rules and the plan), or null when it
 * no longer passes; then it is not put back.
 *
 * Words (seen in the live check of this round: after a message about capacity one duty came back reworded, and the
 * reply said "I changed what Lead agent does"): an agent that keeps its name keeps its job and duties too, as an offer
 * keeps its line, unless the message bears on what is sold or who buys (a word of a kept offer or of the way's customer
 * line), on that agent's own work (a word of its job or duties), or speaks of the team. Then what the answer wrote
 * stands, so the AI can correct a duty the message made untrue ("Lists possible hotel customers" after "I do not sell
 * to hotels yet").
 */
export function cardTeamKept<Agent extends { name: string; job?: string; duties?: readonly string[] }>(before: AboutBefore | null, said: string, team: readonly Agent[], held: (agent: Omit<AboutPlanAgent, 'left'>) => Agent | null, max = 3): Agent[] {
  const out = [...team];
  if (!before) return out;
  const card = before.plan.team;
  card.forEach((was, at) => {
    if (was.left || out.some(agent => fold(agent.name) === fold(was.name))) return;
    const there = out[at];
    const fresh = there && !card.some(agent => fold(agent.name) === fold(there.name)) ? there : null;
    if (speaksOfAgent(said, was) || (fresh && speaksOfAgent(said, fresh))) return;
    const { left: _left, ...own } = was;
    const back = held(own);
    if (!back) return;
    if (fresh) out[at] = back;
    else if (out.length < max) out.splice(Math.min(at, out.length), 0, back);
  });
  const sold = [...before.plan.offers.filter(offer => offer.kept).map(offer => `${offer.name} ${offer.line}`), before.plan.way?.customer ?? ''].join(' ');
  const heard = said.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (bearsOn(said, sold) || heard.some(word => TEAM_WORDS.has(word))) return out;
  const words = (agent: { job?: string; duties?: readonly string[] }) => [agent.job ?? '', ...(agent.duties ?? [])].map(fold).join('\n');
  for (const was of card) {
    if (was.left) continue;
    const at = out.findIndex(agent => fold(agent.name) === fold(was.name));
    if (at < 0 || words(out[at]!) === words(was) || bearsOn(said, [was.job, ...was.duties].join(' '))) continue;
    const { left: _left, ...own } = was;
    const back = held(own);
    if (back) out[at] = back;
  }
  return out;
}
