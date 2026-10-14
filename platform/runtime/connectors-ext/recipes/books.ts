import { check } from '../../contracts.ts';
import { tableFromGrid } from '../decoders.ts';
import { norm, parseDelimited } from '../tabular.ts';
import type { Decoder, SourceRecipe } from '../recipe.ts';
import type { DecodedTable } from '../types.ts';
import { UNCONFIRMED, checkedAgainst, tabularDecoder } from './operations.ts';

/**
 * Billing and khata books used by Indian small businesses: Vyapar, BUSY, Marg ERP, myBillBook,
 * Khatabook, OkCredit, BharatPe and Petpooja. Every recipe is checked against the export's own
 * total row, or against the total the person reads off the system's own report when the export
 * carries none. Each recipe's notices say whether its headings were checked against a public
 * source or are still unconfirmed.
 */

/** Headings of the column the two-sided decoder adds. It names which amount column a row filled. */
export const FILLED_SIDE_HEADING = 'Filled Amount Column';

/**
 * Khata ledgers put each entry in one of two amount columns ("You Gave" / "You Got") with no type
 * column. This decoder reads the CSV and adds one derived column holding the recipe field name of
 * the amount column the row filled, so the recipe can map it to a kind. It never computes amounts.
 * A row with both or neither amount filled is refused; total rows are left for the interpreter.
 */
export const twoSidedCsvDecoder: Decoder = {
  id: 'csv-two-sided', version: '1', accepts: 'text',
  decode(input, recipe): DecodedTable {
    check(typeof input.text === 'string', 'TEXT_REQUIRED', 'This recipe reads a text export.');
    const m = recipe.measure;
    check(m.type === 'money' && 'credit' in m.amount, 'RECIPE_MEASURE_INVALID', 'This decoder reads a two-column ledger.');
    const amount = m.type === 'money' && 'credit' in m.amount ? m.amount : { credit: '', debit: '' };
    const table = tableFromGrid(parseDelimited(input.text!, ','), recipe, input.meta);
    check(!table.headers.some(h => norm(h) === norm(FILLED_SIDE_HEADING)), 'INVALID_HEADERS', 'The export already has a column with a reserved heading.');
    const columnOf = (field: string): string | null => {
      const spec = recipe.fields[field]; if (!spec) return null;
      const aliases = new Set(spec.from.map(norm));
      return table.headers.find(h => aliases.has(norm(h))) ?? null;
    };
    const creditColumn = columnOf(amount.credit), debitColumn = columnOf(amount.debit);
    check(creditColumn !== null && debitColumn !== null, 'REQUIRED_COLUMN_MISSING', 'A column this recipe needs is missing. The export may be from another report or version.');
    const labelColumn = recipe.totals.kind === 'footer-row' ? columnOf(recipe.totals.labelField) : null;
    const labels = recipe.totals.kind === 'footer-row' ? new Set(recipe.totals.labels.map(norm)) : new Set<string>();
    let inFooter = false;
    for (const row of table.rows) {
      if (labelColumn && labels.has(norm(row.cells[labelColumn] ?? ''))) inFooter = true;
      if (inFooter) { row.cells[FILLED_SIDE_HEADING] = ''; continue; }
      const filled = (column: string) => { const text = (row.cells[column] ?? '').trim(); return text !== '' && !/^[-–—]$/.test(text); };
      const credit = filled(creditColumn!), debit = filled(debitColumn!);
      check(!(credit && debit), 'AMBIGUOUS_MOVEMENT', 'A row has amounts in both columns.');
      check(credit || debit, 'MISSING_AMOUNT', 'A row has no amount in either column. A missing amount is not counted as zero.');
      row.cells[FILLED_SIDE_HEADING] = credit ? amount.credit : amount.debit;
    }
    return { ...table, headers: [...table.headers, FILLED_SIDE_HEADING] };
  },
};

const DMY = ['DMY'] as const;
const SALE_NOTICE = 'A sale invoice is a billed claim, not cash received.';

const vyaparSales: SourceRecipe = {
  id: 'vyapar.sale-report', version: '1', group: 'vyapar', operation: 'sales-register', title: 'Vyapar Sale Report export', decoder: 'csv',
  fields: {
    date: { from: ['Date'], type: 'date', required: true, dateFormats: DMY },
    invoiceNo: { from: ['Invoice No.', 'Invoice No', 'Ref No.', 'Ref No'], type: 'text', required: true },
    party: { from: ['Party Name'], type: 'text', required: true },
    gstin: { from: ['Party GSTIN', 'GSTIN'], type: 'text' },
    type: { from: ['Transaction Type', 'Type'], type: 'text', required: true },
    paymentType: { from: ['Payment Type'], type: 'text' },
    total: { from: ['Total Amount', 'Total'], type: 'money', required: true },
    received: { from: ['Received Amount', 'Received', 'Received / Paid Amount'], type: 'money' },
    balance: { from: ['Balance Amount', 'Balance', 'Balance Due'], type: 'money' },
    paymentStatus: { from: ['Payment Status', 'Status'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'total' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['invoiceNo'],
  kind: { field: 'type', values: { Sale: 'invoice', 'Sale Return': 'credit_note', 'Credit Note': 'credit_note' } },
  sign: { field: 'type', negative: ['Sale Return', 'Credit Note'], positive: ['Sale'] },
  status: { field: 'paymentStatus', values: { '': '', Paid: 'paid', Unpaid: 'unpaid', Partial: 'partially_paid', 'Partially Paid': 'partially_paid', Overdue: 'overdue' } },
  outputs: { invoiceId: 'invoiceNo', customerName: 'party', gstin: 'gstin', paymentMethod: 'paymentType', status: 'paymentStatus' },
  totals: { kind: 'footer-row', labelField: 'date', labels: ['Total', 'Grand Total'], amountFields: ['total'] },
  ignored: ['Phone No.'],
  notices: [SALE_NOTICE, 'Sale returns and credit notes are imported as negative amounts.', 'Received and balance columns describe collections at export time and are not imported as cash.',
    'Vyapar exports the Sale Report as an Excel sheet; save it as CSV to import. The headings and DD/MM/YYYY dates were checked; the source did not show whether the sheet has a Total row.',
    checkedAgainst('https://github.com/mehulbasu/trevito-dashboard/blob/2f05dbfd4fba7c82e74d7aa4e3dca366ddd4bef8/docs/vyapar.md')],
  sensitivity: 'financial',
};
const vyaparPurchases: SourceRecipe = {
  id: 'vyapar.purchase-report', version: '1', group: 'vyapar', operation: 'purchase-register', title: 'Vyapar Purchase Report export', decoder: 'csv',
  fields: {
    date: { from: ['Date'], type: 'date', required: true, dateFormats: DMY },
    billNo: { from: ['Bill No.', 'Bill No', 'Ref No.', 'Ref No', 'Invoice No.', 'Invoice No'], type: 'text', required: true },
    party: { from: ['Party Name'], type: 'text', required: true },
    gstin: { from: ['Party GSTIN', 'GSTIN'], type: 'text' },
    type: { from: ['Transaction Type', 'Type'], type: 'text', required: true },
    paymentType: { from: ['Payment Type'], type: 'text' },
    total: { from: ['Total Amount', 'Total'], type: 'money', required: true },
    paid: { from: ['Paid Amount', 'Paid', 'Received / Paid Amount'], type: 'money' },
    balance: { from: ['Balance Amount', 'Balance', 'Balance Due'], type: 'money' },
    paymentStatus: { from: ['Payment Status', 'Status'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'total' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['billNo', 'party'],
  kind: { field: 'type', values: { Purchase: 'purchase_bill', 'Purchase Return': 'debit_note', 'Debit Note': 'debit_note' } },
  sign: { field: 'type', negative: ['Purchase Return', 'Debit Note'], positive: ['Purchase'] },
  status: { field: 'paymentStatus', values: { '': '', Paid: 'paid', Unpaid: 'unpaid', Partial: 'partially_paid', 'Partially Paid': 'partially_paid', Overdue: 'overdue' } },
  outputs: { invoiceId: 'billNo', customerName: 'party', gstin: 'gstin', paymentMethod: 'paymentType', status: 'paymentStatus' },
  totals: { kind: 'footer-row', labelField: 'date', labels: ['Total', 'Grand Total'], amountFields: ['total'] },
  ignored: ['Phone No.'],
  notices: ['A purchase bill is an amount owed to a supplier, not cash paid.', 'Purchase returns and debit notes are imported as negative amounts.', 'The party on a purchase is a supplier, not a customer.',
    UNCONFIRMED],
  sensitivity: 'financial',
};

const busyRegister = (operation: 'sales-register' | 'purchase-register'): SourceRecipe => {
  const sales = operation === 'sales-register';
  return {
    id: sales ? 'busy.sales-register' : 'busy.purchase-register', version: '1', group: 'busy', operation,
    title: sales ? 'BUSY Sales Register export' : 'BUSY Purchase Register export', decoder: 'csv',
    fields: {
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['DMY', 'DMY-MON'] },
      vchNo: { from: ['Vch/Bill No', 'Vch/Bill No.', 'Vch No.', 'Bill No'], type: 'text', required: true },
      party: { from: ['Particulars', 'Party', 'Account'], type: 'text', required: true },
      vchType: { from: ['Vch Type', 'Voucher Type'], type: 'text', required: true },
      gstin: { from: ['GSTIN', 'GSTIN/UIN'], type: 'text' },
      taxable: { from: ['Taxable Amt', 'Taxable Amount', 'Taxable Value'], type: 'money' },
      tax: { from: ['Tax Amt', 'Tax Amount', 'Total Tax'], type: 'money' },
      amount: { from: ['Bill Amount', 'Amount', 'Bill Amt'], type: 'money', required: true },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: sales ? ['vchNo'] : ['vchNo', 'party'],
    kind: sales
      ? { field: 'vchType', values: { Sales: 'invoice', Sale: 'invoice', 'Sales Return': 'credit_note', 'Sale Return': 'credit_note' } }
      : { field: 'vchType', values: { Purchase: 'purchase_bill', 'Purchase Return': 'debit_note' } },
    sign: sales
      ? { field: 'vchType', negative: ['Sales Return', 'Sale Return'], positive: ['Sales', 'Sale'] }
      : { field: 'vchType', negative: ['Purchase Return'], positive: ['Purchase'] },
    outputs: { invoiceId: 'vchNo', customerName: 'party', gstin: 'gstin', taxMinor: 'tax' },
    totals: { kind: 'footer-row', labelField: 'party', labels: ['Total', 'Grand Total'], amountFields: ['amount'] },
    notices: sales
      ? [SALE_NOTICE, 'The amount is the bill amount including tax; the taxable amount is not imported as the measure.', 'Sales returns are imported as negative amounts.']
      : ['A purchase bill is an amount owed to a supplier, not cash paid.', 'The amount is the bill amount including tax.', 'Purchase returns are imported as negative amounts.', 'The party on a purchase is a supplier, not a customer.'],
    sensitivity: 'financial',
  };
};

const margBook = (operation: 'sales-register' | 'purchase-register'): SourceRecipe => {
  const sales = operation === 'sales-register';
  return {
    id: sales ? 'marg.sale-book' : 'marg.purchase-book', version: '1', group: 'marg', operation,
    title: sales ? 'Marg ERP Sale Book export' : 'Marg ERP Purchase Book export', decoder: 'csv',
    fields: {
      date: { from: ['Date', 'Bill Date'], type: 'date', required: true, dateFormats: DMY },
      billNo: { from: ['Bill No', 'Bill No.', 'Bill Number'], type: 'text', required: true },
      party: { from: ['Party Name', 'Party', 'Supplier Name'], type: 'text', required: true },
      mode: { from: ['Cash/Credit', 'Type'], type: 'text', required: true },
      gstin: { from: ['GSTIN', 'GST No'], type: 'text' },
      taxable: { from: ['Taxable', 'Taxable Amount', 'Gross Amount'], type: 'money' },
      gst: { from: ['GST Amt', 'GST Amount', 'Tax Amount'], type: 'money' },
      amount: { from: ['Net Amount', 'Bill Amount', 'Amount'], type: 'money', required: true },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: sales ? ['billNo'] : ['billNo', 'party'],
    kind: { field: 'mode', values: sales ? { Cash: 'invoice', Credit: 'invoice' } : { Cash: 'purchase_bill', Credit: 'purchase_bill' } },
    outputs: { invoiceId: 'billNo', customerName: 'party', gstin: 'gstin', taxMinor: 'gst', paymentMethod: 'mode' },
    totals: { kind: 'footer-row', labelField: 'billNo', labels: ['Total', 'Grand Total'], amountFields: ['amount'] },
    notices: sales
      ? [SALE_NOTICE, 'A cash bill is marked as cash by the shop; a credit bill is still owed.', 'The amount is the net bill amount including tax.']
      : ['A purchase bill is an amount owed to a supplier, not cash paid.', 'The amount is the net bill amount including tax.', 'The party on a purchase is a supplier, not a customer.'],
    sensitivity: 'financial',
  };
};

const mybillbookSales: SourceRecipe = {
  id: 'mybillbook.sales-report', version: '1', group: 'mybillbook', operation: 'sales-register', title: 'myBillBook Sales report export', decoder: 'csv',
  fields: {
    date: { from: ['Date', 'Invoice Date'], type: 'date', required: true, dateFormats: ['DMY', 'DMY-MON'] },
    invoiceNo: { from: ['Invoice Number', 'Invoice No.', 'Invoice No'], type: 'text', required: true },
    party: { from: ['Party Name'], type: 'text', required: true },
    dueDate: { from: ['Due Date'], type: 'date', dateFormats: ['DMY', 'DMY-MON'] },
    amount: { from: ['Invoice Amount', 'Total Amount', 'Amount'], type: 'money', required: true },
    balance: { from: ['Balance Amount', 'Balance', 'Pending Amount'], type: 'money' },
    paymentStatus: { from: ['Status', 'Payment Status'], type: 'text', required: true },
  },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['invoiceNo'],
  kind: { constant: 'invoice' },
  status: { field: 'paymentStatus', values: { Paid: 'paid', Unpaid: 'unpaid', 'Partially Paid': 'partially_paid', Partial: 'partially_paid', Overdue: 'overdue' } },
  outputs: { invoiceId: 'invoiceNo', customerName: 'party', dueDate: 'dueDate', status: 'paymentStatus' },
  totals: { kind: 'footer-row', labelField: 'date', labels: ['Total', 'Grand Total'], amountFields: ['amount'] },
  notices: [SALE_NOTICE, 'Paid and unpaid status is as of the export date and can change later.'],
  sensitivity: 'financial',
};

const khatabookLedger: SourceRecipe = {
  id: 'khatabook.customer-transactions', version: '1', group: 'khatabook', operation: 'credit-ledger', title: 'Khatabook customer transactions export', decoder: 'csv-two-sided',
  header: [['Date'], ['Customer Name', 'Name'], ['You Gave (₹)', 'You Gave'], ['You Got (₹)', 'You Got']],
  fields: {
    date: { from: ['Date'], type: 'date', required: true, dateFormats: ['DMY-MON', 'DMY'] },
    stamp: { from: ['Date'], type: 'text', required: true },
    customer: { from: ['Customer Name', 'Name'], type: 'text', required: true },
    details: { from: ['Details', 'Note', 'Remarks'], type: 'text' },
    gave: { from: ['You Gave (₹)', 'You Gave'], type: 'money' },
    got: { from: ['You Got (₹)', 'You Got'], type: 'money' },
    side: { from: [FILLED_SIDE_HEADING], type: 'text' },
  },
  measure: { type: 'money', amount: { credit: 'gave', debit: 'got' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['stamp', 'customer', 'side'],
  kind: { field: 'side', values: { gave: 'credit_given', got: 'payment_received' } },
  outputs: { customerName: 'customer', description: 'details' },
  totals: { kind: 'footer-row', labelField: 'customer', labels: ['Grand Total', 'Total'], amountFields: ['gave', 'got'] },
  notices: ['A positive amount is credit given to a customer (they owe more); a negative amount is a payment received.',
    'Credit given is usually a sale on credit, not cash received.', 'The ledger is what the shop recorded; it is not a bank record.'],
  sensitivity: 'financial',
};
const okcreditStatement: SourceRecipe = {
  id: 'okcredit.account-statement', version: '1', group: 'okcredit', operation: 'credit-ledger', title: 'OkCredit account statement export', decoder: 'csv-two-sided',
  header: [['Date'], ['Name', 'Customer Name'], ['Credit'], ['Payment']],
  fields: {
    date: { from: ['Date'], type: 'date', required: true, dateFormats: ['DMY-MON', 'DMY'] },
    stamp: { from: ['Date'], type: 'text', required: true },
    customer: { from: ['Name', 'Customer Name'], type: 'text', required: true },
    note: { from: ['Note', 'Notes', 'Remarks'], type: 'text' },
    credit: { from: ['Credit'], type: 'money' },
    payment: { from: ['Payment'], type: 'money' },
    side: { from: [FILLED_SIDE_HEADING], type: 'text' },
  },
  measure: { type: 'money', amount: { credit: 'credit', debit: 'payment' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['stamp', 'customer', 'side'],
  kind: { field: 'side', values: { credit: 'credit_given', payment: 'payment_received' } },
  outputs: { customerName: 'customer', description: 'note' },
  totals: { kind: 'footer-row', labelField: 'customer', labels: ['Total', 'Grand Total'], amountFields: ['credit', 'payment'] },
  ignored: ['Balance'],
  notices: ['A positive amount is credit given to a customer (they owe more); a negative amount is a payment received.',
    'Credit given is usually a sale on credit, not cash received.', 'The statement is what the shop recorded; it is not a bank record.'],
  sensitivity: 'financial',
};

const bharatpeSettlement: SourceRecipe = {
  id: 'bharatpe.transaction-report', version: '1', group: 'bharatpe', operation: 'collections', title: 'BharatPe QR transaction and settlement report', decoder: 'csv',
  fields: {
    date: { from: ['Transaction Date', 'Date'], type: 'date', required: true, dateFormats: ['DMY', 'DMY-MON', 'ISO-DATETIME', 'ISO'] },
    transactionId: { from: ['Transaction ID', 'Txn ID'], type: 'text', required: true },
    utr: { from: ['UTR', 'UTR No', 'RRN'], type: 'text' },
    payer: { from: ['Payer Name', 'Customer Name'], type: 'text' },
    amount: { from: ['Amount', 'Amount (₹)', 'Transaction Amount'], type: 'money', required: true },
    txnStatus: { from: ['Status', 'Transaction Status'], type: 'text', required: true },
    settlementDate: { from: ['Settlement Date'], type: 'date', dateFormats: ['DMY', 'DMY-MON', 'ISO-DATETIME', 'ISO'] },
    settlementUtr: { from: ['Settlement UTR', 'Settlement Reference'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['transactionId'],
  kind: { field: 'txnStatus', values: { Success: 'upi_collection', Settled: 'upi_collection', Refunded: 'upi_refund' } },
  sign: { field: 'txnStatus', negative: ['Refunded'], positive: ['Success', 'Settled'] },
  exclude: { field: 'txnStatus', values: ['Failed', 'Pending', 'Expired'] },
  outputs: { bankReference: 'utr', customerName: 'payer' },
  totals: { kind: 'report' },
  ignored: ['Payer VPA', 'Payment Mode'],
  notices: ['The report states no total of its own; enter the settled total shown in the BharatPe app for the same dates.',
    'Failed, pending and expired payments are not money received and are not imported.', 'A collection is money received on the QR; the bank settlement may arrive on a later date.'],
  sensitivity: 'financial',
};

/**
 * Petpooja order reports carry their own Total row and summary statistics (Min., Max., Avg.) right
 * under the header, before the bills. The Total row is the source total wherever it sits; the
 * statistics rows are dropped, never read as bills.
 */
export const petpoojaDecoder = tabularDecoder({ id: 'petpooja-orders', totalsAnywhere: true, statisticRows: ['Min.', 'Max.', 'Avg.', 'Min', 'Max', 'Avg'] });

const petpoojaOrders: SourceRecipe = {
  id: 'petpooja.order-summary', version: '2', group: 'petpooja', operation: 'orders', title: 'Petpooja order-wise sales report', decoder: 'petpooja-orders',
  fields: {
    invoiceNo: { from: ['Invoice No.', 'Invoice No', 'Order No.', 'Order No'], type: 'text', required: true },
    date: { from: ['Date', 'Order Date'], type: 'date', required: true, dateFormats: ['ISO', 'ISO-DATETIME', 'DMY'] },
    orderType: { from: ['Order Type'], type: 'text', required: true },
    paymentType: { from: ['Payment Type'], type: 'text' },
    orderStatus: { from: ['Status', 'Order Status'], type: 'text', required: true },
    subTotal: { from: ['My Amount', 'My Amount (₹)', 'Sub Total'], type: 'money' },
    discount: { from: ['Total Discount', 'Total Discount (₹)', 'Discount', 'Discount (₹)'], type: 'money' },
    delivery: { from: ['Delivery Charge', 'Delivery Charge (₹)'], type: 'money' },
    container: { from: ['Container Charge', 'Container Charge (₹)', 'Packaging Charge'], type: 'money' },
    tax: { from: ['Total Tax', 'Total Tax (₹)', 'Tax'], type: 'money' },
    roundOff: { from: ['Round Off', 'Round Off (₹)'], type: 'money' },
    grandTotal: { from: ['Grand Total', 'Grand Total (₹)', 'Total', 'Total (₹)'], type: 'money', required: true },
  },
  measure: { type: 'money', amount: { field: 'grandTotal' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['invoiceNo'],
  kind: { field: 'orderType', values: { 'Dine In': 'order', DineIn: 'order', 'Pick Up': 'order', Pickup: 'order', Takeaway: 'order', Delivery: 'order', 'Delivery(Parcel)': 'order', Parcel: 'order', Online: 'order' } },
  status: { field: 'orderStatus', values: { Success: '', Printed: '', Settled: '', Complete: '', Completed: '', Paid: '', Complimentary: 'complimentary' } },
  exclude: { field: 'orderStatus', values: ['Cancelled', 'Canceled'] },
  outputs: { orderId: 'invoiceNo', paymentMethod: 'paymentType', taxMinor: 'tax', shippingMinor: 'delivery', status: 'orderStatus' },
  totals: { kind: 'footer-row', labelField: 'invoiceNo', labels: ['Total', 'Grand Total'], amountFields: ['grandTotal'] },
  ignored: ['Phone', 'Name', 'Area', 'Customer Name', 'Customer Phone'],
  notices: ['The amount is the order grand total including tax and charges.', 'Cancelled orders are not imported.',
    'Orders through delivery apps are billed totals; the app pays out later net of its commission.',
    'The Total row may sit right under the header, followed by Min., Max. and Avg. rows; those statistics are never read as bills. Customer names and phone numbers are not imported.',
    'Headings with "(₹)" and the summary rows follow a third-party parser of the Orders Master Report (github.com/ShopnoBanerjee/akira-backend), not a published sample.',
    UNCONFIRMED],
  sensitivity: 'financial',
};

/** Recipes whose layout no public source showed carry that fact as a notice. */
const unconfirmed = (recipe: SourceRecipe): SourceRecipe => ({ ...recipe, notices: [...(recipe.notices ?? []), UNCONFIRMED] });

export const RECIPES: readonly SourceRecipe[] = [
  vyaparSales, vyaparPurchases, ...[busyRegister('sales-register'), busyRegister('purchase-register'), margBook('sales-register'), margBook('purchase-register'),
    mybillbookSales, khatabookLedger, okcreditStatement, bharatpeSettlement].map(unconfirmed), petpoojaOrders,
];
export const DECODERS: readonly Decoder[] = [twoSidedCsvDecoder, petpoojaDecoder];
