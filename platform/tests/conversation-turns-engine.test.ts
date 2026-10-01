import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { conversationRecordIntegrity } from '../runtime/conversation-history.ts';

// Authored synthetic HTTP/records only; no CLI, provider, network, or operator vault.
const PASSWORD = 'synthetic-turn-fixture-passphrase';
const ENDPOINT = 'https://synthetic-turn-provider.invalid/v1/responses';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const calculatorCall = (operation = 'billed') => ({ tool: 'calculator.calculate',
  args: { operation, period: PERIOD, branch: null, customerId: null } });
const execution = (operation = 'billed') => ({ kind: 'execute', calls: [calculatorCall(operation)], clarification: null });
const clarification = { kind: 'clarification', calls: [], clarification: 'Which period should I use?' };

async function fixture(t: TestContext, plan: any = execution()) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-conversation-turns-'));
  let providerCalls = 0;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: {
    http: async () => { providerCalls++; return { status: 200, endpoint: ENDPOINT,
      body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(plan) }] }] }) }; },
  } });
  t.after(async () => {
    await engine.close();
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(target.toLowerCase().startsWith(join(resolve(tmpdir()), 'chausar-conversation-turns-').toLowerCase()));
    await rm(target, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic turn fixture', folder: 'test', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  for (const [sourceId, amount] of [['source-a', '100.00'], ['source-b', '200.00']]) {
    await engine.request('sources.import', { sourceId, format: 'csv',
      content: `id,kind,date,amount,currency,branch,status\n${sourceId}-invoice,invoice,2026-09-02,${amount},INR,main,issued`,
      expectedTotals: { rowCount: 1, amountMinor: sourceId === 'source-a' ? '10000' : '20000' },
      recipe: { version: 1, id: `synthetic-${sourceId}-map`, system: 'synthetic-csv', edition: '1',
        scope: { company: 'Synthetic turn fixture', branches: ['main'] }, bindings: [
          { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
          { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
          { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
          { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
          ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
        ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  }
  await engine.request('models.configure', { config: { id: 'synthetic-turn-route', kind: 'openai-responses', model: 'synthetic-turn-model',
    endpoint: ENDPOINT, budgetMinor: '10000', maxCostMinor: '1' }, secret: 'synthetic-only-fixture' });
  await engine.request('trust.update', { send: 'shape' });
  async function turn(question: string, sourceIds?: string[], scope: Record<string, unknown> = {}) {
    const request = { question, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-turn-route',
      ...(sourceIds !== undefined ? { sourceIds } : {}), ...scope };
    const preview = await engine.request('models.preview', request), approval = await engine.request('models.approve', { id: preview.id });
    const answer = await engine.request('conversation.ask', { ...request, previewId: preview.id, approvalId: approval.id });
    return { preview, answer };
  }
  async function reopen() { await engine.request('workspace.lock'); await engine.request('workspace.open', { folder: 'test', passphrase: PASSWORD }); }
  return { engine, directory, turn, reopen, get providerCalls() { return providerCalls; } };
}

test('public reviewed calculation counts selected A before arithmetic and preserves its receipt after encrypted reopen', async t => {
  const f = await fixture(t), { answer } = await f.turn('What was billed for the selected source?', ['source-a']);
  const result = answer.results[0];
  assert.equal(result.error, undefined); assert.equal(result.answer.totalMinor, '10000');
  assert.deepEqual(result.answer.requestedSourceIds, ['source-a']);
  assert.deepEqual(result.answer.sourceIds, ['source-a']); assert.equal(result.answer.rowIds.length, 1);
  assert.equal(f.providerCalls, 1);
  await f.reopen();
  assert.deepEqual(await f.engine.request('receipts.get', { id: result.answer.id }), result.answer);
  assert.deepEqual((await f.engine.request('conversation.get', { id: answer.id })).answer, answer);
  assert.equal(f.providerCalls, 1);
});

test('an explicitly empty reviewed source scope does not widen to all imported facts', async t => {
  const f = await fixture(t), { answer } = await f.turn('Calculate only the empty selected scope.', []);
  assert.equal(answer.results[0].error, undefined); assert.equal(answer.results[0].answer.totalMinor, '0');
  assert.deepEqual(answer.results[0].answer.requestedSourceIds, []); assert.deepEqual(answer.results[0].answer.rowIds, []);
});

test('unselected unpublished connector capture cannot block selected local evidence; selecting it still refuses', async t => {
  const f = await fixture(t);
  // Deliberately incomplete synthetic acquisition record. It must never be qualified.
  await f.engine.vault!.update(state => { state.imports.push({ id: 'synthetic-unready-capture', type: 'connector-capture-v1',
    sourceId: 'source-b', domain: { company: 'Synthetic turn fixture', dataset: 'invoice', branches: ['main'], period: PERIOD } }); });
  const { answer } = await f.turn('What was billed from A only?', ['source-a']);
  assert.equal(answer.results[0].answer.totalMinor, '10000');
  assert.equal((await f.engine.request('receipts.get', { id: answer.results[0].answer.id })).totalMinor, '10000');
  await assert.rejects(f.turn('What was billed from unready B?', ['source-b']));
});

test('all-tool-error composite is signed and stored with empty resultRefs through close/reopen', async t => {
  const f = await fixture(t, execution('change')), { answer, preview } = await f.turn('Compare without prior dates.');
  assert.equal(answer.results[0].error.code, 'COMPARISON_REQUIRED'); assert.deepEqual(answer.receipt.resultRefs, []);
  assert.equal(f.engine.vault!.read().conversations.filter(record => record.id === answer.id).length, 1);
  await f.reopen();
  const record = f.engine.vault!.read().conversations.find(record => record.id === answer.id);
  assert.deepEqual(record.answer, answer); assert.equal(record.modelReceiptId, preview.id);
  assert.equal(record.integrity, conversationRecordIntegrity(record));
  assert.deepEqual(record.sourceIds, ['source-a', 'source-b']); assert.equal(record.rowIds.length, 2);
  assert.equal(f.providerCalls, 1);
  // Public history admission is owned by the independent history/renderer patch.
});

test('clarification retains verbatim objective and current guarded continuation after encrypted reopen without dispatch', async t => {
  const f = await fixture(t, clarification), question = '  What was billed for this business?  ';
  const { answer } = await f.turn(question, ['source-a']);
  assert.equal(answer.clarification, clarification.clarification);
  await f.reopen();
  const record = f.engine.vault!.read().conversations.find(record => record.modelReceiptId === answer.modelReceiptId);
  assert.equal(record.question, question); assert.deepEqual(record.answer, answer);
  assert.equal(record.integrity, conversationRecordIntegrity(record));
  const continuation = f.engine.conversationContinuation(f.engine.context, record.id);
  assert.equal(continuation.originalQuestion, question); assert.equal(continuation.clarification, clarification.clarification);
  assert.deepEqual(continuation.sourceIds, ['source-a']); assert.deepEqual(continuation.requestScope.sourceIds, ['source-a']);
  assert.equal(f.providerCalls, 1);
  const ciphertext = await readFile(join(f.directory, 'test', 'authority.encrypted.json'), 'utf8');
  assert.equal(ciphertext.includes(question), false); assert.equal(ciphertext.includes(clarification.clarification), false);
});

test('pending clarification refuses revoked current source authority without provider invocation', async t => {
  const f = await fixture(t, clarification), { answer } = await f.turn('Which billing period?', ['source-a']);
  const id = f.engine.vault!.read().conversations.find(record => record.modelReceiptId === answer.modelReceiptId).id;
  await f.engine.request('trust.update', { allowedSources: ['source-b'] });
  assert.throws(() => f.engine.conversationContinuation(f.engine.context, id));
  assert.equal(f.providerCalls, 1);
});

test('pending clarification refuses tampering and expired retained objective before a preview or transfer', async t => {
  const f = await fixture(t, clarification), { answer } = await f.turn('Retain this exact objective.', ['source-a']);
  const saved = f.engine.vault!.read().conversations.find(record => record.modelReceiptId === answer.modelReceiptId), id = saved.id;
  await f.engine.vault!.update(state => { state.conversations.find(record => record.id === id).question = 'Altered objective'; });
  assert.throws(() => f.engine.conversationContinuation(f.engine.context, id), { code: 'CONVERSATION_CONTINUATION_UNAVAILABLE' });
  await f.engine.vault!.update(state => {
    const expired = { ...saved, at: new Date(Date.now() - 400 * 86400000).toISOString() };
    expired.integrity = conversationRecordIntegrity(expired); state.conversations = state.conversations.map(record => record.id === id ? expired : record);
  });
  assert.throws(() => f.engine.conversationContinuation(f.engine.context, id), { code: 'CONVERSATION_CONTINUATION_UNAVAILABLE' });
  assert.equal(f.providerCalls, 1);
});

test('pending continuation rejects duplicate model receipts rather than choosing the first match', async t => {
  const f = await fixture(t, clarification), { answer } = await f.turn('Retain one current pending turn.', ['source-a']);
  const id = f.engine.vault!.read().conversations.find(record => record.modelReceiptId === answer.modelReceiptId).id;
  await f.engine.vault!.update(state => { state.modelReceipts.push(structuredClone(state.modelReceipts.find(record => record.id === answer.modelReceiptId))); });
  assert.throws(() => f.engine.conversationContinuation(f.engine.context, id), { code: 'CONVERSATION_CONTINUATION_UNAVAILABLE' });
  assert.equal(f.providerCalls, 1);
});

test('pending continuation uses the hash-validated manifest scope instead of mutable model request metadata', async t => {
  const f = await fixture(t, clarification), { answer } = await f.turn('Retain the selected billing scope.', ['source-a'], { period: PERIOD });
  const id = f.engine.vault!.read().conversations.find(record => record.modelReceiptId === answer.modelReceiptId).id;
  await f.engine.vault!.update(state => {
    state.modelReceipts.find(record => record.id === answer.modelReceiptId).requestScope.period = { from: '2026-08-01', to: '2026-08-31' };
  });
  assert.deepEqual(f.engine.conversationContinuation(f.engine.context, id).requestScope.period, PERIOD);
  assert.equal(f.providerCalls, 1);
});
