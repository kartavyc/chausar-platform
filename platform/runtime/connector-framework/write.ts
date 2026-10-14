import { ActionService, canonical, current, digest, sourceAccess } from '../actions.ts';
import type { ActionResult, Connector, PreparedAction, Readback } from '../actions.ts';
import { check } from '../contracts.ts';
import type { Context, State, StateStore } from '../contracts.ts';
import { ConnectorCapabilityRegistry } from './registry.ts';
import type { ConnectorOperationScope } from './registry.ts';

/** Business quantities use declared exact wire encodings; this boundary never calculates them. */
export type WriteValue = null | boolean | string | WriteObject | readonly WriteValue[];
export type WriteObject = { readonly [field: string]: WriteValue };
export type WriteOperationScope = ConnectorOperationScope & { kind: 'write' };
export type WriteSourceScope = { sourceId: string; companyId: string; accountId: string; endpointId: string };
export type WriteEvidence = { reference: string; sha256: string };
export type WriteMappingContract = {
  revision: string;
  writableFields: readonly string[];
  preservedFields: readonly string[];
  unrepresentableCases: readonly string[];
  sourceCondition: 'atomic-version' | 'none';
  /** Required for a weaker route. A local recheck never claims source atomicity. */
  residualRace: string | null;
};
export type WriteRetryContract = {
  namespace: string;
  retention: 'provider-declared' | 'not-guaranteed';
  retentionDescription: string;
  requestEquivalence: 'exact-command-and-scope';
  automaticRetry: 'never';
};
export type WriteDefinition<P extends WriteObject> = {
  scope: WriteOperationScope;
  source: WriteSourceScope;
  title: string;
  description: string;
  impact: 'reversible' | 'message' | 'money' | 'destructive';
  definitionRevision: string;
  schemaRevision: string;
  mapping: WriteMappingContract;
  retry: WriteRetryContract;
  /** Data-only validation must reject unknown or ambiguous business meanings. */
  validatePayload: (payload: unknown) => P;
};
export type WritePreparation = {
  sourceRevision: string;
  originalSourceEvidence: WriteEvidence;
  expectedState: WriteObject;
  command: WriteObject;
  postconditions: WriteObject;
  sourceCondition: { kind: 'atomic-version'; expectedVersion: string } | { kind: 'none'; residualRace: string };
  notBefore: string | null;
  expiresAt: string;
};
/** Metadata only. Credential material must stay behind the injected provider/broker. */
export type WriteGrant = {
  operation: WriteOperationScope;
  source: WriteSourceScope;
  credentialReference: string;
  permissionRevision: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: string;
  read: boolean;
  write: boolean;
};
export type WriteAuthorization = (state: State, context: Context, operation: WriteOperationScope, source: WriteSourceScope, mode: 'read' | 'write') => WriteGrant;
export type WriteBinding = {
  operationDigest: string;
  sourceDigest: string;
  commandDigest: string;
  idempotencyKey: string;
};
/** Provider acceptance/applied claims are receipts, not independent confirmation. */
export type WriteDoReceipt = {
  binding: WriteBinding;
  outcome: 'accepted' | 'provider-claims-applied' | 'rejected' | 'unknown';
  providerReceipt: WriteEvidence | null;
  externalId: string | null;
  data: WriteObject | null;
};
export type WriteObservation =
  | { binding: WriteBinding; outcome: 'confirmed-applied'; evidence: WriteEvidence; authoritative: true; final: true; sourceRevision: string; observed: WriteObject; businessSuccess: boolean; externalId: string | null }
  | { binding: WriteBinding; outcome: 'confirmed-not-applied'; evidence: WriteEvidence; authoritative: true; final: true; absenceProof: 'authoritative-final-operation-lookup'; sourceRevision: string }
  | { binding: WriteBinding; outcome: 'conflicting' | 'inconclusive'; evidence: WriteEvidence | null; reason: string };
export type SyntheticWriteRequest<P extends WriteObject> = {
  intentId: string;
  payload: P;
  scope: WriteOperationScope;
  source: WriteSourceScope;
  preparation: WritePreparation;
  binding: WriteBinding;
};
/** Explicit injection is the only executable provider entry point. No external adapter is installed. */
export interface SyntheticWriteProvider<P extends WriteObject> {
  environment: 'synthetic';
  operation: WriteOperationScope;
  source: WriteSourceScope;
  prepare(payload: P, context: Context): Promise<WritePreparation>;
  do(request: SyntheticWriteRequest<P>, context: Context): Promise<WriteDoReceipt>;
  readback(request: SyntheticWriteRequest<P>, receipt: WriteDoReceipt | undefined, context: Context): Promise<WriteObservation>;
  reconcile(request: SyntheticWriteRequest<P>, receipt: WriteDoReceipt | undefined, context: Context): Promise<WriteObservation>;
}
type WriteEnvelope<P extends WriteObject> = {
  protocol: 'chausar-synthetic-write-v1';
  intentId: string;
  payload: P;
  preparation: WritePreparation;
  operationDigest: string;
  sourceDigest: string;
  definitionDigest: string;
  qualificationDigest: string;
  authorizationDigest: string;
};

/** The registry's tested implementation pin includes every reviewed metadata revision and source binding. */
export function writeDefinitionDigest<P extends WriteObject>(definition: WriteDefinition<P>): string {
  const { validatePayload: _validatePayload, ...metadata } = definition;
  return digest(metadata);
}

function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 1000; }
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function exactKeys(value: unknown, keys: readonly string[], code = 'INVALID_WRITE_CONTRACT'): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, code, 'Write contracts require plain JSON records.');
  check(canonical(Object.keys(value).sort()) === canonical([...keys].sort()), code, 'Write contract fields must match the declared schema.');
}
function businessObject(value: unknown): asserts value is WriteObject {
  let nodes = 0;
  const visit = (node: unknown, depth: number) => {
    check(++nodes <= 4096 && depth <= 20, 'INVALID_WRITE_PAYLOAD', 'Write parameters exceed their bounded structure.');
    if (node === null || typeof node === 'boolean' || typeof node === 'string') return;
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
    check(typeof node === 'object' && Object.getPrototypeOf(node) === Object.prototype, 'INVALID_WRITE_PAYLOAD', 'Business numbers require exact typed wire encodings.');
    for (const [field, item] of Object.entries(node)) { check(!['__proto__', 'prototype', 'constructor'].includes(field), 'INVALID_WRITE_PAYLOAD', 'Reserved parameter fields are refused.'); visit(item, depth + 1); }
  };
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_WRITE_PAYLOAD', 'Write parameters require a record.');
  visit(value, 0);
}
function evidence(value: unknown): asserts value is WriteEvidence {
  exactKeys(value, ['reference', 'sha256'], 'INVALID_WRITE_EVIDENCE');
  check(text(value.reference) && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256), 'INVALID_WRITE_EVIDENCE', 'Source observations require an evidence reference and SHA-256.');
}
function boundedRecord<T>(value: T): T {
  const wire = canonical(value);
  check(Buffer.byteLength(wire) <= 256 * 1024, 'INVALID_WRITE_CONTRACT', 'Write contracts exceed their JSON byte limit.');
  return JSON.parse(wire) as T;
}

/**
 * Opt-in ActionService integration for deterministic synthetic qualification only.
 * Approval and durable attempt journaling stay in the existing ActionService.
 * Interrupted recovery belongs to the single engine's exclusive-vault startup boundary.
 * Constructing this boundary without a provider installs no executable operations.
 */
export class QualifiedSyntheticWriteService<P extends WriteObject> {
  #store: StateStore;
  #actions: ActionService;
  #registry: ConnectorCapabilityRegistry;
  #definition: WriteDefinition<P>;
  #provider?: SyntheticWriteProvider<P>;
  #authorization: WriteAuthorization;
  #clock: () => string;
  #definitionDigest: string;
  #preparing = new Map<string, { payloadDigest: string; promise: Promise<PreparedAction> }>();

  constructor(store: StateStore, definition: WriteDefinition<P>, dependencies: { registry: ConnectorCapabilityRegistry; authorization: WriteAuthorization; provider?: SyntheticWriteProvider<P>; clock?: () => string }) {
    this.#store = store; this.#registry = dependencies.registry; this.#authorization = dependencies.authorization;
    this.#clock = dependencies.clock ?? (() => new Date().toISOString());
    const { validatePayload, ...metadata } = definition;
    this.#definition = { ...boundedRecord(metadata), validatePayload };
    this.#definitionDigest = writeDefinitionDigest(definition);
    check(definition.scope.kind === 'write' && text(definition.definitionRevision) && text(definition.schemaRevision) && text(definition.mapping.revision), 'INVALID_WRITE_DEFINITION', 'Each write requires exact independent definition, schema and mapping revisions.');
    check(definition.retry.automaticRetry === 'never' && definition.retry.requestEquivalence === 'exact-command-and-scope' && text(definition.retry.namespace) && text(definition.retry.retentionDescription), 'INVALID_WRITE_DEFINITION', 'The write profile must declare its idempotency scope and prohibit automatic retries.');
    check(definition.mapping.sourceCondition === 'atomic-version' || text(definition.mapping.residualRace), 'INVALID_WRITE_DEFINITION', 'A weaker mutation route must disclose its residual race.');
    check(Object.values(definition.source).every(text), 'INVALID_WRITE_DEFINITION', 'A write must bind its source, company, account and endpoint.');
    if (dependencies.provider) {
      check(dependencies.provider.environment === 'synthetic', 'EXTERNAL_WRITES_DISABLED', 'This runtime permits only explicitly injected synthetic write providers.');
      check(digest(dependencies.provider.operation) === digest(definition.scope) && digest(dependencies.provider.source) === digest(definition.source), 'WRITE_PROVIDER_SCOPE_MISMATCH', 'The provider must match this exact write operation and source scope.');
      this.#provider = dependencies.provider;
    }
    this.#actions = new ActionService(store, this.#provider ? [this.#connector()] : []);
  }

  catalogue(context: Context) { return this.#actions.catalogue(context); }
  list(context: Context) {
    return this.#actions.list(context).filter(action => {
      try {
        this.#envelope(action.payload);
        return canonical(action.sourceIds) === canonical([this.#definition.source.sourceId]);
      } catch { return false; }
    });
  }
  #qualified() {
    const at = this.#clock(); check(instant(at), 'INVALID_WRITE_CLOCK', 'The injected write clock must provide an unambiguous UTC instant.');
    return this.#registry.assertDefinition(this.#definition.scope, this.#definitionDigest, at, 'synthetic-tested');
  }
  #grant(state: State, context: Context, mode: 'read' | 'write') {
    const grant = boundedRecord(this.#authorization(state, structuredClone(context), structuredClone(this.#definition.scope), structuredClone(this.#definition.source), mode));
    exactKeys(grant, ['operation', 'source', 'credentialReference', 'permissionRevision', 'status', 'expiresAt', 'read', 'write'], 'INVALID_WRITE_AUTHORIZATION');
    check(grant.status === 'active' && instant(grant.expiresAt) && Date.parse(grant.expiresAt) > Date.parse(this.#clock()), 'WRITE_AUTH_EXPIRED', 'The scoped source authorization expired or was revoked.');
    check(digest(grant.operation) === digest(this.#definition.scope) && digest(grant.source) === digest(this.#definition.source) && text(grant.credentialReference) && text(grant.permissionRevision), 'WRITE_AUTH_SCOPE_MISMATCH', 'The grant must bind this exact operation, source, account and endpoint.');
    check(mode === 'read' ? grant.read === true : grant.write === true, mode === 'read' ? 'WRITE_READBACK_REVOKED' : 'WRITE_PERMISSION_REVOKED', 'The required independent source grant is unavailable.');
    return grant;
  }
  #validatePreparation(value: unknown): WritePreparation {
    exactKeys(value, ['sourceRevision', 'originalSourceEvidence', 'expectedState', 'command', 'postconditions', 'sourceCondition', 'notBefore', 'expiresAt']);
    check(text(value.sourceRevision) && instant(value.expiresAt) && (value.notBefore === null || instant(value.notBefore)), 'INVALID_WRITE_PREPARATION', 'Preparation must bind source revision and explicit business validity.');
    evidence(value.originalSourceEvidence); businessObject(value.expectedState); businessObject(value.command); businessObject(value.postconditions);
    check(Object.keys(value.command).every(field => this.#definition.mapping.writableFields.includes(field)), 'INVALID_WRITE_MAPPING', 'Source commands may change only explicitly declared writable fields.');
    check(this.#definition.mapping.preservedFields.every(field => Object.hasOwn(value.expectedState as object, field)), 'INVALID_WRITE_MAPPING', 'Preserved source fields require original-source evidence.');
    const condition = value.sourceCondition;
    check(condition !== null && typeof condition === 'object', 'INVALID_WRITE_PREPARATION', 'Preparation needs its declared source condition.');
    if (this.#definition.mapping.sourceCondition === 'atomic-version') {
      exactKeys(condition, ['kind', 'expectedVersion']);
      check(condition.kind === 'atomic-version' && condition.expectedVersion === value.sourceRevision, 'INVALID_WRITE_PREPARATION', 'A conditional command must carry the exact source version.');
    } else {
      exactKeys(condition, ['kind', 'residualRace']);
      check(condition.kind === 'none' && condition.residualRace === this.#definition.mapping.residualRace, 'INVALID_WRITE_PREPARATION', 'The preparation must preserve the declared residual race.');
    }
    return boundedRecord(value) as WritePreparation;
  }
  #window(preparation: WritePreparation) {
    const at = Date.parse(this.#clock());
    check(at < Date.parse(preparation.expiresAt) && (preparation.notBefore === null || at >= Date.parse(preparation.notBefore)), 'WRITE_BUSINESS_WINDOW_CLOSED', 'This prepared intent is outside its permitted dispatch window. Prepare a new action.');
  }
  #envelope(value: unknown): WriteEnvelope<P> {
    exactKeys(value, ['protocol', 'intentId', 'payload', 'preparation', 'operationDigest', 'sourceDigest', 'definitionDigest', 'qualificationDigest', 'authorizationDigest']);
    check(value.protocol === 'chausar-synthetic-write-v1' && text(value.intentId) && value.operationDigest === digest(this.#definition.scope) && value.sourceDigest === digest(this.#definition.source) && value.definitionDigest === this.#definitionDigest, 'WRITE_BINDING_CHANGED', 'This preparation belongs to another operation, source or definition revision.');
    const payload = this.#definition.validatePayload(value.payload); businessObject(payload);
    check(canonical(payload) === canonical(value.payload), 'INVALID_WRITE_PAYLOAD', 'Validated write meaning must match the exact reviewed parameters.');
    this.#validatePreparation(value.preparation);
    check(typeof value.qualificationDigest === 'string' && /^[a-f0-9]{64}$/.test(value.qualificationDigest) && typeof value.authorizationDigest === 'string' && /^[a-f0-9]{64}$/.test(value.authorizationDigest), 'WRITE_BINDING_CHANGED', 'Preparation requires exact qualification and authorization bindings.');
    return boundedRecord(value) as WriteEnvelope<P>;
  }
  #revalidate(envelope: WriteEnvelope<P>, state: State, context: Context, mode: 'read' | 'write') {
    const qualification = this.#qualified();
    if (mode === 'write') check(qualification.digest === envelope.qualificationDigest, 'WRITE_QUALIFICATION_CHANGED', 'Qualification changed after preparation. New dispatch requires fresh preparation.');
    const grant = this.#grant(state, context, mode);
    if (mode === 'write') { check(digest(grant) === envelope.authorizationDigest, 'WRITE_AUTHORITY_CHANGED', 'Source authority changed after preparation. Review a new exact preparation.'); this.#window(envelope.preparation); }
  }
  #binding(envelope: WriteEnvelope<P>, key: string): WriteBinding {
    return { operationDigest: envelope.operationDigest, sourceDigest: envelope.sourceDigest, commandDigest: digest({ command: envelope.preparation.command, postconditions: envelope.preparation.postconditions, sourceCondition: envelope.preparation.sourceCondition }), idempotencyKey: key };
  }
  #request(envelope: WriteEnvelope<P>, key: string): SyntheticWriteRequest<P> {
    return { intentId: envelope.intentId, payload: structuredClone(envelope.payload), scope: structuredClone(this.#definition.scope), source: structuredClone(this.#definition.source), preparation: structuredClone(envelope.preparation), binding: this.#binding(envelope, key) };
  }
  #doReceipt(value: unknown, binding: WriteBinding): WriteDoReceipt {
    exactKeys(value, ['binding', 'outcome', 'providerReceipt', 'externalId', 'data'], 'INVALID_WRITE_RECEIPT');
    check(digest(value.binding) === digest(binding) && ['accepted', 'provider-claims-applied', 'rejected', 'unknown'].includes(String(value.outcome)), 'INVALID_WRITE_RECEIPT', 'A provider receipt must correlate to the exact command and operation identity.');
    if (value.providerReceipt !== null) evidence(value.providerReceipt);
    if (value.data !== null) businessObject(value.data);
    check(value.externalId === null || text(value.externalId), 'INVALID_WRITE_RECEIPT', 'A provider receipt needs a bounded external identity.');
    return boundedRecord(value) as WriteDoReceipt;
  }
  #observation(value: unknown, binding: WriteBinding, preparation: WritePreparation): Readback {
    check(value !== null && typeof value === 'object', 'INVALID_WRITE_OBSERVATION', 'An observation must declare its proof and outcome.');
    const record = value as Record<string, unknown>;
    check(digest(record.binding) === digest(binding), 'INVALID_WRITE_OBSERVATION', 'Observation evidence must correlate to this exact command, scope and operation identity.');
    if (record.outcome === 'confirmed-applied') {
      exactKeys(record, ['binding', 'outcome', 'evidence', 'authoritative', 'final', 'sourceRevision', 'observed', 'businessSuccess', 'externalId'], 'INVALID_WRITE_OBSERVATION');
      evidence(record.evidence); businessObject(record.observed);
      check(record.authoritative === true && record.final === true && text(record.sourceRevision) && typeof record.businessSuccess === 'boolean' && (record.externalId === null || text(record.externalId)), 'INVALID_WRITE_OBSERVATION', 'Applied effects need authoritative final source evidence; business success is separate.');
      const observed = record.observed;
      check(Object.entries(preparation.postconditions).every(([field, expected]) => Object.hasOwn(observed, field) && canonical(observed[field]) === canonical(expected)), 'WRITE_POSTCONDITION_MISMATCH', 'Source observation does not establish the exact approved postconditions.');
      check(this.#definition.mapping.preservedFields.every(field => Object.hasOwn(observed, field) && canonical(observed[field]) === canonical(preparation.expectedState[field])), 'WRITE_PRESERVATION_MISMATCH', 'Readback must prove preservation before canonical normalization.');
      return { verified: true, businessSuccess: record.businessSuccess, data: boundedRecord(record), ...(record.externalId === null ? {} : { externalId: record.externalId as string }) };
    }
    if (record.outcome === 'confirmed-not-applied') {
      exactKeys(record, ['binding', 'outcome', 'evidence', 'authoritative', 'final', 'absenceProof', 'sourceRevision'], 'INVALID_WRITE_OBSERVATION'); evidence(record.evidence);
      check(record.authoritative === true && record.final === true && record.absenceProof === 'authoritative-final-operation-lookup' && text(record.sourceRevision), 'INVALID_WRITE_OBSERVATION', 'An empty or lagging lookup is not authoritative absence proof.');
      return { verified: false, businessSuccess: false, absent: true, data: boundedRecord(record) };
    }
    exactKeys(record, ['binding', 'outcome', 'evidence', 'reason'], 'INVALID_WRITE_OBSERVATION');
    check(['conflicting', 'inconclusive'].includes(String(record.outcome)) && text(record.reason), 'INVALID_WRITE_OBSERVATION', 'Unresolved observations require an explicit uncertainty reason.');
    if (record.evidence !== null) evidence(record.evidence);
    return { verified: false, businessSuccess: false, data: boundedRecord(record) };
  }
  #connector(): Connector {
    const definition = this.#definition;
    return { id: definition.scope.connectorId, title: definition.title, operations: { [definition.scope.operationId]: {
      title: definition.title, description: definition.description, impact: definition.impact,
      idempotency: `${definition.retry.namespace}: stable business intent, exact command/account/endpoint; automatic retry never; ${definition.retry.retentionDescription}`,
      readback: 'Independent authoritative final source observation, exact command correlation; provider acceptance does not prove application.',
      validate: payload => this.#envelope(payload) as unknown as Record<string, unknown>,
      authorize: (state, context, mode) => { this.#qualified(); this.#grant(state, context, mode); },
      execute: async (payload, key, context): Promise<ActionResult> => {
        const envelope = this.#envelope(payload); this.#revalidate(envelope, this.#store.read(), context, 'write');
        const receipt = this.#doReceipt(await this.#provider!.do(this.#request(envelope, key), context), this.#binding(envelope, key));
        return { data: receipt, ...(receipt.externalId === null ? {} : { externalId: receipt.externalId }) };
      },
      reconcile: async (payload, key, result, context): Promise<Readback> => {
        const envelope = this.#envelope(payload); this.#revalidate(envelope, this.#store.read(), context, 'read');
        const request = this.#request(envelope, key); const receipt = result === undefined ? undefined : this.#doReceipt(result.data, request.binding);
        const action = this.#store.read().actions.find((item: PreparedAction) => item.connector === definition.scope.connectorId && item.operation === definition.scope.operationId && item.idempotencyKey === key) as PreparedAction | undefined;
        const observation = action?.status === 'executing' ? await this.#provider!.readback(request, receipt, context) : await this.#provider!.reconcile(request, receipt, context);
        this.#revalidate(envelope, this.#store.read(), context, 'read');
        return this.#observation(observation, request.binding, envelope.preparation);
      },
    } } };
  }
  #action(context: Context, id: string) {
    const action = this.list(context).find(item => item.id === id);
    check(action, 'NOT_FOUND', 'The prepared write is unavailable in the current source scope.'); return action;
  }
  async prepare(context: Context, request: { intentId: string; payload: unknown }): Promise<PreparedAction> {
    context = structuredClone(context);
    check(this.#provider, 'EXTERNAL_WRITES_DISABLED', 'No executable provider is installed. Explicit synthetic injection is required.');
    const intentId = request.intentId;
    check(text(intentId), 'INVALID_WRITE_INTENT', 'A write requires a stable identity for its intended business occurrence.');
    current(this.#store.read(), context, 'prepare'); sourceAccess(this.#store.read(), context, [this.#definition.source.sourceId]);
    this.#grant(this.#store.read(), context, 'read');
    const qualification = this.#qualified(); const grant = this.#grant(this.#store.read(), context, 'write');
    const payload = boundedRecord(this.#definition.validatePayload(boundedRecord(request.payload))); businessObject(payload);
    const key = `write-${digest({ operation: this.#definition.scope, source: this.#definition.source, intentId })}`;
    const existing = this.list(context).find(action => action.connector === this.#definition.scope.connectorId && action.operation === this.#definition.scope.operationId && action.idempotencyKey === key);
    if (existing) {
      const envelope = this.#envelope(existing.payload);
      check(canonical(payload) === canonical(envelope.payload), 'IDEMPOTENCY_CONFLICT', 'This business occurrence already binds different exact parameters. Revise its unattempted preparation or use an independently authorized occurrence.');
      check(existing.status !== 'cancelled', 'WRITE_INTENT_CANCELLED', 'This business occurrence was cancelled. A repeat requires an independently authorized occurrence.');
      return existing;
    }
    const pending = this.#preparing.get(key);
    if (pending) {
      check(pending.payloadDigest === digest(payload), 'IDEMPOTENCY_CONFLICT', 'This business occurrence is already preparing different exact parameters.');
      const prepared = await pending.promise;
      current(this.#store.read(), context, 'prepare'); sourceAccess(this.#store.read(), context, prepared.sourceIds); this.#grant(this.#store.read(), context, 'write'); this.#grant(this.#store.read(), context, 'read');
      return structuredClone(prepared);
    }
    const promise = (async () => {
      const preparation = this.#validatePreparation(await this.#provider!.prepare(structuredClone(payload), structuredClone(context)));
      const envelope: WriteEnvelope<P> = { protocol: 'chausar-synthetic-write-v1', intentId, payload, preparation, operationDigest: digest(this.#definition.scope), sourceDigest: digest(this.#definition.source), definitionDigest: this.#definitionDigest, qualificationDigest: qualification.digest, authorizationDigest: digest(grant) };
      this.#revalidate(envelope, this.#store.read(), context, 'read');
      this.#revalidate(envelope, this.#store.read(), context, 'write');
      const prepared = await this.#actions.prepare(context, { connector: this.#definition.scope.connectorId, operation: this.#definition.scope.operationId, payload: envelope, idempotencyKey: key, sourceIds: [this.#definition.source.sourceId] });
      current(this.#store.read(), context, 'prepare'); sourceAccess(this.#store.read(), context, prepared.sourceIds); this.#grant(this.#store.read(), context, 'read');
      return prepared;
    })();
    this.#preparing.set(key, { payloadDigest: digest(payload), promise });
    try { return await promise; } finally { if (this.#preparing.get(key)?.promise === promise) this.#preparing.delete(key); }
  }
  /** Refresh only unattempted intent, retaining its operation key and invalidating prior approval. */
  async refresh(context: Context, id: string, payload: unknown) {
    context = structuredClone(context);
    const action = this.#action(context, id);
    check(action.attempts.length === 0 && action.status !== 'cancelled', 'ACTION_ALREADY_ATTEMPTED', 'Only an unattempted, uncancelled intent can be refreshed. Unknown outcomes require read-only reconciliation.');
    current(this.#store.read(), context, 'prepare'); sourceAccess(this.#store.read(), context, action.sourceIds);
    this.#grant(this.#store.read(), context, 'read');
    const prior = this.#envelope(action.payload); const validated = boundedRecord(this.#definition.validatePayload(boundedRecord(payload))); businessObject(validated);
    const qualification = this.#qualified(); const grant = this.#grant(this.#store.read(), context, 'write');
    this.#grant(this.#store.read(), context, 'read');
    const preparation = this.#validatePreparation(await this.#provider!.prepare(structuredClone(validated), structuredClone(context)));
    const envelope: WriteEnvelope<P> = { ...prior, payload: validated, preparation, qualificationDigest: qualification.digest, authorizationDigest: digest(grant) };
    this.#revalidate(envelope, this.#store.read(), context, 'read');
    this.#revalidate(envelope, this.#store.read(), context, 'write');
    const refreshed = await this.#actions.revise(context, id, envelope);
    current(this.#store.read(), context, 'prepare'); sourceAccess(this.#store.read(), context, refreshed.sourceIds); this.#grant(this.#store.read(), context, 'read');
    return refreshed;
  }
  async approve(context: Context, id: string, expectedDigest: string) {
    const action = this.#action(context, id); this.#revalidate(this.#envelope(action.payload), this.#store.read(), context, 'write');
    return this.#actions.approve(context, id, expectedDigest);
  }
  async do(context: Context, id: string) {
    const action = this.#action(context, id); this.#revalidate(this.#envelope(action.payload), this.#store.read(), context, 'write');
    const settled = await this.#actions.execute(context, id);
    this.#grant(this.#store.read(), context, 'read');
    return settled;
  }
  /** Read-only recovery; expiry of the business window or write grant never authorizes another do. */
  async reconcile(context: Context, id: string) {
    this.#action(context, id);
    const settled = await this.#actions.reconcile(context, id);
    this.#grant(this.#store.read(), context, 'read');
    return settled;
  }
  async cancel(context: Context, id: string) { this.#action(context, id); return this.#actions.cancel(context, id); }
}

/**
 * The catalogue writeback bridge (platform/runtime/writeback). A catalogue adapter reports what it
 * observed in the system; this turns that into the ActionService read-back with the same rules as
 * the qualified path above: an applied effect must show every approved postcondition, an empty or
 * lagging lookup is never absence, and business success stays separate from application.
 */
export type CatalogueObservation =
  | { outcome: 'confirmed-applied'; observed: WriteObject; externalId: string | null; businessSuccess: boolean }
  | { outcome: 'confirmed-not-applied'; reason: string }
  | { outcome: 'inconclusive' | 'conflicting'; reason: string };
export function catalogueReadback(value: unknown, postconditions: WriteObject): Readback {
  check(value !== null && typeof value === 'object', 'INVALID_WRITE_OBSERVATION', 'An observation must declare its outcome.');
  const record = value as Record<string, unknown>;
  if (record.outcome === 'confirmed-applied') {
    exactKeys(record, ['outcome', 'observed', 'externalId', 'businessSuccess'], 'INVALID_WRITE_OBSERVATION');
    check(record.observed !== null && typeof record.observed === 'object' && !Array.isArray(record.observed) && typeof record.businessSuccess === 'boolean' && (record.externalId === null || text(record.externalId)), 'INVALID_WRITE_OBSERVATION', 'Applied effects need the observed record and a separate business result.');
    const observed = boundedRecord(record.observed) as Record<string, unknown>;
    const mismatched = Object.entries(postconditions).filter(([field, expected]) => !Object.hasOwn(observed, field) || canonical(observed[field]) !== canonical(expected)).map(([field]) => field);
    const evidence = { reference: 'catalogue-readback', sha256: digest(observed) };
    if (mismatched.length) return { verified: false, businessSuccess: false, data: { outcome: 'conflicting', reason: 'The system shows a different result than the approved change.', mismatched, observed: observed as WriteObject, evidence } };
    return { verified: true, businessSuccess: record.businessSuccess, data: { outcome: 'confirmed-applied', observed: observed as WriteObject, evidence }, ...(record.externalId === null ? {} : { externalId: record.externalId as string }) };
  }
  if (record.outcome === 'confirmed-not-applied') {
    exactKeys(record, ['outcome', 'reason'], 'INVALID_WRITE_OBSERVATION'); check(text(record.reason), 'INVALID_WRITE_OBSERVATION', 'Absence needs its reason.');
    return { verified: false, businessSuccess: false, absent: true, data: { outcome: 'confirmed-not-applied', reason: record.reason } };
  }
  exactKeys(record, ['outcome', 'reason'], 'INVALID_WRITE_OBSERVATION');
  check(['conflicting', 'inconclusive'].includes(String(record.outcome)) && text(record.reason), 'INVALID_WRITE_OBSERVATION', 'Unresolved observations require an explicit uncertainty reason.');
  return { verified: false, businessSuccess: false, data: { outcome: record.outcome as string, reason: record.reason as string } };
}
