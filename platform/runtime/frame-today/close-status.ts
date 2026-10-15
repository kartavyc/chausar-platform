/**
 * `todayx.closeStatus` (TD-03, spec `reports.closeStatus`): how far the month's close has got, for
 * Books Today. The month is the one before the business day. Each of the four parts takes its state
 * from records other methods hold, read as the same caller; a part with no record behind it is
 * `not-loaded-yet`. No figure is computed and none is sent: the reply carries states only.
 *
 * - bank: the bank statements this caller may see (`sources.list`, format `bank-csv`, and the
 *   connectors lane's committed `bank-statements` envelopes). None: not loaded yet. A statement whose
 *   rows did not reconcile with its own totals needs you. Otherwise in progress: a statement is in,
 *   and no record yet says it was reconciled against the books.
 * - gstr2b: the ask lane's `askx.gst2b` for the month (purchases against GSTR-2B, AS-19). A
 *   composition or unregistered business: not applicable. No 2B lines: not loaded yet. Lines in 2B
 *   or the books only, or differing beyond the tolerance: needs you. Otherwise done.
 * - tds: TDS against Form 26AS. The connectors lane's committed `form26as-ais` envelope makes it
 *   not started (no comparison record exists yet); without one, not loaded yet.
 * - trial-balance: no engine record holds a trial balance yet, so it is always not loaded yet.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { moduleMethods } from '../modules/registry.ts';
import { businessToday } from './frame.ts';

export type CloseState = 'done' | 'in-progress' | 'not-started' | 'needs-you' | 'not-applicable' | 'not-loaded-yet';
export const CLOSE_PARTS = ['bank', 'gstr2b', 'tds', 'trial-balance'] as const;
export type CloseStatusReply = {
  month: string;
  parts: Record<typeof CLOSE_PARTS[number], CloseState>;
  /** Why GSTR-2B does not apply, when it does not. */
  notApplicable?: 'composition' | 'unregistered';
};
type Rec = Record<string, any>;
async function quiet<T>(work: () => Promise<T>): Promise<T | null> { try { return await work(); } catch { return null; } }
const call = (host: ModuleHost, method: string, payload: Record<string, unknown> = {}) => quiet(() => host.call(method, payload) as Promise<any>);

/** The calendar month before the given day, and its first and last day. */
export function closeMonth(day: string): { month: string; from: string; to: string } {
  const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
  const y = month === 1 ? year - 1 : year, m = month === 1 ? 12 : month - 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { month: `${y}-${mm}`, from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

export async function closeStatus(_ctx: Context, host: ModuleHost): Promise<CloseStatusReply> {
  const { month, from, to } = closeMonth(businessToday(host.store.read()));
  const sources: any = await call(host, 'sources.list');
  const envelopes: any = moduleMethods.has('connectorsx.envelopes') ? await call(host, 'connectorsx.envelopes', { limit: 400 }) : null;
  const committed = (Array.isArray(envelopes) ? envelopes : []).filter((e: Rec) => e && e.status === 'accepted' && e.committed !== null && e.committed !== undefined && typeof e.group === 'string');
  const bankFiles = (Array.isArray(sources) ? sources : []).filter((s: Rec) => s?.format === 'bank-csv');
  const bankEnvelopes = committed.filter((e: Rec) => e.group === 'bank-statements');
  const bank: CloseState = bankFiles.length === 0 && bankEnvelopes.length === 0 ? 'not-loaded-yet'
    : bankFiles.some((s: Rec) => s.coverage?.reconciled === false) ? 'needs-you' : 'in-progress';

  let gstr2b: CloseState = 'not-loaded-yet';
  let notApplicable: CloseStatusReply['notApplicable'];
  if (moduleMethods.has('askx.gst2b')) {
    const match: any = await call(host, 'askx.gst2b', { period: { from, to } });
    if (match?.state === 'not-applicable') { gstr2b = 'not-applicable'; if (match.reason === 'composition' || match.reason === 'unregistered') notApplicable = match.reason; }
    else if (match?.state === 'ready' && Array.isArray(match.groups)) {
      const open = match.groups.some((g: Rec) => ['differs-outside', 'in-2b-only', 'books-only'].includes(g?.group) && Number.isSafeInteger(g.count) && g.count > 0);
      gstr2b = open ? 'needs-you' : 'done';
    }
  }
  const tds: CloseState = committed.some((e: Rec) => e.group === 'form26as-ais') ? 'not-started' : 'not-loaded-yet';
  return { month, parts: { bank, gstr2b, tds, 'trial-balance': 'not-loaded-yet' }, ...(notApplicable ? { notApplicable } : {}) };
}
