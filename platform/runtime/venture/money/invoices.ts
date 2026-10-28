// Invoices: prepared from an order with a fresh price receipt, approved by digest, numbered on issue, and
// written into the books as an invoice fact. Tax invoice fields follow the owner's own settings.
// Ink v2 wave 4 (4J5): an order's quote becomes one invoice, once (QUOTE_ALREADY_INVOICED); each line keeps the rate
// charged, and a tax-included price says so on its line (tax-kinds.ts splits it); recurring schedules draft through
// draftInvoiceIn; the view adds the invoice's next step, its timeline (invoice-states.ts), its credit notes, the TDS
// the client deducted and, on a draft whose rate is no longer the plan's, the rate change, which only the owner acts on.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { gstinValid } from '../../memory.ts';
import {
  activateTerm, digest, exactPayload, isoDate, listRecords, readVenture, requireAppChannel, smallInteger, ventureAction, type VentureTx,
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
import { buildPriceReceipt, receiptFigure, receiptTaxable } from './quote.ts';
import { halfRateBps, stateName, taxDecision } from './tax.ts';
import { newestFirst, oneLine, recordId, requireAcceptedBlueprint, requireOffer, requirePrice } from './shared.ts';
import { digestOf, journalled, type ApplyHandle } from '../journal/journal.ts';
import { gateEffect, sealApproval } from '../policy/holds.ts';
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
  });
}

/**
 * Subtotal, the tax lines, total, paid, credited (4J5: only when a credit note was issued) and balance, each with its
 * display text, so Total = Paid + Credited + Balance.
 */
function invoiceFigures(invoice: InvoiceRecord, receipt: PriceReceiptRecord, creditedMinor: bigint): PriceFigure[] {
  const money = (key: PriceFigure['key'], label: string, minor: MinorString): PriceFigure => ({ key, label, minor, display: formatMinor(minor, invoice.currency), currency: invoice.currency });
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
  const notes: string[] = [];
  if (invoice.documentTitle === 'INVOICE (not a tax invoice)') {
    const missing = blueprint ? taxInvoiceMissing(blueprint.backOffice, venture.country) : [];
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
  return {
    invoice,
    client,
    receipt,
    payments,
    documentText: documentText({ invoice, client, sellerName: blueprint?.name.value ?? venture.workingName, country: venture.country, experimental, creditedMinor: String(credited) }),
    figures: invoiceFigures(invoice, receipt, credited),
    notes,
    next: invoiceNext(state, venture, invoice, today),
    timeline: invoiceTimeline(state, venture, invoice, today),
    ...(rateChange ? { rateChange } : {}),
    credits: creditViewsOn(state, venture, invoice.id),
    // 4J20: how late an open invoice is, as its list row says it.
    ...(lateOf(invoice, today) ? { late: lateOf(invoice, today)! } : {}),
  };
}

/** What drafting an invoice takes: its order, the days until due and the issue date (null: today on the owner's calendar). */
export type InvoiceDraftInput = { orderId: string; dueInDays: number; issueDate: IsoDate | null };

/**
 * Inside a venture transaction: drafts the invoice for an order, replacing any earlier draft, with a fresh price
 * receipt at the plan's rate now. An order whose quote is on an issued invoice already is refused: one order becomes one
 * invoice, once. Each line keeps the rate charged; a tax-included price says so on its line, whose unit is the amount
 * before tax per unit (exact, because the split works per unit).
 */
export function draftInvoiceIn(tx: VentureTx, input: InvoiceDraftInput): InvoiceRecord {
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const blueprint = requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
  const order = tx.find('venture-order', input.orderId);
  check(order, 'ORDER_NOT_FOUND', 'This order was not found.');
  check(!order.internal, 'INTERNAL_ORDER', 'Your own shop work has no customer invoice.');
  check(order.status !== 'cancelled', 'INVALID_VENTURE_REQUEST', 'This order was cancelled.');
  const existing = tx.list('venture-invoice').filter(i => i.orderId === order.id);
  check(existing.every(i => i.status === 'draft'), 'QUOTE_ALREADY_INVOICED', "This order's quote is on an issued invoice already. One order becomes one invoice, once.");
  const draft = existing.at(-1) ?? null;
  const client = tx.find('venture-client', order.clientId);
  check(client, 'CLIENT_NOT_FOUND', 'The client of this order was not found.');
  const offer = requireOffer(blueprint, order.offerId);
  requirePrice(offer);

  const base = tx.base('venture-invoice');
  const invoiceId = draft?.id ?? base.id;
  const receipt = buildPriceReceipt(tx, { type: 'invoice', invoiceId }, { quantity: order.quantity, taxInclusive: order.taxInclusive === true }, blueprint, offer, client);
  const backOffice = blueprint.backOffice;
  const country = venture.country;
  // An issue date the owner leaves out is today on their own calendar, not the UTC day.
  const issueDate = input.issueDate ?? localDayAt(tx.now, country);
  const dueDate = addDaysUtc(issueDate, input.dueInDays);
  const decision = taxDecision(backOffice, client, country);
  check(decision.treatment === receipt.inputs.taxTreatment, 'INVALID_VENTURE_REQUEST', 'The tax treatment changed while pricing.');
  const inclusive = receipt.inputs.taxInclusive === true;
  const subtotal = figureOf(receipt, 'subtotal').minor;
  const line: InvoiceLine = {
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
    dueInDays: input.dueInDays,
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
  };
  invoice.digest = invoiceDigest(invoice);
  const stored = draft ? tx.replace(invoice) : tx.put(invoice);
  tx.emit('invoice-prepared', { invoiceId: stored.id });
  return stored;
}

/** venture.invoice.prepare (level prepare): a draft invoice for an order, replacing any earlier draft. */
export async function prepareInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  const body = exactPayload(payload, ['orderId', 'dueInDays', 'issueDate'], ['orderId']);
  const orderId = recordId(body.orderId, 'Order');
  const dueInDays = body.dueInDays === undefined ? 15 : smallInteger(body.dueInDays, 'Days until due', 0, 90);
  const given = body.issueDate === undefined ? null : isoDate(body.issueDate, 'Issue date');
  return ventureAction(deps, ctx, 'prepare', 'invoice.prepare', tx => {
    const stored = draftInvoiceIn(tx, { orderId, dueInDays, issueDate: given });
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

    const sequence = venture.invoiceSequence + 1;
    const number = `INV-${String(sequence).padStart(4, '0')}`;
    tx.touch({ invoiceSequence: sequence });
    const fact = insertBooksFact(tx, deps.store, invoiceFact(invoice, client, taxable, invoice.lines[0]?.description ?? 'Service'));
    const next: InvoiceRecord = { ...invoice, number, status: 'issued', issuedAt: tx.now, factIds: [fact.id] };
    tx.replace(next);
    const order = tx.find('venture-order', invoice.orderId);
    if (order && order.status === 'open') tx.replace({ ...order, status: 'invoiced' });
    activateTerm(tx, 'invoice', { recordId: next.id, kind: 'venture-invoice' });
    tx.emit('invoice-issued', { invoiceId: next.id, number });
    handle.settleIn(tx, `Issued ${number}.`, invoice.priceReceiptId);
    return { issueDate: next.issueDate as string, orderId: next.orderId, taxable, number, priceReceiptId: invoice.priceReceiptId };
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

  const books = await booksReceiptFor(deps, ctx, 'billed', issued.issueDate, issued.orderId, issued.taxable, BILLED_COVERS_MORE);
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
      return { ...invoice, total: formatMinor(invoice.totalMinor, invoice.currency), receiptId: invoice.priceReceiptId, next: invoiceNext(state, venture, invoice, today), ...(late ? { late } : {}) };
    });
}
