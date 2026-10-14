/**
 * The decision log: every mapping, identity, accounts-label, action, procedure, calculation and
 * dictionary-edit decision, kept on this machine. An entry holds a structural event built from the
 * shared vocabulary, plus local references (source and record identifiers) used only to scope,
 * show and purge it. Nothing in an entry is a value, a name or an amount.
 */
import { audit, check, newId, now, type Context, type State } from '../contracts.ts';
import { current, digest } from '../actions.ts';
import { assertSourceAccess } from '../trust.ts';
import { assertLearningDecisionRecord } from '../learning.ts';
import { area, canSee, peekArea, ids, limitOf, oneOf } from './state.ts';
import { structuralEvent } from './structure.ts';
import { DECISION_KINDS, REPORT_SHAPES, type StructuralEvent } from './vocabulary.ts';

export type LogEntry = {
  id: string; at: string; memberId: string; role: Context['role']; epoch: number;
  sourceIds: string[]; refs: string[]; event: StructuralEvent; integrity: string;
};
export type LogView = { id: string; at: string; origin: 'lane' | 'import'; event: StructuralEvent; sourceIds: string[]; refs: string[] };
export type DecisionRecord = { event: unknown; sourceIds?: unknown; refs?: unknown };

export const logOf = (state: State) => area<LogEntry[]>(state, 'log', () => []);
const LOG_LIMIT = 50_000, MEMBER_LIMIT = 20_000;

/** Append inside the caller's transaction, so a decision commits with the change it describes. */
export function recordDecision(state: State, ctx: Context, input: DecisionRecord): LogEntry {
  current(state, ctx, 'prepare');
  const event = structuralEvent(input.event), sourceIds = ids(input.sourceIds, 'source identifiers'), refs = ids(input.refs, 'references');
  assertSourceAccess(state, ctx, sourceIds);
  const log = logOf(state);
  // A bounded ring: decisions past retention go first, then the author's own oldest past their quota, then the oldest overall.
  const cutoff = Date.now() - state.policy.retentionDays * 86_400_000;
  if (log.some(entry => Date.parse(entry.at) < cutoff)) log.splice(0, log.length, ...log.filter(entry => Date.parse(entry.at) >= cutoff));
  const own = log.filter(entry => entry.memberId === ctx.memberId);
  if (own.length >= MEMBER_LIMIT) log.splice(log.indexOf(own[0]), 1);
  if (log.length >= LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT + 1);
  const record = { id: newId('decision'), at: now(), memberId: ctx.memberId, role: ctx.role, epoch: ctx.epoch, sourceIds, refs, event };
  const entry: LogEntry = { ...record, integrity: digest(record) };
  log.push(entry); audit(state, 'learningx.logged', { id: entry.id, kind: event.kind, choice: event.choice });
  return structuredClone(entry);
}
export function entryIntact(entry: LogEntry): boolean {
  const { integrity, ...record } = entry;
  return integrity === digest(record);
}

const coreReasons: Record<string, StructuralEvent['reason']> = {
  manual_confirmation: 'manual-confirmation', ambiguous_field: 'ambiguous-field', type_match: 'type-match', date_format: 'date-format',
  currency_mismatch: 'currency-mismatch', duplicate_record: 'duplicate-record', exact_reference: 'exact-reference', reconciliation: 'reconciliation',
  unsupported_shape: 'unsupported-shape', verified_readback: 'verified-readback',
};
/** The engine's own import and mapping decisions (state.learning), as structural events. */
export function coreDecisions(state: State, ctx: Context): LogView[] {
  const views: LogView[] = [];
  for (const record of state.learning) {
    if (record?.type !== 'decision') continue;
    try { assertLearningDecisionRecord(record); } catch { continue; }
    if (record.memberId !== ctx.memberId && ctx.role !== 'owner' || !canSee(state, ctx, record.sourceIds)) continue;
    const input = record.input;
    let event: StructuralEvent;
    // The engine keeps its raw input; anything outside the vocabulary is left out, and a bad record never breaks the log.
    try {
      event = structuralEvent({
        kind: input.kind === 'customer-match' ? 'identity' : input.kind, choice: input.choice,
        ...(typeof input.reasonCode === 'string' && Object.hasOwn(coreReasons, input.reasonCode) ? { reason: coreReasons[input.reasonCode] } : {}),
        ...((REPORT_SHAPES as readonly unknown[]).includes(input.reportShape) ? { shape: input.reportShape } : {}),
        ...(Array.isArray(input.fields) ? { fields: input.fields } : {}),
      });
    } catch { continue; }
    views.push({ id: record.id, at: record.at, origin: 'import', event, sourceIds: [...record.sourceIds], refs: record.importIdentity ? [record.importIdentity.id] : [] });
  }
  return views;
}
/** Every decision the caller may see: an author sees their own; an owner sees all within source access. */
export function visibleDecisions(state: State, ctx: Context): LogView[] {
  current(state, ctx);
  const lane = logOf(state).filter(entry => entryIntact(entry) && (entry.memberId === ctx.memberId || ctx.role === 'owner') && canSee(state, ctx, entry.sourceIds))
    .map(entry => ({ id: entry.id, at: entry.at, origin: 'lane' as const, event: structuredClone(entry.event), sourceIds: [...entry.sourceIds], refs: [...entry.refs] }));
  return [...coreDecisions(state, ctx), ...lane].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function logPage(state: State, ctx: Context, payload: Record<string, unknown>) {
  const kind = payload.kind === undefined ? undefined : oneOf(payload.kind, DECISION_KINDS);
  const limit = limitOf(payload.limit, 100, 500);
  check(payload.before === undefined || typeof payload.before === 'string' && payload.before.length <= 200, 'INVALID_REQUEST', 'Page with an earlier decision identifier.');
  let items = visibleDecisions(state, ctx).filter(item => !kind || item.event.kind === kind).reverse();
  const total = items.length;
  if (payload.before) { const index = items.findIndex(item => item.id === payload.before); check(index >= 0, 'NOT_FOUND', 'That decision is no longer in the log.'); items = items.slice(index + 1); }
  const page = items.slice(0, limit);
  return { items: page, total, next: items.length > limit ? page.at(-1)!.id : null };
}

export function logSummary(state: State, ctx: Context) {
  const items = visibleDecisions(state, ctx);
  const byKind: Record<string, Record<string, number>> = {};
  for (const item of items) { const row = byKind[item.event.kind] ??= {}; row[item.event.choice] = (row[item.event.choice] ?? 0) + 1; }
  return { total: items.length, byKind, structureOnly: true };
}

/** Remove decisions derived from deleted or revoked sources and records. */
export function purgeLog(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; cutoff?: number }): number {
  const log = peekArea<LogEntry[]>(state, 'log');
  if (!log) return 0;
  const before = log.length;
  const old = (at: string) => reason.cutoff !== undefined && !(Date.parse(at) >= reason.cutoff);
  const kept = log.filter(entry => !old(entry.at) && !entry.sourceIds.some(id => reason.sourceIds.includes(id) || reason.removedIds.has(id)) && !entry.refs.some(id => reason.removedIds.has(id)));
  log.splice(0, log.length, ...kept);
  return before - kept.length;
}
