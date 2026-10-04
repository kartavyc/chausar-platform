import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createHostController, currentMonth } from '../src/host/controller.ts';
import type { HostController, HostOptions } from '../src/host/controller.ts';
import { validateModelRoutes, validateUiContext } from '../src/host/contracts.ts';
import type { HostRpcPayloads, HostRpcPort } from '../src/host/contracts.ts';
import type { ConversationRequest } from '../src/bridge/conversation-contract.ts';
import type { ModelConsent } from '../src/bridge/conversation-host.ts';
import type { TodayConfiguration, validateEngineToday } from '../src/bridge/today-engine.ts';
import { todayRecord } from '../src/bridge/today-engine.ts';
import type { TodayConsumerController } from '../src/host/today-controller.ts';
import { validateLessonReviewList } from '../src/host/retained-contracts.ts';
import { approvalFixture, groundedFixture, planningPreviewFixture, readbackFixture, synthesisPreviewFixture, synthesisReplyFixture } from './conversation-fixtures.ts';
import { fullCalculationReceiptFixture, HUGE_INTEGER } from './fixtures.ts';
import { engine as dictionaryEngine, nodeDigest, settle, syntheticEngine } from './first-run/fixture.ts';
import { FIRST_RUN_METHODS } from '../src/screens/first-run/contracts.ts';
import type { FirstRunMethod, FirstRunRpcPayloads } from '../src/screens/first-run/contracts.ts';
import { handoffPinOf } from '../src/screens/first-run/controller.ts';
import { pinOf } from '../src/screens/first-run/review.ts';
import type { Review } from '../src/screens/first-run/review.ts';

/** Synthetic host transport; no real vault, network, process or model dispatch. */
const context = (contextKey = 'a'.repeat(64)) => ({ workspace: { id: 'workspace_fixture', name: 'Synthetic host fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role: 'owner', epoch: 1, branches: ['*'] }, contextKey });
const route = { id: 'route_fixture', kind: 'codex-cli', model: 'model_fixture', enabled: true, installationVerified: false, label: 'Synthetic route' };
const clock = () => Date.parse('2026-10-03T12:00:00.000Z');
const compiler = await dictionaryEngine();
const publishedDictionary = compiler.compile(compiler.pack(0), 1, 'member_fixture', '2026-10-01T09:00:00.000Z');
const ontology = () => ({ current: structuredClone(publishedDictionary), history: [structuredClone(publishedDictionary)] });
const legacyHostOptions = (): HostOptions => ({ now: clock, timeZone: 'UTC', firstRun: { digest: nodeDigest }, dashboard: {
  title: 'Today', date: '2026-10-03', request: { period: { from: '2026-10-01', to: '2026-10-31' } },
  selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }],
} });
/** Explicit four-method model using the retained CAS/receipt fixture; every other call must be named. */
async function firstRunHost(options: Pick<HostOptions, 'todayProducer' | 'dashboard' | 'timeZone'> = { todayProducer: {} }, reply?: (method: keyof HostRpcPayloads, payload: unknown) => unknown) {
  const fixture = await syntheticEngine();
  const calls: string[] = [];
  const port: HostRpcPort = { async request(method, payload) {
    calls.push(method);
    if (FIRST_RUN_METHODS.includes(method as FirstRunMethod)) return fixture.port.request(method as FirstRunMethod, payload as FirstRunRpcPayloads[FirstRunMethod]);
    if (method === 'models.list') return [];
    if (method === 'workspace.lock') return { locked: true };
    const value = reply?.(method, payload); if (value !== undefined) return value;
    throw Error(`Unexpected first-run host method ${method}`);
  } };
  const host = createHostController(port, { now: clock, firstRun: { digest: nodeDigest, createAttemptId: () => 'host-reviewed-attempt' }, ...options });
  let live = true;
  host.setFirstRunSurface(() => live);
  await host.refresh(); await host.firstRun.load();
  return { fixture, host, calls, depart: () => { live = false; host.setFirstRunSurface(null); } };
}
async function reviewFirstRun(host: HostController) {
  assert.deepEqual(host.firstRun.choosePack('ecommerce'), { ok: true }); await settle();
  let shown = host.firstRun.snapshot(); if (shown.kind !== 'review') throw Error('Expected checked review');
  for (const row of shown.review.rows) {
    shown = host.firstRun.snapshot(); if (shown.kind !== 'review') throw Error('Review departed');
    assert.deepEqual(host.firstRun.acceptRow(row.definition.name, checkedReviewPin(shown.review)), { ok: true });
  }
  shown = host.firstRun.snapshot(); if (shown.kind !== 'review') throw Error('Review departed');
  assert.deepEqual(host.firstRun.acceptSettings(checkedReviewPin(shown.review)), { ok: true });
  shown = host.firstRun.snapshot(); if (shown.kind !== 'review') throw Error('Review departed');
  return checkedReviewPin(shown.review);
}
function checkedReviewPin(review: Review) { const pin = pinOf(review); assert.ok(pin, 'review digest must be ready'); return pin; }
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
    if (method === 'ontology.get') return ontology();
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

test('deferred gate issues no catalogue, Saved, Today or figure requests before reviewed publication', async () => {
  const { host, calls } = await firstRunHost();
  assert.equal(host.snapshot().dictionaryReviewRequired, true);
  assert.equal(host.snapshot().todayConfiguration, 'not-configured'); assert.equal(host.timeZone, null);
  assert.deepEqual([...new Set(calls)].sort(), ['ontology.get', 'ontology.packs', 'ui.context']);
  await host.conversation.open('synthetic-saved');
  assert.equal(calls.includes('conversation.get'), false);
  host.dispose();
});
test('own publication adopts its verified context and Continue has a final synchronous host admission', async () => {
  const { fixture, host } = await firstRunHost();
  const pin = await reviewFirstRun(host), before = host.snapshot().context?.contextKey;
  assert.deepEqual(await host.firstRun.publishDictionary(pin), { ok: true });
  const shown = host.firstRun.snapshot(); if (shown.kind !== 'published') throw Error('Expected publication');
  assert.notEqual(shown.context.contextKey, before); assert.equal(host.snapshot().context?.contextKey, fixture.contextKey());
  const leave = await host.firstRun.leave(handoffPinOf(shown)); assert.equal(leave.ok, true);
  if (!leave.ok) throw Error('Expected admitted departure');
  const handoff = leave.admit(); assert.ok(handoff);
  let revoke = true;
  const stop = host.subscribe(() => { if (revoke && !host.snapshot().dictionaryReviewRequired) { revoke = false; host.invalidate('ACCESS_DENIED'); } });
  assert.equal(host.completeFirstRun(handoff), false, 'a synchronous revocation observer has the last word');
  assert.equal(leave.admit(), null); assert.equal(host.snapshot().context, null); stop(); host.dispose();
});
test('lost publication acknowledgement retains its attempt through refused host disposal and rereads without retry', async () => {
  const { fixture, host, calls } = await firstRunHost();
  const pin = await reviewFirstRun(host);
  fixture.onRequest((method, _payload, defaults) => { if (method === 'ontology.publish') { defaults(); throw refusal('REQUEST_FAILED'); } return undefined; });
  await host.firstRun.publishDictionary(pin);
  assert.equal(host.firstRun.issuance(), 'unresolved');
  assert.deepEqual(host.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(host.firstRun.snapshot(), { kind: 'unknown', code: 'READ_INVALIDATED', reconciling: false, attempt: null });
  host.setFirstRunSurface(() => true); fixture.onRequest(null);
  assert.deepEqual(await host.firstRun.reconcile(), { ok: true });
  assert.equal(calls.filter(method => method === 'ontology.publish').length, 1);
  const shown = host.firstRun.snapshot(); if (shown.kind !== 'published') throw Error('Expected attributed readback');
  const leave = await host.firstRun.leave(handoffPinOf(shown)); if (!leave.ok) throw Error('Expected departure');
  const handoff = leave.admit(); assert.ok(handoff); assert.equal(host.completeFirstRun(handoff), true);
  assert.equal(host.snapshot().dictionaryReviewRequired, false); assert.equal(host.snapshot().today, null);
  assert.equal(host.snapshot().todayConfiguration, 'not-configured'); host.dispose();
});

test('explicit same-owner requalification after reopen resolves the original lost-ack attempt and rejects changed authority without retry', async () => {
  const { fixture, host, calls } = await firstRunHost(); const original = host.firstRun;
  const pin = await reviewFirstRun(host);
  fixture.onRequest((method, _payload, defaults) => {
    if (method === 'ontology.publish') { host.invalidate('VAULT_LOCKED'); defaults(); throw refusal('REQUEST_FAILED'); }
    return undefined;
  });
  await host.firstRun.publishDictionary(pin); assert.equal(host.firstRun.issuance(), 'unresolved');
  assert.equal(host.snapshot().context, null); host.setFirstRunSurface(null);
  const hiddenCalls = calls.length; await host.refresh(); await host.checkAuthority(); assert.equal(calls.length, hiddenCalls, 'ordinary locked refresh and poll read nothing');
  for (const change of ['workspace', 'member', 'epoch', 'role'] as const) {
    fixture.onRequest((method, _payload, defaults) => {
      if (method !== 'ui.context') return undefined;
      const current = validateUiContext(defaults());
      return change === 'workspace' ? { ...current, workspace: { ...current.workspace, id: 'workspace_other' } }
        : { ...current, member: { ...current.member, ...(change === 'member' ? { id: 'member_other' } : change === 'epoch' ? { epoch: current.member.epoch + 1 } : { role: 'cofounder' }) } };
    });
    const before = calls.length; assert.equal(await host.requalifyFirstRunAfterReopen(), false, change);
    assert.deepEqual(calls.slice(before), ['ui.context'], change); assert.equal(host.snapshot().context, null, change); assert.equal(host.firstRun.issuance(), 'unresolved', change);
  }
  const reached = deferred<void>(), held = deferred<unknown>();
  fixture.onRequest(method => { if (method === 'ui.context') { reached.resolve(); return held.promise; } return undefined; });
  const pending = host.requalifyFirstRunAfterReopen(); await reached.promise; host.invalidate('VAULT_LOCKED');
  fixture.onRequest(null); held.resolve(await fixture.port.request('ui.context', {})); assert.equal(await pending, false, 'invalidated metadata cannot restore the surface');
  const before = calls.length; assert.equal(await host.requalifyFirstRunAfterReopen(), true);
  assert.deepEqual(calls.slice(before), ['ui.context']); assert.equal(host.firstRun, original);
  assert.equal(host.snapshot().dictionaryReviewRequired, true); assert.equal(host.snapshot().todayConfiguration, 'not-configured');
  assert.deepEqual(host.snapshot().routes, []); assert.equal(host.snapshot().today, null); assert.equal(host.snapshot().receipt, null);
  const noSurfaceCalls = calls.length; assert.equal((await host.firstRun.reconcile()).ok, false); assert.equal(calls.length, noSurfaceCalls, 'requalification does not restore a departed surface');
  host.setFirstRunSurface(() => true); assert.deepEqual(await host.firstRun.reconcile(), { ok: true });
  assert.equal(calls.filter(method => method === 'ontology.publish').length, 1); assert.equal(host.firstRun.issuance(), 'none');
  const resolved = host.firstRun.snapshot(); if (resolved.kind !== 'published') throw Error('Expected original attempt readback');
  assert.equal(resolved.published.hash, fixture.current()?.hash); assert.equal(await host.requalifyFirstRunAfterReopen(), false, 'a resolved pin cannot be reused'); host.dispose();
});
test('a synchronous child denial during requalification keeps the host denied and its original attempt unresolved until fresh explicit re-entry', async () => {
  const { fixture, host, calls } = await firstRunHost(); const pin = await reviewFirstRun(host);
  fixture.onRequest((method, _payload, defaults) => { if (method === 'ontology.publish') { defaults(); throw refusal('REQUEST_FAILED'); } return undefined; });
  await host.firstRun.publishDictionary(pin); host.invalidate('VAULT_LOCKED'); fixture.onRequest(null);
  let once = true;
  const stop = host.conversation.subscribe(() => { if (once) { once = false; host.invalidate('ACCESS_DENIED'); } });
  const before = calls.length;
  assert.equal(await host.requalifyFirstRunAfterReopen(), false);
  assert.deepEqual(calls.slice(before), ['ui.context']); assert.equal(host.snapshot().phase, 'unavailable');
  assert.equal(host.snapshot().code, 'ACCESS_DENIED'); assert.equal(host.snapshot().context, null);
  assert.equal(host.firstRun.issuance(), 'unresolved'); assert.equal(calls.filter(method => method === 'ontology.publish').length, 1);
  stop(); assert.equal(await host.requalifyFirstRunAfterReopen(), true);
  host.setFirstRunSurface(() => true); assert.deepEqual(await host.firstRun.reconcile(), { ok: true });
  assert.equal(calls.filter(method => method === 'ontology.publish').length, 1); assert.equal(host.firstRun.issuance(), 'none'); host.dispose();
});

test('deferred creation emits the exact envelope, holds its recovery acknowledgement and retains no request secrets', async () => {
  const payloads: unknown[] = []; let opened = false;
  const port: HostRpcPort = { async request(method, payload) {
    if (method === 'ui.context') { if (!opened) throw refusal('VAULT_LOCKED'); return { ...context(), workspace: { ...context().workspace, demo: false } }; }
    if (method === 'workspace.create') { payloads.push(structuredClone(payload)); opened = true; return { workspace: { ...context().workspace, demo: false }, recoveryKit: 'SYNTHETIC recovery kit', recoveryCode: 'SYNTHETIC recovery kit' }; }
    if (method === 'ontology.get') return { current: null, history: [] };
    throw Error(`Unexpected creation fixture method ${method}`);
  } };
  const host = createHostController(port, { firstRun: { digest: nodeDigest } }); await host.refresh();
  await host.createWorkspace({ name: 'SYNTHETIC creation', folder: 'synthetic', passphrase: 'Synthetic passphrase' });
  assert.deepEqual(payloads, [{ name: 'SYNTHETIC creation', folder: 'synthetic', passphrase: 'Synthetic passphrase', dictionaryMode: 'deferred', demo: false }]);
  const payload = payloads[0]; assert.ok(payload && typeof payload === 'object');
  assert.equal(Object.hasOwn(payload, 'pack'), false); assert.equal(Object.hasOwn(payload, 'demoFixtureMonth'), false);
  assert.equal(JSON.stringify(host.snapshot()).includes('Synthetic passphrase'), false);
  assert.deepEqual(host.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.equal(host.snapshot().creation.kind, 'recovery-required');
  const held = host.snapshot().creation; if (held.kind !== 'recovery-required') throw Error('Expected held recovery kit');
  await host.acknowledgeRecovery(structuredClone(held.value));
  assert.equal(host.snapshot().creation.kind, 'recovery-required', 'only the exact rendered kit can be acknowledged');
  host.invalidate('VAULT_LOCKED'); await host.acknowledgeRecovery(held.value);
  assert.equal(host.snapshot().creation.kind, 'recovery-held');
  assert.equal(JSON.stringify(host.snapshot()).includes('SYNTHETIC recovery kit'), false);
  await host.refresh();
  assert.equal(host.snapshot().creation.kind, 'recovery-required', 'a fresh exact-workspace admin read resumes the held kit');
  await host.acknowledgeRecovery(held.value); assert.equal(host.snapshot().creation.kind, 'idle');
  assert.equal(JSON.stringify(host.snapshot()).includes('SYNTHETIC recovery kit'), false);
  assert.equal(host.snapshot().dictionaryReviewRequired, true); host.dispose();
});

test('synchronous child denials fence unissued creation and pinned acknowledgement without exposing a kit or starting metadata', async () => {
  const calls: string[] = []; let opened = false;
  const kit = 'SYNTHETIC synchronous kit';
  const port: HostRpcPort = { async request(method) {
    calls.push(method);
    if (method === 'ui.context') { if (!opened) throw refusal('VAULT_LOCKED'); return { ...context(), workspace: { ...context().workspace, demo: false } }; }
    if (method === 'workspace.create') { opened = true; return { workspace: { ...context().workspace, demo: false }, recoveryKit: kit, recoveryCode: kit }; }
    if (method === 'ontology.get') return { current: null, history: [] };
    throw Error(`Unexpected synchronous creation fixture method ${method}`);
  } };
  const host = createHostController(port, { firstRun: { digest: nodeDigest } }); await host.refresh();
  let deny = true;
  const stopCreate = host.conversation.subscribe(() => { if (deny) { deny = false; host.invalidate('ACCESS_DENIED'); } });
  const beforeCreate = calls.length; await host.createWorkspace({ name: 'SYNTHETIC unissued', passphrase: 'Synthetic secret' });
  assert.equal(calls.length, beforeCreate); assert.equal(host.snapshot().phase, 'unavailable'); assert.equal(host.snapshot().code, 'ACCESS_DENIED');
  assert.deepEqual(host.snapshot().creation, { kind: 'idle' }, 'a known unissued creation owns no disposal fence');
  stopCreate(); host.invalidate('VAULT_LOCKED'); await host.createWorkspace({ name: 'SYNTHETIC issued', passphrase: 'Synthetic secret' });
  const shown = host.snapshot().creation; if (shown.kind !== 'recovery-required') throw Error('Expected single issued creation kit');
  deny = true;
  const snapshots: string[] = [], stopShown = host.subscribe(() => { snapshots.push(JSON.stringify(host.snapshot())); });
  const stopAck = host.conversation.subscribe(() => { if (deny) { deny = false; host.invalidate('ACCESS_DENIED'); } });
  const beforeAck = calls.length; assert.equal(await host.acknowledgeRecovery(shown.value), false);
  assert.equal(calls.length, beforeAck); assert.equal(host.snapshot().phase, 'unavailable'); assert.equal(host.snapshot().code, 'ACCESS_DENIED');
  assert.equal(host.snapshot().creation.kind, 'recovery-held'); assert.equal(snapshots.some(value => value.includes(kit)), false);
  assert.deepEqual(host.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' }); stopAck(); stopShown();
  await host.refresh(); const resumed = host.snapshot().creation; if (resumed.kind !== 'recovery-required') throw Error('Expected trusted exact-workspace release');
  assert.equal(await host.acknowledgeRecovery(resumed.value), true); assert.equal(calls.filter(method => method === 'workspace.create').length, 1); host.dispose();
});

test('a create reply after lock or authority denial holds its sole kit until a fresh exact-workspace admin release without retry', { timeout: 10000 }, async () => {
  for (const code of ['VAULT_LOCKED', 'ACCESS_DENIED'] as const) {
    const waiting = deferred<unknown>(), reached = deferred<void>(); let creates = 0;
    let authority: ReturnType<typeof context> | null = null;
    const kit = `SYNTHETIC late kit ${code}`;
    const created = { workspace: { ...context().workspace, demo: false as const }, recoveryKit: kit, recoveryCode: kit };
    const port: HostRpcPort = { async request(method) {
      if (method === 'ui.context') { if (authority === null) throw refusal('VAULT_LOCKED'); return authority; }
      if (method === 'workspace.create') { creates++; reached.resolve(); return waiting.promise; }
      if (method === 'ontology.get') return { current: null, history: [] };
      throw Error(`Unexpected late-create method ${method}`);
    } };
    const host = createHostController(port, { firstRun: { digest: nodeDigest } }); await host.refresh();
    const creating = host.createWorkspace({ name: 'SYNTHETIC late creation', passphrase: 'Synthetic secret' }); await reached.promise;
    assert.deepEqual(host.dispose(), { ok: false, code: 'IN_FLIGHT' }, code);
    host.invalidate(code); const invalidated = host.snapshot().phase;
    waiting.resolve(created); await creating;
    assert.equal(host.snapshot().phase, invalidated, code); assert.equal(host.snapshot().creation.kind, 'recovery-held', code);
    assert.equal(JSON.stringify(host.snapshot()).includes(kit), false, code); assert.equal(JSON.stringify(host.snapshot()).includes('Synthetic secret'), false, code);
    assert.deepEqual(host.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' }, code);
    await host.createWorkspace({ name: 'SYNTHETIC duplicate', passphrase: 'Synthetic other secret' }); assert.equal(creates, 1, code);
    await host.acknowledgeRecovery({ workspace: created.workspace, recoveryKit: kit }); assert.equal(host.snapshot().creation.kind, 'recovery-held', code);
    authority = { ...context(), workspace: { ...context().workspace, id: 'workspace_other', demo: false } }; await host.refresh();
    assert.equal(host.snapshot().creation.kind, 'recovery-held', 'another workspace cannot release the kit'); assert.equal(JSON.stringify(host.snapshot()).includes(kit), false);
    authority = { ...context(), workspace: { ...context().workspace, demo: false }, member: { ...context().member, role: 'viewer' } }; await host.refresh();
    assert.equal(host.snapshot().creation.kind, 'recovery-held', 'a viewer cannot release the kit'); assert.equal(JSON.stringify(host.snapshot()).includes(kit), false);
    authority = { ...context(), workspace: { ...context().workspace, demo: false } }; await host.refresh();
    const released = host.snapshot().creation; if (released.kind !== 'recovery-required') throw Error('Expected fresh exact-workspace admin release');
    assert.equal(host.snapshot().phase, 'loading'); assert.equal(released.value.recoveryKit, kit);
    await host.acknowledgeRecovery(released.value); assert.equal(host.snapshot().dictionaryReviewRequired, true);
    assert.equal(host.snapshot().creation.kind, 'idle'); assert.equal(JSON.stringify(host.snapshot()).includes(kit), false); assert.equal(creates, 1);
    host.dispose();
  }
});

test('recovery acknowledgement holds the created workspace through its first context read and refuses a consistent different workspace', { timeout: 10000 }, async () => {
  const reached = deferred<void>(), held = deferred<void>(); let opened = false, holdAcknowledgement = false, other = false, creates = 0;
  const kit = 'SYNTHETIC bound recovery kit';
  const port: HostRpcPort = { async request(method) {
    if (method === 'ui.context') {
      if (!opened) throw refusal('VAULT_LOCKED');
      if (holdAcknowledgement) { holdAcknowledgement = false; reached.resolve(); await held.promise; }
      return { ...context(other ? 'b'.repeat(64) : undefined), workspace: { ...context().workspace, id: other ? 'workspace_other' : 'workspace_fixture', demo: false } };
    }
    if (method === 'workspace.create') { opened = true; creates++; return { workspace: { ...context().workspace, demo: false }, recoveryKit: kit, recoveryCode: kit }; }
    if (method === 'ontology.get') return { current: null, history: [] };
    throw Error(`Unexpected acknowledgement fixture method ${method}`);
  } };
  const host = createHostController(port, { firstRun: { digest: nodeDigest } }); await host.refresh();
  await host.createWorkspace({ name: 'SYNTHETIC bound creation', passphrase: 'Synthetic binding secret' });
  const shown = host.snapshot().creation; if (shown.kind !== 'recovery-required') throw Error('Expected created kit');
  holdAcknowledgement = true; const acknowledging = host.acknowledgeRecovery(shown.value); await reached.promise;
  assert.equal(host.snapshot().creation.kind, 'recovery-held'); assert.equal(JSON.stringify(host.snapshot()).includes(kit), false);
  other = true; held.resolve(); assert.equal(await acknowledging, false);
  assert.equal(host.snapshot().context, null); assert.equal(host.snapshot().code, 'ACCESS_DENIED'); assert.equal(host.snapshot().creation.kind, 'recovery-held');
  other = false; await host.refresh(); const resumed = host.snapshot().creation; if (resumed.kind !== 'recovery-required') throw Error('Expected exact-workspace recovery resume');
  assert.equal(await host.acknowledgeRecovery(resumed.value), true); assert.equal(host.snapshot().context?.workspace.id, 'workspace_fixture'); assert.equal(creates, 1); host.dispose();
});

test('own publication retires initial Today and legacy policy until explicit fresh dictionary-bound input is installed', async () => {
  let currentPack = { ...installedPack };
  const { host, calls } = await firstRunHost({ timeZone: 'UTC', dashboard: legacyHostOptions().dashboard!, todayProducer: { display: displayedDay, configuration: explicitConfiguration() } }, method => {
    if (method === 'today.get') return { ...producerReply(), starterPack: { ...currentPack } };
    if (method === 'scenarios.discover') return emptyDiscoveryPage();
    throw Error(`Unexpected rebound Today method ${method}`);
  });
  const originalFirstRun = host.firstRun, retired = requireToday(host), held = retired.snapshot();
  assert.equal(host.bindTodayProducer({}), false, 'the deferred dictionary gate cannot be bypassed');
  const pin = await reviewFirstRun(host); assert.deepEqual(await host.firstRun.publishDictionary(pin), { ok: true });
  assert.equal(host.todayConsumer, null);
  const beforeRetired = calls.length;
  await retired.refresh(); assert.equal(await retired.prepare(held, liveToday), false);
  assert.equal(await retired.activity(held, liveToday), null); assert.equal(calls.length, beforeRetired, 'held old consumer controls issue nothing');
  const published = host.firstRun.snapshot(); if (published.kind !== 'published') throw Error('Expected verified publication');
  currentPack = { id: published.published.pack, dictionaryHash: published.published.hash, version: published.published.version };
  const left = await host.firstRun.leave(handoffPinOf(published)); if (!left.ok) throw Error('Expected admitted Continue');
  const handoff = left.admit(); assert.ok(handoff); assert.equal(host.completeFirstRun(handoff), true);
  await host.refreshToday(); await host.refreshToday();
  assert.equal(host.firstRun, originalFirstRun, 'rebind retains the original first-run attempt owner');
  assert.equal(host.snapshot().todayConfiguration, 'not-configured'); assert.equal(host.snapshot().today, null);
  assert.equal(host.todayConsumer, null); assert.equal(calls.includes('today.get'), false); assert.equal(calls.includes('dashboard.get'), false);
  const beforePending = calls.length;
  assert.deepEqual(await host.retained.readDiscovery(), { ok: false, code: 'READ_INVALIDATED' });
  await host.conversation.open('synthetic-saved');
  assert.equal(calls.length, beforePending, 'Saved stays pending without even a raw metadata read'); assert.equal(host.snapshot().phase, 'ready');
  assert.ok(calls.includes('models.list'), 'route catalogue remains available after admitted Continue');
  assert.equal(host.bindTodayProducer({ display: displayedDay, configuration: explicitConfiguration() }), false, 'old pack/hash/version is refused');
  assert.equal(host.bindTodayProducer({ display: displayedDay }), false, 'a display alone has no dictionary pin');
  assert.equal(host.bindTodayProducer({ display: displayedDay, surprise: true }), false, 'unknown input keys are refused');
  assert.equal(host.bindTodayProducer({}), true); await host.refreshToday();
  assert.equal(host.snapshot().todayConfiguration, 'not-configured'); assert.equal(calls.includes('today.get'), false);
  const beforeMissing = calls.length; assert.deepEqual(await host.retained.readDiscovery(), { ok: false, code: 'READ_INVALIDATED' }); assert.equal(calls.length, beforeMissing);
  const request = { ...explicitConfiguration().request, dictionaryHash: currentPack.dictionaryHash };
  const fresh: TodayConfiguration = { ...explicitConfiguration(), starterPack: currentPack, request, configurationDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex') };
  assert.equal(host.bindTodayProducer({ display: displayedDay, configuration: fresh }), true);
  const active = requireToday(host); assert.notEqual(active, retired); assert.equal(host.snapshot().todayConfiguration, 'configured');
  assert.equal(calls.includes('today.get'), false, 'binding issues no business read');
  await host.refreshToday(); assert.equal(active.snapshot().phase, 'ready');
  assert.equal(calls.filter(method => method === 'today.get').length, 1); assert.equal(calls.includes('dashboard.get'), false);
  assert.deepEqual(await host.retained.readDiscovery(), { ok: true }); assert.equal(calls.filter(method => method === 'scenarios.discover').length, 1);
  const beforeOld = calls.length; await retired.refresh(); assert.equal(await retired.activity(held, liveToday), null); assert.equal(calls.length, beforeOld);
  host.dispose();
});
test('calendar month is explicit in the host timezone, including leap day', () => {
  assert.deepEqual(currentMonth(Date.parse('2024-03-01T00:15:00.000Z'), 'America/Los_Angeles'), { date: '2024-02-29', period: { from: '2024-02-01', to: '2024-02-29' } });
  assert.throws(() => currentMonth(NaN, 'UTC'));
});
test('mount refresh reads current-month Today and every receipt without choosing or calling a model', async () => {
  const fixture = transport(), host = createHostController(fixture.port, legacyHostOptions());
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
  const fixture = transport(), host = createHostController(fixture.port, legacyHostOptions());
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
test('context replacement during an awaited aggregate clears every private surface', { timeout: 10000 }, async () => {
  const waiting = deferred<unknown>(), reached = deferred<void>(); let key = 'a'.repeat(64);
  const fixture = transport(method => {
    if (method === 'ui.context') return context(key);
    if (method === 'models.list') return [route];
    if (method === 'dashboard.get') { reached.resolve(); return waiting.promise; }
    throw Error('Receipt read must not begin after authority change');
  });
  const host = createHostController(fixture.port, legacyHostOptions()), refresh = host.refresh();
  await reached.promise;
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
  const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh(); holdReceipt = true;
  const reading = host.openReceipt('receipt_billed', { place: 'today', sub: 'today', sheet: 'receipt_billed' });
  for (let count = 0; count < 100 && fixture.calls.filter(call => call.method === 'receipts.get').length < 5; count++) await Promise.resolve();
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
  const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh(); holdReceipt = true;
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
  const fixture = transport(), host = createHostController(fixture.port, legacyHostOptions()); await host.refresh();
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
  const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh();
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
  const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh();
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
  const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh();
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
    const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh(); hold = true;
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
  const host = createHostController(fixture.port, legacyHostOptions()); await host.refresh(); host.selectRoute('route_fixture');
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

/* ---------- Optional trusted Today producer at the real host guarded transport seam ---------- */
type TodayReply = ReturnType<typeof validateEngineToday>;
type ReviewQueue = Extract<TodayReply['review'], { state: 'available' }>['value'];
type ReviewRow = ReviewQueue['rows'][number];
type PreparedTiles = Extract<TodayReply['tiles'], { state: 'prepared' }>['value'];
const displayedDay = { date: '2026-10-02', timeZone: 'Asia/Kolkata' };
const installedPack = { id: 'synthetic_explicit_pack', dictionaryHash: 'c'.repeat(64), version: 7 };
const liveToday = () => true;
const todayMethods = (calls: readonly { method: keyof HostRpcPayloads }[]) => calls.filter(call => String(call.method).startsWith('today.')).map(call => call.method);
function producerReply(): TodayReply {
  return { kind: 'today-engine-v1', display: { ...displayedDay }, atomic: false, noAction: true, starterPack: { ...installedPack }, defaults: { state: 'unconfigured', reason: 'pack-defaults-not-configured' }, state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' }, productReviewCount: null, tiles: { state: 'unavailable', reason: 'capture-required' }, attention: { state: 'unavailable', reason: 'attention-guards-required' }, review: { state: 'unavailable', reason: 'review-service-unavailable' }, dayEvents: { state: 'unavailable', reason: 'events-service-unavailable' } };
}
function scopedQueue(rows: ReviewRow[] = [], cursor: string | null = null): ReviewQueue {
  return { scope: 'prepared-actions-job-mandates-deliverables-lessons-v1', completeness: 'incomplete', count: null, knownCount: rows.length, rows, nextCursor: cursor, producers: { actions: { status: 'complete' }, jobs: { status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' }, lessons: { status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' } } };
}
function requireToday(host: HostController): TodayConsumerController {
  if (host.todayConsumer === null) throw Error('Expected explicitly injected Today capability');
  return host.todayConsumer;
}
function producerTransport(reply?: (method: keyof HostRpcPayloads, payload: unknown) => unknown | Promise<unknown>) {
  return transport((method, payload) => {
    const override = reply?.(method, payload); if (override !== undefined) return override;
    if (method === 'ui.context') return context();
    if (method === 'models.list') return [route];
    if (method === 'today.get') return producerReply();
    if (method === 'today.review') return scopedQueue();
    if (method === 'workspace.lock') return { locked: true };
    throw Error(`Unexpected trusted Today dispatch ${String(method)}`);
  });
}
function explicitConfiguration(): TodayConfiguration {
  const request: TodayConfiguration['request'] = { dictionaryHash: installedPack.dictionaryHash, asOf: '2026-10-04T00:00:00.000Z', scope: { sourceIds: ['source_fixture'], branch: 'branch_fixture' }, tiles: ['billed', 'received', 'margin'].map(operation => ({ id: `tile_${operation}`, label: `Explicit ${operation}`, operation, figureKey: operation === 'margin' ? 'contribution' : 'total', period: { from: '2026-09-01', to: '2026-09-30' }, buckets: [{ id: `bucket_${operation}`, label: 'Explicit first week', period: { from: '2026-09-01', to: '2026-09-07' } }] })) };
  return { configurationId: 'configuration_fixture', configurationDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex'), starterPack: { ...installedPack }, request };
}
function preparedTiles(configuration: TodayConfiguration): PreparedTiles {
  return { reference: { id: 'capture_fixture', digest: 'e'.repeat(64) }, display: { ...displayedDay }, configuration: { id: configuration.configurationId, digest: configuration.configurationDigest, starterPack: { ...configuration.starterPack }, origin: 'custom' }, result: { version: 1, asOf: configuration.request.asOf, dictionary: { hash: installedPack.dictionaryHash, version: installedPack.version }, scope: structuredClone(configuration.request.scope), atomic: false, verification: 'not-configured', tiles: configuration.request.tiles.map(tile => ({ id: tile.id, label: tile.label, operation: tile.operation, figureKey: tile.figureKey, period: { ...tile.period }, value: { status: 'partial', figure: { key: tile.figureKey, label: tile.label, minor: HUGE_INTEGER, display: 'Producer exact synthetic display', unit: 'money', currency: 'INR' }, receiptId: `receipt_${tile.operation}`, definition: { dictionaryHash: installedPack.dictionaryHash, ontologyVersion: installedPack.version, definitionHash: 'd'.repeat(64), definitions: [{ name: tile.operation, label: tile.label, meaning: 'Synthetic producer definition', kind: 'order', field: 'amountMinor', currency: 'INR', nulls: 'reject' }], operationId: tile.operation, operationType: tile.operation === 'margin' ? 'margin' : 'sum' }, coverage: { selectedRows: 3, countedRows: 2, excludedRows: 1, unresolvedConflicts: 1, importIds: ['import_fixture'], completeness: 'partial', gaps: ['Synthetic source gap'] }, gaps: [{ code: 'SYNTHETIC_PARTIAL', message: 'Synthetic protocol evidence remains partial' }] }, points: tile.buckets.map(bucket => ({ ...structuredClone(bucket), value: { status: 'unavailable', figure: null, receiptId: null, definition: null, coverage: null, gaps: [{ code: 'SYNTHETIC_BUCKET_MISSING', message: 'Synthetic bucket evidence is missing' }] } })) })) } };
}
function actionRecord() {
  return { id: 'action_fixture', connector: 'synthetic_connector', operation: 'synthetic_operation', payload: { asWritten: '00,450.70' }, sourceIds: ['source_fixture'], idempotencyKey: 'synthetic-key', digest: 'd'.repeat(64), revision: 3, createdBy: 'member_fixture', createdEpoch: 1, createdAt: '2026-10-01T09:00:00.000Z', impact: 'message', status: 'prepared', attempts: [] };
}
function actionReview(): ReviewRow {
  const action = actionRecord();
  return { kind: 'action-approval', title: 'Synthetic prepared action', since: action.createdAt, reference: { kind: 'action-approval', id: action.id, revision: action.revision, digest: action.digest }, request: { method: 'actions.approve', payload: { id: action.id, digest: action.digest } }, canApprove: true, provenance: [{ producer: 'actions', id: action.id, revision: action.revision, digest: action.digest }] };
}
function jobRecord() {
  return { id: 'job_fixture', goal: 'Synthetic delivered job', ownerId: 'member_fixture', ownerEpoch: 1, ownerRole: 'owner', budgetMinor: '1000', reserveMinor: '100', spentMinor: '50', reservedMinor: '0', stopRule: { maxRuns: 1, deadline: '2026-10-31T00:00:00.000Z' }, nextRunAt: '2026-10-01T09:00:00.000Z', intervalMs: 3600000, catchup: 'skip', graceMs: 60000, requiresApproval: true, sourceIds: ['source_fixture'], revision: 2, digest: 'b'.repeat(64), runs: 1, fence: 1, status: 'awaiting-acceptance', createdAt: '2026-10-01T09:00:00.000Z', ledger: [{ at: '2026-10-02T09:00:00.000Z', event: 'delivered' }], deliverable: { z: 'Synthetic second field', a: 'Synthetic first field' } };
}
function acceptanceReview(): ReviewRow {
  const job = jobRecord(), deliverableDigest = createHash('sha256').update(JSON.stringify({ a: job.deliverable.a, z: job.deliverable.z })).digest('hex');
  const reference = { kind: 'job-acceptance' as const, id: job.id, revision: job.revision, digest: job.digest, deliverableDigest };
  return { kind: 'job-acceptance', title: job.goal, since: '2026-10-02T09:00:00.000Z', reference, request: { method: 'jobs.accept', payload: { id: job.id, reference } }, canApprove: true, provenance: [{ producer: 'jobs', id: job.id, revision: job.revision, digest: job.digest }] };
}
/** Synthetic protocol qualification follows the existing released lesson fixture, without an evaluator claim. */
function releasedLesson() {
  const actor = { memberId: 'member_fixture', role: 'owner', epoch: 1 }, pin = { id: 'lesson_today_fixture', revision: 1, digest: 'a'.repeat(64) }, at = '2026-10-01T09:00:00.000Z';
  const reference = (id: string, digit: string) => ({ id, revision: '1', digest: digit.repeat(64) });
  const summary = (set: 'open' | 'hidden') => ({ reference: reference(`evaluation_${set}_fixture`, set === 'open' ? 'd' : 'e'), set, candidate: pin, authorityId: 'synthetic_evaluator_fixture', qualification: 'synthetic-protocol', suite: reference(`suite_${set}`, 'f'), harness: reference('harness_fixture', '0'), build: reference('build_fixture', '1'), configuration: reference('configuration_fixture', '2'), comparisonId: 'comparison_fixture', completedAt: at, status: 'complete', baseline: { guidance: 'off', digest: '3'.repeat(64) }, treatment: { guidance: 'on', candidate: pin }, metrics: [{ name: 'synthetic_metric', direction: 'higher-is-better', before: 1, after: 1 }], sourceTainted: false, sourceIds: ['source_fixture'] });
  return { candidate: { kind: 'candidate-lesson', workspaceId: 'workspace_fixture', ...pin, owner: actor, proposedBy: actor, proposedAt: at, episodeIds: ['lesson_episode_fixture'], title: 'Synthetic Friday reminder', rationale: 'Synthetic source rationale', evidence: [{ pin: { kind: 'calculation', id: 'receipt_fixture', revision: '1', digest: 'b'.repeat(64), sourceIds: ['source_fixture'], branchIds: ['branch_fixture'] }, available: true, sourceTainted: false, sourceMarkings: [{ sourceId: 'source_fixture', marking: 'internal' }], summary: 'Synthetic evidence summary' }], change: { kind: 'reminder-timing', targetId: 'reminder_fixture', before: 'monday', after: 'friday' }, applicability: { memberId: actor.memberId, branchIds: ['branch_fixture'], sourceIds: ['source_fixture'], conditions: { ritual: 'friday' } }, counterexamples: [{ conditions: { ritual: 'monday' }, reason: 'Synthetic Monday exception' }], target: { kind: 'reminder-timing', id: 'reminder_fixture', revision: '1', digest: 'c'.repeat(64), owner: actor, value: 'monday' } }, status: 'review-ready', evaluation: { candidate: pin, open: summary('open'), hidden: summary('hidden'), digest: 'd'.repeat(64) }, review: { id: 'lesson_review_fixture', candidate: pin, evaluationDigest: 'd'.repeat(64), reviewer: actor, at, digest: 'e'.repeat(64) } };
}
function lessonReview(): ReviewRow {
  const lesson = releasedLesson(), candidate = { id: lesson.candidate.id, revision: lesson.candidate.revision, digest: lesson.candidate.digest };
  return { kind: 'lesson-decision', title: lesson.candidate.title, since: lesson.candidate.proposedAt, reference: { kind: 'lesson-decision', ...candidate, reviewId: lesson.review.id, reviewDigest: lesson.review.digest, evaluationDigest: lesson.evaluation.digest }, request: { method: 'memory.decideLesson', payload: { candidate, reviewId: lesson.review.id, reviewDigest: lesson.review.digest }, requiredHumanFields: ['decision', 'reason'] }, canApprove: true, provenance: [{ producer: 'lessons', ...candidate }] };
}

test('omitting the trusted Today producer retains the legacy refresh journey and exact locked empty snapshot', { timeout: 10000 }, async () => {
  const fixture = transport(), host = createHostController(fixture.port, legacyHostOptions());
  assert.equal(host.todayConsumer, null);
  await host.refreshToday();
  assert.equal(host.snapshot().today?.statsEvidence.length, 3);
  assert.equal(fixture.count('dashboard.get'), 1); assert.equal(fixture.count('receipts.get'), 4);
  assert.deepEqual(todayMethods(fixture.calls), []);
  await host.lock();
  assert.deepEqual(host.snapshot(), { phase: 'locked', code: 'VAULT_LOCKED', context: null, today: null, routes: [], selectedRouteId: null, receipt: null, dictionaryReviewRequired: false, todayConfiguration: 'not-configured', creation: { kind: 'idle' } });
  host.dispose();
});
test('explicit missing Today display is honest missing state with zero Today get or prepare and no clock inference', { timeout: 10000 }, async () => {
  const fixture = producerTransport(), host = createHostController(fixture.port, { todayProducer: {}, now: () => { throw Error('Business display must not read the local clock'); } });
  await host.refreshToday(); const consumer = requireToday(host);
  assert.equal(host.snapshot().phase, 'ready'); assert.equal(host.snapshot().today, null);
  assert.deepEqual(consumer.snapshot(), { phase: 'missing', response: null, page: null, detail: null, preparing: false });
  assert.equal(await consumer.prepare(consumer.snapshot(), liveToday), false);
  await consumer.refresh();
  assert.deepEqual(todayMethods(fixture.calls), []); assert.equal(fixture.count('dashboard.get'), 0); assert.equal(fixture.count('receipts.get'), 0);
  assert.equal(fixture.count('models.list'), 1); host.dispose();
});
test('explicit display with no configuration reads metadata then actual Today get without dashboard, defaults or automatic prepare', { timeout: 10000 }, async () => {
  const fixture = producerTransport(), host = createHostController(fixture.port, { todayProducer: { display: displayedDay }, now: () => { throw Error('Today display must remain explicit'); }, timeZone: 'America/Los_Angeles' });
  await host.refreshToday(); const consumer = requireToday(host);
  assert.deepEqual(fixture.calls.map(call => call.method), ['ui.context', 'ontology.get', 'ui.context', 'ui.context', 'models.list', 'ui.context', 'ui.context', 'today.get', 'ui.context']);
  assert.deepEqual(fixture.calls.find(call => call.method === 'today.get')?.payload, displayedDay);
  assert.equal(host.snapshot().today, null); assert.equal(consumer.snapshot().phase, 'ready');
  assert.equal(consumer.snapshot().response?.atomic, false); assert.equal(consumer.snapshot().response?.noAction, true); assert.equal(consumer.snapshot().response?.productReviewCount, null);
  assert.equal(await consumer.prepare(consumer.snapshot(), liveToday), false);
  await host.refreshToday();
  assert.deepEqual(todayMethods(fixture.calls), ['today.get', 'today.get']); assert.equal(fixture.count('dashboard.get'), 0); assert.equal(fixture.count('receipts.get'), 0); host.dispose();
});
test('Today page controls cancelled, replaced or departed during the host inner context hold issue zero raw requests and a fresh control still works', { timeout: 10000 }, async () => {
  for (const outcome of ['cancelled', 'replaced', 'departed'] as const) {
    const reached = deferred<void>(), held = deferred<void>(); let armed = false, live = true;
    const fixture = producerTransport(method => {
      if (method === 'ui.context' && armed) { armed = false; reached.resolve(); return held.promise.then(() => context()); }
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday();
    const consumer = requireToday(host), before = fixture.calls.length, old = consumer.snapshot(); armed = true;
    const pending = consumer.page(old, false, () => live); await reached.promise;
    assert.equal(fixture.count('today.review'), 0, outcome);
    if (outcome === 'replaced') await consumer.refresh(); else if (outcome === 'cancelled') consumer.cancelSelection(); else live = false;
    held.resolve(); assert.equal(await pending, false, outcome); assert.equal(fixture.count('today.review'), 0, outcome); assert.equal(host.snapshot().phase, 'ready', outcome);
    assert.equal(fixture.calls.slice(before).filter(call => call.method !== 'ui.context').every(call => call.method === 'today.get'), true, outcome);
    consumer.cancelSelection(); live = true;
    assert.equal(await consumer.page(consumer.snapshot(), false, () => live), true, outcome);
    assert.equal(fixture.count('today.review'), 1, outcome); assert.equal(consumer.snapshot().page?.count, null); host.dispose();
  }
});
test('issued Today success and evidence denial after lock, context replacement or newer snapshot cannot publish or invalidate the newer journey', { timeout: 10000 }, async () => {
  for (const outcome of ['locked', 'context-replaced', 'snapshot-replaced'] as const) for (const reply of ['success', 'denial'] as const) {
    const reached = deferred<void>(), held = deferred<unknown>(); let hold = false, key = 'a'.repeat(64);
    const fixture = producerTransport(method => {
      if (method === 'ui.context') return context(key);
      if (method === 'today.get' && hold) { reached.resolve(); return held.promise; }
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday();
    const consumer = requireToday(host); hold = true; const pending = consumer.refresh(); await reached.promise; hold = false;
    if (outcome === 'locked') await host.lock();
    else if (outcome === 'context-replaced') { key = 'b'.repeat(64); await host.checkAuthority(); assert.equal(host.snapshot().code, 'ACCESS_DENIED'); await host.refreshToday(); }
    else await consumer.refresh();
    const currentHost = host.snapshot(), currentToday = consumer.snapshot();
    if (reply === 'success') held.resolve(producerReply()); else held.reject(refusal('EVIDENCE_UNAVAILABLE'));
    await pending;
    assert.equal(host.snapshot(), currentHost, `${outcome}/${reply}`); assert.equal(consumer.snapshot(), currentToday, `${outcome}/${reply}`);
    assert.equal(host.snapshot().phase, outcome === 'locked' ? 'locked' : 'ready');
    assert.equal(consumer.snapshot().response === null, outcome === 'locked'); assert.equal(fixture.count('today.prepareTiles'), 0); host.dispose();
  }
});
test('a live Today evidence denial clears the host while trusted producer issuance clears both Today and retained Saved private state', { timeout: 10000 }, async () => {
  let deny = false;
  const fixture = producerTransport(method => {
    if (method === 'today.get' && deny) return Promise.reject(refusal('EVIDENCE_UNAVAILABLE'));
    if (method === 'scenarios.discover') return emptyDiscoveryPage();
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday();
  assert.deepEqual(await host.retained.readDiscovery(), { ok: true }); assert.equal(host.retained.snapshot().discovery.kind, 'ready');
  host.invalidateTrustedProducer();
  assert.equal(host.snapshot().code, 'READ_INVALIDATED'); assert.equal(host.snapshot().context, null); assert.equal(requireToday(host).snapshot().response, null);
  assert.equal(host.retained.snapshot().discovery.kind, 'idle');
  await host.refreshToday(); deny = true; await requireToday(host).refresh();
  assert.equal(host.snapshot().phase, 'unavailable'); assert.equal(host.snapshot().code, 'EVIDENCE_UNAVAILABLE'); assert.equal(requireToday(host).snapshot().response, null); host.dispose();
});
test('explicit prepare sends the insertion-order digest and exact configuration once, then reopens only the issued capture on ordinary refresh', { timeout: 10000 }, async () => {
  const configuration = explicitConfiguration(), prepared = preparedTiles(configuration), reached = deferred<void>(), held = deferred<unknown>(); let issued = false;
  const fixture = producerTransport(method => {
    if (method === 'today.prepareTiles') { issued = true; reached.resolve(); return held.promise; }
    if (method === 'today.get' && issued) return { ...producerReply(), tiles: { state: 'prepared', value: prepared } };
    if (method === 'receipts.get') return receipt('billed');
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay, configuration } }); await host.refreshToday();
  const consumer = requireToday(host), view = consumer.snapshot(); assert.equal(fixture.count('today.prepareTiles'), 0);
  const preparing = consumer.prepare(view, liveToday); assert.equal(await consumer.prepare(view, liveToday), false); await reached.promise;
  assert.equal(consumer.snapshot().preparing, true); assert.equal(fixture.count('today.prepareTiles'), 1);
  assert.deepEqual(fixture.calls.find(call => call.method === 'today.prepareTiles')?.payload, { ...displayedDay, ...configuration });
  assert.notEqual(configuration.configurationDigest, createHash('sha256').update(JSON.stringify({ asOf: configuration.request.asOf, dictionaryHash: configuration.request.dictionaryHash, scope: configuration.request.scope, tiles: configuration.request.tiles })).digest('hex'));
  held.resolve(prepared); assert.equal(await preparing, true);
  const accepted = consumer.snapshot(); assert.equal(accepted.response?.tiles.state, 'prepared');
  if (accepted.response?.tiles.state === 'prepared') { assert.equal(accepted.response.tiles.value.result.tiles[0]?.value.figure?.minor, HUGE_INTEGER); assert.equal(accepted.response.tiles.value.result.tiles[0]?.value.figure?.display, 'Producer exact synthetic display'); assert.equal(accepted.response.tiles.value.result.tiles[0]?.points[0]?.value.figure, null); }
  await host.refreshToday();
  assert.deepEqual(fixture.calls.filter(call => call.method === 'today.get').map(call => call.payload), [displayedDay, { ...displayedDay, tileCapture: prepared.reference }, { ...displayedDay, tileCapture: prepared.reference }]);
  assert.equal(fixture.count('today.prepareTiles'), 1); assert.equal(fixture.count('dashboard.get'), 0);
  assert.equal((await consumer.receipt(consumer.snapshot(), 'receipt_billed', liveToday))?.kind, 'receipt'); assert.equal(fixture.count('receipts.get'), 1);
  assert.equal(await consumer.receipt(consumer.snapshot(), 'receipt_not_released', liveToday), null); assert.equal(fixture.count('receipts.get'), 1); host.dispose();
});
test('bad prepare digest, changed pack or request dictionary binding refuses before raw prepare without guessing defaults', { timeout: 10000 }, async () => {
  for (const change of ['digest', 'pack', 'dictionary'] as const) {
    const configuration = explicitConfiguration();
    const input = change === 'digest' ? { ...configuration, configurationDigest: 'f'.repeat(64) } : change === 'dictionary' ? { ...configuration, request: { ...configuration.request, dictionaryHash: 'f'.repeat(64) } } : configuration;
    const fixture = producerTransport(method => method === 'today.get' && change === 'pack' ? { ...producerReply(), starterPack: { ...installedPack, version: installedPack.version + 1 } } : undefined);
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay, configuration: input } }); await host.refreshToday();
    const consumer = requireToday(host); assert.equal(await consumer.prepare(consumer.snapshot(), liveToday), false, change);
    assert.equal(fixture.count('today.prepareTiles'), 0, change); assert.equal(consumer.snapshot().code, change === 'dictionary' ? 'INVALID_REPLY' : 'TODAY_CONFIGURATION_CHANGED', change);
    if (change === 'dictionary') assert.equal(fixture.count('today.get'), 0);
    assert.equal(host.snapshot().phase, 'ready'); host.dispose();
  }
});
test('a failed Today read with no checked response cannot prepare even with a complete explicit configuration and a ready host', { timeout: 10000 }, async () => {
  const fixture = producerTransport(method => method === 'today.get' ? { ...producerReply(), unexpectedHint: 'not trusted producer evidence' } : undefined);
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay, configuration: explicitConfiguration() } }); await host.refreshToday();
  const consumer = requireToday(host), failed = consumer.snapshot(); assert.equal(host.snapshot().phase, 'ready'); assert.equal(failed.phase, 'failed'); assert.equal(failed.code, 'INVALID_REPLY'); assert.equal(failed.response, null);
  const before = fixture.calls.length; assert.equal(await consumer.prepare(failed, liveToday), false); assert.equal(fixture.calls.length, before); assert.equal(fixture.count('today.prepareTiles'), 0); host.dispose();
});
test('prepare cancelled or departed during the host before-dispatch context hold issues nothing and a fresh explicit prepare succeeds', { timeout: 10000 }, async () => {
  for (const outcome of ['cancelled', 'departed'] as const) {
    const configuration = explicitConfiguration(), prepared = preparedTiles(configuration), reached = deferred<void>(), held = deferred<void>(); let armed = false, live = true, issued = false;
    const fixture = producerTransport(method => {
      if (method === 'ui.context' && armed) { armed = false; reached.resolve(); return held.promise.then(() => context()); }
      if (method === 'today.prepareTiles') { issued = true; return prepared; }
      if (method === 'today.get' && issued) return { ...producerReply(), tiles: { state: 'prepared', value: prepared } };
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay, configuration } }); await host.refreshToday(); const consumer = requireToday(host); armed = true;
    const pending = consumer.prepare(consumer.snapshot(), () => live); await reached.promise; assert.equal(fixture.count('today.prepareTiles'), 0);
    if (outcome === 'cancelled') consumer.cancelSelection(); else live = false;
    held.resolve(); assert.equal(await pending, false, outcome); assert.equal(fixture.count('today.prepareTiles'), 0, outcome);
    consumer.cancelSelection(); live = true; assert.equal(await consumer.prepare(consumer.snapshot(), () => live), true, outcome); assert.equal(fixture.count('today.prepareTiles'), 1, outcome); host.dispose();
  }
});
test('review resolves the exact full row pin before a genuine action list read, rejects changed pins and never approves', { timeout: 10000 }, async () => {
  for (const outcome of ['accepted', 'resolver-changed', 'domain-revision-changed', 'domain-digest-changed'] as const) {
    const row = actionReview(), response = { ...producerReply(), review: { state: 'available' as const, value: scopedQueue([row]) } };
    const fixture = producerTransport(method => {
      if (method === 'today.get') return response;
      if (method === 'today.resolveReview') return outcome === 'resolver-changed' ? { ...row, reference: { ...row.reference, revision: row.reference.revision + 1, digest: 'f'.repeat(64) }, request: { method: 'actions.approve', payload: { id: row.reference.id, digest: 'f'.repeat(64) } }, provenance: row.provenance.map(pin => ({ ...pin, revision: pin.revision + 1, digest: 'f'.repeat(64) })) } : row;
      if (method === 'actions.list') return [{ ...actionRecord(), ...(outcome === 'domain-revision-changed' ? { revision: 4 } : outcome === 'domain-digest-changed' ? { digest: 'f'.repeat(64) } : {}) }];
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), view = consumer.snapshot();
    if (view.response?.review.state !== 'available') throw Error('Expected producer review'); const chosen = view.response.review.value.rows[0]; if (!chosen) throw Error('Expected producer row');
    const detail = await consumer.review(view, chosen, liveToday);
    assert.equal(detail?.kind ?? null, outcome === 'accepted' ? 'action' : null, outcome);
    assert.deepEqual(fixture.calls.find(call => call.method === 'today.resolveReview')?.payload, { reference: row.reference });
    assert.equal(fixture.count('actions.list'), outcome === 'resolver-changed' ? 0 : 1, outcome);
    assert.deepEqual(fixture.calls.filter(call => !['ui.context', 'models.list'].includes(call.method)).map(call => call.method), outcome === 'resolver-changed' ? ['ontology.get', 'today.get', 'today.resolveReview'] : ['ontology.get', 'today.get', 'today.resolveReview', 'actions.list']);
    const before = fixture.calls.length; assert.equal(await consumer.review(view, chosen, liveToday), null); assert.equal(fixture.calls.length, before, outcome);
    assert.equal(fixture.calls.some(call => ['actions.approve', 'jobs.approve', 'jobs.accept', 'memory.decideLesson'].includes(call.method)), false); host.dispose();
  }
});
test('cancellation after a successful review resolver while the domain inner context read is held issues zero actions list calls; a fresh review still opens', { timeout: 10000 }, async () => {
  const row = actionReview(), reached = deferred<void>(), held = deferred<void>(); let contextReadsToHold = 0, holdResolver = true;
  const fixture = producerTransport(method => {
    if (method === 'today.get') return { ...producerReply(), review: { state: 'available', value: scopedQueue([row]) } };
    if (method === 'today.resolveReview') { if (holdResolver) contextReadsToHold = 2; return row; }
    if (method === 'ui.context' && contextReadsToHold > 0 && --contextReadsToHold === 0) { reached.resolve(); return held.promise.then(() => context()); }
    if (method === 'actions.list') return [actionRecord()];
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), view = consumer.snapshot();
  if (view.response?.review.state !== 'available' || !view.response.review.value.rows[0]) throw Error('Expected producer review row');
  const pending = consumer.review(view, view.response.review.value.rows[0], liveToday); await reached.promise;
  assert.equal(fixture.count('today.resolveReview'), 1); assert.equal(fixture.count('actions.list'), 0); consumer.cancelSelection(); held.resolve();
  assert.equal(await pending, null); assert.equal(fixture.count('actions.list'), 0); assert.equal(host.snapshot().phase, 'ready');
  holdResolver = false; const fresh = consumer.snapshot(); if (fresh.response?.review.state !== 'available' || !fresh.response.review.value.rows[0]) throw Error('Expected current producer review row');
  assert.equal((await consumer.review(fresh, fresh.response.review.value.rows[0], liveToday))?.kind, 'action'); assert.equal(fixture.count('actions.list'), 1); host.dispose();
});
test('review continuation preserves the exact opaque cursor and page size, old page controls are inert and a queue change is not retried', { timeout: 10000 }, async () => {
  const opaqueCursor = 'eyJvZmZzZXQiOjQsInNlYWwiOiJzeW50aGV0aWNfZml4dHVyZSJ9', row = actionReview(); let refuse = false;
  const nextCursor = 'eyJvZmZzZXQiOjgsInNlYWwiOiJzeW50aGV0aWNfZml4dHVyZSJ9';
  const rows = Array.from({ length: 10 }, (_, index): ReviewRow => ({ ...row, reference: { ...row.reference, id: `action_page_${index}` }, request: { method: 'actions.approve', payload: { id: `action_page_${index}`, digest: row.reference.digest } }, provenance: [] }));
  const fixture = producerTransport(method => {
    if (method === 'today.get') return { ...producerReply(), review: { state: 'available', value: { ...scopedQueue(rows.slice(0, 4), opaqueCursor), knownCount: 10 } } };
    if (method === 'today.review') { if (refuse) return Promise.reject(refusal('REVIEW_QUEUE_CHANGED')); return { ...scopedQueue(rows.slice(4, 8), nextCursor), knownCount: 10 }; }
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), initial = consumer.snapshot();
  assert.equal(await consumer.page(initial, true, liveToday), true);
  assert.deepEqual(fixture.calls.find(call => call.method === 'today.review')?.payload, { limit: 4, cursor: opaqueCursor });
  const current = consumer.snapshot(); assert.equal(await consumer.page(initial, true, liveToday), false); assert.equal(fixture.count('today.review'), 1);
  refuse = true; assert.equal(await consumer.page(current, true, liveToday), false);
  assert.equal(consumer.snapshot().code, 'REVIEW_QUEUE_CHANGED'); assert.equal(consumer.snapshot().page, null); assert.equal(consumer.snapshot().response, null);
  assert.equal(fixture.count('today.review'), 2); assert.equal(fixture.count('today.get'), 1); assert.equal(fixture.count('today.prepareTiles'), 0); host.dispose();
});
test('job acceptance drilldown verifies revision, digest and the canonical deliverable digest through the genuine job list without accepting', { timeout: 10000 }, async () => {
  for (const outcome of ['accepted-read', 'resolver-deliverable-changed', 'job-revision-changed', 'job-digest-changed', 'job-deliverable-changed'] as const) {
    const row = acceptanceReview();
    const fixture = producerTransport(method => {
      if (method === 'today.get') return { ...producerReply(), review: { state: 'available', value: scopedQueue([row]) } };
      if (method === 'today.resolveReview') {
        const changed = { ...row.reference, deliverableDigest: 'f'.repeat(64) };
        return outcome === 'resolver-deliverable-changed' ? { ...row, reference: changed, request: { method: 'jobs.accept', payload: { id: row.reference.id, reference: changed } } } : row;
      }
      if (method === 'jobs.list') return [{ ...jobRecord(), ...(outcome === 'job-revision-changed' ? { revision: 3 } : outcome === 'job-digest-changed' ? { digest: 'f'.repeat(64) } : outcome === 'job-deliverable-changed' ? { deliverable: { a: 'Changed synthetic field', z: 'Synthetic second field' } } : {}) }];
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), view = consumer.snapshot();
    if (view.response?.review.state !== 'available' || !view.response.review.value.rows[0]) throw Error('Expected acceptance row');
    const detail = await consumer.review(view, view.response.review.value.rows[0], liveToday);
    assert.equal(detail?.kind ?? null, outcome === 'accepted-read' ? 'job' : null, outcome); assert.equal(fixture.count('jobs.list'), outcome === 'resolver-deliverable-changed' ? 0 : 1, outcome);
    assert.deepEqual(fixture.calls.find(call => call.method === 'today.resolveReview')?.payload, { reference: row.reference });
    assert.equal(fixture.calls.some(call => ['jobs.accept', 'jobs.approve', 'actions.approve'].includes(call.method)), false); host.dispose();
  }
});
test('lesson drilldown retains candidate, review and evaluation pins through genuine memory.lessons and requires the existing human decision flow', { timeout: 10000 }, async () => {
  for (const outcome of ['accepted-read', 'candidate-changed', 'candidate-revision-changed', 'review-id-changed', 'review-digest-changed', 'evaluation-changed'] as const) {
    const row = lessonReview(), lesson = releasedLesson();
    // A changed candidate is still a coherent, independently releasable lesson. The stale Today pin must reject it.
    const changedPin = { id: lesson.candidate.id, revision: outcome === 'candidate-revision-changed' ? 2 : lesson.candidate.revision, digest: outcome === 'candidate-changed' ? 'f'.repeat(64) : lesson.candidate.digest };
    const changedCandidate = { ...lesson, candidate: { ...lesson.candidate, ...changedPin }, review: { ...lesson.review, candidate: changedPin }, evaluation: { ...lesson.evaluation, candidate: changedPin, open: { ...lesson.evaluation.open, candidate: changedPin, treatment: { ...lesson.evaluation.open.treatment, candidate: changedPin } }, hidden: { ...lesson.evaluation.hidden, candidate: changedPin, treatment: { ...lesson.evaluation.hidden.treatment, candidate: changedPin } } } };
    if (outcome === 'candidate-changed' || outcome === 'candidate-revision-changed') assert.doesNotThrow(() => validateLessonReviewList([changedCandidate], validateUiContext(context())));
    const fixture = producerTransport(method => {
      if (method === 'today.get') return { ...producerReply(), review: { state: 'available', value: scopedQueue([row]) } };
      if (method === 'today.resolveReview') return row;
      if (method === 'memory.lessons') return [outcome === 'candidate-changed' || outcome === 'candidate-revision-changed' ? changedCandidate : { ...lesson, ...(outcome === 'review-id-changed' ? { review: { ...lesson.review, id: 'lesson_review_other' } } : outcome === 'review-digest-changed' ? { review: { ...lesson.review, digest: 'f'.repeat(64) } } : outcome === 'evaluation-changed' ? { evaluation: { ...lesson.evaluation, digest: 'f'.repeat(64) }, review: { ...lesson.review, evaluationDigest: 'f'.repeat(64) } } : {}) }];
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), view = consumer.snapshot();
    if (view.response?.review.state !== 'available' || !view.response.review.value.rows[0]) throw Error('Expected lesson row');
    const detail = await consumer.review(view, view.response.review.value.rows[0], liveToday);
    assert.equal(detail?.kind ?? null, outcome === 'accepted-read' ? 'lesson' : null, outcome); assert.equal(fixture.count('memory.lessons'), 1, outcome);
    if (detail?.lesson) { assert.equal(detail.lesson.candidate.digest, lesson.candidate.digest); assert.equal(detail.lesson.review?.digest, lesson.review.digest); assert.equal(detail.lesson.evaluation?.digest, lesson.evaluation.digest); }
    assert.deepEqual(fixture.calls.find(call => call.method === 'today.resolveReview')?.payload, { reference: row.reference });
    assert.equal(fixture.calls.some(call => call.method === 'memory.decideLesson'), false); host.dispose();
  }
});
test('a producer event resolves its exact receipt reference before the genuine proof read and an old same-address event control remains inert', { timeout: 10000 }, async () => {
  const event = { id: 'today_event_fixture', at: '2026-10-02T06:00:00.000Z', actor: { kind: 'not-recorded' as const }, kind: 'calculation.completed' as const, args: { operation: 'billed', stale: false }, reference: { kind: 'receipt' as const, receiptId: 'receipt_billed' } };
  const fixture = producerTransport(method => {
    if (method === 'today.get') return { ...producerReply(), dayEvents: { state: 'available', value: { ...displayedDay, calendarRevision: null, events: [event], total: 1, state: { kind: 'partial', reasonCodes: ['ACTOR_NOT_RECORDED'] } } } };
    if (method === 'today.resolveEvent') return event.reference;
    if (method === 'receipts.get') return receipt('billed');
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), old = consumer.snapshot();
  await consumer.refresh(); const fresh = consumer.snapshot(), before = fixture.calls.length;
  assert.equal(await consumer.event(old, event.id, liveToday), null); assert.equal(fixture.calls.length, before);
  const detail = await consumer.event(fresh, event.id, liveToday); assert.equal(detail?.kind, 'receipt'); assert.equal(detail?.receipt?.id, 'receipt_billed');
  assert.deepEqual(fixture.calls.slice(before).filter(call => call.method !== 'ui.context').map(call => call.method), ['today.resolveEvent', 'receipts.get']);
  assert.deepEqual(fixture.calls.find(call => call.method === 'today.resolveEvent')?.payload, { ...displayedDay, eventId: event.id });
  assert.deepEqual(fixture.calls.find(call => call.method === 'receipts.get')?.payload, { id: event.reference.receiptId }); host.dispose();
});
test('selected attention resolves the full current decision, opens its released proof and Back restores the accepted detail without another read', { timeout: 10000 }, async () => {
  const due = { reference: { kind: 'decision' as const, decisionId: 'decision_fixture' }, text: 'Synthetic due decision', reviewDate: displayedDay.date, due: 'today' as const, status: 'open' as const, branch: null, revision: 2, receiptIds: ['receipt_billed'] };
  const attentionId = 'attention_fixture';
  const fixture = producerTransport(method => {
    if (method === 'today.get') return { ...producerReply(), attention: { state: 'available', value: { kind: 'today-attention-v1', request: { displayedDate: displayedDay.date, timeZone: displayedDay.timeZone }, authority: { workspaceId: 'workspace_fixture', memberId: 'member_fixture', epoch: 1, stateRevision: 9 }, alertEpisodes: [], dueDecisions: [due], calendar: { window: { from: displayedDay.date, through: '2026-10-08', days: 7, timeZone: displayedDay.timeZone }, state: 'unavailable', reason: 'no-reviewed-calendar', rows: [] }, counts: { alertEpisodes: 0, dueDecisions: 1, calendarEntries: 0 }, alertsCheckedAt: '2026-10-02T09:00:00.000Z', evaluated: false, pin: 'f'.repeat(64) }, selection: { state: 'configured', policyId: 'synthetic_installed_policy', policyRevision: 'synthetic_revision', eligibleCount: 1, rows: [{ id: attentionId, kind: 'due-decision', value: due }] } } };
    if (method === 'today.resolveAttention') return due;
    if (method === 'receipts.get') return receipt('billed');
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host);
  const detail = await consumer.attention(consumer.snapshot(), attentionId, liveToday); assert.equal(detail?.kind, 'decision'); assert.deepEqual(detail?.receiptIds, ['receipt_billed']);
  assert.deepEqual(fixture.calls.find(call => call.method === 'today.resolveAttention')?.payload, { ...displayedDay, reference: due.reference });
  const accepted = consumer.snapshot(); assert.equal((await consumer.receipt(accepted, 'receipt_billed', liveToday))?.kind, 'receipt');
  const proof = consumer.snapshot(), beforeBack = fixture.calls.length; assert.equal(consumer.back(proof), detail); assert.equal(fixture.calls.length, beforeBack);
  assert.equal(consumer.back(proof), null); assert.equal(consumer.snapshot().detail, detail); assert.equal(fixture.count('decisions.list'), 0); assert.equal(fixture.count('receipts.get'), 1); host.dispose();
});
test('Activity uses the genuine bounded administrative list and a viewer issues zero activity reads', { timeout: 10000 }, async () => {
  for (const role of ['owner', 'viewer'] as const) {
    const records = { items: [{ id: 'activity_fixture', type: 'synthetic-event', at: '2026-10-02T09:00:00.000Z' }], modelReceipts: [] };
    const fixture = producerTransport(method => {
      if (method === 'ui.context') return { ...context(), member: { ...context().member, role } };
      if (method === 'activity.list') return records;
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host);
    const detail = await consumer.activity(consumer.snapshot(), liveToday);
    assert.equal(detail?.kind ?? null, role === 'owner' ? 'activity' : null); assert.equal(fixture.count('activity.list'), role === 'owner' ? 1 : 0);
    if (role === 'owner') { assert.deepEqual(detail?.record, records); assert.deepEqual(fixture.calls.find(call => call.method === 'activity.list')?.payload, {}); }
    assert.equal(fixture.count('today.prepareTiles'), 0); assert.equal(host.snapshot().phase, 'ready'); host.dispose();
  }
});
test('a current captured tile opens complete local evidence without RPC, proof reads the genuine receipt and Back survives a stale tile control', { timeout: 10000 }, async () => {
  const baseConfiguration = explicitConfiguration();
  const request: TodayConfiguration['request'] = { ...baseConfiguration.request, tiles: baseConfiguration.request.tiles.map((tile, index) => index === 0 ? { ...tile, id: 'tile_earned', label: 'Explicit earned', operation: 'earned', comparison: { operation: 'change', figureKey: 'earned', period: { from: '2026-08-01', to: '2026-08-31' } }, buckets: [...tile.buckets, { id: 'bucket_earned_missing', label: 'Explicit second week', period: { from: '2026-09-08', to: '2026-09-14' } }] } : tile) };
  const configuration: TodayConfiguration = { ...baseConfiguration, request, configurationDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex') };
  const basePrepared = preparedTiles(configuration), first = basePrepared.result.tiles[0], configured = configuration.request.tiles[0];
  if (!first || !configured?.comparison || !first.points[0]) throw Error('Expected explicitly configured tile, bucket and comparison');
  const definition = { dictionaryHash: installedPack.dictionaryHash, ontologyVersion: installedPack.version, definitionHash: 'd'.repeat(64), definitions: [{ name: 'earned', label: 'Earned', meaning: 'Synthetic imported order earnings', kind: 'order', field: 'amountMinor', currency: 'INR', nulls: 'reject' as const, sign: 1 as const }], operationId: 'earned', operationType: 'sum' as const };
  const coverage = { selectedRows: 3, countedRows: 2, excludedRows: 1, unresolvedConflicts: 1, importIds: ['import_fixture'], completeness: 'partial' as const, gaps: ['Synthetic source coverage remains partial'] };
  const tile: PreparedTiles['result']['tiles'][number] = { ...first, value: { ...first.value, definition, coverage, gaps: [{ code: 'SYNTHETIC_PARTIAL', message: 'Synthetic retained gap', definitionName: 'earned', period: { ...first.period } }] }, points: first.points.map((point, index) => index === 0 ? { ...point, value: { status: 'partial', figure: { key: 'total', label: 'Synthetic measured first week', minor: '-200', display: 'Producer exact synthetic bucket display', unit: 'money', currency: 'INR' }, receiptId: 'receipt_earned_week', definition, coverage, gaps: [{ code: 'SYNTHETIC_BUCKET_PARTIAL', message: 'Synthetic first-week gap' }] } } : point), comparison: { ...configured.comparison, value: { status: 'partial', figure: { key: 'earned', label: 'Synthetic measured change', minor: '-900719925474099312345678901234567890', display: 'Producer exact synthetic comparison display', unit: 'money', currency: 'INR' }, receiptId: 'receipt_change', definition: { ...definition, operationId: 'change', operationType: 'change' }, coverage, gaps: [{ code: 'SYNTHETIC_COMPARISON_PARTIAL', message: 'Synthetic comparison gap' }] } } };
  const prepared: PreparedTiles = { ...basePrepared, result: { ...basePrepared.result, tiles: basePrepared.result.tiles.map((entry, index) => index === 0 ? tile : entry) } }; let issued = false;
  const fixture = producerTransport(method => {
    if (method === 'today.prepareTiles') { issued = true; return prepared; }
    if (method === 'today.get' && issued) return { ...producerReply(), tiles: { state: 'prepared', value: prepared } };
    if (method === 'receipts.get') return receipt('earned');
  });
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay, configuration } }); await host.refreshToday(); const consumer = requireToday(host);
  assert.equal(await consumer.prepare(consumer.snapshot(), liveToday), true); const captured = consumer.snapshot(), beforeDetail = fixture.calls.length;
  const detail = await consumer.tile(captured, tile.id, liveToday); if (detail === null) throw Error('Expected released local tile detail');
  assert.equal(detail.kind, 'tile'); assert.equal(detail.title, tile.label); assert.deepEqual(detail.record, tile); assert.notEqual(detail.record, tile);
  assert.deepEqual(detail.receiptIds, ['receipt_earned', 'receipt_earned_week', 'receipt_change']); assert.equal(Object.isFrozen(detail), true); assert.equal(Object.isFrozen(detail.record), true);
  assert.equal(fixture.calls.length, beforeDetail, 'Tile detail must not resolve, calculate, prepare or perform a raw read');
  const opened = consumer.snapshot(); assert.equal(opened.detail, detail);
  assert.equal((await consumer.receipt(opened, 'receipt_earned', liveToday))?.kind, 'receipt'); const proof = consumer.snapshot(), beforeStale = fixture.calls.length;
  assert.deepEqual(fixture.calls.slice(beforeDetail).filter(call => call.method !== 'ui.context').map(call => call.method), ['receipts.get']);
  assert.deepEqual(fixture.calls.find(call => call.method === 'receipts.get')?.payload, { id: 'receipt_earned' });
  assert.equal(await consumer.tile(captured, tile.id, liveToday), null); assert.equal(fixture.calls.length, beforeStale); assert.equal(consumer.snapshot(), proof);
  assert.equal(consumer.back(proof), detail); assert.equal(consumer.snapshot().detail, detail); assert.deepEqual(consumer.snapshot().detail?.record, tile);
  assert.equal(fixture.calls.length, beforeStale); assert.equal(fixture.count('today.prepareTiles'), 1); assert.equal(fixture.count('receipts.get'), 1); host.dispose();
});
test('an import event resolves exact native IDs before legacy sources.list; only own expectedTotals undefined is admitted and optional accessors are never evaluated', { timeout: 10000 }, async () => {
  for (const outcome of ['accepted', 'unknown-undefined', 'expected-totals-accessor', 'unknown-accessor', 'native-import-id-changed', 'native-source-id-changed', 'resolver-import-id-changed', 'resolver-source-id-changed'] as const) {
    let getterCalls = 0;
    // Matches ImportService's public legacy record; retainedInput is excluded by importPublicRecord.
    const imported = { id: 'import_fixture', at: '2026-10-02T09:00:00.000Z', sourceId: 'source_fixture', format: 'csv', recipeHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), rowIds: ['fact_fixture'], coverage: { sourceRows: 1, importedRows: 1, rejectedRows: 0, expectedRows: null, reconciled: false }, totalsMinor: '45070', expectedTotals: undefined, unmappedFields: ['synthetic_unmapped_field'], qualification: 'experimental' };
    if (outcome === 'unknown-undefined') Object.defineProperty(imported, 'futureOptional', { value: undefined, enumerable: true });
    if (outcome === 'expected-totals-accessor' || outcome === 'unknown-accessor') Object.defineProperty(imported, outcome === 'expected-totals-accessor' ? 'expectedTotals' : 'futureOptional', { enumerable: true, get() { getterCalls++; return undefined; } });
    if (outcome === 'native-import-id-changed') imported.id = 'import_other';
    if (outcome === 'native-source-id-changed') imported.sourceId = 'source_other';
    const event = { id: 'import_event_fixture', at: '2026-10-02T09:00:00.000Z', actor: { kind: 'not-recorded' as const }, kind: 'source.imported' as const, args: { sourceId: 'source_fixture', format: 'csv' as const, rowCount: 1, qualification: 'experimental' as const }, reference: { kind: 'import' as const, importId: 'import_fixture', sourceId: 'source_fixture' } };
    const fixture = producerTransport(method => {
      if (method === 'today.get') return { ...producerReply(), dayEvents: { state: 'available', value: { ...displayedDay, calendarRevision: null, events: [event], total: 1, state: { kind: 'partial', reasonCodes: ['ACTOR_NOT_RECORDED'] } } } };
      if (method === 'today.resolveEvent') return { ...event.reference, ...(outcome === 'resolver-import-id-changed' ? { importId: 'import_other' } : outcome === 'resolver-source-id-changed' ? { sourceId: 'source_other' } : {}) };
      if (method === 'sources.list') return [imported];
    });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host);
    assert.equal(Object.hasOwn(imported, 'expectedTotals'), true);
    const detail = await consumer.event(consumer.snapshot(), event.id, liveToday), resolverChanged = outcome === 'resolver-import-id-changed' || outcome === 'resolver-source-id-changed';
    assert.equal(detail?.kind ?? null, outcome === 'accepted' ? 'import' : null, outcome); assert.equal(getterCalls, 0, outcome);
    assert.deepEqual(fixture.calls.find(call => call.method === 'today.resolveEvent')?.payload, { ...displayedDay, eventId: event.id });
    assert.equal(fixture.count('sources.list'), resolverChanged ? 0 : 1, outcome);
    assert.deepEqual(fixture.calls.filter(call => !['ui.context', 'models.list'].includes(call.method)).map(call => call.method), resolverChanged ? ['ontology.get', 'today.get', 'today.resolveEvent'] : ['ontology.get', 'today.get', 'today.resolveEvent', 'sources.list']);
    if (outcome === 'accepted') {
      const { expectedTotals: omitted, ...expected } = imported; assert.equal(omitted, undefined);
      assert.deepEqual(detail?.record, { event, current: expected }); assert.equal(detail?.title, event.reference.sourceId); assert.deepEqual(detail?.receiptIds, []);
      const current = detail && todayRecord(detail.record) ? detail.record.current : null;
      assert.equal(todayRecord(current) && Object.hasOwn(current, 'expectedTotals'), false);
    } else { assert.equal(consumer.snapshot().phase, 'failed', outcome); assert.equal(consumer.snapshot().code, 'INVALID_REPLY', outcome); }
    assert.equal(Object.hasOwn(imported, 'expectedTotals'), true, 'Normalization must not mutate the raw legacy record');
    assert.equal(fixture.count('today.prepareTiles'), 0); assert.equal(fixture.count('receipts.get'), 0); assert.equal(host.snapshot().phase, 'ready'); host.dispose();
  }
});

test('native Activity retains both groups, untruncated model receipts and the exact UTF8 payload while omitting only recorded optional undefined', { timeout: 10000 }, async () => {
  const approval = { id: 'approval_fixture', kind: 'outbound-approval', previewId: 'preview_fixture', digest: 'a'.repeat(64), routeId: 'route_fixture', endpoint: 'https://fixture.invalid', approverId: 'member_fixture', approverEpoch: 1, createdAt: '2026-10-02T09:00:00.000Z', expiresAt: '2026-10-02T09:05:00.000Z', used: false };
  const preview = { id: 'preview_fixture', kind: 'model-preview', status: 'completed', purpose: 'conversation-synthesis', payload: '₹'.repeat(87381), actualCostMinor: null, costMeasured: false, costStatus: 'reserved-estimate-cost-unavailable', providerRequestId: undefined };
  const raw = { items: [{ id: 'activity_fixture', type: 'model.dispatch.completed', details: { receiptId: preview.id } }], modelReceipts: [preview, ...Array.from({ length: 501 }, (_, index) => ({ ...approval, id: `approval_${index}` }))] };
  const fixture = producerTransport(method => method === 'activity.list' ? raw : undefined);
  const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host);
  const detail = await consumer.activity(consumer.snapshot(), liveToday); assert.equal(detail?.kind, 'activity');
  const { providerRequestId: omitted, ...expectedPreview } = preview; assert.equal(omitted, undefined);
  assert.deepEqual(detail?.record, { items: raw.items, modelReceipts: [expectedPreview, ...raw.modelReceipts.slice(1)] });
  assert.equal(Object.hasOwn(preview, 'providerRequestId'), true); assert.equal(fixture.count('activity.list'), 1);
  assert.ok(Object.isFrozen(detail?.record)); assert.deepEqual(detail?.receiptIds, []); assert.equal(fixture.count('today.prepareTiles'), 0); host.dispose();
});

test('Activity rejects invented outer arrays, unknown fields, hostile descriptors and oversized UTF8 payloads without executing accessors', { timeout: 10000 }, async () => {
  for (const kind of ['array', 'extra', 'missing', 'optional-getter', 'unknown-undefined', 'utf8-overflow', 'unapproved-long-field'] as const) {
    let getterCalls = 0; const preview = { id: 'preview_fixture', kind: 'model-preview', status: 'completed', payload: 'safe synthetic payload', providerRequestId: undefined };
    if (kind === 'optional-getter') Object.defineProperty(preview, 'providerRequestId', { enumerable: true, get() { getterCalls++; return undefined; } });
    if (kind === 'unknown-undefined') Object.defineProperty(preview, 'futureOptional', { enumerable: true, value: undefined });
    if (kind === 'utf8-overflow') preview.payload = '₹'.repeat(87382);
    if (kind === 'unapproved-long-field') Object.defineProperty(preview, 'futurePayload', { enumerable: true, value: 'x'.repeat(50001) });
    const native = { items: [], modelReceipts: [preview] };
    const raw = kind === 'array' ? [] : kind === 'extra' ? { ...native, total: 0 } : kind === 'missing' ? { items: [] } : native;
    const fixture = producerTransport(method => method === 'activity.list' ? raw : undefined);
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host);
    assert.equal(await consumer.activity(consumer.snapshot(), liveToday), null, kind); assert.equal(consumer.snapshot().code, 'INVALID_REPLY', kind);
    assert.equal(getterCalls, 0, kind); assert.equal(fixture.count('activity.list'), 1, kind); assert.equal(consumer.snapshot().detail, null, kind); host.dispose();
  }
});

test('issued Activity success and refusal cannot revive a cancelled selection and a fresh native read still succeeds', { timeout: 10000 }, async () => {
  for (const outcome of ['success', 'refusal'] as const) {
    const reached = deferred<void>(), held = deferred<unknown>(), native = { items: [], modelReceipts: [] }; let armed = true;
    const fixture = producerTransport(method => { if (method === 'activity.list') { if (armed) { reached.resolve(); return held.promise; } return native; } });
    const host = createHostController(fixture.port, { todayProducer: { display: displayedDay } }); await host.refreshToday(); const consumer = requireToday(host), view = consumer.snapshot();
    const pending = consumer.activity(view, liveToday); await reached.promise; consumer.cancelSelection(); const cancelled = consumer.snapshot();
    if (outcome === 'success') held.resolve(native); else held.reject(refusal('ACCESS_DENIED'));
    assert.equal(await pending, null, outcome); assert.equal(consumer.snapshot(), cancelled, outcome); assert.equal(consumer.snapshot().detail, null, outcome);
    assert.equal(await consumer.activity(view, liveToday), null, outcome); assert.equal(fixture.count('activity.list'), 1, outcome);
    armed = false; assert.equal((await consumer.activity(cancelled, liveToday))?.kind, 'activity', outcome); assert.equal(fixture.count('activity.list'), 2, outcome); host.dispose();
  }
});
