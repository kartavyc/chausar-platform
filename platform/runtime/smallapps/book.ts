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

/** Markup and script links: refused in stored person text so no screen can ever be handed a tag to render. */
const MARKUP = /<\s*[A-Za-z!/?]|&#|&[a-z]+;|\b(?:javascript|vbscript|data)\s*:/i;
/**
 * Person-written text. It is kept as data and never read as an instruction. Numbers a person
 * writes ("promised to pay 400") are their own record, so the small-app number guard does not apply.
 */
export function personText(value: unknown, max: number, field: string, allowEmpty = false, code = 'SMALLAPP_RECORD_INVALID'): string {
  check(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u.test(value.replace(/[\n\t]/g, ' ')),
    code, `Give ${field} as plain text.`);
  check(!MARKUP.test(value.normalize('NFKC')), code, `Give ${field} as plain text, without markup or script links.`);
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
/** One version is visible when every source it was bound to is allowed and the caller holds every branch it names. */
export function versionVisible(state: State, ctx: Context, version: Version): boolean {
  const member = state.members.find(m => m.id === ctx.memberId);
  if (!member) return false;
  return version.sourceIds.every(id => sourceAllowed(state, ctx, id))
    && (member.branches.includes('*') || version.branches.every(b => b !== '' && member.branches.includes(b)));
}
/** An entry is listed when its current version is visible; earlier versions are checked one by one wherever they are returned. */
export const visible = (state: State, ctx: Context, entry: Entry): boolean => versionVisible(state, ctx, entry.versions.at(-1)!);
/** The versions the caller may see, and how many were withheld. */
export function visibleVersions(state: State, ctx: Context, entry: Entry): { versions: Version[]; withheld: number; withheldWords: string | null } {
  const versions = entry.versions.filter(v => versionVisible(state, ctx, v)), withheld = entry.versions.length - versions.length;
  return { versions: structuredClone(versions), withheld,
    withheldWords: withheld === 0 ? null : withheld === 1 ? 'One earlier version is outside your current access and is not shown.'
      : `${withheld} earlier versions are outside your current access and are not shown.` };
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
