/**
 * Training ladder steps 1 and 2 (architecture piece 13; plan day 8, block 9).
 *
 * Step 1 looks up the most similar past recipes before a new one is proposed: the base recipes
 * shipped with the app, recipes of imports on this computer that reproduced their source totals,
 * and recipes the owner saved to the library. Step 2 forces every proposal, from the library or
 * from a model, through the mapping language's grammar: anything that cannot be true, such as a
 * source field the file does not have or a dictionary word that does not exist, is removed and
 * named. Nothing here imports data; the import itself still runs through `sources.preview`.
 */
import { audit, check, newId, now, type Context, type State } from '../contracts.ts';
import { current, digest } from '../actions.ts';
import { defaultRecipe, demoRecipe, type Binding, type ImportFormat, type MappingRecipe } from '../ingest.ts';
import type { FieldType as DictionaryFieldType } from '../ontology.ts';
import type { MethodSpec } from '../modules/types.ts';
import { area, canSee, limitOf, peekArea } from './state.ts';
import { recordDecision } from './log.ts';
import { SYSTEMS } from './vocabulary.ts';

export type GrammarIssue = { path: string; code: string };
export type GrammarResult = { valid: boolean; recipe: MappingRecipe | null; issues: GrammarIssue[]; removed: GrammarIssue[]; missingTargets: string[] };
export type LibraryEntry = { id: string; origin: 'base' | 'local' | 'saved'; system: string; recipe: MappingRecipe; passedTests: boolean; sourceIds: string[]; at?: string };
type Saved = { entries: (LibraryEntry & { memberId: string })[] };

const RECIPE_KEYS = ['version', 'id', 'system', 'edition', 'scope', 'bindings', 'allowedKinds', 'allowedStatuses', 'onUnmapped', 'ignoredFields', 'tallyLedgerClasses', 'bankLayout'];
const BINDING_KEYS = ['target', 'source', 'constant', 'type', 'nulls', 'values', 'dateFormat', 'moneyUnit', 'currency', 'fx'];
const CORE_TARGETS = ['entityId', 'kind', 'validFrom', 'validTo', 'branch'];
export const REQUIRED_TARGETS = ['entityId', 'kind', 'validFrom', 'amountMinor', 'currency'];
const TYPES = ['string', 'money', 'date', 'integer', 'boolean'];
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const shortText = (value: unknown, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
export const normalizeHeader = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/**
 * The mapping language's grammar, the same rules `sources.preview` enforces, as a pure check.
 * Forbidden keys reject the whole recipe; a binding that cannot be true is removed and named.
 */
export function constrainRecipe(input: unknown, context: { dictionary?: Record<string, DictionaryFieldType> | null; sourceFields?: string[] } = {}): GrammarResult {
  const issues: GrammarIssue[] = [], removed: GrammarIssue[] = [];
  const refuse = (path: string, code: string): GrammarResult => ({ valid: false, recipe: null, issues: [...issues, { path, code }], removed, missingTargets: [] });
  if (!plain(input)) return refuse('', 'INVALID_RECIPE');
  if (!Object.keys(input).every(key => RECIPE_KEYS.includes(key))) return refuse('', 'RECIPE_CODE_FORBIDDEN');
  const recipe = structuredClone(input) as MappingRecipe;
  if (recipe.version !== 1 || typeof recipe.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,120}$/.test(recipe.id)) issues.push({ path: 'id', code: 'INVALID_RECIPE' });
  if (!shortText(recipe.system) || !shortText(recipe.edition, 80)) issues.push({ path: 'system', code: 'INVALID_RECIPE' });
  if (!plain(recipe.scope) || !shortText(recipe.scope.company) || !Array.isArray(recipe.scope.branches) || recipe.scope.branches.length === 0 || !recipe.scope.branches.every(branch => shortText(branch, 80))) issues.push({ path: 'scope', code: 'MISSING_SCOPE' });
  if (!Array.isArray(recipe.bindings) || recipe.bindings.length > 1000) return refuse('bindings', 'INVALID_BINDING');
  if (!recipe.bindings.every(binding => plain(binding) && Object.keys(binding).every(key => BINDING_KEYS.includes(key)))) return refuse('bindings', 'RECIPE_CODE_FORBIDDEN');
  const fields = context.dictionary ?? null, sources = context.sourceFields ? new Set(context.sourceFields) : null;
  const targets = new Set<string>(), kept: Binding[] = [];
  recipe.bindings.forEach((binding, index) => {
    const path = `bindings.${index}`, drop = (code: string) => removed.push({ path: `${path}:${typeof binding.target === 'string' ? binding.target.slice(0, 64) : ''}`, code });
    if (typeof binding.target !== 'string' || !(CORE_TARGETS.includes(binding.target) || (fields ? Object.hasOwn(fields, binding.target) : /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(binding.target)))) return drop('UNKNOWN_BINDING');
    if (targets.has(binding.target)) return drop('UNKNOWN_BINDING');
    if ((typeof binding.source === 'string') === (binding.constant !== undefined)) return drop('AMBIGUOUS_BINDING');
    if (typeof binding.source === 'string' && (binding.source.length === 0 || binding.source.length > 200)) return drop('AMBIGUOUS_BINDING');
    if (binding.constant !== undefined && !shortText(binding.constant)) return drop('AMBIGUOUS_BINDING');
    if (sources && typeof binding.source === 'string' && !sources.has(binding.source)) return drop('SOURCE_FIELD_ABSENT');
    if (!TYPES.includes(binding.type) || !['reject', 'omit', 'zero'].includes(binding.nulls)) return drop('INVALID_BINDING');
    if (fields && Object.hasOwn(fields, binding.target) && fields[binding.target] !== binding.type) return drop('BINDING_TYPE_MISMATCH');
    if (['entityId', 'kind', 'branch'].includes(binding.target) && binding.type !== 'string') return drop('BINDING_TYPE_MISMATCH');
    if (['validFrom', 'validTo'].includes(binding.target) && binding.type !== 'date') return drop('BINDING_TYPE_MISMATCH');
    if (binding.type === 'date' && !['ISO', 'DMY', 'YMD8'].includes(binding.dateFormat ?? '')) return drop('AMBIGUOUS_DATE');
    if (binding.type === 'money' && (!['major', 'minor'].includes(binding.moneyUnit ?? '') || typeof binding.currency !== 'string' || !/^[A-Z]{3}$/.test(binding.currency))) return drop('AMBIGUOUS_MONEY');
    if (binding.fx !== undefined && !(plain(binding.fx) && /^\d{1,30}$/.test(String(binding.fx.numerator)) && BigInt(binding.fx.numerator) > 0n && /^\d{1,30}$/.test(String(binding.fx.denominator)) && BigInt(binding.fx.denominator) > 0n && ['exact', 'half-up'].includes(binding.fx.rounding))) return drop('INVALID_EXCHANGE_RATE');
    if (binding.values !== undefined && !(plain(binding.values) && Object.keys(binding.values).length <= 500 && Object.values(binding.values).every(value => typeof value === 'string' && value.length <= 200))) return drop('INVALID_BINDING');
    targets.add(binding.target); kept.push(binding);
  });
  recipe.bindings = kept;
  const missingTargets = REQUIRED_TARGETS.filter(target => !targets.has(target));
  if (missingTargets.length) issues.push({ path: 'bindings', code: 'MISSING_BINDING' });
  if (!Array.isArray(recipe.allowedKinds) || recipe.allowedKinds.length === 0 || !recipe.allowedKinds.every(kind => shortText(kind, 64))
    || !Array.isArray(recipe.allowedStatuses) || !recipe.allowedStatuses.every(status => typeof status === 'string' && status.length <= 64) || !['report', 'reject'].includes(recipe.onUnmapped)) issues.push({ path: 'assertions', code: 'MISSING_ASSERTIONS' });
  if (recipe.ignoredFields !== undefined && !(Array.isArray(recipe.ignoredFields) && recipe.ignoredFields.every(field => shortText(field)))) issues.push({ path: 'ignoredFields', code: 'INVALID_RECIPE' });
  if (recipe.tallyLedgerClasses !== undefined && !(plain(recipe.tallyLedgerClasses) && Object.values(recipe.tallyLedgerClasses).every(value => ['sales', 'purchase', 'bank', 'tax', 'other'].includes(value as string)))) issues.push({ path: 'tallyLedgerClasses', code: 'INVALID_RECIPE' });
  if (sources && recipe.bankLayout !== undefined) for (const key of ['idField', 'dateField', 'descriptionField', 'debitField', 'creditField', 'balanceField'] as const) if (!sources.has(recipe.bankLayout[key])) issues.push({ path: `bankLayout.${key}`, code: 'SOURCE_FIELD_ABSENT' });
  return { valid: issues.length === 0, recipe, issues, removed, missingTargets };
}

const baseFormats: [ImportFormat, string][] = [['csv', 'canonical'], ['tally-xml', 'tally'], ['gst-json', 'gst-portal'], ['bank-csv', 'bank'], ['zoho-json', 'zoho-books'], ['shopify-json', 'shopify']];
export function baseLibrary(): LibraryEntry[] {
  return baseFormats.map(([format, system]) => { const recipe = format === 'csv' ? structuredClone(demoRecipe) : defaultRecipe(format); return { id: `base:${recipe.id}`, origin: 'base' as const, system, recipe, passedTests: true, sourceIds: [] }; });
}
/** Every recipe the caller may see: base, reconciled imports on this computer, and saved entries. */
export function library(state: State, ctx: Context): LibraryEntry[] {
  const local = state.imports.filter(item => item?.retainedInput?.input?.recipe && item.coverage?.reconciled === true && canSee(state, ctx, [item.sourceId]))
    .map(item => ({ id: `local:${item.id}`, origin: 'local' as const, system: String(item.retainedInput.input.recipe.system), recipe: structuredClone(item.retainedInput.input.recipe) as MappingRecipe, passedTests: true, sourceIds: [item.sourceId], at: item.at }));
  const saved = (peekArea<Saved>(state, 'recipes')?.entries ?? []).filter(entry => canSee(state, ctx, entry.sourceIds)).map(({ memberId: _member, ...entry }) => structuredClone(entry));
  return [...baseLibrary(), ...local, ...saved];
}
function recipeFields(recipe: MappingRecipe): string[] {
  const layout = recipe.bankLayout ? [recipe.bankLayout.idField, recipe.bankLayout.dateField, recipe.bankLayout.descriptionField, recipe.bankLayout.debitField, recipe.bankLayout.creditField, recipe.bankLayout.balanceField] : [];
  return [...new Set([...recipe.bindings.map(binding => binding.source).filter((field): field is string => typeof field === 'string'), ...(recipe.ignoredFields ?? []), ...layout])];
}

export type LookupRequest = { fields: string[]; system?: string; limit: number };
export function lookupRequest(payload: Record<string, unknown>): LookupRequest {
  check(Array.isArray(payload.fields) && payload.fields.length > 0 && payload.fields.length <= 500 && payload.fields.every(field => shortText(field)), 'INVALID_REQUEST', 'Give the file\'s column names, at most 500.');
  check(payload.system === undefined || (SYSTEMS as readonly unknown[]).includes(payload.system), 'INVALID_REQUEST', 'Name a registered system family.');
  return { fields: [...new Set(payload.fields as string[])], system: payload.system as string | undefined, limit: limitOf(payload.limit, 3, 20) };
}
/** A recipe's system name to its registered family, by its leading words ('tally-export' is tally). */
export function familyOf(system: string): string {
  const name = system.toLowerCase();
  return [...SYSTEMS].sort((a, b) => b.length - a.length).find(family => name === family || name.startsWith(`${family}-`) || name.startsWith(`${family}_`)) ?? 'other';
}
const originRank = { local: 0, saved: 1, base: 2 } as const;
/** Integer percentage similarity: shared normalized column names over all names, plus a system bonus. */
export function lookup(state: State, ctx: Context, request: LookupRequest) {
  const wanted = new Map(request.fields.map(field => [normalizeHeader(field), field]));
  return library(state, ctx).map(entry => {
    const known = new Set(recipeFields(entry.recipe).map(normalizeHeader).filter(Boolean));
    const matched = [...wanted.keys()].filter(key => known.has(key));
    const union = new Set([...wanted.keys(), ...known]).size;
    const overlap = union === 0 ? 0 : Math.floor(matched.length * 100 / union);
    const score = Math.min(100, overlap + (request.system && request.system === familyOf(entry.system) ? 20 : 0));
    return { id: entry.id, origin: entry.origin, system: familyOf(entry.system), recipeId: entry.recipe.id, passedTests: entry.passedTests, score, matched: matched.map(key => wanted.get(key)!), digest: digest(entry.recipe), at: entry.at ?? null };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || Number(b.passedTests) - Number(a.passedTests) || originRank[a.origin] - originRank[b.origin] || a.id.localeCompare(b.id)).slice(0, request.limit);
}

/** Common Indian export words for the canonical names; used to adapt a library recipe to a new file. */
const SYNONYMS: Record<string, string[]> = {
  id: ['id', 'number', 'no', 'voucherno', 'vouchernumber', 'invoiceno', 'invoicenumber', 'billno', 'reference', 'refno', 'txnid', 'transactionid', 'guid'],
  date: ['date', 'invoicedate', 'billdate', 'voucherdate', 'txndate', 'transactiondate', 'valuedate', 'orderdate', 'tarikh'],
  amount: ['amount', 'total', 'value', 'amt', 'netamount', 'grandtotal', 'taxablevalue', 'invoicevalue', 'rakam', 'raqam'],
  customerId: ['customerid', 'customer', 'party', 'partyname', 'buyer', 'client', 'ledger', 'partyledger'],
  invoiceId: ['invoiceid', 'invoiceno', 'invoicenumber', 'billno', 'vouchernumber'],
  dueDate: ['duedate', 'paymentdue', 'due'], status: ['status', 'state', 'paymentstatus'],
  description: ['description', 'narration', 'particulars', 'remarks', 'details', 'vivaran'], kind: ['kind', 'type', 'vouchertype', 'doctype'],
  currency: ['currency', 'cur', 'ccy'], branch: ['branch', 'location', 'godown', 'outlet', 'store'], orderId: ['orderid', 'orderno', 'ordernumber'],
};
function adaptSource(source: string, fields: Map<string, string>): string | undefined {
  const key = normalizeHeader(source);
  if (fields.has(key)) return fields.get(key);
  const family = Object.entries(SYNONYMS).find(([name, words]) => normalizeHeader(name) === key || words.includes(key));
  return family ? family[1].map(word => fields.get(word)).find(Boolean) ?? fields.get(normalizeHeader(family[0])) : undefined;
}

export type ProposalRequest = LookupRequest & { scope: MappingRecipe['scope']; candidate?: unknown; sourceIds: string[] };
/** Propose a recipe: a model's candidate, or the best library match adapted to the file, always constrained. */
export function propose(state: State, ctx: Context, dictionary: Record<string, DictionaryFieldType> | null, request: ProposalRequest) {
  const fields = new Map(request.fields.map(field => [normalizeHeader(field), field]));
  let basedOn: { id: string; origin: string; score: number } | null = null, draft: unknown;
  if (request.candidate !== undefined) draft = request.candidate;
  else {
    const best = lookup(state, ctx, { ...request, limit: 1 })[0];
    check(best, 'NO_LIBRARY_MATCH', 'No similar recipe exists yet. Map the columns by hand or ask the model for a candidate.');
    const entry = library(state, ctx).find(item => item.id === best.id)!;
    basedOn = { id: best.id, origin: best.origin, score: best.score };
    const recipe = structuredClone(entry.recipe);
    recipe.id = `proposed-${normalizeHeader(entry.recipe.id).slice(0, 40) || 'recipe'}-v1`;
    recipe.scope = structuredClone(request.scope);
    recipe.bindings = recipe.bindings.map(binding => typeof binding.source === 'string' ? { ...binding, source: adaptSource(binding.source, fields) ?? binding.source } : binding);
    delete recipe.bankLayout; delete recipe.tallyLedgerClasses;
    recipe.ignoredFields = (recipe.ignoredFields ?? []).filter(field => fields.has(normalizeHeader(field)));
    draft = recipe;
  }
  const result = constrainRecipe(draft, { dictionary, sourceFields: request.fields });
  const mapped = new Set(result.recipe?.bindings.map(binding => binding.source).filter(Boolean) ?? []);
  return { ...result, basedOn, unmappedFields: request.fields.filter(field => !mapped.has(field) && !(result.recipe?.ignoredFields ?? []).includes(field)), digest: result.recipe ? digest(result.recipe) : null };
}
const learningTargets: Record<string, string> = { entityId: 'reference', kind: 'kind', validFrom: 'date', amountMinor: 'amount', taxMinor: 'tax', currency: 'currency', customerId: 'customer-id', invoiceId: 'invoice-id', orderId: 'order-id', dueDate: 'due-date', status: 'status', description: 'description', branch: 'branch', quantity: 'quantity', sku: 'sku', bankReference: 'bank-reference' };
const structureFields = (recipe: MappingRecipe | null) => (recipe?.bindings ?? []).filter(binding => learningTargets[binding.target]).map(binding => [learningTargets[binding.target], binding.type === 'money' ? 'decimal' : binding.type]);

function scopeOf(value: unknown, ctx: Context, state: State): MappingRecipe['scope'] {
  check(plain(value) && shortText(value.company) && Array.isArray(value.branches) && value.branches.length > 0 && value.branches.length <= 50 && value.branches.every(branch => shortText(branch, 80)) && Object.keys(value).every(key => ['company', 'branches', 'gstin'].includes(key)), 'MISSING_SCOPE', 'A recipe names its company and branches.');
  const member = current(state, ctx, 'prepare');
  check(member.branches.includes('*') || (value.branches as string[]).every(branch => member.branches.includes(branch)), 'BRANCH_FORBIDDEN', 'The recipe includes a branch outside your permissions.');
  return structuredClone(value) as MappingRecipe['scope'];
}
const dictionaryFields = (state: State) => (state.ontology?.current ?? null)?.fields as Record<string, DictionaryFieldType> | undefined ?? null;
const sourceIdsOf = (value: unknown) => { check(value === undefined || Array.isArray(value) && value.length <= 16 && value.every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id)), 'INVALID_REQUEST', 'Name at most 16 sources.'); return [...new Set((value ?? []) as string[])].sort(); };
const systemOf = (system: string | undefined) => (SYSTEMS as readonly string[]).includes(system ?? '') ? system as typeof SYSTEMS[number] : undefined;

export const recipeMethods: Record<string, MethodSpec> = {
  'learningx.recipeLookup': { permission: 'read', handler: (ctx, payload, host) => {
    const state = host.store.read(); current(state, ctx);
    return { items: lookup(state, ctx, lookupRequest(payload)), librarySize: library(state, ctx).length };
  } },
  'learningx.recipeCheck': { permission: 'read', handler: (ctx, payload, host) => {
    const state = host.store.read(); current(state, ctx);
    check(payload.fields === undefined || Array.isArray(payload.fields) && payload.fields.length <= 500 && payload.fields.every(field => shortText(field)), 'INVALID_REQUEST', 'Give at most 500 column names.');
    return constrainRecipe(payload.recipe, { dictionary: dictionaryFields(state), sourceFields: payload.fields as string[] | undefined });
  } },
  'learningx.recipePropose': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => {
    const request = { ...lookupRequest(payload), scope: scopeOf(payload.scope, ctx, state), candidate: payload.candidate, sourceIds: sourceIdsOf(payload.sourceIds) };
    const result = propose(state, ctx, dictionaryFields(state), request);
    const entry = recordDecision(state, ctx, { event: { kind: 'mapping', choice: 'proposed', reason: result.valid ? 'library-match' : 'grammar-refused', ...(systemOf(request.system) ? { system: systemOf(request.system) } : {}), fields: structureFields(result.recipe) }, sourceIds: request.sourceIds });
    return { ...result, decisionId: entry.id, origin: request.candidate === undefined ? 'library' : 'model' };
  }) },
  'learningx.recipeSave': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'prepare');
    const sourceIds = sourceIdsOf(payload.sourceIds);
    check(canSee(state, ctx, sourceIds), 'SOURCE_REVOKED', 'This source is no longer available to your account.');
    const result = constrainRecipe(payload.recipe, { dictionary: dictionaryFields(state) });
    check(result.valid && result.removed.length === 0 && result.recipe, 'RECIPE_GRAMMAR', 'Only a recipe that follows the mapping language completely is kept in the library.');
    check(typeof payload.passedTests === 'boolean', 'INVALID_REQUEST', 'Say whether the recipe reproduced its source totals.');
    const saved = area<Saved>(state, 'recipes', () => ({ entries: [] }));
    check(saved.entries.length < 2000, 'LIBRARY_FULL', 'The local recipe library is full.');
    const entry = { id: newId('saved'), origin: 'saved' as const, system: result.recipe.system, recipe: result.recipe, passedTests: payload.passedTests, sourceIds, at: now(), memberId: ctx.memberId };
    saved.entries.push(entry); audit(state, 'learningx.recipe-saved', { id: entry.id });
    const { memberId: _member, ...view } = entry; return structuredClone(view);
  }) },
  'learningx.recipeForget': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'prepare');
    const saved = peekArea<Saved>(state, 'recipes'), index = saved?.entries.findIndex(entry => entry.id === payload.id && (entry.memberId === ctx.memberId || ctx.role === 'owner')) ?? -1;
    check(saved && index >= 0, 'NOT_FOUND', 'That saved recipe is not in the library.');
    saved.entries.splice(index, 1); return { deleted: true };
  }) },
};

/** The library index is on the deletion list: saved recipes from a removed source go with it. */
export function purgeRecipes(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string> }): number {
  const saved = peekArea<Saved>(state, 'recipes');
  if (!saved) return 0;
  const before = saved.entries.length;
  saved.entries = saved.entries.filter(entry => !entry.sourceIds.some(id => reason.sourceIds.includes(id) || reason.removedIds.has(id)) && !reason.removedIds.has(entry.id));
  return before - saved.entries.length;
}
