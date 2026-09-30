import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import type { MappingRecipe } from '../runtime/ingest.ts';
import { ConnectorCapabilityRegistry, type ConnectorOperationScope } from '../runtime/connector-framework/registry.ts';
import { CAPTURE_LIMITS, CursorImportService, reconcileSourceTotals, type CaptureLease, type CapturedPageInput, type DecodedSourceRow, type IndependentSourceTotals, type QualifiedDecoder } from '../runtime/connector-framework/import.ts';
import { SOURCE_PROFILE_NOTICES } from '../runtime/connector-framework/profiles.ts';

const ctx: Context = { memberId: 'owner', epoch: 1, role: 'owner' };
const at = '2026-09-30T12:00:00.000Z';
class Store implements StateStore {
  state: State = initialState('Fixture', true); failCommit = false;
  read() { return structuredClone(this.state); }
  async update<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const draft = structuredClone(this.state), result = await fn(draft);
    if (this.failCommit) { this.failCommit = false; throw new Error('synthetic crash before durable commit'); }
    draft.revision++; this.state = draft; return result;
  }
}
const scope: ConnectorOperationScope = { connectorId: 'synthetic-fixture', connectorVersion: 'v1', operationId: 'import-sales', kind: 'import', transport: 'file', applicability: { applicationVersion: 'v1', edition: 'fixture', module: 'sales', configuration: 'synthetic-config-v1', deploymentProfile: 'synthetic' } };
const domain = { company: 'Fixture', dataset: 'sales', branches: ['main'], period: { from: '2026-09-01', to: '2026-09-30' } };
const recipe: MappingRecipe = { version: 1, id: 'synthetic-mapping-v1', system: 'synthetic', edition: 'fixture', scope: { company: 'Fixture', branches: ['main'] }, bindings: [
  { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
  { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
  { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
  { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
  { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
  { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' },
], allowedKinds: ['sale'], allowedStatuses: [], onUnmapped: 'reject', ignoredFields: ['revision'] };
const decoder: QualifiedDecoder = { id: 'fixture-json', version: 'v1', identityNamespace: 'sales-revisions-v1', resourceIdentityFields: ['id', 'kind'], revisionOrder: { kind: 'unqualified' }, schemaSha256: digest('fixture-schema-v1'), identityFields: ['id', 'revision'], businessFields: ['id', 'revision', 'kind', 'date', 'amount', 'currency', 'branch'], deliveryFields: ['deliveryNote'], decode: content => JSON.parse(content) };
const row = (id = 'sale-1', amount = '1050', revision = '1'): DecodedSourceRow => ({ id, revision, kind: 'sale', date: '2026-09-15', amount, currency: 'INR', branch: 'main' });
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
const total = (rowCount = 1, amountMinor = '1050'): IndependentSourceTotals => ({ provenance: 'independent-source-report', reportId: 'reviewed-source-report', sha256: digest({ rowCount, amountMinor }), domainHash: digest(domain), company: 'Fixture', dataset: 'sales', currency: 'INR', rowCount, amountMinor, observedAt: at, snapshotId: 'snapshot-1' });
const page = (rows: DecodedSourceRow[], patch: Partial<CapturedPageInput> = {}): CapturedPageInput => ({ deliveryId: 'page-1', content: JSON.stringify(rows), fromCursor: null, nextCursor: null, terminal: true, schemaSha256: decoder.schemaSha256, decoderId: decoder.id, decoderVersion: decoder.version, sourceObservedAt: at, ...patch });
async function setup(customDecoder = decoder, customRecipe = recipe) {
  const store = new Store(); await new OntologyService(store).publish(ctx, 'ecommerce');
  const registry = new ConnectorCapabilityRegistry([{ scope, implemented: true, capabilities: ['corrections'], evidenceIds: ['synthetic-import'], limitations: ['Synthetic only'] }], [{ id: 'synthetic-import', scope, assertions: ['operation', 'corrections'], observedAt: '2026-09-30T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z', artifact: { sha256: digest('fixture-suite'), reference: 'platform/tests/connector-import.test.ts' }, notes: ['Synthetic only'], environment: 'synthetic', provenance: { kind: 'synthetic-fixture', generatorVersion: 'v1' } }]);
  const service = new CursorImportService(store, registry, customDecoder, { now: () => at });
  const review = await service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain, recipe: customRecipe, evidence: { reportId: 'reviewed-schema-report', sha256: decoder.schemaSha256 } });
  const request = { sourceId: 'source-1', scope, domain, recipe: customRecipe, reviewId: review.id, snapshot: { kind: 'source-snapshot' as const, id: 'snapshot-1' }, idempotencyKey: 'fixture-capture-1' };
  const lease = await service.open(ctx, request);
  return { store, service, registry, lease, request, review };
}

test('capture persists raw provenance before publication and exact replay adds one contribution', async () => {
  const { store, service, lease, request } = await setup();
  assert.deepEqual(await service.open(ctx, request), lease);
  const captured = await service.capturePage(ctx, lease, page([row()]));
  assert.equal(store.state.facts.length, 0); assert.equal(captured.pages[0].content, JSON.stringify([row()]));
  assert.equal(captured.pages[0].sha256.length, 64); assert.equal(captured.pages[0].bytes, Buffer.byteLength(captured.pages[0].content));
  assert.deepEqual(captured.progress, { capturedPages: 1, parsedPages: 1, validatedPages: 0, publishedPages: 0 });
  await service.capturePage(ctx, lease, page([row()]));
  const published = await service.publish(ctx, lease, total()); await service.publish(ctx, lease, total());
  assert.equal(published.status, 'published'); assert.equal(store.state.facts.length, 1); assert.equal(published.coverage.snapshotConsistent, true);
  assert.doesNotThrow(() => service.assertReady(ctx, 'source-1', domain));
  const receipt = await new CalculatorService(store).calculate(ctx, { operation: 'earned', period: domain.period });
  assert.equal(receipt.valueMinor, '1050'); assert.equal(receipt.rowIds.length, 1);
});

test('crash before captured-page commit preserves cursor and replay never skips rows', async () => {
  const { store, service, lease } = await setup(); store.failCommit = true;
  await assert.rejects(service.capturePage(ctx, lease, page([row()], { terminal: false, nextCursor: 'opaque-2' })), /synthetic crash/);
  assert.equal(service.get(ctx, lease.captureId).progress.capturedPages, 0);
  assert.equal(service.get(ctx, lease.captureId).frontiers.captured, null);
  await service.capturePage(ctx, lease, page([row()], { terminal: false, nextCursor: 'opaque-2' }));
  await service.capturePage(ctx, lease, page([row('sale-2', '2000')], { deliveryId: 'page-2', fromCursor: 'opaque-2' }));
  store.failCommit = true; await assert.rejects(service.publish(ctx, lease, total(2, '3050')), /synthetic crash/);
  assert.equal(store.state.facts.length, 0); assert.equal(service.get(ctx, lease.captureId).progress.publishedPages, 0);
  const published = await service.publish(ctx, lease, total(2, '3050'));
  assert.equal(store.state.facts.length, 2); assert.equal(published.totalsMinor, '3050');
});

test('duplicate immutable revisions across page overlap deduplicate without treating payload formatting as change', async () => {
  const { service, lease, store } = await setup();
  await service.capturePage(ctx, lease, page([row()], { terminal: false, nextCursor: 'c2' }));
  await service.capturePage(ctx, lease, page([{ ...row(), deliveryNote: 'new delivery metadata' }], { content: JSON.stringify([{ ...row(), deliveryNote: 'new delivery metadata' }], null, 2), terminal: false, nextCursor: 'c2' }));
  const captured = await service.capturePage(ctx, lease, page([row(), row('sale-2', '2000')], { deliveryId: 'page-2', fromCursor: 'c2' }));
  assert.equal(captured.coverage.sourceRows, 2); assert.equal(captured.pages.length, 2);
  await service.publish(ctx, lease, total(2, '3050')); assert.equal(store.state.facts.length, 2);
});

test('conflicting redelivery after publication quarantines readiness and marks saved receipts stale', async () => {
  const { service, lease, store } = await setup(); await service.capturePage(ctx, lease, page([row()])); await service.publish(ctx, lease, total());
  await new CalculatorService(store).calculate(ctx, { operation: 'earned' });
  const conflict = await service.capturePage(ctx, lease, page([row('sale-1', '9999')]));
  assert.equal(conflict.status, 'quarantined'); assert.equal(conflict.coverage.reconciled, false);
  assert.equal(store.state.facts.length, 1); assert.ok(store.state.receipts.every(r => r.stale));
  assert.throws(() => service.assertReady(ctx, 'source-1', domain), code('SOURCE_NOT_READY'));
});

test('conflicting same-revision content in either arrival order never publishes a winner', async () => {
  for (const amounts of [['1050', '9999'], ['9999', '1050']]) {
    const { service, lease, store } = await setup();
    await service.capturePage(ctx, lease, page([row('sale-1', amounts[0])], { terminal: false, nextCursor: 'c2' }));
    const conflict = await service.capturePage(ctx, lease, page([row('sale-1', amounts[1])], { deliveryId: 'page-2', fromCursor: 'c2' }));
    assert.equal(conflict.status, 'quarantined'); assert.ok(conflict.gaps.some(g => g.code === 'IMMUTABLE_IDENTITY_CONFLICT')); assert.equal(store.state.facts.length, 0);
    await assert.rejects(service.publish(ctx, lease, total()), code('CAPTURE_INCOMPLETE'));
  }
});

test('schema drift retains bytes and captured frontier while withholding parsed progress', async () => {
  const { service, lease, store } = await setup();
  const drift = await service.capturePage(ctx, lease, page([row()], { schemaSha256: digest('new-schema'), terminal: false, nextCursor: 'c2' }));
  assert.equal(drift.status, 'quarantined'); assert.equal(drift.pages[0].content, JSON.stringify([row()]));
  assert.equal(drift.frontiers.captured, 'c2'); assert.equal(drift.frontiers.parsed, null); assert.equal(drift.progress.parsedPages, 0);
  assert.equal(store.state.facts.length, 0);
});

test('source totals are scoped independent evidence and missing money remains unavailable', async () => {
  assert.equal(reconcileSourceTotals({ rowCount: 1, amountMinor: null, currency: 'INR' }, total(), domain, { kind: 'source-snapshot', id: 'snapshot-1' }).status, 'unavailable');
  assert.equal(reconcileSourceTotals({ rowCount: 0, amountMinor: '0', currency: 'INR' }, null, domain, { kind: 'unverified', limitation: 'No snapshot guarantee' }).differenceMinor, null);
  for (const totals of [null, total(2), total(1, '9999'), { ...total(), domainHash: digest('wrong-domain') }, { ...total(), currency: 'USD' }]) {
    const { service, lease, store } = await setup(); await service.capturePage(ctx, lease, page([row()]));
    assert.equal((await service.publish(ctx, lease, totals)).status, 'quarantined'); assert.equal(store.state.facts.length, 0);
  }
});

test('unknown snapshot consistency prevents readiness even if independent totals match', async () => {
  const { service, request, store } = await setup();
  const lease = await service.open(ctx, { ...request, idempotencyKey: 'unverified-snapshot', snapshot: { kind: 'unverified', limitation: 'Moving collection has no coupled cut' } });
  await service.capturePage(ctx, lease, page([row()])); const result = await service.publish(ctx, lease, total());
  assert.equal(result.status, 'published'); assert.equal(result.coverage.snapshotConsistent, false); assert.equal(store.state.facts.length, 1);
  assert.throws(() => service.assertReady(ctx, 'source-1', domain), code('SOURCE_NOT_READY'));
});

test('reviewed recipe cannot zero-fill missing values, and missing source money quarantines', async () => {
  const { service, lease, store } = await setup();
  const unsafe = structuredClone(recipe); unsafe.bindings.find(b => b.target === 'amountMinor')!.nulls = 'zero';
  await assert.rejects(service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain, recipe: unsafe, evidence: { reportId: 'source', sha256: decoder.schemaSha256 } }), code('UNSAFE_MISSING_VALUE_POLICY'));
  await service.capturePage(ctx, lease, page([{ ...row(), amount: null }])); const result = await service.publish(ctx, lease, total());
  assert.equal(result.status, 'quarantined'); assert.equal(result.reconciliation?.observed.amountMinor, null); assert.equal(store.state.facts.length, 0);
});

test('generation fence, source revocation, evidence expiry and ontology changes fail closed', async () => {
  const { service, lease } = await setup(); const current = await service.takeOwnership(ctx, lease.captureId);
  await assert.rejects(service.capturePage(ctx, lease, page([row()])), code('CAPTURE_FENCE_EXPIRED')); await service.capturePage(ctx, current, page([row()]));
  const revoked = await setup(); revoked.store.state.sourceRules.push({ sourceId: 'source-1', revoked: true });
  await assert.rejects(revoked.service.capturePage(ctx, revoked.lease, page([row()])), code('SOURCE_REVOKED'));
  const expired = await setup(); expired.registry.revokeEvidence('synthetic-import', at, 'Synthetic revocation');
  await assert.rejects(expired.service.capturePage(ctx, expired.lease, page([row()])), code('CONNECTOR_NOT_QUALIFIED'));
  const ontology = await setup(); ontology.store.state.ontology.syntheticMeaningChanged = true;
  await assert.rejects(ontology.service.capturePage(ctx, ontology.lease, page([row()])), code('ONTOLOGY_CHANGED'));
});

test('opaque cursor loops, false terminal evidence and oversized raw pages cannot advance publication', async () => {
  const { service, lease } = await setup(); await service.capturePage(ctx, lease, page([row()], { terminal: false, nextCursor: 'c2' }));
  const loop = await service.capturePage(ctx, lease, page([row()], { deliveryId: 'page-2', fromCursor: 'c2', terminal: false, nextCursor: 'c2' }));
  assert.equal(loop.status, 'quarantined'); assert.equal(loop.progress.parsedPages, 1);
  const bad = await setup(); const contradiction = await bad.service.capturePage(ctx, bad.lease, page([row()], { terminal: true, nextCursor: 'c2' }));
  assert.equal(contradiction.status, 'quarantined');
  const large = await setup(); await assert.rejects(large.service.capturePage(ctx, large.lease, page([], { content: 'x'.repeat(CAPTURE_LIMITS.pageBytes + 1) })), code('INVALID_CAPTURE_PAGE'));
  assert.equal(large.service.get(ctx, large.lease.captureId).progress.capturedPages, 0);
});

test('approved complete empty scope remains distinct from an unacquired source', async () => {
  const { service, lease } = await setup(); assert.throws(() => service.assertReady(ctx, 'source-1', domain), code('SOURCE_NOT_READY'));
  await service.capturePage(ctx, lease, page([])); const empty = await service.publish(ctx, lease, total(0, '0'));
  assert.equal(empty.status, 'published'); assert.equal(empty.coverage.sourceRows, 0); assert.equal(empty.coverage.reconciled, true);
  assert.doesNotThrow(() => service.assertReady(ctx, 'source-1', domain));
});

test('same immutable revision conflicts across overlapping acquisition filters and invalidates prior readiness', async () => {
  const { service, lease, store, request } = await setup(); await service.capturePage(ctx, lease, page([row()])); await service.publish(ctx, lease, total());
  const otherDomain = { ...domain, period: { from: '2026-09-10', to: '2026-09-20' } };
  const review = await service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain: otherDomain, recipe, evidence: { reportId: 'other-scope', sha256: decoder.schemaSha256 } });
  const other = await service.open(ctx, { ...request, domain: otherDomain, reviewId: review.id, idempotencyKey: 'overlap-filter-key' });
  const conflict = await service.capturePage(ctx, other, page([row('sale-1', '9999')]));
  assert.equal(conflict.status, 'quarantined'); assert.equal(service.get(ctx, lease.captureId).status, 'quarantined'); assert.equal(store.state.facts.length, 1);
  assert.throws(() => service.assertReady(ctx, 'source-1', domain), code('SOURCE_NOT_READY'));
});

test('a restarted service cannot decode or publish an existing capture under a changed decoder definition', async () => {
  const { store, registry, lease } = await setup();
  const changed = new CursorImportService(store, registry, { ...decoder, version: 'v2' }, { now: () => at });
  await assert.rejects(changed.takeOwnership(ctx, lease.captureId), code('CAPTURE_DECODER_CHANGED'));
  await assert.rejects(changed.capturePage(ctx, lease, page([row()])), code('CAPTURE_DECODER_CHANGED'));
});

test('unqualified correction ordering abstains and qualified monotonic revisions cannot roll current facts backwards', async () => {
  for (const ordered of [false, true]) {
    const fixture = await setup(ordered ? { ...decoder, revisionOrder: { kind: 'monotonic-integer', field: 'revision' } } : decoder);
    const { service, lease, request, store } = fixture;
    await service.capturePage(ctx, lease, page([row('sale-1', '9999', '2')])); await service.publish(ctx, lease, total(1, '9999'));
    const late = await service.open(ctx, { ...request, idempotencyKey: 'late-old-revision' });
    const captured = await service.capturePage(ctx, late, page([row('sale-1', '1050', '1')]));
    assert.equal(captured.status, 'quarantined'); assert.equal(captured.gaps[0].code, ordered ? 'STALE_SOURCE_REVISION' : 'REVISION_ORDER_REVIEW_REQUIRED');
    assert.equal(store.state.facts.length, 1); assert.equal(store.state.facts[0].fields.amountMinor, '9999');
  }
  const { service, lease, request, store } = await setup({ ...decoder, revisionOrder: { kind: 'monotonic-integer', field: 'revision' } });
  await service.capturePage(ctx, lease, page([row()])); await service.publish(ctx, lease, total());
  const newer = await service.open(ctx, { ...request, idempotencyKey: 'newer-source-revision' });
  await service.capturePage(ctx, newer, page([row('sale-1', '2000', '2')])); await service.publish(ctx, newer, total(1, '2000'));
  assert.equal(store.state.facts.length, 2); assert.equal(store.state.facts.at(-1)!.fields.amountMinor, '2000');
});

test('company and dataset identities cannot alias the same canonical source ID', async () => {
  const { service } = await setup(); const otherRecipe = structuredClone(recipe); otherRecipe.scope.company = 'Other Company';
  await assert.rejects(service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain: { ...domain, company: 'Other Company' }, recipe: otherRecipe, evidence: { reportId: 'other-company', sha256: decoder.schemaSha256 } }), code('SOURCE_IDENTITY_SCOPE_CONFLICT'));
  await assert.rejects(service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain: { ...domain, dataset: 'other-dataset' }, recipe, evidence: { reportId: 'other-dataset', sha256: decoder.schemaSha256 } }), code('SOURCE_IDENTITY_SCOPE_CONFLICT'));
});

test('intra-page revision conflict also quarantines an earlier published claim in an overlapping scope', async () => {
  const { service, lease, request } = await setup(); await service.capturePage(ctx, lease, page([row()])); await service.publish(ctx, lease, total());
  const otherDomain = { ...domain, period: { from: '2026-09-10', to: '2026-09-20' } };
  const review = await service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain: otherDomain, recipe, evidence: { reportId: 'other-scope', sha256: decoder.schemaSha256 } });
  const other = await service.open(ctx, { ...request, domain: otherDomain, reviewId: review.id, idempotencyKey: 'intra-page-conflict' });
  const conflict = await service.capturePage(ctx, other, page([row(), row('sale-1', '9999')]));
  assert.equal(conflict.gaps[0].code, 'IMMUTABLE_IDENTITY_CONFLICT'); assert.equal(service.get(ctx, lease.captureId).status, 'quarantined');
  assert.throws(() => service.assertReady(ctx, 'source-1', domain), code('SOURCE_NOT_READY'));
});

test('source report reconciliation stays in source currency while typed FX produces canonical values', async () => {
  const usd = structuredClone(recipe); const amount = usd.bindings.find(b => b.target === 'amountMinor')!;
  amount.currency = 'USD'; amount.fx = { numerator: '83', denominator: '1', rounding: 'exact' };
  const { service, lease, store } = await setup(decoder, usd);
  await service.capturePage(ctx, lease, page([{ ...row('sale-1', '100'), currency: 'USD' }]));
  const result = await service.publish(ctx, lease, { ...total(1, '100'), currency: 'USD' });
  assert.equal(result.status, 'published'); assert.equal(result.reconciliation!.observed.amountMinor, '100'); assert.equal(result.reconciliation!.observed.currency, 'USD');
  assert.equal(result.totalsMinor, '8300'); assert.equal(store.state.facts[0].fields.currency, 'INR');
});

test('queued review and capture transactions bind immutable caller inputs', async () => {
  const { service, store } = await setup();
  const original = store.update.bind(store); let release: (() => void) | undefined;
  store.update = async <T>(fn: (state: State) => T | Promise<T>) => { await new Promise<void>(resolve => { release = resolve; }); return original(fn); };
  const mutableRecipe = structuredClone(recipe);
  const pending = service.reviewMapping(ctx, { sourceId: 'source-1', scope, domain, recipe: mutableRecipe, evidence: { reportId: 'review', sha256: decoder.schemaSha256 } });
  mutableRecipe.bindings.find(b => b.target === 'amountMinor')!.nulls = 'zero'; release!();
  const reviewed = await pending; assert.equal(reviewed.recipeHash, digest(recipe)); assert.notEqual(reviewed.recipeHash, digest(mutableRecipe));
  store.update = original;
  await assert.rejects(service.reviewMapping({ ...ctx, sourceTainted: true }, { sourceId: 'source-1', scope, domain, recipe, evidence: { reportId: 'review', sha256: decoder.schemaSha256 } }), code('HUMAN_MAPPING_REVIEW_REQUIRED'));
});

test('paid order plus refund counts net sales once, draft activity and failed cash movement never count as realized money', async () => {
  const meanings = structuredClone(recipe); meanings.allowedKinds = ['sale', 'refund', 'payment']; meanings.allowedStatuses = ['paid', 'settled', 'draft', 'pending', 'void'];
  meanings.bindings.push({ target: 'status', source: 'status', type: 'string', nulls: 'reject' });
  const typed = { ...decoder, businessFields: [...decoder.businessFields, 'status'] };
  const { service, lease, store } = await setup(typed, meanings);
  const events = [
    { ...row('paid-order', '10000'), status: 'paid' },
    { ...row('refund-event', '2000'), kind: 'refund', status: 'settled' },
    { ...row('draft-order', '50000'), status: 'draft' },
    { ...row('failed-cash', '2000'), kind: 'payment', status: 'void' },
  ];
  await service.capturePage(ctx, lease, page(events)); await service.publish(ctx, lease, total(4, '64000'));
  const calculator = new CalculatorService(store);
  const net = await calculator.calculate(ctx, { operation: 'net_sales' }); assert.equal(net.valueMinor, '8000');
  const cash = await calculator.calculate(ctx, { operation: 'received' }); assert.equal(cash.coverage.completeness, 'empty'); assert.ok(cash.coverage.gaps.length > 0);
  assert.equal(SOURCE_PROFILE_NOTICES.find(n => n.product === 'PhonePe Pulse')!.disposition, 'collection-and-reuse-held');
  assert.ok(SOURCE_PROFILE_NOTICES.every(n => n.provenance === 'parent-source-review'));
});
