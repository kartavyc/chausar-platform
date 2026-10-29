// The price arithmetic. Pure BigInt code on integer minor-unit strings: no model, no state, no floats.
// Every step is returned with the inputs it used and the rounding rule, so a receipt can show its work.
import { check } from '../../portable.ts';
import { currencyMinorDigits } from '../../currency.ts';
import type { BpsString, MinorString, PriceStep, TaxTreatment } from './price-types.ts';

export const TAX_TREATMENTS: readonly TaxTreatment[] = Object.freeze(['none', 'single', 'cgst-sgst', 'igst', 'zero-rated-lut'] as const);

export type PriceInput = {
  unitPriceMinor: MinorString;
  quantity: string;
  discountBps: BpsString;
  taxRateBps: BpsString;
  currency: string;
  taxTreatment: TaxTreatment;
};

export type PriceAmounts = {
  unit: MinorString;
  subtotal: MinorString;
  discount: MinorString;
  taxable: MinorString;
  tax: MinorString;
  cgst: MinorString | null;
  sgst: MinorString | null;
  igst: MinorString | null;
  total: MinorString;
};

/** The rule text written into every receipt step. Engine words, never model words. */
export const PRICE_RULES = Object.freeze({
  multiply: 'unit price times quantity',
  discount: 'discount in basis points, rounded half up to the minor unit',
  taxable: 'subtotal less the discount',
  none: 'no tax added, because tax is not turned on for this price',
  single: 'tax in basis points, rounded half up to the minor unit',
  split: 'CGST and SGST each at half the rate, each rounded half up to the minor unit, so their sum can differ by one from a single rate',
  splitSum: 'CGST plus SGST',
  igst: 'IGST at the full rate, rounded half up to the minor unit',
  lut: 'export of services under LUT, zero-rated',
  total: 'amount before tax plus tax',
});

const MAX_AMOUNT_DIGITS = 30;

/** Rounds a basis-point product half up to the minor unit: (n + 5000) / 10000. */
function half(n: bigint): bigint {
  return (n + 5000n) / 10000n;
}

/** Rounds a half-rate basis-point product half up to the minor unit: (n + 10000) / 20000. */
function halfOfHalf(n: bigint): bigint {
  return (n + 10000n) / 20000n;
}

function wholeText(value: unknown, field: string, code: string, min: bigint, max: bigint | null): bigint {
  const pattern = new RegExp(`^(0|[1-9][0-9]{0,${MAX_AMOUNT_DIGITS - 1}})$`);
  const range = max === null ? `${min} or more` : `from ${min} to ${max}`;
  check(typeof value === 'string' && pattern.test(value), code, `${field} must be a whole number ${range}.`);
  const parsed = BigInt(value);
  check(parsed >= min && (max === null || parsed <= max), code, `${field} must be a whole number ${range}.`);
  return parsed;
}

/**
 * Prices one line. All inputs are non-negative integer strings; quantity 1 to 10000; basis points 0 to 10000.
 * subtotal = unit x quantity; discount = half(subtotal x discountBps); taxable = subtotal - discount;
 * tax by treatment (see PRICE_RULES); total = taxable + tax.
 */
export function computePrice(input: PriceInput): { steps: PriceStep[]; amounts: PriceAmounts } {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_VENTURE_REQUEST', 'Send one price request.');
  const unit = wholeText(input.unitPriceMinor, 'The unit price', 'INVALID_AMOUNT', 0n, null);
  const quantity = wholeText(input.quantity, 'The quantity', 'INVALID_VENTURE_REQUEST', 1n, 10000n);
  const discountBps = wholeText(input.discountBps, 'The discount', 'INVALID_VENTURE_REQUEST', 0n, 10000n);
  const taxRateBps = wholeText(input.taxRateBps, 'The tax rate', 'INVALID_TAX_RATE', 0n, 10000n);
  currencyMinorDigits(input.currency);
  check(TAX_TREATMENTS.includes(input.taxTreatment), 'INVALID_VENTURE_REQUEST', 'Choose a known tax treatment.');
  if (input.taxTreatment === 'none') check(taxRateBps === 0n, 'INVALID_TAX_RATE', 'A price without tax must use a tax rate of zero.');

  const steps: PriceStep[] = [];
  const subtotal = unit * quantity;
  steps.push({ op: 'multiply', inputs: [String(unit), String(quantity)], resultMinor: String(subtotal), rule: PRICE_RULES.multiply });
  const discount = half(subtotal * discountBps);
  steps.push({ op: 'discount', inputs: [String(subtotal), String(discountBps)], resultMinor: String(discount), rule: PRICE_RULES.discount });
  const taxable = subtotal - discount;
  steps.push({ op: 'discount', inputs: [String(subtotal), String(discount)], resultMinor: String(taxable), rule: PRICE_RULES.taxable });

  let tax = 0n;
  let cgst: bigint | null = null, sgst: bigint | null = null, igst: bigint | null = null;
  const rate = String(taxRateBps);
  switch (input.taxTreatment) {
    case 'none':
      steps.push({ op: 'tax', inputs: [String(taxable), rate], resultMinor: '0', rule: PRICE_RULES.none });
      break;
    case 'single':
      tax = half(taxable * taxRateBps);
      steps.push({ op: 'tax', inputs: [String(taxable), rate], resultMinor: String(tax), rule: PRICE_RULES.single });
      break;
    case 'cgst-sgst':
      cgst = halfOfHalf(taxable * taxRateBps);
      sgst = halfOfHalf(taxable * taxRateBps);
      steps.push({ op: 'tax-split', inputs: [String(taxable), rate], resultMinor: String(cgst), rule: PRICE_RULES.split });
      steps.push({ op: 'tax-split', inputs: [String(taxable), rate], resultMinor: String(sgst), rule: PRICE_RULES.split });
      tax = cgst + sgst;
      steps.push({ op: 'add', inputs: [String(cgst), String(sgst)], resultMinor: String(tax), rule: PRICE_RULES.splitSum });
      break;
    case 'igst':
      igst = half(taxable * taxRateBps);
      tax = igst;
      steps.push({ op: 'tax', inputs: [String(taxable), rate], resultMinor: String(igst), rule: PRICE_RULES.igst });
      break;
    case 'zero-rated-lut':
      steps.push({ op: 'tax', inputs: [String(taxable)], resultMinor: '0', rule: PRICE_RULES.lut });
      break;
  }
  const total = taxable + tax;
  steps.push({ op: 'add', inputs: [String(taxable), String(tax)], resultMinor: String(total), rule: PRICE_RULES.total });

  return {
    steps,
    amounts: {
      unit: String(unit), subtotal: String(subtotal), discount: String(discount), taxable: String(taxable), tax: String(tax),
      cgst: cgst === null ? null : String(cgst), sgst: sgst === null ? null : String(sgst), igst: igst === null ? null : String(igst),
      total: String(total),
    },
  };
}
