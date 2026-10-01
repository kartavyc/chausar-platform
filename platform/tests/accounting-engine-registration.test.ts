import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { trustFingerprint } from '../runtime/trust.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { EngineConnectorService, type ConnectorSemanticInput } from '../runtime/engine-connectors.ts';
import { EngineSemanticService } from '../runtime/engine-semantic.ts';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { ConnectorCapabilityRegistry, ConnectorReadDispatcher, ConnectorReadImportBridge, CursorImportService,
  type ConnectorCapability, type ConnectorOperationScope, type ReadClock, type ReadImportLink,
  type SyntheticConnectorEvidence } from '../runtime/connector-framework/index.ts';
import { createAccountingConnectorCandidate, inspectAccountingSemanticCapture,
  type AccountingEngineRegistration, createZohoReadAdapter, parseZohoPage, zohoReadConfiguration,
  zohoReadOperationId, zohoSchemaFingerprint, ZOHO_ADAPTER_VERSION, sha256 } from '../runtime/adapters/accounting/index.ts';

// Authored fixture transport/evidence only. None of these tests install a qualified semantic gate or use a vendor account.
const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const at = '2026-09-30T12:00:00.000Z';
const bytes = readFileSync(new URL('./fixtures/accounting/zoho/invoice-detail.json', import.meta.url));
const readImplementationDigest = sha256(readFileSync(new URL('../runtime/adapters/accounting/zoho.ts', import.meta.url)));
const importImplementationDigest = sha256(readFileSync(new URL('../runtime/adapters/accounting/import.ts', import.meta.url)));
class Store implements StateStore {
  state = initialState('Synthetic accounting registration business', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const state = this.read(), result = await change(state); this.state = state; return result; }
}
function registration(calls: { count: number }): AccountingEngineRegistration {
  const native = { resource: 'invoices' as const, resourceId: '10001', organizationId: '12345', companyId: '12345', dataCenter: 'in' as const };
  const operation: ConnectorOperationScope = { connectorId: 'zoho-books', connectorVersion: ZOHO_ADAPTER_VERSION,
    operationId: zohoReadOperationId('invoices', true), kind: 'read', transport: 'api', applicability: {
      applicationVersion: 'v3', edition: 'synthetic-fixture', module: 'invoices', configuration: zohoReadConfiguration(native), deploymentProfile: 'synthetic', region: 'in' } };
  const reader = createZohoReadAdapter({ ...native, operation, environment: 'synthetic', transport: async request => {
    calls.count++; return { status: 200, content: Uint8Array.from(bytes), contentType: 'application/json', finalUrl: request.url };
  } });
  return { id: 'zoho-authored-invoice-fixture', title: 'Synthetic Zoho invoice fixture', sourceId: 'accounting-source',
    companyId: native.companyId, organizationId: native.organizationId, environment: 'synthetic', syntheticFixture: true,
    domain: { company: native.companyId, dataset: 'zoho-invoices', branches: ['all'] }, reader,
    importOperation: { ...operation, operationId: `${operation.operationId}.captured-import`, kind: 'import', transport: 'file' },
    readImplementationDigest, importImplementationDigest, contentTypes: ['application/json'], maximumSourceAgeMs: 60_000,
    decoder: { id: 'zoho-fixture-decoder', version: 'fixture-1', identityNamespace: 'zoho-fixture-revisions',
      schemaSha256: zohoSchemaFingerprint(bytes.toString('utf8')), company: native.companyId, dataset: 'zoho-invoices', branch: 'all',
      measure: 'subtotal', minorDigitsByCurrency: { INR: 2 }, parse: content => parseZohoPage(content, { ...native, detail: true, expectedResourceId: native.resourceId }) },
    mapping: { id: 'authored-invoice-mapping', currency: 'INR', eventTypes: { 'invoice:invoice:receivable': 'invoice' }, statuses: { 'open:sent': 'open' } } };
}
const capabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination', 'rate-limit-backoff'];
function registryFor(candidate: ReturnType<typeof createAccountingConnectorCandidate>) {
  const scopes = [candidate.profile.readOperation, candidate.profile.importOperation];
  const digests = [readImplementationDigest, importImplementationDigest];
  return new ConnectorCapabilityRegistry(scopes.map((scope, i) => ({ scope, implemented: true, implementationDigest: digests[i],
    capabilities: i === 0 ? capabilities : [], evidenceIds: [`authored-accounting-${i}`], limitations: ['Authored synthetic fixture only.'] })),
  scopes.map((scope, i): SyntheticConnectorEvidence => ({ scope, id: `authored-accounting-${i}`, implementationDigest: digests[i],
    assertions: ['operation', ...(i === 0 ? capabilities : [])], observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z',
    artifact: { sha256: sha256(bytes), reference: 'platform/tests/fixtures/accounting/zoho/invoice-detail.json' },
    environment: 'synthetic', provenance: { kind: 'synthetic-fixture', generatorVersion: 'accounting-registration-test-1' }, notes: ['No real vendor qualification.'] })));
}
async function setup() {
  const calls = { count: 0 }, candidate = createAccountingConnectorCandidate(registration(calls)), store = new Store();
  await new OntologyService(store).publish(ctx, 'services');
  let nowMs = Date.parse(at);
  const clock: ReadClock = { nowMs: () => nowMs, setTimer: () => () => {}, sleep: async ms => { nowMs += ms; } };
  const registry = registryFor(candidate), p = candidate.profile;
  const authority = { tenantId: store.state.workspace.id, sourceId: p.sourceId, companyId: p.companyId, organizationId: p.organizationId! };
  const grant = () => ({ scope: authority, authorityRevision: trustFingerprint(store.read(), ctx, [p.sourceId]),
    grantedScopes: p.reader.requiredAuthScopes, expiresAtMs: nowMs + 60_000, credentialReference: 'synthetic-opaque-grant' });
  const reader = new ConnectorReadDispatcher({ registry, clock, authorize: async () => grant() });
  const importer = new CursorImportService(store, registry, p.decoder, { now: () => new Date(clock.nowMs()).toISOString() });
  const descriptor = importer.decoderDescriptor();
  const review = await importer.reviewMapping(ctx, { sourceId: p.sourceId, scope: p.importOperation, domain: p.domain, recipe: candidate.proposal.recipe,
    evidence: { reportId: 'authored-schema-review', sha256: descriptor.schemaSha256 } });
  const raw = await reader.read({ operation: p.readOperation, authority, dataScope: p.domain, environment: 'synthetic' }, p.reader);
  const bridge = new ConnectorReadImportBridge(store, { readOperation: p.readOperation, importOperation: p.importOperation, authority, domain: p.domain,
    contentTypes: p.contentTypes, decoder: descriptor }, { registry, reader, importer, now: () => new Date(clock.nowMs()).toISOString() });
  const capture = await bridge.capture(ctx, { read: raw, request: { sourceId: p.sourceId, scope: p.importOperation, domain: p.domain,
    recipe: candidate.proposal.recipe, reviewId: review.id, idempotencyKey: 'authored-accounting-capture',
    snapshot: { kind: 'unverified', limitation: 'Native authored response has no source snapshot evidence.' } } });
  // Use the actual five-field Engine semantic port, not the importer's wider internal descriptor.
  const semanticDescriptor = { id: descriptor.id, version: descriptor.version, schemaSha256: descriptor.schemaSha256,
    identityNamespace: descriptor.identityNamespace, definitionHash: descriptor.definitionHash };
  const input = (): ConnectorSemanticInput => ({ state: store.read(), profile: p, capture: store.read().imports.find(item => item.id === capture.id),
    sourceTotals: { provenance: 'independent-source-report', reportId: 'authored-net-register', sha256: digest('Independent authored INR net10000'),
      company: p.companyId, dataset: p.domain.dataset, domainHash: digest(p.domain), currency: 'INR', rowCount: 1, amountMinor: '10000', observedAt: at, snapshotId: null },
    readLink: store.read().imports.find(item => item.type === 'connector-read-import-link-v1') as ReadImportLink,
    registry, decoderDescriptor: semanticDescriptor, at: '2099-01-01T00:00:00.000Z' });
  return { calls, candidate, store, clock, registry, grant, input, raw, importer, capture, advance: (value: string) => { nowMs = Date.parse(value); } };
}

test('accounting registration installs no qualifications and named billed calculation remains SOURCE_NOT_READY', async () => {
  const calls = { count: 0 }, candidate = createAccountingConnectorCandidate(registration(calls)), store = new Store();
  await new OntologyService(store).publish(ctx, 'services');
  const service = new EngineConnectorService(store, { profiles: [candidate.profile] });
  try {
    const profiles = await service.request(ctx, 'connectors.profiles');
    assert.equal(profiles[0].read.level, 'unqualified'); assert.equal(profiles[0].import.level, 'unqualified');
    assert.equal(candidate.admission.semanticQualification, 'unqualified'); assert.equal(candidate.admission.liveVerified, false);
    await assert.rejects(service.request(ctx, 'connectors.read', { profileId: candidate.profile.id }), { code: 'CONNECTOR_DEFINITION_UNQUALIFIED' });
    assert.equal(calls.count, 0);
    const calculator = new CalculatorService(store, { consumerGuard: (context, request) => service.assertCalculationReady(context, request) });
    await assert.rejects(calculator.calculate(ctx, { operation: 'billed' }), { code: 'SOURCE_NOT_READY' });
    assert.equal(store.state.facts.length, 0); assert.equal(store.state.receipts.length, 0);
  } finally { service.close(); }
});

test('authored native reader is refused by the public consumer for its unknown source time, without invented snapshots', async () => {
  const f = await setup(), service = new EngineConnectorService(f.store, { registry: f.registry, clock: f.clock,
    profiles: [f.candidate.profile], authorizeRead: async () => f.grant() });
  try {
    await assert.rejects(service.request(ctx, 'connectors.read', { profileId: f.candidate.profile.id }), { code: 'CONNECTOR_SOURCE_NOT_CURRENT' });
    assert.equal(f.raw.pages[0].provenance.source.generatedAtMs, null); assert.equal(f.raw.pages[0].provenance.source.snapshotId, null);
    assert.equal(f.store.state.facts.length, 0); assert.equal(f.calls.count, 2);
  } finally { service.close(); }
});

test('actual capture inspection preserves exact16 custody rows/native hashes and never manufactures14 semantic fields or proof', async () => {
  const f = await setup(), inspected = inspectAccountingSemanticCapture(ctx, f.input(), f.clock);
  assert.equal(inspected.semanticQualification, 'unqualified'); assert.equal(inspected.ready, false); assert.equal(inspected.liveVerified, false);
  assert.equal(inspected.compilerSourceSchemaHash, null); assert.equal(inspected.compilerSourceRowsHash, null);
  assert.equal(inspected.pages[0].nativePageSha256, sha256(bytes)); assert.equal(inspected.nativeWireSchemaSha256, f.candidate.profile.decoder.schemaSha256);
  assert.equal(Object.keys(inspected.pages[0].rows[0].decoded).length, 16); assert.equal(inspected.pages[0].rows[0].decoded.amount, '10000');
  assert.equal(inspected.pages[0].rows[0].decoded.accounting, f.capture.pages[0].rows[0].accounting);
  assert.equal(inspected.pages[0].sourceGeneratedAtMs, null); assert.equal(inspected.pages[0].snapshotId, null);
  assert.equal(f.store.state.facts.length, 0); assert.ok(!f.store.state.imports.some(item => /engine-semantic/.test(item.type)));
  const actualGate = new EngineSemanticService(f.store, { registry: f.registry, clock: f.clock, maximumEvidenceAgeMs: 60_000, dossiers: [] });
  assert.throws(() => actualGate.beforePublish(ctx, f.input()), { code: 'SEMANTIC_DOSSIER_REQUIRED' });
});

test('capture evidence inspection rejects changed bytes and changed current mapping authority', async () => {
  const f = await setup();
  const original = f.input(); original.state.imports.find(item => item.id === original.capture.id).pages[0].content += ' ';
  const changed = { ...original, capture: original.state.imports.find(item => item.id === original.capture.id) };
  assert.throws(() => inspectAccountingSemanticCapture(ctx, changed, f.clock), { code: 'ACCOUNTING_ORIGINAL_BYTES_CHANGED' });
  f.store.state.members[0].epoch++;
  assert.throws(() => inspectAccountingSemanticCapture({ ...ctx, epoch: 2 }, f.input(), f.clock), { code: 'ACCOUNTING_CAPTURE_AUTHORITY_CHANGED' });
});

test('source permission and independent operation evidence expiry use the current host clock', async () => {
  const f = await setup();
  f.store.state.sourceRules.push({ id: 'accounting-source', sourceId: 'accounting-source', revoked: true });
  assert.throws(() => inspectAccountingSemanticCapture(ctx, f.input(), f.clock), { code: 'SOURCE_REVOKED' });
  f.store.state.sourceRules = [];
  f.advance('2026-10-02T00:00:00.000Z');
  assert.throws(() => inspectAccountingSemanticCapture(ctx, f.input(), f.clock), { code: 'CONNECTOR_NOT_QUALIFIED' });
});

test('candidate registration rejects product-version drift, decoder company drift and silent synthetic labels', () => {
  const config = registration({ count: 0 });
  assert.throws(() => createAccountingConnectorCandidate({ ...config, importOperation: { ...config.importOperation,
    applicability: { ...config.importOperation.applicability, applicationVersion: 'v4' } } }), { code: 'ACCOUNTING_OPERATION_SCOPE_MISMATCH' });
  assert.throws(() => createAccountingConnectorCandidate({ ...config, decoder: { ...config.decoder, company: 'another-company' } }), { code: 'ACCOUNTING_DECODER_SCOPE_MISMATCH' });
  const { syntheticFixture: _label, ...unlabelled } = config;
  assert.throws(() => createAccountingConnectorCandidate(unlabelled), { code: 'ACCOUNTING_ENVIRONMENT_MISMATCH' });
});

test('actual local HTTP RPC lists installed accounting profile and refuses unqualified read/question/calculation without saving facts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-accounting-registration-'));
  const calls = { count: 0 }, candidate = createAccountingConnectorCandidate(registration(calls));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', connectorRuntime: { profiles: [candidate.profile] } });
  const app = createLocalServer(engine);
  t.after(async () => {
    await app.close(); await engine.shutdown();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('chausar-accounting-registration-'));
    await rm(directory, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic Accounting Registration', passphrase: 'Authored accounting fixture passphrase', demo: false, pack: 'services' });
  const { origin, token } = await app.listen();
  const rpc = async (method: string, payload: object = {}) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, payload }) });
    if (response.status !== 200) {
      const body = await response.json() as { error: { code: string; message: string } };
      throw Object.assign(new Error(body.error.message), { code: body.error.code });
    }
    return response;
  };
  const profiles = await (await rpc('connectors.profiles')).json() as { result: { id: string; read: { level: string }; semanticQualification: string; syntheticFixture: boolean }[] };
  assert.equal(profiles.result[0].id, candidate.profile.id); assert.equal(profiles.result[0].read.level, 'unqualified');
  assert.equal(profiles.result[0].syntheticFixture, true); assert.equal(profiles.result[0].semanticQualification, 'unverified');
  await assert.rejects(rpc('connectors.read', { profileId: candidate.profile.id }), { code: 'CONNECTOR_DEFINITION_UNQUALIFIED' });
  await assert.rejects(rpc('calculation.run', { operation: 'billed' }), { code: 'SOURCE_NOT_READY' });
  await assert.rejects(rpc('conversation.ask', { question: 'What was billed?' }), { code: 'SOURCE_NOT_READY' });
  assert.equal(engine.vault!.read().facts.length, 0); assert.equal(engine.vault!.read().receipts.length, 0); assert.equal(calls.count, 0);
});
