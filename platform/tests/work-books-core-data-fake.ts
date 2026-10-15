/**
 * A stand-in for core-data's one-customer deletion (BK-20), shaped exactly like core-data's round-4 contract
 * (docs/lanes/core-data.md "Round 4 contracts"; platform/runtime/core-data/data.ts and deletion-customer.ts on
 * branch claude/lane-core-data): `deletion.customerPlan { id }` and `deletion.customer { id, confirmation }`,
 * the same request checks, refusal codes and reply fields. It chooses rows more simply than core-data (by the
 * record id named in a fact, an action payload, or a receipt's rows) and works on synthetic data only.
 * `leave` names stores the fake does not empty but still reports as deleted: a core that is wrong, so the
 * work-books recount must catch it.
 */
import { ChausarError, type State } from '../runtime/contracts.ts';

type Store = { read(): State; update<T>(change: (state: State) => T | Promise<T>): Promise<T> };
const STORES = ['facts', 'receipts', 'answers', 'actions', 'conversations'] as const;
type Core = typeof STORES[number];
export const WAITING_REASON = 'An action that is executing or unsure is checked first. It is kept until it is settled, then it can be deleted.';

function fields(payload: unknown, keys: string[]): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ChausarError('INVALID_DELETION_REQUEST', 'Send the request fields as a plain object.');
  const value = payload as Record<string, unknown>;
  if (!Object.keys(value).every(k => keys.includes(k)) || !keys.every(k => value[k] !== undefined)) throw new ChausarError('INVALID_DELETION_REQUEST', 'Send only the declared request fields.');
  return value;
}
function scope(state: State, id: string) {
  const facts = state.facts.filter(f => !f.deletedAt && ['customerId', 'supplierId', 'itemId'].some(k => f.fields?.[k] === id));
  const factIds = new Set(facts.map(f => f.id));
  const receipts = state.receipts.filter(r => (r.rowIds ?? []).some((x: string) => factIds.has(x)));
  const receiptIds = new Set(receipts.map(r => r.id));
  const answers = state.answers.filter(a => receiptIds.has(a.receiptId));
  const actions = state.actions.filter(a => a?.payload?.customerId === id);
  const conversations = state.conversations.filter(c => JSON.stringify(c).includes(JSON.stringify(id)));
  return { facts, receipts, answers, actions, conversations, waiting: actions.filter(a => a.status === 'executing' || a.status === 'unknown') } as Record<Core, any[]> & { waiting: any[] };
}
const planRows = (s: ReturnType<typeof scope>) => STORES.map(store => {
  const count = s[store].length, waiting = store === 'actions' ? s.waiting.length : 0;
  return { store, count, waiting, state: count === 0 ? 'nothing-held' : waiting === count ? 'pending' : 'can-delete', reason: waiting > 0 ? WAITING_REASON : null };
});

export function fakeCoreDeletion(options: { leave?: Core[] } = {}) {
  const leave = new Set(options.leave ?? []);
  return {
    'deletion.customerPlan': (payload: unknown, store: Store) => {
      const { id } = fields(payload, ['id']) as { id: string };
      const s = scope(store.read(), id); const stores = planRows(s);
      if (stores.every(r => r.count === 0) && !store.read().facts.some(f => f.fields?.customerId === id)) throw new ChausarError('RECORD_NOT_FOUND', 'This record is not available to you.');
      return { recordId: id, stores, canDelete: stores.some(r => r.state === 'can-delete') };
    },
    'deletion.customer': async (payload: unknown, store: Store) => {
      const raw = fields(payload, ['id', 'confirmation']);
      if (typeof raw.id !== 'string' || raw.confirmation !== raw.id) throw new ChausarError('CONFIRMATION_REQUIRED', 'Type the customer id exactly to delete.');
      const id = raw.id; const at = '2026-10-15T00:00:00.000Z';
      const before = planRows(scope(store.read(), id));
      if (before.every(r => r.count === 0)) throw new ChausarError('RECORD_NOT_FOUND', 'This record is not available to you.');
      const derived = await store.update(state => {
        const s = scope(state, id); const waiting = new Set(s.waiting.map(a => a.id));
        const gone = (key: Core, rows: any[]) => leave.has(key) ? rows : rows.filter(row => !s[key].includes(row) || (key === 'actions' && waiting.has(row.id)));
        const factIds = new Set(s.facts.map(f => f.id));
        state.facts = gone('facts', state.facts); state.receipts = gone('receipts', state.receipts); state.answers = gone('answers', state.answers);
        state.actions = gone('actions', state.actions); state.conversations = gone('conversations', state.conversations);
        let staleMarked = 0;
        for (const r of state.receipts) if (!leave.has('receipts') && (r.rowIds ?? []).some((x: string) => factIds.has(x))) { r.stale = true; staleMarked++; }
        return { staleMarked, modelReceiptsRemoved: 0, privateRemoved: 0 };
      });
      const after = scope(store.read(), id);
      const rows = before.map(row => {
        const remaining = leave.has(row.store as Core) ? 0 : after[row.store as Core].length;
        if (row.count === 0) return { store: row.store, count: 0, remaining, state: 'nothing-held', reason: null };
        if (remaining === 0) return { store: row.store, count: row.count, remaining, state: 'deleted', reason: null };
        return { store: row.store, count: row.count, remaining, state: 'pending', reason: row.store === 'actions' ? WAITING_REASON : 'Some of it was still found after deleting. It was not reported deleted.' };
      });
      const files = store.read().imports.filter(i => Array.isArray(i?.rowIds) && i.rowIds.length > 0).length;
      return { recordId: id, at, rows, complete: rows.every(r => r.state === 'deleted' || r.state === 'nothing-held'),
        elsewhere: [
          { store: 'source-files', count: files, state: files ? 'not-possible' : 'nothing-held', reason: files ? 'The original file kept with its import still holds these rows. Deleting the whole source in Trust removes it.' : null },
          { store: 'decisions', count: 0, state: 'nothing-held', reason: null },
        ], derived };
    },
  };
}
