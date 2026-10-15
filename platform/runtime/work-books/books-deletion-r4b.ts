/**
 * BK-20, round 4: the core stores of one customer (facts, receipts, answers, actions,
 * conversations) are deleted through core-data's one-customer deletion when it is installed.
 * Whether it is installed is read from the method registry, never by calling it: calling it
 * deletes. `deletion.customerPlan` (a read) says, before the yes, what core-data will do with
 * each store, with the actions it must wait for. `deletion.customer` is called once, only
 * inside `records.delete`, after the typed id and the approve seat were checked there
 * (deleting always waits for a person). What core-data reports is not trusted alone for the
 * report: the exact rows counted before are counted again afterwards (review 4), and a store is
 * `deleted` only when that recount and core-data's own row agree.
 *
 * core-data's contract (docs/lanes/core-data.md "Round 4 contracts", platform/runtime/core-data/data.ts):
 *   `deletion.customerPlan` (read) { id } →
 *     { recordId; canDelete; stores: { store: CoreStore; count; waiting; state: 'can-delete' | 'pending' | 'nothing-held'; reason: string | null }[] }
 *   `deletion.customer` (approve) { id; confirmation } (confirmation === id) →
 *     { recordId; at; complete; rows: { store: CoreStore; count; remaining; state: 'deleted' | 'pending' | 'not-possible' | 'nothing-held'; reason: string | null }[];
 *       elsewhere: { store: 'source-files' | 'decisions'; count; state: 'not-possible' | 'nothing-held'; reason: string | null }[];
 *       derived: { staleMarked; modelReceiptsRemoved; privateRemoved } }
 *   refusals: TAINTED_APPROVAL, CONFIRMATION_REQUIRED, RECORD_NOT_FOUND, INVALID_DELETION_REQUEST, DELETION_REGISTER_*.
 * Both choose exactly the rows `holdingsOf` counts for the caller (facts they can see, their own receipts, answers
 * and conversations, actions under the action service's access rule), so no row the caller cannot see is deleted.
 */
import type { ModuleHost } from '../modules/types.ts';
import { installed } from './work-jobs-sheet.ts';

export const CORE_CUSTOMER_DELETION = 'deletion.customer';
export const CORE_CUSTOMER_PLAN = 'deletion.customerPlan';
export const CORE_STORES: ReadonlySet<string> = new Set(['facts', 'receipts', 'answers', 'actions', 'conversations']);

export type CorePlanRow = { store: string; count: number; waiting: number; state: 'can-delete' | 'pending' | 'nothing-held'; reason: string | null };
export type CoreDoneRow = { store: string; count: number; remaining: number; state: 'deleted' | 'pending' | 'not-possible' | 'nothing-held'; reason: string | null };
export type Elsewhere = { store: 'source-files' | 'decisions'; count: number; state: 'not-possible' | 'nothing-held'; reason: string | null };
export type Derived = { staleMarked: number; modelReceiptsRemoved: number; privateRemoved: number };
export type CoreDeletion = { code: string | null; rows: CoreDoneRow[] | null; elsewhere: Elsewhere[] | null; derived: Derived | null };

export const coreDeletionInstalled = (host: ModuleHost) => installed(host, CORE_CUSTOMER_DELETION);
export const corePlanInstalled = (host: ModuleHost) => installed(host, CORE_CUSTOMER_PLAN);

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const reasonOf = (v: unknown): string | null | undefined => v === null ? null : typeof v === 'string' && v.length <= 4000 ? v : undefined;
const codeOf = (error: unknown, fallback: string) => { const code = (error as { code?: unknown })?.code; return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : fallback; };
/** Each row checked field by field; a row that does not fit, or a store named twice, drops the whole list (null). */
function rowsOf<T>(value: unknown, stores: ReadonlySet<string>, row: (r: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const out: T[] = []; const seen = new Set<string>();
  for (const r of value) {
    if (!plain(r) || typeof r.store !== 'string' || !stores.has(r.store) || seen.has(r.store)) return null;
    const checked = row(r); if (checked === null) return null; seen.add(r.store); out.push(checked);
  }
  return out;
}

/** core-data's plan for the core stores, or the refusal code; null when the plan method is not installed. */
export async function corePlan(host: ModuleHost, id: string): Promise<{ rows: CorePlanRow[] | null; code: string | null } | null> {
  if (!(await corePlanInstalled(host))) return null;
  let reply: unknown;
  try { reply = await host.call(CORE_CUSTOMER_PLAN, { id }); } catch (error) { return { rows: null, code: codeOf(error, 'CORE_PLAN_FAILED') }; }
  const rows = plain(reply) ? rowsOf(reply.stores, CORE_STORES, r => {
    const reason = reasonOf(r.reason);
    return whole(r.count) && whole(r.waiting) && r.waiting <= r.count && (r.state === 'can-delete' || r.state === 'pending' || r.state === 'nothing-held') && reason !== undefined
      ? { store: r.store as string, count: r.count, waiting: r.waiting, state: r.state as CorePlanRow['state'], reason } : null;
  }) : null;
  // Every one of the five stores, each once; anything else is not core-data's plan.
  return rows && rows.length === CORE_STORES.size ? { rows, code: null } : { rows: null, code: 'INVALID_DELETION_REPLY' };
}

/** Calls core-data's deletion once; a refusal is kept as its code for the report, never swallowed into "deleted". */
export async function deleteCoreRows(host: ModuleHost, id: string, confirmation: string): Promise<CoreDeletion> {
  let reply: unknown;
  try { reply = await host.call(CORE_CUSTOMER_DELETION, { id, confirmation }); }
  catch (error) { return { code: codeOf(error, 'CORE_DELETION_FAILED'), rows: null, elsewhere: null, derived: null }; }
  if (!plain(reply)) return { code: null, rows: null, elsewhere: null, derived: null };
  const rows = rowsOf(reply.rows, CORE_STORES, r => {
    const reason = reasonOf(r.reason);
    return whole(r.count) && whole(r.remaining) && ['deleted', 'pending', 'not-possible', 'nothing-held'].includes(r.state as string) && reason !== undefined
      ? { store: r.store as string, count: r.count, remaining: r.remaining, state: r.state as CoreDoneRow['state'], reason } : null;
  });
  const elsewhere = rowsOf(reply.elsewhere, new Set(['source-files', 'decisions']), r => {
    const reason = reasonOf(r.reason);
    return whole(r.count) && (r.state === 'not-possible' || r.state === 'nothing-held') && reason !== undefined
      ? { store: r.store as Elsewhere['store'], count: r.count, state: r.state as Elsewhere['state'], reason } : null;
  });
  const d = reply.derived;
  const derived = plain(d) && whole(d.staleMarked) && whole(d.modelReceiptsRemoved) && whole(d.privateRemoved)
    ? { staleMarked: d.staleMarked, modelReceiptsRemoved: d.modelReceiptsRemoved, privateRemoved: d.privateRemoved } : null;
  return { code: null, rows, elsewhere, derived };
}
