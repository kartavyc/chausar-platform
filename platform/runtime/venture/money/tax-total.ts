import type { State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import type { InvoiceRecord, SumReceiptSubject, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { invoiceCountry } from '../core/country-history.ts';
import type { SumPlan } from './sums.ts';

/** A historical invoice retains the tax name on its approved plan. */
export function invoiceTaxLabel(state: State, venture: VentureRecord, invoice: InvoiceRecord): string {
  const receipt = listRecords(state, 'venture-price-receipt', venture.id).find(row => row.id === invoice.priceReceiptId);
  const plan = receipt && listRecords(state, 'venture-blueprint', venture.id).find(row => row.digest === receipt.inputs.blueprintDigest);
  return invoice.taxLabel ?? plan?.backOffice.taxLabel ?? invoiceCountry(state, venture, invoice).tax.label;
}

/** A tax total binds one currency, one tax name and the exact inclusive issue-date period. */
export function taxTotalPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'tax-total' }>): SumPlan {
  const invoices = listRecords(state, 'venture-invoice', venture.id).filter(invoice =>
    ['issued', 'part-paid', 'paid'].includes(invoice.status) && invoice.number !== null && invoice.issueDate !== null
    && invoice.issueDate >= subject.from && invoice.issueDate <= subject.to && invoice.currency === subject.currency
    && invoiceTaxLabel(state, venture, invoice) === subject.taxLabel)
    .sort((a, b) => a.issueDate!.localeCompare(b.issueDate!) || a.number!.localeCompare(b.number!));
  return { subject: { ...subject }, currency: subject.currency, unit: 'minor',
    words: { label: `${subject.taxLabel} on issued invoices`, one: 'invoice', many: 'invoices', none: 'No invoices issued.' },
    addends: invoices.map(invoice => ({ recordId: invoice.id, label: `${invoice.number}, ${subject.taxLabel}`, amount: invoice.taxMinor,
      display: formatMinor(invoice.taxMinor, invoice.currency), estimate: false })) };
}
