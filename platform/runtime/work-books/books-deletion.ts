/**
 * Deleting what we hold about one customer (BK-20, with the report of TR-13). The lane can
 * delete only what it keeps itself: agreements and stop words, same-or-not decisions and
 * memory lines that name the customer. Facts, receipts, saved answers, actions and
 * conversations live in the core, which has no per-customer delete; those rows say so and
 * name who can remove them. Nothing is reported deleted until it was counted again and gone.
 */
import { check, newId, now, type Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, member, peekBooks, plainId, seesEverything, text, writeBooks, type BooksState } from './books-common.ts';
import { holdingsOf, lineNames, recordIdsOf, visibleRecordIds } from './books-records.ts';
import { visibleMemoryLine } from './books-memory.ts';
import { peekSection } from './state.ts';

type RowState = 'deleted' | 'pending' | 'not-possible' | 'nothing-held';
export type DeletionRow = { store: string; count: number; state: RowState; reason: string | null };
export type DeletionReport = { id: string; recordId: string; at: string; by: string; complete: boolean; rows: DeletionRow[] };
/** As stored: who made the report, kept so only they and the administrators read it back. */
type StoredReport = DeletionReport & { memberId?: string };
const shown = ({ memberId: _m, ...report }: StoredReport): DeletionReport => report;

/** Stores this lane keeps and can delete from. */
const OURS = new Set(['memory', 'opt-ins', 'matches']);
/** Why each core store cannot be emptied for one customer from here. */
const NEEDS_OWNER: Readonly<Record<string, string>> = {
  facts: 'These rows came from your source files and systems. Remove them there and read the source again, or delete the whole source in Trust.',
  receipts: 'Receipts are kept by the core with the answers they prove. Deleting the source removes them.',
  answers: 'Saved answers are kept by the core. Deleting the source marks them; the core has no delete for one customer.',
  actions: 'The actions record is kept so a sent change can be checked. The core has no delete for one customer.',
  conversations: 'Conversations are kept by the core. The owner deletes them with the conversation.',
};
const MAX_REPORTS = 500;

function plan(host: ModuleHost, ctx: Context, id: unknown) {
  return holdingsOf(host, ctx, id).map(({ store, count }) => ({
    store, count, state: count === 0 ? 'nothing-held' as const : OURS.has(store) ? 'can-delete' as const : 'needs-owner' as const,
    reason: count > 0 && !OURS.has(store) ? NEEDS_OWNER[store] ?? 'This store has no delete for one customer.' : null,
  }));
}
function reportsOf(books: BooksState): StoredReport[] {
  const holder = books as unknown as Record<string, unknown>;
  if (!Array.isArray(holder.deletions)) holder.deletions = [];
  return holder.deletions as StoredReport[];
}

export const deletionMethods: Record<string, MethodSpec> = {
  'records.deletionPlan': { permission: 'read', async handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']); const stores = plan(host, ctx, id);
    const sources = await optionalCall(host, 'trustx.deletions', {});
    return { recordId: id as string, stores, canDelete: stores.some(s => s.state === 'can-delete'), sourceDeletion: { available: sources.available } };
  } },
  'records.delete': { permission: 'approve', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'confirmation'], ['id', 'confirmation']);
    check(plainId(request.id), 'INVALID_BOOKS_REQUEST', 'Name the record.');
    check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot delete anything.');
    check(text(request.confirmation, 200) && request.confirmation === request.id, 'CONFIRMATION_REQUIRED', 'Type the customer id exactly to delete.');
    const before = plan(host, ctx, request.id);
    check(before.some(s => s.state === 'can-delete') || before.every(s => s.state === 'nothing-held'), 'DELETION_NOT_AVAILABLE',
      'Chausar cannot delete these records itself. Facts, receipts, answers, actions and conversations need the owner to remove the source.');
    const ids = recordIdsOf(host.store.read(), request.id); const who = member(host.store.read(), ctx); const at = now();
    // The memory store counts only lines the caller can see; only those are deleted.
    const visibleLines = new Set(before.some(s => s.store === 'memory' && s.count > 0)
      ? peekBooks(host.store.read()).memory.filter(l => !l.deletedAt && visibleMemoryLine(host.store, ctx, l, host) && lineNames(l, ids)).map(l => l.id) : []);
    // Same-or-not decisions are counted only when the caller can see both customers (holdingsOf); only those are deleted.
    const visible = visibleRecordIds(host, ctx);
    const deletable = (m: { left: string; right: string }) => (ids.has(m.left) || ids.has(m.right)) && visible.has(m.left) && visible.has(m.right);
    await writeBooks(host.store, ctx, 'approve', books => {
      books.optIns = books.optIns.filter(o => !ids.has(o.recordId)); books.stops = books.stops.filter(s => !ids.has(s.recordId));
      books.matches = books.matches.filter(m => !deletable(m));
      for (const line of books.memory) if (visibleLines.has(line.id)) { line.text = null; line.earlier = []; line.deletedAt = at; }
    });
    const after = new Map(holdingsOf(host, ctx, request.id).map(s => [s.store, s.count]));
    const rows: DeletionRow[] = before.map(s => s.state === 'nothing-held' ? { store: s.store, count: 0, state: 'nothing-held', reason: null }
      : s.state === 'needs-owner' ? { store: s.store, count: s.count, state: 'not-possible', reason: s.reason }
      : (after.get(s.store) ?? 0) === 0 ? { store: s.store, count: s.count, state: 'deleted', reason: null }
      : { store: s.store, count: s.count, state: 'pending', reason: 'Some of it was still found after deleting. It was not reported deleted.' });
    const report: StoredReport = { id: newId('deletion'), recordId: request.id, at, by: who.name, complete: rows.every(r => r.state === 'deleted' || r.state === 'nothing-held'), rows, memberId: ctx.memberId };
    await writeBooks(host.store, ctx, 'approve', books => { const reports = reportsOf(books); reports.push(report); if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS); });
    return shown(report);
  } },
  'records.deletions': { permission: 'read', handler(ctx, payload, host) {
    input(payload, []); const state = host.store.read(); const list = peekSection<Record<string, unknown>>(state, 'books')?.deletions;
    // Reports are proof of what was removed; they name the record id, so each is read back only by the
    // person who made it and by an owner or cofounder who sees every branch.
    const all = seesEverything(state, ctx);
    return { reports: (Array.isArray(list) ? list as StoredReport[] : []).filter(r => all || (r.memberId !== undefined && r.memberId === ctx.memberId)).slice().reverse().map(shown) };
  } },
};
