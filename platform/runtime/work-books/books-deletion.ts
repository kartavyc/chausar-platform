/**
 * Deleting what we hold about one customer (BK-20, with the report of TR-13). The lane can
 * delete only what it keeps itself: agreements and stop words, same-or-not decisions and
 * memory lines that name the customer. Facts, receipts, saved answers, actions and
 * conversations live in the core: with core-data's one-customer deletion installed (round 4,
 * `books-deletion-r4b.ts`) they are planned by `deletion.customerPlan` and deleted by one
 * `deletion.customer` call; without it those rows say so and name who can remove them.
 * Nothing is reported deleted until it was counted again and gone.
 */
import { check, newId, now, type Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, member, peekBooks, plainId, seesEverything, text, writeBooks, type BooksState } from './books-common.ts';
import { holdingRowsOf, holdingsOf, lineNames, recordIdsOf, stillHeld, visibleRecordIds } from './books-records.ts';
import { visibleMemoryLine } from './books-memory.ts';
import { peekSection } from './state.ts';
import { CORE_STORES, coreDeletionInstalled, corePlan, deleteCoreRows, type Derived, type Elsewhere } from './books-deletion-r4b.ts';

type RowState = 'deleted' | 'pending' | 'not-possible' | 'nothing-held';
export type DeletionRow = { store: string; count: number; state: RowState; reason: string | null };
/** `elsewhere` and `derived`: core-data's copies outside the five stores and what it changed around them (null when the core was not called). */
export type DeletionReport = { id: string; recordId: string; at: string; by: string; complete: boolean; rows: DeletionRow[]; elsewhere?: Elsewhere[] | null; derived?: Derived | null };
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
const GONE = 'Some of it was still found after deleting. It was not reported deleted.';

type PlanState = 'can-delete' | 'needs-owner' | 'pending' | 'nothing-held';
/** `waiting`: core-data's own count of actions that are executing or unsure, kept until settled (core-plan rows only). */
type PlanRow = { store: string; count: number; state: PlanState; reason: string | null; waiting?: number };
const PLAN_REFUSED = (code: string) => `The core could not say what it would delete (${code}). Nothing in the core is deleted from here.`;
/**
 * What each store will do. `core`: core-data's one-customer deletion is installed (round 4). Its plan
 * (`deletion.customerPlan`), when installed, gives the core stores' counts, the actions it waits for and its reasons;
 * without the plan the stores this lane counted are offered. core-data chooses exactly the rows counted here for the
 * caller, so no full-access rule applies (review 4's `'*'` requirement is dropped; see docs/lanes/work-books.md).
 */
async function plan(host: ModuleHost, ctx: Context, id: unknown, core: boolean): Promise<{ stores: PlanRow[]; planFrom: 'core' | 'here' }> {
  const counted = holdingsOf(host, ctx, id);
  const fromCore = core ? await corePlan(host, id as string) : null;
  const stores = counted.map(({ store, count }): PlanRow => {
    if (!CORE_STORES.has(store) || !core) {
      const can = OURS.has(store);
      return { store, count, state: count === 0 ? 'nothing-held' : can ? 'can-delete' : 'needs-owner', reason: count > 0 && !can ? NEEDS_OWNER[store] ?? 'This store has no delete for one customer.' : null };
    }
    if (fromCore?.code) return { store, count, state: count === 0 ? 'nothing-held' : 'needs-owner', reason: count > 0 ? PLAN_REFUSED(fromCore.code) : null };
    const row = fromCore?.rows?.find(r => r.store === store);
    if (row) return { store, count: row.count, state: row.state, reason: row.reason, waiting: row.waiting };
    return { store, count, state: count === 0 ? 'nothing-held' : 'can-delete', reason: null };
  });
  return { stores, planFrom: fromCore?.rows ? 'core' : 'here' };
}
function reportsOf(books: BooksState): StoredReport[] {
  const holder = books as unknown as Record<string, unknown>;
  if (!Array.isArray(holder.deletions)) holder.deletions = [];
  return holder.deletions as StoredReport[];
}

export const deletionMethods: Record<string, MethodSpec> = {
  'records.deletionPlan': { permission: 'read', async handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']); const core = await coreDeletionInstalled(host); const { stores, planFrom } = await plan(host, ctx, id, core);
    const sources = await optionalCall(host, 'trustx.deletions', {});
    // `planFrom`: 'core' when core-data's own plan gave the core stores (with `waiting` and its reasons), 'here' when this lane counted them.
    return { recordId: id as string, stores, canDelete: stores.some(s => s.state === 'can-delete'), sourceDeletion: { available: sources.available },
      coreDeletion: { available: core, planFrom } };
  } },
  'records.delete': { permission: 'approve', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'confirmation'], ['id', 'confirmation']);
    check(plainId(request.id), 'INVALID_BOOKS_REQUEST', 'Name the record.');
    check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot delete anything.');
    check(text(request.confirmation, 200) && request.confirmation === request.id, 'CONFIRMATION_REQUIRED', 'Type the customer id exactly to delete.');
    const core = await coreDeletionInstalled(host);
    const { stores: before } = await plan(host, ctx, request.id, core);
    // The exact core rows counted now, recounted by key after the deletion (a receipt is no longer found through deleted facts).
    const snapshot = new Map(holdingRowsOf(host, ctx, request.id).filter(s => s.keys).map(s => [s.store, s.keys!]));
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
    // Round 4: the core stores through core-data's one-customer deletion, once, only when it is installed and offers something.
    const coreCall = core && before.some(s => CORE_STORES.has(s.store) && s.state === 'can-delete') ? await deleteCoreRows(host, request.id, request.confirmation) : null;
    const afterState = host.store.read();
    const after = new Map(holdingRowsOf(host, ctx, request.id, true).map(s => [s.store,
      s.keys ? new Set([...s.keys, ...stillHeld(afterState, s.store, snapshot.get(s.store) ?? new Set())]).size : s.count]));
    const rows: DeletionRow[] = before.map(s => {
      if (s.state === 'nothing-held') return { store: s.store, count: 0, state: 'nothing-held', reason: null };
      if (s.state === 'needs-owner') return { store: s.store, count: s.count, state: 'not-possible', reason: s.reason };
      const left = after.get(s.store) ?? 0;
      if (!CORE_STORES.has(s.store)) return left === 0 ? { store: s.store, count: s.count, state: 'deleted', reason: null } : { store: s.store, count: s.count, state: 'pending', reason: GONE };
      // A core store is deleted only when the recount here and core-data's own row agree that nothing is left.
      const said = coreCall?.rows?.find(r => r.store === s.store);
      if (left === 0 && (!said || said.remaining === 0)) return { store: s.store, count: s.count, state: 'deleted', reason: null };
      const reason = coreCall?.code ? `The core deletion refused (${coreCall.code}). Nothing here was reported deleted.` : said?.reason ?? s.reason ?? GONE;
      return { store: s.store, count: s.count, state: 'pending', reason };
    });
    const report: StoredReport = { id: newId('deletion'), recordId: request.id, at, by: who.name, complete: rows.every(r => r.state === 'deleted' || r.state === 'nothing-held'), rows,
      elsewhere: coreCall?.elsewhere ?? null, derived: coreCall?.derived ?? null, memberId: ctx.memberId };
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
