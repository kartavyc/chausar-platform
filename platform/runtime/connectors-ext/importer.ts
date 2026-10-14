import { audit, authorize, check, hash, newId, now, type Context, type StateStore } from '../contracts.ts';
import { currentAccess, insertFacts, type FactInput } from '../memory.ts';
import { OntologyService } from '../ontology.ts';
import { isNoResend } from '../trust.ts';
import type { ImportService, MappingRecipe } from '../ingest.ts';
import type { CanonicalRecord, RecipeOutcome } from './types.ts';

/**
 * Accepted recipe outcomes become facts through the existing importer. Money goes through
 * ImportService, so the dictionary, branch access, source deletion and the second total check all
 * apply. Counts (sessions, tickets, commits) are not money, so they are written as `quantity`
 * facts under the same access, deletion and identity rules.
 */
export type CommitTarget = { sourceId: string; company: string; branch: string };
const SOURCE = /^[A-Za-z0-9_.:-]{1,100}$/;
const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Fields the published dictionary knows; anything else stays out of the facts. */
function dictionaryFields(store: StateStore, ctx: Context): Record<string, string> {
  const dictionary = new OntologyService(store).current(ctx);
  check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business meanings before importing.');
  return dictionary.fields ?? {};
}
const outputFields = (records: readonly CanonicalRecord[], known: Record<string, string>, count = false) =>
  [...new Set(records.flatMap(record => Object.keys(record.fields)))].filter(name => Object.hasOwn(known, name) && !['currency', 'amountMinor', 'unit', ...(count ? ['quantity'] : [])].includes(name)).sort();

/** The canonical CSV and data recipe the core importer validates and totals a second time. */
export function canonicalImport(outcome: RecipeOutcome, target: CommitTarget, known: Record<string, string>): { content: string; recipe: MappingRecipe; expectedTotals: { rowCount: number; amountMinor: string } } {
  check(outcome.status === 'accepted' && outcome.recipe.measure === 'money', 'IMPORT_NOT_ACCEPTED', 'Only an accepted money outcome can be imported this way.');
  const extra = outputFields(outcome.records, known);
  const currencies = [...new Set(outcome.records.map(record => record.measure.type === 'money' ? record.measure.currency : ''))];
  check(currencies.length === 1 && /^[A-Z]{3}$/.test(currencies[0]), 'MIXED_CURRENCY', 'One import holds one currency.');
  const header = ['id', 'kind', 'date', 'amount', 'currency', ...extra, 'branch'];
  const lines = outcome.records.map(record => [record.entityId, record.kind, record.date, record.measure.type === 'money' ? record.measure.amountMinor : '', currencies[0],
    ...extra.map(name => record.fields[name] ?? ''), target.branch].map(escape).join(','));
  const recipe: MappingRecipe = { version: 1, id: `cx-${outcome.recipe.id}`, system: outcome.recipe.group, edition: outcome.recipe.version, scope: { company: target.company, branches: [target.branch] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: currencies[0], nulls: 'reject' },
      { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' },
      ...extra.map(name => known[name] === 'money' ? { target: name, source: name, type: 'money' as const, moneyUnit: 'minor' as const, currency: currencies[0], nulls: 'omit' as const }
        : known[name] === 'date' ? { target: name, source: name, type: 'date' as const, dateFormat: 'ISO' as const, nulls: 'omit' as const }
        : known[name] === 'integer' ? { target: name, source: name, type: 'integer' as const, nulls: 'omit' as const }
        : { target: name, source: name, type: 'string' as const, nulls: 'omit' as const }),
    ],
    allowedKinds: [...new Set(outcome.records.map(record => record.kind))], allowedStatuses: [...new Set(['', ...outcome.records.map(record => record.fields.status ?? '')])], onUnmapped: 'reject' };
  return { content: [header.join(','), ...lines].join('\n') + '\n', recipe, expectedTotals: { rowCount: outcome.records.length, amountMinor: outcome.observed.total } };
}

export async function commitOutcome(store: StateStore, imports: ImportService, ctx: Context, outcome: RecipeOutcome, target: CommitTarget): Promise<{ importId: string; rowIds: string[]; duplicate: boolean; measure: 'money' | 'count' }> {
  check(SOURCE.test(target.sourceId) && typeof target.company === 'string' && target.company.length > 0 && target.company.length <= 200 && SOURCE.test(target.branch), 'INVALID_IMPORT_TARGET', 'Name the source, company and branch for this import.');
  check(outcome.status === 'accepted', 'IMPORT_NOT_ACCEPTED', 'Only a file that passed its checks against the source\'s own totals can be imported.');
  if (outcome.recipe.measure === 'money') {
    const prepared = canonicalImport(outcome, target, dictionaryFields(store, ctx));
    const contentHash = hash(prepared.content), recipeHash = hash(prepared.recipe);
    const existed = store.read().imports.some(item => item.sourceId === target.sourceId && item.contentHash === contentHash && item.recipeHash === recipeHash);
    const result = await imports.commit(ctx, { sourceId: target.sourceId, format: 'csv', ...prepared });
    return { importId: result.id, rowIds: [...result.rowIds], duplicate: existed || result.duplicate === true, measure: 'money' };
  }
  return store.update(state => {
    const view: StateStore = { read: () => state, update: store.update.bind(store) };
    authorize(view, ctx, 'prepare'); currentAccess(view, ctx, target.branch, target.sourceId);
    const known = dictionaryFields(view, ctx);
    check(known.quantity === 'integer', 'DICTIONARY_FIELD_REQUIRED', 'Counts need the published integer field quantity.');
    const contentHash = hash({ records: outcome.records, contentHash: outcome.contentHash }), recipeHash = outcome.recipe.digest;
    check(!isNoResend(state, outcome.contentHash), 'SOURCE_DELETED', 'This file was previously deleted. Its content cannot be imported again.');
    const prior = state.imports.find(item => item.sourceId === target.sourceId && item.contentHash === contentHash && item.recipeHash === recipeHash);
    if (prior) return { importId: prior.id, rowIds: [...prior.rowIds], duplicate: true, measure: 'count' as const };
    const extra = outputFields(outcome.records, known, true);
    const facts: FactInput[] = outcome.records.map(record => {
      check(record.measure.type === 'count' && /^-?\d{1,15}$/.test(record.measure.quantity), 'INVALID_COUNT', 'A count must be a whole number.');
      return { entityId: record.entityId, kind: record.kind, validFrom: record.date, sourceId: target.sourceId, sourceRow: record.sourceRow, branch: target.branch,
        fields: { quantity: Number(record.measure.quantity), unit: record.measure.unit, ...Object.fromEntries(extra.filter(name => record.fields[name] !== undefined && known[name] !== 'money').map(name => [name, known[name] === 'integer' ? Number(record.fields[name]) : record.fields[name]])) } };
    });
    insertFacts(state, facts, now());
    const latest = new Map(state.facts.filter(fact => fact.sourceId === target.sourceId).map(fact => [`${fact.kind}\u0000${fact.entityId}`, fact.id] as const));
    const rowIds = facts.map(fact => latest.get(`${fact.kind}\u0000${fact.entityId}`)!);
    const record = { id: newId('import'), at: now(), sourceId: target.sourceId, format: 'csv', recipeHash, contentHash, rowIds,
      coverage: { sourceRows: outcome.records.length + outcome.excludedRows, importedRows: facts.length, rejectedRows: 0, expectedRows: outcome.sourceTotals?.rowCount ?? null, reconciled: true },
      totalsMinor: null, measure: { type: 'count', unit: outcome.observed.unit, total: outcome.observed.total }, unmappedFields: [...outcome.unmappedFields], qualification: 'experimental', recipeId: outcome.recipe.id };
    state.imports.push(record);
    audit(state, 'source.imported', { importId: record.id, sourceId: target.sourceId, rowCount: rowIds.length });
    return { importId: record.id, rowIds, duplicate: false, measure: 'count' as const };
  });
}
