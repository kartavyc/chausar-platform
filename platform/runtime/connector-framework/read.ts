import { createHash } from 'node:crypto';
import { digest as canonicalDigest } from '../actions.ts';
import { check } from '../contracts.ts';
import { validatePeriod } from '../memory.ts';
import { connectorOperationKey } from './registry.ts';
import type { ConnectorCapabilityRegistry, ConnectorOperationScope } from './registry.ts';

/** These contracts extract data only. Parsing and every business calculation belong to the typed importer/engine. */
export type ReadAuthorityScope = Readonly<{ tenantId: string; sourceId: string; organizationId?: string; companyId?: string }>;
export type ReadDataScope = Readonly<{ company: string; dataset: string; branches: readonly string[]; period?: Readonly<{ from: string; to: string }> }>;
export type ReadEnvironment = 'synthetic' | 'sandbox' | 'live';
export type ReadQualification = 'synthetic-tested' | 'sandbox-verified' | 'live-verified';
export type ReadCursor = Readonly<{ kind: 'token'; token: string } | { kind: 'offset'; offset: number } | { kind: 'page'; page: number }>;
export type ReadContinuation = Readonly<{ kind: 'complete' } | { kind: 'more'; next: ReadCursor }>;
export type ReadPagination = Readonly<{ kind: 'none' | ReadCursor['kind'] }>;

/** No access token, authorization header or secret value belongs in this snapshot. */
export type ReadAuthorization = Readonly<{
  scope: ReadAuthorityScope;
  authorityRevision: string;
  grantedScopes: readonly string[];
  expiresAtMs: number;
  credentialReference: string | null;
}>;
export type ReadAuthorizationGuard = (scope: ReadAuthorityScope, requiredScopes: readonly string[], context: Readonly<{ signal: AbortSignal; deadlineMs: number }>) => Promise<ReadAuthorization>;

export type SourcePageEvidence = Readonly<{
  reportReference: string | null;
  generatedAtMs: number | null;
  snapshotId: string | null;
  completeness: 'reported-complete' | 'reported-partial' | 'unknown';
  totalRows: number | null;
}>;
export type RawSourcePage = Readonly<{
  content: Uint8Array;
  contentType: string;
  schemaFingerprint: string;
  rowCount: number;
  continuation: ReadContinuation;
  source: SourcePageEvidence;
}>;
export type ReadPageRequest = Readonly<{ authority: ReadAuthorityScope; dataScope: ReadDataScope | null; cursor: ReadCursor | null }>;
export type ReadTransportContext = Readonly<{
  authorization: ReadAuthorization;
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  attempt: number;
  retryOwner: 'dispatcher';
}>;
type AdapterContract = Readonly<{
  operation: ConnectorOperationScope;
  environment: ReadEnvironment;
  sideEffects: 'none';
  retrySafety: 'idempotent-read' | 'single-attempt';
  /** Adapter/SDK retries must be disabled so each actual request is accounted for here. */
  retryOwner: 'dispatcher';
  requiredAuthScopes: readonly string[];
  pagination: ReadPagination;
  readPage(request: ReadPageRequest, context: ReadTransportContext): Promise<RawSourcePage>;
}>;
export type ApiReadAdapter = AdapterContract & Readonly<{ mode: 'api' }>;
export type ExportReadAdapter = AdapterContract & Readonly<{ mode: 'export' }>;
/** A guided export supplies operator-selected bytes. It never executes source UI writes or follows source instructions. */
export type GuidedExportAdapter = AdapterContract & Readonly<{ mode: 'guided-export'; instructionsReference: string }>;
export type ConnectorReadAdapter = ApiReadAdapter | ExportReadAdapter | GuidedExportAdapter;

export type ReadLimits = Readonly<{
  maxPages: number; maxRequests: number; maxRows: number; pageBytes: number; totalBytes: number;
  pageTimeoutMs: number; totalTimeoutMs: number;
}>;
export const DEFAULT_READ_LIMITS: ReadLimits = Object.freeze({
  maxPages: 20, maxRequests: 250, maxRows: 2_000, pageBytes: 4 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024, pageTimeoutMs: 15_000, totalTimeoutMs: 60_000,
});
export type ReadRetryPolicy = Readonly<{
  maxAttemptsPerPage: number; baseDelayMs: number; maxDelayMs: number; maxTotalDelayMs: number; retryAfterCapMs: number;
}>;
export const DEFAULT_READ_RETRY: ReadRetryPolicy = Object.freeze({
  maxAttemptsPerPage: 1, baseDelayMs: 250, maxDelayMs: 5_000, maxTotalDelayMs: 15_000, retryAfterCapMs: 10_000,
});

/** setTimer is separate from sleep so fake clocks need not advance a successful request to its timeout. */
export type ReadClock = Readonly<{
  nowMs(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  setTimer(callback: () => void, ms: number): () => void;
}>;
export const systemReadClock: ReadClock = Object.freeze({
  nowMs: () => Date.now(),
  setTimer: (callback: () => void, ms: number) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
  sleep: (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new ReadTransportError('cancelled')); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new ReadTransportError('cancelled')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  }),
});

export type ReadTransportFailure = 'rate-limited' | 'temporarily-unavailable' | 'network-unavailable' | 'timed-out'
  | 'authentication-expired' | 'permission-denied' | 'invalid-request' | 'unsupported' | 'cancelled' | 'unknown';
/** Only this closed classification may retry. Arbitrary errors and response text never become receipt messages. */
export class ReadTransportError extends Error {
  readonly kind: ReadTransportFailure;
  readonly retryAfterMs: number | null;
  readonly cleanup: 'settled' | 'abort-requested';
  /** Count payload bytes read before classifying failure. Zero means no failure payload was read. */
  readonly receivedBytes: number;
  constructor(kind: ReadTransportFailure, retryAfterMs: number | null = null, cleanup: 'settled' | 'abort-requested' = 'settled', receivedBytes = 0) {
    super('The read transport failed.'); this.name = 'ReadTransportError'; this.kind = kind; this.retryAfterMs = retryAfterMs; this.cleanup = cleanup; this.receivedBytes = receivedBytes;
  }
}
export type ReadAttemptEvidence = Readonly<{
  page: number; attempt: number; startedAtMs: number; finishedAtMs: number;
  outcome: 'succeeded' | ReadTransportFailure; delayBeforeNextMs: number | null;
}>;
export type RawReadProvenance = Readonly<{
  operationKey: string; authorityScopeHash: string; dataScopeHash: string | null; capturedAtMs: number; contentSha256: string; byteLength: number;
  contentType: string; schemaFingerprint: string; source: SourcePageEvidence;
}>;
export type CapturedReadPage = Readonly<{ content: Uint8Array; fromCursor: ReadCursor | null; continuation: ReadContinuation; rowCount: number; provenance: RawReadProvenance }>;
export type ReadCompleteness = Readonly<{
  pagination: 'complete'; source: 'reported-complete' | 'unknown'; expectedRows: number | null; actualRows: number;
  sourceTotalMatches: boolean | null; snapshot: 'same-declared-snapshot' | 'unverified'; independentReconciliation: 'required';
}>;
export type ReadFreshness = Readonly<{
  retrievedAtMs: number; oldestSourceGeneratedAtMs: number | null; maximumAgeMs: number;
  state: 'current' | 'stale' | 'unknown'; reason: 'within-policy' | 'older-than-policy' | 'source-time-missing' | 'source-clock-ahead';
}>;
export type ReadReceipt = Readonly<{
  operationKey: string; authorityScopeHash: string; dataScopeHash: string | null; environment: ReadEnvironment; minimumQualification: ReadQualification;
  startedAtMs: number; finishedAtMs: number; requests: number; pages: number; rows: number; bytes: number;
  discardedBytes: number; transportBytes: number;
  attempts: readonly ReadAttemptEvidence[]; contentHashes: readonly string[];
  outcome: 'complete' | 'refused'; failureCode: string | null;
  cleanup: 'settled' | 'abort-requested';
  qualification: Readonly<{ definitionDigest: string; evidenceDigest: string; digest: string; evidenceIds: readonly string[] }> | null;
}>;
export type ConnectorReadResult = Readonly<{
  pages: readonly CapturedReadPage[]; completeness: ReadCompleteness; freshness: ReadFreshness;
  schema: Readonly<{ state: 'stable' | 'changed'; fingerprints: readonly string[] }>; receipt: ReadReceipt;
}>;
export class ConnectorReadError extends Error {
  readonly code: string;
  readonly receipt: ReadReceipt;
  constructor(code: string, receipt: ReadReceipt) { super('The connector read was refused.'); this.name = 'ConnectorReadError'; this.code = code; this.receipt = receipt; }
}
export type ConnectorReadRequest = Readonly<{
  operation: ConnectorOperationScope; authority: ReadAuthorityScope; dataScope?: ReadDataScope; environment: ReadEnvironment;
  limits?: Partial<ReadLimits>; retry?: Partial<ReadRetryPolicy>; maximumSourceAgeMs?: number; signal?: AbortSignal;
}>;
export type ConnectorReadDependencies = Readonly<{
  registry: Pick<ConnectorCapabilityRegistry, 'assertCanUse' | 'assertCapability'>;
  authorize: ReadAuthorizationGuard;
  clock?: ReadClock;
}>;

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const cursorKey = (cursor: ReadCursor | null) => JSON.stringify(cursor);
const scopeKey = (scope: ReadAuthorityScope) => JSON.stringify([scope.tenantId, scope.sourceId, scope.organizationId ?? null, scope.companyId ?? null]);
export const readAuthorityScopeHash = (scope: ReadAuthorityScope): string => digest(scopeKey(scope));
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const exact = (value: unknown, keys: readonly string[]): boolean => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  && keys.length === Object.keys(value).length && keys.every(key => Object.hasOwn(value, key));
const qualified: Record<ReadEnvironment, ReadQualification> = { synthetic: 'synthetic-tested', sandbox: 'sandbox-verified', live: 'live-verified' };
const retryable = new Set<ReadTransportFailure>(['rate-limited', 'temporarily-unavailable', 'network-unavailable', 'timed-out']);
const resultSeal = (result: ConnectorReadResult) => canonicalDigest({ receipt: result.receipt, completeness: result.completeness,
  freshness: result.freshness, schema: result.schema, pages: result.pages.map(page => ({ contentSha256: digest(page.content),
    fromCursor: page.fromCursor, continuation: page.continuation, rowCount: page.rowCount, provenance: page.provenance })) });

/** No default adapter, endpoint, credential acquisition, network call or external write exists in this dispatcher. */
export class ConnectorReadDispatcher {
  readonly #dependencies: ConnectorReadDependencies;
  readonly #issuedResults = new WeakMap<ConnectorReadResult, { seal: string; maxPages: number; maxBytes: number; pageBytes: number }>();
  constructor(dependencies: ConnectorReadDependencies) { this.#dependencies = dependencies; }

  /** Trusted in-process custody. Caller-constructed or serialized DTOs require an independent persisted verifier. */
  assertIssuedResult(result: ConnectorReadResult): void {
    const issued = this.#issuedResults.get(result);
    check(issued, 'READ_RESULT_NOT_ISSUED', 'This read result was not issued by the trusted reader.');
    check(Array.isArray(result.pages) && result.pages.length <= issued.maxPages, 'READ_RESULT_CHANGED', 'The issued read result changed.');
    let bytes = 0;
    for (const page of result.pages) {
      check(page.content instanceof Uint8Array && page.content.byteLength <= issued.pageBytes, 'READ_RESULT_CHANGED', 'The issued read result changed.');
      bytes += page.content.byteLength;
    }
    check(bytes <= issued.maxBytes, 'READ_RESULT_CHANGED', 'The issued read result changed.');
    let seal: string;
    try { seal = resultSeal(result); } catch { check(false, 'READ_RESULT_CHANGED', 'The issued read result changed.'); }
    check(seal! === issued.seal, 'READ_RESULT_CHANGED', 'The issued read result changed.');
  }

  async read(input: ConnectorReadRequest, adapter: ConnectorReadAdapter): Promise<ConnectorReadResult> {
    const operation = structuredClone(input.operation), authority = structuredClone(input.authority), dataScope = structuredClone(input.dataScope ?? null);
    const operationKey = connectorOperationKey(operation), authorityScopeHash = readAuthorityScopeHash(authority), dataScopeHash = dataScope === null ? null : canonicalDigest(dataScope);
    const clock = this.#dependencies.clock ?? systemReadClock;
    let lastTime = clock.nowMs();
    const time = () => { const value = clock.nowMs(); if (!integer(value, 0, 8_640_000_000_000_000) || value < lastTime) throw new Error('READ_CLOCK_INVALID'); lastTime = value; return value; };
    const startedAtMs = lastTime, minimumQualification = qualified[input.environment];
    let requests = 0, rows = 0, bytes = 0, discardedBytes = 0, delayedMs = 0, cleanup: ReadReceipt['cleanup'] = 'settled';
    let qualification: ReadReceipt['qualification'] = null;
    const pages: CapturedReadPage[] = [], attempts: ReadAttemptEvidence[] = [];
    const receipt = (code: string | null): ReadReceipt => Object.freeze({ operationKey, authorityScopeHash, dataScopeHash, environment: input.environment, minimumQualification,
      startedAtMs, finishedAtMs: lastTime, requests, pages: pages.length, rows, bytes, discardedBytes, transportBytes: bytes + discardedBytes,
      attempts: attempts.map(item => Object.freeze({ ...item })), contentHashes: pages.map(page => page.provenance.contentSha256),
      outcome: code ? 'refused' : 'complete', failureCode: code, cleanup, qualification });
    const refuse = (code: string): never => { throw new ConnectorReadError(code, receipt(code)); };
    const require = (condition: unknown, code: string): void => { if (!condition) refuse(code); };
    const limits = { ...DEFAULT_READ_LIMITS, ...input.limits }, retry = { ...DEFAULT_READ_RETRY, ...input.retry };
    const maxAge = input.maximumSourceAgeMs ?? 24 * 60 * 60 * 1_000;
    require(integer(startedAtMs, 0, 8_640_000_000_000_000), 'READ_CLOCK_INVALID');
    require(Object.keys(authority).every(key => ['tenantId', 'sourceId', 'organizationId', 'companyId'].includes(key))
      && safeId(authority.tenantId) && safeId(authority.sourceId)
      && (authority.organizationId === undefined || safeId(authority.organizationId)) && (authority.companyId === undefined || safeId(authority.companyId)), 'READ_SCOPE_INVALID');
    if (dataScope !== null) {
      const bounded = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
      require(Object.keys(dataScope).every(key => ['company', 'dataset', 'branches', 'period'].includes(key)) && bounded(dataScope.company) && bounded(dataScope.dataset)
        && Array.isArray(dataScope.branches) && dataScope.branches.length > 0 && dataScope.branches.every(bounded)
        && new Set(dataScope.branches).size === dataScope.branches.length, 'READ_DATA_SCOPE_INVALID');
      try { validatePeriod(dataScope.period); } catch { refuse('READ_DATA_SCOPE_INVALID'); }
    }
    require(minimumQualification && adapter.environment === input.environment, 'READ_ENVIRONMENT_MISMATCH');
    require(operationKey === connectorOperationKey(adapter.operation), 'READ_OPERATION_MISMATCH');
    const modeBinding = { api: ['read', 'api'], export: ['export', 'file'], 'guided-export': ['guided-export', 'guided-ui'] } as const;
    require(operation.kind === modeBinding[adapter.mode]?.[0] && operation.transport === modeBinding[adapter.mode]?.[1]
      && adapter.sideEffects === 'none' && adapter.retryOwner === 'dispatcher', 'READ_CAPABILITY_REQUIRED');
    require(['none', 'token', 'offset', 'page'].includes(adapter.pagination.kind)
      && adapter.requiredAuthScopes.every(safeId) && new Set(adapter.requiredAuthScopes).size === adapter.requiredAuthScopes.length, 'READ_ADAPTER_INVALID');
    const requiredAuthScopes = [...adapter.requiredAuthScopes];
    for (const key of Object.keys(DEFAULT_READ_LIMITS) as Array<keyof ReadLimits>) require(integer(limits[key], 1, DEFAULT_READ_LIMITS[key]), 'READ_LIMIT_INVALID');
    require(limits.pageBytes <= limits.totalBytes && limits.pageTimeoutMs <= limits.totalTimeoutMs, 'READ_LIMIT_INVALID');
    require(integer(retry.maxAttemptsPerPage, 1, 5) && integer(retry.baseDelayMs, 1, 5_000)
      && integer(retry.maxDelayMs, retry.baseDelayMs, 10_000) && integer(retry.maxTotalDelayMs, 0, 30_000)
      && integer(retry.retryAfterCapMs, 0, 30_000) && integer(maxAge, 0, 31_536_000_000), 'READ_RETRY_POLICY_INVALID');
    require(retry.maxAttemptsPerPage === 1 || adapter.retrySafety === 'idempotent-read', 'READ_RETRY_UNQUALIFIED');
    const deadline = startedAtMs + limits.totalTimeoutMs;
    const checkBudget = () => { require(!input.signal?.aborted, 'READ_CANCELLED'); require(time() < deadline, 'READ_DEADLINE_EXCEEDED'); };
    const assertCapability = () => {
      const at = new Date(time()).toISOString();
      try {
        const current = this.#dependencies.registry.assertCanUse(operation, at, minimumQualification);
        require(qualification === null || qualification.digest === current.digest, 'READ_QUALIFICATION_CHANGED');
        qualification = Object.freeze({ definitionDigest: current.definitionDigest, evidenceDigest: current.evidenceDigest, digest: current.digest, evidenceIds: Object.freeze([...current.evidenceIds]) });
        for (const capability of ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness'] as const)
          this.#dependencies.registry.assertCapability(operation, capability, at, minimumQualification);
        if (adapter.pagination.kind !== 'none') this.#dependencies.registry.assertCapability(operation, 'pagination', at, minimumQualification);
        if (retry.maxAttemptsPerPage > 1) this.#dependencies.registry.assertCapability(operation, 'rate-limit-backoff', at, minimumQualification);
      } catch (error) { if (error instanceof ConnectorReadError) throw error; refuse('READ_CAPABILITY_UNQUALIFIED'); }
      require(operationKey === connectorOperationKey(adapter.operation), 'READ_OPERATION_MISMATCH');
    };
    const within = <T>(execute: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> => new Promise((resolve, reject) => {
      const controller = new AbortController(); let settled = false;
      const finish = (failure: unknown, value?: T) => {
        if (settled) return; settled = true; cancelTimer(); input.signal?.removeEventListener('abort', abort);
        if (failure) reject(failure); else resolve(value!);
      };
      const abort = () => { cleanup = 'abort-requested'; controller.abort(); finish(new ReadTransportError('cancelled', null, 'abort-requested')); };
      const cancelTimer = clock.setTimer(() => { cleanup = 'abort-requested'; controller.abort(); finish(new ReadTransportError('timed-out', null, 'abort-requested')); }, timeoutMs);
      input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) { abort(); return; }
      Promise.resolve().then(() => execute(controller.signal)).then(value => finish(null, value), error => finish(error));
    });
    let authorityRevision: string | null = null;
    let credentialReference: string | null | undefined;
    const authorize = async (): Promise<ReadAuthorization> => {
      checkBudget(); assertCapability();
      let authorization: ReadAuthorization;
      try { authorization = await within(signal => this.#dependencies.authorize(structuredClone(authority), [...requiredAuthScopes], { signal, deadlineMs: deadline }), Math.min(limits.pageTimeoutMs, deadline - time())); }
      catch (error) { refuse(error instanceof ReadTransportError && error.kind === 'timed-out' ? 'READ_AUTHORIZATION_TIMEOUT' : input.signal?.aborted ? 'READ_CANCELLED' : 'READ_AUTHORIZATION_FAILED'); }
      checkBudget();
      assertCapability();
      require(scopeKey(authorization!.scope) === scopeKey(authority) && safeId(authorization!.authorityRevision), 'READ_AUTHORIZATION_SCOPE_MISMATCH');
      require(integer(authorization!.expiresAtMs, 0, 8_640_000_000_000_000) && authorization!.expiresAtMs > time(), 'READ_AUTHENTICATION_EXPIRED');
      require(requiredAuthScopes.every(scope => authorization!.grantedScopes.includes(scope)), 'READ_AUTHORIZATION_SCOPE_MISSING');
      require(authorization!.credentialReference === null || boundedText(authorization!.credentialReference, 256), 'READ_CREDENTIAL_REFERENCE_INVALID');
      require(credentialReference === undefined || credentialReference === authorization!.credentialReference, 'READ_CREDENTIAL_CHANGED');
      require(authorityRevision === null || authorization!.authorityRevision === authorityRevision, 'READ_AUTHORITY_CHANGED');
      authorityRevision = authorization!.authorityRevision;
      credentialReference = authorization!.credentialReference;
      return { scope: structuredClone(authority), authorityRevision: authorization!.authorityRevision,
        grantedScopes: [...authorization!.grantedScopes], expiresAtMs: authorization!.expiresAtMs, credentialReference: authorization!.credentialReference };
    };
    const invoke = (request: ReadPageRequest, authorization: ReadAuthorization, attempt: number, timeoutMs: number): Promise<RawSourcePage> => within(signal =>
      adapter.readPage(request, { authorization, signal, timeoutMs, maxBytes: Math.min(limits.pageBytes, limits.totalBytes - bytes - discardedBytes), attempt, retryOwner: 'dispatcher' }), timeoutMs);
    const seen = new Set<string>([cursorKey(null)]); let cursor: ReadCursor | null = null;
    let expectedRows: number | null = null, allReportedComplete = true, allSnapshotsPresent = true, snapshotId: string | null = null;
    let allTimesPresent = true, sourceClockAhead = false, oldestGeneratedAt: number | null = null;
    try {
      while (true) {
        require(pages.length < limits.maxPages, 'READ_PAGE_LIMIT');
        let page: RawSourcePage | undefined;
        for (let attempt = 1; attempt <= retry.maxAttemptsPerPage; attempt++) {
          const before = await authorize();
          require(requests < limits.maxRequests && bytes + discardedBytes < limits.totalBytes, 'READ_REQUEST_LIMIT');
          const attemptStart = time(); requests++;
          let failure: ReadTransportError | null = null, rawPage: RawSourcePage | undefined;
          try { rawPage = await invoke({ authority: structuredClone(authority), dataScope: structuredClone(dataScope), cursor: structuredClone(cursor) }, before, attempt, Math.min(limits.pageTimeoutMs, deadline - time())); }
          catch (error) { failure = error instanceof ReadTransportError ? error : new ReadTransportError('unknown'); }
          const receivedBytes = failure ? failure.receivedBytes : rawPage?.content instanceof Uint8Array ? rawPage.content.byteLength : 0;
          const receivedBytesWithinLimits = integer(receivedBytes, 0, limits.pageBytes) && bytes + discardedBytes + receivedBytes <= limits.totalBytes;
          // Received bytes remain discarded until this exact page is admitted,
          // including when any post-transport clock or authority check refuses it.
          if (receivedBytesWithinLimits) discardedBytes += receivedBytes;
          time();
          attempts.push({ page: pages.length + 1, attempt, startedAtMs: attemptStart, finishedAtMs: lastTime, outcome: failure?.kind ?? 'succeeded', delayBeforeNextMs: null });
          require(receivedBytesWithinLimits, 'READ_BYTE_LIMIT');
          require(before.expiresAtMs > time(), 'READ_AUTHENTICATION_EXPIRED');
          await authorize(); // Revocation, expiry, qualification changes and missing scopes prevent raw-data delivery.
          if (!failure) {
            require(rawPage && rawPage.content instanceof Uint8Array && rawPage.content.byteLength === receivedBytes
              && bytes + discardedBytes <= limits.totalBytes, 'READ_BYTE_LIMIT');
            require(exact(rawPage, ['content', 'contentType', 'schemaFingerprint', 'rowCount', 'continuation', 'source'])
              && exact(rawPage!.source, ['reportReference', 'generatedAtMs', 'snapshotId', 'completeness', 'totalRows'])
              && (rawPage!.source.reportReference === null || boundedText(rawPage!.source.reportReference, 1_000))
              && (rawPage!.source.snapshotId === null || boundedText(rawPage!.source.snapshotId, 200)), 'READ_SOURCE_EVIDENCE_INVALID');
            require(boundedText(rawPage!.contentType, 100) && typeof rawPage!.schemaFingerprint === 'string' && /^[a-f0-9]{64}$/.test(rawPage!.schemaFingerprint)
              && integer(rawPage!.rowCount, 0, limits.maxRows) && ['reported-complete', 'reported-partial', 'unknown'].includes(rawPage!.source.completeness)
              && (rawPage!.source.totalRows === null || integer(rawPage!.source.totalRows, 0, Number.MAX_SAFE_INTEGER))
              && (rawPage!.source.generatedAtMs === null || integer(rawPage!.source.generatedAtMs, 0, 8_640_000_000_000_000)), 'READ_PAGE_INVALID');
            require(exact(rawPage!.continuation, rawPage!.continuation.kind === 'complete' ? ['kind'] : ['kind', 'next']), 'READ_PAGINATION_INVALID');
            if (rawPage!.continuation.kind === 'more') {
              const next = rawPage!.continuation.next;
              require(next && exact(next, next.kind === 'token' ? ['kind', 'token'] : next.kind === 'offset' ? ['kind', 'offset'] : ['kind', 'page']), 'READ_PAGINATION_INVALID');
              require(next.kind === 'token' ? boundedText(next.token, 2_048) : next.kind === 'offset' ? integer(next.offset, 1, Number.MAX_SAFE_INTEGER)
                : next.kind === 'page' && integer(next.page, 1, Number.MAX_SAFE_INTEGER), 'READ_PAGINATION_INVALID');
            }
            page = structuredClone(rawPage!); break;
          }
          require(retryable.has(failure.kind) && adapter.retrySafety === 'idempotent-read' && attempt < retry.maxAttemptsPerPage, `READ_TRANSPORT_${failure.kind.toUpperCase().replaceAll('-', '_')}`);
          require(failure.cleanup === 'settled', 'READ_TRANSPORT_TIMEOUT_UNSETTLED');
          require(failure.retryAfterMs === null || integer(failure.retryAfterMs, 0, retry.retryAfterCapMs), 'READ_RETRY_AFTER_REFUSED');
          const delay = Math.max(Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1)), failure.retryAfterMs ?? 0);
          require(delayedMs + delay <= retry.maxTotalDelayMs && time() + delay < deadline, 'READ_RETRY_BUDGET_EXCEEDED');
          delayedMs += delay;
          attempts[attempts.length - 1] = { ...attempts[attempts.length - 1], delayBeforeNextMs: delay };
          try { await clock.sleep(delay, input.signal); } catch { refuse('READ_CANCELLED'); }
        }
        require(page && page.content instanceof Uint8Array && page.content.byteLength <= limits.pageBytes
          && bytes + discardedBytes <= limits.totalBytes, 'READ_BYTE_LIMIT');
        require(typeof page!.contentType === 'string' && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:; charset=utf-8)?$/.test(page!.contentType)
          && /^[a-f0-9]{64}$/.test(page!.schemaFingerprint) && integer(page!.rowCount, 0, limits.maxRows), 'READ_PAGE_INVALID');
        require(rows + page!.rowCount <= limits.maxRows, 'READ_ROW_LIMIT');
        require(page!.source && ['reported-complete', 'reported-partial', 'unknown'].includes(page!.source.completeness)
          && (page!.source.totalRows === null || integer(page!.source.totalRows, 0, Number.MAX_SAFE_INTEGER))
          && (page!.source.generatedAtMs === null || integer(page!.source.generatedAtMs, 0, 8_640_000_000_000_000))
          && (page!.source.reportReference === null || typeof page!.source.reportReference === 'string')
          && (page!.source.snapshotId === null || typeof page!.source.snapshotId === 'string'), 'READ_SOURCE_EVIDENCE_INVALID');
        require(page!.source.completeness !== 'reported-partial', 'READ_SOURCE_INCOMPLETE');
        require(page!.source.totalRows === null || expectedRows === null || page!.source.totalRows === expectedRows, 'READ_SOURCE_TOTAL_CHANGED');
        if (page!.source.totalRows !== null) expectedRows = page!.source.totalRows;
        allReportedComplete &&= page!.source.completeness === 'reported-complete';
        allSnapshotsPresent &&= page!.source.snapshotId !== null;
        require(page!.source.snapshotId === null || snapshotId === null || page!.source.snapshotId === snapshotId, 'READ_SOURCE_SNAPSHOT_CHANGED');
        if (page!.source.snapshotId !== null) snapshotId = page!.source.snapshotId;
        allTimesPresent &&= page!.source.generatedAtMs !== null;
        if (page!.source.generatedAtMs !== null) {
          oldestGeneratedAt = oldestGeneratedAt === null ? page!.source.generatedAtMs : Math.min(oldestGeneratedAt, page!.source.generatedAtMs);
          sourceClockAhead ||= page!.source.generatedAtMs > time();
        }
        const continuation = page!.continuation;
        require(continuation && ['complete', 'more'].includes(continuation.kind), 'READ_PAGINATION_INVALID');
        if (continuation.kind === 'more') {
          const next = continuation.next;
          require(adapter.pagination.kind !== 'none' && next && next.kind === adapter.pagination.kind && page!.rowCount > 0, 'READ_PAGINATION_INVALID');
          require(next.kind === 'token' ? typeof next.token === 'string' && next.token.length > 0 && next.token.length <= 2_048 && !/[\u0000-\u001f]/.test(next.token)
            : next.kind === 'offset' ? integer(next.offset, 1, Number.MAX_SAFE_INTEGER) && (cursor?.kind !== 'offset' || next.offset > cursor.offset)
            : integer(next.page, 1, Number.MAX_SAFE_INTEGER) && (cursor?.kind !== 'page' || next.page > cursor.page), 'READ_PAGINATION_INVALID');
          require(!seen.has(cursorKey(next)), 'READ_PAGINATION_LOOP'); seen.add(cursorKey(next));
        }
        const capturedAtMs = time();
        discardedBytes -= page!.content.byteLength; bytes += page!.content.byteLength; rows += page!.rowCount;
        pages.push({ content: Uint8Array.from(page!.content), fromCursor: structuredClone(cursor), continuation: structuredClone(continuation), rowCount: page!.rowCount,
          provenance: { operationKey, authorityScopeHash, dataScopeHash, capturedAtMs, contentSha256: digest(page!.content), byteLength: page!.content.byteLength,
            contentType: page!.contentType, schemaFingerprint: page!.schemaFingerprint, source: structuredClone(page!.source) } });
        if (continuation.kind === 'complete') break;
        cursor = structuredClone(continuation.next);
      }
      require(expectedRows === null || expectedRows === rows, 'READ_SOURCE_TOTAL_MISMATCH');
      await authorize();
      const retrievedAtMs = time();
      const freshness: ReadFreshness = !allTimesPresent ? { retrievedAtMs, oldestSourceGeneratedAtMs: null, maximumAgeMs: maxAge, state: 'unknown', reason: 'source-time-missing' }
        : sourceClockAhead ? { retrievedAtMs, oldestSourceGeneratedAtMs: oldestGeneratedAt, maximumAgeMs: maxAge, state: 'unknown', reason: 'source-clock-ahead' }
        : { retrievedAtMs, oldestSourceGeneratedAtMs: oldestGeneratedAt, maximumAgeMs: maxAge, state: retrievedAtMs - oldestGeneratedAt! > maxAge ? 'stale' : 'current',
          reason: retrievedAtMs - oldestGeneratedAt! > maxAge ? 'older-than-policy' : 'within-policy' };
      const fingerprints = [...new Set(pages.map(page => page.provenance.schemaFingerprint))];
      const result: ConnectorReadResult = { pages, completeness: { pagination: 'complete', source: allReportedComplete ? 'reported-complete' : 'unknown', expectedRows, actualRows: rows,
        sourceTotalMatches: expectedRows === null ? null : true, snapshot: allSnapshotsPresent ? 'same-declared-snapshot' : 'unverified', independentReconciliation: 'required' },
        freshness, schema: { state: fingerprints.length === 1 ? 'stable' : 'changed', fingerprints }, receipt: receipt(null) };
      this.#issuedResults.set(result, { seal: resultSeal(result), maxPages: limits.maxPages, maxBytes: limits.totalBytes, pageBytes: limits.pageBytes });
      return result;
    } catch (error) {
      if (error instanceof ConnectorReadError) throw error;
      return refuse(error instanceof Error && error.message === 'READ_CLOCK_INVALID' ? 'READ_CLOCK_INVALID' : 'READ_CONTRACT_INVALID');
    }
  }
}
