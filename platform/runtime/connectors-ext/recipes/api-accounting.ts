import type { Decoder, SourceRecipe } from '../recipe.ts';

/**
 * Accounting API recipes over records from adapters/accounting/tally-registers.ts and books-api.ts.
 * All read only. Gross billing (including tax) is never net revenue: '.net' recipes measure the
 * tax-exclusive subtotal the source states and refuse a record without one; '.gross' recipes measure
 * the tax-inclusive document total and say so.
 */
type Register = 'sales' | 'purchase';
function tallyRegister(register: Register, totals: 'declared' | 'report'): SourceRecipe {
  const sales = register === 'sales';
  return {
    id: `tally.${register}-register${totals === 'report' ? '.report' : ''}`, version: '1', group: 'tally', operation: `${register}-register`,
    title: `Tally ${sales ? 'Sales' : 'Purchase'} Register, ${sales ? 'sales' : 'purchase'} ledger postings${totals === 'report' ? ' (total from your Tally report)' : ''}`,
    decoder: 'api-records',
    fields: {
      voucherId: { from: ['voucherId'], type: 'text', required: true },
      voucherNumber: { from: ['voucherNumber'], type: 'text' },
      date: { from: ['date'], type: 'date', required: true, dateFormats: ['YMD8'] },
      voucherType: { from: ['voucherType'], type: 'text' },
      party: { from: ['party'], type: 'text' },
      ledger: { from: ['ledger'], type: 'text', required: true },
      amount: { from: ['amount'], type: 'money', required: true },
      side: { from: ['side'], type: 'text', required: true },
      currency: { from: ['currency'], type: 'text', required: true },
      state: { from: ['state'], type: 'text', required: true },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['voucherId', 'ledger'],
    kind: { constant: sales ? 'sale' : 'purchase' },
    exclude: { field: 'state', values: ['cancelled', 'optional'] },
    // Tally XML: a debit is a negative amount (ISDEEMEDPOSITIVE Yes). Sales are credits, purchases debits.
    sign: { field: 'side', negative: [sales ? 'debit' : 'credit'], positive: [sales ? 'credit' : 'debit'] },
    outputs: { invoiceId: 'voucherNumber', ...(sales ? { customerName: 'party' } : { description: 'party' }) },
    totals: { kind: totals },
    notices: [
      `Each record is one ${sales ? 'sales' : 'purchase'} ledger posting of a ${sales ? 'Sales' : 'Purchase'} voucher: the taxable value, without GST or the party amount.`,
      'Cancelled and optional vouchers are left out and counted as excluded.',
      totals === 'declared'
        ? `The check is the ${sales ? 'Sales' : 'Purchase'} Accounts group's movement for the period. Credit notes or journals posted to those ledgers make it differ, and the read is refused; then use the report recipe.`
        : `Enter the total of the ${sales ? 'Sales' : 'Purchase'} Register from Tally for the same period and ledgers.`,
    ],
    sensitivity: 'financial',
  };
}
type Books = 'zoho-books' | 'xero' | 'quickbooks';
const TITLES: Record<Books, string> = { 'zoho-books': 'Zoho Books', xero: 'Xero', quickbooks: 'QuickBooks Online' };
function invoices(system: Books, basis: 'net' | 'gross'): SourceRecipe {
  const net = basis === 'net';
  return {
    id: `${system}.invoices.${basis}`, version: '1', group: system, operation: 'invoices',
    title: `${TITLES[system]} invoices, ${net ? 'net of tax' : 'gross including tax'}`, decoder: 'api-records',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      number: { from: ['number'], type: 'text' },
      date: { from: ['date'], type: 'date', required: true, dateFormats: ['ISO'] },
      currency: { from: ['currency'], type: 'text', required: true },
      amount: { from: [net ? 'netAmount' : 'grossAmount'], type: 'money', required: true },
      tax: { from: ['taxAmount'], type: 'money' },
      status: { from: ['status'], type: 'text', required: true },
      direction: { from: ['direction'], type: 'text', required: true },
      customer: { from: ['customerName'], type: 'text' },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['id'],
    kind: { field: 'direction', values: net ? { receivable: 'invoice', payable: 'bill' } : { receivable: 'invoice_gross', payable: 'bill_gross' } },
    exclude: { field: 'status', values: ['draft', 'void', 'deleted'] },
    outputs: { invoiceId: 'number', customerName: 'customer', taxMinor: 'tax' },
    ignored: [net ? 'grossAmount' : 'netAmount', 'sourceStatus'],
    totals: { kind: 'report' },
    notices: [
      net ? 'The amount is the tax-exclusive subtotal the system states. An invoice without one is refused, never replaced by its gross total.'
        : 'The amount is the invoice total including tax. That is gross billing, not net revenue.',
      'Draft, void and deleted invoices are left out and counted as excluded.',
      system === 'quickbooks' ? 'QuickBooks states its invoice count; a read that returns a different number is refused. Enter the total from a QuickBooks report.'
        : system === 'xero' ? 'Xero states its invoice count; a read that returns a different number is refused. Enter the total from a Xero report.'
        : net ? 'Zoho Books gives the subtotal in each invoice\'s detail, read one request per invoice; a period with too many invoices is refused. Zoho states its invoice count; enter the total from a Zoho Books report for the same period.'
        : 'Enter the total from a Zoho Books report for the same period.',
    ],
    sensitivity: 'financial',
  };
}
export const RECIPES: readonly SourceRecipe[] = [
  tallyRegister('sales', 'declared'), tallyRegister('sales', 'report'), tallyRegister('purchase', 'declared'), tallyRegister('purchase', 'report'),
  invoices('zoho-books', 'net'), invoices('zoho-books', 'gross'), invoices('xero', 'net'), invoices('xero', 'gross'), invoices('quickbooks', 'gross'),
];
export const DECODERS: readonly Decoder[] = [];
