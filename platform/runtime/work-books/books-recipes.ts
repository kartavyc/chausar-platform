/**
 * Recipes (BK-05) and "Map this field" (BK-06).
 *
 * Two kinds of recipe meet here. Connector recipes (`connectorsx.recipes`) are registered with
 * the app: their state comes from the reads made with them, their check from the latest read's
 * two totals, and their questions from reads that abstained or failed a check. A field of a
 * file import that no recipe covers can be mapped: the person names the meaning, and the
 * learning lane's grammar (`learningx.recipePropose`) constrains the proposal. A proposal stays
 * "proposed" until a named person accepts it; accepting keeps it in the recipe library
 * (`learningx.recipeSave`). Nothing here changes an import: "Try it on a copy" (BK-09) does that safely.
 */
import { check, newId, now, type Context, type State } from '../contracts.ts';
import { parseCsv, type Binding, type MappingRecipe } from '../ingest.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { canonical, input, member, plainId, text, writeBooks, type BooksState } from './books-common.ts';
import { envelopes, NOT_INSTALLED, type EnvelopeView } from './books-connectors.ts';
import { sourceVisible } from './books-sources.ts';

type Raw = Record<string, unknown>;
const plain = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const str = (value: unknown, max = 400): string | null => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : null;
const REQUEST = 'INVALID_BOOKS_REQUEST';

/* ------------------------------------------------------------------ lane state (round 2) */

export type Grade = 'model' | 'owner' | 'accountant' | 'ca' | 'reconciled';
export type Proposal = {
  id: string; sourceId: string; field: string; target: string | null; origin: 'library' | 'person';
  recipe: MappingRecipe | null; baseRecipe: MappingRecipe | null; digest: string | null; valid: boolean;
  issues: { path: string; code: string }[]; removed: { path: string; code: string }[]; missingTargets: string[];
  proposedBy: string; proposedById: string; at: string; state: 'proposed' | 'accepted' | 'declined' | 'published';
  decided: { by: string; role: string; at: string } | null; libraryId: string | null;
};
export type TrialRecord = { trialId: string; draftId: string | null; proposalId: string | null; digest: string; by: string; at: string };
type R2 = { proposals: Proposal[]; trials: TrialRecord[] };
/** Round-2 lists in the Books section; call only inside `store.update`. */
export function r2(books: BooksState): R2 {
  const value = books as BooksState & Partial<R2>;
  if (!Array.isArray(value.proposals)) value.proposals = [];
  if (!Array.isArray(value.trials)) value.trials = [];
  return value as R2;
}
export function peekR2(state: State): R2 {
  const books = (state.extensions?.['work-books'] as Record<string, unknown> | undefined)?.books as Partial<R2> | undefined;
  return { proposals: Array.isArray(books?.proposals) ? books!.proposals : [], trials: Array.isArray(books?.trials) ? books!.trials : [] };
}
/** Source deletion removes proposals and trial records built from the removed source. */
export function r2Purge(state: State, sourceIds: ReadonlySet<string>): number {
  const books = (state.extensions?.['work-books'] as Record<string, unknown> | undefined)?.books as Partial<R2> | undefined;
  if (!books || !Array.isArray(books.proposals)) return 0;
  const before = books.proposals.length;
  const gone = new Set(books.proposals.filter(p => sourceIds.has(p.sourceId)).map(p => p.id));
  books.proposals = books.proposals.filter(p => !gone.has(p.id));
  if (Array.isArray(books.trials)) books.trials = books.trials.filter(t => t.proposalId === null || !gone.has(t.proposalId));
  return before - books.proposals.length;
}

/* ------------------------------------------------------------------ connector recipes */

const QUESTION_REASONS = ['value-not-in-list', 'binding-not-settled', 'not-known-whether-applies', 'check-failed', 'too-little-evidence'] as const;
type QuestionReason = typeof QUESTION_REASONS[number];
const CHECK_FAILURES = new Set(['SOURCE_TOTAL_MISMATCH', 'SOURCE_ROW_MISMATCH', 'BALANCE_BROKEN', 'SOURCE_CUT_SHORT', 'MISSING_AMOUNT']);
function reasonOf(e: EnvelopeView): QuestionReason | null {
  if (e.status === 'abstained') return e.abstention?.reason === 'unknown_value' ? 'value-not-in-list' : 'binding-not-settled';
  if (e.status === 'refused' && (CHECK_FAILURES.has(e.refusal?.code ?? '') || e.total.match === 'no')) return 'check-failed';
  return null;
}
type RecipeRow = { id: string; version: string; system: string; operation: string; title: string; state: 'seed' | 'tested' | 'not-yet-tested' | 'failed'; totals: string; measure: 'money' | 'count'; lastReadAt: string | null };
type RawRecipe = { row: RecipeRow; fields: { name: string; type: string; required: boolean; headings: string[] }[]; notices: string[] };
function recipeOf(raw: unknown, reads: EnvelopeView[]): RawRecipe | null {
  if (!plain(raw)) return null;
  const id = str(raw.id, 200), version = str(raw.version, 40), group = str(raw.group, 80);
  if (!id || !version || !group) return null;
  const mine = reads.filter(e => e.recipeId === id), latest = mine[0];
  const state = !latest ? 'seed' : latest.status === 'accepted' ? 'tested' : latest.status === 'abstained' ? 'not-yet-tested' : 'failed';
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).filter(plain).slice(0, 200).flatMap(f => {
    const name = str(f.name, 120); if (!name) return [];
    return [{ name, type: str(f.type, 40) ?? 'text', required: f.required === true, headings: (Array.isArray(f.headings) ? f.headings : []).map(h => str(h, 200)).filter((h): h is string => h !== null).slice(0, 20) }];
  });
  return { row: { id, version, system: group, operation: str(raw.operation, 120) ?? '', title: str(raw.title, 300) ?? id, state, totals: str(raw.totals, 40) ?? 'report',
    measure: raw.measure === 'count' ? 'count' : 'money', lastReadAt: latest?.at ?? null }, fields,
    notices: (Array.isArray(raw.notices) ? raw.notices : []).map(n => str(n, 600)).filter((n): n is string => n !== null).slice(0, 10) };
}
async function connectorRecipes(host: ModuleHost, ctx: Context, group?: string): Promise<{ available: boolean; recipes: RawRecipe[]; reads: EnvelopeView[] }> {
  const reply = await optionalCall(host, 'connectorsx.recipes', group ? { group } : {});
  if (!reply.available) return { available: false, recipes: [], reads: [] };
  const reads = (await envelopes(host, ctx)).items;
  return { available: true, reads, recipes: (Array.isArray(reply.value) ? reply.value : []).slice(0, 2000).map(r => recipeOf(r, reads)).filter((r): r is RawRecipe => r !== null) };
}

/* ------------------------------------------------------------------ mapping proposals */

const gradeOf = (role: string): Grade => role === 'accountant' ? 'accountant' : role === 'ca' ? 'ca' : 'owner';
type Imported = { importId: string; recipe: MappingRecipe; columns: string[]; reconciled: boolean; unmapped: string[] };
/** The latest file import of a source that kept its recipe, with its column names. */
function latestImport(state: State, sourceId: string): Imported | null {
  const record = state.imports.filter(i => i.sourceId === sourceId && plain(i.retainedInput?.input?.recipe)).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
  if (!record) return null;
  const recipe = structuredClone(record.retainedInput.input.recipe) as MappingRecipe, content = record.retainedInput.input.content;
  const unmapped: string[] = Array.isArray(record.unmappedFields) ? record.unmappedFields.filter((f: unknown): f is string => typeof f === 'string') : [];
  let columns: string[] = [];
  if (typeof content === 'string' && ['csv', 'bank-csv'].includes(record.format)) { try { columns = Object.keys(parseCsv(content)[0] ?? {}); } catch { columns = []; } }
  if (!columns.length) columns = [...new Set([...recipe.bindings.map(b => b.source).filter((s): s is string => typeof s === 'string'), ...(recipe.ignoredFields ?? []), ...unmapped])];
  return { importId: record.id, recipe, columns: columns.slice(0, 500), reconciled: record.coverage?.reconciled === true, unmapped };
}
type BindingRow = { target: string; source: string | null; type: string; state: 'accepted' | 'proposed'; acceptedBy: { by: string; role: string; at: string } | null; grade: Grade | null; change: 'same' | 'new' | 'changed' };
function proposalView(p: Proposal, state: State) {
  const base = new Map((p.baseRecipe?.bindings ?? []).map(b => [b.target, b] as const));
  const imported = latestImport(state, p.sourceId);
  const bindings: BindingRow[] = (p.recipe?.bindings ?? []).map(b => {
    const before = base.get(b.target), change = !before ? 'new' as const : canonical(before) === canonical(b) ? 'same' as const : 'changed' as const;
    if (change === 'same') return { target: b.target, source: b.source ?? null, type: b.type, state: 'accepted' as const, acceptedBy: null, grade: imported?.reconciled ? 'reconciled' as const : null, change };
    // A changed or new binding is "proposed" until a named person accepts it.
    if (p.decided && (p.state === 'accepted' || p.state === 'published')) return { target: b.target, source: b.source ?? null, type: b.type, state: 'accepted' as const, acceptedBy: structuredClone(p.decided), grade: gradeOf(p.decided.role), change };
    return { target: b.target, source: b.source ?? null, type: b.type, state: 'proposed' as const, acceptedBy: null, grade: null, change };
  });
  const removedTargets = [...base.keys()].filter(t => !(p.recipe?.bindings ?? []).some(b => b.target === t));
  return { id: p.id, sourceId: p.sourceId, field: p.field, target: p.target, origin: p.origin, state: p.state, proposedBy: p.proposedBy, at: p.at,
    valid: p.valid, fieldBound: (p.recipe?.bindings ?? []).some(b => b.source === p.field), digest: p.digest,
    scope: p.recipe ? { system: p.recipe.system, company: p.recipe.scope?.company ?? null, branches: [...(p.recipe.scope?.branches ?? [])] } : null,
    bindings, dropped: removedTargets, issues: structuredClone(p.issues), removed: structuredClone(p.removed), missingTargets: [...p.missingTargets],
    decided: p.decided ? structuredClone(p.decided) : null, libraryId: p.libraryId,
    // The import's current recipe changed since this proposal was made: what is proposed is compared with a recipe no longer in use.
    baseChanged: !!imported && !!p.baseRecipe && canonical(imported.recipe) !== canonical(p.baseRecipe) };
}
const TYPES = ['string', 'money', 'date', 'integer', 'boolean'] as const;

export const recipeMethods: Record<string, MethodSpec> = {
  'books.recipes': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['group']); check(request.group === undefined || (typeof request.group === 'string' && /^[a-z0-9-]{1,80}$/.test(request.group)), REQUEST, 'Name one system.');
    const found = await connectorRecipes(host, ctx, request.group);
    const state = host.store.read();
    return { available: found.available, recipes: found.recipes.map(r => r.row),
      proposals: peekR2(state).proposals.filter(p => sourceVisible(host.store, ctx, p.sourceId)).map(p => {
        const v = proposalView(p, state); return { id: v.id, sourceId: v.sourceId, field: v.field, state: v.state, proposedBy: v.proposedBy, at: v.at, valid: v.valid };
      }).reverse() };
  } },
  'books.recipe': { permission: 'read', async handler(ctx, payload, host) {
    const { recipeId } = input(payload, ['recipeId'], ['recipeId']); check(plainId(recipeId), REQUEST, 'Name the recipe.');
    const found = await connectorRecipes(host, ctx);
    check(found.available, NOT_INSTALLED, 'Connecting systems is not installed in this build. Bring a file instead.');
    const recipe = found.recipes.find(r => r.row.id === recipeId); check(recipe, 'RECIPE_NOT_FOUND', 'This recipe is not in the list.');
    const reads = found.reads.filter(e => e.recipeId === recipeId), latest = reads[0] ?? null;
    const reconciled = latest?.status === 'accepted' && latest.total.match === 'yes';
    const scopeSource = latest ? (await optionalCall(host, 'connectorsx.envelopes', { sourceId: latest.sourceId, limit: 1 })) : { available: false as const };
    const raw = scopeSource.available && Array.isArray(scopeSource.value) && plain(scopeSource.value[0]) ? scopeSource.value[0] : null;
    return { recipe: recipe.row,
      scope: { system: recipe.row.system, company: str(raw?.company, 200), branch: str(raw?.branch, 100), gstin: null, period: latest?.period ?? null },
      // Registered recipes are seeds shipped with the app: no person has accepted their bindings. A reconciled read grades them.
      bindings: recipe.fields.map(f => ({ meaning: f.name, headings: f.headings, type: f.type, required: f.required, state: 'seed' as const, acceptedBy: null, grade: reconciled ? 'reconciled' as const : null })),
      check: latest ? { envelopeId: latest.id, at: latest.at, ...latest.total } : null,
      questions: reads.flatMap(e => { const reason = reasonOf(e); if (!reason) return [];
        return [{ envelopeId: e.id, sourceId: e.sourceId, at: e.at, reason, detail: e.abstention?.reason ?? e.refusal?.code ?? null, field: e.abstention?.field ?? null,
          question: e.abstention?.question ?? null, choices: e.abstention?.options ?? [], ours: e.total.ours, theirs: e.total.theirs, measure: e.total.measure, unit: e.total.unit }]; }).slice(0, 20),
      newer: latest && latest.recipeVersion && latest.recipeVersion !== recipe.row.version ? { readWith: latest.recipeVersion, current: recipe.row.version } : null,
      notices: recipe.notices, sourceIds: [...new Set(reads.map(e => e.sourceId))] };
  } },
  'books.mapField': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['sourceId', 'field', 'target', 'type', 'dateFormat', 'moneyUnit'], ['sourceId', 'field']);
    check(plainId(request.sourceId) && text(request.field, 200), REQUEST, 'Name the source and the field.');
    check(request.target === undefined || (typeof request.target === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(request.target) && TYPES.includes(request.type)), REQUEST, 'Name the meaning and its type.');
    check(request.dateFormat === undefined || ['ISO', 'DMY', 'YMD8'].includes(request.dateFormat), REQUEST, 'Choose how dates are written.');
    check(request.moneyUnit === undefined || ['major', 'minor'].includes(request.moneyUnit), REQUEST, 'Choose rupees or paise.');
    check(sourceVisible(host.store, ctx, request.sourceId), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
    const state = host.store.read(), imported = latestImport(state, request.sourceId);
    check(imported, 'MAP_FIELD_NOT_AVAILABLE', 'Only a field of an imported file can be mapped here. A connected system\'s recipe is changed by its own lane.');
    check(imported.columns.includes(request.field) && !imported.recipe.bindings.some(b => b.source === request.field), 'FIELD_NOT_UNMAPPED', 'This field is not one that no recipe covers.');
    let candidate: MappingRecipe | undefined;
    if (request.target !== undefined) {
      const binding: Binding = { target: request.target, source: request.field, type: request.type, nulls: 'omit',
        ...(request.type === 'date' ? { dateFormat: request.dateFormat ?? 'ISO' } : {}),
        ...(request.type === 'money' ? { moneyUnit: request.moneyUnit ?? 'major', currency: imported.recipe.bindings.find(b => b.type === 'money')?.currency ?? 'INR' } : {}) } as Binding;
      candidate = { ...structuredClone(imported.recipe), id: `${imported.recipe.id}-mapped`.slice(0, 120),
        bindings: [...imported.recipe.bindings.filter(b => b.target !== request.target), binding], ignoredFields: (imported.recipe.ignoredFields ?? []).filter(f => f !== request.field) };
    }
    // The learning lane's grammar decides what can be true; anything it removes is named, never kept.
    const reply = await optionalCall(host, 'learningx.recipePropose', { fields: imported.columns, scope: structuredClone(imported.recipe.scope), sourceIds: [request.sourceId], ...(candidate ? { candidate } : {}) });
    check(reply.available, 'RECIPE_PROPOSALS_NOT_INSTALLED', 'Recipe proposals are not installed in this build.');
    const result = reply.value as Raw;
    check(plain(result) && typeof result.valid === 'boolean', 'LEARNING_REPLY_INVALID', 'The learning lane answered in an unexpected shape.');
    const issues = (list: unknown) => (Array.isArray(list) ? list : []).filter(plain).slice(0, 200).map(i => ({ path: str(i.path, 200) ?? '', code: str(i.code, 64) ?? 'INVALID_RECIPE' }));
    const who = member(state, ctx);
    return writeBooks(host.store, ctx, 'prepare', books => {
      const lists = r2(books);
      check(lists.proposals.filter(p => p.state === 'proposed').length < 200, 'PROPOSAL_LIMIT', 'Decide earlier proposals before making more.');
      const proposal: Proposal = { id: newId('proposal'), sourceId: request.sourceId, field: request.field, target: request.target ?? null, origin: candidate ? 'person' : 'library',
        recipe: plain(result.recipe) ? structuredClone(result.recipe) as unknown as MappingRecipe : null, baseRecipe: imported.recipe, digest: str(result.digest, 200),
        valid: result.valid === true, issues: issues(result.issues), removed: issues(result.removed),
        missingTargets: (Array.isArray(result.missingTargets) ? result.missingTargets : []).map(t => str(t, 64)).filter((t): t is string => t !== null),
        proposedBy: who.name, proposedById: ctx.memberId, at: now(), state: 'proposed', decided: null, libraryId: null };
      lists.proposals.push(proposal);
      return proposalView(proposal, host.store.read());
    });
  } },
  'books.proposal': { permission: 'read', handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']); check(plainId(id), REQUEST, 'Name the proposal.');
    const state = host.store.read(), found = peekR2(state).proposals.find(p => p.id === id);
    check(found && sourceVisible(host.store, ctx, found.sourceId), 'PROPOSAL_NOT_FOUND', 'This proposal was not found.');
    return proposalView(found, state);
  } },
  'books.decideProposal': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'decision', 'digest'], ['id', 'decision', 'digest']);
    check(plainId(request.id) && ['accept', 'decline'].includes(request.decision) && typeof request.digest === 'string', REQUEST, 'Accept or decline the proposal you read.');
    const state = host.store.read(), found = peekR2(state).proposals.find(p => p.id === request.id);
    check(found && sourceVisible(host.store, ctx, found.sourceId), 'PROPOSAL_NOT_FOUND', 'This proposal was not found.');
    check(found.state === 'proposed', 'ALREADY_DECIDED', 'This proposal was already decided.');
    check(request.digest === found.digest, 'PREVIEW_CHANGED', 'The proposal changed since you read it. Read it again.');
    let libraryId: string | null = null;
    if (request.decision === 'accept') {
      check(found.valid && found.removed.length === 0 && found.recipe, 'RECIPE_GRAMMAR', 'Only a recipe that follows the mapping language completely can be accepted.');
      const saved = await optionalCall(host, 'learningx.recipeSave', { recipe: found.recipe, sourceIds: [found.sourceId], passedTests: false });
      check(saved.available, 'RECIPE_PROPOSALS_NOT_INSTALLED', 'Recipe proposals are not installed in this build.');
      libraryId = plain(saved.value) ? str(saved.value.id, 200) : null;
    }
    const who = member(state, ctx);
    return writeBooks(host.store, ctx, 'prepare', (books, latest) => {
      const stored = r2(books).proposals.find(p => p.id === found.id);
      check(stored && stored.state === 'proposed', 'ALREADY_DECIDED', 'This proposal was already decided.');
      stored.state = request.decision === 'accept' ? 'accepted' : 'declined';
      stored.decided = { by: who.name, role: who.role, at: now() }; stored.libraryId = libraryId;
      return proposalView(stored, latest);
    });
  } },
};
