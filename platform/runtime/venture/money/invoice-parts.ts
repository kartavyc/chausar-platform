// Wave 6 money (6D1): cutting an order into several invoices (an advance, milestones, a part payment, the final one).
// Pure BigInt code, portable, so the fake engine cuts with the same rules. An advance or milestone takes a share in basis
// points of the order's amount before tax, rounded half up; a part payment takes an amount before tax the owner typed;
// the tax on each is worked out fresh at the order's rate (price.ts). The final invoice takes the exact rest of every
// figure (amount before tax, each tax line, total), so the invoices of an order add up to its receipt to the minor unit.
// Nothing may bill more than is left: a cut whose amount before tax, any tax line or total passes the rest is refused.
import { check } from '../../portable.ts';
import { decimalMinor } from '../../currency.ts';
import { computePrice } from './price.ts';
import type { BpsString, PriceStep, TaxTreatment } from './price-types.ts';
import type { InvoicePart } from './billing-types.ts';

export type PartKind = InvoicePart['kind'];
export const PART_KINDS: readonly PartKind[] = Object.freeze(['advance', 'milestone', 'partial', 'final'] as const);
/** The words a part is called on its line when the owner names none. */
export const PART_WORDS: Readonly<Record<PartKind, string>> = Object.freeze({ advance: 'Advance', milestone: 'Milestone', partial: 'Part payment', final: 'Final invoice' });

/** What the owner asked to bill: the kind, its name, and the share (advance, milestone) or amount before tax (partial). */
export type PartAsk = { kind: PartKind; label: string; shareBps: bigint | null; taxableMinor: bigint | null };
/** An order's figures, or what invoices on it billed: amount before tax, the tax lines in document order, total. */
export type PartSums = { taxable: bigint; lines: bigint[]; total: bigint };
/** One invoice's cut of its order. final: it took the rest of every figure. */
export type PartCut = PartSums & { final: boolean; tax: bigint; steps: PriceStep[] };

const LABEL = /^[^\u0000-\u001F\u007F]{1,60}$/;

/** A percent as typed ('50', '12.5') in basis points, above 0 and below 100. */
export function shareOf(value: unknown): bigint {
  check(typeof value === 'string' && /^\d{1,2}(?:\.\d{1,2})?$/.test(value.trim()), 'INVALID_VENTURE_REQUEST', 'A share of the order is a percent above 0 and below 100, like 50 or 12.5.');
  const [whole, fraction = ''] = value.trim().split('.');
  const bps = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  check(bps > 0n && bps < 10000n, 'INVALID_VENTURE_REQUEST', 'A share of the order is a percent above 0 and below 100, like 50 or 12.5.');
  return bps;
}

/** The part a payload asks for: { kind, label?, percent? (advance, milestone), amount? (partial, before tax) }. */
export function partAskOf(value: unknown, currency: string): PartAsk {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Say which part of the order this invoice bills.');
  const body = value as Record<string, unknown>;
  check(Object.keys(body).every(key => ['kind', 'label', 'percent', 'amount'].includes(key)), 'INVALID_VENTURE_REQUEST', 'Send the kind of invoice, its name, and a percent or an amount.');
  check(typeof body.kind === 'string' && (PART_KINDS as readonly string[]).includes(body.kind), 'INVALID_VENTURE_REQUEST', 'Choose an advance, a milestone, a part payment or the final invoice.');
  const kind = body.kind as PartKind;
  check(body.label === undefined || (typeof body.label === 'string' && LABEL.test(body.label.trim())), 'INVALID_VENTURE_REQUEST', 'Name the invoice in one line of up to 60 characters.');
  const label = typeof body.label === 'string' ? body.label.trim().replace(/\s+/g, ' ') : PART_WORDS[kind];
  if (kind === 'final') {
    check(body.percent === undefined && body.amount === undefined, 'INVALID_VENTURE_REQUEST', 'The final invoice bills what is left; send no percent or amount.');
    return { kind, label, shareBps: null, taxableMinor: null };
  }
  if (kind === 'partial') {
    check(body.percent === undefined && typeof body.amount === 'string', 'INVALID_VENTURE_REQUEST', 'Type the amount before tax this invoice bills.');
    const typed = (body.amount as string).replace(/[\s,]/g, '');
    check(/^\d+(?:\.\d+)?$/.test(typed), 'INVALID_AMOUNT', 'The amount must be a positive amount like 2499 or 2499.50.');
    const minor = BigInt(decimalMinor(typed, currency));
    check(minor > 0n, 'INVALID_AMOUNT', 'The amount must be above zero.');
    return { kind, label, shareBps: null, taxableMinor: minor };
  }
  check(body.amount === undefined && body.percent !== undefined, 'INVALID_VENTURE_REQUEST', 'Give the share of the order as a percent, like 50.');
  return { kind, label, shareBps: shareOf(body.percent), taxableMinor: null };
}

/** The tax lines of a treatment's amounts, in the order a document lists them. */
function linesOf(treatment: TaxTreatment, amounts: { tax: string; cgst: string | null; sgst: string | null; igst: string | null }): bigint[] {
  if (treatment === 'cgst-sgst') return [BigInt(amounts.cgst ?? '0'), BigInt(amounts.sgst ?? '0')];
  if (treatment === 'igst') return [BigInt(amounts.igst ?? '0')];
  if (treatment === 'single' || treatment === 'zero-rated-lut') return [BigInt(amounts.tax)];
  return [];
}

/** The rest of an order after what earlier invoices billed. */
export function restOf(basis: PartSums, billed: PartSums): PartSums {
  return { taxable: basis.taxable - billed.taxable, lines: basis.lines.map((line, index) => line - (billed.lines[index] ?? 0n)), total: basis.total - billed.total };
}

const RULE_REST = "the order's figure less what earlier invoices billed, so the invoices add up to the order exactly";

/**
 * One invoice's cut: refuses when nothing is left (QUOTE_ALREADY_INVOICED) or the cut passes the rest
 * (ORDER_OVER_INVOICED). A share or amount that takes all that is left before tax becomes the final cut.
 */
export function cutPart(basis: PartSums, billed: PartSums, ask: PartAsk, rate: { taxRateBps: BpsString; treatment: TaxTreatment; currency: string }): PartCut {
  const rest = restOf(basis, billed);
  check(rest.total > 0n && rest.taxable > 0n, 'QUOTE_ALREADY_INVOICED', 'This order is billed in full already. Change the order before you bill more.');
  const taxable = ask.kind === 'final' ? rest.taxable
    : ask.taxableMinor !== null ? ask.taxableMinor
      : (basis.taxable * (ask.shareBps ?? 0n) + 5000n) / 10000n;
  check(taxable > 0n, 'INVALID_AMOUNT', 'This share is less than one minor unit of the order.');
  check(taxable <= rest.taxable, 'ORDER_OVER_INVOICED', 'This is more than is left to bill on this order. Bill the rest with the final invoice, or change the order first.');
  if (taxable === rest.taxable) {
    const steps: PriceStep[] = [
      { op: 'discount', inputs: [String(basis.taxable), String(billed.taxable)], resultMinor: String(rest.taxable), rule: RULE_REST },
      ...rest.lines.map((line, index): PriceStep => ({ op: 'discount', inputs: [String(basis.lines[index]), String(billed.lines[index] ?? 0n)], resultMinor: String(line), rule: RULE_REST })),
      { op: 'discount', inputs: [String(basis.total), String(billed.total)], resultMinor: String(rest.total), rule: RULE_REST },
    ];
    check(rest.lines.every(line => line >= 0n) && rest.taxable + rest.lines.reduce((sum, line) => sum + line, 0n) === rest.total, 'ORDER_OVER_INVOICED', 'The invoices on this order no longer add up to it. Look at them before you bill more.');
    return { ...rest, final: true, tax: rest.total - rest.taxable, steps };
  }
  const priced = computePrice({ unitPriceMinor: String(taxable), quantity: '1', discountBps: '0', taxRateBps: rate.taxRateBps, currency: rate.currency, taxTreatment: rate.treatment });
  const lines = linesOf(rate.treatment, priced.amounts);
  const total = BigInt(priced.amounts.total);
  check(total <= rest.total && lines.every((line, index) => line <= (rest.lines[index] ?? 0n)), 'ORDER_OVER_INVOICED', 'This is more than is left to bill on this order. Bill the rest with the final invoice, or change the order first.');
  return { taxable, lines, total, final: false, tax: BigInt(priced.amounts.tax), steps: priced.steps };
}
