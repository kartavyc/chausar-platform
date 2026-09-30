import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, authorize, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { assertSourceAccess, trustFingerprint } from '../runtime/trust.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import type { MappingRecipe } from '../runtime/ingest.ts';
import { ConnectorCapabilityRegistry } from '../runtime/connector-framework/registry.ts';
import type { ConnectorCapability, ConnectorOperationScope, SyntheticConnectorEvidence } from '../runtime/connector-framework/registry.ts';
import { CursorImportService } from '../runtime/connector-framework/import.ts';
import type { CaptureRequest, IndependentSourceTotals, QualifiedDecoder } from '../runtime/connector-framework/import.ts';
import { ConnectorReadDispatcher } from '../runtime/connector-framework/read.ts';
import type { ApiReadAdapter, ConnectorReadResult, RawSourcePage, ReadDataScope, ReadPageRequest } from '../runtime/connector-framework/read.ts';
import { ConnectorReadImportBridge } from '../runtime/connector-framework/bridge.ts';
import type { ReadImportBinding } from '../runtime/connector-framework/bridge.ts';

const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const at = '2026-09-30T12:00:00.000Z', milliseconds = Date.parse(at);
class Store implements StateStore {
  state = initialState('Fixture', true);
  failEvent: string | null = null;
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const state = structuredClone(this.state), result = await change(state);
    if (this.failEvent && state.activity.at(-1)?.event === this.failEvent) { this.failEvent = null; throw new Error('synthetic commit crash'); }
    state.revision++; this.state = state; return result;
  }
}
const readScope: ConnectorOperationScope = { connectorId: 'synthetic-ledger', connectorVersion: 'v1', operationId: 'read-sales', kind: 'read', transport: 'api',
  applicability: { applicationVersion: 'v1', edition: 'fixture', module: 'sales', configuration: 'reviewed-config', deploymentProfile: 'synthetic' } };
const importScope: ConnectorOperationScope = { ...readScope, operationId: 'import-sales', kind: 'import', transport: 'file' };
const domain = { company: 'Fixture', dataset: 'sales', branches: ['main'], period: { from: '2026-09-01', to: '2026-09-30' } };
const fields = ['id', 'revision', 'kind', 'date', 'amount', 'currency', 'branch'];
const decoder: QualifiedDecoder = { id: 'reviewed-json', version: 'v1', schemaSha256: digest('schema-v1'), identityNamespace: 'sales-revisions-v1',
  resourceIdentityFields: ['id', 'kind'], revisionOrder: { kind: 'unqualified' }, identityFields: ['id', 'revision'], businessFields: fields, deliveryFields: [],
  decode: content => JSON.parse(content.replace(/^\uFEFF/, '')) };
const recipe: MappingRecipe = { version: 1, id: 'reviewed-sales', system: 'synthetic', edition: 'fixture', scope: { company: 'Fixture', branches: ['main'] }, bindings: [
  { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
  { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
  { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
  { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' },
], allowedKinds: ['sale'], allowedStatuses: [], onUnmapped: 'reject', ignoredFields: ['revision'] };
const rows = [
  { id: 'sale-1', revision: '1', kind: 'sale', date: '2026-09-15', amount: '900719925474099325', currency: 'INR', branch: 'main' },
  { id: 'sale-2', revision: '1', kind: 'sale', date: '2026-09-16', amount: '75', currency: 'INR', branch: 'main' },
];
const total: IndependentSourceTotals = { provenance: 'independent-source-report', reportId: 'reviewed-report', sha256: digest('report-evidence'), domainHash: digest(domain),
  company: 'Fixture', dataset: 'sales', currency: 'INR', rowCount: 2, amountMinor: '900719925474099400', observedAt: at, snapshotId: 'snapshot-1' };
const readCaps: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination'];
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;

async function setup(options: { rawPage?: (request: ReadPageRequest) => RawSourcePage; readDataScope?: ReadDataScope | null } = {}) {
  const store = new Store(); await new OntologyService(store).publish(ctx, 'ecommerce');
  const operations = [readScope, importScope];
  const registry = new ConnectorCapabilityRegistry(operations.map((scope, index) => ({ scope, implemented: true, capabilities: index === 0 ? readCaps : [],
    evidenceIds: [`synthetic-${index}`], limitations: ['Synthetic only.'] })), operations.map((scope, index): SyntheticConnectorEvidence => ({ id: `synthetic-${index}`, scope,
    assertions: ['operation', ...(index === 0 ? readCaps : [])], observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z',
    artifact: { sha256: digest('integration-evidence'), reference: 'platform/tests/connector-framework-integration.test.ts' }, notes: [], environment: 'synthetic',
    provenance: { kind: 'synthetic-fixture', generatorVersion: 'v1' } })));
  const importer = new CursorImportService(store, registry, decoder, { now: () => at });
  const review = await importer.reviewMapping(ctx, { sourceId: 'source-1', scope: importScope, domain, recipe, evidence: { reportId: 'reviewed-schema-report', sha256: decoder.schemaSha256 } });
  const authority = { tenantId: store.state.workspace.id, sourceId: 'source-1', companyId: 'Fixture' };
  const reader = new ConnectorReadDispatcher({ registry, clock: { nowMs: () => milliseconds, setTimer: () => () => {}, sleep: async () => {} },
    authorize: async () => { authorize(store, ctx, 'prepare'); assertSourceAccess(store.read(), ctx, ['source-1']);
      return { scope: authority, authorityRevision: trustFingerprint(store.read(), ctx, ['source-1']), grantedScopes: ['sales.read'], expiresAtMs: milliseconds + 60_000, credentialReference: null }; } });
  const rawPage = options.rawPage ?? ((request: ReadPageRequest): RawSourcePage => ({ content: Buffer.from(JSON.stringify([rows[request.cursor === null ? 0 : 1]])),
    contentType: 'application/json', schemaFingerprint: decoder.schemaSha256, rowCount: 1,
    continuation: request.cursor === null ? { kind: 'more', next: { kind: 'token', token: 'PRIVATE-CURSOR-2' } } : { kind: 'complete' },
    source: { reportReference: 'source-sales-report', generatedAtMs: milliseconds - 100, snapshotId: 'snapshot-1', completeness: 'reported-complete', totalRows: 2 } }));
  const adapter: ApiReadAdapter = { operation: readScope, environment: 'synthetic', mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
    requiredAuthScopes: ['sales.read'], pagination: { kind: 'token' }, readPage: async request => rawPage(request) };
  const read = await reader.read({ operation: readScope, authority, environment: 'synthetic',
    ...(options.readDataScope === null ? {} : { dataScope: options.readDataScope ?? domain }) }, adapter);
  const descriptor = importer.decoderDescriptor();
  const binding: ReadImportBinding = { readOperation: readScope, importOperation: importScope, authority, domain, contentTypes: ['application/json'], decoder: {
    id: descriptor.id, version: descriptor.version, schemaSha256: descriptor.schemaSha256, identityNamespace: descriptor.identityNamespace, definitionHash: descriptor.definitionHash,
  } };
  const bridge = new ConnectorReadImportBridge(store, binding, { registry, reader, importer, now: () => at });
  const request: CaptureRequest = { idempotencyKey: 'stable-integration-capture', sourceId: 'source-1', scope: importScope, domain, recipe, reviewId: review.id,
    snapshot: { kind: 'source-snapshot', id: 'snapshot-1' } };
  return { store, registry, importer, reader, bridge, read, adapter, request, binding };
}

test('synthetic API read -> exact raw capture -> reviewed import -> source totals -> typed calculator receipt', async () => {
  const fixture = await setup();
  const capture = await fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request });
  assert.equal(capture.status, 'capturing'); assert.equal(capture.pages.length, 2); assert.equal(fixture.store.state.facts.length, 0);
  assert.deepEqual(capture.pages.map(page => page.sha256), fixture.read.receipt.contentHashes);
  assert.equal(capture.pages[1].fromCursor, '{"kind":"token","token":"PRIVATE-CURSOR-2"}');
  const link = fixture.store.state.imports.find(item => item.type === 'connector-read-import-link-v1');
  assert.equal(link.captureId, capture.id); assert.equal(link.readReceipt.qualification.definitionDigest.length, 64);
  assert.equal(link.pages[0].provenance.operationKey, fixture.read.receipt.operationKey); assert.equal(link.identityNamespace, decoder.identityNamespace);
  assert.ok(!JSON.stringify(link.readReceipt).includes('PRIVATE-CURSOR-2'));
  const published = await fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, total);
  assert.equal(published.status, 'published'); assert.equal(published.coverage.reconciled, true); assert.equal(published.coverage.snapshotConsistent, true);
  fixture.importer.assertReady(ctx, 'source-1', domain);
  const receipt = await new CalculatorService(fixture.store).calculate(ctx, { operation: 'earned', period: domain.period });
  assert.equal(receipt.valueMinor, total.amountMinor); assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.equal(receipt.rowIds.length, 2);
  assert.equal(receipt.rows[0].amountMinor, rows[0].amount); assert.equal(receipt.dictionaryHash.length, 64); assert.equal(receipt.definitionHash.length, 64);
  await fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request });
  assert.equal(fixture.store.state.facts.length, 2); assert.equal(fixture.store.state.imports.filter(item => item.type === 'connector-read-import-link-v1').length, 1);
});

test('forged DTOs and mutation of issued raw bytes cannot create captures', async () => {
  for (const tamper of [false, true]) {
    const fixture = await setup(), before = fixture.store.state.imports.length;
    let read: ConnectorReadResult = fixture.read;
    if (tamper) read.pages[0].content[0] ^= 1; else read = structuredClone(read);
    await assert.rejects(fixture.bridge.capture(ctx, { read, request: fixture.request }), code(tamper ? 'READ_RESULT_CHANGED' : 'READ_RESULT_NOT_ISSUED'));
    assert.equal(fixture.store.state.imports.length, before); assert.equal(fixture.store.state.facts.length, 0);
  }
});

test('scope mismatch and unbound data domains fail before durable capture writes', async () => {
  for (const selectedDomain of [null, { ...domain, dataset: 'different-dataset' }, { ...domain, branches: ['different-branch'] },
    { ...domain, period: { from: '2026-09-01', to: '2026-09-29' } }]) {
    const fixture = await setup({ readDataScope: selectedDomain }); const before = fixture.store.state.imports.length;
    await assert.rejects(fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request }), code('BRIDGE_READ_SCOPE_MISMATCH'));
    assert.equal(fixture.store.state.imports.length, before);
  }
  const fixture = await setup();
  await assert.rejects(fixture.bridge.capture(ctx, { read: fixture.read, request: { ...fixture.request, sourceId: 'source-2' } }), code('BRIDGE_CAPTURE_SCOPE_MISMATCH'));
  const wrongTenant = new ConnectorReadImportBridge(fixture.store, { ...fixture.binding, authority: { ...fixture.binding.authority, tenantId: 'other-tenant' } },
    { registry: fixture.registry, reader: fixture.reader, importer: fixture.importer, now: () => at });
  await assert.rejects(wrongTenant.capture(ctx, { read: fixture.read, request: fixture.request }), code('BRIDGE_TENANT_MISMATCH'));
});

test('revoked read qualification, source grant and decoder identity cannot cross the capture boundary', async () => {
  const revoked = await setup(); revoked.registry.revokeEvidence('synthetic-0', at, 'Synthetic revocation.');
  await assert.rejects(revoked.bridge.capture(ctx, { read: revoked.read, request: revoked.request }), code('CONNECTOR_NOT_QUALIFIED'));
  const source = await setup(); source.store.state.sourceRules.push({ sourceId: 'source-1', revoked: true });
  await assert.rejects(source.bridge.capture(ctx, { read: source.read, request: source.request }), code('SOURCE_REVOKED'));
  const decoderMismatch = await setup();
  assert.throws(() => new ConnectorReadImportBridge(decoderMismatch.store, { ...decoderMismatch.binding, decoder: { ...decoderMismatch.binding.decoder, identityNamespace: 'other-namespace' } },
    { registry: decoderMismatch.registry, reader: decoderMismatch.reader, importer: decoderMismatch.importer }), code('BRIDGE_DECODER_MISMATCH'));
});

test('schema drift retains raw read provenance and quarantine without publishing facts', async () => {
  const fixture = await setup({ rawPage: () => ({ content: Buffer.from(JSON.stringify([rows[0]])), contentType: 'application/json', schemaFingerprint: digest('new-schema'), rowCount: 1,
    continuation: { kind: 'complete' }, source: { reportReference: 'source-report', generatedAtMs: milliseconds, snapshotId: 'snapshot-1', completeness: 'reported-complete', totalRows: 1 } }) });
  const capture = await fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request });
  assert.equal(capture.status, 'quarantined'); assert.ok(capture.gaps.some(gap => gap.code === 'SCHEMA_CHANGE_REVIEW_REQUIRED'));
  assert.equal(capture.pages[0].content, Buffer.from(fixture.read.pages[0].content).toString()); assert.equal(fixture.store.state.facts.length, 0);
  assert.equal(fixture.store.state.imports.filter(item => item.type === 'connector-read-import-link-v1').length, 1);
});

test('binary invalid UTF-8 is refused; a reviewed BOM decoder preserves the exact source bytes', async () => {
  const source = { reportReference: 'source-report', generatedAtMs: milliseconds, snapshotId: 'snapshot-1', completeness: 'reported-complete' as const, totalRows: 1 };
  const invalid = await setup({ rawPage: () => ({ content: Uint8Array.from([0xff]), contentType: 'application/json', schemaFingerprint: decoder.schemaSha256, rowCount: 1, continuation: { kind: 'complete' }, source }) });
  await assert.rejects(invalid.bridge.capture(ctx, { read: invalid.read, request: invalid.request }), code('BRIDGE_ENCODING_UNSUPPORTED'));
  const bom = await setup({ rawPage: () => ({ content: Buffer.from(`\uFEFF${JSON.stringify([rows[0]])}`), contentType: 'application/json', schemaFingerprint: decoder.schemaSha256,
    rowCount: 1, continuation: { kind: 'complete' }, source }) });
  const capture = await bom.bridge.capture(ctx, { read: bom.read, request: bom.request });
  assert.equal(capture.status, 'capturing'); assert.ok(capture.pages[0].content.startsWith('\uFEFF')); assert.equal(capture.pages[0].sha256, bom.read.pages[0].provenance.contentSha256);
});

test('missing independent totals quarantine complete read data and remain unavailable rather than a verified zero', async () => {
  const fixture = await setup(); const capture = await fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request });
  const quarantined = await fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, null);
  assert.equal(quarantined.status, 'quarantined'); assert.equal(quarantined.reconciliation?.status, 'unavailable'); assert.equal(quarantined.reconciliation?.differenceMinor, null);
  assert.equal(fixture.store.state.facts.length, 0); assert.throws(() => fixture.importer.assertReady(ctx, 'source-1', domain), code('SOURCE_NOT_READY'));
});

test('a crash before bridge provenance commit resumes the same cursor capture with no duplicate contribution', async () => {
  const fixture = await setup(); fixture.store.failEvent = 'connector.read-import-linked';
  await assert.rejects(fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request }), /synthetic commit crash/);
  assert.equal(fixture.store.state.imports.filter(item => item.type === 'connector-capture-v1').length, 1);
  assert.equal(fixture.store.state.imports.find(item => item.type === 'connector-capture-v1').pages.length, 0);
  const capture = await fixture.bridge.capture(ctx, { read: fixture.read, request: fixture.request });
  const published = await fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, total);
  assert.equal(published.status, 'published'); assert.equal(fixture.store.state.facts.length, 2); assert.equal(published.pages.length, 2);
});
