import type { Decoder, SourceRecipe } from '../recipe.ts';

/**
 * Groups the plan names whose exports carry no total of their own: the person enters the total
 * from the dashboard's own report, and the file is refused until it matches to the paisa.
 */
const date = (from: string[]) => ({ from, type: 'date' as const, required: true, dateFormats: ['DMY', 'DMY-MON', 'ISO', 'ISO-DATETIME'] as const });
export const RECIPES: readonly SourceRecipe[] = [
  { id: 'paytm.settlements', version: '1', group: 'paytm-business', operation: 'settlement-report', title: 'Paytm for Business settlement report', decoder: 'csv',
    fields: { id: { from: ['Transaction_ID', 'Transaction ID'], type: 'text', required: true }, order: { from: ['Order_ID', 'Order ID'], type: 'text' }, date: { ...date(['Transaction_Date', 'Transaction Date']), dateFormats: ['DMY', 'ISO', 'ISO-DATETIME'] },
      amount: { from: ['Settled_Amount', 'Settled Amount', 'Net Amount'], type: 'money', required: true }, fee: { from: ['Commission', 'MDR'], type: 'money' }, status: { from: ['Status', 'Transaction_Status'], type: 'text', required: true },
      utr: { from: ['UTR', 'UTR_No', 'Bank Reference'], type: 'text' } },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' }, identity: ['id'], kind: { constant: 'payment' },
    status: { field: 'status', values: { SUCCESS: 'settled', SETTLED: 'settled' } }, exclude: { field: 'status', values: ['FAILURE', 'FAILED', 'PENDING'] },
    outputs: { orderId: 'order', bankReference: 'utr', feeMinor: 'fee' }, totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['Settled amounts are net of the gateway commission.', 'Failed and pending transactions are not imported and are counted as excluded.'] },
  { id: 'phonepe.settlements', version: '1', group: 'phonepe-business', operation: 'settlement-report', title: 'PhonePe Business settlement report', decoder: 'csv',
    fields: { id: { from: ['Transaction ID', 'Merchant Transaction ID', 'Provider Reference Id'], type: 'text', required: true }, date: { ...date(['Transaction Date', 'Date']), dateFormats: ['DMY', 'DMY-MON', 'ISO-DATETIME'] },
      amount: { from: ['Settlement Amount', 'Net Amount'], type: 'money', required: true }, status: { from: ['Status', 'Transaction Status'], type: 'text', required: true }, utr: { from: ['UTR', 'Settlement UTR'], type: 'text' } },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' }, identity: ['id'], kind: { constant: 'payment' },
    status: { field: 'status', values: { COMPLETED: 'settled', SUCCESS: 'settled', SETTLED: 'settled' } }, exclude: { field: 'status', values: ['FAILED', 'PENDING'] },
    outputs: { bankReference: 'utr' }, totals: { kind: 'report' }, sensitivity: 'financial', notices: ['A UPI collection is money received, not a sale.'] },
  { id: 'instamojo.payments', version: '1', group: 'instamojo', operation: 'payments-export', title: 'Instamojo payments export', decoder: 'csv',
    fields: { id: { from: ['Payment ID'], type: 'text', required: true }, date: { ...date(['Created At', 'Date']), dateFormats: ['ISO-DATETIME', 'DMY', 'DMY-MON'] },
      amount: { from: ['Amount'], type: 'money', required: true }, fee: { from: ['Fees', 'Instamojo Fees'], type: 'money' }, status: { from: ['Status'], type: 'text', required: true }, link: { from: ['Link/Purpose', 'Purpose'], type: 'text' } },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' }, identity: ['id'], kind: { constant: 'payment' },
    status: { field: 'status', values: { Credit: 'settled', Successful: 'settled' } }, exclude: { field: 'status', values: ['Failed', 'Pending'] },
    outputs: { feeMinor: 'fee', description: 'link' }, ignored: ['Buyer Name', 'Buyer Email', 'Buyer Phone'], totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['Buyer names, emails and phones are not imported.', 'A payment amount is gross of Instamojo fees.'] },
  { id: 'restaurant.payout-annexure', version: '1', group: 'restaurant-partners', operation: 'payout-annexure', title: 'Swiggy or Zomato payout annexure (order level)', decoder: 'csv',
    fields: { id: { from: ['Order ID', 'Order No'], type: 'text', required: true }, date: { ...date(['Order Date', 'Order Placed At']), dateFormats: ['DMY', 'DMY-MON', 'ISO', 'ISO-DATETIME'] },
      amount: { from: ['Net Payout', 'Net Payable', 'Final Payout'], type: 'money', required: true }, commission: { from: ['Commission', 'Platform Commission'], type: 'money' },
      status: { from: ['Order Status', 'Status'], type: 'text', required: true } },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' }, identity: ['id'], kind: { constant: 'payment' },
    status: { field: 'status', values: { Delivered: 'settled', Completed: 'settled', '': 'settled' } }, exclude: { field: 'status', values: ['Cancelled', 'Rejected'] },
    outputs: { orderId: 'id', feeMinor: 'commission' }, totals: { kind: 'footer-row', labelField: 'id', labels: ['Total', 'Grand Total'], amountFields: ['amount'] }, sensitivity: 'financial',
    notices: ['Net payout is after commission, taxes and deductions; it is not the order value.'] },
  { id: 'quick-commerce.sales', version: '1', group: 'quick-commerce', operation: 'sales-report', title: 'Blinkit, Zepto or Instamart seller sales report', decoder: 'csv',
    fields: { id: { from: ['Order ID', 'Invoice No'], type: 'text', required: true }, date: { ...date(['Order Date', 'Date']), dateFormats: ['DMY', 'DMY-MON', 'ISO'] },
      sku: { from: ['SKU', 'Item ID', 'Product ID'], type: 'text', required: true }, amount: { from: ['Net Sales', 'Selling Price', 'GMV'], type: 'money', required: true }, city: { from: ['City'], type: 'text' } },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' }, identity: ['id', 'sku'], kind: { constant: 'invoice' },
    outputs: { sku: 'sku', orderId: 'id' }, totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['A platform sales line is a billed claim; the platform\'s payout is separate.'] },
];
export const DECODERS: readonly Decoder[] = [];
