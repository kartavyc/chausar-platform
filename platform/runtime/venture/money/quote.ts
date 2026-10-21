// Price receipts: the proof behind every price Chausar shows. Built inside a venture transaction from the
// owner's own price and tax settings by pure arithmetic; the explanation is an engine template, never model text.
import { check, type Context } from '../../contracts.ts';
import { numberGuard } from '../../calculator.ts';
import { currencyMinorDigits, formatMinor } from '../../currency.ts';
import { digest, exactPayload, listRecords, readVenture, ventureAction, type VentureTx } from '../records.ts';
import { computePrice, type PriceAmounts } from './price.ts';
import { halfRatePercent, ratePercent, taxDecision, type TaxDecision } from './tax.ts';
import { latestBlueprint, oneLine, quantityText, recordId, requireLatestBlueprint, requireOffer, requirePrice } from './shared.ts';
import type { BlueprintRecord, ClientRecord, MinorString, Offer, PriceFigure, PriceReceiptRecord, SumReceiptRecord, VentureDeps } from '../contracts.ts';
import { servedSumReceipt } from './sums.ts';

export type PriceSubject = PriceReceiptRecord['subject'];

function figure(key: PriceFigure['key'], label: string, minor: MinorString, currency: string): PriceFigure {
  return { key, label, minor, display: formatMinor(minor, currency), currency };
}

/** The tax figures for a treatment, in the order a document lists them. */
export function taxFigures(amounts: PriceAmounts, decision: TaxDecision, taxLabel: string, currency: string): PriceFigure[] {
  switch (decision.treatment) {
    case 'single':
      return [figure('tax', `${taxLabel} at ${ratePercent(decision.rateBps)}%`, amounts.tax, currency)];
    case 'cgst-sgst': {
      const halfRate = halfRatePercent(decision.rateBps);
      return [
        figure('cgst', `CGST at ${halfRate}%`, amounts.cgst ?? '0', currency),
        figure('sgst', `SGST at ${halfRate}%`, amounts.sgst ?? '0', currency),
        figure('tax', 'GST total', amounts.tax, currency),
      ];
    }
    case 'igst':
      return [figure('igst', `IGST at ${ratePercent(decision.rateBps)}%`, amounts.igst ?? '0', currency), figure('tax', 'GST total', amounts.tax, currency)];
    case 'zero-rated-lut':
      return [figure('tax', 'GST, zero-rated export under LUT', amounts.tax, currency)];
    case 'none':
      return [figure('tax', 'Tax', amounts.tax, currency)];
  }
}

/** Every figure of a price receipt: unit, subtotal, discount, amount before tax, the tax figures, then the total. */
export function priceFigures(amounts: PriceAmounts, decision: TaxDecision, taxLabel: string, quantityUnit: string, currency: string): PriceFigure[] {
  return [
    figure('unit', `Price per ${quantityUnit}`, amounts.unit, currency),
    figure('subtotal', 'Subtotal', amounts.subtotal, currency),
    figure('discount', 'Discount', amounts.discount, currency),
    figure('taxable', 'Amount before tax', amounts.taxable, currency),
    ...taxFigures(amounts, decision, taxLabel, currency),
    figure('total', 'Total', amounts.total, currency),
  ];
}

function display(figures: PriceFigure[], key: PriceFigure['key']): string {
  const found = figures.find(f => f.key === key);
  check(found, 'INVALID_VENTURE_REQUEST', 'A receipt figure is missing.');
  return found.display;
}

/** The explanation sentence, built from the figures by template. */
export function priceExplanation(figures: PriceFigure[], decision: TaxDecision, taxLabel: string, quantity: string, quantityUnit: string, taxMinor: MinorString): string {
  const base = `${quantity} x ${quantityUnit} at ${display(figures, 'unit')}`;
  const total = display(figures, 'total');
  if (decision.treatment === 'zero-rated-lut') return `${base}, zero-rated as an export of services under LUT = ${total}.`;
  const place = decision.treatment === 'cgst-sgst' && decision.stateAssumed ? ' Place of supply taken as your own state.' : '';
  if (decision.treatment === 'none' || BigInt(taxMinor) === 0n) return `${base} = ${total}.${place}`;
  if (decision.treatment === 'single') return `${base}, plus ${taxLabel} at ${ratePercent(decision.rateBps)}% (${display(figures, 'tax')}) = ${total}.`;
  if (decision.treatment === 'igst') return `${base}, plus IGST at ${ratePercent(decision.rateBps)}% (${display(figures, 'igst')}) = ${total}.`;
  const halfRate = halfRatePercent(decision.rateBps);
  return `${base}, plus CGST at ${halfRate}% (${display(figures, 'cgst')}) and SGST at ${halfRate}% (${display(figures, 'sgst')}) = ${total}.${place}`;
}

/**
 * Plain numbers a later sentence may cite, for numberGuard: each figure's minor text, each display number without
 * its currency code and thousands commas ('2948.82'), the quantity, and every rate as percent text ('18', '9').
 */
export function priceAllowedNumbers(figures: PriceFigure[], quantity: string, decision: TaxDecision): string[] {
  const numbers: string[] = [];
  for (const f of figures) {
    numbers.push(f.minor);
    numbers.push(f.display.slice(f.currency.length + 1).replace(/,/g, ''));
  }
  numbers.push(quantity, ratePercent(decision.rateBps));
  if (decision.treatment === 'cgst-sgst') numbers.push(halfRatePercent(decision.rateBps));
  return [...new Set(numbers)];
}

/** The digest covers everything a receipt says except its id, its time, the digest itself and the stale flag. */
export function receiptDigest(record: PriceReceiptRecord): string {
  const { id: _id, at: _at, digest: _digest, stale: _stale, ...body } = record;
  return digest(body);
}

/**
 * Creates a venture-price-receipt inside a transaction. Pure arithmetic only: no store, calculator or model call.
 * The unit price is the owner's own; the tax rate and its source come from the blueprint; the treatment from
 * taxDecision. The receipt records the blueprint version priced by its digest.
 */
export function buildPriceReceipt(
  tx: VentureTx, subject: PriceSubject, inputs: { quantity: string },
  blueprint: BlueprintRecord, offer: Offer, client: ClientRecord | null,
): PriceReceiptRecord {
  check(tx.venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const backOffice = blueprint.backOffice;
  const currency = backOffice.currency;
  check(currency === tx.venture.country.currency, 'CURRENCY_CONFLICT', `This business keeps its books in ${tx.venture.country.currency}.`);
  const unitPriceMinor = requirePrice(offer);
  const decision = taxDecision(backOffice, client, tx.venture.country);
  const priced = computePrice({ unitPriceMinor, quantity: inputs.quantity, discountBps: '0', taxRateBps: decision.rateBps, currency, taxTreatment: decision.treatment });
  const taxLabel = oneLine(backOffice.taxLabel);
  const quantityUnit = offer.pricing.quantityUnit;
  const figures = priceFigures(priced.amounts, decision, taxLabel, quantityUnit, currency);
  const explanation = priceExplanation(figures, decision, taxLabel, inputs.quantity, quantityUnit, priced.amounts.tax);
  const record: PriceReceiptRecord = {
    ...tx.base('venture-price-receipt'),
    subject: { ...subject },
    operation: 'venture.price',
    currency,
    minorDigits: currencyMinorDigits(currency),
    inputs: {
      unitPriceMinor,
      quantity: inputs.quantity,
      discountBps: '0',
      taxMode: backOffice.taxMode,
      taxRateBps: decision.rateBps,
      taxTreatment: decision.treatment,
      unitPriceBy: 'told-by-you',
      taxRateBy: backOffice.taxRateBy,
      blueprintDigest: blueprint.digest,
    },
    steps: priced.steps,
    figures,
    totalMinor: priced.amounts.total,
    allowedNumbers: priceAllowedNumbers(figures, inputs.quantity, decision),
    explanation,
    digest: '',
    stale: false,
  };
  numberGuard(record.explanation, record);
  record.digest = receiptDigest(record);
  return tx.put(record);
}

/** One figure of a receipt by key, or null. */
export function receiptFigure(receipt: PriceReceiptRecord, key: PriceFigure['key']): PriceFigure | null {
  return receipt.figures.find(f => f.key === key) ?? null;
}

/** The amount before tax of a receipt (the 'taxable' figure). */
export function receiptTaxable(receipt: PriceReceiptRecord): MinorString {
  const taxable = receiptFigure(receipt, 'taxable');
  check(taxable, 'RECEIPT_NOT_FOUND', 'This price receipt is missing its amount before tax.');
  return taxable.minor;
}

/**
 * venture.price.quote (level prepare). Prices an offer of the latest blueprint version, draft or accepted, so the
 * plan can show receipts before the owner accepts it. No client, so the treatment is 'single' or 'none'.
 */
export async function quotePrice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PriceReceiptRecord> {
  const body = exactPayload(payload, ['offerId', 'quantity'], ['offerId']);
  const offerId = recordId(body.offerId, 'Offer');
  const quantity = body.quantity === undefined ? null : quantityText(body.quantity);
  return ventureAction(deps, ctx, 'prepare', 'price.quote', tx => {
    const blueprint = requireLatestBlueprint(tx.list('venture-blueprint'));
    const offer = requireOffer(blueprint, offerId);
    requirePrice(offer);
    const receipt = buildPriceReceipt(tx, { type: 'offer', offerId: offer.id }, { quantity: quantity ?? offer.pricing.defaultQuantity }, blueprint, offer, null);
    tx.emit('price-quoted', { receiptId: receipt.id, offerId: offer.id });
    return receipt;
  });
}

/**
 * venture.receipt.get (level read). An offer receipt reads stale once the latest blueprint version has a different
 * digest from the one it priced. A sum receipt (sums.ts: owed, received, spent) reads stale once its subject adds up
 * to something else.
 */
export async function getReceipt(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PriceReceiptRecord | SumReceiptRecord> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = recordId(body.id, 'Receipt');
  const { state, venture } = readVenture(deps, ctx);
  const sum = listRecords(state, 'venture-sum-receipt', venture.id).find(r => r.id === id);
  if (sum) return servedSumReceipt(state, venture, sum);
  const receipt = listRecords(state, 'venture-price-receipt', venture.id).find(r => r.id === id);
  check(receipt, 'RECEIPT_NOT_FOUND', 'This price receipt was not found.');
  if (receipt.subject.type !== 'offer') return receipt;
  const latest = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  return { ...receipt, stale: receipt.stale || latest === null || latest.digest !== receipt.inputs.blueprintDigest };
}

// ---------------------------------------------------------------------------
// Quote binding for paid calls (Open Edit's rule): a quote holds one draft, one figure and one payer for one hour
// ---------------------------------------------------------------------------

/** How long a quoted figure holds. After an hour the owner has moved on and the price may have too: quote again. */
export const QUOTE_TTL_MS = 60 * 60_000;

/** What a quote binds: the digest of exactly what is paid for, the figure in whole units, and who is billed. */
export type QuoteBinding = { draftDigest: string; figure: string; payer: string };

/**
 * Refuses an approval or a spend that no longer matches its quote: QUOTE_CHANGED when the draft, the figure or the
 * payer differ in any way, QUOTE_EXPIRED when more than an hour has passed since the quote was made. Pure: the caller
 * passes the time.
 */
export function checkQuoteBinding(quoted: QuoteBinding & { quotedAt: string }, offered: QuoteBinding, nowIso: string): void {
  check(quoted.draftDigest === offered.draftDigest && quoted.figure === offered.figure && quoted.payer === offered.payer, 'QUOTE_CHANGED',
    'This changed since it was quoted: the draft, the cost or who pays. Look at the new quote.');
  check(Date.parse(nowIso) - Date.parse(quoted.quotedAt) <= QUOTE_TTL_MS, 'QUOTE_EXPIRED', 'This quote is over an hour old. Ask for a fresh one.');
}
