import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostController, currentMonth } from '../src/host/controller.ts';
import type { HostController } from '../src/host/controller.ts';
import { validateModelRoutes, validateUiContext } from '../src/host/contracts.ts';
import type { HostRpcPayloads, HostRpcPort } from '../src/host/contracts.ts';
import type { ConversationRequest } from '../src/bridge/conversation-contract.ts';
import type { ModelConsent } from '../src/bridge/conversation-host.ts';
import { approvalFixture, groundedFixture, planningPreviewFixture, readbackFixture, synthesisPreviewFixture, synthesisReplyFixture } from './conversation-fixtures.ts';
import { fullCalculationReceiptFixture, HUGE_INTEGER } from './fixtures.ts';

/** Synthetic host transport; no real vault, network, process or model dispatch. */
const context = (contextKey = 'a'.repeat(64)) => ({ workspace: { id: 'workspace_fixture', name: 'Synthetic host fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role: 'owner', epoch: 1, branches: ['*'] }, contextKey });
const route = { id: 'route_fixture', kind: 'codex-cli', model: 'model_fixture', enabled: true, installationVerified: false, label: 'Synthetic route' };
const clock = () => Date.parse('2026-10-03T12:00:00.000Z');
function receipt(operation: string) {
  const fixture = fullCalculationReceiptFixture();
  const rows = fixture.rows.map(row => ({ ...row, validFrom: '2026-10-01' }));
  const common = { ...fixture, id: `receipt_${operation}`, operation, period: { from: '2026-10-01', to: '2026-10-31' }, rows };
  if (operation === 'margin') return common;
  return { ...common, figures: [{ key: 'total', label: `Fixture ${operation}`, minor: HUGE_INTEGER, display: 'Engine exact synthetic display', unit: 'money', currency: 'INR' }], valueMinor: HUGE_INTEGER, totalMinor: HUGE_INTEGER, allowedNumbers: [HUGE_INTEGER] };
}
function dashboard(receipts = ['billed', 'received', 'earned', 'margin'].map(receipt)) {
  return { workspace: { ...context().workspace, currency: 'INR', createdAt: '2026-10-01T09:00:00.000Z' }, calculations: receipts, factCount: 3, sources: 2, decisions: [], waitingActions: [], jobs: [], policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, dictionary: null, lastActivity: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const refusal = (code: string) => Object.assign(Error(code), { code });
/** The exact displayed review, consented once; a clicked consent must name the displayed preview and payload. */
function consentFor(host: HostController): ModelConsent {
  const state = host.conversation.snapshot();
  if (state.kind !== 'review') throw Error('Expected a displayed review');
  return { previewId: state.preview.id, digest: state.preview.digest, consent: true };
}
/** The reviewed question as the frame submits it; the route is the one the host selected. */
const reviewedRequest: ConversationRequest = { question: '  What was billed?  ', purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'route_fixture' };
/** A valid empty released page: nothing is listed, nothing is reopened. */
const emptyDiscoveryPage = () => ({ mode: 'retained-revisions', items: [], nextCursor: null, noAction: true });
function transport(reply?: (method: keyof HostRpcPayloads, payload: unknown) => unknown | Promise<unknown>) {
  const calls: { method: keyof HostRpcPayloads; payload: unknown }[] = [];
  const port: HostRpcPort = { async request(method, payload) {
    calls.push({ method, payload: structuredClone(payload) });
    if (reply) return reply(method, payload);
    if (method === 'ui.context') return context();
    if (method === 'dashboard.get') return dashboard();
    if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
    if (method === 'models.list') return [route];
    if (method === 'workspace.lock') return { locked: true };
    throw Error('Unexpected synthetic dispatch');
  } };
  const count = (method: keyof HostRpcPayloads): number => calls.filter(call => call.method === method).length;
  return { port, calls, count };
}

test('calendar month is explicit in the host timezone, including leap day', () => {
  assert.deepEqual(currentMonth(Date.parse('2024-03-01T00:15:00.000Z'), 'America/Los_Angeles'), { date: '2024-02-29', period: { from: '2024-02-01', to: '2024-02-29' } });
  assert.throws(() => currentMonth(NaN, 'UTC'));
});
test('mount refresh reads current-month Today and every receipt without choosing or calling a model', async () => {
  const fixture = transport(), host = createHostController(fixture.port, { now: clock });
  await host.refresh();
  assert.equal(host.snapshot().phase, 'ready');
  assert.equal(host.snapshot().today?.statsEvidence.length, 3);
  assert.equal(host.snapshot().today?.statsEvidence[0]?.engineFigure.minor, HUGE_INTEGER);
  assert.equal(host.snapshot().selectedRouteId, null);
  assert.equal(host.questionSettings(), null);
  assert.deepEqual(fixture.calls.find(call => call.method === 'dashboard.get')?.payload, { period: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(fixture.calls.filter(call => call.method === 'receipts.get').length, 4);
  assert.equal(fixture.calls.filter(call => call.method === 'models.list').length, 1);
  assert.equal(fixture.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask', 'models.test'].includes(call.method)), false);
  host.dispose();
});
test('route selection is explicit, checked, stable and clears prior private selection', async () => {
  const fixture = transport(), host = createHostController(fixture.port, { now: clock });
  await host.refresh();
  host.selectRoute('route_fixture');
  const settings = host.questionSettings();
  assert.equal(settings?.routeId, 'route_fixture');
  assert.equal(host.questionSettings(), settings);
  await host.openReceipt('receipt_billed', { place: 'today', sub: 'today', sheet: 'receipt_billed' });
  assert.equal(host.snapshot().receipt?.kind, 'ready');
  assert.equal(fixture.calls.filter(call => call.method === 'receipts.get').length, 5);
  host.selectRoute(null);
  assert.equal(host.questionSettings(), null);
  assert.equal(host.snapshot().receipt, null);
  host.selectRoute('route_not_in_catalogue');
  assert.equal(host.snapshot().phase, 'unavailable');
  assert.equal(host.snapshot().today, null);
  host.dispose();
});
test('context replacement during an awaited aggregate clears every private surface', async () => {
  const waiting = deferred<unknown>(); let key = 'a'.repeat(64);
  const fixture = transport(method => {
    if (method === 'ui.context') return context(key);
    if (method === 'dashboard.get') return waiting.promise;
    throw Error('Receipt read must not begin after authority change');
  });
  const host = createHostController(fixture.port, { now: clock }), refresh = host.refresh();
  for (let count = 0; count < 8 && !fixture.calls.some(call => call.method === 'dashboard.get'); count++) await Promise.resolve();
  assert.equal(fixture.calls.some(call => call.method === 'dashboard.get'), true);
  key = 'b'.repeat(64); waiting.resolve(dashboard()); await refresh;
  assert.equal(host.snapshot().context, null);
  assert.equal(host.snapshot().today, null);
  assert.deepEqual(host.snapshot().routes, []);
  assert.equal(host.snapshot().code, 'ACCESS_DENIED');
  host.dispose();
});
test('lock clears evidence before its transport completes and discards old receipt replies', async () => {
  const waiting = deferred<unknown>(), locking = deferred<unknown>(); let holdReceipt = false;
  const fixture = transport((method, payload) => {
    if (method === 'ui.context') return context();
    if (method === 'dashboard.get') return dashboard();
    if (method === 'models.list') return [route];
    if (method === 'receipts.get') return holdReceipt ? waiting.promise : receipt((payload as { id: string }).id.slice('receipt_'.length));
    if (method === 'workspace.lock') return locking.promise;
    throw Error('Unexpected synthetic call');
  });
  const host = createHostController(fixture.port, { now: clock }); await host.refresh(); holdReceipt = true;
  const reading = host.openReceipt('receipt_billed', { place: 'today', sub: 'today', sheet: 'receipt_billed' });
  for (let count = 0; count < 8 && fixture.calls.filter(call => call.method === 'receipts.get').length < 5; count++) await Promise.resolve();
  const locked = host.lock();
  assert.equal(host.snapshot().phase, 'locked'); assert.equal(host.snapshot().today, null); assert.equal(host.snapshot().receipt, null);
  waiting.resolve(receipt('billed')); locking.resolve({ locked: true }); await reading; await locked;
  assert.equal(host.snapshot().phase, 'locked'); assert.equal(host.snapshot().receipt, null); host.dispose();
});
test('receipt replacement and disposal cannot release an earlier reply', async () => {
  const waiting = deferred<unknown>(); let holdReceipt = false;
  const fixture = transport((method, payload) => {
    if (method === 'ui.context') return context();
    if (method === 'dashboard.get') return dashboard();
    if (method === 'models.list') return [route];
    if (method === 'receipts.get') return holdReceipt ? waiting.promise : receipt((payload as { id: string }).id.slice('receipt_'.length));
    throw Error('Unexpected synthetic call');
  });
  const host = createHostController(fixture.port, { now: clock }); await host.refresh(); holdReceipt = true;
  const reading = host.openReceipt('receipt_billed', { place: 'today', sub: 'today', sheet: 'receipt_billed' });
  host.closeReceipt(); host.dispose(); waiting.resolve(receipt('billed')); await reading;
  assert.equal(host.snapshot().today, null); assert.equal(host.snapshot().receipt, null);
});
test('malformed context/catalogue and accessors fail without evaluation or private output', () => {
  assert.throws(() => validateUiContext({ ...context(), secret: 'not-a-context-field' }));
  assert.throws(() => validateModelRoutes([{ ...route, installationVerified: true }]));
  assert.throws(() => validateModelRoutes([route, route]));
  let accessed = false;
  const malformed = { ...context() }; Object.defineProperty(malformed, 'contextKey', { enumerable: true, get() { accessed = true; return 'bad'; } });
  assert.throws(() => validateUiContext(malformed)); assert.equal(accessed, false);
});
test('an Ask intent cannot preview an unselected route', async () => {
  const fixture = transport(), host = createHostController(fixture.port, { now: clock }); await host.refresh();
  const result = await host.conversation.preview({ question: '  Fixture question  ', purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'route_fixture' });
  assert.equal(result.ok, false);
  assert.equal(fixture.calls.some(call => call.method === 'models.preview'), false);
  assert.equal(host.snapshot().context, null); assert.equal(host.snapshot().code, 'ACCESS_DENIED'); host.dispose();
});
test('a viewer may hide its own workspace without issuing the admin-only Engine lock', async () => {
  const fixture = transport((method, payload) => {
    if (method === 'ui.context') return { ...context(), member: { ...context().member, role: 'viewer' } };
    if (method === 'dashboard.get') return dashboard();
    if (method === 'models.list') return [route];
    if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
    throw Error('Viewer must not invoke Engine lock');
  });
  const host = createHostController(fixture.port, { now: clock }); await host.refresh();
  host.selectRoute('route_fixture'); assert.equal(host.questionSettings(), null);
  await host.lock(); assert.equal(host.snapshot().phase, 'locked'); assert.equal(host.snapshot().today, null);
  const beforeRefresh = fixture.calls.length; await host.refresh(); assert.equal(fixture.calls.length, beforeRefresh);
  assert.equal(fixture.calls.some(call => call.method === 'workspace.lock'), false); host.dispose();
});
test('idle authority checks read metadata only and clear private evidence on replacement', async () => {
  let key = 'a'.repeat(64);
  const fixture = transport((method, payload) => {
    if (method === 'ui.context') return context(key);
    if (method === 'dashboard.get') return dashboard();
    if (method === 'models.list') return [route];
    if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
    throw Error('Unexpected synthetic call');
  });
  const host = createHostController(fixture.port, { now: clock }); await host.refresh();
  const callCount = fixture.calls.length; key = 'b'.repeat(64); await host.checkAuthority();
  assert.deepEqual(fixture.calls.slice(callCount).map(call => call.method), ['ui.context']);
  assert.equal(host.snapshot().today, null); assert.equal(host.snapshot().context, null); assert.equal(host.snapshot().code, 'ACCESS_DENIED'); host.dispose();
});

/* ---------- Conversation operations at the host seam: each RPC carries its own operation guard ---------- */
test('a conversation readback cancelled while the host holds its own before-dispatch context read issues no raw request; the host and the next readback are unaffected', async () => {
  const saved = readbackFixture(groundedFixture()), reached = deferred<void>(), held = deferred<void>(); let armed = false;
  const fixture = transport(async (method, payload) => {
    if (method === 'ui.context') { if (armed) { armed = false; reached.resolve(); await held.promise; } return context(); }
    if (method === 'dashboard.get') return dashboard();
    if (method === 'models.list') return [route];
    if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
    if (method === 'conversation.get') return saved;
    throw Error(`Unexpected synthetic dispatch ${String(method)}`);
  });
  const host = createHostController(fixture.port, { now: clock }); await host.refresh();
  const before = fixture.calls.length; armed = true;
  const pending = host.conversation.open(saved.id);
  // The conversation published its busy readback and the host's own inner context read is held; no raw readback was issued.
  await reached.promise;
  assert.deepEqual(host.conversation.snapshot(), { kind: 'busy', operation: 'readback' }); assert.equal(fixture.count('conversation.get'), 0);
  // The explicit cancellation publishes idle while that inner read is still held.
  host.conversation.cancel();
  assert.deepEqual(host.conversation.snapshot(), { kind: 'idle' });
  held.resolve();
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' });
  // The released unchanged context reached the raw boundary and the operation's own guard refused it there: zero raw requests.
  assert.equal(fixture.count('conversation.get'), 0);
  assert.deepEqual(fixture.calls.slice(before).map(call => call.method), ['ui.context']);
  assert.deepEqual(host.conversation.snapshot(), { kind: 'idle' });
  assert.equal(host.snapshot().phase, 'ready'); assert.notEqual(host.snapshot().context, null); assert.notEqual(host.snapshot().today, null);
  // The next journey is unaffected: a fresh readback is issued once and read back.
  assert.deepEqual(await host.conversation.open(saved.id), { ok: true });
  assert.equal(fixture.count('conversation.get'), 1); assert.equal(host.conversation.snapshot().kind, 'answer');
  assert.equal(host.snapshot().phase, 'ready'); host.dispose();
});
test('an issued readback denied after its cancellation or replacement invalidates nothing and leaves the newer journey current; the same denial of a live readback still makes the whole host unavailable', async () => {
  for (const outcome of ['cancelled', 'replaced', 'live'] as const) {
    const saved = readbackFixture(groundedFixture()), denial = deferred<unknown>(); let hold = false;
    const fixture = transport((method, payload) => {
      if (method === 'ui.context') return context();
      if (method === 'dashboard.get') return dashboard();
      if (method === 'models.list') return [route];
      if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
      if (method === 'scenarios.discover') return emptyDiscoveryPage();
      if (method === 'conversation.get') return hold ? denial.promise : saved;
      throw Error(`Unexpected synthetic dispatch ${String(method)}`);
    });
    const host = createHostController(fixture.port, { now: clock }); await host.refresh(); hold = true;
    const pending = host.conversation.open(saved.id);
    // The raw readback was actually issued and is held.
    for (let i = 0; i < 64 && fixture.count('conversation.get') < 1; i++) await Promise.resolve();
    assert.equal(fixture.count('conversation.get'), 1, outcome);
    if (outcome === 'cancelled') {
      host.conversation.cancel();
      // The newer journey, a fresh what-if discovery, starts and completes while the cancelled readback is still held.
      assert.deepEqual(await host.retained.readDiscovery(), { ok: true });
      assert.equal(host.retained.snapshot().discovery.kind, 'ready');
    } else if (outcome === 'replaced') {
      hold = false;
      assert.deepEqual(await host.conversation.open(saved.id), { ok: true });
      assert.equal(host.conversation.snapshot().kind, 'answer');
    }
    // The held raw call is then denied by name: an evidence denial that would invalidate a live operation's host.
    denial.reject(refusal('EVIDENCE_UNAVAILABLE'));
    assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' }, outcome);
    if (outcome === 'live') {
      assert.equal(host.snapshot().phase, 'unavailable'); assert.equal(host.snapshot().code, 'EVIDENCE_UNAVAILABLE');
      assert.equal(host.snapshot().context, null); assert.equal(host.snapshot().today, null);
      assert.deepEqual(host.conversation.snapshot(), { kind: 'unavailable', code: 'EVIDENCE_UNAVAILABLE' });
    } else {
      assert.equal(host.snapshot().phase, 'ready', outcome); assert.notEqual(host.snapshot().context, null); assert.notEqual(host.snapshot().today, null);
      if (outcome === 'cancelled') {
        assert.deepEqual(host.conversation.snapshot(), { kind: 'idle' });
        assert.equal(host.retained.snapshot().discovery.kind, 'ready');
      } else {
        assert.equal(host.conversation.snapshot().kind, 'answer'); assert.equal(fixture.count('conversation.get'), 2);
      }
    }
    host.dispose();
  }
});
test('every conversation stage carries its own operation guard and legitimate multi-stage work completes: planning preview, approval, ask, readback, final-writing preview, approval, run and readback', async () => {
  const planning = planningPreviewFixture(reviewedRequest), tools = groundedFixture(planning.id), writing = synthesisPreviewFixture(tools), final = synthesisReplyFixture(tools, writing);
  const fixture = transport((method, payload) => {
    if (method === 'ui.context') return context();
    if (method === 'dashboard.get') return dashboard();
    if (method === 'models.list') return [route];
    if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
    if (method === 'models.preview') return planning;
    if (method === 'models.approve') return approvalFixture((payload as { id: string }).id === planning.id ? planning : writing);
    if (method === 'conversation.ask') return tools;
    if (method === 'conversation.get') return readbackFixture((payload as { id: string }).id === tools.id ? tools : final);
    if (method === 'conversation.synthesis.preview') return writing;
    if (method === 'conversation.synthesis.run') return final;
    throw Error(`Unexpected synthetic dispatch ${String(method)}`);
  });
  const host = createHostController(fixture.port, { now: clock }); await host.refresh(); host.selectRoute('route_fixture');
  const before = fixture.calls.length;
  assert.deepEqual(await host.conversation.preview(reviewedRequest), { ok: true });
  assert.deepEqual(await host.conversation.sendReviewed(consentFor(host)), { ok: true });
  assert.equal(host.conversation.snapshot().kind, 'answer');
  assert.deepEqual(await host.conversation.previewFinalWriting(), { ok: true });
  assert.deepEqual(await host.conversation.sendReviewed(consentFor(host)), { ok: true });
  const result = host.conversation.snapshot(); assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') assert.equal(result.saved.kind, 'synthesized-conversation');
  // Each raw conversation call was issued exactly once, in order, each between the host's own before and after context reads.
  const issuedCalls = fixture.calls.slice(before).map(call => String(call.method));
  assert.deepEqual(issuedCalls.filter(method => method !== 'ui.context'), ['models.preview', 'models.approve', 'conversation.ask', 'conversation.get', 'conversation.synthesis.preview', 'models.approve', 'conversation.synthesis.run', 'conversation.get']);
  assert.equal(issuedCalls.filter(method => method === 'ui.context').length, 16);
  assert.equal(host.snapshot().phase, 'ready'); host.dispose();
});
