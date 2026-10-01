import { authorize, check, ChausarError, newId, type Context, type State, type StateStore } from './contracts.ts';
import { digest } from './actions.ts';
import { assertSourceAccess, sourceAllowed, trustFingerprint } from './trust.ts';
import { validatePeriod } from './memory.ts';
import type { CalculationReceipt, CalculationRequest } from './calculator.ts';
import type { BusinessEvidenceRefs, BusinessEvidenceReadiness } from './conversation-context.ts';
import type { MappingRecipe } from './ingest.ts';
import {
  ConnectorCapabilityRegistry, ConnectorReadDispatcher, ConnectorReadImportBridge, CursorImportService,
  connectorOperationKey, systemReadClock,
  type ConnectorOperationScope, type ConnectorReadAdapter, type ConnectorReadResult, type ConnectorCapture,
  type ImportDomain, type IndependentSourceTotals, type MappingReview, type QualifiedDecoder, type QualifiedLevel,
  type ReadAuthorizationGuard, type ReadAuthorityScope, type ReadClock, type ReadEnvironment, type ReadFreshness,
  type ReadImportLink,
} from './connector-framework/index.ts';

/** Trusted host registrations. RPC payloads cannot install code, grants, endpoints or qualification evidence. */
export type EngineConnectorProfile = {
  id: string; title: string; sourceId: string; companyId: string; organizationId?: string;
  domain: ImportDomain; environment: ReadEnvironment; syntheticFixture?: true;
  readOperation: ConnectorOperationScope; importOperation: ConnectorOperationScope;
  readImplementationDigest: string; importImplementationDigest: string;
  reader: ConnectorReadAdapter; decoder: QualifiedDecoder; contentTypes: string[];
  /** Required host freshness policy; no implicit real-provider freshness assumption. */
  maximumSourceAgeMs: number;
};
export type ConnectorSemanticInput = Readonly<{
  state: State; profile: EngineConnectorProfile; capture: ConnectorCapture; sourceTotals: IndependentSourceTotals;
  readLink: ReadImportLink; registry: ConnectorCapabilityRegistry;
  decoderDescriptor: { id: string; version: string; schemaSha256: string; identityNamespace: string; definitionHash: string };
  at: string;
  measures?: readonly string[];
}>;
export type ConnectorSemanticProof = { mappingPackDigest: string; goldenRunDigest: string; holdoutRunDigest: string; reconciliationRunDigest: string };
/** The semantic lane supplies this real gate. No qualified stub or default implementation is installed. */
export type ConnectorSemanticPort = {
  beforePublish(context: Context, input: ConnectorSemanticInput): ConnectorSemanticProof;
  assertReady(context: Context, input: ConnectorSemanticInput): ConnectorSemanticProof;
};
export type EngineConnectorOptions = {
  registry?: ConnectorCapabilityRegistry;
  profiles?: readonly EngineConnectorProfile[] | ((store: StateStore) => readonly EngineConnectorProfile[]);
  authorizeRead?: (context: Context, ...args: Parameters<ReadAuthorizationGuard>) => ReturnType<ReadAuthorizationGuard>;
  semanticGate?: ConnectorSemanticPort | ((store: StateStore) => ConnectorSemanticPort);
  clock?: ReadClock;
  custody?: { maximumPendingReads: number; maximumBytes: number; ttlMs: number };
};
/** Literal RPC methods retain their actual service result; dynamic dispatch returns the result union. */
export type EngineConnectorRpcResults = {
  'connectors.profiles': ReturnType<EngineConnectorService['profiles']>;
  'connectors.read': Awaited<ReturnType<EngineConnectorService['read']>>;
  'connectors.reviewMapping': Awaited<ReturnType<EngineConnectorService['reviewMapping']>>;
  'connectors.capture': Awaited<ReturnType<EngineConnectorService['capture']>>;
  'connectors.publish': Awaited<ReturnType<EngineConnectorService['publish']>>;
  'connectors.ready': ReturnType<EngineConnectorService['ready']>;
  'connectors.captureStatus': ReturnType<EngineConnectorService['captureStatus']>;
  'connectors.releaseRead': ReturnType<EngineConnectorService['releaseRead']>;
};
type RuntimeProfile = {
  profile: EngineConnectorProfile; digest: string; authority: ReadAuthorityScope; importer: CursorImportService;
};
type PendingRead = {
  runtime: RuntimeProfile; reader: ConnectorReadDispatcher; result: ConnectorReadResult;
  context: Context; authorityRevision: string; expiresAt: number;
  cancelExpiry: () => void;
};
type ConsumerBinding = {
  type: 'connector-consumer-binding-v1'; id: string; captureId: string; profileId: string; profileDigest: string;
  sourceId: string; environment: ReadEnvironment; minimum: QualifiedLevel;
  readQualificationDigest: string; importQualificationDigest: string;
  acquiredBy: Context; authorityRevision: string;
  freshness: ReadFreshness; semanticQualification: 'unqualified' | 'qualified';
  semanticProof?: ConnectorSemanticProof;
};
const levels: Record<ReadEnvironment, QualifiedLevel> = { synthetic: 'synthetic-tested', sandbox: 'sandbox-verified', live: 'live-verified' };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const captures = (state: State): ConnectorCapture[] => state.imports.filter(item => item.type === 'connector-capture-v1');
const bindingFor = (state: State, captureId: string): ConsumerBinding | undefined => state.imports.find(item => item.type === 'connector-consumer-binding-v1' && item.captureId === captureId);
const overlap = (domain: ImportDomain, request: Pick<CalculationRequest, 'period' | 'branch'>) => (!request.branch || domain.branches.includes(request.branch))
  && (!request.period || !domain.period || domain.period.from <= request.period.to && request.period.from <= domain.period.to);
const view = (store: StateStore, state: State): StateStore => ({ read: () => state, update: store.update.bind(store) });
const publicCapture = (capture: ConnectorCapture, binding?: ConsumerBinding) => ({
  id: capture.id, sourceId: capture.sourceId, domain: structuredClone(capture.domain), status: capture.status,
  generation: capture.generation, progress: structuredClone(capture.progress), coverage: structuredClone(capture.coverage),
  gaps: structuredClone(capture.gaps), rowIds: [...capture.rowIds], totalsMinor: capture.totalsMinor,
  qualification: binding?.minimum ?? 'unqualified', semanticQualification: binding?.semanticQualification === 'qualified'
    ? `${binding.environment}-qualified` : binding?.semanticQualification ?? 'unverified',
  syntheticFixture: binding?.environment === 'synthetic', liveVerified: false,
});

/** Read -> owner mapping review -> byte-preserving capture -> independent totals -> typed receipt. */
export class EngineConnectorService {
  readonly #store: StateStore; readonly #options: EngineConnectorOptions; readonly #registry: ConnectorCapabilityRegistry;
  readonly #clock: ReadClock; readonly #profiles = new Map<string, RuntimeProfile>();
  readonly #semanticGate?: ConnectorSemanticPort;
  readonly #pending = new Map<string, PendingRead>(); readonly #controllers = new Set<AbortController>();
  readonly #custody: { maximumPendingReads: number; maximumBytes: number; ttlMs: number };
  #reading = 0; #closed = false;

  constructor(store: StateStore, options: EngineConnectorOptions = {}) {
    this.#store = store; this.#options = { ...options }; this.#registry = options.registry ?? new ConnectorCapabilityRegistry();
    this.#clock = options.clock ?? systemReadClock;
    this.#semanticGate = typeof options.semanticGate === 'function' ? options.semanticGate(store) : options.semanticGate;
    this.#custody = { ...(options.custody ?? { maximumPendingReads: 4, maximumBytes: 16 * 1024 * 1024, ttlMs: 300_000 }) };
    check(Number.isSafeInteger(this.#custody.maximumPendingReads) && this.#custody.maximumPendingReads >= 1 && this.#custody.maximumPendingReads <= 16
      && Number.isSafeInteger(this.#custody.maximumBytes) && this.#custody.maximumBytes >= 1 && this.#custody.maximumBytes <= 64 * 1024 * 1024
      && Number.isSafeInteger(this.#custody.ttlMs) && this.#custody.ttlMs >= 1000 && this.#custody.ttlMs <= 900_000,
    'CONNECTOR_CUSTODY_POLICY_INVALID', 'Choose bounded connector custody limits.');
    const profiles = typeof options.profiles === 'function' ? options.profiles(store) : options.profiles ?? [];
    check(Array.isArray(profiles) && profiles.length <= 200, 'CONNECTOR_PROFILES_INVALID', 'Install a bounded host profile catalogue.');
    for (const input of profiles) {
      const { reader, decoder, ...metadata } = input;
      const { readPage, ...readerMetadata } = reader, { decode, ...decoderMetadata } = decoder;
      const profile: EngineConnectorProfile = { ...structuredClone(metadata),
        reader: { ...structuredClone(readerMetadata), readPage }, decoder: { ...structuredClone(decoderMetadata), decode } };
      check(id(profile.id) && !this.#profiles.has(profile.id) && id(profile.sourceId) && typeof profile.title === 'string' && profile.title.length > 0
        && profile.title.length <= 200 && id(profile.companyId) && Object.hasOwn(levels, profile.environment)
        && (profile.environment !== 'synthetic' || profile.syntheticFixture === true),
      'CONNECTOR_PROFILE_INVALID', 'Install distinct exact profiles and explicitly label every synthetic fixture.');
      check(sha(profile.readImplementationDigest) && sha(profile.importImplementationDigest)
        && connectorOperationKey(profile.reader.operation) === connectorOperationKey(profile.readOperation)
        && profile.reader.environment === profile.environment && profile.importOperation.kind === 'import'
        && Number.isSafeInteger(profile.maximumSourceAgeMs) && profile.maximumSourceAgeMs >= 1 && profile.maximumSourceAgeMs <= 31_536_000_000,
      'CONNECTOR_PROFILE_INVALID', 'Pin exact read/import implementations, environments and freshness policy.');
      validatePeriod(profile.domain.period);
      const authority: ReadAuthorityScope = { tenantId: store.read().workspace.id, sourceId: profile.sourceId, companyId: profile.companyId,
        ...(profile.organizationId ? { organizationId: profile.organizationId } : {}) };
      const runtime: RuntimeProfile = { profile, authority, digest: digest({ ...metadata, reader: readerMetadata, decoder: decoderMetadata }),
        importer: new CursorImportService(this.#guardedStore(profile), this.#registry, profile.decoder, { now: () => this.#at(), minimumQualification: levels[profile.environment] }) };
      this.#profiles.set(profile.id, runtime);
      // Constructor checks the complete bridge/decoder/domain binding even before an acquisition exists.
      this.#bridge(runtime, new ConnectorReadDispatcher({ registry: this.#registry, authorize: async () => { throw new Error('No read started'); } }));
    }
  }

  #at() { return new Date(this.#clock.nowMs()).toISOString(); }
  #runtime(profileId: unknown): RuntimeProfile {
    check(!this.#closed, 'CONNECTOR_RUNTIME_CLOSED', 'Open the workspace before using connectors.');
    const runtime = typeof profileId === 'string' ? this.#profiles.get(profileId) : undefined;
    check(runtime, 'CONNECTOR_PROFILE_NOT_INSTALLED', 'This exact connector profile is not installed by the trusted host.'); return runtime;
  }
  #access(ctx: Context, profile: EngineConnectorProfile, permission: 'read' | 'prepare' = 'read', state = this.#store.read()) {
    const member = authorize(view(this.#store, state), ctx, permission); assertSourceAccess(state, ctx, [profile.sourceId]);
    check(profile.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch)), 'CONNECTOR_BRANCH_FORBIDDEN', 'This profile includes branches outside current access.');
  }
  #qualified(profile: EngineConnectorProfile) {
    const minimum = levels[profile.environment];
    const read = this.#registry.assertDefinition(profile.readOperation, profile.readImplementationDigest, this.#at(), minimum);
    const imported = this.#registry.assertDefinition(profile.importOperation, profile.importImplementationDigest, this.#at(), minimum);
    return { read, imported, minimum };
  }
  #guardedStore(profile: EngineConnectorProfile): StateStore {
    return { read: this.#store.read.bind(this.#store), update: change => this.#store.update(async state => {
      this.#qualified(profile); const result = await change(state); this.#qualified(profile); return result;
    }) };
  }
  #bridge(runtime: RuntimeProfile, reader: ConnectorReadDispatcher) {
    const p = runtime.profile;
    return new ConnectorReadImportBridge(this.#guardedStore(p), { readOperation: p.readOperation, importOperation: p.importOperation,
      authority: runtime.authority, domain: p.domain, decoder: runtime.importer.decoderDescriptor(), contentTypes: p.contentTypes },
    { reader, registry: this.#registry, importer: runtime.importer, now: () => this.#at() });
  }
  #dropRead(key: string) { this.#pending.get(key)?.cancelExpiry(); this.#pending.delete(key); }
  #expire() { for (const [key, read] of this.#pending) if (read.expiresAt <= this.#clock.nowMs()) this.#dropRead(key); }
  #fresh(profile: EngineConnectorProfile, freshness: ReadFreshness) {
    const generated = freshness.oldestSourceGeneratedAtMs, time = this.#clock.nowMs();
    check(generated !== null && generated <= time && time - generated <= profile.maximumSourceAgeMs,
      'CONNECTOR_SOURCE_NOT_CURRENT', 'This source time is missing, ahead of the host clock or older than the approved freshness policy.');
  }
  #semantic(ctx: Context, runtime: RuntimeProfile, capture: ConnectorCapture, totals: IndependentSourceTotals, state: State, phase: 'beforePublish' | 'assertReady', measures?: readonly string[]) {
    const gate = this.#semanticGate;
    check(gate, 'CONNECTOR_SEMANTIC_GATE_REQUIRED', 'The actual mapping-pack golden/holdout and reconciliation gate must qualify this source before publication.');
    const readLink = state.imports.find(item => item.type === 'connector-read-import-link-v1' && item.captureId === capture.id) as ReadImportLink | undefined;
    check(readLink, 'CONNECTOR_READ_CUSTODY_REQUIRED', 'Semantic qualification requires the original trusted read-to-capture custody link.');
    const descriptor = runtime.importer.decoderDescriptor();
    const proof = gate[phase](ctx, { state, profile: runtime.profile, capture, sourceTotals: totals, readLink,
      registry: this.#registry, decoderDescriptor: { id: descriptor.id, version: descriptor.version, schemaSha256: descriptor.schemaSha256,
        identityNamespace: descriptor.identityNamespace, definitionHash: descriptor.definitionHash }, at: this.#at(), ...(measures ? { measures } : {}) });
    check(proof && ['mappingPackDigest', 'goldenRunDigest', 'holdoutRunDigest', 'reconciliationRunDigest'].every(key => sha(proof[key as keyof typeof proof])),
      'CONNECTOR_SEMANTIC_PROOF_INVALID', 'The semantic gate must bind actual qualification evidence.'); return structuredClone(proof);
  }

  profiles(ctx: Context) {
    authorize(this.#store, ctx); return [...this.#profiles.values()].filter(r => {
      try { this.#access(ctx, r.profile); return true; } catch { return false; }
    }).map(({ profile }) => ({ id: profile.id, title: profile.title, sourceId: profile.sourceId, domain: structuredClone(profile.domain),
      environment: profile.environment, syntheticFixture: profile.environment === 'synthetic',
      read: this.#registry.qualification(profile.readOperation, this.#at(), levels[profile.environment]),
      import: this.#registry.qualification(profile.importOperation, this.#at(), levels[profile.environment]),
      semanticQualification: 'unverified', liveVerified: false }));
  }
  sourceSummaries(ctx: Context) {
    const state = this.#store.read(), member = authorize(this.#store, ctx);
    return captures(state).filter(capture => sourceAllowed(state, ctx, capture.sourceId)
      && capture.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch)))
      .map(capture => publicCapture(capture, bindingFor(state, capture.id)));
  }
  async read(ctx: Context, profileId: string) {
    ctx = structuredClone(ctx); const runtime = this.#runtime(profileId), profile = runtime.profile;
    this.#access(ctx, profile, 'prepare'); this.#qualified(profile); this.#expire();
    check(this.#options.authorizeRead, 'CONNECTOR_HOST_GRANTS_REQUIRED', 'A trusted host must supply current source grants.');
    check(this.#pending.size + this.#reading < this.#custody.maximumPendingReads, 'CONNECTOR_CUSTODY_FULL', 'Capture or release an existing read before starting another.');
    const fingerprint = trustFingerprint(this.#store.read(), ctx, [profile.sourceId]);
    const reader = new ConnectorReadDispatcher({ registry: this.#registry, clock: this.#clock, authorize: async (...args) => {
      this.#access(ctx, profile, 'prepare'); this.#qualified(profile);
      check(trustFingerprint(this.#store.read(), ctx, [profile.sourceId]) === fingerprint, 'CONNECTOR_AUTHORITY_CHANGED', 'Your current read authority changed.');
      const grant = await this.#options.authorizeRead!(ctx, ...args);
      this.#access(ctx, profile, 'prepare'); this.#qualified(profile);
      check(trustFingerprint(this.#store.read(), ctx, [profile.sourceId]) === fingerprint, 'CONNECTOR_AUTHORITY_CHANGED', 'Your current read authority changed.');
      return grant;
    } });
    const controller = new AbortController(); this.#controllers.add(controller); this.#reading++;
    try {
      const result = await reader.read({ operation: profile.readOperation, authority: runtime.authority, dataScope: profile.domain,
        environment: profile.environment, maximumSourceAgeMs: profile.maximumSourceAgeMs, signal: controller.signal,
        limits: { totalBytes: Math.min(this.#custody.maximumBytes, 16 * 1024 * 1024), pageBytes: Math.min(this.#custody.maximumBytes, 4 * 1024 * 1024) } }, profile.reader);
      this.#access(ctx, profile, 'prepare'); this.#qualified(profile); this.#fresh(profile, result.freshness); this.#expire();
      check(!this.#closed && [...this.#pending.values()].reduce((sum, pending) => sum + pending.result.receipt.bytes, result.receipt.bytes) <= this.#custody.maximumBytes,
        'CONNECTOR_CUSTODY_FULL', 'The held read bytes exceed the host custody budget.');
      const acquisitionId = newId('acquisition'), expiresAt = this.#clock.nowMs() + this.#custody.ttlMs;
      const cancelExpiry = this.#clock.setTimer(() => this.#dropRead(acquisitionId), this.#custody.ttlMs);
      this.#pending.set(acquisitionId, { runtime, reader, result, context: ctx, authorityRevision: fingerprint, expiresAt, cancelExpiry });
      return { acquisitionId, profileId, expiresAt: new Date(expiresAt).toISOString(), receipt: structuredClone(result.receipt),
        completeness: structuredClone(result.completeness), freshness: structuredClone(result.freshness), schema: structuredClone(result.schema),
        syntheticFixture: profile.environment === 'synthetic', semanticQualification: 'unqualified', liveVerified: false };
    } finally { this.#reading--; this.#controllers.delete(controller); }
  }
  reviewMapping(ctx: Context, profileId: string, recipe: MappingRecipe, evidence: MappingReview['evidence']) {
    const runtime = this.#runtime(profileId); this.#access(ctx, runtime.profile, 'prepare'); this.#qualified(runtime.profile);
    return runtime.importer.reviewMapping(ctx, { sourceId: runtime.profile.sourceId, scope: runtime.profile.importOperation, domain: runtime.profile.domain, recipe, evidence });
  }
  async capture(ctx: Context, input: { acquisitionId: string; reviewId: string; recipe: MappingRecipe; idempotencyKey: string }) {
    ctx = structuredClone(ctx); input = structuredClone(input); this.#expire(); const pending = this.#pending.get(input.acquisitionId);
    check(pending, 'CONNECTOR_READ_CUSTODY_EXPIRED', 'Acquire source bytes again; this trusted in-process read is unavailable.');
    check(pending.context.memberId === ctx.memberId && pending.context.epoch === ctx.epoch && pending.context.role === ctx.role,
      'CONNECTOR_READ_OWNER_MISMATCH', 'Capture your own current acquisition.');
    const { runtime, result, reader } = pending, profile = runtime.profile;
    this.#access(ctx, profile, 'prepare'); const qualification = this.#qualified(profile); this.#fresh(profile, result.freshness);
    check(trustFingerprint(this.#store.read(), ctx, [profile.sourceId]) === pending.authorityRevision, 'CONNECTOR_AUTHORITY_CHANGED', 'Read authority changed before capture.');
    check(result.completeness.snapshot === 'same-declared-snapshot' && result.pages[0]?.provenance.source.snapshotId,
      'CONNECTOR_SNAPSHOT_REQUIRED', 'This consumer requires an explicit coherent source snapshot.');
    const captured = await this.#bridge(runtime, reader).capture(ctx, { read: result, request: {
      sourceId: profile.sourceId, scope: profile.importOperation, domain: profile.domain, recipe: input.recipe,
      reviewId: input.reviewId, idempotencyKey: input.idempotencyKey, snapshot: { kind: 'source-snapshot', id: result.pages[0].provenance.source.snapshotId! },
    } });
    const binding: ConsumerBinding = { type: 'connector-consumer-binding-v1', id: `consumer_${captured.id}`, captureId: captured.id,
      profileId: profile.id, profileDigest: runtime.digest, sourceId: profile.sourceId, environment: profile.environment, minimum: qualification.minimum,
      readQualificationDigest: qualification.read.digest, importQualificationDigest: qualification.imported.digest,
      acquiredBy: structuredClone(ctx), authorityRevision: pending.authorityRevision,
      freshness: structuredClone(result.freshness), semanticQualification: 'unqualified' };
    await this.#store.update(state => {
      this.#access(ctx, profile, 'prepare', state); this.#qualified(profile);
      const old = bindingFor(state, captured.id);
      check(!old || digest(old) === digest(binding), 'CONNECTOR_CONSUMER_BINDING_CHANGED', 'This capture has a different admitted consumer binding.');
      if (!old) state.imports.push(structuredClone(binding));
    });
    this.#dropRead(input.acquisitionId); return publicCapture(captured, binding);
  }
  async publish(ctx: Context, profileId: string, captureId: string, totals: IndependentSourceTotals) {
    ctx = structuredClone(ctx); totals = structuredClone(totals); const runtime = this.#runtime(profileId), profile = runtime.profile;
    this.#access(ctx, profile, 'prepare'); this.#qualified(profile);
    const capture = runtime.importer.get(ctx, captureId); const binding = this.#assertBinding(ctx, runtime, capture);
    check(totals, 'SOURCE_TOTALS_REQUIRED', 'Provide the independently reviewed source report totals.');
    check(capture.status !== 'published' || digest(capture.sourceTotals) === digest(totals), 'CONNECTOR_SOURCE_TOTALS_CHANGED', 'A published capture cannot be rebound to different source report totals.');
    // Pin totals and genuine semantic evidence in the SAME transaction as fact publication.
    const publicationStore: StateStore = { read: this.#store.read.bind(this.#store), update: change => this.#store.update(async state => {
      this.#access(ctx, profile, 'prepare', state); this.#qualified(profile); this.#assertBinding(ctx, runtime, capture, state);
      const result = await change(state); this.#qualified(profile); this.#access(ctx, profile, 'prepare', state);
      return result;
    }) };
    const published = await new CursorImportService(publicationStore, this.#registry, profile.decoder, { now: () => this.#at(), minimumQualification: levels[profile.environment],
      beforeInsert: (currentContext, state, currentCapture, currentTotals) => {
        this.#assertBinding(currentContext, runtime, currentCapture, state);
        const proof = this.#semantic(currentContext, runtime, currentCapture, currentTotals, state, 'beforePublish');
        const saved = bindingFor(state, captureId)!; saved.semanticQualification = 'qualified'; saved.semanticProof = structuredClone(proof);
      } })
      .publish(ctx, { captureId, generation: capture.generation }, totals);
    return publicCapture(published, bindingFor(this.#store.read(), captureId) ?? binding);
  }
  #assertBinding(ctx: Context, runtime: RuntimeProfile, capture: ConnectorCapture, state = this.#store.read()) {
    this.#access(ctx, runtime.profile, 'read', state); const qualified = this.#qualified(runtime.profile), binding = bindingFor(state, capture.id);
    check(binding && binding.profileId === runtime.profile.id && binding.profileDigest === runtime.digest && binding.sourceId === capture.sourceId
      && binding.environment === runtime.profile.environment && binding.minimum === qualified.minimum
      && binding.readQualificationDigest === qualified.read.digest && binding.importQualificationDigest === qualified.imported.digest
      && (capture.minimumQualification ?? 'synthetic-tested') === qualified.minimum && capture.qualificationDigest === qualified.imported.digest
      && capture.operationKey === connectorOperationKey(runtime.profile.importOperation) && digest(capture.domain) === digest(runtime.profile.domain)
      && capture.decoderDefinitionHash === runtime.importer.decoderDescriptor().definitionHash,
    'CONNECTOR_CONSUMER_BINDING_CHANGED', 'This capture lacks its exact current host profile and qualification binding.');
    const review = state.imports.find(item => item.type === 'connector-mapping-review-v1' && item.id === capture.reviewId) as MappingReview | undefined;
    const reviewer = review && state.members.find(member => member.id === review.reviewer.memberId);
    check(review && reviewer?.active && reviewer.epoch === review.reviewer.epoch && ['owner', 'cofounder'].includes(reviewer.role)
      && review.recipeHash === capture.recipeHash && digest(state.ontology) === capture.ontologyHash,
      'CONNECTOR_MAPPING_REVIEW_CHANGED', 'The reviewed dictionary, mapping or reviewer authority changed.');
    authorize(view(this.#store, state), binding.acquiredBy);
    check(trustFingerprint(state, binding.acquiredBy, [capture.sourceId]) === binding.authorityRevision && capture.authority === binding.authorityRevision,
      'CONNECTOR_AUTHORITY_CHANGED', 'The source acquisition authority changed; review a newly authorized capture.');
    this.#fresh(runtime.profile, binding.freshness); return binding;
  }
  #readyCapture(ctx: Context, capture: ConnectorCapture, state: State, measures?: readonly string[]) {
    const binding = bindingFor(state, capture.id); check(binding, 'CONNECTOR_CONSUMER_BINDING_REQUIRED', 'This captured source requires its trusted consumer binding.');
    const runtime = this.#runtime(binding.profileId); const admitted = this.#assertBinding(ctx, runtime, capture, state);
    runtime.importer.assertReady(ctx, capture.sourceId, capture.domain, true);
    check(capture.sourceTotals && admitted.semanticQualification === 'qualified', 'CONNECTOR_SEMANTIC_GATE_REQUIRED', 'This source lacks actual semantic qualification.');
    check(digest(admitted.semanticProof) === digest(this.#semantic(ctx, runtime, capture, capture.sourceTotals, state, 'assertReady', measures)), 'CONNECTOR_SEMANTIC_QUALIFICATION_CHANGED', 'Saved source semantic qualification is no longer current.');
  }
  ready(ctx: Context, profileId: string, measures?: readonly string[]) {
    const runtime = this.#runtime(profileId), profile = runtime.profile, state = this.#store.read(); this.#access(ctx, profile);
    runtime.importer.assertReady(ctx, profile.sourceId, profile.domain, true);
    captures(state).filter(c => c.sourceId === profile.sourceId && digest(c.domain) === digest(profile.domain)).forEach(c => this.#readyCapture(ctx, c, state, measures));
    return { ready: true, sourceId: profile.sourceId, domain: structuredClone(profile.domain), syntheticFixture: profile.environment === 'synthetic',
      semanticQualification: `${profile.environment}-qualified`, qualification: levels[profile.environment], liveVerified: false };
  }
  /** Install in every CalculatorService, including reports, jobs and MCP. Invoke again before durable receipt commit. */
  assertCalculationReady(ctx: Context, request: CalculationRequest) {
    const state = this.#store.read(); authorize(this.#store, ctx); validatePeriod(request.period); validatePeriod(request.comparePeriod);
    if (request.sourceIds !== undefined) assertSourceAccess(state, ctx, request.sourceIds);
    const inSourceScope = (sourceId: string) => request.sourceIds === undefined || request.sourceIds.includes(sourceId);
    const operation = (state.ontology?.current ?? state.ontology)?.operations?.find((item: any) => item.id === request.operation);
    const measures: string[] | undefined = operation?.definitions;
    const selected = captures(state).filter(c => inSourceScope(c.sourceId) && sourceAllowed(state, ctx, c.sourceId) && (!request.branch || c.domain.branches.includes(request.branch)));
    for (const capture of selected) this.#readyCapture(ctx, capture, state, measures);
    for (const runtime of this.#profiles.values()) {
      if (!inSourceScope(runtime.profile.sourceId) || !sourceAllowed(state, ctx, runtime.profile.sourceId) || request.branch && !runtime.profile.domain.branches.includes(request.branch)) continue;
      const member = authorize(this.#store, ctx);
      if (!runtime.profile.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch))) continue;
      const domainPeriod = runtime.profile.domain.period;
      for (const period of [request.period, request.comparePeriod].filter(p => p !== undefined)) {
        check(!domainPeriod || domainPeriod.from <= period.from && domainPeriod.to >= period.to, 'CONNECTOR_DOMAIN_INCOMPLETE', 'The selected period extends beyond the acquired source domain.');
      }
      check(request.period || !domainPeriod, 'CONNECTOR_DOMAIN_REQUIRED', 'Choose an explicit period within this acquired source domain.');
      check(selected.some(capture => capture.sourceId === runtime.profile.sourceId && digest(capture.domain) === digest(runtime.profile.domain)),
        'SOURCE_NOT_READY', 'This selected source domain has not been acquired and published.');
    }
  }
  /** Saved receipts must obey the same current acquisition guard. Missing profiles after restart fail closed. */
  assertReceiptReady(ctx: Context, receipt: CalculationReceipt) {
    // Rechecks the requested domains, including selected sources with no counted rows.
    this.assertCalculationReady(ctx, { operation: receipt.operation, period: receipt.period ?? undefined, comparePeriod: receipt.comparePeriod ?? undefined,
      branch: receipt.branch ?? undefined, ...(receipt.requestedSourceIds !== undefined ? { sourceIds: receipt.requestedSourceIds } : {}) });
  }
  /** Business observations use the same current acquisition authority, without inventing a calculation. */
  assertBusinessEvidenceReady(ctx: Context, refs: BusinessEvidenceRefs): BusinessEvidenceReadiness {
    const state = this.#store.read(); authorize(this.#store, ctx);
    const sourceIds = [...new Set([...refs.sourceIds, ...refs.managedSourceIds])]; assertSourceAccess(state, ctx, sourceIds);
    const qualifiedSourceIds: string[] = [];
    for (const sourceId of sourceIds) {
      const managed = captures(state).filter(capture => capture.sourceId === sourceId);
      const installed = [...this.#profiles.values()].filter(runtime => runtime.profile.sourceId === sourceId);
      if (!managed.length && !installed.length && !refs.managedSourceIds.includes(sourceId)) continue;
      check(managed.length > 0 && installed.length > 0, 'SOURCE_NOT_READY', 'The managed business evidence needs its actual installed acquisition profile.');
      const selected = managed.filter(capture => overlap(capture.domain, { branch: refs.request.branch, period: refs.request.period }));
      check(selected.length > 0, 'SOURCE_NOT_READY', 'The selected business scope has no current managed capture.');
      for (const capture of selected) this.#readyCapture(ctx, capture, state);
      for (const runtime of installed.filter(runtime => overlap(runtime.profile.domain, { branch: refs.request.branch, period: refs.request.period }))) {
        this.#access(ctx, runtime.profile);
        check(selected.some(capture => digest(capture.domain) === digest(runtime.profile.domain)), 'SOURCE_NOT_READY', 'An installed business source domain has not been acquired and published.');
      }
      const expectedRows = refs.factIds.filter(id => state.facts.some(fact => fact.id === id && fact.sourceId === sourceId));
      check(expectedRows.every(id => selected.some(capture => capture.rowIds.includes(id))), 'SOURCE_NOT_READY', 'Every managed business observation must retain qualified capture lineage.');
      qualifiedSourceIds.push(sourceId);
    }
    return { qualifiedSourceIds };
  }
  captureStatus(ctx: Context, profileId: string, captureId: string) {
    const runtime = this.#runtime(profileId), capture = runtime.importer.get(ctx, captureId); this.#assertBinding(ctx, runtime, capture);
    return publicCapture(capture, bindingFor(this.#store.read(), capture.id));
  }
  releaseRead(ctx: Context, acquisitionId: string) {
    authorize(this.#store, ctx); const pending = this.#pending.get(acquisitionId);
    check(pending && pending.context.memberId === ctx.memberId && pending.context.epoch === ctx.epoch && pending.context.role === ctx.role,
      'CONNECTOR_READ_OWNER_MISMATCH', 'Release your own current acquisition.');
    this.#dropRead(acquisitionId); return { released: true };
  }
  request<Method extends keyof EngineConnectorRpcResults>(ctx: Context, method: Method, payload?: unknown): Promise<EngineConnectorRpcResults[Method]>;
  request(ctx: Context, method: string, payload?: unknown): Promise<EngineConnectorRpcResults[keyof EngineConnectorRpcResults]>;
  async request(ctx: Context, method: string, payload: any = {}): Promise<EngineConnectorRpcResults[keyof EngineConnectorRpcResults]> {
    const fields: Record<string, string[]> = {
      'connectors.profiles': [], 'connectors.read': ['profileId'], 'connectors.reviewMapping': ['profileId', 'recipe', 'evidence'],
      'connectors.capture': ['acquisitionId', 'reviewId', 'recipe', 'idempotencyKey'], 'connectors.publish': ['profileId', 'captureId', 'sourceTotals'],
      'connectors.ready': ['profileId'], 'connectors.captureStatus': ['profileId', 'captureId'], 'connectors.releaseRead': ['acquisitionId'],
    };
    check(Object.hasOwn(fields, method) && payload && Object.getPrototypeOf(payload) === Object.prototype && Object.keys(payload).every(k => fields[method].includes(k)),
      'INVALID_CONNECTOR_REQUEST', 'Use only the named connector method parameters.');
    switch (method) {
      case 'connectors.profiles': return this.profiles(ctx);
      case 'connectors.read': return this.read(ctx, payload.profileId);
      case 'connectors.reviewMapping': return this.reviewMapping(ctx, payload.profileId, payload.recipe, payload.evidence);
      case 'connectors.capture': return this.capture(ctx, payload);
      case 'connectors.publish': return this.publish(ctx, payload.profileId, payload.captureId, payload.sourceTotals);
      case 'connectors.ready': return this.ready(ctx, payload.profileId);
      case 'connectors.captureStatus': return this.captureStatus(ctx, payload.profileId, payload.captureId);
      case 'connectors.releaseRead': return this.releaseRead(ctx, payload.acquisitionId);
      default: throw new ChausarError('INVALID_CONNECTOR_REQUEST', 'Use only the named connector method parameters.');
    }
  }
  close() { this.#closed = true; for (const controller of this.#controllers) controller.abort(); for (const key of this.#pending.keys()) this.#dropRead(key); }
}
