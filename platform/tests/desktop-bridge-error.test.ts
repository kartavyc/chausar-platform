import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createDesktopRequestPort, createDesktopReceiptReader, readFailureCode, unwrapDesktopRequestEnvelope,
} from '../../app/ui/src/bridge/client.ts';
import { createHostController } from '../../app/ui/src/host/controller.ts';
import { createConversationHost } from '../../app/ui/src/bridge/conversation-host.ts';
import { fullCalculationReceiptFixture } from '../../app/ui/tests/fixtures.ts';
import { loadElectronPreloadFixture } from './fixtures/electron-context-bridge.ts';

interface FixtureApi {
  request(method: string, payload?: unknown): Promise<unknown>;
  requestEnvelope(method: string, payload?: unknown): Promise<unknown>;
}
const preloadPath = new URL('../../app/desktop/preload.cjs', import.meta.url);
const preloadSource = await readFile(preloadPath, 'utf8');
const refusal = (code: string) => ({ ok: false, error: { code, message: 'Synthetic private detail must stay in preload.' } });
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
  assert.deepEqual(preloadCodes, codes(clientSource, /const desktopRefusalCodes = \[([\s\S]*?)\] as const;/));
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
