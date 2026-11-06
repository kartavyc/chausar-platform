import { check } from '../../contracts.ts';
import type { ApiReadAdapter, ReadContinuation } from '../../connector-framework/read.ts';
import type { ConnectorOperationScope } from '../../connector-framework/registry.ts';
import {
  array, assertCompany, currency, date, decimal, integer, makeLine, makeRecord, object,
  parseExactJson, parseResponse, requiredText, sha256, text, wireSchemaFingerprint,
  type AccountingAccount, type AccountingPage, type AccountingReadConfig, type AccountingRecord,
} from './common.ts';

export const ZOHO_ADAPTER_VERSION = 'books-v3-adapter-1';
export const ZOHO_RESOURCES = Object.freeze([
  'invoices', 'creditnotes', 'customerpayments', 'chartofaccounts',
  'creditnote-refunds', 'customerpayment-refunds',
] as const);
export type ZohoResource = typeof ZOHO_RESOURCES[number];
export type ZohoDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'com.cn' | 'sa';
export const ZOHO_HOSTS: Readonly<Record<ZohoDataCenter, string>> = Object.freeze({
  com: 'www.zohoapis.com', eu: 'www.zohoapis.eu', in: 'www.zohoapis.in',
  'com.au': 'www.zohoapis.com.au', jp: 'www.zohoapis.jp', ca: 'www.zohoapis.ca',
  'com.cn': 'www.zohoapis.com.cn', sa: 'www.zohoapis.sa',
});
export const ZOHO_READ_SCOPES: Readonly<Record<ZohoResource, string>> = Object.freeze({
  invoices: 'ZohoBooks.invoices.READ', creditnotes: 'ZohoBooks.creditnotes.READ',
  customerpayments: 'ZohoBooks.customerpayments.READ', chartofaccounts: 'ZohoBooks.accountants.READ',
  'creditnote-refunds': 'ZohoBooks.creditnotes.READ', 'customerpayment-refunds': 'ZohoBooks.customerpayments.READ',
});
const collectionKeys: Record<ZohoResource, string> = {
  invoices: 'invoices', creditnotes: 'creditnotes', customerpayments: 'customer_payments',
  chartofaccounts: 'chartofaccounts', 'creditnote-refunds': 'creditnote_refunds',
  'customerpayment-refunds': 'payment_refunds',
};
const detailKeys: Partial<Record<ZohoResource, string>> = {
  invoices: 'invoice', creditnotes: 'creditnote', customerpayments: 'payment', chartofaccounts: '__root__',
};
const sourceIdKeys: Record<ZohoResource, string> = {
  invoices: 'invoice_id', creditnotes: 'creditnote_id', customerpayments: 'payment_id', chartofaccounts: 'account_id',
  'creditnote-refunds': 'creditnote_refund_id', 'customerpayment-refunds': 'payment_refund_id',
};
const numericId = (value: unknown): string => {
  const result = requiredText(value, 'ZOHO_ID_REQUIRED');
  check(/^\d{1,100}$/.test(result), 'ZOHO_ID_INVALID', 'Zoho source IDs must be numeric text.');
  return result;
};
function scopedSource(value: unknown, organizationId: string): Record<string, unknown> {
  const source = object(value);
  if (source.organization_id !== undefined) check(numericId(source.organization_id) === organizationId, 'ZOHO_ORGANIZATION_MISMATCH', 'Source bytes belong to another organization.');
  return source;
}
function classification(value: string | null): AccountingAccount['classification'] {
  if (['other_asset', 'other_current_asset', 'cash', 'bank', 'fixed_asset', 'accounts_receivable'].includes(value ?? '')) return 'asset';
  if (['other_current_liability', 'credit_card', 'long_term_liability', 'accounts_payable'].includes(value ?? '')) return 'liability';
  if (value === 'equity') return 'equity';
  if (value === 'income' || value === 'other_income') return 'income';
  if (['expense', 'cost_of_goods_sold', 'other_expense'].includes(value ?? '')) return 'expense';
  return 'unknown';
}
function documentStatus(value: string | null): AccountingRecord['status'] {
  if (value === 'draft' || value === 'void' || value === 'paid') return value;
  if (['sent', 'overdue', 'partially_paid', 'open'].includes(value ?? '')) return 'open';
  return 'unknown';
}
function lines(source: Record<string, unknown>, warnings: string[], resource: 'invoices' | 'creditnotes') {
  if (source.line_items === undefined) { warnings.push('DETAIL_LINES_UNAVAILABLE'); return []; }
  return array(source.line_items).map(value => {
    const line = object(value), category = text(line.line_item_category);
    // Preserve headers/subtotals as source rows, without making them sale quantities.
    const substantive = category === null || category === 'line_item';
    if (!substantive) warnings.push(['header', 'subtotal'].includes(category ?? '') ? 'NON_POSTING_LINE_RETAINED' : 'UNKNOWN_LINE_CATEGORY');
    return makeLine({
      id: text(line.line_item_id), description: text(line.description),
      quantity: substantive ? decimal(line.quantity) : null,
      unitAmount: substantive ? decimal(line.rate) : null,
      // A reported total is retained. Quantity * rate is not substituted for discounts/tax.
      amount: substantive && resource === 'invoices' ? decimal(line.item_total) : null,
      accountId: text(line.account_id), taxCode: text(line.tax_id), source: line,
    });
  });
}
function document(source: Record<string, unknown>, resource: 'invoices' | 'creditnotes', detail: boolean): AccountingRecord {
  const warnings: string[] = [], sourceStatus = text(source.status), status = documentStatus(sourceStatus);
  if (status === 'unknown') warnings.push('UNKNOWN_DOCUMENT_STATUS');
  if (!detail) warnings.push('LIST_SUMMARY_REQUIRES_DETAIL');
  if (resource === 'invoices') warnings.push('INVOICE_SCHEMA_REFERENCE_REVIEW_REQUIRED');
  if (source.is_inclusive_tax === undefined) warnings.push('TAX_INCLUSION_UNAVAILABLE');
  else check(typeof source.is_inclusive_tax === 'boolean', 'ZOHO_TAX_INCLUSION_INVALID', 'Tax inclusion must be an explicit boolean.');
  const allocations = resource === 'creditnotes' && source.invoices !== undefined ? array(source.invoices).map(value => {
    const invoice = object(value);
    return { documentId: numericId(invoice.invoice_id), documentKind: 'invoice', amount: decimal(invoice.amount), source: invoice };
  }) : [];
  const result = makeRecord({
    id: numericId(source[sourceIdKeys[resource]]), kind: resource === 'invoices' ? 'invoice' : 'credit-note',
    sourceType: resource === 'invoices' ? 'invoice' : 'creditnote', direction: 'receivable',
    revision: text(resource === 'invoices' ? source.last_modified_time : source.updated_time),
    date: date(source.date), currency: currency(source.currency_code), total: decimal(source.total),
    subtotal: resource === 'invoices' ? decimal(source.sub_total) : null,
    taxTotal: resource === 'invoices' ? decimal(source.tax_total) : null, balance: decimal(source.balance),
    sourceStatus, status, lines: detail ? lines(source, warnings, resource) : [], allocations, source, warnings,
  });
  if (result.currency === null) warnings.push('CURRENCY_UNAVAILABLE');
  if (result.total === null) warnings.push('SOURCE_AMOUNT_UNAVAILABLE');
  if (result.taxTotal === null) warnings.push('SOURCE_TAX_TOTAL_UNAVAILABLE');
  // A credit note is a positive credit document, not an observed cash refund.
  if (resource === 'creditnotes') warnings.push('CREDIT_NOTE_IS_NOT_CASH_REFUND', 'CREDIT_LINE_TOTAL_SEMANTICS_UNQUALIFIED');
  return result;
}
function payment(source: Record<string, unknown>, detail: boolean): AccountingRecord {
  const sourceStatus = text(source.status), warnings: string[] = [];
  const allocations = source.invoices === undefined ? [] : array(source.invoices).map(value => {
    const invoice = object(value);
    return { documentId: numericId(invoice.invoice_id), documentKind: 'invoice', amount: decimal(invoice.amount_applied), source: invoice };
  });
  if (!detail) warnings.push('LIST_SUMMARY_REQUIRES_DETAIL');
  if (source.invoices === undefined) warnings.push('PAYMENT_ALLOCATIONS_UNAVAILABLE');
  // Success is a source status, not bank settlement verification or revenue recognition.
  warnings.push(sourceStatus === 'success' ? 'PAYMENT_SETTLEMENT_UNVERIFIED' : sourceStatus === 'failure' ? 'FAILED_PAYMENT_EXCLUDED_FROM_CASH' : 'UNKNOWN_PAYMENT_STATUS');
  if (source.amount_refunded !== undefined) { decimal(source.amount_refunded); warnings.push('REFUNDED_AGGREGATE_REQUIRES_SEPARATE_REFUND_EVENTS'); }
  const result = makeRecord({ id: numericId(source.payment_id), kind: 'payment', sourceType: 'customerpayment', direction: 'inflow', date: date(source.date), currency: currency(source.currency_code),
    total: decimal(source.amount), sourceStatus, status: 'unknown', allocations, source, warnings });
  if (result.currency === null) warnings.push('CURRENCY_UNAVAILABLE');
  if (result.total === null) warnings.push('SOURCE_AMOUNT_UNAVAILABLE');
  return result;
}
function account(source: Record<string, unknown>): AccountingRecord {
  const sourceType = text(source.account_type), category = classification(sourceType);
  if (source.is_active !== undefined) check(typeof source.is_active === 'boolean', 'ZOHO_ACCOUNT_ACTIVE_INVALID', 'Account activity must be a boolean.');
  return makeRecord({ id: numericId(source.account_id), kind: 'account', sourceType: 'account', revision: text(source.last_modified_time), currency: currency(source.currency_code), source,
    account: { code: text(source.account_code), name: text(source.account_name), sourceType, sourceClass: null, classification: category },
    warnings: category === 'unknown' ? ['UNKNOWN_ACCOUNT_TYPE'] : [] });
}
function refund(source: Record<string, unknown>, resource: 'creditnote-refunds' | 'customerpayment-refunds', parentId?: string): AccountingRecord {
  const sourceParent = numericId(resource === 'creditnote-refunds' ? source.creditnote_id : source.payment_id);
  if (parentId !== undefined) check(sourceParent === parentId, 'ZOHO_REFUND_PARENT_MISMATCH', 'Refund belongs to another document.');
  const credit = resource === 'creditnote-refunds';
  const amount = decimal(credit ? source.amount_fcy : source.amount), warnings = ['REFUND_CURRENCY_REQUIRES_PARENT_VERIFICATION', 'REFUND_SETTLEMENT_UNVERIFIED'];
  // amount_bcy and amount_fcy remain distinct source quantities; no base currency guessing.
  if (amount === null) warnings.push('SOURCE_AMOUNT_UNAVAILABLE');
  return makeRecord({ id: numericId(source[sourceIdKeys[resource]]), kind: 'refund', sourceType: credit ? 'creditnote_refund' : 'payment_refund', direction: 'outflow', date: date(source.date),
    currency: null, total: amount, sourceStatus: text(source.status), source,
    allocations: [{ documentId: sourceParent, documentKind: credit ? 'credit-note' : 'payment', amount, source }], warnings });
}

export type ZohoParseContext = {
  resource: ZohoResource; organizationId: string; detail?: boolean; expectedPage?: number;
  expectedResourceId?: string; parentId?: string;
};
/** Import exact captured API JSON. Caller must supply the authorized company binding. */
export function parseZohoPage(content: string, context: ZohoParseContext): AccountingPage {
  check(ZOHO_RESOURCES.includes(context.resource), 'ZOHO_RESOURCE_UNSUPPORTED', 'Select an implemented Zoho resource.');
  const organizationId = numericId(context.organizationId), body = scopedSource(parseExactJson(content), organizationId);
  check(integer(body.code) === 0, 'ZOHO_API_ERROR', 'Zoho did not report a successful source response.');
  const detail = context.detail === true, resource = context.resource;
  check(!detail || detailKeys[resource] !== undefined, 'ZOHO_DETAIL_UNSUPPORTED', 'This refund profile imports collection responses only.');
  const values = detail ? [resource === 'chartofaccounts' ? body : object(body[detailKeys[resource]!])] : array(body[collectionKeys[resource]]);
  check(values.length <= 10_000, 'ZOHO_ROW_LIMIT', 'The source row budget was exceeded.');
  const records = values.map(value => {
    const source = scopedSource(value, organizationId);
    const record = resource === 'invoices' || resource === 'creditnotes' ? document(source, resource, detail)
      : resource === 'customerpayments' ? payment(source, detail)
      : resource === 'chartofaccounts' ? account(source) : refund(source, resource, context.parentId);
    if (context.expectedResourceId !== undefined) check(record.id === numericId(context.expectedResourceId), 'ZOHO_DETAIL_ID_MISMATCH', 'Detail response belongs to another resource.');
    return record;
  });
  let continuation: ReadContinuation = { kind: 'complete' };
  if (!detail) {
    // The documented payment list can return null. That does not prove termination.
    const pagination = object(body.page_context, 'ZOHO_PAGINATION_UNAVAILABLE'), page = integer(pagination.page, 1);
    if (context.expectedPage !== undefined) check(page === integer(context.expectedPage, 1), 'ZOHO_PAGE_MISMATCH', 'Source returned another page.');
    if (pagination.per_page !== undefined) check(values.length <= integer(pagination.per_page, 1, 10_000), 'ZOHO_PAGE_SIZE_MISMATCH', 'Source returned more rows than its declared page size.');
    check(typeof pagination.has_more_page === 'boolean', 'ZOHO_PAGINATION_UNAVAILABLE', 'Source must explicitly report pagination termination.');
    check(!pagination.has_more_page || values.length > 0, 'ZOHO_EMPTY_CONTINUATION', 'An empty continuing page cannot establish progress.');
    if (pagination.has_more_page) continuation = { kind: 'more', next: { kind: 'page', page: page + 1 } };
  }
  return { records, continuation, totalRows: null, sourceGeneratedAtMs: null, snapshotId: null,
    warnings: ['SOURCE_TOTALS_REQUIRE_INDEPENDENT_REPORT', 'PAGINATION_IS_NOT_COMPANY_COMPLETENESS', 'SOURCE_SNAPSHOT_UNVERIFIED'] };
}

export const zohoSchemaFingerprint = (content: string): string => wireSchemaFingerprint(content);
export type ZohoReadConfig = AccountingReadConfig & {
  operation: ConnectorOperationScope; organizationId: string; companyId?: string; dataCenter: ZohoDataCenter;
  resource: ZohoResource; resourceId?: string; parentId?: string; perPage?: number; dataset?: string;
};
export const zohoReadOperationId = (resource: ZohoResource, detail = false): string => `zoho-books-v3-${resource}-${detail ? 'detail' : 'list'}`;
/** Pins every non-secret target and paging choice to exact operation qualification. */
export function zohoReadConfiguration(config: Pick<ZohoReadConfig, 'dataCenter' | 'organizationId' | 'companyId' | 'resource' | 'resourceId' | 'parentId' | 'perPage' | 'dataset'>): string {
  return sha256(JSON.stringify({
    version: ZOHO_ADAPTER_VERSION, dataCenter: config.dataCenter, organizationId: numericId(config.organizationId),
    companyId: requiredText(config.companyId ?? config.organizationId), resource: config.resource,
    resourceId: config.resourceId === undefined ? null : numericId(config.resourceId),
    parentId: config.parentId === undefined ? null : numericId(config.parentId),
    perPage: integer(config.perPage ?? 200, 1, 200), dataset: requiredText(config.dataset ?? `zoho-${config.resource}`),
  }));
}
/** No default network or OAuth exchange. Host transport resolves the opaque credential reference. */
export function createZohoReadAdapter(config: ZohoReadConfig): ApiReadAdapter {
  const organizationId = numericId(config.organizationId), companyId = config.companyId ?? organizationId;
  requiredText(companyId); check(typeof config.transport === 'function', 'ZOHO_TRANSPORT_REQUIRED', 'Inject a read-only transport.');
  check(Object.hasOwn(ZOHO_HOSTS, config.dataCenter), 'ZOHO_DATA_CENTER_UNSUPPORTED', 'Select a documented Zoho data center.');
  check(ZOHO_RESOURCES.includes(config.resource), 'ZOHO_RESOURCE_UNSUPPORTED', 'Select an implemented Zoho resource.');
  check(config.operation.connectorId === 'zoho-books' && config.operation.kind === 'read' && config.operation.transport === 'api'
    && config.operation.applicability.applicationVersion === 'v3', 'ZOHO_OPERATION_MISMATCH', 'Bind an exact Zoho Books v3 read operation.');
  const operation = structuredClone(config.operation), environment = config.environment, transport = config.transport;
  const resource = config.resource, resourceId = config.resourceId === undefined ? undefined : numericId(config.resourceId);
  const parentId = config.parentId === undefined ? undefined : numericId(config.parentId), detail = resourceId !== undefined;
  check(operation.connectorVersion === ZOHO_ADAPTER_VERSION && operation.operationId === zohoReadOperationId(resource, detail)
    && operation.applicability.module === resource && operation.applicability.configuration === zohoReadConfiguration(config),
    'ZOHO_OPERATION_PROFILE_MISMATCH', 'Operation qualification must pin the exact resource, target, data center and paging profile.');
  check(!detail || detailKeys[resource] !== undefined, 'ZOHO_DETAIL_UNSUPPORTED', 'Use the separately scoped refund collection operation.');
  check(resource !== 'customerpayment-refunds' || parentId !== undefined, 'ZOHO_REFUND_PARENT_REQUIRED', 'Payment refund reads require an exact payment ID.');
  check(parentId === undefined || resource === 'creditnote-refunds' || resource === 'customerpayment-refunds', 'ZOHO_PARENT_UNSUPPORTED', 'Parent binding applies only to refund collections.');
  check(!detail || parentId === undefined, 'ZOHO_PARENT_UNSUPPORTED', 'Detail reads do not accept a refund parent.');
  const perPage = integer(config.perPage ?? 200, 1, 200), host = ZOHO_HOSTS[config.dataCenter];
  const dataset = requiredText(config.dataset ?? `zoho-${resource}`);
  Object.freeze(operation.applicability); Object.freeze(operation);
  return Object.freeze<ApiReadAdapter>({
    mode: 'api', operation, environment, sideEffects: 'none', retrySafety: 'idempotent-read', retryOwner: 'dispatcher',
    requiredAuthScopes: Object.freeze([ZOHO_READ_SCOPES[resource]]), pagination: Object.freeze({ kind: detail ? 'none' : 'page' }),
    async readPage(request, context) {
      assertCompany(request, companyId, organizationId);
      check(request.dataScope?.dataset === dataset && request.dataScope.branches.length === 1 && request.dataScope.branches[0] === 'all'
        && request.dataScope.period === undefined, 'ZOHO_DOMAIN_UNSUPPORTED', 'This reader acquires only the configured resource across all branches and dates.');
      check(context.retryOwner === 'dispatcher', 'ZOHO_RETRY_OWNER_INVALID', 'Transport retries must be disabled.');
      check(!context.signal.aborted, 'ZOHO_READ_CANCELLED', 'Read was cancelled.');
      let page = 1;
      if (request.cursor !== null) {
        check(!detail && request.cursor.kind === 'page', 'ZOHO_CURSOR_INVALID', 'Zoho reads require a bounded page cursor.');
        page = integer((request.cursor as { page: number }).page, 1);
      }
      const path = resource === 'creditnote-refunds' ? `/creditnotes${parentId ? `/${parentId}` : ''}/refunds`
        : resource === 'customerpayment-refunds' ? `/customerpayments/${parentId}/refunds`
        : `/${resource}${detail ? `/${resourceId}` : ''}`;
      const url = new URL(`https://${host}/books/v3${path}`);
      url.searchParams.set('organization_id', organizationId);
      if (!detail) { url.searchParams.set('page', String(page)); url.searchParams.set('per_page', String(perPage)); }
      const expectedUrl = url.toString();
      const response = await transport({ method: 'GET', url: expectedUrl, headers: { Accept: 'application/json' } }, context);
      const { parsed, schemaFingerprint } = parseResponse(response, expectedUrl, context, content => ({
        parsed: parseZohoPage(content, { resource, organizationId, detail, expectedPage: page, expectedResourceId: resourceId, parentId }),
        schemaFingerprint: zohoSchemaFingerprint(content),
      }));
      return { content: response.content, contentType: response.contentType, schemaFingerprint,
        rowCount: parsed.records.length, continuation: parsed.continuation,
        source: { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null } };
    },
  });
}
