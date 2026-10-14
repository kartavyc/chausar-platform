/**
 * Sources (BK-01, BK-02, BK-06): one row per imported source with twelve month squares.
 * A month is loaded only when an accepted import holds facts dated in it, refused when the
 * only attempts that month were refused, and otherwise "not loaded yet" — never a zero.
 */
import { authorize, check, type Context, type Fact, type State } from '../contracts.ts';
import { parseCsv } from '../ingest.ts';
import { sourceAllowed } from '../trust.ts';
import type { MethodSpec } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { amountOf, input, plainId, type Amount } from './books-common.ts';

export type MonthState = 'loaded' | 'loading' | 'not-loaded-yet' | 'refused' | 'failed';
export type SourceRow = { sourceId: string; system: string; way: 'files' | 'signed-in' | 'this-computer'; scope: string | null;
  lastReadAt: string | null; months: { month: string; state: MonthState }[]; rows: number; refused: number; unmapped: number; experimental: boolean; connected: boolean };
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
export function visibleSourceIds(state: State, ctx: Context): string[] {
  return [...new Set([...state.imports.map(i => i?.sourceId), ...refusals(state).map(r => r.sourceId)].filter((id): id is string => typeof id === 'string' && sourceAllowed(state, ctx, id)))].sort();
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
export function unmappedFields(state: State, ctx: Context) {
  const sources = visibleSourceIds(state, ctx); const fields = new Map<string, { sourceIds: Set<string>; type: FieldType; filled: { rows: number; of: number } | null }>();
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

export const sourceMethods: Record<string, MethodSpec> = {
  'books.sources': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['endMonth']); check(request.endMonth === undefined || validMonth(request.endMonth), 'INVALID_REQUEST', 'Give the last month as YYYY-MM.');
    const state = host.store.read(); const ids = visibleSourceIds(state, ctx); const months = monthsEnding(request.endMonth ?? defaultEnd(state, ids));
    const freshness = await optionalCall(host, 'connectorsx.freshness', {});
    return { rows: ids.map(id => sourceRow(state, id, months)), unmappedFields: unmappedFields(state, ctx).length, freshness: { available: freshness.available } };
  } },
  'books.source': { permission: 'read', handler(ctx, payload, host) {
    const { sourceId } = input(payload, ['sourceId'], ['sourceId']); check(plainId(sourceId), 'INVALID_REQUEST', 'Name the source.');
    const state = host.store.read(); check(visibleSourceIds(state, ctx).includes(sourceId), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
    const imports = state.imports.filter(i => i.sourceId === sourceId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const kinds = new Map<string, Set<string>>(); for (const f of liveFacts(state, sourceId) as Fact[]) kinds.set(f.kind, (kinds.get(f.kind) ?? new Set()).add(f.entityId));
    return { row: sourceRow(state, sourceId, monthsEnding(defaultEnd(state, [sourceId]))),
      reads: imports.map(i => ({ id: i.id, at: i.at, rows: Number.isInteger(i.coverage?.importedRows) ? i.coverage.importedRows : (i.rowIds?.length ?? 0), totals: amountOf(i.totalsMinor) as Amount, reconciled: i.coverage?.reconciled === true, format: i.format })),
      refusals: refusals(state).filter(r => r.sourceId === sourceId).map(r => ({ at: r.at, codes: r.codes })),
      kinds: [...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, rows]) => ({ kind, rows: rows.size })),
      unmappedFields: [...new Set(imports.flatMap(i => Array.isArray(i.unmappedFields) ? i.unmappedFields : []))].sort() };
  } },
  'books.unmapped': { permission: 'read', handler(ctx, payload, host) { input(payload, []); authorize(host.store, ctx); return { fields: unmappedFields(host.store.read(), ctx) }; } },
};
