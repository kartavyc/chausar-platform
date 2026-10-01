import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import {
  EngineConnectorService, type EngineConnectorOptions, type EngineConnectorProfile,
  type ConnectorSemanticInput,
} from '../runtime/engine-connectors.ts';
import { EngineSemanticService, type EngineSemanticDossier } from '../runtime/engine-semantic.ts';
import {
  ConnectorCapabilityRegistry, CursorImportService,
  type ConnectorCapability, type ConnectorOperationScope, type ConnectorCapture,
  type IndependentSourceTotals, type ImportDomain, type QualifiedDecoder, type ReadImportLink,
  type SyntheticConnectorEvidence,
} from '../runtime/connector-framework/index.ts';
import { appendEvidence, hashData, verifyLedger } from '../semantic-qualification/src/index.ts';
import type { OperationEvidence } from '../semantic-qualification/src/contracts.ts';
import { createSyntheticSemanticFixture, fixtureDictionaryDraft } from './fixtures/engine-semantic-fixture.ts';

// Every source, host grant, implementation digest and business in this file is a labelled synthetic test fixture.
// These tests exercise the concrete adapter; they do not qualify any live installation, vendor or write-back.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const domain: ImportDomain = { company: 'Synthetic Fixture', dataset: 'sales', branches: ['main'], period };
const code = (expected: string) => (error: any) => error?.code === expected;
class Store implements StateStore {
  state = initialState('Synthetic Fixture', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft);
    draft.revision++; this.state = draft; return result;
  }
}
type Controls = { advancingClock?: boolean; alterDossier?: (dossier: EngineSemanticDossier) => void };

async function fixture(t: TestContext, controls: Controls = {}) {
  const store = new Store(); await new OntologyService(store).publish(owner, fixtureDictionaryDraft);
  const baseMs = Date.now(); let clockMs = baseMs, clockReads = 0;
  const authored = createSyntheticSemanticFixture(new Date(baseMs).toISOString());
  const decoder: QualifiedDecoder = {
    id: 'synthetic-json', version: 'v1', schemaSha256: hashData(authored.sourceSchema), identityNamespace: 'synthetic-sales-v1',
    identityFields: ['id', 'revision'], resourceIdentityFields: ['id', 'kind'], revisionOrder: { kind: 'unqualified' },
    businessFields: Object.keys(authored.sourceSchema.fields), deliveryFields: [], decode: text => JSON.parse(text),
  };
  const scope: ConnectorOperationScope = {
    connectorId: 'synthetic-register', connectorVersion: '1', operationId: 'read-sales', kind: 'read', transport: 'api',
    applicability: { applicationVersion: '1', edition: 'fixture', module: 'sales', configuration: 'exact-minor-fixture', deploymentProfile: 'synthetic' },
  };
  const importScope: ConnectorOperationScope = { ...scope, operationId: 'import-sales', kind: 'import', transport: 'file' };
  const capabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness'];
  const readDigest = digest('semantic-test-synthetic-read-code'), importDigest = digest('semantic-test-synthetic-decoder-code');
  const scopes = [scope, importScope];
  const registry = new ConnectorCapabilityRegistry(scopes.map((scope, index) => ({
    scope, implemented: true, capabilities: index === 0 ? capabilities : [], evidenceIds: [`semantic-synthetic-evidence-${index}`],
    implementationDigest: index === 0 ? readDigest : importDigest, limitations: ['Synthetic test fixture only.'],
  })), scopes.map((scope, index): SyntheticConnectorEvidence => ({
    id: `semantic-synthetic-evidence-${index}`, scope, assertions: ['operation', ...(index === 0 ? capabilities : [])],
    observedAt: new Date(baseMs - 1000).toISOString(), expiresAt: new Date(baseMs + 86_400_000).toISOString(),
    artifact: { sha256: digest('semantic-test-authored-evidence'), reference: 'platform/tests/engine-semantic.test.ts' },
    notes: ['Explicit synthetic adapter fixture; no vendor or live qualification.'], environment: 'synthetic',
    provenance: { kind: 'synthetic-fixture', generatorVersion: 'v1' }, implementationDigest: index === 0 ? readDigest : importDigest,
  })));
  const profile: EngineConnectorProfile = {
    id: 'synthetic-sales', title: 'Synthetic semantic sales fixture', sourceId: 'fixture-source', companyId: 'synthetic-fixture-company',
    domain: structuredClone(domain), environment: 'synthetic', syntheticFixture: true,
    readOperation: scope, importOperation: importScope, readImplementationDigest: readDigest, importImplementationDigest: importDigest,
    decoder, contentTypes: ['application/json'], maximumSourceAgeMs: 60_000,
    reader: {
      operation: scope, environment: 'synthetic', mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
      requiredAuthScopes: ['sales.read'], pagination: { kind: 'none' },
      readPage: async request => {
        assert.equal(request.authority.tenantId, store.read().workspace.id); assert.deepEqual(request.dataScope, domain);
        return {
          content: Buffer.from(JSON.stringify(authored.rows)), contentType: 'application/json', schemaFingerprint: decoder.schemaSha256,
          rowCount: 2, continuation: { kind: 'complete' },
          source: { reportReference: 'synthetic-independent-sales-report', generatedAtMs: baseMs,
            snapshotId: authored.sourceReport.snapshotId, completeness: 'reported-complete', totalRows: 2 },
        };
      },
    },
  };
  const descriptor = new CursorImportService(store, registry, decoder).decoderDescriptor();
  let adapter!: EngineSemanticService;
  const options: EngineConnectorOptions = {
    registry, profiles: [profile],
    clock: { nowMs: () => { clockReads++; return controls.advancingClock ? clockMs++ : clockMs; },
      setTimer: () => () => {}, sleep: async () => {} },
    authorizeRead: async (_ctx, authority, grantedScopes) => ({ scope: authority, authorityRevision: 'synthetic-semantic-host-grants-v1',
      grantedScopes, expiresAtMs: baseMs + 60_000, credentialReference: null }),
    semanticGate: currentStore => {
      adapter = new EngineSemanticService(currentStore, {
        registry, clock: options.clock!, maximumEvidenceAgeMs: 60_000,
        dossiers: state => {
          const dossier = authored.dossier(digest(state.ontology), descriptor.definitionHash);
          controls.alterDossier?.(dossier); return [dossier];
        },
      });
      return adapter;
    },
  };
  const service = new EngineConnectorService(store, options); t.after(() => service.close());
  const calculator = new CalculatorService(store, {
    consumerGuard: (ctx, request) => service.assertCalculationReady(ctx, request),
    receiptGuard: (ctx, receipt) => service.assertReceiptReady(ctx, receipt),
  });
  const totals: IndependentSourceTotals = {
    provenance: 'independent-source-report', reportId: authored.sourceReport.reportId, sha256: authored.sourceReport.evidenceHash,
    domainHash: digest(domain), company: domain.company, dataset: domain.dataset, currency: 'INR',
    rowCount: 2, amountMinor: '900719925474099400', observedAt: new Date(baseMs).toISOString(), snapshotId: authored.sourceReport.snapshotId,
  };
  return { store, service, calculator, authored, totals, registry, profile, descriptor, adapter,
    now: () => new Date(options.clock!.nowMs()).toISOString(), get clockReads() { return clockReads; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function capture(value: Fixture) {
  const read = await value.service.request(owner, 'connectors.read', { profileId: 'synthetic-sales' });
  const review = await value.service.request(owner, 'connectors.reviewMapping', { profileId: 'synthetic-sales', recipe: value.authored.recipe,
    evidence: { reportId: 'synthetic-semantic-schema-review', sha256: value.descriptor.schemaSha256 } });
  return value.service.request(owner, 'connectors.capture', { acquisitionId: read.acquisitionId, reviewId: review.id,
    recipe: value.authored.recipe, idempotencyKey: 'synthetic-semantic-capture-v1' });
}
async function publish(value: Fixture) {
  const captured = await capture(value);
  const result = await value.service.request(owner, 'connectors.publish', { profileId: 'synthetic-sales', captureId: captured.id, sourceTotals: value.totals });
  assert.equal(result.status, 'published'); assert.equal(result.semanticQualification, 'synthetic-qualified'); return result;
}
function semanticInput(value: Fixture, captureId: string, measures: string[]): ConnectorSemanticInput {
  const state = value.store.read();
  const captured = state.imports.find(item => item.type === 'connector-capture-v1' && item.id === captureId) as ConnectorCapture;
  const readLink = state.imports.find(item => item.type === 'connector-read-import-link-v1' && item.captureId === captureId) as ReadImportLink;
  assert.ok(captured?.sourceTotals); assert.ok(readLink);
  return { state, profile: value.profile, capture: captured, sourceTotals: captured.sourceTotals, readLink,
    registry: value.registry, decoderDescriptor: value.descriptor, at: value.now(), measures };
}
function assertNoPublication(value: Fixture) {
  assert.equal(value.store.state.facts.length, 0);
  assert.equal(value.store.state.imports.filter(item => ['engine-semantic-evidence-v1', 'engine-semantic-anchor-v1'].includes(item.type)).length, 0);
}

test('advancing host clock admits read, capture, semantic publication, readiness and exact calculation across different ticks', async t => {
  const value = await fixture(t, { advancingClock: true });
  const result = await publish(value);
  const evidence = value.store.state.imports.find(item => item.type === 'engine-semantic-evidence-v1' && item.captureId === result.id);
  assert.notEqual(evidence.ledger[0].at, evidence.binding.at);
  assert.equal(value.service.ready(owner, 'synthetic-sales').ready, true);
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  assert.equal(receipt.totalMinor, '900719925474099400');
  assert.equal(value.calculator.receipt(owner, receipt.id).id, receipt.id);
  assert.ok(value.clockReads > 10); assert.equal(evidence.proof.liveVerified, false); assert.equal(evidence.proof.writebackQualified, false);
});

test('current source rights refusal precedes insertion and persists no semantic ledger or anchor', async t => {
  const value = await fixture(t, { alterDossier: dossier => { dossier.current.manifest.rights.permissions.reuse = 'denied'; } });
  const captured = await capture(value);
  await assert.rejects(value.service.publish(owner, 'synthetic-sales', captured.id, value.totals), code('RIGHTS_UNRESOLVED'));
  assertNoPublication(value);
});

test('current source artifact byte mismatch precedes insertion and persists no semantic ledger or anchor', async t => {
  const value = await fixture(t, { alterDossier: dossier => {
    const artifact = dossier.current.manifest.artifacts.find(item => item.role === 'source-rows')!;
    dossier.current.artifactBytes[artifact.path] = `${dossier.current.artifactBytes[artifact.path]} `;
  } });
  const captured = await capture(value);
  await assert.rejects(value.service.publish(owner, 'synthetic-sales', captured.id, value.totals), code('ARTIFACT_HASH_MISMATCH'));
  assertNoPublication(value);
});

test('saved receipt refuses a changed published typed amount despite retained source bytes and ledger', async t => {
  const value = await fixture(t); await publish(value);
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  await value.store.update(state => { state.facts.find(fact => fact.entityId === 'sale-1')!.fields.amountMinor = '1'; });
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('SEMANTIC_PUBLISHED_FACTS_CHANGED'));
  await assert.rejects(value.calculator.calculate(owner, { operation: 'earned', period }), code('SEMANTIC_PUBLISHED_FACTS_CHANGED'));
  assert.equal(value.store.state.receipts.find(item => item.id === receipt.id).totalMinor, '900719925474099400');
});

test('a truncated retained ledger with a valid rehashed append cannot replace the independent head anchor', async t => {
  const value = await fixture(t); const published = await publish(value);
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  await value.store.update(state => {
    const record = state.imports.find(item => item.type === 'engine-semantic-evidence-v1' && item.captureId === published.id);
    const anchor = state.imports.find(item => item.type === 'engine-semantic-anchor-v1' && item.captureId === published.id);
    const ledger = record.ledger as OperationEvidence[];
    assert.equal(ledger.length, 21);
    const { id: _id, previousHash: _previous, ...payload } = ledger.at(-1)!;
    ledger.splice(7);
    appendEvidence(ledger, { ...payload, at: new Date(Date.parse(payload.at) + 1).toISOString() });
    assert.equal(verifyLedger(ledger).valid, true); assert.notEqual(verifyLedger(ledger).head, anchor.head);
    assert.throws(() => verifyLedger(ledger, anchor.head), code('LEDGER_HEAD_MISMATCH'));
  });
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('SEMANTIC_SOURCE_NOT_READY'));
});

test('the concrete adapter rejects an exact requested measure absent from qualification evidence', async t => {
  const value = await fixture(t); const published = await publish(value);
  const input = semanticInput(value, published.id, ['earned']);
  assert.equal(value.adapter.assertReady(owner, input).qualification, 'synthetic-qualified');
  assert.throws(() => value.adapter.assertReady(owner, { ...input, measures: ['unqualified_custom'] }), code('SEMANTIC_MEASURE_UNQUALIFIED'));
});
