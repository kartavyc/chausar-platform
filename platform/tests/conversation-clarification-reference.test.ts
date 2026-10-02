import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, initialState, newId, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { assertBusinessContextCurrent, type BusinessContextManifest } from '../runtime/conversation-context.ts';
import { ConversationHistoryService, conversationRecordIntegrity, createCalculationAnswerRecord } from '../runtime/conversation-history.ts';
import { ModelGateway } from '../runtime/gateway.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';

// Public gateway/history contracts with authored injected HTTP responses. No
// network, credentials, live provider, private history helpers or GUI is used.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const SOURCE = 'synthetic-clarification-reference-source';
const unavailable = (error: unknown) => error instanceof ChausarError && error.code === 'CONVERSATION_NOT_FOUND';
class MemoryStore implements StateStore {
  state = initialState('Synthetic clarification references', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
async function fixture(turn: 'clarification' | 'errors' = 'clarification') {
  const store = new MemoryStore(), trust = new TrustService(store);
  await new OntologyService(store).publish(OWNER, 'ecommerce');
  await new MemoryService(store).append(OWNER, [{
    entityId: 'synthetic-reference-invoice', sourceId: SOURCE, sourceRow: 1, kind: 'invoice', branch: 'main',
    validFrom: '2026-09-01', fields: { amountMinor: '10000', currency: 'INR', status: 'issued' },
  }]);
  await trust.updatePolicy(OWNER, { send: 'shape' });
  let dispatches = 0, modelReads = 0, receiptReads = 0, businessReads = 0;
  const wire = turn === 'clarification'
    ? { kind: 'clarification', calls: [], clarification: 'Which period should I use?' }
    : { kind: 'execute', clarification: null, calls: [{ tool: 'calculator.calculate',
      // A valid planner call reaches the real calculator's missing-link refusal.
      // Unreviewed comparison/scenario inputs correctly refuse before this boundary.
      args: { operation: 'aging', period: null, branch: null, customerId: null } }] };
  const gateway = new ModelGateway(store, { http: async request => {
    dispatches++;
    return { status: 200, endpoint: request.endpoint, body: JSON.stringify({ done: true, done_reason: 'stop',
      message: { content: JSON.stringify(wire) } }) };
  } });
  const route = await gateway.configureRoute(OWNER, { id: 'synthetic-reference-route', kind: 'ollama', model: 'synthetic-only',
    endpoint: 'http://127.0.0.1:11434/api/chat', budgetMinor: '0', maxCostMinor: '0' });
  const question = turn === 'clarification' ? '  Help me choose a view of this business.  ' : 'Age the unlinked invoices.';
  const request = { question, purpose: 'conversation' as const, questionDisclosure: 'verbatim' as const, routeId: route.id };
  const preview = await gateway.preview(OWNER, request), approval = await gateway.approveOutbound(OWNER, preview.id);
  const result = await gateway.execute(OWNER, { ...request, previewId: preview.id, approvalId: approval.id });
  assert.equal(result.kind, 'conversation');
  const model = gateway.assertConversationReceipt(OWNER, preview.id), id = newId('conversation_reference');
  let answer: any;
  if (result.plan.kind === 'clarification') answer = { clarification: result.plan.clarification, modelReceiptId: model.id };
  else {
    assert.equal(result.plan.calls.length, 1);
    const call = result.plan.calls[0]; assert.equal(call.tool, 'calculator.calculate');
    let refusal: { code: string; message: string } | undefined;
    try { await new CalculatorService(store).calculate(OWNER, call.args as { operation: string }); }
    catch (error) { assert.ok(error instanceof ChausarError); refusal = { code: error.code, message: error.message.slice(0, 512) }; }
    assert.ok(refusal); assert.equal(refusal.code, 'AGING_LINK_REQUIRED');
    answer = { id, kind: 'grounded-conversation', results: [{ tool: call.tool, error: refusal }], modelReceiptId: model.id,
      receipt: { id, kind: 'conversation-tool-receipt', modelReceiptId: model.id, resultRefs: [] } };
  }
  const rowIds = [...new Set<string>([...model.factIds, ...(model.rowIds ?? [])])].sort();
  const sourceIds = [...new Set<string>([...model.sourceIds,
    ...store.read().facts.filter(fact => rowIds.includes(fact.id)).map(fact => fact.sourceId)])].sort();
  const body = { id, kind: turn === 'clarification' ? 'conversation-clarification-answer' : 'conversation-tools-answer',
    at: now(), memberId: OWNER.memberId, epoch: OWNER.epoch, question, answer, modelReceiptId: model.id, sourceIds, rowIds,
    ...(turn === 'errors' ? { resultRefs: [] } : {}) };
  const record = { ...body, integrity: conversationRecordIntegrity(body) };
  await store.update(state => { state.conversations.push(record); });
  const history = new ConversationHistoryService(store, {
    assertBusinessContext: (ctx: Context, manifest: BusinessContextManifest, view: StateStore) => {
      businessReads++; return assertBusinessContextCurrent(view, ctx, manifest);
    },
    receipt: (ctx, receiptId, view) => { receiptReads++; return new CalculatorService(view).receipt(ctx, receiptId); },
    assertModelReceipt: (ctx, modelId, view) => { modelReads++; return gateway.assertConversationReceipt(ctx, modelId, view); },
  });
  return { store, trust, history, model, record, answer, approval,
    counts: () => ({ dispatches, modelReads, receiptReads, businessReads }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function refusedMutations(f: Fixture, mutations: ((state: State, record: any) => void)[], resign = false) {
  const original = f.store.read();
  for (const mutate of mutations) {
    await f.store.update(state => {
      Object.assign(state, structuredClone(original));
      const record = state.conversations.find(item => item.id === f.record.id); mutate(state, record);
      if (resign) record.integrity = conversationRecordIntegrity(record);
    });
    assert.throws(() => f.history.get(OWNER, f.model.id), unavailable);
    assert.equal(f.counts().dispatches, 1);
  }
}

test('retained ID and clarification model receipt alias return the same exact defensive copy without dispatch', async () => {
  const f = await fixture(), before = f.store.read();
  const expected = { id: f.record.id, at: f.record.at, question: f.record.question, kind: 'clarification', answer: f.answer };
  const direct = f.history.get(OWNER, f.record.id), alias = f.history.get(OWNER, f.model.id);
  assert.deepEqual(direct, expected); assert.deepEqual(alias, expected);
  assert.notEqual(alias.id, f.model.id); assert.equal(alias.question, '  Help me choose a view of this business.  ');
  alias.answer.clarification = 'Changed returned copy'; alias.question = 'Changed returned question';
  assert.deepEqual(direct, expected); assert.deepEqual(f.history.get(OWNER, f.model.id), expected);
  assert.deepEqual(f.store.read(), before); assert.deepEqual(f.counts(), { dispatches: 1, modelReads: 3, receiptReads: 0, businessReads: 0 });
});

test('two clarifications sharing a model receipt reject canonical and alias reads before admission', async () => {
  const f = await fixture(), duplicate = { ...structuredClone(f.record), id: newId('conversation_reference') };
  duplicate.integrity = conversationRecordIntegrity(duplicate);
  await f.store.update(state => { state.conversations.push(duplicate); });
  const before = f.counts();
  for (const id of [f.record.id, duplicate.id, f.model.id]) assert.throws(() => f.history.get(OWNER, id), unavailable);
  assert.deepEqual(f.counts(), before);
});

test('foreign or corrupt duplicate aliases cannot be discarded to expose a surviving valid clarification', async () => {
  const f = await fixture(), original = f.store.read();
  for (const variant of ['foreign', 'corrupt', 'duplicate-id']) {
    await f.store.update(state => {
      Object.assign(state, structuredClone(original));
      const duplicate = { ...structuredClone(f.record), id: variant === 'duplicate-id' ? f.record.id : newId('conversation_reference') };
      if (variant === 'foreign') duplicate.memberId = 'foreign-author';
      duplicate.integrity = variant === 'corrupt' ? 'altered' : conversationRecordIntegrity(duplicate);
      state.conversations.push(duplicate);
    });
    const before = f.counts();
    assert.throws(() => f.history.get(OWNER, f.record.id), unavailable);
    assert.throws(() => f.history.get(OWNER, f.model.id), unavailable);
    assert.deepEqual(f.counts(), before, variant);
  }
});

test('collision between a clarification alias and a valid calculation record ID rejects before either admission', async () => {
  const f = await fixture(), calculator = new CalculatorService(f.store);
  const receipt = await calculator.calculate(OWNER, { operation: 'billed' });
  const answer = { supported: true, message: receipt.explanation, receipt };
  const collision = createCalculationAnswerRecord(OWNER, 'What was billed?', answer, receipt);
  collision.id = f.model.id; collision.integrity = conversationRecordIntegrity(collision);
  await f.store.update(state => { state.conversations.push(collision); });
  const before = f.counts();
  assert.throws(() => f.history.get(OWNER, f.record.id), unavailable);
  assert.throws(() => f.history.get(OWNER, f.model.id), unavailable);
  assert.deepEqual(f.counts(), before);
});

test('clarification alias rejects foreign author, stale epoch and missing or altered integrity', async () => {
  const f = await fixture();
  await refusedMutations(f, [
    (_state, record) => { record.memberId = 'foreign-author'; record.integrity = conversationRecordIntegrity(record); },
    (_state, record) => { record.epoch = 2; record.integrity = conversationRecordIntegrity(record); },
    (_state, record) => { delete record.integrity; },
    (_state, record) => { record.integrity = 'altered'; },
  ]);
});

test('clarification alias still binds the exact answer, natural wording and source lineage after recomputed integrity', async () => {
  const f = await fixture();
  await refusedMutations(f, [
    (_state, record) => { record.answer.clarification = 'Which branch should I use?'; },
    (_state, record) => { record.answer.modelReceiptId = 'another-model'; },
    (_state, record) => { record.answer.amountMinor = '10000'; },
    (_state, record) => { record.question = record.question.trim(); },
    (_state, record) => { record.sourceIds = []; },
    (_state, record) => { record.rowIds = []; },
  ], true);
});

test('clarification alias checks record, completed model and fact retention before cleanup', async () => {
  const f = await fixture(), expired = new Date(Date.now() - 100 * 86400000).toISOString();
  await refusedMutations(f, [
    (_state, record) => { record.at = expired; },
    state => { state.modelReceipts.find(item => item.id === f.model.id).createdAt = expired; },
    state => { state.modelReceipts.find(item => item.id === f.model.id).completedAt = expired; },
    state => { state.facts[0].learnedAt = expired; },
  ], true);
});

test('clarification alias refuses changed or revoked policy, route, source, fact and completed model authority', async () => {
  const f = await fixture();
  await refusedMutations(f, [
    state => { state.policy.send = 'nothing'; },
    state => { state.policy.allowedSources = ['another-source']; },
    state => { state.routes[0].enabled = false; },
    state => { state.routes[0].revision++; },
    state => { state.sourceRules.push({ sourceId: SOURCE, revoked: true }); },
    state => { state.facts[0].fields.amountMinor = '20000'; },
    state => { state.facts[0].deletedAt = now(); },
    state => { state.modelReceipts.find(item => item.id === f.model.id).status = 'failed'; },
    state => { state.modelReceipts.find(item => item.id === f.approval.id).used = false; },
  ]);
});

test('source deletion removes both direct and model receipt clarification references without redispatch', async () => {
  const f = await fixture(); await f.trust.deleteSource(OWNER, SOURCE);
  assert.throws(() => f.history.get(OWNER, f.record.id), unavailable);
  assert.throws(() => f.history.get(OWNER, f.model.id), unavailable);
  assert.deepEqual(f.counts(), { dispatches: 1, modelReads: 0, receiptReads: 0, businessReads: 0 });
});

test('revoked caller cannot use the clarification model receipt alias', async () => {
  const f = await fixture(); await f.store.update(state => { state.members.find(member => member.id === OWNER.memberId)!.active = false; });
  assert.throws(() => f.history.get(OWNER, f.model.id), (error: unknown) => error instanceof ChausarError && error.code === 'ACCESS_REVOKED');
  assert.deepEqual(f.counts(), { dispatches: 1, modelReads: 0, receiptReads: 0, businessReads: 0 });
});

test('a valid nonclarification completed turn remains readable by record ID but has no model receipt alias', async () => {
  const f = await fixture('errors');
  assert.deepEqual(f.history.get(OWNER, f.record.id).answer, f.answer);
  const before = f.counts(); assert.throws(() => f.history.get(OWNER, f.model.id), unavailable);
  assert.deepEqual(f.counts(), before);
});
