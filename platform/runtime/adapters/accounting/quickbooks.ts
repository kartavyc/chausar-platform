import { check } from '../../contracts.ts';
import type { ApiReadAdapter, ReadCursor } from '../../connector-framework/read.ts';
import type { ConnectorOperationScope } from '../../connector-framework/registry.ts';
import { connectorOperationKey } from '../../connector-framework/registry.ts';
import {
  array, assertCompany, currency, date, decimal, integer, makeLine, makeRecord, object,
  parseExactJson, parseResponse, requiredText, sha256, text, wireSchemaFingerprint,
} from './common.ts';
import type { AccountingAccount, AccountingAllocation, AccountingPage, AccountingReadConfig, AccountingRecord, AccountingStatus } from './common.ts';

export const QUICKBOOKS_ENTITIES = Object.freeze(['Invoice', 'CreditMemo', 'Payment', 'RefundReceipt', 'Account'] as const);
export type QuickBooksEntity = typeof QUICKBOOKS_ENTITIES[number];
export type QuickBooksPageProfile = {
  entity: QuickBooksEntity; realmId: string; minorVersion: string;
  /** STARTPOSITION is one based, unlike the framework's offset type. */
  startPosition?: number; pageSize?: number;
};
export type QuickBooksOperationProfile = QuickBooksPageProfile & {
  environment: AccountingReadConfig['environment'];
  /** Host's canonical company identity; defaults to the explicitly selected realm. */
  companyId?: string;
  dataset?: string;
  edition?: string;
  region?: string;
  period?: { from: string; to: string };
};
export type QuickBooksReadConfig = AccountingReadConfig & QuickBooksOperationProfile & { operation: ConnectorOperationScope };

export function quickBooksOperation(profile: QuickBooksOperationProfile, kind: 'read' | 'import'): ConnectorOperationScope {
  profileCheck(profile);
  check(['synthetic', 'sandbox', 'live'].includes(profile.environment), 'QBO_ENVIRONMENT_INVALID', 'An explicit execution environment is required.');
  if (profile.period) {
    check(date(profile.period.from) !== null && date(profile.period.to) !== null && profile.entity !== 'Account' && profile.period.from <= profile.period.to,
      'QBO_PERIOD_INVALID', 'Only transaction routes support a bounded posting-date period.');
  }
  const execution = { realmId: profile.realmId, companyId: profile.companyId ?? profile.realmId, entity: profile.entity,
    minorVersion: profile.minorVersion, pageSize: profile.pageSize ?? 100, dataset: profile.dataset ?? `qbo-${profile.entity.toLowerCase()}`,
    branch: 'all', period: profile.period ?? null, includeInactiveAccounts: profile.entity === 'Account', environment: profile.environment,
    edition: profile.edition ?? 'QBO', region: profile.region ?? null };
  return { connectorId: 'quickbooks', connectorVersion: '1.0.0', operationId: `qbo-${profile.entity.toLowerCase()}-${kind}-v1`, kind,
    transport: kind === 'read' ? 'api' : 'file', applicability: { applicationVersion: `v3-minor-${profile.minorVersion}`,
      edition: execution.edition, module: profile.entity, configuration: sha256(JSON.stringify(execution)),
      deploymentProfile: profile.environment === 'synthetic' ? 'injected-fixture' : 'host-attested-transport',
      ...(profile.region ? { region: profile.region } : {}) } };
}

function profileCheck(profile: QuickBooksPageProfile): void {
  check(QUICKBOOKS_ENTITIES.includes(profile.entity), 'QBO_ENTITY_UNSUPPORTED', 'Select an implemented QuickBooks Online entity.');
  check(/^\d{1,30}$/.test(profile.realmId), 'QBO_REALM_INVALID', 'A configured QuickBooks company realm is required.');
  check(/^(?:0|[1-9]\d{0,3})$/.test(profile.minorVersion), 'QBO_MINOR_VERSION_REQUIRED', 'Pin an explicit QuickBooks v3 minor version.');
  integer(profile.startPosition ?? 1, 1, 1_000_000_000); integer(profile.pageSize ?? 100, 1, 1000);
}
function reference(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return text(object(value).value);
}
function revision(value: unknown): string {
  const result = requiredText(value, 'QBO_SYNC_TOKEN_REQUIRED');
  check(/^(?:0|[1-9]\d{0,37})$/.test(result), 'QBO_SYNC_TOKEN_INVALID', 'The source SyncToken must be an exact nonnegative revision.');
  return result;
}
function invoiceStatus(source: Record<string, unknown>): { status: AccountingStatus; sourceStatus: string | null } {
  const observed = text(source.invoiceStatus);
  if (observed === 'VOIDED') return { status: 'void', sourceStatus: observed };
  if (observed === 'PAID_NOT_DEPOSITED' || observed === 'DEPOSITED') return { status: 'paid', sourceStatus: observed };
  if (observed && ['DUE_VIEWED', 'DUE_NOT_SENT', 'DUE_SENT', 'OVERDUE_VIEWED', 'OVERDUE_NOT_SENT', 'OVERDUE_SENT', 'PARTIALLY_PAID'].includes(observed))
    return { status: 'open', sourceStatus: observed };
  return { status: 'unknown', sourceStatus: observed ?? text(source.TxnStatus) ?? text(source.status) };
}
function linked(value: unknown, amount: string | null): AccountingAllocation[] {
  if (value === undefined || value === null) return [];
  const references = array(value).map(value => object(value));
  // One line may link an invoice AND credit. The line amount belongs to the pair,
  // not independently to both documents; preserve the native grouping in source.
  return references.map(source => ({ documentId: text(source.TxnId), documentKind: text(source.TxnType),
    amount: references.length === 1 ? amount : null, source }));
}
function accountClassification(source: Record<string, unknown>): AccountingAccount {
  const classes: Record<string, AccountingAccount['classification']> = {
    Asset: 'asset', Liability: 'liability', Equity: 'equity', Revenue: 'income', Expense: 'expense',
  };
  const sourceClass = text(source.Classification);
  return { code: text(source.AcctNum), name: text(source.Name), sourceType: text(source.AccountType),
    sourceClass, classification: sourceClass === null ? 'unknown' : classes[sourceClass] ?? 'unknown' };
}
function parseRecord(value: unknown, entity: QuickBooksEntity): AccountingRecord {
  const source = object(value);
  check(source.sparse !== true, 'QBO_SPARSE_UNSUPPORTED', 'A sparse observation requires a separately qualified merge route.');
  const record = makeRecord({ id: requiredText(source.Id), revision: revision(source.SyncToken), source,
    sourceType: entity, direction: entity === 'Invoice' || entity === 'CreditMemo' ? 'receivable' : entity === 'Payment' ? 'inflow' : entity === 'RefundReceipt' ? 'outflow' : 'unknown',
    kind: entity === 'Invoice' ? 'invoice' : entity === 'CreditMemo' ? 'credit-note' : entity === 'Payment' ? 'payment' : entity === 'RefundReceipt' ? 'refund' : 'account' });
  if (entity === 'Account') {
    record.account = accountClassification(source);
    record.currency = currency(reference(source.CurrencyRef));
    // CurrentBalance is a balance-sheet observation, never a transaction amount.
    record.balance = decimal(source.CurrentBalance);
    if (record.account.classification === 'unknown') record.warnings.push('QBO_ACCOUNT_CLASSIFICATION_UNAVAILABLE');
    return record;
  }
  record.date = date(source.TxnDate); record.currency = currency(reference(source.CurrencyRef));
  record.total = decimal(source.TotalAmt); record.balance = decimal(source.Balance);
  record.sourceStatus = text(source.TxnStatus) ?? text(source.status);
  if (entity === 'Invoice') Object.assign(record, invoiceStatus(source));
  if (record.status === 'unknown') record.warnings.push('QBO_VOID_AND_POSTING_STATUS_UNVERIFIED');
  if (!record.date) record.warnings.push('QBO_POSTING_DATE_UNAVAILABLE');
  if (!record.currency) record.warnings.push('QBO_CURRENCY_UNAVAILABLE');
  if (record.total === null) record.warnings.push('QBO_SOURCE_TOTAL_UNAVAILABLE');
  // MetaData and response time are not the source posting date or a coherent snapshot.
  if (source.ExchangeRate !== undefined) decimal(source.ExchangeRate);
  if (source.DueDate !== undefined) date(source.DueDate);
  if (source.Deposit !== undefined) decimal(source.Deposit);
  if (source.RemainingCredit !== undefined) decimal(source.RemainingCredit);
  const tax = source.TxnTaxDetail === undefined || source.TxnTaxDetail === null ? null : object(source.TxnTaxDetail);
  record.taxTotal = tax ? decimal(tax.TotalTax) : null;
  if (tax?.TaxLine !== undefined) for (const value of array(tax.TaxLine)) {
    const line = object(value); decimal(line.Amount);
    if (line.TaxLineDetail !== undefined) {
      const detail = object(line.TaxLineDetail);
      decimal(detail.TaxPercent); decimal(detail.NetAmountTaxable); decimal(detail.TaxInclusiveAmount);
    }
  }
  if (source.Line !== undefined) record.lines = array(source.Line).map(value => {
    const line = object(value), detailType = text(line.DetailType), amount = decimal(line.Amount);
    const normalized = makeLine({ source: line, id: text(line.Id), description: text(line.Description) });
    if (entity === 'Payment') {
      record.allocations.push(...linked(line.LinkedTxn, amount));
      record.warnings.push('QBO_PAYMENT_ALLOCATION_NOT_ADDITIONAL_CASH');
      return normalized;
    }
    if (detailType === 'SalesItemLineDetail') {
      const detail = object(line.SalesItemLineDetail), itemId = reference(detail.ItemRef);
      normalized.quantity = decimal(detail.Qty); normalized.unitAmount = decimal(detail.UnitPrice);
      normalized.accountId = reference(detail.ItemAccountRef); normalized.taxCode = reference(detail.TaxCodeRef);
      if (detail.TaxInclusiveAmt !== undefined) decimal(detail.TaxInclusiveAmt);
      normalized.amount = itemId ? amount : null;
      if (!itemId) record.warnings.push('QBO_DOCUMENTATION_LINE_AMOUNT_IGNORED');
      else if (!normalized.accountId) record.warnings.push('QBO_ITEM_ACCOUNT_LOOKUP_REQUIRED');
      if (detail.DeferredRevenue === true) record.warnings.push('QBO_DEFERRED_REVENUE_REQUIRES_FULFILLMENT_REVIEW');
    } else if (detailType === 'DiscountLineDetail') {
      const detail = object(line.DiscountLineDetail);
      normalized.amount = amount; normalized.accountId = reference(detail.DiscountAccountRef);
      normalized.taxCode = reference(detail.TaxCodeRef); decimal(detail.DiscountPercent);
      record.warnings.push('QBO_DISCOUNT_IS_ALLOWANCE');
    } else if (detailType === 'SubTotalLineDetail' || detailType === 'DescriptionOnly') {
      // These amounts are raw evidence, not an additional posting line.
      if (detailType === 'SubTotalLineDetail') record.warnings.push('QBO_SUBTOTAL_NOT_ADDITIONAL_CHARGE');
    } else record.warnings.push('QBO_LINE_DETAIL_UNSUPPORTED');
    record.allocations.push(...linked(line.LinkedTxn, null));
    return normalized;
  });
  record.allocations.push(...linked(source.LinkedTxn, null));
  if (entity === 'Payment') {
    decimal(source.UnappliedAmt);
    record.warnings.push('QBO_PAYMENT_IS_RECEIVABLE_SETTLEMENT_NOT_REVENUE', 'QBO_BANK_SETTLEMENT_UNVERIFIED');
    if (record.allocations.some(allocation => allocation.documentKind === 'CreditMemo')) record.warnings.push('QBO_CREDIT_APPLICATION_NOT_NEW_CASH');
    if (record.allocations.some(allocation => allocation.amount === null)) record.warnings.push('QBO_GROUPED_ALLOCATION_AMOUNT_UNAVAILABLE');
  }
  if (entity === 'CreditMemo') record.warnings.push('QBO_CREDIT_NOTE_NOT_CASH_REFUND');
  if (entity === 'RefundReceipt') record.warnings.push('QBO_REFUND_BANK_SETTLEMENT_UNVERIFIED', 'QBO_CREDIT_REFUND_OVERLAP_REVIEW_REQUIRED');
  record.warnings = [...new Set(record.warnings)];
  return record;
}

/** Parse one raw v3 QueryResponse. Number tokens remain exact source strings. */
export function parseQuickBooksPage(content: string, profile: QuickBooksPageProfile): AccountingPage {
  profileCheck(profile);
  const envelope = object(parseExactJson(content));
  check(!Object.hasOwn(envelope, 'Fault'), 'QBO_SOURCE_FAULT', 'A QuickBooks fault is not an accounting data page.');
  const response = object(envelope.QueryResponse, 'QBO_QUERY_RESPONSE_REQUIRED');
  check(QUICKBOOKS_ENTITIES.every(entity => entity === profile.entity || !Object.hasOwn(response, entity)), 'QBO_ENTITY_MISMATCH', 'The query response must match the configured entity.');
  const values = response[profile.entity] === undefined ? [] : array(response[profile.entity]);
  const startPosition = profile.startPosition ?? 1, pageSize = profile.pageSize ?? 100;
  check(values.length <= pageSize, 'QBO_PAGE_SIZE_EXCEEDED', 'The returned page exceeds the requested entity limit.');
  if (response.startPosition !== undefined) check(integer(response.startPosition, 1, 1_000_000_000) === startPosition, 'QBO_PAGE_POSITION_MISMATCH', 'The returned page position does not match the request.');
  if (response.maxResults !== undefined) check(integer(response.maxResults, 0, 1000) === values.length, 'QBO_PAGE_COUNT_MISMATCH', 'The returned count must match the actual entities.');
  // totalCount is documented for SELECT COUNT(*), which returns no data entities.
  // It is neither this page's count nor an independent reconciliation report.
  check(!Object.hasOwn(response, 'totalCount'), 'QBO_COUNT_RESPONSE_UNSUPPORTED', 'Count queries need a separate report evidence route.');
  const records = values.map(value => parseRecord(value, profile.entity));
  return { records, continuation: values.length === pageSize ? { kind: 'more', next: { kind: 'offset', offset: startPosition + values.length } } : { kind: 'complete' },
    totalRows: null, sourceGeneratedAtMs: null, snapshotId: null,
    warnings: ['QBO_QUERY_PAGINATION_NOT_COMPANY_COMPLETENESS', 'QBO_SOURCE_SNAPSHOT_UNVERIFIED'] };
}

/** Descriptor for the reviewed parser route; it includes the explicit requested minor version. */
export function quickBooksParserDescriptorHash(profile: Pick<QuickBooksPageProfile, 'entity' | 'minorVersion'>): string {
  return sha256(JSON.stringify({ adapter: 'qbo-v3-query-json-v1', entity: profile.entity, minorVersion: profile.minorVersion }));
}
export const quickBooksSchemaFingerprint = (content: string): string => wireSchemaFingerprint(content);
function startPosition(cursor: ReadCursor | null): number {
  if (cursor === null) return 1;
  check(cursor.kind === 'offset', 'QBO_CURSOR_INVALID', 'QuickBooks queries use one-based positional continuations.');
  return integer(cursor.offset, 1, 1_000_000_000);
}
/** No network or credential provider exists by default. Host resolves opaque references. */
export function createQuickBooksReadAdapter(config: QuickBooksReadConfig): ApiReadAdapter {
  profileCheck(config);
  check(config.startPosition === undefined || config.startPosition === 1, 'QBO_INITIAL_POSITION_INVALID', 'The dispatcher cursor owns subsequent page positions.');
  const { transport } = config, profile = { entity: config.entity, realmId: config.realmId, minorVersion: config.minorVersion, pageSize: config.pageSize ?? 100 };
  const operation = structuredClone(config.operation), environment = config.environment, companyId = config.companyId ?? config.realmId;
  const dataset = config.dataset ?? `qbo-${profile.entity.toLowerCase()}`;
  const period = config.period ? structuredClone(config.period) : null;
  check(connectorOperationKey(operation) === connectorOperationKey(quickBooksOperation(config, 'read')),
    'QBO_OPERATION_PROFILE_MISMATCH', 'Read qualification must bind the exact QuickBooks entity and execution profile.');
  Object.freeze(operation.applicability); Object.freeze(operation);
  const adapter: ApiReadAdapter = { operation, environment, mode: 'api', sideEffects: 'none', retrySafety: 'idempotent-read', retryOwner: 'dispatcher',
    requiredAuthScopes: Object.freeze(['com.intuit.quickbooks.accounting']), pagination: Object.freeze({ kind: 'offset' }),
    async readPage(request, context) {
      assertCompany(request, companyId);
      check(request.dataScope?.dataset === dataset && request.dataScope.branches.length === 1 && request.dataScope.branches[0] === 'all',
        'QBO_DATA_SCOPE_UNSUPPORTED', 'This route binds one exact entity dataset and the all-company branch domain.');
      check(JSON.stringify(request.dataScope.period ?? null) === JSON.stringify(period), 'QBO_PERIOD_PROFILE_MISMATCH', 'The read period must match the qualified execution profile.');
      check(context.retryOwner === 'dispatcher' && !context.signal.aborted, 'QBO_READ_CONTEXT_INVALID', 'The dispatcher owns bounded attempts and cancellation.');
      const position = startPosition(request.cursor);
      // Period filters apply to transaction posting dates. Accounts have no TxnDate.
      check(profile.entity !== 'Account' || !request.dataScope?.period, 'QBO_ACCOUNT_PERIOD_UNSUPPORTED', 'Account master queries cannot claim posting-date period filtering.');
      if (period) { date(period.from); date(period.to); check(period.from <= period.to, 'QBO_PERIOD_INVALID', 'The posting-date period is reversed.'); }
      const filters: string[] = [];
      if (profile.entity === 'Account') filters.push('Active IN (true, false)');
      if (period) filters.push(`TxnDate >= '${period.from}' AND TxnDate <= '${period.to}'`);
      const query = `SELECT * FROM ${profile.entity}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} STARTPOSITION ${position} MAXRESULTS ${profile.pageSize}`;
      const host = environment === 'live' ? 'quickbooks.api.intuit.com' : 'sandbox-quickbooks.api.intuit.com';
      const url = `https://${host}/v3/company/${profile.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${profile.minorVersion}`;
      const response = await transport({ method: 'GET', url, headers: { Accept: 'application/json' } }, context);
      const decoded = parseResponse(response, url, context, content => ({ page: parseQuickBooksPage(content, { ...profile, startPosition: position }), fingerprint: quickBooksSchemaFingerprint(content) }));
      const page = decoded.page;
      return { content: response.content, contentType: response.contentType, schemaFingerprint: decoded.fingerprint,
        rowCount: page.records.length, continuation: page.continuation,
        source: { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null } };
    } };
  return Object.freeze(adapter);
}

type DecimalParts = { value: bigint; scale: number };
function parts(value: string): DecimalParts {
  const [whole, fraction = ''] = value.split('.'); return { value: BigInt(whole + fraction), scale: fraction.length };
}
function decimalSum(values: string[]): string {
  const terms = values.map(parts), scale = Math.max(0, ...terms.map(term => term.scale));
  const amount = terms.reduce((sum, term) => sum + term.value * 10n ** BigInt(scale - term.scale), 0n);
  const sign = amount < 0n ? '-' : '', digits = (amount < 0n ? -amount : amount).toString().padStart(scale + 1, '0');
  return scale === 0 ? sign + digits : sign + digits.slice(0, -scale) + '.' + digits.slice(-scale);
}
const negate = (value: string): string => value.startsWith('-') ? value.slice(1) : `-${value}`;
export type QuickBooksDocumentReconciliation = {
  status: 'matched' | 'mismatch' | 'unavailable'; sourceTotal: string | null; computedTotal: string | null; difference: string | null; reasons: string[];
};
/** Local document consistency only. Never substitutes for the independent source report. */
export function reconcileQuickBooksDocument(record: AccountingRecord): QuickBooksDocumentReconciliation {
  const unavailable = (reason: string): QuickBooksDocumentReconciliation => ({ status: 'unavailable', sourceTotal: record.total, computedTotal: null, difference: null, reasons: [reason] });
  if (!['invoice', 'credit-note', 'refund'].includes(record.kind)) return unavailable('QBO_TRANSACTION_LINE_RECONCILIATION_UNSUPPORTED');
  if (record.total === null) return unavailable('QBO_SOURCE_TOTAL_UNAVAILABLE');
  if (record.status === 'void') return unavailable('QBO_VOID_POSTING_REQUIRES_SOURCE_REVIEW');
  if (record.warnings.includes('QBO_LINE_DETAIL_UNSUPPORTED')) return unavailable('QBO_LINE_DETAIL_UNSUPPORTED');
  const calculation = text(record.source.GlobalTaxCalculation);
  if (calculation !== 'TaxExcluded' && calculation !== 'NotApplicable') return unavailable('QBO_TAX_CALCULATION_PROFILE_UNQUALIFIED');
  const values: string[] = [];
  for (const line of record.lines) {
    const detailType = text(line.source.DetailType);
    if (detailType === 'SalesItemLineDetail' && line.amount !== null) values.push(line.amount);
    else if (detailType === 'DiscountLineDetail') {
      if (line.amount === null || line.amount.startsWith('-')) return unavailable('QBO_DISCOUNT_SIGN_UNQUALIFIED');
      values.push(negate(line.amount));
    } else if (detailType === 'SalesItemLineDetail' && reference(object(line.source.SalesItemLineDetail).ItemRef)) return unavailable('QBO_LINE_AMOUNT_UNAVAILABLE');
  }
  if (!record.lines.length) return unavailable('QBO_LINES_UNAVAILABLE');
  if (calculation === 'TaxExcluded') {
    if (record.taxTotal === null) return unavailable('QBO_TAX_TOTAL_UNAVAILABLE');
    values.push(record.taxTotal);
  } else if (record.taxTotal !== null && parts(record.taxTotal).value !== 0n) return unavailable('QBO_TAX_MODE_TOTAL_CONFLICT');
  const computedTotal = decimalSum(values), difference = decimalSum([computedTotal, negate(record.total)]);
  return { status: parts(difference).value === 0n ? 'matched' : 'mismatch', sourceTotal: record.total, computedTotal, difference,
    reasons: parts(difference).value === 0n ? [] : ['QBO_DOCUMENT_TOTAL_MISMATCH'] };
}
