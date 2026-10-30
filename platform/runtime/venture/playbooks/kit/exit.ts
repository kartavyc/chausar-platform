// Chausar playbook kit: the honest exit at intake (Ink v2 wave 5, package 5A2; catalogue P4). Code decides first
// whether an ask is in, partly or outside what a kit playbook does, from the definition's own phrases (scope.inScope and
// scope.outOfScope) in English and, through the playbook's Hindi file, in Hindi. A model's view, when the owner asks for
// one, is only ever shown as "model estimate: may be outside" and the owner picks; it never decides. Outside gives one
// fixed reply, "This is outside what we do. We can help with {in-scope part}. For {the rest}, {pointElsewhere}.", and no
// follow-up is ever scheduled for that person: their open card goes to Not now for "outside scope" with no day to ask
// again (W4 4E's pipeline). Partly makes the order for the in-scope part only and lists the rest on it. Learned from
// QuantumByte's main_agent/skills/disqualification/SKILL.md (Apache-2.0), ideas only, no code taken.
import { ChausarError, check } from '../../../contracts.ts';
import type { OpportunityRecord, VentureRecord } from '../../contracts.ts';
import type { VentureTx } from '../../records.ts';
import { localDayAt } from '../../local-day.ts';
import { announce, cardsOf, CLOSED_STAGES, storeCard } from '../../network/pipeline.ts';
import { pickPlaybook, PLAYBOOK_REGISTRY } from '../registry.ts';
import type { PlaybookDefinition } from './define.ts';
import { loadHi } from './words.ts';

/** What the honest exit decided, by code: the in-scope phrases the ask names, the out-of-scope ones, and the reply. */
export type ScopeVerdict = {
  verdict: 'in' | 'partly' | 'outside' | 'unclear';
  inPart: string[];
  rest: string[];
  /** The fixed reply, when part or all of the ask is outside. */
  reply: string | null;
  by: 'code';
};

/** How a model's view on scope is shown, when the owner asks for one: an estimate beside the ask, never a decision. */
export const MODEL_SCOPE_WORDS = Object.freeze({ outside: 'model estimate: may be outside', inside: 'model estimate: may fit' });
/** The evidence line a parked card carries. */
export const OUTSIDE_CARD_LINE = 'Not now: outside what you do. Chausar will not follow up.';

/** Lower case, Unicode-normalised, without the nukta (so ज़ and ज match), with single spaces. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/़/g, '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const LATIN = /[a-z0-9]/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A phrase as a whole word or words: a Latin phrase needs a boundary on each side (a plural s or es may follow). */
function names(text: string, phrase: string): boolean {
  const wanted = fold(phrase);
  if (!wanted) return false;
  if (!LATIN.test(wanted)) return text.includes(wanted);
  return new RegExp(`(?<![a-z0-9])${escape(wanted)}(?:e?s)?(?![a-z0-9])`, 'u').test(text);
}

/** "a", "a and b", "a, b and c". */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The fixed reply for an ask that is partly or wholly outside. */
export function exitReply(inPart: readonly string[], rest: readonly string[], pointElsewhere: string): string {
  const elsewhere = pointElsewhere.trim().replace(/[.\s]+$/, '');
  return `This is outside what we do. We can help with ${joinWords(inPart)}. For ${joinWords(rest)}, ${elsewhere}.`;
}

/**
 * The honest exit's decision on one ask, by code: each in-scope and out-of-scope phrase of the playbook that the ask
 * names, in English or (with hi, the playbook's Hindi lookup) in Hindi. In: only in-scope phrases; partly: both;
 * outside: only out-of-scope ones; unclear: neither, and the owner picks. The reply names the in-scope phrases the ask
 * named, or, when it named none, everything the playbook does.
 */
export function scopeOf(definition: Pick<PlaybookDefinition, 'scope'>, request: string, options: { hi?: (english: string) => string | null } = {}): ScopeVerdict {
  const text = fold(request);
  const named = (phrase: string) => names(text, phrase) || (options.hi ? names(text, options.hi(phrase) ?? '') : false);
  const { inScope, outOfScope, pointElsewhere } = definition.scope;
  const inPart = inScope.filter(named);
  const rest = outOfScope.filter(named);
  if (!rest.length) return { verdict: inPart.length ? 'in' : 'unclear', inPart, rest, reply: null, by: 'code' };
  const verdict = inPart.length ? 'partly' : 'outside';
  return { verdict, inPart, rest, reply: exitReply(inPart.length ? inPart : inScope, rest, pointElsewhere), by: 'code' };
}

/**
 * The kit playbook a business runs, from its idea: the registered playbook its words pick (registry.ts pickPlaybook over
 * the flagships and the kit playbooks), when that is a kit definition; null for a flagship or a plain service.
 */
export function kitDefinitionOf(venture: Pick<VentureRecord, 'idea'>, definitions: readonly PlaybookDefinition[]): PlaybookDefinition | null {
  if (!definitions.length) return null;
  const known = new Set(PLAYBOOK_REGISTRY.map(entry => entry.id));
  const picked = pickPlaybook(venture.idea, [...PLAYBOOK_REGISTRY, ...definitions.map(item => item.registration).filter(entry => !known.has(entry.id))]);
  return picked ? definitions.find(item => item.registration.id === picked.id) ?? null : null;
}

/** A kit playbook's Hindi lookup for its scope phrases (playbooks/<id>/hi.json, through 5A1's words.ts). */
export function scopeHi(definition: Pick<PlaybookDefinition, 'registration'>): (english: string) => string | null {
  const hi = loadHi(definition.registration.id);
  return english => (Object.hasOwn(hi, english) ? hi[english] ?? null : null);
}

/**
 * The honest exit at order intake (money/orders.ts): for a business a kit playbook runs, an ask wholly outside refuses
 * OUTSIDE_SCOPE with the fixed reply as its words, so no order is made; partly answers what the order lists as left
 * out; in, unclear, or a business no kit playbook runs answers null and the order is made as before.
 */
export function orderScope(venture: Pick<VentureRecord, 'idea'>, request: string, definitions: readonly PlaybookDefinition[]): { rest: string[]; reply: string } | null {
  const definition = kitDefinitionOf(venture, definitions);
  if (!definition) return null;
  const scope = scopeOf(definition, request, { hi: scopeHi(definition) });
  if (scope.verdict === 'outside') throw new ChausarError('OUTSIDE_SCOPE', scope.reply!);
  return scope.verdict === 'partly' ? { rest: scope.rest, reply: scope.reply! } : null;
}

/**
 * Parks every open pipeline card of a person (or of a client's person) whose ask is outside what the business does:
 * Not now, with the reason on the card and no day to ask again, so no follow-up is ever scheduled for them. A closed
 * card stays as it is. Answers the cards it parked.
 */
export function parkOutsideScope(tx: VentureTx, who: { personId?: string | null; clientId?: string | null }, by: string): OpportunityRecord[] {
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const today = localDayAt(tx.now, venture.country);
  const parked: OpportunityRecord[] = [];
  for (const card of cardsOf(tx.state, venture, today)) {
    const theirs = (!!who.personId && card.personId === who.personId)
      || (!!who.clientId && (card.clientId === who.clientId || card.person?.clientId === who.clientId));
    if (!theirs || CLOSED_STAGES.has(card.stage)) continue;
    card.history = [...card.history, { from: card.stage, to: 'not-now', at: tx.now, by, evidence: { kind: 'owner', id: null, line: OUTSIDE_CARD_LINE } }];
    card.stage = 'not-now';
    card.askAgainFrom = null;
    card.next = null;
    const record = storeCard(tx, card);
    announce(tx, record.id);
    parked.push(record);
  }
  return parked;
}
