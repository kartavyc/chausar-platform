// Chausar venture launcher, core (P1): the fifteen-row country table.
// Plain data. minorDigits is filled from currencyMinorDigits when listCountries() runs.
// No row is legal or tax advice; every screen that shows a note says so.
import { check } from '../../contracts.ts';
import { currencyMinorDigits } from '../../currency.ts';
import type { CountryCode, CountryProfile, DateOrder, TaxMode } from '../contracts.ts';

export const COUNTRIES_CHECKED_ON = '2026-10-15';

type Row = {
  code: CountryCode; name: string; currency: string; mode: TaxMode; label: string; standardRateBps: string;
  paymentRails: string[]; dateOrder: DateOrder; idLabel: string; idPattern: string | null; invoiceKind: 'tax-invoice' | 'invoice';
};

/** Most countries accept letters, digits and hyphens for a GST or VAT number; the owner types their own. */
const GENERIC_ID = '^[A-Z0-9][A-Z0-9-]{4,22}[A-Z0-9]$';
const STRIPE_SET = ['stripe', 'paypal', 'paddle'];

const ROWS: readonly Row[] = [
  { code: 'IN', name: 'India', currency: 'INR', mode: 'gst', label: 'GST', standardRateBps: '1800', paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice' },
  { code: 'US', name: 'United States', currency: 'USD', mode: 'sales-tax', label: 'Sales tax', standardRateBps: '0', paymentRails: ['stripe', 'paypal', 'lemon-squeezy'], dateOrder: 'month-day-year', idLabel: '', idPattern: null, invoiceKind: 'invoice' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', mode: 'vat', label: 'VAT', standardRateBps: '2000', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'VAT number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'CA', name: 'Canada', currency: 'CAD', mode: 'gst', label: 'GST', standardRateBps: '500', paymentRails: STRIPE_SET, dateOrder: 'year-month-day', idLabel: 'GST/HST number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'AU', name: 'Australia', currency: 'AUD', mode: 'gst', label: 'GST', standardRateBps: '1000', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'ABN', idPattern: '^\\d{11}$', invoiceKind: 'tax-invoice' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', mode: 'gst', label: 'GST', standardRateBps: '1500', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'GST number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', mode: 'gst', label: 'GST', standardRateBps: '900', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'GST registration number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', mode: 'vat', label: 'VAT', standardRateBps: '500', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'TRN', idPattern: '^\\d{15}$', invoiceKind: 'tax-invoice' },
  { code: 'DE', name: 'Germany', currency: 'EUR', mode: 'vat', label: 'VAT', standardRateBps: '1900', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'VAT number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'FR', name: 'France', currency: 'EUR', mode: 'vat', label: 'VAT', standardRateBps: '2000', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'VAT number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', mode: 'vat', label: 'VAT', standardRateBps: '2100', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'VAT number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', mode: 'vat', label: 'VAT', standardRateBps: '2300', paymentRails: STRIPE_SET, dateOrder: 'day-month-year', idLabel: 'VAT number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', mode: 'vat', label: 'VAT', standardRateBps: '1500', paymentRails: ['paypal', 'paddle', 'lemon-squeezy'], dateOrder: 'year-month-day', idLabel: 'VAT number', idPattern: GENERIC_ID, invoiceKind: 'tax-invoice' },
  { code: 'JP', name: 'Japan', currency: 'JPY', mode: 'vat', label: 'Consumption tax', standardRateBps: '1000', paymentRails: STRIPE_SET, dateOrder: 'year-month-day', idLabel: 'Registration number', idPattern: '^T\\d{13}$', invoiceKind: 'tax-invoice' },
  { code: 'XX', name: 'Another country (prices in US dollars)', currency: 'USD', mode: 'none', label: 'Tax', standardRateBps: '0', paymentRails: ['paypal', 'lemon-squeezy', 'paddle'], dateOrder: 'day-month-year', idLabel: '', idPattern: null, invoiceKind: 'invoice' },
];

/**
 * A tax label as it reads inside a sentence: acronyms stay ('GST', 'VAT'), other labels start lower case
 * ('sales tax', 'consumption tax', 'tax'), so a question never shows a capital in the middle.
 */
export function taxWord(label: string): string {
  return /^[A-Z]{2,}$/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

function registrationNote(row: Row): string {
  if (row.code === 'IN') return 'Service businesses usually register for GST above a yearly turnover of INR 20 lakh (INR 10 lakh in special category states). Some must register earlier. Check with a CA.';
  if (row.code === 'US') return 'Sales tax on services depends on the state. Chausar adds none unless you turn tax on and enter your rate on your plan.';
  if (row.code === 'CA') return 'Whether you must charge GST depends on your turnover and where your clients are. Provinces with HST charge a higher combined rate, so enter your own rate on your plan. Check with a local accountant.';
  if (row.code === 'XX') return 'Chausar adds no tax unless you turn tax on and enter your rate on your plan.';
  return `Whether you must charge ${taxWord(row.label)} depends on your turnover and where your clients are. Check with a local accountant.`;
}

function complianceNotes(code: CountryCode): string[] {
  if (code === 'IN') return [
    'Customer personal data falls under the DPDP Act and its rules.',
    'Commercial SMS needs DLT registration, so Chausar does not send SMS.',
    'Export of services is zero-rated only under an LUT and with payment in foreign currency. Check with a CA.',
  ];
  if (['DE', 'FR', 'NL', 'IE'].includes(code)) return [
    'Customer personal data falls under the GDPR.',
    'Cross-border VAT rules such as reverse charge are not handled here.',
  ];
  if (code === 'GB') return ['Customer personal data falls under the UK GDPR.'];
  if (code === 'US') return ['Marketing email must follow CAN-SPAM.'];
  return [];
}

function profile(row: Row): CountryProfile {
  return {
    code: row.code,
    name: row.name,
    currency: row.currency,
    minorDigits: currencyMinorDigits(row.currency),
    region: row.code === 'IN' ? 'india' : 'global',
    tax: {
      mode: row.mode,
      label: row.label,
      standardRateBps: row.standardRateBps,
      registrationNote: registrationNote(row),
      idLabel: row.idLabel,
      idPattern: row.idPattern,
      invoiceKind: row.invoiceKind,
      checkedOn: COUNTRIES_CHECKED_ON,
    },
    paymentRails: [...row.paymentRails],
    dateOrder: row.dateOrder,
    complianceNotes: complianceNotes(row.code),
  };
}

/** Answers venture.countries. Fifteen rows in table order, each a fresh copy. Needs no vault. */
export function listCountries(): CountryProfile[] {
  return ROWS.map(profile);
}

/** The profile for a code, or UNKNOWN_COUNTRY. */
export function countryProfile(code: unknown): CountryProfile {
  const row = typeof code === 'string' ? ROWS.find(r => r.code === code) : undefined;
  check(row, 'UNKNOWN_COUNTRY', 'Choose a country from the list.');
  return profile(row);
}
