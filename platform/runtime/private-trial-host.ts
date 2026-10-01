import { performance } from 'node:perf_hooks';
import { ChausarError, authorize, check, hash, type Context, type State, type StateStore } from './contracts.ts';
import { canSeeFact, currentAccess } from './memory.ts';
import { assertSourceAccess } from './trust.ts';
import { PrivateTrialService } from './private-trials.ts';
import type {
  PrivateTrialEvaluation, PrivateTrialFork, PrivateTrialHost, PrivateTrialImpact,
  PrivateTrialPromotionProposal, PrivateTrialPromotionRequest, PrivateTrialRequest, PrivateTrialStrategy,
} from './private-trial-contracts.ts';

export type PrivateTrialArtifactRef = {
  id: string; purpose: 'private-trial'; valueDigest: string; diskBytes: number;
};
/** Trusted encrypted custody only. Digests are SHA256 of JSON.stringify(value).
 * Every write/remove must compare its expected digest under the custody writer lock.
 * null is create-only. Read authenticates the ciphertext before returning its value.
 */
export type PrivateTrialArtifactPort = {
  write(input: { id: string; purpose: 'private-trial'; value: unknown; expectedDigest: string | null }): Promise<PrivateTrialArtifactRef>;
  read(input: { id: string; purpose: 'private-trial' }): Promise<PrivateTrialArtifactRef & { value: unknown }>;
  list(input: { purpose: 'private-trial' }): Promise<PrivateTrialArtifactRef[]>;
  remove(input: { id: string; purpose: 'private-trial'; expectedDigest: string }): Promise<{ removed: boolean; diskBytes: number }>;
};
export type PrivateTrialAtomicPublication = {
  proposal: PrivateTrialPromotionProposal; fork: PrivateTrialFork; evaluation: PrivateTrialEvaluation;
  /** Call synchronously against the commit-state view inside the atomic publication transaction. */
  assertCurrent(commitView: StateStore): void;
};
export type PrivateTrialHostOptions = Pick<PrivateTrialHost, 'now' | 'resolveRecipeEvidence' | 'calculatorGuards' | 'resolvePromotionImpact'> & {
  custody: PrivateTrialArtifactPort;
  /** Root owns publication. Throwing leaves the reservation blocked for explicit reconciliation. */
  promoteAtomic(ctx: Context, publication: PrivateTrialAtomicPublication): Promise<{ publicationId: string }>;
};
export type PrivateTrialSummary = {
  trialId: string; workspaceId: string; memberId: string; epoch: number; createdAt: string;
  status: 'created' | 'evaluated'; qualification: 'isolated-source-replay'; interpretation: 'restated-private-diagnostic';
  change: { type: PrivateTrialFork['change']['type']; target: string };
  savedAnswerIds: string[]; forkDigest: string; evaluationDigest: string | null;
  baselinePin: PrivateTrialFork['baselinePin']; candidatePin: PrivateTrialFork['candidatePin'];
  cost: { preparationElapsedMs: number; serializedForkBytes: number; hostElapsedMs: number;
    forkDiskBytes: number; evaluationDiskBytes: number; bindingDiskBytes: number; totalDiskBytes: number };
  evaluation?: PrivateTrialEvaluation;
};
export type PrivateTrialDiscard = {
  trialId: string; status: 'discarded'; discardElapsedMs: number; removedDiskBytes: number;
  retainedTombstoneDiskBytes: number; cleanupComplete: boolean; failedArtifactIds: string[];
};
type Binding = {
  version: 1; type: 'private-trial-issued-binding-v1'; trialId: string;
  workspaceId: string; memberId: string; epoch: number; createdAt: string;
  status: 'active' | 'discarded' | 'promoting' | 'promoted';
  fork: { ref: PrivateTrialArtifactRef; issuedDigest: string };
  evaluation: { ref: PrivateTrialArtifactRef; issuedDigest: string } | null;
  publicationId?: string;
};
type Loaded = { binding: Binding; bindingRef: PrivateTrialArtifactRef; fork: PrivateTrialFork; evaluation?: PrivateTrialEvaluation };
const purpose = 'private-trial' as const;
const digest = (value: unknown) => hash(JSON.stringify(value));
const opaqueId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const bindingId = (trialId: string) => `${trialId}-binding`;
const readOnly = (state: State): StateStore => ({ read: () => structuredClone(state), update: async () => { throw new ChausarError('TRIAL_READ_ONLY', 'A private trial view cannot write live authority.'); } });
const authorityDigest = (state: State) => hash({ schemaVersion: state.schemaVersion, workspace: state.workspace, members: state.members,
  policy: state.policy, ontology: state.ontology, facts: state.facts, imports: state.imports, sourceRules: state.sourceRules, merges: state.merges, tombstones: state.tombstones });
const withoutDigest = (value: { digest: string }) => { const { digest: ignored, ...body } = value; return body; };
function ref(value: PrivateTrialArtifactRef, expectedId?: string): PrivateTrialArtifactRef {
  check(value && opaqueId(value.id) && (!expectedId || value.id === expectedId) && value.purpose === purpose
    && /^[a-f0-9]{64}$/.test(value.valueDigest) && Number.isSafeInteger(value.diskBytes) && value.diskBytes > 0,
  'TRIAL_CUSTODY_INVALID', 'Encrypted custody must return the exact opaque identity, authenticated digest and measured encrypted bytes.');
  return { id: value.id, purpose, valueDigest: value.valueDigest, diskBytes: value.diskBytes };
}
function completedSync(value: unknown) {
  if (value && typeof (value as { then?: unknown }).then === 'function') {
    if (value instanceof Promise) void value.catch(() => {});
    check(false, 'TRIAL_READINESS_REQUIRED', 'Current readiness guards must complete synchronously.');
  }
}

/** Custody orchestration; no filesystem, keys, models, transports or live publication implementation. */
export class PrivateTrialHostService {
  readonly #live: StateStore;
  readonly #options: PrivateTrialHostOptions;
  #chain: Promise<unknown> = Promise.resolve();
  constructor(live: StateStore, options: PrivateTrialHostOptions) {
    check(live && typeof live.read === 'function' && options && ['now', 'resolveRecipeEvidence', 'calculatorGuards', 'resolvePromotionImpact', 'promoteAtomic']
      .every(key => typeof (options as unknown as Record<string, unknown>)[key] === 'function')
      && options.custody && ['write', 'read', 'list', 'remove'].every(key => typeof (options.custody as unknown as Record<string, unknown>)[key] === 'function'),
    'TRIAL_HOST_REQUIRED', 'Install encrypted CAS custody, current readiness, complete impact and atomic publication ports.');
    this.#live = live; this.#options = options;
  }
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(operation); this.#chain = result.catch(() => {}); return result;
  }
  #access(ctx: Context, binding?: Binding, view = this.#live) {
    check(!ctx.sourceTainted, 'TRIAL_TAINTED_CONTEXT', 'A source document cannot authorize private trial custody.');
    authorize(view, ctx, 'prepare');
    if (binding) check(binding.workspaceId === view.read().workspace.id && binding.memberId === ctx.memberId && binding.epoch === ctx.epoch,
      'TRIAL_FORBIDDEN', 'This trial belongs to another workspace, member or permission epoch.');
  }
  async #readArtifact(id: string) {
    check(opaqueId(id), 'INVALID_PRIVATE_TRIAL', 'Use a managed opaque trial identifier.');
    const result = await this.#options.custody.read({ id, purpose }); const identity = ref(result, id);
    check(digest(result.value) === identity.valueDigest, 'TRIAL_CUSTODY_CHANGED', 'The custody-authenticated payload must match its independently retained bytes.');
    return { ref: identity, value: structuredClone(result.value) };
  }
  async #writeArtifact(id: string, value: unknown, expectedDigest: string | null) {
    check(opaqueId(id), 'INVALID_PRIVATE_TRIAL', 'Use a managed opaque artifact identifier.');
    const identity = ref(await this.#options.custody.write({ id, purpose, value: structuredClone(value), expectedDigest }), id);
    check(identity.valueDigest === digest(value), 'TRIAL_CUSTODY_CHANGED', 'Encrypted custody must acknowledge the exact service-issued payload.');
    return identity;
  }
  async #binding(ctx: Context, trialId: string) {
    check(opaqueId(trialId), 'INVALID_PRIVATE_TRIAL', 'Choose a managed private trial identifier.'); this.#access(ctx);
    const stored = await this.#readArtifact(bindingId(trialId)); this.#access(ctx);
    const value = stored.value as Binding;
    check(value?.version === 1 && value.type === 'private-trial-issued-binding-v1' && value.trialId === trialId
      && ['active', 'discarded', 'promoting', 'promoted'].includes(value.status) && typeof value.createdAt === 'string'
      && Number.isFinite(Date.parse(value.createdAt)) && value.fork && /^[a-f0-9]{64}$/.test(value.fork.issuedDigest),
    'TRIAL_CUSTODY_CHANGED', 'Retain an authenticated service-issued binding for the exact trial.');
    ref(value.fork.ref, `${trialId}-fork`);
    if (value.evaluation) {
      ref(value.evaluation.ref, `${trialId}-evaluation`);
      check(/^[a-f0-9]{64}$/.test(value.evaluation.issuedDigest), 'TRIAL_CUSTODY_CHANGED', 'Retain the separately issued evaluation identity.');
    }
    this.#access(ctx, value); return { binding: value, bindingRef: stored.ref };
  }
  #current(ctx: Context, loaded: Loaded, view = this.#live) {
    this.#access(ctx, loaded.binding, view); const live = view.read(), fork = loaded.fork;
    check(fork.workspaceId === loaded.binding.workspaceId && fork.memberId === loaded.binding.memberId && fork.epoch === loaded.binding.epoch
      && fork.createdAt === loaded.binding.createdAt, 'TRIAL_CUSTODY_CHANGED', 'Fork origin must match its independent issuance binding.');
    check(authorityDigest(live) === fork.liveAuthorityDigest, 'TRIAL_STALE_BASE', 'Live meaning, source evidence or authority changed. Create and evaluate a new trial.');
    const sources = [...new Set([...fork.baseline.facts.map(fact => fact.sourceId), ...fork.baseline.imports.map(item => item.sourceId).filter((source): source is string => typeof source === 'string')])];
    assertSourceAccess(live, ctx, sources);
    for (const fact of fork.baseline.facts) {
      currentAccess(view, ctx, fact.branch, fact.sourceId);
      check(canSeeFact(view, ctx, fact), 'TRIAL_SCOPE_UNAVAILABLE', 'The complete retained fork exceeds current source or branch access.');
    }
    if (fork.change.type === 'source-precedence') assertSourceAccess(live, ctx, fork.change.sourceIds);
    for (const saved of fork.savedRequests) {
      currentAccess(view, ctx, saved.request.branch); if (saved.request.sourceIds) assertSourceAccess(live, ctx, saved.request.sourceIds);
      const answers = live.answers.filter(answer => answer.id === saved.answerId), receipts = live.receipts.filter(receipt => receipt.id === saved.receiptId);
      check(answers.length === 1 && answers[0].receiptId === saved.receiptId && hash(answers[0].request) === saved.requestDigest
        && receipts.length === 1 && hash(receipts[0]) === saved.retainedReceiptDigest, 'TRIAL_SAVED_REQUEST_CHANGED', 'An original saved request or receipt changed.');
    }
  }
  async #load(ctx: Context, trialId: string): Promise<Loaded> {
    const retained = await this.#binding(ctx, trialId);
    check(retained.binding.status === 'active', retained.binding.status === 'discarded' ? 'TRIAL_DISCARDED' : 'TRIAL_PUBLICATION_RESERVED', 'This trial is discarded or reserved for publication.');
    const storedFork = await this.#readArtifact(retained.binding.fork.ref.id); this.#access(ctx, retained.binding);
    const fork = storedFork.value as PrivateTrialFork;
    check(storedFork.ref.valueDigest === retained.binding.fork.ref.valueDigest && fork?.type === 'private-trial-fork-v1'
      && fork.version === 1 && fork.id === trialId && fork.digest === retained.binding.fork.issuedDigest && hash(withoutDigest(fork)) === fork.digest,
    'TRIAL_ARTIFACT_UNAUTHENTIC', 'The fork must match both its encrypted payload and independently issued identity.');
    let evaluation: PrivateTrialEvaluation | undefined;
    if (retained.binding.evaluation) {
      const stored = await this.#readArtifact(retained.binding.evaluation.ref.id); this.#access(ctx, retained.binding);
      evaluation = stored.value as PrivateTrialEvaluation;
      check(stored.ref.valueDigest === retained.binding.evaluation.ref.valueDigest && evaluation?.type === 'private-trial-evaluation-v1'
        && evaluation.version === 1 && evaluation.trialId === trialId && evaluation.forkDigest === fork.digest
        && evaluation.digest === retained.binding.evaluation.issuedDigest && hash(withoutDigest(evaluation)) === evaluation.digest,
      'TRIAL_ARTIFACT_UNAUTHENTIC', 'The evaluation must match its separately issued identity and exact fork.');
    }
    // A different host may have revoked or reserved issuance while payload reads were awaiting custody.
    const latest = await this.#binding(ctx, trialId);
    check(latest.bindingRef.valueDigest === retained.bindingRef.valueDigest && latest.binding.status === 'active',
      latest.binding.status === 'discarded' ? 'TRIAL_DISCARDED' : 'TRIAL_CUSTODY_CHANGED', 'Trial issuance changed while loading its retained payloads.');
    const loaded = { ...retained, fork, evaluation }; this.#current(ctx, loaded); return loaded;
  }
  #service(loaded?: Loaded, view = this.#live): PrivateTrialService {
    const host: PrivateTrialHost = {
      now: this.#options.now, resolveRecipeEvidence: this.#options.resolveRecipeEvidence,
      calculatorGuards: this.#options.calculatorGuards, resolvePromotionImpact: this.#options.resolvePromotionImpact,
      resolveTrial: (ctx, trialId) => {
        check(loaded && trialId === loaded.fork.id, 'TRIAL_CUSTODY_REQUIRED', 'Load authenticated encrypted trial custody before replay.');
        this.#current(ctx, loaded, view); return structuredClone({ fork: loaded.fork, evaluation: loaded.evaluation });
      },
      assertArtifactAuthentic: (ctx, kind, issuedDigest) => {
        check(loaded, 'TRIAL_CUSTODY_REQUIRED', 'Load independently authenticated trial issuance.'); this.#current(ctx, loaded, view);
        check((kind === 'fork' ? loaded.binding.fork : loaded.binding.evaluation)?.issuedDigest === issuedDigest,
          'TRIAL_ARTIFACT_UNAUTHENTIC', 'A caller-recomputed digest is not an independently issued artifact.');
      },
    };
    return new PrivateTrialService(view, host);
  }
  #readyCreated(ctx: Context, loaded: Loaded) {
    this.#current(ctx, loaded);
    for (const side of ['baseline', 'candidate'] as const) {
      const guards = this.#options.calculatorGuards(readOnly(loaded.fork[side]), { phase: 'read', side, change: structuredClone(loaded.fork.change) });
      check(guards && typeof guards.consumerGuard === 'function' && typeof guards.receiptGuard === 'function', 'TRIAL_READINESS_REQUIRED', 'Current view-specific readiness is mandatory.');
      for (const saved of loaded.fork.savedRequests) completedSync(guards.consumerGuard(ctx, structuredClone(saved.request)));
    }
    this.#current(ctx, loaded);
  }
  #summary(loaded: Loaded, hostElapsedMs: number): PrivateTrialSummary {
    const { fork, evaluation, binding, bindingRef } = loaded;
    const forkDiskBytes = binding.fork.ref.diskBytes, evaluationDiskBytes = binding.evaluation?.ref.diskBytes ?? 0;
    return structuredClone({ trialId: fork.id, workspaceId: fork.workspaceId, memberId: fork.memberId, epoch: fork.epoch, createdAt: fork.createdAt,
      status: evaluation ? 'evaluated' : 'created', qualification: 'isolated-source-replay', interpretation: 'restated-private-diagnostic',
      change: { type: fork.change.type, target: fork.change.type === 'definition' ? fork.change.name : fork.change.type === 'recipe' ? fork.change.recipeId : fork.change.kind },
      savedAnswerIds: fork.savedRequests.map(saved => saved.answerId), forkDigest: fork.digest, evaluationDigest: evaluation?.digest ?? null,
      baselinePin: fork.baselinePin, candidatePin: fork.candidatePin,
      cost: { preparationElapsedMs: fork.cost.preparationElapsedMs, serializedForkBytes: fork.cost.serializedForkBytes,
        hostElapsedMs, forkDiskBytes, evaluationDiskBytes, bindingDiskBytes: bindingRef.diskBytes,
        totalDiskBytes: forkDiskBytes + evaluationDiskBytes + bindingRef.diskBytes }, ...(evaluation ? { evaluation } : {}) });
  }
  create(context: Context, request: PrivateTrialRequest): Promise<PrivateTrialSummary> {
    const ctx = structuredClone(context), input = structuredClone(request);
    return this.#serial(async () => {
      const started = performance.now(); this.#access(ctx);
      const fork = await this.#service().create(ctx, input); this.#access(ctx);
      const forkRef = await this.#writeArtifact(`${fork.id}-fork`, fork, null); this.#access(ctx);
      const binding: Binding = { version: 1, type: 'private-trial-issued-binding-v1', trialId: fork.id, workspaceId: fork.workspaceId,
        memberId: fork.memberId, epoch: fork.epoch, createdAt: fork.createdAt, status: 'active', fork: { ref: forkRef, issuedDigest: fork.digest }, evaluation: null };
      let bindingRef: PrivateTrialArtifactRef;
      try { bindingRef = await this.#writeArtifact(bindingId(fork.id), binding, null); }
      catch (error) {
        // Unissued payloads are unreachable. Best-effort bounded cleanup never manufactures issuance.
        try { await this.#options.custody.remove({ id: forkRef.id, purpose, expectedDigest: forkRef.valueDigest }); } catch { /* Custody inventory must retain any orphan as unresolved evidence. */ }
        throw error;
      }
      const loaded: Loaded = { binding, bindingRef, fork }; this.#current(ctx, loaded);
      this.#readyCreated(ctx, loaded);
      return this.#summary(loaded, performance.now() - started);
    });
  }
  evaluate(context: Context, trialId: string): Promise<PrivateTrialSummary> {
    const ctx = structuredClone(context);
    return this.#serial(async () => {
      const started = performance.now(); const loaded = await this.#load(ctx, trialId);
      if (loaded.evaluation) { loaded.evaluation = this.#service(loaded).read(ctx, trialId); return this.#summary(loaded, performance.now() - started); }
      const evaluation = await this.#service(loaded).evaluate(ctx, trialId); this.#current(ctx, loaded);
      const evaluationRef = await this.#writeArtifact(`${trialId}-evaluation`, evaluation, null); this.#current(ctx, loaded);
      const binding: Binding = { ...loaded.binding, evaluation: { ref: evaluationRef, issuedDigest: evaluation.digest } };
      let bindingRef: PrivateTrialArtifactRef;
      try { bindingRef = await this.#writeArtifact(bindingId(trialId), binding, loaded.bindingRef.valueDigest); }
      catch (error) {
        try { await this.#options.custody.remove({ id: evaluationRef.id, purpose, expectedDigest: evaluationRef.valueDigest }); } catch { /* An unreachable orphan does not authorize a trial. */ }
        throw error;
      }
      const current = { ...loaded, binding, bindingRef, evaluation }; this.#current(ctx, current);
      this.#service(current).read(ctx, trialId); return this.#summary(current, performance.now() - started);
    });
  }
  read(context: Context, trialId: string): Promise<PrivateTrialSummary> {
    const ctx = structuredClone(context);
    return this.#serial(async () => {
      const started = performance.now(), loaded = await this.#load(ctx, trialId);
      if (loaded.evaluation) loaded.evaluation = this.#service(loaded).read(ctx, trialId); else this.#readyCreated(ctx, loaded);
      return this.#summary(loaded, performance.now() - started);
    });
  }
  list(context: Context): Promise<PrivateTrialSummary[]> {
    const ctx = structuredClone(context);
    return this.#serial(async () => {
      this.#access(ctx); const identities = await this.#options.custody.list({ purpose }); this.#access(ctx);
      check(Array.isArray(identities) && identities.length <= 4096, 'TRIAL_CUSTODY_LIMIT', 'Private trial enumeration must be complete and bounded.');
      check(new Set(identities.map(identity => identity.id)).size === identities.length, 'TRIAL_CUSTODY_INVALID', 'Custody enumeration must not duplicate artifact identities.');
      const results: PrivateTrialSummary[] = [];
      for (const identity of identities) {
        ref(identity); if (!identity.id.endsWith('-binding')) continue;
        const stored = await this.#readArtifact(identity.id); this.#access(ctx); const binding = stored.value as Binding;
        if (binding.workspaceId !== this.#live.read().workspace.id || binding.memberId !== ctx.memberId || binding.epoch !== ctx.epoch || binding.status !== 'active') continue;
        const started = performance.now(), loaded = await this.#load(ctx, binding.trialId);
        if (loaded.evaluation) loaded.evaluation = this.#service(loaded).read(ctx, loaded.fork.id); else this.#readyCreated(ctx, loaded);
        results.push(this.#summary(loaded, performance.now() - started));
      }
      this.#access(ctx); return results;
    });
  }
  discard(context: Context, trialId: string): Promise<PrivateTrialDiscard> {
    const ctx = structuredClone(context);
    return this.#serial(async () => {
      const started = performance.now(); const retained = await this.#binding(ctx, trialId);
      check(['active', 'discarded'].includes(retained.binding.status), 'TRIAL_PUBLICATION_RESERVED', 'A publication reservation requires explicit reconciliation before discard.');
      const binding = { ...retained.binding, status: 'discarded' as const };
      const tombstoneRef = retained.binding.status === 'discarded' ? retained.bindingRef
        : await this.#writeArtifact(bindingId(trialId), binding, retained.bindingRef.valueDigest);
      this.#access(ctx, binding); let removedDiskBytes = 0; const failedArtifactIds: string[] = [];
      for (const artifact of [binding.fork.ref, ...(binding.evaluation ? [binding.evaluation.ref] : [])]) {
        try {
          const removed = await this.#options.custody.remove({ id: artifact.id, purpose, expectedDigest: artifact.valueDigest });
          check(typeof removed?.removed === 'boolean' && Number.isSafeInteger(removed.diskBytes) && removed.diskBytes >= 0
            && (removed.removed || removed.diskBytes === 0), 'TRIAL_CUSTODY_INVALID', 'Discard requires measured actual removed encrypted bytes.');
          removedDiskBytes += removed.diskBytes;
        } catch { failedArtifactIds.push(artifact.id); }
        this.#access(ctx, binding);
      }
      return { trialId, status: 'discarded', discardElapsedMs: performance.now() - started, removedDiskBytes,
        retainedTombstoneDiskBytes: tombstoneRef.diskBytes, cleanupComplete: failedArtifactIds.length === 0, failedArtifactIds };
    });
  }
  promotionImpact(context: Context, trialId: string, strategy: PrivateTrialStrategy): Promise<PrivateTrialImpact> {
    const ctx = structuredClone(context);
    return this.#serial(async () => this.#service(await this.#load(ctx, trialId)).promotionImpact(ctx, trialId, strategy));
  }
  promote(context: Context, request: PrivateTrialPromotionRequest): Promise<{ trialId: string; status: 'promoted'; publicationId: string }> {
    const ctx = structuredClone(context), input = structuredClone(request);
    return this.#serial(async () => {
      const loaded = await this.#load(ctx, input.trialId), proposal = this.#service(loaded).proposePromotion(ctx, input);
      check(loaded.evaluation, 'TRIAL_EVALUATION_REQUIRED', 'Retain the exact evaluated trial before publication.');
      const reserved: Binding = { ...loaded.binding, status: 'promoting' };
      const reservedRef = await this.#writeArtifact(bindingId(input.trialId), reserved, loaded.bindingRef.valueDigest);
      this.#current(ctx, loaded); let asserted = false;
      const published = await this.#options.promoteAtomic(ctx, {
        proposal: structuredClone(proposal), fork: structuredClone(loaded.fork), evaluation: structuredClone(loaded.evaluation),
        assertCurrent: commitView => {
          check(commitView && typeof commitView.read === 'function', 'TRIAL_ATOMIC_PUBLICATION_REQUIRED', 'Supply the exact transaction commit-state view.');
          this.#current(ctx, loaded, commitView); this.#service(loaded, commitView).assertPromotionCurrent(ctx, proposal); asserted = true;
        },
      });
      check(asserted && published && opaqueId(published.publicationId), 'TRIAL_ATOMIC_PUBLICATION_REQUIRED', 'Atomic publication must check the reviewed trial at commit and return only its published identity.');
      this.#access(ctx, reserved);
      await this.#writeArtifact(bindingId(input.trialId), { ...reserved, status: 'promoted', publicationId: published.publicationId }, reservedRef.valueDigest);
      this.#access(ctx, reserved); return { trialId: input.trialId, status: 'promoted', publicationId: published.publicationId };
    });
  }
}
