// Canonical browser-safe types, shared by the engine and renderer.


export type CountryCode = string;

export type CountryProfile = {
  code: CountryCode;
  name: string;
  currency: string; // ISO 4217
  minorDigits: number; // from currencyMinorDigits(currency)
  region: 'india' | 'global';
  tax: {
    mode: TaxMode;
    label: string; // 'GST', 'VAT', 'Sales tax', 'Consumption tax', 'Tax'
    standardRateBps: string; // prefill for the owner's rate; '0' when it varies by place or is unknown
    registrationNote: string; // plain sentence, never advice
    idLabel: string; // 'GSTIN', 'VAT number', 'ABN' ...; '' when invoiceKind is 'invoice'
    idPattern: string | null; // RegExp source for the registration number; null for IN (GSTIN checksum) and when idLabel is ''
    invoiceKind: 'tax-invoice' | 'invoice'; // 'tax-invoice' for gst and vat countries
    checkedOn: string;
  };
  paymentRails: string[]; // connector ids, first is the default
  dateOrder: DateOrder;
  complianceNotes: string[];
};

export type TaxMode = 'gst' | 'vat' | 'sales-tax' | 'none';

export type DateOrder = 'day-month-year' | 'month-day-year' | 'year-month-day';
