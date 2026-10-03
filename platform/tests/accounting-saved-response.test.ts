import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from '../runtime/actions.ts';
import { initialState, authorize, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { assertSourceAccess, trustFingerprint } from '../runtime/trust.ts';
import { OntologyService, type DictionaryDraft } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { EngineConnectorService } from '../runtime/engine-connectors.ts';
import { ConnectorCapabilityRegistry, type ConnectorCapability, type ConnectorOperationScope, type SyntheticConnectorEvidence } from '../runtime/connector-framework/registry.ts';
import { ConnectorReadDispatcher, ConnectorReadError, type ReadTransportContext } from '../runtime/connector-framework/read.ts';
import { CursorImportService, type CaptureRequest, type IndependentSourceTotals, type ImportDomain } from '../runtime/connector-framework/import.ts';
import { ConnectorReadImportBridge, type ReadImportLink } from '../runtime/connector-framework/bridge.ts';
import { createAccountingDecoder, proposeAccountingMapping, reconcileAccountingSourceTotals } from '../runtime/adapters/accounting/import.ts';
import { parseZohoPage, zohoSchemaFingerprint } from '../runtime/adapters/accounting/zoho.ts';
import { createAccountingConnectorCandidate } from '../runtime/adapters/accounting/engine-registration.ts';
import { createZohoSavedResponseAdapter, zohoSavedResponseConfiguration, ZOHO_SAVED_RESPONSE_OPERATION_ID, ZOHO_SAVED_RESPONSE_VERSION } from '../runtime/adapters/accounting/zoho-saved-response.ts';

// Generator: saved-creditnotes-fixture-1. All bytes, reports, grants and reviews are authored synthetic evidence.
// The public custody/import contracts are real; no network, database or vendor qualification is involved.
const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const at = '2026-09-30T12:00:00.000Z', milliseconds = Date.parse(at);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fixture = (page: number) => readFileSync(new URL(`./fixtures/accounting/zoho/saved-creditnotes-page-${page}.json`, import.meta.url));
const nativePages = [fixture(1), fixture(2)];
const implementationDigests = [sha256(readFileSync(new URL('../runtime/adapters/accounting/zoho-saved-response.ts', import.meta.url))),
  sha256(readFileSync(new URL('../runtime/adapters/accounting/import.ts', import.meta.url)))];
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
const sourceId = 'synthetic-saved-creditnotes';
const domain: ImportDomain = { company: '12345', dataset: 'zoho-saved-creditnotes', branches: ['all'] };
const sourceAmountMinor = '900719925474099310'; // Independently hand-worked: 900719925474099301 + 9.
const metric = 'recorded_credit_note_value';
const dictionary: DictionaryDraft = { pack: 'synthetic-saved-response', label: 'Synthetic recorded credit note value', currency: 'INR', gstMode: 'unregistered',
  fields: { amountMinor: 'money', currency: 'string', status: 'string' }, definitions: [{ name: metric,
    label: 'Recorded credit note value (synthetic arithmetic)', kind: 'refund', field: 'amountMinor', currency: 'INR', nulls: 'reject',
    meaning: 'Sum the recorded source total of open credit note documents in this authored fixture; this does not establish cash refunds, tax-exclusive revenue, delivery or bank settlement.' }] };
class Store implements StateStore {
  state = initialState('Synthetic saved-response workspace', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
const capabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination'];
function registryFor(scopes: ConnectorOperationScope[]) {
  return new ConnectorCapabilityRegistry(scopes.map((scope, i) => ({ scope, implemented: true, implementationDigest: implementationDigests[i],
    capabilities: i === 0 ? capabilities : [], evidenceIds: [`saved-response-synthetic-${i}`],
    limitations: ['Authored fixture only; no sandbox, live or semantic qualification.'] })),
  scopes.map((scope, i): SyntheticConnectorEvidence => ({ scope, id: `saved-response-synthetic-${i}`, implementationDigest: implementationDigests[i],
    assertions: ['operation', ...(i === 0 ? capabilities : [])], observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-05T00:00:00.000Z',
    artifact: { sha256: digest('authored saved-response public contract tests'), reference: 'platform/tests/accounting-saved-response.test.ts' },
    environment: 'synthetic', notes: ['Authored bytes and independent hand-worked totals; not vendor evidence.'],
    provenance: { kind: 'synthetic-fixture', generatorVersion: 'saved-creditnotes-fixture-1' } })));
}
function independentReport(patch: Partial<IndependentSourceTotals> = {}): IndependentSourceTotals {
  return { provenance: 'independent-source-report', reportId: 'synthetic-hand-worked-credit-note-register',
    sha256: digest('Synthetic register: CN 21001 = INR 9007199254740993.01; CN 21002 = INR 0.09; count 2; total minor 900719925474099310.'),
    domainHash: digest(domain), company: domain.company, dataset: domain.dataset, currency: 'INR', rowCount: 2,
    amountMinor: sourceAmountMinor, observedAt: at, snapshotId: null, ...patch };
}
type SavedFile = { content: Uint8Array; contentType: string; organizationId: string; companyId: string };
async function setup(options: { pages?: Uint8Array[]; manifest?: readonly string[]; readFile?: (page: number, context: ReadTransportContext) => Promise<SavedFile>; review?: boolean } = {}) {
  const pages = (options.pages ?? nativePages).map(page => Uint8Array.from(page));
  const profile = { organizationId: '12345', companyId: '12345', dataset: domain.dataset, pageSha256: options.manifest ?? pages.map(sha256) };
  const operation: ConnectorOperationScope = { connectorId: 'zoho-books', connectorVersion: ZOHO_SAVED_RESPONSE_VERSION,
    operationId: ZOHO_SAVED_RESPONSE_OPERATION_ID, kind: 'export', transport: 'file', applicability: { applicationVersion: 'v3',
      edition: 'authored-synthetic', module: 'creditnotes', configuration: zohoSavedResponseConfiguration(profile), deploymentProfile: 'synthetic' } };
  const importOperation: ConnectorOperationScope = { ...operation, operationId: `${operation.operationId}.captured-import`, kind: 'import' };
  const store = new Store(); await new OntologyService(store).publish(ctx, dictionary);
  const registry = registryFor([operation, importOperation]), calls: number[] = [];
  const adapter = createZohoSavedResponseAdapter({ ...profile, operation, environment: 'synthetic', readFile: async (page, context) => {
    calls.push(page);
    return options.readFile ? options.readFile(page, context)
      : { content: pages[page - 1], contentType: 'application/json', organizationId: profile.organizationId, companyId: profile.companyId };
  } });
  const authority = { tenantId: store.state.workspace.id, sourceId, companyId: profile.companyId, organizationId: profile.organizationId };
  const reader = new ConnectorReadDispatcher({ registry, clock: { nowMs: () => milliseconds, setTimer: () => () => {}, sleep: async () => {} }, authorize: async () => {
    authorize(store, ctx, 'prepare'); assertSourceAccess(store.read(), ctx, [sourceId]);
    return { scope: authority, authorityRevision: trustFingerprint(store.read(), ctx, [sourceId]), grantedScopes: ['files.read'],
      expiresAtMs: milliseconds + 60_000, credentialReference: null };
  } });
  const parse = (content: string) => parseZohoPage(content, { resource: 'creditnotes', organizationId: profile.organizationId });
  const decoder = createAccountingDecoder({ id: 'synthetic-saved-creditnotes-decoder', version: 'fixture-1',
    identityNamespace: 'synthetic-zoho-creditnote-revisions', schemaSha256: zohoSchemaFingerprint(nativePages[0].toString('utf8')),
    company: domain.company, dataset: domain.dataset, branch: 'all', measure: 'total', minorDigitsByCurrency: { INR: 2 }, parse });
  const importer = new CursorImportService(store, registry, decoder, { now: () => at });
  const proposal = proposeAccountingMapping({ id: 'synthetic-creditnotes-mapping-v1', system: 'zoho-books', edition: operation.applicability.edition,
    company: domain.company, branch: 'all', currency: 'INR', eventTypes: { 'credit-note:creditnote:receivable': 'refund' }, statuses: { 'open:open': 'open' } });
  const review = options.review === false ? null : await importer.reviewMapping(ctx, { sourceId, scope: importOperation, domain,
    recipe: proposal.recipe, evidence: { reportId: 'synthetic-owner-reviewed-creditnotes-schema', sha256: decoder.schemaSha256 } });
  const bridge = new ConnectorReadImportBridge(store, { readOperation: operation, importOperation, authority, domain,
    decoder: importer.decoderDescriptor(), contentTypes: ['application/json'] }, { reader, registry, importer, now: () => at });
  const request: CaptureRequest = { sourceId, scope: importOperation, domain, recipe: proposal.recipe,
    reviewId: review?.id ?? 'unaccepted-proposal', idempotencyKey: 'synthetic-saved-creditnotes-import-1',
    snapshot: { kind: 'unverified', limitation: 'Saved response bytes provide no consistent company snapshot or source observation clock.' } };
  const read = () => reader.read({ operation, authority, dataScope: domain, environment: 'synthetic' }, adapter);
  return { pages, profile, operation, importOperation, store, registry, calls, adapter, authority, reader, decoder, parse, importer, proposal, review, bridge, request, read };
}
async function captured(options: Parameters<typeof setup>[0] = {}) {
  const f = await setup(options), raw = await f.read(), capture = await f.bridge.capture(ctx, { read: raw, request: f.request });
  return { ...f, raw, capture, lease: { captureId: capture.id, generation: capture.generation } };
}
const noPublication = (store: Store) => { assert.equal(store.state.facts.length, 0); assert.equal(store.state.receipts.length, 0); };

test('saved native response files preserve all original bytes through public read/capture/reconciliation and a synthetic arithmetic receipt', async () => {
  const f = await captured(); assert.deepEqual(f.calls, [1, 2]);
  assert.equal(f.raw.receipt.minimumQualification, 'synthetic-tested'); assert.equal(f.raw.receipt.environment, 'synthetic');
  assert.equal(f.raw.receipt.pages, 2); assert.equal(f.raw.receipt.rows, 2); assert.equal(f.raw.receipt.requests, 2);
  assert.deepEqual(f.raw.receipt.contentHashes, nativePages.map(sha256)); assert.equal(f.raw.freshness.state, 'unknown');
  assert.equal(f.raw.completeness.source, 'unknown'); assert.equal(f.raw.completeness.snapshot, 'unverified'); assert.equal(f.raw.completeness.expectedRows, null);
  assert.equal(f.capture.pages[0].content, nativePages[0].toString('utf8')); assert.equal(f.capture.pages[1].content, nativePages[1].toString('utf8'));
  assert.deepEqual(f.capture.pages.map(page => page.sha256), f.raw.receipt.contentHashes);
  assert.deepEqual(f.capture.pages.map(page => page.sourceObservedAt), [null, null]);
  assert.equal(f.capture.pages[0].nextCursor, '{"kind":"page","page":2}'); assert.equal(f.capture.pages[1].fromCursor, f.capture.pages[0].nextCursor);
  assert.equal(f.capture.pages[1].terminal, true); assert.equal(f.capture.totalBytes, nativePages.reduce((sum, page) => sum + page.byteLength, 0));
  assert.deepEqual(f.capture.pages.flatMap(page => page.rows.map(row => row.amount)), ['900719925474099301', '9']); noPublication(f.store);
  const evidence = JSON.parse(f.capture.pages[0].rows[0].accounting as string);
  assert.equal(evidence.total, '9007199254740993.0100'); assert.equal(evidence.source.total, evidence.total); assert.equal(evidence.kind, 'credit-note');
  assert.ok(evidence.warnings.includes('CREDIT_NOTE_IS_NOT_CASH_REFUND')); assert.ok(evidence.warnings.includes('LIST_SUMMARY_REQUIRES_DETAIL'));
  const sourceTotals = independentReport(), reconciliation = reconcileAccountingSourceTotals({ records: f.pages.flatMap(page => f.parse(Buffer.from(page).toString('utf8')).records),
    kind: 'credit-note', currency: 'INR', minorDigits: 2, measure: 'total', domain, snapshot: f.request.snapshot, expected: sourceTotals });
  assert.equal(reconciliation.status, 'matched'); assert.equal(reconciliation.observed.amountMinor, sourceAmountMinor); assert.equal(reconciliation.snapshotConsistent, false);
  const published = await f.importer.publish(ctx, f.lease, sourceTotals);
  assert.equal(published.status, 'published'); assert.equal(published.totalsMinor, sourceAmountMinor); assert.equal(published.coverage.snapshotConsistent, false);
  assert.equal(published.recipeHash, digest(f.proposal.recipe)); assert.equal(published.reviewId, f.review!.id);
  assert.throws(() => f.importer.assertReady(ctx, sourceId, domain), code('SOURCE_NOT_READY'));
  // This unguarded in-memory invocation verifies the explicit fixture metric, not a production certified answer.
  const receipt = await new CalculatorService(f.store).calculate(ctx, { operation: metric, sourceIds: [sourceId], period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(receipt.valueMinor, sourceAmountMinor); assert.equal(receipt.operation, metric); assert.equal(receipt.rowIds.length, 2);
  assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.deepEqual(receipt.coverage.importIds, [published.id]);
  const link = f.store.state.imports.find(item => item.type === 'connector-read-import-link-v1') as ReadImportLink;
  assert.deepEqual(link.pages.map(page => page.provenance.contentSha256), f.raw.receipt.contentHashes);
  assert.equal(link.dataScopeHash, digest(domain)); assert.equal(link.decoderDefinitionHash, f.importer.decoderDescriptor().definitionHash);
  const evidencePath = process.env.CHAUSAR_SAVED_RESPONSE_ARTIFACT;
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify({ qualification: 'authored-synthetic-only', semanticQualification: 'unqualified',
    liveVerified: false, writebackQualified: false, rawPageSha256: f.raw.receipt.contentHashes, nativeBytes: f.raw.receipt.bytes,
    sourceCompleteness: f.raw.completeness, sourceObservedAt: published.pages.map(page => page.sourceObservedAt),
    decoderDescriptor: f.importer.decoderDescriptor(), mappingReview: f.review, recipeHash: published.recipeHash,
    captureId: published.id, generation: published.generation, sourceTotals, reconciliation: published.reconciliation,
    readImportLinkId: link.id, readQualification: link.readReceipt.qualification, receipt: { id: receipt.id, operation: receipt.operation,
      valueMinor: receipt.valueMinor, rowIds: receipt.rowIds, dictionaryHash: receipt.dictionaryHash, definitionHash: receipt.definitionHash,
      coverage: receipt.coverage }, readinessRefusal: 'SOURCE_NOT_READY' }, null, 2) + '\n');
});

test('replaying the same files/import key and republishing adds no duplicate contribution', async () => {
  const f = await captured(), first = await f.importer.publish(ctx, f.lease, independentReport());
  const replay = await f.bridge.capture(ctx, { read: await f.read(), request: f.request });
  assert.equal(replay.id, first.id); assert.equal(replay.pages.length, 2); assert.equal(replay.status, 'published');
  const repeated = await f.importer.publish(ctx, f.lease, independentReport()); assert.deepEqual(repeated.rowIds, first.rowIds);
  const separate = await f.bridge.capture(ctx, { read: await f.read(), request: { ...f.request, idempotencyKey: 'synthetic-saved-creditnotes-import-2' } });
  const republished = await f.importer.publish(ctx, { captureId: separate.id, generation: separate.generation }, independentReport());
  assert.deepEqual(republished.rowIds, first.rowIds); assert.equal(f.store.state.facts.length, 2);
  const receipt = await new CalculatorService(f.store).calculate(ctx, { operation: metric }); assert.equal(receipt.valueMinor, sourceAmountMinor);
});

test('absent, mismatched, wrong-count and wrong-domain independent totals quarantine without facts or receipts', async () => {
  for (const totals of [null, independentReport({ amountMinor: '900719925474099311' }), independentReport({ rowCount: 3 }),
    independentReport({ domainHash: digest('other-domain') }), independentReport({ currency: 'USD' })]) {
    const f = await captured(), result = await f.importer.publish(ctx, f.lease, totals);
    assert.equal(result.status, 'quarantined'); assert.equal(result.coverage.reconciled, false); noPublication(f.store);
    assert.deepEqual(result.pages.map(page => page.sha256), nativePages.map(sha256));
    assert.equal(result.reconciliation?.status, totals === null ? 'unavailable' : 'mismatch');
    if (totals === null) assert.equal(result.reconciliation?.differenceMinor, null);
    assert.throws(() => f.importer.assertReady(ctx, sourceId, domain), code('SOURCE_NOT_READY'));
  }
});

test('a terminal filtered response remains unreconciled against the full independent source report', async () => {
  const content = Buffer.from(nativePages[0].toString('utf8').replace('"has_more_page": true', '"has_more_page": false'));
  const f = await captured({ pages: [content] });
  assert.equal(f.raw.receipt.outcome, 'complete'); assert.equal(f.raw.completeness.pagination, 'complete');
  assert.equal(f.raw.receipt.rows, 1); assert.equal(f.raw.completeness.source, 'unknown');
  const result = await f.importer.publish(ctx, f.lease, independentReport());
  assert.equal(result.status, 'quarantined'); assert.equal(result.reconciliation?.status, 'mismatch');
  assert.deepEqual(result.reconciliation?.observed, { rowCount: 1, amountMinor: '900719925474099301', currency: 'INR' });
  assert.equal(result.reconciliation?.differenceMinor, '-9');
  assert.ok(result.reconciliation?.reasons.includes('SOURCE_ROW_MISMATCH'));
  assert.ok(result.reconciliation?.reasons.includes('SOURCE_TOTAL_MISMATCH'));
  assert.equal(result.pages[0].content, content.toString('utf8')); assert.equal(result.pages[0].sha256, sha256(content)); noPublication(f.store);
});

test('fractional minor units are retained and quarantined instead of rounded', async () => {
  const pages = [Buffer.from(nativePages[0].toString('utf8').replaceAll('9007199254740993.0100', '9007199254740993.0101')), nativePages[1]];
  const f = await captured({ pages }); assert.equal(f.capture.status, 'quarantined');
  assert.ok(f.capture.gaps.some(gap => gap.code === 'ACCOUNTING_MINOR_PRECISION'));
  assert.equal(f.capture.pages[0].content, pages[0].toString('utf8')); assert.equal(f.capture.pages[0].sha256, sha256(pages[0])); noPublication(f.store);
  await assert.rejects(f.importer.publish(ctx, f.lease, independentReport()), code('CAPTURE_INCOMPLETE'));
});

test('conflicting amounts for one immutable credit note revision quarantine in either native-page arrival order', async () => {
  for (const amounts of [['9007199254740993.0100', '0.0900'], ['0.0900', '9007199254740993.0100']]) {
    const pages = [Buffer.from(nativePages[0].toString('utf8').replaceAll('9007199254740993.0100', amounts[0])),
      Buffer.from(nativePages[0].toString('utf8').replaceAll('9007199254740993.0100', amounts[1])
        .replace('"page": 1', '"page": 2').replace('"has_more_page": true', '"has_more_page": false'))];
    const f = await captured({ pages }); assert.equal(f.capture.status, 'quarantined');
    assert.ok(f.capture.gaps.some(gap => gap.code === 'IMMUTABLE_IDENTITY_CONFLICT')); noPublication(f.store);
    assert.deepEqual(f.capture.pages.map(page => page.sha256), pages.map(sha256));
    await assert.rejects(f.importer.publish(ctx, f.lease, independentReport()), code('CAPTURE_INCOMPLETE'));
  }
});

test('incomplete, missing-termination, wrong-page and surplus saved-response manifests are refused before capture', async () => {
  const variants = [
    [nativePages[0]],
    [Buffer.from(nativePages[0].toString('utf8').replace('"has_more_page": true', '"has_more_page": null')), nativePages[1]],
    [nativePages[1]],
    [nativePages[0], Buffer.from(nativePages[1].toString('utf8').replace('"page": 2', '"page": 3'))],
    [nativePages[0], nativePages[1], nativePages[1]],
  ];
  for (const pages of variants) {
    const f = await setup({ pages });
    await assert.rejects(f.read(), (error: unknown) => { assert.ok(error instanceof ConnectorReadError); assert.equal(error.receipt.outcome, 'refused'); return true; });
    assert.equal(f.store.state.imports.filter(item => item.type === 'connector-capture-v1').length, 0); noPublication(f.store);
  }
});

test('malformed JSON, duplicate source keys, invalid UTF-8 and changed pinned bytes charge refused file bytes', async () => {
  const variants = [Buffer.from('{"code":'), Buffer.from(nativePages[0].toString('utf8').replace('"code": 0', '"code": 0, "code": 0')),
    Uint8Array.from([0xc3, 0x28]), Buffer.from(nativePages[0].toString('utf8').replace('SYN-SAVED-CN-1', 'MUTATED'))];
  for (const [i, content] of variants.entries()) {
    const f = await setup({ pages: [content, nativePages[1]], ...(i === 3 ? { manifest: nativePages.map(sha256) } : {}) });
    await assert.rejects(f.read(), (error: unknown) => {
      assert.ok(error instanceof ConnectorReadError); assert.equal(error.code, 'READ_TRANSPORT_INVALID_REQUEST');
      assert.equal(error.receipt.discardedBytes, content.byteLength); assert.equal(error.receipt.transportBytes, content.byteLength);
      assert.equal(error.receipt.pages, 0); return true;
    }); noPublication(f.store);
  }
});

test('saved-response scope and file custody cannot alias a different organization, company or dataset', async () => {
  for (const filePatch of [{ organizationId: '99999' }, { companyId: 'other-company' }, { contentType: 'text/html' }]) {
    const f = await setup({ readFile: async page => ({ content: nativePages[page - 1], contentType: 'application/json', organizationId: '12345', companyId: '12345', ...filePatch }) });
    await assert.rejects(f.read(), code('READ_TRANSPORT_INVALID_REQUEST')); noPublication(f.store);
  }
  const f = await setup();
  await assert.rejects(f.reader.read({ operation: f.operation, authority: f.authority, dataScope: { ...domain, dataset: 'another-dataset' }, environment: 'synthetic' }, f.adapter));
  assert.deepEqual(f.calls, []); noPublication(f.store);
});

test('mapping changes need a distinct owner review and cannot reuse the original capture identity', async () => {
  const f = await captured(), revised = structuredClone(f.proposal.recipe); revised.id = 'synthetic-creditnotes-mapping-v2';
  revised.bindings.find(binding => binding.target === 'status')!.values!['open:open'] = 'pending'; revised.allowedStatuses = ['pending'];
  const raw = await f.read();
  await assert.rejects(f.bridge.capture(ctx, { read: raw, request: { ...f.request, recipe: revised } }), code('MAPPING_REVIEW_REQUIRED'));
  const revisionReview = await f.importer.reviewMapping(ctx, { sourceId, scope: f.importOperation, domain, recipe: revised,
    evidence: { reportId: 'synthetic-owner-mapping-v2-review', sha256: f.decoder.schemaSha256 } });
  assert.notEqual(revisionReview.id, f.review!.id); assert.notEqual(revisionReview.recipeHash, f.review!.recipeHash);
  await assert.rejects(f.bridge.capture(ctx, { read: raw, request: { ...f.request, recipe: revised, reviewId: revisionReview.id } }), code('IDEMPOTENCY_CONFLICT'));
  const revision = await f.bridge.capture(ctx, { read: raw, request: { ...f.request, recipe: revised, reviewId: revisionReview.id, idempotencyKey: 'synthetic-reviewed-mapping-v2-capture' } });
  assert.equal(revision.recipeHash, digest(revised)); assert.equal(revision.reviewId, revisionReview.id); assert.equal(revision.status, 'capturing');
  assert.equal(f.importer.get(ctx, f.capture.id).recipeHash, digest(f.proposal.recipe)); noPublication(f.store);
});

test('unaccepted proposals, forged read DTOs and changed original bytes fail before capture', async () => {
  const unreviewed = await setup({ review: false });
  await assert.rejects(unreviewed.bridge.capture(ctx, { read: await unreviewed.read(), request: unreviewed.request }), code('MAPPING_REVIEW_REQUIRED'));
  assert.equal(unreviewed.store.state.imports.length, 0); noPublication(unreviewed.store);
  for (const mutate of [false, true]) {
    const f = await setup(), raw = await f.read(); if (mutate) raw.pages[0].content[0] ^= 1;
    await assert.rejects(f.bridge.capture(ctx, { read: mutate ? raw : structuredClone(raw), request: f.request }), code(mutate ? 'READ_RESULT_CHANGED' : 'READ_RESULT_NOT_ISSUED'));
    assert.equal(f.store.state.imports.filter(item => item.type === 'connector-capture-v1').length, 0); noPublication(f.store);
  }
});

test('new source fields quarantine exact saved bytes under the existing reviewed schema', async () => {
  const pages = [Buffer.from(nativePages[0].toString('utf8').replace('"creditnote_number": "SYN-SAVED-CN-1"', '"creditnote_number": "SYN-SAVED-CN-1", "new_source_basis": "review-required"')), nativePages[1]];
  const f = await captured({ pages }); assert.equal(f.capture.status, 'quarantined');
  assert.ok(f.capture.gaps.some(gap => gap.code === 'SCHEMA_CHANGE_REVIEW_REQUIRED'));
  assert.equal(f.capture.pages[0].content, pages[0].toString('utf8')); assert.equal(f.capture.pages[0].rows.length, 0); noPublication(f.store);
  await assert.rejects(f.importer.publish(ctx, f.lease, independentReport()), code('CAPTURE_INCOMPLETE'));
});

test('saved source timestamps cannot be promoted into snapshots and synthetic evidence cannot qualify live reads', async () => {
  const f = await setup(), raw = await f.read();
  await assert.rejects(f.bridge.capture(ctx, { read: raw, request: { ...f.request, snapshot: { kind: 'source-snapshot', id: 'invented-snapshot' } } }), code('BRIDGE_SNAPSHOT_MISMATCH'));
  assert.throws(() => f.registry.assertCanUse(f.operation, at, 'live-verified'), code('CONNECTOR_NOT_QUALIFIED'));
  const unqualified = new ConnectorReadDispatcher({ registry: new ConnectorCapabilityRegistry(),
    authorize: async () => { throw new Error('Unqualified acquisition must refuse before file authority.'); } });
  await assert.rejects(unqualified.read({ operation: f.operation, authority: f.authority, dataScope: domain, environment: 'synthetic' }, f.adapter), code('READ_CAPABILITY_UNQUALIFIED'));
  assert.equal(f.store.state.imports.filter(item => item.type === 'connector-capture-v1').length, 0); noPublication(f.store);
});

test('public Engine connector methods list the installed file candidate and refuse unqualified or unknown-time admission', async () => {
  const f = await setup(), candidate = createAccountingConnectorCandidate({ id: 'synthetic-saved-creditnotes-profile',
    title: 'Authored synthetic saved creditnotes', sourceId, companyId: f.profile.companyId, organizationId: f.profile.organizationId,
    domain, environment: 'synthetic', syntheticFixture: true, reader: f.adapter, importOperation: f.importOperation,
    readImplementationDigest: implementationDigests[0], importImplementationDigest: implementationDigests[1],
    contentTypes: ['application/json'], maximumSourceAgeMs: 60_000,
    decoder: { id: f.decoder.id, version: 'fixture-1', identityNamespace: f.decoder.identityNamespace, schemaSha256: f.decoder.schemaSha256,
      company: domain.company, dataset: domain.dataset, branch: 'all', measure: 'total', minorDigitsByCurrency: { INR: 2 }, parse: f.parse },
    mapping: { id: 'synthetic-creditnotes-mapping-v1', currency: 'INR', eventTypes: { 'credit-note:creditnote:receivable': 'refund' }, statuses: { 'open:open': 'open' } } });
  assert.equal(candidate.admission.semanticQualification, 'unqualified'); assert.equal(candidate.admission.ready, false);
  assert.equal(candidate.admission.liveVerified, false); assert.equal(candidate.admission.writebackQualified, false);
  const empty = new EngineConnectorService(f.store, { profiles: [candidate.profile],
    clock: { nowMs: () => milliseconds, setTimer: () => () => {}, sleep: async () => {} } });
  try {
    const profiles = await empty.request(ctx, 'connectors.profiles'); assert.equal(profiles.length, 1);
    assert.equal(profiles[0].read.level, 'unqualified'); assert.equal(profiles[0].import.level, 'unqualified');
    assert.equal(profiles[0].syntheticFixture, true); assert.equal(profiles[0].semanticQualification, 'unverified');
    await assert.rejects(empty.request(ctx, 'connectors.read', { profileId: candidate.profile.id }), code('CONNECTOR_DEFINITION_UNQUALIFIED'));
    assert.deepEqual(f.calls, []);
    const calculator = new CalculatorService(f.store, { consumerGuard: (context, request) => empty.assertCalculationReady(context, request) });
    await assert.rejects(calculator.calculate(ctx, { operation: metric }), code('SOURCE_NOT_READY')); noPublication(f.store);
  } finally { empty.close(); }
  const qualified = new EngineConnectorService(f.store, { profiles: [candidate.profile], registry: f.registry,
    clock: { nowMs: () => milliseconds, setTimer: () => () => {}, sleep: async () => {} }, authorizeRead: async () => ({
      scope: f.authority, authorityRevision: trustFingerprint(f.store.read(), ctx, [sourceId]), grantedScopes: ['files.read'],
      expiresAtMs: milliseconds + 60_000, credentialReference: null }) });
  try {
    const profiles = await qualified.request(ctx, 'connectors.profiles'); assert.equal(profiles[0].read.level, 'synthetic-tested');
    assert.equal(profiles[0].import.level, 'synthetic-tested'); assert.equal(profiles[0].semanticQualification, 'unverified');
    await assert.rejects(qualified.request(ctx, 'connectors.read', { profileId: candidate.profile.id }), code('CONNECTOR_SOURCE_NOT_CURRENT'));
    assert.deepEqual(f.calls, [1, 2]); noPublication(f.store);
    assert.equal(f.store.state.imports.filter(item => item.type === 'connector-capture-v1').length, 0);
  } finally { qualified.close(); }
});
