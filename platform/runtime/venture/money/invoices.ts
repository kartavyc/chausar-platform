// Invoices: prepared from an order with a fresh price receipt, approved by digest, numbered on issue, and
// written into the books as an invoice fact. Tax invoice fields follow the owner's own settings.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { gstinValid } from '../../memory.ts';
import {
  activateTerm, digest, exactPayload, isoDate, listRecords, readVenture, requireAppChannel, smallInteger, ventureAction,
} from '../records.ts';
import { booksReceiptFor, BILLED_COVERS_MORE, EXPERIMENTAL_NOTE } from './books.ts';
import { documentText } from './document.ts';
import { addDaysUtc, todayUtc } from './dates.ts';
import { insertBooksFact, invoiceFact } from './facts.ts';
import { buildPriceReceipt, receiptFigure, receiptTaxable } from './quote.ts';
import { halfRateBps, stateName, taxDecision } from './tax.ts';
import { newestFirst, oneLine, recordId, requireAcceptedBlueprint, requireOffer, requirePrice } from './shared.ts';
import type {
  BackOffice, BlueprintRecord, ClientRecord, CountryProfile, InvoiceRecord, InvoiceView, MinorString, PriceFigure,
  PriceReceiptRecord, TaxTreatment, VentureDeps, VentureRecord, VentureStorage,
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

/** Subtotal, the tax lines, total, paid and balance, each with its display text. */
function invoiceFigures(invoice: InvoiceRecord, receipt: PriceReceiptRecord): PriceFigure[] {
  const money = (key: PriceFigure['key'], label: string, minor: MinorString): PriceFigure => ({ key, label, minor, display: formatMinor(minor, invoice.currency), currency: invoice.currency });
  const keys = invoice.taxTreatment === 'zero-rated-lut' ? ['tax' as const] : taxLineKeys(invoice.taxTreatment);
  const figures: PriceFigure[] = [money('subtotal', 'Subtotal', invoice.subtotalMinor)];
  invoice.taxLines.forEach((line, index) => figures.push(money(keys[index] ?? 'tax', line.label, line.minor)));
  figures.push(money('total', 'Total', invoice.totalMinor), money('paid', 'Paid', invoice.paidMinor), money('balance', 'Balance', invoice.balanceMinor));
  check(invoice.totalMinor === receipt.totalMinor, 'RECEIPT_NOT_FOUND', 'This invoice no longer matches its price receipt.');
  return figures;
}

/** The blueprint version an invoice was priced with, found by the receipt's digest. */
function pricedBlueprint(state: State, venture: VentureRecord, receipt: PriceReceiptRecord): BlueprintRecord | null {
  const blueprints = listRecords(state, 'venture-blueprint', venture.id);
  return blueprints.find(b => b.digest === receipt.inputs.blueprintDigest)
    ?? blueprints.find(b => b.id === venture.acceptedBlueprintId) ?? null;
}

/** The full view the screens show for one invoice. */
export function invoiceView(state: State, venture: VentureRecord, invoice: InvoiceRecord, storage: VentureStorage): InvoiceView {
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
  if (storage === 'experimental-file') notes.push(EXPERIMENTAL_NOTE);
  return {
    invoice,
    client,
    receipt,
    payments,
    documentText: documentText({ invoice, client, sellerName: blueprint?.name.value ?? venture.workingName, country: venture.country, storage }),
    figures: invoiceFigures(invoice, receipt),
    notes,
  };
}

/** venture.invoice.prepare (level prepare): a draft invoice for an order, replacing any earlier draft. */
export async function prepareInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  const body = exactPayload(payload, ['orderId', 'dueInDays', 'issueDate'], ['orderId']);
  const orderId = recordId(body.orderId, 'Order');
  const dueInDays = body.dueInDays === undefined ? 15 : smallInteger(body.dueInDays, 'Days until due', 0, 90);
  const issueDate = body.issueDate === undefined ? todayUtc(deps.clock) : isoDate(body.issueDate, 'Issue date');
  const dueDate = addDaysUtc(issueDate, dueInDays);

  return ventureAction(deps, ctx, 'prepare', 'invoice.prepare', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const blueprint = requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
    const order = tx.find('venture-order', orderId);
    check(order, 'ORDER_NOT_FOUND', 'This order was not found.');
    check(order.status !== 'cancelled', 'INVALID_VENTURE_REQUEST', 'This order was cancelled.');
    const existing = tx.list('venture-invoice').filter(i => i.orderId === order.id);
    check(existing.every(i => i.status === 'draft'), 'INVOICE_NOT_DRAFT', 'This order already has an issued invoice.');
    const draft = existing.at(-1) ?? null;
    const client = tx.find('venture-client', order.clientId);
    check(client, 'CLIENT_NOT_FOUND', 'The client of this order was not found.');
    const offer = requireOffer(blueprint, order.offerId);
    requirePrice(offer);

    const base = tx.base('venture-invoice');
    const invoiceId = draft?.id ?? base.id;
    const receipt = buildPriceReceipt(tx, { type: 'invoice', invoiceId }, { quantity: order.quantity }, blueprint, offer, client);
    const backOffice = blueprint.backOffice;
    const country = venture.country;
    const decision = taxDecision(backOffice, client, country);
    check(decision.treatment === receipt.inputs.taxTreatment, 'INVALID_VENTURE_REQUEST', 'The tax treatment changed while pricing.');
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
      lines: [{ description: oneLine(offer.name.value), quantity: order.quantity, unitMinor: figureOf(receipt, 'unit').minor, amountMinor: figureOf(receipt, 'subtotal').minor }],
      subtotalMinor: figureOf(receipt, 'subtotal').minor,
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
    return invoiceView(tx.state, venture, stored, deps.storage);
  });
}

/**
 * venture.invoice.issue (level approve, app only, evidence). Numbers the approved draft, writes the invoice fact,
 * then, after the commit, asks the calculator for the billed receipt of that day and order.
 */
export async function issueInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.invoice.issue');
  const body = exactPayload(payload, ['invoiceId', 'digest'], ['invoiceId', 'digest']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  check(typeof body.digest === 'string' && DIGEST_TEXT.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the invoice you checked.');
  const approved = body.digest;

  const issued = await ventureAction(deps, ctx, 'approve', 'invoice.issue', tx => {
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
    return { issueDate: next.issueDate as string, orderId: next.orderId, taxable };
  });

  const books = await booksReceiptFor(deps, ctx, 'billed', issued.issueDate, issued.orderId, issued.taxable, BILLED_COVERS_MORE);
  return ventureAction(deps, ctx, 'approve', 'invoice.books', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const invoice = tx.find('venture-invoice', invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    const stored = tx.replace({ ...invoice, booksReceiptId: books.receiptId, booksNote: books.note });
    return invoiceView(tx.state, venture, stored, deps.storage);
  });
}

/** venture.invoice.get (level read). */
export async function getInvoice(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  const body = exactPayload(payload, ['invoiceId'], ['invoiceId']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  const { state, venture } = readVenture(deps, ctx);
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(i => i.id === invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  return invoiceView(state, venture, invoice, deps.storage);
}

/** venture.invoice.list (level read): newest first. */
export async function listInvoices(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceRecord[]> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return newestFirst(listRecords(state, 'venture-invoice', venture.id));
}
