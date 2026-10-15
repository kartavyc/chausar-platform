/**
 * Definitions and provenance (BK-08, AS-05 and the receipt small print).
 *
 * Meaning reviews are kept here, keyed by the exact dictionary version and hash, because a
 * published dictionary's hash covers its content and is never rewritten. Co-signs made on a
 * work-books draft (`books.cosign`) are read from that lane's state, read only, and tied to
 * the release through its publication attempt (`books-<draftId>`). Neither a review nor a
 * co-sign counts when it comes from the publisher.
 *
 * Every receipt the calculator makes gets `receipt.provenance` through the calculator's
 * decorator hook, from the same state the calculation read: the recipes behind its imports
 * and who accepted them, the meaning's publisher, reviewer and co-signer, the forecast line
 * (a calculation is never a forecast, so null) and the Allowed by line (rule, check, device).
 */
import { audit, authorize, check, ChausarError, newId, now, type Context, type State } from '../contracts.ts';
import { registerReceiptDecorator, type CalculationReceipt, type ReceiptProvenance } from '../calculator.ts';
import type { Dictionary } from '../ontology.ts';
import { moduleState, peekModuleState, type MethodSpec } from '../modules/types.ts';
import { peekBooks } from '../work-books/books-common.ts';

type ReviewKind = 'review' | 'cosign';
export type MeaningReview = { id: string; dictionaryHash: string; version: number; kind: ReviewKind; memberId: string; epoch: number; at: string };
export type ProvenanceState = { reviews: MeaningReview[] };
type Signer = { kind: ReviewKind; memberId: string; at: string | null; via: 'meanings.review' | 'books.cosign' };
type Person = { memberId: string; name: string };

const REVIEWER_ROLES = ['owner', 'cofounder', 'accountant'];
const MAX_REVIEWS = 10_000;
const HASH = /^[a-f0-9]{64}$/;

function peekProvenance(state: State): ProvenanceState {
  const value = peekModuleState<Record<string, unknown>>(state, 'core-data')?.provenance as Partial<ProvenanceState> | undefined;
  return { reviews: Array.isArray(value?.reviews) ? value.reviews : [] };
}
function writeProvenance(state: State): ProvenanceState {
  const space = moduleState<Record<string, unknown>>(state, 'core-data', () => ({}));
  const value = (space.provenance ??= { reviews: [] }) as ProvenanceState;
  if (!Array.isArray(value.reviews)) value.reviews = [];
  return value;
}
function exact(payload: unknown, allowed: string[], required: string[] = allowed): Record<string, any> {
  check(!!payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(payload, k)),
    'INVALID_PROVENANCE_REQUEST', 'Use only the declared request fields.');
  return payload as Record<string, any>;
}
function person(state: State, memberId: string): Person { return { memberId, name: state.members.find(m => m.id === memberId)?.name ?? 'unknown' }; }
function history(state: State): Dictionary[] {
  const list: Dictionary[] = Array.isArray(state.ontology?.history) ? state.ontology.history : [];
  return list.length ? list : [state.ontology?.current ?? (state.ontology?.operations ? state.ontology : null)].filter(Boolean);
}

/** Reviewers and co-signers of one exact release, oldest first, never the publisher. */
export function signersOf(state: State, dictionary: Dictionary): Signer[] {
  const signers: Signer[] = peekProvenance(state).reviews.filter(r => r?.dictionaryHash === dictionary.hash && r.version === dictionary.version)
    .map(r => ({ kind: r.kind, memberId: r.memberId, at: r.at, via: 'meanings.review' as const }));
  const attempts: { attemptId?: unknown; dictionaryHash?: unknown; version?: unknown }[] = Array.isArray(state.ontology?.publicationAttempts) ? state.ontology.publicationAttempts : [];
  const books = peekBooks(state);
  for (const meta of books.draftMeta) {
    if (meta?.publishedVersion !== dictionary.version || !Array.isArray(meta.cosignerIds)) continue;
    const attemptId = `books-${meta.draftId}`.slice(0, 128);
    if (!attempts.some(a => a?.attemptId === attemptId && a.dictionaryHash === dictionary.hash && a.version === dictionary.version)) continue;
    const cosigns = (books.drafts.find(d => d?.id === meta.draftId)?.reviews ?? []).filter(r => r?.kind === 'cosign');
    meta.cosignerIds.forEach((memberId, index) => { if (typeof memberId === 'string') signers.push({ kind: 'cosign', memberId, at: typeof cosigns[index]?.at === 'string' ? cosigns[index].at : null, via: 'books.cosign' }); });
  }
  return signers.filter(s => s.memberId !== dictionary.publishedBy).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

/** The recipe behind each counted import, and who accepted it and when (null when no record says). */
export function recipesOf(state: State, receipt: Pick<CalculationReceipt, 'sourceIds' | 'coverage'>): NonNullable<ReceiptProvenance['recipes']> {
  const found = new Map<string, NonNullable<ReceiptProvenance['recipes']>[number]>();
  const add = (sourceId: unknown, recipeId: unknown, acceptedBy: unknown, acceptedAt: unknown) => {
    if (typeof sourceId !== 'string' || typeof recipeId !== 'string' || !recipeId) return;
    found.set(JSON.stringify([sourceId, recipeId]), { sourceId, recipeId, acceptedBy: typeof acceptedBy === 'string' ? acceptedBy : null, acceptedAt: typeof acceptedAt === 'string' ? acceptedAt : null });
  };
  for (const importId of receipt.coverage?.importIds ?? []) {
    const record = state.imports.find(i => i?.id === importId); if (!record) continue;
    if (record.type === 'connector-capture-v1') {
      // A connector capture runs under a mapping recipe a reviewer accepted (connectors.reviewMapping).
      const review = state.imports.find(i => i?.type === 'connector-mapping-review-v1' && i.id === record.reviewId);
      add(record.sourceId, record.recipe?.id, review?.reviewer?.memberId, review?.reviewedAt);
    } else if (record.retainedInput) {
      // imports.commit retains its recipe; the accepted import decision names who committed it.
      const decision = state.learning.find(l => l?.type === 'decision' && l.importIdentity?.id === record.id && l.importIdentity.outcome === 'accepted');
      add(record.sourceId, record.retainedInput.input?.recipe?.id, decision?.memberId, decision?.at);
    }
  }
  const covered = new Set([...found.values()].map(r => r.sourceId));
  for (const sourceId of receipt.sourceIds ?? []) {
    if (covered.has(sourceId)) continue;
    // sources.accept: the latest accepted connector recipe proposal for this source.
    const proposal = state.learning.filter(l => l?.category === 'connector-recipe' && l.status === 'accepted' && l.sourceId === sourceId).at(-1);
    if (proposal) add(sourceId, proposal.id, proposal.acceptedBy, proposal.acceptedAt);
  }
  return [...found.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.recipeId.localeCompare(b.recipeId));
}

/** Which trust rule let this member read the counted sources: explicit grants first, else the workspace policy. */
function ruleOf(state: State, sourceIds: string[]): string {
  if (!sourceIds.length) return 'member-access';
  const grants = state.sourceRules.filter(r => typeof r?.sourceId === 'string' && sourceIds.includes(r.sourceId) && typeof r.id === 'string').map(r => r.id as string).sort();
  // An identifier (letters, digits and _ . : + -), at most four grant ids, so readers can show it as a rule id.
  if (grants.length) return `source-grant:${grants.slice(0, 4).map(id => id.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40)).join('+')}${grants.length > 4 ? '+more' : ''}`;
  return state.policy?.allowedSources?.includes('*') ? 'policy.allowed-sources:all' : 'policy.allowed-sources:listed';
}
/** The deciding check steps, as an identifier: source access passed, then the number guard passed. */
const CHECK_STEP = 'source-access+number-guard';

/** The calculator's receipt decorator: records what can only be known when the receipt is made. */
export function decorateReceipt(ctx: Context, receipt: CalculationReceipt, state: State): void {
  const dictionary = history(state).find(d => d?.hash === receipt.dictionaryHash && d.version === receipt.ontologyVersion);
  const signers = dictionary ? signersOf(state, dictionary) : [];
  const review = signers.filter(s => s.kind === 'review').at(-1), cosign = signers.filter(s => s.kind === 'cosign').at(-1);
  const channel = ctx.channel === 'desktop' || ctx.channel === 'phone' || ctx.channel === 'mcp' ? ctx.channel : null;
  receipt.provenance = {
    recipes: recipesOf(state, receipt),
    ...(dictionary ? { meaning: { publishedBy: dictionary.publishedBy, reviewedBy: review?.memberId ?? null, coSignedBy: cosign?.memberId ?? null, reviewedAt: review?.at ?? null } } : {}),
    forecast: null,
    // Without a channel the caller is an in-process host task; the device is then unknown and the line is not recorded.
    ...(channel ? { allowedBy: { ruleId: ruleOf(state, receipt.sourceIds), check: CHECK_STEP, device: channel, memberId: ctx.memberId, at: receipt.createdAt } } : {}),
  };
}
registerReceiptDecorator(decorateReceipt);

/** The latest forecast evaluation of this seat that learned from or was tested on this receipt. */
function forecastLine(state: State, ctx: Context, receiptId: string) {
  const saved = state.answers.filter(a => a?.type === 'forecast-evaluation-v1' && a.memberId === ctx.memberId && a.epoch === ctx.epoch && Array.isArray(a.receiptIds) && a.receiptIds.includes(receiptId)).at(-1);
  if (!saved) return 'not applicable' as const;
  const span = (periods: { from: string; to: string }[]) => periods.length ? { from: periods.map(p => p.from).sort()[0], to: periods.map(p => p.to).sort().at(-1)! } : 'not counted' as const;
  const words = { 'lower-absolute-error': 'beat the baseline', 'equal-absolute-error': 'tied with the baseline', 'higher-absolute-error': 'did not beat the baseline', unscored: 'not counted' } as Record<string, string>;
  return { forecastId: saved.id as string, method: saved.methods?.method ?? 'unknown', baseline: saved.methods?.benchmark ?? 'unknown',
    learnedFrom: span((saved.origins ?? []).flatMap((o: any) => (o.training ?? []).map((t: any) => t.period)).filter(Boolean)),
    testedOn: span((saved.folds ?? []).map((f: any) => f.targetPeriod).filter(Boolean)),
    horizons: (saved.horizons ?? []).map((h: any) => ({ horizonMonths: h.horizonMonths, result: words[h.comparison] ?? 'unknown' })),
    stale: saved.stale === true };
}

export const provenanceMethods: Record<string, MethodSpec> = {
  /** Record that the calling person reviewed (or co-signed) one exact published release. */
  'meanings.review': { permission: 'prepare', handler(ctx, payload, host) {
    const request = exact(payload, ['version', 'hash', 'kind']);
    check(Number.isSafeInteger(request.version) && request.version > 0 && typeof request.hash === 'string' && HASH.test(request.hash) && ['review', 'cosign'].includes(request.kind),
      'INVALID_PROVENANCE_REQUEST', 'Name the release by version and hash, and whether this is a review or a co-sign.');
    check(ctx.channel !== 'mcp' && !ctx.sourceTainted, 'REVIEW_NEEDS_PERSON', 'A person must record their own review.');
    return host.store.update(state => {
      const member = authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, 'prepare');
      check(REVIEWER_ROLES.includes(member.role), 'FORBIDDEN', 'Only an owner, cofounder or accountant can review a meaning.');
      const dictionary = history(state).find(d => d?.version === request.version && d.hash === request.hash);
      check(dictionary, 'RELEASE_NOT_FOUND', 'This release was not found.');
      check(dictionary.publishedBy !== ctx.memberId, 'REVIEW_SELF', 'A review must come from a different person than the publisher.');
      const store = writeProvenance(state);
      check(!signersOf(state, dictionary).some(s => s.memberId === ctx.memberId && s.kind === request.kind), 'ALREADY_REVIEWED', 'You have already recorded this for this release.');
      check(store.reviews.length < MAX_REVIEWS, 'REVIEW_LIMIT', 'Too many reviews are kept.');
      const review: MeaningReview = { id: newId('review'), dictionaryHash: dictionary.hash, version: dictionary.version, kind: request.kind, memberId: ctx.memberId, epoch: ctx.epoch, at: now() };
      store.reviews.push(review); audit(state, 'meaning.reviewed', { version: review.version, kind: review.kind });
      return { version: review.version, hash: review.dictionaryHash, kind: review.kind, by: person(state, review.memberId), at: review.at };
    });
  } },
  /** Every published release, oldest first, with publisher, reviewers, co-signers and each definition's example and date used. */
  'meanings.releases': { permission: 'read', handler(ctx, payload, host) {
    exact(payload, []); const state = host.store.read(); authorize(host.store, ctx);
    return { releases: history(state).map(dictionary => {
      const signers = signersOf(state, dictionary).map(s => ({ ...person(state, s.memberId), at: s.at ?? 'unknown', via: s.via, kind: s.kind }));
      const reviewers = signers.filter(s => s.kind === 'review').map(({ kind: _kind, ...s }) => s), coSigners = signers.filter(s => s.kind === 'cosign').map(({ kind: _kind, ...s }) => s);
      return { version: dictionary.version, hash: dictionary.hash, publishedBy: person(state, dictionary.publishedBy), publishedAt: dictionary.publishedAt,
        reviewers: reviewers.length ? reviewers : 'not reviewed' as const, coSigners: coSigners.length ? coSigners : 'not co-signed' as const,
        definitions: dictionary.definitions.map(d => ({ name: d.name, label: d.label, example: d.example ? structuredClone(d.example) : 'absent' as const, usedFrom: d.usedFrom ?? 'absent' as const })) };
    }) };
  } },
  /** A receipt's full provenance. Access is exactly receipts.get's; an unknown and a forbidden receipt refuse alike. */
  'receipts.provenance': { permission: 'read', handler(ctx, payload, host) {
    const { receiptId } = exact(payload, ['receiptId']);
    check(typeof receiptId === 'string' && receiptId.length > 0 && receiptId.length <= 200, 'INVALID_PROVENANCE_REQUEST', 'Name the receipt.');
    let receipt: CalculationReceipt;
    try { receipt = host.services.calculator.receipt(ctx, receiptId); }
    catch (error) {
      if (['RECEIPT_NOT_FOUND', 'RECEIPT_FORBIDDEN'].includes((error as { code?: string })?.code ?? '')) throw new ChausarError('RECEIPT_NOT_FOUND', 'This receipt is unavailable.');
      throw error;
    }
    const state = host.store.read(), stored = receipt.provenance;
    const dictionary = history(state).find(d => d?.hash === receipt.dictionaryHash && d.version === receipt.ontologyVersion);
    const recipes = stored?.recipes ?? recipesOf(state, receipt);
    const signers = dictionary ? signersOf(state, dictionary) : [];
    const list = (kind: ReviewKind) => signers.filter(s => s.kind === kind).map(s => ({ ...person(state, s.memberId), at: s.at ?? 'unknown', via: s.via }));
    const reviewedBy = list('review'), coSignedBy = list('cosign');
    return {
      receiptId: receipt.id, recorded: stored ? 'recorded' as const : 'not recorded' as const,
      recipes: receipt.sourceIds.map(sourceId => {
        const found = recipes.filter(r => r.sourceId === sourceId);
        return found.length ? found.map(r => ({ sourceId, state: 'recorded' as const, recipeId: r.recipeId,
          acceptedBy: r.acceptedBy ? person(state, r.acceptedBy) : 'unknown' as const, acceptedAt: r.acceptedAt ?? 'unknown' as const }))
          : [{ sourceId, state: 'absent' as const }];
      }).flat(),
      meaning: !dictionary ? 'absent' as const : {
        version: dictionary.version, hash: dictionary.hash, publishedBy: person(state, dictionary.publishedBy), publishedAt: dictionary.publishedAt,
        reviewedBy: reviewedBy.length ? reviewedBy : 'not reviewed' as const, coSignedBy: coSignedBy.length ? coSignedBy : 'not co-signed' as const,
        atCalculation: !stored?.meaning ? 'not recorded' as const : {
          reviewedBy: stored.meaning.reviewedBy ? { ...person(state, stored.meaning.reviewedBy), at: stored.meaning.reviewedAt ?? 'unknown' } : 'not reviewed' as const,
          coSignedBy: stored.meaning.coSignedBy ? person(state, stored.meaning.coSignedBy) : 'not co-signed' as const } },
      forecast: forecastLine(state, ctx, receipt.id),
      allowedBy: !stored?.allowedBy ? 'not recorded' as const : { ruleId: stored.allowedBy.ruleId, checkStep: stored.allowedBy.check,
        device: { channel: stored.allowedBy.device, deviceId: 'absent' as const }, by: person(state, stored.allowedBy.memberId), at: stored.allowedBy.at },
    };
  } },
};
