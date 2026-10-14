import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  createDesktopRequestPort, createDesktopReceiptReader, readFailureCode, unwrapDesktopRequestEnvelope,
} from '../../app/ui/src/bridge/client.ts';
import { createHostController } from '../../app/ui/src/host/controller.ts';
import { createConversationHost } from '../../app/ui/src/bridge/conversation-host.ts';
import { todayRefusalCodes } from '../../app/ui/src/bridge/contract.ts';
import { ENGINE_DICTIONARY_REFUSALS, firstRunFailure, type FirstRunMethod } from '../../app/ui/src/screens/first-run/contracts.ts';
import { createFirstRunController, type IssuanceEvent } from '../../app/ui/src/screens/first-run/controller.ts';
import { allReviewed, pinOf } from '../../app/ui/src/screens/first-run/review.ts';
import { engine as frozenFirstRunEngine, nodeDigest, settle, syntheticEngine } from '../../app/ui/tests/first-run/fixture.ts';
import { fullCalculationReceiptFixture } from '../../app/ui/tests/fixtures.ts';
import { loadElectronPreloadFixture } from './fixtures/electron-context-bridge.ts';

interface FixtureApi {
  request(method: string, payload?: unknown): Promise<unknown>;
  requestEnvelope(method: string, payload?: unknown): Promise<unknown>;
}
const preloadPath = new URL('../../app/desktop/preload.cjs', import.meta.url);
const preloadSource = await readFile(preloadPath, 'utf8');
const refusal = (code: string) => ({ ok: false, error: { code, message: 'Synthetic private detail must stay in preload.' } });
const require = createRequire(import.meta.url);
const { validateRequest, publicError } = require('../../app/desktop/ipc-contract.cjs') as {
  validateRequest(input: unknown): { method: string; payload: Record<string, unknown> };
  publicError(error: unknown): { code: string; message: string };
};
function fixture(invoke: (method: string, payload: unknown) => unknown | Promise<unknown>) {
  const calls: { method: string; payload: unknown }[] = [];
  const { api } = loadElectronPreloadFixture<FixtureApi>({ source: preloadSource, filename: preloadPath.pathname,
    async invoke(channel, envelope) {
      assert.equal(channel, 'chausar:request');
      const request = envelope as { method: string; payload: unknown }; calls.push(request);
      return invoke(request.method, request.payload);
    },
  });
  return { api, port: createDesktopRequestPort(api), calls };
}
// Actual IPC validation/error projection, preload source and renderer adapter;
// the dispatcher and both Electron data copies remain source-only fixtures.
function validatedFixture(dispatch: (method: string, payload: Record<string, unknown>) => unknown | Promise<unknown>) {
  return fixture(async (method, payload) => {
    try {
      const request = validateRequest({ method, payload });
      return { ok: true, result: await dispatch(request.method, request.payload) };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
}

test('copied legacy Error loses VAULT_LOCKED but resolved envelope preserves it through the actual preload', async t => {
  t.diagnostic(`app/desktop/preload.cjs sha256=${createHash('sha256').update(preloadSource).digest('hex')}`);
  const h = fixture(() => refusal('VAULT_LOCKED'));
  // This deliberately models Electron's documented Error copy instead of directly exposing the API.
  await assert.rejects(h.api.request('ui.context', {}), error => {
    assert.equal(Object.hasOwn(error as object, 'code'), false);
    assert.equal(readFailureCode(error), 'REQUEST_FAILED'); return true;
  });
  const wire = await h.api.requestEnvelope('ui.context', {});
  assert.deepEqual(wire, { version: 1, ok: false, error: { code: 'VAULT_LOCKED' } });
  assert.equal(Object.isFrozen(wire), true);
  assert.equal(Object.isFrozen((wire as { error: object }).error), true);
  await assert.rejects(h.port.request('ui.context', {}), { code: 'VAULT_LOCKED', message: 'The desktop request failed.' });
  // Existing host behavior receives the local typed Error and clears all private state.
  const host = createHostController(h.port); await host.refresh();
  assert.equal(host.snapshot().phase, 'locked'); assert.equal(host.snapshot().code, 'VAULT_LOCKED');
  assert.equal(host.snapshot().context, null); assert.equal(host.snapshot().today, null);
  host.dispose();
});

test('envelope adapter preserves ordinary results, defaults and business objects resembling envelopes', async () => {
  const results = [undefined, null, false, 0, '', [null, false, 0],
    { version: 1, ok: false, error: { code: 'VAULT_LOCKED' }, businessResult: true }, fullCalculationReceiptFixture()];
  for (const result of results) {
    const h = fixture(() => ({ ok: true, result }));
    assert.deepEqual(await h.port.request('receipts.get'), result);
    assert.deepEqual(h.calls, [{ method: 'receipts.get', payload: {} }]);
    assert.deepEqual(await h.api.request('receipts.get'), result, 'Legacy success remains raw.');
  }
  const receipt = fullCalculationReceiptFixture();
  const h = fixture(() => ({ ok: true, result: receipt }));
  assert.equal((await createDesktopReceiptReader(h.port).receipt(receipt.id)).ok, true);
});

test('existing refusal mappings survive copied bridge data and invalidate concurrent receipt reads', async () => {
  for (const [sourceCode, expectedCode] of [
    ['ACCESS_DENIED', 'ACCESS_DENIED'], ['ACCESS_REVOKED', 'ACCESS_DENIED'], ['SOURCE_REVOKED', 'ACCESS_DENIED'],
    ['BRANCH_FORBIDDEN', 'ACCESS_DENIED'], ['RECEIPT_FORBIDDEN', 'ACCESS_DENIED'], ['FORBIDDEN', 'ACCESS_DENIED'],
    ['VAULT_LOCKED', 'VAULT_LOCKED'], ['UNAUTHENTICATED', 'UNAUTHENTICATED'],
    ['RECEIPT_NOT_FOUND', 'EVIDENCE_UNAVAILABLE'], ['EVIDENCE_UNAVAILABLE', 'EVIDENCE_UNAVAILABLE'],
  ] as const) {
    let finish!: (reply: unknown) => void;
    const h = fixture((_method, payload) => (payload as { id: string }).id === 'slow_receipt'
      ? new Promise(resolve => { finish = resolve; }) : refusal(sourceCode));
    const reader = createDesktopReceiptReader(h.port);
    const slow = reader.receipt('slow_receipt');
    const denied = await reader.receipt('denied_receipt');
    assert.deepEqual(denied, { ok: false, code: expectedCode });
    finish({ ok: true, result: { ...fullCalculationReceiptFixture(), id: 'slow_receipt' } });
    assert.deepEqual(await slow, { ok: false, code: 'READ_INVALIDATED' });
    assert.equal(JSON.stringify(denied).includes('private'), false);
  }
  for (const [sourceCode, expectedCode] of [
    ['OUTBOUND_APPROVAL_REQUIRED', 'CONSENT_REQUIRED'], ['PREVIEW_STALE', 'STALE_EVIDENCE'],
    ['CONVERSATION_CONTINUATION_RESOLVED', 'CONTINUATION_RESOLVED'],
    ['CONVERSATION_CONTINUATION_LIMIT', 'CONTINUATION_LIMIT'], ['CONVERSATION_NOT_FOUND', 'EVIDENCE_UNAVAILABLE'],
    ['INVALID_SESSION', 'UNAUTHENTICATED'], ['ROUTE_REVOKED', 'ACCESS_DENIED'],
  ] as const) {
    const h = fixture(() => refusal(sourceCode));
    const conversation = createConversationHost(h.port);
    assert.deepEqual(await conversation.open('synthetic_turn'), { ok: false, code: expectedCode });
    assert.equal(h.calls.length, 1, 'A refusal never retries or dispatches a model request.');
  }
});

test('preload and renderer refusal allowlists agree and unknown failures carry no engine detail', async () => {
  const clientSource = await readFile(new URL('../../app/ui/src/bridge/client.ts', import.meta.url), 'utf8');
  const codes = (source: string, expression: RegExp) => [...source.match(expression)![1]!.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]!).sort();
  const preloadCodes = codes(preloadSource, /const refusalCodes = new Set\(\[([\s\S]*?)\]\);/);
  assert.match(clientSource, /\.\.\.todayRefusalCodes/);
  const rendererCodes = [...codes(clientSource, /const desktopRefusalCodes = \[([\s\S]*?)\] as const;/), ...todayRefusalCodes].sort();
  assert.equal(new Set(preloadCodes).size, preloadCodes.length);
  assert.equal(new Set(rendererCodes).size, rendererCodes.length);
  assert.deepEqual(preloadCodes, rendererCodes);
  for (const code of preloadCodes) {
    const h = fixture(() => refusal(code));
    await assert.rejects(h.port.request('ui.context', {}), { code });
  }
  for (const reply of [null, undefined, {}, { ok: 'true', result: {} }, { ok: true },
    { ok: false }, { ok: false, error: { code: 'VAULT_LOCKED' } }, refusal('UNKNOWN_CODE'),
    refusal('VAULT_LOCKED secret'), { ...refusal('VAULT_LOCKED'), result: 'retained evidence' },
    { ok: false, error: { code: 'VAULT_LOCKED', message: 'private', stack: 'secret stack' } }]) {
    const h = fixture(() => reply);
    assert.deepEqual(await h.api.requestEnvelope('ui.context', {}), { version: 1, ok: false, error: { code: 'REQUEST_FAILED' } });
    await assert.rejects(h.port.request('ui.context', {}), { code: 'REQUEST_FAILED', message: 'The desktop request failed.' });
  }
  const h = fixture(() => { throw Object.assign(new Error('VAULT_LOCKED: synthetic private SQL'), { code: 'VAULT_LOCKED', cause: 'secret' }); });
  assert.deepEqual(await h.api.requestEnvelope('ui.context'), { version: 1, ok: false, error: { code: 'REQUEST_FAILED' } });
});

test('dictionary and deferred-creation refusals cross IPC validation and both bridge copies with only their safe code', async () => {
  const draft = (await frozenFirstRunEngine()).rawPack(0);
  for (const code of [...ENGINE_DICTIONARY_REFUSALS, 'INVALID_DICTIONARY_MODE'] as const) {
    const method = code === 'INVALID_DICTIONARY_MODE' ? 'workspace.create' : 'ontology.publish';
    const payload = code === 'INVALID_DICTIONARY_MODE'
      ? { name: 'Synthetic bridge creation', passphrase: 'Synthetic transport fixture only', dictionaryMode: 'deferred', demo: false }
      : { draft, expectedCurrentHash: null, attemptId: 'synthetic_bridge_publication' };
    const expectedJson = JSON.stringify(payload);
    const h = validatedFixture((actualMethod, actualPayload) => {
      assert.equal(actualMethod, method); assert.equal(JSON.stringify(actualPayload), expectedJson);
      throw Object.assign(new Error('Synthetic private publication detail'), { code, cause: 'Synthetic private cause' });
    });
    const wire = await h.api.requestEnvelope(method, payload);
    assert.deepEqual(wire, { version: 1, ok: false, error: { code } });
    assert.equal(Object.isFrozen(wire), true);
    assert.equal(Object.isFrozen((wire as { error: object }).error), true);
    await assert.rejects(h.port.request(method, payload), error => {
      const local = error as Error & { code: string };
      assert.equal(local.code, code); assert.equal(local.message, 'The desktop request failed.');
      assert.equal(Object.hasOwn(local, 'cause'), false);
      assert.equal(JSON.stringify(local).includes('Synthetic private'), false);
      assert.equal(local.stack?.includes('Synthetic private'), false);
      if (code !== 'INVALID_DICTIONARY_MODE') assert.deepEqual(firstRunFailure(local), { code: 'PUBLISH_REFUSED', engineCode: code });
      return true;
    });
    assert.deepEqual(h.calls, [{ method, payload }, { method, payload }], 'Each explicit transport probe dispatches once without retry.');
  }
});

test('first-run publication settles a bridged CAS refusal but retains an unknown bridged outcome without retry', async () => {
  for (const code of ['DICTIONARY_CONFLICT', 'SYNTHETIC_DICTIONARY_PRIVATE'] as const) {
    const synthetic = await syntheticEngine();
    synthetic.onRequest(method => {
      if (method === 'ontology.publish') throw Object.assign(new Error('Synthetic private publication refusal'), { code });
      return undefined;
    });
    const h = validatedFixture((method, payload) => synthetic.port.request(method as FirstRunMethod, payload as never));
    const controller = createFirstRunController(h.port, { guard: { live: () => true }, digest: nodeDigest,
      createAttemptId: () => 'synthetic_bridge_controller_attempt' });
    const events: IssuanceEvent[] = [];
    controller.onIssuance(event => { events.push(event); });
    assert.deepEqual(await controller.load(), { ok: true });
    assert.deepEqual(controller.choosePack('ecommerce'), { ok: true });
    await settle();
    const review = controller.snapshot(); assert.ok(review.kind === 'review');
    const pin = pinOf(review.review); assert.ok(pin);
    for (const row of review.review.rows) assert.deepEqual(controller.acceptRow(row.definition.name, pin), { ok: true });
    assert.deepEqual(controller.acceptSettings(pin), { ok: true });
    const result = await controller.publishDictionary(pin);
    assert.equal(synthetic.count('ontology.publish'), 1); assert.equal(synthetic.current(), null);
    if (code === 'DICTIONARY_CONFLICT') {
      assert.deepEqual(result, { ok: false, code: 'PUBLISH_REFUSED' });
      const shown = controller.snapshot(); assert.ok(shown.kind === 'review');
      assert.deepEqual(shown.notice, { code: 'PUBLISH_REFUSED', engineCode: 'DICTIONARY_CONFLICT' });
      assert.equal(allReviewed(shown.review), true); assert.equal(controller.issuance(), 'none');
      assert.deepEqual(events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'not-committed' }]);
      assert.deepEqual(controller.dispose(), { ok: true });
    } else {
      assert.deepEqual(result, { ok: false, code: 'PUBLISH_UNKNOWN' });
      assert.equal(controller.snapshot().kind, 'unknown'); assert.equal(controller.issuance(), 'unresolved');
      assert.deepEqual(events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'unresolved' }]);
      assert.deepEqual(await controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
      assert.equal(controller.issuance(), 'unresolved', 'An absent receipt cannot settle an issued publication.');
      assert.deepEqual(controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
      assert.equal(synthetic.count('ontology.publish'), 1, 'Readback must not retry publication.');
    }
    assert.equal(JSON.stringify(controller.snapshot()).includes('Synthetic private'), false);
  }
});

test('renderer rejects malformed envelopes without reading getters, coercing codes or accepting prototypes', async () => {
  let getterCalls = 0, conversions = 0;
  const valid = { version: 1, ok: false, error: { code: 'VAULT_LOCKED' } };
  const getter = Object.defineProperty({ version: 1, ok: false }, 'error', { enumerable: true, get() { getterCalls++; return valid.error; } });
  const code = { toString() { conversions++; return 'VAULT_LOCKED'; } };
  for (const value of [null, [], new Error('VAULT_LOCKED'), { code: 'VAULT_LOCKED' },
    { ...valid, version: 2 }, { ...valid, result: 'old evidence' }, { ...valid, error: { code: 'UNKNOWN_CODE' } },
    { ...valid, error: { code, message: 'secret' } }, { ...valid, error: { code } }, getter,
    Object.assign(Object.create({ inherited: true }), valid), { ...valid, error: Object.create({ code: 'VAULT_LOCKED' }) },
    { ...valid, [Symbol('secret')]: true }, { version: 1, ok: true }, { version: 1, ok: true, result: 1, error: valid.error },
    new Proxy(valid, { getPrototypeOf() { throw new Error('private'); } })]) {
    assert.throws(() => unwrapDesktopRequestEnvelope(value), { code: 'REQUEST_FAILED', message: 'The desktop request failed.' });
  }
  assert.equal(getterCalls, 0); assert.equal(conversions, 0);
  const rejecting = createDesktopRequestPort({ async requestEnvelope() { throw new Error('VAULT_LOCKED: private SQL'); } });
  await assert.rejects(rejecting.request('ui.context'), { code: 'REQUEST_FAILED', message: 'The desktop request failed.' });
});

const retainedPublicRefusalCodes = [
  'SCENARIO_UNAVAILABLE', 'SCENARIO_REVISION_UNAVAILABLE',
  'SCENARIO_EVIDENCE_UNAVAILABLE', 'SCENARIO_FORBIDDEN',
  'SCENARIO_AUTHORITY_CHANGED', 'SCENARIO_ARTIFACT_CHANGED',
  'SCENARIO_RETENTION_EXPIRED', 'SCENARIO_HOST_REQUIRED',
  'SCENARIO_CUSTODY_INVALID', 'SCENARIO_CUSTODY_CONFLICT',
  'SCENARIO_TAINTED_CONTEXT', 'SCENARIO_WORKSPACE_CHANGED',
  'SCENARIO_RUN_UNAVAILABLE', 'SCENARIO_READ_ONLY',
  'SCENARIO_HEAD_CHANGED', 'SCENARIO_JOB_UNAVAILABLE',
  'SCENARIO_BRANCH_UNAVAILABLE', 'SCENARIO_GRAPH_INVALID',
  'SCENARIO_VECTOR_MISMATCH', 'INVALID_SCENARIO',
  'LESSON_AUTHORITY_REQUIRED', 'LESSON_AUTHORITY_REVISION_REQUIRED',
  'LESSON_AUTHORITY_CHANGED', 'LESSON_REVIEW_CHANGED',
  'LESSON_EVALUATION_BLOCKED', 'EVALUATION_AUTHORITY_REQUIRED',
  'EVALUATION_CHANGED', 'EVALUATION_CANDIDATE_MISMATCH',
  'EVALUATION_PROVENANCE_REQUIRED', 'EVALUATION_COMPARISON_MISMATCH',
  'INVALID_LESSON_EVALUATION', 'LESSON_EVIDENCE_UNAVAILABLE',
  'LESSON_EVIDENCE_CHANGED', 'LESSON_TARGET_CHANGED',
  'LESSON_OWNER_REQUIRED', 'LESSON_WORKSPACE_CHANGED',
  'LESSON_NOT_FOUND', 'LESSON_CHANGED', 'INVALID_LESSON',
  'INVALID_LESSON_DECISION', 'INVALID_LESSON_STATE',
  'INVALID_LESSON_TARGET', 'APP_LESSON_REVIEW_REQUIRED',
  'TAINTED_LESSON', 'LESSON_CONFLICT', 'INVALID_SUPERSESSION',
] as const;

test('public retained refusals preserve only their exact code through actual preload copies', async () => {
  assert.equal(retainedPublicRefusalCodes.length, 46);
  assert.equal(new Set(retainedPublicRefusalCodes).size, 46);
  for (const code of retainedPublicRefusalCodes) {
    const method = code.startsWith('SCENARIO_') || code === 'INVALID_SCENARIO'
      ? 'scenarios.reopen' : 'memory.lessons';
    const h = fixture(() => refusal(code));
    const wire = await h.api.requestEnvelope(method, {});
    assert.deepEqual(wire, { version: 1, ok: false, error: { code } }, code);
    assert.equal(Object.isFrozen(wire), true);
    assert.equal(Object.isFrozen((wire as { error: object }).error), true);
    assert.equal(JSON.stringify(wire).includes('Synthetic private detail'), false);
    await assert.rejects(h.port.request(method, {}), {
      code, message: 'The desktop request failed.',
    });
    assert.equal(h.calls.length, 2, 'Each explicit probe dispatches once; neither retries.');
  }
});

test('private, unemitted and unknown retained codes remain generic at both bridge copies', async () => {
  for (const code of [
    'LESSON_AUTHORITIES_REQUIRED', 'PROTECTED_LESSON_TARGET',
    'INVALID_LESSON_STATE_NAMESPACE', 'SYNTHETIC_RETAINED_UNKNOWN',
  ]) {
    const h = fixture(() => refusal(code));
    assert.deepEqual(await h.api.requestEnvelope('memory.lessons', {}), {
      version: 1, ok: false, error: { code: 'REQUEST_FAILED' },
    });
    await assert.rejects(h.port.request('memory.lessons', {}), {
      code: 'REQUEST_FAILED', message: 'The desktop request failed.',
    });
    assert.equal(h.calls.length, 2);
  }
});

test('the renderer mirrors every lane refusal line of the preload, and passes exactly those codes', async () => {
  const { laneRefusalCodes } = await import('../../app/ui/src/bridge/client.ts');
  const block = preloadSource.slice(preloadSource.indexOf('const laneRefusals = ['));
  const preloadLane = [...new Set([...block.slice(0, block.indexOf('];')).matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(match => match[1]!))].sort();
  assert.deepEqual([...laneRefusalCodes].sort(), preloadLane);
  for (const code of ['UNLOCK_FAILED', 'DEMO_CLOCK_ALREADY_SET']) {
    assert.throws(() => unwrapDesktopRequestEnvelope({ version: 1, ok: false, error: { code } }), { code });
  }
  assert.throws(() => unwrapDesktopRequestEnvelope({ version: 1, ok: false, error: { code: 'NOT_A_LANE_CODE' } }), { code: 'REQUEST_FAILED' });
});
