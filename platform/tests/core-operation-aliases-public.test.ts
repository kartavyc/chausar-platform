import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { hash, type Context } from '../runtime/contracts.ts';
import type { DictionaryDraft } from '../runtime/ontology.ts';
import { FIXTURE_SOURCE, importInput, loadPackage, PERIOD, UNSUPPORTED_MESSAGE } from '../benchmarks/bilingual/fixture.ts';

// Synthetic public-API acceptance only: experimental-file storage and authored CSV.
// No provider configuration, credentials, model dispatch, native worker or GUI.
const PASSWORD = 'Synthetic disposable core-alias acceptance passphrase';
type Operation = 'billed' | 'received' | 'earned' | 'refunds' | 'net_sales' | 'margin';
const oracle: Record<Operation, { minor: string; entities: string[]; figures: Record<string, string> }> = {
  billed: { minor: '220000', entities: ['invoice-a'], figures: { total: '220000' } },
  received: { minor: '110000', entities: ['payment-a'], figures: { total: '110000' } },
  earned: { minor: '205000', entities: ['order-a', 'order-b'], figures: { total: '205000' } },
  refunds: { minor: '12500', entities: ['refund-a'], figures: { total: '12500' } },
  net_sales: { minor: '192500', entities: ['order-a', 'order-b', 'refund-a'], figures: { total: '192500' } },
  margin: { minor: '134500', entities: ['order-a', 'order-b', 'refund-a', 'cost-a', 'cost-b'],
    figures: { earned: '205000', refunds: '12500', netSales: '192500', costs: '58000', contribution: '134500', marginBps: '6987' } },
};
// Original nine questions recovered from the preceding frozen lane3 benchmark.
// Pin the wording here so a revised benchmark oracle cannot change this acceptance.
const originalHindi: [Operation, string][] = [
  ['billed', 'कितनी राशि के बिल बने?'],
  ['received', 'कितना नकद मिला?'],
  ['earned', 'कितनी अर्जित कमाई हुई?'],
  ['refunds', 'कितनी राशि वापस हुई?'],
  ['net_sales', 'शुद्ध बिक्री कितनी थी?'],
  ['margin', 'योगदान कितना था?'],
];
const originalRefusals = ['बिक्री कैसी चल रही है?', 'पूरा लेखा लाभ कितना है?', 'बिक्री क्यों बदली?'];
const independentHindi: [Operation, string][] = [
  ['billed', 'बिलों की राशि कितनी थी?'],
  ['received', 'कृपया प्राप्त नकद बताएँ।'],
  ['earned', 'अर्जित राजस्व कितना है?'],
  ['refunds', 'वापसी की राशि कितनी थी?'],
  ['net_sales', 'कृपया शुद्ध बिक्री बताएँ।'],
  ['margin', 'कितना ऑर्डर योगदान हुआ?'],
];
const clearEnglish: [Operation, string][] = [
  ['billed', 'What was billed?'], ['received', 'What was received?'], ['earned', 'What was earned?'],
  ['refunds', 'What were refunds?'], ['net_sales', 'What was net sales?'], ['margin', 'What was margin?'],
];

async function fixture(t: TestContext) {
  const base = await realpath(resolve(tmpdir()));
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Synthetic acceptance scratch must stay on C.');
  const directory = await mkdtemp(join(base, 'chausar-core-aliases-public-'));
  let providerDispatches = 0;
  const denyTransport = async () => { providerDispatches++; throw new Error('Provider dispatch is forbidden in local alias acceptance.'); };
  const options = { directory, demo: true, storage: 'experimental-file' as const, gateway: { http: denyTransport, process: denyTransport } };
  let engine = new Engine(options);
  t.after(async () => {
    try {
      if ((await engine.request('workspace.status')).open) {
        assert.deepEqual((await engine.request('activity.list')).modelReceipts, []);
      }
      assert.equal(providerDispatches, 0, 'No local question may fall through to a model provider.');
    } finally {
      try { await engine.close(); } finally {
        const target = await realpath(directory), child = relative(base, target);
        assert.ok(child && !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep) && !child.includes(sep));
        assert.ok(basename(target).startsWith('chausar-core-aliases-public-'));
        await rm(target, { recursive: true, force: true });
      }
    }
  });
  await engine.request('workspace.create', { name: 'Synthetic Bilingual Shop', folder: 'aliases', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  const dictionary = await engine.request('ontology.publish', { pack: 'ecommerce' });
  const loaded = await loadPackage(), imported = await engine.request('sources.import', importInput(loaded.shop));
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 12);
  const facts = (await engine.request('memory.list')).facts;
  assert.equal(facts.length, 12);
  const request = (method: string, payload: Record<string, unknown> = {}) => engine.request(method, payload);
  const requestAs = (context: Context, method: string, payload: Record<string, unknown> = {}) => engine.requestAs(context, method, payload);
  const ask = (question: string, filters: Record<string, unknown> = {}) => request('conversation.ask', { question, period: PERIOD, sourceIds: [FIXTURE_SOURCE], ...filters });
  async function reopen() {
    if ((await request('workspace.status')).open) await request('workspace.lock');
    await engine.close(); engine = new Engine(options);
    await request('workspace.open', { folder: 'aliases', passphrase: PASSWORD });
  }
  return { request, requestAs, ask, dictionary, facts, reopen, dispatches: () => providerDispatches };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function assertAnswer(f: Fixture, question: string, operation: Operation) {
  const answer = await f.ask(question), receipt = answer.receipt, expected = oracle[operation];
  assert.equal(answer.supported, true, question); assert.ok(receipt, question);
  assert.equal(receipt.operation, operation, question);
  assert.equal(receipt.valueMinor, expected.minor, question); assert.equal(receipt.totalMinor, expected.minor, question);
  assert.equal(receipt.currency, 'INR'); assert.deepEqual(receipt.period, PERIOD);
  assert.deepEqual(receipt.requestedSourceIds, [FIXTURE_SOURCE]);
  assert.deepEqual(receipt.rows.map((row: any) => row.entityId).sort(), [...expected.entities].sort(), question);
  assert.deepEqual(receipt.rowIds.slice().sort(), receipt.rows.map((row: any) => row.factId).sort());
  assert.equal(new Set(receipt.rowIds).size, receipt.rowIds.length);
  for (const row of receipt.rows) {
    const fact = f.facts.find((fact: any) => fact.id === row.factId); assert.ok(fact);
    assert.equal(row.sourceId, FIXTURE_SOURCE); assert.equal(row.entityId, fact.entityId);
    assert.equal(row.amountMinor, fact.fields.amountMinor); assert.equal(row.sourceRow, fact.sourceRow);
  }
  assert.deepEqual(Object.fromEntries(receipt.figures.map((figure: any) => [figure.key, figure.minor])), expected.figures, question);
  assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.equal(receipt.coverage.countedRows, expected.entities.length);
  assert.equal(receipt.dictionaryHash, f.dictionary.hash); assert.equal(receipt.ontologyVersion, f.dictionary.version);
  const definitions = f.dictionary.definitions.filter((definition: any) => f.dictionary.operations.find((item: any) => item.id === operation).definitions.includes(definition.name));
  assert.deepEqual(receipt.definitions, definitions); assert.equal(receipt.definitionHash, hash(definitions));
  if (operation === 'margin') assert.ok(receipt.coverage.gaps.some((gap: string) => gap.includes('Contribution includes imported costs only.')));
  assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt, 'Readback must preserve the actual public receipt and current authority.');
  assert.equal(f.dispatches(), 0);
  return receipt;
}
async function completedCalculations(f: Fixture) {
  return (await f.request('activity.list')).items.filter((item: any) => item.event === 'calculation.completed').length;
}
async function assertUnsupported(f: Fixture, question: string) {
  const before = await completedCalculations(f), result = await f.ask(question);
  assert.equal(result.supported, false, question); assert.equal(result.receipt, null, question);
  assert.equal(result.message, UNSUPPORTED_MESSAGE, question);
  assert.equal(await completedCalculations(f), before, `Refusal must not retain a calculation: ${question}`);
  assert.equal(f.dispatches(), 0);
}

test('public local question path answers six clear original Hindi questions and refuses the other three', async t => {
  const f = await fixture(t);
  for (const [operation, question] of originalHindi) await assertAnswer(f, question, operation);
  for (const question of originalRefusals) await assertUnsupported(f, question);
  assert.deepEqual((await f.request('memory.list')).facts, f.facts, 'Alias selection must not change synthetic source facts.');
});

test('reusable Hindi wording and clear English wording select published operations with identical receipt semantics', async t => {
  const f = await fixture(t);
  for (const [operation, question] of independentHindi) await assertAnswer(f, question, operation);
  for (const [operation, question] of clearEnglish) await assertAnswer(f, question, operation);
  assert.equal(await completedCalculations(f), 12);
});

test('counts, balances, negated requests, multiple operations and vague profit or causal language remain unsupported', async t => {
  const f = await fixture(t);
  const questions = [
    'कितने बिल बने?', 'बिल कितने हैं?', 'नकद कितना है?', 'नकद कितना बचा है?',
    'शुद्ध बिक्री मत बताओ', 'शुद्ध बिक्री और प्राप्त नकद कितनी थी?', 'बिक्री', 'लाभ',
    ...originalRefusals,
  ];
  for (const question of questions) await assertUnsupported(f, question);
  assert.equal(await completedCalculations(f), 0);
  assert.deepEqual((await f.request('memory.list')).facts, f.facts);
});

test('Hindi alias selection retains current branch, member, source and private-receipt authority gates', async t => {
  const f = await fixture(t), ownerReceipt = await assertAnswer(f, 'अर्जित राजस्व कितना है?', 'earned');
  const viewer = await f.request('members.add', { name: 'Synthetic main-only alias viewer', role: 'viewer', branches: ['main'] });
  const context: Context = { memberId: viewer.id, role: viewer.role, epoch: viewer.epoch, channel: 'desktop' };
  const askAs = (filters: Record<string, unknown> = {}) => f.requestAs(context, 'conversation.ask', {
    question: 'कितनी अर्जित कमाई हुई?', period: PERIOD, sourceIds: [FIXTURE_SOURCE], ...filters,
  });
  const scoped = await askAs(); assert.equal(scoped.supported, true);
  assert.equal(scoped.receipt.totalMinor, '125025');
  assert.deepEqual(scoped.receipt.rows.map((row: any) => row.entityId), ['order-a']);
  assert.ok(scoped.receipt.rows.every((row: any) => row.branch === 'main'));
  assert.deepEqual(await f.requestAs(context, 'receipts.get', { id: scoped.receipt.id }), scoped.receipt);
  await assert.rejects(askAs({ branch: 'west' }), { code: 'FORBIDDEN_BRANCH' });
  await assert.rejects(f.requestAs(context, 'receipts.get', { id: ownerReceipt.id }), { code: 'RECEIPT_FORBIDDEN' });
  await f.request('members.revoke', { id: viewer.id });
  await assert.rejects(askAs(), { code: 'ACCESS_REVOKED' });
  await assert.rejects(f.requestAs(context, 'receipts.get', { id: scoped.receipt.id }), { code: 'ACCESS_REVOKED' });
  await f.request('trust.update', { allowedSources: [] });
  await assert.rejects(f.ask('कितनी अर्जित कमाई हुई?'), { code: 'SOURCE_REVOKED' });
  await assert.rejects(f.request('receipts.get', { id: ownerReceipt.id }), { code: 'SOURCE_REVOKED' });
  assert.equal(await completedCalculations(f), 2, 'Denied alias requests must not save additional receipts.');
});

test('public Hindi receipt survives encrypted Engine reopen and locked questions cannot execute', async t => {
  const f = await fixture(t), retained = await assertAnswer(f, 'कृपया शुद्ध बिक्री बताएँ।', 'net_sales');
  await f.request('workspace.lock');
  await assert.rejects(f.ask('कृपया शुद्ध बिक्री बताएँ।'), { code: 'VAULT_LOCKED' });
  await assert.rejects(f.request('receipts.get', { id: retained.id }), { code: 'VAULT_LOCKED' });
  await f.reopen();
  assert.deepEqual(await f.request('receipts.get', { id: retained.id }), retained);
  await assertAnswer(f, 'कृपया शुद्ध बिक्री बताएँ।', 'net_sales');
  assert.equal(f.dispatches(), 0);
});

test('legacy English discovery retains owner-customized semantics while new aliases require reviewed definitions', async t => {
  const f = await fixture(t);
  await assertAnswer(f, 'What was billed?', 'billed');
  await assertAnswer(f, 'What were refunds?', 'refunds');
  const draft: DictionaryDraft = {
    pack: f.dictionary.pack, label: f.dictionary.label, currency: f.dictionary.currency, gstMode: f.dictionary.gstMode,
    fields: structuredClone(f.dictionary.fields), definitions: structuredClone(f.dictionary.definitions),
  };
  const billed = draft.definitions.find(definition => definition.name === 'billed'); assert.ok(billed);
  billed.kind = 'cost'; billed.label = 'Owner cost-based billed';
  billed.meaning = 'Synthetic owner defines billed to count imported period costs instead of invoice values.';
  const billedPublication = await f.request('ontology.publish', { draft, expectedCurrentHash: f.dictionary.hash });
  assert.equal(billedPublication.version, f.dictionary.version + 1);
  assert.notEqual(billedPublication.hash, f.dictionary.hash);
  const legacy = await f.ask('What was billed?');
  assert.equal(legacy.supported, true, 'The existing English route continues to execute the current owner definition.');
  assert.equal(legacy.receipt.operation, 'billed');
  assert.equal(legacy.receipt.valueMinor, '58000'); assert.equal(legacy.receipt.totalMinor, '58000');
  assert.deepEqual(legacy.receipt.rows.map((row: any) => row.entityId).sort(), ['cost-a', 'cost-b']);
  assert.deepEqual(Object.fromEntries(legacy.receipt.figures.map((figure: any) => [figure.key, figure.minor])), { total: '58000' });
  assert.equal(legacy.receipt.dictionaryHash, billedPublication.hash);
  assert.deepEqual(legacy.receipt.definitions, [billed]); assert.equal(legacy.receipt.definitionHash, hash([billed]));
  assert.deepEqual(legacy.receipt.period, PERIOD); assert.deepEqual(legacy.receipt.requestedSourceIds, [FIXTURE_SOURCE]);
  assert.deepEqual(await f.request('receipts.get', { id: legacy.receipt.id }), legacy.receipt);
  await assertUnsupported(f, 'बिलों की राशि कितनी थी?');

  const refunds = draft.definitions.find(definition => definition.name === 'refunds'); assert.ok(refunds);
  refunds.kind = 'cost'; refunds.label = 'Owner cost-based refunds';
  refunds.meaning = 'Synthetic owner defines refunds to count imported period costs instead of credit notes.';
  const refundPublication = await f.request('ontology.publish', { draft, expectedCurrentHash: billedPublication.hash });
  const current = await f.request('calculation.run', { operation: 'refunds', period: PERIOD, sourceIds: [FIXTURE_SOURCE] });
  assert.equal(current.operation, 'refunds'); assert.equal(current.valueMinor, '58000'); assert.equal(current.totalMinor, '58000');
  assert.deepEqual(current.rows.map((row: any) => row.entityId).sort(), ['cost-a', 'cost-b']);
  assert.equal(current.dictionaryHash, refundPublication.hash); assert.deepEqual(current.definitions, [refunds]);
  assert.equal(current.definitionHash, hash([refunds]));
  assert.deepEqual(await f.request('receipts.get', { id: current.id }), current);
  await assertUnsupported(f, 'What were refunds?');
  await assertUnsupported(f, 'वापसी की राशि कितनी थी?');
  assert.equal(await completedCalculations(f), 4, 'Changed-definition refusals must not create fallback receipts.');
  assert.deepEqual((await f.request('memory.list')).facts, f.facts, 'Custom definition publication does not rewrite source evidence.');
  assert.equal(f.dispatches(), 0);
});
