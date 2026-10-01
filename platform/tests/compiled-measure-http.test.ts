import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { DatabaseCalculator } from '../runtime/analytics.ts';
import type { DictionaryDraft, Definition } from '../runtime/ontology.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { Binding, ImportInput, MappingRecipe } from '../runtime/ingest.ts';

const passphrase = 'Synthetic compiled-measure HTTP fixture passphrase';
const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceId = 'synthetic-owner-authored-money-events';
const bankDefinition: Definition = {
  name: 'bank_revenue', label: 'Owner-defined bank revenue', kind: 'payment', field: 'amountMinor', currency: 'INR', nulls: 'reject',
  meaning: 'Explicit owner convention for this synthetic case: settled cash receipts excluding tax, by settlement date. This is separate from delivered earned revenue.',
};
const feeDefinition: Definition = {
  name: 'settlement_fees', label: 'Reported settlement fees', kind: 'payment', field: 'feeMinor', currency: 'INR', nulls: 'reject',
  meaning: 'Explicit owner convention for this synthetic case: sum only the separately reported fee amount on settled payment events, excluding tax.',
};
const eventInput: ImportInput & { recipe: MappingRecipe } = {
  sourceId, format: 'csv',
  content: 'id,kind,date,amount,fee,currency,branch,status\ninvoice-a,invoice,2026-09-02,1500.00,0.00,INR,main,issued\ninvoice-b,invoice,2026-09-03,1500.00,0.00,INR,main,issued\npayment-a,payment,2026-09-04,1100.00,7.00,INR,main,settled\npayment-b,payment,2026-09-05,1500.00,13.00,INR,main,settled\nsale-a,sale,2026-09-06,1000.00,0.00,INR,main,delivered\nsale-b,sale,2026-09-07,1500.00,0.00,INR,main,delivered',
  recipe: {
    version: 1, id: 'synthetic-owner-money-events', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Measures', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'feeMinor', source: 'fee', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status'].map((field): Binding => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['issued', 'settled', 'delivered'], onUnmapped: 'reject',
  }, expectedTotals: { rowCount: 6, amountMinor: '810000' },
};

async function fixture(t: TestContext) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-compiled-measure-http-'));
  let providerCalls = 0;
  // Experimental file storage is intentional. Native verifier installation below
  // is a trusted test-host seam, not production Engine-options qualification.
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: async () => {
    providerCalls++; throw new Error('This local measure flow must not contact a model provider.');
  } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  t.after(async () => {
    await app.close(); const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-compiled-measure-http-')));
    await rm(target, { recursive: true, force: true });
  });
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const result = await raw(method, payload, bearer); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.error, undefined); return result.body.result;
  }
  await rpc('workspace.create', { name: 'Synthetic Measures', passphrase, demo: false, pack: 'ecommerce' });
  const packs = await rpc('ontology.packs');
  const draft: DictionaryDraft = structuredClone(packs.find((pack: DictionaryDraft) => pack.pack === 'ecommerce'));
  assert.ok(draft); draft.definitions.push(structuredClone(bankDefinition), structuredClone(feeDefinition));
  async function member() {
    const invitation = await rpc('auth.invite', { name: 'Synthetic measure reader', role: 'viewer', branches: ['main'] });
    return rpc('auth.accept', { token: invitation.token });
  }
  function installNativeVerifier() {
    const database = new DatabaseCalculator();
    engine.services.calculator.verifier = (receipt: CalculationReceipt) => database.verify(receipt);
  }
  return { engine, rpc, raw, draft, member, providerCalls: () => providerCalls, installNativeVerifier };
}

function compiledReceipt(receipt: any, dictionary: any, definition: Definition, total: string) {
  assert.equal(receipt.operation, definition.name); assert.equal(receipt.totalMinor, total); assert.equal(receipt.valueMinor, total);
  assert.equal(receipt.dictionaryHash, dictionary.hash); assert.equal(receipt.currency, 'INR');
  const published = dictionary.compiledSums.find((sum: any) => sum.operationId === definition.name);
  assert.ok(published, 'The owner-published measure must have its own compiled artifact.');
  assert.deepEqual(receipt.compiledCalculation, { dictionaryHash: dictionary.hash, sum: published });
  assert.equal(published.contractVersion, 1); assert.equal(published.compilerVersion, 'chausar-single-sum/1');
  assert.equal(published.type, 'single-definition-sum'); assert.equal(published.definitionName, definition.name);
  assert.equal(published.recordKind, definition.kind); assert.equal(published.moneyField, definition.field);
  assert.equal(published.currency, definition.currency); assert.equal(published.sign, definition.sign ?? 1);
  assert.equal(published.nullPolicy, definition.nulls); assert.equal(published.dictionaryVersion, dictionary.version);
  assert.match(published.definitionHash, /^[a-f0-9]{64}$/); assert.match(published.digest, /^[a-f0-9]{64}$/);
  assert.ok(receipt.rows.every((row: any) => row.measureField === definition.field));
}

test('public HTTP owner publication, import, catalog, exact custom sums and encrypted reopen stay local with no native SQL claim', async t => {
  const value = await fixture(t), { rpc, engine } = value;
  const dictionary = await rpc('ontology.publish', { draft: value.draft });
  const imported = await rpc('sources.import', eventInput); assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 6);
  const catalog = await rpc('mcp.info'); assert.ok(catalog.availableTools.some((operation: any) => operation.id === 'bank_revenue'));
  const current = await rpc('ontology.get'); assert.equal(current.current.hash, dictionary.hash);
  for (const [operation, expected] of [['billed', '300000'], ['received', '260000'], ['earned', '250000']] as const) {
    const receipt = await rpc('calculation.run', { operation, period }); assert.equal(receipt.totalMinor, expected);
    assert.equal(receipt.databaseProof, undefined, 'Experimental arithmetic is not native SQL evidence.');
  }
  const bank = await rpc('calculation.run', { operation: 'bank_revenue', period }); compiledReceipt(bank, dictionary, bankDefinition, '260000');
  assert.deepEqual(bank.rows.map((row: any) => row.amountMinor).sort(), ['110000', '150000']);
  assert.ok(bank.rowIds.every((id: string) => imported.rowIds.includes(id)));
  const fees = await rpc('calculation.run', { operation: 'settlement_fees', period }); compiledReceipt(fees, dictionary, feeDefinition, '2000');
  assert.deepEqual(fees.rows.map((row: any) => row.amountMinor).sort(), ['1300', '700']);
  await rpc('workspace.lock'); await rpc('workspace.open', { folder: 'main', passphrase });
  assert.deepEqual(await rpc('receipts.get', { id: bank.id }), bank); assert.deepEqual(await rpc('receipts.get', { id: fees.id }), fees);
  assert.equal(value.providerCalls(), 0); assert.equal(engine.vault!.read().modelReceipts.length, 0);
  assert.equal((await rpc('trust.get')).policy.send, 'nothing');
});

let duckdbInstalled = false;
try { createRequire(import.meta.url).resolve('@duckdb/node-api'); duckdbInstalled = true; } catch {}
test('public experimental-file HTTP custom field sums carry actual installed native DuckDB proof and survive reopen', { skip: !duckdbInstalled }, async t => {
  const value = await fixture(t), { rpc } = value;
  const dictionary = await rpc('ontology.publish', { draft: value.draft }); await rpc('sources.import', eventInput);
  value.installNativeVerifier();
  const bank = await rpc('calculation.run', { operation: 'bank_revenue', period }); compiledReceipt(bank, dictionary, bankDefinition, '260000');
  const fees = await rpc('calculation.run', { operation: 'settlement_fees', period }); compiledReceipt(fees, dictionary, feeDefinition, '2000');
  for (const receipt of [bank, fees]) {
    assert.equal(receipt.databaseProof.verified, true); assert.equal(receipt.databaseProof.engine, 'duckdb');
    assert.equal(receipt.databaseProof.receiptId, receipt.id); assert.equal(receipt.databaseProof.operation, receipt.operation);
  }
  await rpc('workspace.lock'); await rpc('workspace.open', { folder: 'main', passphrase }); value.installNativeVerifier();
  assert.deepEqual(await rpc('receipts.get', { id: fees.id }), fees);
  const repeated = await rpc('calculation.run', { operation: 'settlement_fees', period });
  assert.equal(repeated.totalMinor, '2000'); assert.equal(repeated.databaseProof.engine, 'duckdb'); assert.equal(value.providerCalls(), 0);
});

test('public custom measure receipts enforce current member, revoked source, revoked session and source erasure', async t => {
  const value = await fixture(t), { rpc, raw } = value;
  await rpc('ontology.publish', { draft: value.draft }); await rpc('sources.import', eventInput);
  const ownerReceipt = await rpc('calculation.run', { operation: 'bank_revenue', period });
  const reader = await value.member();
  const privateReceipt = await raw('receipts.get', { id: ownerReceipt.id }, reader.token);
  assert.equal(privateReceipt.status, 403); assert.equal(privateReceipt.body.error.code, 'RECEIPT_FORBIDDEN');
  assert.ok(!JSON.stringify(privateReceipt.body).includes('260000'));
  const readerReceipt = await rpc('calculation.run', { operation: 'bank_revenue', period, branch: 'main' }, reader.token);
  assert.equal(readerReceipt.totalMinor, '260000');
  await rpc('trust.update', { allowedSources: ['another-explicit-source'] });
  const denied = await raw('receipts.get', { id: ownerReceipt.id }); assert.notEqual(denied.status, 200); assert.equal(denied.body.error.code, 'RECEIPT_FORBIDDEN');
  await rpc('trust.update', { allowedSources: [sourceId] }); await rpc('members.revoke', { id: reader.member.id });
  const revoked = await raw('receipts.get', { id: readerReceipt.id }, reader.token); assert.equal(revoked.status, 401); assert.equal(revoked.body.error.code, 'UNAUTHENTICATED');
  await rpc('sources.delete', { id: sourceId });
  const erased = await raw('receipts.get', { id: ownerReceipt.id }); assert.equal(erased.body.error.code, 'RECEIPT_NOT_FOUND');
  assert.ok(!JSON.stringify(erased.body).includes('260000')); assert.equal(value.providerCalls(), 0);
});

test('public dictionary republication retains labelled stale evidence and recomputes the newly authored meaning; unknown operations fail closed', async t => {
  const value = await fixture(t), { rpc, raw } = value;
  const first = await rpc('ontology.publish', { draft: value.draft }); await rpc('sources.import', eventInput);
  const original = await rpc('calculation.run', { operation: 'bank_revenue', period });
  const revised = structuredClone(value.draft);
  revised.definitions[revised.definitions.findIndex(definition => definition.name === 'bank_revenue')] = {
    ...bankDefinition, kind: 'sale', meaning: 'Explicit revised owner convention for this synthetic case: delivered sale events excluding tax, by delivery date.',
  };
  const second = await rpc('ontology.publish', { draft: revised }); assert.notEqual(second.hash, first.hash);
  const retained = await rpc('receipts.get', { id: original.id }); assert.equal(retained.stale, true); assert.equal(retained.totalMinor, '260000');
  assert.deepEqual(retained.compiledCalculation, original.compiledCalculation); assert.equal(retained.dictionaryHash, first.hash);
  const fresh = await rpc('calculation.run', { operation: 'bank_revenue', period });
  compiledReceipt(fresh, second, revised.definitions.find(definition => definition.name === 'bank_revenue')!, '250000');
  for (const operation of ['unpublished_fees', 'constructor', 'SELECT private_data']) {
    const unknown = await raw('calculation.run', { operation, period }); assert.equal(unknown.body.error.code, 'UNKNOWN_CALCULATION');
  }
  const forged = await raw('calculation.run', { operation: 'bank_revenue', period, compiledCalculation: original.compiledCalculation });
  assert.equal(forged.body.error.code, 'INVALID_CALCULATION'); assert.equal(value.providerCalls(), 0);
});

test('public custom money field preserves integers beyond Number precision and distinguishes excluded missing amounts from zero', async t => {
  const value = await fixture(t), { rpc, raw } = value;
  const visible: Definition = { ...feeDefinition, name: 'visible_fees', nulls: 'exclude' };
  const signed: Definition = { ...visible, name: 'signed_fees', sign: -1 };
  const required: Definition = { ...feeDefinition, name: 'required_fees', nulls: 'reject' };
  value.draft.definitions.push(visible, signed, required); const dictionary = await rpc('ontology.publish', { draft: value.draft });
  const large = structuredClone(eventInput); large.sourceId = 'synthetic-big-integer-fees';
  large.content = 'id,kind,date,amount,fee,currency,branch,status\npayment-big,payment,2026-09-04,5000,900719925474099312345,INR,main,settled\npayment-small,payment,2026-09-05,7000,10003,INR,main,settled\npayment-unknown,payment,2026-09-06,9000,,INR,main,settled';
  large.recipe = { ...large.recipe, id: 'synthetic-big-integer-fees', bindings: large.recipe.bindings.map((binding): Binding => binding.type === 'money' ? { ...binding, moneyUnit: 'minor', nulls: binding.target === 'feeMinor' ? 'omit' : 'reject' } : binding) };
  large.expectedTotals = { rowCount: 3, amountMinor: '21000' }; const imported = await rpc('sources.import', large);
  const receipt = await rpc('calculation.run', { operation: 'visible_fees', period }); compiledReceipt(receipt, dictionary, visible, '900719925474099322348');
  assert.equal(receipt.coverage.completeness, 'partial'); assert.equal(receipt.coverage.countedRows, 2);
  assert.ok(receipt.exclusions.some((excluded: any) => excluded.rowId === imported.rowIds[2] && excluded.reason.includes('null')));
  assert.ok(receipt.coverage.gaps.some((gap: string) => gap.includes('missing amounts are not zero')));
  const negative = await rpc('calculation.run', { operation: 'signed_fees', period }); compiledReceipt(negative, dictionary, signed, '-900719925474099322348');
  const rejected = await raw('calculation.run', { operation: 'required_fees', period }); assert.equal(rejected.body.error.code, 'MISSING_MEASURE_VALUE');
  assert.equal(value.providerCalls(), 0);
});

function barrier() {
  let start!: () => void, release!: () => void;
  const started = new Promise<void>(accept => { start = accept; }), waiting = new Promise<void>(accept => { release = accept; });
  return { started, release, async verify() { start(); await waiting; return { engine: 'injected-test-barrier', nativeExecutionClaim: false }; } };
}

test('public dictionary change during pending custom verification refuses receipt commit', async t => {
  const value = await fixture(t), { rpc, raw, engine } = value;
  await rpc('ontology.publish', { draft: value.draft }); await rpc('sources.import', eventInput);
  const gate = barrier(); engine.services.calculator.verifier = () => gate.verify();
  const pending = raw('calculation.run', { operation: 'bank_revenue', period });
  const revised = structuredClone(value.draft); revised.definitions.find(definition => definition.name === 'bank_revenue')!.meaning += ' Revised owner wording.';
  try {
    await Promise.race([gate.started, pending.then(result => { throw new Error(`Verification was not reached: ${JSON.stringify(result.body)}`); })]);
    await rpc('ontology.publish', { draft: revised });
  } finally { gate.release(); }
  const result = await pending; assert.notEqual(result.status, 200); assert.equal(result.body.error.code, 'DICTIONARY_CHANGED');
  assert.equal(engine.vault!.read().receipts.length, 0); assert.equal(value.providerCalls(), 0);
});

test('public member revocation during pending custom verification refuses receipt commit', async t => {
  const value = await fixture(t), { rpc, raw, engine } = value;
  await rpc('ontology.publish', { draft: value.draft }); await rpc('sources.import', eventInput);
  const reader = await value.member(), gate = barrier(); engine.services.calculator.verifier = () => gate.verify();
  const pending = raw('calculation.run', { operation: 'bank_revenue', period, branch: 'main' }, reader.token);
  try {
    await Promise.race([gate.started, pending.then(result => { throw new Error(`Verification was not reached: ${JSON.stringify(result.body)}`); })]);
    await rpc('members.revoke', { id: reader.member.id });
  } finally { gate.release(); }
  const result = await pending; assert.notEqual(result.status, 200); assert.equal(result.body.error.code, 'ACCESS_REVOKED');
  assert.equal(engine.vault!.read().receipts.length, 0); assert.equal(value.providerCalls(), 0);
});
