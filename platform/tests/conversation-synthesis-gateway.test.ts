import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, hash, initialState, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway, type GatewayOptions, type ModelRequest } from '../runtime/gateway.ts';
import type { ConversationSynthesisCodec, GatewaySynthesisAuthority, GroundedSynthesisOutput, GroundedToolSummary } from '../runtime/conversation-synthesis-contract.ts';

// Authored synthetic HTTP and memory only. The codec below is a strict fixture
// port, not the isolated pure module's semantic validator or live qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const ENDPOINT = 'https://synthetic-synthesis.example.test/v1/responses';
const QUESTION = '  Explain SYNTHETIC PRIVATE COMPANY and its billed result.  ';
const PRIVATE_SOURCE = 'synthetic-private-source', EMPTY_SOURCE = 'synthetic-empty-selected-source';
const FACT_ID = 'synthetic-private-fact', TURN_ID = 'synthetic-tool-turn', PLANNER_ID = 'synthetic-planner-model';
const PRIVATE_VALUE = 'INR 938475610.00';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
function output(): GroundedSynthesisOutput { return { schemaVersion: 1, paragraphs: [{ parts: [
  { kind: 'text', text: 'The admitted business claim is ' }, { kind: 'slot', ref: 'e1' },
  { kind: 'text', text: '. The billed result is ' }, { kind: 'slot', ref: 'e2' },
], evidenceRefs: ['e1', 'e2'] }], cautionRefs: ['e3'] }; }
function summary(): GroundedToolSummary { return { schemaVersion: 1, question: QUESTION,
  results: [{ ref: 'r1', tool: 'business.describe', status: 'ok', evidenceRefs: ['e1'] },
    { ref: 'r2', tool: 'calculator.calculate', status: 'partial', evidenceRefs: ['e2', 'e3'] }],
  evidence: [{ kind: 'claim', ref: 'e1', resultRef: 'r1', text: 'SYNTHETIC PRIVATE CLAIM TEXT', origin: 'owner-told', qualification: 'owner-stated', citationRefs: ['c1'] },
    { kind: 'figure', ref: 'e2', resultRef: 'r2', label: 'Billed', unit: 'money', currency: 'INR' },
    { kind: 'caution', ref: 'e3', resultRef: 'r2', code: 'PARTIAL_COVERAGE', label: 'Partial retained coverage', required: true }], citationRefs: ['c1'] }; }
function authority(): GatewaySynthesisAuthority {
  const current = summary(); return { summary: current, binding: { toolTurnId: TURN_ID, plannerModelReceiptId: PLANNER_ID,
    inputDigest: hash(current), toolResultsDigest: hash('synthetic admitted ordered tool results'), evidence: [
      { ref: 'e1', resultRef: 'r1', answerId: 'synthetic-private-business-answer', evidenceHash: hash('synthetic claim'), renderText: 'SYNTHETIC PRIVATE CLAIM TEXT', citationIds: ['synthetic-underlying-citation'] },
      { ref: 'e2', resultRef: 'r2', answerId: 'synthetic-private-calculation-answer', evidenceHash: hash('synthetic receipt figure'), renderText: PRIVATE_VALUE, receiptId: 'synthetic-private-receipt', figureKey: 'billed' },
      { ref: 'e3', resultRef: 'r2', answerId: 'synthetic-private-calculation-answer', evidenceHash: hash('synthetic coverage'), renderText: 'Synthetic exact partial coverage caution.' },
    ] }, sourceIds: [EMPTY_SOURCE, PRIVATE_SOURCE], factIds: [FACT_ID], rowIds: [FACT_ID] };
}
function fixtureCodec(): ConversationSynthesisCodec { return {
  instructions: 'Return the declared synthetic grounded slots and caution references as JSON. Do not request tools.',
  schema: current => {
    assert.equal(current.schemaVersion, 1); assert.equal(current.results.length, 2);
    return { type: 'object', additionalProperties: false, required: ['schemaVersion', 'paragraphs', 'cautionRefs'], properties: {
      schemaVersion: { const: 1 }, paragraphs: { type: 'array' }, cautionRefs: { type: 'array', items: { enum: current.evidence.filter(item => item.kind === 'caution').map(item => item.ref) } },
    } };
  },
  validate: (raw, current) => {
    if (hash(raw) !== hash(output()) || current.question !== QUESTION) throw new ChausarError('INVALID_SYNTHESIS_OUTPUT', 'Synthetic output violates the installed fixture contract.');
    return structuredClone(raw) as GroundedSynthesisOutput;
  },
  materialize: () => { throw new Error('Gateway must not materialize or persist a final history answer.'); },
}; }
class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC SYNTHESIS WORKSPACE', true);
  constructor() {
    this.state.policy.send = 'samples'; this.state.policy.retentionDays = 365;
    this.state.facts.push({ id: FACT_ID, entityId: 'synthetic-private-entity', sourceId: PRIVATE_SOURCE, sourceRow: 1,
      kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null,
      fields: { amountMinor: '93847561000', currency: 'INR', note: 'SYNTHETIC RAW PRIVATE ROW' } });
  }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
function request(changes: Partial<ModelRequest> = {}): ModelRequest { return { question: QUESTION, purpose: 'conversation-synthesis',
  questionDisclosure: 'verbatim', routeId: 'synthetic-synthesis', toolTurnId: TURN_ID, ...changes }; }
function response(raw: unknown = output()) { return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ output: [
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(raw) }] },
] }) }; }
async function fixture(options: GatewayOptions = {}) {
  const store = new MemoryStore(); let current = authority(), resolverCalls = 0, httpCalls = 0;
  const gateway = new ModelGateway(store, { synthesisCodec: fixtureCodec(), conversationSynthesis: (ctx, id, view) => {
    resolverCalls++; assert.equal(id, TURN_ID); assert.equal(view.read().workspace.id, store.state.workspace.id);
    if (ctx.memberId !== owner.memberId) throw new ChausarError('SYNTHESIS_UNAVAILABLE', 'Synthetic private tool turn belongs to another account.');
    return structuredClone(current);
  }, ...options, http: async input => { httpCalls++; assert.equal(input.endpoint, ENDPOINT); assert.equal(JSON.parse(input.body).tools.length, 0);
    return options.http ? options.http(input) : response(); } });
  await gateway.configureRoute(owner, { id: 'synthetic-synthesis', kind: 'openai-responses', model: 'synthetic-synthesis-model', endpoint: ENDPOINT }, 'synthetic fixture credential');
  return { store, gateway, change: (next: GatewaySynthesisAuthority) => { current = next; },
    calls: () => httpCalls, resolutions: () => resolverCalls };
}
async function reviewed(run: Awaited<ReturnType<typeof fixture>>, input = request()) {
  const preview = await run.gateway.preview(owner, input), approval = await run.gateway.approveOutbound(owner, preview.id);
  return { input, preview, approval, execute: (changes: Partial<ModelRequest> = {}) => run.gateway.execute(owner,
    { ...input, previewId: preview.id, approvalId: approval.id, ...changes }) };
}

test('separate synthesis preview discloses only the admitted summary with exact objective and mandatory warning', async () => {
  const run = await fixture(), preview = await run.gateway.preview(owner, request()), wire = JSON.parse(JSON.parse(preview.payload).input);
  assert.deepEqual(wire, summary()); assert.equal(preview.naturalQuestion, QUESTION); assert.equal(preview.questionHash, hash(QUESTION));
  assert.equal(preview.synthesisInputDigest, hash(summary())); assert.deepEqual(preview.synthesisBinding, authority().binding);
  assert.deepEqual(preview.sourceIds, [EMPTY_SOURCE, PRIVATE_SOURCE]); assert.deepEqual(preview.factIds, [FACT_ID]); assert.deepEqual(preview.rowIds, [FACT_ID]);
  assert.equal(preview.approvalRequired, true); assert.equal(preview.digest, hash(preview.payload));
  assert.match(preview.synthesisDisclosureWarning, /retained original objective.*admitted claim text.*separately from evidence Shape/i);
  for (const local of [PRIVATE_VALUE, PRIVATE_SOURCE, EMPTY_SOURCE, FACT_ID, TURN_ID, PLANNER_ID,
    'synthetic-private-receipt', 'synthetic-underlying-citation', 'SYNTHETIC RAW PRIVATE ROW']) assert.equal(preview.payload.includes(local), false, local);
  await assert.rejects(run.gateway.execute(owner, { ...request(), previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED'));
  assert.equal(run.calls(), 0); assert.deepEqual(run.store.state.conversations, []); assert.deepEqual(run.store.state.receipts, []);
});

test('Shape refuses before host resolution, credentials, receipt creation or budget reservation', async () => {
  let brokerCalls = 0; const run = await fixture({ credentialBroker: async () => { brokerCalls++; return 'synthetic credential'; } });
  run.store.state.policy.send = 'shape';
  await assert.rejects(run.gateway.preview(owner, request()), code('SYNTHESIS_DISCLOSURE_REQUIRED'));
  assert.equal(run.resolutions(), 0); assert.equal(brokerCalls, 0); assert.equal(run.calls(), 0);
  assert.deepEqual(run.store.state.modelReceipts, []); assert.equal(run.store.state.routes[0].costConsumedMinor, '0');
  run.store.state.policy.send = 'nothing'; await assert.rejects(run.gateway.preview(owner, request()), code('SEND_DISABLED'));
  assert.equal(run.resolutions(), 0);
});

test('missing resolver or incomplete host codec fails precisely without a permissive fallback', async () => {
  for (const missing of ['resolver', 'codec', 'schema', 'validate', 'materialize', 'instructions'] as const) {
    const run = await fixture();
    if (missing === 'resolver') delete run.gateway.options.conversationSynthesis;
    else if (missing === 'codec') delete run.gateway.options.synthesisCodec;
    else delete (run.gateway.options.synthesisCodec as any)[missing];
    await assert.rejects(run.gateway.preview(owner, request()), code('SYNTHESIS_UNAVAILABLE'));
    assert.equal(run.calls(), 0); assert.deepEqual(run.store.state.modelReceipts, []);
  }
});

test('RPC cannot supply evidence/schema/output/scope or a forged tool turn', async () => {
  const run = await fixture();
  for (const fields of [{ summary: summary() }, { binding: authority().binding }, { schema: {} }, { output: output() },
    { sourceIds: [] }, { branch: 'synthetic-branch' }, { period: { from: '2026-09-01', to: '2026-09-30' } },
    { samples: [] }, { profileSamples: [] }, { continuationId: 'synthetic-pending' },
  ]) await assert.rejects(run.gateway.preview(owner, { ...request(), ...fields } as ModelRequest), code('INVALID_SYNTHESIS_REQUEST'));
  for (const id of ['', '../turn', 't'.repeat(201)]) await assert.rejects(run.gateway.preview(owner, request({ toolTurnId: id })), code('INVALID_SYNTHESIS_REQUEST'));
  await assert.rejects(run.gateway.preview(owner, request({ question: QUESTION.trim() })), code('PREVIEW_REQUEST_CHANGED'));
  assert.equal(run.calls(), 0);
});

test('exact approved synthesis makes one HTTP attempt and saves wire plus normalized output for guarded readback', async () => {
  const run = await fixture(), turn = await reviewed(run); await run.gateway.configureRoute(owner, { id: 'synthetic-unused-fallback', kind: 'ollama', model: 'synthetic-fallback' });
  const result = await turn.execute(); assert.equal(result.kind, 'conversation-synthesis');
  assert.equal(run.calls(), 1); assert.equal(result.receipt.attempts, 1); assert.equal(result.receipt.plan, undefined);
  if (result.kind === 'conversation-synthesis') assert.deepEqual(result.output, output());
  const readback = run.gateway.assertSynthesisReceipt(owner, turn.preview.id);
  assert.deepEqual(readback.synthesisOutputWire, output()); assert.deepEqual(readback.synthesisOutput, output());
  assert.equal(readback.synthesisOutputWireDigest, hash(output())); assert.equal(readback.synthesisOutputDigest, hash(output()));
  assert.equal(run.calls(), 1); assert.equal(run.gateway.receipts(owner).find(record => record.id === turn.preview.id).status, 'completed');
  assert.deepEqual(run.store.state.conversations, []); assert.deepEqual(run.store.state.receipts, []);
  assert.equal(run.store.state.routes.find(route => route.id === 'synthetic-unused-fallback').costConsumedMinor, '0');
  await assert.rejects(turn.execute(), code('PREVIEW_NOT_FOUND')); assert.equal(run.calls(), 1);
});

test('changed or missing tool-turn ID and exact question fail before the separately approved transfer', async () => {
  for (const changes of [{ toolTurnId: undefined }, { toolTurnId: 'synthetic-other-turn' }, { question: QUESTION.trim() }, { routeId: 'synthetic-other-route' }]) {
    const run = await fixture(), turn = await reviewed(run); await assert.rejects(turn.execute(changes), code('PREVIEW_REQUEST_CHANGED')); assert.equal(run.calls(), 0);
  }
  const run = await fixture(), turn = await reviewed(run);
  await assert.rejects(turn.execute({ sourceIds: [] }), code('INVALID_SYNTHESIS_REQUEST')); assert.equal(run.calls(), 0);
});

test('authority result, summary or local binding changes invalidate approval and dispatch', async () => {
  for (const mutate of [
    (next: GatewaySynthesisAuthority) => { next.binding.toolResultsDigest = hash('changed ordered results'); },
    (next: GatewaySynthesisAuthority) => { (next.summary.evidence[0] as any).text = 'Changed synthetic claim.'; next.binding.inputDigest = hash(next.summary); },
    (next: GatewaySynthesisAuthority) => { next.binding.evidence[1].renderText = 'INR 777.00'; },
  ]) {
    {
      const run = await fixture(), preview = await run.gateway.preview(owner, request()), next = authority(); mutate(next); run.change(next);
      await assert.rejects(run.gateway.approveOutbound(owner, preview.id), code('SYNTHESIS_STALE')); assert.equal(run.calls(), 0);
    }
    {
      const run = await fixture(), turn = await reviewed(run), next = authority(); mutate(next); run.change(next);
      await assert.rejects(turn.execute(), code('SYNTHESIS_STALE')); assert.equal(run.calls(), 0);
    }
  }
});

test('zero-row selected source revocation prevents dispatch and withholds cached receipts', async () => {
  const run = await fixture(), turn = await reviewed(run);
  run.store.state.sourceRules.push({ sourceId: EMPTY_SOURCE, revoked: true });
  await assert.rejects(turn.execute(), code('PREVIEW_STALE')); assert.equal(run.calls(), 0);
  assert.equal(run.gateway.receipts(owner).some(record => record.id === turn.preview.id), false);
});

test('authority change across async credential retrieval is refused before approval consumption or transport', async () => {
  let run: Awaited<ReturnType<typeof fixture>>, brokerCalls = 0;
  run = await fixture({ credentialBroker: async () => { brokerCalls++; const next = authority(); next.binding.evidence[1].renderText = 'INR 555.00'; run.change(next); return 'synthetic fixture credential'; } });
  const turn = await reviewed(run); run.gateway.clearCredentials();
  await assert.rejects(turn.execute(), code('SYNTHESIS_STALE')); assert.equal(brokerCalls, 1); assert.equal(run.calls(), 0);
  assert.equal(run.store.state.modelReceipts.find(record => record.id === turn.approval.id).used, false);
});

test('authority or saved disclosure mutation during HTTP withholds completion without fallback or final answer mutation', async () => {
  for (const change of ['host', 'stored', 'question-disclosure', 'purpose', 'approval'] as const) {
    let run: Awaited<ReturnType<typeof fixture>>, receiptId = '';
    run = await fixture({ http: async () => {
      if (change === 'host') { const next = authority(); next.binding.toolResultsDigest = hash('changed during HTTP'); run.change(next); }
      else {
        const record = run.store.state.modelReceipts.find(item => item.id === receiptId);
        if (change === 'stored') delete record.synthesisDisclosure;
        if (change === 'question-disclosure') delete record.questionDisclosure;
        if (change === 'purpose') record.purpose = 'analysis';
        if (change === 'approval') record.approvalRequired = false;
      }
      return response();
    } });
    const turn = await reviewed(run); receiptId = turn.preview.id;
    await assert.rejects(turn.execute(), code('SYNTHESIS_STALE')); assert.equal(run.calls(), 1);
    const record = run.store.state.modelReceipts.find(item => item.id === receiptId); assert.equal(record.status, 'failed'); assert.equal(record.synthesisOutput, undefined);
    assert.deepEqual(run.store.state.conversations, []);
  }
});

test('invalid output or incomplete provider state never admits a plan, retries or reroutes', async () => {
  for (const fail of ['output', 'incomplete'] as const) {
    const run = await fixture({ http: async () => fail === 'output' ? response({ operation: 'billed' })
      : { ...response(), body: JSON.stringify({ status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output()) }] }] }) } });
    const turn = await reviewed(run);
    await assert.rejects(turn.execute(), code(fail === 'output' ? 'INVALID_SYNTHESIS_OUTPUT' : 'MODEL_INCOMPLETE'));
    const record = run.store.state.modelReceipts.find(item => item.id === turn.preview.id);
    assert.equal(record.status, 'failed'); assert.equal(record.plan, undefined); assert.equal(record.synthesisOutput, undefined); assert.equal(run.calls(), 1);
  }
});

test('wire/output tampering, revoked approving rights or changed current authority withhold completed readback and listing', async () => {
  for (const mutate of [
    (run: Awaited<ReturnType<typeof fixture>>, record: any) => { record.synthesisOutput.paragraphs[0].parts[0].text = 'Changed text.'; },
    (run: Awaited<ReturnType<typeof fixture>>, record: any) => { record.synthesisOutputWire.cautionRefs = []; },
    (run: Awaited<ReturnType<typeof fixture>>, record: any) => { record.synthesisOutputDigest = hash('changed'); },
    (run: Awaited<ReturnType<typeof fixture>>, record: any) => { const next = authority(); next.binding.toolResultsDigest = hash('changed retained results'); run.change(next); },
    (run: Awaited<ReturnType<typeof fixture>>, record: any) => { run.store.state.members[0].role = 'accountant'; },
  ]) {
    const run = await fixture(), turn = await reviewed(run); await turn.execute(); mutate(run, run.store.state.modelReceipts.find(item => item.id === turn.preview.id));
    assert.throws(() => run.gateway.assertSynthesisReceipt(owner, turn.preview.id));
    assert.equal(run.gateway.receipts({ ...owner, role: run.store.state.members[0].role }).some(record => record.id === turn.preview.id), false);
    assert.equal(run.calls(), 1);
  }
});

test('generic model receipt listing cannot disclose another approver account private synthesis bindings', async () => {
  const run = await fixture(), turn = await reviewed(run); await turn.execute();
  run.store.state.members.push({ id: 'synthetic-other-cofounder', name: 'Synthetic cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
  const other: Context = { memberId: 'synthetic-other-cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
  assert.equal(run.gateway.receipts(other).some(record => record.id === turn.preview.id), false);
  assert.throws(() => run.gateway.assertSynthesisReceipt(other, turn.preview.id), code('FORBIDDEN')); assert.equal(run.calls(), 1);
});

test('malformed authority references, cycles, computed fields and recursive ports refuse locally and release guards', async () => {
  for (const mutate of [
    (next: any) => { next.binding.inputDigest = hash('wrong'); },
    (next: any) => { next.binding.evidence[0].ref = 'foreign-alias'; },
    (next: any) => { next.binding.evidence.push(next.binding.evidence[0]); },
    (next: any) => { next.factIds = ['not-current-fact']; },
    (next: any) => { next.binding.evidence[0].renderText = 'x'.repeat(32769); },
    (next: any) => { next.binding.evidence[0].renderText = next; },
    (next: any) => { Object.defineProperty(next, 'summary', { enumerable: true, get: () => { throw new Error('Getter must not run'); } }); },
  ]) {
    const run = await fixture(), next: any = authority(); mutate(next); run.gateway.options.conversationSynthesis = () => next;
    await assert.rejects(run.gateway.preview(owner, request()), (error: unknown) => error instanceof ChausarError && ['INVALID_SYNTHESIS_REQUEST', 'SYNTHESIS_STALE'].includes(error.code));
    assert.equal(run.calls(), 0); assert.deepEqual(run.store.state.modelReceipts, []);
  }
  const run = await fixture(), turn = await reviewed(run); await turn.execute(); let checks = 0;
  run.gateway.options.conversationSynthesis = () => { checks++; run.gateway.assertSynthesisReceipt(owner, turn.preview.id); return authority(); };
  assert.throws(() => run.gateway.assertSynthesisReceipt(owner, turn.preview.id), code('SYNTHESIS_STALE')); assert.equal(checks, 1);
  run.gateway.options.conversationSynthesis = () => authority(); assert.equal(run.gateway.assertSynthesisReceipt(owner, turn.preview.id).status, 'completed');
});

test('budget rejection rolls back one-use approval and refuses before provider entry', async () => {
  const run = await fixture(), turn = await reviewed(run); run.store.state.routes[0].budgetMinor = '0';
  await assert.rejects(turn.execute(), code('BUDGET_EXCEEDED')); assert.equal(run.calls(), 0);
  assert.equal(run.store.state.modelReceipts.find(record => record.id === turn.approval.id).used, false);
  assert.equal(run.store.state.modelReceipts.find(record => record.id === turn.preview.id).status, 'preview');
});
