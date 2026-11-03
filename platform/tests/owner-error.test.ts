// One-shot A1 (row 0): a failed request shows the owner Chausar's own words, never engine source text or a path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { ownerError, UNEXPECTED_WORDS } from '../runtime/owner-error.ts';

test('owner error: Chausar refusals keep their code, words and plain reason', () => {
  assert.deepEqual(ownerError(new ChausarError('CHAT_CONSENT_REQUIRED', 'Agree first.')), { code: 'CHAT_CONSENT_REQUIRED', message: 'Agree first.' });
  assert.deepEqual(ownerError(Object.assign(new ChausarError('DEVICE_KEYS_UNAVAILABLE', 'No key here.'), { reason: 'locked' })), { code: 'DEVICE_KEYS_UNAVAILABLE', message: 'No key here.', reason: 'locked' });
  assert.deepEqual(ownerError(Object.assign(new Error('This session ended.'), { code: 'UNAUTHENTICATED' })), { code: 'UNAUTHENTICATED', message: 'This session ended.' });
  assert.equal(ownerError(Object.assign(new ChausarError('X', 'y'), { reason: 'Not A Tag' })).reason, undefined);
});

test('owner error: a JavaScript error or a Node file error becomes one plain sentence', () => {
  const proxy = new TypeError("'get' on proxy: property 'preview' is a read-only and non-configurable data property on the proxy target");
  for (const error of [proxy, new Error('boom at C:/Users/someone/x.ts:12'), Object.assign(new Error("ENOENT: no such file, open 'C:/secret/path'"), { code: 'ENOENT', syscall: 'open', errno: -2 }),
    Object.assign(new Error('bad'), { code: 'ERR_INVALID_ARG_TYPE' }), 'a thrown string', null]) {
    const shown = ownerError(error);
    assert.deepEqual(shown, { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS });
  }
  assert.doesNotMatch(UNEXPECTED_WORDS, /\u2014/);
});
