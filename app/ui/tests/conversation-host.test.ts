import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationHost, createDesktopConversationHost, createBrowserConversationHost } from '../src/bridge/conversation-host.ts';
import type { ConversationDraft, ConversationHost, ConversationHostPort, ConversationRpcPayloads, ModelConsent } from '../src/bridge/conversation-host.ts';
import type { ConversationRequest, ConversationRpcPort } from '../src/bridge/conversation-contract.ts';
import { planningPreviewFixture, approvalFixture, groundedFixture, synthesisPreviewFixture, synthesisReplyFixture, continuationFixture, readbackFixture } from './conversation-fixtures.ts';

type Method = keyof ConversationRpcPayloads;
interface Call { readonly method: Method; readonly payload: unknown }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixturePort(reply: (method: Method, payload: unknown) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const port: ConversationHostPort = {
    async request(method, payload) { calls.push({ method, payload: structuredClone(payload) }); return reply(method, payload); },
  };
  return { port, calls };
}
const draft = (question = '  What was billed?  '): ConversationDraft => ({
  question, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'route_fixture', sourceIds: [],
});
const fixtureNow = () => Date.parse('2026-10-01T10:00:00.000Z');
function consentFor(host: ConversationHost): ModelConsent {
  const state = host.snapshot();
  assert.equal(state.kind, 'review');
  if (state.kind !== 'review') throw Error('Expected reviewed fixture');
  return { previewId: state.preview.id, digest: state.preview.digest, consent: true };
}
function planningFlow(input = draft()) {
  const preview = planningPreviewFixture(input), answer = groundedFixture(preview.id), saved = readbackFixture(answer, input.question);
  const fixture = fixturePort(method => {
    switch (method) {
      case 'models.preview': return preview;
      case 'models.approve': return approvalFixture(preview);
      case 'conversation.ask': return answer;
      case 'conversation.get': return saved;
      default: throw Error('Unexpected fixture request');
    }
  });
  return { ...fixture, preview, answer, saved, host: createConversationHost(fixture.port, { now: fixtureNow }) };
}

test('invalid question and caller-authored continuation never reach the injected port', async () => {
  const fixture = fixturePort(() => { throw Error('Unexpected request'); });
  const host = createConversationHost(fixture.port);
  assert.deepEqual(await host.preview(draft('   ')), { ok: false, code: 'INVALID_REPLY' });
  assert.deepEqual(await host.preview({ ...draft(), continuationId: 'caller_authored' } as ConversationDraft), { ok: false, code: 'INVALID_REPLY' });
  assert.equal(fixture.calls.length, 0);
});

test('cancelling before a delayed preview reply discards it without approval or dispatch', async () => {
  const response = deferred<unknown>();
  const fixture = fixturePort(() => response.promise);
  const host = createConversationHost(fixture.port);
  const pending = host.preview(draft());
  host.cancel(); response.resolve({ malformed: true });
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(host.snapshot(), { kind: 'idle' });
  assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview']);
});

test('synchronous authority invalidation by an observer prevents the first RPC', async () => {
  const fixture = fixturePort(() => { throw Error('Unexpected request'); });
  const host = createConversationHost(fixture.port);
  const unsubscribe = host.subscribe(() => { if (host.snapshot().kind === 'busy') host.invalidate('VAULT_LOCKED'); });
  assert.deepEqual(await host.preview(draft()), { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'VAULT_LOCKED' });
  assert.equal(fixture.calls.length, 0); unsubscribe();
});

test('planning review alone sends no model request and explicit consent reuses the exact frozen question and scope', async () => {
  const input = { ...draft(), sourceIds: ['source_fixture'], period: { from: '2026-09-01', to: '2026-09-30' } };
  const fixture = planningFlow(input);
  assert.deepEqual(await fixture.host.preview(input), { ok: true });
  assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview']);
  const reviewed = fixture.host.snapshot();
  assert.equal(reviewed.kind, 'review');
  if (reviewed.kind !== 'review' || reviewed.stage !== 'planning') throw Error('Expected planning review');
  assert.ok(Object.isFrozen(reviewed) && Object.isFrozen(reviewed.request.sourceIds) && Object.isFrozen(reviewed.request.period));
  input.sourceIds.push('source_changed'); input.period.from = '2026-01-01';
  assert.deepEqual(await fixture.host.sendReviewed(consentFor(fixture.host)), { ok: true });
  assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview', 'models.approve', 'conversation.ask', 'conversation.get']);
  assert.deepEqual(fixture.calls[2]?.payload, { ...reviewed.request, previewId: fixture.preview.id, approvalId: approvalFixture(fixture.preview).id });
  assert.equal(reviewed.request.question, '  What was billed?  ');
  assert.equal(fixture.host.snapshot().kind, 'answer');
});

test('missing consent or consent for a different payload never requests approval', async () => {
  const fixture = planningFlow(); await fixture.host.preview(draft());
  const consent = consentFor(fixture.host);
  assert.deepEqual(await fixture.host.sendReviewed({ ...consent, consent: false }), { ok: false, code: 'CONSENT_REQUIRED' });
  assert.deepEqual(await fixture.host.sendReviewed({ ...consent, digest: '0'.repeat(64) }), { ok: false, code: 'REVIEW_CHANGED' });
  assert.deepEqual(await fixture.host.sendReviewed({ ...consent, previewId: 'other_preview' }), { ok: false, code: 'REVIEW_CHANGED' });
  assert.equal(fixture.host.snapshot().kind, 'review'); assert.equal(fixture.calls.length, 1);
});

test('a double consent press consumes the local review before asynchronous approval', async () => {
  const approval = deferred<unknown>(), preview = planningPreviewFixture(draft()), answer = groundedFixture(preview.id);
  const fixture = fixturePort(method => {
    if (method === 'models.preview') return preview;
    if (method === 'models.approve') return approval.promise;
    if (method === 'conversation.ask') return answer;
    if (method === 'conversation.get') return readbackFixture(answer);
    throw Error('Unexpected fixture request');
  });
  const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
  const consent = consentFor(host), pending = host.sendReviewed(consent);
  assert.deepEqual(await host.sendReviewed(consent), { ok: false, code: 'REVIEW_CHANGED' });
  approval.resolve(approvalFixture(preview)); assert.deepEqual(await pending, { ok: true });
  assert.equal(fixture.calls.filter(call => call.method === 'models.approve').length, 1);
  assert.equal(fixture.calls.filter(call => call.method === 'conversation.ask').length, 1);
  assert.deepEqual(await host.sendReviewed(consent), { ok: false, code: 'REVIEW_CHANGED' });
});

test('cancellation during approval prevents dispatch even when a valid approval arrives', async () => {
  const approval = deferred<unknown>(), preview = planningPreviewFixture(draft());
  const fixture = fixturePort(method => method === 'models.preview' ? preview : approval.promise);
  const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
  const pending = host.sendReviewed(consentFor(host)); host.cancel(); approval.resolve(approvalFixture(preview));
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(host.snapshot(), { kind: 'idle' });
  assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview', 'models.approve']);
});

test('approval identity, endpoint, used state and expiry are checked before any ask', async () => {
  const preview = planningPreviewFixture(draft());
  for (const changed of [
    { digest: '0'.repeat(64) }, { routeId: 'other_route' }, { endpoint: 'https://other-fixture.invalid/v1/responses' }, { used: true },
    { expiresAt: '2026-10-01T10:00:00.000Z' },
  ]) {
    const fixture = fixturePort(method => method === 'models.preview' ? preview : { ...approvalFixture(preview), ...changed });
    const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
    const expected = 'expiresAt' in changed ? 'APPROVAL_EXPIRED' : 'INVALID_REPLY';
    assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: false, code: expected });
    assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: expected });
    assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview', 'models.approve']);
  }
});

test('consent accessors cannot dispatch and reentrant consent proxies cannot revive a canceled review', async () => {
  const fixture = planningFlow(); await fixture.host.preview(draft());
  const consent = consentFor(fixture.host); let getterCalls = 0;
  const accessor = { ...consent };
  Object.defineProperty(accessor, 'previewId', { enumerable: true, get() { getterCalls += 1; fixture.host.cancel(); return consent.previewId; } });
  assert.deepEqual(await fixture.host.sendReviewed(accessor), { ok: false, code: 'CONSENT_REQUIRED' });
  assert.equal(getterCalls, 0); assert.equal(fixture.host.snapshot().kind, 'review');
  const proxy = new Proxy(consent, { ownKeys(target) { fixture.host.cancel(); return Reflect.ownKeys(target); } });
  assert.deepEqual(await fixture.host.sendReviewed(proxy), { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.calls.length, 1); assert.deepEqual(fixture.host.snapshot(), { kind: 'idle' });
});

test('reentrant clock or ask observer invalidation cannot overwrite authority state or dispatch', async () => {
  for (const boundary of ['clock', 'ask-observer'] as const) {
    const preview = planningPreviewFixture(draft()), fixture = fixturePort(method => method === 'models.preview' ? preview : approvalFixture(preview));
    let host!: ConversationHost;
    host = createConversationHost(fixture.port, { now: () => { if (boundary === 'clock') host.invalidate('ACCESS_DENIED'); return fixtureNow(); } });
    if (boundary === 'ask-observer') host.subscribe(() => {
      const state = host.snapshot(); if (state.kind === 'busy' && state.operation === 'ask') host.invalidate('ACCESS_DENIED');
    });
    await host.preview(draft());
    assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: false, code: 'READ_INVALIDATED' });
    assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'ACCESS_DENIED' });
    assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview', 'models.approve']);
  }
});

test('an active fresh read immediately clears the old body and revoked, stale or unavailable replies remain cleared', async () => {
  const saved = readbackFixture(groundedFixture());
  for (const [engineCode, expected] of [['SOURCE_REVOKED', 'ACCESS_DENIED'], ['ROUTE_REVOKED', 'ACCESS_DENIED'], ['INVALID_SESSION', 'UNAUTHENTICATED'], ['PREVIEW_STALE', 'STALE_EVIDENCE'], ['CONVERSATION_NOT_FOUND', 'EVIDENCE_UNAVAILABLE']] as const) {
    const pendingRead = deferred<unknown>(); let reads = 0;
    const fixture = fixturePort(() => ++reads === 1 ? saved : pendingRead.promise);
    const host = createConversationHost(fixture.port); assert.deepEqual(await host.open(saved.id), { ok: true });
    const pending = host.open(saved.id); assert.deepEqual(host.snapshot(), { kind: 'busy', operation: 'readback' });
    pendingRead.reject({ code: engineCode, message: 'Private provider detail must not be displayed' });
    assert.deepEqual(await pending, { ok: false, code: expected });
    assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: expected });
  }
});

test('a newer fresh read wins over an earlier preview, regardless of reply order', async () => {
  const earlier = deferred<unknown>(), saved = readbackFixture(groundedFixture());
  const fixture = fixturePort(method => method === 'models.preview' ? earlier.promise : saved);
  const host = createConversationHost(fixture.port), first = host.preview(draft());
  assert.deepEqual(await host.open(saved.id), { ok: true }); const visible = host.snapshot();
  earlier.resolve(planningPreviewFixture(draft()));
  assert.deepEqual(await first, { ok: false, code: 'READ_INVALIDATED' }); assert.equal(host.snapshot(), visible);
});

test('fresh readback must match the just-dispatched reply and exact reviewed question', async () => {
  for (const drift of ['question', 'answer', 'id'] as const) {
    const preview = planningPreviewFixture(draft()), answer = groundedFixture(preview.id), saved = readbackFixture(answer);
    const replacement = drift === 'answer' ? { ...answer, results: [{ tool: 'calculator.calculate', error: { code: 'NO_DATA', message: 'Unavailable' } }], receipt: { ...answer.receipt, resultRefs: [] } } : answer;
    const changed = { ...saved, ...(drift === 'question' ? { question: 'A different question' } : {}), ...(drift === 'id' ? { id: 'other_turn' } : {}), answer: replacement };
    const fixture = fixturePort(method => method === 'models.preview' ? preview : method === 'models.approve' ? approvalFixture(preview) : method === 'conversation.ask' ? answer : changed);
    const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
    assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: false, code: 'INVALID_REPLY' });
    assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'INVALID_REPLY' });
  }
});

test('clarification resolves its server receipt alias with a fresh get and selects only the canonical server turn', async () => {
  const preview = planningPreviewFixture(draft()), reply = { clarification: 'Which period should I use?', modelReceiptId: preview.id }, saved = readbackFixture(reply);
  const fixture = fixturePort(method => {
    if (method === 'models.preview') return preview;
    if (method === 'models.approve') return approvalFixture(preview);
    if (method === 'conversation.ask') return reply;
    if (method === 'conversation.get') return saved;
    if (method === 'conversation.continuation') return continuationFixture(saved.id);
    throw Error('Unexpected fixture request');
  });
  const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
  assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: true });
  assert.deepEqual(fixture.calls[3]?.payload, { id: preview.id });
  assert.deepEqual(await host.selectContinuation(saved.id), { ok: true });
  assert.deepEqual(fixture.calls[4]?.payload, { id: saved.id }); assert.equal(host.snapshot().kind, 'continuation');
});

test('editing preserves only the checked continuation while canceling the prior review and exact clarification draft', async () => {
  const id = 'conversation_clarification_fixture', fixture = fixturePort((method, payload) => {
    if (method === 'conversation.continuation') return continuationFixture(id);
    if (method === 'models.preview') return planningPreviewFixture(payload as ConversationRequest);
    throw Error('Unexpected fixture request');
  });
  const host = createConversationHost(fixture.port);
  await host.selectContinuation(id); await host.preview(draft('September')); const oldConsent = consentFor(host);
  host.editQuestion(); assert.equal(host.snapshot().kind, 'continuation');
  assert.deepEqual(await host.sendReviewed(oldConsent), { ok: false, code: 'REVIEW_CHANGED' });
  assert.deepEqual(await host.preview(draft('  August instead  ')), { ok: true });
  assert.deepEqual(fixture.calls[2]?.payload, { ...draft('  August instead  '), continuationId: id });
  host.cancel(); assert.deepEqual(host.snapshot(), { kind: 'idle' });
  assert.deepEqual(await host.preview(draft('A fresh question')), { ok: true });
  assert.deepEqual(fixture.calls[3]?.payload, draft('A fresh question'));
});

test('editing an in-flight clarification review retains its server continuation and rejects the late old preview', async () => {
  const id = 'conversation_clarification_fixture', earlier = deferred<unknown>(); let previews = 0;
  const fixture = fixturePort((method, payload) => {
    if (method === 'conversation.continuation') return continuationFixture(id);
    if (method === 'models.preview') return ++previews === 1 ? earlier.promise : planningPreviewFixture(payload as ConversationRequest);
    throw Error('Unexpected fixture request');
  });
  const host = createConversationHost(fixture.port); await host.selectContinuation(id);
  const pending = host.preview(draft('September')); host.editQuestion();
  assert.equal(host.snapshot().kind, 'continuation');
  assert.deepEqual(await host.preview(draft('August')), { ok: true }); const visible = host.snapshot();
  earlier.resolve(planningPreviewFixture({ ...draft('September'), continuationId: id }));
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' }); assert.equal(host.snapshot(), visible);
  assert.deepEqual(fixture.calls[2]?.payload, { ...draft('August'), continuationId: id });
});

test('continuation rejection is shown without falling back to a new question or retry', async () => {
  const id = 'conversation_clarification_fixture', fixture = fixturePort(method => {
    if (method === 'conversation.continuation') return continuationFixture(id);
    throw { code: 'CONVERSATION_CONTINUATION_RESOLVED' };
  });
  const host = createConversationHost(fixture.port); await host.selectContinuation(id);
  assert.deepEqual(await host.preview(draft('September')), { ok: false, code: 'CONTINUATION_RESOLVED' });
  assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'CONTINUATION_RESOLVED' });
  assert.deepEqual(fixture.calls.map(call => call.method), ['conversation.continuation', 'models.preview']);
});

test('final writing requires a second separately reviewed consent and dispatches only retained tool ID', async () => {
  const planning = planningPreviewFixture(draft()), tools = groundedFixture(planning.id), writing = synthesisPreviewFixture(tools), final = synthesisReplyFixture(tools, writing);
  const fixture = fixturePort((method, payload) => {
    if (method === 'models.preview') return planning;
    if (method === 'models.approve') return approvalFixture((payload as { id: string }).id === planning.id ? planning : writing);
    if (method === 'conversation.ask') return tools;
    if (method === 'conversation.get') return readbackFixture((payload as { id: string }).id === tools.id ? tools : final);
    if (method === 'conversation.synthesis.preview') return writing;
    if (method === 'conversation.synthesis.run') return final;
    throw Error('Unexpected fixture request');
  });
  const host = createConversationHost(fixture.port, { now: fixtureNow });
  assert.deepEqual(await host.previewFinalWriting(), { ok: false, code: 'NO_TOOL_TURN' }); assert.equal(fixture.calls.length, 0);
  await host.preview(draft()); const planningConsent = consentFor(host); await host.sendReviewed(planningConsent);
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(await host.previewFinalWriting(), { ok: true });
  assert.deepEqual(fixture.calls[4], { method: 'conversation.synthesis.preview', payload: { id: tools.id } });
  assert.deepEqual(await host.sendReviewed(planningConsent), { ok: false, code: 'REVIEW_CHANGED' }); assert.equal(fixture.calls.length, 5);
  assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: true });
  assert.deepEqual(fixture.calls[6], { method: 'conversation.synthesis.run', payload: { id: tools.id, previewId: writing.id, approvalId: approvalFixture(writing).id } });
  const result = host.snapshot(); assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') assert.equal(result.saved.kind, 'synthesized-conversation');
  assert.deepEqual(await host.previewFinalWriting(), { ok: false, code: 'NO_TOOL_TURN' });
});

test('final writing rejects changed input digest, canonical caution, reference alias or retained tool body before fresh readback', async () => {
  for (const drift of ['inputDigest', 'caution', 'reference', 'tools'] as const) {
    const tools = groundedFixture(), writing = synthesisPreviewFixture(tools), final = synthesisReplyFixture(tools, writing);
    const retained = structuredClone(tools);
    if (drift === 'inputDigest') final.receipt.inputDigest = '0'.repeat(64);
    else if (drift === 'caution') final.cautions[0]!.text = 'An invented caution';
    else if (drift === 'reference') final.references[0]!.evidenceRefs = ['e999'];
    else {
      const result = final.tools.results[0]!;
      final.tools = { ...final.tools, results: [{ ...result, answer: { ...result.answer,
        figures: result.answer.figures.map((figure, index) => index === 0 ? { ...figure, display: '₹999.00' } : figure),
      } }] };
    }
    const fixture = fixturePort(method => {
      if (method === 'conversation.get') return readbackFixture(retained);
      if (method === 'conversation.synthesis.preview') return writing;
      if (method === 'models.approve') return approvalFixture(writing);
      if (method === 'conversation.synthesis.run') return final;
      throw Error('Unexpected fixture request');
    });
    const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.open(tools.id); await host.previewFinalWriting();
    assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: false, code: 'INVALID_REPLY' });
    assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'INVALID_REPLY' });
    assert.equal(fixture.calls.filter(call => call.method === 'conversation.get').length, 1);
  }
});

test('cancellation during the post-dispatch fresh read withholds its late body without retrying the dispatched call', async () => {
  const preview = planningPreviewFixture(draft()), answer = groundedFixture(preview.id), readEntered = deferred<void>(), read = deferred<unknown>();
  const fixture = fixturePort(method => {
    if (method === 'models.preview') return preview;
    if (method === 'models.approve') return approvalFixture(preview);
    if (method === 'conversation.ask') return answer;
    if (method === 'conversation.get') { readEntered.resolve(); return read.promise; }
    throw Error('Unexpected fixture request');
  });
  const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
  const pending = host.sendReviewed(consentFor(host)); await readEntered.promise;
  host.cancel(); read.resolve(readbackFixture(answer));
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' }); assert.deepEqual(host.snapshot(), { kind: 'idle' });
  assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview', 'models.approve', 'conversation.ask', 'conversation.get']);
});

test('a dispatched provider failure is sanitized and never automatically retried or synthesized', async () => {
  const preview = planningPreviewFixture(draft()), fixture = fixturePort(method => {
    if (method === 'models.preview') return preview;
    if (method === 'models.approve') return approvalFixture(preview);
    throw Error('Private provider request body');
  });
  const host = createConversationHost(fixture.port, { now: fixtureNow }); await host.preview(draft());
  assert.deepEqual(await host.sendReviewed(consentFor(host)), { ok: false, code: 'REQUEST_FAILED' });
  assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'REQUEST_FAILED' });
  assert.deepEqual(fixture.calls.map(call => call.method), ['models.preview', 'models.approve', 'conversation.ask']);
});

test('desktop and browser host seams use only their typed injected methods without transport discovery', async () => {
  const saved = readbackFixture(groundedFixture()), desktop = fixturePort(() => saved);
  assert.deepEqual(await createDesktopConversationHost(desktop.port).open(saved.id), { ok: true });
  const messages: { readonly method: Method; readonly payload: unknown }[] = [];
  const rpc: ConversationRpcPort = { async call(message) { messages.push(structuredClone(message)); return saved; } };
  assert.deepEqual(await createBrowserConversationHost(rpc).open(saved.id), { ok: true });
  assert.deepEqual(messages, [{ method: 'conversation.get', payload: { id: saved.id } }]);
  assert.deepEqual(desktop.calls, messages);
});

test('reentrant reply or error descriptors cannot replace a newer invalidated state', async () => {
  for (const boundary of ['reply', 'error'] as const) {
    const saved = readbackFixture(groundedFixture()); let host!: ConversationHost;
    const fixture = fixturePort(() => {
      if (boundary === 'reply') return new Proxy(saved, { ownKeys(target) { host.invalidate('ACCESS_DENIED'); return Reflect.ownKeys(target); } });
      throw new Proxy({ code: 'CONVERSATION_NOT_FOUND' }, { getOwnPropertyDescriptor(target, key) {
        host.invalidate('ACCESS_DENIED'); return Reflect.getOwnPropertyDescriptor(target, key);
      } });
    });
    host = createConversationHost(fixture.port);
    assert.deepEqual(await host.open(saved.id), { ok: false, code: 'READ_INVALIDATED' });
    assert.deepEqual(host.snapshot(), { kind: 'unavailable', code: 'ACCESS_DENIED' });
  }
});
