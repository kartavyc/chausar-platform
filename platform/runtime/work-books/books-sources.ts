/**
 * Sources (BK-01, BK-02, BK-06): one row per imported source with twelve month squares.
 * A month is loaded only when an accepted import holds facts dated in it, refused when the
 * only attempts that month were refused, and otherwise "not loaded yet" — never a zero.
 */
import { authorize, check, type Context, type Fact, type State, type StateStore } from '../contracts.ts';
import { parseCsv } from '../ingest.ts';
import { canSeeFact } from '../memory.ts';
import { sourceAllowed } from '../trust.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { amountOf, input, plainId, type Amount } from './books-common.ts';
import { connections, envelopes, freshness, systemOf, type ConnectionView, type EnvelopeView } from './books-connectors.ts';

export type MonthState = 'loaded' | 'loading' | 'not-loaded-yet' | 'refused' | 'failed';
export type SourceRow = { sourceId: string; system: string; way: 'files' | 'signed-in' | 'this-computer'; scope: string | null;
  lastReadAt: string | null; months: { month: string; state: MonthState }[]; rows: number; refused: number; unmapped: number; experimental: boolean; connected: boolean;
  /** Round 2, additive: the connection behind this source (connectors-ext), its last failed read and whether it is past its freshness target. */
  connection?: { connectionId: string; group: string; road: 'interface' | 'file' | 'database'; status: 'active' | 'paused' } | null;
  lastFailure?: { at: string; code: string | null } | null; stale?: boolean };
type Refusal = { sourceId: string; at: string; format: string | null; codes: string[] };

/** Import refusals from the local learning log (an import refusal writes no import row). */
export function refusals(state: State): Refusal[] {
  return state.learning.filter(event => event?.type === 'decision' && event.importIdentity?.outcome === 'rejected' && typeof event.importIdentity.sourceId === 'string' && typeof event.at === 'string')
    .map(event => ({ sourceId: event.importIdentity.sourceId, at: event.at, format: typeof event.importIdentity.format === 'string' ? event.importIdentity.format : null,
      // The refusal log keeps the reason class, not the raw validation codes.
      codes: [String(event.input?.reasonCode ?? 'unsupported_shape').toUpperCase()] }));
}
export function monthsEnding(end: string): string[] {
  const [year, month] = end.split('-').map(Number); const out: string[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(year, month - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}
const validMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
/**
 * Core's source rule (engine visibleImports, actions sourceAccess): a source is visible only
 * when the source is allowed and every fact it holds is visible to the caller (branch and
 * source). A source that holds facts in a branch outside the caller's access is hidden whole,
 * so its retained content is never parsed for that caller.
 */
export function sourceVisible(store: StateStore, ctx: Context, sourceId: string): boolean {
  const state = store.read();
  return sourceAllowed(state, ctx, sourceId) && state.facts.every(f => f.sourceId !== sourceId || canSeeFact(store, ctx, f));
}
export function visibleSourceIds(store: StateStore, ctx: Context): string[] {
  const state = store.read();
  return [...new Set([...state.imports.map(i => i?.sourceId), ...refusals(state).map(r => r.sourceId)].filter((id): id is string => typeof id === 'string'))].filter(id => sourceVisible(store, ctx, id)).sort();
}
const liveFacts = (state: State, sourceId: string) => state.facts.filter(f => f.sourceId === sourceId && !f.deletedAt);
function sourceRow(state: State, sourceId: string, months: string[]): SourceRow {
  const imports = state.imports.filter(i => i.sourceId === sourceId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const refused = refusals(state).filter(r => r.sourceId === sourceId);
  const byId = new Map(state.facts.filter(f => !f.deletedAt).map(f => [f.id, f] as const));
  const loaded = new Set(imports.flatMap(i => (Array.isArray(i.rowIds) ? i.rowIds : []).map((id: string) => byId.get(id)?.validFrom?.slice(0, 7)).filter(Boolean)));
  const refusedMonths = new Set(refused.map(r => r.at.slice(0, 7)));
  const latest = imports.at(-1); const recipe = latest?.retainedInput?.input?.recipe;
  const company = typeof recipe?.scope?.company === 'string' ? recipe.scope.company : null;
  const rows = new Set(liveFacts(state, sourceId).map(f => JSON.stringify([f.kind, f.entityId]))).size;
  return { sourceId, system: typeof recipe?.system === 'string' ? recipe.system : String(latest?.format ?? refused.at(-1)?.format ?? 'unknown'), way: 'files', scope: company,
    lastReadAt: typeof latest?.at === 'string' ? latest.at : null,
    months: months.map(month => ({ month, state: loaded.has(month) ? 'loaded' : refusedMonths.has(month) ? 'refused' : 'not-loaded-yet' })),
    rows, refused: refused.length, unmapped: new Set(imports.flatMap(i => Array.isArray(i.unmappedFields) ? i.unmappedFields : [])).size,
    experimental: imports.length === 0 || imports.some(i => i.qualification === 'experimental'), connected: imports.length > 0 };
}
function defaultEnd(state: State, sourceIds: string[]): string {
  const latest = state.imports.filter(i => sourceIds.includes(i.sourceId) && typeof i.at === 'string').map(i => i.at as string).sort().at(-1);
  return (latest ?? new Date().toISOString()).slice(0, 7);
}
type FieldType = 'text' | 'number' | 'date' | 'empty' | 'unknown';
function fieldShape(values: string[]): { type: FieldType; filled: number } {
  const filled = values.filter(v => v.trim().length > 0);
  if (!filled.length) return { type: 'empty', filled: 0 };
  const type: FieldType = filled.every(v => /^\d{4}-\d{2}-\d{2}$|^\d{2}[-/]\d{2}[-/]\d{4}$|^(19|20)\d{2}(0[1-9]|1[0-2])\d{2}$/.test(v.trim())) ? 'date'
    : filled.every(v => /^[-+]?[\d,]+(\.\d+)?$/.test(v.trim())) ? 'number' : 'text';
  return { type, filled: filled.length };
}
export function unmappedFields(store: StateStore, ctx: Context) {
  const state = store.read(); const sources = visibleSourceIds(store, ctx); const fields = new Map<string, { sourceIds: Set<string>; type: FieldType; filled: { rows: number; of: number } | null }>();
  for (const record of state.imports.filter(i => sources.includes(i.sourceId))) {
    const names: string[] = Array.isArray(record.unmappedFields) ? record.unmappedFields.filter((f: unknown) => typeof f === 'string') : [];
    if (!names.length) continue;
    const content = record.retainedInput?.input?.content; let rows: Record<string, string>[] | null = null;
    if ((record.format === 'csv' || record.format === 'bank-csv') && typeof content === 'string') { try { rows = parseCsv(content); } catch { rows = null; } }
    for (const name of names) {
      const entry = fields.get(name) ?? { sourceIds: new Set<string>(), type: 'unknown' as FieldType, filled: null };
      entry.sourceIds.add(record.sourceId);
      if (rows) { const shape = fieldShape(rows.map(row => row[name] ?? '')); entry.type = shape.type; entry.filled = { rows: shape.filled, of: rows.length }; }
      fields.set(name, entry);
    }
  }
  return [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([field, v]) => ({ field, sourceIds: [...v.sourceIds].sort(), type: v.type, filled: v.filled }));
}

const coreUnmapped = (state: State, sourceId: string): string[] =>
  [...new Set(state.imports.filter(i => i.sourceId === sourceId).flatMap(i => Array.isArray(i.unmappedFields) ? i.unmappedFields.filter((f: unknown): f is string => typeof f === 'string') : []))];
const wayOf = (c: ConnectionView): SourceRow['way'] => c.road === 'file' ? 'files' : c.road === 'database' || c.group === 'tally' ? 'this-computer' : 'signed-in';
const covers = (p: { from: string; to: string } | null, month: string) => !!p && p.from.slice(0, 7) <= month && p.to.slice(0, 7) >= month;

type Connected = { available: boolean; connections: ConnectionView[]; envelopes: EnvelopeView[]; freshness: Awaited<ReturnType<typeof freshness>>['items']; ids: string[] };
/**
 * Every source the caller may see: imported files (core), connections and reads from the
 * connector factory. Each id passes `sourceVisible`, so the core source rule holds for all.
 */
async function connected(host: ModuleHost, ctx: Context, end: string | null): Promise<Connected> {
  const asOf = `${end ?? new Date().toISOString().slice(0, 7)}-01`;
  const [conns, reads, fresh] = await Promise.all([connections(host, ctx), envelopes(host, ctx), freshness(host, ctx, asOf)]);
  const ids = [...new Set([...visibleSourceIds(host.store, ctx), ...conns.items.map(c => c.sourceId), ...reads.items.map(e => e.sourceId), ...fresh.items.map(f => f.sourceId)])]
    .filter(id => sourceVisible(host.store, ctx, id)).sort();
  return { available: conns.available || reads.available || fresh.available, connections: conns.items, envelopes: reads.items, freshness: fresh.items, ids };
}
/** One row: the core file view, with what the connector factory knows laid over it. */
function mergedRow(state: State, sourceId: string, months: string[], c: Connected): SourceRow {
  const row = sourceRow(state, sourceId, months);
  const conn = c.connections.find(x => x.sourceId === sourceId), fresh = c.freshness.find(f => f.sourceId === sourceId);
  const reads = c.envelopes.filter(e => e.sourceId === sourceId);
  if (!conn && !fresh && reads.length === 0) return row;
  const hasImports = state.imports.some(i => i.sourceId === sourceId);
  if (conn) { row.way = wayOf(conn); if (!hasImports || row.system === 'unknown') row.system = conn.label; row.scope = conn.company || row.scope; row.connected = true; }
  else if (!hasImports && reads[0]) row.system = reads[0].recipeId.split('.')[0] || row.system;
  // Everything read through the connector factory is experimental until a person runs the bench.
  row.experimental = true;
  row.months = row.months.map(({ month, state: core }) => {
    const f = fresh?.months.get(month);
    if (core === 'loaded' || f === 'loaded') return { month, state: 'loaded' as const };
    if (reads.some(e => e.waiting && covers(e.period, month))) return { month, state: 'loading' as const };
    if (f === 'failed') return { month, state: 'failed' as const };
    if (core === 'refused' || f === 'refused') return { month, state: 'refused' as const };
    return { month, state: 'not-loaded-yet' as const };
  });
  row.lastReadAt = [row.lastReadAt, fresh?.lastRead ?? null].filter((v): v is string => typeof v === 'string').sort().at(-1) ?? null;
  row.refused += reads.filter(e => e.status !== 'accepted').length;
  row.unmapped = new Set([...coreUnmapped(state, sourceId), ...(fresh?.unmappedFields ?? []), ...reads.flatMap(e => e.unmappedFields)]).size;
  row.connection = conn ? { connectionId: conn.connectionId, group: conn.group, road: conn.road, status: conn.status } : null;
  row.lastFailure = fresh?.lastFailure ? { at: fresh.lastFailure.at, code: fresh.lastFailure.code } : null;
  row.stale = fresh?.stale === true;
  return row;
}
export type UnmappedRow = { field: string; sourceIds: string[]; type: FieldType; filled: { rows: number; of: number } | null; origin: 'file' | 'connector'; recipeId: string | null; mappable: boolean };
/** Fields no recipe covers: core file imports with type and fill rate, and connector reads by recipe. */
async function allUnmapped(host: ModuleHost, ctx: Context, c: Connected): Promise<UnmappedRow[]> {
  const files: UnmappedRow[] = unmappedFields(host.store, ctx).map(f => ({ ...f, origin: 'file' as const, recipeId: null, mappable: true }));
  const reply = await optionalCall<unknown>(host, 'connectorsx.unmapped', {});
  const listed = reply.available && reply.value && typeof reply.value === 'object' && Array.isArray((reply.value as { fields?: unknown }).fields) ? (reply.value as { fields: unknown[] }).fields : [];
  const seen = new Set<string>(); const out: UnmappedRow[] = [];
  for (const raw of listed.slice(0, 2000)) {
    if (!raw || typeof raw !== 'object') continue;
    const { field, recipeId } = raw as { field?: unknown; recipeId?: unknown };
    if (typeof field !== 'string' || field.length === 0 || field.length > 400 || typeof recipeId !== 'string' || recipeId.length > 200 || seen.has(`${recipeId}\u0000${field}`)) continue;
    const sourceIds = [...new Set(c.envelopes.filter(e => e.recipeId === recipeId && e.unmappedFields.includes(field)).map(e => e.sourceId))].sort();
    if (!sourceIds.length) continue;
    seen.add(`${recipeId}\u0000${field}`);
    // A connector recipe is registered engine code chosen by id; mapping one of its fields changes that recipe, not the library.
    out.push({ field, sourceIds, type: 'unknown', filled: null, origin: 'connector', recipeId, mappable: false });
  }
  return [...files, ...out.sort((a, b) => a.field.localeCompare(b.field))];
}
/** The read operations a connection offers, from the connector catalogue. */
async function operationsFor(host: ModuleHost, group: string) {
  let reply: Awaited<ReturnType<typeof optionalCall>>;
  try { reply = await optionalCall<unknown>(host, 'connectorsx.systems', { group }); } catch { return []; }
  if (!reply.available || !reply.value || typeof reply.value !== 'object') return [];
  const groups = (reply.value as { groups?: unknown }).groups; const system = Array.isArray(groups) ? systemOf(groups[0], null) : null;
  return (system?.operations ?? []).filter(op => op.road === 'interface' && op.depth === 'read' && (op.status === 'tested' || op.status === 'experimental'))
    .map(op => ({ id: op.id, label: op.label, limitation: op.limitation, live: op.status === 'tested' }));
}

export const sourceMethods: Record<string, MethodSpec> = {
  'books.sources': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['endMonth']); check(request.endMonth === undefined || validMonth(request.endMonth), 'INVALID_BOOKS_REQUEST', 'Give the last month as YYYY-MM.');
    const state = host.store.read();
    const c = await connected(host, ctx, request.endMonth ?? null);
    const end = request.endMonth ?? (c.connections.length ? [defaultEnd(state, c.ids), new Date().toISOString().slice(0, 7)].sort().at(-1)! : defaultEnd(state, c.ids));
    const months = monthsEnding(end);
    const unmapped = await allUnmapped(host, ctx, c);
    return { rows: c.ids.map(id => mergedRow(state, id, months, c)), unmappedFields: unmapped.length, freshness: { available: c.available } };
  } },
  'books.source': { permission: 'read', async handler(ctx, payload, host) {
    const { sourceId } = input(payload, ['sourceId'], ['sourceId']); check(plainId(sourceId), 'INVALID_BOOKS_REQUEST', 'Name the source.');
    const c = await connected(host, ctx, null);
    const state = host.store.read(); check(c.ids.includes(sourceId), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
    const imports = state.imports.filter(i => i.sourceId === sourceId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const kinds = new Map<string, Set<string>>(); for (const f of liveFacts(state, sourceId) as Fact[]) kinds.set(f.kind, (kinds.get(f.kind) ?? new Set()).add(f.entityId));
    const conn = c.connections.find(x => x.sourceId === sourceId) ?? null;
    const reads = c.envelopes.filter(e => e.sourceId === sourceId);
    const end = [defaultEnd(state, [sourceId]), ...(conn ? [new Date().toISOString().slice(0, 7)] : [])].sort().at(-1)!;
    return { row: mergedRow(state, sourceId, monthsEnding(end), c),
      reads: imports.map(i => ({ id: i.id, at: i.at, rows: Number.isInteger(i.coverage?.importedRows) ? i.coverage.importedRows : (i.rowIds?.length ?? 0), totals: amountOf(i.totalsMinor) as Amount, reconciled: i.coverage?.reconciled === true, format: i.format })),
      refusals: refusals(state).filter(r => r.sourceId === sourceId).map(r => ({ at: r.at, codes: r.codes })),
      kinds: [...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, rows]) => ({ kind, rows: rows.size })),
      unmappedFields: [...new Set([...coreUnmapped(state, sourceId), ...reads.flatMap(e => e.unmappedFields)])].sort(),
      // Round 2, additive: the connection, what it can read, and the history of reads with their envelopes.
      connectors: { available: c.available },
      connection: conn ? { ...conn, operations: await operationsFor(host, conn.group) } : null,
      envelopes: reads.slice(0, 50) };
  } },
  'books.unmapped': { permission: 'read', async handler(ctx, payload, host) {
    input(payload, []); authorize(host.store, ctx);
    return { fields: await allUnmapped(host, ctx, await connected(host, ctx, null)) };
  } },
};
