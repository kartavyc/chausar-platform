import { check } from '../../contracts.ts';
import { cellsOf, gridFromRows, locateTable, norm, parseDelimited, type GridLine } from '../tabular.ts';
import { headerGroups } from '../decoders.ts';
import type { Decoder, SourceRecipe } from '../recipe.ts';
import type { DecodedTable, RawRow } from '../types.ts';
import { UNCONFIRMED, checkedAgainst } from './operations.ts';

/**
 * Marketplace payouts: Amazon Seller Central (settlement flat file V2), Flipkart Seller Hub
 * (settled transactions, Orders sheet) and Meesho (payments, Order Payments sheet).
 * Settlement amounts are net of marketplace fees; a payout is not a sale.
 */

export const ENTRY_TYPE_HEADING = 'Entry Type';
export const ENTRY_KEY_HEADING = 'Entry Key';
const SUMMARY_COLUMNS = ['settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency'] as const;
const KEY_COLUMNS = ['transaction-type', 'order-id', 'adjustment-id', 'shipment-id', 'order-item-code', 'merchant-adjustment-item-id', 'amount-type', 'amount-description', 'posted-date-time', 'sku'] as const;

/**
 * Amazon settlement flat file V2 (tab separated). The first data row is the settlement summary:
 * it carries settlement-id, the period, deposit-date, total-amount and currency and no entry
 * amount. That row becomes the declared total; every following row is one entry. The decoder adds
 * two columns: "Entry Type" (transaction-type / amount-type, for the recipe's kind map) and
 * "Entry Key" (the source's own identifying columns joined, so one settlement line is one record).
 * It never adds or rounds amounts.
 */
export const amazonSettlementV2Decoder: Decoder = {
  id: 'amazon-settlement-v2', version: '1', accepts: 'text',
  decode(input, recipe): DecodedTable {
    check(typeof input.text === 'string', 'TEXT_REQUIRED', 'This recipe reads a text export.');
    const table = locateTable(parseDelimited(input.text!, '\t'), headerGroups(recipe));
    const lower = new Map(table.headers.map(h => [norm(h), h]));
    for (const name of ['settlement-id', 'amount', 'transaction-type', 'amount-type', ...SUMMARY_COLUMNS])
      check(lower.has(name), 'REQUIRED_COLUMN_MISSING', 'A column this recipe needs is missing. The export may be from another report or version.');
    check(!lower.has(norm(ENTRY_TYPE_HEADING)) && !lower.has(norm(ENTRY_KEY_HEADING)), 'INVALID_HEADERS', 'The export already has a column with a reserved heading.');
    const col = (name: string) => lower.get(name)!;
    const rows: RawRow[] = table.body.map(row => ({ line: row.line, cells: cellsOf(table.headers, row.cells) }));
    check(rows.length > 0, 'EMPTY_SOURCE', 'The file has no rows to import.');
    const isSummary = (row: RawRow) => row.cells[col('total-amount')] !== '' && row.cells[col('amount')] === '' && row.cells[col('transaction-type')] === '';
    const first = rows[0];
    const meta: Record<string, string> = { ...(input.meta ?? {}) };
    let declared: DecodedTable['declared'] = null, entries = rows;
    if (isSummary(first)) {
      const settlementId = first.cells[col('settlement-id')];
      check(/^[0-9A-Za-z-]{1,40}$/.test(settlementId), 'SETTLEMENT_ID_INVALID', 'The settlement summary row has no usable settlement id.');
      check(first.cells[col('currency')].toUpperCase() === 'INR', 'CURRENCY_UNSUPPORTED', 'This recipe reads Amazon India settlements in rupees only.');
      declared = { rowCount: null, amount: first.cells[col('total-amount')], amountUnit: 'major', reference: 'settlement-total-amount' };
      meta.settlementId = settlementId;
      meta.settlementStart = first.cells[col('settlement-start-date')];
      meta.settlementEnd = first.cells[col('settlement-end-date')];
      meta.depositDate = first.cells[col('deposit-date')];
      entries = rows.slice(1);
      for (const row of entries) check(row.cells[col('settlement-id')] === settlementId, 'SETTLEMENT_MIXED', 'The file holds lines from more than one settlement. Import each settlement on its own.');
    }
    for (const row of entries) {
      check(row.cells[col('total-amount')] === '', 'SETTLEMENT_MIXED', 'The file holds more than one settlement summary. Import each settlement on its own.');
      const type = row.cells[col('transaction-type')], amountType = row.cells[col('amount-type')];
      row.cells[ENTRY_TYPE_HEADING] = type && amountType ? `${type} / ${amountType}` : '';
      row.cells[ENTRY_KEY_HEADING] = KEY_COLUMNS.map(name => lower.has(name) ? row.cells[col(name)] : '').join('|');
    }
    return { headers: [...table.headers, ENTRY_TYPE_HEADING, ENTRY_KEY_HEADING], rows: entries, footers: [], declared, meta };
  },
};

const amazonSettlement: SourceRecipe = {
  id: 'amazon-seller.settlement-v2', version: '1', group: 'amazon-seller', operation: 'settlement', title: 'Amazon Seller Central settlement report (flat file V2)', decoder: 'amazon-settlement-v2',
  header: [['settlement-id'], ['total-amount'], ['transaction-type'], ['amount-type'], ['amount']],
  fields: {
    settlementId: { from: ['settlement-id'], type: 'text', required: true },
    transactionType: { from: ['transaction-type'], type: 'text', required: true },
    amountType: { from: ['amount-type'], type: 'text', required: true },
    amountDescription: { from: ['amount-description'], type: 'text' },
    amount: { from: ['amount'], type: 'money', required: true },
    date: { from: ['posted-date'], type: 'date', required: true, dateFormats: ['DMY', 'ISO', 'ISO-DATETIME'] },
    orderId: { from: ['order-id'], type: 'text' },
    marketplaceName: { from: ['marketplace-name'], type: 'text' },
    sku: { from: ['sku'], type: 'text' },
    quantity: { from: ['quantity-purchased'], type: 'integer' },
    entryType: { from: [ENTRY_TYPE_HEADING], type: 'text' },
    entryKey: { from: [ENTRY_KEY_HEADING], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['settlementId', 'entryKey'],
  kind: { field: 'entryType', values: {
    'Order / ItemPrice': 'sale', 'Order / ItemFees': 'marketplace_fee', 'Order / Promotion': 'discount', 'Order / ItemWithheldTax': 'tax_withheld',
    'Refund / ItemPrice': 'refund', 'Refund / ItemFees': 'marketplace_fee', 'Refund / Promotion': 'discount', 'Refund / ItemWithheldTax': 'tax_withheld',
    'other-transaction / other-transaction': 'marketplace_adjustment', 'ServiceFee / Cost of Advertising': 'advertising_cost',
    'Liquidations / ItemPrice': 'liquidation_proceeds', 'Liquidations / ItemFees': 'marketplace_fee',
  } },
  outputs: { orderId: 'orderId', sku: 'sku', description: 'amountDescription', marketplace: 'marketplaceName', costType: 'amountType', quantity: 'quantity' },
  totals: { kind: 'declared' },
  ignored: ['settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency', 'merchant-order-id', 'adjustment-id', 'shipment-id',
    'fulfillment-id', 'posted-date-time', 'order-item-code', 'merchant-order-item-id', 'merchant-adjustment-item-id', 'promotion-id'],
  notices: ['Settlement amounts are net of marketplace fees; the deposit is not the sales total.', 'Fees, promotions and tax withheld are negative entries inside the settlement.',
    'A refund line reverses money for an earlier order; it is not a new sale.', 'Reserve and other adjustments move money between settlements and are not income.',
    'Posted dates are written as YYYY-MM-DD or DD.MM.YYYY depending on the marketplace; both are read. The summary row also carries the currency.',
    checkedAgainst('https://github.com/guysolan/thetis/blob/19698c0e382b8364999a8072d7592e0e515289a3/services/amazon/supabase/functions/_shared/amazon/reports/23.10.2024/v2.txt')],
  sensitivity: 'financial',
};

const flipkartSettlement: SourceRecipe = {
  id: 'flipkart-seller.settled-orders', version: '1', group: 'flipkart-seller', operation: 'settlement', title: 'Flipkart Seller Hub settled transactions (Orders sheet)', decoder: 'worksheet',
  fields: {
    neftId: { from: ['NEFT ID', 'Settlement Ref No.', 'Settlement Ref No'], type: 'text', required: true },
    date: { from: ['Payment Date', 'Settlement Date'], type: 'date', required: true, dateFormats: ['ISO', 'DMY', 'ISO-DATETIME'] },
    settlement: { from: ['Bank Settlement Value (Rs.) = SUM(J:R)', 'Bank Settlement Value (Rs.)', 'Bank Settlement Value'], type: 'money', required: true },
    orderId: { from: ['Order ID'], type: 'text', required: true },
    orderItemId: { from: ['Order item ID'], type: 'text', required: true },
    orderType: { from: ['Order Type'], type: 'text' },
    sale: { from: ['Sale Amount (Rs.)', 'Sale Amount'], type: 'money' },
    fee: { from: ['Marketplace Fee (Rs.)', 'Marketplace Fee (Rs.) = SUM (V:AI)', 'Marketplace Fee (Rs.) = SUM(V:AI)', 'Marketplace Fee'], type: 'money' },
    taxes: { from: ['Taxes (Rs.)', 'Taxes'], type: 'money' },
    protection: { from: ['Protection Fund (Rs.)', 'Protection Fund'], type: 'money' },
    refund: { from: ['Refund (Rs.)', 'Refund'], type: 'money' },
    sku: { from: ['Seller SKU', 'SKU'], type: 'text' },
    quantity: { from: ['Quantity'], type: 'integer' },
  },
  measure: { type: 'money', amount: { field: 'settlement' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['neftId', 'orderItemId'],
  kind: { field: 'orderType', values: { '': 'marketplace_settlement', Prepaid: 'marketplace_settlement', Postpaid: 'marketplace_settlement', COD: 'marketplace_settlement' } },
  outputs: { orderId: 'orderId', sku: 'sku', feeMinor: 'fee', taxMinor: 'taxes', paymentMethod: 'orderType', quantity: 'quantity', bankReference: 'neftId' },
  totals: { kind: 'report' },
  notices: ['Settlement amounts are net of marketplace fees, taxes and refunds; the bank settlement value is not the sale amount.',
    'The Orders sheet states no total of its own; enter the bank settlement total from the Summary sheet or the payments page for the same period.',
    'A negative settlement value is money recovered by Flipkart, usually for a return.',
    'An Orders sheet without an Order Type column is read as settlement lines; headings with "= SUM(...)" formulas and line breaks are matched as written.',
    'Headings follow a third-party mirror of the Seller Hub payments workbook (github.com/jainsamarth07/sellerlens), not a published sample.', UNCONFIRMED],
  sensitivity: 'financial',
};

const meeshoPayments: SourceRecipe = {
  id: 'meesho.order-payments', version: '2', group: 'meesho', operation: 'settlement', title: 'Meesho payments report (Order Payments sheet)', decoder: 'meesho-order-payments',
  fields: {
    subOrderNo: { from: ['Sub Order No', 'Sub Order No.', 'Sub Order Number'], type: 'text', required: true },
    orderDate: { from: ['Order Date'], type: 'date', dateFormats: ['ISO', 'DMY', 'ISO-DATETIME'] },
    date: { from: ['Payment Date'], type: 'date', required: true, dateFormats: ['ISO', 'DMY', 'ISO-DATETIME'] },
    orderStatus: { from: ['Live Order Status', 'Order Status'], type: 'text', required: true },
    productName: { from: ['Product Name'], type: 'text' },
    sku: { from: ['Supplier SKU', 'SKU'], type: 'text' },
    quantity: { from: ['Quantity'], type: 'integer' },
    transactionId: { from: ['Transaction ID'], type: 'text', required: true },
    settlement: { from: ['Final Settlement Amount'], type: 'money', required: true },
    saleAmount: { from: ['Total Sale Amount (Incl. Shipping & GST)'], type: 'money' },
    commission: { from: ['Meesho Commission (Incl. GST)'], type: 'money' },
    shipping: { from: ['Shipping Charge (Incl. GST)'], type: 'money' },
    tcs: { from: ['TCS'], type: 'money' },
    tds: { from: ['TDS'], type: 'money' },
  },
  measure: { type: 'money', amount: { field: 'settlement' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['subOrderNo', 'transactionId'],
  kind: { field: 'orderStatus', values: { Delivered: 'sale_settlement', Shipped: 'sale_settlement', Return: 'return_settlement', RTO: 'rto_settlement', Exchange: 'exchange_settlement' } },
  outputs: { orderId: 'subOrderNo', sku: 'sku', description: 'productName', feeMinor: 'commission', shippingMinor: 'shipping', quantity: 'quantity', bankReference: 'transactionId' },
  totals: { kind: 'report' },
  ignored: ['Catalog ID', 'Order source', 'Revenue Details / Fixed Fee (Incl. GST)', 'Deductions / Fixed Fee (Incl. GST)', 'Warehousing fee (inc Gst)', 'Warehousing fee (Incl. GST)',
    'Return premium (incl GST)', 'Return premium (incl GST) of Return', 'Meesho Commission Percentage', 'Meesho gold platform fee (Incl. GST)', 'Meesho mall platform fee (Incl. GST)',
    'Return Shipping Charge (Incl. GST)', 'GST Compensation (PRP Shipping)', 'Other Support Service Charges (Excl. GST)', 'Waivers (Excl. GST)', 'Net Other Support Service Charges (Excl. GST)',
    'GST on Net Other Support Service Charges', 'TDS Rate %', 'Compensation', 'Claims', 'Recovery', 'Compensation Reason', 'Claims Reason', 'Recovery Reason'],
  notices: ['Settlement amounts are net of Meesho commission, shipping, TCS and TDS; the final settlement is not the sale amount.',
    'The sheet states no total of its own; enter the total paid shown on the Meesho payments page for the same period.',
    'A return or RTO line is usually money recovered for an earlier order.',
    'The sheet has a section row above the headings and a formula legend row below them; the legend row is not a record, and the repeated "Fixed Fee (Incl. GST)" headings are told apart by their section.',
    checkedAgainst('https://github.com/Divyansh-rl/monthlySummary/blob/6d18827a65a68fcea494f4b36bead882eb4ceab3/data_august.csv')],
  sensitivity: 'financial',
};

/** A legend cell under a Meesho heading: a column letter, a letter sum such as "(B + C + G)", or a formula "L = J + K". */
const LEGEND_CELL = /^(?:\(?[A-Z]{1,2}(?:\s*[-+*/]\s*[A-Z]{1,2})*\)?|.{0,200}\s=\s.{0,200})$/;
const sameText = (value: string) => value.normalize('NFKC').replace(/[ \s]+/g, ' ').trim();

/**
 * Meesho's Order Payments sheet: a section row ("Order Related Details", "Revenue Details",
 * "Deductions", ...) above the headings, the headings, then a legend row of column letters and
 * formulas. A heading that repeats ("Fixed Fee (Incl. GST)" under two sections) is qualified by its
 * section ("Deductions / Fixed Fee (Incl. GST)"); one that still repeats is refused. The legend row
 * is dropped only when it has no sub order number and at least three legend cells.
 */
export const meeshoPaymentsDecoder: Decoder = {
  id: 'meesho-order-payments', version: '1', accepts: 'rows',
  decode(input, recipe): DecodedTable {
    check(Array.isArray(input.rows), 'ROWS_REQUIRED', 'This recipe reads a worksheet.');
    const grid = gridFromRows(input.rows!), wanted = headerGroups(recipe).map(group => group.map(norm));
    const at = grid.findIndex(row => { const cells = new Set(row.cells.map(norm)); return wanted.every(group => group.some(alias => cells.has(alias))); });
    check(at >= 0 && at < 200, 'HEADER_NOT_FOUND', 'The column headings this recipe expects were not found. The export may be from another report or layout.');
    const heading = grid[at].cells.map(sameText), above = at > 0 ? grid[at - 1].cells.map(sameText) : [];
    let section = '';
    const sections = heading.map((_, i) => { if (above[i]) section = above[i]; return section; });
    const seen = new Map<string, number>();
    for (const h of heading) if (h) seen.set(norm(h), (seen.get(norm(h)) ?? 0) + 1);
    const named = heading.map((h, i) => h && (seen.get(norm(h)) ?? 0) > 1 && sections[i] ? `${sections[i]} / ${h}` : h);
    const lines: GridLine[] = [...grid.slice(0, at), { line: grid[at].line, cells: named }, ...grid.slice(at + 1)];
    const legend = lines[at + 1];
    if (legend && sameText(legend.cells[0] ?? '') === '' && legend.cells.filter(cell => sameText(cell) !== '' && LEGEND_CELL.test(sameText(cell))).length >= 3) lines.splice(at + 1, 1);
    const table = locateTable(lines, headerGroups(recipe));
    const rows: RawRow[] = table.body.map(row => ({ line: row.line, cells: cellsOf(table.headers, row.cells) }));
    return { headers: table.headers, rows, footers: [], declared: null, meta: { ...(input.meta ?? {}) } };
  },
};

export const RECIPES: readonly SourceRecipe[] = [amazonSettlement, flipkartSettlement, meeshoPayments];
export const DECODERS: readonly Decoder[] = [amazonSettlementV2Decoder, meeshoPaymentsDecoder];
