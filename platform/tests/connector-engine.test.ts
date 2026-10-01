import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService, type CalculatorOptions } from '../runtime/calculator.ts';
import { EngineConnectorService, type EngineConnectorOptions, type EngineConnectorProfile } from '../runtime/engine-connectors.ts';
import {
  ConnectorCapabilityRegistry, CursorImportService, connectorOperationKey,
  type ConnectorOperationScope, type ConnectorCapability, type SyntheticConnectorEvidence,
  type IndependentSourceTotals, type ImportDomain, type QualifiedDecoder,
} from '../runtime/connector-framework/index.ts';
import type { MappingRecipe } from '../runtime/ingest.ts';
import { APPROVED_CONNECTOR_GROUPS, CONNECTOR_REGISTRY } from '../runtime/connectors.ts';
import { EngineSemanticService } from '../runtime/engine-semantic.ts';
import { hashData } from '../semantic-qualification/src/index.ts';
import { createSyntheticSemanticFixture, fixtureDictionaryDraft } from './fixtures/engine-semantic-fixture.ts';

// These profiles, reports and source clocks are explicitly synthetic fixtures, never vendor qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const domain: ImportDomain = { company: 'Synthetic Fixture', dataset: 'sales', branches: ['main'], period };
const authoredFixture = createSyntheticSemanticFixture(new Date().toISOString());
const decoder: QualifiedDecoder = {
  id: 'synthetic-json', version: 'v1', schemaSha256: hashData(authoredFixture.sourceSchema), identityNamespace: 'synthetic-sales-v1',
  identityFields: ['id', 'revision'], resourceIdentityFields: ['id', 'kind'], revisionOrder: { kind: 'unqualified' },
  businessFields: Object.keys(authoredFixture.sourceSchema.fields), deliveryFields: [], decode: text => JSON.parse(text),
};
const recipe: MappingRecipe = authoredFixture.recipe;
const rows = authoredFixture.rows;
const code = (expected: string) => (error: any) => error?.code === expected;
class Store implements StateStore {
  state = initialState('Synthetic Fixture', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
function fixtureOptions(store: StateStore, controls: { rows?: typeof rows; generatedAtMs?: number | null; grants?: boolean; semanticGate?: false } = {}) {
  let clockMs = Date.now(); const observedAt = new Date(clockMs - 1000).toISOString();
  const authored = createSyntheticSemanticFixture(new Date(clockMs).toISOString());
  const scope: ConnectorOperationScope = { connectorId: 'synthetic-register', connectorVersion: '1', operationId: 'read-sales', kind: 'read', transport: 'api',
    applicability: { applicationVersion: '1', edition: 'fixture', module: 'sales', configuration: 'exact-minor-fixture', deploymentProfile: 'synthetic' } };
  const importScope: ConnectorOperationScope = { ...scope, operationId: 'import-sales', kind: 'import', transport: 'file' };
  const readCapabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness'];
  const readDigest = digest('synthetic-read-code'), importDigest = digest('synthetic-decoder-code');
  const registry = new ConnectorCapabilityRegistry([scope, importScope].map((scope, index) => ({ scope, implemented: true,
    capabilities: index === 0 ? readCapabilities : [], evidenceIds: [`synthetic-evidence-${index}`], limitations: ['Synthetic fixture only.'],
    implementationDigest: index === 0 ? readDigest : importDigest })), [scope, importScope].map((scope, index): SyntheticConnectorEvidence => ({
    id: `synthetic-evidence-${index}`, scope, assertions: ['operation', ...(index === 0 ? readCapabilities : [])], observedAt,
    expiresAt: new Date(clockMs + 86_400_000).toISOString(), artifact: { sha256: digest('synthetic-evidence'), reference: 'platform/tests/connector-engine.test.ts' },
    notes: ['Synthetic fixture, unqualified semantics.'], environment: 'synthetic', provenance: { kind: 'synthetic-fixture', generatorVersion: 'v1' },
    implementationDigest: index === 0 ? readDigest : importDigest,
  })));
  let requests = 0;
  const profile: EngineConnectorProfile = {
    id: 'synthetic-sales', title: 'Synthetic sales fixture', sourceId: 'fixture-source', companyId: 'synthetic-fixture-company', domain: structuredClone(domain),
    environment: 'synthetic', syntheticFixture: true, readOperation: scope, importOperation: importScope,
    readImplementationDigest: readDigest, importImplementationDigest: importDigest, decoder, contentTypes: ['application/json'], maximumSourceAgeMs: 60_000,
    reader: { operation: scope, environment: 'synthetic', mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
      requiredAuthScopes: ['sales.read'], pagination: { kind: 'none' }, readPage: async request => {
        requests++; assert.equal(request.authority.tenantId, store.read().workspace.id); assert.deepEqual(request.dataScope, domain);
        const data = controls.rows ?? rows;
        return { content: Buffer.from(JSON.stringify(data)), contentType: 'application/json', schemaFingerprint: decoder.schemaSha256, rowCount: data.length,
          continuation: { kind: 'complete' }, source: { reportReference: 'synthetic-source-report', generatedAtMs: controls.generatedAtMs === undefined ? clockMs : controls.generatedAtMs,
            snapshotId: authored.sourceReport.snapshotId, completeness: 'reported-complete', totalRows: data.length } };
      } },
  };
  const options: EngineConnectorOptions = { registry, profiles: [profile], clock: { nowMs: () => clockMs,
    setTimer: (_callback, _ms) => () => {}, sleep: async () => {} },
    ...(controls.grants === false ? {} : { authorizeRead: async (_ctx: Context, authority: any, grantedScopes: any) => ({ scope: authority,
      authorityRevision: 'synthetic-host-grants-v1', grantedScopes, expiresAtMs: clockMs + 60_000, credentialReference: null }) }),
  };
  const descriptor = new CursorImportService(store, registry, decoder).decoderDescriptor();
  if (controls.semanticGate !== false) options.semanticGate = currentStore => new EngineSemanticService(currentStore, { registry, clock: options.clock!, maximumEvidenceAgeMs: 60_000,
    dossiers: state => [authored.dossier(digest(state.ontology), descriptor.definitionHash)] });
  const totals: IndependentSourceTotals = { provenance: 'independent-source-report', reportId: authored.sourceReport.reportId, sha256: authored.sourceReport.evidenceHash,
    company: domain.company, dataset: domain.dataset, domainHash: digest(domain), currency: 'INR', rowCount: (controls.rows ?? rows).length,
    amountMinor: authored.totals.amountMinor, observedAt: new Date(clockMs).toISOString(), snapshotId: authored.sourceReport.snapshotId };
  return { options, registry, profile, totals, get requests() { return requests; }, advance: (ms: number) => { clockMs += ms; } };
}
async function fixture(controls: Parameters<typeof fixtureOptions>[1] = {}) {
  const store = new Store(); await new OntologyService(store).publish(owner, fixtureDictionaryDraft);
  const setup = fixtureOptions(store, controls); const service = new EngineConnectorService(store, setup.options);
  const guards: CalculatorOptions = { consumerGuard: (ctx, request) => service.assertCalculationReady(ctx, request), receiptGuard: (ctx, receipt) => service.assertReceiptReady(ctx, receipt) };
  return { store, service, setup, calculator: new CalculatorService(store, guards), guards };
}
async function captured(value: Awaited<ReturnType<typeof fixture>>, key = 'synthetic-capture-v1') {
  const read = await value.service.request(owner, 'connectors.read', { profileId: 'synthetic-sales' });
  const review = await value.service.request(owner, 'connectors.reviewMapping', { profileId: 'synthetic-sales', recipe,
    evidence: { reportId: 'synthetic-schema-review', sha256: decoder.schemaSha256 } });
  const capture = await value.service.request(owner, 'connectors.capture', { acquisitionId: read.acquisitionId, reviewId: review.id, recipe, idempotencyKey: key });
  return { read, review, capture };
}
async function published(value: Awaited<ReturnType<typeof fixture>>, key = 'synthetic-capture-v1') {
  const result = await captured(value, key);
  const publication = await value.service.request(owner, 'connectors.publish', { profileId: 'synthetic-sales', captureId: result.capture.id, sourceTotals: value.setup.totals });
  assert.equal(publication.status, 'published'); return { ...result, publication };
}

test('host defaults install no adapters/grants and renderer cannot inject profile code', async () => {
  const store = new Store(), empty = new EngineConnectorService(store);
  assert.deepEqual(empty.profiles(owner), []);
  await assert.rejects(empty.request(owner, 'connectors.read', { profileId: 'unknown' }), code('CONNECTOR_PROFILE_NOT_INSTALLED'));
  const value = await fixture({ grants: false });
  await assert.rejects(value.service.request(owner, 'connectors.read', { profileId: 'synthetic-sales', endpoint: 'renderer-selected' }), code('INVALID_CONNECTOR_REQUEST'));
  await assert.rejects(value.service.read(owner, 'synthetic-sales'), code('CONNECTOR_HOST_GRANTS_REQUIRED')); assert.equal(value.setup.requests, 0);
});
test('approved scope retains exact fifty plan groups plus six additions without discarding legacy enterprise entries', () => {
  assert.equal(APPROVED_CONNECTOR_GROUPS.length, 56); assert.equal(new Set(APPROVED_CONNECTOR_GROUPS.map(group => group.id)).size, 56);
  assert.equal(APPROVED_CONNECTOR_GROUPS.filter(group => group.scope === 'original-plan-group').length, 50);
  assert.deepEqual(APPROVED_CONNECTOR_GROUPS.filter(group => group.scope === 'founder-approved-addition').map(group => group.id),
    ['khatabook', 'okcredit', 'mybillbook', 'bharatpe', 'petpooja', 'form26as-ais']);
  assert.ok(APPROVED_CONNECTOR_GROUPS.some(group => group.id === 'quickbooks'));
  assert.ok(APPROVED_CONNECTOR_GROUPS.every(group => group.qualification === 'unqualified' && !group.liveVerified && !group.writebackQualified));
  for (const id of ['sap', 'oracle', 'netsuite', 'dynamics']) assert.ok(CONNECTOR_REGISTRY.some(item => item.id === id));
});
test('synthetic public-consumer workflow preserves exact totals and labels semantic qualification truthfully', async () => {
  const value = await fixture();
  await assert.rejects(value.calculator.calculate(owner, { operation: 'earned', period }), code('SOURCE_NOT_READY'));
  const flow = await published(value);
  assert.equal(flow.read.syntheticFixture, true); assert.equal(flow.read.liveVerified, false); assert.equal(flow.read.semanticQualification, 'unqualified');
  assert.equal(flow.publication.semanticQualification, 'synthetic-qualified'); assert.equal(flow.publication.qualification, 'synthetic-tested');
  assert.ok(!JSON.stringify(flow.read).includes('sale-1')); assert.ok(!Object.hasOwn(flow.capture, 'pages'));
  assert.equal(value.service.ready(owner, 'synthetic-sales').ready, true);
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  assert.equal(receipt.totalMinor, '900719925474099400'); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  assert.deepEqual(value.calculator.receipt(owner, receipt.id), receipt);
  assert.equal(value.store.state.imports.filter(item => item.type === 'connector-consumer-binding-v1').length, 1);
});
test('mapping owner review rejects phone approval and profile inputs stay fixed after installation', async () => {
  const value = await fixture();
  await assert.rejects(value.service.reviewMapping({ ...owner, channel: 'phone' }, 'synthetic-sales', recipe,
    { reportId: 'schema', sha256: decoder.schemaSha256 }), code('HUMAN_MAPPING_REVIEW_REQUIRED'));
  value.setup.profile.domain.company = 'mutated'; value.setup.profile.reader.operation.operationId = 'mutated';
  const acquired = await value.service.read(owner, 'synthetic-sales'); assert.equal(acquired.receipt.operationKey.includes('mutated'), false);
});
test('expired custody and revoked member cannot capture previously acquired bytes', async () => {
  const value = await fixture(), read = await value.service.read(owner, 'synthetic-sales'); value.setup.advance(300_001);
  await assert.rejects(value.service.capture(owner, { acquisitionId: read.acquisitionId, reviewId: 'none', recipe, idempotencyKey: 'expired-read' }), code('CONNECTOR_READ_CUSTODY_EXPIRED'));
  assert.equal(value.store.state.facts.length, 0);
  const other = await fixture(), secondRead = await other.service.read(owner, 'synthetic-sales'); other.store.state.members[0].epoch++;
  await assert.rejects(other.service.capture(owner, { acquisitionId: secondRead.acquisitionId, reviewId: 'none', recipe, idempotencyKey: 'revoked-read' }), code('ACCESS_REVOKED'));
  assert.equal(other.store.state.facts.length, 0);
});
test('unknown/stale source time refuses admission despite successful transport', async () => {
  for (const generatedAtMs of [null, Date.now() - 600_000]) {
    const value = await fixture({ generatedAtMs });
    await assert.rejects(value.service.read(owner, 'synthetic-sales'), code('CONNECTOR_SOURCE_NOT_CURRENT'));
    assert.equal(value.store.state.imports.length, 0);
  }
});
test('independent totals mismatch quarantines and blocks calculations plus saved receipts', async () => {
  const value = await fixture(); await published(value);
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  const next = await captured(value, 'mismatching-synthetic-totals');
  const result = await value.service.publish(owner, 'synthetic-sales', next.capture.id, { ...value.setup.totals, amountMinor: '0' });
  assert.equal(result.status, 'quarantined'); assert.equal(value.store.state.facts.length, 2);
  await assert.rejects(value.calculator.calculate(owner, { operation: 'earned', period }), code('SOURCE_NOT_READY'));
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('SOURCE_NOT_READY'));
});
test('current freshness, exact qualification and host profiles remain required after publication/reopen', async () => {
  const value = await fixture(); await published(value);
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  const reopened = new EngineConnectorService(value.store);
  assert.throws(() => reopened.assertReceiptReady(owner, receipt), code('CONNECTOR_PROFILE_NOT_INSTALLED'));
  value.setup.advance(60_001);
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('CONNECTOR_SOURCE_NOT_CURRENT'));
  const fresh = await fixture(); await published(fresh); fresh.setup.registry.revokeEvidence('synthetic-evidence-1', new Date(fresh.setup.options.clock!.nowMs()).toISOString(), 'fixture revocation');
  await assert.rejects(fresh.calculator.calculate(owner, { operation: 'earned', period }), code('CONNECTOR_NOT_QUALIFIED'));
});
test('viewer can read ready connector calculations but cannot mutate acquisition', async () => {
  const value = await fixture(); await published(value);
  value.store.state.members.push({ id: 'viewer', name: 'Fixture viewer', role: 'viewer', epoch: 1, active: true, branches: ['main'] });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1 };
  const receipt = await value.calculator.calculate(viewer, { operation: 'earned', period }); assert.equal(receipt.totalMinor, value.setup.totals.amountMinor);
  assert.equal(value.calculator.receipt(viewer, receipt.id).memberId, 'viewer');
  await assert.rejects(value.service.read(viewer, 'synthetic-sales'), code('FORBIDDEN'));
});
test('receipt cannot certify an expanded or unspecified domain or evade empty-source readiness', async () => {
  const value = await fixture(); await published(value);
  await assert.rejects(value.calculator.calculate(owner, { operation: 'earned' }), code('CONNECTOR_DOMAIN_REQUIRED'));
  await assert.rejects(value.calculator.calculate(owner, { operation: 'earned', period: { from: '2026-08-01', to: '2026-09-30' } }), code('CONNECTOR_DOMAIN_INCOMPLETE'));
  const receipt = await value.calculator.calculate(owner, { operation: 'billed', period });
  assert.deepEqual(receipt.sourceIds, []); value.setup.advance(60_001);
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('CONNECTOR_SOURCE_NOT_CURRENT'));
});
test('acquisition conflict during asynchronous database verification prevents a saved receipt', async () => {
  const value = await fixture(); await published(value); const next = await captured(value, 'async-quarantine-v1');
  const calculator = new CalculatorService(value.store, { ...value.guards, verifier: async () => {
    await value.service.publish(owner, 'synthetic-sales', next.capture.id, { ...value.setup.totals, amountMinor: '0' }); return { fixture: true };
  } });
  await assert.rejects(calculator.calculate(owner, { operation: 'earned', period }), code('SOURCE_NOT_READY'));
  assert.equal(value.store.state.receipts.filter(item => item.operation === 'earned').length, 0);
});
test('importer enforces explicit minimum qualification and persists synthetic capture environment', async () => {
  const value = await fixture();
  const importer = new CursorImportService(value.store, value.setup.registry, decoder, { minimumQualification: 'live-verified' });
  await assert.rejects(importer.reviewMapping(owner, { sourceId: 'fixture-source', scope: value.setup.profile.importOperation, domain, recipe,
    evidence: { reportId: 'synthetic-schema', sha256: decoder.schemaSha256 } }), code('CONNECTOR_NOT_QUALIFIED'));
  const flow = await captured(value); const stored = value.store.state.imports.find(item => item.id === flow.capture.id);
  assert.equal(stored.minimumQualification, 'synthetic-tested'); assert.equal(stored.operationKey, connectorOperationKey(value.setup.profile.importOperation));
});
test('missing or genuinely failing semantic admission inserts no facts even in the demo workspace', async () => {
  const missing = await fixture({ semanticGate: false }), first = await captured(missing);
  await assert.rejects(missing.service.publish(owner, 'synthetic-sales', first.capture.id, missing.setup.totals), code('CONNECTOR_SEMANTIC_GATE_REQUIRED'));
  assert.equal(missing.store.state.facts.length, 0); assert.equal(missing.store.state.imports.filter(item => item.type === 'engine-semantic-anchor-v1').length, 0);
  const changedRows = structuredClone(rows); changedRows[0].tax = '2';
  const changed = await fixture({ rows: changedRows }), second = await captured(changed);
  await assert.rejects(changed.service.publish(owner, 'synthetic-sales', second.capture.id, changed.setup.totals), code('SEMANTIC_SOURCE_SCOPE_MISMATCH'));
  assert.equal(changed.store.state.facts.length, 0); assert.equal(changed.store.state.imports.filter(item => item.type === 'engine-semantic-anchor-v1').length, 0);
});
test('read cancellation clears custody and refuses use after service close', async () => {
  const value = await fixture(), read = await value.service.read(owner, 'synthetic-sales'); value.service.close();
  await assert.rejects(value.service.read(owner, 'synthetic-sales'), code('CONNECTOR_RUNTIME_CLOSED'));
  await assert.rejects(value.service.capture(owner, { acquisitionId: read.acquisitionId, reviewId: 'none', recipe, idempotencyKey: 'closed-read' }), code('CONNECTOR_READ_CUSTODY_EXPIRED'));
});

test('actual public HTTP RPC reaches captured facts, receipts and durable jobs; quarantine blocks reuse after reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-connector-rpc-'));
  let engine: Engine;
  const proxy: StateStore = { read: () => engine.vault!.read(), update: change => engine.vault!.update(change) };
  const setup = fixtureOptions(proxy);
  engine = new Engine({ directory, demo: true, storage: 'experimental-file', connectorRuntime: setup.options,
    durableJobs: { workerId: 'synthetic-connectors-worker', maxActiveJobs: 4, leaseMs: 1000, networkAvailable: () => false } });
  const app = createLocalServer(engine);
  t.after(async () => {
    await app.close(); await engine.shutdown(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-connector-rpc-')); await rm(directory, { recursive: true, force: true });
  });
  const passphrase = 'Synthetic connector roundtrip passphrase';
  await engine.request('workspace.create', { name: 'Synthetic Fixture', passphrase, demo: false, pack: 'ecommerce' });
  await engine.request('ontology.publish', { draft: fixtureDictionaryDraft });
  await engine.request('trust.update', { autonomy: true });
  const { origin, token } = await app.listen();
  const rpc = async (method: string, payload: any = {}) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any;
    if (response.status !== 200) throw Object.assign(new Error(body.error?.message ?? method), { code: body.error?.code });
    return body.result;
  };
  await assert.rejects(rpc('calculation.run', { operation: 'earned', period }), code('SOURCE_NOT_READY'));
  const listed = await rpc('connectors.profiles'); assert.equal(listed[0].syntheticFixture, true); assert.equal(listed[0].semanticQualification, 'unverified');
  const read = await rpc('connectors.read', { profileId: 'synthetic-sales' });
  assert.ok(!JSON.stringify(read).includes('sale-1'));
  const review = await rpc('connectors.reviewMapping', { profileId: 'synthetic-sales', recipe, evidence: { reportId: 'synthetic-schema-review', sha256: decoder.schemaSha256 } });
  const capture = await rpc('connectors.capture', { acquisitionId: read.acquisitionId, reviewId: review.id, recipe, idempotencyKey: 'synthetic-public-rpc-v1' });
  const publication = await rpc('connectors.publish', { profileId: 'synthetic-sales', captureId: capture.id, sourceTotals: setup.totals });
  assert.equal(publication.status, 'published'); assert.equal(publication.semanticQualification, 'synthetic-qualified');
  const summaries = await rpc('sources.list'); assert.equal(summaries.length, 1);
  assert.ok(summaries.every((source: any) => !Object.hasOwn(source, 'pages') && !Object.hasOwn(source, 'readReceipt') && !Object.hasOwn(source, 'ledger')));
  const receipt = await rpc('calculation.run', { operation: 'earned', period }); assert.equal(receipt.totalMinor, setup.totals.amountMinor);
  assert.equal((await rpc('receipts.get', { id: receipt.id })).coverage.completeness, 'reconciled-imports');
  const answer = await rpc('conversation.ask', { question: 'What was earned?', period });
  assert.equal(answer.supported, true); assert.equal(answer.receipt.totalMinor, setup.totals.amountMinor);
  assert.equal((await rpc('receipts.get', { id: answer.receipt.id })).id, answer.receipt.id);
  const job = await rpc('jobs.create', { type: 'calculation-set', goal: 'Synthetic captured exact sales total',
    input: { requests: [{ id: 'sales', input: { operation: 'earned', period }, reserveMinor: '1', durationMs: 15000 }] },
    sourceIds: ['fixture-source'], budgetMinor: '10', reserveMinor: '2', limits: { modelUnits: 0, durationMs: 20000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 60000).toISOString() }, intervalMs: 60000, graceMs: 0, catchup: 'latest', background: false,
    testedRoutes: [], allowedActions: [] });
  const delivered = await rpc('jobs.run', { id: job.id }); assert.equal(delivered.status, 'awaiting-acceptance');
  const jobReceipt = delivered.deliverable.result.calculations[0].value;
  assert.equal(jobReceipt.valueMinor, setup.totals.amountMinor);
  assert.ok((await rpc('receipts.get', { id: jobReceipt.receiptId })).jobOperation);
  await rpc('workspace.lock'); await rpc('workspace.open', { passphrase });
  assert.equal((await rpc('receipts.get', { id: receipt.id })).totalMinor, setup.totals.amountMinor);
  const secondRead = await rpc('connectors.read', { profileId: 'synthetic-sales' });
  const next = await rpc('connectors.capture', { acquisitionId: secondRead.acquisitionId, reviewId: review.id, recipe, idempotencyKey: 'synthetic-public-rpc-mismatch' });
  const mismatch = await rpc('connectors.publish', { profileId: 'synthetic-sales', captureId: next.id, sourceTotals: { ...setup.totals, amountMinor: '0' } });
  assert.equal(mismatch.status, 'quarantined');
  await assert.rejects(rpc('calculation.run', { operation: 'earned', period }), code('SOURCE_NOT_READY'));
  await assert.rejects(rpc('receipts.get', { id: receipt.id }), code('SOURCE_NOT_READY'));
  await assert.rejects(rpc('jobs.accept', { id: job.id }), code('JOB_EVIDENCE_REVOKED'));
});
