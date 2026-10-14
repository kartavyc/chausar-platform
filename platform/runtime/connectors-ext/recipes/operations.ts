import { check } from '../../contracts.ts';
import { headerGroups } from '../decoders.ts';
import { cellsOf, gridFromRows, locateTable, norm, parseDelimited, type Delimiter, type Grid } from '../tabular.ts';
import type { Decoder, SourceRecipe } from '../recipe.ts';
import type { DecodedTable, RawRow } from '../types.ts';

/**
 * Operations exports: couriers, order and inventory systems, payroll registers, billing and helpdesk.
 * Shared tabular decoder options live here so the marketing and work families reuse the same code.
 */
export type TabularOptions = {
  id: string;
  accepts?: 'text' | 'rows';
  delimiter?: Delimiter;
  /** Lines whose first cell starts with this text are source comments (GA4 writes "#" lines). */
  commentPrefix?: string;
  /** Rows labelled with the recipe's own total labels, or "Total: ...", are the source's totals wherever they sit. */
  totalsAnywhere?: boolean;
  /** Constant columns the engine adds to every body row. Their headings always start with "(added)". */
  added?: Readonly<Record<string, string>>;
  /** A value read from a title line above the table, added as a column (a register's month, a report's as-of date). */
  titleValue?: { pattern: RegExp; header: string };
};

const ADDED = /^\(added\) [a-z][a-z ]{1,60}$/;

export function labelColumn(recipe: SourceRecipe, headers: readonly string[]): string | null {
  if (recipe.totals.kind !== 'footer-row') return null;
  const spec = recipe.fields[recipe.totals.labelField];
  const aliases = new Set(spec.from.map(norm));
  return headers.find(header => aliases.has(norm(header))) ?? null;
}

export function splitTotals(recipe: SourceRecipe, headers: readonly string[], rows: RawRow[]): { body: RawRow[]; footers: RawRow[] } {
  const column = labelColumn(recipe, headers);
  if (!column || recipe.totals.kind !== 'footer-row') return { body: rows, footers: [] };
  const labels = new Set(recipe.totals.labels.map(norm));
  const body: RawRow[] = [], footers: RawRow[] = [];
  for (const row of rows) {
    const label = norm(row.cells[column] ?? '');
    (labels.has(label) || label.startsWith('total:') ? footers : body).push(row);
  }
  return { body, footers };
}

/** One bounded tabular decoder: delimited text or worksheet rows, with optional comment lines, totals rows and added columns. */
export function tabularDecoder(options: TabularOptions): Decoder {
  const added = options.added ?? {};
  for (const header of Object.keys(added)) check(ADDED.test(header), 'DECODER_INVALID', 'Added columns are marked as added.');
  if (options.titleValue) check(ADDED.test(options.titleValue.header), 'DECODER_INVALID', 'Added columns are marked as added.');
  const accepts = options.accepts ?? 'text';
  return {
    id: options.id, version: '1', accepts,
    decode(input, recipe): DecodedTable {
      let grid: Grid;
      if (accepts === 'text') {
        check(typeof input.text === 'string', 'TEXT_REQUIRED', 'This recipe reads a text export.');
        grid = parseDelimited(input.text!, options.delimiter ?? ',');
      } else {
        check(Array.isArray(input.rows), 'ROWS_REQUIRED', 'This recipe reads a worksheet.');
        grid = gridFromRows(input.rows!);
      }
      if (options.commentPrefix) grid = grid.filter(line => !(line.cells[0] ?? '').trim().startsWith(options.commentPrefix!));
      const table = locateTable(grid, headerGroups(recipe));
      const extra: Record<string, string> = { ...added };
      if (options.titleValue) {
        const titles = table.before.slice(0, 40).map(line => line.cells.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400));
        const found = titles.map(text => options.titleValue!.pattern.exec(text)).find(Boolean);
        check(found && found[1], 'SOURCE_PERIOD_MISSING', 'The report title does not state its period. The export may be from another report or layout.');
        extra[options.titleValue.header] = found![1].trim();
      }
      const known = new Set(table.headers.map(norm));
      for (const header of Object.keys(extra)) check(!known.has(norm(header)), 'DUPLICATE_HEADERS', 'Two columns have the same heading. Rename one in the export before importing.');
      const rows: RawRow[] = table.body.map(row => ({ line: row.line, cells: cellsOf(table.headers, row.cells) }));
      const { body, footers } = options.totalsAnywhere ? splitTotals(recipe, table.headers, rows) : { body: rows, footers: [] };
      for (const row of body) Object.assign(row.cells, extra);
      return { headers: [...table.headers, ...Object.keys(extra)], rows: body, footers, declared: null, meta: { ...(input.meta ?? {}) } };
    },
  };
}

const PAYROLL_NOTICES = [
  'Payroll cost is the gross pay the register states, before employee deductions. Employer contributions such as employer PF and ESI are not included.',
  'Employee names are not imported. Each record is identified by employee id and pay month only.',
];
const money = (from: string[], required = false) => ({ from, type: 'money' as const, ...(required ? { required } : {}) });
const text = (from: string[], required = false) => ({ from, type: 'text' as const, ...(required ? { required } : {}) });

export const DECODERS: readonly Decoder[] = [
  tabularDecoder({ id: 'csv-payroll-cost', added: { '(added) cost type': 'payroll' } }),
  tabularDecoder({ id: 'greythr-salary-register', added: { '(added) cost type': 'payroll' }, titleValue: { pattern: /for the month of ([A-Za-z]{3,9}[ -]\d{4})/i, header: '(added) pay month' } }),
  tabularDecoder({ id: 'csv-ticket-count', added: { '(added) ticket count': '1' } }),
  tabularDecoder({ id: 'csv-as-of-title', totalsAnywhere: true, titleValue: { pattern: /^As (?:of|on):? (\d{1,2}\/\d{1,2}\/\d{4})$/i, header: '(added) as of date' } }),
];

export const RECIPES: readonly SourceRecipe[] = [
  {
    id: 'shiprocket.cod-remittance', version: '1', group: 'shiprocket', operation: 'cod-remittance', title: 'Shiprocket COD remittance report', decoder: 'csv',
    fields: {
      awb: text(['AWB Code', 'AWB'], true),
      orderId: text(['Order ID', 'Channel Order ID']),
      courier: text(['Courier Name', 'Courier']),
      shipped: { from: ['Shipped Date'], type: 'date', dateFormats: ['DMY-MON'] },
      date: { from: ['Remittance Date'], type: 'date', required: true, dateFormats: ['DMY-MON'] },
      cod: money(['COD Amount'], true),
      freight: money(['Freight Charges', 'Freight Total Amount']),
      utr: text(['UTR', 'UTR No']),
      status: text(['Remittance Status', 'Status'], true),
    },
    measure: { type: 'money', amount: { field: 'cod' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['awb'], kind: { constant: 'payment' },
    status: { field: 'status', values: { Remitted: 'settled', 'Early COD Remitted': 'settled' } },
    outputs: { orderId: 'orderId', shippingMinor: 'freight', bankReference: 'utr', status: 'status' },
    totals: { kind: 'footer-row', labelField: 'awb', labels: ['Total', 'Remittance Total'], amountFields: ['cod'] },
    notices: ['COD amount is the cash the courier collected from buyers and remitted. Freight is shown separately and is not deducted here.'],
    sensitivity: 'financial',
  },
  {
    id: 'delhivery.cod-remittance', version: '1', group: 'delhivery', operation: 'cod-remittance', title: 'Delhivery COD remittance report', decoder: 'csv',
    fields: {
      waybill: text(['Waybill', 'Waybill No', 'AWB'], true),
      orderId: text(['Order ID', 'Order No', 'Reference No']),
      delivered: { from: ['Delivered Date'], type: 'date', dateFormats: ['DMY'] },
      date: { from: ['Remittance Date', 'Remitted On'], type: 'date', required: true, dateFormats: ['DMY'] },
      cod: money(['COD Amount', 'Collectable Amount'], true),
      charges: money(['Shipping Charges', 'Total Charges']),
      utr: text(['UTR', 'Bank Reference']),
      status: text(['Status'], true),
    },
    measure: { type: 'money', amount: { field: 'cod' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['waybill'], kind: { constant: 'payment' },
    status: { field: 'status', values: { Remitted: 'settled', Paid: 'settled' } },
    outputs: { orderId: 'orderId', shippingMinor: 'charges', bankReference: 'utr', status: 'status' },
    totals: { kind: 'footer-row', labelField: 'waybill', labels: ['Total', 'Grand Total'], amountFields: ['cod'] },
    notices: ['COD amount is the cash Delhivery collected and remitted. Shipping charges are shown separately and are not deducted here.'],
    sensitivity: 'financial',
  },
  {
    id: 'unicommerce.sale-orders', version: '1', group: 'unicommerce', operation: 'sale-orders', title: 'Unicommerce sale orders export', decoder: 'csv',
    fields: {
      orderCode: text(['Sale Order Code'], true),
      itemCode: text(['Sale Order Item Code'], true),
      displayCode: text(['Display Order Code']),
      date: { from: ['Created', 'Order Date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      channel: text(['Channel', 'Channel Name']),
      sku: text(['Item SKU Code', 'Item SKU'], true),
      price: money(['Selling Price'], true),
      shipping: money(['Shipping Charges']),
      status: text(['Sale Order Item Status'], true),
    },
    measure: { type: 'money', amount: { field: 'price' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['orderCode', 'itemCode'], kind: { constant: 'order' },
    status: { field: 'status', values: { CREATED: 'open', FULFILLABLE: 'open', PACKED: 'open', DISPATCHED: 'dispatched', DELIVERED: 'delivered', RETURNED: 'returned' } },
    exclude: { field: 'status', values: ['CANCELLED'] },
    outputs: { orderId: 'displayCode', sku: 'sku', marketplace: 'channel', shippingMinor: 'shipping', status: 'status' },
    totals: { kind: 'report' },
    ignored: ['Item Name'],
    notices: ['Sale order value is the selling price on each order line, by order creation date. It is not delivered revenue until the status says delivered.',
      'Cancelled order lines are not imported. The export has no total row, so enter the order value from Unicommerce\'s own report.'],
    sensitivity: 'financial',
  },
  {
    id: 'unicommerce.inventory-snapshot', version: '1', group: 'unicommerce', operation: 'inventory-snapshot', title: 'Unicommerce inventory snapshot', decoder: 'csv',
    fields: {
      sku: text(['Item SkuCode', 'Item SKU Code', 'SKU'], true),
      facility: text(['Facility', 'Facility Code'], true),
      date: { from: ['Updated', 'Snapshot Date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      inventory: { from: ['Inventory'], type: 'integer', required: true },
    },
    measure: { type: 'count', field: 'inventory', unit: 'units' },
    identity: ['facility', 'sku'], kind: { constant: 'stock_level' },
    outputs: { sku: 'sku', outletId: 'facility', stockQuantity: 'inventory' },
    totals: { kind: 'report' },
    ignored: ['Item Type Name'],
    notices: ['Inventory is the good, sellable stock per facility when the snapshot was taken. Bad inventory and open sale quantities are not included.',
      'A stock level is a count at one moment; adding snapshots from different days does not give stock.'],
    sensitivity: 'operational',
  },
  {
    id: 'zoho-inventory.sales-orders', version: '1', group: 'zoho-inventory', operation: 'sales-orders', title: 'Zoho Inventory sales orders export', decoder: 'csv',
    fields: {
      number: text(['SalesOrder Number', 'Sales Order Number'], true),
      date: { from: ['Order Date', 'Sales Order Date'], type: 'date', required: true, dateFormats: ['ISO'] },
      customer: text(['Customer Name'], true),
      status: text(['Status', 'SalesOrder Status'], true),
      sku: text(['SKU'], true),
      quantity: { from: ['Quantity Ordered', 'Quantity'], type: 'integer' },
      itemTotal: money(['Item Total'], true),
      currency: text(['Currency Code'], true),
    },
    measure: { type: 'money', amount: { field: 'itemTotal' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['number', 'sku'], kind: { constant: 'order' },
    status: { field: 'status', values: { Draft: 'draft', Confirmed: 'open', Closed: 'closed', Onhold: 'on_hold', Fulfilled: 'delivered' } },
    exclude: { field: 'status', values: ['Void'] },
    outputs: { orderId: 'number', customerName: 'customer', sku: 'sku', quantity: 'quantity', status: 'status' },
    totals: { kind: 'report' },
    ignored: ['Item Name', 'Item Price'],
    notices: ['Each record is one sales order line, valued at its item total before order-level discounts and shipping. Void orders are not imported.'],
    sensitivity: 'financial',
  },
  {
    id: 'zoho-inventory.inventory-summary', version: '1', group: 'zoho-inventory', operation: 'inventory-summary', title: 'Zoho Inventory inventory summary report', decoder: 'csv-as-of-title',
    header: [['Item Name'], ['SKU'], ['Stock On Hand']],
    fields: {
      label: text(['Item Name'], true),
      sku: text(['SKU']),
      date: { from: ['(added) as of date'], type: 'date', dateFormats: ['DMY'] },
      onHand: { from: ['Stock On Hand'], type: 'integer', required: true },
    },
    measure: { type: 'count', field: 'onHand', unit: 'units' },
    identity: ['label'], kind: { constant: 'stock_level' },
    outputs: { sku: 'sku', stockQuantity: 'onHand' },
    totals: { kind: 'footer-row', labelField: 'label', labels: ['Total'], amountFields: ['onHand'] },
    notices: ['Stock on hand is the physical quantity on the report\'s as-of date, including stock committed to open orders.'],
    sensitivity: 'operational',
  },
  {
    id: 'keka.payroll-register', version: '1', group: 'keka', operation: 'payroll-register', title: 'Keka payroll register', decoder: 'csv-payroll-cost',
    fields: {
      employeeId: text(['Employee Number', 'Employee Id'], true),
      date: { from: ['Payroll Month', 'Pay Period'], type: 'date', required: true, dateFormats: ['MON-YYYY'] },
      gross: money(['Total Earnings', 'Gross Pay'], true),
      deductions: money(['Total Deductions']),
      net: money(['Net Pay']),
      costType: text(['(added) cost type']),
    },
    measure: { type: 'money', amount: { field: 'gross' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['employeeId', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType' },
    totals: { kind: 'footer-row', labelField: 'employeeId', labels: ['Total', 'Grand Total'], amountFields: ['gross'] },
    ignored: ['Employee Name', 'Department'],
    notices: PAYROLL_NOTICES, sensitivity: 'personal',
  },
  {
    id: 'greythr.salary-register', version: '1', group: 'greythr', operation: 'salary-register', title: 'greytHR salary register', decoder: 'greythr-salary-register',
    fields: {
      employeeId: text(['Employee No', 'Emp No'], true),
      date: { from: ['(added) pay month'], type: 'date', dateFormats: ['MON-YYYY'] },
      gross: money(['GROSS', 'Gross Salary'], true),
      deductions: money(['TOTAL DEDUCTIONS']),
      net: money(['NET PAY'], true),
      costType: text(['(added) cost type']),
    },
    measure: { type: 'money', amount: { field: 'gross' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['employeeId', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType' },
    totals: { kind: 'footer-row', labelField: 'employeeId', labels: ['Total'], amountFields: ['gross'] },
    ignored: ['Sl No', 'Employee Name', 'Designation', 'Location'],
    notices: [...PAYROLL_NOTICES, 'The pay month is read from the register title, because the register has no month column.'],
    sensitivity: 'personal',
  },
  {
    id: 'zoho-payroll.payroll-register', version: '1', group: 'zoho-payroll', operation: 'payroll-register', title: 'Zoho Payroll pay run register', decoder: 'csv-payroll-cost',
    fields: {
      employeeId: text(['Employee ID'], true),
      date: { from: ['Pay Date'], type: 'date', required: true, dateFormats: ['DMY'] },
      gross: money(['Gross Pay'], true),
      deductions: money(['Total Deductions', 'Deductions']),
      net: money(['Net Pay'], true),
      costType: text(['(added) cost type']),
    },
    measure: { type: 'money', amount: { field: 'gross' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['employeeId', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType' },
    totals: { kind: 'footer-row', labelField: 'employeeId', labels: ['Total'], amountFields: ['gross'] },
    ignored: ['Employee Name', 'Department'],
    notices: [...PAYROLL_NOTICES, 'Records are dated by the pay run\'s pay date, which can fall in the month after the work.'],
    sensitivity: 'personal',
  },
  {
    id: 'razorpayx-payroll.payroll-report', version: '1', group: 'razorpayx-payroll', operation: 'payroll-report', title: 'RazorpayX Payroll payroll report', decoder: 'csv-payroll-cost',
    fields: {
      employeeId: text(['Employee ID'], true),
      date: { from: ['Payroll Month', 'Month'], type: 'date', required: true, dateFormats: ['YYYY-MM'] },
      gross: money(['Gross Salary', 'Gross Pay'], true),
      deductions: money(['Deductions', 'Total Deductions']),
      net: money(['Net Pay', 'Net Salary'], true),
      costType: text(['(added) cost type']),
    },
    measure: { type: 'money', amount: { field: 'gross' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['employeeId', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType' },
    totals: { kind: 'footer-row', labelField: 'employeeId', labels: ['Total'], amountFields: ['gross'] },
    ignored: ['Name', 'Email', 'Department'],
    notices: PAYROLL_NOTICES, sensitivity: 'personal',
  },
  {
    id: 'chargebee.invoices', version: '1', group: 'chargebee', operation: 'invoices', title: 'Chargebee invoices export', decoder: 'csv',
    fields: {
      number: text(['Invoice Number'], true),
      date: { from: ['Invoice Date', 'Date'], type: 'date', required: true, dateFormats: ['DMY-MON'] },
      customerId: text(['Customer Id'], true),
      company: text(['Customer Company']),
      subscriptionId: text(['Subscription Id']),
      amount: money(['Amount', 'Total'], true),
      tax: money(['Tax Total', 'Tax']),
      status: text(['Status'], true),
      currency: text(['Currency', 'Currency Code'], true),
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['number'], kind: { constant: 'invoice' },
    status: { field: 'status', values: { Paid: 'paid', 'Payment Due': 'payment_due', 'Not Paid': 'not_paid', Posted: 'posted', Pending: 'pending' } },
    exclude: { field: 'status', values: ['Voided'] },
    outputs: { invoiceId: 'number', customerId: 'customerId', company: 'company', subscriptionId: 'subscriptionId', taxMinor: 'tax', status: 'status' },
    totals: { kind: 'report' },
    ignored: ['Customer Email', 'Customer Name'],
    notices: ['Invoice amount is the invoice total as Chargebee states it, including tax. Tax is carried separately so billed value can exclude it.',
      'Voided invoices are not imported. The export has no total row, so enter the invoiced total from Chargebee\'s own report.'],
    sensitivity: 'financial',
  },
  {
    id: 'freshdesk.tickets', version: '1', group: 'freshdesk', operation: 'tickets', title: 'Freshdesk tickets export', decoder: 'csv-ticket-count',
    fields: {
      ticketId: text(['Ticket ID'], true),
      date: { from: ['Created time'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      status: text(['Status'], true),
      priority: text(['Priority']),
      type: text(['Type']),
      count: { from: ['(added) ticket count'], type: 'integer' },
    },
    measure: { type: 'count', field: 'count', unit: 'tickets' },
    identity: ['ticketId'], kind: { constant: 'ticket' },
    status: { field: 'status', values: { Open: 'open', Pending: 'pending', Resolved: 'resolved', Closed: 'closed', 'Waiting on Customer': 'waiting', 'Waiting on Third Party': 'waiting' } },
    outputs: { description: 'type', status: 'status' },
    totals: { kind: 'report' },
    ignored: ['Subject', 'Full name', 'Email', 'Agent', 'Group', 'Source', 'Resolved time', 'Due by Time'],
    notices: ['Each ticket counts once, on the day it was created. Merged and deleted tickets are not in the export.',
      'The export has no total, so enter the ticket count Freshdesk shows for the same filter. Requester names and emails are not imported.'],
    sensitivity: 'personal',
  },
];
