import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, hash, initialState, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway, type GatewayConversationContinuation, type GatewayOptions, type ModelRequest } from '../runtime/gateway.ts';

// Authored synthetic memory and HTTP contracts only. No provider, native process,
// credential broker, customer vault or network is accessed by this fixture.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const ENDPOINT = 'https://synthetic-continuation.example.test/v1/responses';
const OBJECTIVE = '  Please calculate billed for SYNTHETIC OBJECTIVE COMPANY.  ';
const CLARIFICATION = 'Which period should I use?';
const REPLY = '  September 2026  ';
const PRIVATE_BRANCH = 'SYNTHETIC PRIVATE BRANCH';
const PRIVATE_SOURCE = 'synthetic-private-source';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const plan = () => ({ kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
  operation: 'billed', period: PERIOD, branch: null, customerId: null,
} }], clarification: null });
const response = (value: unknown = plan()) => ({ status: 200, endpoint: ENDPOINT, body: JSON.stringify({ output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
] }) });

class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC CONTINUATION WORKSPACE', true);
  constructor() { this.state.policy.send = 'shape'; this.state.policy.retentionDays = 365; }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
function descriptor(changes: Partial<Omit<GatewayConversationContinuation, 'digest'>> = {}): GatewayConversationContinuation {
  const body = { schemaVersion: 1 as const, turnId: 'synthetic-pending-turn', originalQuestion: OBJECTIVE,
    clarification: CLARIFICATION, sourceIds: [] as string[], requestScope: { sourceIds: [] as string[] }, ...changes };
  return { ...body, digest: hash(body) };
}
function input(changes: Partial<ModelRequest> = {}): ModelRequest {
  return { question: REPLY, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-api',
    continuationId: 'synthetic-pending-turn', ...changes };
}
function content(payload: string) { return JSON.parse(JSON.parse(payload).input); }
async function fixture(retained: GatewayConversationContinuation = descriptor(), http?: NonNullable<GatewayOptions['http']>) {
  const store = new MemoryStore(); let calls = 0; let current = retained; let available = true;
  const resolutions: { turnId: string; resolvedByModelReceiptId?: string }[] = [];
  const gateway = new ModelGateway(store, {
    conversationContinuation: (_context, turnId, view, resolvedByModelReceiptId) => {
      assert.equal(view.read().workspace.id, store.state.workspace.id);
      resolutions.push({ turnId, resolvedByModelReceiptId });
      if (!available) throw new ChausarError('CONVERSATION_CONTINUATION_UNAVAILABLE', 'Synthetic pending turn expired.');
      return structuredClone(current);
    },
    http: async request => { calls++; assert.equal(request.endpoint, ENDPOINT); return http ? http(request) : response(); },
  });
  await gateway.configureRoute(owner, { id: 'synthetic-api', kind: 'openai-responses', model: 'synthetic-continuation-model', endpoint: ENDPOINT }, 'synthetic fixture credential');
  return { store, gateway, resolutions, calls: () => calls, change: (next: GatewayConversationContinuation) => { current = next; },
    expire: () => { available = false; } };
}
async function reviewed(run: Awaited<ReturnType<typeof fixture>>, request: ModelRequest = input()) {
  const preview = await run.gateway.preview(owner, request), approval = await run.gateway.approveOutbound(owner, preview.id);
  return { request, preview, approval, execute: (changes: Partial<ModelRequest> = {}) => run.gateway.execute(owner,
    { ...request, previewId: preview.id, approvalId: approval.id, ...changes }) };
}

test('continuation preview reviews the old objective, clarification and exact latest reply before any HTTP call', async () => {
  const retained = descriptor(), run = await fixture(retained), preview = await run.gateway.preview(owner, input());
  const wire = content(preview.payload);
  assert.equal(wire.question, REPLY); assert.equal(wire.questionDisclosure, 'verbatim');
  assert.deepEqual(wire.continuation, { turnId: retained.turnId, originalQuestion: OBJECTIVE, clarification: CLARIFICATION });
  assert.equal(wire.continuationDisclosure, 'verbatim');
  assert.equal(preview.naturalQuestion, REPLY); assert.equal(preview.questionHash, hash(REPLY));
  assert.equal(preview.continuationId, retained.turnId); assert.equal(preview.continuationDigest, retained.digest);
  assert.deepEqual(preview.continuation, retained); assert.equal(preview.digest, hash(preview.payload));
  assert.match(preview.continuationDisclosureWarning!, /complete retained original objective.*clarification.*exact current reply/i);
  assert.match(preview.continuationDisclosureWarning!, /separately from evidence Shape.*private names, amounts and instructions/i);
  assert.equal(preview.approvalRequired, true); assert.equal(run.calls(), 0);
  await assert.rejects(run.gateway.execute(owner, { ...input(), previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED'));
  assert.equal(run.calls(), 0);
  assert.deepEqual(run.store.state.receipts, []); assert.deepEqual(run.store.state.answers, []); assert.deepEqual(run.store.state.conversations, []);
});

test('fresh exact question never automatically includes retained private objective or invokes the host resolver', async () => {
  const run = await fixture(), fresh = input({ question: 'Please calculate billed.', continuationId: undefined });
  const preview = await run.gateway.preview(owner, fresh), wire = content(preview.payload);
  assert.equal(wire.question, fresh.question); assert.equal(wire.continuation, undefined);
  assert.equal(wire.continuationDisclosure, undefined); assert.equal(preview.continuation, undefined);
  assert.equal(preview.payload.includes('SYNTHETIC OBJECTIVE COMPANY'), false);
  assert.deepEqual(run.resolutions, []); assert.equal(run.calls(), 0);
});

test('one approved continuation HTTP call retains the latest natural question and compatible normalized plan', async () => {
  const run = await fixture(), turn = await reviewed(run);
  await run.gateway.configureRoute(owner, { id: 'synthetic-unused-fallback', kind: 'ollama', model: 'synthetic-fallback' });
  const result = await turn.execute();
  assert.equal(run.calls(), 1); assert.equal(result.kind, 'conversation');
  assert.equal(result.receipt.naturalQuestion, REPLY); assert.equal(result.receipt.questionHash, hash(REPLY));
  assert.deepEqual(result.plan, { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: { operation: 'billed', period: PERIOD } }], clarification: null });
  assert.equal(result.receipt.continuationDigest, turn.preview.continuationDigest); assert.equal(result.receipt.attempts, 1);
  assert.equal(run.gateway.assertConversationReceipt(owner, turn.preview.id).status, 'completed');
  assert.ok(run.resolutions.some(resolution => resolution.resolvedByModelReceiptId === undefined));
  assert.ok(run.resolutions.filter(resolution => resolution.resolvedByModelReceiptId !== undefined).every(resolution => resolution.resolvedByModelReceiptId === turn.preview.id));
  assert.equal(run.store.state.routes.find(route => route.id === 'synthetic-unused-fallback').costConsumedMinor, '0');
  assert.deepEqual(run.store.state.receipts, []); assert.deepEqual(run.store.state.answers, []); assert.deepEqual(run.store.state.conversations, []);
  await assert.rejects(turn.execute(), code('PREVIEW_NOT_FOUND')); assert.equal(run.calls(), 1);
});

test('changed, cleared or omitted continuation ID fails before provider entry', async () => {
  for (const changes of [{ continuationId: 'different-pending-turn' }, { continuationId: undefined }, { continuationId: '' }]) {
    const run = await fixture(), turn = await reviewed(run);
    await assert.rejects(turn.execute(changes), code('PREVIEW_REQUEST_CHANGED'));
    assert.equal(run.calls(), 0);
    assert.equal(run.store.state.modelReceipts.find(record => record.id === turn.preview.id).status, 'preview');
  }
  const run = await fixture(), turn = await reviewed(run);
  await assert.rejects(run.gateway.execute(owner, { previewId: turn.preview.id, approvalId: turn.approval.id }), code('PREVIEW_REQUEST_CHANGED'));
  assert.equal(run.calls(), 0);
});

test('continuation text or private scope changed by the host invalidates both approval and dispatch', async () => {
  for (const next of [descriptor({ originalQuestion: 'A changed synthetic objective.' }), descriptor({ requestScope: { sourceIds: [], period: PERIOD } })]) {
    {
      const run = await fixture(), preview = await run.gateway.preview(owner, input()); run.change(next);
      await assert.rejects(run.gateway.approveOutbound(owner, preview.id), code('CONVERSATION_CONTINUATION_STALE'));
      assert.equal(run.calls(), 0);
    }
    {
      const run = await fixture(), turn = await reviewed(run); run.change(next);
      await assert.rejects(turn.execute(), code('CONVERSATION_CONTINUATION_STALE'));
      assert.equal(run.calls(), 0);
    }
  }
});

test('expired retained authority and revoked zero-row selected sources refuse before entry', async () => {
  {
    const run = await fixture(), turn = await reviewed(run); run.expire();
    await assert.rejects(turn.execute(), code('CONVERSATION_CONTINUATION_UNAVAILABLE')); assert.equal(run.calls(), 0);
  }
  {
    const retained = descriptor({ sourceIds: [PRIVATE_SOURCE], requestScope: { sourceIds: [PRIVATE_SOURCE] } });
    const run = await fixture(retained), turn = await reviewed(run);
    assert.deepEqual(turn.preview.sourceIds, []); assert.deepEqual(turn.preview.requestScope.sourceIds, [PRIVATE_SOURCE]);
    run.store.state.sourceRules.push({ sourceId: PRIVATE_SOURCE, revoked: true });
    await assert.rejects(turn.execute(), code('SOURCE_REVOKED')); assert.equal(run.calls(), 0);
  }
});

test('explicit empty retained source selection excludes unrelated current evidence and keeps private scope local', async () => {
  const run = await fixture();
  run.store.state.facts.push({ id: 'synthetic-unrelated-fact', entityId: 'synthetic-invoice', sourceId: 'synthetic-unrelated-source', sourceRow: 1,
    kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null,
    branch: PRIVATE_BRANCH, fields: { amountMinor: '3487981723', currency: 'INR', privateNote: 'SYNTHETIC PRIVATE ROW' } });
  const preview = await run.gateway.preview(owner, input()), wire = content(preview.payload);
  assert.deepEqual(preview.requestScope.sourceIds, []); assert.deepEqual(preview.sourceIds, []); assert.deepEqual(preview.factIds, []);
  assert.deepEqual(wire.evidence.calculator.shape, []);
  for (const text of ['synthetic-unrelated-source', PRIVATE_BRANCH, '3487981723', 'SYNTHETIC PRIVATE ROW']) assert.equal(preview.payload.includes(text), false);
  await assert.rejects(run.gateway.preview(owner, input({ sourceIds: ['synthetic-unrelated-source'] })), code('CONVERSATION_CONTINUATION_STALE'));
  assert.equal(run.calls(), 0);
});

test('retained fixed scope is inherited, remains local in Shape, and accepts canonical equivalent caller scope', async () => {
  const sources = ['synthetic-source-b', 'synthetic-source-a'], asOf = '2026-09-30T12:00:00.000Z';
  const retained = descriptor({ sourceIds: sources, requestScope: { sourceIds: sources, branch: PRIVATE_BRANCH,
    asOf, onDate: '2026-09-30', period: PERIOD } });
  const run = await fixture(retained), request = input({ sourceIds: [...sources].reverse(), asOf: '2026-09-30T14:00:00+02:00' });
  const turn = await reviewed(run, request);
  assert.deepEqual(turn.preview.requestScope, { sourceIds: [...sources].sort(), branch: PRIVATE_BRANCH, period: PERIOD, asOf, onDate: '2026-09-30' });
  assert.equal(turn.preview.payload.includes(PRIVATE_BRANCH), false);
  for (const source of sources) assert.equal(turn.preview.payload.includes(source), false);
  assert.equal(content(turn.preview.payload).continuation.requestScope, undefined);
  const result = await turn.execute({ sourceIds: sources, asOf }); assert.equal(result.kind, 'conversation'); assert.equal(run.calls(), 1);
});

test('conflicting retained branch, period, dates or selected sources fail without a new preview or transfer', async () => {
  const retained = descriptor({ sourceIds: [PRIVATE_SOURCE], requestScope: { sourceIds: [PRIVATE_SOURCE], branch: PRIVATE_BRANCH,
    asOf: '2026-09-30T12:00:00.000Z', onDate: '2026-09-30', period: PERIOD } });
  for (const change of [
    { sourceIds: [] }, { branch: 'synthetic-other-branch' }, { asOf: '2026-09-29T12:00:00.000Z' },
    { onDate: '2026-09-29' }, { period: { from: '2026-09-01', to: '2026-10-01' } },
  ]) {
    const run = await fixture(retained), before = run.store.state.modelReceipts.length;
    await assert.rejects(run.gateway.preview(owner, input(change)), code('CONVERSATION_CONTINUATION_STALE'));
    assert.equal(run.store.state.modelReceipts.length, before); assert.equal(run.calls(), 0);
  }
});

test('unspecified prior filters may narrow the new exact review while sources always stay pinned', async () => {
  const run = await fixture(), turn = await reviewed(run, input({ period: PERIOD, branch: PRIVATE_BRANCH, onDate: '2026-09-30' }));
  assert.deepEqual(turn.preview.requestScope.period, PERIOD); assert.equal(turn.preview.requestScope.branch, PRIVATE_BRANCH);
  assert.deepEqual(turn.preview.requestScope.sourceIds, []);
  await assert.rejects(turn.execute({ period: { from: '2026-09-01', to: '2026-10-01' } }), code('PREVIEW_REQUEST_CHANGED'));
  assert.equal(run.calls(), 0); await turn.execute(); assert.equal(run.calls(), 1);
});

test('saved continuation metadata and scope tampering fail before dispatch', async () => {
  for (const mutate of [
    (record: any) => { record.continuationId = undefined; },
    (record: any) => { record.continuationDigest = hash('changed'); },
    (record: any) => { record.continuation.originalQuestion = 'Changed objective.'; },
    (record: any) => { record.requestScope.period = PERIOD; },
    (record: any) => { delete record.requestScope; },
    (record: any) => { delete record.requestScopeDigest; },
    (record: any) => { record.continuation = undefined; },
  ]) {
    const run = await fixture(), turn = await reviewed(run); mutate(run.store.state.modelReceipts.find(record => record.id === turn.preview.id));
    await assert.rejects(turn.execute(), (error: unknown) => error instanceof ChausarError && ['PREVIEW_REQUEST_CHANGED', 'CONVERSATION_CONTINUATION_STALE', 'INVALID_CONVERSATION_CONTINUATION'].includes(error.code));
    assert.equal(run.calls(), 0);
  }
});

test('host changes during HTTP prevent completed admission without consuming pending objective or fallback', async () => {
  let run: Awaited<ReturnType<typeof fixture>>;
  run = await fixture(descriptor(), async () => { run.change(descriptor({ clarification: 'Which branch should I use?' })); return response(); });
  const turn = await reviewed(run);
  await assert.rejects(turn.execute(), code('CONVERSATION_CONTINUATION_STALE'));
  assert.equal(run.calls(), 1); const record = run.store.state.modelReceipts.find(item => item.id === turn.preview.id);
  assert.equal(record.status, 'failed'); assert.equal(record.plan, undefined); assert.equal(record.attempts, 1);
  assert.deepEqual(run.store.state.conversations, []); assert.deepEqual(run.store.state.receipts, []);
});

test('in-flight saved disclosure changes and fresh-record continuation injection cannot admit a mismatched receipt', async () => {
  for (const continued of [true, false]) {
    let run: Awaited<ReturnType<typeof fixture>>, receiptId = '';
    run = await fixture(descriptor(), async () => {
      const record = run.store.state.modelReceipts.find(item => item.id === receiptId);
      if (continued) delete record.continuationDisclosure;
      else { record.continuation = descriptor(); record.continuationDigest = record.continuation.digest; }
      return response();
    });
    const turn = await reviewed(run, input({ continuationId: continued ? 'synthetic-pending-turn' : undefined })); receiptId = turn.preview.id;
    await assert.rejects(turn.execute(), code('CONVERSATION_CONTINUATION_STALE'));
    assert.equal(run.calls(), 1); const record = run.store.state.modelReceipts.find(item => item.id === receiptId);
    assert.equal(record.status, 'failed'); assert.equal(record.plan, undefined); assert.deepEqual(run.store.state.conversations, []);
  }
});

test('failed transfer leaves retained objective reusable by a new exactly approved preview', async () => {
  let attempts = 0;
  const run = await fixture(descriptor(), async () => ++attempts === 1 ? { status: 503, endpoint: ENDPOINT, body: 'Synthetic unavailable' } : response());
  const failed = await reviewed(run); await assert.rejects(failed.execute(), code('MODEL_FAILED')); assert.equal(run.calls(), 1);
  const retry = await reviewed(run); assert.notEqual(retry.preview.id, failed.preview.id);
  assert.deepEqual(content(retry.preview.payload).continuation, content(failed.preview.payload).continuation);
  await retry.execute(); assert.equal(run.calls(), 2); assert.deepEqual(run.store.state.conversations, []);
});

test('host consumed-by-exact-model readback receives the new model receipt ID', async () => {
  const retained = descriptor(), run = await fixture(retained), turn = await reviewed(run); await turn.execute();
  run.gateway.options.conversationContinuation = (_context, turnId, _view, resolvedByModelReceiptId) => {
    assert.equal(turnId, retained.turnId);
    if (resolvedByModelReceiptId !== turn.preview.id) throw new ChausarError('CONVERSATION_CONTINUATION_UNAVAILABLE', 'Synthetic turn already consumed.');
    return retained;
  };
  assert.equal(run.gateway.assertConversationReceipt(owner, turn.preview.id).status, 'completed');
  await assert.rejects(run.gateway.preview(owner, input()), code('CONVERSATION_CONTINUATION_UNAVAILABLE'));
  assert.equal(run.calls(), 1);
});

test('eight exact prior clarification exchanges are reviewed and a ninth is refused without truncation', async () => {
  const exchanges = Array.from({ length: 8 }, (_, index) => ({ question: `Synthetic reply ${String.fromCharCode(65 + index)}.`, clarification: 'Which period should I use?' }));
  const run = await fixture(descriptor({ exchanges })), preview = await run.gateway.preview(owner, input());
  assert.deepEqual(content(preview.payload).continuation.exchanges, exchanges); assert.deepEqual(preview.continuation!.exchanges, exchanges);
  run.change(descriptor({ exchanges: [...exchanges, { question: 'Synthetic reply I.', clarification: 'Which branch should I use?' }] }));
  await assert.rejects(run.gateway.preview(owner, input()), code('INVALID_CONVERSATION_CONTINUATION'));
  assert.equal(run.calls(), 0);
});

test('malformed, cyclic, computed, oversized or digest-invalid host descriptors are refused locally', async () => {
  const malformed: unknown[] = [
    null, {}, Promise.resolve(descriptor()), { ...descriptor(), digest: hash('wrong') },
    descriptor({ turnId: 'different-turn' }), descriptor({ originalQuestion: 'q'.repeat(8001) }),
    descriptor({ clarification: 'q'.repeat(501) }), descriptor({ sourceIds: [PRIVATE_SOURCE, PRIVATE_SOURCE] }),
    descriptor({ sourceIds: [PRIVATE_SOURCE], requestScope: { sourceIds: [] } }),
    descriptor({ requestScope: { branch: 'b'.repeat(201) } }), descriptor({ requestScope: { onDate: '2026-02-31' } }),
    descriptor({ requestScope: { asOf: 'not-a-timestamp' } }), descriptor({ requestScope: { period: { from: '2026-09-30', to: '2026-09-01' } } }),
    { ...descriptor(), undeclared: 'synthetic' }, Object.assign(Object.create({ inherited: true }), descriptor()),
  ];
  const computed = descriptor(); Object.defineProperty(computed, 'originalQuestion', { enumerable: true, get: () => { throw new Error('Getter must not run'); } }); malformed.push(computed);
  const cyclic: any = descriptor(); cyclic.requestScope = cyclic; malformed.push(cyclic);
  const sparse = descriptor(); sparse.exchanges = Array(1); malformed.push(sparse);
  const extraArrayField = descriptor(); (extraArrayField.sourceIds as any).extra = 'synthetic'; malformed.push(extraArrayField);
  for (const value of malformed) {
    const run = await fixture(); run.gateway.options.conversationContinuation = () => value as GatewayConversationContinuation;
    await assert.rejects(run.gateway.preview(owner, input()), code('INVALID_CONVERSATION_CONTINUATION'));
    assert.equal(run.calls(), 0); assert.equal(run.store.state.modelReceipts.length, 0);
  }
});

test('RPC cannot supply a descriptor body, an unbounded ID or continuation in analytical mode', async () => {
  const run = await fixture();
  for (const continuationId of ['', 't'.repeat(201), '../synthetic-turn', '\nsynthetic-turn']) {
    await assert.rejects(run.gateway.preview(owner, input({ continuationId })), code('INVALID_CONVERSATION_CONTINUATION'));
  }
  await assert.rejects(run.gateway.preview(owner, { ...input(), continuation: descriptor() } as ModelRequest), code('INVALID_CONVERSATION_CONTINUATION'));
  await assert.rejects(run.gateway.preview(owner, input({ purpose: 'analysis', questionDisclosure: undefined })), code('INVALID_CONVERSATION_CONTINUATION'));
  const noResolver = new ModelGateway(run.store);
  await assert.rejects(noResolver.preview(owner, input()), code('CONVERSATION_CONTINUATION_UNAVAILABLE'));
  assert.equal(run.calls(), 0); assert.deepEqual(run.resolutions, []);
});

test('recursive receipt callback cycles fail with a bounded contract error and release the guard', async () => {
  const retained = descriptor(), run = await fixture(retained), turn = await reviewed(run); await turn.execute(); let checks = 0;
  run.gateway.options.conversationContinuation = () => { checks++; run.gateway.assertConversationReceipt(owner, turn.preview.id); return retained; };
  assert.throws(() => run.gateway.assertConversationReceipt(owner, turn.preview.id), code('INVALID_CONVERSATION_CONTINUATION'));
  assert.equal(checks, 1);
  run.gateway.options.conversationContinuation = () => retained;
  assert.equal(run.gateway.assertConversationReceipt(owner, turn.preview.id).status, 'completed'); assert.equal(run.calls(), 1);
});

test('nine distinct recursive prior-receipt checks stop before stack overflow while eight checks pass', async () => {
  const run = await fixture(), turns: { retained: GatewayConversationContinuation; receiptId: string }[] = [];
  for (let index = 0; index < 9; index++) {
    const retained = descriptor({ turnId: `synthetic-pending-${index}` }); run.change(retained);
    const turn = await reviewed(run, input({ continuationId: retained.turnId })); await turn.execute();
    turns.push({ retained, receiptId: turn.preview.id });
  }
  let calls = 0;
  run.gateway.options.conversationContinuation = (_context, turnId) => {
    calls++; const index = turns.findIndex(turn => turn.retained.turnId === turnId);
    if (index + 1 < turns.length) run.gateway.assertConversationReceipt(owner, turns[index + 1].receiptId);
    return turns[index].retained;
  };
  assert.throws(() => run.gateway.assertConversationReceipt(owner, turns[0].receiptId), code('INVALID_CONVERSATION_CONTINUATION')); assert.equal(calls, 8);
  calls = 0; assert.equal(run.gateway.assertConversationReceipt(owner, turns[1].receiptId).status, 'completed'); assert.equal(calls, 8);
  assert.equal(run.calls(), 9);
});
