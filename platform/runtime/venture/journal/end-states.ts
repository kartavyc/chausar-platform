// Chausar venture launcher, journal (Ink v2 wave 4, package 4J10; catalogue H27): what happens after applied. A
// provider may report that an action it took was accepted, processed, shown or gave a result; each is one step on the
// entry's ends, forward only, chained like every other journal item (chain.ts). verified is the last and needs a dated
// acceptance check: what checked it and on which day. An action on several targets (reminders to five clients)
// records how each ended: applied, rejected, partial, unknown or throttled. The entry is an unknown outcome while any
// target's is, applied when any target went (all or part), rejected when none did; a retry covers only the targets that
// were refused or throttled, never one that went, went in part or may have gone.
// The end states and the per-target outcomes follow sealeap-ecommerce-skills (assets/operations-template.md),
// beyondseo (src/beyondseo/projects.py) and shopify-multi-store (docs/ACTIONS.md), as the catalogue row H27 names them;
// this is a rewrite in TypeScript, not a copy.
import { check, type Context } from '../../contracts.ts';
import type { IsoDate, JournalEndState, JournalEndStep, JournalRecord, JournalState, JournalTargetOutcome, VentureDeps } from '../contracts.ts';
import { digest, isoDate, ventureAction, type VentureTx } from '../records.ts';
import { redactSecrets } from '../core/secrets.ts';
import type { Journalled, ProposeInput } from './journal.ts';

/** The order an action moves on in after applied. Each step goes further than the one before it. */
export const END_ORDER: Readonly<Record<JournalEndState, number>> = Object.freeze({ accepted: 1, processed: 2, shown: 3, result: 4, verified: 5 });
const TARGET_OUTCOMES: ReadonlySet<string> = new Set(['applied', 'rejected', 'partial', 'unknown', 'throttled']);
/** The targets a retry may cover: refused or throttled, so known not to have gone. */
const RETRYABLE: ReadonlySet<string> = new Set(['rejected', 'throttled']);
const MAX_TARGETS = 200;
const CONTROL = /[\u0000-\u001F\u007F]/;
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

function line(value: unknown, field: string, max: number): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value), 'INVALID_VENTURE_REQUEST', `${field} must be one line of plain text.`);
  return redactSecrets(value.trim());
}

// ---------------------------------------------------------------------------
// End states after applied
// ---------------------------------------------------------------------------

export type EndInput = { entryId: string; state: JournalEndState; line: string; by?: JournalEndStep['by']; check?: { id: string; checkedOn: IsoDate } };

/** One end state inside a transaction: on an applied entry or post, further than the last, verified with a dated check. */
export function reportEndIn(tx: VentureTx, input: EndInput): Journalled {
  check(input && typeof input === 'object' && Object.hasOwn(END_ORDER, input.state), 'INVALID_VENTURE_REQUEST', 'Say how far it went: accepted, processed, shown, result or verified.');
  const words = line(input.line, 'The line', 300);
  check(input.by === undefined || ['platform', 'engine', 'owner'].includes(input.by), 'INVALID_VENTURE_REQUEST', 'Say who reported it.');
  let dated: JournalEndStep['check'];
  if (input.state === 'verified') {
    check(input.check && typeof input.check === 'object', 'JOURNAL_CHECK_UNDATED', 'Verified needs the check that accepted it and the day it ran.');
    check(typeof input.check.id === 'string' && ID.test(input.check.id), 'INVALID_VENTURE_REQUEST', 'Name the check that accepted it.');
    const checkedOn = isoDate(input.check.checkedOn, 'The day of the check');
    check(checkedOn <= tx.now.slice(0, 10), 'JOURNAL_CHECK_UNDATED', 'A check dated after today has not run yet.');
    dated = { id: input.check.id, checkedOn };
  }
  const record = tx.find('venture-journal-entry', input.entryId) ?? tx.find('venture-connector-post', input.entryId);
  check(record, 'JOURNAL_NOT_FOUND', 'This action is not in the journal.');
  check(record.state === 'applied', 'JOURNAL_NOT_APPLIED', 'Only an action that went out can move on from there.');
  const last = record.ends?.[record.ends.length - 1];
  check(!last || END_ORDER[last.state] < END_ORDER[input.state], 'JOURNAL_ALREADY_DECIDED', `This already went as far as ${last?.state ?? 'applied'}.`);
  const step: JournalEndStep = { state: input.state, at: tx.now, by: input.by ?? (input.state === 'verified' ? 'engine' : 'platform'), line: words, ...(dated ? { check: dated } : {}) };
  return tx.replace({ ...record, ends: [...(record.ends ?? []), step] } as Journalled);
}

/** What a provider reported after applied (an engine call, never the model's): one end state, chained in its commit. */
export async function reportEndState(deps: VentureDeps, ctx: Context, input: EndInput): Promise<Journalled> {
  return ventureAction(deps, ctx, 'prepare', 'journal.end', tx => reportEndIn(tx, input));
}

/** How far an entry went after applied, for the journal list; undefined when no end state was reported. */
export const endStateOf = (record: Journalled): JournalEndState | undefined => record.ends?.[record.ends.length - 1]?.state;

// ---------------------------------------------------------------------------
// Several targets
// ---------------------------------------------------------------------------

/** The targets an effect reported, checked: each a known id, a known outcome and one line. */
export function normalizeTargets(value: unknown): JournalTargetOutcome[] {
  check(Array.isArray(value) && value.length > 0 && value.length <= MAX_TARGETS, 'INVALID_VENTURE_REQUEST', `An action reports from 1 to ${MAX_TARGETS} targets.`);
  const seen = new Set<string>();
  return value.map(item => {
    check(item && typeof item === 'object' && typeof item.id === 'string' && ID.test(item.id) && !seen.has(item.id) && TARGET_OUTCOMES.has(item.outcome),
      'INVALID_VENTURE_REQUEST', 'Each target needs its own id and how it ended: applied, rejected, partial, unknown or throttled.');
    seen.add(item.id);
    return { id: item.id, outcome: item.outcome, line: line(item.line, 'A target line', 200) };
  });
}

/** The target ids a retry covers, as proposed: up to the most an action reports, each a short id, none twice. */
export function normalizeCovers(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  check(Array.isArray(value) && value.length <= MAX_TARGETS && value.every(id => typeof id === 'string' && ID.test(id)) && new Set(value).size === value.length,
    'INVALID_VENTURE_REQUEST', 'A retry names each target it covers once, by its id.');
  return [...value];
}

/** The entry's state from its targets: unknown while any may have gone, applied when any went, rejected when none did. */
export function stateOfTargets(targets: readonly JournalTargetOutcome[]): JournalState {
  if (targets.some(target => target.outcome === 'unknown')) return 'outcome_unknown';
  if (targets.some(target => target.outcome === 'applied' || target.outcome === 'partial')) return 'applied';
  return 'rejected';
}

/** The targets a retry may cover: those refused or throttled. */
export function failedTargets(record: Journalled): string[] {
  return (record.targets ?? []).filter(target => RETRYABLE.has(target.outcome)).map(target => target.id);
}

/**
 * The proposal that tries again for the targets that failed, and only those; null when none failed. It is a new entry
 * with its own subject, so the original keeps its outcome; the owner approves it like any other.
 */
export function retryProposal(record: Journalled, entries: readonly JournalRecord[] = []): ProposeInput | null {
  if (record.kind !== 'venture-journal-entry') return null;
  // What another retry of the same entry already covers, waiting, under way, unknown or done, is never sent twice.
  const taken = coveredElsewhere(entries, record.id, null);
  const covers = failedTargets(record).filter(id => !taken.has(id));
  if (!covers.length) return null;
  const actionDigest = digest({ retryOf: record.id, of: record.actionDigest, covers });
  const count = covers.length === 1 ? 'the one target' : `the ${covers.length} targets`;
  return {
    action: record.action, subject: `${record.subject}:retry:${actionDigest.slice(0, 12)}`, target: record.target, actionDigest,
    line: `Try again for ${count} that failed: ${record.describe}`.slice(0, 300), retryOf: record.id, covers,
    ...(record.account ? { account: record.account } : {}), ...(record.operation ? { operation: record.operation } : {}),
  };
}

/** A retry that is not rejected (waiting, under way, unknown or applied) holds its targets. */
const LIVE: ReadonlySet<JournalState> = new Set<JournalState>(['described', 'approved', 'outcome_unknown', 'applied']);
/** The targets other retries of one entry hold, leaving out the proposal of this very subject (proposing it again). */
function coveredElsewhere(entries: readonly JournalRecord[], retryOf: string, subject: string | null): Set<string> {
  const taken = new Set<string>();
  for (const entry of entries) {
    if (entry.retryOf !== retryOf || entry.shadow || entry.subject === subject || !LIVE.has(entry.state)) continue;
    for (const id of entry.covers ?? []) taken.add(id);
  }
  return taken;
}

/**
 * Inside proposeIn: a retry names an entry of the same action and covers only targets of it that failed, and none
 * that another retry of it already holds, so nothing is sent twice.
 */
export function checkRetryIn(tx: VentureTx, input: { action: string; subject: string; retryOf: string | null; covers: string[] }): void {
  if (!input.retryOf) {
    check(!input.covers.length, 'INVALID_VENTURE_REQUEST', 'Only a retry names the targets it covers.');
    return;
  }
  const original = tx.find('venture-journal-entry', input.retryOf) as JournalRecord | undefined;
  check(original, 'JOURNAL_NOT_FOUND', 'The action this tries again is not in the journal.');
  const failed = new Set(failedTargets(original));
  check(original.action === input.action && input.covers.length > 0 && input.covers.every(id => failed.has(id)),
    'INVALID_VENTURE_REQUEST', 'A retry covers only the targets that failed, never one that went or may have gone.');
  const taken = coveredElsewhere(tx.list('venture-journal-entry'), original.id, input.subject);
  check(input.covers.every(id => !taken.has(id)), 'INVALID_VENTURE_REQUEST', 'Another retry already covers some of these targets, so they are not sent again.');
}
