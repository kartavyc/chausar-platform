// Portable exact integer price types shared by native receipts and browser rehearsal.
export type BpsString=string;
export type MinorString=string;
export type TaxTreatment='none'|'single'|'cgst-sgst'|'igst'|'zero-rated-lut';
export type PriceStep={op:'multiply'|'discount'|'tax'|'tax-split'|'add';inputs:string[];resultMinor:MinorString;rule:string};
