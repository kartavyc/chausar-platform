import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, initialState, newId, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { assertBusinessContextCurrent } from '../runtime/conversation-context.ts';
import { ConversationHistoryService, conversationRecordIntegrity } from '../runtime/conversation-history.ts';
import { ModelGateway } from '../runtime/gateway.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';

// Authored synthetic turns use the public gateway and calculator with an injected
// HTTP port. No network, credentials, provider inference, process or GUI is used.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const SOURCE = 'synthetic-turn-history-source';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
type Turn = 'clarification' | 'errors';
class MemoryStore implements StateStore {
  state = initialState('Synthetic retained conversation turns', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
async function fixture(turn: Turn, withFacts = true) {
  const store = new MemoryStore(), trust = new TrustService(store);
  await new OntologyService(store).publish(OWNER, 'ecommerce');
  if (withFacts) await new MemoryService(store).append(OWNER, [{
    entityId: 'synthetic-turn-invoice', sourceId: SOURCE, sourceRow: 1, kind: 'invoice', branch: 'main',
    validFrom: '2026-09-01', fields: { amountMinor: '10000', currency: 'INR', status: 'issued' },
  }]);
  await trust.updatePolicy(OWNER, { send: 'shape' });
  let dispatches = 0, receiptReads = 0;
  const wire = turn === 'clarification' ? { kind: 'clarification', calls: [], clarification: 'Which period should I use?' }
    : { kind: 'execute', clarification: null, calls: ['change', 'scenario'].map(operation => ({
      tool: 'calculator.calculate', args: { operation, period: null, branch: null, customerId: null },
    })) };
  const gateway = new ModelGateway(store, { http: async request => {
    dispatches++;
    return { status: 200, endpoint: request.endpoint, body: JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(wire) } }) };
  } });
  const route = await gateway.configureRoute(OWNER, { id: 'synthetic-turn-history-route', kind: 'ollama', model: 'synthetic',
    endpoint: 'http://127.0.0.1:11434/api/chat', budgetMinor: '0', maxCostMinor: '0' });
  const question = turn === 'clarification' ? '  Help me choose a view of this business.  ' : 'Compare its billed change and assess a price scenario.';
  const request = { question, purpose: 'conversation' as const, questionDisclosure: 'verbatim' as const, routeId: route.id };
  const preview = await gateway.preview(OWNER, request), approval = await gateway.approveOutbound(OWNER, preview.id);
  const result = await gateway.execute(OWNER, { ...request, previewId: preview.id, approvalId: approval.id });
  assert.equal(result.kind, 'conversation');
  const model = gateway.assertConversationReceipt(OWNER, preview.id), id = newId('conversation_turn');
  let answer: any;
  if (result.plan.kind === 'clarification') answer = { clarification: result.plan.clarification, modelReceiptId: model.id };
  else {
    const results: any[] = [], calculator = new CalculatorService(store);
    for (const call of result.plan.calls) {
      assert.equal(call.tool, 'calculator.calculate');
      try { await calculator.calculate(OWNER, call.args as { operation: string }); assert.fail('This authored calculation needs missing parameters.'); }
      catch (error) {
        assert.ok(error instanceof ChausarError);
        results.push({ tool: call.tool, error: { code: error.code, message: error.message.slice(0, 512) } });
      }
    }
    answer = { id, kind: 'grounded-conversation', results, modelReceiptId: model.id,
      receipt: { id, kind: 'conversation-tool-receipt', modelReceiptId: model.id, resultRefs: [] } };
  }
  const rowIds = [...new Set<string>([...model.factIds, ...(model.rowIds ?? [])])].sort();
  const sourceIds = [...new Set<string>([...model.sourceIds, ...store.read().facts.filter(fact => rowIds.includes(fact.id)).map(fact => fact.sourceId)])].sort();
  const body = { id, kind: turn === 'clarification' ? 'conversation-clarification-answer' : 'conversation-tools-answer',
    at: now(), memberId: OWNER.memberId, epoch: OWNER.epoch, question, answer, modelReceiptId: model.id, sourceIds, rowIds,
    ...(turn === 'errors' ? { resultRefs: [] } : {}) };
  const record = { ...body, integrity: conversationRecordIntegrity(body) };
  await store.update(state => { state.conversations.push(record); });
  const guards = {
    assertBusinessContext: (ctx: Context, manifest: Parameters<typeof assertBusinessContextCurrent>[2], view: StateStore) => assertBusinessContextCurrent(view, ctx, manifest),
    receipt: (ctx: Context, receiptId: string, view: StateStore) => { receiptReads++; return new CalculatorService(view).receipt(ctx, receiptId); },
  };
  const history = new ConversationHistoryService(store, { ...guards,
    assertModelReceipt: (ctx, modelId, view) => gateway.assertConversationReceipt(ctx, modelId, view) });
  return { store, trust, gateway, guards, history, model, approval, record, answer,
    counts: () => ({ dispatches, receiptReads }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function refused(f: Fixture) {
  assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
  assert.equal(f.history.list(OWNER).items.some(item => item.id === f.record.id), false);
}
async function changes(f: Fixture, mutations: ((state: State, record: any) => void)[], resign = false) {
  const original = f.store.read();
  for (const mutate of mutations) {
    await f.store.update(state => {
      Object.assign(state, structuredClone(original));
      const record = state.conversations.find(item => item.id === f.record.id);
      mutate(state, record);
      if (resign) record.integrity = conversationRecordIntegrity(record);
    });
    refused(f);
  }
}

test('clarification history reopens the exact completed plan and original wording without new dispatch', async () => {
  const f = await fixture('clarification'), before = f.store.read();
  assert.deepEqual(f.history.get(OWNER, f.record.id), { id: f.record.id, at: f.record.at,
    question: f.record.question, kind: 'clarification', answer: f.answer });
  assert.deepEqual(f.history.list(OWNER).items, [{ id: f.record.id, at: f.record.at, question: f.record.question,
    kind: 'clarification', receiptId: f.model.id }]);
  const copy = f.history.get(OWNER, f.record.id); copy.answer.clarification = 'Changed returned copy';
  assert.deepEqual(f.history.get(OWNER, f.record.id).answer, f.answer);
  assert.deepEqual(f.store.read(), before); assert.deepEqual(f.counts(), { dispatches: 1, receiptReads: 0 });
});

test('all-tool-error history retains actual calculator refusals with no child receipts or recalculation', async () => {
  const f = await fixture('errors'), before = f.store.read();
  assert.deepEqual(f.answer.results.map((result: any) => result.error.code), ['COMPARISON_REQUIRED', 'SCENARIO_REQUIRED']);
  assert.deepEqual(f.history.get(OWNER, f.record.id).answer, f.answer);
  assert.equal(f.history.get(OWNER, f.record.id).kind, 'grounded-conversation');
  assert.equal(f.history.list(OWNER).items[0].receiptId, f.record.id);
  assert.deepEqual(f.answer.receipt.resultRefs, []); assert.equal(before.receipts.length, 0);
  assert.deepEqual(f.store.read(), before); assert.deepEqual(f.counts(), { dispatches: 1, receiptReads: 0 });
});

test('empty-evidence clarification and error turns still require the installed current model guard', async () => {
  for (const turn of ['clarification', 'errors'] as const) {
    const f = await fixture(turn, false);
    assert.deepEqual(f.record.rowIds, []); assert.deepEqual(f.record.sourceIds, []);
    assert.deepEqual(f.history.get(OWNER, f.record.id).answer, f.answer);
    const unguarded = new ConversationHistoryService(f.store, f.guards);
    assert.throws(() => unguarded.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
    assert.deepEqual(unguarded.list(OWNER).items, []);
  }
});

test('turn integrity, unique identity and exact author and epoch are mandatory', async () => {
  for (const turn of ['clarification', 'errors'] as const) {
    const f = await fixture(turn);
    await changes(f, [
      (_state, record) => { record.integrity = 'altered'; },
      (_state, record) => { delete record.integrity; },
      (_state, record) => { record.memberId = 'foreign-author'; record.integrity = conversationRecordIntegrity(record); },
      (_state, record) => { record.epoch = 2; record.integrity = conversationRecordIntegrity(record); },
      (state, record) => { state.conversations.push(structuredClone(record)); },
      (_state, record) => { record.answer.modelReceiptId = 'foreign-model'; },
    ]);
  }
});

test('clarification rejects altered text, request bindings, evidence roots and extra fields even with recomputed integrity', async () => {
  const f = await fixture('clarification');
  await changes(f, [
    (_state, record) => { record.answer.clarification = 'Which branch should I use?'; },
    (_state, record) => { record.answer.amountMinor = '10000'; },
    (_state, record) => { record.question = record.question.trim(); },
    (_state, record) => { record.rowIds = []; },
    (_state, record) => { record.sourceIds = []; },
    (_state, record) => { record.modelReceiptId = 'another-model'; },
    (_state, record) => { record.rawSource = 'Injected private field'; },
  ], true);
});

test('zero-child composites admit only complete ordered typed errors under their exact execute plan', async () => {
  const f = await fixture('errors');
  await changes(f, [
    (_state, record) => { record.answer.results[0] = { tool: 'calculator.calculate', answer: { totalMinor: '10000' } }; },
    (_state, record) => { record.answer.results = []; },
    (_state, record) => { record.answer.results.pop(); },
    (_state, record) => { record.answer.results[0].tool = 'business.describe'; },
    (_state, record) => { record.answer.results[0].error.extra = 'Undeclared'; },
    (_state, record) => { record.answer.results[0].error.code = 'untyped refusal'; },
    (_state, record) => { record.answer.results[0].error.message = ''; },
    (_state, record) => { record.resultRefs = [{ tool: 'calculator.calculate', answerId: 'missing-child' }]; record.answer.receipt.resultRefs = structuredClone(record.resultRefs); },
    (_state, record) => { record.rowIds = []; },
    (_state, record) => { record.sourceIds.push('unreviewed-source'); },
    (_state, record) => { record.kind = 'conversation-clarification-answer'; delete record.resultRefs; },
  ], true);
});

test('completed turn reads refuse revoked or changed route, policy, source, fact and model authority', async () => {
  for (const turn of ['clarification', 'errors'] as const) {
    const f = await fixture(turn);
    await changes(f, [
      state => { state.policy.send = 'nothing'; },
      state => { state.policy.allowedSources = ['another-source']; },
      state => { state.routes[0].enabled = false; },
      state => { state.routes[0].revision++; },
      state => { state.facts[0].fields.amountMinor = '20000'; },
      state => { state.sourceRules.push({ sourceId: SOURCE, revoked: true }); },
      state => { state.modelReceipts.find(item => item.id === f.model.id).status = 'failed'; },
      state => { state.modelReceipts.push(structuredClone(f.model)); },
      state => { state.modelReceipts.find(item => item.id === f.approval.id).used = false; },
      state => { state.modelReceipts.find(item => item.id === f.approval.id).approverEpoch = 2; },
    ]);
  }
});

test('record, completed model and fact retention guard every retained turn before cleanup', async () => {
  const expired = new Date(Date.now() - 100 * 86400000).toISOString();
  for (const turn of ['clarification', 'errors'] as const) {
    const f = await fixture(turn);
    await changes(f, [
      (_state, record) => { record.at = expired; },
      state => { state.modelReceipts.find(item => item.id === f.model.id).createdAt = expired; },
      state => { state.modelReceipts.find(item => item.id === f.model.id).completedAt = expired; },
      state => { state.facts[0].learnedAt = expired; },
    ], true);
  }
});

test('revoked caller authority cannot list or read either retained turn kind', async () => {
  for (const turn of ['clarification', 'errors'] as const) {
    const f = await fixture(turn);
    await f.store.update(state => { state.members.find(member => member.id === OWNER.memberId)!.active = false; });
    assert.throws(() => f.history.list(OWNER), code('ACCESS_REVOKED'));
    assert.throws(() => f.history.get(OWNER, f.record.id), code('ACCESS_REVOKED'));
  }
});

test('actual source deletion purges clarification and all-tool-error lineage records', async () => {
  for (const turn of ['clarification', 'errors'] as const) {
    const f = await fixture(turn);
    await f.trust.deleteSource(OWNER, SOURCE);
    assert.equal(f.store.read().conversations.some(item => item.id === f.record.id), false);
    refused(f); assert.deepEqual(f.counts(), { dispatches: 1, receiptReads: 0 });
  }
});
