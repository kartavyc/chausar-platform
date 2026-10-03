import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { digest } from '../runtime/actions.ts';
import { authorize, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { assertSourceAccess, trustFingerprint, TrustService } from '../runtime/trust.ts';
import { OntologyService, type DictionaryDraft } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ConnectorCapabilityRegistry, connectorOperationKey, type ConnectorCapability,
  type ConnectorOperationScope, type SyntheticConnectorEvidence } from '../runtime/connector-framework/registry.ts';
import { ConnectorReadDispatcher, ConnectorReadError, readAuthorityScopeHash } from '../runtime/connector-framework/read.ts';
import { CursorImportService, type CaptureRequest, type IndependentSourceTotals, type ImportDomain } from '../runtime/connector-framework/import.ts';
import { ConnectorReadImportBridge, type ReadImportLink } from '../runtime/connector-framework/bridge.ts';
import { createAccountingDecoder, proposeAccountingMapping } from '../runtime/adapters/accounting/import.ts';
import { parseZohoPage, zohoSchemaFingerprint } from '../runtime/adapters/accounting/zoho.ts';
import { createZohoSavedResponseAdapter, zohoSavedResponseConfiguration, ZOHO_SAVED_RESPONSE_OPERATION_ID,
  ZOHO_SAVED_RESPONSE_VERSION } from '../runtime/adapters/accounting/zoho-saved-response.ts';

// Authored saved-creditnotes-fixture-1 bytes only. Restart means new service instances
// over a JSON-round-tripped test store; no native database or vendor qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const caller: Context = { memberId: 'synthetic-reviewer', role: 'cofounder', epoch: 1 };
const at = '2026-09-30T12:00:00.000Z', milliseconds = Date.parse(at);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pages = [1, 2].map(page => readFileSync(new URL(`./fixtures/accounting/zoho/saved-creditnotes-page-${page}.json`, import.meta.url)));
const hashes = pages.map(sha256);
const implementationDigests = [sha256(readFileSync(new URL('../runtime/adapters/accounting/zoho-saved-response.ts', import.meta.url))),
  sha256(readFileSync(new URL('../runtime/adapters/accounting/import.ts', import.meta.url)))];
const sourceId = 'synthetic-saved-creditnotes-restart';
const domain: ImportDomain = { company: '12345', dataset: 'zoho-saved-creditnotes', branches: ['all'] };
const totalMinor = '900719925474099310'; // Hand-worked independently: 900719925474099301 + 9.
const metric = 'recorded_credit_note_value';
const dictionary: DictionaryDraft = { pack: 'synthetic-saved-response-restart', label: 'Synthetic credit-note register',
  currency: 'INR', gstMode: 'unregistered', fields: { amountMinor: 'money', currency: 'string', status: 'string' },
  definitions: [{ name: metric, label: 'Recorded credit note value (synthetic arithmetic)', kind: 'refund',
    field: 'amountMinor', currency: 'INR', nulls: 'reject',
    meaning: 'Sum authored open credit-document totals only; no cash refund, earned revenue, tax or bank-settlement claim.' }] };
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;

class Store implements StateStore {
  state: State;
  constructor(retained?: State) { this.state = retained ? JSON.parse(JSON.stringify(retained)) : initialState('Synthetic accounting restart', true); }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
type Host = { nowMs: number; filesRead: boolean; onFile?: (page: number) => void };
function runtime(store: Store, host: Host) {
  const profile = { organizationId: '12345', companyId: domain.company, dataset: domain.dataset, pageSha256: hashes };
  const operation: ConnectorOperationScope = { connectorId: 'zoho-books', connectorVersion: ZOHO_SAVED_RESPONSE_VERSION,
    operationId: ZOHO_SAVED_RESPONSE_OPERATION_ID, kind: 'export', transport: 'file', applicability: {
      applicationVersion: 'v3', edition: 'authored-synthetic', module: 'creditnotes', deploymentProfile: 'synthetic',
      configuration: zohoSavedResponseConfiguration(profile) } };
  const importOperation: ConnectorOperationScope = { ...operation, operationId: `${operation.operationId}.captured-import`, kind: 'import' };
  const scopes = [operation, importOperation];
  const capabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination'];
  const registry = new ConnectorCapabilityRegistry(scopes.map((scope, i) => ({ scope, implemented: true,
    implementationDigest: implementationDigests[i], capabilities: i === 0 ? capabilities : [],
    evidenceIds: [`synthetic-restart-${i}`], limitations: ['Authored fixture only; no semantic, sandbox or live qualification.'] })),
  scopes.map((scope, i): SyntheticConnectorEvidence => ({ scope, id: `synthetic-restart-${i}`,
    implementationDigest: implementationDigests[i], assertions: ['operation', ...(i === 0 ? capabilities : [])],
    observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-05T00:00:00.000Z', environment: 'synthetic',
    artifact: { sha256: digest('Authored accounting restart contract scenarios'), reference: 'platform/tests/accounting-saved-response-restart.test.ts' },
    notes: ['Invented fixture/grants/reports only.'], provenance: { kind: 'synthetic-fixture', generatorVersion: 'saved-creditnotes-fixture-1' } })));
  const authority = { tenantId: store.state.workspace.id, sourceId, companyId: profile.companyId, organizationId: profile.organizationId };
  const calls: number[] = [];
  const adapter = createZohoSavedResponseAdapter({ ...profile, operation, environment: 'synthetic', readFile: async page => {
    calls.push(page); host.onFile?.(page);
    return { content: pages[page - 1], contentType: 'application/json', companyId: profile.companyId, organizationId: profile.organizationId };
  } });
  const reader = new ConnectorReadDispatcher({ registry,
    clock: { nowMs: () => host.nowMs, setTimer: () => () => {}, sleep: async () => {} }, authorize: async () => {
      authorize(store, caller, 'prepare'); assertSourceAccess(store.read(), caller, [sourceId]);
      return { scope: authority, authorityRevision: trustFingerprint(store.read(), caller, [sourceId]),
        grantedScopes: host.filesRead ? ['files.read'] : [], expiresAtMs: host.nowMs + 60_000, credentialReference: null };
    } });
  const decoder = createAccountingDecoder({ id: 'synthetic-restart-creditnotes-decoder', version: 'fixture-1',
    identityNamespace: 'synthetic-restart-creditnote-revisions', schemaSha256: zohoSchemaFingerprint(pages[0].toString('utf8')),
    company: domain.company, dataset: domain.dataset, branch: 'all', measure: 'total', minorDigitsByCurrency: { INR: 2 },
    parse: content => parseZohoPage(content, { resource: 'creditnotes', organizationId: profile.organizationId }) });
  const importer = new CursorImportService(store, registry, decoder, { now: () => new Date(host.nowMs).toISOString() });
  const proposal = proposeAccountingMapping({ id: 'synthetic-restart-creditnote-mapping', system: 'zoho-books',
    edition: operation.applicability.edition, company: domain.company, branch: 'all', currency: 'INR',
    eventTypes: { 'credit-note:creditnote:receivable': 'refund' }, statuses: { 'open:open': 'open' } });
  const bridge = new ConnectorReadImportBridge(store, { readOperation: operation, importOperation, authority, domain,
    decoder: importer.decoderDescriptor(), contentTypes: ['application/json'] },
  { reader, registry, importer, now: () => new Date(host.nowMs).toISOString() });
  const read = () => reader.read({ operation, authority, dataScope: domain, environment: 'synthetic' }, adapter);
  return { operation, importOperation, authority, calls, reader, importer, proposal, bridge, read };
}
const report: IndependentSourceTotals = { provenance: 'independent-source-report', reportId: 'synthetic-hand-worked-credit-register',
  sha256: digest('Authored register: CN 21001 = INR 9007199254740993.01; CN 21002 = INR 0.09; total minor 900719925474099310; count 2.'),
  domainHash: digest(domain), company: domain.company, dataset: domain.dataset, currency: 'INR', rowCount: 2,
  amountMinor: totalMinor, observedAt: at, snapshotId: null };

async function setup() {
  const store = new Store(), host: Host = { nowMs: milliseconds, filesRead: true };
  await new TrustService(store).addMember(owner, { id: caller.memberId, name: 'Synthetic accounting reviewer', role: caller.role });
  await new OntologyService(store).publish(owner, dictionary);
  const services = runtime(store, host);
  const review = await services.importer.reviewMapping(caller, { sourceId, scope: services.importOperation, domain,
    recipe: services.proposal.recipe, evidence: { reportId: 'synthetic-owner-reviewed-credit-register', sha256: services.importer.decoderDescriptor().schemaSha256 } });
  const request: CaptureRequest = { sourceId, scope: services.importOperation, domain, recipe: services.proposal.recipe,
    reviewId: review.id, idempotencyKey: 'synthetic-accounting-restart-import', snapshot: { kind: 'unverified',
      limitation: 'Saved response JSON establishes neither source observation time nor a coherent company snapshot.' } };
  return { store, host, services, request };
}

test('restart retains accounting capture, arithmetic receipt and original provenance while fresh replay contributes once', async () => {
  const f = await setup(), raw = await f.services.read();
  const capture = await f.services.bridge.capture(caller, { read: raw, request: f.request });
  const lease = { captureId: capture.id, generation: capture.generation };
  const first = await f.services.importer.publish(caller, lease, report);
  // This explicit unguarded fixture arithmetic is not an Engine-certified answer.
  const firstReceipt = await new CalculatorService(f.store).calculate(caller, { operation: metric, sourceIds: [sourceId] });
  const originalLink = f.store.state.imports.find(item => item.type === 'connector-read-import-link-v1') as ReadImportLink;
  const retained = f.store.read(), store = new Store(retained);
  const restarted = runtime(store, { nowMs: milliseconds + 1000, filesRead: true });
  assert.deepEqual(store.read(), retained);
  await assert.rejects(restarted.bridge.capture(caller, { read: raw, request: f.request }), code('READ_RESULT_NOT_ISSUED'));
  assert.deepEqual(store.read(), retained);
  const fresh = await restarted.read(), replay = await restarted.bridge.capture(caller, { read: fresh, request: f.request });
  const repeated = await restarted.importer.publish(caller, { captureId: replay.id, generation: replay.generation }, report);
  assert.equal(replay.id, first.id); assert.equal(replay.generation, first.generation);
  assert.equal(replay.status, 'published'); assert.deepEqual(repeated.rowIds, first.rowIds);
  assert.equal(store.state.facts.length, 2); assert.equal(repeated.totalsMinor, totalMinor);
  assert.deepEqual(repeated.pages.map(page => page.sha256), hashes);
  assert.deepEqual(repeated.pages.map(page => page.content), pages.map(page => page.toString('utf8')));
  assert.deepEqual(repeated.pages.map(page => page.sourceObservedAt), [null, null]);
  assert.equal(repeated.coverage.snapshotConsistent, false);
  assert.throws(() => restarted.importer.assertReady(caller, sourceId, domain), code('SOURCE_NOT_READY'));
  assert.equal(fresh.freshness.state, 'unknown'); assert.equal(fresh.freshness.oldestSourceGeneratedAtMs, null);
  assert.equal(fresh.completeness.source, 'unknown'); assert.equal(fresh.completeness.snapshot, 'unverified');
  assert.equal(fresh.receipt.minimumQualification, 'synthetic-tested'); assert.equal(fresh.receipt.environment, 'synthetic');
  const links = store.state.imports.filter(item => item.type === 'connector-read-import-link-v1') as ReadImportLink[];
  assert.equal(links.length, 2); assert.deepEqual(links.find(link => link.id === originalLink.id), originalLink);
  for (const link of links) {
    assert.equal(link.captureId, first.id); assert.equal(link.dataScopeHash, digest(domain));
    assert.equal(link.authorityScopeHash, readAuthorityScopeHash(restarted.authority));
    assert.equal(link.decoderDefinitionHash, restarted.importer.decoderDescriptor().definitionHash);
    assert.deepEqual(link.readReceipt.contentHashes, hashes);
    assert.deepEqual(link.pages.map(page => page.provenance.contentSha256), hashes);
    assert.deepEqual(link.pages.map(page => page.provenance.byteLength), pages.map(page => page.byteLength));
    assert.ok(link.pages.every(page => page.provenance.operationKey === connectorOperationKey(restarted.operation)
      && page.provenance.source.generatedAtMs === null && page.provenance.source.snapshotId === null));
  }
  const retainedReceipt = store.state.receipts.find(receipt => receipt.id === firstReceipt.id);
  assert.ok(retainedReceipt, 'The original synthetic arithmetic receipt must remain persisted after restart.');
  assert.deepEqual(retainedReceipt, retained.receipts.find(receipt => receipt.id === firstReceipt.id));
  const afterReceipt = await new CalculatorService(store).calculate(caller, { operation: metric, sourceIds: [sourceId] });
  assert.equal(afterReceipt.valueMinor, totalMinor); assert.deepEqual(afterReceipt.rowIds, firstReceipt.rowIds);
  assert.equal(afterReceipt.dictionaryHash, firstReceipt.dictionaryHash); assert.equal(afterReceipt.definitionHash, firstReceipt.definitionHash);
  assert.deepEqual(afterReceipt.coverage.importIds, [first.id]);
});

test('restarted saved-response dispatcher checks the current file grant before opening any file', async () => {
  const f = await setup(), store = new Store(f.store.read());
  const restarted = runtime(store, { nowMs: milliseconds + 1000, filesRead: false }), retained = store.read();
  await assert.rejects(restarted.read(), error => {
    assert.ok(error instanceof ConnectorReadError); assert.equal(error.code, 'READ_AUTHORIZATION_SCOPE_MISSING');
    assert.equal(error.receipt.requests, 0); assert.equal(error.receipt.bytes, 0); return true;
  });
  assert.deepEqual(restarted.calls, []); assert.deepEqual(store.read(), retained);
});

test('file grant revoked during saved-response transport prevents delivery after restart', async () => {
  const f = await setup(), store = new Store(f.store.read()), host: Host = { nowMs: milliseconds + 1000, filesRead: true };
  host.onFile = () => { host.filesRead = false; };
  const restarted = runtime(store, host), retained = store.read();
  await assert.rejects(restarted.read(), error => {
    assert.ok(error instanceof ConnectorReadError); assert.equal(error.code, 'READ_AUTHORIZATION_SCOPE_MISSING');
    assert.equal(error.receipt.pages, 0); assert.equal(error.receipt.requests, 1);
    assert.equal(error.receipt.bytes, 0);
    // Current dispatcher revocation occurs before received-byte accounting. This
    // scenario verifies no delivery; it does not certify transport-byte completeness.
    assert.deepEqual(error.receipt.contentHashes, []); return true;
  });
  assert.deepEqual(restarted.calls, [1]); assert.deepEqual(store.read(), retained);
});

for (const scope of ['member', 'source'] as const) {
  test(`retained accounting capture and issued reads cannot bypass current ${scope} revocation after restart`, async () => {
    const f = await setup(), original = await f.services.bridge.capture(caller, { read: await f.services.read(), request: f.request });
    const store = new Store(f.store.read()), restarted = runtime(store, { nowMs: milliseconds + 1000, filesRead: true });
    const pending = await restarted.read(), trust = new TrustService(store);
    if (scope === 'member') await trust.revokeMember(owner, caller.memberId);
    else await trust.grantSource(owner, { sourceId, revoked: true });
    const denied = scope === 'member' ? 'ACCESS_REVOKED' : 'SOURCE_REVOKED', retained = store.read();
    await assert.rejects(restarted.bridge.capture(caller, { read: pending, request: f.request }), code(denied));
    await assert.rejects(restarted.importer.publish(caller, { captureId: original.id, generation: original.generation }, report), code(denied));
    assert.throws(() => restarted.importer.get(caller, original.id), code(denied));
    assert.throws(() => restarted.importer.assertReady(caller, sourceId, domain), code(denied));
    await assert.rejects(restarted.read(), code('READ_AUTHORIZATION_FAILED'));
    assert.deepEqual(restarted.calls, [1, 2]); assert.deepEqual(store.read(), retained);
    assert.equal(store.state.facts.length, 0); assert.equal(store.state.receipts.length, 0);
    assert.deepEqual(original.pages.map(page => page.sha256), hashes);
  });
}
