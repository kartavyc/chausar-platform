import type { ApiReadSpec } from '../adapters/read-kit.ts';
import { cashfreeReadSpec, payuReadSpec, razorpayPaymentsReadSpec, razorpaySettlementReconReadSpec, razorpaySettlementsReadSpec, stripeReadSpec } from '../adapters/payments/index.ts';
import { shopifyReadSpec, woocommerceReadSpec } from '../adapters/commerce/index.ts';
import { googleCalendarEventsSpec, googleDriveFilesSpec, googleSheetsValuesSpec } from '../adapters/google/index.ts';
import { hubspotDealsSpec, zohoCrmDealsSpec } from '../adapters/crm/index.ts';
import { tallyPurchaseRegisterSpec, tallySalesRegisterSpec } from '../adapters/accounting/tally-registers.ts';
import { quickBooksInvoicesSpec, xeroInvoicesSpec, zohoBooksInvoicesSpec } from '../adapters/accounting/books-api.ts';

/**
 * Read operations reachable through a connected system's own interface. Each binds an adapter
 * description to the recipe that maps its records and checks them against the source's totals.
 * `settings` are the connection's non-secret settings; `parameters` are per-read choices such as a
 * settlement id. Credentials are never either.
 */
export type ReadBinding = {
  group: string; id: string; label: string; recipe: string; settings: readonly string[]; parameters: readonly string[];
  spec: ApiReadSpec<any>; config(settings: Readonly<Record<string, string>>, parameters?: Readonly<Record<string, string>>): unknown;
  /** False when the adapter refuses live reads by design until a missing piece exists. */
  live: boolean; limitation: string;
};
const none = () => ({});
/** Tally registers read the ledgers the person classified, listed as one setting separated by "|". */
const tally = (s: Readonly<Record<string, string>>) => ({ ...(s.endpoint ? { endpoint: s.endpoint } : {}), company: s.company, baseCurrency: s.baseCurrency ?? 'INR', ledgers: (s.ledgers ?? '').split('|').map(item => item.trim()).filter(Boolean) });
const currency = (s: Readonly<Record<string, string>>) => s.orgCurrency ? { orgCurrency: s.orgCurrency } : {};
export const READS: readonly ReadBinding[] = [
  { group: 'razorpay', id: 'payments', label: 'Payments for a period', recipe: 'razorpay.payments', settings: [], parameters: [], spec: razorpayPaymentsReadSpec, config: none, live: true, limitation: 'The person enters the total from Razorpay\'s report. Captured payments are not net revenue.' },
  { group: 'razorpay', id: 'settlements', label: 'Settlements for a period', recipe: 'razorpay.settlements', settings: [], parameters: [], spec: razorpaySettlementsReadSpec, config: none, live: true, limitation: 'The person enters the total from Razorpay\'s report.' },
  { group: 'razorpay', id: 'settlement-recon', label: 'One settlement, item by item', recipe: 'razorpay.settlement-recon', settings: [], parameters: ['settlementId'], spec: razorpaySettlementReconReadSpec, config: (_s, p = {}) => ({ settlementId: p.settlementId }), live: true, limitation: 'Checked against the settlement\'s own amount.' },
  { group: 'stripe', id: 'payout-reconciliation', label: 'One payout, transaction by transaction', recipe: 'stripe.payout-reconciliation', settings: [], parameters: ['payoutId'], spec: stripeReadSpec, config: (_s, p = {}) => ({ payoutId: p.payoutId }), live: true, limitation: 'Automatic payouts only; checked against the payout amount.' },
  { group: 'cashfree', id: 'settlements', label: 'Settlements', recipe: 'cashfree.settlements', settings: ['environment'], parameters: [], spec: cashfreeReadSpec, config: s => ({ environment: s.environment ?? 'production' }), live: false, limitation: 'Live reads need header-key sign-in, which is not built yet. The parser runs on recorded responses only.' },
  { group: 'payu', id: 'settlement-details', label: 'Settlement details for a day', recipe: 'payu.settlement-details', settings: ['environment'], parameters: ['settlementDate'], spec: payuReadSpec, config: (s, p = {}) => ({ environment: s.environment ?? 'production', settlementDate: p.settlementDate }), live: false, limitation: 'PayU signed requests are not built yet.' },
  { group: 'shopify', id: 'orders', label: 'Orders for a period', recipe: 'shopify.orders', settings: ['shop'], parameters: [], spec: shopifyReadSpec, config: s => ({ shop: s.shop }), live: true, limitation: 'Order count is checked; the amount waits for the report total. Orders are billed claims.' },
  { group: 'woocommerce', id: 'orders', label: 'Orders for a period', recipe: 'woocommerce.orders', settings: ['site'], parameters: [], spec: woocommerceReadSpec, config: s => ({ site: s.site }), live: true, limitation: 'Order count is checked; the amount waits for the report total.' },
  { group: 'tally', id: 'sales-register', label: 'Sales Register through Tally\'s XML interface', recipe: 'tally.sales-register', settings: ['endpoint', 'company', 'baseCurrency', 'ledgers'], parameters: [], spec: tallySalesRegisterSpec, config: tally, live: true, limitation: 'This computer only. Checked against Tally\'s own Sales Accounts movement; credit notes and journals in the period need the report total instead.' },
  { group: 'tally', id: 'purchase-register', label: 'Purchase Register through Tally\'s XML interface', recipe: 'tally.purchase-register', settings: ['endpoint', 'company', 'baseCurrency', 'ledgers'], parameters: [], spec: tallyPurchaseRegisterSpec, config: tally, live: true, limitation: 'This computer only. Checked against Tally\'s own Purchase Accounts movement.' },
  { group: 'zoho-books', id: 'invoices', label: 'Invoices (gross)', recipe: 'zoho-books.invoices.gross', settings: ['dataCenter', 'organizationId'], parameters: [], spec: zohoBooksInvoicesSpec, config: s => ({ dataCenter: s.dataCenter, organizationId: s.organizationId }), live: true, limitation: 'The list carries gross totals only; net needs a per-invoice read not built yet. The person enters the report total.' },
  { group: 'xero', id: 'invoices', label: 'Sales invoices', recipe: 'xero.invoices.net', settings: ['tenantId'], parameters: [], spec: xeroInvoicesSpec, config: s => ({ tenantId: s.tenantId }), live: true, limitation: 'The person enters the report total; the invoice count is checked.' },
  { group: 'quickbooks', id: 'invoices', label: 'Invoices (gross)', recipe: 'quickbooks.invoices.gross', settings: ['realmId', 'environment'], parameters: [], spec: quickBooksInvoicesSpec, config: s => ({ realmId: s.realmId, environment: s.environment ?? 'production' }), live: true, limitation: 'Gross only. The person enters the report total; the invoice count is checked.' },
  { group: 'google-workspace', id: 'sheets', label: 'A Google Sheet you picked', recipe: 'google-sheets.canonical', settings: [], parameters: ['spreadsheetId', 'range'], spec: googleSheetsValuesSpec, config: (_s, p = {}) => ({ spreadsheetId: p.spreadsheetId, range: p.range }), live: true, limitation: 'drive.file scope: only sheets you picked. Checked against the sheet\'s Total row.' },
  { group: 'google-workspace', id: 'drive', label: 'Files you picked in Drive', recipe: 'google-drive.files', settings: [], parameters: [], spec: googleDriveFilesSpec, config: none, live: true, limitation: 'drive.file scope. A file list; read a CSV file\'s content through its recipe.' },
  { group: 'google-workspace', id: 'calendar', label: 'Calendar events', recipe: 'google-calendar.events', settings: [], parameters: ['calendarId'], spec: googleCalendarEventsSpec, config: (_s, p = {}) => ({ calendarId: p.calendarId ?? 'primary' }), live: false, limitation: 'calendar.readonly needs Google\'s app verification before it can be offered.' },
  { group: 'zoho-crm', id: 'deals', label: 'Deals', recipe: 'zoho-crm.deals', settings: ['dataCenter', 'orgCurrency'], parameters: [], spec: zohoCrmDealsSpec, config: s => ({ dataCenter: s.dataCenter, ...currency(s) }), live: true, limitation: 'A won deal is not a sale. Every deal is read; the person enters the report total.' },
  { group: 'hubspot', id: 'deals', label: 'Deals closing in a period', recipe: 'hubspot.deals', settings: ['orgCurrency'], parameters: [], spec: hubspotDealsSpec, config: currency, live: true, limitation: 'A won deal is not a sale. At most 10,000 deals per read.' },
];
export const readsFor = (group: string) => READS.filter(item => item.group === group);
