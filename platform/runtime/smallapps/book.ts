/**
 * The follow-up book (experimental): who to call, when, and what was said. Every change appends a
 * version; nothing is overwritten. An entry about a customer carries the source identifiers of the
 * records that name that customer, so deleting the source removes the entry with its history.
 */
import { check, newId, now, type Context, type State, type StateStore } from '../contracts.ts';
import { canSeeFact } from '../memory.ts';
import { sourceAllowed } from '../trust.ts';
import { validDay } from './descriptor.ts';

export const STATUSES = ['open', 'done', 'dropped'] as const;
export type Version = { version: number; at: string; by: string; who: string; when: string; said: string; status: typeof STATUSES[number];
  customerId: string | null; sourceIds: string[]; branches: string[] };
export type Entry = { id: string; book: 'follow-up'; createdAt: string; createdBy: string; versions: Version[] };
export const MAX_ENTRIES = 2000, MAX_VERSIONS = 200;

/** Person-written text. It is kept as data and never read as an instruction. */
export function personText(value: unknown, max: number, field: string, allowEmpty = false): string {
  check(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\n\t]/g, ' ')),
    'SMALLAPP_RECORD_INVALID', `Give ${field} as plain text.`);
  return value.trim();
}
export function whenDay(value: unknown): string { check(validDay(value), 'SMALLAPP_RECORD_INVALID', 'Give the follow-up date as a calendar day.'); return value; }
export function status(value: unknown): Version['status'] { check(STATUSES.includes(value as any), 'SMALLAPP_RECORD_INVALID', 'Choose open, done or dropped.'); return value as Version['status']; }

/** Bind a customer to the sources and branches that name it, as the caller sees them now. */
export function customerScope(store: StateStore, ctx: Context, customerId: unknown): Pick<Version, 'customerId' | 'sourceIds' | 'branches'> {
  if (customerId === null || customerId === undefined) return { customerId: null, sourceIds: [], branches: [] };
  check(typeof customerId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(customerId), 'SMALLAPP_RECORD_INVALID', 'Give a customer identifier from your records.');
  const facts = store.read().facts.filter(f => !f.deletedAt && f.fields.customerId === customerId && canSeeFact(store, ctx, f));
  check(facts.length > 0, 'SMALLAPP_CUSTOMER_UNKNOWN', 'No customer with that identifier is visible to you.');
  return { customerId, sourceIds: [...new Set(facts.map(f => f.sourceId))].sort(), branches: [...new Set(facts.map(f => f.branch ?? ''))].sort() };
}
export function visible(state: State, ctx: Context, entry: Entry): boolean {
  const member = state.members.find(m => m.id === ctx.memberId); const latest = entry.versions.at(-1)!;
  if (!member) return false;
  return latest.sourceIds.every(id => sourceAllowed(state, ctx, id))
    && (member.branches.includes('*') || latest.branches.every(b => b !== '' && member.branches.includes(b)));
}
export function newEntry(ctx: Context, first: Omit<Version, 'version' | 'at' | 'by'>): Entry {
  const at = now();
  return { id: newId('followup'), book: 'follow-up', createdAt: at, createdBy: ctx.memberId, versions: [{ ...first, version: 1, at, by: ctx.memberId }] };
}
export const latestView = (entry: Entry) => ({ id: entry.id, book: entry.book, createdAt: entry.createdAt, createdBy: entry.createdBy, ...structuredClone(entry.versions.at(-1)!) });
/** Remove every entry whose current or past version came from a deleted source. */
export function purgeBook(book: Entry[], sources: ReadonlySet<string>, removedIds: ReadonlySet<string>): Entry[] {
  return book.filter(entry => !removedIds.has(entry.id) && !entry.versions.some(v => v.sourceIds.some(id => sources.has(id))));
}
