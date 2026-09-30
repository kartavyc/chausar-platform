import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../runtime/actions.ts';
import { check, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ConnectorCapabilityRegistry } from '../runtime/connector-framework/registry.ts';
import type { ConnectorEvidence, ConnectorOperationRegistration } from '../runtime/connector-framework/registry.ts';
import { QualifiedSyntheticWriteService, writeDefinitionDigest } from '../runtime/connector-framework/write.ts';
import type { SyntheticWriteProvider, SyntheticWriteRequest, WriteDefinition, WriteDoReceipt, WriteGrant, WriteObject, WriteObservation, WriteOperationScope, WriteSourceScope } from '../runtime/connector-framework/write.ts';

class Store implements StateStore {
  state = initialState('Synthetic write contract', true);
  queue = Promise.resolve();
  read(): State { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => { const state = this.read(); const result = await change(state); state.revision += 1; this.state = state; return result; });
    this.queue = run.then(() => {}, () => {}); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const scope: WriteOperationScope = {
  connectorId: 'synthetic-ledger', connectorVersion: 'fixture-v1', operationId: 'append-note', kind: 'write', transport: 'api',
  applicability: { applicationVersion: 'fixture-v1', edition: 'synthetic', module: 'notes', configuration: 'fixture-config', deploymentProfile: 'isolated-test' },
};
const source: WriteSourceScope = { sourceId: 'synthetic-source', companyId: 'synthetic-company', accountId: 'synthetic-account', endpointId: 'in-memory-fixture' };
const proof = { reference: 'synthetic-ledger-state', sha256: digest({ fixture: 'connector-write-contracts-v1' }) };
type Payload = { memo: string; amountMinor: string };
const payload: Payload = { memo: 'Reviewed memo', amountMinor: '900719925474099312345' };
function definition(): WriteDefinition<Payload> {
  return {
    scope, source, title: 'Synthetic note', description: 'Deterministic in-memory contract; no remote effect.', impact: 'reversible', definitionRevision: 'definition-v1', schemaRevision: 'schema-v1',
    mapping: { revision: 'mapping-v1', writableFields: ['memo', 'amountMinor'], preservedFields: ['marker'], unrepresentableCases: ['missing amount meaning'], sourceCondition: 'atomic-version', residualRace: null },
    retry: { namespace: 'synthetic-company/notes', retention: 'not-guaranteed', retentionDescription: 'No external idempotency guarantee is claimed.', requestEquivalence: 'exact-command-and-scope', automaticRetry: 'never' },
    validatePayload: value => {
      check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_WRITE_PAYLOAD', 'A typed payload is required.');
      const record = value as Record<string, unknown>;
      check(Object.keys(record).sort().join(',') === 'amountMinor,memo' && typeof record.memo === 'string' && record.memo.length > 0 && typeof record.amountMinor === 'string' && /^-?\d+$/.test(record.amountMinor), 'INVALID_WRITE_PAYLOAD', 'Money meaning must be explicit and encoded exactly; unknown fields are refused.');
      return { memo: record.memo, amountMinor: record.amountMinor };
    },
  };
}
function registry(readOnly = false, profile = definition(), evidenceId = 'synthetic-write-proof') {
  const implementationDigest = writeDefinitionDigest(profile);
  const registration: ConnectorOperationRegistration = { scope, implemented: true, capabilities: [], evidenceIds: [evidenceId], limitations: ['Synthetic tests only; external writes disabled.'], implementationDigest };
  const evidence: ConnectorEvidence = {
    id: evidenceId, scope: readOnly ? { ...scope, kind: 'read' } : scope, implementationDigest,
    assertions: readOnly ? ['operation'] : ['operation', 'prepare', 'approve', 'do', 'readback', 'reconcile'],
    observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z', artifact: proof, notes: ['In-memory test evidence only.'],
    environment: 'synthetic', provenance: { kind: 'synthetic-fixture', generatorVersion: 'connector-write-contracts-v1' },
  };
  return new ConnectorCapabilityRegistry([registration], [evidence]);
}
function fixture(options: { injected?: boolean; readOnlyEvidence?: boolean; impact?: WriteDefinition<Payload>['impact'] } = {}) {
  const store = new Store();
  const profile = definition(); if (options.impact) profile.impact = options.impact;
  const capabilities = registry(options.readOnlyEvidence, profile);
  let at = '2026-09-30T12:00:00.000Z';
  let read = true, write = true, permissionRevision = 'permission-v1';
  let authExpiresAt = '2026-10-02T00:00:00.000Z';
  let sourceRevision = 'source-v1';
  let actual: { key: string; data: WriteObject } | undefined;
  let lostAck = false, pending = false, preparationCalls = 0, doCalls = 0, readbackCalls = 0, reconcileCalls = 0;
  let readbackHook: (() => void) | undefined;
  let override: ((request: SyntheticWriteRequest<Payload>, observation: WriteObservation) => WriteObservation) | undefined;
  const observation = (request: SyntheticWriteRequest<Payload>): WriteObservation => {
    if (pending) return { binding: request.binding, outcome: 'inconclusive', evidence: null, reason: 'Source processing is still pending; a lagging index is not absence proof.' };
    if (actual?.key === request.binding.idempotencyKey) return { binding: request.binding, outcome: 'confirmed-applied', evidence: proof, authoritative: true, final: true, sourceRevision, observed: actual.data, businessSuccess: false, externalId: actual.key };
    return { binding: request.binding, outcome: 'confirmed-not-applied', evidence: proof, authoritative: true, final: true, absenceProof: 'authoritative-final-operation-lookup', sourceRevision };
  };
  const provider: SyntheticWriteProvider<Payload> = {
    environment: 'synthetic', operation: scope, source,
    prepare: async value => {
      preparationCalls += 1;
      return { sourceRevision, originalSourceEvidence: proof, expectedState: { marker: 'preserve-source-distinction' }, command: value, postconditions: value, sourceCondition: { kind: 'atomic-version', expectedVersion: sourceRevision }, notBefore: null, expiresAt: '2026-10-01T00:00:00.000Z' };
    },
    do: async request => {
      doCalls += 1;
      check(request.preparation.sourceCondition.kind === 'atomic-version' && request.preparation.sourceCondition.expectedVersion === sourceRevision, 'SOURCE_CONDITION_CONFLICT', 'The synthetic source rejects stale conditional mutation.');
      actual = { key: request.binding.idempotencyKey, data: { ...request.preparation.command, marker: 'preserve-source-distinction' } }; sourceRevision = 'source-v2';
      if (lostAck) throw new Error('Synthetic lost acknowledgement after commit.');
      return { binding: request.binding, outcome: 'accepted', providerReceipt: proof, externalId: actual.key, data: { accepted: true } };
    },
    readback: async request => { readbackCalls += 1; readbackHook?.(); const value = observation(request); return override ? override(request, value) : value; },
    reconcile: async request => { reconcileCalls += 1; const value = observation(request); return override ? override(request, value) : value; },
  };
  const authorization = (): WriteGrant => ({ operation: scope, source, credentialReference: 'synthetic-grant-metadata-only', permissionRevision, status: 'active', expiresAt: authExpiresAt, read, write });
  const service = new QualifiedSyntheticWriteService(store, profile, { registry: capabilities, authorization, provider: options.injected === false ? undefined : provider, clock: () => at });
  return {
    store, capabilities, profile, provider, authorization, service,
    counts: () => ({ preparationCalls, doCalls, readbackCalls, reconcileCalls }),
    actual: () => structuredClone(actual),
    setTime: (value: string) => { at = value; },
    expireAuthorization: () => { authExpiresAt = at; },
    revokeRead: () => { read = false; }, revokeWrite: () => { write = false; },
    changePermissionRevision: () => { permissionRevision = 'permission-v2'; },
    changeSourceRevision: () => { sourceRevision = 'intervening-human-source-version'; },
    loseAcknowledgement: () => { lostAck = true; }, pending: (value = true) => { pending = value; },
    onReadback: (hook: () => void) => { readbackHook = hook; },
    overrideObservation: (change: typeof override) => { override = change; },
  };
}
async function approved(f: ReturnType<typeof fixture>, intentId = 'business-occurrence-1') {
  const action = await f.service.prepare(owner, { intentId, payload }); await f.service.approve(owner, action.id, action.digest); return action;
}

test('default boundary installs no executable operations and rejects external provider injection', async () => {
  const f = fixture({ injected: false }); assert.deepEqual(f.service.catalogue(owner), []);
  await assert.rejects(f.service.prepare(owner, { intentId: 'disabled', payload }), { code: 'EXTERNAL_WRITES_DISABLED' });
  assert.throws(() => new QualifiedSyntheticWriteService(f.store, f.profile, { registry: f.capabilities, authorization: f.authorization, provider: { ...f.provider, environment: 'live' } as unknown as SyntheticWriteProvider<Payload> }), { code: 'EXTERNAL_WRITES_DISABLED' });
  assert.deepEqual(f.counts(), { preparationCalls: 0, doCalls: 0, readbackCalls: 0, reconcileCalls: 0 });
});

test('read evidence cannot qualify preparation or dispatch of any write', async () => {
  const f = fixture({ readOnlyEvidence: true });
  await assert.rejects(f.service.prepare(owner, { intentId: 'read-is-not-write', payload }), { code: 'CONNECTOR_NOT_QUALIFIED' });
  assert.equal(f.counts().preparationCalls, 0); assert.equal(f.counts().doCalls, 0);
});

test('workspace and source revocation stop provider preparation before it observes business parameters', async () => {
  for (const revoke of [(f: ReturnType<typeof fixture>) => { f.store.state.members[0].epoch += 1; }, (f: ReturnType<typeof fixture>) => { f.store.state.policy.allowedSources = []; }]) {
    const f = fixture(); revoke(f);
    await assert.rejects(f.service.prepare(owner, { intentId: 'revoked-before-preparation', payload }));
    assert.equal(f.counts().preparationCalls, 0); assert.equal(f.store.state.actions.length, 0);
  }
});

test('a source write grant never authorizes reading original source state during preparation', async () => {
  const f = fixture(); f.revokeRead();
  await assert.rejects(f.service.prepare(owner, { intentId: 'write-only-source-grant', payload }), { code: 'WRITE_READBACK_REVOKED' });
  assert.equal(f.counts().preparationCalls, 0); assert.equal(f.store.state.actions.length, 0);
});

test('approved do uses exact large-integer parameters, preserves source distinctions and separates business success', async () => {
  const f = fixture(); const action = await approved(f);
  const done = await f.service.do(owner, action.id);
  assert.equal(done.status, 'verified'); assert.equal(done.businessSuccess, false);
  assert.equal(f.actual()?.data.amountMinor, payload.amountMinor); assert.equal(f.actual()?.data.marker, 'preserve-source-distinction');
  assert.deepEqual(f.counts(), { preparationCalls: 1, doCalls: 1, readbackCalls: 1, reconcileCalls: 0 });
  assert.equal(f.capabilities.qualification(scope, '2026-09-30T12:00:00.000Z').level, 'synthetic-tested');
  assert.match(JSON.stringify(done.payload), /qualificationDigest/); assert.ok(!JSON.stringify(done.payload).includes('synthetic-grant-metadata-only'));
});

test('missing money, float numbers, unknown fields and invented source meanings never dispatch', async () => {
  for (const invalid of [{ memo: 'Missing amount' }, { ...payload, amountMinor: 123.45 }, { ...payload, amountMinor: 'unknown' }, { ...payload, sql: 'UPDATE source' }]) {
    const f = fixture(); await assert.rejects(f.service.prepare(owner, { intentId: 'invalid-meaning', payload: invalid }), { code: 'INVALID_WRITE_PAYLOAD' });
    assert.equal(f.counts().preparationCalls, 0); assert.equal(f.counts().doCalls, 0);
  }
});

test('business occurrence identity deduplicates requests and forbids replacing unknown intent with a new transport key', async () => {
  const f = fixture(); f.loseAcknowledgement(); const action = await approved(f);
  assert.equal((await f.service.do(owner, action.id)).status, 'unknown');
  const duplicate = await f.service.prepare(owner, { intentId: 'business-occurrence-1', payload });
  assert.equal(duplicate.id, action.id); assert.equal(f.counts().doCalls, 1); assert.equal(f.counts().preparationCalls, 1);
  await assert.rejects(f.service.prepare(owner, { intentId: 'business-occurrence-1', payload: { ...payload, memo: 'Changed intention' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.service.do(owner, action.id), { code: 'ACTION_ALREADY_ATTEMPTED' });
  assert.equal((await f.service.reconcile(owner, action.id)).status, 'verified'); assert.equal(f.counts().doCalls, 1); assert.equal(f.counts().reconcileCalls, 1);
});

test('same-valued independent business occurrences retain distinct stable operation keys', async () => {
  const f = fixture(); const first = await f.service.prepare(owner, { intentId: 'obligation-one', payload }); const second = await f.service.prepare(owner, { intentId: 'obligation-two', payload });
  assert.notEqual(first.idempotencyKey, second.idempotencyKey); assert.equal(f.store.state.actions.length, 2);
});

test('source command and postcondition tampering invalidates approval before any provider effect', async () => {
  const f = fixture(); const action = await approved(f);
  const envelope = f.store.state.actions[0].payload; envelope.preparation.command.memo = 'Tampered command';
  await assert.rejects(f.service.do(owner, action.id), { code: 'PREVIEW_CHANGED' }); assert.equal(f.counts().doCalls, 0);
  const stale = fixture(); const prepared = await stale.service.prepare(owner, { intentId: 'wrong-approval', payload });
  await assert.rejects(stale.service.approve(owner, prepared.id, '0'.repeat(64)), { code: 'PREVIEW_CHANGED' });
});

test('current source grants, credential revision, qualifier revocation and expired auth prevent approved dispatch', async () => {
  for (const revoke of [(f: ReturnType<typeof fixture>) => f.revokeWrite(), (f: ReturnType<typeof fixture>) => f.changePermissionRevision(), (f: ReturnType<typeof fixture>) => f.expireAuthorization(), (f: ReturnType<typeof fixture>) => f.capabilities.revokeEvidence('synthetic-write-proof', '2026-09-30T12:00:00.000Z', 'fixture proof withdrawn')]) {
    const f = fixture(); const action = await approved(f); revoke(f);
    await assert.rejects(f.service.do(owner, action.id)); assert.equal(f.counts().doCalls, 0); assert.equal(f.store.state.actions[0].attempts.length, 0);
  }
});

test('business expiry blocks new do while read-only reconciliation remains possible after a dispatched uncertainty', async () => {
  const expired = fixture(); const action = await approved(expired); expired.setTime('2026-10-01T12:00:00.000Z');
  await assert.rejects(expired.service.do(owner, action.id), { code: 'WRITE_BUSINESS_WINDOW_CLOSED' }); assert.equal(expired.counts().doCalls, 0);
  const uncertain = fixture(); uncertain.loseAcknowledgement(); const attempted = await approved(uncertain); await uncertain.service.do(owner, attempted.id);
  uncertain.setTime('2026-10-01T12:00:00.000Z'); uncertain.revokeWrite();
  assert.equal((await uncertain.service.reconcile(owner, attempted.id)).status, 'verified'); assert.equal(uncertain.counts().doCalls, 1);
});

test('source-enforced version precondition prevents intervening edits from being overwritten', async () => {
  const f = fixture(); const action = await approved(f); f.changeSourceRevision();
  const attempted = await f.service.do(owner, action.id); assert.equal(attempted.status, 'unknown'); assert.equal(attempted.attempts[0].error, 'SOURCE_CONDITION_CONFLICT'); assert.equal(f.actual(), undefined);
  const resolved = await f.service.reconcile(owner, action.id); assert.equal(resolved.status, 'rejected'); assert.equal(resolved.businessSuccess, false);
  await assert.rejects(f.service.do(owner, action.id), { code: 'ACTION_ALREADY_ATTEMPTED' }); assert.equal(f.counts().doCalls, 1);
});

test('accepted asynchronous work and lagging lookup remain unknown until final source observation', async () => {
  const f = fixture(); f.pending(); const action = await approved(f);
  const attempted = await f.service.do(owner, action.id); assert.equal(attempted.status, 'unknown'); assert.equal(attempted.businessSuccess, undefined);
  assert.equal((attempted.result?.data as WriteDoReceipt).outcome, 'accepted');
  assert.equal((await f.service.reconcile(owner, action.id)).status, 'unknown'); assert.equal(f.counts().doCalls, 1);
  f.pending(false); assert.equal((await f.service.reconcile(owner, action.id)).status, 'verified'); assert.equal(f.counts().doCalls, 1);
});

test('readback must prove exact postconditions and preserved fields before normalization', async () => {
  for (const wrong of [{ ...payload, marker: 'Changed preserved field' }, { ...payload, memo: 'Different source meaning', marker: 'preserve-source-distinction' }]) {
    const f = fixture(); f.overrideObservation((_request, observation) => observation.outcome === 'confirmed-applied' ? { ...observation, observed: wrong } : observation);
    const action = await approved(f); const attempted = await f.service.do(owner, action.id);
    assert.equal(attempted.status, 'unknown'); assert.equal(attempted.businessSuccess, undefined); assert.equal(f.counts().doCalls, 1);
  }
});

test('foreign, conflicting and unfinalized observation evidence cannot confirm application or absence', async () => {
  const changes = [
    (request: SyntheticWriteRequest<Payload>, observation: WriteObservation) => ({ ...observation, binding: { ...request.binding, idempotencyKey: 'foreign-operation-key' } }),
    (request: SyntheticWriteRequest<Payload>) => ({ binding: request.binding, outcome: 'conflicting' as const, evidence: proof, reason: 'Two same-valued source candidates have different operation identities.' }),
    (_request: SyntheticWriteRequest<Payload>, observation: WriteObservation) => ({ ...observation, final: false } as unknown as WriteObservation),
  ];
  for (const change of changes) {
    const f = fixture(); f.overrideObservation(change); const action = await approved(f); assert.equal((await f.service.do(owner, action.id)).status, 'unknown'); assert.equal(f.counts().doCalls, 1);
  }
});

test('read revocation in flight retains durable uncertainty and withholds observation data', async () => {
  const f = fixture(); f.onReadback(() => f.revokeRead()); const action = await approved(f);
  await assert.rejects(f.service.do(owner, action.id), { code: 'WRITE_READBACK_REVOKED' });
  const attempted = f.store.state.actions[0]; assert.equal(attempted.status, 'unknown'); assert.equal(attempted.readback, undefined); assert.equal(attempted.attempts[0].error, 'WRITE_READBACK_REVOKED');
  await assert.rejects(f.service.reconcile(owner, action.id), { code: 'NOT_FOUND' }); assert.deepEqual(f.service.list(owner), []); assert.equal(f.counts().doCalls, 1);
});

test('concurrent do requests reserve one durable attempt and never retry a provider mutation', async () => {
  const f = fixture(); const action = await approved(f);
  const runs = await Promise.allSettled([f.service.do(owner, action.id), f.service.do(owner, action.id)]);
  assert.equal(runs.filter(value => value.status === 'fulfilled').length, 1); assert.equal(f.counts().doCalls, 1); assert.equal(f.store.state.actions[0].attempts.length, 1);
});

test('phone, tainted input and revoked approver epoch cannot execute an approved write', async () => {
  for (const context of [{ ...owner, channel: 'phone' as const }, { ...owner, sourceTainted: true }]) {
    const f = fixture(); const action = await approved(f); await assert.rejects(f.service.do(context, action.id)); assert.equal(f.counts().doCalls, 0);
  }
  const f = fixture(); const action = await approved(f); f.store.state.members[0].epoch += 1;
  await assert.rejects(f.service.do(owner, action.id)); assert.equal(f.counts().doCalls, 0);
});

test('shared connector and operation IDs never expose or cancel a different account preparation', async () => {
  const f = fixture(); const sourceB = { ...source, sourceId: 'other-source', accountId: 'other-account' };
  const profileB = { ...definition(), source: sourceB };
  const providerB = { ...f.provider, source: sourceB };
  const serviceB = new QualifiedSyntheticWriteService(f.store, profileB, { registry: registry(false, profileB), provider: providerB, authorization: () => ({ ...f.authorization(), source: sourceB }), clock: () => '2026-09-30T12:00:00.000Z' });
  const actionB = await serviceB.prepare(owner, { intentId: 'other-account-intent', payload: { ...payload, memo: 'Private other-account parameters' } });
  assert.deepEqual(f.service.list(owner), []); assert.equal(serviceB.list(owner).length, 1);
  await assert.rejects(f.service.cancel(owner, actionB.id), { code: 'NOT_FOUND' }); await assert.rejects(f.service.reconcile(owner, actionB.id), { code: 'NOT_FOUND' });
  assert.equal(f.store.state.actions[0].status, 'prepared'); assert.equal(f.counts().doCalls, 0);
});

test('current renewed proof reconciles an unknown outcome while stale approval cannot dispatch', async () => {
  const f = fixture(); f.loseAcknowledgement(); const action = await approved(f); await f.service.do(owner, action.id);
  f.capabilities.revokeEvidence('synthetic-write-proof', '2026-09-30T12:00:00.000Z', 'Qualification proof replaced.');
  const renewed = new QualifiedSyntheticWriteService(f.store, f.profile, { registry: registry(false, f.profile, 'renewed-write-proof'), authorization: f.authorization, provider: f.provider, clock: () => '2026-09-30T12:00:00.000Z' });
  assert.equal((await renewed.reconcile(owner, action.id)).status, 'verified'); assert.equal(f.counts().doCalls, 1);
  const pending = fixture(); const prepared = await approved(pending);
  const newQualification = new QualifiedSyntheticWriteService(pending.store, pending.profile, { registry: registry(false, pending.profile, 'new-pre-dispatch-proof'), authorization: pending.authorization, provider: pending.provider, clock: () => '2026-09-30T12:00:00.000Z' });
  await assert.rejects(newQualification.do(owner, prepared.id), { code: 'WRITE_QUALIFICATION_CHANGED' }); assert.equal(pending.counts().doCalls, 0);
});

test('unattempted intent refresh keeps its stable operation identity and clears the old approval', async () => {
  const f = fixture(); const action = await approved(f); f.changePermissionRevision();
  const refreshed = await f.service.refresh(owner, action.id, { ...payload, memo: 'Freshly reviewed command' });
  assert.equal(refreshed.id, action.id); assert.equal(refreshed.idempotencyKey, action.idempotencyKey); assert.equal(refreshed.revision, 2); assert.equal(refreshed.approval, undefined); assert.equal(refreshed.status, 'prepared');
  await assert.rejects(f.service.approve(owner, refreshed.id, action.digest), { code: 'PREVIEW_CHANGED' });
  await f.service.approve(owner, refreshed.id, refreshed.digest); assert.equal((await f.service.do(owner, refreshed.id)).status, 'verified');
  await assert.rejects(f.service.refresh(owner, refreshed.id, payload), { code: 'ACTION_ALREADY_ATTEMPTED' }); assert.equal(f.counts().doCalls, 1);
});

test('cancelled business occurrence cannot be silently revived by a duplicate prepare', async () => {
  const f = fixture(); const action = await f.service.prepare(owner, { intentId: 'cancelled-occurrence', payload }); await f.service.cancel(owner, action.id);
  await assert.rejects(f.service.prepare(owner, { intentId: 'cancelled-occurrence', payload }), { code: 'WRITE_INTENT_CANCELLED' });
  await assert.rejects(f.service.refresh(owner, action.id, payload), { code: 'ACTION_ALREADY_ATTEMPTED' }); assert.equal(f.counts().doCalls, 0);
});

test('changed write mapping or schema cannot borrow proof for the earlier tested definition', async () => {
  for (const mutate of [(value: WriteDefinition<Payload>) => { value.mapping.revision = 'untested-mapping-v2'; }, (value: WriteDefinition<Payload>) => { value.schemaRevision = 'untested-schema-v2'; }]) {
    const f = fixture(); const changed = definition(); mutate(changed);
    const service = new QualifiedSyntheticWriteService(f.store, changed, { registry: f.capabilities, authorization: f.authorization, provider: f.provider, clock: () => '2026-09-30T12:00:00.000Z' });
    await assert.rejects(service.prepare(owner, { intentId: 'untested-definition', payload }), { code: 'CONNECTOR_DEFINITION_UNQUALIFIED' }); assert.equal(f.counts().preparationCalls, 0);
  }
});

test('concurrent preparation converges on one authoritative business intent and one provider preparation', async () => {
  const f = fixture(); const [first, second] = await Promise.all([f.service.prepare(owner, { intentId: 'concurrent-preparation', payload }), f.service.prepare(owner, { intentId: 'concurrent-preparation', payload })]);
  assert.equal(first.id, second.id); assert.equal(f.store.state.actions.length, 1); assert.equal(f.counts().preparationCalls, 1);
});

test('a caller revoked while waiting for coalesced preparation receives no source-state parameters', async () => {
  const f = fixture(); const waiting: Context = { ...owner, memberId: 'waiting-owner' };
  f.store.state.members.push({ id: waiting.memberId, name: 'Waiting owner', role: 'owner', epoch: 1, active: true, branches: ['*'] });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const originalPrepare = f.provider.prepare;
  f.provider.prepare = async (value, context) => { await gate; return originalPrepare(value, context); };
  const first = f.service.prepare(owner, { intentId: 'coalesced-authority-check', payload });
  const revokedWaiter = f.service.prepare(waiting, { intentId: 'coalesced-authority-check', payload });
  f.store.state.members.find(member => member.id === waiting.memberId)!.epoch += 1; release();
  const results = await Promise.allSettled([first, revokedWaiter]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.equal(results[1].reason.code, 'ACCESS_REVOKED');
  assert.equal(f.counts().preparationCalls, 1); assert.equal(f.store.state.actions.length, 1);
});

test('read revocation during delayed preparation or refresh withholds original source-state evidence', async () => {
  for (const refreshing of [false, true]) {
    const f = fixture(); const existing = refreshing ? await approved(f) : undefined;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const originalPrepare = f.provider.prepare; f.provider.prepare = async (value, context) => { await gate; return originalPrepare(value, context); };
    const preparing = existing ? f.service.refresh(owner, existing.id, payload) : f.service.prepare(owner, { intentId: 'delayed-read-authority', payload });
    f.revokeRead(); release();
    await assert.rejects(preparing, { code: 'WRITE_READBACK_REVOKED' });
    assert.equal(f.store.state.actions.length, existing ? 1 : 0); assert.equal(f.counts().doCalls, 0);
  }
});

test('refresh rechecks its independent source read grant before observing another source preparation', async () => {
  const f = fixture(); const action = await approved(f); const profile = definition(); const validate = profile.validatePayload;
  profile.validatePayload = value => { f.revokeRead(); return validate(value); };
  const service = new QualifiedSyntheticWriteService(f.store, profile, { registry: registry(false, profile), authorization: f.authorization, provider: f.provider, clock: () => '2026-09-30T12:00:00.000Z' });
  await assert.rejects(service.refresh(owner, action.id, payload), { code: 'WRITE_READBACK_REVOKED' });
  assert.equal(f.counts().preparationCalls, 1); assert.equal(f.store.state.actions[0].revision, 1); assert.equal(f.counts().doCalls, 0);
});

test('queued source preparation binds the checked caller context, business occurrence and payload snapshots', async () => {
  for (const refreshing of [false, true]) {
    const f = fixture(); const profile = definition(); const validate = profile.validatePayload;
    profile.validatePayload = value => { validate(value); return value as Payload; };
    const service = new QualifiedSyntheticWriteService(f.store, profile, { registry: registry(false, profile), authorization: f.authorization, provider: f.provider, clock: () => '2026-09-30T12:00:00.000Z' });
    const existing = refreshing ? await service.prepare(owner, { intentId: 'checked-business-occurrence', payload }) : undefined;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const originalPrepare = f.provider.prepare;
    let observedContext: Context | undefined;
    f.provider.prepare = async (value, context) => { await gate; observedContext = structuredClone(context); return originalPrepare(value, context); };
    const caller: Context = { ...owner }; const originalPayload = { ...payload }; const request = { intentId: 'checked-business-occurrence', payload: originalPayload };
    const preparing = existing ? service.refresh(caller, existing.id, originalPayload) : service.prepare(caller, request);
    request.intentId = 'mutated-business-occurrence'; originalPayload.memo = 'Changed while source preparation awaited'; caller.memberId = 'invented-caller'; caller.epoch = 99;
    release(); const prepared = await preparing;
    const envelope = prepared.payload as { intentId: string; payload: Payload; preparation: { command: Payload } };
    assert.equal(envelope.intentId, 'checked-business-occurrence'); assert.equal(envelope.payload.memo, payload.memo); assert.equal(envelope.preparation.command.memo, payload.memo);
    assert.equal(prepared.createdBy, 'owner'); assert.equal(observedContext?.memberId, 'owner'); assert.equal(observedContext?.epoch, 1);
    const sameIntent = await service.prepare(owner, { intentId: 'checked-business-occurrence', payload });
    assert.equal(sameIntent.id, prepared.id); assert.equal(sameIntent.idempotencyKey, prepared.idempotencyKey); assert.equal(f.store.state.actions.length, 1);
  }
});
