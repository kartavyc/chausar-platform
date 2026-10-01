import { createHash } from 'node:crypto';
import { audit, authorize, check, newId, type Context, type State, type StateStore } from '../contracts.ts';
import { digest } from '../actions.ts';
import { ImportService, parseIndianMoney, type ImportPreview, type MappingRecipe } from '../ingest.ts';
import { sumMoney } from '../calculator.ts';
import { insertFacts, markStale, validatePeriod, type Period } from '../memory.ts';
import { assertSourceAccess, isNoResend, trustFingerprint } from '../trust.ts';
import { ConnectorCapabilityRegistry, connectorOperationKey, type ConnectorOperationScope, type QualifiedLevel } from './registry.ts';

/** Decoders are registered engine code. Source data cannot name a module, expression or query. */
export type DecodedSourceRow = Record<string, string | boolean | null>;
export type QualifiedDecoder = {
  id: string; version: string; schemaSha256: string;
  /** Stable logical source revision namespace; acquisition filters and code versions do not redefine it. */
  identityNamespace: string;
  /** Immutable event/revision identity; mutable resource IDs alone are insufficient. */
  identityFields: readonly string[];
  resourceIdentityFields: readonly string[];
  /** A stable entity may replace an earlier observation only under qualified source ordering. */
  revisionOrder: { kind: 'unqualified' } | { kind: 'monotonic-integer'; field: string };
  /** All business fields. Excluded fields must be qualified mutable delivery metadata. */
  businessFields: readonly string[];
  deliveryFields: readonly string[];
  decode(content: string): DecodedSourceRow[];
};
export type ImportDomain = { company: string; dataset: string; branches: string[]; period?: Period };
export type CaptureSnapshot = { kind: 'source-snapshot'; id: string } | { kind: 'unverified'; limitation: string };
export type MappingReview = {
  type: 'connector-mapping-review-v1'; id: string; sourceId: string; operationKey: string;
  domain: ImportDomain; recipeHash: string; decoderId: string; decoderVersion: string;
  schemaSha256: string; evidence: { reportId: string; sha256: string };
  reviewer: { memberId: string; epoch: number }; reviewedAt: string;
};
export type CaptureRequest = {
  idempotencyKey: string; sourceId: string; scope: ConnectorOperationScope; domain: ImportDomain;
  recipe: MappingRecipe; reviewId: string; snapshot: CaptureSnapshot;
};
export type CaptureLease = { captureId: string; generation: number };
export type CapturedPageInput = {
  deliveryId: string; fromCursor: string | null; nextCursor: string | null;
  terminal: boolean; content: string; schemaSha256: string; decoderId: string; decoderVersion: string;
  /** Source event clock is separate from local capture time. */
  sourceObservedAt: string | null;
};
type CapturedIdentity = { key: string; businessHash: string; resourceKey: string; revision: string | null };
class ImmutableRevisionConflict extends Error {
  readonly code = 'IMMUTABLE_IDENTITY_CONFLICT'; readonly identity: string;
  constructor(identity: string) { super('One immutable source revision has conflicting business content.'); this.identity = identity; }
}
type CapturedPage = CapturedPageInput & {
  sha256: string; bytes: number; capturedAt: string; normalizedHash: string | null;
  rows: DecodedSourceRow[]; identities: CapturedIdentity[];
};
export type CaptureGap = { id: string; code: string; page: number; identity?: string; owner: string; status: 'unresolved' };
export type ConnectorCapture = {
  type: 'connector-capture-v1'; id: string; sourceId: string; operationKey: string;
  scope: ConnectorOperationScope; domain: ImportDomain; requestHash: string; recipe: MappingRecipe;
  recipeHash: string; reviewId: string; decoderId: string; decoderVersion: string; schemaSha256: string;
  identityNamespace: string; decoderDefinitionHash: string; qualificationDigest: string; minimumQualification?: QualifiedLevel;
  snapshot: CaptureSnapshot; authority: string; ontologyHash: string; generation: number; owner: string;
  status: 'capturing' | 'quarantined' | 'published'; createdAt: string;
  pages: CapturedPage[]; gaps: CaptureGap[]; totalBytes: number; terminal: boolean;
  frontiers: { captured: string | null; parsed: string | null; validated: string | null; published: string | null };
  progress: { capturedPages: number; parsedPages: number; validatedPages: number; publishedPages: number };
  rowIds: string[]; totalsMinor: string | null;
  coverage: { sourceRows: number; importedRows: number; rejectedRows: number; expectedRows: number | null; reconciled: boolean; snapshotConsistent: boolean; gaps: string[] };
  sourceTotals?: IndependentSourceTotals; reconciliation?: SourceReconciliation;
};
export type IndependentSourceTotals = {
  provenance: 'independent-source-report'; reportId: string; sha256: string;
  domainHash: string; company: string; dataset: string; currency: string;
  rowCount: number; amountMinor: string; observedAt: string; snapshotId: string | null;
};
export type ObservedSourceTotals = { rowCount: number; amountMinor: string | null; currency: string };
export type SourceReconciliation = {
  status: 'matched' | 'mismatch' | 'unavailable'; reasons: string[];
  observed: ObservedSourceTotals; expected: IndependentSourceTotals | null;
  differenceMinor: string | null; snapshotConsistent: boolean;
};
export const CAPTURE_LIMITS = Object.freeze({ pageBytes: 4 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, maxPages: 100, maxRows: 10000 });
const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const exactInteger = (v: unknown): v is string => typeof v === 'string' && /^-?(?:0|[1-9]\d{0,37})$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const boundedText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
function captures(state: State): ConnectorCapture[] { return state.imports.filter(i => i.type === 'connector-capture-v1'); }
function find(state: State, id: string): ConnectorCapture { const c = captures(state).find(c => c.id === id); check(c, 'CAPTURE_NOT_FOUND', 'This capture is unavailable.'); return c; }
function domainCheck(domain: ImportDomain) {
  check(domain && boundedText(domain.company) && boundedText(domain.dataset) && Array.isArray(domain.branches) && domain.branches.length > 0 && domain.branches.every(b => boundedText(b)) && new Set(domain.branches).size === domain.branches.length, 'INVALID_CAPTURE_DOMAIN', 'Captures require exact company, dataset and branches.');
  validatePeriod(domain.period);
}
function decoderCheck(decoder: QualifiedDecoder) {
  check(boundedText(decoder.id) && boundedText(decoder.version) && boundedText(decoder.identityNamespace) && /^[a-f0-9]{64}$/.test(decoder.schemaSha256) && typeof decoder.decode === 'function', 'INVALID_DECODER', 'Register a versioned decoder with a wire schema digest and stable identity namespace.');
  const fields = [...decoder.businessFields, ...decoder.deliveryFields];
  check(decoder.identityFields.length > 0 && decoder.resourceIdentityFields.length > 0 && decoder.businessFields.length > 0 && fields.every(f => boundedText(f) && !['__proto__', 'constructor', 'prototype'].includes(f)) && new Set(fields).size === fields.length && [...decoder.identityFields, ...decoder.resourceIdentityFields].every(f => decoder.businessFields.includes(f)), 'INVALID_DECODER', 'Every identity and business field needs one declared meaning.');
  check(decoder.revisionOrder?.kind === 'unqualified' || decoder.revisionOrder?.kind === 'monotonic-integer' && decoder.identityFields.includes(decoder.revisionOrder.field) && !decoder.resourceIdentityFields.includes(decoder.revisionOrder.field), 'INVALID_DECODER', 'Correction ordering needs a qualified monotonic source revision field.');
}
const decoderDefinitionHash = (decoder: QualifiedDecoder) => digest({ id: decoder.id, version: decoder.version, schemaSha256: decoder.schemaSha256, identityNamespace: decoder.identityNamespace, identityFields: decoder.identityFields, resourceIdentityFields: decoder.resourceIdentityFields, revisionOrder: decoder.revisionOrder, businessFields: decoder.businessFields, deliveryFields: decoder.deliveryFields });

/** Exact deterministic reconciliation; absent data never becomes an observed zero. */
export function reconcileSourceTotals(observed: ObservedSourceTotals, expected: IndependentSourceTotals | null, domain: ImportDomain, snapshot: CaptureSnapshot): SourceReconciliation {
  domainCheck(domain);
  check(Number.isSafeInteger(observed.rowCount) && observed.rowCount >= 0 && /^[A-Z]{3}$/.test(observed.currency) && (observed.amountMinor === null || exactInteger(observed.amountMinor)), 'INVALID_OBSERVED_TOTALS', 'Observed totals must have exact units and explicit availability.');
  if (!expected || observed.amountMinor === null) return { status: 'unavailable', reasons: [!expected ? 'SOURCE_TOTALS_REQUIRED' : 'OBSERVED_AMOUNT_UNAVAILABLE'], observed: structuredClone(observed), expected: expected ? structuredClone(expected) : null, differenceMinor: null, snapshotConsistent: false };
  check(expected.provenance === 'independent-source-report' && boundedText(expected.reportId) && /^[a-f0-9]{64}$/.test(expected.sha256) && /^[a-f0-9]{64}$/.test(expected.domainHash) && Number.isSafeInteger(expected.rowCount) && expected.rowCount >= 0 && exactInteger(expected.amountMinor) && timestamp(expected.observedAt), 'INVALID_SOURCE_TOTALS', 'Reconciliation requires a named independent report and exact totals.');
  const reasons: string[] = [];
  if (expected.domainHash !== digest(domain) || expected.company !== domain.company || expected.dataset !== domain.dataset) reasons.push('SOURCE_TOTAL_SCOPE_MISMATCH');
  if (observed.currency !== expected.currency) reasons.push('SOURCE_TOTAL_CURRENCY_MISMATCH');
  if (observed.rowCount !== expected.rowCount) reasons.push('SOURCE_ROW_MISMATCH');
  if (observed.amountMinor !== expected.amountMinor) reasons.push('SOURCE_TOTAL_MISMATCH');
  const snapshotConsistent = snapshot.kind === 'source-snapshot' && snapshot.id === expected.snapshotId;
  return { status: reasons.length ? 'mismatch' : 'matched', reasons, observed: structuredClone(observed), expected: structuredClone(expected), differenceMinor: observed.currency === expected.currency ? String(BigInt(observed.amountMinor) - BigInt(expected.amountMinor)) : null, snapshotConsistent };
}

function csv(rows: DecodedSourceRow[], fields: readonly string[]): string {
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [fields.map(escape).join(','), ...rows.map(row => fields.map(f => escape(row[f] === null || row[f] === undefined ? '' : String(row[f]))).join(','))].join('\n');
}

function decodePage(decoder: QualifiedDecoder, content: string) {
  const decoded = decoder.decode(content), rows: DecodedSourceRow[] = [], identities: CapturedIdentity[] = [], seen = new Map<string, string>();
  check(Array.isArray(decoded) && decoded.length <= CAPTURE_LIMITS.maxRows, 'CAPTURE_ROW_LIMIT', 'The decoded row budget was exceeded.');
  const fields = [...decoder.businessFields, ...decoder.deliveryFields];
  for (const row of decoded) {
    check(row && Object.getPrototypeOf(row) === Object.prototype && Object.keys(row).every(f => fields.includes(f)) && Object.values(row).every(v => v === null || typeof v === 'string' || typeof v === 'boolean') && [...decoder.identityFields, ...decoder.resourceIdentityFields].every(f => boundedText(row[f], 1000)), 'UNQUALIFIED_SOURCE_ROW', 'Source identities and values need qualified exact field meanings.');
    const key = digest(decoder.identityFields.map(f => row[f])), businessHash = digest(Object.fromEntries(decoder.businessFields.map(f => [f, row[f] ?? null])));
    const resourceKey = digest(decoder.resourceIdentityFields.map(f => row[f]));
    const revision = decoder.revisionOrder.kind === 'monotonic-integer' ? row[decoder.revisionOrder.field] : null;
    check(revision === null || typeof revision === 'string' && /^(?:0|[1-9]\d{0,37})$/.test(revision), 'UNQUALIFIED_SOURCE_REVISION', 'Source revisions need exact nonnegative integer ordering.');
    if (seen.has(key) && seen.get(key) !== businessHash) throw new ImmutableRevisionConflict(key);
    if (!seen.has(key)) { rows.push(structuredClone(row)); identities.push({ key, businessHash, resourceKey, revision }); seen.set(key, businessHash); }
  }
  return { rows, identities, normalizedHash: digest([...identities].sort((a, b) => a.key.localeCompare(b.key))) };
}

/** Uses the existing transactional StateStore; DB normalization is an integration-owned change. */
export class CursorImportService {
  #store: StateStore; #registry: ConnectorCapabilityRegistry; #decoder: QualifiedDecoder; #now: () => string; #minimum: QualifiedLevel;
  #beforeInsert?: (context: Context, state: State, capture: ConnectorCapture, totals: IndependentSourceTotals) => void;
  constructor(store: StateStore, registry: ConnectorCapabilityRegistry, decoder: QualifiedDecoder, dependencies: { now?: () => string; minimumQualification?: QualifiedLevel;
    beforeInsert?: (context: Context, state: State, capture: ConnectorCapture, totals: IndependentSourceTotals) => void } = {}) {
    decoderCheck(decoder); this.#store = store; this.#registry = registry; this.#decoder = { ...decoder, identityFields: [...decoder.identityFields], resourceIdentityFields: [...decoder.resourceIdentityFields], revisionOrder: structuredClone(decoder.revisionOrder), businessFields: [...decoder.businessFields], deliveryFields: [...decoder.deliveryFields] }; this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#minimum = dependencies.minimumQualification ?? 'synthetic-tested';
    this.#beforeInsert = dependencies.beforeInsert;
    check(['synthetic-tested', 'sandbox-verified', 'live-verified'].includes(this.#minimum), 'INVALID_QUALIFICATION_LEVEL', 'Use the actual host execution environment qualification.');
  }
  decoderDescriptor() {
    const { decode: _decode, ...descriptor } = this.#decoder;
    return structuredClone({ ...descriptor, definitionHash: decoderDefinitionHash(this.#decoder) });
  }
  #sourceBinding(state: State, sourceId: string, domain: ImportDomain) {
    const prior = captures(state).filter(c => c.sourceId === sourceId);
    check(prior.every(c => c.domain.company === domain.company && c.domain.dataset === domain.dataset && c.identityNamespace === this.#decoder.identityNamespace), 'SOURCE_IDENTITY_SCOPE_CONFLICT', 'Use one stable source identity per installation, company, dataset and revision namespace.');
  }
  #access(state: State, ctx: Context, sourceId: string, branches: string[], authority?: string, permission: 'read' | 'prepare' = 'prepare') {
    const view: StateStore = { read: () => state, update: this.#store.update.bind(this.#store) };
    const member = authorize(view, ctx, permission); assertSourceAccess(state, ctx, [sourceId]);
    check(branches.every(b => member.branches.includes('*') || member.branches.includes(b)), 'FORBIDDEN_BRANCH', 'The capture includes a branch outside your current access.');
    if (authority) check(trustFingerprint(state, ctx, [sourceId]) === authority, 'AUTHORITY_CHANGED', 'Capture permissions changed. Start a newly authorized capture.');
  }
  #qualified(scope: ConnectorOperationScope) { check(scope.kind === 'import', 'IMPORT_CAPABILITY_REQUIRED', 'Publication requires a separately qualified import operation.'); if (this.#decoder.revisionOrder.kind !== 'unqualified') this.#registry.assertCapability(scope, 'corrections', this.#now(), this.#minimum); return this.#registry.assertCanUse(scope, this.#now(), this.#minimum); }
  async reviewMapping(ctx: Context, input: { sourceId: string; scope: ConnectorOperationScope; domain: ImportDomain; recipe: MappingRecipe; evidence: MappingReview['evidence'] }): Promise<MappingReview> {
    ctx = structuredClone(ctx); input = structuredClone(input);
    check(ctx.sourceTainted !== true && ctx.channel !== 'phone', 'HUMAN_MAPPING_REVIEW_REQUIRED', 'Approve source meanings through the trusted owner review flow.');
    domainCheck(input.domain); this.#qualified(input.scope);
    check(input.recipe.scope.company === input.domain.company && digest(input.recipe.scope.branches) === digest(input.domain.branches), 'MAPPING_SCOPE_MISMATCH', 'Review the recipe for this exact company and branches.');
    check(input.recipe.onUnmapped === 'reject' && input.recipe.bindings.every(b => b.nulls !== 'zero'), 'UNSAFE_MISSING_VALUE_POLICY', 'Unknown fields require review and missing values cannot become zero.');
    check(boundedText(input.evidence.reportId) && /^[a-f0-9]{64}$/.test(input.evidence.sha256), 'MAPPING_EVIDENCE_REQUIRED', 'Review needs a named source report and its digest.');
    const mapped = input.recipe.bindings.flatMap(b => b.source ? [b.source] : []);
    check(mapped.every(f => this.#decoder.businessFields.includes(f)), 'MAPPING_FIELDS_UNQUALIFIED', 'Bindings must use qualified business fields.');
    return this.#store.update(state => {
      const member = authorize({ read: () => state, update: this.#store.update.bind(this.#store) }, ctx, 'approve'); this.#access(state, ctx, input.sourceId, input.domain.branches);
      this.#sourceBinding(state, input.sourceId, input.domain);
      const review: MappingReview = { type: 'connector-mapping-review-v1', id: newId('mapping'), sourceId: input.sourceId, operationKey: connectorOperationKey(input.scope), domain: structuredClone(input.domain), recipeHash: digest(input.recipe), decoderId: this.#decoder.id, decoderVersion: this.#decoder.version, schemaSha256: this.#decoder.schemaSha256, evidence: structuredClone(input.evidence), reviewer: { memberId: member.id, epoch: member.epoch }, reviewedAt: this.#now() };
      state.imports.push(review); audit(state, 'connector.mapping-reviewed', { reviewId: review.id, sourceId: input.sourceId }); return structuredClone(review);
    });
  }
  async open(ctx: Context, request: CaptureRequest): Promise<CaptureLease> {
    ctx = structuredClone(ctx); request = structuredClone(request);
    domainCheck(request.domain); this.#qualified(request.scope);
    check(boundedText(request.sourceId) && boundedText(request.idempotencyKey) && request.idempotencyKey.length >= 8, 'INVALID_CAPTURE_IDENTITY', 'Captures require a stable named source and idempotency key.');
    check(request.snapshot.kind === 'source-snapshot' ? boundedText(request.snapshot.id) : request.snapshot.kind === 'unverified' && boundedText(request.snapshot.limitation, 1000), 'INVALID_SNAPSHOT', 'State the source snapshot or its consistency limitation.');
    return this.#store.update(state => {
      this.#access(state, ctx, request.sourceId, request.domain.branches); this.#qualified(request.scope);
      this.#sourceBinding(state, request.sourceId, request.domain);
      const review = state.imports.find(i => i.type === 'connector-mapping-review-v1' && i.id === request.reviewId) as MappingReview | undefined;
      check(review && review.sourceId === request.sourceId && review.operationKey === connectorOperationKey(request.scope) && review.recipeHash === digest(request.recipe) && digest(review.domain) === digest(request.domain) && review.decoderId === this.#decoder.id && review.decoderVersion === this.#decoder.version && review.schemaSha256 === this.#decoder.schemaSha256, 'MAPPING_REVIEW_REQUIRED', 'An owner must review this exact mapping, decoder, schema and scope.');
      const approver = state.members.find(m => m.id === review.reviewer.memberId);
      check(approver?.active && approver.epoch === review.reviewer.epoch && ['owner', 'cofounder'].includes(approver.role), 'MAPPING_REVIEW_REVOKED', 'The mapping reviewer no longer has approval authority.');
      const id = `capture_${digest({ sourceId: request.sourceId, operation: connectorOperationKey(request.scope), key: request.idempotencyKey })}`, requestHash = digest(request), previous = captures(state).find(c => c.id === id);
      if (previous) { check(previous.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT', 'This key belongs to different capture inputs.'); this.#access(state, ctx, previous.sourceId, previous.domain.branches, previous.authority); return { captureId: id, generation: previous.generation }; }
      const capture: ConnectorCapture = { identityNamespace: this.#decoder.identityNamespace, decoderDefinitionHash: decoderDefinitionHash(this.#decoder), qualificationDigest: this.#qualified(request.scope).digest, minimumQualification: this.#minimum, type: 'connector-capture-v1', id, sourceId: request.sourceId, scope: structuredClone(request.scope), operationKey: connectorOperationKey(request.scope), domain: structuredClone(request.domain), requestHash, recipe: structuredClone(request.recipe), recipeHash: digest(request.recipe), reviewId: review.id, decoderId: review.decoderId, decoderVersion: review.decoderVersion, schemaSha256: review.schemaSha256, snapshot: structuredClone(request.snapshot), authority: trustFingerprint(state, ctx, [request.sourceId]), ontologyHash: digest(state.ontology), generation: 1, owner: ctx.memberId, status: 'capturing', createdAt: this.#now(), pages: [], gaps: [], totalBytes: 0, terminal: false, frontiers: { captured: null, parsed: null, validated: null, published: null }, progress: { capturedPages: 0, parsedPages: 0, validatedPages: 0, publishedPages: 0 }, rowIds: [], totalsMinor: null, coverage: { sourceRows: 0, importedRows: 0, rejectedRows: 0, expectedRows: null, reconciled: false, snapshotConsistent: false, gaps: ['ACQUISITION_NOT_COMPLETE'] } };
      state.imports.push(capture); audit(state, 'connector.capture-opened', { captureId: id, sourceId: request.sourceId }); return { captureId: id, generation: 1 };
    });
  }
  #current(state: State, ctx: Context, lease: CaptureLease) {
    const c = find(state, lease.captureId); this.#access(state, ctx, c.sourceId, c.domain.branches, c.authority);
    check((c.minimumQualification ?? 'synthetic-tested') === this.#minimum && c.qualificationDigest === this.#qualified(c.scope).digest, 'CAPTURE_QUALIFICATION_CHANGED', 'Operation qualification changed; review a new capture.');
    check(c.decoderDefinitionHash === decoderDefinitionHash(this.#decoder), 'CAPTURE_DECODER_CHANGED', 'Resume with the exact pinned decoder definition.');
    check(c.generation === lease.generation, 'CAPTURE_FENCE_EXPIRED', 'This acquisition owner has been superseded.');
    check(c.ontologyHash === digest(state.ontology), 'ONTOLOGY_CHANGED', 'Business meanings changed during this capture. Review a new capture.');
    const review = state.imports.find(i => i.type === 'connector-mapping-review-v1' && i.id === c.reviewId) as MappingReview | undefined;
    const reviewer = review && state.members.find(m => m.id === review.reviewer.memberId);
    check(reviewer?.active && reviewer.epoch === review?.reviewer.epoch && ['owner', 'cofounder'].includes(reviewer.role), 'MAPPING_REVIEW_REVOKED', 'The mapping reviewer no longer has approval authority.');
    return c;
  }
  #gap(state: State, c: ConnectorCapture, ctx: Context, code: string, page: number, identity?: string) {
    c.status = 'quarantined'; c.coverage.reconciled = false; c.coverage.gaps = [...new Set([...c.coverage.gaps, code])];
    c.gaps.push({ id: newId('gap'), code, page, ...(identity ? { identity } : {}), owner: ctx.memberId, status: 'unresolved' });
    markStale(state, 'Connector capture requires reconciliation.'); audit(state, 'connector.capture-quarantined', { captureId: c.id, code, page });
  }
  async capturePage(ctx: Context, lease: CaptureLease, input: CapturedPageInput): Promise<ConnectorCapture> {
    check(boundedText(input.deliveryId) && typeof input.content === 'string' && Buffer.byteLength(input.content) <= CAPTURE_LIMITS.pageBytes && typeof input.terminal === 'boolean' && (input.sourceObservedAt === null || timestamp(input.sourceObservedAt)), 'INVALID_CAPTURE_PAGE', 'A page requires bounded raw bytes and explicit terminal and observation evidence.');
    check((input.fromCursor === null || boundedText(input.fromCursor, 4096)) && (input.nextCursor === null || boundedText(input.nextCursor, 4096)), 'INVALID_CURSOR', 'Continuations must be bounded opaque data.');
    ctx = structuredClone(ctx); lease = structuredClone(lease); input = structuredClone(input);
    return this.#store.update(state => {
      const c = this.#current(state, ctx, lease); const rawHash = sha256(input.content);
      check(!isNoResend(state, rawHash), 'SOURCE_DELETED', 'Deleted source evidence cannot be recaptured.');
      const previous = c.pages.find(p => p.deliveryId === input.deliveryId);
      if (previous) {
        const sameDescriptor = previous.fromCursor === input.fromCursor && previous.nextCursor === input.nextCursor && previous.terminal === input.terminal && previous.schemaSha256 === input.schemaSha256 && previous.decoderId === input.decoderId && previous.decoderVersion === input.decoderVersion;
        if (sameDescriptor && previous.sha256 === rawHash) return structuredClone(c);
        let equivalent = false;
        if (sameDescriptor && previous.normalizedHash) {
          try { equivalent = decodePage(this.#decoder, input.content).normalizedHash === previous.normalizedHash; } catch { /* Conflicting or unqualified redelivery is quarantined below. */ }
        }
        if (equivalent) { audit(state, 'connector.equivalent-redelivery', { captureId: c.id, deliveryId: input.deliveryId, sha256: rawHash }); return structuredClone(c); }
        this.#gap(state, c, ctx, 'DELIVERY_IDENTITY_CONFLICT', c.pages.indexOf(previous) + 1);
        return structuredClone(c);
      }
      check(c.status === 'capturing', 'CAPTURE_QUARANTINED', 'This capture must be reconciled before further processing.');
      check(!c.terminal && c.pages.length < CAPTURE_LIMITS.maxPages && c.totalBytes + Buffer.byteLength(input.content) <= CAPTURE_LIMITS.totalBytes, 'CAPTURE_LIMIT', 'The capture is terminal or exceeds its resource budget.');
      const page: CapturedPage = { ...structuredClone(input), sha256: rawHash, bytes: Buffer.byteLength(input.content), capturedAt: this.#now(), normalizedHash: null, rows: [], identities: [] };
      c.pages.push(page); c.totalBytes += page.bytes; c.progress.capturedPages++;
      if (input.fromCursor !== c.frontiers.captured || (input.terminal ? input.nextCursor !== null : input.nextCursor === null) || (!input.terminal && (input.nextCursor === input.fromCursor || c.pages.slice(0, -1).some(p => p.nextCursor === input.nextCursor)))) { this.#gap(state, c, ctx, 'CURSOR_CHAIN_INVALID', c.pages.length); return structuredClone(c); }
      c.frontiers.captured = input.nextCursor; c.terminal = input.terminal;
      if (input.schemaSha256 !== c.schemaSha256 || input.decoderId !== c.decoderId || input.decoderVersion !== c.decoderVersion) { this.#gap(state, c, ctx, 'SCHEMA_CHANGE_REVIEW_REQUIRED', c.pages.length); return structuredClone(c); }
      let decoded: ReturnType<typeof decodePage>;
      try { decoded = decodePage(this.#decoder, input.content); check(decoded.rows.length + c.coverage.sourceRows <= CAPTURE_LIMITS.maxRows, 'CAPTURE_ROW_LIMIT', 'The decoded row budget was exceeded.'); }
      catch (error) {
        this.#gap(state, c, ctx, error instanceof Error && 'code' in error ? String(error.code) : 'DECODE_QUARANTINED', c.pages.length, error instanceof ImmutableRevisionConflict ? error.identity : undefined);
        if (error instanceof ImmutableRevisionConflict) {
          for (const other of captures(state).filter(other => other.id !== c.id && other.sourceId === c.sourceId && other.identityNamespace === c.identityNamespace && other.pages.some(p => p.identities.some(i => i.key === error.identity)))) this.#gap(state, other, ctx, 'IMMUTABLE_IDENTITY_CONFLICT', 0, error.identity);
        }
        return structuredClone(c);
      }
      const seen = new Map(c.pages.flatMap(p => p.identities.map(i => [i.key, i.businessHash] as const)));
      const history = captures(state).filter(other => other.id !== c.id && other.sourceId === c.sourceId && other.domain.company === c.domain.company && other.domain.dataset === c.domain.dataset && other.identityNamespace === c.identityNamespace);
      for (let index = 0; index < decoded.rows.length; index++) {
        const row = decoded.rows[index], identity = decoded.identities[index], { key, businessHash } = identity;
        const related = [...c.pages.flatMap(p => p.identities), ...history.flatMap(other => other.pages.flatMap(p => p.identities))].filter(i => i.resourceKey === identity.resourceKey && i.key !== key);
        if (related.length && (identity.revision === null || related.some(i => i.revision === null))) { this.#gap(state, c, ctx, 'REVISION_ORDER_REVIEW_REQUIRED', c.pages.length, key); return structuredClone(c); }
        if (identity.revision !== null && related.some(i => i.revision !== null && BigInt(i.revision) >= BigInt(identity.revision!))) { this.#gap(state, c, ctx, 'STALE_SOURCE_REVISION', c.pages.length, key); return structuredClone(c); }
        const prior = seen.get(key), historic = history.flatMap(other => other.pages.flatMap(p => p.identities.filter(i => i.key === key).map(i => ({ capture: other, hash: i.businessHash }))));
        if ((prior !== undefined && prior !== businessHash) || historic.some(i => i.hash !== businessHash)) {
          this.#gap(state, c, ctx, 'IMMUTABLE_IDENTITY_CONFLICT', c.pages.length, key);
          for (const h of historic) this.#gap(state, h.capture, ctx, 'IMMUTABLE_IDENTITY_CONFLICT', 0, key);
          return structuredClone(c);
        }
        if (prior === undefined) { page.rows.push(structuredClone(row)); page.identities.push(identity); seen.set(key, businessHash); }
      }
      page.normalizedHash = decoded.normalizedHash; c.coverage.sourceRows = seen.size;
      c.frontiers.parsed = input.nextCursor; c.progress.parsedPages++;
      audit(state, 'connector.page-captured', { captureId: c.id, page: c.pages.length, sha256: rawHash }); return structuredClone(c);
    });
  }
  async takeOwnership(ctx: Context, captureId: string): Promise<CaptureLease> {
    ctx = structuredClone(ctx);
    return this.#store.update(state => { const existing = find(state, captureId), c = this.#current(state, ctx, { captureId, generation: existing.generation }); check(c.status === 'capturing', 'CAPTURE_NOT_ACTIVE', 'Only an active capture can transfer ownership.'); c.generation++; c.owner = ctx.memberId; audit(state, 'connector.capture-fenced', { captureId, generation: c.generation }); return { captureId, generation: c.generation }; });
  }
  async publish(ctx: Context, lease: CaptureLease, totals: IndependentSourceTotals | null): Promise<ConnectorCapture> {
    ctx = structuredClone(ctx); lease = structuredClone(lease); totals = structuredClone(totals);
    return this.#store.update(state => {
      const c = this.#current(state, ctx, lease); if (c.status === 'published') return structuredClone(c);
      check(c.status === 'capturing' && c.terminal && c.progress.parsedPages === c.pages.length, 'CAPTURE_INCOMPLETE', 'Only a terminal, fully parsed capture can publish.');
      const rows = c.pages.flatMap(p => p.rows), fields = this.#decoder.businessFields;
      const view: StateStore = { read: () => state, update: this.#store.update.bind(this.#store) };
      let preview: ImportPreview;
      try { preview = new ImportService(view).preview(ctx, { sourceId: c.sourceId, format: 'csv', content: csv(rows, fields), recipe: c.recipe, installation: { company: c.domain.company, edition: c.recipe.edition } }); }
      catch { this.#gap(state, c, ctx, 'MAPPING_VALIDATION_FAILED', 0); return structuredClone(c); }
      if (c.domain.period && preview.facts.some(f => f.validFrom < c.domain.period!.from || f.validFrom > c.domain.period!.to)) { this.#gap(state, c, ctx, 'OUTSIDE_CAPTURE_PERIOD', 0); return structuredClone(c); }
      // The importer validates mapping and calculates canonical values. This service owns
      // independently scoped source reconciliation, in source units before any FX conversion.
      const mappingErrors = preview.errors.filter(e => e.code !== 'SOURCE_TOTALS_REQUIRED');
      const binding = c.recipe.bindings.find(b => b.target === 'amountMinor')!;
      let sourceAmount: string | null = null;
      if (!mappingErrors.some(e => e.row > 0)) {
        try { sourceAmount = sumMoney(rows.map(row => parseIndianMoney(binding.constant ?? row[binding.source!], binding.moneyUnit))); }
        catch { mappingErrors.push({ row: 0, code: 'SOURCE_AMOUNT_UNAVAILABLE', message: 'Source units could not be reconciled.' }); }
      }
      const observed: ObservedSourceTotals = { rowCount: rows.length, amountMinor: sourceAmount, currency: binding.currency ?? '' };
      const reconciliation = reconcileSourceTotals(observed, totals, c.domain, c.snapshot); c.reconciliation = reconciliation;
      if (mappingErrors.length || reconciliation.status !== 'matched') { for (const code of new Set([...mappingErrors.map(e => e.code), ...reconciliation.reasons])) this.#gap(state, c, ctx, code, 0); return structuredClone(c); }
      this.#access(state, ctx, c.sourceId, c.domain.branches, c.authority);
      const admission = this.#beforeInsert?.(ctx, state, c, totals!);
      check(admission === undefined, 'ASYNC_IMPORT_GATE_REFUSED', 'Fact admission must finish synchronously inside the publication transaction.');
      const at = this.#now(); const records = insertFacts(state, preview.facts, at);
      // Include reused immutable facts in lineage; replay creates no second contribution.
      c.rowIds = preview.facts.map(f => state.facts.filter(old => old.sourceId === f.sourceId && old.entityId === f.entityId && old.kind === f.kind).at(-1)!.id);
      c.totalsMinor = preview.totalsMinor; c.sourceTotals = structuredClone(totals!); c.status = 'published';
      c.progress.validatedPages = c.pages.length; c.progress.publishedPages = c.pages.length;
      c.frontiers.validated = c.frontiers.parsed; c.frontiers.published = c.frontiers.parsed;
      c.coverage = { sourceRows: rows.length, importedRows: preview.facts.length, rejectedRows: 0, expectedRows: totals!.rowCount, reconciled: true, snapshotConsistent: reconciliation.snapshotConsistent, gaps: reconciliation.snapshotConsistent ? [] : ['SOURCE_SNAPSHOT_CONSISTENCY_UNVERIFIED'] };
      audit(state, 'connector.capture-published', { captureId: c.id, addedRows: records.length, rowCount: c.rowIds.length }); return structuredClone(c);
    });
  }
  get(ctx: Context, captureId: string): ConnectorCapture { const state = this.#store.read(), c = find(state, captureId); this.#access(state, ctx, c.sourceId, c.domain.branches, undefined, 'read'); return structuredClone(c); }
  /** The parent must call this before certifying consumer readiness; raw facts alone do not establish coverage. */
  assertReady(ctx: Context, sourceId: string, domain: ImportDomain, requireSnapshot = true): void {
    const state = this.#store.read(); this.#access(state, ctx, sourceId, domain.branches, undefined, 'read');
    const overlapping = captures(state).filter(c => c.sourceId === sourceId && c.domain.company === domain.company && c.domain.dataset === domain.dataset && c.domain.branches.some(b => domain.branches.includes(b)) && (!domain.period || !c.domain.period || c.domain.period.from <= domain.period.to && domain.period.from <= c.domain.period.to));
    check(overlapping.every(c => c.status !== 'quarantined'), 'SOURCE_NOT_READY', 'An overlapping source scope has unresolved acquisition conflicts.');
    const relevant = overlapping.filter(c => digest(c.domain) === digest(domain));
    check(relevant.length > 0 && relevant.every(c => c.status === 'published' && c.coverage.reconciled && (!requireSnapshot || c.coverage.snapshotConsistent)), 'SOURCE_NOT_READY', 'The source has incomplete, conflicting or unverified acquisition evidence.');
  }
}
