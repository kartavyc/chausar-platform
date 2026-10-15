import { audit, authorize, check, newId, now, type Context, type StateStore } from '../contracts.ts';
import { currentAccess } from '../memory.ts';
import type { ModuleHost } from '../modules/types.ts';
import { sourceAllowed } from '../trust.ts';
import { digest as digestOf } from '../actions.ts';
import { RECIPES, runCompiled } from './recipes/index.ts';
import { ANSWER_LIMITS, diffRecipes, takeRead, withAnswers, answersFor, type Answer } from './answers.ts';
import { answered, outcomeSummary, recordEnvelope, shape } from './service.ts';
import { cxState, peekCx, type Envelope, type Reconciliation } from './state.ts';
import type { SourceRecipe } from './recipe.ts';

/**
 * `recipes.*` (BK-05): answer a recipe's question in place, compare recipe versions, and
 * reconcile an import against the source's own total again. The work-books Recipes screen calls these.
 */
const REQUEST = 'CONNECTOR_REQUEST_INVALID';
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const view = (store: StateStore, state: any): StateStore => ({ read: () => state, update: store.update.bind(store) });
function trusted(ctx: Context) {
  check((ctx.channel === undefined || ctx.channel === 'desktop') && ctx.sourceTainted !== true, 'OPEN_DESKTOP', 'Do this yourself in the desktop app.');
}
/** Whether the caller may see this branch and source; an envelope outside it is "not found". */
function canSee(host: ModuleHost, ctx: Context, item: { branch: string; sourceId: string }): boolean {
  const state = host.store.read(), member = authorize(host.store, ctx);
  return (member.branches.includes('*') || member.branches.includes(item.branch)) && sourceAllowed(state, ctx, item.sourceId);
}
function envelopeFor(host: ModuleHost, ctx: Context, id: unknown): Envelope {
  check(typeof id === 'string' && ID.test(id), REQUEST, 'Choose a read.');
  const found = peekCx(host.store.read()).envelopes.find(item => item.id === id);
  check(found && canSee(host, ctx, found), 'ENVELOPE_NOT_FOUND', 'This read is no longer available.');
  return found!;
}
function who(host: ModuleHost, ctx: Context) {
  const member = host.store.read().members.find(item => item.id === ctx.memberId);
  return { memberId: ctx.memberId, name: member?.name ?? ctx.memberId, role: member?.role ?? ctx.role };
}
const publicAnswer = (answer: Answer) => structuredClone(answer);
/** The base recipe a read was made with: registered by id, or (for a database read) the kept compiled recipe. */
function baseRecipe(host: ModuleHost, envelope: Envelope): SourceRecipe | null {
  const registered = RECIPES.get(envelope.recipeId);
  if (registered) return registered;
  const kept = peekCx(host.store.read()).recipesKept?.find(item => item.digest === envelope.recipeDigest)?.recipe ?? null;
  return kept;
}

export const recipeHandlers = {
  async answer(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['envelopeId', 'choice'], ['envelopeId', 'choice']);
    const envelope = envelopeFor(host, ctx, payload.envelopeId);
    currentAccess(host.store, ctx, envelope.branch, envelope.sourceId);
    const question = envelope.question;
    check(envelope.status === 'abstained' && question, 'RECIPE_QUESTION_NONE', 'This read did not ask a question.');
    check(typeof payload.choice === 'string' && question!.choices.includes(payload.choice), 'RECIPE_ANSWER_INVALID', 'Choose one of the offered answers.');
    const registered = RECIPES.get(envelope.recipeId);
    check(!registered || registered.version === envelope.recipeVersion, 'RECIPE_ANSWER_STALE', 'The recipe changed since this read. Read the source again.');
    const base = baseRecipe(host, envelope);
    check(base, 'RECIPE_ANSWER_STALE', 'The recipe changed since this read. Read the source again.');
    const by = who(host, ctx);
    const answer = await host.store.update(state => {
      authorize(view(host.store, state), ctx, 'prepare');
      const cx = cxState(state), answers = cx.answers ??= [];
      // One answer per question: a new answer for the same value replaces the old one.
      const same = (item: Answer) => item.sourceId === envelope.sourceId && item.recipeId === envelope.recipeId && item.recipeVersion === envelope.recipeVersion
        && item.reason === question!.reason && item.field === question!.field && item.sample === question!.sample && (item.target ?? null) === (question!.target ?? null);
      cx.answers = answers.filter(item => !same(item));
      check(cx.answers.length < ANSWER_LIMITS.answers, 'ANSWER_LIMIT', 'Remove earlier answers before adding more.');
      const item: Answer = { id: newId('answer'), sourceId: envelope.sourceId, recipeId: envelope.recipeId, recipeVersion: envelope.recipeVersion, reason: question!.reason, field: question!.field,
        target: question!.target ?? null, sample: question!.sample, choice: payload.choice, answeredBy: { ...by, at: now() }, envelopeId: envelope.id };
      // The answered recipe must still compile as data before the answer is kept.
      withAnswers(base!, answersFor(envelope.sourceId, base!, [...cx.answers, item]));
      cx.answers.push(item);
      audit(state, 'connectorsx.answered', { answerId: item.id, recipeId: item.recipeId, reason: item.reason, envelopeId: envelope.id });
      return structuredClone(item);
    });
    const held = takeRead(host, ctx, envelope.id);
    if (!held) return { answer: publicAnswer(answer), read: null, readAgain: envelope.road === 'file' ? 'bring-the-file-again' : 'read-again' };
    const use = answered(host, held.target.sourceId, held.base);
    const outcome = runCompiled(use.recipe, held.input, held.options);
    if (held.ocrNotice) outcome.notices.push(held.ocrNotice);
    const connection = held.connectionId ? peekCx(host.store.read()).connections.find(item => item.id === held.connectionId) ?? null : null;
    const read = await recordEnvelope(host, ctx, { outcome, connection, target: held.target, recipe: use.recipe, road: held.road, requestedPeriod: held.requestedPeriod, read: held.read,
      answerIds: use.applied, hold: { base: held.base, input: held.input, options: held.options, ocrNotice: held.ocrNotice } });
    return { answer: publicAnswer(answer), read: outcomeSummary(read), readAgain: 'not-needed' };
  },
  answers(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['recipeId', 'sourceId']);
    check(payload.recipeId === undefined || (typeof payload.recipeId === 'string' && ID.test(payload.recipeId)), REQUEST, 'Name the recipe.');
    check(payload.sourceId === undefined || (typeof payload.sourceId === 'string' && ID.test(payload.sourceId)), REQUEST, 'Name the source.');
    const cx = peekCx(host.store.read()), branchOf = (sourceId: string) => cx.connections.find(item => item.sourceId === sourceId)?.branch ?? cx.envelopes.find(item => item.sourceId === sourceId)?.branch ?? 'main';
    return { answers: (cx.answers ?? []).filter(item => (payload.recipeId === undefined || item.recipeId === payload.recipeId) && (payload.sourceId === undefined || item.sourceId === payload.sourceId)
      && canSee(host, ctx, { sourceId: item.sourceId, branch: branchOf(item.sourceId) })).slice().reverse().map(publicAnswer) };
  },
  async answerRemove(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['answerId'], ['answerId']);
    check(typeof payload.answerId === 'string' && ID.test(payload.answerId), REQUEST, 'Choose an answer.');
    const listed = recipeHandlers.answers(ctx, {}, host).answers.find(item => item.id === payload.answerId);
    check(listed, 'ANSWER_NOT_FOUND', 'This answer is not in the list.');
    return host.store.update(state => {
      authorize(view(host.store, state), ctx, 'prepare');
      const cx = cxState(state), before = cx.answers?.length ?? 0;
      cx.answers = (cx.answers ?? []).filter(item => item.id !== payload.answerId);
      check(cx.answers.length < before, 'ANSWER_NOT_FOUND', 'This answer is not in the list.');
      audit(state, 'connectorsx.answer-removed', { answerId: payload.answerId });
      return { removed: true, answerId: payload.answerId };
    });
  },
  upgradeDiff(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['recipeId', 'envelopeId', 'sourceId'], ['recipeId']);
    const seed = RECIPES.get(payload.recipeId);
    check(typeof payload.recipeId === 'string' && seed, 'RECIPE_NOT_FOUND', 'Choose a registered recipe.');
    const cx = peekCx(host.store.read());
    const side = (recipe: SourceRecipe, label: string) => ({ version: recipe.version, digest: digestOf(recipe), label });
    let from: SourceRecipe | null = seed!, to: SourceRecipe = seed!, fromLabel = 'seed', toLabel = 'current';
    if (payload.envelopeId !== undefined) {
      const envelope = envelopeFor(host, ctx, payload.envelopeId);
      check(envelope.recipeId === payload.recipeId, 'ENVELOPE_NOT_FOUND', 'This read was made with another recipe.');
      from = cx.recipesKept?.find(item => item.digest === envelope.recipeDigest)?.recipe ?? null; fromLabel = 'read-with';
      to = answered(host, envelope.sourceId, seed!).recipe; toLabel = to === seed ? 'current' : 'with-answers';
    } else if (payload.sourceId !== undefined) {
      check(typeof payload.sourceId === 'string' && ID.test(payload.sourceId), REQUEST, 'Name the source.');
      const known = cx.connections.find(item => item.sourceId === payload.sourceId) ?? cx.envelopes.find(item => item.sourceId === payload.sourceId);
      check(!known || canSee(host, ctx, known), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
      to = answered(host, payload.sourceId, seed!).recipe; toLabel = to === seed ? 'current' : 'with-answers';
    }
    if (!from) return { recipeId: seed!.id, available: false, reason: 'OLD_VERSION_NOT_KEPT', from: null, to: side(to, toLabel), same: false, changes: [] };
    const changes = diffRecipes(from, to);
    return { recipeId: seed!.id, available: true, reason: null, from: side(from, fromLabel), to: side(to, toLabel), same: changes.length === 0, changes };
  },
  async reconcile(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['envelopeId', 'reportTotals'], ['envelopeId']);
    const envelope = envelopeFor(host, ctx, payload.envelopeId);
    let typed: { total: string; rowCount: number | null } | null = null;
    if (payload.reportTotals !== undefined) {
      const value = payload.reportTotals;
      check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['total', 'rowCount'].includes(key)) && typeof value.total === 'string' && /^-?\d{1,30}$/.test(value.total)
        && (value.rowCount === undefined || value.rowCount === null || (Number.isSafeInteger(value.rowCount) && value.rowCount >= 0)), 'INVALID_SOURCE_TOTALS', 'Enter the report total as whole minor units and an optional row count.');
      typed = { total: value.total, rowCount: value.rowCount ?? null };
    }
    const state = host.store.read(), recipe = baseRecipe(host, envelope);
    const measure: 'money' | 'count' = recipe ? recipe.measure.type : /^[A-Z]{3}$/.test(envelope.observed.unit) ? 'money' : 'count';
    const theirs = typed ? { total: typed.total, rowCount: typed.rowCount, reference: 'report-entered-by-person', provenance: 'user-entered-report' }
      : envelope.sourceTotals ? { total: envelope.sourceTotals.total, rowCount: envelope.sourceTotals.rowCount, reference: envelope.sourceTotals.reference, provenance: envelope.sourceTotals.provenance } : null;
    const record = envelope.committed ? state.imports.find(item => item.id === envelope.committed!.importId) : null;
    let ours: Reconciliation['ours'] = { total: null, rowCount: 0, live: 0, changed: 0 }, status: Reconciliation['status'];
    if (!record) status = 'not-imported';
    else {
      const ids = new Set<string>(Array.isArray(record.rowIds) ? record.rowIds : []);
      // Facts are bitemporal: a later version of the same record (same source, kind and entity) replaces this one.
      const latest = new Map<string, string>();
      for (const fact of state.facts) if (fact.sourceId === envelope.sourceId) latest.set(`${fact.kind}\u0000${fact.entityId}`, fact.id);
      let sum = 0n, live = 0, changed = 0, found = 0, unreadable = false;
      for (const fact of state.facts) {
        if (!ids.has(fact.id)) continue;
        found++;
        if (fact.deletedAt || fact.supersededAt || latest.get(`${fact.kind}\u0000${fact.entityId}`) !== fact.id) { changed++; continue; }
        const raw = measure === 'money' ? fact.fields.amountMinor : fact.fields.quantity;
        const text = typeof raw === 'string' || typeof raw === 'bigint' || (typeof raw === 'number' && Number.isSafeInteger(raw)) ? String(raw) : '';
        if (!/^-?\d{1,30}$/.test(text)) { unreadable = true; continue; }
        sum += BigInt(text); live++;
      }
      // A fact no longer in memory at all (removed by deletion) counts as changed too.
      changed += ids.size - found;
      ours = { total: unreadable ? null : String(sum), rowCount: ids.size, live, changed };
      status = changed > 0 || unreadable ? 'rows-changed' : !theirs || theirs.total === null ? 'no-source-total'
        : theirs.total === ours.total && (theirs.rowCount === null || theirs.rowCount === live) ? 'matches' : 'differs';
    }
    const result: Reconciliation = { at: now(), by: who(host, ctx), importId: record?.id ?? null, status, theirs, ours, measure, unit: envelope.observed.unit };
    await host.store.update(next => {
      authorize(view(host.store, next), ctx, 'prepare');
      const current = cxState(next).envelopes.find(item => item.id === envelope.id);
      check(current, 'ENVELOPE_NOT_FOUND', 'This read is no longer available.');
      current.reconciliations = [...(current.reconciliations ?? []), result].slice(-10);
      audit(next, 'connectorsx.reconciled', { envelopeId: envelope.id, status });
    });
    return { envelopeId: envelope.id, ...structuredClone(result) };
  },
};
