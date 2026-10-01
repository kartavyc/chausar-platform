import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { BridgeService, type BridgeProfileDefinition, type BridgeRunRequest, type BridgeServiceOptions } from '../runtime/bridge-service.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService, type Binding, type ImportInput } from '../runtime/ingest.ts';
import { OntologyService, starterPacks, type Definition } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { MemoryService } from '../runtime/memory.ts';

class Store implements StateStore {
  state = initialState('Synthetic declared bridge');
  beforeCommit?: (state: State) => void;
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>) {
    const draft = this.read(), hook = this.beforeCommit; this.beforeCommit = undefined; hook?.(draft);
    const result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const baseline = { from: '2026-08-01', to: '2026-08-31' }, comparison = { from: '2026-09-01', to: '2026-09-30' };
type Row = { id: string; date: string; amount: string; sku: string; quantity: string; unit?: string; customerId?: string };
const pair: Row[] = [
  { id: 'product-a-august', date: '2026-08-03', amount: '100', sku: 'product-a', quantity: '10' },
  { id: 'product-a-september', date: '2026-09-03', amount: '240', sku: 'product-a', quantity: '20' },
];
function input(rows: Row[]): ImportInput {
  return { sourceId: 'owner-authored-product-sheet', format: 'csv',
    content: 'id,kind,date,amount,currency,branch,sku,quantity,unit,status,customerId\n' + rows.map(row => `${row.id},sale,${row.date},${row.amount},INR,main,${row.sku},${row.quantity},${row.unit ?? 'item'},posted,${row.customerId ?? ''}`).join('\n'),
    recipe: { version: 1, id: 'synthetic-declared-product-grain', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic declared bridge', branches: ['main'] },
      bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
        { target: 'quantity', source: 'quantity', type: 'integer', nulls: 'omit' },
        { target: 'customerId', source: 'customerId', type: 'string', nulls: 'omit' },
        ...['currency', 'branch', 'sku', 'unit', 'status'].map((field): Binding => ({ target: field, source: field, type: 'string', nulls: field === 'unit' ? 'omit' : 'reject' })),
      ], allowedKinds: ['sale'], allowedStatuses: ['posted'], onUnmapped: 'reject' },
    // Only fixture reconciliation uses a computed sum. Expected bridge answers
    // below are independent literals, not values produced by the bridge kernel.
    expectedTotals: { rowCount: rows.length, amountMinor: rows.reduce((total, row) => total + BigInt(row.amount), 0n).toString() } };
}
async function fixture(rows = pair, options: BridgeServiceOptions = {}, definition?: Definition) {
  const store = new Store(), ontology = new OntologyService(store), draft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  if (definition) draft.definitions.push(definition);
  const dictionary = await ontology.publish(owner, draft), operationId = definition?.name ?? 'earned';
  const money = dictionary.definitions.find(item => item.name === operationId)!;
  const imports = new ImportService(store); await imports.commit(owner, input(rows));
  const calculator = new CalculatorService(store, options.calculator), asOf = new Date().toISOString();
  const receipts = [await calculator.calculate(owner, { operation: operationId, period: baseline, branch: 'main', asOf }),
    await calculator.calculate(owner, { operation: operationId, period: comparison, branch: 'main', asOf })];
  const profile: BridgeProfileDefinition = { label: 'Explicit synthetic product bridge', dictionaryHash: dictionary.hash, operationId, moneyDefinitionHash: hash(money),
    quantityField: 'quantity', quantityMeaning: 'Delivered item count encoded as whole scaled integers for this synthetic sheet.', quantityScale: 0,
    identityFields: ['sku'], identityMeaning: 'The exact synthetic SKU identifies one product across the two periods.', grain: 'one-fact-per-product-period',
    unitField: 'unit', unit: 'item', unitMeaning: 'An item is one delivered retail piece; no packaging or contextual conversion is applied.',
    factorRule: 'realized-average-net-amount-per-unit', method: 'separate-interaction', rounding: 'truncate-toward-zero-minor', incompleteCoverage: 'partial',
    scope: { branch: 'main', sourceIds: ['owner-authored-product-sheet'] } };
  const service = new BridgeService(store, options), published = await service.publish(owner, { id: 'synthetic-products', expectedRevision: 0, definition: profile });
  const request: BridgeRunRequest = { profileId: published.id, profileRevision: published.revision, baselineReceiptId: receipts[0].id, comparisonReceiptId: receipts[1].id };
  return { store, ontology, imports, dictionary, calculator, receipts, profile, published, service, request };
}
const code = (expected: string) => (error: any) => error.code === expected;

test('published owner declaration yields private exact 100→240 descriptive bridge with factor and counted/excluded source lineage', async () => {
  const value = await fixture(), saved = await value.service.run(owner, value.request);
  assert.equal(saved.result.status, 'complete'); assert.equal(saved.result.measuredDeltaMinor, '140');
  assert.deepEqual(saved.result.contributions, { volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '0', scopeRemovedMinor: '0' });
  assert.deepEqual(saved.result.residual, { missingFactorMinor: '0', roundingMinor: '0', totalMinor: '0' });
  assert.equal(saved.qualification, 'declared-experimental'); assert.equal(saved.sourceQualification, 'source-unqualified');
  assert.match(saved.interpretation, /not causal effects/); assert.equal(saved.factorAdmission, null);
  assert.deepEqual(saved.sourceIds, ['owner-authored-product-sheet']); assert.equal(saved.rowIds.length, 2);
  assert.equal(saved.manifest.factors[0].sourceAmountMinor, '100'); assert.equal(saved.manifest.factors[0].quantity, '10');
  assert.equal(saved.manifest.factors[0].moneyField, 'amountMinor'); assert.equal(saved.manifest.factors[0].sign, 1);
  assert.ok(saved.manifest.factors.every(factor => factor.factHash === hash(value.store.read().facts.find(fact => fact.id === factor.factId))));
  assert.deepEqual(value.service.get(owner, { id: saved.id }), saved);
  assert.deepEqual(new BridgeService(value.store).get(owner, { id: saved.id }), saved, 'Reconstruction uses persisted evidence, not chat or an in-memory cache.');
  assert.equal(value.store.read().policy.send, 'nothing'); assert.equal(value.store.read().modelReceipts.length, 0); assert.equal(value.store.read().actions.length, 0);
  assert.equal(value.service.profiles(owner).length, 1);
});

test('scope additions/removals and missing common quantities retain independent measured delta and partial residual; refusal is explicit', async () => {
  const rows = [...pair,
    { id: 'removed', date: '2026-08-04', amount: '40', sku: 'removed-product', quantity: '4' },
    { id: 'added', date: '2026-09-04', amount: '30', sku: 'added-product', quantity: '3' },
    { id: 'unknown-a', date: '2026-08-05', amount: '50', sku: 'unknown-product', quantity: '' },
    { id: 'unknown-b', date: '2026-09-05', amount: '70', sku: 'unknown-product', quantity: '' }];
  const value = await fixture(rows), saved = await value.service.run(owner, value.request);
  assert.equal(saved.result.status, 'partial'); assert.equal(saved.result.measuredDeltaMinor, '150');
  assert.equal(saved.result.contributions!.scopeAddedMinor, '30'); assert.equal(saved.result.contributions!.scopeRemovedMinor, '-40');
  assert.deepEqual(saved.result.residual, { missingFactorMinor: '20', roundingMinor: '0', totalMinor: '20' });
  const revised = await value.service.publish(owner, { id: value.published.id, expectedRevision: 1, definition: { ...value.profile, incompleteCoverage: 'refuse' } });
  const refused = await value.service.run(owner, { ...value.request, profileRevision: revised.revision });
  assert.equal(refused.result.status, 'refused'); assert.equal(refused.result.contributions, null); assert.equal(refused.result.residual, null);
});

test('published signs affect factor money exactly once and source amounts remain explicit', async () => {
  const value = await fixture(pair, {}, { name: 'signed_sales', label: 'Signed synthetic sales', meaning: 'Owner-declared negative sign for delivered synthetic sale amount events.',
    kind: 'sale', field: 'amountMinor', currency: 'INR', nulls: 'reject', sign: -1 });
  const saved = await value.service.run(owner, value.request);
  assert.equal(saved.result.measuredDeltaMinor, '-140'); assert.equal(saved.result.contributions!.volumeMinor, '-100');
  assert.equal(saved.result.contributions!.priceMinor, '-20'); assert.equal(saved.result.contributions!.interactionMinor, '-20');
  assert.equal(saved.manifest.factors[0].sourceAmountMinor, '100'); assert.equal(saved.manifest.factors[0].amountMinor, '-100'); assert.equal(saved.manifest.factors[0].sign, -1);
});

test('profile authoring requires explicit meaning, supported fields/methods, current app authority and expected revision', async () => {
  const value = await fixture();
  for (const ctx of [{ ...owner, sourceTainted: true }, { ...owner, channel: 'mcp' as const }, { ...owner, channel: undefined }]) {
    await assert.rejects(value.service.publish(ctx, { id: 'forbidden', expectedRevision: 0, definition: value.profile }), code('BRIDGE_APP_AUTHOR_REQUIRED'));
  }
  await assert.rejects(value.service.publish(owner, { id: value.published.id, expectedRevision: 0, definition: value.profile }), code('BRIDGE_PROFILE_REVISION_CHANGED'));
  for (const [patch, expected] of [
    [{ method: 'ordered-price-first' }, 'BRIDGE_PROFILE_UNSUPPORTED'], [{ quantityField: 'amountMinor' }, 'BRIDGE_FACTOR_BINDING_INVALID'],
    [{ identityFields: ['quantity'] }, 'BRIDGE_IDENTITY_BINDING_INVALID'], [{ quantityMeaning: '' }, 'BRIDGE_FACTOR_BINDING_INVALID'],
    [{ moneyDefinitionHash: hash('different definition') }, 'BRIDGE_DEFINITION_CHANGED'],
  ] as const) await assert.rejects(value.service.publish(owner, { id: 'invalid', expectedRevision: 0, definition: { ...value.profile, ...patch } as BridgeProfileDefinition }), code(expected));
  const missing: any = structuredClone(value.profile); delete missing.rounding;
  await assert.rejects(value.service.publish(owner, { id: 'no-default', expectedRevision: 0, definition: missing }), code('BRIDGE_PROFILE_INVALID'));
});

test('duplicate product grain, missing identity and incompatible private population cuts are refused', async () => {
  const duplicate = await fixture([...pair, { id: 'another-product-a-sale', date: '2026-09-06', amount: '10', sku: 'product-a', quantity: '1' }]);
  await assert.rejects(duplicate.service.run(owner, duplicate.request), code('BRIDGE_INPUT_INVALID'));
  const value = await fixture();
  await value.store.update(state => { state.facts[0].fields.sku = undefined; });
  await assert.rejects(value.service.run(owner, value.request), code('BRIDGE_IDENTITY_REQUIRED'));
  const cut = await fixture(); const later = await cut.calculator.calculate(owner, { operation: 'earned', period: comparison, branch: 'main', asOf: '2099-01-01T00:00:00.000Z' });
  await assert.rejects(cut.service.run(owner, { ...cut.request, comparisonReceiptId: later.id }), code('BRIDGE_POPULATION_MISMATCH'));
});

test('zero quantity or unmatched canonical unit never creates an invented unit price', async () => {
  for (const patch of [{ quantity: '0' }, { unit: 'box' }]) {
    const value = await fixture([pair[0], { ...pair[1], ...patch }]), saved = await value.service.run(owner, value.request);
    assert.equal(saved.result.status, 'partial'); assert.equal(saved.result.residual!.missingFactorMinor, '140');
    assert.equal(saved.result.contributions!.priceMinor, '0'); assert.equal(saved.result.products[0].exact, null);
  }
});

test('managed source roots require distinct trusted factor admission even when their counted population is empty', async () => {
  const value = await fixture(); await value.store.update(state => { state.imports.push({ type: 'connector-capture-v1', sourceId: 'owner-authored-product-sheet', rowIds: [] }); });
  await assert.rejects(value.service.run(owner, value.request), code('BRIDGE_FACTOR_ADMISSION_REQUIRED'));
  const definition = { ...value.profile, scope: { branch: 'main', sourceIds: ['owner-authored-product-sheet', 'managed-empty-root'] } };
  await value.store.update(state => { state.imports.push({ type: 'connector-capture-v1', sourceId: 'managed-empty-root', rowIds: [] }); });
  await value.service.publish(owner, { id: 'empty-managed-root', expectedRevision: 0, definition });
  await assert.rejects(value.service.run(owner, { ...value.request, profileId: 'empty-managed-root' }), code('BRIDGE_FACTOR_ADMISSION_REQUIRED'));
  let calls = 0;
  const guarded = new BridgeService(value.store, { factorAdmission: (_ctx, manifest) => {
    calls++; assert.deepEqual(manifest.managedSourceIds, ['owner-authored-product-sheet']); return { digest: hash(manifest), qualification: 'synthetic-tested' };
  } });
  const saved = await guarded.run(owner, value.request); assert.equal(saved.sourceQualification, 'synthetic-factor-admitted'); assert.equal(calls, 2);
  assert.deepEqual(guarded.get(owner, { id: saved.id }), saved); assert.equal(calls, 3);
  assert.throws(() => new BridgeService(value.store).get(owner, { id: saved.id }), code('BRIDGE_FACTOR_ADMISSION_REQUIRED'));
});

test('existing source readiness is required before commit and reopening, including excluded scopes', async () => {
  let ready = true, calls = 0;
  const value = await fixture(pair, { calculator: { receiptGuard: () => { calls++; if (!ready) throw Object.assign(new Error('Synthetic host readiness revoked'), { code: 'SOURCE_NOT_READY' }); } } });
  const saved = await value.service.run(owner, value.request); assert.ok(calls >= 4);
  ready = false; assert.throws(() => value.service.get(owner, { id: saved.id }), code('SOURCE_NOT_READY'));
  ready = true; value.store.beforeCommit = () => { ready = false; };
  await assert.rejects(value.service.run(owner, value.request), code('SOURCE_NOT_READY'));
  assert.equal(value.store.read().answers.filter(answer => answer.kind === 'descriptive-bridge-receipt-v1').length, 1);
});

test('source revocation, private member mismatch, epoch drift and managed erasure deny saved bridge/profile access', async () => {
  const value = await fixture(), saved = await value.service.run(owner, value.request), trust = new TrustService(value.store);
  const viewer = await trust.addMember(owner, { name: 'Synthetic other reader', role: 'viewer', branches: ['main'] });
  const other: Context = { memberId: viewer.id, role: viewer.role, epoch: viewer.epoch, channel: 'desktop' };
  assert.throws(() => value.service.get(other, { id: saved.id }), code('BRIDGE_UNAVAILABLE')); assert.deepEqual(value.service.profiles(other), []);
  await trust.updatePolicy(owner, { allowedSources: ['some-other-root'] });
  assert.throws(() => value.service.get(owner, { id: saved.id }), code('SOURCE_REVOKED')); assert.deepEqual(value.service.profiles(owner), []);
  await trust.updatePolicy(owner, { allowedSources: ['*'] });
  assert.throws(() => value.service.get({ ...owner, epoch: 2 }, { id: saved.id }), code('ACCESS_REVOKED'));
  await trust.deleteSource(owner, 'owner-authored-product-sheet');
  assert.throws(() => value.service.get(owner, { id: saved.id }), code('BRIDGE_UNAVAILABLE')); assert.deepEqual(value.service.profiles(owner), []);
  assert.equal(value.store.read().answers.some(answer => answer.kind === 'descriptive-bridge-profile-v1' || answer.kind === 'descriptive-bridge-receipt-v1'), false);
});

test('dictionary/profile revisions and changed factor values invalidate reuse rather than restating retained results', async () => {
  const value = await fixture(), saved = await value.service.run(owner, value.request);
  await value.store.update(state => { state.facts[0].fields.quantity = 11; });
  assert.throws(() => value.service.get(owner, { id: saved.id }), code('BRIDGE_EVIDENCE_CHANGED'));
  const revised = await fixture(), first = await revised.service.run(owner, revised.request);
  await revised.service.publish(owner, { id: revised.published.id, expectedRevision: 1, definition: { ...revised.profile, label: 'Reviewed second revision' } });
  assert.throws(() => revised.service.get(owner, { id: first.id }), code('BRIDGE_PROFILE_REVISION_CHANGED'));
  const changed = await fixture(), old = await changed.service.run(owner, changed.request); await changed.ontology.publish(owner, 'ecommerce');
  assert.throws(() => changed.service.get(owner, { id: old.id }), code('BRIDGE_STALE_EVIDENCE'));
  await assert.rejects(changed.service.run(owner, changed.request), code('BRIDGE_DICTIONARY_CHANGED'));
});

test('factor/permission drift during durable commit leaves no saved bridge', async () => {
  const factor = await fixture(); factor.store.beforeCommit = state => { state.facts[0].fields.quantity = 12; };
  await assert.rejects(factor.service.run(owner, factor.request), code('BRIDGE_EVIDENCE_CHANGED'));
  assert.equal(factor.store.read().answers.some(answer => answer.kind === 'descriptive-bridge-receipt-v1'), false);
  const source = await fixture(); source.store.beforeCommit = state => { state.policy.allowedSources = ['other-root']; };
  await assert.rejects(source.service.run(owner, source.request), code('SOURCE_REVOKED'));
  const member = await fixture(); member.store.beforeCommit = state => { state.members[0].epoch = 2; };
  await assert.rejects(member.service.run(owner, member.request), code('ACCESS_REVOKED'));
});

test('receipt row/total tampering and retained request loss fail before attribution', async () => {
  for (const mutate of [
    (state: State) => { state.receipts[0].rows[0].amountMinor = '99'; },
    (state: State) => { state.receipts[0].totalMinor = '99'; },
    (state: State) => { state.answers = state.answers.filter(answer => answer.receiptId !== state.receipts[0].id); },
  ]) {
    const value = await fixture(); await value.store.update(mutate);
    await assert.rejects(value.service.run(owner, value.request)); assert.equal(value.store.read().answers.some(answer => answer.kind === 'descriptive-bridge-receipt-v1'), false);
  }
});

test('declared exact identity retains raw source fields when population selection resolves customer aliases', async () => {
  const value = await fixture([{ ...pair[0], customerId: 'source-a' }, { ...pair[1], customerId: 'source-b' }]);
  await new MemoryService(value.store).merge(owner, ['source-a', 'source-b'], 'source-b');
  const asOf = new Date().toISOString(), before = await value.calculator.calculate(owner, { operation: 'earned', period: baseline, branch: 'main', asOf });
  const after = await value.calculator.calculate(owner, { operation: 'earned', period: comparison, branch: 'main', asOf });
  const profile = await value.service.publish(owner, { id: 'exact-source-identity', expectedRevision: 0, definition: {
    ...value.profile, identityFields: ['customerId'], identityMeaning: 'In this synthetic case the exact source customer tag is the explicitly chosen product key; merged aliases are not product identity.',
  } });
  const saved = await value.service.run(owner, { profileId: profile.id, profileRevision: profile.revision, baselineReceiptId: before.id, comparisonReceiptId: after.id });
  assert.deepEqual(saved.manifest.factors.map(factor => factor.identity), [['source-a'], ['source-b']]);
  assert.equal(saved.result.contributions!.scopeRemovedMinor, '-100'); assert.equal(saved.result.contributions!.scopeAddedMinor, '240');
  assert.equal(saved.result.contributions!.volumeMinor, '0'); assert.equal(saved.result.measuredDeltaMinor, '140');
  assert.ok(saved.manifest.factors.every(factor => factor.factHash === hash(value.store.read().facts.find(fact => fact.id === factor.factId))));
});

test('an all-branch profile loses read/run authority when current branches narrow even if existing rows remain visible', async () => {
  const value = await fixture(), profile = await value.service.publish(owner, { id: 'all-branches', expectedRevision: 0, definition: { ...value.profile, scope: { ...value.profile.scope, branch: null } } });
  const asOf = new Date().toISOString(), before = await value.calculator.calculate(owner, { operation: 'earned', period: baseline, asOf });
  const after = await value.calculator.calculate(owner, { operation: 'earned', period: comparison, asOf });
  const request = { profileId: profile.id, profileRevision: profile.revision, baselineReceiptId: before.id, comparisonReceiptId: after.id };
  const saved = await value.service.run(owner, request);
  await value.store.update(state => { state.members[0].branches = ['main']; });
  assert.throws(() => value.service.get(owner, { id: saved.id }), code('BRIDGE_SCOPE_FORBIDDEN'));
  await assert.rejects(value.service.run(owner, request), code('BRIDGE_SCOPE_FORBIDDEN'));
  assert.equal(value.service.profiles(owner).some(item => item.id === profile.id), false);
});
