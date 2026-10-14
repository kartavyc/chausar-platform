import { check } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import type { AccountingRecord } from './common.ts';
import { parseZohoPage, ZOHO_READ_SCOPES } from './zoho.ts';
import { parseXeroPage } from './xero.ts';
import { parseQuickBooksPage } from './quickbooks.ts';
import { checkPeriod, optionalCurrency, parseSourceJson, scalarText, sourceObject, strictConfig } from '../google/common.ts';

/**
 * Thin read-kit wrappers over the existing accounting parsers, for invoice lists only. The parsers
 * stay the source of truth for field meaning; these specs add the request, paging and declared count.
 *
 * Net and gross. Every record carries netAmount (the tax-exclusive subtotal, where the source states
 * one) and grossAmount (the document total including tax). Gross billing is never net revenue: the
 * '.net' recipes measure netAmount and refuse a record without it; the '.gross' recipes say plainly
 * that they measure tax-inclusive billing.
 *  - Zoho Books: sub_total is in invoice detail, not in the list response, so a list read leaves
 *    netAmount empty and the net recipe refuses it; the gross recipe reads total.
 *  - Xero: SubTotal is in the list response (exclusive of tax for every LineAmountTypes).
 *  - QuickBooks: the parser exposes TotalAmt (tax-inclusive) and TotalTax only, no subtotal; only the
 *    gross recipe applies. Nothing here subtracts tax from a total.
 */
export type BooksInvoiceRecord = {
  id: string; number: string; date: string; currency: string; netAmount: string; grossAmount: string; taxAmount: string;
  status: string; sourceStatus: string; direction: string; customerName: string;
};
function invoiceRecord(record: AccountingRecord, number: unknown, customer: unknown, fallbackCurrency?: string): BooksInvoiceRecord {
  return { id: record.id, number: scalarText(number), date: record.date ?? '', currency: record.currency ?? fallbackCurrency ?? '',
    netAmount: record.subtotal ?? '', grossAmount: record.total ?? '', taxAmount: record.taxTotal ?? '', status: record.status,
    sourceStatus: record.sourceStatus ?? '', direction: record.direction, customerName: scalarText(customer) };
}
const pageOf = (url: string, name: string, min = 1): number => {
  const value = new URL(url).searchParams.get(name) ?? '';
  check(/^\d{1,9}$/.test(value) && Number(value) >= min, 'READ_REQUEST_INVALID', 'The page request is not one this adapter made.');
  return Number(value);
};
const totalCount = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const text = scalarText(value); check(/^\d{1,9}$/.test(text), 'SOURCE_TOTAL_INVALID', 'The system stated an unusable record count.'); return Number(text);
};

// ---------------------------------------------------------------- Zoho Books
export type ZohoBooksDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca';
export const ZOHO_BOOKS_DATA_CENTERS: readonly ZohoBooksDataCenter[] = Object.freeze(['com', 'eu', 'in', 'com.au', 'jp', 'ca']);
export type ZohoBooksInvoicesConfig = { dataCenter: ZohoBooksDataCenter; organizationId: string };
export function zohoBooksInvoicesUrl(config: ZohoBooksInvoicesConfig, page: number, period: { from: string; to: string } | null): string {
  let url = `https://www.zohoapis.${config.dataCenter}/books/v3/invoices?organization_id=${config.organizationId}&page=${page}&per_page=200`;
  if (period) url += `&date_start=${period.from}&date_end=${period.to}`;
  return url;
}
/** page_context.has_more_page drives paging; page_context.total, when Zoho states it, is the declared count. */
export const zohoBooksInvoicesSpec: ApiReadSpec<ZohoBooksInvoicesConfig> = Object.freeze({
  system: 'zoho-books', operation: 'invoices', version: '1',
  scopes: Object.freeze([ZOHO_READ_SCOPES.invoices]), auth: 'zoho',
  origins: config => [`https://www.zohoapis.${config.dataCenter}`],
  validate(config: ZohoBooksInvoicesConfig) {
    strictConfig(config, ['dataCenter', 'organizationId'], ['dataCenter', 'organizationId']);
    check(ZOHO_BOOKS_DATA_CENTERS.includes(config.dataCenter), 'CONFIG_INVALID', 'Choose the Zoho data center the organization lives in.');
    check(typeof config.organizationId === 'string' && /^\d{1,30}$/.test(config.organizationId), 'CONFIG_INVALID', 'The Zoho Books organization id is a number.');
    return config;
  },
  first: (config, period) => ({ method: 'GET', url: zohoBooksInvoicesUrl(config, 1, checkPeriod(period, false)) }),
  parse(body, _response, config, request): ParsedPage {
    const page = pageOf(request.url, 'page'), parsed = parseZohoPage(body, { resource: 'invoices', organizationId: config.organizationId, expectedPage: page });
    const raw = parseSourceJson(body), context = sourceObject(raw.page_context), sources = raw.invoices as Record<string, unknown>[];
    const records = parsed.records.map((record, i) => invoiceRecord(record, sources[i].invoice_number, sources[i].customer_name));
    const url = new URL(request.url), from = url.searchParams.get('date_start'), to = url.searchParams.get('date_end');
    const next: ReadRequest | null = parsed.continuation.kind === 'more' ? { method: 'GET', url: zohoBooksInvoicesUrl(config, page + 1, from && to ? { from, to } : null) } : null;
    const total = totalCount(context.total);
    return { records, next, declared: total === null ? null : { rowCount: total, reference: 'zoho-books-page-context-total' } };
  },
});

// ---------------------------------------------------------------- Xero
export type XeroInvoicesConfig = { tenantId: string };
const XERO = 'https://api.xero.com';
export const XERO_INVOICES_SCOPE = 'accounting.invoices.read';
export function xeroInvoicesUrl(page: number, period: { from: string; to: string } | null): string {
  const dt = (day: string) => `DateTime(${day.slice(0, 4)},${day.slice(5, 7)},${day.slice(8, 10)})`;
  const where = `Type=="ACCREC"${period ? `&&Date>=${dt(period.from)}&&Date<=${dt(period.to)}` : ''}`;
  return `${XERO}/api.xro/2.0/Invoices?page=${page}&pageSize=100&where=${encodeURIComponent(where)}`;
}
/** Sales invoices only (Type ACCREC; bills are left to a separate read). xero-tenant-id names the organisation; it is not a credential. */
export const xeroInvoicesSpec: ApiReadSpec<XeroInvoicesConfig> = Object.freeze({
  system: 'xero', operation: 'invoices', version: '1',
  scopes: Object.freeze([XERO_INVOICES_SCOPE]), auth: 'bearer',
  origins: () => [XERO],
  validate(config: XeroInvoicesConfig) {
    strictConfig(config, ['tenantId'], ['tenantId']);
    check(typeof config.tenantId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.tenantId), 'CONFIG_INVALID', 'The Xero tenant id is a UUID.');
    return config;
  },
  first: (config, period) => ({ method: 'GET', url: xeroInvoicesUrl(1, checkPeriod(period, false)), headers: { 'xero-tenant-id': config.tenantId } }),
  parse(body, _response, config, request): ParsedPage {
    const page = pageOf(request.url, 'page'), parsed = parseXeroPage(body, { resource: 'invoices', page, pageSize: 100 });
    const records = parsed.records.map(record => invoiceRecord(record, record.source.InvoiceNumber, record.source.Contact === undefined ? '' : sourceObject(record.source.Contact).Name));
    check(parsed.records.every(record => record.sourceType === 'ACCREC'), 'SOURCE_SHAPE_INVALID', 'The system returned documents of another type.');
    const where = new URL(request.url).searchParams.get('where') ?? '';
    const next: ReadRequest | null = parsed.continuation.kind === 'more'
      ? { method: 'GET', url: `${XERO}/api.xro/2.0/Invoices?page=${page + 1}&pageSize=100&where=${encodeURIComponent(where)}`, headers: { 'xero-tenant-id': config.tenantId } } : null;
    return { records, next, declared: parsed.totalRows === null ? null : { rowCount: parsed.totalRows, reference: 'xero-pagination-item-count' } };
  },
});

// ---------------------------------------------------------------- QuickBooks Online
export type QuickBooksInvoicesConfig = {
  realmId: string; environment: 'production' | 'sandbox';
  /** The company's home currency, used only when an invoice has no CurrencyRef (multicurrency off). */
  homeCurrency?: string;
};
export const QUICKBOOKS_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';
export const QUICKBOOKS_MINOR_VERSION = '75';
const qboOrigin = (config: QuickBooksInvoicesConfig) => config.environment === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
const qboWhere = (period: { from: string; to: string } | null) => period ? ` where TxnDate >= '${period.from}' and TxnDate <= '${period.to}'` : '';
export function quickBooksQueryUrl(config: QuickBooksInvoicesConfig, query: string): string {
  return `${qboOrigin(config)}/v3/company/${config.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QUICKBOOKS_MINOR_VERSION}`;
}
export const quickBooksInvoicePageQuery = (period: { from: string; to: string } | null, start: number) => `select * from Invoice${qboWhere(period)} STARTPOSITION ${start} MAXRESULTS 100`;
export const quickBooksInvoiceCountQuery = (period: { from: string; to: string } | null) => `select count(*) from Invoice${qboWhere(period)}`;
const QUERY = /^select (\*|count\(\*\)) from Invoice(?: where TxnDate >= '(\d{4}-\d{2}-\d{2})' and TxnDate <= '(\d{4}-\d{2}-\d{2})')?(?: STARTPOSITION (\d{1,9}) MAXRESULTS 100)?$/;
/**
 * Invoice pages by STARTPOSITION (one based). After the last, short page the read asks
 * `select count(*) from Invoice` (same filter); its totalCount is the declared count. When the last
 * data page is exactly full the next page is empty and no count can follow it (the read kit allows
 * no request after an empty page); the read then ends without a declared count.
 */
export const quickBooksInvoicesSpec: ApiReadSpec<QuickBooksInvoicesConfig> = Object.freeze({
  system: 'quickbooks', operation: 'invoices', version: '1',
  scopes: Object.freeze([QUICKBOOKS_ACCOUNTING_SCOPE]), auth: 'bearer',
  origins: config => [qboOrigin(config)],
  validate(config: QuickBooksInvoicesConfig) {
    strictConfig(config, ['realmId', 'environment', 'homeCurrency'], ['realmId', 'environment']);
    check(typeof config.realmId === 'string' && /^\d{1,30}$/.test(config.realmId), 'CONFIG_INVALID', 'The QuickBooks company (realm) id is a number.');
    check(config.environment === 'production' || config.environment === 'sandbox', 'CONFIG_INVALID', 'Choose production or sandbox.');
    optionalCurrency(config.homeCurrency);
    return config;
  },
  first: (config, period) => ({ method: 'GET', url: quickBooksQueryUrl(config, quickBooksInvoicePageQuery(checkPeriod(period, false), 1)) }),
  parse(body, _response, config, request): ParsedPage {
    const match = QUERY.exec(new URL(request.url).searchParams.get('query') ?? '');
    check(match, 'READ_REQUEST_INVALID', 'The page request is not one this adapter made.');
    const period = match![2] ? { from: match![2], to: match![3] } : null;
    if (match![1] === 'count(*)') {
      const root = parseSourceJson(body);
      check(root.Fault === undefined, 'QBO_SOURCE_FAULT', 'QuickBooks reported a fault.');
      const count = totalCount(sourceObject(root.QueryResponse).totalCount);
      check(count !== null, 'SOURCE_TOTAL_INVALID', 'The system stated an unusable record count.');
      return { records: [], next: null, declared: { rowCount: count, reference: 'quickbooks-count-query' } };
    }
    const start = Number(match![4]);
    const parsed = parseQuickBooksPage(body, { entity: 'Invoice', realmId: config.realmId, minorVersion: QUICKBOOKS_MINOR_VERSION, startPosition: start, pageSize: 100 });
    const records = parsed.records.map(record => invoiceRecord(record, record.source.DocNumber, record.source.CustomerRef === undefined ? '' : sourceObject(record.source.CustomerRef).name, config.homeCurrency));
    let next: ReadRequest | null = null;
    if (parsed.continuation.kind === 'more') next = { method: 'GET', url: quickBooksQueryUrl(config, quickBooksInvoicePageQuery(period, start + records.length)) };
    else if (records.length > 0) next = { method: 'GET', url: quickBooksQueryUrl(config, quickBooksInvoiceCountQuery(period)) };
    return { records, next };
  },
});
