/**
 * `todayx.closeStatus` (TD-03, spec `reports.closeStatus`): how far the month's close has got, for
 * Books Today. The month is the one before the business day. Each of the four parts takes its state
 * from records other methods hold, read as the same caller; a part with no record behind it is
 * `not-loaded-yet`. No figure is computed and none is sent: the reply carries states only.
 *
 * - bank: the bank statements this caller may see (`sources.list`, format `bank-csv`, and the
 *   connectors lane's committed `bank-statements` envelopes). A statement that carries its own
 *   period (`period` or `coverage` with `from` and `to`) counts only when it overlaps the month; one
 *   with no dates is counted as it is (bank-csv imports carry no dates today). None: not loaded yet.
 *   A statement whose rows did not reconcile with its own totals needs you. Otherwise in progress:
 *   a statement is in, and no record yet says it was reconciled against the books.
 * - gstr2b: the ask lane's `askx.gst2b` for the month (purchases against GSTR-2B, AS-19). A
 *   composition or unregistered business: not applicable. No 2B lines: not loaded yet. Lines in 2B
 *   or the books only, differing beyond the tolerance, a probable match (a suggestion a person must
 *   look at) or lines left out because they could not be read: needs you. Otherwise done.
 * - tds: TDS against Form 26AS. The connectors lane's committed `form26as-ais` envelope makes it
 *   not started (no comparison record exists yet); without one, not loaded yet.
 * - trial-balance: no engine record holds a trial balance yet, so it is always not loaded yet.
 *
 * A read that failed is `not-sure`, never `not-loaded-yet`: what the record would have said is not
 * known. A method that is not built here (`UNKNOWN_METHOD`, `METHOD_UNAVAILABLE`) is not loaded yet.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { moduleMethods } from '../modules/registry.ts';
import { businessToday } from './frame.ts';

export type CloseState = 'done' | 'in-progress' | 'not-started' | 'needs-you' | 'not-applicable' | 'not-loaded-yet' | 'not-sure';
export const CLOSE_PARTS = ['bank', 'gstr2b', 'tds', 'trial-balance'] as const;
export type CloseStatusReply = {
  month: string;
  parts: Record<typeof CLOSE_PARTS[number], CloseState>;
  /** Why GSTR-2B does not apply, when it does not. */
  notApplicable?: 'composition' | 'unregistered';
};
type Rec = Record<string, any>;
/** A read's reply, or why it has none: `absent` when the method is not built here, `failed` otherwise. */
type Read = { ok: true; value: any } | { ok: false; why: 'absent' | 'failed' };
const NOT_BUILT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);
async function read(host: ModuleHost, method: string, payload: Record<string, unknown> = {}): Promise<Read> {
  try { return { ok: true, value: await host.call(method, payload) }; }
  catch (error) { return { ok: false, why: NOT_BUILT.has(String((error as { code?: unknown })?.code ?? '')) ? 'absent' : 'failed' }; }
}
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
/** A statement with its own dates counts only when they overlap the month; one with none is kept. */
function overlaps(source: Rec, from: string, to: string): boolean {
  const span = [source.period, source.coverage].find((c: any) => c && isDate(c.from) && isDate(c.to));
  return span === undefined || (span.from.slice(0, 10) <= to && span.to.slice(0, 10) >= from);
}

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
  const sourcesRead = await read(host, 'sources.list');
  const envelopesRead: Read = moduleMethods.has('connectorsx.envelopes') ? await read(host, 'connectorsx.envelopes', { limit: 400 }) : { ok: false, why: 'absent' };
  const sources = sourcesRead.ok && Array.isArray(sourcesRead.value) ? sourcesRead.value : null;
  const envelopes = envelopesRead.ok && Array.isArray(envelopesRead.value) ? envelopesRead.value : null;
  const sourcesUnsure = sources === null && !(!sourcesRead.ok && sourcesRead.why === 'absent');
  const envelopesUnsure = envelopes === null && !(!envelopesRead.ok && envelopesRead.why === 'absent');
  const committed = (envelopes ?? []).filter((e: Rec) => e && e.status === 'accepted' && e.committed !== null && e.committed !== undefined && typeof e.group === 'string');
  const bankFiles = (sources ?? []).filter((s: Rec) => s?.format === 'bank-csv' && overlaps(s, from, to));
  const bankEnvelopes = committed.filter((e: Rec) => e.group === 'bank-statements' && overlaps(e, from, to));
  const bank: CloseState = bankFiles.some((s: Rec) => s.coverage?.reconciled === false) ? 'needs-you'
    : sourcesUnsure || (envelopesUnsure && bankFiles.length === 0) ? 'not-sure'
    : bankFiles.length === 0 && bankEnvelopes.length === 0 ? 'not-loaded-yet' : 'in-progress';

  let gstr2b: CloseState = 'not-loaded-yet';
  let notApplicable: CloseStatusReply['notApplicable'];
  if (moduleMethods.has('askx.gst2b')) {
    const matchRead = await read(host, 'askx.gst2b', { period: { from, to } });
    const match: any = matchRead.ok ? matchRead.value : null;
    if (!matchRead.ok) gstr2b = matchRead.why === 'absent' ? 'not-loaded-yet' : 'not-sure';
    else if (match?.state === 'not-applicable') { gstr2b = 'not-applicable'; if (match.reason === 'composition' || match.reason === 'unregistered') notApplicable = match.reason; }
    else if (match?.state === 'ready' && Array.isArray(match.groups)) {
      // A probable match is only a suggestion, and a line that could not be read is left out: a person looks at both.
      const open = match.groups.some((g: Rec) => ['differs-outside', 'in-2b-only', 'books-only', 'probable'].includes(g?.group) && Number.isSafeInteger(g.count) && g.count > 0);
      const leftOut = Number.isSafeInteger(match.leftOut) && match.leftOut > 0;
      gstr2b = open || leftOut ? 'needs-you' : 'done';
    }
  }
  const tds: CloseState = committed.some((e: Rec) => e.group === 'form26as-ais') ? 'not-started' : envelopesUnsure ? 'not-sure' : 'not-loaded-yet';
  return { month, parts: { bank, gstr2b, tds, 'trial-balance': 'not-loaded-yet' }, ...(notApplicable ? { notApplicable } : {}) };
}
