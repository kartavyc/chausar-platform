import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { buildBusinessContext } from '../runtime/conversation-context.ts';
import { createCalculationAnswerRecord } from '../runtime/conversation-history.ts';
import { validateConversationPlan, type ConversationPlannerContext } from '../runtime/conversation-planner.ts';
import { conversationCalculationClarification, type ReviewedConversationCalculationParameters } from '../runtime/conversation-calculation-arguments.ts';
import { numberGuard, type CalculationReceipt } from '../runtime/calculator.ts';
import { starterPacks } from '../runtime/ontology.ts';

// Real import, exact calculator, encrypted storage and current-history services.
// Planner wires below are authored SYNTHETIC fixtures, never model predictions.
// The coordinator-owned public conversation join is deliberately not simulated.
const PASSWORD = 'Synthetic calculation parameter fixture passphrase';
const ENDPOINT = 'https://synthetic-calculation-parameters.invalid/v1/responses';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const PRIOR = { from: '2026-08-01', to: '2026-08-31' };
type Row = { id: string; date: string; minor: string };
const DEFAULT_ROWS: Row[] = [
  { id: 'current-one', date: '2026-09-02', minor: '10000' },
  { id: 'current-two', date: '2026-09-03', minor: '20001' },
  { id: 'prior', date: '2026-08-02', minor: '12000' },
  { id: 'outside', date: '2026-07-02', minor: '70000' },
];

async function fixture(t: TestContext, rows: Row[] = DEFAULT_ROWS) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-calculation-parameters-'));
  const control: { providerCalls: number; wire: unknown } = { providerCalls: 0,
    wire: { kind: 'clarification', calls: [], clarification: 'Which comparison period should I use?' } };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: {
    http: async () => {
      control.providerCalls++;
      return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(control.wire) }] },
      ] }) };
    },
  } });
  t.after(async () => {
    await engine.close();
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('chausar-calculation-parameters-'));
    await rm(target, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'SYNTHETIC comparison and scenario business', folder: 'fixture',
    passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  async function importRows(sourceId: string, importedRows: Row[], expectedMinor: string, kind: 'sale' | 'invoice' = 'sale') {
    const result = await engine.request('sources.import', { sourceId, format: 'csv',
      content: 'id,kind,date,amount,currency,branch,status\n' + importedRows.map(row =>
        `${row.id},${kind},${row.date},${row.minor},INR,main,delivered`).join('\n'),
      expectedTotals: { rowCount: importedRows.length, amountMinor: expectedMinor },
      recipe: { version: 1, id: `synthetic-${sourceId}-minor-units`, system: 'synthetic-csv', edition: '1',
        scope: { company: 'SYNTHETIC comparison and scenario business', branches: ['main'] }, bindings: [
          { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
          { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
          { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
          { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
          ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
        ], allowedKinds: ['sale', 'invoice'], allowedStatuses: ['delivered'], onUnmapped: 'reject' } });
    assert.equal(result.coverage.reconciled, true);
    return result;
  }
  // Import reconciliation totals are independent fixture input, not answer keys.
  await importRows('synthetic-A', rows, String(rows.reduce((sum, row) => sum + BigInt(row.minor), 0n)));
  // Same current/prior identities conflict unless filtering precedes resolution.
  const currentRow = rows.find(row => row.date >= PERIOD.from && row.date <= PERIOD.to)!;
  await importRows('synthetic-B', [
    { id: currentRow.id, date: currentRow.date, minor: '900000' },
    { id: 'prior', date: '2026-08-02', minor: '800000' },
  ], '1700000');
  await engine.request('models.configure', { config: { id: 'synthetic-parameters-route', kind: 'openai-responses',
    model: 'synthetic-authored-planner-fixture', endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' },
    secret: 'synthetic-fixture-only' });
  await engine.request('trust.update', { send: 'shape' });
  function context(parameters: ReviewedConversationCalculationParameters): ConversationPlannerContext {
    const store = engine.vault!;
    return { manifest: buildBusinessContext(store, engine.context, { sourceIds: ['synthetic-A'], period: parameters.period }),
      operations: store.read().ontology.current.operations.map((op: { id: string }) => op.id),
      selectors: { branches: ['main'], customerIds: [] }, reviewedCalculationParameters: parameters };
  }
  async function run(operation: 'change' | 'scenario', parameters: ReviewedConversationCalculationParameters,
    sourceIds: string[] = ['synthetic-A']): Promise<CalculationReceipt> {
    const plan = validateConversationPlan({ kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
      operation, period: parameters.period ?? null, branch: null, customerId: null,
      ...(operation === 'change' ? { comparePeriod: parameters.comparePeriod } : { assumptions: parameters.assumptions }),
    } }], clarification: null }, context(parameters));
    const call = plan.calls[0];
    assert.equal(call.tool, 'calculator.calculate');
    // Coordinator normally supplies this source/time admission. This fixture
    // calls the existing public calculator after the actual lane validator.
    return engine.request('calculation.run', { ...call.args, sourceIds });
  }
  async function retain(question: string, receipt: CalculationReceipt) {
    const record = createCalculationAnswerRecord(engine.context, question, receipt, receipt);
    await engine.vault!.update(state => { state.conversations.push(record); });
    assert.deepEqual((await engine.request('conversation.get', { id: record.id })).answer, receipt);
    return record;
  }
  async function reopen() {
    await engine.request('workspace.lock');
    await engine.request('workspace.open', { folder: 'fixture', passphrase: PASSWORD });
  }
  return { engine, directory, control, run, retain, reopen, context, importRows };
}
function figures(receipt: CalculationReceipt) { return Object.fromEntries(receipt.figures.map(figure => [figure.key, figure.minor])); }

test('imported two-period comparison uses independent arithmetic, A-only evidence and retained reopen', async t => {
  const f = await fixture(t), before = f.engine.vault!.read().facts;
  const receipt = await f.run('change', { period: PERIOD, comparePeriod: PRIOR });
  // 10000+20001=30001; 30001-12000=18001;
  // 18001*10000/12000=15000 remainder 10000: truncate to 15000 bps.
  assert.deepEqual(figures(receipt), { current: '30001', previous: '12000', change: '18001', changeBps: '15000' });
  assert.equal(receipt.totalMinor, '18001');
  assert.deepEqual(receipt.period, PERIOD); assert.deepEqual(receipt.comparePeriod, PRIOR);
  assert.deepEqual(receipt.requestedSourceIds, ['synthetic-A']); assert.deepEqual(receipt.sourceIds, ['synthetic-A']);
  assert.equal(receipt.coverage.countedRows, 3); assert.equal(receipt.coverage.unresolvedConflicts, 0);
  assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  assert.ok(receipt.rows.every(row => row.sourceId === 'synthetic-A'));
  assert.match(String(receipt.assumptions.causalStatus), /not a causal explanation/);
  assert.deepEqual(f.engine.vault!.read().facts, before);
  const record = await f.retain('SYNTHETIC: compare the explicit September and August periods.', receipt);
  await f.reopen();
  assert.deepEqual(await f.engine.request('receipts.get', { id: receipt.id }), receipt);
  assert.deepEqual((await f.engine.request('conversation.get', { id: record.id })).answer, receipt);
  assert.equal(f.control.providerCalls, 0);
  const encrypted = await readFile(join(f.directory, 'fixture', 'authority.encrypted.json'), 'utf8');
  assert.equal(encrypted.includes(record.question), false);
});

test('owner price basis points remain exact input while scenario output truncates and source facts stay unchanged', async t => {
  const f = await fixture(t), before = f.engine.vault!.read().facts;
  const receipt = await f.run('scenario', { period: PERIOD, assumptions: { priceChangeBps: '00500' } });
  // 30001*10500/10000=31501.05; retained 31501, change 1500.
  assert.deepEqual(figures(receipt), { baseline: '30001', scenario: '31501', change: '1500', priceChangeBps: '500' });
  assert.equal(receipt.totalMinor, '31501');
  assert.equal(receipt.assumptions.volume, 'Held constant');
  assert.equal(receipt.assumptions.status, 'Scenario only. Source facts are unchanged.');
  assert.equal(receipt.assumptions.rounding, 'Truncate fractional minor units toward zero');
  const saved = f.engine.vault!.read().answers.find(answer => answer.receiptId === receipt.id);
  assert.deepEqual(saved.request.assumptions, { priceChangeBps: '00500' });
  assert.deepEqual(f.engine.vault!.read().facts, before);
  assert.equal(numberGuard(receipt.explanation, receipt).accepted, true);
  assert.throws(() => numberGuard('Scenario revenue is 999999999.', receipt), { code: 'UNGROUNDED_NUMBER' });
  const record = await f.retain('SYNTHETIC owner request: assume price change of 00500 basis points.', receipt);
  await f.reopen();
  assert.deepEqual(await f.engine.request('receipts.get', { id: receipt.id }), receipt);
  assert.deepEqual((await f.engine.request('conversation.get', { id: record.id })).answer, receipt);
  assert.equal(f.control.providerCalls, 0);
});

test('comparison negative ratio, zero denominator and overlap use the existing exact formula and unique lineage', async t => {
  const f = await fixture(t, [
    { id: 'prior', date: '2026-08-02', minor: '3' },
    { id: 'overlap', date: '2026-09-02', minor: '2' },
    { id: 'current-end', date: '2026-09-20', minor: '5' },
  ]);
  const small = { from: '2026-09-01', to: '2026-09-10' };
  assert.deepEqual(figures(await f.run('change', { period: small, comparePeriod: PRIOR })),
    { current: '2', previous: '3', change: '-1', changeBps: '-3333' });
  assert.deepEqual(figures(await f.run('change', { period: small, comparePeriod: { from: '2026-06-01', to: '2026-06-30' } })),
    { current: '2', previous: '0', change: '2' });
  const overlap = await f.run('change', { period: PERIOD, comparePeriod: { from: '2026-08-01', to: '2026-09-15' } });
  assert.deepEqual(figures(overlap), { current: '7', previous: '5', change: '2', changeBps: '4000' });
  assert.equal(overlap.rowIds.length, 3); assert.equal(new Set(overlap.rowIds).size, 3);
  assert.equal(overlap.coverage.selectedRows, 3); assert.equal(overlap.coverage.countedRows, 3);
});

test('negative and large scenario minor units and allowed range edges retain backend arithmetic', async t => {
  const f = await fixture(t, [
    { id: 'negative', date: '2026-09-02', minor: '-3' },
    { id: 'large', date: '2026-09-20', minor: '900719925474099391' },
  ]);
  const negativePeriod = { from: '2026-09-01', to: '2026-09-10' };
  assert.deepEqual(figures(await f.run('scenario', { period: negativePeriod, assumptions: { priceChangeBps: '1000' } })),
    { baseline: '-3', scenario: '-3', change: '0', priceChangeBps: '1000' });
  const largePeriod = { from: '2026-09-20', to: '2026-09-20' };
  assert.deepEqual(figures(await f.run('scenario', { period: largePeriod, assumptions: { priceChangeBps: '1000' } })),
    { baseline: '900719925474099391', scenario: '990791918021509330', change: '90071992547409939', priceChangeBps: '1000' });
  assert.equal((await f.run('scenario', { period: negativePeriod, assumptions: { priceChangeBps: '-10000' } })).totalMinor, '0');
  assert.equal((await f.run('scenario', { period: negativePeriod, assumptions: { priceChangeBps: '100000' } })).totalMinor, '-33');
});

test('a revoked reviewed source refuses both arithmetic and retained answer readback', async t => {
  const f = await fixture(t), parameters = { period: PERIOD, comparePeriod: PRIOR };
  const receipt = await f.run('change', parameters), record = await f.retain('SYNTHETIC current authorized comparison.', receipt);
  const count = f.engine.vault!.read().receipts.length;
  await f.engine.request('trust.update', { allowedSources: ['synthetic-B'] });
  await assert.rejects(f.run('change', parameters), { code: 'SOURCE_REVOKED' });
  await assert.rejects(f.engine.request('receipts.get', { id: receipt.id }), { code: 'SOURCE_REVOKED' });
  await assert.rejects(f.engine.request('conversation.get', { id: record.id }), { code: 'CONVERSATION_NOT_FOUND' });
  assert.equal(f.engine.vault!.read().receipts.length, count);
  assert.equal(f.control.providerCalls, 0);
});

test('published definition change withholds a retained comparison rather than recomputing history', async t => {
  const f = await fixture(t), receipt = await f.run('change', { period: PERIOD, comparePeriod: PRIOR });
  const record = await f.retain('SYNTHETIC retained comparison under original definitions.', receipt);
  const draft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  draft.definitions.find(definition => definition.name === 'earned')!.meaning = 'SYNTHETIC revised delivered revenue convention.';
  await f.engine.request('ontology.publish', { draft });
  await assert.rejects(f.engine.request('conversation.get', { id: record.id }), { code: 'CONVERSATION_NOT_FOUND' });
  assert.equal(f.engine.vault!.read().receipts.length, 1);
  assert.equal(f.control.providerCalls, 0);
});

test('actual public preview and single-use synthetic planner return and retain a missing-input clarification', async t => {
  const f = await fixture(t);
  const question = 'SYNTHETIC: compare revenue with an unspecified prior period.';
  f.control.wire = { kind: 'clarification', calls: [], clarification: conversationCalculationClarification('change', { period: PERIOD }) };
  const request = { question, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-parameters-route',
    sourceIds: ['synthetic-A'], period: PERIOD };
  const preview = await f.engine.request('models.preview', request);
  assert.equal(f.control.providerCalls, 0); assert.equal(preview.approvalRequired, true);
  await assert.rejects(f.engine.request('conversation.ask', { ...request, previewId: preview.id }), { code: 'OUTBOUND_APPROVAL_REQUIRED' });
  const approval = await f.engine.request('models.approve', { id: preview.id });
  const answer = await f.engine.request('conversation.ask', { ...request, previewId: preview.id, approvalId: approval.id });
  assert.equal(answer.clarification, 'Which comparison period should I use?');
  assert.equal(f.engine.vault!.read().receipts.length, 0);
  await assert.rejects(f.engine.request('conversation.ask', { ...request, previewId: preview.id, approvalId: approval.id }), { code: 'PREVIEW_NOT_FOUND' });
  const history = await f.engine.request('conversation.history');
  const record = history.items.find((item: { question: string }) => item.question === question);
  assert.ok(record);
  await f.reopen();
  assert.deepEqual((await f.engine.request('conversation.get', { id: record.id })).answer, answer);
  assert.equal(f.control.providerCalls, 1);
});

test('changed reviewed period and dictionary refuse at actual public approval boundary before synthetic provider entry', async t => {
  const f = await fixture(t), request = { question: 'SYNTHETIC revenue for the exact reviewed period.', purpose: 'conversation',
    questionDisclosure: 'verbatim', routeId: 'synthetic-parameters-route', sourceIds: ['synthetic-A'], period: PERIOD };
  const preview = await f.engine.request('models.preview', request), approval = await f.engine.request('models.approve', { id: preview.id });
  await assert.rejects(f.engine.request('conversation.ask', { ...request, period: PRIOR, previewId: preview.id, approvalId: approval.id }),
    { code: 'PREVIEW_REQUEST_CHANGED' });
  const draft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  draft.definitions.find(definition => definition.name === 'earned')!.meaning = 'SYNTHETIC changed meaning after exact approval.';
  await f.engine.request('ontology.publish', { draft });
  await assert.rejects(f.engine.request('conversation.ask', { ...request, previewId: preview.id, approvalId: approval.id }),
    { code: 'BUSINESS_CONTEXT_STALE' });
  assert.equal(f.control.providerCalls, 0); assert.equal(f.engine.vault!.read().receipts.length, 0);
});

test('an admitted calculator failure still retains an all-tool-error answer and reopens without another dispatch', async t => {
  const f = await fixture(t);
  await f.importRows('synthetic-linkless-invoice', [{ id: 'linkless', date: '2026-09-02', minor: '10000' }], '10000', 'invoice');
  f.control.wire = { kind: 'execute', calls: [{ tool: 'calculator.calculate',
    args: { operation: 'aging', period: PERIOD, branch: null, customerId: null } }], clarification: null };
  const request = { question: 'SYNTHETIC: age the invoice without required aging links.', purpose: 'conversation',
    questionDisclosure: 'verbatim', routeId: 'synthetic-parameters-route', sourceIds: ['synthetic-linkless-invoice'], period: PERIOD };
  const preview = await f.engine.request('models.preview', request), approval = await f.engine.request('models.approve', { id: preview.id });
  const answer = await f.engine.request('conversation.ask', { ...request, previewId: preview.id, approvalId: approval.id });
  assert.equal(answer.results[0].error.code, 'AGING_LINK_REQUIRED');
  assert.deepEqual(answer.receipt.resultRefs, []);
  assert.equal(f.engine.vault!.read().receipts.length, 0);
  await f.reopen();
  assert.deepEqual((await f.engine.request('conversation.get', { id: answer.id })).answer, answer);
  assert.equal(f.control.providerCalls, 1);
});
