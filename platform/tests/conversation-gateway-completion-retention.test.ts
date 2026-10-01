import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway, type ModelRequest, type RouteKind } from '../runtime/gateway.ts';

// Authored synthetic fixtures only: injected HTTP never reaches a provider,
// native process or network. The compatible credential is a fixture label.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const COMPATIBLE_ENDPOINT = 'https://synthetic-provider.example.test/v1/chat/completions';
const START = Date.parse('2026-10-01T09:00:00.000Z');
const DAY = 86400000;
const wirePlan = () => ({ kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
  operation: 'billed', period: null, branch: null, customerId: null,
} }], clarification: null });
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;

class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC GATEWAY CONTRACT WORKSPACE', true);
  constructor() { this.state.policy.send = 'shape'; this.state.policy.retentionDays = 1; }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}

function providerBody(kind: RouteKind, extra: Record<string, unknown> = {}, messageExtra: Record<string, unknown> = {}) {
  const message = { role: 'assistant', content: JSON.stringify(wirePlan()), ...messageExtra };
  return kind === 'ollama' ? { message, ...extra } : { choices: [{ message, ...extra }] };
}

async function fixture(kind: 'ollama' | 'openai-compatible', body: unknown) {
  const store = new MemoryStore(); let dispatches = 0;
  const endpoint = kind === 'ollama' ? OLLAMA_ENDPOINT : COMPATIBLE_ENDPOINT;
  const gateway = new ModelGateway(store, { http: async request => {
    dispatches++; assert.equal(request.endpoint, endpoint);
    return { status: 200, endpoint, body: JSON.stringify(body) };
  } });
  await gateway.configureRoute(owner, { id: 'synthetic-route', kind, model: 'synthetic-conversation-model', endpoint },
    kind === 'openai-compatible' ? 'synthetic fixture credential' : undefined);
  const input: ModelRequest = { question: 'Please calculate what was billed.', purpose: 'conversation',
    questionDisclosure: 'verbatim', routeId: 'synthetic-route' };
  const preview = await gateway.preview(owner, input), approval = await gateway.approveOutbound(owner, preview.id);
  const execute = () => gateway.execute(owner, { ...input, previewId: preview.id, approvalId: approval.id });
  return { store, gateway, input, preview, approval, execute, dispatches: () => dispatches };
}

for (const [label, kind, extra, messageExtra, expected] of [
  ['Ollama explicit unfinished response', 'ollama', { done: false, done_reason: 'length' }, {}, 'MODEL_INCOMPLETE'],
  ['Ollama incomplete flag without reason', 'ollama', { done: false }, {}, 'MODEL_INCOMPLETE'],
  ['Ollama completed flag with length stop', 'ollama', { done: true, done_reason: 'length' }, {}, 'MODEL_INCOMPLETE'],
  ['Ollama unsupported completion reason', 'ollama', { done: true, done_reason: 'cancelled' }, {}, 'MODEL_INCOMPLETE'],
  ['Ollama provider error with valid plan', 'ollama', { done: true, error: 'Synthetic provider failure' }, {}, 'MODEL_FAILED'],
  ['Ollama refusal with valid plan', 'ollama', { done: true }, { refusal: 'Synthetic provider refusal' }, 'MODEL_REFUSAL'],
  ['compatible-chat length stop', 'openai-compatible', { finish_reason: 'length' }, {}, 'MODEL_INCOMPLETE'],
  ['compatible-chat unsupported completion reason', 'openai-compatible', { finish_reason: 'cancelled' }, {}, 'MODEL_INCOMPLETE'],
  ['compatible-chat filtered output', 'openai-compatible', { finish_reason: 'content_filter' }, {}, 'MODEL_REFUSAL'],
  ['compatible-chat refusal with valid plan', 'openai-compatible', { finish_reason: 'stop' }, { refusal: 'Synthetic provider refusal' }, 'MODEL_REFUSAL'],
] as const) {
  test(`gateway completion: ${label} never admits the syntactically valid tool plan`, async () => {
    const run = await fixture(kind, providerBody(kind, extra, messageExtra));
    await assert.rejects(run.execute(), code(expected));
    assert.equal(run.dispatches(), 1);
    const record = run.store.state.modelReceipts.find(item => item.id === run.preview.id);
    assert.equal(record.status, 'failed'); assert.equal(record.errorCode, expected); assert.equal(record.attempts, 1);
    assert.equal(record.plan, undefined); assert.equal(record.conversationPlanWire, undefined);
    assert.deepEqual(run.store.state.receipts, []); assert.deepEqual(run.store.state.answers, []);
    await assert.rejects(run.execute(), code('PREVIEW_NOT_FOUND'));
    assert.equal(run.dispatches(), 1);
  });
}

test('gateway completion: compatible-chat provider error never admits a valid plan or retries', async () => {
  const body = { ...providerBody('openai-compatible', { finish_reason: 'stop' }), error: { message: 'Synthetic provider failure' } };
  const run = await fixture('openai-compatible', body);
  await assert.rejects(run.execute(), code('MODEL_FAILED'));
  const record = run.store.state.modelReceipts.find(item => item.id === run.preview.id);
  assert.equal(record.status, 'failed'); assert.equal(record.errorCode, 'MODEL_FAILED'); assert.equal(record.attempts, 1);
  assert.equal(record.plan, undefined); assert.equal(run.dispatches(), 1);
  await assert.rejects(run.execute(), code('PREVIEW_NOT_FOUND')); assert.equal(run.dispatches(), 1);
});

for (const [label, kind, extra] of [
  ['Ollama completed stop', 'ollama', { done: true, done_reason: 'stop' }],
  ['compatible-chat completed stop', 'openai-compatible', { finish_reason: 'stop' }],
  ['legacy Ollama omitted completion fields', 'ollama', {}],
  ['legacy compatible-chat omitted completion fields', 'openai-compatible', {}],
] as const) {
  test(`gateway completion: ${label} admits one registered plan`, async () => {
    const run = await fixture(kind, providerBody(kind, extra));
    const result = await run.execute();
    assert.equal(result.kind, 'conversation'); assert.equal(result.receipt.status, 'completed');
    assert.equal(result.receipt.attempts, 1); assert.equal(run.dispatches(), 1);
    assert.deepEqual(result.plan, { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: { operation: 'billed' } }], clarification: null });
    assert.equal(run.gateway.assertConversationReceipt(owner, run.preview.id).status, 'completed');
    await assert.rejects(run.execute(), code('PREVIEW_NOT_FOUND')); assert.equal(run.dispatches(), 1);
  });
}

test('gateway retention: zero-fact exact question and payload expire on read without cleanup, while recent records remain', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const run = await fixture('ollama', providerBody('ollama', { done: true, done_reason: 'stop' }));
  assert.deepEqual(run.preview.factIds, []); assert.deepEqual(run.preview.sourceIds, []);
  assert.equal(run.gateway.receipts(owner).find(item => item.id === run.preview.id).naturalQuestion, run.input.question);
  t.mock.timers.setTime(START + DAY - 1);
  assert.ok(run.gateway.receipts(owner).some(item => item.id === run.preview.id));
  assert.ok(run.gateway.receipts(owner).some(item => item.id === run.approval.id));
  t.mock.timers.setTime(START + DAY + 1);
  const fresh = await run.gateway.preview(owner, { ...run.input, question: 'A recent synthetic question.' });
  const freshApproval = await run.gateway.approveOutbound(owner, fresh.id);
  const available = run.gateway.receipts(owner);
  assert.equal(available.some(item => item.id === run.preview.id), false);
  assert.equal(available.some(item => item.id === run.approval.id), false);
  assert.ok(available.some(item => item.id === fresh.id && item.payload === fresh.payload && item.naturalQuestion === 'A recent synthetic question.'));
  assert.ok(available.some(item => item.id === freshApproval.id));
  // No cleanup or tombstone mutation was required to enforce read access.
  assert.equal(run.store.state.modelReceipts.length, 4); assert.deepEqual(run.store.state.tombstones, []);
  assert.equal(run.dispatches(), 0);
});

test('gateway retention: malformed or missing record dates never expose verbatim disclosure or approval bodies', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const run = await fixture('ollama', providerBody('ollama', { done: true, done_reason: 'stop' }));
  for (const record of run.store.state.modelReceipts) record.createdAt = 'not-a-timestamp';
  assert.equal(run.gateway.receipts(owner).length, 0);
  for (const record of run.store.state.modelReceipts) { delete record.createdAt; delete record.at; delete record.learnedAt; }
  assert.equal(run.gateway.receipts(owner).length, 0);
  assert.equal(run.store.state.modelReceipts.length, 2); assert.equal(run.dispatches(), 0);
});

test('gateway retention: completed zero-fact disclosure expires even while its retained raw state has a valid plan', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const run = await fixture('ollama', providerBody('ollama', { done: true, done_reason: 'stop' }));
  await run.execute();
  assert.equal(run.gateway.receipts(owner).find(item => item.id === run.preview.id).status, 'completed');
  t.mock.timers.setTime(START + DAY + 1);
  assert.equal(run.gateway.receipts(owner).some(item => item.id === run.preview.id), false);
  assert.throws(() => run.gateway.assertConversationReceipt(owner, run.preview.id), code('MODEL_RECEIPT_EXPIRED'));
  const retained = run.store.state.modelReceipts.find(item => item.id === run.preview.id);
  assert.equal(retained.status, 'completed'); assert.ok(retained.plan); assert.equal(retained.naturalQuestion, run.input.question);
  assert.equal(run.dispatches(), 1);
});

test('gateway retention: old zero-fact previews cannot obtain fresh consent or dispatch after retention expiry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const run = await fixture('ollama', providerBody('ollama', { done: true, done_reason: 'stop' }));
  t.mock.timers.setTime(START + DAY + 1);
  await assert.rejects(run.gateway.approveOutbound(owner, run.preview.id), code('MODEL_RECEIPT_EXPIRED'));
  await assert.rejects(run.execute(), code('MODEL_RECEIPT_EXPIRED'));
  assert.equal(run.dispatches(), 0);
  assert.equal(run.store.state.modelReceipts.length, 2);
  assert.equal(run.store.state.modelReceipts.find(item => item.id === run.preview.id).status, 'preview');
});
