import { check } from '../../contracts.ts';
import { digest } from '../../actions.ts';
import type { ApiReadAdapter, ReadContinuation } from '../../connector-framework/read.ts';
import { connectorOperationKey } from '../../connector-framework/registry.ts';
import type { ConnectorOperationScope } from '../../connector-framework/registry.ts';
import { array, assertCompany, currency, date, decimal, freezeOperation, integer, makeLine, makeRecord, object, parseExactJson, parseResponse, requiredText, text, wireSchemaFingerprint } from './common.ts';
import type { AccountingAccount, AccountingAllocation, AccountingPage, AccountingReadConfig, AccountingRecord, AccountingStatus } from './common.ts';

/** Schema version is an internal reference identity, not a qualification assertion. */
export const XERO_REFERENCE_PROFILE = 'accounting-api-2.0-openapi-19.0.0';
export type XeroResource = 'invoices' | 'credit-notes' | 'payments' | 'accounts';
export type XeroParseOptions = Readonly<{ resource: XeroResource; page?: number; pageSize?: number }>;
const resources = Object.freeze({ invoices: 'Invoices', 'credit-notes': 'CreditNotes', payments: 'Payments', accounts: 'Accounts' });
const rootStatus = new Set(['DRAFT', 'SUBMITTED', 'DELETED', 'AUTHORISED', 'PAID', 'VOIDED']);
const paymentTypes = new Set(['ACCRECPAYMENT', 'ACCPAYPAYMENT', 'ARCREDITPAYMENT', 'APCREDITPAYMENT', 'AROVERPAYMENTPAYMENT', 'ARPREPAYMENTPAYMENT', 'APPREPAYMENTPAYMENT', 'APOVERPAYMENTPAYMENT']);
const classifications: Record<string, AccountingAccount['classification']> = { ASSET: 'asset', LIABILITY: 'liability', EQUITY: 'equity', REVENUE: 'income', EXPENSE: 'expense' };

function msDate(value: unknown): number | null {
  const source = text(value); if (source === null) return null;
  const match = /^\/Date\((-?\d{1,15})([+-]\d{4})?\)\/$/.exec(source);
  check(match && (!match[2] || match[2] === '+0000' || match[2] === '-0000'), 'XERO_DATE_OFFSET_UNQUALIFIED', 'This date wrapper requires a reviewed offset profile.');
  const result = Number(match[1]);
  check(Number.isSafeInteger(result) && Math.abs(result) <= 8_640_000_000_000_000, 'XERO_DATE_INVALID', 'Source date is outside the supported calendar.');
  return result;
}

/** Calendar dates do not inherit the host's timezone. Nonzero wrappers need a separately reviewed profile. */
export function xeroCalendarDate(value: unknown, companion?: unknown): string | null {
  const explicit = text(companion);
  let result: string | null;
  if (explicit !== null) {
    check(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,7})?$/.test(explicit), 'XERO_DATE_STRING_INVALID', 'Expected an explicit source calendar date.');
    result = date(explicit.slice(0, 10));
  } else {
    const source = text(value); if (source === null) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return date(source);
    const epoch = msDate(source)!;
    const instant = new Date(epoch).toISOString();
    check(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(instant), 'XERO_CALENDAR_DATE_AMBIGUOUS', 'A calendar date must be source midnight.');
    result = date(instant.slice(0, 10));
  }
  // Cross-check the documented zero-offset representation when both fields are present.
  if (value !== undefined && value !== null) {
    const source = text(value)!;
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) check(date(source) === result, 'XERO_DATE_CONFLICT', 'Source date representations disagree.');
    else if (/^\/Date\(-?\d+(?:[+-]0000)?\)\/$/.test(source)) {
      check(new Date(msDate(source)!).toISOString() === `${result}T00:00:00.000Z`, 'XERO_DATE_CONFLICT', 'Source date representations disagree.');
    } else check(false, 'XERO_DATE_OFFSET_UNQUALIFIED', 'This date wrapper requires a reviewed offset profile.');
  }
  return result;
}

function revision(source: Record<string, unknown>): string | null {
  const wrapper = text(source.UpdatedDateUTC), iso = text(source.UpdatedDateUTCString);
  if (iso !== null) {
    check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(iso) && Number.isFinite(Date.parse(iso)), 'XERO_REVISION_INVALID', 'Expected a UTC revision timestamp.');
    check(new Date(iso).toISOString().slice(0, 19) === iso.slice(0, 19), 'XERO_REVISION_INVALID', 'A real revision calendar timestamp is required.');
  }
  if (wrapper !== null) {
    const epoch = msDate(wrapper)!;
    if (iso !== null) {
      // The companion may omit milliseconds; the wrapper retains the actual source precision.
      check(iso.includes('.') ? Date.parse(iso) === epoch : Math.floor(Date.parse(iso) / 1000) === Math.floor(epoch / 1000), 'XERO_REVISION_CONFLICT', 'Source revision representations disagree.');
    }
    return new Date(epoch).toISOString();
  }
  if (iso === null) return null;
  return new Date(iso).toISOString();
}

function status(source: unknown, family: XeroResource): AccountingStatus {
  const value = text(source); if (value === null) return 'unknown';
  if (family === 'accounts') {
    check(['ACTIVE', 'ARCHIVED', 'DELETED'].includes(value), 'XERO_STATUS_UNSUPPORTED', 'Unknown source account status.');
    return value === 'DELETED' ? 'deleted' : value === 'ACTIVE' ? 'open' : 'unknown';
  }
  check((family === 'payments' ? ['AUTHORISED', 'DELETED'].includes(value) : rootStatus.has(value)), 'XERO_STATUS_UNSUPPORTED', 'Unknown source transaction status.');
  return value === 'DRAFT' || value === 'SUBMITTED' ? 'draft' : value === 'AUTHORISED' ? 'open' : value === 'PAID' ? 'paid' : value === 'VOIDED' ? 'void' : 'deleted';
}

function sourceWarnings(source: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  for (const flag of ['HasErrors', 'HasValidationErrors'] as const) {
    if (source[flag] !== undefined) check(typeof source[flag] === 'boolean', 'XERO_FLAG_INVALID', 'Expected source validation flag.');
    if (source[flag] === true) warnings.push('SOURCE_VALIDATION_ERRORS');
  }
  for (const name of ['ValidationErrors', 'Warnings'] as const) if (source[name] !== undefined && array(source[name]).length) warnings.push('SOURCE_VALIDATION_ERRORS');
  return [...new Set(warnings)];
}

function account(source: Record<string, unknown>): AccountingAccount {
  const sourceClass = text(source.Class);
  return { code: text(source.Code), name: text(source.Name), sourceType: text(source.Type), sourceClass,
    classification: sourceClass !== null ? classifications[sourceClass] ?? 'unknown' : 'unknown' };
}

function allocations(source: Record<string, unknown>, credit: boolean): AccountingAllocation[] {
  const result: AccountingAllocation[] = [];
  if (credit && source.Allocations !== undefined) for (const entry of array(source.Allocations)) {
    const allocation = object(entry), invoice = allocation.Invoice === undefined ? null : object(allocation.Invoice);
    if (allocation.IsDeleted !== undefined) check(typeof allocation.IsDeleted === 'boolean', 'XERO_ALLOCATION_FLAG_INVALID', 'Expected a deletion flag.');
    if (allocation.Date !== undefined) xeroCalendarDate(allocation.Date);
    result.push({ documentId: invoice ? text(invoice.InvoiceID) : null, documentKind: 'invoice', amount: decimal(allocation.Amount), source: allocation });
  }
  // Embedded payments are references only. Import the Payments resource once for cash accounting.
  if (source.Payments !== undefined) for (const entry of array(source.Payments)) {
    const payment = object(entry);
    if (payment.Date !== undefined) xeroCalendarDate(payment.Date);
    result.push({ documentId: text(payment.PaymentID), documentKind: credit ? 'refund-reference' : 'payment-reference', amount: decimal(payment.Amount), source: payment });
  }
  if (!credit && source.CreditNotes !== undefined) for (const entry of array(source.CreditNotes)) {
    const note = object(entry);
    result.push({ documentId: text(note.CreditNoteID), documentKind: 'credit-note-reference', amount: decimal(note.AppliedAmount), source: note });
  }
  return result;
}

function document(source: Record<string, unknown>, resource: 'invoices' | 'credit-notes'): AccountingRecord {
  const credit = resource === 'credit-notes', type = requiredText(source.Type, 'XERO_DOCUMENT_TYPE_REQUIRED');
  check((credit ? ['ACCRECCREDIT', 'ACCPAYCREDIT'] : ['ACCREC', 'ACCPAY']).includes(type), 'XERO_DOCUMENT_TYPE_UNSUPPORTED', 'This source document type requires another qualified operation.');
  const warnings = sourceWarnings(source), taxMode = text(source.LineAmountTypes);
  check(taxMode === null || ['Exclusive', 'Inclusive', 'NoTax'].includes(taxMode), 'XERO_TAX_MODE_UNSUPPORTED', 'Unknown source line tax mode.');
  if (taxMode === null) warnings.push('TAX_MODE_MISSING');
  if (source.LineItems === undefined) warnings.push('LINE_DETAILS_MISSING');
  for (const name of ['CurrencyRate', 'AmountPaid', 'AmountCredited', 'TotalDiscount', 'RoundingAmount', 'EnteredTotal', 'CISDeduction', 'CISRate']) if (source[name] !== undefined) decimal(source[name]);
  const record = makeRecord({ id: requiredText(source[credit ? 'CreditNoteID' : 'InvoiceID']), kind: credit ? 'credit-note' : 'invoice', source,
    sourceType: type, direction: type === 'ACCREC' || type === 'ACCRECCREDIT' ? 'receivable' : 'payable',
    revision: revision(source), date: xeroCalendarDate(source.Date, source.DateString), currency: currency(source.CurrencyCode),
    total: decimal(source.Total), subtotal: decimal(source.SubTotal), taxTotal: decimal(source.TotalTax), balance: decimal(source[credit ? 'RemainingCredit' : 'AmountDue']),
    sourceStatus: text(source.Status), status: status(source.Status, resource), warnings, allocations: allocations(source, credit),
    lines: source.LineItems === undefined ? [] : array(source.LineItems).map(entry => {
      const line = object(entry);
      for (const name of ['DiscountRate', 'DiscountAmount']) if (line[name] !== undefined) decimal(line[name]);
      return makeLine({ source: line, id: text(line.LineItemID), description: text(line.Description), quantity: decimal(line.Quantity),
        unitAmount: decimal(line.UnitAmount), amount: decimal(line.LineAmount), accountId: text(line.AccountID), taxAmount: decimal(line.TaxAmount), taxCode: text(line.TaxType) });
    }) });
  if (source.DueDate !== undefined || source.DueDateString !== undefined) xeroCalendarDate(source.DueDate, source.DueDateString);
  if (record.currency === null) warnings.push('CURRENCY_MISSING');
  if (record.date === null) warnings.push('DATE_MISSING');
  if (record.revision === null) warnings.push('REVISION_MISSING');
  if (record.total === null) warnings.push('SOURCE_TOTAL_MISSING');
  if (!credit && (source.Prepayments !== undefined && array(source.Prepayments).length || source.Overpayments !== undefined && array(source.Overpayments).length)) warnings.push('PREPAYMENT_OVERPAYMENT_SEMANTICS_UNSUPPORTED');
  if (source.RoundingAmount !== undefined || source.EnteredTotal !== undefined) warnings.push('ROUNDING_OPT_IN_SINGLE_INVOICE_PROFILE_REQUIRED');
  return record;
}

function payment(source: Record<string, unknown>): AccountingRecord {
  const type = text(source.PaymentType), warnings = sourceWarnings(source);
  check(type === null || paymentTypes.has(type), 'XERO_PAYMENT_TYPE_UNSUPPORTED', 'Unknown source payment type.');
  const observedStatus = status(source.Status, 'payments');
  const refund = type === 'ARCREDITPAYMENT' || type === 'APCREDITPAYMENT';
  const linked = source[refund ? 'CreditNote' : 'Invoice'];
  const target = linked === undefined ? null : object(linked);
  if (type !== null && ['ACCRECPAYMENT', 'ACCPAYPAYMENT', 'ARCREDITPAYMENT', 'APCREDITPAYMENT'].includes(type)) {
    const expectedTargetType = { ACCRECPAYMENT: 'ACCREC', ACCPAYPAYMENT: 'ACCPAY', ARCREDITPAYMENT: 'ACCRECCREDIT', APCREDITPAYMENT: 'ACCPAYCREDIT' }[type];
    if (target?.Type !== undefined) check(target.Type === expectedTargetType, 'XERO_PAYMENT_DOCUMENT_TYPE_CONFLICT', 'Payment and linked document types disagree.');
    check(source[refund ? 'Invoice' : 'CreditNote'] === undefined && source.Prepayment === undefined && source.Overpayment === undefined,
      'XERO_PAYMENT_DOCUMENT_TYPE_CONFLICT', 'A payment cannot change its source document family.');
  }
  if (source.CurrencyRate !== undefined) decimal(source.CurrencyRate);
  if (source.BankAmount !== undefined) decimal(source.BankAmount);
  if (source.IsReconciled !== undefined) check(typeof source.IsReconciled === 'boolean', 'XERO_RECONCILED_FLAG_INVALID', 'Expected a source reconciliation flag.');
  const sourceAccount = source.Account === undefined ? null : object(source.Account);
  const record = makeRecord({ id: requiredText(source.PaymentID), kind: refund ? 'refund' : 'payment', source, revision: revision(source),
    sourceType: type, direction: type === 'ACCRECPAYMENT' || type === 'APCREDITPAYMENT' ? 'inflow' : type === 'ACCPAYPAYMENT' || type === 'ARCREDITPAYMENT' ? 'outflow' : 'unknown',
    date: xeroCalendarDate(source.Date, source.DateString), currency: target ? currency(target.CurrencyCode) : null, total: decimal(source.Amount),
    status: type === null || !['ACCRECPAYMENT', 'ACCPAYPAYMENT', 'ARCREDITPAYMENT', 'APCREDITPAYMENT'].includes(type) ? 'unknown' : observedStatus,
    sourceStatus: text(source.Status), warnings, account: sourceAccount ? account(sourceAccount) : null,
    allocations: target ? [{ documentId: text(target[refund ? 'CreditNoteID' : 'InvoiceID']), documentKind: refund ? 'credit-note' : 'invoice', amount: decimal(source.Amount), source: target }] : [] });
  if (type === null) warnings.push('PAYMENT_TYPE_MISSING');
  if (type !== null && /(?:PREPAYMENT|OVERPAYMENT)PAYMENT$/.test(type)) warnings.push('PREPAYMENT_OVERPAYMENT_SEMANTICS_UNSUPPORTED');
  if (record.currency === null) warnings.push('DOCUMENT_CURRENCY_MISSING');
  if (record.allocations.length === 0 || record.allocations[0].documentId === null) warnings.push('PAYMENT_DOCUMENT_LINK_MISSING');
  if (record.revision === null) warnings.push('REVISION_MISSING');
  if (record.date === null) warnings.push('DATE_MISSING');
  if (record.total === null) warnings.push('SOURCE_TOTAL_MISSING');
  // BankAmount and IsReconciled are source observations; neither proves bank settlement.
  warnings.push('BANK_SETTLEMENT_UNVERIFIED');
  return record;
}

function pagination(root: Record<string, unknown>, count: number, options: XeroParseOptions): { continuation: ReadContinuation; totalRows: number | null } {
  const page = integer(options.page ?? 1, 1), pageSize = integer(options.pageSize ?? 100, 1, 100);
  if (options.resource === 'accounts') {
    check(page === 1 && root.pagination === undefined, 'XERO_ACCOUNTS_PAGINATION_UNSUPPORTED', 'Accounts use the unpaged chart-of-accounts operation.');
    return { continuation: { kind: 'complete' }, totalRows: null };
  }
  check(count <= pageSize, 'XERO_PAGE_SIZE_EXCEEDED', 'Source returned more rows than requested.');
  if (root.pagination === undefined) return { continuation: count < pageSize ? { kind: 'complete' } : { kind: 'more', next: { kind: 'page', page: page + 1 } }, totalRows: null };
  const metadata = object(root.pagination), actualPage = integer(metadata.page, 1), actualSize = integer(metadata.pageSize, 1, 100), pages = integer(metadata.pageCount), totalRows = integer(metadata.itemCount);
  check(actualPage === page && actualSize === pageSize, 'XERO_PAGINATION_MISMATCH', 'Source pagination must bind the requested page.');
  check((totalRows === 0 ? pages === 0 || pages === 1 : pages === Math.ceil(totalRows / pageSize)) && page <= Math.max(pages, 1), 'XERO_PAGINATION_TOTAL_INVALID', 'Source pagination totals are inconsistent.');
  check(count === Math.min(pageSize, Math.max(0, totalRows - (page - 1) * pageSize)), 'XERO_PAGINATION_ROW_COUNT_INVALID', 'Source page does not match its declared item count.');
  return { continuation: page < pages ? { kind: 'more', next: { kind: 'page', page: page + 1 } } : { kind: 'complete' }, totalRows };
}

export function xeroSchemaFingerprint(content: string): string { return wireSchemaFingerprint(content); }

export function parseXeroPage(content: string, options: XeroParseOptions): AccountingPage {
  check(Object.hasOwn(resources, options.resource), 'XERO_RESOURCE_UNSUPPORTED', 'Unknown Xero read operation.');
  const root = object(parseExactJson(content));
  check(root.Status === undefined || root.Status === 'OK', 'XERO_RESPONSE_FAILED', 'Source returned a failed accounting response.');
  check(root.ErrorNumber === undefined, 'XERO_RESPONSE_FAILED', 'Source returned an accounting error.');
  const entries = array(root[resources[options.resource]]), warnings = sourceWarnings(root);
  const records = entries.map(entry => {
    const source = object(entry);
    if (options.resource === 'invoices' || options.resource === 'credit-notes') return document(source, options.resource);
    if (options.resource === 'payments') return payment(source);
    const normalized = account(source), record = makeRecord({ id: requiredText(source.AccountID), kind: 'account', source,
      sourceType: text(source.Type),
      revision: revision(source), currency: currency(source.CurrencyCode), sourceStatus: text(source.Status), status: status(source.Status, 'accounts'),
      account: normalized, warnings: sourceWarnings(source) });
    if (normalized.classification === 'unknown') record.warnings.push('ACCOUNT_CLASSIFICATION_UNAVAILABLE');
    if (record.sourceStatus === 'ARCHIVED') record.warnings.push('ARCHIVED_ACCOUNT');
    return record;
  });
  const paging = pagination(root, records.length, options);
  // DateTimeUTC is a response clock, not a report generation time or a stable business snapshot.
  return { records, ...paging, sourceGeneratedAtMs: null, snapshotId: null, warnings: [...warnings, 'SOURCE_SNAPSHOT_UNVERIFIED', 'INDEPENDENT_SOURCE_TOTALS_REQUIRED'] };
}

export type XeroOperationProfile = Readonly<{
  companyId: string; organizationId: string; resource: XeroResource; dataset?: string; pageSize?: number;
  edition: string; configurationProfile: string; deploymentProfile: string; region?: string;
}>;
export type XeroReadConfig = AccountingReadConfig & XeroOperationProfile & Readonly<{ operation: ConnectorOperationScope }>;

/** Qualification scope binds the exact endpoint, tenant and unfiltered acquisition profile without credentials. */
export function xeroOperation(profile: XeroOperationProfile, kind: 'read' | 'import'): ConnectorOperationScope {
  check(Object.hasOwn(resources, profile.resource) && ['read', 'import'].includes(kind), 'XERO_RESOURCE_UNSUPPORTED', 'Unknown Xero operation profile.');
  for (const value of [profile.companyId, profile.organizationId, profile.edition, profile.configurationProfile, profile.deploymentProfile]) requiredText(value);
  const configuration = digest({ reference: XERO_REFERENCE_PROFILE, companyId: profile.companyId, organizationId: profile.organizationId,
    resource: profile.resource, dataset: profile.dataset ?? `xero-${profile.resource}`, pageSize: integer(profile.pageSize ?? 100, 1, 100),
    acquisition: 'full-tenant-no-period-all-branches', configurationProfile: profile.configurationProfile });
  return { connectorId: 'xero', connectorVersion: '1.0.0', operationId: `xero-${profile.resource}-${kind}`, kind, transport: kind === 'read' ? 'api' : 'file',
    applicability: { applicationVersion: '2.0', edition: profile.edition, module: `Accounting.${resources[profile.resource]}`,
      configuration, deploymentProfile: profile.deploymentProfile, ...(profile.region === undefined ? {} : { region: requiredText(profile.region) }) } };
}

/** Host injects opaque credential resolution and a no-retry, no-redirect GET transport. */
export function createXeroReadAdapter(config: XeroReadConfig): ApiReadAdapter {
  const organizationId = requiredText(config.organizationId), companyId = requiredText(config.companyId), resource = config.resource;
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId), 'XERO_ORGANIZATION_INVALID', 'An explicit Xero tenant UUID is required.');
  check(Object.hasOwn(resources, resource), 'XERO_RESOURCE_UNSUPPORTED', 'Unknown Xero read operation.');
  const operation = freezeOperation(config.operation), pageSize = integer(config.pageSize ?? 100, 1, 100), dataset = requiredText(config.dataset ?? `xero-${resource}`), transport = config.transport;
  check(connectorOperationKey(operation) === connectorOperationKey(xeroOperation(config, 'read')), 'XERO_OPERATION_MISMATCH', 'Expected the qualified endpoint, tenant and acquisition profile.');
  const scope = resource === 'accounts' ? 'accounting.settings.read' : resource === 'payments' ? 'accounting.payments.read' : 'accounting.invoices.read';
  return Object.freeze({ operation, environment: config.environment, mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
    requiredAuthScopes: Object.freeze([scope]), pagination: Object.freeze({ kind: resource === 'accounts' ? 'none' : 'page' }),
    async readPage(request, context) {
      assertCompany(request, companyId, organizationId);
      check(request.dataScope?.dataset === dataset && request.dataScope.period === undefined && request.dataScope.branches.length === 1 && request.dataScope.branches[0] === 'all',
        'XERO_DATA_SCOPE_UNSUPPORTED', 'This operation reads an unfiltered tenant resource without period or branch selection.');
      check(request.cursor === null || resource !== 'accounts' && request.cursor.kind === 'page', 'XERO_CURSOR_UNSUPPORTED', 'Expected a source page cursor.');
      const page = request.cursor?.kind === 'page' ? integer(request.cursor.page, 1) : 1;
      const endpoint = new URL(`https://api.xero.com/api.xro/2.0/${resources[resource]}`);
      if (resource !== 'accounts') { endpoint.searchParams.set('page', String(page)); endpoint.searchParams.set('pageSize', String(pageSize)); }
      const url = endpoint.href;
      const response = await transport({ method: 'GET', url, headers: { Accept: 'application/json', 'xero-tenant-id': organizationId } }, context);
      const { parsed, schemaFingerprint } = parseResponse(response, url, context, content => ({ parsed: parseXeroPage(content, { resource, page, pageSize }), schemaFingerprint: xeroSchemaFingerprint(content) }));
      return { content: response.content, contentType: response.contentType, schemaFingerprint, rowCount: parsed.records.length, continuation: parsed.continuation,
        source: { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: parsed.totalRows } };
    },
  });
}
