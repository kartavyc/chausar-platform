import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadTransportError } from '../runtime/connector-framework/read.ts';
import type { ReadTransportContext } from '../runtime/connector-framework/read.ts';
import {
  date, decimal, parseExactJson, parseResponse, responseText, wireSchemaFingerprint,
} from '../runtime/adapters/accounting/common.ts';
import type { AccountingHttpResponse } from '../runtime/adapters/accounting/common.ts';

const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
const url = 'https://fixture.invalid/reviewed-read';
const context: ReadTransportContext = {
  authorization: { scope: { tenantId: 'fixture', sourceId: 'accounting-source', companyId: 'Fixture' },
    authorityRevision: 'reviewed', grantedScopes: [], expiresAtMs: 1_000_000, credentialReference: 'opaque-reference' },
  signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 4096, attempt: 1, retryOwner: 'dispatcher',
};
const response = (content = '{"total":118.000}', patch: Partial<AccountingHttpResponse> = {}): AccountingHttpResponse => ({
  status: 200, content: Buffer.from(content), contentType: 'application/json', finalUrl: url, ...patch,
});
const transportFailure = (kind: ReadTransportError['kind'], receivedBytes: number, retryAfterMs: number | null = null) => (error: unknown) => {
  assert.ok(error instanceof ReadTransportError); assert.equal(error.kind, kind);
  assert.equal(error.receivedBytes, receivedBytes); assert.equal(error.retryAfterMs, retryAfterMs); assert.equal(error.cleanup, 'settled'); return true;
};

test('exact JSON preserves unquoted decimal spelling, large integers, exponents and raw source strings', () => {
  const parsed = parseExactJson('\uFEFF{"amount":9007199254740993.2500,"id":900719925474099312345,"small":1e-9,"negative":-0.00,"quoted":"118.000","flag":true,"empty":null,"nested":[0,0.001]}');
  assert.deepEqual(parsed, { amount: '9007199254740993.2500', id: '900719925474099312345', small: '1e-9', negative: '-0.00', quoted: '118.000', flag: true, empty: null, nested: ['0', '0.001'] });
  assert.throws(() => decimal('1e-9'), code('ACCOUNTING_DECIMAL_INVALID'));
  assert.throws(() => decimal(118), code('ACCOUNTING_TEXT_REQUIRED'));
});

test('ambiguous, reserved and escaped duplicate JSON keys fail before mappings can see values', () => {
  for (const content of ['{"amount":1,"amount":2}', '{"amount":1,"am\\u006funt":2}', '{"__proto__":{}}', '{"nested":{"constructor":1}}', '{"prototype":null}']) {
    assert.throws(() => parseExactJson(content), code('ACCOUNTING_JSON_KEY_INVALID'));
  }
  assert.equal(Object.getPrototypeOf(parseExactJson('{"safe":1}')), Object.prototype);
});

test('malformed JSON, structural depth, node count and byte budgets are bounded', () => {
  for (const content of ['{"n":01}', '{"n":1,}', '[1,]', 'NaN', 'Infinity', 'true false', '"unterminated', '{"n":1e}', '{"n":.1}', '"line\nbreak"']) {
    assert.throws(() => parseExactJson(content), code('ACCOUNTING_JSON_INVALID'));
  }
  assert.throws(() => parseExactJson('['.repeat(49) + '0' + ']'.repeat(49)), code('ACCOUNTING_JSON_LIMIT'));
  assert.throws(() => parseExactJson('[' + Array(200_001).fill('0').join(',') + ']'), code('ACCOUNTING_JSON_LIMIT'));
  assert.throws(() => parseExactJson('"' + 'a'.repeat(4 * 1024 * 1024) + '"'), code('ACCOUNTING_PAGE_LIMIT'));
});

test('wire fingerprints ignore scalar values and collection order but distinguish numbers from quoted amounts and new fields', () => {
  const first = wireSchemaFingerprint('{"invoices":[{"id":"1","total":118.000,"date":"2026-09-01"},{"id":"2","total":2,"date":"2026-09-02"}]}');
  assert.equal(first, wireSchemaFingerprint('{"invoices":[{"total":999.999,"date":"2026-08-01","id":"9"},{"date":"2026-08-02","id":"8","total":0}]}'));
  assert.notEqual(first, wireSchemaFingerprint('{"invoices":[{"id":"1","total":"118.000","date":"2026-09-01"}]}'));
  assert.notEqual(first, wireSchemaFingerprint('{"invoices":[{"id":"1","total":118.000,"date":"2026-09-01","new_tax_basis":true}]}'));
  assert.notEqual(wireSchemaFingerprint('{"amount":null}'), wireSchemaFingerprint('{"amount":0}'));
});

test('calendar dates validate actual days and decimals do not coerce missing, rounded or formatted values', () => {
  assert.equal(date('2024-02-29'), '2024-02-29'); assert.equal(date(null), null);
  for (const value of ['2026-02-29', '2026-04-31', '2026-09-01T01:00:00Z', '01/09/2026']) assert.throws(() => date(value), code('ACCOUNTING_DATE_INVALID'));
  assert.equal(decimal('9007199254740993.2500'), '9007199254740993.2500'); assert.equal(decimal(null), null);
  for (const value of ['1,000', '+1', '01', '1.', '.1', 'NaN']) assert.throws(() => decimal(value), code('ACCOUNTING_DECIMAL_INVALID'));
});

test('transport retains successful bytes and refuses invalid UTF-8, redirected URLs, content types and over-budget payloads', () => {
  const raw = response('{"description":"₹ invoice","total":118.000}');
  assert.equal(responseText(raw, url, context), Buffer.from(raw.content).toString('utf8'));
  const invalid = response('', { content: Uint8Array.from([0xc3, 0x28]) });
  assert.throws(() => responseText(invalid, url, context), transportFailure('invalid-request', 2));
  for (const patch of [{ status: 302 }, { finalUrl: 'https://fixture.invalid/unqualified' }, { contentType: 'text/html' }]) {
    const failed = response('private source body', patch);
    assert.throws(() => responseText(failed, url, context), transportFailure('unsupported', failed.content.byteLength));
  }
  const huge = response('x'.repeat(4097));
  assert.throws(() => responseText(huge, url, context), transportFailure('invalid-request', 4097));
  for (const status of [undefined, NaN, 200.5, 99, 600]) {
    const malformed = response('{}', { status: status as number });
    assert.throws(() => responseText(malformed, url, context), transportFailure('invalid-request', malformed.content.byteLength));
  }
});

test('HTTP error classification reports discarded bytes and never shortens malformed or HTTP-date Retry-After floors', () => {
  const body = 'source failure body';
  for (const [status, kind] of [[401, 'authentication-expired'], [403, 'permission-denied'], [429, 'rate-limited'], [503, 'temporarily-unavailable'], [400, 'invalid-request']] as const) {
    assert.throws(() => responseText(response(body, { status }), url, context), transportFailure(kind, Buffer.byteLength(body)));
  }
  assert.throws(() => responseText(response(body, { status: 429, headers: { 'Retry-After': '3' } }), url, context), transportFailure('rate-limited', Buffer.byteLength(body), 3000));
  for (const floor of ['Wed, 30 Sep 2026 12:00:03 GMT', '-1', '0.5', 'tomorrow', '999999999']) {
    assert.throws(() => responseText(response(body, { status: 429, headers: { 'retry-after': floor } }), url, context), transportFailure('rate-limited', Buffer.byteLength(body), 86_400_000));
  }
});

test('parser failures charge all source response bytes and preserve the closed transport failure boundary', () => {
  const failed = response('{"amount":1,"amount":2}');
  assert.throws(() => parseResponse(failed, url, context, parseExactJson), transportFailure('invalid-request', failed.content.byteLength));
  const intentional = new ReadTransportError('unsupported', null, 'settled', 7);
  assert.throws(() => parseResponse(response(), url, context, () => { throw intentional; }), error => error === intentional);
});
