/**
 * Try a change on a copy (BK-09), experimental. A meaning draft (BK-08) or a recipe proposal
 * (BK-05/06) is run on a private copy through the core `trials.*` methods: the copy is made,
 * the chosen saved questions are worked out twice (now, and with the change), and the two
 * figures are shown side by side. The copy never runs an action and never sends anything out
 * (core trials refuse both). Publish goes through `trials.promote` under the same rules as a
 * normal release (co-sign, approve seat); Discard removes the copy.
 */
import { check, hash, type Context, type State } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, peekBooks, plainId, writeBooks, type Amount } from './books-common.ts';
import { assertPublishable, metaOf } from './books-meanings.ts';
import { peekR2, r2 } from './books-recipes.ts';
import { sourceVisible } from './books-sources.ts';

type Raw = Record<string, unknown>;
const plain = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const str = (value: unknown, max = 400): string | null => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : null;
const minor = (value: unknown): Amount => typeof value === 'string' && /^-?\d{1,30}$/.test(value) ? { minor: String(BigInt(value)) } : { missing: 'unknown' };
const REQUEST = 'INVALID_BOOKS_REQUEST';

type Question = { id: string; receiptId: string; operation: string; period: { from: string; to: string } | null; stale: boolean };
async function savedQuestions(host: ModuleHost): Promise<{ available: boolean; items: Question[] }> {
  const reply = await optionalCall(host, 'trials.savedQuestions', {});
  if (!reply.available) return { available: false, items: [] };
  return { available: true, items: (Array.isArray(reply.value) ? reply.value : []).filter(plain).slice(0, 500).flatMap(q => {
    const id = str(q.id, 200), receiptId = str(q.receiptId, 200), request = plain(q.request) ? q.request : {};
    if (!id || !receiptId) return [];
    const p = plain(request.period) && typeof request.period.from === 'string' && typeof request.period.to === 'string' ? { from: request.period.from, to: request.period.to } : null;
    return [{ id, receiptId, operation: str(request.operation, 80) ?? '', period: p, stale: q.stale === true }];
  }) };
}

type Cell = { value: Amount; refused: string | null; receipt: { operation: string; period: { from: string; to: string } | null; counted: number; excluded: number; definitions: string[]; completeness: string } | null };
function cellOf(outcome: unknown): Cell {
  if (!plain(outcome)) return { value: { missing: 'unknown' }, refused: 'TRIAL_REPLY_INVALID', receipt: null };
  if (outcome.status !== 'calculated' || !plain(outcome.receipt)) return { value: { missing: 'unknown' }, refused: str(outcome.code, 64) ?? 'TRIAL_REFUSED', receipt: null };
  const r = outcome.receipt, coverage = plain(r.coverage) ? r.coverage : {};
  const n = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
  return { value: minor(r.totalMinor), refused: null, receipt: {
    operation: str(r.operation, 80) ?? '', period: plain(r.period) && typeof r.period.from === 'string' && typeof r.period.to === 'string' ? { from: r.period.from, to: r.period.to } : null,
    counted: n(coverage.countedRows), excluded: n(coverage.excludedRows),
    definitions: (Array.isArray(r.definitions) ? r.definitions : []).filter(plain).map(d => str(d.name, 80)).filter((d): d is string => d !== null).slice(0, 20),
    completeness: str(coverage.completeness, 40) ?? 'unknown' } };
}
const same = (a: Amount, b: Amount) => 'minor' in a && 'minor' in b ? a.minor === b.minor : false;

/** The Books view of one trial summary from core, with the live receipt of each saved question. */
async function trialView(host: ModuleHost, summary: unknown, record: { draftId: string | null; proposalId: string | null; precedence?: Precedence | null } | null) {
  check(plain(summary) && str(summary.trialId, 200), 'TRIAL_REPLY_INVALID', 'The copy answered in an unexpected shape.');
  const trialId = summary.trialId as string, questions = (await savedQuestions(host)).items;
  const evaluation = plain(summary.evaluation) ? summary.evaluation : null;
  const rows = (evaluation && Array.isArray(evaluation.comparisons) ? evaluation.comparisons : []).filter(plain).slice(0, 200).map(c => {
    const answerId = str(c.answerId, 200) ?? '', q = questions.find(x => x.id === answerId);
    const request = plain(c.request) ? c.request : {};
    const now = cellOf(c.baseline), changed = cellOf(c.candidate);
    return { answerId, operation: str(request.operation, 80) ?? q?.operation ?? '', period: q?.period ?? null,
      // "Now" opens the saved answer's own receipt; "with the change" lives only on the copy and is shown in the sheet.
      now: { ...now, receiptId: q?.receiptId ?? null }, withChange: { ...changed, receiptId: null },
      differs: !same(now.value, changed.value) || now.refused !== changed.refused };
  });
  let impact: { digest: string; strategy: 'prospective'; affectedAnswers: number; rebuild: number; activeWork: number } | null = null, impactCode: string | null = null;
  if (evaluation) {
    try {
      const raw = await host.call('trials.impact', { trialId, strategy: 'prospective' });
      const count = (v: unknown) => Array.isArray(v) ? v.length : 0;
      if (plain(raw) && str(raw.digest, 200)) impact = { digest: raw.digest as string, strategy: 'prospective', affectedAnswers: count(raw.affectedSavedAnswerIds), rebuild: count(raw.rebuildArtifactIds), activeWork: count(raw.activeWorkIds) };
    } catch (error) { impactCode = str((error as { code?: unknown })?.code, 64) ?? 'TRIAL_IMPACT_FAILED'; }
  }
  const change = plain(summary.change) ? summary.change : {}, cost = plain(summary.cost) ? summary.cost : {};
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  return { trialId, draftId: record?.draftId ?? null, proposalId: record?.proposalId ?? null, precedence: record?.precedence ? structuredClone(record.precedence) : null, experimental: true as const,
    status: summary.status === 'evaluated' ? 'evaluated' as const : 'created' as const,
    change: { type: str(change.type, 40) ?? 'definition', target: str(change.target, 200) ?? '' },
    cost: { preparationMs: n(cost.preparationElapsedMs), diskBytes: n(cost.totalDiskBytes) },
    evaluationDigest: str(summary.evaluationDigest, 200), rows, impact, impactCode,
    limitations: (evaluation && Array.isArray(evaluation.limitations) ? evaluation.limitations : []).map(l => str(l, 600)).filter((l): l is string => l !== null).slice(0, 10) };
}

type Precedence = { kind: string; sourceIds: string[] };
/** A source order to try (BK-14 to BK-09): which source wins for one kind of fact. */
function precedenceOf(host: ModuleHost, ctx: Context, value: unknown): Precedence {
  check(plain(value) && Object.keys(value).every(k => k === 'kind' || k === 'sourceIds') && typeof value.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.kind)
    && Array.isArray(value.sourceIds) && value.sourceIds.length > 0 && value.sourceIds.length <= 64 && value.sourceIds.every(plainId) && new Set(value.sourceIds).size === value.sourceIds.length,
  REQUEST, 'Name the kind of fact and the sources in the order to try.');
  const sourceIds = [...value.sourceIds as string[]];
  const facts = host.store.read().facts;
  // Each source must be one the caller can see and that holds facts: an order over unknown names tries nothing.
  check(sourceIds.every(id => sourceVisible(host.store, ctx, id) && facts.some(f => f.sourceId === id && !f.deletedAt)), 'SOURCE_NOT_FOUND', 'One of these sources is not available to you.');
  return { kind: value.kind as string, sourceIds };
}
const samePrecedence = (a: Precedence | null | undefined, b: Precedence) => !!a && a.kind === b.kind && a.sourceIds.join('\u0000') === b.sourceIds.join('\u0000');

/** The data-only change a draft, a proposal or a source order stands for, in the core trial contract. */
function changeFor(state: State, ctx: Context, host: ModuleHost, request: { draftId?: string; proposalId?: string; precedence?: unknown }) {
  if (request.precedence !== undefined) {
    const order = precedenceOf(host, ctx, request.precedence);
    // The copy runs exactly this order; the same order then publishes as the live source rule for this kind.
    return { change: { type: 'source-precedence', kind: order.kind, sourceIds: [...order.sourceIds] }, digest: hash(order), draftId: null, proposalId: null, precedence: order };
  }
  if (request.draftId !== undefined) {
    const books = peekBooks(state), draft = books.drafts.find(d => d.id === request.draftId);
    check(draft && (draft.state === 'draft' || draft.state === 'cosigned'), 'DRAFT_NOT_FOUND', 'This draft was not found.');
    // Removing a word is not a replacement the copy can run: core trials take a definition to put in its place.
    check(draft.after !== null && draft.before !== null, 'TRIAL_CHANGE_UNSUPPORTED', 'Only a change to an existing word can be tried on a copy. Adding or removing a word cannot.');
    const current = host.services.ontology.current(ctx);
    check(current && metaOf(books, draft.id).baseHash === current.hash, 'DICTIONARY_CONFLICT', 'A newer release landed after this draft. Draft the change again.');
    return { change: { type: 'definition', name: draft.name, replacement: structuredClone(draft.after) }, digest: draft.digest, draftId: draft.id, proposalId: null, precedence: null };
  }
  const proposal = peekR2(state).proposals.find(p => p.id === request.proposalId);
  check(proposal && sourceVisible(host.store, ctx, proposal.sourceId), 'PROPOSAL_NOT_FOUND', 'This proposal was not found.');
  check(proposal.state === 'proposed' || proposal.state === 'accepted', 'ALREADY_DECIDED', 'This proposal was already decided.');
  check(proposal.valid && proposal.recipe && proposal.baseRecipe && proposal.digest, 'RECIPE_GRAMMAR', 'Only a recipe that follows the mapping language completely can be tried.');
  return { change: { type: 'recipe', sourceId: proposal.sourceId, recipeId: proposal.baseRecipe.id, replacement: structuredClone(proposal.recipe) }, digest: proposal.digest, draftId: null, proposalId: proposal.id, precedence: null };
}
const recordFor = (state: State, ctx: Context, trialId: string) => peekR2(state).trials.find(t => t.trialId === trialId && t.by === ctx.memberId) ?? null;

export const trialMethods: Record<string, MethodSpec> = {
  'books.trialQuestions': { permission: 'read', async handler(_ctx, payload, host) {
    input(payload, []); const found = await savedQuestions(host);
    return { available: found.available, questions: found.items };
  } },
  'books.trial': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['draftId', 'proposalId', 'precedence', 'savedAnswerIds']);
    check([request.draftId, request.proposalId, request.precedence].filter(v => v !== undefined).length === 1 && (request.draftId === undefined || plainId(request.draftId)) && (request.proposalId === undefined || plainId(request.proposalId)), REQUEST, 'Name one draft, one proposal or one source order.');
    check(request.savedAnswerIds === undefined || (Array.isArray(request.savedAnswerIds) && request.savedAnswerIds.length <= 50 && request.savedAnswerIds.every(plainId)), REQUEST, 'Choose at most fifty saved questions.');
    const made = changeFor(host.store.read(), ctx, host, request);
    const questions = (await savedQuestions(host)).items;
    const ids: string[] = request.savedAnswerIds !== undefined ? [...new Set(request.savedAnswerIds as string[])] : questions.filter(q => !q.stale).map(q => q.id).slice(0, 50);
    check(ids.length > 0 && ids.every(id => questions.some(q => q.id === id)), 'TRIAL_NO_SAVED_QUESTIONS', 'Choose saved questions to work out on the copy. Ask a question first if there are none.');
    const created = await host.call('trials.create', { version: 1, savedAnswerIds: ids, change: made.change });
    check(plain(created) && str(created.trialId, 200), 'TRIAL_REPLY_INVALID', 'The copy answered in an unexpected shape.');
    const trialId = created.trialId as string;
    await writeBooks(host.store, ctx, 'prepare', books => {
      const list = r2(books).trials; list.push({ trialId, draftId: made.draftId, proposalId: made.proposalId, ...(made.precedence ? { precedence: made.precedence } : {}), digest: made.digest, by: ctx.memberId, at: new Date().toISOString() });
      if (list.length > 200) list.splice(0, list.length - 200);
    });
    const evaluated = await host.call('trials.evaluate', { trialId });
    return trialView(host, evaluated, made);
  } },
  'books.trialRead': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['trialId', 'draftId', 'proposalId', 'precedence']);
    check([request.trialId, request.draftId, request.proposalId, request.precedence].filter(v => v !== undefined).length === 1 && [request.trialId, request.draftId, request.proposalId].every(v => v === undefined || plainId(v)), REQUEST, 'Name one trial, draft, proposal or source order.');
    const order = request.precedence !== undefined ? precedenceOf(host, ctx, request.precedence) : null;
    const records = peekR2(host.store.read()).trials.filter(t => t.by === ctx.memberId);
    const record = [...records].reverse().find(t => t.trialId === request.trialId || (request.draftId !== undefined && t.draftId === request.draftId) || (request.proposalId !== undefined && t.proposalId === request.proposalId) || (order !== null && samePrecedence(t.precedence, order)));
    if (!record) return { trial: null };
    let summary: unknown;
    try { summary = await host.call('trials.get', { trialId: record.trialId }); }
    catch { return { trial: null }; }   // discarded or no longer readable by this person: there is no copy to show
    return { trial: await trialView(host, summary, record) };
  } },
  'books.trialPublish': { permission: 'approve', async handler(ctx, payload, host) {
    const request = input(payload, ['trialId', 'evaluationDigest', 'impactDigest'], ['trialId', 'evaluationDigest', 'impactDigest']);
    check(plainId(request.trialId) && typeof request.evaluationDigest === 'string' && typeof request.impactDigest === 'string', REQUEST, 'Publish the copy you reviewed.');
    const state = host.store.read(), record = recordFor(state, ctx, request.trialId);
    check(record, 'TRIAL_NOT_FOUND', 'This copy was not found.');
    if (record.draftId) {
      const books = peekBooks(state), draft = books.drafts.find(d => d.id === record.draftId);
      check(draft, 'DRAFT_NOT_FOUND', 'This draft was not found.');
      // The same rules as a release: the draft is unchanged since the copy was made, co-signed when the team needs it, and its checks pass.
      assertPublishable(state, draft, metaOf(books, draft.id), record.digest);
    } else if (record.precedence) {
      // A source order has no draft of its own: core promotion re-checks the owner's seat and that each source is still visible.
      check(record.precedence.sourceIds.every(id => sourceVisible(host.store, ctx, id)), 'SOURCE_NOT_FOUND', 'One of these sources is not available to you.');
    } else {
      const proposal = peekR2(state).proposals.find(p => p.id === record.proposalId);
      check(proposal && proposal.digest === record.digest && proposal.state === 'accepted', 'PROPOSAL_NOT_ACCEPTED', 'A named person must accept the proposal before it is published.');
    }
    const promoted = await host.call('trials.promote', { trialId: request.trialId, evaluationDigest: request.evaluationDigest, strategy: 'prospective', acknowledgedImpactDigest: request.impactDigest });
    check(plain(promoted) && str(promoted.publicationId, 200), 'TRIAL_REPLY_INVALID', 'The copy answered in an unexpected shape.');
    const version = host.services.ontology.current(ctx)?.version ?? null;
    await writeBooks(host.store, ctx, 'approve', books => {
      if (record.draftId) { const draft = books.drafts.find(d => d.id === record.draftId); if (draft) { draft.state = 'published'; const meta = metaOf(books, draft.id); meta.publishedVersion = version; } }
      else { const proposal = r2(books).proposals.find(p => p.id === record.proposalId); if (proposal) proposal.state = 'published'; }
    });
    return { trialId: request.trialId, status: 'promoted' as const, publicationId: promoted.publicationId as string, draftId: record.draftId, proposalId: record.proposalId, precedence: record.precedence ?? null };
  } },
  'books.trialDiscard': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['trialId'], ['trialId']); check(plainId(request.trialId), REQUEST, 'Name the copy.');
    check(recordFor(host.store.read(), ctx, request.trialId), 'TRIAL_NOT_FOUND', 'This copy was not found.');
    const reply = await host.call('trials.discard', { trialId: request.trialId });
    await writeBooks(host.store, ctx, 'prepare', books => { const list = r2(books).trials; const i = list.findIndex(t => t.trialId === request.trialId); if (i >= 0) list.splice(i, 1); });
    return { trialId: request.trialId, status: 'discarded' as const, cleanupComplete: plain(reply) && reply.cleanupComplete === true };
  } },
};
