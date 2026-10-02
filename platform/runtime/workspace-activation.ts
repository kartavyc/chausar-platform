import { authorize, check, ChausarError, hash, type Context, type Member, type State } from './contracts.ts';
import { compileDictionary, type Dictionary, type DictionaryDraft } from './ontology.ts';
import { canSeeFact } from './memory.ts';
import { assertSourceAccess } from './trust.ts';
import { proveEmptyWorkspaceTarget, WorkspaceImportCandidateService } from './workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest, readHistoricalWorkspaceState } from './workspace-interchange.ts';
import type { EmptyTargetInspection, WorkspaceImportCandidate, WorkspaceInventory } from './workspace-interchange-contracts.ts';
import type { WorkspaceInterchangeCustodyMeasurement, WorkspaceInterchangeCustodyPin, WorkspaceInterchangeCustodyRecord, WorkspaceInterchangeSourceLease } from './workspace-interchange-host.ts';

export type AuthenticatedActivationCandidate = WorkspaceInterchangeCustodyRecord & { measurement: WorkspaceInterchangeCustodyMeasurement };
export type WorkspaceActivationPolicy = {
  /** Explicit trusted fixture identities. Neither workspace.demo nor an RPC label admits a workspace. */
  approvedSyntheticWorkspaceIds: string[];
  allowedSyntheticSourceIds: string[];
  budgets: { maxCandidateBytes: number; maxArtifactBytes: number; maxArtifacts: number; maxFacts: number; maxRecords: number };
  retentionDays: number;
};
export type WorkspaceActivationAuthority = {
  workspaceId: string; owner: Member; context: Context; sessionAuthorityId: string; createdAt: string;
};
export type WorkspaceBusinessProjection = {
  format: 'chausar.synthetic-business-projection.v1';
  workspace: { name: string; currency: string };
  /** Reviewed fresh local policy, never the historical policy. */
  policy: State['policy'];
  ontology: State['ontology']; facts: State['facts']; imports: State['imports'];
  conflicts: State['conflicts']; merges: State['merges']; tombstones: State['tombstones']; sourceRules: State['sourceRules'];
};
export type WorkspaceActivationEvidence = {
  format: 'chausar.workspace-activation-evidence.v1'; inert: true;
  /** Exact original authenticated candidate text and independent pin, including the complete historical archive. */
  content: string; pin: WorkspaceInterchangeCustodyRecord['pin'];
};
export type WorkspaceActivationRecord = {
  format: 'chausar.workspace-activation.v1'; status: 'committed'; activationId: string;
  candidateId: string; candidateCreationId: string; candidateDigest: string; pinDigest: string;
  contextDigest: string; sourceInventoryDigest: string; targetProofDigest: string;
  targetId: string; workspaceId: string; projectionDigest: string;
  authorityDigest: string; stateDigest: string; evidenceDigest: string;
};
export type WorkspaceActivationCommit = {
  record: WorkspaceActivationRecord; state: State; evidence: WorkspaceActivationEvidence; authority: WorkspaceActivationAuthority;
};
export type WorkspaceActivationReadback =
  | ({ status: 'committed'; encrypted: true; ciphertextBytes: number; qualification: 'test-fixture' | 'encrypted-local-host' } & WorkspaceActivationCommit)
  | { status: 'failed' | 'unknown'; activationId: string; reasonCode: string };

/** Root holds current source + candidate record + reserved physical target exclusion for the ENTIRE callback. */
export type WorkspaceActivationLease = {
  source: WorkspaceInterchangeSourceLease;
  target: EmptyTargetInspection;
  readCandidate(): Promise<AuthenticatedActivationCandidate>;
  /** Before publication: recheck source inventory/access/readiness, exact candidate issuance and physical empty target generation. */
  assertCurrent(): Promise<void>;
  /** Root allocates fresh target owner/session authority; it never copies historical credentials or session IDs. */
  allocateAuthority(): Promise<WorkspaceActivationAuthority>;
  /**
   * Durable single-use CAS for BOTH candidateCreationId and activationId. Preserve evidence encrypted,
   * initialize only the exact reserved empty target, publish no-overwrite, and keep source fences held.
   * Refuse replay after restart, even when content is identical. Ambiguous failures remain unknown.
   * Source writer exclusion lasts through commit/readback; target assertCurrent is pre-commit only.
   */
  commit(input: WorkspaceActivationCommit): Promise<void>;
  /** Authenticated target snapshot + evidence + authority + durable commit binding under the same held locks. */
  readback(): Promise<WorkspaceActivationReadback>;
};
export type WorkspaceActivationPorts = {
  custody: { read(context: Context, candidateId: string): Promise<AuthenticatedActivationCandidate> };
  withTransaction<T>(context: Context, input: {
    candidateId: string; targetId: string; expectedInventory: WorkspaceInventory; expectedTarget: EmptyTargetInspection;
  }, work: (lease: WorkspaceActivationLease) => Promise<T>): Promise<T>;
  /** Explicit restart/recovery inspection; authenticate current owner and exact issuance/target binding. Never retry or adopt a partial target. */
  readback(context: Context, input: { activationId: string }): Promise<WorkspaceActivationReadback>;
};
export type WorkspaceActivationReview = {
  candidateId: string; reviewedDigest: string; projectionDigest: string; packageDigest: string;
  targetId: string; workspaceId: string; sourceWorkspaceId: string;
  qualification: 'test-fixture' | 'encrypted-local-host';
  liveStores: string[]; inertStores: string[]; facts: number; artifacts: number;
  legacyImportIds: string[]; inertImportIds: string[]; inertSourceRuleIds: string[];
};
export type WorkspaceActivationSummary = {
  activationId: string; candidateId: string; workspaceId: string; targetId: string;
  projectionDigest: string; stateDigest: string; evidenceDigest: string;
  status: 'committed'; qualification: 'test-fixture' | 'encrypted-local-host'; ciphertextBytes: number;
  ownerContext: Context; sessionAuthorityId: string;
};
/** Host exception observations only, never a publication outcome. A commit callback may throw before or after publication. */
export type WorkspaceActivationDiagnosticStage = 'transaction-admission' | 'projection-review' | 'pre-authority-guard'
  | 'authority-allocation' | 'authority-validation' | 'publication-construction' | 'pre-publication-guard'
  | 'commit-callback' | 'immediate-readback' | 'readback-validation' | 'transaction-exit';
const diagnosticErrorCodes = [
  'ACTIVATION_APPLICATION_CHANGED', 'ACTIVATION_AUTHORITY', 'ACTIVATION_CANDIDATE_CHANGED', 'ACTIVATION_COMMIT_UNKNOWN',
  'ACTIVATION_FILE_CUSTODY', 'ACTIVATION_GUARD', 'ACTIVATION_LIVE_CUSTODY', 'ACTIVATION_POSTGRES_CIPHERTEXT_CHANGED',
  'ACTIVATION_POSTGRES_CUSTODY_CHANGED', 'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'ACTIVATION_POSTGRES_SOURCE_CHANGED',
  'ACTIVATION_POSTGRES_UNRESOLVED', 'ACTIVATION_PROJECTION_CHANGED', 'ACTIVATION_READBACK', 'ACTIVATION_ROOT_GUARD',
  'ACTIVATION_SINGLE_USE', 'ACTIVATION_SOURCE_CHANGED', 'ACTIVATION_TARGET_CHANGED', 'BACKUP_ACTIVATION_CUSTODY_CHANGED',
  'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'BACKUP_ACTIVATION_STAGING_UNRESOLVED',
  'BACKUP_FILE_CHANGED', 'BACKUP_INVENTORY_INCOMPLETE', 'BACKUP_LIMIT', 'BACKUP_LOCK_CHANGED', 'BACKUP_SOURCE_CHANGED', 'FORBIDDEN', 'INTERCHANGE_AUTHORITY_CHANGED',
  'INTERCHANGE_NOT_READY', 'INTERCHANGE_READ_SCOPE_REQUIRED', 'INTERCHANGE_REVIEW_CHANGED', 'INTERCHANGE_TARGET_CHANGED',
] as const;
export type WorkspaceActivationDiagnosticErrorCode = typeof diagnosticErrorCodes[number] | 'UNCLASSIFIED';
/** Shared closed sanitization for constructor-only custody diagnostics; never read messages or invoke error getters. */
export function workspaceActivationDiagnosticErrorCode(error: unknown): WorkspaceActivationDiagnosticErrorCode {
  try {
    const field = error instanceof ChausarError ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    return field && 'value' in field && diagnosticErrorCodes.includes(field.value) ? field.value : 'UNCLASSIFIED';
  } catch { return 'UNCLASSIFIED'; }
}
export type WorkspaceActivationDiagnostic = Readonly<{
  format: 'chausar.activation-host-diagnostic.v1'; stage: WorkspaceActivationDiagnosticStage;
  observation: 'exception'; commitAttempted: boolean; errorCode: WorkspaceActivationDiagnosticErrorCode;
}>;
/** Constructor-only telemetry; no context, identifiers, payloads, exception messages or admission result. */
export type WorkspaceActivationDiagnosticOptions = { onDiagnostic(event: WorkspaceActivationDiagnostic): void };
type CheckedCandidate = { candidate: WorkspaceImportCandidate; pin: Extract<WorkspaceInterchangeCustodyPin, { kind: 'candidate' }>; historical: State; read: AuthenticatedActivationCandidate };

const plainId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const custodyId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a: unknown, b: unknown) => canonicalInterchangeJson(a) === canonicalInterchangeJson(b);
const legacyFormats = ['csv', 'bank-csv', 'tally-xml', 'zoho-json', 'shopify-json', 'gst-json'];
const liveStores = ['ontology', 'facts', 'imports', 'conflicts', 'merges', 'tombstones', 'sourceRules'];
const inertStores = ['members', 'policy', 'workspace', 'schemaVersion', 'revision', 'receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts', 'activity', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'];
function assertDictionary(dictionary: Dictionary) {
  check(dictionary && typeof dictionary === 'object' && !Array.isArray(dictionary), 'ACTIVATION_DICTIONARY', 'Active ontology requires a complete published dictionary.');
  const { hash: publishedHash, ...content } = dictionary;
  check(digest(publishedHash) && hash(content) === publishedHash && Number.isSafeInteger(dictionary.version) && dictionary.version > 0
    && plainId(dictionary.publishedBy) && typeof dictionary.publishedAt === 'string' && Number.isFinite(Date.parse(dictionary.publishedAt)),
  'ACTIVATION_DICTIONARY', 'Published dictionary content, revision, author and order-sensitive hash must remain coherent.');
  const draftKeys = ['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'];
  check(Object.keys(dictionary).every(key => [...draftKeys, 'version', 'publishedAt', 'publishedBy', 'hash', 'operations', 'compiledSums', 'schema', 'checks'].includes(key)),
    'ACTIVATION_DICTIONARY', 'Active dictionary records cannot contain undeclared runtime authority.');
  // Retain original draft/definition key order while deriving the supported compiler catalogue.
  const draft = Object.fromEntries(Object.entries(dictionary).filter(([key]) => draftKeys.includes(key))) as DictionaryDraft;
  const compiled = compileDictionary(draft, dictionary.version, dictionary.publishedBy, dictionary.publishedAt);
  check(equal(dictionary.operations, compiled.operations) && equal(dictionary.schema, compiled.schema) && equal(dictionary.checks, compiled.checks)
    && (dictionary.compiledSums === undefined || equal(dictionary.compiledSums, compiled.compiledSums)),
  'ACTIVATION_DICTIONARY', 'Active operations, schema, null rules and compiled sums must derive from the exact published business definitions.');
}
function assertOntology(ontology: State['ontology']) {
  check(ontology && typeof ontology === 'object' && !Array.isArray(ontology), 'ACTIVATION_DICTIONARY', 'Synthetic activation requires a current coherent published ontology.');
  if (Object.hasOwn(ontology, 'current')) {
    exact(ontology, ['current', 'history'], 'ACTIVATION_DICTIONARY');
    check(Array.isArray(ontology.history) && ontology.history.length > 0, 'ACTIVATION_DICTIONARY', 'Preserve the complete published ontology history.');
    const published = ontology as { current: Dictionary; history: Dictionary[] };
    assertDictionary(published.current); published.history.forEach(assertDictionary);
    check(JSON.stringify(published.current) === JSON.stringify(published.history.at(-1))
      && published.history.every((item, index) => index === 0 || item.version > published.history[index - 1].version),
    'ACTIVATION_DICTIONARY', 'Current ontology and ordered publication history must agree exactly.');
  } else assertDictionary(ontology);
}
function exact(value: unknown, keys: string[], code = 'ACTIVATION_SHAPE'): asserts value is Record<string, unknown> {
  canonicalInterchangeJson(value);
  check(value && typeof value === 'object' && !Array.isArray(value) && equal(Object.keys(value).sort(), [...keys].sort()), code, 'The activation fields must match the reviewed format exactly.');
}
async function completed(work: () => Promise<void>) {
  const result: unknown = await work();
  check(result === undefined, 'ACTIVATION_GUARD', 'Trusted activation guards must complete and return no admission value.');
}
function owner(context: Context, state: State) {
  check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Activation requires the current untainted desktop owner.');
  const member = authorize({ read: () => state, update: async () => { throw new Error('Activation inspection is read-only.'); } }, context, 'admin');
  check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Activation requires unrestricted current owner access.');
}
function measured(value: WorkspaceInterchangeCustodyMeasurement) {
  exact(value, ['encrypted', 'archiveCiphertextBytes', 'inventoryPinCiphertextBytes', 'qualification']);
  check(value.encrypted === true && ['test-fixture', 'encrypted-local-host'].includes(value.qualification)
    && [value.archiveCiphertextBytes, value.inventoryPinCiphertextBytes].every(n => Number.isSafeInteger(n) && n > 0),
  'ACTIVATION_CUSTODY', 'Exact candidate and independent pin require authenticated encrypted custody.');
}

/** Isolated orchestration only. No filesystem, Vault, Engine, provider, scheduler or IPC capability. */
export class WorkspaceActivationHost {
  #ports: WorkspaceActivationPorts;
  #policy: WorkspaceActivationPolicy;
  #onDiagnostic?: WorkspaceActivationDiagnosticOptions['onDiagnostic'];
  constructor(ports: WorkspaceActivationPorts, policy: WorkspaceActivationPolicy, diagnostics?: WorkspaceActivationDiagnosticOptions) {
    check(ports && typeof ports.custody?.read === 'function' && typeof ports.withTransaction === 'function' && typeof ports.readback === 'function',
      'ACTIVATION_ROOT_REQUIRED', 'Constructor-only root custody, exclusive transaction and authenticated readback ports are required.');
    exact(policy, ['approvedSyntheticWorkspaceIds', 'allowedSyntheticSourceIds', 'budgets', 'retentionDays']);
    exact(policy.budgets, ['maxCandidateBytes', 'maxArtifactBytes', 'maxArtifacts', 'maxFacts', 'maxRecords']);
    for (const ids of [policy.approvedSyntheticWorkspaceIds, policy.allowedSyntheticSourceIds]) check(Array.isArray(ids) && ids.length > 0
      && ids.every(plainId) && new Set(ids).size === ids.length, 'ACTIVATION_POLICY', 'Declare explicit distinct trusted synthetic workspace and source identities.');
    check(Object.values(policy.budgets).every(n => Number.isSafeInteger(n) && n > 0)
      && Number.isInteger(policy.retentionDays) && policy.retentionDays >= 1 && policy.retentionDays <= 3650,
    'ACTIVATION_POLICY', 'Activation requires explicit positive constructor budgets and bounded retention.');
    if (diagnostics !== undefined) {
      const field = diagnostics && Object.getOwnPropertyDescriptor(diagnostics, 'onDiagnostic');
      check(diagnostics && [Object.prototype, null].includes(Object.getPrototypeOf(diagnostics))
        && Reflect.ownKeys(diagnostics).length === 1 && field?.enumerable && 'value' in field && typeof field.value === 'function',
      'ACTIVATION_ROOT_REQUIRED', 'Diagnostics require one explicit constructor-only callback.');
      this.#onDiagnostic = field.value;
    }
    this.#ports = ports; this.#policy = structuredClone(policy);
  }
  #diagnose(stage: WorkspaceActivationDiagnosticStage, commitAttempted: boolean, error: unknown) {
    if (!this.#onDiagnostic) return;
    try {
      const event: WorkspaceActivationDiagnostic = Object.freeze({ format: 'chausar.activation-host-diagnostic.v1',
        stage, observation: 'exception', commitAttempted, errorCode: workspaceActivationDiagnosticErrorCode(error) });
      const result: unknown = this.#onDiagnostic(event);
      // A mistaken async observer must not create an unhandled rejection or affect custody acknowledgement.
      if (result !== undefined) void Promise.resolve(result).catch(() => {});
    } catch { /* Diagnostic failure cannot change admission, publication, replay or public error semantics. */ }
  }
  #checked(context: Context, candidateId: string, read: AuthenticatedActivationCandidate): CheckedCandidate {
    exact(read, ['content', 'pin', 'measurement']); measured(read.measurement);
    check(typeof read.content === 'string' && Buffer.byteLength(read.content) <= this.#policy.budgets.maxCandidateBytes, 'ACTIVATION_LIMIT', 'The complete candidate exceeds the constructor byte budget.');
    const pin = read.pin;
    exact(pin, ['format', 'recordId', 'creationId', 'contextDigest', 'inventory', 'packageDigest', 'kind', 'candidateDigest', 'target']);
    check(pin.kind === 'candidate' && pin.format === 'chausar.interchange-custody-pin.v1' && custodyId(candidateId)
      && pin.recordId === candidateId && custodyId(pin.creationId) && digest(pin.contextDigest) && digest(pin.packageDigest) && digest(pin.candidateDigest),
    'ACTIVATION_CANDIDATE', 'Activation requires the independently issued exact candidate pin.');
    check(pin.contextDigest === interchangeDigest(context), 'INTERCHANGE_CONTEXT_CHANGED', 'Use the current owner context that issued the candidate.');
    let parsed: unknown;
    try { parsed = JSON.parse(read.content); } catch { throw new ChausarError('ACTIVATION_CANDIDATE', 'Encrypted candidate text is not complete JSON.'); }
    check(canonicalInterchangeJson(parsed) === read.content, 'ACTIVATION_CANDIDATE', 'The retained candidate must be canonical unambiguous JSON.');
    exact(parsed, ['format', 'id', 'inert', 'activation', 'targetId', 'targetWorkspaceId', 'packageDigest', 'sourceInventoryDigest', 'targetProofDigest', 'contextDigest', 'archive']);
    const candidate = parsed as unknown as WorkspaceImportCandidate;
    // Rebuild against the independent pin; payload hashes alone do not establish provenance.
    const rebuilt = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: pin.inventory }), target: () => pin.target,
      assertCompleteRead: (ctx, historical) => owner(ctx, historical),
    }).prepare(context, { text: canonicalInterchangeJson(candidate.archive), targetId: pin.target.targetId });
    check(equal(candidate, rebuilt) && interchangeDigest(candidate) === pin.candidateDigest && candidate.packageDigest === pin.packageDigest,
      'ACTIVATION_CANDIDATE', 'Candidate content differs from its independent issued inventory, target or review pin.');
    check(this.#policy.approvedSyntheticWorkspaceIds.includes(pin.inventory.generation.workspaceId), 'ACTIVATION_SYNTHETIC_ONLY', 'Root has not approved this exact source workspace as a synthetic fixture.');
    const records = pin.inventory.stores.reduce((count, store) => count + store.records, 0);
    check(pin.inventory.artifacts.length <= this.#policy.budgets.maxArtifacts && records <= this.#policy.budgets.maxRecords
      && pin.inventory.artifacts.reduce((bytes, item) => bytes + item.bytes, 0) <= this.#policy.budgets.maxArtifactBytes,
    'ACTIVATION_LIMIT', 'Complete archive inventory exceeds the explicit activation budget.');
    const historical = readHistoricalWorkspaceState(candidate.archive);
    check(historical.facts.length <= this.#policy.budgets.maxFacts, 'ACTIVATION_LIMIT', 'Complete fact history exceeds the explicit activation budget.');
    return { candidate, pin, historical, read: structuredClone(read) };
  }
  #project(historical: State): WorkspaceBusinessProjection {
    assertOntology(historical.ontology);
    const sources = [...new Set(historical.facts.map(f => f.sourceId))];
    check(sources.every(source => this.#policy.allowedSyntheticSourceIds.includes(source)), 'ACTIVATION_SOURCE_PROFILE', 'Every historical fact requires an explicitly approved synthetic source profile.');
    const managed = historical.imports.filter(item => typeof item?.type === 'string' && item.type.startsWith('connector-'));
    check(managed.length === 0, 'ACTIVATION_MANAGED_SOURCE', 'Managed connector history requires fresh profiles and consumer gates; copying never qualifies it for synthetic activation.');
    const legacy = historical.imports.filter(item => item?.format !== undefined);
    for (const item of legacy) {
      check(item.type === undefined && legacyFormats.includes(item.format)
        && Object.keys(item).every(key => ['id', 'sourceId', 'format', 'at', 'recipeHash', 'contentHash', 'rowIds', 'coverage', 'totalsMinor', 'expectedTotals', 'qualification', 'unmappedFields', 'retainedInput'].includes(key))
        && plainId(item.id) && plainId(item.sourceId) && typeof item.at === 'string' && Number.isFinite(Date.parse(item.at))
        && digest(item.recipeHash) && digest(item.contentHash) && Array.isArray(item.rowIds) && item.rowIds.every(plainId)
        && item.coverage && typeof item.coverage === 'object' && typeof item.totalsMinor === 'string' && /^-?\d+$/.test(item.totalsMinor),
      'ACTIVATION_LEGACY_IMPORT', 'Only complete untyped legacy business imports may be activated; mixed runtime bindings or unsupported formats remain unqualified.');
      if (item.retainedInput !== undefined) {
        exact(item.retainedInput, ['version', 'generation', 'input', 'digest'], 'ACTIVATION_LEGACY_IMPORT');
        const retained = item.retainedInput.input;
        check(retained && typeof retained === 'object' && !Array.isArray(retained)
          && Object.keys(retained).every(key => ['sourceId', 'format', 'content', 'recipe', 'expectedTotals', 'installation'].includes(key))
          && item.retainedInput.version === 1 && Number.isSafeInteger(item.retainedInput.generation) && item.retainedInput.generation > 0
          && item.retainedInput.digest === hash(retained) && retained.sourceId === item.sourceId && retained.format === item.format
          && typeof retained.content === 'string' && hash(retained.content) === item.contentHash && retained.recipe
          && typeof retained.recipe === 'object' && hash(retained.recipe) === item.recipeHash,
        'ACTIVATION_LEGACY_IMPORT', 'Original legacy retained input, recipe/content meaning and generation must match their exact ordered semantic pins.');
      }
    }
    const imports = legacy;
    check(imports.every(item => this.#policy.allowedSyntheticSourceIds.includes(item.sourceId)), 'ACTIVATION_SOURCE_PROFILE', 'Every activated legacy import requires an approved synthetic source profile.');
    // Source precedence changes business meaning. Access grants and member scopes remain inert.
    const sourceRules = historical.sourceRules.filter(rule => rule && typeof rule.kind === 'string' && Array.isArray(rule.sourceIds));
    for (const rule of sourceRules) {
      check(Object.keys(rule).every(key => ['id', 'kind', 'sourceIds', 'at', 'by'].includes(key)) && plainId(rule.id)
        && typeof rule.at === 'string' && Number.isFinite(Date.parse(rule.at))
        && rule.sourceIds.every((source: unknown) => plainId(source) && this.#policy.allowedSyntheticSourceIds.includes(source)),
      'ACTIVATION_SOURCE_RULE', 'Historical precedence requires a complete inert business rule without carried access authority.');
    }
    return structuredClone({ format: 'chausar.synthetic-business-projection.v1', workspace: { name: historical.workspace.name, currency: historical.workspace.currency },
      policy: { send: 'nothing', autonomy: false, allowedSources: [...this.#policy.allowedSyntheticSourceIds], retentionDays: this.#policy.retentionDays, sharing: false },
      ontology: historical.ontology, facts: historical.facts, imports, conflicts: historical.conflicts,
      merges: historical.merges, tombstones: historical.tombstones, sourceRules });
  }
  async #transaction<T>(context: Context, checked: CheckedCandidate, work: (lease: WorkspaceActivationLease, projection: WorkspaceBusinessProjection, current: () => Promise<void>) => Promise<T>): Promise<T> {
    let calls = 0;
    const result = await this.#ports.withTransaction(structuredClone(context), { candidateId: checked.pin.recordId, targetId: checked.pin.target.targetId,
      expectedInventory: structuredClone(checked.pin.inventory), expectedTarget: structuredClone(checked.pin.target) }, async lease => {
      check(++calls === 1 && lease?.source && typeof lease.source.assertCurrent === 'function' && typeof lease.source.assertCompleteOwner === 'function'
        && typeof lease.assertCurrent === 'function' && typeof lease.readCandidate === 'function' && typeof lease.allocateAuthority === 'function'
        && typeof lease.commit === 'function' && typeof lease.readback === 'function', 'ACTIVATION_ROOT_REQUIRED', 'Root must issue exactly one complete held activation transaction.');
      check(lease.source.ready === true, 'INTERCHANGE_NOT_READY', 'Complete current source and consumer inventory is not ready.');
      const state = structuredClone(lease.source.state); owner(context, state);
      const historicalCapture = lease.source.authenticatedHistoricalCapture;
      const capture = historicalCapture
        ? captureWorkspaceInterchange(structuredClone(historicalCapture.state), structuredClone(historicalCapture.artifacts))
        : captureWorkspaceInterchange(state, structuredClone(lease.source.artifacts));
      check(equal(capture.inventory, checked.pin.inventory), 'INTERCHANGE_AUTHORITY_CHANGED', 'Current independent source inventory differs from candidate issuance.');
      check(equal(lease.target, checked.pin.target), 'INTERCHANGE_TARGET_CHANGED', 'Actual reserved physical target proof or generation changed.');
      proveEmptyWorkspaceTarget(lease.target);
      const sourceIds = [...new Set([...checked.historical.facts.map(f => f.sourceId), ...checked.historical.imports.map(item => item?.sourceId).filter((value): value is string => typeof value === 'string')])];
      assertSourceAccess(state, context, sourceIds);
      check(checked.historical.facts.every(f => canSeeFact({ read: () => state, update: async () => { throw new Error('Inspection is read-only.'); } }, context, f)),
        'INTERCHANGE_READ_SCOPE_REQUIRED', 'Current owner must have access to every retained historical row.');
      const current = async () => {
        await completed(() => lease.source.assertCompleteOwner(structuredClone(context), structuredClone(checked.historical)));
        // The complete transaction guard includes current source custody,
        // candidate issuance and the empty target under the same held locks.
        await completed(() => lease.assertCurrent());
        const reread = this.#checked(context, checked.pin.recordId, await lease.readCandidate());
        check(equal(reread.read, checked.read), 'INTERCHANGE_REVIEW_CHANGED', 'Exact authenticated candidate or independent issuance changed during activation.');
      };
      await current(); const projection = this.#project(checked.historical); await current();
      return work(lease, projection, current);
    });
    check(calls === 1, 'ACTIVATION_ROOT_REQUIRED', 'Root did not execute the exclusive activation callback.'); return result;
  }
  #authority(value: WorkspaceActivationAuthority, historical: State, target: EmptyTargetInspection) {
    exact(value, ['workspaceId', 'owner', 'context', 'sessionAuthorityId', 'createdAt']);
    exact(value.owner, ['id', 'name', 'role', 'active', 'epoch', 'branches']);
    exact(value.context, ['memberId', 'role', 'epoch', 'channel']);
    check(value.workspaceId === target.workspaceId && value.workspaceId !== historical.workspace.id && plainId(value.sessionAuthorityId)
      && !historical.sessions.some(session => session?.id === value.sessionAuthorityId || session?.token === value.sessionAuthorityId)
      && plainId(value.owner.id) && !historical.members.some(member => member.id === value.owner.id)
      && value.owner.role === 'owner' && value.owner.active === true && typeof value.owner.name === 'string' && value.owner.name.length > 0
      && Number.isSafeInteger(value.owner.epoch) && value.owner.epoch > 0 && equal(value.owner.branches, ['*'])
      && equal(value.context, { memberId: value.owner.id, role: 'owner', epoch: value.owner.epoch, channel: 'desktop' })
      && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)),
    'ACTIVATION_AUTHORITY', 'Root must allocate a distinct workspace with a fresh unrestricted owner and independent current desktop session authority.');
  }
  #state(projection: WorkspaceBusinessProjection, authority: WorkspaceActivationAuthority): State {
    return { schemaVersion: 1, revision: 0,
      workspace: { id: authority.workspaceId, ...structuredClone(projection.workspace), demo: true, createdAt: authority.createdAt },
      members: [structuredClone(authority.owner)],
      policy: structuredClone(projection.policy),
      ontology: structuredClone(projection.ontology), facts: structuredClone(projection.facts), imports: structuredClone(projection.imports),
      conflicts: structuredClone(projection.conflicts), merges: structuredClone(projection.merges), tombstones: structuredClone(projection.tombstones), sourceRules: structuredClone(projection.sourceRules),
      receipts: [], answers: [], decisions: [], actions: [], jobs: [], learning: [], plugins: [], modelReceipts: [], activity: [], conversations: [], routes: [], sessions: [], unsupported: [], schedules: [] };
  }
  async review(contextInput: Context, input: { candidateId: string; reviewedDigest: string }): Promise<WorkspaceActivationReview> {
    exact(input, ['candidateId', 'reviewedDigest']); const context = structuredClone(contextInput);
    const checked = this.#checked(context, input.candidateId, await this.#ports.custody.read(structuredClone(context), input.candidateId));
    check(input.reviewedDigest === checked.pin.candidateDigest, 'INTERCHANGE_REVIEW_CHANGED', 'Acknowledge the exact candidate review digest.');
    return this.#transaction(context, checked, async (_lease, projection, current) => {
      await current();
      return { candidateId: checked.pin.recordId, reviewedDigest: checked.pin.candidateDigest, projectionDigest: interchangeDigest(projection),
        packageDigest: checked.pin.packageDigest, targetId: checked.pin.target.targetId, workspaceId: checked.pin.target.workspaceId,
        sourceWorkspaceId: checked.pin.inventory.generation.workspaceId, qualification: checked.read.measurement.qualification,
        liveStores: [...liveStores], inertStores: [...inertStores], facts: projection.facts.length, artifacts: checked.pin.inventory.artifacts.length,
        legacyImportIds: projection.imports.map(item => item.id), inertImportIds: checked.historical.imports.filter(item => !legacyFormats.includes(item?.format)).map(item => item.id),
        inertSourceRuleIds: checked.historical.sourceRules.filter(rule => !projection.sourceRules.some(active => equal(rule, active))).map(rule => rule.id) };
    });
  }
  #readback(value: WorkspaceActivationReadback, activationId: string, context: Context, expected?: WorkspaceActivationCommit): WorkspaceActivationSummary {
    check(value?.status === 'committed', 'ACTIVATION_COMMIT_UNKNOWN', 'No exact authenticated committed target is established. Inspect this activation explicitly; do not retry or overwrite.');
    check(value.encrypted === true && Number.isSafeInteger(value.ciphertextBytes) && value.ciphertextBytes > 0
      && ['test-fixture', 'encrypted-local-host'].includes(value.qualification), 'ACTIVATION_READBACK', 'Target authority and complete evidence require measured authenticated encrypted readback.');
    const { record, state, evidence, authority } = value;
    exact(record, ['format', 'status', 'activationId', 'candidateId', 'candidateCreationId', 'candidateDigest', 'pinDigest', 'contextDigest', 'sourceInventoryDigest', 'targetProofDigest', 'targetId', 'workspaceId', 'projectionDigest', 'authorityDigest', 'stateDigest', 'evidenceDigest']);
    exact(evidence, ['format', 'inert', 'content', 'pin']);
    check(record.format === 'chausar.workspace-activation.v1' && record.status === 'committed' && record.activationId === activationId
      && evidence.format === 'chausar.workspace-activation-evidence.v1' && evidence.inert === true
      && record.stateDigest === hash(state) && record.evidenceDigest === interchangeDigest(evidence)
      && record.authorityDigest === interchangeDigest(authority) && record.pinDigest === interchangeDigest(evidence.pin),
    'ACTIVATION_READBACK', 'Authenticated target, complete inert evidence or authority differs from the committed activation binding.');
    const checked = this.#checked(context, record.candidateId, { content: evidence.content, pin: evidence.pin,
      measurement: { encrypted: true, archiveCiphertextBytes: value.ciphertextBytes, inventoryPinCiphertextBytes: value.ciphertextBytes, qualification: value.qualification } });
    this.#authority(authority, checked.historical, checked.pin.target);
    const projection = this.#project(checked.historical);
    check(record.candidateCreationId === checked.pin.creationId && record.candidateDigest === checked.pin.candidateDigest
      && record.contextDigest === interchangeDigest(context) && record.sourceInventoryDigest === interchangeDigest(checked.pin.inventory)
      && record.targetProofDigest === proveEmptyWorkspaceTarget(checked.pin.target) && record.targetId === checked.pin.target.targetId
      && record.workspaceId === checked.pin.target.workspaceId && record.projectionDigest === interchangeDigest(projection)
      && JSON.stringify(state) === JSON.stringify(this.#state(projection, authority)),
    'ACTIVATION_READBACK', 'Restart readback must retain the exact issued target, reviewed business projection and fresh bootstrap authority.');
    check(!expected || equal({ record, state, evidence, authority }, expected), 'ACTIVATION_READBACK', 'Target readback differs from the exact one-time reviewed publication.');
    return { activationId, candidateId: record.candidateId, workspaceId: record.workspaceId, targetId: record.targetId,
      projectionDigest: record.projectionDigest, stateDigest: record.stateDigest, evidenceDigest: record.evidenceDigest,
      status: 'committed', qualification: value.qualification, ciphertextBytes: value.ciphertextBytes,
      ownerContext: structuredClone(authority.context), sessionAuthorityId: authority.sessionAuthorityId };
  }
  async activate(contextInput: Context, input: { candidateId: string; reviewedDigest: string; projectionDigest: string; activationId: string; confirmed: true }): Promise<WorkspaceActivationSummary> {
    exact(input, ['candidateId', 'reviewedDigest', 'projectionDigest', 'activationId', 'confirmed']);
    check(input.confirmed === true && custodyId(input.activationId) && digest(input.projectionDigest), 'CONFIRMATION_REQUIRED', 'Confirm one exact reviewed business projection and a single-use activation identity.');
    const context = structuredClone(contextInput), payload = structuredClone(input);
    const checked = this.#checked(context, payload.candidateId, await this.#ports.custody.read(structuredClone(context), payload.candidateId));
    check(payload.reviewedDigest === checked.pin.candidateDigest, 'INTERCHANGE_REVIEW_CHANGED', 'Acknowledge the exact independently issued candidate review digest.');
    let commitAttempted = false, stage: WorkspaceActivationDiagnosticStage = 'transaction-admission';
    try {
      return await this.#transaction(context, checked, async (lease, projection, current) => {
        stage = 'projection-review';
        check(interchangeDigest(projection) === payload.projectionDigest, 'ACTIVATION_PROJECTION_CHANGED', 'Acknowledge the exact business projection and inert dispositions from review.');
        stage = 'pre-authority-guard'; await current();
        stage = 'authority-allocation'; const authority = structuredClone(await lease.allocateAuthority());
        stage = 'authority-validation'; this.#authority(authority, checked.historical, checked.pin.target);
        stage = 'publication-construction';
        const state = this.#state(projection, authority);
        const evidence: WorkspaceActivationEvidence = { format: 'chausar.workspace-activation-evidence.v1', inert: true, content: checked.read.content, pin: structuredClone(checked.pin) };
        const record: WorkspaceActivationRecord = { format: 'chausar.workspace-activation.v1', status: 'committed', activationId: payload.activationId,
          candidateId: checked.pin.recordId, candidateCreationId: checked.pin.creationId, candidateDigest: checked.pin.candidateDigest, pinDigest: interchangeDigest(checked.pin),
          contextDigest: interchangeDigest(context), sourceInventoryDigest: interchangeDigest(checked.pin.inventory), targetProofDigest: proveEmptyWorkspaceTarget(checked.pin.target),
          targetId: checked.pin.target.targetId, workspaceId: state.workspace.id, projectionDigest: payload.projectionDigest,
          authorityDigest: interchangeDigest(authority), stateDigest: hash(state), evidenceDigest: interchangeDigest(evidence) };
        const publication: WorkspaceActivationCommit = { record, state, evidence, authority };
        stage = 'pre-publication-guard'; await current(); commitAttempted = true;
        stage = 'commit-callback';
        await completed(() => lease.commit(structuredClone(publication)));
        stage = 'immediate-readback'; const value = await lease.readback();
        stage = 'readback-validation'; const summary = this.#readback(value, payload.activationId, context, publication);
        stage = 'transaction-exit'; return summary;
      });
    } catch (error) {
      this.#diagnose(stage, commitAttempted, error);
      if (commitAttempted) throw new ChausarError('ACTIVATION_COMMIT_UNKNOWN', `Activation ${payload.activationId} attempted publication but exact commit acknowledgement is unavailable. Use explicit readback; do not retry or overwrite.`);
      throw error;
    }
  }
  /** Inspection only, including after restart or a lost commit acknowledgement. */
  async resolve(contextInput: Context, input: { activationId: string }): Promise<WorkspaceActivationSummary | Exclude<WorkspaceActivationReadback, { status: 'committed' }>> {
    exact(input, ['activationId']); check(custodyId(input.activationId), 'ACTIVATION_SHAPE', 'Inspect one explicit activation identity.');
    const value = await this.#ports.readback(structuredClone(contextInput), structuredClone(input));
    if (value?.status !== 'committed') {
      exact(value, ['status', 'activationId', 'reasonCode']);
      check(['failed', 'unknown'].includes(value.status) && value.activationId === input.activationId && plainId(value.reasonCode), 'ACTIVATION_READBACK', 'Root recovery must retain the exact unresolved activation identity.');
      return structuredClone(value);
    }
    return this.#readback(value, input.activationId, structuredClone(contextInput));
  }
}
