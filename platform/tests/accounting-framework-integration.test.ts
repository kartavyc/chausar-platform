import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from '../runtime/actions.ts';
import { initialState, authorize, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { assertSourceAccess, trustFingerprint } from '../runtime/trust.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ConnectorCapabilityRegistry } from '../runtime/connector-framework/registry.ts';
import type { ConnectorCapability, ConnectorOperationScope, SyntheticConnectorEvidence } from '../runtime/connector-framework/registry.ts';
import { ConnectorReadDispatcher, ConnectorReadError } from '../runtime/connector-framework/read.ts';
import type { ConnectorReadAdapter, ConnectorReadRequest } from '../runtime/connector-framework/read.ts';
import { CursorImportService } from '../runtime/connector-framework/import.ts';
import type { CaptureRequest, IndependentSourceTotals, ImportDomain } from '../runtime/connector-framework/import.ts';
import { ConnectorReadImportBridge } from '../runtime/connector-framework/bridge.ts';
import type { ReadImportBinding } from '../runtime/connector-framework/bridge.ts';
import type { AccountingPage, AccountingTransport } from '../runtime/adapters/accounting/common.ts';
import { createAccountingDecoder, proposeAccountingMapping, reconcileAccountingSourceTotals } from '../runtime/adapters/accounting/import.ts';
import { createZohoReadAdapter, parseZohoPage, zohoReadConfiguration, zohoReadOperationId, zohoSchemaFingerprint, ZOHO_ADAPTER_VERSION } from '../runtime/adapters/accounting/zoho.ts';
import { createQuickBooksReadAdapter, parseQuickBooksPage, quickBooksOperation, quickBooksSchemaFingerprint } from '../runtime/adapters/accounting/quickbooks.ts';
import { createXeroReadAdapter, parseXeroPage, xeroOperation, xeroSchemaFingerprint } from '../runtime/adapters/accounting/xero.ts';
import { createTallyExportAdapter, parseTallyXml, tallyOperation, tallyXmlSchemaFingerprint } from '../runtime/adapters/accounting/tally.ts';

// Every artifact and attestation in this file is synthetic; the real vendor parsers and factories are exercised without a network.
const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const at = '2026-09-30T12:00:00.000Z', milliseconds = Date.parse(at);
const fixtureText = (path: string) => readFileSync(new URL(`./fixtures/accounting/${path}`, import.meta.url), 'utf8');
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
class Store implements StateStore {
  state = initialState('Accounting fixture workspace', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = structuredClone(this.state), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
type Scenario = {
  content: { value: string }; contentType: 'application/json' | 'application/xml'; operation: ConnectorOperationScope; domain: ImportDomain;
  organizationId?: string; parse(content: string): AccountingPage; schema(content: string): string;
  factory(transport: AccountingTransport, environment?: 'synthetic' | 'live'): ConnectorReadAdapter;
  measure: 'subtotal' | 'total'; precisions: Record<string, number>; eventTypes: Record<string, string>; statuses: Record<string, string>; mappingCurrency: string;
};
function zohoScenario(content = fixtureText('zoho/invoice-detail.json')): Scenario {
  const profile = { resource: 'invoices' as const, resourceId: '10001', organizationId: '12345', companyId: '12345', dataCenter: 'in' as const };
  const operation: ConnectorOperationScope = { connectorId: 'zoho-books', connectorVersion: ZOHO_ADAPTER_VERSION,
    operationId: zohoReadOperationId('invoices', true), kind: 'read', transport: 'api', applicability: {
      applicationVersion: 'v3', edition: 'synthetic-fixture', module: 'invoices', configuration: zohoReadConfiguration(profile), deploymentProfile: 'synthetic', region: 'in',
    } };
  return { content: { value: content }, contentType: 'application/json', operation, organizationId: profile.organizationId,
    domain: { company: profile.companyId, dataset: 'zoho-invoices', branches: ['all'] },
    parse: bytes => parseZohoPage(bytes, { resource: 'invoices', organizationId: profile.organizationId, detail: true, expectedResourceId: profile.resourceId }),
    schema: zohoSchemaFingerprint, factory: (transport, environment = 'synthetic') => createZohoReadAdapter({ ...profile, operation, environment, transport }),
    measure: 'subtotal', precisions: { INR: 2 }, mappingCurrency: 'INR', eventTypes: { 'invoice:invoice:receivable': 'invoice' }, statuses: { 'open:sent': 'open' },
  };
}
function quickBooksScenario(): Scenario {
  const profile = { entity: 'Invoice' as const, realmId: '123456789', minorVersion: '75', environment: 'synthetic' as const };
  const operation = quickBooksOperation(profile, 'read');
  return { content: { value: fixtureText('quickbooks/invoices.json') }, contentType: 'application/json', operation,
    domain: { company: profile.realmId, dataset: 'qbo-invoice', branches: ['all'] }, parse: bytes => parseQuickBooksPage(bytes, profile), schema: quickBooksSchemaFingerprint,
    factory: transport => createQuickBooksReadAdapter({ ...profile, operation, transport }), measure: 'total', precisions: { USD: 2 }, mappingCurrency: 'USD',
    eventTypes: { 'invoice:Invoice:receivable': 'invoice' }, statuses: { 'open:PARTIALLY_PAID': 'open', 'unknown:missing': 'unknown' },
  };
}
function xeroScenario(): Scenario {
  const profile = { resource: 'credit-notes' as const, companyId: 'xero-company', organizationId: '40000000-0000-0000-0000-000000000001',
    edition: 'synthetic-fixture', configurationProfile: 'fixture-profile', deploymentProfile: 'synthetic' };
  const operation = xeroOperation(profile, 'read');
  return { content: { value: fixtureText('xero/credit-notes.json') }, contentType: 'application/json', operation, organizationId: profile.organizationId,
    domain: { company: profile.companyId, dataset: 'xero-credit-notes', branches: ['all'] },
    parse: bytes => parseXeroPage(bytes, { resource: 'credit-notes' }), schema: xeroSchemaFingerprint,
    factory: transport => createXeroReadAdapter({ ...profile, operation, environment: 'synthetic', transport }), measure: 'subtotal', precisions: { NZD: 2 }, mappingCurrency: 'NZD',
    eventTypes: { 'credit-note:ACCRECCREDIT:receivable': 'refund' }, statuses: { 'open:AUTHORISED': 'open' },
  };
}
function tallyScenario(): Scenario {
  const profile = { applicationVersion: '6.0' as const, wireFormat: 'xml-v1' as const, envelopeVariant: 'response-v1' as const, resource: 'vouchers' as const,
    companyId: 'company-a', companyName: 'Synthetic Company', edition: 'synthetic-fixture', configuration: 'fixture-profile', deploymentProfile: 'synthetic', baseCurrency: 'INR' };
  const operation = tallyOperation(profile, 'export'), content = { value: fixtureText('tally/vouchers-v1.xml') };
  return { content, contentType: 'application/xml', operation, domain: { company: profile.companyId, dataset: 'vouchers', branches: ['all'] },
    parse: bytes => parseTallyXml(bytes, profile), schema: bytes => tallyXmlSchemaFingerprint(bytes, profile),
    factory: () => createTallyExportAdapter({ profile, environment: 'synthetic', readExport: async () => ({ content: Buffer.from(content.value), contentType: 'application/xml', companyId: profile.companyId, companyName: profile.companyName }) }),
    measure: 'total', precisions: { INR: 2 }, mappingCurrency: 'INR', eventTypes: { 'invoice:Sales:receivable': 'invoice' }, statuses: { 'unknown:Sales': 'unknown' },
  };
}
const readCapabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination', 'rate-limit-backoff'];
function syntheticRegistry(readOperation: ConnectorOperationScope, importOperation: ConnectorOperationScope) {
  const scopes = [readOperation, importOperation];
  return new ConnectorCapabilityRegistry(scopes.map((scope, i) => ({ scope, implemented: true, capabilities: i === 0 ? readCapabilities : [],
    evidenceIds: [`accounting-fixture-${i}`], limitations: ['Deterministic fixture only; no sandbox or live evidence.'] })),
  scopes.map((scope, i): SyntheticConnectorEvidence => ({ scope, id: `accounting-fixture-${i}`, assertions: ['operation', ...(i === 0 ? readCapabilities : [])],
    observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z',
    artifact: { sha256: digest('accounting integration synthetic fixture'), reference: 'platform/tests/accounting-framework-integration.test.ts' },
    environment: 'synthetic', notes: ['Fixture assertion only.'], provenance: { kind: 'synthetic-fixture', generatorVersion: '1' } })));
}
async function setup(scenario = zohoScenario(), options: { review?: boolean; transport?: AccountingTransport } = {}) {
  const store = new Store(), dictionary = structuredClone(starterPacks.find(pack => pack.pack === 'services')!);
  // Each authored fixture declares its own currency. This test does not select an FX or production currency policy.
  dictionary.currency = scenario.mappingCurrency; dictionary.definitions.forEach(definition => { definition.currency = scenario.mappingCurrency; });
  await new OntologyService(store).publish(ctx, dictionary);
  const importOperation: ConnectorOperationScope = { ...scenario.operation, operationId: `${scenario.operation.operationId}.captured-import`, kind: 'import', transport: 'file' };
  const registry = syntheticRegistry(scenario.operation, importOperation), waits: number[] = [];
  let nowMs = milliseconds;
  const calls: Array<{ url: string; headers: Readonly<Record<string, string>>; credentialReference: string | null }> = [];
  const transport: AccountingTransport = async (request, context) => {
    calls.push({ url: request.url, headers: request.headers, credentialReference: context.authorization.credentialReference });
    return options.transport ? options.transport(request, context) : { status: 200, content: Buffer.from(scenario.content.value), contentType: scenario.contentType, finalUrl: request.url };
  };
  const adapter = scenario.factory(transport), sourceId = 'accounting-source';
  const authority = { tenantId: store.state.workspace.id, sourceId, companyId: scenario.domain.company,
    ...(scenario.organizationId ? { organizationId: scenario.organizationId } : {}) };
  const reader = new ConnectorReadDispatcher({ registry, clock: { nowMs: () => nowMs, setTimer: () => () => {},
    sleep: async ms => { waits.push(ms); nowMs += ms; } }, authorize: async () => {
    authorize(store, ctx, 'prepare'); assertSourceAccess(store.read(), ctx, [sourceId]);
    return { scope: authority, authorityRevision: trustFingerprint(store.read(), ctx, [sourceId]), grantedScopes: adapter.requiredAuthScopes,
      expiresAtMs: milliseconds + 100_000, credentialReference: 'opaque-owner-broker-reference' };
  } });
  const decoder = createAccountingDecoder({ id: `${scenario.operation.connectorId}-fixture-decoder`, version: 'fixture-1',
    identityNamespace: `${scenario.operation.connectorId}-fixture-resource-revisions`, schemaSha256: scenario.schema(scenario.content.value),
    company: scenario.domain.company, dataset: scenario.domain.dataset, branch: 'all', measure: scenario.measure,
    minorDigitsByCurrency: scenario.precisions, parse: scenario.parse });
  const importer = new CursorImportService(store, registry, decoder, { now: () => at });
  const proposal = proposeAccountingMapping({ id: 'fixture-owner-mapping', system: scenario.operation.connectorId, edition: 'synthetic-fixture',
    company: scenario.domain.company, branch: 'all', currency: scenario.mappingCurrency, eventTypes: scenario.eventTypes, statuses: scenario.statuses });
  const review = options.review === false ? null : await importer.reviewMapping(ctx, { sourceId, scope: importOperation, domain: scenario.domain,
    recipe: proposal.recipe, evidence: { reportId: 'fixture-owner-reviewed-schema-report', sha256: decoder.schemaSha256 } });
  const descriptor = importer.decoderDescriptor();
  const binding: ReadImportBinding = { readOperation: scenario.operation, importOperation, authority, domain: scenario.domain,
    contentTypes: [scenario.contentType], decoder: { id: descriptor.id, version: descriptor.version, schemaSha256: descriptor.schemaSha256,
      identityNamespace: descriptor.identityNamespace, definitionHash: descriptor.definitionHash } };
  const bridge = new ConnectorReadImportBridge(store, binding, { registry, reader, importer, now: () => at });
  const request: CaptureRequest = { idempotencyKey: 'accounting-fixture-capture', sourceId, scope: importOperation, domain: scenario.domain,
    recipe: proposal.recipe, reviewId: review?.id ?? 'unaccepted-proposal', snapshot: { kind: 'unverified', limitation: 'Vendor fixture source provides no consistent snapshot proof.' } };
  const readRequest: ConnectorReadRequest = { operation: scenario.operation, authority, dataScope: scenario.domain, environment: 'synthetic' };
  const read = (patch: Partial<ConnectorReadRequest> = {}) => reader.read({ ...readRequest, ...patch }, adapter);
  return { store, registry, decoder, importer, reader, bridge, adapter, authority, scenario, proposal, review, request, readRequest, read, calls, waits };
}
function independentInvoiceRegister(domain: ImportDomain, amountMinor = '10000'): IndependentSourceTotals {
  return { provenance: 'independent-source-report', reportId: 'synthetic-independent-invoice-register', sha256: digest(`synthetic independently reviewed register: invoice 10001 INR ${amountMinor} minor units`),
    domainHash: digest(domain), company: domain.company, dataset: domain.dataset, currency: 'INR', rowCount: 1, amountMinor,
    observedAt: at, snapshotId: null };
}

test('Zoho fixture parser -> issued source bytes -> owner mapping -> independent subtotal report -> billed invoice receipt', async () => {
  const fixture = await setup(), raw = await fixture.read();
  assert.equal(raw.receipt.minimumQualification, 'synthetic-tested'); assert.equal(raw.completeness.source, 'unknown'); assert.equal(raw.completeness.snapshot, 'unverified');
  assert.equal(fixture.scenario.domain.period, undefined); assert.equal(raw.pages[0].provenance.source.generatedAtMs, null);
  const capture = await fixture.bridge.capture(ctx, { read: raw, request: fixture.request });
  assert.equal(capture.status, 'capturing'); assert.equal(fixture.store.state.facts.length, 0); assert.equal(capture.pages[0].content, fixture.scenario.content.value);
  assert.equal(capture.pages[0].sha256, raw.pages[0].provenance.contentSha256); assert.equal(capture.pages[0].rows[0].amount, '10000');
  assert.equal(JSON.parse(capture.pages[0].rows[0].accounting as string).total, '118.000');
  const sourceTotals = independentInvoiceRegister(fixture.scenario.domain);
  const checkTotals = reconcileAccountingSourceTotals({ records: fixture.scenario.parse(fixture.scenario.content.value).records, kind: 'invoice', currency: 'INR',
    minorDigits: 2, measure: 'subtotal', domain: fixture.scenario.domain, snapshot: fixture.request.snapshot, expected: sourceTotals });
  assert.equal(checkTotals.status, 'matched'); assert.equal(checkTotals.snapshotConsistent, false);
  const published = await fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, sourceTotals);
  assert.equal(published.status, 'published'); assert.equal(published.coverage.reconciled, true); assert.equal(published.coverage.snapshotConsistent, false);
  let readinessCode: string | null = null;
  assert.throws(() => fixture.importer.assertReady(ctx, fixture.request.sourceId, fixture.scenario.domain), error => {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') readinessCode = error.code;
    return code('SOURCE_NOT_READY')(error);
  });
  // This fixture calculation checks typed arithmetic, while the default production readiness guard above still refuses snapshot certification.
  const receipt = await new CalculatorService(fixture.store).calculate(ctx, { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(receipt.valueMinor, '10000'); assert.equal(receipt.operation, 'billed'); assert.equal(receipt.rowIds.length, 1); assert.equal(receipt.rows[0].kind, 'invoice');
  assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.match(receipt.dictionaryHash, /^[a-f0-9]{64}$/); assert.match(receipt.definitionHash, /^[a-f0-9]{64}$/);
  const earned = await new CalculatorService(fixture.store).calculate(ctx, { operation: 'earned' });
  assert.equal(earned.valueMinor, '0'); assert.equal(earned.rowIds.length, 0);
  const link = fixture.store.state.imports.find(item => item.type === 'connector-read-import-link-v1');
  assert.ok(link); assert.equal(link.pages[0].provenance.dataScopeHash, digest(fixture.scenario.domain)); assert.equal(link.readReceipt.environment, 'synthetic');
  assert.equal(fixture.calls[0].credentialReference, 'opaque-owner-broker-reference'); assert.equal(Object.hasOwn(fixture.calls[0].headers, 'Authorization'), false);
  assert.ok(!JSON.stringify(link).includes('opaque-owner-broker-reference'));
  // An opt-in trusted local test harness may retain these actual outputs. Default test runs write no artifact.
  const evidencePath = process.env.CHAUSAR_ACCOUNTING_EVIDENCE_PATH;
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify({ qualification: 'synthetic-only', semanticGate: 'unqualified', semanticGateEvaluated: false,
    liveVerified: false, rawPageHashes: raw.receipt.contentHashes, decoderDescriptor: fixture.importer.decoderDescriptor(),
    proposalRecipeHash: digest(fixture.proposal.recipe), reviewId: fixture.review!.id, captureId: published.id, generation: published.generation,
    sourceTotals, reconciliation: published.reconciliation, billedReceipt: receipt, readinessCode,
    sourceSnapshot: raw.completeness.snapshot, sourceObservedAt: capture.pages[0].sourceObservedAt, domain: fixture.scenario.domain,
    semanticBlockers: ['Exact accounting period is absent.', 'Source snapshot consistency is unverified.', 'Source observation time is unavailable.',
      'Parent-owned rights admission, retained semantic ledger, current-dependency checks and semantic publication gate are not wired in this fixture.'],
  }, null, 2) + '\n', 'utf8');
});

test('QuickBooks, Xero and Tally XML use actual fixture parsers and preserve dispatcher-to-import custody without publication', async () => {
  for (const scenario of [quickBooksScenario(), xeroScenario(), tallyScenario()]) {
    const fixture = await setup(scenario), raw = await fixture.read();
    const capture = await fixture.bridge.capture(ctx, { read: raw, request: fixture.request });
    assert.equal(capture.status, 'capturing', scenario.operation.connectorId); assert.equal(capture.pages.length, 1); assert.equal(fixture.store.state.facts.length, 0);
    assert.equal(capture.pages[0].content, scenario.content.value); assert.equal(capture.pages[0].sha256, raw.receipt.contentHashes[0]);
    assert.equal(capture.pages[0].rows.length, scenario.parse(scenario.content.value).records.length); assert.equal(capture.pages[0].sourceObservedAt, null);
    assert.equal(raw.completeness.snapshot, 'unverified'); assert.equal(raw.receipt.environment, 'synthetic');
    assert.equal(fixture.store.state.imports.filter(item => item.type === 'connector-read-import-link-v1').length, 1);
    if (scenario.operation.connectorId === 'tally') assert.ok(capture.pages[0].rows.every(row => row.amount === null));
  }
});

test('adapter mapping proposals alone and recipe mutation after owner review cannot capture or publish facts', async () => {
  const unreviewed = await setup(zohoScenario(), { review: false }), raw = await unreviewed.read();
  assert.equal(unreviewed.proposal.requiresHumanAcceptance, true); assert.equal(unreviewed.proposal.semanticQualification, 'unqualified');
  await assert.rejects(unreviewed.bridge.capture(ctx, { read: raw, request: unreviewed.request }), code('MAPPING_REVIEW_REQUIRED'));
  assert.equal(unreviewed.store.state.facts.length, 0); assert.equal(unreviewed.store.state.imports.length, 0);
  const reviewed = await setup(), reviewedRaw = await reviewed.read(), changed = structuredClone(reviewed.request);
  changed.recipe.bindings.find(binding => binding.target === 'kind')!.values!['invoice:invoice:receivable'] = 'sale';
  await assert.rejects(reviewed.bridge.capture(ctx, { read: reviewedRaw, request: changed }), code('MAPPING_REVIEW_REQUIRED'));
  assert.equal(reviewed.store.state.facts.length, 0);
});

test('forged read DTOs and mutated source bytes fail before durable accounting custody is created', async () => {
  for (const mutateBytes of [false, true]) {
    const fixture = await setup(), raw = await fixture.read(), before = fixture.store.state.imports.length;
    if (mutateBytes) raw.pages[0].content[0] ^= 1;
    await assert.rejects(fixture.bridge.capture(ctx, { read: mutateBytes ? raw : structuredClone(raw), request: fixture.request }), code(mutateBytes ? 'READ_RESULT_CHANGED' : 'READ_RESULT_NOT_ISSUED'));
    assert.equal(fixture.store.state.imports.length, before); assert.equal(fixture.store.state.facts.length, 0);
  }
});

test('unknown source snapshots cannot be promoted and a changed company domain cannot cross the bridge', async () => {
  const fixture = await setup(), raw = await fixture.read(), promoted = structuredClone(fixture.request);
  promoted.snapshot = { kind: 'source-snapshot', id: 'invented-snapshot' };
  await assert.rejects(fixture.bridge.capture(ctx, { read: raw, request: promoted }), code('BRIDGE_SNAPSHOT_MISMATCH'));
  const changed = structuredClone(fixture.request); changed.domain.company = 'another-company';
  await assert.rejects(fixture.bridge.capture(ctx, { read: raw, request: changed }), code('BRIDGE_CAPTURE_SCOPE_MISMATCH'));
  assert.equal(fixture.store.state.facts.length, 0); assert.equal(fixture.store.state.imports.filter(item => item.type === 'connector-capture-v1').length, 0);
});

test('schema drift quarantines the original vendor bytes with no parsed or published accounting contribution', async () => {
  const fixture = await setup(); fixture.scenario.content.value = fixture.scenario.content.value.replace('"invoice_number": "SYN-1"', '"invoice_number": "SYN-1", "new_source_basis": "requires review"');
  const raw = await fixture.read(), capture = await fixture.bridge.capture(ctx, { read: raw, request: fixture.request });
  assert.equal(capture.status, 'quarantined'); assert.ok(capture.gaps.some(gap => gap.code === 'SCHEMA_CHANGE_REVIEW_REQUIRED'));
  assert.equal(capture.pages[0].content, fixture.scenario.content.value); assert.equal(capture.pages[0].rows.length, 0); assert.equal(fixture.store.state.facts.length, 0);
  await assert.rejects(fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, independentInvoiceRegister(fixture.scenario.domain)), code('CAPTURE_INCOMPLETE'));
});

test('independent source totals are required and gross totals cannot certify the tax-excluded billed measure', async () => {
  for (const expected of [null, '11800'] as const) {
    const fixture = await setup(), raw = await fixture.read(), capture = await fixture.bridge.capture(ctx, { read: raw, request: fixture.request });
    const quarantined = await fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, expected === null ? null : independentInvoiceRegister(fixture.scenario.domain, expected));
    assert.equal(quarantined.status, 'quarantined'); assert.equal(fixture.store.state.facts.length, 0);
    assert.equal(quarantined.reconciliation?.status, expected === null ? 'unavailable' : 'mismatch');
    assert.equal(quarantined.reconciliation?.differenceMinor, expected === null ? null : '-1800');
  }
});

test('unknown native statuses and source event directions require new mapping decisions before publication', async () => {
  const unknownStatus = zohoScenario(fixtureText('zoho/invoice-detail.json').replace('"status": "sent"', '"status": "failure"'));
  const payable = xeroScenario(); payable.content.value = payable.content.value.replace('"Type": "ACCRECCREDIT"', '"Type": "ACCPAYCREDIT"');
  for (const scenario of [unknownStatus, payable]) {
    const fixture = await setup(scenario), raw = await fixture.read(), capture = await fixture.bridge.capture(ctx, { read: raw, request: fixture.request });
    assert.equal(capture.status, 'capturing');
    const report: IndependentSourceTotals = scenario.operation.connectorId === 'zoho-books' ? independentInvoiceRegister(scenario.domain)
      : { ...independentInvoiceRegister(scenario.domain, '3000'), currency: 'NZD', reportId: 'synthetic-independent-payable-credit-register' };
    const quarantined = await fixture.importer.publish(ctx, { captureId: capture.id, generation: capture.generation }, report);
    assert.equal(quarantined.status, 'quarantined'); assert.ok(quarantined.gaps.some(gap => gap.code === 'UNKNOWN_VALUE'),
      `${scenario.operation.connectorId}: ${JSON.stringify(quarantined.gaps)}`);
    assert.equal(fixture.store.state.facts.length, 0);
  }
});

test('Zoho actual parser multipage authored fixture preserves all page bytes, exact high amounts and cursor continuity', async () => {
  const scenario = zohoScenario(), profile = { resource: 'invoices' as const, organizationId: '12345', companyId: '12345', dataCenter: 'in' as const, perPage: 2 };
  scenario.operation = { ...scenario.operation, operationId: zohoReadOperationId('invoices'),
    applicability: { ...scenario.operation.applicability, configuration: zohoReadConfiguration(profile) } };
  scenario.content.value = fixtureText('zoho/invoices-page-1.json'); scenario.measure = 'total';
  scenario.parse = content => parseZohoPage(content, { resource: 'invoices', organizationId: '12345' });
  scenario.factory = transport => createZohoReadAdapter({ ...profile, operation: scenario.operation, environment: 'synthetic', transport });
  const page2 = fixtureText('zoho/invoices-page-2.json'), fixture = await setup(scenario, { transport: async request => ({
    status: 200, content: Buffer.from(new URL(request.url).searchParams.get('page') === '2' ? page2 : scenario.content.value), contentType: 'application/json', finalUrl: request.url,
  }) });
  const raw = await fixture.read(), capture = await fixture.bridge.capture(ctx, { read: raw, request: fixture.request });
  assert.equal(raw.receipt.pages, 2); assert.equal(raw.receipt.rows, 3); assert.equal(raw.schema.state, 'stable');
  assert.equal(capture.status, 'capturing'); assert.equal(capture.pages.length, 2); assert.equal(capture.pages[0].rows[0].amount, '900719925474099301');
  assert.equal(capture.pages[0].nextCursor, '{"kind":"page","page":2}'); assert.equal(capture.pages[1].fromCursor, capture.pages[0].nextCursor);
  assert.equal(capture.pages[1].terminal, true); assert.deepEqual(capture.pages.map(page => page.sha256), raw.receipt.contentHashes);
  assert.equal(capture.pages[1].content, page2); assert.equal(capture.totalBytes, Buffer.byteLength(scenario.content.value) + Buffer.byteLength(page2));
  assert.equal(fixture.store.state.facts.length, 0); assert.equal(raw.completeness.source, 'unknown'); assert.equal(raw.completeness.snapshot, 'unverified');
});

test('changed vendor revisions quarantine the new capture and stale prior receipts rather than overwriting an invoice', async () => {
  const fixture = await setup(), firstRead = await fixture.read(), first = await fixture.bridge.capture(ctx, { read: firstRead, request: fixture.request });
  await fixture.importer.publish(ctx, { captureId: first.id, generation: first.generation }, independentInvoiceRegister(fixture.scenario.domain));
  await new CalculatorService(fixture.store).calculate(ctx, { operation: 'billed' });
  fixture.scenario.content.value = fixture.scenario.content.value.replace('2026-09-01T10:00:00+0530', '2026-09-02T10:00:00+0530').replace('"sub_total": 100.000', '"sub_total": 101.000');
  const nextRead = await fixture.read(), correction = await fixture.bridge.capture(ctx, { read: nextRead, request: { ...fixture.request, idempotencyKey: 'accounting-correction-fixture' } });
  assert.equal(correction.status, 'quarantined'); assert.ok(correction.gaps.some(gap => gap.code === 'REVISION_ORDER_REVIEW_REQUIRED'));
  assert.equal(fixture.store.state.facts.length, 1); assert.equal(fixture.store.state.facts[0].fields.amountMinor, '10000');
  assert.ok(fixture.store.state.receipts.every(receipt => receipt.stale));
  assert.throws(() => fixture.importer.assertReady(ctx, fixture.request.sourceId, fixture.scenario.domain, false), code('SOURCE_NOT_READY'));
  await assert.rejects(fixture.importer.publish(ctx, { captureId: correction.id, generation: correction.generation }, independentInvoiceRegister(fixture.scenario.domain, '10100')), code('CAPTURE_INCOMPLETE'));
});

test('adapter failed-response bytes count against aggregate budgets and qualified Retry-After floors are honored', async () => {
  let attempts = 0;
  const scenario = zohoScenario(), failedBody = Buffer.from('synthetic throttled response');
  const fixture = await setup(scenario, { transport: async request => ++attempts === 1
    ? { status: 429, content: failedBody, contentType: 'application/json', finalUrl: request.url, headers: { 'retry-after': '3' } }
    : { status: 200, content: Buffer.from(scenario.content.value), contentType: 'application/json', finalUrl: request.url } });
  const raw = await fixture.read({ retry: { maxAttemptsPerPage: 2 } });
  assert.equal(attempts, 2); assert.deepEqual(fixture.waits, [3000]); assert.equal(raw.receipt.discardedBytes, failedBody.byteLength);
  assert.equal(raw.receipt.transportBytes, Buffer.byteLength(scenario.content.value) + failedBody.byteLength);
  assert.equal(raw.receipt.bytes, Buffer.byteLength(scenario.content.value)); assert.deepEqual(raw.receipt.attempts.map(attempt => attempt.outcome), ['rate-limited', 'succeeded']);
  let boundedAttempts = 0;
  const bounded = await setup(scenario, { transport: async request => ++boundedAttempts === 1
    ? { status: 429, content: failedBody, contentType: 'application/json', finalUrl: request.url }
    : { status: 200, content: Buffer.from(scenario.content.value), contentType: 'application/json', finalUrl: request.url } });
  const totalBytes = Buffer.byteLength(scenario.content.value) + failedBody.byteLength - 1;
  await assert.rejects(bounded.read({ retry: { maxAttemptsPerPage: 2 }, limits: { pageBytes: totalBytes, totalBytes } }), error => {
    assert.ok(error instanceof ConnectorReadError); assert.equal(error.code, 'READ_BYTE_LIMIT'); assert.equal(error.receipt.pages, 0); return true;
  });
  assert.equal(boundedAttempts, 2); assert.equal(bounded.store.state.facts.length, 0);
});

test('HTTP-date Retry-After cannot become an immediate retry, and redirected/invalid UTF-8 source responses refuse capture', async () => {
  for (const fault of ['retry-floor', 'redirect', 'utf8'] as const) {
    const fixture = await setup(zohoScenario(), { transport: async request => fault === 'retry-floor'
      ? { status: 429, content: Buffer.from('synthetic retry body'), contentType: 'application/json', finalUrl: request.url, headers: { 'Retry-After': 'Wed, 30 Sep 2026 12:00:03 GMT' } }
      : { status: fault === 'redirect' ? 302 : 200, content: fault === 'utf8' ? Uint8Array.from([0xff]) : Buffer.from('{}'),
        contentType: 'application/json', finalUrl: fault === 'redirect' ? 'https://unqualified.invalid/' : request.url } });
    await assert.rejects(fixture.read({ retry: { maxAttemptsPerPage: 2 } }), code(fault === 'retry-floor' ? 'READ_RETRY_AFTER_REFUSED' : fault === 'redirect' ? 'READ_TRANSPORT_UNSUPPORTED' : 'READ_TRANSPORT_INVALID_REQUEST'));
    assert.equal(fixture.calls.length, 1); assert.deepEqual(fixture.waits, []); assert.equal(fixture.store.state.facts.length, 0);
  }
});

test('an empty capability registry and synthetic fixture evidence both refuse live execution before transport', async () => {
  for (const emptyRegistry of [true, false]) {
    const fixture = await setup(), adapter = fixture.scenario.factory(async () => { assert.fail('Live transport must not be invoked.'); }, 'live');
    const dispatcher = new ConnectorReadDispatcher({ registry: emptyRegistry ? new ConnectorCapabilityRegistry() : fixture.registry,
      clock: { nowMs: () => milliseconds, setTimer: () => () => {}, sleep: async () => {} },
      authorize: async () => { assert.fail('Unqualified live execution must refuse before credentials.'); } });
    await assert.rejects(dispatcher.read({ ...fixture.readRequest, environment: 'live' }, adapter), code('READ_CAPABILITY_UNQUALIFIED'));
    assert.equal(fixture.store.state.facts.length, 0);
  }
});
