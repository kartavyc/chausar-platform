import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, hash, initialState, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway, type GatewayConversationContinuation, type ModelRequest } from '../runtime/gateway.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import type { ReviewedConversationCalculationParameters } from '../runtime/conversation-calculation-arguments.ts';

// Authored synthetic memory/provider fixtures. No network, CLI, customer vault,
// native database, credentials or vendor qualification are exercised here.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const PRIOR = { from: '2026-08-01', to: '2026-08-31' };
const ENDPOINT = 'https://synthetic-reviewed-calculation.invalid/v1/responses';
const ids = ['synthetic-current', 'synthetic-prior-only'];
const code = (value: string) => (error: unknown) => error instanceof ChausarError && error.code === value;
class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC parameter join', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
function retained(parameters: ReviewedConversationCalculationParameters): GatewayConversationContinuation {
  const body = { schemaVersion: 1 as const, turnId: 'synthetic-pending-comparison', originalQuestion: 'Compare revenue.',
    clarification: 'Which comparison period should I use?', sourceIds: ids,
    requestScope: { sourceIds: ids, ...(parameters.period ? { period: parameters.period } : {}) },
    reviewedCalculationParameters: parameters };
  return { ...body, digest: hash(body) };
}
function wire(operation: 'change' | 'scenario' = 'change') {
  return { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
    operation, period: PERIOD, branch: null, customerId: null,
    ...(operation === 'change' ? { comparePeriod: PRIOR } : { assumptions: { priceChangeBps: '00500' } }),
  } }], clarification: null };
}
function input(operation: 'change' | 'scenario' = 'change'): ModelRequest {
  return { question: 'SYNTHETIC reviewed calculation', purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-route',
    sourceIds: ids, period: PERIOD,
    ...(operation === 'change' ? { comparePeriod: PRIOR } : { assumptions: { priceChangeBps: '00500' } }) };
}
async function fixture(operation: 'change' | 'scenario' = 'change', continuation?: GatewayConversationContinuation) {
  const store = new MemoryStore(); store.state.policy.send = 'shape';
  await new OntologyService(store).publish(owner, starterPacks.find(pack => pack.pack === 'ecommerce')!);
  for (const [sourceId, date] of [[ids[0], '2026-09-02'], [ids[1], '2026-08-02'], ['synthetic-unselected', '2026-08-03']]) {
    store.state.facts.push({ id: `${sourceId}-fact`, sourceId, entityId: `${sourceId}-sale`, sourceRow: 1,
      kind: 'sale', validFrom: date, validTo: null, learnedAt: now(), supersededAt: null,
      branch: 'main', fields: { amountMinor: '10000', currency: 'INR', status: 'delivered' } });
  }
  let calls = 0; let output: unknown = wire(operation);
  const gateway = new ModelGateway(store, {
    ...(continuation ? { conversationContinuation: () => structuredClone(continuation) } : {}),
    http: async request => { calls++; return { status: 200, endpoint: request.endpoint,
      body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }) }; },
  });
  await gateway.configureRoute(owner, { id: 'synthetic-route', kind: 'openai-responses', model: 'synthetic-authored-planner',
    endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' }, 'synthetic-fixture-only');
  return { store, gateway, calls: () => calls, output: (next: unknown) => { output = next; } };
}
function content(preview: any) { return JSON.parse(JSON.parse(preview.payload).input); }
function operationSchemas(preview: any) {
  return preview.schema.properties.calls.items.anyOf.filter((alternative: any) => alternative.properties.tool.enum.includes('calculator.calculate'));
}
async function reviewed(f: Awaited<ReturnType<typeof fixture>>, request: ModelRequest) {
  const preview = await f.gateway.preview(owner, request), approval = await f.gateway.approveOutbound(owner, preview.id);
  return { preview, approval, execute: (changes: Partial<ModelRequest> = {}) => f.gateway.execute(owner,
    { ...request, ...changes, previewId: preview.id, approvalId: approval.id }) };
}

test('explicit prior-only admission is pinned separately from the current descriptive manifest', async () => {
  const f = await fixture(), turn = await reviewed(f, input());
  assert.deepEqual(turn.preview.sourceIds, ids);
  assert.deepEqual(turn.preview.businessContext.sourceIds, ['synthetic-current']);
  assert.deepEqual(turn.preview.factIds, ids.map(id => `${id}-fact`));
  assert.equal(turn.preview.factIds.includes('synthetic-unselected-fact'), false);
  const body = content(turn.preview);
  assert.deepEqual(body.calculationParameters.period, PERIOD); assert.deepEqual(body.calculationParameters.comparePeriod, PRIOR);
  assert.deepEqual(body.calculationParameters.origins, { period: 'owner-requested', comparePeriod: 'owner-requested' });
  assert.equal(JSON.stringify(body.evidence).includes('2026-08-01'), false);
  const result = await turn.execute();
  assert.equal(result.kind, 'conversation'); assert.equal(f.calls(), 1);
  assert.deepEqual(f.gateway.assertConversationReceipt(owner, result.receipt.id).plan, result.plan);
});

test('omitted prior-only source stays unselected and cannot be added to an approved preview', async () => {
  const f = await fixture(), request = { ...input(), sourceIds: ['synthetic-current'] }, turn = await reviewed(f, request);
  assert.deepEqual(turn.preview.sourceIds, ['synthetic-current']);
  assert.deepEqual(turn.preview.factIds, ['synthetic-current-fact']);
  await assert.rejects(turn.execute({ sourceIds: ids }), code('PREVIEW_REQUEST_CHANGED'));
  assert.equal(f.calls(), 0); assert.equal(f.store.state.modelReceipts.find(item => item.id === turn.approval.id).used, false);
});

test('explicit empty calculation scope remains empty even with exact comparison inputs', async () => {
  const f = await fixture(), turn = await reviewed(f, { ...input(), sourceIds: [] });
  assert.deepEqual(turn.preview.sourceIds, []); assert.deepEqual(turn.preview.factIds, []);
  const result = await turn.execute(); assert.equal(result.kind, 'conversation');
  assert.deepEqual(f.gateway.assertConversationReceipt(owner, result.receipt.id).sourceIds, []);
});

test('revoking a selected prior-only source refuses before provider entry and approval consumption', async () => {
  const f = await fixture(), turn = await reviewed(f, input());
  f.store.state.policy.allowedSources = ['synthetic-current'];
  await assert.rejects(turn.execute(), code('PREVIEW_STALE')); assert.equal(f.calls(), 0);
  assert.equal(f.store.state.modelReceipts.find(item => item.id === turn.approval.id).used, false);
});

for (const operation of ['change', 'scenario'] as const) {
  test(`${operation} changed retained owner parameters refuse before dispatch and on completed readback`, async () => {
    const f = await fixture(operation), turn = await reviewed(f, input(operation));
    const changes = operation === 'change' ? { comparePeriod: { ...PRIOR, to: '2026-08-30' } } : { assumptions: { priceChangeBps: '00600' } };
    await assert.rejects(turn.execute(changes), code('PREVIEW_REQUEST_CHANGED')); assert.equal(f.calls(), 0);
    const result = await turn.execute(); assert.equal(f.calls(), 1);
    Object.assign(f.store.state.modelReceipts.find(item => item.id === result.receipt.id).reviewedCalculationParameters, changes);
    assert.throws(() => f.gateway.assertConversationReceipt(owner, result.receipt.id), code('PAYLOAD_CHANGED'));
    assert.equal(f.calls(), 1);
  });
}

test('rewriting parameter metadata and its digest still refuses against the unchanged approved payload', async () => {
  const f = await fixture('scenario'), turn = await reviewed(f, input('scenario'));
  const record = f.store.state.modelReceipts.find(item => item.id === turn.preview.id);
  record.reviewedCalculationParameters.assumptions.priceChangeBps = '00600';
  record.calculationParametersDigest = hash(record.reviewedCalculationParameters);
  await assert.rejects(turn.execute(), code('PREVIEW_REQUEST_CHANGED')); assert.equal(f.calls(), 0);
  await assert.rejects(f.gateway.execute(owner, { previewId: turn.preview.id, approvalId: turn.approval.id }), code('PAYLOAD_CHANGED'));
  assert.equal(f.calls(), 0);
});

test('dictionary revision invalidates the reviewed parameter contract before provider entry', async () => {
  const f = await fixture(), turn = await reviewed(f, input()), draft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  draft.definitions[0].meaning = 'A changed SYNTHETIC published definition.';
  await new OntologyService(f.store).publish(owner, draft);
  await assert.rejects(turn.execute(), code('BUSINESS_CONTEXT_STALE')); assert.equal(f.calls(), 0);
});

test('continuation adds missing inputs only under a fresh approval and preserves exact inherited periods', async () => {
  const f = await fixture('change', retained({ period: PERIOD }));
  const request: ModelRequest = { question: 'Use prior August.', purpose: 'conversation', questionDisclosure: 'verbatim',
    routeId: 'synthetic-route', continuationId: 'synthetic-pending-comparison' };
  const missing = await f.gateway.preview(owner, request);
  assert.equal(operationSchemas(missing).some((schema: any) => schema.properties.args.properties.operation.enum?.includes('change')), false);
  assert.equal(content(missing).calculationParameters.missingInputClarifications.change, 'Which comparison period should I use?');
  const preview = await f.gateway.preview(owner, { ...request, comparePeriod: PRIOR });
  assert.deepEqual(preview.calculationParameterOrigins, { period: 'retained-owner-requested', comparePeriod: 'owner-requested' });
  await assert.rejects(f.gateway.execute(owner, { ...request, comparePeriod: PRIOR, previewId: missing.id }), code('PREVIEW_REQUEST_CHANGED'));
  await assert.rejects(f.gateway.execute(owner, { ...request, comparePeriod: PRIOR, previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED'));
  const approval = await f.gateway.approveOutbound(owner, preview.id);
  const result = await f.gateway.execute(owner, { ...request, comparePeriod: PRIOR, previewId: preview.id, approvalId: approval.id });
  assert.equal(result.kind, 'conversation'); assert.equal(f.calls(), 1);
  assert.deepEqual(f.gateway.assertConversationReceipt(owner, result.receipt.id).reviewedCalculationParameters, { period: PERIOD, comparePeriod: PRIOR });
});

test('conflicting inherited comparison and assumption inputs refuse without new preview or provider calls', async () => {
  const parameters = { period: PERIOD, comparePeriod: PRIOR, assumptions: { priceChangeBps: '00500' } };
  const f = await fixture('change', retained(parameters));
  for (const changes of [{ comparePeriod: { ...PRIOR, to: '2026-08-30' } }, { assumptions: { priceChangeBps: '500' } }]) {
    await assert.rejects(f.gateway.preview(owner, { ...input(), continuationId: 'synthetic-pending-comparison', ...changes }), code('CONVERSATION_CONTINUATION_STALE'));
  }
  assert.equal(f.calls(), 0); assert.equal(f.store.state.modelReceipts.length, 0);
});

test('comparison/scenario inputs refuse outside conversation and cannot be smuggled onto ordinary calls', async () => {
  const f = await fixture();
  for (const purpose of ['analysis', 'business-context'] as const) {
    await assert.rejects(f.gateway.preview(owner, { question: 'SYNTHETIC calculation', purpose, comparePeriod: PRIOR }), code('INVALID_CALCULATION_PARAMETERS'));
    await assert.rejects(f.gateway.preview(owner, { question: 'SYNTHETIC calculation', purpose, assumptions: { priceChangeBps: '00500' } }), code('INVALID_CALCULATION_PARAMETERS'));
  }
  const turn = await reviewed(f, input());
  f.output({ kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
    operation: 'revenue', period: PERIOD, branch: null, customerId: null, comparePeriod: PRIOR,
  } }], clarification: null });
  await assert.rejects(turn.execute(), code('INVALID_CONVERSATION_PLAN')); assert.equal(f.calls(), 1);
});
test('trusted host reviewed-request guard is read-only and requires exact unused approval before dispatch', async () => {
  const f = await fixture(), request = input(), preview = await f.gateway.preview(owner, request);
  await assert.rejects(async () => f.gateway.assertReviewedConversationRequest(owner, { ...request, previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED'));
  const approval = await f.gateway.approveOutbound(owner, preview.id), exact = { ...request, previewId: preview.id, approvalId: approval.id };
  const before = f.store.read(), model = f.gateway.assertReviewedConversationRequest(owner, exact);
  assert.equal(model.id, preview.id); assert.deepEqual(model.sourceIds, ids);
  assert.equal(model.publishedCalculations.dictionaryHash, f.store.state.ontology.current.hash);
  assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 0);
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, { ...exact, comparePeriod: { ...PRIOR, to: '2026-08-30' } }), code('PREVIEW_REQUEST_CHANGED'));
  const draft = f.store.read(); draft.policy.allowedSources = ['synthetic-current'];
  const view: StateStore = { read: () => draft, update: async () => { throw new Error('Read-only authority guard must not update.'); } };
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, exact, view), code('PREVIEW_STALE'));
  assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 0);
});

test('trusted host completed-request guard allows identical current readback without new effect authority', async () => {
  const f = await fixture(), request = input(), turn = await reviewed(f, request), result = await turn.execute();
  const exact = { ...request, previewId: turn.preview.id, approvalId: turn.approval.id }, before = f.store.read();
  const model = f.gateway.assertReviewedConversationRequest(owner, exact);
  assert.equal(model.id, result.receipt.id); assert.equal(model.status, 'completed');
  assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 1);
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, { ...exact, approvalId: 'different-approval' }), code('APPROVAL_REVOKED'));
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, { ...exact, question: 'Different question.' }), code('PREVIEW_REQUEST_CHANGED'));
  f.store.state.members.find(member => member.id === owner.memberId)!.epoch++;
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, exact)); assert.equal(f.calls(), 1);
});

test('trusted host guard refuses altered retained schema and catalogue metadata', async () => {
  for (const field of ['schema', 'publishedCalculations'] as const) {
    const f = await fixture(), turn = await reviewed(f, input()), record = f.store.state.modelReceipts.find(item => item.id === turn.preview.id);
    if (field === 'schema') record.schema.properties.calls.maxItems = 99;
    else record.publishedCalculations.dictionaryHash = '0'.repeat(64);
    assert.throws(() => f.gateway.assertReviewedConversationRequest(owner,
      { ...input(), previewId: turn.preview.id, approvalId: turn.approval.id }), code('PAYLOAD_CHANGED'));
    assert.equal(f.calls(), 0); assert.equal(f.store.state.modelReceipts.find(item => item.id === turn.approval.id).used, false);
  }
});
test('private scope metadata cannot relabel the current period of an approved retained request', async () => {
  const f = await fixture(), turn = await reviewed(f, input()), record = f.store.state.modelReceipts.find(item => item.id === turn.preview.id);
  record.requestScope.period = { ...PERIOD, to: '2026-09-29' };
  const exact = { ...input(), period: record.requestScope.period, previewId: turn.preview.id, approvalId: turn.approval.id };
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, exact), code('TOOL_SCOPE_CHANGED'));
  assert.equal(f.calls(), 0); assert.equal(f.store.state.modelReceipts.find(item => item.id === turn.approval.id).used, false);
});