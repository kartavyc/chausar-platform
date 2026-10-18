// Chausar venture launcher, core (P1): what a tax invoice needs, and the checks on owner-typed tax fields.
// Registration numbers are owner-typed and checked here; Chausar never guesses one.
import { check } from '../../contracts.ts';
import { gstinValid } from '../../memory.ts';
import { INDIA_STATES } from '../contracts.ts';
import type { BackOffice, CountryProfile } from '../contracts.ts';

/**
 * Whether every field a tax invoice needs is present. A plain invoice (not registered, or a country whose
 * invoices are not tax invoices) is never "ready" and has nothing missing.
 */
export function taxInvoiceFields(backOffice: BackOffice, country: CountryProfile): { taxInvoiceReady: boolean; taxInvoiceMissing: string[] } {
  if (!backOffice.taxRegistered.value || backOffice.invoiceKind === 'invoice') return { taxInvoiceReady: false, taxInvoiceMissing: [] };
  const missing: string[] = [];
  if (country.code === 'IN') {
    if (!(backOffice.taxId && gstinValid(backOffice.taxId))) missing.push('Your GSTIN');
    if (!backOffice.taxState) missing.push('Your state');
    if (!backOffice.sacCode) missing.push('Your SAC code');
  } else if (!backOffice.taxId) {
    missing.push(`Your ${country.tax.idLabel}`);
  }
  return { taxInvoiceReady: missing.length === 0, taxInvoiceMissing: missing };
}

/** Applies taxInvoiceFields to a back office in place and returns it. */
export function withTaxInvoiceFields(backOffice: BackOffice, country: CountryProfile): BackOffice {
  const fields = taxInvoiceFields(backOffice, country);
  backOffice.taxInvoiceReady = fields.taxInvoiceReady;
  backOffice.taxInvoiceMissing = fields.taxInvoiceMissing;
  return backOffice;
}

/** An owner-typed registration number: upper-cased, spaces removed, then the country's check. */
export function cleanTaxId(value: unknown, country: CountryProfile): string {
  check(typeof value === 'string' && value.length <= 60, 'INVALID_TAX_ID', `Check your ${country.tax.idLabel || 'registration number'}.`);
  check(country.code === 'IN' || country.tax.idPattern !== null, 'INVALID_VENTURE_REQUEST', 'Chausar does not use a registration number for this country.');
  const cleaned = value.toUpperCase().replace(/\s+/g, '');
  if (country.code === 'IN') {
    check(gstinValid(cleaned) && Object.hasOwn(INDIA_STATES, cleaned.slice(0, 2)), 'INVALID_TAX_ID', 'Check your GSTIN.');
  } else {
    check(new RegExp(country.tax.idPattern as string).test(cleaned), 'INVALID_TAX_ID', `Check your ${country.tax.idLabel}.`);
  }
  return cleaned;
}

/** India only: a two-digit GST state code from INDIA_STATES. */
export function cleanTaxState(value: unknown): string {
  check(typeof value === 'string' && Object.hasOwn(INDIA_STATES, value.trim()), 'INVALID_TAX_ID', 'Choose your state from the list.');
  return value.trim();
}

/** India only: a six-digit SAC code for services, starting 99. */
export function cleanSacCode(value: unknown): string {
  check(typeof value === 'string' && value.length <= 20, 'INVALID_TAX_ID', 'Check your SAC code. Service codes have six digits and start with 99.');
  const cleaned = value.replace(/\s+/g, '');
  check(/^99\d{4}$/.test(cleaned), 'INVALID_TAX_ID', 'Check your SAC code. Service codes have six digits and start with 99.');
  return cleaned;
}
