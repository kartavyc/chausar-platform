/**
 * Data operations in the core (round 4, core-data items 6 to 9):
 * - `deletion.customerPlan` / `deletion.customer`: one customer's facts, receipts, answers, actions and
 *   conversations (BK-20, TR-13; work-books' `records.delete` calls it);
 * - `deletion.pending` / `deletion.reapply`: deletions that came back with a restore (WK-15), read from the
 *   deletion register kept outside the vault;
 * - `workspace.setTimeZone` / `workspace.timeZone`: the workspace time zone that `ui.context` serves;
 * - `decisions.journal.cancel`: the cancelled state of the decision journal (AS-15).
 * Workspace delete removes `approvals.exportPrepared` files through `prepared-exports.ts`.
 */
import { authorize, audit, check, now, type Context, type State } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import type { ActionService } from '../actions.ts';
import type { ReportService } from '../reports.ts';
import { registerPrivateStatePurgeHook } from '../private-state-lifecycle.ts';
import { mentions } from '../work-books/books-common.ts';
import { recordIdsOf, visibleRecordIds } from '../work-books/books-records.ts';
import { coreScope, deleteCore, erasedIds, factReferences, madeAt, planRows, plainRecordId, rowScope, CORE_STORES, type CoreDeletionRow } from './deletion-customer.ts';
import { addToRegister, bindRegisterDirectory, flushOutbox, peekDataState, registerEntries, registerKey, rowKey, type DeletionKind, type RegisterEntry } from './deletion-register.ts';
import { preparedExportNames, rememberPreparedExports } from './prepared-exports.ts';

// Export names are copied into private state whenever the core purges (source deletion, revocation, keep-period cleanup).
registerPrivateStatePurgeHook(state => { rememberPreparedExports(state); return 0; });

function fields(payload: unknown, allowed: string[], required: string[], code: string): Record<string, any> {
  check(!!payload && typeof payload === 'object' && !Array.isArray(payload) && [Object.prototype, null].includes(Object.getPrototypeOf(payload)), code, 'Send the request fields as a plain object.');
  const value = payload as Record<string, unknown>;
  check(Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k) && value[k] !== undefined), code, 'Send only the declared request fields, with every required field.');
  return value;
}
const actionsOf = (host: ModuleHost) => host.services.actions as ActionService | undefined;

/** Binds the register folder, writes any waiting register entries and keeps export names; only when something is due. */
async function housekeep(host: ModuleHost) {
  bindRegisterDirectory(host.store, host.directory);
  const state = host.store.read(), known = new Set(peekDataState(state)?.exports ?? []);
  if (!(peekDataState(state)?.outbox.length) && preparedExportNames(state).every(n => known.has(n))) return;
  await host.store.update(next => { rememberPreparedExports(next); try { flushOutbox(host.directory, next); } catch { /* stays in the outbox; deletion.pending reports a broken register */ } });
}

// Deletion of one customer (BK-20).
function customerRequest(ctx: Context, payload: unknown, host: ModuleHost, withConfirmation: boolean) {
  const request = fields(payload, withConfirmation ? ['id', 'confirmation'] : ['id'], withConfirmation ? ['id', 'confirmation'] : ['id'], 'INVALID_DELETION_REQUEST');
  check(plainRecordId(request.id), 'INVALID_DELETION_REQUEST', 'Name the customer.');
  const state = host.store.read(), ids = recordIdsOf(state, request.id), scope = coreScope(state, ctx, ids, actionsOf(host));
  // Only a record the caller can see, or one they still hold rows about, is answered; anything else reads as not found.
  check(CORE_STORES.some(s => scope[s].length > 0) || visibleRecordIds(host, ctx).has(request.id), 'RECORD_NOT_FOUND', 'This record is not available to you.');
  return { request, ids, scope };
}

// What came back with a restore (WK-15).
/** A customer entry with its row list comes back by those rows; one without it (too many rows) by the customer's id. */
type Comeback = { entry: RegisterEntry; id: string | null };
const rowKeys = (state: State, entry: RegisterEntry) => { const keys = new Set(entry.rows ?? []), workspace = state.workspace.id; return rowScope(state, keys, id => rowKey(workspace, id)); };
const REFERENCE_KEYS = new Set(['customerId', 'supplierId', 'itemId', 'recordId']);
function referenced(value: unknown, into: Set<string>, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return;
  for (const [key, item] of Object.entries(value)) {
    if (REFERENCE_KEYS.has(key) && typeof item === 'string' && plainRecordId(item)) into.add(item); else referenced(item, into, depth + 1);
  }
}
const sourceDeleted = (state: State, sourceId: string) => state.tombstones.some(t => t?.sourceId === sourceId && (t.kind === 'source' || t.deleted === true));
function comebacks(state: State, entries: RegisterEntry[]): Record<DeletionKind, Comeback[]> {
  const workspace = state.workspace.id, wanted = new Map(entries.map(e => [`${e.kind}:${e.key}`, e]));
  const old = (row: any, entry: RegisterEntry) => { const t = madeAt(row); return typeof t !== 'string' || t <= entry.at; };
  const customers = new Set<string>();
  for (const fact of state.facts) for (const id of factReferences(fact)) customers.add(id);
  for (const merge of state.merges) if (Array.isArray(merge?.entityIds)) for (const id of merge.entityIds) if (typeof id === 'string' && plainRecordId(id)) customers.add(id);
  for (const key of ['receipts', 'answers', 'actions', 'conversations'] as const) for (const row of state[key]) referenced(row, customers);
  const found: Record<DeletionKind, Comeback[]> = { customer: [], source: [] };
  // Each row id is hashed once; an entry is back when any of its rows is present again.
  const present = new Set(CORE_STORES.flatMap(key => state[key].map(row => row?.id)).filter((id): id is string => typeof id === 'string' && id.length > 0).map(id => rowKey(workspace, id)));
  for (const entry of entries) if (entry.kind === 'customer' && Array.isArray(entry.rows) && entry.rows.some(key => present.has(key))) found.customer.push({ entry, id: null });
  for (const id of customers) {
    const entry = wanted.get(`customer:${registerKey(workspace, 'customer', id)}`); if (!entry || Array.isArray(entry.rows)) continue;
    const back = state.facts.some(f => !f.deletedAt && factReferences(f).includes(id) && old(f, entry))
      || (['receipts', 'answers', 'actions', 'conversations'] as const).some(key => state[key].some(row => mentions(row, id) && old(row, entry)));
    if (back) found.customer.push({ entry, id });
  }
  const sources = new Set<string>([...state.facts.map(f => f.sourceId), ...state.imports.map(i => i?.sourceId)].filter((s): s is string => typeof s === 'string' && s.length > 0));
  for (const id of sources) {
    const entry = wanted.get(`source:${registerKey(workspace, 'source', id)}`); if (!entry || sourceDeleted(state, id)) continue;
    if (state.facts.some(f => f.sourceId === id && old(f, entry)) || state.imports.some(i => i?.sourceId === id && old(i, entry))) found.source.push({ entry, id });
  }
  return found;
}
const KIND_NAMES: readonly DeletionKind[] = ['customer', 'source'];
type ReapplyRow = { kind: DeletionKind; cameBack: number; deleted: number; remaining: number; state: CoreDeletionRow['state']; reason: string | null };

export const dataMethods: Record<string, MethodSpec> = {
  'deletion.customerPlan': { permission: 'read', async handler(ctx, payload, host) {
    const { request, scope } = customerRequest(ctx, payload, host, false); const stores = planRows(scope);
    return { recordId: request.id as string, stores, canDelete: stores.some(s => s.state === 'can-delete') };
  } },
  'deletion.customer': { permission: 'approve', async handler(ctx, payload, host) {
    check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot delete anything.');
    const raw = fields(payload, ['id', 'confirmation'], ['id', 'confirmation'], 'INVALID_DELETION_REQUEST');
    check(plainRecordId(raw.id) && typeof raw.confirmation === 'string' && raw.confirmation === raw.id, 'CONFIRMATION_REQUIRED', 'Type the customer id exactly to delete.');
    await housekeep(host);
    const { request, ids } = customerRequest(ctx, payload, host, true); const actions = actionsOf(host);
    // The register is written inside the deletion's own update, before anything goes: a deletion is never left out of
    // it, and a full or broken register stops the deletion. It names the exact rows erased, by keyed hash only.
    const result = await deleteCore(host.store, ctx, state => coreScope(state, ctx, ids, actions), registerKey(host.store.read().workspace.id, 'customer', request.id),
      (scope, state) => { addToRegister(host.directory, state.workspace.id, [{ kind: 'customer', id: request.id, at: now(), rowIds: erasedIds(scope) }]); });
    return { recordId: request.id as string, ...result };
  } },
  'deletion.pending': { permission: 'read', handler(ctx, payload, host) {
    fields(payload, [], [], 'INVALID_DELETION_REQUEST'); bindRegisterDirectory(host.store, host.directory);
    const state = host.store.read(), entries = registerEntries(host.directory, state), found = comebacks(state, entries);
    const kinds = KIND_NAMES.map(kind => ({ kind, cameBack: found[kind].length }));
    return { registered: entries.length, kinds, total: kinds.reduce((sum, k) => sum + k.cameBack, 0) };
  } },
  'deletion.reapply': { permission: 'approve', async handler(ctx, payload, host) {
    check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot delete anything.');
    const request = fields(payload, ['confirmation'], ['confirmation'], 'INVALID_DELETION_REQUEST');
    check(typeof request.confirmation === 'string' && request.confirmation === host.store.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to delete these again.');
    await housekeep(host);
    const before = comebacks(host.store.read(), registerEntries(host.directory, host.store.read()));
    const notes: Record<DeletionKind, Set<string>> = { customer: new Set(), source: new Set() };
    const actions = actionsOf(host);
    for (const { entry, id } of before.customer) {
      // The rows deleted before are deleted again, whoever can see them now; without a row list, what the caller holds from before the deletion.
      const select = id === null ? (state: State) => rowKeys(state, entry) : (state: State) => coreScope(state, ctx, recordIdsOf(state, id), actions, entry.at);
      const result = await deleteCore(host.store, ctx, select, entry.key);
      for (const row of result.rows) if (row.reason) notes.customer.add(row.reason);
    }
    const sources = host.services.sourceDeletion as { delete(sourceId: string, confirmation: string): Promise<unknown> } | undefined;
    for (const { id } of before.source) {
      if (id === null) continue;
      try {
        if (sources) await sources.delete(id, id);
        else { check(authorize(host.store, ctx, 'admin').role === 'owner', 'OWNER_REQUIRED', 'Only the owner can delete a source.'); await host.services.trust.deleteSource(ctx, id); }
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        notes.source.add(code === 'OWNER_REQUIRED' ? 'Only the owner can delete a source again.' : 'This source could not be deleted again here. Delete it in Trust.');
      }
    }
    const after = comebacks(host.store.read(), registerEntries(host.directory, host.store.read()));
    const rows: ReapplyRow[] = KIND_NAMES.map(kind => {
      const cameBack = before[kind].length, remaining = after[kind].filter(c => before[kind].some(b => b.entry.key === c.entry.key)).length;
      const state: ReapplyRow['state'] = cameBack === 0 ? 'nothing-held' : remaining === 0 ? 'deleted' : notes[kind].size && remaining === cameBack && kind === 'source' ? 'not-possible' : 'pending';
      const reason = remaining === 0 ? null : [...notes[kind]][0] ?? 'Some of it is held by another person or is outside your access. They delete it again.';
      return { kind, cameBack, deleted: cameBack - remaining, remaining, state, reason };
    });
    const at = now();
    await host.store.update(state => { audit(state, 'deletion.reapplied', { kinds: rows.map(r => ({ kind: r.kind, cameBack: r.cameBack, remaining: r.remaining })) }); });
    return { at, complete: rows.every(r => r.remaining === 0), kinds: rows };
  } },

  // Workspace time zone (TD-04).
  'workspace.setTimeZone': { permission: 'admin', async handler(ctx, payload, host) {
    check(!ctx.sourceTainted, 'TAINTED_SETTING', 'Imported text cannot change workspace settings.');
    const { timeZone } = fields(payload, ['timeZone'], ['timeZone'], 'INVALID_TIME_ZONE');
    let zone: string | undefined;
    // A name the runtime accepts, spelled as the zone list spells it (Intl itself would answer an older alias such as Asia/Calcutta).
    try { if (typeof timeZone === 'string' && timeZone.length <= 100 && /^[A-Za-z0-9_+\-/]+$/.test(timeZone) && new Intl.DateTimeFormat('en', { timeZone })) zone = Intl.supportedValuesOf('timeZone').find(z => z.toLowerCase() === timeZone.toLowerCase()) ?? timeZone; } catch { zone = undefined; }
    check(zone, 'INVALID_TIME_ZONE', 'Choose a time zone by its name, such as Asia/Kolkata.');
    return host.store.update(state => {
      authorize({ read: () => state, update: async () => { throw new Error('The settings view is read-only.'); } }, ctx, 'admin');
      (state.workspace as State['workspace']).timeZone = zone; audit(state, 'workspace.timeZone.set', { timeZone: zone });
      return { timeZone: zone };
    });
  } },
  'workspace.timeZone': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, [], [], 'INVALID_TIME_ZONE'); const zone = host.store.read().workspace.timeZone;
    try { return { timeZone: typeof zone === 'string' && zone.length <= 100 && new Intl.DateTimeFormat('en', { timeZone: zone }) ? zone : null }; } catch { return { timeZone: null }; }
  } },

  // Decision journal: the cancelled state (AS-15). The decided-on date enters through the draft's content.
  'decisions.journal.cancel': { permission: 'prepare', async handler(ctx, payload, host) {
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_DECISION_REQUIRED', 'Prepare and review an internal decision explicitly inside the app.');
    const request = fields(payload, ['id', 'revision', 'reason'], ['id', 'revision', 'reason'], 'INVALID_CANCELLATION');
    check(typeof request.id === 'string' && request.id.trim().length > 0 && request.id.length <= 200, 'INVALID_CANCELLATION', 'Identify the decision to cancel.');
    check(typeof request.revision === 'number' && Number.isSafeInteger(request.revision) && request.revision >= 1, 'REVISION_CONFLICT', 'Supply the loaded journal revision before changing it.');
    check(typeof request.reason === 'string' && request.reason.trim().length > 0 && request.reason.length <= 2000, 'INVALID_CANCELLATION', 'Say in a sentence why the decision is cancelled.');
    return (host.services.reports as ReportService).cancelJournalDecision(ctx, request.id, { expectedRevision: request.revision, reason: request.reason });
  } },
};
