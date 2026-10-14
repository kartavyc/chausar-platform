/**
 * FR-11 An idea, not a business yet. A founder with no books tells the idea in their own words;
 * the draft forms beside the conversation: the business in a few lines, the money for one sale,
 * a first 90-day plan, and the unknowns.
 *
 * Deterministic and without a model. Every line on the draft is a statement the owner typed,
 * kept exactly as typed and placed in the section the owner picked. Nothing here reads a number
 * out of the text, computes one or writes one: a figure exists only inside the owner's own words.
 * The standard unknowns of a new business stay blank until the owner tells them. A range is shown
 * only from `IDEA_RANGES`, a dated table that names its official source; the table is empty until
 * a person checks a source, so today every unknown the owner has not told is a blank.
 *
 * The idea lives in the workspace (the founder's vault comes first, FR-01), as owner text: it is
 * derived from no source, so a source purge leaves it, and it is deleted with the workspace.
 */
import { audit, check, newId, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { frameOf, updateFrame } from './frame.ts';

export type IdeaSection = 'business' | 'sale' | 'plan' | 'unknown';
export const IDEA_SECTIONS: readonly IdeaSection[] = ['business', 'sale', 'plan', 'unknown'];
/** The unknowns every new business starts with, and the section a told answer lands in. */
export type StandardUnknown = 'price' | 'sale-cost' | 'first-customers' | 'licences';
export const STANDARD_UNKNOWNS: Readonly<Record<StandardUnknown, IdeaSection>> = { price: 'sale', 'sale-cost': 'sale', 'first-customers': 'plan', licences: 'plan' };
/** `told-by-owner`: the owner says it is so. `assumption`: the owner's own guess, or a dated range from a source. */
export type IdeaLabel = 'told-by-owner' | 'assumption';
export type ClaimStatus = 'active' | 'corrected' | 'withdrawn';
export type IdeaClaim = {
  id: string; at: string; by: string; text: string; section: IdeaSection; answers: StandardUnknown | null; label: IdeaLabel;
  status: ClaimStatus; replaces: string | null; correctedBy: string | null;
};
export type IdeaState = { startedAt: string; startedBy: string; claims: IdeaClaim[] };

/**
 * A range for a standard unknown, shown only with its official source and the date a person
 * checked it. `low` and `high` are text exactly as the source prints them; nothing computes them.
 */
export type IdeaRange = { unknown: StandardUnknown; low: string; high: string; unit: string; source: string; checkedOn: string };
/**
 * Empty on purpose: this build fetched no source, and a range that nobody checked against its
 * official source is not shown. A person who checks one adds the row with its source and date.
 */
export const IDEA_RANGES: readonly IdeaRange[] = [];

const TEXT_LIMIT = 500, CLAIM_LIMIT = 200;
const keys = (payload: Record<string, unknown>, allowed: readonly string[]) =>
  check(Object.keys(payload).every(key => allowed.includes(key)), 'INVALID_TODAYX_REQUEST', 'This request has fields it does not use.');
const isUnknown = (value: unknown): value is StandardUnknown => typeof value === 'string' && Object.hasOwn(STANDARD_UNKNOWNS, value);

/** The owner's words, as typed: only surrounding space is trimmed. Never parsed, never rewritten. */
function ownerText(value: unknown): string {
  check(typeof value === 'string', 'INVALID_TODAYX_REQUEST', 'Tell the idea as text.');
  const text = value.trim();
  check(text.length >= 1 && text.length <= TEXT_LIMIT, 'INVALID_TODAYX_REQUEST', `Tell one thing at a time, in at most ${TEXT_LIMIT} characters.`);
  // Control characters other than line breaks are not text a person typed.
  check(!/[\u0000-\u0009\u000B-\u001F\u007F]/.test(text), 'INVALID_TODAYX_REQUEST', 'Tell the idea as plain text.');
  return text;
}

/** Only a founder, inside the app, tells the idea: never a phone message, an agent or a run that read outside text. */
function founder(ctx: Context) {
  check(ctx.channel !== 'phone' && ctx.channel !== 'mcp' && !ctx.sourceTainted, 'IDEA_APP_ONLY', 'Tell the idea inside the app.');
  check(ctx.role === 'owner' || ctx.role === 'cofounder', 'IDEA_FOUNDER_ONLY', 'Only a founder tells the idea.');
}

type Line = { claimId: string; text: string; label: IdeaLabel };
const lineOf = (claim: IdeaClaim): Line => ({ claimId: claim.id, text: claim.text, label: claim.label });

/** The draft as the screen draws it. Every line is the owner's text; ranges only from the given dated table. */
export function ideaDraft(idea: IdeaState | null, ranges: readonly IdeaRange[] = IDEA_RANGES) {
  if (idea === null) return { state: 'not-started' as const };
  const active = idea.claims.filter(claim => claim.status === 'active');
  const section = (name: IdeaSection) => active.filter(claim => claim.section === name && claim.answers === null).map(lineOf);
  const unknowns = (Object.keys(STANDARD_UNKNOWNS) as StandardUnknown[]).map(id => {
    const told = active.filter(claim => claim.answers === id).map(lineOf);
    // A range shows only with its source and the date it was checked; a row without both is never shown.
    const range = told.length > 0 ? null : ranges.find(row => row.unknown === id && row.source.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(row.checkedOn)) ?? null;
    return { id, section: STANDARD_UNKNOWNS[id], state: told.length > 0 ? 'told' as const : range ? 'range' as const : 'blank' as const, lines: told,
      range: range ? { low: range.low, high: range.high, unit: range.unit, source: range.source, checkedOn: range.checkedOn, label: 'assumption' as const } : null };
  });
  return {
    state: 'drafting' as const, startedAt: idea.startedAt,
    conversation: idea.claims.map(claim => ({ claimId: claim.id, at: claim.at, text: claim.text, section: claim.section, answers: claim.answers, label: claim.label,
      status: claim.status, replaces: claim.replaces, correctedBy: claim.correctedBy })),
    business: section('business'), sale: section('sale'), plan: section('plan'), unknownsTold: section('unknown'), unknowns,
    /** No model wrote any line of this draft. */
    writtenBy: 'owner-only' as const,
  };
}

const ideaOf = (host: ModuleHost) => frameOf(host.store.read()).idea ?? null;

export async function ideaStart(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  keys(payload, []); founder(ctx);
  const idea = await updateFrame(host, ctx, 'prepare', (frame, state) => {
    if (!frame.idea) { frame.idea = { startedAt: now(), startedBy: ctx.memberId, claims: [] }; audit(state, 'idea.started', { memberId: ctx.memberId }); }
    return structuredClone(frame.idea);
  });
  return ideaDraft(idea);
}

export async function ideaTell(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  keys(payload, ['text', 'section', 'answers', 'guess']); founder(ctx);
  const text = ownerText(payload.text);
  check(payload.answers === undefined || payload.answers === null || isUnknown(payload.answers), 'INVALID_TODAYX_REQUEST', 'Answer one of the listed unknowns.');
  const answers = isUnknown(payload.answers) ? payload.answers : null;
  const section = answers ? STANDARD_UNKNOWNS[answers] : payload.section;
  check(typeof section === 'string' && (IDEA_SECTIONS as readonly string[]).includes(section), 'INVALID_TODAYX_REQUEST', 'Pick where this goes: the business, one sale, the plan or the unknowns.');
  check(payload.answers === undefined || payload.answers === null || payload.section === undefined || payload.section === section, 'INVALID_TODAYX_REQUEST', 'This unknown belongs to another part of the draft.');
  check(payload.guess === undefined || typeof payload.guess === 'boolean', 'INVALID_TODAYX_REQUEST', 'Say whether this is a guess.');
  const idea = await updateFrame(host, ctx, 'prepare', (frame, state) => {
    check(frame.idea, 'IDEA_NOT_STARTED', 'Start the idea first.');
    check(frame.idea.claims.length < CLAIM_LIMIT, 'IDEA_FULL', `An idea draft holds at most ${CLAIM_LIMIT} statements.`);
    frame.idea.claims.push({ id: newId('idea_claim'), at: now(), by: ctx.memberId, text, section: section as IdeaSection, answers,
      label: payload.guess === true ? 'assumption' : 'told-by-owner', status: 'active', replaces: null, correctedBy: null });
    audit(state, 'idea.told', { memberId: ctx.memberId, section });
    return structuredClone(frame.idea);
  });
  return ideaDraft(idea);
}

/** Correct a statement (the old one is kept, marked corrected) or withdraw it (undo). */
export async function ideaCorrect(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  keys(payload, ['claimId', 'text', 'guess', 'withdraw']); founder(ctx);
  check(typeof payload.claimId === 'string' && payload.claimId.length <= 200, 'INVALID_TODAYX_REQUEST', 'Name the statement to correct.');
  const withdraw = payload.withdraw === true;
  check(payload.withdraw === undefined || typeof payload.withdraw === 'boolean', 'INVALID_TODAYX_REQUEST', 'Say whether to withdraw the statement.');
  check(withdraw ? payload.text === undefined : payload.text !== undefined, 'INVALID_TODAYX_REQUEST', 'Give the corrected words, or withdraw the statement.');
  check(payload.guess === undefined || typeof payload.guess === 'boolean', 'INVALID_TODAYX_REQUEST', 'Say whether this is a guess.');
  const text = withdraw ? null : ownerText(payload.text);
  const idea = await updateFrame(host, ctx, 'prepare', (frame, state) => {
    check(frame.idea, 'IDEA_NOT_STARTED', 'Start the idea first.');
    const claim = frame.idea.claims.find(item => item.id === payload.claimId);
    check(claim, 'IDEA_CLAIM_NOT_FOUND', 'That statement is not in this idea.');
    check(claim.status === 'active', 'IDEA_CLAIM_DECIDED', 'That statement was already corrected or withdrawn.');
    if (withdraw) claim.status = 'withdrawn';
    else {
      check(frame.idea.claims.length < CLAIM_LIMIT, 'IDEA_FULL', `An idea draft holds at most ${CLAIM_LIMIT} statements.`);
      const replacement: IdeaClaim = { id: newId('idea_claim'), at: now(), by: ctx.memberId, text: text!, section: claim.section, answers: claim.answers,
        label: payload.guess === undefined ? claim.label : payload.guess ? 'assumption' : 'told-by-owner', status: 'active', replaces: claim.id, correctedBy: null };
      claim.status = 'corrected'; claim.correctedBy = replacement.id;
      frame.idea.claims.push(replacement);
    }
    audit(state, withdraw ? 'idea.withdrawn' : 'idea.corrected', { memberId: ctx.memberId, section: claim.section });
    return structuredClone(frame.idea);
  });
  return ideaDraft(idea);
}

export function ideaGet(_ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  keys(payload, []);
  return ideaDraft(structuredClone(ideaOf(host)));
}
