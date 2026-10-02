import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ChausarError, initialState, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway, type HttpResult, type ModelRequest } from '../runtime/gateway.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';

// Authored synthetic provider held in memory. No network, process, native DB,
// customer vault, acquisition or real provider inference occurs in this file.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const PRIOR = { from: '2026-08-01', to: '2026-08-31' };
const ENDPOINT = 'https://synthetic-dispatched-status.invalid/v1/responses';
const ids = ['synthetic-current', 'synthetic-prior-only'];
const code = (value: string) => (error: unknown) => error instanceof ChausarError && error.code === value;
class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC dispatched status', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
const request: ModelRequest = { question: 'SYNTHETIC compare reviewed revenue periods.', purpose: 'conversation',
  questionDisclosure: 'verbatim', routeId: 'synthetic-route', sourceIds: ids, period: PERIOD, comparePeriod: PRIOR };
const plan = { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
  operation: 'change', period: PERIOD, branch: null, customerId: null, comparePeriod: PRIOR,
} }], clarification: null };
const response: HttpResult = { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ status: 'completed', output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(plan) }] },
] }) };
async function fixture(t: TestContext) {
  const store = new MemoryStore(); store.state.policy.send = 'shape';
  await new OntologyService(store).publish(owner, starterPacks.find(pack => pack.pack === 'ecommerce')!);
  for (const [sourceId, date] of [[ids[0], '2026-09-02'], [ids[1], '2026-08-02']]) {
    store.state.facts.push({ id: `${sourceId}-fact`, sourceId, entityId: `${sourceId}-sale`, sourceRow: 1,
      kind: 'sale', validFrom: date, validTo: null, learnedAt: now(), supersededAt: null,
      branch: 'main', fields: { amountMinor: '10000', currency: 'INR', status: 'delivered' } });
  }
  let ready = true, calls = 0, markStarted!: () => void, finish!: (response: HttpResult) => void, fail!: (error: Error) => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const pending = new Promise<HttpResult>((resolve, reject) => { finish = resolve; fail = reject; });
  let sending: Promise<void> | undefined, outcome: { result?: Awaited<ReturnType<ModelGateway['execute']>>; error?: unknown } = {};
  const gateway = new ModelGateway(store, { businessContext: { assertEvidenceReady: (_context, refs) => {
    if (!ready) throw new ChausarError('SYNTHETIC_READINESS_LOST', 'Synthetic readiness fixture withheld.');
    // These manually authored local facts are unmanaged. The installed hook can
    // withhold current readiness, but must not manufacture managed qualification.
    assert.deepEqual(refs.managedSourceIds, []);
    return { qualifiedSourceIds: [] };
  } }, http: async () => { calls++; markStarted(); return pending; } });
  await gateway.configureRoute(owner, { id: request.routeId, kind: 'openai-responses', model: 'synthetic-authored-planner',
    endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' }, 'synthetic-fixture-only');
  const preview = await gateway.preview(owner, request), approval = await gateway.approveOutbound(owner, preview.id);
  const records = preview.businessContext.claims.find((claim: any) => claim.category === 'records');
  assert.equal(records?.qualification, 'unqualified-observation');
  const exact = { ...request, previewId: preview.id, approvalId: approval.id };
  const start = async () => {
    sending = gateway.execute(owner, exact).then(result => { outcome = { result }; }, error => { outcome = { error }; });
    await started;
  };
  t.after(async () => { if (sending) { finish(response); await sending; } });
  return { store, gateway, preview, approval, exact, start, calls: () => calls, setReady: (value: boolean) => { ready = value; },
    finish: async () => { finish(response); await sending; return outcome; },
    fail: async () => { fail(new Error('SYNTHETIC provider failure')); await sending; return outcome; } };
}

test('one real fixture dispatch grants only current status and cannot authorize replay or a result', async t => {
  const f = await fixture(t); await f.start(); const before = f.store.read();
  const status = f.gateway.assertDispatchedConversationRequest(owner, f.exact);
  assert.equal(status.status, 'dispatching'); assert.equal(status.id, f.preview.id); assert.equal(status.attempts, 1);
  assert.deepEqual(status.sourceIds, ids); assert.equal(status.digest, f.preview.digest); assert.equal(status.schemaDigest, f.preview.schemaDigest);
  assert.equal(status.publishedCalculations.dictionaryHash, f.store.state.ontology.current.hash);
  for (const key of ['plan', 'answer', 'conversationPlanWire', 'payload', 'errorCode', 'result']) assert.equal(Object.hasOwn(status, key), false);
  assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 1);
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, f.exact), code('PREVIEW_NOT_FOUND'));
  assert.throws(() => f.gateway.assertConversationReceipt(owner, f.preview.id), code('MODEL_RESULT_UNAVAILABLE'));
  await assert.rejects(f.gateway.execute(owner, f.exact), code('PREVIEW_NOT_FOUND'));
  assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 1);
});

test('status after original approval expiry validates the recorded dispatch without enabling another transfer', async t => {
  const f = await fixture(t); await f.start();
  const current = Date.now(), clock = t.mock.method(Date, 'now', () => current + 301000);
  try {
    const before = f.store.read(), status = f.gateway.assertDispatchedConversationRequest(owner, f.exact);
    assert.equal(status.status, 'dispatching'); assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 1);
    await assert.rejects(f.gateway.execute(owner, f.exact), code('PREVIEW_NOT_FOUND')); assert.equal(f.calls(), 1);
  } finally { clock.mock.restore(); }
});

test('a genuine failed-after-dispatch receipt supports only guarded status, never replay or result readback', async t => {
  const f = await fixture(t); await f.start(); const outcome = await f.fail();
  assert.ok(outcome.error instanceof ChausarError); assert.equal(outcome.error.code, 'MODEL_FAILED');
  const before = f.store.read(), status = f.gateway.assertDispatchedConversationRequest(owner, f.exact);
  assert.equal(status.status, 'failed'); assert.equal(status.attempts, 1); assert.equal(f.calls(), 1);
  assert.equal(Object.hasOwn(status, 'plan'), false); assert.equal(Object.hasOwn(status, 'errorCode'), false);
  assert.deepEqual(f.store.read(), before);
  await assert.rejects(f.gateway.execute(owner, f.exact), code('PREVIEW_NOT_FOUND'));
  assert.throws(() => f.gateway.assertConversationReceipt(owner, f.preview.id), code('MODEL_RESULT_UNAVAILABLE'));
  assert.throws(() => f.gateway.assertReviewedConversationRequest(owner, f.exact), code('PREVIEW_NOT_FOUND'));
  assert.equal(f.calls(), 1);
});

test('never-dispatched previews and completed results remain outside the dispatched-status API', async t => {
  const f = await fixture(t);
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, f.exact), code('DISPATCH_STATUS_UNAVAILABLE'));
  assert.equal(f.gateway.assertReviewedConversationRequest(owner, f.exact).status, 'preview');
  await f.start(); const outcome = await f.finish(); assert.equal(outcome.result?.kind, 'conversation');
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, f.exact), code('DISPATCH_STATUS_UNAVAILABLE'));
  assert.equal(f.gateway.assertReviewedConversationRequest(owner, f.exact).status, 'completed');
  assert.equal(f.calls(), 1);
});

test('single-dispatch evidence and the unique consumed original approval must remain exact', async t => {
  const f = await fixture(t); await f.start(); const before = f.store.read();
  const changes: { label: string; mutate: (state: State, model: any, approval: any) => void; code: string }[] = [
    { label: 'no attempt', mutate: (_s,m) => { m.attempts = 0; }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'repeated attempt', mutate: (_s,m) => { m.attempts = 2; }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'missing dispatch', mutate: (_s,m) => { delete m.dispatchedAt; }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'invalid dispatch', mutate: (_s,m) => { m.dispatchedAt = 'invalid'; }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'before approval', mutate: (_s,m,a) => { m.dispatchedAt = new Date(Date.parse(a.createdAt)-1).toISOString(); }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'at expiry', mutate: (_s,m,a) => { m.dispatchedAt = a.expiresAt; }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'future dispatch', mutate: (_s,m) => { m.dispatchedAt = new Date(Date.now()+1000).toISOString(); }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
    { label: 'unconsumed approval', mutate: (_s,_m,a) => { a.used = false; }, code: 'APPROVAL_REVOKED' },
    { label: 'different preview', mutate: (_s,_m,a) => { a.previewId = 'different-preview'; }, code: 'APPROVAL_REVOKED' },
    { label: 'different route', mutate: (_s,_m,a) => { a.routeId = 'different-route'; }, code: 'APPROVAL_REVOKED' },
    { label: 'different endpoint', mutate: (_s,_m,a) => { a.endpoint = 'https://different.invalid'; }, code: 'APPROVAL_REVOKED' },
    { label: 'different payload digest', mutate: (_s,_m,a) => { a.digest = '0'.repeat(64); }, code: 'APPROVAL_REVOKED' },
    { label: 'approver epoch', mutate: (_s,_m,a) => { a.approverEpoch++; }, code: 'APPROVAL_REVOKED' },
    { label: 'duplicate approval', mutate: (s,_m,a) => { s.modelReceipts.push(structuredClone(a)); }, code: 'APPROVAL_REVOKED' },
    { label: 'duplicate receipt', mutate: (s,m) => { s.modelReceipts.push(structuredClone(m)); }, code: 'DISPATCH_STATUS_UNAVAILABLE' },
  ];
  try {
    for (const change of changes) {
      f.store.state = structuredClone(before);
      change.mutate(f.store.state, f.store.state.modelReceipts.find(r => r.id === f.preview.id), f.store.state.modelReceipts.find(r => r.id === f.approval.id));
      assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, f.exact), code(change.code), change.label);
      assert.equal(f.calls(), 1);
    }
  } finally { f.store.state = before; }
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, { ...f.exact, approvalId: 'another-approval' }), code('APPROVAL_REVOKED'));
});

test('status retains exact request parameters and current private evidence/readiness against the supplied transaction view', async t => {
  const f = await fixture(t); await f.start(); const before = f.store.read();
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, { ...f.exact, comparePeriod: { ...PRIOR, to: '2026-08-30' } }), code('PREVIEW_REQUEST_CHANGED'));
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, { ...f.exact, sourceIds: ['synthetic-current'] }), code('PREVIEW_REQUEST_CHANGED'));
  const draft = f.store.read(); draft.policy.allowedSources = ['synthetic-current'];
  const view: StateStore = { read: () => draft, update: async () => { throw new Error('Status guard must be read-only.'); } };
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, f.exact, view), code('PREVIEW_STALE'));
  assert.deepEqual(f.store.read(), before); assert.equal(f.calls(), 1);
  f.setReady(false);
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, f.exact), code('SYNTHETIC_READINESS_LOST'));
  f.setReady(true);
  const definition = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  definition.definitions[0].meaning = 'A changed synthetic dictionary.';
  await new OntologyService(f.store).publish(owner, definition);
  assert.throws(() => f.gateway.assertDispatchedConversationRequest(owner, f.exact), code('BUSINESS_CONTEXT_STALE'));
  assert.equal(f.calls(), 1);
});

test('an expired unused approval still cannot execute a new conversation', async t => {
  const f = await fixture(t), current = Date.now(), clock = t.mock.method(Date, 'now', () => current + 301000);
  try {
    await assert.rejects(f.gateway.execute(owner, f.exact), code('OUTBOUND_APPROVAL_REQUIRED'));
    assert.equal(f.calls(), 0); assert.equal(f.store.state.modelReceipts.find(r => r.id === f.approval.id).used, false);
    assert.equal(f.store.state.modelReceipts.find(r => r.id === f.preview.id).status, 'preview');
  } finally { clock.mock.restore(); }
});