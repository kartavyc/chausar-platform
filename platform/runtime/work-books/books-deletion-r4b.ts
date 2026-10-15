/**
 * BK-20, round 4: the core stores of one customer (facts, receipts, answers, actions,
 * conversations) are deleted through core-data's one-customer deletion when it is installed.
 * Whether it is installed is read from the method registry, never by calling it: calling it
 * deletes. The call is made only inside `records.delete`, after the typed id and the approve
 * seat were checked there (deleting always waits for a person). What core-data reports is
 * not trusted for the report: every store is counted again afterwards, and only a store found
 * empty is reported deleted.
 *
 * Assumed contract (docs/lanes/work-books.md, "Round 4 contracts"):
 *   `deletion.customer` (core-data, permission approve):
 *     { customerId: string; recordIds: string[]; confirmation: string }  // confirmation === customerId
 *   → { customerId: string; stores: { store: 'facts' | 'receipts' | 'answers' | 'actions' | 'conversations'; count: number }[] }
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { installed } from './work-jobs-sheet.ts';

export const CORE_CUSTOMER_DELETION = 'deletion.customer';
export const CORE_STORES: ReadonlySet<string> = new Set(['facts', 'receipts', 'answers', 'actions', 'conversations']);

export const coreDeletionInstalled = (host: ModuleHost) => installed(host, CORE_CUSTOMER_DELETION);

/** Calls core-data's deletion once; a refusal is kept as its code for the report, never swallowed into "deleted". */
export async function deleteCoreRows(host: ModuleHost, _ctx: Context, customerId: string, recordIds: readonly string[], confirmation: string): Promise<{ code: string | null }> {
  try { await host.call(CORE_CUSTOMER_DELETION, { customerId, recordIds: [...recordIds], confirmation }); return { code: null }; }
  catch (error) {
    const code = (error as { code?: unknown })?.code;
    return { code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'CORE_DELETION_FAILED' };
  }
}
