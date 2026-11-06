// The plain-text invoice. Deterministic code, no model: every number is a receipt figure's display text and
// every date goes through formatVentureDate. Names are folded to one line, so no client text can add a line.
import { formatMinor } from '../../currency.ts';
import { formatVentureDate } from '../records.ts';
import { oneLine } from './shared.ts';
import type { ClientRecord, CountryProfile, InvoiceRecord } from '../contracts.ts';

export const RULE_LINE = '----------------------------------------';
export const EXPERIMENTAL_DOCUMENT_LINE = 'Practice invoice from an experimental Chausar build.';

/** The label for the owner's registration number: the country's own ('GSTIN', 'VAT number'), else 'Tax ID'. */
export function supplierTaxIdLabel(country: CountryProfile): string {
  return country.tax.idLabel || 'Tax ID';
}

/** The label for a client's number: GSTIN for a client in India, the country's label for a client at home, else 'Tax ID'. */
export function clientTaxIdLabel(client: ClientRecord, country: CountryProfile): string {
  const clientCountry = client.countryCode ?? country.code;
  if (clientCountry === 'IN') return 'GSTIN';
  if (clientCountry === country.code && country.tax.idLabel) return country.tax.idLabel;
  return 'Tax ID';
}

export type InvoiceDocumentInput = {
  invoice: InvoiceRecord;
  client: ClientRecord;
  sellerName: string;
  country: CountryProfile;
  /** Practice wording while storage is experimental (experimentalStorage in contracts.ts). */
  experimental: boolean;
  /** 4J5: what issued credit notes took off; a Credited line shows when it is above zero, so the lines add up. */
  creditedMinor?: string;
};

/** The invoice as plain text, in the fixed layout of the build spec. */
export function documentText(input: InvoiceDocumentInput): string {
  const { invoice, client, country } = input;
  const money = (minor: string) => formatMinor(minor, invoice.currency);
  const date = (iso: string | null) => (iso === null ? 'Not set' : formatVentureDate(iso, country.dateOrder));
  const lines: string[] = [];
  lines.push(`${invoice.documentTitle} ${invoice.number ?? 'DRAFT'}`);
  lines.push(`From: ${oneLine(input.sellerName)}`);
  if (invoice.supplierTaxId !== null) lines.push(`${supplierTaxIdLabel(country)}: ${invoice.supplierTaxId}`);
  lines.push(`To: ${oneLine(client.name)}`);
  if (invoice.clientTaxId !== null) lines.push(`${clientTaxIdLabel(client, country)}: ${invoice.clientTaxId}`);
  if (invoice.placeOfSupply !== null) lines.push(`Place of supply: ${invoice.placeOfSupply}`);
  lines.push(`Issued: ${date(invoice.issueDate)}    Due: ${date(invoice.dueDate)}`);
  lines.push(RULE_LINE);
  for (const line of invoice.lines) {
    const parts = [oneLine(line.description)];
    if (invoice.sacCode !== null) parts.push(`SAC ${invoice.sacCode}`);
    parts.push(`${line.quantity} x ${money(line.unitMinor)}`, money(line.amountMinor));
    lines.push(parts.join('  '));
    // A tax-included split whose rounding difference is on the line (money/tax-kinds.ts). The client reads this, so it
    // says it plainly; the receipt keeps the working.
    if (BigInt(line.amountMinor) !== BigInt(line.quantity) * BigInt(line.unitMinor)) lines.push('Unit price shown rounded; the line total is exact.');
  }
  lines.push(`Subtotal  ${money(invoice.subtotalMinor)}`);
  for (const taxLine of invoice.taxLines) lines.push(`${taxLine.label}  ${money(taxLine.minor)}`);
  lines.push(`Total  ${money(invoice.totalMinor)}`);
  lines.push(`Paid  ${money(invoice.paidMinor)}`);
  if (BigInt(input.creditedMinor ?? '0') > 0n) lines.push(`Credited  ${money(input.creditedMinor as string)}`);
  lines.push(`Balance  ${money(invoice.balanceMinor)}`);
  lines.push(RULE_LINE);
  lines.push(`Every number on this invoice has a receipt in Chausar: ${invoice.priceReceiptId}`);
  if (input.experimental) lines.push(EXPERIMENTAL_DOCUMENT_LINE);
  return lines.join('\n');
}
