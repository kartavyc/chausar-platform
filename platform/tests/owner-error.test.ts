// One-shot A1 (row 0): a failed request shows the owner Chausar's own words, never engine source text or a path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { ownerError, UNEXPECTED_WORDS } from '../runtime/owner-error.ts';

test('owner error: Chausar refusals keep their code, words and plain reason', () => {
  assert.deepEqual(ownerError(new ChausarError('CHAT_CONSENT_REQUIRED', 'Agree first.')), { code: 'CHAT_CONSENT_REQUIRED', message: 'Agree first.', owner: true });
  assert.deepEqual(ownerError(Object.assign(new ChausarError('DEVICE_KEYS_UNAVAILABLE', 'No key here.'), { reason: 'locked' })), { code: 'DEVICE_KEYS_UNAVAILABLE', message: 'No key here.', reason: 'locked', owner: true });
  assert.deepEqual(ownerError(Object.assign(new Error('This session ended.'), { code: 'UNAUTHENTICATED' })), { code: 'UNAUTHENTICATED', message: 'This session ended.', owner: true });
  assert.equal(ownerError(Object.assign(new ChausarError('X', 'y'), { reason: 'Not A Tag' })).reason, undefined);
});

test('owner error: a JavaScript error or a Node file error becomes one plain sentence', () => {
  const proxy = new TypeError("'get' on proxy: property 'preview' is a read-only and non-configurable data property on the proxy target");
  for (const error of [proxy, new Error('boom at C:/Users/someone/x.ts:12'), Object.assign(new Error("ENOENT: no such file, open 'C:/secret/path'"), { code: 'ENOENT', syscall: 'open', errno: -2 }),
    Object.assign(new Error('bad'), { code: 'ERR_INVALID_ARG_TYPE' }), 'a thrown string', null]) {
    const shown = ownerError(error);
    assert.deepEqual(shown, { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
  }
  assert.doesNotMatch(UNEXPECTED_WORDS, /\u2014/);
});

test('review of A1: an upper-case code is not enough; a network library error never shows its words', () => {
  // undici's connect timeout: an upper-case code, no syscall, and a message with the host and port in it.
  const undici = Object.assign(new Error('Connect Timeout Error (attempted address: api.example.com:443, timeout: 10000ms)'), { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' });
  assert.deepEqual(ownerError(undici), { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
  assert.deepEqual(ownerError(Object.assign(new Error('Some library said no at C:/x'), { code: 'SOME_LIBRARY_CODE' })), { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
  // The engine's own codes on a plain error keep their words.
  assert.deepEqual(ownerError(Object.assign(new Error('This session ended.'), { code: 'UNAUTHENTICATED' })), { code: 'UNAUTHENTICATED', message: 'This session ended.', owner: true });
  assert.deepEqual(ownerError(Object.assign(new Error('Pick a price.'), { code: 'PRICE_REQUIRED' })), { code: 'PRICE_REQUIRED', message: 'Pick a price.', owner: true });
  assert.deepEqual(ownerError(Object.assign(new Error('Open it from the list.'), { code: 'TRANSFER_SAME_BUSINESS' })), { code: 'TRANSFER_SAME_BUSINESS', message: 'Open it from the list.', owner: true });
});

test('A1 re-review: a playbook refusal thrown as a coded plain error is Chausar\'s own; a library or system error is not', async () => {
  const { asRefusal } = await import('../runtime/venture/refusals.ts');
  const { refusalError } = await import('../runtime/venture/refusal-brand.ts');
  const seo = asRefusal(refusalError(new Error('Give the Search Console export and the recorded content and AI-answer gaps.'), { code: 'GSC_EXPORT_INVALID' }));
  assert.ok(seo instanceof ChausarError);
  assert.deepEqual(ownerError(seo), { code: 'GSC_EXPORT_INVALID', message: 'Give the Search Console export and the recorded content and AI-answer gaps.', owner: true });
  for (const other of [
    Object.assign(new Error('Connect Timeout Error (attempted address: api.example.com:443)'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    Object.assign(new Error('bad argument'), { code: 'ERR_INVALID_ARG_TYPE' }),
    Object.assign(new Error("EPERM: operation not permitted, open 'C:/x'"), { code: 'EPERM', syscall: 'open', errno: -1 }),
    new TypeError('x is not a function'), 'a string',
  ]) assert.equal(asRefusal(other), null);
});

test('A1 final check: only a branded refusal converts; a library error with the same shape stays a fault and a crash', async () => {
  const { asRefusal, settleError } = await import('../runtime/venture/refusals.ts');
  const { refusalError } = await import('../runtime/venture/refusal-brand.ts');
  // A real Node http "socket hang up": code ECONNRESET and no syscall.
  const { createServer, request } = await import('node:http');
  const server = createServer((req) => { req.socket.destroy(); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const hangUp = await new Promise<Error>(done => { const req = request({ host: '127.0.0.1', port, path: '/' }, () => {}); req.on('error', done); req.end(); });
  server.close();
  assert.equal((hangUp as any).code, 'ECONNRESET');
  assert.equal((hangUp as any).syscall, undefined, 'the shape the old guess accepted');
  // An SDK's "not found: <path>": code ENOENT, no syscall, a path in its words.
  const notFound = Object.assign(new Error('not found: C:/Users/someone/project/file.txt'), { code: 'ENOENT' });
  const sameShape = Object.assign(new Error('Give a full address.'), { code: 'SEO_SOURCE_INVALID' });
  for (const error of [hangUp, notFound, sameShape, Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }), Object.assign(new Error('bad'), { code: 'EINVAL' })]) {
    assert.equal(asRefusal(error), null, (error as Error).message);
    assert.deepEqual(ownerError(error), { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
    assert.equal(settleError(error).crash, true, 'noted as a crash');
  }
  const branded = settleError(refusalError(new Error('Build a strategy from its recorded work, panel and publication receipt.'), { code: 'STRATEGY_BINDING_REQUIRED' }));
  assert.equal(branded.crash, false);
  assert.deepEqual(ownerError(branded.error), { code: 'STRATEGY_BINDING_REQUIRED', message: 'Build a strategy from its recorded work, panel and publication receipt.', owner: true });
});

test('unexpected failures point to the current Reports page', () => {
  assert.match(ownerError(new Error('unexpected')).message, /Settings > Safety > Reports/);
});