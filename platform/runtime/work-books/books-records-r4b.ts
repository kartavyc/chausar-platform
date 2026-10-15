/**
 * BK-12, round 4: the rest of a record's time line. `records.get` keeps invoices and payments
 * from facts; `records.timelineMore` adds what was said or prepared about the record, each
 * with where it came from:
 *  - reminders and other actions that name the record (core `actions`, including the local
 *    reminder drafts), counted under core's own access rule;
 *  - reminders sent and payments noted in write-back's follow-up journal
 *    (`writeback.followUp.journal`), when that family is installed. Write-back names the
 *    customer by the connected system's id, so only an entry whose id is exactly this record's
 *    (or one joined with it) is shown;
 *  - notes: memory lines that name the record as a whole word, as far as the caller sees them.
 * Nothing here is calculated; entries are listed oldest first, at most 200.
 */
import { check, type Context, type State } from '../contracts.ts';
import { sourceAccess, type ActionService, type PreparedAction } from '../actions.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, mentions, peekBooks, plainId } from './books-common.ts';
import { visibleMemoryLine } from './books-memory.ts';
import { collectRecords, lineNames, recordIdsOf } from './books-records.ts';

export type TimelineEntry = {
  at: string; type: 'reminder' | 'action' | 'reminder-sent' | 'payment-noted' | 'note';
  what: string | null; status: string | null; source: 'actions' | 'writeback-journal' | 'memory'; ref: string | null;
};
const MAX_ENTRIES = 200;
const word = (value: unknown, max = 80): string | null => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value : null;
const instant = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

/** The same access rule `records.holdings` counts actions by: core's own, else the source rule. */
export function actionVisible(host: ModuleHost, state: State, ctx: Context, action: PreparedAction): boolean {
  const actions = host.services.actions as ActionService | undefined;
  try {
    if (typeof actions?.access === 'function') actions.access(state, ctx, action);
    else { sourceAccess(state, ctx, Array.isArray(action.sourceIds) ? action.sourceIds : []); check((action.sourceIds?.length ?? 0) > 0 || action.createdBy === ctx.memberId, 'ACTION_FORBIDDEN', 'This private local action belongs to another account.'); }
    return true;
  } catch { return false; }
}

export async function timelineMore(host: ModuleHost, ctx: Context, id: unknown) {
  check(plainId(id), 'INVALID_BOOKS_REQUEST', 'Name the record.');
  const entry = collectRecords(host, ctx).get(id); check(entry, 'RECORD_NOT_FOUND', 'This record is not available to you.');
  const state = host.store.read(); const ids = recordIdsOf(state, entry.id); const entries: TimelineEntry[] = [];
  for (const action of state.actions as PreparedAction[]) {
    if (!action || typeof action.id !== 'string' || ![...ids].some(i => mentions(action.payload, i)) || !actionVisible(host, state, ctx, action)) continue;
    const at = instant(action.createdAt); if (!at) continue;
    entries.push({ at, type: /reminder/i.test(String(action.operation)) ? 'reminder' : 'action', what: word(action.operation), status: word(action.status, 20), source: 'actions', ref: action.id });
  }
  const journal = await optionalCall<unknown>(host, 'writeback.followUp.journal', {});
  if (journal.available && Array.isArray(journal.value)) for (const raw of journal.value.slice(0, 5000)) {
    const j = raw as Record<string, unknown> | null; if (!j || typeof j !== 'object' || typeof j.customerId !== 'string' || !ids.has(j.customerId)) continue;
    const at = instant(j.at); if (!at || (j.kind !== 'sent' && j.kind !== 'paid')) continue;
    entries.push({ at, type: j.kind === 'sent' ? 'reminder-sent' : 'payment-noted', what: null, status: null, source: 'writeback-journal', ref: word(j.invoiceId, 200) });
  }
  for (const line of peekBooks(state).memory) {
    if (line.deletedAt || line.text === null || !lineNames(line, ids) || !visibleMemoryLine(host.store, ctx, line, host)) continue;
    const at = instant(line.learnedAt); if (!at) continue;
    entries.push({ at, type: 'note', what: line.text.slice(0, 600), status: word(line.status, 20), source: 'memory', ref: line.id });
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref)));
  return { recordId: entry.id, entries: entries.slice(-MAX_ENTRIES), omitted: Math.max(0, entries.length - MAX_ENTRIES), journal: { available: journal.available } };
}

export const recordR4bMethods: Record<string, MethodSpec> = {
  'records.timelineMore': { permission: 'read', async handler(ctx, payload, host) { const { id } = input(payload, ['id'], ['id']); return timelineMore(host, ctx, id); } },
};
