import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopReceiptReader, createBrowserReceiptReader, createEnterpriseStatusReader, isEvidenceDenial } from '../src/bridge/client.ts';
import { fullCalculationReceiptFixture } from './fixtures.ts';

test('desktop rereads exact receipt identity through the existing named engine method', async () => {
  const input = fullCalculationReceiptFixture();
  const calls: unknown[] = [];
  const reader = createDesktopReceiptReader({ async request(method, payload) { calls.push({ method, payload }); return input; } });
  assert.equal(reader.environment, 'desktop');
  const first = await reader.receipt(input.id); const second = await reader.receipt(input.id);
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.deepEqual(calls, [
    { method: 'receipts.get', payload: { id: input.id } },
    { method: 'receipts.get', payload: { id: input.id } },
  ]);
  assert.notEqual(first, second); // No stale object bypasses current engine access.
});

test('browser RPC and enterprise API are distinct adapters with no receipt schema alias', async () => {
  const input = fullCalculationReceiptFixture();
  const browserCalls: unknown[] = [], enterpriseCalls: unknown[] = [];
  const browser = createBrowserReceiptReader({ async call(message) { browserCalls.push(message); return input; } });
  const enterprise = createEnterpriseStatusReader({ async get(path) { enterpriseCalls.push(path); return { investigationId: 'investigation_fixture', status: 'completed', resultId: 'result_fixture' }; } });
  assert.equal(browser.environment, 'browser'); assert.equal(enterprise.environment, 'enterprise');
  assert.equal((await browser.receipt(input.id)).ok, true);
  assert.deepEqual(await enterprise.investigation('investigation_fixture'), { ok: true, value: { investigationId: 'investigation_fixture', status: 'completed', resultId: 'result_fixture' } });
  assert.deepEqual(browserCalls, [{ method: 'receipts.get', payload: { id: input.id } }]);
  assert.deepEqual(enterpriseCalls, ['/v1/investigations/investigation_fixture']);
  assert.equal(Object.hasOwn(enterprise, 'receipt'), false);
  const wrongSchema = createEnterpriseStatusReader({ async get() { return input; } });
  assert.deepEqual(await wrongSchema.investigation('investigation_fixture'), { ok: false, code: 'INVALID_REPLY' });
});

test('invalid replies and wrong IDs fail atomically before any values are exposed', async () => {
  const input = fullCalculationReceiptFixture();
  for (const value of [{ ...input, id: 'other_receipt' }, { ...input, valueMinor: 1.5 }, { ...input, sourceIds: null }, { message: 'raw source text' }]) {
    const reader = createDesktopReceiptReader({ async request() { return value; } });
    assert.deepEqual(await reader.receipt(input.id), { ok: false, code: 'INVALID_REPLY' });
  }
  const wrongId = createEnterpriseStatusReader({ async get() { return { investigationId: 'someone_else', status: 'completed' }; } });
  assert.deepEqual(await wrongId.investigation('investigation_fixture'), { ok: false, code: 'INVALID_REPLY' });
});

test('transport failure contains no raw error, reroute, retry or prior result', async () => {
  let calls = 0;
  const reader = createDesktopReceiptReader({ async request() { calls++; throw new Error('private SQL and secret-token fixture'); } });
  const result = await reader.receipt('receipt_fixture');
  assert.deepEqual(result, { ok: false, code: 'REQUEST_FAILED' }); assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('unsafe IDs are refused before transport and current JSON reply handling is explicit', async () => {
  let calls = 0;
  const source = fullCalculationReceiptFixture();
  const directCoreShape = { ...source, rows: source.rows.map(row => ({ ...row, branch: undefined })) };
  // Current engine child-process JSON IPC and browser JSON remove this optional property.
  const serialized = JSON.parse(JSON.stringify(directCoreShape)) as unknown;
  const jsonReader = createDesktopReceiptReader({ async request() { calls++; return serialized; } });
  assert.deepEqual(await jsonReader.receipt('https://example.invalid/receipt'), { ok: false, code: 'INVALID_REPLY' });
  assert.equal(calls, 0);
  assert.equal((await jsonReader.receipt(source.id)).ok, true);
  const untransported = createDesktopReceiptReader({ async request() { return directCoreShape; } });
  assert.deepEqual(await untransported.receipt(source.id), { ok: false, code: 'INVALID_REPLY' });
});

test('workspace lock or access invalidation refuses late completions and failures', async () => {
  const input = fullCalculationReceiptFixture();
  let finish: ((reply: unknown) => void) | undefined;
  const reader = createDesktopReceiptReader({ request() { return new Promise(resolve => { finish = resolve; }); } });
  const late = reader.receipt(input.id); reader.invalidate(); finish!(input);
  assert.deepEqual(await late, { ok: false, code: 'READ_INVALIDATED' });
  let reject: ((error: unknown) => void) | undefined;
  const browser = createBrowserReceiptReader({ call() { return new Promise((_, failure) => { reject = failure; }); } });
  const oldFailure = browser.receipt(input.id); browser.invalidate(); reject!(new Error('old private failure'));
  assert.deepEqual(await oldFailure, { ok: false, code: 'READ_INVALIDATED' });
  let completed: ((reply: unknown) => void) | undefined;
  const enterprise = createEnterpriseStatusReader({ get() { return new Promise(resolve => { completed = resolve; }); } });
  const oldCompany = enterprise.investigation('investigation_fixture'); enterprise.invalidate(); completed!({ investigationId: 'investigation_fixture', status: 'completed' });
  assert.deepEqual(await oldCompany, { ok: false, code: 'READ_INVALIDATED' });
});

test('authority loss returns a fixed denial code and invalidates concurrent evidence reads', async () => {
  for (const [sourceCode, expectedCode] of [
    ['ACCESS_REVOKED', 'ACCESS_DENIED'], ['RECEIPT_FORBIDDEN', 'ACCESS_DENIED'], ['SOURCE_REVOKED', 'ACCESS_DENIED'],
    ['VAULT_LOCKED', 'VAULT_LOCKED'], ['UNAUTHENTICATED', 'UNAUTHENTICATED'], ['RECEIPT_NOT_FOUND', 'EVIDENCE_UNAVAILABLE'],
    ['authority_denied', 'ACCESS_DENIED'], ['authentication_required', 'UNAUTHENTICATED'], ['not_found', 'EVIDENCE_UNAVAILABLE'],
  ] as const) {
    let complete: ((reply: unknown) => void) | undefined;
    const reader = createDesktopReceiptReader({ request(_, payload) {
      if (payload.id === 'slow_receipt') return new Promise(resolve => { complete = resolve; });
      return Promise.reject(Object.assign(new Error('private denial detail'), { code: sourceCode }));
    } });
    const slow = reader.receipt('slow_receipt');
    const denied = await reader.receipt('denied_receipt');
    assert.deepEqual(denied, { ok: false, code: expectedCode }); assert.equal(isEvidenceDenial(expectedCode), true);
    complete!({ ...fullCalculationReceiptFixture(), id: 'slow_receipt' });
    assert.deepEqual(await slow, { ok: false, code: 'READ_INVALIDATED' });
  }
  assert.equal(isEvidenceDenial('REQUEST_FAILED'), false);
});

test('error code accessors and unrecognized error text cannot execute or leak', async () => {
  let getterCalls = 0;
  const error = Object.defineProperty(new Error('private error data'), 'code', { get() { getterCalls++; return 'ACCESS_REVOKED'; } });
  const reader = createDesktopReceiptReader({ async request() { throw error; } });
  assert.deepEqual(await reader.receipt('receipt_fixture'), { ok: false, code: 'REQUEST_FAILED' });
  assert.equal(getterCalls, 0);
  let conversions = 0;
  const objectCode = { toString() { conversions++; return 'ACCESS_REVOKED'; } };
  const noCoercion = createDesktopReceiptReader({ async request() { throw { code: objectCode }; } });
  assert.deepEqual(await noCoercion.receipt('receipt_fixture'), { ok: false, code: 'REQUEST_FAILED' });
  assert.equal(conversions, 0);
});
