import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createXeroReadAdapter, parseXeroPage, xeroCalendarDate, xeroOperation, xeroSchemaFingerprint } from '../runtime/adapters/accounting/xero.ts';
import type { XeroOperationProfile, XeroResource } from '../runtime/adapters/accounting/xero.ts';
import type { AccountingTransport } from '../runtime/adapters/accounting/common.ts';
import type { ReadPageRequest, ReadTransportContext } from '../runtime/connector-framework/read.ts';
import { ReadTransportError } from '../runtime/connector-framework/read.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/accounting/xero/${name}.json`, import.meta.url), 'utf8');
const organizationId = '99999999-0000-0000-0000-000000000001';
const profile = (resource: XeroResource = 'invoices', pageSize = 2): XeroOperationProfile => ({ companyId: 'canonical-company', organizationId, resource, pageSize,
  edition: 'synthetic-global', configurationProfile: 'synthetic-v1', deploymentProfile: 'synthetic-injected-get', region: 'global' });
const request = (resource: XeroResource = 'invoices'): ReadPageRequest => ({ authority: { tenantId: 'local-workspace', sourceId: 'xero-source', companyId: 'canonical-company', organizationId },
  dataScope: { company: 'canonical-company', dataset: `xero-${resource}`, branches: ['all'] }, cursor: null });
const context: ReadTransportContext = { authorization: { scope: request().authority, authorityRevision: 'synthetic-1', grantedScopes: ['accounting.invoices.read'], expiresAtMs: 9_000_000_000_000, credentialReference: 'opaque-ref' },
  signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 1_000_000, attempt: 1, retryOwner: 'dispatcher' };
function adapter(transport: AccountingTransport, sourceProfile = profile()) { return createXeroReadAdapter({ ...sourceProfile, operation: xeroOperation(sourceProfile, 'read'), environment: 'synthetic', transport }); }
const rejection = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code;

test('Xero exact source decimals, description-only lines, tax modes and submitted drafts remain distinct', () => {
  const page = parseXeroPage(fixture('invoices-page-1'), { resource: 'invoices', pageSize: 2 });
  assert.equal(page.records[0].total, '9007199254740993.1235');
  assert.equal(page.records[0].lines[0].unitAmount, '9007199254740993.0001');
  assert.equal(page.records[0].lines[0].quantity, '1.0000');
  assert.equal(page.records[0].lines[0].accountId, null);
  assert.equal(page.records[0].lines[0].source.AccountCode, '200');
  assert.equal(page.records[0].lines[1].amount, null);
  assert.equal(page.records[0].source.AmountCredited, '10.00');
  assert.equal(page.records[0].date, '2026-09-01');
  assert.equal(page.records[0].revision, '2026-09-01T00:00:00.123Z');
  assert.equal(page.records[1].status, 'draft');
  assert.equal(page.records[0].sourceType, 'ACCREC');
  assert.equal(page.records[0].direction, 'receivable');
  assert.equal(page.records[1].sourceType, 'ACCPAY');
  assert.equal(page.records[1].direction, 'payable');
  assert.equal(page.records[1].source.LineAmountTypes, 'Inclusive');
  assert.equal(page.records[1].subtotal, '100.00');
  assert.equal(page.records[1].lines[0].amount, '115.00');
  assert.deepEqual(page.continuation, { kind: 'more', next: { kind: 'page', page: 2 } });
  assert.equal(page.totalRows, 3);
  assert.equal(page.sourceGeneratedAtMs, null);
  assert.equal(page.snapshotId, null);
});

test('Xero void observations retain amounts without becoming an active invoice', () => {
  const page = parseXeroPage(fixture('invoices-page-2'), { resource: 'invoices', page: 2, pageSize: 2 });
  assert.deepEqual(page.continuation, { kind: 'complete' });
  assert.equal(page.records[0].status, 'void');
  assert.equal(page.records[0].sourceStatus, 'VOIDED');
  assert.equal(page.records[0].total, '40.00');
});

test('Xero credit allocations and embedded refund references do not manufacture cash events', () => {
  const note = parseXeroPage(fixture('credit-notes'), { resource: 'credit-notes' }).records[0];
  assert.equal(note.kind, 'credit-note');
  assert.equal(note.sourceType, 'ACCRECCREDIT');
  assert.equal(note.direction, 'receivable');
  assert.equal(note.total, '34.50');
  assert.equal(note.balance, '14.50');
  assert.deepEqual(note.allocations.map(entry => entry.documentKind), ['invoice', 'invoice', 'refund-reference']);
  assert.equal(note.allocations[1].source.IsDeleted, true);
  assert.equal(note.allocations[2].amount, '10.00');
});

test('Xero payment document currency differs from bank amount; refunds, deleted and unsupported prepayments remain explicit', () => {
  const records = parseXeroPage(fixture('payments'), { resource: 'payments' }).records;
  assert.equal(records[0].currency, 'NZD');
  assert.deepEqual(records.map(record => record.direction), ['inflow', 'outflow', 'outflow', 'unknown']);
  assert.deepEqual(records.map(record => record.sourceType), ['ACCRECPAYMENT', 'ACCPAYPAYMENT', 'ARCREDITPAYMENT', 'ARPREPAYMENTPAYMENT']);
  assert.equal(records[0].total, '20.00');
  assert.equal(records[0].source.BankAmount, '26.50');
  assert.equal((records[0].source.Account as Record<string, unknown>).CurrencyCode, 'USD');
  assert.equal(records[0].account?.classification, 'asset');
  assert.equal(records[1].status, 'deleted');
  assert.equal(records[2].kind, 'refund');
  assert.equal(records[2].allocations[0].documentKind, 'credit-note');
  assert.ok(records[2].warnings.includes('BANK_SETTLEMENT_UNVERIFIED'));
  assert.equal(records[3].status, 'unknown');
  assert.equal(records[3].currency, null);
  assert.ok(records[3].warnings.includes('PREPAYMENT_OVERPAYMENT_SEMANTICS_UNSUPPORTED'));
});

test('Xero credit-payment direction preserves A/R refund outflow and A/P refund inflow; conflicting target types refuse', () => {
  const payable = fixture('payments').replace('ARCREDITPAYMENT', 'APCREDITPAYMENT');
  assert.equal(parseXeroPage(payable, { resource: 'payments' }).records[2].direction, 'inflow');
  const contradictory = fixture('payments').replace('"CreditNoteID": "20000000-0000-0000-0000-000000000001", "CurrencyCode": "NZD"', '"CreditNoteID": "20000000-0000-0000-0000-000000000001", "CurrencyCode": "NZD", "Type": "ACCPAYCREDIT"');
  assert.throws(() => parseXeroPage(contradictory, { resource: 'payments' }), rejection('XERO_PAYMENT_DOCUMENT_TYPE_CONFLICT'));
});

test('Xero account class is source explicit; archived and unclassified accounts stay visible', () => {
  const records = parseXeroPage(fixture('accounts'), { resource: 'accounts' }).records;
  assert.deepEqual(records.map(entry => entry.account?.classification), ['income', 'asset', 'expense', 'unknown']);
  assert.equal(records[0].currency, null);
  assert.ok(records[2].warnings.includes('ARCHIVED_ACCOUNT'));
  assert.equal(records[3].status, 'deleted');
  assert.equal(records[3].total, null);
});

test('Xero absent collections, duplicate keys, unknown statuses and malformed source decimals are refused', () => {
  assert.throws(() => parseXeroPage('{"Status":"OK"}', { resource: 'invoices' }), rejection('ACCOUNTING_ARRAY_REQUIRED'));
  assert.throws(() => parseXeroPage('{"Invoices":[],"Invoices":[]}', { resource: 'invoices' }), rejection('ACCOUNTING_JSON_KEY_INVALID'));
  assert.throws(() => parseXeroPage(fixture('invoices-page-2').replace('VOIDED', 'REFUNDED'), { resource: 'invoices', page: 2, pageSize: 2 }), rejection('XERO_STATUS_UNSUPPORTED'));
  assert.throws(() => parseXeroPage(fixture('invoices-page-2').replace('40.00', '4e1'), { resource: 'invoices', page: 2, pageSize: 2 }), rejection('ACCOUNTING_DECIMAL_INVALID'));
  assert.throws(() => parseXeroPage('{"Status":"ERROR","Invoices":[]}', { resource: 'invoices' }), rejection('XERO_RESPONSE_FAILED'));
});

test('Xero dates refuse timezone reinterpretation, nonmidnight wrappers and conflicting source companions', () => {
  assert.equal(xeroCalendarDate('/Date(1788220800000+0000)/'), '2026-09-01');
  assert.throws(() => xeroCalendarDate('/Date(1788220800000+1200)/'), rejection('XERO_DATE_OFFSET_UNQUALIFIED'));
  assert.throws(() => xeroCalendarDate('/Date(1788220800001)/'), rejection('XERO_CALENDAR_DATE_AMBIGUOUS'));
  assert.throws(() => xeroCalendarDate('/Date(1788220800000)/', '2026-09-02T00:00:00'), rejection('XERO_DATE_CONFLICT'));
  assert.throws(() => xeroCalendarDate('2026-02-30'), rejection('ACCOUNTING_DATE_INVALID'));
  assert.throws(() => parseXeroPage(`{"Invoices":[{"InvoiceID":"rolled-date","Type":"ACCREC","Status":"DRAFT","UpdatedDateUTC":"/Date(${Date.parse('2026-03-02T00:00:00Z')})/","UpdatedDateUTCString":"2026-02-30T00:00:00Z"}]}`, { resource: 'invoices' }), rejection('XERO_REVISION_INVALID'));
  assert.throws(() => parseXeroPage(fixture('invoices-page-1').replace('2026-09-01T00:00:00Z', '2026-09-01T00:00:00.124Z'), { resource: 'invoices', pageSize: 2 }), rejection('XERO_REVISION_CONFLICT'));
});

test('Xero pagination validates reported row count, requested page, size and endpoint shape', () => {
  assert.throws(() => parseXeroPage(fixture('invoices-page-1'), { resource: 'invoices', page: 2, pageSize: 2 }), rejection('XERO_PAGINATION_MISMATCH'));
  assert.throws(() => parseXeroPage(fixture('invoices-page-1').replace('"itemCount": 3', '"itemCount": 1'), { resource: 'invoices', pageSize: 2 }), rejection('XERO_PAGINATION_TOTAL_INVALID'));
  assert.throws(() => parseXeroPage(fixture('invoices-page-2').replace('"itemCount": 3', '"itemCount": 4'), { resource: 'invoices', page: 2, pageSize: 2 }), rejection('XERO_PAGINATION_ROW_COUNT_INVALID'));
  const full = '{"Invoices":[{"InvoiceID":"a","Type":"ACCREC","Status":"DRAFT"},{"InvoiceID":"b","Type":"ACCREC","Status":"DRAFT"}]}';
  assert.deepEqual(parseXeroPage(full, { resource: 'invoices', pageSize: 2 }).continuation, { kind: 'more', next: { kind: 'page', page: 2 } });
  assert.deepEqual(parseXeroPage('{"Invoices":[]}', { resource: 'invoices', page: 2, pageSize: 2 }).continuation, { kind: 'complete' });
  assert.throws(() => parseXeroPage(fixture('accounts'), { resource: 'accounts', page: 2 }), rejection('XERO_ACCOUNTS_PAGINATION_UNSUPPORTED'));
});

test('Xero observed schema fingerprint changes for field/type drift without scalar-value or row-order changes', () => {
  const source = fixture('invoices-page-1');
  assert.equal(xeroSchemaFingerprint(source), xeroSchemaFingerprint(source.replace('9007199254740993.1235', '9007199254740999.1235')));
  assert.notEqual(xeroSchemaFingerprint(source), xeroSchemaFingerprint(source.replace('"CurrencyRate": 1.000000', '"CurrencyRate": "1.000000"')));
  assert.notEqual(xeroSchemaFingerprint(source), xeroSchemaFingerprint(source.replace('"AmountPaid": 20.00,', '')));
});

test('Xero GET transport preserves original bytes, binds tenant and uses exact page cursors', async () => {
  const seen: string[] = [], sourceBytes = Buffer.from(fixture('invoices-page-1'));
  const reader = adapter(async (req, suppliedContext) => {
    assert.equal(req.method, 'GET'); assert.equal(req.headers['xero-tenant-id'], organizationId);
    assert.equal(req.headers.Authorization, undefined); assert.equal(suppliedContext.authorization.credentialReference, 'opaque-ref');
    seen.push(req.url); return { status: 200, content: sourceBytes, contentType: 'application/json', finalUrl: req.url };
  });
  const page = await reader.readPage(request(), context);
  assert.equal(page.content, sourceBytes);
  assert.equal(page.schemaFingerprint, xeroSchemaFingerprint(fixture('invoices-page-1')));
  assert.equal(page.source.generatedAtMs, null);
  assert.equal(page.source.completeness, 'unknown');
  assert.equal(seen[0], 'https://api.xero.com/api.xro/2.0/Invoices?page=1&pageSize=2');
});

test('Xero each read family pins its GET endpoint and granular read grant', async () => {
  for (const [resource, name, scope] of [
    ['invoices', 'Invoices', 'accounting.invoices.read'], ['credit-notes', 'CreditNotes', 'accounting.invoices.read'],
    ['payments', 'Payments', 'accounting.payments.read'], ['accounts', 'Accounts', 'accounting.settings.read'],
  ] as const) {
    const sourceProfile = profile(resource, 100), bytes = Buffer.from(resource === 'invoices' ? '{"Invoices":[]}' : fixture(resource));
    const reader = adapter(async req => {
      assert.equal(req.url, `https://api.xero.com/api.xro/2.0/${name}${resource === 'accounts' ? '' : '?page=1&pageSize=100'}`);
      return { status: 200, content: bytes, contentType: 'application/json', finalUrl: req.url };
    }, sourceProfile);
    assert.deepEqual(reader.requiredAuthScopes, [scope]);
    assert.equal((await reader.readPage(request(resource), context)).content, bytes);
  }
});

test('Xero credential transport injection is captured at construction', async () => {
  const sourceProfile = profile(), config = { ...sourceProfile, operation: xeroOperation(sourceProfile, 'read'), environment: 'synthetic' as const,
    transport: async (req: { url: string }) => ({ status: 200, content: Buffer.from(fixture('invoices-page-1')), contentType: 'application/json', finalUrl: req.url }) };
  const reader = createXeroReadAdapter(config);
  config.transport = async () => { throw new Error('Changed caller transport must not execute'); };
  assert.equal((await reader.readPage(request(), context)).rowCount, 2);
});

test('Xero resource, tenant, page-size and API version are independently operation-bound', () => {
  const sourceProfile = profile(), readScope = xeroOperation(sourceProfile, 'read');
  assert.equal(readScope.applicability.applicationVersion, '2.0');
  assert.equal(xeroOperation(sourceProfile, 'import').transport, 'file');
  for (const changed of [{ resource: 'payments' as const }, { organizationId: '88888888-0000-0000-0000-000000000001' }, { pageSize: 1 }, { dataset: 'other-dataset' }])
    assert.throws(() => createXeroReadAdapter({ ...sourceProfile, ...changed, operation: readScope, environment: 'synthetic', transport: async () => { throw new Error('unused'); } }), rejection('XERO_OPERATION_MISMATCH'));
  assert.throws(() => createXeroReadAdapter({ ...sourceProfile, operation: { ...readScope, applicability: { ...readScope.applicability, applicationVersion: '3.0' } }, environment: 'synthetic', transport: async () => { throw new Error('unused'); } }), rejection('XERO_OPERATION_MISMATCH'));
});

test('Xero returned operation and applicability are immutable before dispatch', () => {
  const reader = adapter(async () => { throw new Error('unused'); });
  assert.throws(() => { reader.operation.operationId = 'xero-payments-read'; }, TypeError);
  assert.throws(() => { reader.operation.applicability.configuration = 'changed'; }, TypeError);
  assert.equal(reader.operation.operationId, 'xero-invoices-read');
});

test('Xero mismatched company/tenant and unsupported scope filters refuse before a transport call', async () => {
  let calls = 0; const reader = adapter(async () => { calls++; throw new Error('must not execute'); });
  const foreign: ReadPageRequest = { ...request(), authority: { ...request().authority, companyId: 'other-company' } };
  await assert.rejects(reader.readPage(foreign, context), rejection('ACCOUNTING_COMPANY_MISMATCH'));
  const scoped: ReadPageRequest = { ...request(), dataScope: { ...request().dataScope!, period: { from: '2026-09-01', to: '2026-09-30' } } };
  await assert.rejects(reader.readPage(scoped, context), rejection('XERO_DATA_SCOPE_UNSUPPORTED'));
  const branch: ReadPageRequest = { ...request(), dataScope: { ...request().dataScope!, branches: ['other'] } };
  await assert.rejects(reader.readPage(branch, context), rejection('XERO_DATA_SCOPE_UNSUPPORTED'));
  const cursor: ReadPageRequest = { ...request(), cursor: { kind: 'token', token: 'unsafe-source-url' } };
  await assert.rejects(reader.readPage(cursor, context), rejection('XERO_CURSOR_UNSUPPORTED'));
  assert.equal(calls, 0);
});

test('Xero read errors retain response bytes, refuse redirects and do not retry inside the adapter', async () => {
  for (const scenario of [
    { status: 200, body: '{"Invoices":', finalUrl: null, kind: 'invalid-request' },
    { status: 302, body: 'redirect', finalUrl: null, kind: 'unsupported' },
    { status: 200, body: '{"Invoices":[]}', finalUrl: 'https://other.invalid/', kind: 'unsupported' },
    { status: 401, body: 'synthetic expired', finalUrl: null, kind: 'authentication-expired' },
    { status: 429, body: 'synthetic quota', finalUrl: null, kind: 'rate-limited' },
  ]) {
    let calls = 0; const reader = adapter(async req => { calls++; return { status: scenario.status, content: Buffer.from(scenario.body), contentType: 'application/json', finalUrl: scenario.finalUrl ?? req.url, headers: { 'retry-after': '2' } }; });
    await assert.rejects(reader.readPage(request(), context), (error: unknown) => error instanceof ReadTransportError && error.kind === scenario.kind && error.receivedBytes === Buffer.byteLength(scenario.body));
    assert.equal(calls, 1);
  }
});
