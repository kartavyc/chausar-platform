/**
 * Shared shapes and helpers for the Books side of the work-books lane (books.*, accounts.*,
 * records.*, history.*). Durable state lives only in `section(state, 'books', …)`; every
 * array is a plain list so ids read from the books never become object keys.
 */
import { authorize, check, type Context, type Member, type State, type StateStore } from '../contracts.ts';
import type { Definition } from '../ontology.ts';
import type { ModulePermission } from '../modules/types.ts';
import { peekSection, section } from './state.ts';

export type Missing = 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted';
export type Amount = { minor: string } | { missing: Missing };
export type Draft = { id: string; name: string; author: string; createdAt: string; state: 'draft' | 'cosigned' | 'published' | 'discarded';
  before: Definition | null; after: Definition | null; change: string;
  affects: { calculations: string[]; savedAnswers: number };
  reviews: { kind: 'cosign' | 'ai-opinion'; by: string; role: string; at: string }[];
  checks: { ok: boolean; code: string | null }; digest: string };
/** Private bookkeeping for a draft, kept apart so `drafts` matches the contract's Draft exactly. */
export type DraftMeta = { draftId: string; authorId: string; baseHash: string; cosignerIds: string[]; publishedVersion: number | null };
export type MemoryKind = 'preference' | 'claim' | 'conversation' | 'working-context';
export type MemoryRecord = { id: string; text: string | null; kind: MemoryKind; status: 'told-by-owner' | 'assumed' | 'corrected' | 'proposed';
  source: 'told-by-owner' | 'computed' | 'outside-content'; receiptId: string | null; learnedAt: string; confirmedAt: string | null;
  earlier: { text: string; at: string }[]; by: string; sourceIds: string[]; deletedAt: string | null };
export type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'receivable' | 'payable' | 'bank' | 'cash' | 'tax';
export type AccountDecision = { name: string; decision: 'yes' | 'no' | 'change'; class: AccountClass | null; proposed: AccountClass | null; by: string; memberId: string; role: string; at: string; sourceIds: string[] };
export type OptIn = { recordId: string; channel: 'mail' | 'whatsapp'; answer: 'yes' | 'no'; source: string; on: string; by: string; at: string };
export type Stop = { recordId: string; on: string; by: string; at: string };
export type MatchDecision = { left: string; right: string; state: 'joined' | 'not-same' | 'open'; relation: string; evidence: string[]; reason: string;
  mergeId: string | null; undoneMergeId: string | null; by: string; role: string; at: string };
export type Rebuild = { answerId: string; at: string; matches: boolean; quick: Amount; full: Amount; quickReceiptId: string; fullReceiptId: string };
export type BooksState = { drafts: Draft[]; draftMeta: DraftMeta[]; memory: MemoryRecord[]; accounts: AccountDecision[]; optIns: OptIn[]; stops: Stop[]; matches: MatchDecision[]; rebuilds: Rebuild[] };

const empty = (): BooksState => ({ drafts: [], draftMeta: [], memory: [], accounts: [], optIns: [], stops: [], matches: [], rebuilds: [] });
/** The writable Books section; call only inside `host.store.update`. Older shapes gain empty lists. */
export function booksState(state: State): BooksState {
  const value = section<BooksState>(state, 'books', empty);
  for (const [key, init] of Object.entries(empty())) if (!Array.isArray((value as Record<string, unknown>)[key])) (value as Record<string, unknown>)[key] = init;
  return value;
}
/** A read-only view that never creates the section. */
export function peekBooks(state: State): BooksState {
  const value = peekSection<Partial<BooksState>>(state, 'books') ?? {};
  const base = empty();
  return Object.fromEntries(Object.entries(base).map(([key, init]) => [key, Array.isArray((value as Record<string, unknown>)[key]) ? (value as Record<string, unknown>)[key] : init])) as BooksState;
}

/** Plain-object payload with only the declared keys. */
export function input(payload: unknown, allowed: string[], required: string[] = []): Record<string, any> {
  check(!!payload && typeof payload === 'object' && !Array.isArray(payload) && [Object.prototype, null].includes(Object.getPrototypeOf(payload)), 'INVALID_BOOKS_REQUEST', 'Send the request fields as a plain object.');
  const value = payload as Record<string, unknown>;
  check(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key) && value[key] !== undefined), 'INVALID_BOOKS_REQUEST', 'Send only the declared request fields, with every required field.');
  return value;
}
export function text(value: unknown, max = 200): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
export function plainId(value: unknown): value is string { return typeof value === 'string' && /^[^\u0000-\u001f]{1,200}$/.test(value); }
export function isoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}
export function isoInstant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
export function amountOf(value: unknown): Amount { return typeof value === 'string' && /^-?\d+$/.test(value) ? { minor: String(BigInt(value)) } : { missing: 'absent' }; }
export function member(state: State, ctx: Context): Member {
  const found = state.members.find(m => m.id === ctx.memberId); check(found, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.'); return found;
}
/** Write to the Books section after re-authorizing inside the transaction. */
export function writeBooks<T>(store: StateStore, ctx: Context, permission: ModulePermission, change: (books: BooksState, state: State) => T): Promise<T> {
  return store.update(state => { authorize(store, ctx, permission); return change(booksState(state), state); });
}
/** Deterministic, key-order independent JSON for comparisons and digests. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** True when any string anywhere inside `value` equals `id` exactly. */
export function mentions(value: unknown, id: string, depth = 0): boolean {
  if (typeof value === 'string') return value === id;
  if (!value || typeof value !== 'object' || depth > 24) return false;
  return (Array.isArray(value) ? value : Object.values(value)).some(item => mentions(item, id, depth + 1));
}
