/**
 * Deleting one customer's core rows (BK-20, TR-13): facts, receipts, saved answers, actions and
 * conversations. The rows chosen are exactly the ones work-books' `holdingsOf` counts for the caller in
 * those five stores: every id joined with the customer by a join that was not undone, facts the caller can
 * see, the caller's own receipts, answers and conversations, and actions under the action service's own
 * access rule. Deleting follows the source deletion in `trust.ts`: each fact leaves a content tombstone,
 * derived private state is purged through `private-state-lifecycle.ts` (which runs every module's purge
 * hook), model receipts that carried the rows go with a payload tombstone, and every other answer or
 * receipt that used a deleted row is marked stale. An action that is executing or unsure is never erased:
 * it is checked first, so it stays and the report says so.
 */
import { authorize, audit, check, hash, newId, now, type Context, type Fact, type State, type StateStore } from '../contracts.ts';
import { sourceAccess, type ActionService, type PreparedAction } from '../actions.ts';
import { canSeeFact, resolveCustomer } from '../memory.ts';
import { coreLifecycleIds, purgePrivateState } from '../private-state-lifecycle.ts';
import { mentions } from '../work-books/books-common.ts';

export const CORE_STORES = ['facts', 'receipts', 'answers', 'actions', 'conversations'] as const;
export type CoreStore = typeof CORE_STORES[number];
export type RowState = 'deleted' | 'pending' | 'not-possible' | 'nothing-held';
export type CoreDeletionRow = { store: CoreStore; count: number; remaining: number; state: RowState; reason: string | null };
/** Copies outside the five stores that this deletion cannot change, named honestly (TR-13). */
export type HeldElsewhere = { store: 'source-files' | 'decisions'; count: number; state: 'not-possible' | 'nothing-held'; reason: string | null };
export type PlanRow = { store: CoreStore; count: number; waiting: number; state: 'can-delete' | 'pending' | 'nothing-held'; reason: string | null };
export type Scope = Record<CoreStore, any[]> & { waiting: PreparedAction[] };

export const WAITING_REASON = 'An action that is executing or unsure is checked first. It is kept until it is settled, then it can be deleted.';
const GONE_REASON = 'Some of it was still found after deleting. It was not reported deleted.';
const STALE_REASON = 'A customer\'s records were deleted.';
const REFERENCE_KEYS = ['customerId', 'supplierId', 'itemId'];
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const view = (state: State): StateStore => ({ read: () => state, update: async () => { throw new Error('The deletion view is read-only.'); } });

/** The record ids one fact names, as work-books reads them. */
export function factReferences(fact: Fact): string[] { return REFERENCE_KEYS.map(k => fact.fields?.[k]).filter(str); }
/** A plain record id, as work-books accepts one. */
export const plainRecordId = (value: unknown): value is string => typeof value === 'string' && /^[^\u0000-\u001f]{1,200}$/.test(value);
/** The time a stored row was made, when it says. */
export const madeAt = (row: any): unknown => row?.learnedAt ?? row?.createdAt ?? row?.at;

function visibleAction(state: State, ctx: Context, actions: ActionService | undefined, action: PreparedAction) {
  try {
    if (typeof actions?.access === 'function') actions.access(state, ctx, action);
    else { sourceAccess(state, ctx, Array.isArray(action.sourceIds) ? action.sourceIds : []); check((action.sourceIds?.length ?? 0) > 0 || action.createdBy === ctx.memberId, 'ACTION_FORBIDDEN', 'This private local action belongs to another account.'); }
    return true;
  } catch { return false; }
}

/**
 * What the caller holds about `ids` in the five core stores, read from `state`. `before` (an ISO time)
 * keeps only rows made at or before it: re-applying a deletion never touches what was added after it.
 */
export function coreScope(state: State, ctx: Context, ids: ReadonlySet<string>, actions: ActionService | undefined, before?: string): Scope {
  const store = view(state), at = now(), list = [...ids];
  const old = (row: any) => { if (before === undefined) return true; const t = madeAt(row); return typeof t !== 'string' || t <= before; };
  const about = (value: unknown) => list.some(i => mentions(value, i));
  const facts = state.facts.filter(f => !f.deletedAt && canSeeFact(store, ctx, f) && list.some(i => resolveCustomer(state, f.fields.customerId, at) === i || factReferences(f).includes(i)) && old(f));
  const factIds = new Set(facts.map(f => f.id));
  const ownReceipts = state.receipts.filter(r => r?.memberId === ctx.memberId);
  const receipts = ownReceipts.filter(r => (about(r.rows) || (r.rowIds ?? []).some((rid: string) => factIds.has(rid))) && old(r));
  const receiptIds = new Set(receipts.map(r => r.id)), ownReceiptIds = new Set(ownReceipts.map(r => r.id));
  const answers = state.answers.filter(a => ownReceiptIds.has(a?.receiptId) && (receiptIds.has(a.receiptId) || about(a.request)) && old(a));
  const held = (state.actions as PreparedAction[]).filter(a => about(a) && visibleAction(state, ctx, actions, a) && old(a));
  const conversations = state.conversations.filter(c => c?.memberId === ctx.memberId && about(c) && old(c));
  return { facts, receipts, answers, actions: held, conversations, waiting: held.filter(a => a.status === 'executing' || a.status === 'unknown') };
}

export function planRows(scope: Scope): PlanRow[] {
  return CORE_STORES.map(store => {
    const count = scope[store].length, waiting = store === 'actions' ? scope.waiting.length : 0;
    return { store, count, waiting, state: count === 0 ? 'nothing-held' : waiting === count ? 'pending' : 'can-delete', reason: waiting > 0 ? WAITING_REASON : null };
  });
}

const ROW_STORES: readonly CoreStore[] = CORE_STORES;
/** The ids of the rows a scope erases: every row but an action that is executing or unsure. */
export function erasedIds(scope: Scope): string[] {
  const waiting = new Set(scope.waiting.map(a => a.id));
  return ROW_STORES.flatMap(s => scope[s].filter(row => !(s === 'actions' && waiting.has(row.id))).map(row => row?.id)).filter(str);
}
/** Exactly the rows whose keyed hash is in `keys` (re-applying a recorded deletion), whoever made them. */
export function rowScope(state: State, keys: ReadonlySet<string>, keyOf: (rowId: string) => string): Scope {
  const pick = (rows: any[]) => rows.filter(row => str(row?.id) && keys.has(keyOf(row.id)));
  const held = pick(state.actions) as PreparedAction[];
  return { facts: pick(state.facts), receipts: pick(state.receipts), answers: pick(state.answers), actions: held, conversations: pick(state.conversations), waiting: held.filter(a => a.status === 'executing' || a.status === 'unknown') };
}

/**
 * Deletes the scope `select` chooses inside one store update and returns the per-store report after
 * choosing again. `record` runs inside the update before anything is erased (the deletion register); if it
 * refuses, nothing is deleted. Rows still found afterwards are `pending`, never `deleted`.
 */
export async function deleteCore(store: StateStore, ctx: Context, select: (state: State) => Scope, auditKey: string, record?: (scope: Scope, state: State) => void) {
  const at = now();
  const result = await store.update(state => {
    authorize(view(state), ctx, 'approve');
    const scope = select(state); record?.(scope, state);
    const previousIds = coreLifecycleIds(state);
    const factIds = new Set(scope.facts.map(f => f.id));
    const gone = new Set<string>([...factIds, ...scope.receipts.map(r => r.id), ...scope.answers.map(a => a.id), ...scope.conversations.map(c => c.id).filter(str)]);
    const waiting = new Set(scope.waiting.map(a => a.id));
    const erasable = new Set(scope.actions.filter(a => !waiting.has(a.id)).map(a => a.id));
    for (const fact of scope.facts) state.tombstones.push({ id: newId('tombstone'), kind: 'content', factId: fact.id, sourceId: fact.sourceId, contentHash: hash(fact), deletedAt: at });
    const receipts = new Set(scope.receipts), answers = new Set(scope.answers), conversations = new Set(scope.conversations);
    state.facts = state.facts.filter(f => !factIds.has(f.id));
    state.receipts = state.receipts.filter(r => !receipts.has(r));
    state.answers = state.answers.filter(a => !answers.has(a));
    state.conversations = state.conversations.filter(c => !conversations.has(c));
    state.actions = state.actions.filter(a => !erasable.has(a?.id));
    for (const id of erasable) gone.add(id);
    // Derived copies: a model receipt that carried a deleted row goes, leaving a payload tombstone so it is never sent again.
    const linked = (value: unknown, depth = 0): boolean => typeof value === 'string' ? gone.has(value)
      : !!value && typeof value === 'object' && depth < 24 && (Array.isArray(value) ? value : Object.values(value)).some(v => linked(v, depth + 1));
    let modelReceipts = 0;
    state.modelReceipts = state.modelReceipts.filter(m => {
      if (!linked(m)) return true;
      if (m?.digest) state.tombstones.push({ id: newId('tombstone'), kind: 'payload', digest: m.digest, deletedAt: at });
      modelReceipts++; return false;
    });
    // Anything else that used a deleted row (another person's receipt, for example) is no longer current.
    let stale = 0;
    for (const item of [...state.answers, ...state.receipts]) if (linked(item.rowIds) || linked(item.rows) || linked(item.receiptId)) { if (item.stale !== true) stale++; item.stale = true; item.staleReason = STALE_REASON; }
    // The original file kept with an import, and a decision's receipts as known on its day, are sealed records: named, not changed.
    const files = state.imports.filter(i => Array.isArray(i?.rowIds) && i.rowIds.some((r: unknown) => typeof r === 'string' && factIds.has(r))).length;
    const decisions = state.decisions.filter(d => linked(d?.rowIds) || linked(d?.receiptIds)).length;
    const elsewhere: HeldElsewhere[] = [
      { store: 'source-files', count: files, state: files ? 'not-possible' : 'nothing-held', reason: files ? 'The original file kept with its import still holds these rows. Deleting the whole source in Trust removes it.' : null },
      { store: 'decisions', count: decisions, state: decisions ? 'not-possible' : 'nothing-held', reason: decisions ? 'A decision keeps the receipts as they were known on its day. They stay with the decision.' : null },
    ];
    const retainedIds = coreLifecycleIds(state);
    const privateRemoved = purgePrivateState(state, { removedIds: [...previousIds].filter(id => !retainedIds.has(id)), expiredFactIds: factIds, at });
    const counts = Object.fromEntries(CORE_STORES.map(s => [s, s === 'actions' ? erasable.size : scope[s].length]));
    audit(state, 'deletion.customer', { key: auditKey, removed: counts, kept: waiting.size, modelReceipts, stale, privateRemoved });
    return { before: planRows(scope), elsewhere, derived: { staleMarked: stale, modelReceiptsRemoved: modelReceipts, privateRemoved } };
  });
  const after = select(store.read());
  const rows: CoreDeletionRow[] = result.before.map(row => {
    const remaining = after[row.store].length;
    if (row.count === 0) return { store: row.store, count: 0, remaining, state: 'nothing-held', reason: null };
    if (remaining === 0) return { store: row.store, count: row.count, remaining, state: 'deleted', reason: null };
    return { store: row.store, count: row.count, remaining, state: 'pending', reason: row.store === 'actions' && after.waiting.length === remaining ? WAITING_REASON : GONE_REASON };
  });
  return { at, rows, complete: rows.every(r => r.state === 'deleted' || r.state === 'nothing-held'), elsewhere: result.elsewhere, derived: result.derived };
}
