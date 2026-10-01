import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Binding, ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { DictionaryDraft } from '../runtime/ontology.ts';
import { hash } from '../runtime/contracts.ts';
import type { BridgeProfileDefinition } from '../runtime/bridge-service.ts';

const passphrase = 'Synthetic descriptive bridge HTTP fixture passphrase';
const baseline = { from: '2026-08-01', to: '2026-08-31' };
const comparison = { from: '2026-09-01', to: '2026-09-30' };
const sourceId = 'synthetic-owner-declared-factor-export';
const literalRows = [
  'baseline-a,sale,2026-08-02,100,10,10,product-a,INR,main,delivered,piece',
  'comparison-a,sale,2026-09-02,240,12,20,product-a,INR,main,delivered,piece',
];

function input(rows: string[]): ImportInput & { recipe: MappingRecipe } {
  const amounts = rows.map(row => BigInt(row.split(',')[3]));
  return {
    sourceId, format: 'csv', content: 'id,kind,date,amount,price,quantity,sku,currency,branch,status,unit\n' + rows.join('\n'),
    recipe: {
      version: 1, id: 'synthetic-explicit-factor-columns', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic Bridge', branches: ['main'] },
      bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
        { target: 'unitPriceMinor', source: 'price', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'omit' },
        { target: 'quantity', source: 'quantity', type: 'integer', nulls: 'omit' },
        ...['sku', 'currency', 'branch', 'status', 'unit'].map((field): Binding => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
    }, expectedTotals: { rowCount: rows.length, amountMinor: String(amounts.reduce((sum, amount) => sum + amount, 0n)) },
  };
}

async function fixture(t: TestContext) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-bridge-http-'));
  let providerCalls = 0;
  // This real local file Vault is experimental; these tests claim no native SQL qualification.
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: async () => {
    providerCalls++; throw new Error('A descriptive bridge must stay local under send nothing.');
  } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    await app.close(); const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-bridge-http-')));
    await rm(target, { recursive: true, force: true });
  });
  const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const result = await raw(method, payload, bearer); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.error, undefined); return result.body.result;
  }
  await rpc('workspace.create', { name: 'Synthetic Bridge', passphrase, demo: false, pack: 'ecommerce' });
  const packs = await rpc('ontology.packs');
  const draft: DictionaryDraft = structuredClone(packs.find((pack: DictionaryDraft) => pack.pack === 'ecommerce'));
  assert.ok(draft); draft.fields.unitPriceMinor = 'money';
  draft.definitions.find(definition => definition.name === 'earned')!.meaning = 'Owner convention for these synthetic delivered rows: amountMinor is revenue in INR minor units. The bridge profile expressly chooses quantity and sku and computes realized net amount per unit; the separately imported reported price does not establish that convention.';
  const dictionary = await rpc('ontology.publish', { draft });
  async function member() {
    const invitation = await rpc('auth.invite', { name: 'Synthetic bridge reader', role: 'viewer', branches: ['main'] });
    return rpc('auth.accept', { token: invitation.token });
  }
  return { engine, rpc, raw, dictionary, draft, member, providerCalls: () => providerCalls };
}

function definition(dictionary: any, incompleteCoverage: 'partial' | 'refuse' = 'partial'): BridgeProfileDefinition {
  return {
    label: 'Owner-declared synthetic product quantity and realized net price bridge', dictionaryHash: dictionary.hash,
    operationId: 'earned', moneyDefinitionHash: hash(dictionary.definitions.find((item: any) => item.name === 'earned')),
    quantityField: 'quantity', quantityMeaning: 'Owner states quantity is the exact count of delivered pieces on each synthetic product-period row.', quantityScale: 0,
    identityFields: ['sku'], identityMeaning: 'Owner states this exact SKU identifies the same synthetic product across the two disjoint periods.',
    grain: 'one-fact-per-product-period', unitField: 'unit', unit: 'piece', unitMeaning: 'Owner states every quantity denotes whole pieces with the same canonical piece unit.',
    factorRule: 'realized-average-net-amount-per-unit', method: 'separate-interaction', rounding: 'truncate-toward-zero-minor', incompleteCoverage,
    scope: { branch: 'main', sourceIds: [sourceId] },
  };
}

async function prepare(value: Awaited<ReturnType<typeof fixture>>, rows = literalRows, policy: 'partial' | 'refuse' = 'partial') {
  const imported = await value.rpc('sources.import', input(rows)); assert.equal(imported.coverage.reconciled, true);
  const profile = await value.rpc('analysis.bridge.publish', { id: `owner-${policy}-bridge`, expectedRevision: 0, definition: definition(value.dictionary, policy) });
  assert.equal(profile.revision, 1); assert.deepEqual(profile.sourceIds, [sourceId]); assert.deepEqual(profile.rowIds, []);
  const asOf = new Date().toISOString();
  const before = await value.rpc('calculation.run', { operation: 'earned', period: baseline, asOf, branch: 'main' });
  const after = await value.rpc('calculation.run', { operation: 'earned', period: comparison, asOf, branch: 'main' });
  for (const receipt of [before, after]) {
    assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.equal(receipt.databaseProof, undefined);
    assert.ok(receipt.rowIds.every((id: string) => imported.rowIds.includes(id)));
  }
  const request = { profileId: profile.id, profileRevision: profile.revision, baselineReceiptId: before.id, comparisonReceiptId: after.id };
  return { imported, profile, before, after, request };
}

function literalBridge(receipt: any) {
  assert.equal(receipt.kind, 'descriptive-bridge-receipt-v1'); assert.equal(receipt.qualification, 'declared-experimental');
  assert.equal(receipt.sourceQualification, 'source-unqualified'); assert.equal(receipt.factorAdmission, null);
  assert.match(receipt.interpretation, /Descriptive contributions/); assert.match(receipt.interpretation, /not causal effects/);
  assert.equal(receipt.result.method, 'separate-interaction'); assert.equal(receipt.result.factorRule, 'realized-average-net-amount-per-unit');
  assert.equal(receipt.result.status, 'complete'); assert.equal(receipt.result.baselineTotalMinor, '100');
  assert.equal(receipt.result.comparisonTotalMinor, '240'); assert.equal(receipt.result.measuredDeltaMinor, '140');
  assert.deepEqual(receipt.result.contributions, { volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '0', scopeRemovedMinor: '0' });
  assert.deepEqual(receipt.result.residual, { missingFactorMinor: '0', roundingMinor: '0', totalMinor: '0' });
  assert.deepEqual(receipt.result.gaps, []);
}

test('paired HTTP explicit separate-interaction bridge independently reconciles 10×10 to 20×12 and reopens exact local evidence', async t => {
  const value = await fixture(t), prepared = await prepare(value);
  assert.equal(prepared.before.totalMinor, '100'); assert.equal(prepared.after.totalMinor, '240');
  const receipt = await value.rpc('analysis.bridge.run', prepared.request); literalBridge(receipt);
  assert.equal(receipt.profileId, prepared.profile.id); assert.equal(receipt.profileRevision, prepared.profile.revision);
  assert.equal(receipt.profileHash, prepared.profile.contentHash); assert.deepEqual(receipt.receipts, [prepared.before, prepared.after]);
  assert.deepEqual(receipt.manifest.receiptIds, [prepared.before.id, prepared.after.id]);
  assert.equal(receipt.manifest.population.asOf, prepared.before.asOf); assert.equal(prepared.before.asOf, prepared.after.asOf);
  assert.deepEqual(receipt.manifest.profile, prepared.profile.definition); assert.deepEqual(receipt.manifest.managedSourceIds, []);
  assert.deepEqual(new Set(receipt.rowIds), new Set(prepared.imported.rowIds));
  assert.deepEqual(receipt.manifest.factors.map((factor: any) => factor.quantity), ['10', '20']);
  assert.deepEqual(receipt.manifest.factors.map((factor: any) => factor.identity), [['product-a'], ['product-a']]);
  assert.deepEqual((await value.rpc('analysis.bridge.profiles')).map((profile: any) => profile.id), [prepared.profile.id]);
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { folder: 'main', passphrase });
  assert.deepEqual(await value.rpc('analysis.bridge.get', { id: receipt.id }), receipt);
  assert.deepEqual(await value.rpc('receipts.get', { id: prepared.before.id }), prepared.before);
  assert.equal((await value.rpc('trust.get')).policy.send, 'nothing');
  assert.equal(value.engine.vault!.read().modelReceipts.length, 0); assert.equal(value.providerCalls(), 0);
});

test('paired HTTP added and removed products stay separate from common-product factors and row permutation preserves the named method', async t => {
  const rows = [...literalRows,
    'baseline-removed,sale,2026-08-03,40,10,4,removed-product,INR,main,delivered,piece',
    'comparison-added,sale,2026-09-03,30,10,3,added-product,INR,main,delivered,piece'];
  const first = await fixture(t), second = await fixture(t);
  const a = await prepare(first, rows), b = await prepare(second, [...rows].reverse());
  const left = await first.rpc('analysis.bridge.run', a.request), right = await second.rpc('analysis.bridge.run', b.request);
  assert.equal(a.before.totalMinor, '140'); assert.equal(a.after.totalMinor, '270');
  assert.equal(left.result.baselineTotalMinor, '140'); assert.equal(left.result.comparisonTotalMinor, '270'); assert.equal(left.result.measuredDeltaMinor, '130');
  assert.deepEqual(left.result.contributions, { volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '30', scopeRemovedMinor: '-40' });
  assert.deepEqual(left.result.residual, { missingFactorMinor: '0', roundingMinor: '0', totalMinor: '0' });
  const added = left.result.products.find((product: any) => product.population === 'added');
  const removed = left.result.products.find((product: any) => product.population === 'removed');
  assert.equal(added.status, 'scope'); assert.equal(added.measuredDeltaMinor, '30'); assert.equal(added.exact, null);
  assert.equal(removed.status, 'scope'); assert.equal(removed.measuredDeltaMinor, '-40'); assert.equal(removed.exact, null);
  assert.deepEqual(right.result, left.result); assert.equal(first.providerCalls(), 0); assert.equal(second.providerCalls(), 0);
});

test('paired HTTP missing declared quantity yields a partial reconciled residual or an explicit refusal under the owner profile', async t => {
  const rows = [...literalRows,
    'baseline-unknown,sale,2026-08-03,50,10,,unknown-factor-product,INR,main,delivered,piece',
    'comparison-unknown,sale,2026-09-03,70,10,,unknown-factor-product,INR,main,delivered,piece'];
  const value = await fixture(t), partial = await prepare(value, rows);
  const receipt = await value.rpc('analysis.bridge.run', partial.request);
  assert.equal(receipt.result.status, 'partial'); assert.equal(receipt.result.baselineTotalMinor, '150');
  assert.equal(receipt.result.comparisonTotalMinor, '310'); assert.equal(receipt.result.measuredDeltaMinor, '160');
  assert.deepEqual(receipt.result.contributions, { volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '0', scopeRemovedMinor: '0' });
  assert.deepEqual(receipt.result.residual, { missingFactorMinor: '20', roundingMinor: '0', totalMinor: '20' });
  const missing = receipt.result.products.find((product: any) => product.status === 'missing-factors');
  assert.equal(missing.measuredDeltaMinor, '20'); assert.equal(missing.contributions, null); assert.equal(missing.exact, null);
  assert.ok(receipt.result.gaps.length > 0); assert.equal(receipt.sourceQualification, 'source-unqualified');
  const profile = await value.rpc('analysis.bridge.publish', { id: 'owner-refuse-bridge', expectedRevision: 0, definition: definition(value.dictionary, 'refuse') });
  const refused = await value.rpc('analysis.bridge.run', { ...partial.request, profileId: profile.id, profileRevision: profile.revision });
  assert.equal(refused.result.status, 'refused'); assert.equal(refused.result.measuredDeltaMinor, '160');
  assert.equal(refused.result.contributions, null); assert.equal(refused.result.residual, null); assert.ok(refused.result.gaps.length > 0);
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP bridge profiles refuse implicit methods, stale revisions and incompatible population cuts', async t => {
  const value = await fixture(t), prepared = await prepare(value);
  const unsupported = await value.raw('analysis.bridge.publish', { id: 'undeclared-method', expectedRevision: 0, definition: { ...definition(value.dictionary), method: 'sequential-price-first' } });
  assert.equal(unsupported.body.error.code, 'BRIDGE_PROFILE_UNSUPPORTED');
  const forged = await value.raw('analysis.bridge.run', { ...prepared.request, method: 'sequential-price-first' });
  assert.equal(forged.body.error.code, 'BRIDGE_REQUEST_INVALID');
  const otherCut = new Date(Date.parse(prepared.after.asOf) + 1000).toISOString();
  const comparisonReceipt = await value.rpc('calculation.run', { operation: 'earned', period: comparison, branch: 'main', asOf: otherCut });
  const population = await value.raw('analysis.bridge.run', { ...prepared.request, comparisonReceiptId: comparisonReceipt.id });
  assert.equal(population.body.error.code, 'BRIDGE_POPULATION_MISMATCH');
  const revised = await value.rpc('analysis.bridge.publish', { id: prepared.profile.id, expectedRevision: 1, definition: { ...definition(value.dictionary), label: 'Owner reviewed revised convention label' } });
  assert.equal(revised.revision, 2);
  const oldRevision = await value.raw('analysis.bridge.run', prepared.request); assert.equal(oldRevision.body.error.code, 'BRIDGE_PROFILE_REVISION_CHANGED');
  const overwrite = await value.raw('analysis.bridge.publish', { id: prepared.profile.id, expectedRevision: 1, definition: definition(value.dictionary) });
  assert.equal(overwrite.body.error.code, 'BRIDGE_PROFILE_REVISION_CHANGED');
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP private bridges recheck current member and source access and source deletion removes retained evidence', async t => {
  const value = await fixture(t), prepared = await prepare(value), receipt = await value.rpc('analysis.bridge.run', prepared.request);
  const reader = await value.member();
  const privateRead = await value.raw('analysis.bridge.get', { id: receipt.id }, reader.token);
  assert.notEqual(privateRead.status, 200); assert.equal(privateRead.body.error.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(JSON.stringify(privateRead.body).includes('measuredDeltaMinor'), false);
  assert.deepEqual(await value.rpc('analysis.bridge.profiles', {}, reader.token), []);
  await value.rpc('trust.update', { allowedSources: ['another-explicit-source'] });
  const revoked = await value.raw('analysis.bridge.get', { id: receipt.id }); assert.equal(revoked.body.error.code, 'SOURCE_REVOKED');
  await value.rpc('trust.update', { allowedSources: [sourceId] });
  await value.rpc('members.revoke', { id: reader.member.id });
  const revokedMember = await value.raw('analysis.bridge.get', { id: receipt.id }, reader.token);
  assert.equal(revokedMember.status, 401); assert.equal(revokedMember.body.error.code, 'UNAUTHENTICATED');
  await value.rpc('sources.delete', { id: sourceId });
  const erased = await value.raw('analysis.bridge.get', { id: receipt.id }); assert.equal(erased.body.error.code, 'BRIDGE_UNAVAILABLE');
  assert.deepEqual(await value.rpc('analysis.bridge.profiles'), []);
  assert.ok(!value.engine.vault!.read().answers.some((answer: any) => answer.id === receipt.id || answer.id === prepared.profile.id));
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP dictionary republication refuses saved bridge reuse and requires a newly authored current profile', async t => {
  const value = await fixture(t), prepared = await prepare(value), receipt = await value.rpc('analysis.bridge.run', prepared.request);
  const draft = structuredClone(value.draft); draft.definitions.find(item => item.name === 'earned')!.meaning += ' Owner revised the stated event convention.';
  const dictionary = await value.rpc('ontology.publish', { draft }); assert.notEqual(dictionary.hash, value.dictionary.hash);
  const saved = await value.raw('analysis.bridge.get', { id: receipt.id }); assert.equal(saved.body.error.code, 'BRIDGE_STALE_EVIDENCE');
  const staleProfile = await value.raw('analysis.bridge.run', prepared.request); assert.equal(staleProfile.body.error.code, 'BRIDGE_DICTIONARY_CHANGED');
  assert.deepEqual(await value.rpc('analysis.bridge.profiles'), []);
  assert.equal((await value.rpc('receipts.get', { id: prepared.before.id })).stale, true);
  assert.equal(value.providerCalls(), 0);
});
