import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createZohoReadAdapter, parseZohoPage, ZOHO_ADAPTER_VERSION, zohoReadConfiguration, zohoReadOperationId, zohoSchemaFingerprint, type ZohoReadConfig, type ZohoResource } from '../runtime/adapters/accounting/zoho.ts';
import { ReadTransportError, type ReadPageRequest, type ReadTransportContext } from '../runtime/connector-framework/read.ts';
import type { AccountingTransport } from '../runtime/adapters/accounting/common.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/accounting/zoho/${name}.json`, import.meta.url), 'utf8');
const parse = (name: string, resource: ZohoResource, detail = false) => parseZohoPage(fixture(name), { resource, organizationId: '12345', detail });
const scope: ReadPageRequest = { authority: { tenantId: 'synthetic-workspace', sourceId: 'synthetic-source', companyId: '12345', organizationId: '12345' },
  dataScope: { company: '12345', dataset: 'zoho-invoices', branches: ['all'] }, cursor: null };
const context: ReadTransportContext = { authorization: { scope: scope.authority, authorityRevision: 'synthetic-1', grantedScopes: ['ZohoBooks.invoices.READ'], expiresAtMs: 9_000_000_000_000, credentialReference: 'opaque-synthetic-reference' },
  signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 1_000_000, attempt: 1, retryOwner: 'dispatcher' };
function config(resource: ZohoResource, transport: AccountingTransport, additions: Partial<ZohoReadConfig> = {}): ZohoReadConfig {
  const profile = { organizationId: '12345', dataCenter: 'in' as const, resource, ...additions };
  return { environment: 'synthetic', transport, ...profile, operation: {
    connectorId: 'zoho-books', connectorVersion: ZOHO_ADAPTER_VERSION,
    operationId: zohoReadOperationId(resource, profile.resourceId !== undefined), kind: 'read', transport: 'api',
    applicability: { applicationVersion: 'v3', edition: 'synthetic-India', module: resource,
      configuration: zohoReadConfiguration(profile), deploymentProfile: 'injected-fixture', region: 'in' },
  } };
}
const syntheticTransport = (content: string): AccountingTransport => async request => ({ status: 200, content: new TextEncoder().encode(content), contentType: 'application/json', finalUrl: request.url });

test('Zoho retains exact large numeric lexemes and separates list summaries from detail lines', () => {
  const page = parse('invoices-page-1', 'invoices');
  assert.equal(page.records[0].total, '9007199254740993.01');
  assert.equal(page.records[0].source.total, '9007199254740993.01');
  assert.equal(page.records[0].status, 'open');
  assert.equal(page.records[0].direction, 'receivable');
  assert.deepEqual(page.records[0].lines, []);
  assert.ok(page.records[0].warnings.includes('LIST_SUMMARY_REQUIRES_DETAIL'));
  assert.deepEqual(page.continuation, { kind: 'more', next: { kind: 'page', page: 2 } });
  assert.equal(page.totalRows, null);
  assert.equal(page.sourceGeneratedAtMs, null);
  assert.equal(page.snapshotId, null);
});

test('Zoho invoice detail preserves quantities/tax/date/currency and keeps subtotal presentation lines out of sale amounts', () => {
  const invoice = parse('invoice-detail', 'invoices', true).records[0];
  assert.equal(invoice.total, '118.000');
  assert.equal(invoice.subtotal, '100.000');
  assert.equal(invoice.taxTotal, '18.000');
  assert.equal(invoice.balance, '68.000');
  assert.equal(invoice.date, '2026-09-01');
  assert.equal(invoice.currency, 'INR');
  assert.equal(invoice.source.due_date, '2026-09-30');
  assert.equal(invoice.source.is_inclusive_tax, false);
  assert.equal(invoice.lines[0].quantity, '0.5');
  assert.equal(invoice.lines[0].unitAmount, '200.000');
  assert.equal(invoice.lines[0].amount, '100.000');
  assert.equal(invoice.lines[0].accountId, '50001');
  assert.equal(invoice.lines[0].taxCode, '70001');
  assert.equal(invoice.lines[1].amount, null);
  assert.equal(invoice.lines[1].source.item_total, '100.000');
  assert.ok(invoice.warnings.includes('INVOICE_SCHEMA_REFERENCE_REVIEW_REQUIRED'));
});

test('Zoho retains void/draft and abstains for unrecognized document statuses', () => {
  const page = parse('invoices-page-2', 'invoices');
  assert.deepEqual(page.records.map(row => row.status), ['void', 'draft']);
  const content = fixture('invoice-detail').replace('"status": "sent"', '"status": "future_status"');
  const invoice = parseZohoPage(content, { resource: 'invoices', organizationId: '12345', detail: true }).records[0];
  assert.equal(invoice.status, 'unknown');
  assert.equal(invoice.sourceStatus, 'future_status');
  assert.ok(invoice.warnings.includes('UNKNOWN_DOCUMENT_STATUS'));
});

test('Zoho credit notes preserve positive credit totals and credited-invoice allocations without creating cash refunds', () => {
  const page = parse('creditnote-detail', 'creditnotes', true), credit = page.records[0];
  assert.equal(page.records.length, 1);
  assert.equal(credit.kind, 'credit-note');
  assert.equal(credit.sourceType, 'creditnote');
  assert.equal(credit.total, '59.00');
  assert.equal(credit.balance, '9.00');
  assert.equal(credit.allocations[0].documentId, '10001');
  assert.equal(credit.allocations[0].amount, '50.00');
  assert.equal(credit.lines[0].amount, null);
  assert.equal(credit.taxTotal, null);
  assert.deepEqual(credit.source.taxes, [{ tax_id: '70001', tax_name: 'Synthetic tax', tax_amount: '9.00' }]);
  assert.ok(credit.warnings.includes('CREDIT_NOTE_IS_NOT_CASH_REFUND'));
});

test('Zoho payment allocations preserve withheld taxes and refunded aggregate never becomes a second payment/refund event', () => {
  const page = parse('payment-detail', 'customerpayments', true), payment = page.records[0];
  assert.equal(page.records.length, 1);
  assert.equal(payment.kind, 'payment');
  assert.equal(payment.direction, 'inflow');
  assert.equal(payment.status, 'unknown');
  assert.equal(payment.sourceStatus, 'success');
  assert.equal(payment.total, '70.00');
  assert.equal(payment.source.amount_refunded, '20.00');
  assert.equal(payment.allocations[0].amount, '50.00');
  assert.equal(payment.allocations[0].source.tax_amount_withheld, '0.00');
  assert.ok(payment.warnings.includes('PAYMENT_SETTLEMENT_UNVERIFIED'));
  const failed = parseZohoPage(fixture('payment-detail').replace('"success"', '"failure"'), { resource: 'customerpayments', organizationId: '12345', detail: true }).records[0];
  assert.ok(failed.warnings.includes('FAILED_PAYMENT_EXCLUDED_FROM_CASH'));
});

test('Zoho credit/payment list summary fixtures abstain for missing detail and source currency', () => {
  const credit = parse('creditnotes-page', 'creditnotes').records[0];
  assert.equal(credit.total, '59.00'); assert.deepEqual(credit.lines, []);
  assert.ok(credit.warnings.includes('LIST_SUMMARY_REQUIRES_DETAIL'));
  const payment = parse('customerpayments-page', 'customerpayments').records[0];
  assert.equal(payment.total, '70.00'); assert.equal(payment.currency, null);
  assert.equal(payment.source.bcy_amount, '70.00'); assert.deepEqual(payment.allocations, []);
  assert.ok(payment.warnings.includes('UNKNOWN_PAYMENT_STATUS'));
  assert.ok(payment.warnings.includes('PAYMENT_ALLOCATIONS_UNAVAILABLE'));
});

test('Zoho separately read refunds bind parent and abstain for source currency absence', () => {
  const creditRefund = parseZohoPage(fixture('creditnote-refunds-page'), { resource: 'creditnote-refunds', organizationId: '12345', parentId: '20001' }).records[0];
  assert.equal(creditRefund.kind, 'refund');
  assert.equal(creditRefund.direction, 'outflow');
  assert.equal(creditRefund.total, '9.00');
  assert.equal(creditRefund.source.amount_bcy, '9.00');
  assert.equal(creditRefund.currency, null);
  assert.equal(creditRefund.allocations[0].documentKind, 'credit-note');
  assert.throws(() => parseZohoPage(fixture('creditnote-refunds-page'), { resource: 'creditnote-refunds', organizationId: '12345', parentId: '99999' }), { code: 'ZOHO_REFUND_PARENT_MISMATCH' });
  const paymentRefund = parse('payment-refunds-page', 'customerpayment-refunds').records[0];
  assert.equal(paymentRefund.allocations[0].documentId, '30001');
  assert.equal(paymentRefund.total, '20.00');
});

test('Zoho chart of account types classify only documented values, including the root detail envelope', () => {
  const accounts = parse('accounts-page', 'chartofaccounts').records;
  assert.equal(accounts[0].account?.classification, 'income');
  assert.equal(accounts[1].account?.classification, 'unknown');
  assert.ok(accounts[1].warnings.includes('UNKNOWN_ACCOUNT_TYPE'));
  assert.equal(accounts[1].source.is_active, false);
  const detail = parse('account-detail', 'chartofaccounts', true).records[0];
  assert.equal(detail.id, '50003');
  assert.equal(detail.account?.classification, 'liability');
  assert.equal(detail.total, null);
  assert.equal(detail.source.closing_balance, '250.00');
});

test('Zoho missing amounts/currency/lines remain unavailable, and invalid calendar dates refuse import', () => {
  const content = '{"code":0,"invoice":{"invoice_id":"10004","date":"2026-09-04","status":"open"}}';
  const invoice = parseZohoPage(content, { resource: 'invoices', organizationId: '12345', detail: true }).records[0];
  assert.equal(invoice.total, null); assert.equal(invoice.currency, null); assert.deepEqual(invoice.lines, []);
  assert.ok(invoice.warnings.includes('SOURCE_AMOUNT_UNAVAILABLE'));
  assert.throws(() => parseZohoPage(content.replace('2026-09-04', '2026-02-30'), { resource: 'invoices', organizationId: '12345', detail: true }), { code: 'ACCOUNTING_DATE_INVALID' });
});

test('Zoho list termination requires explicit coherent page metadata and cannot be guessed from null', () => {
  const content = fixture('invoices-page-1');
  assert.throws(() => parseZohoPage(content, { resource: 'invoices', organizationId: '12345', expectedPage: 2 }), { code: 'ZOHO_PAGE_MISMATCH' });
  assert.throws(() => parseZohoPage('{"code":0,"customer_payments":[],"page_context":null}', { resource: 'customerpayments', organizationId: '12345' }), { code: 'ZOHO_PAGINATION_UNAVAILABLE' });
  assert.throws(() => parseZohoPage('{"code":0,"invoices":[],"page_context":{"page":1,"has_more_page":true}}', { resource: 'invoices', organizationId: '12345' }), { code: 'ZOHO_EMPTY_CONTINUATION' });
  const empty = parseZohoPage('{"code":0,"invoices":[],"page_context":{"page":1,"has_more_page":false}}', { resource: 'invoices', organizationId: '12345' });
  assert.deepEqual(empty.continuation, { kind: 'complete' }); assert.equal(empty.totalRows, null);
});

test('Zoho refuses cross organization, resource mismatch, ambiguous JSON and API error responses', () => {
  assert.throws(() => parseZohoPage(fixture('invoice-detail').replace('"invoice_id":', '"organization_id":"99999","invoice_id":'), { resource: 'invoices', organizationId: '12345', detail: true }), { code: 'ZOHO_ORGANIZATION_MISMATCH' });
  assert.throws(() => parseZohoPage(fixture('invoice-detail'), { resource: 'invoices', organizationId: '12345', detail: true, expectedResourceId: '99999' }), { code: 'ZOHO_DETAIL_ID_MISMATCH' });
  assert.throws(() => parseZohoPage('{"code":0,"code":1}', { resource: 'invoices', organizationId: '12345' }), { code: 'ACCOUNTING_JSON_KEY_INVALID' });
  assert.throws(() => parseZohoPage('{"code":45}', { resource: 'invoices', organizationId: '12345' }), { code: 'ZOHO_API_ERROR' });
});

test('Zoho actual wire fingerprints detect added fields and number/string drift independently of values', () => {
  const content = fixture('invoice-detail');
  assert.equal(zohoSchemaFingerprint(content), zohoSchemaFingerprint(content.replace('118.000', '119.000')));
  assert.notEqual(zohoSchemaFingerprint(content), zohoSchemaFingerprint(content.replace('118.000', '"118.000"')));
  assert.notEqual(zohoSchemaFingerprint(content), zohoSchemaFingerprint(content.replace('"invoice_id":', '"future_field":true,"invoice_id":')));
});

test('Zoho injected transport uses pinned DC/company/resource/pagination and preserves original raw source bytes', async () => {
  const content = fixture('invoices-page-1'), requests: string[] = [];
  const adapter = createZohoReadAdapter(config('invoices', async (request, receivedContext) => {
    requests.push(request.url);
    assert.equal(request.method, 'GET'); assert.deepEqual(request.headers, { Accept: 'application/json' });
    assert.equal(receivedContext.authorization.credentialReference, 'opaque-synthetic-reference');
    return { status: 200, content: new TextEncoder().encode(content), contentType: 'application/json', finalUrl: request.url };
  }, { perPage: 2 }));
  const page = await adapter.readPage(scope, context);
  assert.deepEqual(requests, ['https://www.zohoapis.in/books/v3/invoices?organization_id=12345&page=1&per_page=2']);
  assert.equal(new TextDecoder().decode(page.content), content);
  assert.deepEqual(page.continuation, { kind: 'more', next: { kind: 'page', page: 2 } });
  assert.equal(page.source.completeness, 'unknown'); assert.equal(page.source.snapshotId, null);
  assert.equal(page.schemaFingerprint, zohoSchemaFingerprint(content));
});

test('Zoho unsupported branch/date/dataset/company scope is rejected before transport', async () => {
  let calls = 0; const adapter = createZohoReadAdapter(config('invoices', async request => { calls++; return syntheticTransport(fixture('invoices-page-1'))(request, context); }));
  for (const request of [
    { ...scope, authority: { ...scope.authority, organizationId: '99999' } },
    { ...scope, dataScope: { ...scope.dataScope!, dataset: 'other' } },
    { ...scope, dataScope: { ...scope.dataScope!, branches: ['branch-a'] } },
    { ...scope, dataScope: { ...scope.dataScope!, period: { from: '2026-09-01', to: '2026-09-30' } } },
  ]) await assert.rejects(adapter.readPage(request, context));
  assert.equal(calls, 0);
});

test('Zoho exact operation profile binds resource/detail/parent/DC and resists caller config mutation', async () => {
  const valid = config('invoices', syntheticTransport(fixture('invoice-detail')), { resourceId: '10001' });
  for (const altered of [
    { ...valid, resource: 'creditnotes' as const }, { ...valid, resourceId: '10002' }, { ...valid, dataCenter: 'com' as const },
    { ...valid, operation: { ...valid.operation, operationId: 'another-operation' } },
  ]) assert.throws(() => createZohoReadAdapter(altered), { code: 'ZOHO_OPERATION_PROFILE_MISMATCH' });
  const adapter = createZohoReadAdapter(valid); valid.organizationId = '99999'; valid.resourceId = '99999';
  valid.operation.operationId = 'mutated';
  assert.equal(adapter.operation.operationId, zohoReadOperationId('invoices', true));
  assert.throws(() => { adapter.operation.operationId = 'redirect-profile'; }, TypeError);
  assert.throws(() => { adapter.operation.applicability.configuration = 'redirect-configuration'; }, TypeError);
  assert.ok(Object.isFrozen(adapter)); assert.ok(Object.isFrozen(adapter.requiredAuthScopes)); assert.ok(Object.isFrozen(adapter.pagination));
  const page = await adapter.readPage(scope, context); assert.equal(page.rowCount, 1);
});

test('Zoho HTTP errors/redirects/parser failures account for every received payload byte', async () => {
  for (const [status, kind] of [[401, 'authentication-expired'], [403, 'permission-denied'], [429, 'rate-limited'], [503, 'temporarily-unavailable']] as const) {
    const content = new TextEncoder().encode('{"code":45}');
    const adapter = createZohoReadAdapter(config('invoices', async request => ({ status, content, contentType: 'application/json', finalUrl: request.url, headers: { 'Retry-After': '2' } })));
    await assert.rejects(adapter.readPage(scope, context), error => error instanceof ReadTransportError && error.kind === kind && error.receivedBytes === content.byteLength && error.retryAfterMs === 2000);
  }
  const malformed = '{"code":0}';
  const adapter = createZohoReadAdapter(config('invoices', syntheticTransport(malformed)));
  await assert.rejects(adapter.readPage(scope, context), error => error instanceof ReadTransportError && error.kind === 'invalid-request' && error.receivedBytes === Buffer.byteLength(malformed));
  const redirected = createZohoReadAdapter(config('invoices', async request => ({ status: 200, content: new TextEncoder().encode(fixture('invoices-page-1')), contentType: 'application/json', finalUrl: `${request.url}&redirected=true` })));
  await assert.rejects(redirected.readPage(scope, context), error => error instanceof ReadTransportError && error.kind === 'unsupported' && error.receivedBytes > 0);
});

test('Zoho refund read paths require exact payment parent and use separate read-only auth scopes', async () => {
  const requests: string[] = [], adapter = createZohoReadAdapter(config('customerpayment-refunds', async request => {
    requests.push(request.url); return syntheticTransport(fixture('payment-refunds-page'))(request, context);
  }, { parentId: '30001' }));
  assert.deepEqual(adapter.requiredAuthScopes, ['ZohoBooks.customerpayments.READ']);
  await adapter.readPage({ ...scope, dataScope: { ...scope.dataScope!, dataset: 'zoho-customerpayment-refunds' } }, context);
  assert.equal(requests[0], 'https://www.zohoapis.in/books/v3/customerpayments/30001/refunds?organization_id=12345&page=1&per_page=200');
  assert.throws(() => createZohoReadAdapter(config('customerpayment-refunds', syntheticTransport(fixture('payment-refunds-page')))), { code: 'ZOHO_REFUND_PARENT_REQUIRED' });
});
