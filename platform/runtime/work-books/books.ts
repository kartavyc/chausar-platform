import type { MethodSpec, EngineModule } from '../modules/types.ts';
import { peekSection } from './state.ts';
import type { BooksState } from './books-common.ts';
import { sourceMethods } from './books-sources.ts';
import { meaningMethods } from './books-meanings.ts';
import { memoryMethods } from './books-memory.ts';
import { accountMethods } from './books-accounts.ts';
import { recordMethods } from './books-records.ts';
import { historyMethods } from './books-history.ts';
import { billMethods } from './books-bill.ts';
import { rateMethods } from './books-rates.ts';
import { deletionMethods } from './books-deletion.ts';

/** books, accounts, records and history methods of the work-books lane (BK-01..BK-20). */
export const booksMethods: Readonly<Record<string, MethodSpec>> = {
  ...sourceMethods, ...meaningMethods, ...memoryMethods, ...accountMethods, ...recordMethods, ...historyMethods,
  ...billMethods, ...rateMethods, ...deletionMethods,
};

/**
 * Removes Books state derived from deleted or revoked sources and removed records: opt-ins
 * and stop flags of records no longer in any fact, account decisions whose every source is
 * gone, memory lines tied to a removed receipt or source, match decisions over removed
 * records, and rebuild results of removed answers. Runs inside the purging transaction,
 * after the core records were removed.
 */
export const booksPurge: NonNullable<EngineModule['purge']> = (state, reason) => {
  const books = peekSection<Partial<BooksState>>(state, 'books'); if (!books) return 0;
  const sources = new Set(reason.sourceIds); let removed = 0;
  const referenced = new Set<string>();
  for (const fact of state.facts) for (const field of ['customerId', 'supplierId', 'itemId']) { const value = fact.fields?.[field]; if (typeof value === 'string') referenced.add(value); }
  const gone = (recordId: string) => reason.removedIds.has(recordId) || !referenced.has(recordId);
  const answers = new Set(state.answers.map(a => a?.id)), receipts = new Set(state.receipts.map(r => r?.id));
  const keep = <T>(key: keyof BooksState, drop: (item: T) => boolean) => {
    const list = books[key]; if (!Array.isArray(list)) return;
    const kept = (list as T[]).filter(item => !drop(item)); removed += list.length - kept.length; (books as Record<string, unknown>)[key] = kept;
  };
  keep<{ recordId: string }>('optIns', o => gone(o.recordId));
  keep<{ recordId: string }>('stops', s => gone(s.recordId));
  keep<{ sourceIds: string[] }>('accounts', a => a.sourceIds.length > 0 && a.sourceIds.every(s => sources.has(s)));
  keep<{ left: string; right: string }>('matches', m => gone(m.left) || gone(m.right));
  keep<{ answerId: string; quickReceiptId: string }>('rebuilds', r => reason.removedIds.has(r.answerId) || !answers.has(r.answerId) || !receipts.has(r.quickReceiptId));
  keep<{ receiptId: string | null; sourceIds: string[] }>('memory', m => (m.receiptId !== null && (reason.removedIds.has(m.receiptId) || !receipts.has(m.receiptId))) || m.sourceIds.some(s => sources.has(s)));
  return removed;
};
