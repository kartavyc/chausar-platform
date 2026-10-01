import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../runtime/actions.ts';
import { ReadTransportError } from '../runtime/connector-framework/read.ts';
import type { ReadTransportContext } from '../runtime/connector-framework/read.ts';
import type { IndependentSourceTotals } from '../runtime/connector-framework/import.ts';
import {
  date, decimal, makeRecord, parseExactJson, parseResponse, responseText, wireSchemaFingerprint,
} from '../runtime/adapters/accounting/common.ts';
import type { AccountingHttpResponse, AccountingPage, AccountingRecord } from '../runtime/adapters/accounting/common.ts';
import {
  createAccountingDecoder, proposeAccountingMapping, reconcileAccountingSourceTotals, toMinorExact,
} from '../runtime/adapters/accounting/import.ts';

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
const domain = { company: 'Fixture', dataset: 'invoice-subtotals', branches: ['all'], period: { from: '2026-09-01', to: '2026-09-30' } };
const snapshot = { kind: 'source-snapshot' as const, id: 'fixture-source-snapshot' };
const record = (patch: Partial<AccountingRecord> = {}): AccountingRecord => makeRecord({
  id: 'invoice-1', revision: '1', kind: 'invoice', sourceType: 'fixture-invoice', direction: 'receivable',
  date: '2026-09-01', currency: 'INR', total: '118.000', subtotal: '100.000', taxTotal: '18.000', status: 'open', sourceStatus: 'sent', source: {}, ...patch,
});
const independentTotal = (patch: Partial<IndependentSourceTotals> = {}): IndependentSourceTotals => ({
  provenance: 'independent-source-report', reportId: 'fixture-independent-invoice-register', sha256: digest('fixture register: INR 100.00, 1 invoice'),
  domainHash: digest(domain), company: domain.company, dataset: domain.dataset, currency: 'INR', rowCount: 1, amountMinor: '10000',
  observedAt: '2026-09-30T12:00:00.000Z', snapshotId: snapshot.id, ...patch,
});
const reconcile = (records: AccountingRecord[], expected: IndependentSourceTotals | null = independentTotal()) => reconcileAccountingSourceTotals({
  records, kind: 'invoice', currency: 'INR', minorDigits: 2, measure: 'subtotal', domain, snapshot, expected,
});
const decoder = (records: AccountingRecord[], patch: Partial<Parameters<typeof createAccountingDecoder>[0]> = {}) => createAccountingDecoder({
  id: 'fixture-accounting-decoder', version: 'v1', identityNamespace: 'fixture-accounting-invoices-v1', schemaSha256: digest('reviewed fixture schema'),
  company: domain.company, dataset: domain.dataset, branch: 'all', measure: 'subtotal', minorDigitsByCurrency: { INR: 2 },
  parse: (): AccountingPage => ({ records, continuation: { kind: 'complete' }, totalRows: null, sourceGeneratedAtMs: null, snapshotId: null, warnings: [] }), ...patch,
});

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

test('minor-unit conversion remains exact beyond safe integers and across explicit currency precisions', () => {
  for (const [major, digits, minor] of [['9007199254740993.2500', 2, '900719925474099325'], ['-0.010', 2, '-1'], ['-0.000', 3, '0'], ['12.000', 0, '12'], ['12.345000', 3, '12345'], ['0.000001', 6, '1']] as const) {
    assert.equal(toMinorExact(major, digits), minor);
  }
  for (const [major, digits] of [['1.001', 2], ['1.1', 0], ['0.0000001', 6]] as const) assert.throws(() => toMinorExact(major, digits), code('ACCOUNTING_MINOR_PRECISION'));
  for (const digits of [-1, 7, 2.5, NaN]) assert.throws(() => toMinorExact('1', digits), code('ACCOUNTING_PRECISION_INVALID'));
  assert.throws(() => toMinorExact('', 2), code('ACCOUNTING_DECIMAL_INVALID'));
});

test('source reconciliation deduplicates identical revisions while keeping source amount and report custody separate', () => {
  const single = record(), matched = reconcile([single, structuredClone(single)]);
  assert.equal(matched.status, 'matched'); assert.equal(matched.observed.rowCount, 1); assert.equal(matched.observed.amountMinor, '10000');
  assert.equal(matched.differenceMinor, '0'); assert.equal(matched.snapshotConsistent, true); assert.equal(matched.expected?.reportId, 'fixture-independent-invoice-register');
  const mismatched = reconcile([single], independentTotal({ amountMinor: '10001' }));
  assert.equal(mismatched.status, 'mismatch'); assert.equal(mismatched.differenceMinor, '-1'); assert.ok(mismatched.reasons.includes('SOURCE_TOTAL_MISMATCH'));
});

test('reconciliation refuses mixed currencies, event kinds, contradictory identities and unordered revisions', () => {
  assert.throws(() => reconcile([record(), record({ id: 'invoice-2', currency: 'USD' })]), code('ACCOUNTING_TOTAL_CURRENCY_MISMATCH'));
  assert.throws(() => reconcile([record(), record({ id: 'payment-1', kind: 'payment' })]), code('ACCOUNTING_TOTAL_KIND_MISMATCH'));
  assert.throws(() => reconcile([record(), record({ subtotal: '101.000' })]), code('ACCOUNTING_TOTAL_DUPLICATE_CONFLICT'));
  assert.throws(() => reconcile([record(), record({ revision: '2', subtotal: '101.000' })]), code('ACCOUNTING_TOTAL_REVISION_CONFLICT'));
});

test('missing source amounts and independent reports remain unavailable, with observed zero separate from absence', () => {
  const missingAmount = reconcile([record({ subtotal: null })]);
  assert.equal(missingAmount.status, 'unavailable'); assert.equal(missingAmount.observed.amountMinor, null); assert.equal(missingAmount.differenceMinor, null);
  assert.deepEqual(missingAmount.reasons, ['OBSERVED_AMOUNT_UNAVAILABLE']);
  const missingReport = reconcile([record()], null);
  assert.equal(missingReport.status, 'unavailable'); assert.deepEqual(missingReport.reasons, ['SOURCE_TOTALS_REQUIRED']);
  const zero = reconcile([record({ subtotal: '0.000' })], independentTotal({ amountMinor: '0' }));
  assert.equal(zero.status, 'matched'); assert.equal(zero.observed.amountMinor, '0');
  const empty = reconcile([], independentTotal({ rowCount: 0, amountMinor: '0' }));
  assert.equal(empty.status, 'unavailable'); assert.equal(empty.observed.rowCount, 0); assert.equal(empty.observed.amountMinor, null);
});

test('report scope, currency and snapshot identity are independently checked', () => {
  const scope = reconcile([record()], independentTotal({ domainHash: digest('another company') }));
  assert.equal(scope.status, 'mismatch'); assert.ok(scope.reasons.includes('SOURCE_TOTAL_SCOPE_MISMATCH'));
  const foreign = reconcile([record()], independentTotal({ currency: 'USD' }));
  assert.equal(foreign.status, 'mismatch'); assert.equal(foreign.differenceMinor, null);
  const unsnapshotted = reconcile([record()], independentTotal({ snapshotId: 'another observation' }));
  assert.equal(unsnapshotted.status, 'matched'); assert.equal(unsnapshotted.snapshotConsistent, false);
});

test('accounting decoder preserves source custody and typed event direction, without inferring revision ordering', () => {
  const original = record({ source: { native_tax_basis: 'inclusive', total: '118.000' } });
  const parsed = decoder([original]).decode('trusted parser input')[0];
  assert.equal(parsed.amount, '10000'); assert.equal(parsed.eventType, 'invoice:fixture-invoice:receivable');
  assert.equal(parsed.sourceKind, 'invoice'); assert.equal(parsed.sourceType, 'fixture-invoice'); assert.equal(parsed.direction, 'receivable');
  assert.equal(parsed.revision, '1'); assert.equal(parsed.statusKey, 'open:sent'); assert.equal(parsed.sourceStatus, 'sent');
  assert.deepEqual(JSON.parse(parsed.accounting as string), original);
  assert.deepEqual(decoder([original]).revisionOrder, { kind: 'unqualified' });
  const unidentifiedRevision = decoder([record({ revision: null })]).decode('first')[0];
  assert.match(unidentifiedRevision.revision as string, /^content:[a-f0-9]{64}$/);
  assert.equal(unidentifiedRevision.revision, decoder([record({ revision: null })]).decode('redelivery')[0].revision);
  assert.notEqual(unidentifiedRevision.revision, decoder([record({ revision: null, subtotal: '101' })]).decode('changed')[0].revision);
});

test('decoder precision is explicit per currency and its immutable version binds company, measure and precision', () => {
  const digits = { INR: 2, JPY: 0, KWD: 3 };
  const currencies = decoder([record(), record({ id: 'JPY-1', currency: 'JPY', subtotal: '123.000' }), record({ id: 'KWD-1', currency: 'KWD', subtotal: '1.234' })], { minorDigitsByCurrency: digits });
  digits.KWD = 2;
  assert.deepEqual(currencies.decode('source').map(row => row.amount), ['10000', '123', '1234']);
  assert.notEqual(currencies.version, decoder([], { minorDigitsByCurrency: digits }).version);
  assert.notEqual(decoder([]).version, decoder([], { measure: 'total' }).version);
  assert.notEqual(decoder([]).version, decoder([], { company: 'Another company' }).version);
  assert.throws(() => decoder([record({ currency: 'USD' })]).decode('source'), code('ACCOUNTING_CURRENCY_PRECISION_REQUIRED'));
  assert.equal(decoder([record({ currency: null })]).decode('source')[0].amount, null);
  assert.equal(decoder([record({ subtotal: null })]).decode('source')[0].amount, null);
  assert.throws(() => decoder([], { minorDigitsByCurrency: { INR: 7 } }), code('ACCOUNTING_PRECISION_INVALID'));
  assert.throws(() => decoder([record({ warnings: ['SOURCE_VALIDATION_ERRORS'] })]).decode('source'), code('ACCOUNTING_SOURCE_VALIDATION_ERRORS'));
  assert.throws(() => decoder([], { parse: () => ({ records: [record()], continuation: { kind: 'complete' }, totalRows: null,
    sourceGeneratedAtMs: null, snapshotId: null, warnings: ['SOURCE_VALIDATION_ERRORS'] }) }).decode('source'), code('ACCOUNTING_SOURCE_VALIDATION_ERRORS'));
});

test('distinct native payment success and failure statuses never share a settlement mapping key', () => {
  const rows = decoder([record({ kind: 'payment', sourceType: 'fixture-payment', direction: 'inflow', status: 'unknown', sourceStatus: 'success' }),
    record({ id: 'payment-2', kind: 'payment', sourceType: 'fixture-payment', direction: 'inflow', status: 'unknown', sourceStatus: 'failure' })]).decode('source');
  assert.equal(rows[0].statusKey, 'unknown:success'); assert.equal(rows[1].statusKey, 'unknown:failure');
  const proposal = proposeAccountingMapping({ id: 'fixture-payment-proposal', system: 'fixture', edition: 'fixture', company: domain.company,
    branch: 'all', currency: 'INR', eventTypes: { 'payment:fixture-payment:inflow': 'payment' }, statuses: { 'unknown:success': 'settled' } });
  const choices = proposal.recipe.bindings.find(binding => binding.target === 'status')!.values!;
  assert.equal(choices[rows[0].statusKey as string], 'settled'); assert.equal(Object.hasOwn(choices, rows[1].statusKey as string), false);
});

test('mapping proposals require authorized acceptance and explicit event/status choices rather than collapsing direction', () => {
  const eventTypes = { 'invoice:fixture-invoice:receivable': 'invoice' }, statuses = { 'open:sent': 'open' };
  const proposal = proposeAccountingMapping({ id: 'fixture-proposal', system: 'fixture', edition: 'fixture', company: domain.company,
    branch: 'all', currency: 'INR', eventTypes, statuses });
  eventTypes['invoice:fixture-invoice:receivable'] = 'sale'; statuses['open:sent'] = 'paid';
  assert.equal(proposal.requiresHumanAcceptance, true); assert.equal(proposal.semanticQualification, 'unqualified');
  const kind = proposal.recipe.bindings.find(binding => binding.target === 'kind');
  assert.equal(kind?.source, 'eventType'); assert.deepEqual(kind?.values, { 'invoice:fixture-invoice:receivable': 'invoice' });
  assert.equal(Object.hasOwn(kind!.values!, 'invoice:fixture-invoice:payable'), false);
  assert.equal(Object.hasOwn(kind!.values!, 'payment:fixture-payment:inflow'), false);
  const status = proposal.recipe.bindings.find(binding => binding.target === 'status');
  assert.equal(status?.source, 'statusKey'); assert.deepEqual(status?.values, { 'open:sent': 'open' });
  assert.equal(Object.hasOwn(status!.values!, 'unknown:failure'), false);
  assert.equal(proposal.recipe.bindings.find(binding => binding.target === 'amountMinor')?.moneyUnit, 'minor');
  assert.equal(proposal.recipe.onUnmapped, 'reject'); assert.ok(proposal.recipe.bindings.every(binding => binding.nulls === 'reject'));
  assert.ok(proposal.notices.some(notice => notice.includes('does not prove earned revenue')));
  assert.throws(() => proposeAccountingMapping({ id: 'invalid', system: 'fixture', edition: 'fixture', company: domain.company,
    branch: 'all', currency: 'INR', eventTypes: {}, statuses: { open: 'open' } }), code('ACCOUNTING_MAPPING_INVALID'));
});
