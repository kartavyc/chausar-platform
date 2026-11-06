// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M15): Indian invoice tax kinds beside normal GST.
// A tax-included price is split by code into the amount before tax and the tax, in BigInt, each step with its rule, so
// the total stays exactly the price the owner agreed. TDS the client deducts is kept on the payment with the section the
// client named, and settles the invoice pending the client's TDS certificate; it is never money received. A draft whose
// rate is no longer the plan's says so; it keeps the rate charged until the owner drafts it again. A business not
// registered for GST never sees any of it: taxDecision gives it 'none', and none of this applies.
import { check, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { listRecords } from '../records.ts';
import { computePrice, PRICE_RULES, type PriceAmounts, type PriceInput } from './price.ts';
import { ratePercent, taxDecision } from './tax.ts';
import type { InvoiceRecord, InvoiceView, PriceStep, VentureRecord } from '../contracts.ts';

/** The rule text written into a tax-included receipt's steps. Engine words, never model words. */
export const INCLUSIVE_RULES = Object.freeze({
  multiply: 'unit price times quantity, tax included',
  split: 'tax included in the price: the amount before tax per unit is the price times 10000 over 10000 plus the rate, rounded half up to the minor unit, times the quantity; the tax is the rest, so the total stays the price',
  taxable: 'amount before tax: the price less the tax',
  halves: 'CGST is half the tax, rounded half up to the minor unit; SGST is the rest, so the two add up to the tax exactly',
});

/** Treatments a tax-included price is split for: the ones that charge a rate. */
export function splitsInclusive(treatment: PriceInput['taxTreatment']): boolean {
  return treatment === 'single' || treatment === 'cgst-sgst' || treatment === 'igst';
}

/** The amount before tax in one tax-included unit: (unit x 10000 x 2 + (10000 + rate)) / (2 x (10000 + rate)), half up. */
export function inclusiveUnit(unitPriceMinor: string, taxRateBps: string): bigint {
  const divisor = 10000n + BigInt(taxRateBps);
  return (BigInt(unitPriceMinor) * 10000n * 2n + divisor) / (2n * divisor);
}

const unitsWord = (n: bigint) => `${n} minor unit${n === 1n ? '' : 's'}`;

/**
 * Prices one line whose unit price already includes the tax. Inputs are checked exactly as computePrice checks them,
 * and the discount must be zero. Per unit: the amount before tax is inclusiveUnit, half up; times the quantity; the tax
 * is the tax-included total less that; CGST is half the tax half up, SGST the rest. When that tax is not the amount
 * before tax times the rate (the per-unit rounding drifted with the quantity), the difference goes on the line, if an
 * amount within 2 minor units gives the price exactly at the rate; if none does, the tax stays the rest of the price and
 * a step says why. The total is always exactly the price.
 */
export function computeInclusivePrice(input: PriceInput): { steps: PriceStep[]; amounts: PriceAmounts } {
  computePrice(input); // the same checks on every input; its amounts are not used
  check(splitsInclusive(input.taxTreatment), 'INVALID_VENTURE_REQUEST', 'Only a price with tax on it can include the tax.');
  check(input.discountBps === '0', 'INVALID_VENTURE_REQUEST', 'A tax-included price has no discount.');
  const unit = BigInt(input.unitPriceMinor), quantity = BigInt(input.quantity), rate = BigInt(input.taxRateBps);
  const gross = unit * quantity;
  const perUnit = inclusiveUnit(input.unitPriceMinor, input.taxRateBps) * quantity;
  const taxAt = (amount: bigint) => (amount * rate + 5000n) / 10000n;
  const steps: PriceStep[] = [{ op: 'multiply', inputs: [String(unit), String(quantity)], resultMinor: String(gross), rule: INCLUSIVE_RULES.multiply }];
  let taxable = perUnit;
  if (perUnit + taxAt(perUnit) !== gross) {
    const fit = [-1n, 1n, -2n, 2n].map(delta => perUnit + delta).find(amount => amount > 0n && amount + taxAt(amount) === gross);
    if (fit !== undefined) {
      taxable = fit;
      const off = fit > perUnit ? fit - perUnit : perUnit - fit;
      steps.push({ op: 'discount', inputs: [String(perUnit), String(fit - perUnit)], resultMinor: String(fit),
        rule: `the per-unit rounding was ${unitsWord(off)} off; it is on the line, so the tax is the amount before tax times the rate, rounded half up` });
    } else {
      const rest = gross - perUnit, at = taxAt(perUnit);
      steps.push({ op: 'tax', inputs: [String(perUnit), String(rate)], resultMinor: String(at),
        rule: `no amount before tax gives exactly this price at this rate, so the tax is the rest of the price: ${unitsWord(rest > at ? rest - at : at - rest)} off the amount before tax times the rate` });
    }
  }
  const tax = gross - taxable;
  steps.push(
    { op: 'tax', inputs: [String(unit), String(rate), String(quantity)], resultMinor: String(tax), rule: INCLUSIVE_RULES.split },
    { op: 'discount', inputs: [String(gross), String(tax)], resultMinor: String(taxable), rule: INCLUSIVE_RULES.taxable },
  );
  let cgst: bigint | null = null, sgst: bigint | null = null, igst: bigint | null = null;
  if (input.taxTreatment === 'cgst-sgst') {
    cgst = (tax + 1n) / 2n;
    sgst = tax - cgst;
    steps.push({ op: 'tax-split', inputs: [String(tax)], resultMinor: String(cgst), rule: INCLUSIVE_RULES.halves });
    steps.push({ op: 'tax-split', inputs: [String(tax), String(cgst)], resultMinor: String(sgst), rule: INCLUSIVE_RULES.halves });
  } else if (input.taxTreatment === 'igst') {
    igst = tax;
  }
  steps.push({ op: 'add', inputs: [String(taxable), String(tax)], resultMinor: String(gross), rule: PRICE_RULES.total });
  return {
    steps,
    amounts: {
      unit: String(unit), subtotal: String(taxable), discount: '0', taxable: String(taxable), tax: String(tax),
      cgst: cgst === null ? null : String(cgst), sgst: sgst === null ? null : String(sgst), igst: igst === null ? null : String(igst),
      total: String(gross),
    },
  };
}

// ---------------------------------------------------------------------------
// TDS the client deducts (India)
// ---------------------------------------------------------------------------

/** The section the client named on their remittance ('194J', '393(1) Table 6(iii)'), as one short line. */
export function tdsSection(value: unknown): string {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ().,/-]{0,39}$/.test(value.trim()), 'INVALID_VENTURE_REQUEST',
    'Give the TDS section as the client wrote it, like 194J.');
  return value.trim();
}

/** "TDS INR 1,975.00 under 194J, to be shown on the client's TDS certificate." */
export function tdsLine(tds: { section: string; amountMinor: string }, currency: string): string {
  return `TDS ${formatMinor(tds.amountMinor, currency)} under ${tds.section}, to be shown on the client's TDS certificate.`;
}

// ---------------------------------------------------------------------------
// A rate change on drafts
// ---------------------------------------------------------------------------

/**
 * A draft invoice whose rate is no longer what the accepted plan charges this client: the rate it keeps, the rate now,
 * and the words. Issued invoices keep their rate for good, so they never have one.
 */
export function rateChangeOf(state: State, venture: VentureRecord, invoice: InvoiceRecord): InvoiceView['rateChange'] {
  if (invoice.status !== 'draft') return undefined;
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId && item.status === 'accepted');
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === invoice.clientId);
  if (!plan || !client) return undefined;
  const now = taxDecision(plan.backOffice, client, venture.country).rateBps;
  const charged = invoice.taxRateBps;
  if (now === charged) return undefined;
  const label = plan.backOffice.taxLabel.trim() || 'Tax';
  const line = now === '0'
    ? `This business does not charge ${label} now. This draft keeps ${ratePercent(charged)}%, the rate when it was drafted. Draft it again to leave ${label} off.`
    : charged === '0'
      ? `${label} is ${ratePercent(now)}% now. This draft has no ${label}, as when it was drafted. Draft it again to add it.`
      : `${label} is ${ratePercent(now)}% now. This draft keeps ${ratePercent(charged)}%, the rate when it was drafted. Draft it again to use ${ratePercent(now)}%.`;
  return { charged, now, line };
}
