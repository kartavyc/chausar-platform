import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ReadTransportError } from '../runtime/connector-framework/read.ts';
import type { ReadPageRequest, ReadTransportContext } from '../runtime/connector-framework/read.ts';
import { sha256 } from '../runtime/adapters/accounting/common.ts';
import {
  createQuickBooksReadAdapter, parseQuickBooksPage, quickBooksOperation,
  quickBooksParserDescriptorHash, quickBooksSchemaFingerprint, reconcileQuickBooksDocument,
} from '../runtime/adapters/accounting/quickbooks.ts';
import type { QuickBooksEntity, QuickBooksOperationProfile } from '../runtime/adapters/accounting/quickbooks.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/accounting/quickbooks/${name}.json`, import.meta.url), 'utf8');
const profile = (entity: QuickBooksEntity = 'Invoice', overrides: Partial<QuickBooksOperationProfile> = {}): QuickBooksOperationProfile => ({
  entity, realmId: '123456789', minorVersion: '75', environment: 'synthetic', ...overrides,
});
const context = (): ReadTransportContext => ({ authorization: { scope: { tenantId: 'workspace', sourceId: 'source', companyId: '123456789' },
  authorityRevision: '1', grantedScopes: ['com.intuit.quickbooks.accounting'], expiresAtMs: 9999999999999, credentialReference: 'opaque-reference' },
  signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 4 * 1024 * 1024, attempt: 1, retryOwner: 'dispatcher' });
const request = (entity: QuickBooksEntity = 'Invoice'): ReadPageRequest => ({ authority: { tenantId: 'workspace', sourceId: 'source', companyId: '123456789' },
  dataScope: { company: '123456789', dataset: `qbo-${entity.toLowerCase()}`, branches: ['all'] }, cursor: null });
const code = (expected: string) => (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === expected;

test('QBO retains exact invoice lines, discounts, tax provenance and source posting date', () => {
  const page = parseQuickBooksPage(fixture('invoices'), profile('Invoice', { pageSize: 2 })), record = page.records[0];
  assert.equal(record.id, 'invoice-1'); assert.equal(record.revision, '2'); assert.equal(record.date, '2026-09-10');
  assert.equal(record.total, '104.50'); assert.equal(record.taxTotal, '9.50'); assert.equal(record.balance, '54.50');
  assert.equal(record.status, 'open'); assert.equal(record.sourceStatus, 'PARTIALLY_PAID');
  assert.equal(record.lines[0].amount, '100.00'); assert.equal(record.lines[0].quantity, '2.0'); assert.equal(record.lines[0].unitAmount, '50.00');
  assert.equal(record.lines[0].taxCode, 'TAX'); assert.equal(record.lines[0].taxAmount, null);
  assert.equal(record.lines[1].amount, null); assert.equal(record.lines[1].source.Amount, '100.00');
  assert.equal(record.lines[2].amount, '5.00'); assert.equal(record.lines[3].amount, null); assert.equal(record.lines[3].source.Amount, '999.00');
  assert.equal(record.subtotal, null); assert.equal(page.sourceGeneratedAtMs, null); assert.equal(page.snapshotId, null); assert.equal(page.totalRows, null);
  assert.deepEqual(page.continuation, { kind: 'more', next: { kind: 'offset', offset: 3 } });
  assert.equal(reconcileQuickBooksDocument(record).status, 'matched');
});

test('QBO observed zero is not an inferred void or paid status', () => {
  const record = parseQuickBooksPage(fixture('invoices'), profile()).records[1];
  assert.equal(record.total, '0'); assert.equal(record.status, 'unknown');
  assert.ok(record.warnings.includes('QBO_VOID_AND_POSTING_STATUS_UNVERIFIED'));
});

test('QBO only directly observed invoiceStatus VOIDED maps to void', () => {
  const content = fixture('invoices').replace('"PARTIALLY_PAID"', '"VOIDED"');
  const record = parseQuickBooksPage(content, profile()).records[0];
  assert.equal(record.status, 'void'); assert.equal(reconcileQuickBooksDocument(record).status, 'unavailable');
  const paid = parseQuickBooksPage(content.replace('"VOIDED"', '"PAID_NOT_DEPOSITED"'), profile()).records[0];
  assert.equal(paid.status, 'paid'); assert.equal(paid.source.invoiceStatus, 'PAID_NOT_DEPOSITED');
});

test('QBO credits and refunds remain distinct native streams with positive source amounts', () => {
  const credit = parseQuickBooksPage(fixture('credit-memos'), profile('CreditMemo')).records[0];
  const refund = parseQuickBooksPage(fixture('refunds'), profile('RefundReceipt')).records[0];
  assert.equal(credit.kind, 'credit-note'); assert.equal(refund.kind, 'refund'); assert.equal(credit.total, '55.00'); assert.equal(refund.total, '55.00');
  assert.equal(credit.source.RemainingCredit, '25.00'); assert.deepEqual(credit.source.InvoiceRef, { value: 'invoice-1' });
  assert.ok(credit.warnings.includes('QBO_CREDIT_NOTE_NOT_CASH_REFUND')); assert.ok(refund.warnings.includes('QBO_CREDIT_REFUND_OVERLAP_REVIEW_REQUIRED'));
  assert.equal(reconcileQuickBooksDocument(credit).status, 'matched'); assert.equal(reconcileQuickBooksDocument(refund).status, 'matched');
});

test('QBO customer payment and grouped credit applications do not duplicate cash', () => {
  const payment = parseQuickBooksPage(fixture('payments'), profile('Payment')).records[0];
  assert.equal(payment.kind, 'payment'); assert.equal(payment.total, '50.00'); assert.equal(payment.status, 'unknown');
  assert.deepEqual(payment.allocations.map(a => [a.documentKind, a.amount]), [['Invoice', '50.00'], ['Invoice', null], ['CreditMemo', null]]);
  assert.ok(payment.lines.every(line => line.amount === null)); assert.equal(payment.lines[1].source.Amount, '25.00');
  assert.equal(payment.source.UnappliedAmt, '0'); assert.deepEqual(payment.source.DepositToAccountRef, { value: 'undeposited-funds' });
  assert.ok(payment.warnings.includes('QBO_CREDIT_APPLICATION_NOT_NEW_CASH')); assert.ok(payment.warnings.includes('QBO_BANK_SETTLEMENT_UNVERIFIED'));
});

test('QBO account classifications preserve explicit native class and inactive account evidence', () => {
  const records = parseQuickBooksPage(fixture('accounts'), profile('Account')).records;
  assert.equal(records[0].account?.classification, 'income'); assert.equal(records[0].account?.sourceClass, 'Revenue'); assert.equal(records[0].account?.code, '4000');
  assert.equal(records[0].total, null); assert.equal(records[0].balance, '0'); assert.equal(records[1].account?.classification, 'expense');
  assert.equal(records[1].source.Active, false); assert.equal(records[1].balance, '12.25');
  const unknown = parseQuickBooksPage(fixture('accounts').replace('"Revenue"', '"UnexpectedClass"'), profile('Account')).records[0];
  assert.equal(unknown.account?.classification, 'unknown'); assert.ok(unknown.warnings.includes('QBO_ACCOUNT_CLASSIFICATION_UNAVAILABLE'));
});

test('QBO decimal arithmetic preserves amounts beyond binary float precision', () => {
  const raw = '{"QueryResponse":{"Invoice":[{"Id":"exact","SyncToken":"9007199254740993","TxnDate":"2026-09-01","CurrencyRef":{"value":"USD"},"GlobalTaxCalculation":"TaxExcluded","TotalAmt":9007199254740993.01,"Line":[{"Amount":9007199254740993.01,"DetailType":"SalesItemLineDetail","SalesItemLineDetail":{"ItemRef":{"value":"1"}}}],"TxnTaxDetail":{"TotalTax":0.00}}],"startPosition":1,"maxResults":1}}';
  const record = parseQuickBooksPage(raw, profile()).records[0];
  assert.equal(record.total, '9007199254740993.01'); assert.equal(record.revision, '9007199254740993');
  assert.deepEqual(reconcileQuickBooksDocument(record), { status: 'matched', sourceTotal: '9007199254740993.01', computedTotal: '9007199254740993.01', difference: '0.00', reasons: [] });
});

test('QBO local document consistency detects mismatched totals without rounding or double-counting subtotal', () => {
  const record = parseQuickBooksPage(fixture('invoices').replace('104.50', '104.51'), profile()).records[0];
  assert.deepEqual(reconcileQuickBooksDocument(record), { status: 'mismatch', sourceTotal: '104.51', computedTotal: '104.50', difference: '-0.01', reasons: ['QBO_DOCUMENT_TOTAL_MISMATCH'] });
  const inclusive = parseQuickBooksPage(fixture('invoices').replace('"TaxExcluded"', '"TaxInclusive"'), profile()).records[0];
  assert.equal(reconcileQuickBooksDocument(inclusive).status, 'unavailable');
});

test('QBO deferred revenue and unknown line details require accounting review', () => {
  const deferred = fixture('invoices').replace('"Qty": 2.0', '"DeferredRevenue": true, "Qty": 2.0');
  assert.ok(parseQuickBooksPage(deferred, profile()).records[0].warnings.includes('QBO_DEFERRED_REVENUE_REQUIRES_FULFILLMENT_REVIEW'));
  const grouped = fixture('invoices').replace('"DetailType": "SubTotalLineDetail"', '"DetailType": "GroupLineDetail"');
  assert.equal(reconcileQuickBooksDocument(parseQuickBooksPage(grouped, profile()).records[0]).status, 'unavailable');
});

test('QBO missing money and dates remain unavailable; invalid calendar dates are rejected', () => {
  const record = parseQuickBooksPage('{"QueryResponse":{"Invoice":[{"Id":"missing","SyncToken":"0"}]}}', profile()).records[0];
  assert.equal(record.total, null); assert.equal(record.taxTotal, null); assert.equal(record.currency, null); assert.equal(record.date, null);
  assert.equal(reconcileQuickBooksDocument(record).status, 'unavailable');
  assert.throws(() => parseQuickBooksPage(fixture('invoices').replace('"TxnDate": "2026-09-10"', '"TxnDate": "2026-02-30"'), profile()), code('ACCOUNTING_DATE_INVALID'));
});

test('QBO pagination accepts terminal empty responses but rejects count and mismatched pages', () => {
  assert.deepEqual(parseQuickBooksPage('{"QueryResponse":{}}', profile()).continuation, { kind: 'complete' });
  assert.throws(() => parseQuickBooksPage('{"QueryResponse":{"totalCount":10}}', profile()), code('QBO_COUNT_RESPONSE_UNSUPPORTED'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices'), profile('Payment')), code('QBO_ENTITY_MISMATCH'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices'), profile('Invoice', { startPosition: 3 })), code('QBO_PAGE_POSITION_MISMATCH'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices').replace('"maxResults": 2', '"maxResults": 1'), profile()), code('QBO_PAGE_COUNT_MISMATCH'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices'), profile('Invoice', { pageSize: 1 })), code('QBO_PAGE_SIZE_EXCEEDED'));
});

test('QBO rejects fault, duplicate fields, sparse records and malformed monetary input', () => {
  assert.throws(() => parseQuickBooksPage('{"Fault":{"type":"ValidationFault"}}', profile()), code('QBO_SOURCE_FAULT'));
  assert.throws(() => parseQuickBooksPage('{"QueryResponse":{},"QueryResponse":{}}', profile()), code('ACCOUNTING_JSON_KEY_INVALID'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices').replace('"sparse": false', '"sparse": true'), profile()), code('QBO_SPARSE_UNSUPPORTED'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices').replace('104.50', '1.045e2'), profile()), code('ACCOUNTING_DECIMAL_INVALID'));
  assert.throws(() => parseQuickBooksPage(fixture('invoices').replace('"SyncToken": "2"', '"SyncToken": "-1"'), profile()), code('QBO_SYNC_TOKEN_INVALID'));
});

test('QBO wire fingerprint detects source field and number-type changes; descriptor pins minor version', () => {
  const content = fixture('invoices');
  assert.notEqual(quickBooksSchemaFingerprint(content), quickBooksSchemaFingerprint(content.replace('104.50', '"104.50"')));
  assert.notEqual(quickBooksSchemaFingerprint(content), quickBooksSchemaFingerprint(content.replace('"Id": "invoice-1"', '"FutureField": true, "Id": "invoice-1"')));
  assert.equal(quickBooksSchemaFingerprint(content), quickBooksSchemaFingerprint(content.replace('104.50', '204.50')));
  assert.notEqual(quickBooksParserDescriptorHash(profile()), quickBooksParserDescriptorHash(profile('Invoice', { minorVersion: '76' })));
});

test('QBO API query uses bound realm, one-based paging and opaque transport credentials', async () => {
  const configured = profile('Invoice', { pageSize: 2 }), bytes = Buffer.from(fixture('invoices'));
  const adapter = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport: async (input, opaque) => {
    const url = new URL(input.url); assert.equal(url.host, 'sandbox-quickbooks.api.intuit.com'); assert.equal(url.pathname, '/v3/company/123456789/query');
    assert.equal(url.searchParams.get('query'), 'SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 2'); assert.equal(url.searchParams.get('minorversion'), '75');
    assert.deepEqual(input.headers, { Accept: 'application/json' }); assert.equal(opaque.authorization.credentialReference, 'opaque-reference');
    return { status: 200, content: bytes, contentType: 'application/json', finalUrl: input.url };
  } });
  const page = await adapter.readPage(request(), context());
  assert.equal(page.content, bytes); assert.equal(sha256(page.content), sha256(bytes)); assert.equal(page.schemaFingerprint, quickBooksSchemaFingerprint(fixture('invoices')));
  assert.deepEqual(page.continuation, { kind: 'more', next: { kind: 'offset', offset: 3 } }); assert.equal(page.source.completeness, 'unknown');
});

test('QBO subsequent page and bound TxnDate filter have exact request semantics', async () => {
  const configured = profile('Invoice', { pageSize: 2, period: { from: '2026-09-01', to: '2026-09-30' } });
  const adapter = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport: async input => {
    assert.equal(new URL(input.url).searchParams.get('query'), "SELECT * FROM Invoice WHERE TxnDate >= '2026-09-01' AND TxnDate <= '2026-09-30' STARTPOSITION 3 MAXRESULTS 2");
    return { status: 200, content: Buffer.from('{"QueryResponse":{}}'), contentType: 'application/json', finalUrl: input.url };
  } });
  const selected: ReadPageRequest = { ...request(), cursor: { kind: 'offset', offset: 3 }, dataScope: { ...request().dataScope!, period: configured.period } };
  assert.deepEqual((await adapter.readPage(selected, context())).continuation, { kind: 'complete' });
});

test('QBO account query includes inactive native accounts', async () => {
  const configured = profile('Account');
  const adapter = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport: async input => {
    assert.equal(new URL(input.url).searchParams.get('query'), 'SELECT * FROM Account WHERE Active IN (true, false) STARTPOSITION 1 MAXRESULTS 100');
    return { status: 200, content: Buffer.from(fixture('accounts')), contentType: 'application/json', finalUrl: input.url };
  } });
  assert.equal((await adapter.readPage(request('Account'), context())).rowCount, 2);
});

test('QBO API refuses swapped entity qualification and unsupported company/dataset/branch/period before transport', async () => {
  let calls = 0; const configured = profile();
  const transport = async (input: { url: string }) => { calls++; return { status: 200, content: Buffer.from('{"QueryResponse":{}}'), contentType: 'application/json', finalUrl: input.url }; };
  assert.throws(() => createQuickBooksReadAdapter({ ...configured, entity: 'Payment', operation: quickBooksOperation(configured, 'read'), transport }), code('QBO_OPERATION_PROFILE_MISMATCH'));
  const adapter = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport });
  const foreign: ReadPageRequest = { ...request(), authority: { ...request().authority, companyId: '999' } }; await assert.rejects(adapter.readPage(foreign, context()), code('ACCOUNTING_COMPANY_MISMATCH'));
  const dataset: ReadPageRequest = { ...request(), dataScope: { ...request().dataScope!, dataset: 'qbo-payment' } }; await assert.rejects(adapter.readPage(dataset, context()), code('QBO_DATA_SCOPE_UNSUPPORTED'));
  const branch: ReadPageRequest = { ...request(), dataScope: { ...request().dataScope!, branches: ['branch-1'] } }; await assert.rejects(adapter.readPage(branch, context()), code('QBO_DATA_SCOPE_UNSUPPORTED'));
  const period: ReadPageRequest = { ...request(), dataScope: { ...request().dataScope!, period: { from: '2026-09-01', to: '2026-09-30' } } }; await assert.rejects(adapter.readPage(period, context()), code('QBO_PERIOD_PROFILE_MISMATCH'));
  const cursor: ReadPageRequest = { ...request(), cursor: { kind: 'token', token: 'not-a-query-position' } }; await assert.rejects(adapter.readPage(cursor, context()), code('QBO_CURSOR_INVALID'));
  assert.equal(calls, 0);
});

test('QBO malformed successful response and redirects retain received byte accounting', async () => {
  const configured = profile();
  const invalid = Buffer.from('{"QueryResponse":{},"QueryResponse":{}}');
  const adapter = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport: async input => ({ status: 200, content: invalid, contentType: 'application/json', finalUrl: input.url }) });
  await assert.rejects(adapter.readPage(request(), context()), error => error instanceof ReadTransportError && error.kind === 'invalid-request' && error.receivedBytes === invalid.length);
  const redirect = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport: async input => ({ status: 302, content: invalid, contentType: 'application/json', finalUrl: input.url }) });
  await assert.rejects(redirect.readPage(request(), context()), error => error instanceof ReadTransportError && error.kind === 'unsupported' && error.receivedBytes === invalid.length);
});

test('QBO published adapter contract cannot be mutated into another qualified entity', async () => {
  const configured = profile(), operation = quickBooksOperation(configured, 'read');
  const adapter = createQuickBooksReadAdapter({ ...configured, operation, transport: async input => {
    assert.equal(new URL(input.url).searchParams.get('query'), 'SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100');
    return { status: 200, content: Buffer.from('{"QueryResponse":{}}'), contentType: 'application/json', finalUrl: input.url };
  } });
  operation.applicability.module = 'Payment'; configured.entity = 'Payment';
  assert.equal(adapter.operation.applicability.module, 'Invoice');
  assert.throws(() => Object.assign(adapter.operation.applicability, { module: 'Payment' }), TypeError);
  assert.throws(() => Object.assign(adapter.operation, quickBooksOperation(profile('Payment'), 'read')), TypeError);
  assert.throws(() => Object.assign(adapter, { environment: 'live' }), TypeError);
  assert.throws(() => Object.assign(adapter.pagination, { kind: 'token' }), TypeError);
  assert.throws(() => Object.assign(adapter.requiredAuthScopes, { 0: 'different-scope' }), TypeError);
  assert.deepEqual((await adapter.readPage(request(), context())).continuation, { kind: 'complete' });
});

test('QBO authorization expiry and rate limit failures use closed classifications without response text', async () => {
  const configured = profile(), content = Buffer.from('{"Fault":{"Error":[{"Message":"SOURCE PRIVATE MESSAGE"}]}}');
  for (const [status, kind] of [[401, 'authentication-expired'], [429, 'rate-limited']] as const) {
    const adapter = createQuickBooksReadAdapter({ ...configured, operation: quickBooksOperation(configured, 'read'), transport: async input => ({ status, content, contentType: 'application/json', finalUrl: input.url, headers: { 'Retry-After': '2' } }) });
    await assert.rejects(adapter.readPage(request(), context()), error => error instanceof ReadTransportError && error.kind === kind && error.receivedBytes === content.length && !error.message.includes('SOURCE PRIVATE MESSAGE'));
  }
});
