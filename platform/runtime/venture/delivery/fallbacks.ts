// Chausar delivery (Ink v2 wave 4, 4J14, catalogue Q21): the computed fallback. When a model's summary or chart of the
// business fails (no answer, a refused answer, no AI at all), the view shows what code can count from the records
// instead: how many there are of each kind, and how many new ones each month, labelled "Counted by code; the summary
// didn't work." Never a guess in place of the summary, and never both at once.
//
// Ideas taken, code written here: helix-foundry's onboarding, which falls back to counts per entity and per month.
import type { State } from '../../contracts.ts';
import type { VentureRecord, VentureRecordKind } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';

export const COUNTED_BY_CODE = "Counted by code; the summary didn't work.";
/** The kinds counted, in the order shown. */
const COUNTED: readonly { kind: string; record: VentureRecordKind; label: string }[] = Object.freeze([
  { kind: 'clients', record: 'venture-client', label: 'Clients' },
  { kind: 'orders', record: 'venture-order', label: 'Orders' },
  { kind: 'invoices', record: 'venture-invoice', label: 'Invoices' },
  { kind: 'runs', record: 'venture-delivery-run', label: 'Runs' },
  { kind: 'people', record: 'venture-person', label: 'People in your network' },
  { kind: 'leads', record: 'venture-opportunity', label: 'Leads' },
]);

export type FallbackView = { line: string; entities: { kind: string; label: string; count: number }[]; months: { month: string; count: number }[] };

/** The owner's month ('YYYY-MM') of an instant; UTC for a business that has no country yet (still in its interview). */
function monthOf(at: string | Date, venture: VentureRecord): string {
  const country = venture.country as VentureRecord['country'] | null;
  return (country ? localDayAt(at, country) : new Date(at).toISOString()).slice(0, 7);
}
const before = (month: string): string => {
  const [year, value] = month.split('-').map(Number);
  return value === 1 ? `${year - 1}-12` : `${year}-${String(value - 1).padStart(2, '0')}`;
};

/**
 * What code counts from the vault: each kind's records, and the new ones in each of the last months (this one
 * included), oldest first. Every record of those kinds is counted, so a month with none is a counted 0.
 */
export function countedByCode(state: State, venture: VentureRecord, now: Date, months = 6): FallbackView {
  const lists = COUNTED.map(item => ({ ...item, records: listRecords(state, item.record, venture.id) }));
  const wanted: string[] = [];
  for (let month = monthOf(now, venture); wanted.length < months; month = before(month)) wanted.unshift(month);
  const perMonth = new Map(wanted.map(month => [month, 0]));
  for (const list of lists) {
    for (const record of list.records) {
      const month = typeof record.at === 'string' ? monthOf(record.at, venture) : null;
      if (month && perMonth.has(month)) perMonth.set(month, perMonth.get(month)! + 1);
    }
  }
  return {
    line: COUNTED_BY_CODE,
    entities: lists.map(list => ({ kind: list.kind, label: list.label, count: list.records.length })),
    months: wanted.map(month => ({ month, count: perMonth.get(month)! })),
  };
}

/**
 * A model summary, or, when making it failed in any way, the counts by code. The caller shows exactly one of the two.
 */
export async function summaryOr<T>(attempt: () => Promise<T>, state: State, venture: VentureRecord, now: Date): Promise<{ summary: T } | { fallback: FallbackView }> {
  try {
    return { summary: await attempt() };
  } catch {
    return { fallback: countedByCode(state, venture, now) };
  }
}
