// Invoices: prepared from an order with a fresh price receipt, approved by digest, numbered on issue, and
// written into the books as an invoice fact. Tax invoice fields follow the owner's own settings.
// Wave 6 (6D1): an order may be billed by several invoices (an advance, milestones, a part payment, the final one), cut
// from its receipt by invoice-parts.ts; together they never pass the order's total (QUOTE_ALREADY_INVOICED,
// ORDER_OVER_INVOICED), and each is still issued only on the owner's approval of its exact digest.
// Ink v2 wave 4 (4J5): each line keeps the rate
// charged, and a tax-included price says so on its line (tax-kinds.ts splits it); recurring schedules draft through
// draftInvoiceIn; the view adds the invoice's next step, its timeline (invoice-states.ts), its credit notes, the TDS
// the client deducted and, on a draft whose rate is no longer the plan's, the rate change, which only the owner acts on.
import { formatMoney, plainMoney } from '../../owner-format.ts';
import { check, type Context, type State } from '../../contracts.ts';
import { gstinValid } from '../../memory.ts';
import {
  activateTerm, digest, exactPayload, isoDate, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx,
} from '../records.ts';
import { creditViewsOn } from './credits.ts';
import { invoiceNext, invoiceTimeline } from './invoice-states.ts';
import { inclusiveUnit, rateChangeOf, tdsLine } from './tax-kinds.ts';
import { creditedOn, paymentState } from './ledger.ts';
import { booksReceiptFor, BILLED_COVERS_MORE, EXPERIMENTAL_NOTE } from './books.ts';
import { documentText } from './document.ts';
import { addDaysUtc } from './dates.ts';
import { lateOf } from './aging.ts';
import { hasCountry } from './figure-kinds.ts';
import { localDayAt } from '../local-day.ts';
import { insertBooksFact, invoiceFact } from './facts.ts';
import { buildPriceReceipt, priceAllowedNumbers, priceFigures, receiptDigest, receiptFigure, receiptTaxable } from './quote.ts';
import { halfRateBps, halfRatePercent, ratePercent, stateName, taxDecision, type TaxDecision } from './tax.ts';
import { billingOf } from './billing.ts';
import { dueDaysOf, reminderDaysOf } from './billing-rules.ts';
import { cutPart, partAskOf, PART_WORDS, type PartAsk, type PartCut, type PartSums } from './invoice-parts.ts';
import { daysFrom } from './ledger.ts';
import { howToPayOf, howToPayLines } from './how-to-pay.ts';
import type { OrderBilledView } from './billing-types.ts';
import { numberGuard } from '../../calculator.ts';
import { newestFirst, oneLine, recordId, requireAcceptedBlueprint, requireOffer, requirePrice } from './shared.ts';
import { digestOf, journalled, type ApplyHandle } from '../journal/journal.ts';
import { gateEffect, sealApproval } from '../policy/holds.ts';
import { blueprintCountry, invoiceCountry } from '../core/country-history.ts';
import {
  experimentalStorage, type BackOffice, type BlueprintRecord, type ClientRecord, type CountryProfile, type InvoiceLine, type InvoiceListRow, type InvoiceRecord,
  type InvoiceView, type IsoDate, type MinorString, type PriceFigure, type PriceReceiptRecord, type TaxTreatment, type VentureDeps, type VentureRecord,
} from '../contracts.ts';

const DIGEST_TEXT = /^[A-Za-z0-9]{1,200}$/;

/** What the owner still has to add before a registered business can issue a tax invoice, in plain words. */
export function taxInvoiceMissing(backOffice: BackOffice, country: CountryProfile): string[] {
  if (!backOffice.taxRegistered.value || country.tax.invoiceKind === 'invoice' || backOffice.invoiceKind === 'invoice') return [];
  const missing: string[] = [];
  if (country.code === 'IN') {
    if (backOffice.taxId === null || !gstinValid(backOffice.taxId)) missing.push('Your GSTIN');
    if (backOffice.taxState === null) missing.push('Your state');
    if (backOffice.sacCode === null) missing.push('Your SAC code');
  } else if (backOffice.taxId === null) missing.push(`Your ${country.tax.idLabel || 'tax number'}`);
  for (const item of backOffice.taxInvoiceMissing) if (!missing.includes(item)) missing.push(item);
  return missing;
}

/**
 * INVOICE when not registered or the country only has plain invoices; TAX INVOICE when registered and every
 * field a tax invoice needs is present; otherwise INVOICE (not a tax invoice).
 */
export function documentTitleFor(backOffice: BackOffice, country: CountryProfile): InvoiceRecord['documentTitle'] {
  if (!backOffice.taxRegistered.value || country.tax.invoiceKind === 'invoice' || backOffice.invoiceKind === 'invoice') return 'INVOICE';
  return backOffice.taxInvoiceReady && taxInvoiceMissing(backOffice, country).length === 0 ? 'TAX INVOICE' : 'INVOICE (not a tax invoice)';
}

/** India only, and only for a registered business: where the supply is taxed. */
export function placeOfSupplyFor(backOffice: BackOffice, client: ClientRecord, country: CountryProfile): string | null {
  if (country.code !== 'IN' || !backOffice.taxRegistered.value) return null;
  if (client.countryCode !== null && client.countryCode !== 'IN') return 'Outside India (export of services)';
  return stateName(client.stateCode) ?? stateName(backOffice.taxState) ?? 'Not set';
}

function figureOf(receipt: PriceReceiptRecord, key: PriceFigure['key']): PriceFigure {
  const found = receiptFigure(receipt, key);
  check(found, 'RECEIPT_NOT_FOUND', 'This price receipt is missing a figure.');
  return found;
}

/** The figure keys behind each tax line, in order. */
function taxLineKeys(treatment: TaxTreatment): PriceFigure['key'][] {
  if (treatment === 'cgst-sgst') return ['cgst', 'sgst'];
  if (treatment === 'igst') return ['igst'];
  if (treatment === 'none') return [];
  return ['tax'];
}

/** Tax lines from the receipt: none when tax is zero, except one line for a zero-rated export. */
export function taxLinesFor(receipt: PriceReceiptRecord): InvoiceRecord['taxLines'] {
  const treatment = receipt.inputs.taxTreatment;
  const rate = receipt.inputs.taxRateBps;
  if (treatment === 'zero-rated-lut') return [{ label: figureOf(receipt, 'tax').label, rateBps: '0', minor: '0' }];
  if (BigInt(figureOf(receipt, 'tax').minor) === 0n) return [];
  return taxLineKeys(treatment).map(key => {
    const f = figureOf(receipt, key);
    return { label: f.label, rateBps: treatment === 'cgst-sgst' ? halfRateBps(rate) : rate, minor: f.minor };
  });
}

/** The fields the owner approves on issue. */
export function invoiceDigest(invoice: InvoiceRecord): string {
  return digest({
    orderId: invoice.orderId, clientId: invoice.clientId, currency: invoice.currency, issueDate: invoice.issueDate, dueDate: invoice.dueDate,
    lines: invoice.lines, subtotalMinor: invoice.subtotalMinor, discountMinor: invoice.discountMinor, taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor, taxRateBps: invoice.taxRateBps, taxTreatment: invoice.taxTreatment, taxLines: invoice.taxLines,
    documentTitle: invoice.documentTitle, supplierTaxId: invoice.supplierTaxId, clientTaxId: invoice.clientTaxId,
    placeOfSupply: invoice.placeOfSupply, sacCode: invoice.sacCode,
    ...(invoice.part ? { part: invoice.part } : {}), ...(invoice.terms !== undefined ? { terms: invoice.terms } : {}),
    ...(invoice.reminderDays !== undefined ? { reminderDays: invoice.reminderDays } : {}),
  });
}

/**
 * Subtotal, the tax lines, total, paid, credited (4J5: only when a credit note was issued) and balance, each with its
 * display text, so Total = Paid + Credited + Balance.
 */
function invoiceFigures(invoice: InvoiceRecord, receipt: PriceReceiptRecord, creditedMinor: bigint): PriceFigure[] {
  const money = (key: PriceFigure['key'], label: string, minor: MinorString): PriceFigure => ({ key, label, minor, display: formatMoney(minor, invoice.currency), currency: invoice.currency });
  const keys = invoice.taxTreatment === 'zero-rated-lut' ? ['tax' as const] : taxLineKeys(invoice.taxTreatment);
  const figures: PriceFigure[] = [money('subtotal', 'Subtotal', invoice.subtotalMinor)];
  invoice.taxLines.forEach((line, index) => figures.push(money(keys[index] ?? 'tax', line.label, line.minor)));
  figures.push(money('total', 'Total', invoice.totalMinor), money('paid', 'Paid', invoice.paidMinor));
  if (creditedMinor > 0n) figures.push(money('credited', 'Credited', String(creditedMinor)));
  figures.push(money('balance', 'Balance', invoice.balanceMinor));
  check(invoice.totalMinor === receipt.totalMinor, 'RECEIPT_NOT_FOUND', 'This invoice no longer matches its price receipt.');
  return figures;
}

/** The blueprint version an invoice was priced with, found by the receipt's digest. */
function pricedBlueprint(state: State, venture: VentureRecord, receipt: PriceReceiptRecord): BlueprintRecord | null {
  const blueprints = listRecords(state, 'venture-blueprint', venture.id);
  return blueprints.find(b => b.digest === receipt.inputs.blueprintDigest)
    ?? blueprints.find(b => b.id === venture.acceptedBlueprintId) ?? null;
}

/** The full view the screens show for one invoice, with its next step, timeline and credit notes as of the owner's day. */
export function invoiceView(state: State, venture: VentureRecord, invoice: InvoiceRecord, deps: Pick<VentureDeps, 'storage' | 'host' | 'clock'>): InvoiceView {
  const experimental = experimentalStorage(deps);
  const client = listRecords(state, 'venture-client', venture.id).find(c => c.id === invoice.clientId);
  check(client, 'CLIENT_NOT_FOUND', 'The client of this invoice was not found.');
  const receipt = listRecords(state, 'venture-price-receipt', venture.id).find(r => r.id === invoice.priceReceiptId);
  check(receipt, 'RECEIPT_NOT_FOUND', 'The price receipt of this invoice was not found.');
  const payments = listRecords(state, 'venture-payment', venture.id).filter(p => p.invoiceId === invoice.id);
  const blueprint = pricedBlueprint(state, venture, receipt);
  const country = blueprintCountry(venture, blueprint);
  const historicalVenture = { ...venture, country };
  const notes: string[] = [];
  if (invoice.documentTitle === 'INVOICE (not a tax invoice)') {
    const missing = blueprint ? taxInvoiceMissing(blueprint.backOffice, country) : [];
    notes.push(`To make this a tax invoice, add: ${missing.length ? missing.join(', ') : 'the registration details your country needs'}.`);
  }
  if (invoice.booksNote !== null) notes.push(invoice.booksNote);
  for (const payment of payments) if (payment.booksNote !== null && !notes.includes(payment.booksNote)) notes.push(payment.booksNote);
  // TDS settles the invoice once its payment counts; a cheque still waiting names it on its timeline line instead.
  for (const payment of payments) if (payment.tds && paymentState(payment) === 'cleared') notes.push(tdsLine(payment.tds, invoice.currency));
  if (experimental) notes.push(EXPERIMENTAL_NOTE);
  const today = localDayAt(deps.clock(), venture.country);
  const rateChange = rateChangeOf(state, venture, invoice);
  const credited = creditedOn(invoice.id, listRecords(state, 'venture-credit-note', venture.id));
  // 6D4: an invoice in the client's currency is never converted; the home-currency value for the tax return is recorded
  // by the owner or their accountant.
  if (invoice.currency !== country.currency) notes.push(`This invoice is in ${invoice.currency}. Chausar does not convert it: record its ${country.currency} value at the exchange rate of the invoice date in your tax return, or ask your accountant.`);
  const sellerName = blueprint?.name.value ?? venture.workingName;
  const howToPay = howToPayOf(state, venture, invoice, sellerName);
  const billed = billedOf(state, venture, invoice);
  return {
    invoice,
    country,
    client,
    receipt,
    payments,
    documentText: documentText({ invoice, client, sellerName, country, experimental, creditedMinor: String(credited), howToPay: howToPayLines(howToPay, country) }),
    figures: invoiceFigures(invoice, receipt, credited),
    notes,
    next: invoiceNext(state, historicalVenture, invoice, today),
    timeline: invoiceTimeline(state, historicalVenture, invoice, today),
    ...(rateChange ? { rateChange } : {}),
    credits: creditViewsOn(state, venture, invoice.id),
    // 4J20: how late an open invoice is, as its list row says it.
    ...(lateOf(invoice, today) ? { late: lateOf(invoice, today)! } : {}),
    ...(billed ? { billed } : {}),
    ...(howToPay ? { howToPay } : {}),
  };
}

/** The invoices on an order that count against its total: issued, part paid or paid, never drafts or cancelled ones. */
function countedOn(invoices: readonly InvoiceRecord[], orderId: string, except?: string): InvoiceRecord[] {
  return invoices.filter(item => item.orderId === orderId && item.id !== except && item.status !== 'draft' && item.status !== 'void');
}

/** 6D1: how much of an order billed in parts is billed and left, when this invoice is one of its parts. */
function billedOf(state: State, venture: VentureRecord, invoice: InvoiceRecord): OrderBilledView | null {
  if (!invoice.part) return null;
  const counted = countedOn(listRecords(state, 'venture-invoice', venture.id), invoice.orderId);
  const billed = counted.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n);
  const total = BigInt(invoice.part.orderTotalMinor);
  const money = (minor: bigint) => formatMoney(minor, invoice.currency);
  return {
    orderTotalMinor: String(total), billedMinor: String(billed), leftMinor: String(total - billed),
    orderTotal: money(total), billed: money(billed), left: money(total - billed), invoices: counted.length,
  };
}

/**
 * What drafting an invoice takes: its order, the days until due (null: the order's own due date, else the owner's
 * default), the issue date (null: today on the owner's calendar), and (6D1) the part of the order it bills (null: the
 * whole order, or what is left when earlier parts were issued) and its own reminder days.
 */
export type InvoiceDraftInput = { orderId: string; dueInDays: number | null; issueDate: IsoDate | null; part?: PartAsk | null; reminderDays?: number[] | null };

/** A receipt's amount before tax, tax lines (in the order taxLineKeys names them) and total, as BigInt. */
function sumsOfReceipt(receipt: PriceReceiptRecord): PartSums {
  return {
    taxable: BigInt(receiptTaxable(receipt)),
    lines: taxLineKeys(receipt.inputs.taxTreatment).map(key => BigInt(receiptFigure(receipt, key)?.minor ?? '0')),
    total: BigInt(receipt.totalMinor),
  };
}

/** What issued invoices on an order billed: amount before tax, each tax line and total; a missing line is zero. */
function billedSums(invoices: readonly InvoiceRecord[], treatment: TaxTreatment): PartSums {
  const keys = taxLineKeys(treatment);
  return invoices.reduce<PartSums>((sum, item) => ({
    taxable: sum.taxable + BigInt(item.subtotalMinor) - BigInt(item.discountMinor),
    lines: keys.map((_key, index) => (sum.lines[index] ?? 0n) + BigInt(item.taxLines[index]?.minor ?? '0')),
    total: sum.total + BigInt(item.totalMinor),
  }), { taxable: 0n, lines: keys.map(() => 0n), total: 0n });
}

/** The words of a part receipt's tax, by template from its figures. */
function partTaxWords(figures: PriceFigure[], decision: TaxDecision, taxLabel: string, tax: bigint): string {
  const shown = (key: PriceFigure['key']) => figures.find(f => f.key === key)?.display ?? '';
  if (decision.treatment === 'zero-rated-lut') return ', zero-rated as an export of services under LUT';
  if (decision.treatment === 'none' || tax === 0n) return '';
  if (decision.treatment === 'single') return `, plus ${taxLabel} at ${ratePercent(decision.rateBps)}% (${shown('tax')})`;
  if (decision.treatment === 'igst') return `, plus IGST at ${ratePercent(decision.rateBps)}% (${shown('igst')})`;
  const half = halfRatePercent(decision.rateBps);
  return `, plus CGST at ${half}% (${shown('cgst')}) and SGST at ${half}% (${shown('sgst')})`;
}

/**
 * 6D1: the price receipt of one part of an order, cut from the whole order's receipt (basis) by invoice-parts.ts. Pure
 * arithmetic with its steps; the explanation is an engine template checked by the number guard.
 */
function partReceipt(tx: VentureTx, invoiceId: string, basis: PriceReceiptRecord, cut: PartCut, ask: PartAsk, earlier: bigint, decision: TaxDecision, taxLabel: string): PriceReceiptRecord {
  const currency = basis.currency;
  const treatment = basis.inputs.taxTreatment;
  const amounts = {
    unit: String(cut.taxable), subtotal: String(cut.taxable), discount: '0', taxable: String(cut.taxable), tax: String(cut.tax),
    cgst: treatment === 'cgst-sgst' ? String(cut.lines[0] ?? 0n) : null, sgst: treatment === 'cgst-sgst' ? String(cut.lines[1] ?? 0n) : null,
    igst: treatment === 'igst' ? String(cut.lines[0] ?? 0n) : null, total: String(cut.total),
  };
  const figures = priceFigures(amounts, decision, taxLabel, 'invoice', currency);
  const money = (minor: bigint | string) => formatMoney(minor, currency);
  const kind: PartAsk['kind'] = cut.final ? 'final' : ask.kind;
  const share = ask.shareBps !== null && !cut.final ? ratePercent(String(ask.shareBps)) : null;
  const explanation = cut.final
    ? `${PART_WORDS.final}: the order's ${money(basis.totalMinor)} less ${money(earlier)} billed before = ${money(cut.total)}.`
    : share !== null
      ? `${PART_WORDS[kind]}: ${share}% of the order's ${money(receiptTaxable(basis))} before tax is ${money(cut.taxable)}${partTaxWords(figures, decision, taxLabel, cut.tax)} = ${money(cut.total)}.`
      : `${PART_WORDS[kind]} of ${money(cut.taxable)} before tax${partTaxWords(figures, decision, taxLabel, cut.tax)} = ${money(cut.total)}.`;
  const plain = (minor: bigint | string) => plainMoney(minor, currency);
  const record: PriceReceiptRecord = {
    ...tx.base('venture-price-receipt'),
    subject: { type: 'invoice', invoiceId },
    operation: 'venture.price',
    currency,
    minorDigits: basis.minorDigits,
    inputs: {
      unitPriceMinor: String(cut.taxable), quantity: '1', discountBps: '0', taxMode: basis.inputs.taxMode, taxRateBps: basis.inputs.taxRateBps,
      taxTreatment: treatment, unitPriceBy: 'told-by-you', taxRateBy: basis.inputs.taxRateBy, blueprintDigest: basis.inputs.blueprintDigest,
      part: { kind, shareBps: share === null ? null : String(ask.shareBps), basisReceiptId: basis.id, earlierMinor: String(earlier) },
      ...(basis.inputs.currencyBy ? { currencyBy: basis.inputs.currencyBy } : {}),
    },
    steps: cut.steps,
    figures,
    totalMinor: String(cut.total),
    allowedNumbers: [...new Set([
      ...priceAllowedNumbers(figures, '1', decision), plain(basis.totalMinor), plain(receiptTaxable(basis)), plain(earlier), plain(cut.total),
      ...(share !== null ? [share] : []),
    ])],
    explanation,
    digest: '',
    stale: false,
  };
  numberGuard(record.explanation, record);
  record.digest = receiptDigest(record);
  return tx.put(record);
}

/** The due date and days: what was asked; else the order's own due date when it falls within 90 days; else the default. */
function dueOf(asked: number | null, orderDue: IsoDate | undefined, issueDate: IsoDate, defaultDays: number): { dueInDays: number; dueDate: IsoDate } {
  if (asked !== null) return { dueInDays: asked, dueDate: addDaysUtc(issueDate, asked) };
  if (orderDue) {
    const days = daysFrom(issueDate, orderDue);
    if (days >= 0 && days <= 90) return { dueInDays: days, dueDate: orderDue };
  }
  return { dueInDays: defaultDays, dueDate: addDaysUtc(issueDate, defaultDays) };
}

/**
 * Inside a venture transaction: drafts the invoice for an order, replacing any earlier draft, with a fresh price
 * receipt at the plan's rate now, or (6D1) one part of the order cut from its receipt. An order billed in full already is
 * refused. Each line keeps the rate charged; a tax-included price says so on its line, whose unit is the amount
 * before tax per unit (exact, because the split works per unit).
 */
export function draftInvoiceIn(tx: VentureTx, input: InvoiceDraftInput): InvoiceRecord {
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const accepted = requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
  const order = tx.find('venture-order', input.orderId);
  check(order, 'ORDER_NOT_FOUND', 'This order was not found.');
  const originalReceipt = tx.find('venture-price-receipt', order.priceReceiptId);
  const originalPlan = originalReceipt && tx.list('venture-blueprint').find(item => item.digest === originalReceipt.inputs.blueprintDigest);
  // Once a business has moved, existing orders keep their approved price and tax profile.
  check(!venture.originalCountry || originalPlan, 'RECEIPT_NOT_FOUND', 'The plan that priced this order was not found.');
  const blueprint = venture.originalCountry ? originalPlan! : accepted;
  check(!order.internal, 'INTERNAL_ORDER', 'Your own shop work has no customer invoice.');
  check(order.status !== 'cancelled', 'INVALID_VENTURE_REQUEST', 'This order was cancelled.');
  const existing = tx.list('venture-invoice').filter(i => i.orderId === order.id);
  // 6D1: an order may be billed in parts; a whole-order invoice already issued leaves nothing to bill.
  const issued = countedOn(existing, order.id);
  check(issued.every(i => i.part), 'QUOTE_ALREADY_INVOICED', 'This order is billed in full already. Change the order before you bill more.');
  const draft = existing.filter(i => i.status === 'draft').at(-1) ?? null;
  const client = tx.find('venture-client', order.clientId);
  check(client, 'CLIENT_NOT_FOUND', 'The client of this order was not found.');
  const offer = requireOffer(blueprint, order.offerId);
  if (!order.foreignPrice) requirePrice(offer);

  const base = tx.base('venture-invoice');
  const invoiceId = draft?.id ?? base.id;
  const backOffice = blueprint.backOffice;
  const country = blueprintCountry(venture, blueprint);
  const decision = taxDecision(backOffice, client, country);
  const billing = billingOf(venture);
  const pricing = { quantity: order.quantity, taxInclusive: order.taxInclusive === true, ...(order.foreignPrice ? { foreign: order.foreignPrice } : {}) };
  // 6D1: a part of the order (or the rest after issued parts) is cut from the receipt of the whole order; later parts
  // reuse the receipt the first issued part was cut from, so a price change never moves an order already part billed.
  const parted = (input.part !== undefined && input.part !== null) || issued.length > 0;
  let receipt: PriceReceiptRecord;
  let partRecord: InvoiceRecord['part'];
  if (!parted) receipt = buildPriceReceipt(tx, { type: 'invoice', invoiceId }, pricing, blueprint, offer, client);
  else {
    const basis = issued.length
      ? tx.find('venture-price-receipt', issued[0]!.part!.basisReceiptId)
      : buildPriceReceipt(tx, { type: 'invoice', invoiceId }, pricing, blueprint, offer, client);
    check(basis, 'RECEIPT_NOT_FOUND', 'The receipt this order was billed from was not found.');
    const ask: PartAsk = input.part ?? { kind: 'final', label: PART_WORDS.final, shareBps: null, taxableMinor: null };
    const earlier = billedSums(issued, basis.inputs.taxTreatment);
    const cut = cutPart(sumsOfReceipt(basis), earlier, ask, { taxRateBps: basis.inputs.taxRateBps, treatment: basis.inputs.taxTreatment, currency: basis.currency });
    receipt = partReceipt(tx, invoiceId, basis, cut, ask, earlier.total, decision, oneLine(backOffice.taxLabel));
    // A share or amount that took all that was left is the final invoice; a name the owner typed is kept.
    const label = cut.final && ask.label === PART_WORDS[ask.kind] ? PART_WORDS.final : ask.label;
    partRecord = {
      kind: cut.final ? 'final' : ask.kind, label, shareBps: receipt.inputs.part?.shareBps ?? null, basisReceiptId: basis.id,
      orderTotalMinor: basis.totalMinor, earlierMinor: String(earlier.total),
    };
  }
  // An issue date the owner leaves out is today on their own calendar, not the UTC day.
  const issueDate = input.issueDate ?? localDayAt(tx.now, country);
  const { dueInDays, dueDate } = dueOf(input.dueInDays, order.dueDate, issueDate, billing.dueInDays);
  check(decision.treatment === receipt.inputs.taxTreatment, 'INVALID_VENTURE_REQUEST', 'The tax treatment changed while pricing.');
  const inclusive = receipt.inputs.taxInclusive === true;
  const subtotal = figureOf(receipt, 'subtotal').minor;
  const line: InvoiceLine = partRecord ? {
    description: `${oneLine(offer.name.value)}: ${partRecord.label}`, quantity: '1', unitMinor: subtotal, amountMinor: subtotal, taxRateBps: receipt.inputs.taxRateBps,
  } : {
    description: inclusive ? `${oneLine(offer.name.value)} (price includes ${oneLine(backOffice.taxLabel)})` : oneLine(offer.name.value),
    quantity: order.quantity,
    // A tax-included line's unit is its amount before tax per unit: exact when the line divides, else the per-unit
    // split the receipt states (the rounding difference is on the line's amount, as the receipt says).
    unitMinor: !inclusive ? figureOf(receipt, 'unit').minor
      : BigInt(subtotal) % BigInt(order.quantity) === 0n ? String(BigInt(subtotal) / BigInt(order.quantity))
        : String(inclusiveUnit(receipt.inputs.unitPriceMinor, receipt.inputs.taxRateBps)),
    amountMinor: subtotal,
    taxRateBps: receipt.inputs.taxRateBps,
  };
  const invoice: InvoiceRecord = {
    ...base,
    id: invoiceId,
    number: null,
    documentTitle: documentTitleFor(backOffice, country),
    orderId: order.id,
    clientId: client.id,
    currency: receipt.currency,
    issueDate,
    dueDate,
    dueInDays,
    lines: [line],
    subtotalMinor: subtotal,
    discountMinor: figureOf(receipt, 'discount').minor,
    taxMinor: figureOf(receipt, 'tax').minor,
    totalMinor: receipt.totalMinor,
    taxLabel: oneLine(backOffice.taxLabel),
    taxRateBps: receipt.inputs.taxRateBps,
    taxTreatment: receipt.inputs.taxTreatment,
    taxLines: taxLinesFor(receipt),
    supplierTaxId: backOffice.taxRegistered.value ? backOffice.taxId : null,
    clientTaxId: client.taxId,
    placeOfSupply: placeOfSupplyFor(backOffice, client, country),
    sacCode: country.code === 'IN' ? backOffice.sacCode : null,
    priceReceiptId: receipt.id,
    status: 'draft',
    digest: '',
    issuedAt: null,
    factIds: [],
    booksReceiptId: null,
    booksNote: null,
    paidMinor: '0',
    balanceMinor: receipt.totalMinor,
    ...(partRecord ? { part: partRecord } : {}),
    ...(billing.terms !== null ? { terms: billing.terms } : {}),
    ...(input.reminderDays ? { reminderDays: [...input.reminderDays] } : {}),
  };
  invoice.digest = invoiceDigest(invoice);
  const stored = draft ? tx.replace(invoice) : tx.put(invoice);
  tx.emit('invoice-prepared', { invoiceId: stored.id });
  return stored;
}

/** venture.invoice.prepare (level prepare): a draft invoice for an order, replacing any earlier draft. */
export async function prepareInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  const body = exactPayload(payload, ['orderId', 'dueInDays', 'issueDate', 'part', 'reminderDays'], ['orderId']);
  const orderId = recordId(body.orderId, 'Order');
  const dueInDays = body.dueInDays === undefined ? null : dueDaysOf(body.dueInDays);
  const given = body.issueDate === undefined ? null : isoDate(body.issueDate, 'Issue date');
  const reminderDays = body.reminderDays === undefined ? null : reminderDaysOf(body.reminderDays);
  return ventureAction(deps, ctx, 'prepare', 'invoice.prepare', tx => {
    // A part payment's typed amount is read in the order's own currency.
    const order = tx.find('venture-order', orderId);
    const currency = (order && tx.find('venture-price-receipt', order.priceReceiptId)?.currency) || 'INR';
    const part = body.part === undefined ? null : partAskOf(body.part, currency);
    const stored = draftInvoiceIn(tx, { orderId, dueInDays, issueDate: given, part, reminderDays });
    return invoiceView(tx.state, tx.venture as VentureRecord, stored, deps);
  });
}

/**
 * venture.invoice.issue (level approve, app only, evidence). Numbers the approved draft, writes the invoice fact,
 * then, after the commit, asks the calculator for the billed receipt of that day and order. Issuing goes through the
 * action journal (venture/journal/): described, approved with a token bound to this invoice's digest, then applied in
 * the same commit that numbers it, so the journal and the books never disagree.
 */
export async function issueInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.invoice.issue');
  const body = exactPayload(payload, ['invoiceId', 'digest'], ['invoiceId', 'digest']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  check(typeof body.digest === 'string' && DIGEST_TEXT.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the invoice you checked.');
  const approved = body.digest;

  // Checked before anything is journalled, with the same refusals the issue commit gives.
  const { state, venture: current } = readVenture(deps, ctx);
  requireAcceptedBlueprint(current, listRecords(state, 'venture-blueprint', current.id));
  const draft = listRecords(state, 'venture-invoice', current.id).find(i => i.id === invoiceId);
  check(draft, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  check(draft.status === 'draft', 'INVOICE_NOT_DRAFT', 'This invoice was already issued.');
  check(draft.digest === approved, 'APPROVAL_STALE', 'This invoice changed after you checked it. Look at it again, then issue it.');
  const clientName = listRecords(state, 'venture-client', current.id).find(c => c.id === draft.clientId)?.name ?? 'your client';

  // One commit numbers the invoice, writes its fact and marks the journal entry applied.
  const issueCommit = (handle: ApplyHandle) => ventureAction(deps, ctx, 'approve', 'invoice.issue', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
    const invoice = tx.find('venture-invoice', invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    check(invoice.status === 'draft', 'INVOICE_NOT_DRAFT', 'This invoice was already issued.');
    check(invoice.digest === approved, 'APPROVAL_STALE', 'This invoice changed after you checked it. Look at it again, then issue it.');
    const client = tx.find('venture-client', invoice.clientId);
    check(client, 'CLIENT_NOT_FOUND', 'The client of this invoice was not found.');
    const receipt = tx.find('venture-price-receipt', invoice.priceReceiptId);
    check(receipt, 'RECEIPT_NOT_FOUND', 'The price receipt of this invoice was not found.');
    const taxable = receiptTaxable(receipt);
    // 6D1: nothing issues past the order's total, whatever was issued since this draft was made.
    const others = countedOn(tx.list('venture-invoice'), invoice.orderId, invoice.id);
    check(invoice.part ? others.every(item => item.part) : others.length === 0, 'QUOTE_ALREADY_INVOICED', 'This order is billed in full already. Change the order before you bill more.');
    const billedBefore = others.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n);
    check(!invoice.part || (billedBefore === BigInt(invoice.part.earlierMinor) && billedBefore + BigInt(invoice.totalMinor) <= BigInt(invoice.part.orderTotalMinor)),
      'APPROVAL_STALE', 'Another invoice on this order was issued after you checked this one. Draft it again.');
    const billedInFull = !invoice.part || billedBefore + BigInt(invoice.totalMinor) === BigInt(invoice.part.orderTotalMinor);

    const sequence = venture.invoiceSequence + 1;
    const number = `INV-${String(sequence).padStart(4, '0')}`;
    tx.touch({ invoiceSequence: sequence });
    const fact = insertBooksFact(tx, deps.store, invoiceFact(invoice, client, taxable, invoice.lines[0]?.description ?? 'Service'));
    const next: InvoiceRecord = { ...invoice, number, status: 'issued', issuedAt: tx.now, factIds: [fact.id] };
    tx.replace(next);
    const order = tx.find('venture-order', invoice.orderId);
    if (order && order.status === 'open' && billedInFull) tx.replace({ ...order, status: 'invoiced' });
    activateTerm(tx, 'invoice', { recordId: next.id, kind: 'venture-invoice' });
    tx.emit('invoice-issued', { invoiceId: next.id, number });
    handle.settleIn(tx, `Issued ${number}.`, invoice.priceReceiptId);
    return { issueDate: next.issueDate as string, orderId: next.orderId, taxable, number, priceReceiptId: invoice.priceReceiptId, currency: next.currency };
  });

  const journal = await journalled(deps, ctx, {
    action: 'invoice.issue', subject: invoiceId, target: clientName, actionDigest: approved, line: `Issue the invoice for ${clientName}.`,
  }, async handle => {
    // The policy gate before the effect: issuing is on the always-ask floor, so only the owner's approval sealed on this
    // entry, bound to this exact invoice digest, lets it through. Anything else asks or is denied, and nothing is issued.
    gateEffect({ name: 'invoice.issue', digest: approved }, sealApproval(handle.entry, digestOf(handle.entry)));
    const value = await issueCommit(handle);
    return { outcome: 'applied', line: `Issued ${value.number}.`, receiptId: value.priceReceiptId, value };
  });
  const issued = journal.value!;

  const books = await booksReceiptFor(deps, ctx, 'billed', issued.issueDate, issued.orderId, issued.taxable, BILLED_COVERS_MORE, issued.currency);
  return ventureAction(deps, ctx, 'approve', 'invoice.books', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const invoice = tx.find('venture-invoice', invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    const stored = tx.replace({ ...invoice, booksReceiptId: books.receiptId, booksNote: books.note });
    return invoiceView(tx.state, venture, stored, deps);
  });
}

/** venture.invoice.get (level read). */
export async function getInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  const body = exactPayload(payload, ['invoiceId'], ['invoiceId']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  const { state, venture } = readVenture(deps, ctx);
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(i => i.id === invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  return invoiceView(state, venture, invoice, deps);
}

/**
 * venture.invoice.list (level read): newest first. Each row carries its total, formatted by code, the price receipt
 * that covers it, and its next step (4J5), so a list needs no invoice.get per row.
 */
export async function listInvoices(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceListRow[]> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  // 4J4: a business still in its interview has no country and no invoices to list yet (NOTES 32).
  if (!hasCountry(venture)) return [];
  const today = localDayAt(deps.clock(), venture.country);
  return newestFirst(listRecords(state, 'venture-invoice', venture.id))
    .map(invoice => {
      // 4J4 (M9): an open invoice past its due day says how late it is, on the owner's calendar.
      const late = lateOf(invoice, today);
      return { ...invoice, total: formatMoney(invoice.totalMinor, invoice.currency), receiptId: invoice.priceReceiptId, next: invoiceNext(state, { ...venture, country: invoiceCountry(state, venture, invoice) }, invoice, today), ...(late ? { late } : {}) };
    });
}
