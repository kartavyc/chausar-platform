// Canonical browser-safe types, shared by the engine and renderer.


export type BpsString=string;

export type PriceStep={op:'multiply'|'discount'|'tax'|'tax-split'|'add';inputs:string[];resultMinor:MinorString;rule:string};

export type MinorString=string;

export type TaxTreatment='none'|'single'|'cgst-sgst'|'igst'|'zero-rated-lut';
