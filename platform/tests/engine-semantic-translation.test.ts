import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { Engine } from '../runtime/engine.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { EngineConnectorService, type EngineConnectorOptions, type EngineConnectorProfile } from '../runtime/engine-connectors.ts';
import { EngineSemanticService, type EngineSemanticDossier } from '../runtime/engine-semantic.ts';
import { semanticTranslationDefinitionHash, type SemanticTranslationProfile, type SemanticTranslationReference,
  type SemanticTranslationOutput } from '../runtime/semantic-translation.ts';
import { ConnectorCapabilityRegistry, CursorImportService, type ConnectorCapability,
  type ConnectorOperationScope, type QualifiedDecoder, type SyntheticConnectorEvidence } from '../runtime/connector-framework/index.ts';
import { hashData, type SourceSchema, type SourceRow } from '../semantic-qualification/src/index.ts';
import { createSyntheticSemanticFixture, fixtureDictionaryDraft } from './fixtures/engine-semantic-fixture.ts';

// Independently authored native synthetic wire data. No named vendor, live installation or write-back qualification.
// Native fields include two explicit delivery metadata fields. Compiler corpus qualification remains distinct
// from this exact current native capture translation evidence.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const domain = { company: 'Synthetic Fixture', dataset: 'sales', branches: ['main'], period };
const decodedSourceSchema: SourceSchema = { fields: {
  wire_id: 'text', wire_revision: 'text', wire_kind: 'text', wire_date: 'text', wire_amount: 'text', wire_tax: 'text',
  wire_currency: 'text', wire_status: 'text', wire_company: 'text', wire_branch: 'text', wire_taxRegistration: 'text',
  wire_quantity: 'text', wire_unit: 'text', wire_related: 'text', wire_generatedAt: 'text', wire_snapshot: 'text',
} };
const wireSchemaHash = hashData({ authoredWireFormat: 'synthetic-native-rows-v1', envelope: 'JSON array', fields: decodedSourceSchema.fields });
function nativeRows(at: string): SourceRow[] {
  return [
    { wire_id: 'sale-2', wire_revision: '1', wire_kind: 'SALE', wire_date: '2026-09-16', wire_amount: '75', wire_tax: '0', wire_currency: 'INR', wire_status: 'POSTED', wire_company: 'Synthetic Fixture', wire_branch: 'main', wire_taxRegistration: 'synthetic-tax', wire_quantity: '1', wire_unit: 'pcs', wire_related: '', wire_generatedAt: at, wire_snapshot: 'fixture-sales-snapshot-v1' },
    { wire_id: 'sale-1', wire_revision: '1', wire_kind: 'SALE', wire_date: '2026-09-15', wire_amount: '900719925474099325', wire_tax: '0', wire_currency: 'INR', wire_status: 'POSTED', wire_company: 'Synthetic Fixture', wire_branch: 'main', wire_taxRegistration: 'synthetic-tax', wire_quantity: '1', wire_unit: 'pcs', wire_related: '', wire_generatedAt: at, wire_snapshot: 'fixture-sales-snapshot-v1' },
  ];
}
function translate(rows: readonly Readonly<SourceRow>[]): SemanticTranslationOutput {
  const translated = [...rows].reverse().map(row => {
    assert.equal(row.wire_kind, 'SALE'); assert.equal(row.wire_status, 'POSTED');
    return { id: row.wire_id, revision: row.wire_revision, kind: 'sale', date: row.wire_date, amount: row.wire_amount,
      tax: row.wire_tax, currency: row.wire_currency, status: 'posted', company: row.wire_company,
      branch: row.wire_branch, taxRegistration: row.wire_taxRegistration, quantity: row.wire_quantity,
      unit: row.wire_unit, related: row.wire_related };
  });
  return { rows: translated, rowLineage: [{ compilerRow: 1, decodedRow: 2 }, { compilerRow: 2, decodedRow: 1 }] };
}
const code = (expected: string) => (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && error.code === expected;
class Store implements StateStore {
  state = initialState('Synthetic Fixture', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>) {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
type Controls = {
  alterProfile?: (profile: SemanticTranslationProfile) => void;
  alterDossier?: (dossier: EngineSemanticDossier) => void;
  alterNative?: (rows: SourceRow[]) => void;
  missing?: boolean; duplicate?: boolean;
};
function setup(store: StateStore, controls: Controls = {}) {
  const baseMs = Date.now(), at = new Date(baseMs).toISOString(), authored = createSyntheticSemanticFixture(at);
  let clockMs = baseMs; const rows = nativeRows(at); controls.alterNative?.(rows);
  const expectedRows = nativeRows(at); // Separate authored dossier native batch, not translator output.
  const recipe = structuredClone(authored.recipe);
  for (const binding of recipe.bindings) {
    if (binding.source) binding.source = `wire_${binding.source}`;
    if (binding.target === 'kind') binding.values = { SALE: 'sale' };
    if (binding.target === 'status') binding.values = { POSTED: 'posted' };
  }
  recipe.ignoredFields = ['wire_revision', 'wire_related', 'wire_generatedAt', 'wire_snapshot'];
  const translator: SemanticTranslationProfile = { id: 'authored-native-sales-translation', version: '1',
    implementationDigest: digest('independently-reviewed-synthetic-translator-v1'),
    configuration: { kind: 'SALE->sale', status: 'POSTED->posted', order: 'reverse', deliveryMetadata: 'wire_generatedAt,wire_snapshot' },
    nativeWireSchemaSha256: wireSchemaHash, decodedSourceSchema: structuredClone(decodedSourceSchema),
    compilerSourceSchema: structuredClone(authored.sourceSchema), translate };
  const reference: SemanticTranslationReference = { profileId: translator.id, version: translator.version, implementationDigest: translator.implementationDigest,
    profileDefinitionHash: semanticTranslationDefinitionHash(translator), nativeWireSchemaSha256: wireSchemaHash,
    decodedSourceSchemaHash: hashData(decodedSourceSchema), decodedSourceRowsHash: hashData(expectedRows),
    compilerSourceSchemaHash: hashData(authored.sourceSchema), compilerSourceRowsHash: hashData(authored.rows),
    rowLineageHash: hashData([{ compilerRow: 1, decodedRow: 2 }, { compilerRow: 2, decodedRow: 1 }]) };
  controls.alterProfile?.(translator);
  const translationProfiles = controls.missing ? [] : controls.duplicate ? [translator, translator] : [translator];
  const decoder: QualifiedDecoder = { id: 'synthetic-native-json', version: '1', schemaSha256: wireSchemaHash,
    identityNamespace: 'synthetic-sales-v1', identityFields: ['wire_id', 'wire_revision'], resourceIdentityFields: ['wire_id', 'wire_kind'],
    revisionOrder: { kind: 'unqualified' }, businessFields: Object.keys(decodedSourceSchema.fields), deliveryFields: [], decode: text => JSON.parse(text) };
  const readScope: ConnectorOperationScope = { connectorId: 'synthetic-register', connectorVersion: '1', operationId: 'read-sales', kind: 'read', transport: 'api',
    applicability: { applicationVersion: '1', edition: 'fixture', module: 'sales', configuration: 'exact-minor-fixture', deploymentProfile: 'synthetic' } };
  const importScope: ConnectorOperationScope = { ...readScope, operationId: 'import-sales', kind: 'import', transport: 'file' };
  const capabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness', 'pagination'];
  const implementations = [digest('synthetic-native-reader-reviewed-v1'), digest('synthetic-native-decoder-reviewed-v1')];
  const registry = new ConnectorCapabilityRegistry([readScope, importScope].map((scope, index) => ({ scope, implemented: true,
    capabilities: index === 0 ? capabilities : [], evidenceIds: [`translation-synthetic-evidence-${index}`], implementationDigest: implementations[index],
    limitations: ['Authored synthetic fixture only; no native vendor qualification.'] })),
  [readScope, importScope].map((scope, index): SyntheticConnectorEvidence => ({ id: `translation-synthetic-evidence-${index}`, scope,
    assertions: ['operation', ...(index === 0 ? capabilities : [])], observedAt: new Date(baseMs - 1000).toISOString(), expiresAt: new Date(baseMs + 86400000).toISOString(),
    artifact: { sha256: digest('independent-authored-native-synthetic-evidence'), reference: 'platform/tests/engine-semantic-translation.test.ts' },
    notes: ['Synthetic read/import fixture only.'], environment: 'synthetic', provenance: { kind: 'synthetic-fixture', generatorVersion: '1' },
    implementationDigest: implementations[index] })));
  const profile: EngineConnectorProfile = { id: 'synthetic-sales', title: 'Authored synthetic native translation fixture', sourceId: 'fixture-source', companyId: 'synthetic-fixture-company',
    domain: structuredClone(domain), environment: 'synthetic', syntheticFixture: true, decoder,
    readOperation: readScope, importOperation: importScope, readImplementationDigest: implementations[0], importImplementationDigest: implementations[1],
    contentTypes: ['application/json'], maximumSourceAgeMs: 60000,
    reader: { operation: readScope, environment: 'synthetic', mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
      requiredAuthScopes: ['sales.read'], pagination: { kind: 'page' }, readPage: async request => {
        const index = request.cursor?.kind === 'page' ? request.cursor.page - 1 : 0;
        return { content: Buffer.from(JSON.stringify([rows[index]])), contentType: 'application/json', schemaFingerprint: wireSchemaHash, rowCount: 1,
          continuation: index === 0 ? { kind: 'more', next: { kind: 'page', page: 2 } } : { kind: 'complete' },
          source: { reportReference: 'synthetic-independent-sales-report', generatedAtMs: baseMs, snapshotId: authored.sourceReport.snapshotId,
            completeness: 'reported-complete', totalRows: 2 } };
      } } };
  const descriptor = new CursorImportService(store, registry, decoder).decoderDescriptor();
  const options: EngineConnectorOptions = { registry, profiles: [profile],
    clock: { nowMs: () => clockMs, setTimer: () => () => {}, sleep: async () => {} },
    authorizeRead: async (_ctx, authority, grantedScopes) => ({ scope: authority, authorityRevision: 'synthetic-native-host-grants-v1', grantedScopes,
      expiresAtMs: baseMs + 60000, credentialReference: null }),
    semanticGate: currentStore => new EngineSemanticService(currentStore, { registry, clock: options.clock!, maximumEvidenceAgeMs: 60000, translationProfiles,
      dossiers: state => {
        const dossier: EngineSemanticDossier = authored.dossier(digest(state.ontology), descriptor.definitionHash);
        dossier.recipeHash = digest(recipe); dossier.translation = structuredClone(reference); controls.alterDossier?.(dossier); return [dossier];
      } }) };
  const totals = { provenance: 'independent-source-report' as const, reportId: authored.sourceReport.reportId, sha256: authored.sourceReport.evidenceHash,
    domainHash: digest(domain), company: domain.company, dataset: domain.dataset, currency: 'INR', rowCount: 2, amountMinor: '900719925474099400',
    observedAt: at, snapshotId: authored.sourceReport.snapshotId };
  return { options, translator, reference, translationProfiles, descriptor, recipe, totals, registry, advance: (ms: number) => { clockMs += ms; } };
}
async function fixture(t: TestContext, controls: Controls = {}) {
  const store = new Store(); await new OntologyService(store).publish(owner, fixtureDictionaryDraft);
  const configuration = setup(store, controls), service = new EngineConnectorService(store, configuration.options); t.after(() => service.close());
  const calculator = new CalculatorService(store, { consumerGuard: (ctx, request) => service.assertCalculationReady(ctx, request),
    receiptGuard: (ctx, receipt) => service.assertReceiptReady(ctx, receipt) });
  return { store, service, calculator, ...configuration };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function capture(value: Fixture) {
  const read = await value.service.request(owner, 'connectors.read', { profileId: 'synthetic-sales' });
  const review = await value.service.request(owner, 'connectors.reviewMapping', { profileId: 'synthetic-sales', recipe: value.recipe,
    evidence: { reportId: 'authored-native-synthetic-schema-review', sha256: value.descriptor.schemaSha256 } });
  return value.service.request(owner, 'connectors.capture', { acquisitionId: read.acquisitionId, reviewId: review.id, recipe: value.recipe, idempotencyKey: 'native-synthetic-translation-capture' });
}
async function publish(value: Fixture) {
  const captured = await capture(value);
  return value.service.request(owner, 'connectors.publish', { profileId: 'synthetic-sales', captureId: captured.id, sourceTotals: value.totals });
}
function noPublication(value: Fixture) {
  assert.equal(value.store.state.facts.length, 0);
  assert.equal(value.store.state.imports.filter(item => ['engine-semantic-evidence-v1', 'engine-semantic-anchor-v1'].includes(item.type)).length, 0);
}

test('actual public Engine imports two native pages through concrete semantic translation, question, exact calculation and saved receipt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-semantic-translation-'));
  let engine: Engine;
  const proxy: StateStore = { read: () => engine.vault!.read(), update: change => engine.vault!.update(change) };
  const value = setup(proxy); engine = new Engine({ directory, demo: true, storage: 'experimental-file', connectorRuntime: value.options });
  t.after(async () => {
    await engine.shutdown(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-semantic-translation-')); await rm(directory, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic Fixture', passphrase: 'Authored synthetic translation passphrase', demo: false, pack: 'ecommerce' });
  await engine.request('ontology.publish', { draft: fixtureDictionaryDraft });
  await assert.rejects(engine.request('calculation.run', { operation: 'earned', period }), code('SOURCE_NOT_READY'));
  const read = await engine.request('connectors.read', { profileId: 'synthetic-sales' });
  const review = await engine.request('connectors.reviewMapping', { profileId: 'synthetic-sales', recipe: value.recipe,
    evidence: { reportId: 'authored-native-schema-review', sha256: value.descriptor.schemaSha256 } });
  const captured = await engine.request('connectors.capture', { acquisitionId: read.acquisitionId, reviewId: review.id, recipe: value.recipe, idempotencyKey: 'public-native-translation' });
  await assert.rejects(engine.request('conversation.ask', { question: 'what is the business about', period }), code('SOURCE_NOT_READY'));
  const published = await engine.request('connectors.publish', { profileId: 'synthetic-sales', captureId: captured.id, sourceTotals: value.totals });
  assert.equal(published.semanticQualification, 'synthetic-qualified'); assert.equal(published.status, 'published');
  const context = await engine.request('conversation.ask', { question: 'what is the business about', period });
  assert.equal(context.kind, 'business-context'); assert.equal(context.scope.syntheticFixture, true);
  assert.ok(context.claims.some((claim: { category: string; qualification: string }) => claim.category === 'records' && claim.qualification === 'evidence-qualified'));
  assert.equal((await engine.request('business.context.receipt', { id: context.id })).contextDigest, context.contextDigest);
  const receipt = await engine.request('calculation.run', { operation: 'earned', period }); assert.equal(receipt.totalMinor, '900719925474099400');
  assert.equal((await engine.request('receipts.get', { id: receipt.id })).id, receipt.id);
  const answer = await engine.request('conversation.ask', { question: 'What was earned?', period });
  assert.equal(answer.supported, true); assert.equal(answer.receipt.totalMinor, '900719925474099400');
  const state = proxy.read(), evidence = state.imports.find(item => item.type === 'engine-semantic-evidence-v1');
  const anchor = state.imports.find(item => item.type === 'engine-semantic-anchor-v1');
  assert.equal(evidence.translation.digest, anchor.translationDigest);
  assert.equal(evidence.translation.binding.sourcePages.length, 2);
  assert.notEqual(evidence.binding.decoder.schemaSha256, evidence.ledger[0].schemaHash);
  assert.notEqual(evidence.translation.binding.decodedSourceRowsHash, evidence.ledger[0].rowsHash);
  assert.equal(evidence.translation.binding.compilerSourceRowsHash, evidence.ledger[0].rowsHash);
  assert.deepEqual(evidence.translation.binding.rowLineage.map((item: {compilerRow:number;decodedRow:number;pageRow:number}) => [item.compilerRow,item.decodedRow,item.pageRow]), [[1,2,1],[2,1,1]]);
  assert.equal(state.facts.find(item => item.entityId === 'sale-1')!.sourceRow, 3);
  assert.equal(state.facts.find(item => item.entityId === 'sale-2')!.sourceRow, 2);
  assert.equal(evidence.proof.liveVerified, false); assert.equal(evidence.proof.writebackQualified, false);
  await engine.request('workspace.lock'); await engine.request('workspace.open', { passphrase: 'Authored synthetic translation passphrase' });
  assert.equal((await engine.request('receipts.get', { id: receipt.id })).totalMinor, '900719925474099400');
});

for (const [name, controls, expected] of [
  ['missing opt-in profile', { missing: true }, 'SEMANTIC_TRANSLATION_PROFILE_REQUIRED'],
  ['ambiguous opt-in profile', { duplicate: true }, 'SEMANTIC_TRANSLATION_PROFILE_REQUIRED'],
  ['translator version drift', { alterProfile: profile => { profile.version = '2'; } }, 'SEMANTIC_TRANSLATION_PROFILE_CHANGED'],
  ['translator implementation drift', { alterProfile: profile => { profile.implementationDigest = digest('changed-code'); } }, 'SEMANTIC_TRANSLATION_PROFILE_CHANGED'],
  ['translator configuration drift', { alterProfile: profile => { profile.configuration.order = 'same'; } }, 'SEMANTIC_TRANSLATION_PROFILE_CHANGED'],
  ['same-id/version replacement function', { alterProfile: profile => { profile.translate = rows => translate(rows); } }, 'SEMANTIC_TRANSLATION_PROFILE_CHANGED'],
  ['native wire schema mismatch', { alterDossier: dossier => { dossier.translation!.nativeWireSchemaSha256 = digest('different-wire-schema'); } }, 'SEMANTIC_TRANSLATION_SCHEMA_CHANGED'],
  ['decoded schema mismatch', { alterDossier: dossier => { dossier.translation!.decodedSourceSchemaHash = digest('different-decoded-schema'); } }, 'SEMANTIC_TRANSLATION_SCHEMA_CHANGED'],
  ['compiler schema mismatch', { alterDossier: dossier => { dossier.translation!.compilerSourceSchemaHash = digest('different-compiler-schema'); } }, 'SEMANTIC_TRANSLATION_SCHEMA_CHANGED'],
  ['native metadata mutation hidden from runtime totals', { alterNative: rows => { rows[0].wire_generatedAt = 'changed-native-metadata'; } }, 'SEMANTIC_TRANSLATION_SOURCE_CHANGED'],
  ['authored row-lineage mismatch', { alterDossier: dossier => { dossier.translation!.rowLineageHash = digest('wrong-lineage'); } }, 'SEMANTIC_TRANSLATION_LINEAGE_CHANGED'],
  ['authored compiler batch mismatch', { alterDossier: dossier => { dossier.current.batch.rows[0].status = 'draft'; } }, 'SEMANTIC_TRANSLATION_COMPILER_ROWS_CHANGED'],
] satisfies [string, Controls, string][]) {
  test(`${name} refuses before fact insertion and leaves no semantic ledger/anchor`, async t => {
    const value = await fixture(t, controls); await assert.rejects(publish(value), code(expected)); noPublication(value);
  });
}

test('missing native business field is quarantined by the actual importer before semantic admission', async t => {
  const value = await fixture(t, { alterNative: rows => { delete rows[0].wire_status; } });
  assert.equal((await publish(value)).status, 'quarantined'); noPublication(value);
  await assert.rejects(value.calculator.calculate(owner, { operation: 'earned', period }), code('SOURCE_NOT_READY'));
});

for (const [name, callback, expected] of [
  ['asynchronous translator', async (rows: readonly Readonly<SourceRow>[]) => translate(rows), 'SEMANTIC_TRANSLATION_RESULT_INVALID'],
  ['non-data translator result', (_rows: readonly Readonly<SourceRow>[]) => new Map(), 'SEMANTIC_TRANSLATION_RESULT_INVALID'],
  ['extra compiler field', (rows: readonly Readonly<SourceRow>[]) => {
    const output = translate(rows); output.rows[0].guessed = 'invented'; return output;
  }, 'SEMANTIC_TRANSLATION_SCHEMA_CHANGED'],
  ['duplicate row lineage at publication', (rows: readonly Readonly<SourceRow>[]) => {
    const output = translate(rows); output.rowLineage[1].compilerRow = 1; return output;
  }, 'SEMANTIC_TRANSLATION_LINEAGE_CHANGED'],
] as const) {
  test(`${name} refuses atomically even when its actual implementation is explicitly pinned`, async t => {
    const value = await fixture(t);
    Reflect.set(value.translator, 'translate', callback); // Deliberately malformed installed host implementations; no RPC installation.
    value.reference.profileDefinitionHash = semanticTranslationDefinitionHash(value.translator);
    await assert.rejects(publish(value), code(expected)); noPublication(value);
  });
}

test('trusted translator cannot mutate the frozen native rows', async t => {
  const value = await fixture(t);
  value.translator.translate = rows => {
    Reflect.set(rows[0], 'wire_amount', 'invented');
    assert.equal(rows[0].wire_amount, '75'); assert.equal(Object.isFrozen(rows), true); assert.equal(Object.isFrozen(rows[0]), true);
    return translate(rows);
  };
  value.reference.profileDefinitionHash = semanticTranslationDefinitionHash(value.translator);
  assert.equal((await publish(value)).status, 'published');
  assert.equal((await value.calculator.calculate(owner, { operation: 'earned', period })).totalMinor, value.totals.amountMinor);
});

test('actual translator output and row lineage are re-executed and validated, not trusted by profile hashes alone', async t => {
  const value = await fixture(t);
  let mode: 'valid' | 'duplicate' | 'dropped' | 'out-of-range' | 'changed-row' = 'valid';
  value.translator.translate = rows => {
    const output = translate(rows);
    if (mode === 'duplicate') output.rowLineage[1].decodedRow = 2;
    if (mode === 'dropped') { output.rows.pop(); output.rowLineage.pop(); }
    if (mode === 'out-of-range') output.rowLineage[1].decodedRow = 3;
    if (mode === 'changed-row') output.rows[0].tax = '1';
    return output;
  };
  value.reference.profileDefinitionHash = semanticTranslationDefinitionHash(value.translator);
  const published = await publish(value); assert.equal(published.status, 'published');
  const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  for (const invalid of ['duplicate', 'dropped', 'out-of-range', 'changed-row'] as const) {
    mode = invalid;
    assert.throws(() => value.calculator.receipt(owner, receipt.id), code(invalid === 'changed-row' ? 'SEMANTIC_TRANSLATION_COMPILER_ROWS_CHANGED' : 'SEMANTIC_TRANSLATION_LINEAGE_CHANGED'));
  }
  mode = 'valid'; assert.equal(value.calculator.receipt(owner, receipt.id).totalMinor, value.totals.amountMinor);
});

test('current translator removal, version drift and anchored translation tampering refuse saved receipt reuse', async t => {
  const value = await fixture(t); await publish(value); const receipt = await value.calculator.calculate(owner, { operation: 'earned', period });
  const originalVersion = value.translator.version; value.translator.version = '2';
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('SEMANTIC_TRANSLATION_PROFILE_CHANGED'));
  value.translator.version = originalVersion; value.translationProfiles.splice(0);
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('SEMANTIC_TRANSLATION_PROFILE_REQUIRED'));
  value.translationProfiles.push(value.translator);
  await value.store.update(state => { state.imports.find(item => item.type === 'engine-semantic-evidence-v1').translation.binding.rowLineage[0].decodedRow = 1; });
  assert.throws(() => value.calculator.receipt(owner, receipt.id), code('SEMANTIC_TRANSLATION_EVIDENCE_CHANGED'));
});

test('independent anchor translation digest and actual published typed facts remain required', async t => {
  const anchored = await fixture(t); await publish(anchored); const receipt = await anchored.calculator.calculate(owner, { operation: 'earned', period });
  await anchored.store.update(state => { state.imports.find(item => item.type === 'engine-semantic-anchor-v1').translationDigest = digest('different-translation'); });
  assert.throws(() => anchored.calculator.receipt(owner, receipt.id), code('SEMANTIC_TRANSLATION_EVIDENCE_CHANGED'));
  const facts = await fixture(t); await publish(facts); const saved = await facts.calculator.calculate(owner, { operation: 'earned', period });
  await facts.store.update(state => { state.facts.find(item => item.entityId === 'sale-1')!.fields.taxMinor = '1'; });
  assert.throws(() => facts.calculator.receipt(owner, saved.id), code('SEMANTIC_PUBLISHED_FACTS_CHANGED'));
});

test('translator cannot fabricate runtime invoice links, bypass freshness or current operation qualification', async t => {
  const link = await fixture(t);
  link.recipe.bindings.push({ target: 'invoiceId', type: 'string', constant: 'invented-invoice', nulls: 'reject' });
  // Author a matching recipe pin so only the actual semantic/runtime link comparison can refuse.
  await assert.rejects(publish(link), code('SEMANTIC_RUNTIME_TRANSLATION_REQUIRED')); noPublication(link);
  const current = await fixture(t); await publish(current); const receipt = await current.calculator.calculate(owner, { operation: 'earned', period });
  current.registry.revokeEvidence('translation-synthetic-evidence-1', new Date(current.options.clock!.nowMs()).toISOString(), 'Authored fixture revocation');
  assert.throws(() => current.calculator.receipt(owner, receipt.id), code('CONNECTOR_NOT_QUALIFIED'));
  const expired = await fixture(t); await publish(expired); const saved = await expired.calculator.calculate(owner, { operation: 'earned', period });
  expired.advance(60001); assert.throws(() => expired.calculator.receipt(owner, saved.id), code('CONNECTOR_SOURCE_NOT_CURRENT'));
});
