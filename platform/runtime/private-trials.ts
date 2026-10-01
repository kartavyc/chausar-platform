import { performance } from 'node:perf_hooks';
import { CalculatorService, type CalculationReceipt, type CalculationRequest } from './calculator.ts';
import { ChausarError, authorize, check, hash, newId, type Context, type Fact, type State, type StateStore } from './contracts.ts';
import { ImportService, type ImportPreview, type MappingRecipe } from './ingest.ts';
import { canSeeFact, currentAccess, type FactInput } from './memory.ts';
import { compileDictionary, type Dictionary, type DictionaryDraft } from './ontology.ts';
import { assertSourceAccess } from './trust.ts';
import type {
  PrivateTrialChange, PrivateTrialComparison, PrivateTrialDifference, PrivateTrialEvaluation,
  PrivateTrialFork, PrivateTrialGuardContext, PrivateTrialHost, PrivateTrialImpact, PrivateTrialOutcome,
  PrivateTrialPromotionProposal, PrivateTrialPromotionRequest, PrivateTrialRecipeEvidence,
  PrivateTrialRequest, PrivateTrialSavedRequest, PrivateTrialStrategy, PrivateTrialVersionPin,
} from './private-trial-contracts.ts';

const keys = (value: unknown, allowed: string[], code = 'INVALID_PRIVATE_TRIAL') => {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), code, 'Only the declared typed private trial properties are accepted.');
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const dictionary = (state: State): Dictionary => {
  const result = state.ontology?.current ?? state.ontology;
  check(result?.hash && Number.isSafeInteger(result.version), 'DICTIONARY_REQUIRED', 'A retained published dictionary is required for a private trial.');
  return result;
};
const readOnly = (state: State): StateStore => ({ read: () => structuredClone(state), update: async () => { throw new ChausarError('TRIAL_READ_ONLY', 'This private trial view is read only.'); } });
/** Ignore output history and revision: saving a trial artifact must not stale its own base. */
const authority = (state: State) => ({
  schemaVersion: state.schemaVersion, workspace: state.workspace, members: state.members, policy: state.policy,
  ontology: state.ontology, facts: state.facts, imports: state.imports, sourceRules: state.sourceRules,
  merges: state.merges, tombstones: state.tombstones,
});
const authorityDigest = (state: State) => hash(authority(state));
const withoutDigest = <T extends { digest: string }>(record: T) => { const { digest: ignored, ...body } = record; return body; };
const receiptMeaning = (receipt: CalculationReceipt) => { const { id: ignoredId, createdAt: ignoredTime, ...meaning } = receipt; return meaning; };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)])) : value;

function dataOnly(value: unknown, seen = new Set<object>(), depth = 0) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isFinite(value), 'INVALID_PRIVATE_TRIAL', 'Trial numbers must be finite.'); return; }
  check(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'INVALID_PRIVATE_TRIAL', 'Trials accept inert data, never code or class instances.');
  check(depth <= 32 && !seen.has(value), 'INVALID_PRIVATE_TRIAL', 'Trial data must have bounded depth and no circular references.'); seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    check(!['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_PRIVATE_TRIAL', 'Reserved data properties are refused.'); dataOnly(child, seen, depth + 1);
  }
  seen.delete(value);
}

function validateChange(change: PrivateTrialChange, state: State) {
  dataOnly(change);
  keys(change, change?.type === 'definition' ? ['type', 'name', 'replacement'] : change?.type === 'recipe' ? ['type', 'sourceId', 'recipeId', 'replacement'] : ['type', 'kind', 'sourceIds']);
  if (change.type === 'definition') {
    const published = dictionary(state).definitions.filter(item => item.name === change.name);
    check(published.length === 1 && change.replacement?.name === change.name, 'TRIAL_DEFINITION_REQUIRED', 'Replace exactly one existing definition without renaming it.');
    check(hash(published[0]) !== hash(change.replacement), 'TRIAL_NO_CHANGE', 'The proposed definition must differ from its baseline.');
  } else if (change.type === 'recipe') {
    check(id(change.sourceId) && id(change.recipeId) && change.replacement?.id === change.recipeId, 'TRIAL_RECIPE_REQUIRED', 'Replace one named recipe belonging to one source.');
  } else {
    check(change.type === 'source-precedence' && /^[a-z][a-z0-9_]{0,63}$/.test(change.kind), 'INVALID_PRIVATE_TRIAL', 'Choose a typed definition, recipe or source precedence change.');
    check(Array.isArray(change.sourceIds) && change.sourceIds.length <= 64 && change.sourceIds.every(id) && new Set(change.sourceIds).size === change.sourceIds.length, 'INVALID_SOURCE_RULE', 'A precedence proposal needs distinct, plain source identifiers.');
    const previous = state.sourceRules.filter(rule => rule.kind === change.kind && Array.isArray(rule.sourceIds)).at(-1);
    check(hash(previous?.sourceIds ?? []) !== hash(change.sourceIds), 'TRIAL_NO_CHANGE', 'The proposed precedence must differ from its baseline.');
  }
}

function isolate(state: State): State {
  const copy = structuredClone(state);
  // No action, transport, workflow, model, route or live output is installed in a fork.
  for (const field of ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts', 'activity', 'conflicts', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const) copy[field] = [];
  return copy;
}

function pin(state: State, evidence: PrivateTrialRecipeEvidence[], candidateRecipe?: MappingRecipe): PrivateTrialVersionPin {
  const d = dictionary(state);
  return {
    dictionaryVersion: d.version, dictionaryHash: d.hash, dictionaryDigest: hash(state.ontology),
    factsDigest: hash(state.facts), importsDigest: hash(state.imports), sourceRulesDigest: hash(state.sourceRules),
    identityDigest: hash({ merges: state.merges, tombstones: state.tombstones }),
    recipes: evidence.map(item => ({ sourceId: item.sourceId, recipeId: item.recipe.id, schemaVersion: item.recipe.version,
      digest: hash(candidateRecipe ?? item.recipe), generationsDigest: hash(item.captures) })),
    stateDigest: authorityDigest(state),
  };
}

function factInput(fact: FactInput): FactInput {
  return { entityId: fact.entityId, sourceId: fact.sourceId, sourceRow: fact.sourceRow, kind: fact.kind, validFrom: fact.validFrom,
    validTo: fact.validTo ?? null, fields: fact.fields, branch: fact.branch };
}
const claimMeaning = (fact: FactInput) => { const { sourceRow: occurrence, ...claim } = factInput(fact); return canonical(claim); };
function completedSync(result: unknown) {
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    if (result instanceof Promise) void result.catch(() => {});
    check(false, 'TRIAL_READINESS_REQUIRED', 'Trial readiness and artifact authentication must finish synchronously at the current use boundary.');
  }
}

function recipeReplay(ctx: Context, baseline: State, evidence: PrivateTrialRecipeEvidence, replacement: MappingRecipe) {
  check(evidence?.sourceId && evidence.recipe && Array.isArray(evidence.captures) && evidence.captures.length > 0, 'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Retain the exact recipe and complete original inputs before trying a mapping change.');
  const sourceId = evidence.sourceId;
  check(replacement.id === evidence.recipe.id && replacement.system === evidence.recipe.system && replacement.edition === evidence.recipe.edition
    && hash(replacement.scope) === hash(evidence.recipe.scope), 'TRIAL_RECIPE_SCOPE_CHANGED', 'A recipe trial keeps its source, installation, company and branch scope.');
  check(hash(replacement) !== hash(evidence.recipe), 'TRIAL_NO_CHANGE', 'The proposed mapping must differ from its baseline.');
  const candidate = structuredClone(baseline), covered = new Set<string>(), generations = new Set<number>(), imports = new Set<string>();
  const replacements = new Map<string, Fact>();
  const errors: ImportPreview['errors'] = [];
  for (const capture of evidence.captures) {
    check(capture.complete === true && Number.isSafeInteger(capture.generation) && capture.generation > 0 && !generations.has(capture.generation)
      && !imports.has(capture.importId), 'TRIAL_INCOMPLETE_GENERATION', 'Every retained mapping generation must be complete, unique and explicitly pinned.');
    generations.add(capture.generation); imports.add(capture.importId);
    const matches = baseline.imports.filter(item => item.id === capture.importId), imported = matches[0];
    const originalRecipe = capture.input.recipe ?? evidence.recipe;
    check(matches.length === 1 && imported.sourceId === sourceId && capture.input.sourceId === sourceId
      && imported.format === capture.input.format && hash(canonical(imported.expectedTotals)) === hash(canonical(capture.input.expectedTotals))
      && imported.contentHash === hash(capture.input.content) && imported.recipeHash === hash(originalRecipe)
      && originalRecipe.id === evidence.recipe.id && originalRecipe.system === evidence.recipe.system && originalRecipe.edition === evidence.recipe.edition
      && hash(originalRecipe.scope) === hash(evidence.recipe.scope)
      && (imported.generation === undefined || imported.generation === capture.generation)
      && hash(imported.rowIds) === hash(capture.factIds) && imported.coverage?.reconciled === true,
    'TRIAL_RECIPE_CUSTODY_CHANGED', 'Original bytes, recipe and producer-owned row lineage must match the retained import.');
    const original = new ImportService(readOnly(baseline)).preview(ctx, { ...capture.input, recipe: originalRecipe });
    check(original.accepted && original.facts.length === capture.factIds.length && original.contentHash === imported.contentHash
      && original.totalsMinor === imported.totalsMinor && hash(original.coverage) === hash(imported.coverage),
    'TRIAL_RECIPE_CUSTODY_CHANGED', 'Replaying the original recipe must reproduce complete retained control totals.');
    for (const [index, mapped] of original.facts.entries()) {
      const matches = baseline.facts.filter(fact => fact.id === capture.factIds[index]), old = matches[0];
      check(matches.length === 1 && old.sourceId === sourceId && hash(claimMeaning(old)) === hash(claimMeaning(mapped)),
        'TRIAL_RECIPE_CUSTODY_CHANGED', 'Every original mapped claim must reproduce its retained fields and identity.'); covered.add(old.id);
    }
    const preview = new ImportService(readOnly(candidate)).preview(ctx, { ...capture.input, recipe: replacement });
    if (!preview.accepted) { errors.push(...preview.errors); continue; }
    check(preview.facts.length === capture.factIds.length, 'TRIAL_RECIPE_CUSTODY_CHANGED', 'Every remapped source row needs its original producer lineage.');
    for (const [index, mapped] of preview.facts.entries()) {
      const old = baseline.facts.find(fact => fact.id === capture.factIds[index])!;
      // Same evidence occurrence in an isolated restatement, retaining its original knowledge time.
      // Live publication must append/retract versioned producer outputs; these are never live writes.
      const changed = { ...structuredClone(old), ...structuredClone(mapped), sourceRow: old.sourceRow };
      const previous = replacements.get(old.id);
      check(!previous || hash(previous) === hash(changed), 'TRIAL_MIXED_GENERATIONS', 'A deduplicated claim must have the same interpretation in every retained generation.');
      replacements.set(old.id, changed);
    }
    const destination = candidate.imports.find(item => item.id === capture.importId)!;
    destination.recipeHash = preview.recipeHash; destination.totalsMinor = preview.totalsMinor; destination.coverage = preview.coverage;
  }
  check(baseline.facts.filter(fact => fact.sourceId === sourceId).every(fact => covered.has(fact.id)), 'TRIAL_INCOMPLETE_GENERATION', 'All retained history for the changed producer must be covered; partial remapping cannot replace a source.');
  check(baseline.imports.filter(item => item.sourceId === sourceId && Array.isArray(item.rowIds) && item.contentHash && item.recipeHash)
    .every(item => imports.has(item.id)), 'TRIAL_INCOMPLETE_GENERATION', 'Every retained import generation for the changed producer must be pinned.');
  if (errors.length) return { candidate: structuredClone(baseline), refusal: { code: 'TRIAL_MAPPING_REFUSED', errors } };
  candidate.facts = candidate.facts.map(fact => replacements.get(fact.id) ?? fact);
  return { candidate, refusal: null };
}

/** Full exact receipt diff, including unchanged-value meaning and coverage changes. */
export function privateTrialReceiptDifferences(baseline: unknown, candidate: unknown): PrivateTrialDifference[] {
  const differences: PrivateTrialDifference[] = [];
  const walk = (left: unknown, right: unknown, path: string, leftPresent = true, rightPresent = true) => {
    if (leftPresent === rightPresent && hash(left ?? null) === hash(right ?? null) && (left === undefined) === (right === undefined)) return;
    if (leftPresent && rightPresent && left && right && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      const l = left as Record<string, unknown>, r = right as Record<string, unknown>;
      for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) walk(l[key], r[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, Object.hasOwn(l, key), Object.hasOwn(r, key));
      return;
    }
    differences.push({ path: path || '/', baselinePresent: leftPresent, candidatePresent: rightPresent,
      baseline: structuredClone(left ?? null), candidate: structuredClone(right ?? null),
      category: ['/id', '/createdAt'].includes(path) ? 'receipt-identity' : 'meaning-or-evidence' });
  };
  walk(baseline, candidate, ''); return differences;
}

function compare(saved: PrivateTrialSavedRequest, baseline: PrivateTrialOutcome, candidate: PrivateTrialOutcome): PrivateTrialComparison {
  const left = baseline.status === 'calculated' ? baseline.receipt : baseline;
  const right = candidate.status === 'calculated' ? candidate.receipt : candidate;
  const differences = privateTrialReceiptDifferences(left, right);
  const calculated = baseline.status === 'calculated' && candidate.status === 'calculated';
  const leftFigures = baseline.status === 'calculated' ? baseline.receipt.figures : [];
  const rightFigures = candidate.status === 'calculated' ? candidate.receipt.figures : [];
  return {
    answerId: saved.answerId, request: structuredClone(saved.request), requestDigest: saved.requestDigest, baseline, candidate, differences,
    meaningChanged: differences.some(item => item.category === 'meaning-or-evidence'),
    totalDeltaMinor: calculated ? String(BigInt(candidate.receipt.totalMinor) - BigInt(baseline.receipt.totalMinor)) : null,
    figures: [...new Set([...leftFigures, ...rightFigures].map(figure => figure.key))].map(key => {
      const left = leftFigures.find(figure => figure.key === key)?.minor ?? null, right = rightFigures.find(figure => figure.key === key)?.minor ?? null;
      return { key, baselineMinor: left, candidateMinor: right, deltaMinor: left !== null && right !== null ? String(BigInt(right) - BigInt(left)) : null };
    }),
  };
}

function constructCandidate(ctx: Context, baseline: State, change: PrivateTrialChange, saved: PrivateTrialSavedRequest[], createdAt: string, evidence: PrivateTrialRecipeEvidence[]) {
  let candidate = structuredClone(baseline);
  let refusal: PrivateTrialFork['candidateMappingRefusal'] = null;
  if (change.type === 'definition') {
    const d = dictionary(baseline);
    const draft: DictionaryDraft = { pack: d.pack, label: d.label, currency: d.currency, gstMode: d.gstMode, fields: structuredClone(d.fields),
      definitions: d.definitions.map(definition => definition.name === change.name ? structuredClone(change.replacement) : structuredClone(definition)) };
    const compiled = compileDictionary(draft, d.version + 1, ctx.memberId, createdAt);
    candidate.ontology = { current: compiled, history: [...(baseline.ontology?.history ?? [d]), compiled] };
  } else if (change.type === 'recipe') {
    check(evidence.length === 1 && evidence[0].sourceId === change.sourceId && evidence[0].recipe.id === change.recipeId,
      'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Use exactly one managed baseline recipe for the chosen source.');
    const replay = recipeReplay(ctx, baseline, evidence[0], change.replacement); candidate = replay.candidate; refusal = replay.refusal;
  } else {
    const earliestKnowledgeCut = saved.map(item => new Date(item.request.asOf!).toISOString()).sort()[0];
    candidate.sourceRules.push({ id: 'private-trial-precedence', kind: change.kind, sourceIds: [...change.sourceIds], at: earliestKnowledgeCut, by: ctx.memberId });
  }
  return { candidate, refusal };
}

/** Isolated replay core. The host owns encrypted storage, discard and atomic publication. */
export class PrivateTrialService {
  readonly #live: Pick<StateStore, 'read'>;
  readonly #host: PrivateTrialHost;
  constructor(live: Pick<StateStore, 'read'>, host: PrivateTrialHost) {
    check(live && typeof live.read === 'function' && host && ['now', 'resolveRecipeEvidence', 'resolveTrial', 'assertArtifactAuthentic', 'calculatorGuards', 'resolvePromotionImpact']
      .every(key => typeof (host as unknown as Record<string, unknown>)[key] === 'function'), 'TRIAL_HOST_REQUIRED', 'Install trusted custody, clock, current readiness and complete promotion-impact ports.');
    this.#live = live; this.#host = host;
  }

  #access(ctx: Context, state: State) {
    check(!ctx.sourceTainted, 'TRIAL_TAINTED_CONTEXT', 'A source document cannot authorize a private meaning change or its promotion.');
    const live = this.#live.read();
    const accessView: StateStore = { read: () => live, update: async () => { throw new ChausarError('TRIAL_READ_ONLY', 'Current authority is read only.'); } };
    authorize(accessView, ctx, 'prepare');
    check(live.workspace.id === state.workspace.id, 'TRIAL_WORKSPACE_CHANGED', 'This private fork belongs to another workspace.');
    // The host-only fork contains complete retained facts: fail closed instead of copying inaccessible history.
    const sources = [...new Set([...state.facts.map(fact => fact.sourceId), ...state.imports.map(item => item.sourceId).filter((source): source is string => typeof source === 'string')])];
    assertSourceAccess(live, ctx, sources);
    for (const fact of state.facts) {
      currentAccess(accessView, ctx, fact.branch, fact.sourceId);
      check(canSeeFact(accessView, ctx, fact), 'TRIAL_SCOPE_UNAVAILABLE', 'The complete fork contains retained history outside your current branch scope.');
    }
  }

  #current(ctx: Context, fork: PrivateTrialFork) {
    this.#access(ctx, fork.baseline);
    check(fork.memberId === ctx.memberId && fork.epoch === ctx.epoch, 'TRIAL_FORBIDDEN', 'This private trial belongs to another member or permission epoch.');
    check(authorityDigest(this.#live.read()) === fork.liveAuthorityDigest, 'TRIAL_STALE_BASE', 'Live definitions, source evidence or authority changed. Create a new trial and repeat its checks.');
    if (fork.change.type === 'source-precedence') assertSourceAccess(this.#live.read(), ctx, fork.change.sourceIds);
    for (const saved of fork.savedRequests) {
      currentAccess(readOnly(this.#live.read()), ctx, saved.request.branch);
      if (saved.request.sourceIds) assertSourceAccess(this.#live.read(), ctx, saved.request.sourceIds);
      const answer = this.#live.read().answers.filter(item => item.id === saved.answerId);
      const receipt = this.#live.read().receipts.filter(item => item.id === saved.receiptId);
      check(answer.length === 1 && answer[0].receiptId === saved.receiptId && hash(answer[0].request) === saved.requestDigest
        && receipt.length === 1 && hash(receipt[0]) === saved.retainedReceiptDigest, 'TRIAL_SAVED_REQUEST_CHANGED', 'The retained saved request or original receipt changed. Repeat the trial.');
    }
  }

  #guards(state: State, guard: PrivateTrialGuardContext) {
    const configured = this.#host.calculatorGuards(readOnly(state), structuredClone(guard));
    check(configured && typeof configured.consumerGuard === 'function' && typeof configured.receiptGuard === 'function'
      && Object.keys(configured).every(key => ['consumerGuard', 'receiptGuard'].includes(key)), 'TRIAL_READINESS_REQUIRED', 'Both current consumer and receipt guards are mandatory; trial replay has no external verifier port.');
    return {
      consumerGuard: (ctx: Context, request: CalculationRequest) => completedSync(configured.consumerGuard(ctx, request)),
      receiptGuard: (ctx: Context, receipt: CalculationReceipt) => completedSync(configured.receiptGuard(ctx, receipt)),
    };
  }

  #load(ctx: Context, trialId: string, requireEvaluation = false) {
    check(id(trialId), 'INVALID_PRIVATE_TRIAL', 'Choose a managed private trial identifier.');
    authorize(readOnly(this.#live.read()), ctx, 'prepare');
    const retained = structuredClone(this.#host.resolveTrial(ctx, trialId));
    const fork = retained?.fork;
    check(fork?.type === 'private-trial-fork-v1' && fork.version === 1 && fork.id === trialId && hash(withoutDigest(fork)) === fork.digest,
      'TRIAL_INTEGRITY_CHANGED', 'The authenticated retained fork must match its exact digest.');
    completedSync(this.#host.assertArtifactAuthentic(ctx, 'fork', fork.digest));
    check(hash(fork.change) === fork.changeDigest && hash(fork.savedRequests) === fork.requestsDigest
      && hash(pin(fork.baseline, fork.recipeEvidence)) === hash(fork.baselinePin)
      && hash(pin(fork.candidate, fork.recipeEvidence, fork.change.type === 'recipe' ? fork.change.replacement : undefined)) === hash(fork.candidatePin),
    'TRIAL_INTEGRITY_CHANGED', 'Retained requests, change and both version pins must still match the fork.');
    this.#current(ctx, fork);
    validateChange(fork.change, fork.baseline);
    check(authorityDigest(fork.baseline) === authorityDigest(isolate(this.#live.read()))
      && fork.workspaceId === fork.baseline.workspace.id && Array.isArray(fork.savedRequests) && fork.savedRequests.length > 0 && fork.savedRequests.length <= 32
      && new Set(fork.savedRequests.map(saved => saved.answerId)).size === fork.savedRequests.length
      && fork.savedRequests.every(saved => hash(saved.request) === saved.requestDigest && typeof saved.request.asOf === 'string' && Number.isFinite(Date.parse(saved.request.asOf))),
    'TRIAL_INTEGRITY_CHANGED', 'The baseline and each retained request must match current live evidence and its original digest.');
    const rebuilt = constructCandidate(ctx, fork.baseline, fork.change, fork.savedRequests, fork.createdAt, fork.recipeEvidence);
    check(hash(rebuilt.candidate) === hash(fork.candidate) && hash(rebuilt.refusal) === hash(fork.candidateMappingRefusal),
      'TRIAL_INTEGRITY_CHANGED', 'The retained candidate must reproduce exactly the one typed proposed change.');
    if (requireEvaluation) {
      check(retained.evaluation?.type === 'private-trial-evaluation-v1' && retained.evaluation.version === 1
        && retained.evaluation.trialId === fork.id && retained.evaluation.forkDigest === fork.digest
        && hash(withoutDigest(retained.evaluation)) === retained.evaluation.digest,
      'TRIAL_EVALUATION_REQUIRED', 'Retain the exact completed evaluation before reviewing or proposing promotion.');
      completedSync(this.#host.assertArtifactAuthentic(ctx, 'evaluation', retained.evaluation.digest));
      const comparisons = retained.evaluation.comparisons;
      check(Array.isArray(comparisons) && comparisons.length === fork.savedRequests.length, 'TRIAL_INTEGRITY_CHANGED', 'The retained evaluation must include every chosen saved request exactly once.');
      for (const [index, saved] of fork.savedRequests.entries()) {
        const comparison = comparisons[index];
        check(comparison && hash(compare(saved, comparison.baseline, comparison.candidate)) === hash(comparison),
          'TRIAL_INTEGRITY_CHANGED', 'Every retained comparison must reproduce the original request and exact receipt differences.');
        for (const side of ['baseline', 'candidate'] as const) {
          const outcome = comparison[side];
          check(outcome?.status === 'calculated' || outcome?.status === 'refused', 'TRIAL_INTEGRITY_CHANGED', 'Retain a typed calculation or refusal outcome.');
          if (outcome.status === 'calculated') {
            const receipt = outcome.receipt, d = dictionary(fork[side]);
            check(hash(receipt) === outcome.receiptDigest && hash(receiptMeaning(receipt)) === outcome.semanticDigest
              && receipt.memberId === ctx.memberId && receipt.epoch === ctx.epoch && receipt.operation === saved.request.operation
              && receipt.asOf === new Date(saved.request.asOf!).toISOString() && receipt.dictionaryHash === d.hash && receipt.ontologyVersion === d.version,
            'TRIAL_INTEGRITY_CHANGED', 'Retained receipt bytes, meaning, owner, request and dictionary pins must match the evaluated side.');
          }
        }
      }
    }
    return retained;
  }

  #ready(ctx: Context, fork: PrivateTrialFork, phase: PrivateTrialGuardContext['phase'], evaluation?: PrivateTrialEvaluation) {
    this.#current(ctx, fork);
    for (const side of ['baseline', 'candidate'] as const) {
      const guards = this.#guards(fork[side], { phase, side, change: fork.change });
      for (const saved of fork.savedRequests) guards.consumerGuard(ctx, structuredClone(saved.request));
      if (evaluation) for (const result of evaluation.comparisons) {
        const outcome = result[side]; if (outcome.status === 'calculated') guards.receiptGuard(ctx, structuredClone(outcome.receipt));
      }
    }
    this.#current(ctx, fork);
  }

  async create(ctx: Context, input: PrivateTrialRequest): Promise<PrivateTrialFork> {
    const started = performance.now(); dataOnly(input); keys(input, ['version', 'savedAnswerIds', 'change']);
    check(input.version === 1 && Array.isArray(input.savedAnswerIds) && input.savedAnswerIds.length > 0 && input.savedAnswerIds.length <= 32
      && input.savedAnswerIds.every(id) && new Set(input.savedAnswerIds).size === input.savedAnswerIds.length, 'INVALID_PRIVATE_TRIAL', 'Choose between one and thirty-two distinct saved calculation answers.');
    input = structuredClone(input);
    const live = structuredClone(this.#live.read()); this.#access(ctx, live); validateChange(input.change, live);
    check(Buffer.byteLength(JSON.stringify(input)) <= 1_000_000, 'TRIAL_LIMIT', 'Keep one typed proposed change under one megabyte.');
    const createdAt = this.#host.now();
    check(typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)), 'TRIAL_CLOCK_REQUIRED', 'The trusted host must supply a valid current timestamp.');
    const baseline = isolate(live);
    const originalGuards = this.#guards(baseline, { phase: 'create', side: 'baseline', change: input.change });
    const savedRequests = input.savedAnswerIds.map(answerId => {
      const matches = live.answers.filter(item => item.id === answerId), answer = matches[0];
      check(matches.length === 1 && answer.request && id(answer.receiptId), 'TRIAL_SAVED_REQUEST_REQUIRED', 'Choose an exact saved calculation request with its original receipt.');
      const original = new CalculatorService(readOnly(live), { receiptGuard: originalGuards.receiptGuard }).receipt(ctx, answer.receiptId);
      const request = structuredClone(answer.request) as CalculationRequest;
      check(!answer.stale && !original.stale && request.operation === original.operation && original.dictionaryHash === dictionary(live).hash,
        'TRIAL_SAVED_REQUEST_CHANGED', 'Use current, matching saved questions and baseline receipts before preparing a private trial.');
      check(hash(request.period ?? null) === hash(original.period) && hash(request.comparePeriod ?? null) === hash(original.comparePeriod)
        && (request.branch ?? null) === original.branch && hash(request.sourceIds ?? null) === hash(original.requestedSourceIds ?? null)
        && (request.operation !== 'aging' || request.onDate === original.assumptions.onDate)
        && (request.operation !== 'scenario' || (/^-?\d+$/.test(request.assumptions?.priceChangeBps ?? '')
          && String(BigInt(request.assumptions!.priceChangeBps)) === original.assumptions.priceChangeBps)),
      'TRIAL_SAVED_REQUEST_CHANGED', 'Saved calculation dates and source/branch scope must match their original receipt.');
      check(typeof request.asOf === 'string' && Number.isFinite(Date.parse(request.asOf)) && new Date(request.asOf).toISOString() === original.asOf
        && (request.operation !== 'aging' || typeof request.onDate === 'string'), 'TRIAL_UNPINNED_REQUEST', 'Saved questions need an explicit knowledge cut and aging date; trial replay cannot silently rewrite requests.');
      originalGuards.consumerGuard(ctx, structuredClone(request));
      return { answerId, receiptId: original.id, retainedReceiptDigest: hash(original), request, requestDigest: hash(request) };
    });
    let recipeEvidence: PrivateTrialRecipeEvidence[] = [];
    if (input.change.type === 'recipe') {
      const evidence = structuredClone(this.#host.resolveRecipeEvidence(ctx, input.change.sourceId));
      check(evidence?.sourceId === input.change.sourceId && evidence.recipe?.id === input.change.recipeId, 'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Use the exact managed baseline recipe for the chosen source.');
      recipeEvidence = [evidence];
    }
    if (input.change.type === 'source-precedence') assertSourceAccess(live, ctx, input.change.sourceIds);
    const { candidate, refusal: candidateMappingRefusal } = constructCandidate(ctx, baseline, input.change, savedRequests, createdAt, recipeEvidence);
    const fork: PrivateTrialFork = {
      version: 1, type: 'private-trial-fork-v1', id: newId('trial'), workspaceId: live.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch,
      createdAt, interpretation: 'restated-private-diagnostic', change: input.change, changeDigest: hash(input.change), liveAuthorityDigest: authorityDigest(live),
      baselinePin: pin(baseline, recipeEvidence), candidatePin: pin(candidate, recipeEvidence, input.change.type === 'recipe' ? input.change.replacement : undefined),
      savedRequests, requestsDigest: hash(savedRequests), baseline, candidate, recipeEvidence, candidateMappingRefusal,
      cost: { preparationElapsedMs: 0, serializedForkBytes: 0, diskBytes: null },
      restrictions: { actions: false, outbound: false, liveAuthorityWrites: false, nativeQualification: false }, digest: '',
    };
    this.#ready(ctx, fork, 'create');
    fork.cost.preparationElapsedMs = performance.now() - started;
    // Digest length is fixed; iterate only the serialized-byte-count digit width to a stable value.
    for (let count = 0; count < 8; count++) {
      fork.digest = hash(withoutDigest(fork)); const bytes = Buffer.byteLength(JSON.stringify(fork));
      if (bytes === fork.cost.serializedForkBytes) break; fork.cost.serializedForkBytes = bytes;
    }
    fork.digest = hash(withoutDigest(fork));
    check(fork.cost.serializedForkBytes === Buffer.byteLength(JSON.stringify(fork)), 'TRIAL_COST_FAILED', 'The serialized fork byte measurement must be exact.');
    return structuredClone(fork);
  }

  async #calculate(ctx: Context, fork: PrivateTrialFork, side: 'baseline' | 'candidate', request: CalculationRequest): Promise<PrivateTrialOutcome> {
    this.#current(ctx, fork);
    const configured = this.#guards(fork[side], { phase: 'evaluate', side, change: fork.change });
    let failedGuard = false;
    const consumerGuard = (context: Context, calculation: CalculationRequest) => {
      try { this.#current(context, fork); configured.consumerGuard(context, calculation); this.#current(context, fork); }
      catch (error) { failedGuard = true; throw error; }
    };
    const receiptGuard = (context: Context, receipt: CalculationReceipt) => {
      try { this.#current(context, fork); configured.receiptGuard(context, receipt); this.#current(context, fork); }
      catch (error) { failedGuard = true; throw error; }
    };
    consumerGuard(ctx, structuredClone(request));
    if (side === 'candidate' && fork.candidateMappingRefusal) return { status: 'refused', code: fork.candidateMappingRefusal.code,
      message: fork.candidateMappingRefusal.errors.map(error => `${error.code}: ${error.message}`).join(' ') };
    let state = structuredClone(fork[side]);
    const store: StateStore = { read: () => structuredClone(state), update: async change => {
      this.#current(ctx, fork); const draft = structuredClone(state); const result = await change(draft);
      this.#current(ctx, fork); state = draft; return result;
    } };
    try {
      const receipt = await new CalculatorService(store, { consumerGuard, receiptGuard }).calculate(ctx, structuredClone(request));
      this.#current(ctx, fork); return { status: 'calculated', receipt, receiptDigest: hash(receipt), semanticDigest: hash(receiptMeaning(receipt)) };
    } catch (error) {
      if (failedGuard || !(error instanceof ChausarError)) throw error;
      this.#current(ctx, fork); return { status: 'refused', code: error.code, message: error.message };
    }
  }

  async evaluate(ctx: Context, trialId: string): Promise<PrivateTrialEvaluation> {
    const started = performance.now(), { fork } = this.#load(ctx, trialId); this.#ready(ctx, fork, 'evaluate');
    const comparisons: PrivateTrialComparison[] = [];
    for (const saved of fork.savedRequests) {
      const baseline = await this.#calculate(ctx, fork, 'baseline', saved.request);
      const candidate = await this.#calculate(ctx, fork, 'candidate', saved.request);
      comparisons.push(compare(saved, baseline, candidate));
    }
    const evaluation: PrivateTrialEvaluation = {
      version: 1, type: 'private-trial-evaluation-v1', trialId, forkDigest: fork.digest,
      qualification: 'isolated-source-replay', interpretation: 'restated-private-diagnostic', comparisons,
      cost: { evaluationElapsedMs: performance.now() - started, serializedReceiptBytes: Buffer.byteLength(JSON.stringify(comparisons)), diskBytes: null },
      limitations: [
        'Candidate meanings reinterpret retained evidence at the identical saved knowledge cuts; original as-known receipts remain unchanged.',
        'Only receipt identity and creation time are incidental; all definition, compiler, row, exclusion, coverage and figure differences are retained.',
        'Serialized bytes and elapsed replay time are measured; encrypted disk usage, fork/discard timing and custody require host measurements.',
        'This isolated source replay does not qualify live connectors, native SQL, models, GUI journeys, publication or shared/team trials.',
      ], digest: '',
    };
    this.#ready(ctx, fork, 'evaluate', evaluation); evaluation.digest = hash(withoutDigest(evaluation));
    return structuredClone(evaluation);
  }

  read(ctx: Context, trialId: string): PrivateTrialEvaluation {
    const { fork, evaluation } = this.#load(ctx, trialId, true); this.#ready(ctx, fork, 'read', evaluation);
    return structuredClone(evaluation!);
  }

  promotionImpact(ctx: Context, trialId: string, strategy: PrivateTrialStrategy): PrivateTrialImpact {
    check(['prospective', 'retrospective'].includes(strategy), 'TRIAL_RESTATEMENT_REQUIRED', 'Choose an explicit prospective or retrospective publication strategy.');
    const { fork, evaluation } = this.#load(ctx, trialId, true); this.#ready(ctx, fork, 'promote', evaluation);
    const dependencies = structuredClone(this.#host.resolvePromotionImpact(ctx, structuredClone(fork), structuredClone(evaluation!), strategy));
    keys(dependencies, ['complete', 'affectedArtifactIds', 'rebuildArtifactIds', 'activeWorkIds'], 'TRIAL_IMPACT_REQUIRED');
    check(dependencies.complete === true && ['affectedArtifactIds', 'rebuildArtifactIds', 'activeWorkIds'].every(key => {
      const values = dependencies[key as 'activeWorkIds']; return Array.isArray(values) && values.every(id) && new Set(values).size === values.length;
    }), 'TRIAL_IMPACT_REQUIRED', 'The host must enumerate complete dependency, rebuild and active-work impact.');
    check(dependencies.rebuildArtifactIds.every(artifact => dependencies.affectedArtifactIds.includes(artifact)), 'TRIAL_IMPACT_REQUIRED', 'Every proposed rebuild must belong to the affected dependency inventory.');
    const impact: PrivateTrialImpact = {
      ...dependencies, trialId, forkDigest: fork.digest, evaluationDigest: evaluation!.digest, strategy,
      affectedSavedAnswerIds: evaluation!.comparisons.filter(result => result.meaningChanged).map(result => result.answerId),
      historicalReceiptIdsToPreserve: this.#live.read().receipts.map(receipt => receipt.id),
      restatement: strategy === 'prospective'
        ? 'Publish for future calculations. Preserve original receipts; rebuilding current dependent outputs is explicit host work.'
        : 'Rebuild the listed dependent outputs as new restated evidence. Preserve original receipts and their as-known identities; never rewrite history.',
      digest: '',
    };
    this.#ready(ctx, fork, 'promote', evaluation); impact.digest = hash(withoutDigest(impact)); return structuredClone(impact);
  }

  proposePromotion(ctx: Context, request: PrivateTrialPromotionRequest): PrivateTrialPromotionProposal {
    dataOnly(request); keys(request, ['trialId', 'evaluationDigest', 'strategy', 'acknowledgedImpactDigest']);
    const { fork, evaluation } = this.#load(ctx, request.trialId, true);
    check(evaluation!.digest === request.evaluationDigest && evaluation!.comparisons.every(result => result.candidate.status === 'calculated'),
      'TRIAL_PROMOTION_REFUSED', 'Promotion requires the exact completed evaluation with no refused candidate calculation.');
    const impact = this.promotionImpact(ctx, request.trialId, request.strategy);
    check(impact.digest === request.acknowledgedImpactDigest, 'TRIAL_IMPACT_NOT_ACKNOWLEDGED', 'Review and acknowledge the exact current restatement and dependency impact.');
    check(impact.activeWorkIds.length === 0, 'TRIAL_ACTIVE_WORK', 'The host must resolve affected active work before preparing publication.');
    authorize(readOnly(this.#live.read()), ctx, 'admin');
    const proposal: PrivateTrialPromotionProposal = {
      version: 1, type: 'private-trial-promotion-proposal-v1', trialId: fork.id, workspaceId: fork.workspaceId,
      memberId: ctx.memberId, epoch: ctx.epoch, liveAuthorityDigest: fork.liveAuthorityDigest,
      baselinePin: fork.baselinePin, candidatePin: fork.candidatePin, change: fork.change, evaluationDigest: evaluation!.digest,
      impact, requiresAtomicHostPublication: true, digest: '',
    };
    this.#ready(ctx, fork, 'promote', evaluation); proposal.digest = hash(withoutDigest(proposal)); return structuredClone(proposal);
  }

  /** Run inside the host's atomic live publication boundary, against its commit-state view. */
  assertPromotionCurrent(ctx: Context, proposal: PrivateTrialPromotionProposal): void {
    check(proposal?.type === 'private-trial-promotion-proposal-v1' && proposal.version === 1 && hash(withoutDigest(proposal)) === proposal.digest,
      'TRIAL_PROMOTION_CHANGED', 'Use the exact reviewed inert promotion proposal.');
    const current = this.proposePromotion(ctx, { trialId: proposal.trialId, evaluationDigest: proposal.evaluationDigest,
      strategy: proposal.impact.strategy, acknowledgedImpactDigest: proposal.impact.digest });
    check(current.digest === proposal.digest, 'TRIAL_PROMOTION_CHANGED', 'The trial, dependency impact or publication authority changed. Repeat review.');
  }
}
