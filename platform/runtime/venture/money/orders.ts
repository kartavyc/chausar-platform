// Orders: one offer for one client, priced by its own receipt with the client's tax treatment.
// The request text is client data: it stays in the vault and only reaches a model through an approved preview.
// Ink v2 wave 4 (4J3): the order list carries each order's stage steps and what waits on the owner (order-steps.ts).
import { check, type Context } from '../../contracts.ts';
import { activateTerm, exactPayload, isoDate, listRecords, plainText, readVenture, ventureAction } from '../records.ts';
import { insertBooksFact, saleFact } from './facts.ts';
import { orderIndex, orderSteps } from './order-steps.ts';
import { buildPriceReceipt, receiptTaxable } from './quote.ts';
import { newestFirst, oneLine, quantityText, recordId, requireAcceptedBlueprint, requireOffer, requirePrice } from './shared.ts';
import type { OrderListRow, OrderRecord, VentureDeps } from '../contracts.ts';
import { localDayAt } from '../local-day.ts';
import { flagshipOffer, flagshipPlan } from '../playbooks/plan.ts';
import { orderIntake } from '../playbooks/intake.ts';
import type { PlaybookDefinition } from '../playbooks/kit/define.ts';

/**
 * venture.order.create (level prepare). intake: what a flagship playbook's offer asks (playbooks/intake.ts); an offer
 * that cuts footage refuses the order with RIGHTS_REQUIRED until its rights are recorded here. taxInclusive (4J5, M15):
 * the owner's price includes the tax, so the order's receipts split it (money/tax-kinds.ts).
 */
export async function createOrder(deps: VentureDeps, ctx: Context, payload: unknown, options: { definitions?: readonly PlaybookDefinition[] } = {}): Promise<OrderRecord> {
  // Ink v2 wave 5 (5A2): the honest exit reads the kit playbooks (playbooks/kit/exit.ts), loaded on use; a test passes its own.
  const exit = await import('../playbooks/kit/exit.ts');
  const definitions = options.definitions ?? (await import('../playbooks/definitions.ts')).PLAYBOOK_DEFINITIONS;
  const body = exactPayload(payload, ['clientId', 'offerId', 'quantity', 'request', 'intake', 'taxInclusive'], ['clientId', 'offerId', 'request']);
  const clientId = recordId(body.clientId, 'Client');
  const offerId = recordId(body.offerId, 'Offer');
  const quantity = body.quantity === undefined ? null : quantityText(body.quantity);
  const request = plainText(body.request, 'The request', { min: 3, max: 4000 });
  check(body.taxInclusive === undefined || typeof body.taxInclusive === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say whether the price includes tax with true or false.');
  const taxInclusive = body.taxInclusive === true;

  return ventureAction(deps, ctx, 'prepare', 'order.create', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const blueprint = requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
    const client = tx.find('venture-client', clientId);
    check(client, 'CLIENT_NOT_FOUND', 'Add this client first.');
    const offer = requireOffer(blueprint, offerId);
    requirePrice(offer);
    // Rights and the other intake fields are checked before anything is written.
    const intake = orderIntake(body.intake, flagshipOffer(flagshipPlan(venture.idea), offer), {
      by: ctx.memberId, at: tx.now, today: localDayAt(tx.now, venture.country), host: deps.host,
      // 5A1, 5A4: a kit offer's people need their consent recorded in this business.
      state: tx.state, venture,
    });
    // 5A2 (P4): an ask wholly outside what a kit playbook does makes no order; one partly outside lists the rest on it.
    const outOfScope = exit.orderScope(venture, request, definitions);
    const base = tx.base('venture-order');
    const orderQuantity = quantity ?? offer.pricing.defaultQuantity;
    const receipt = buildPriceReceipt(tx, { type: 'order', orderId: base.id }, { quantity: orderQuantity, taxInclusive }, blueprint, offer, client);
    const order: OrderRecord = {
      ...base, clientId: client.id, offerId: offer.id, quantity: orderQuantity, request,
      status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null, ...(intake ? { intake } : {}),
      ...(taxInclusive ? { taxInclusive: true } : {}), ...(outOfScope ? { outOfScope } : {}),
    };
    const stored = tx.put(order);
    activateTerm(tx, 'order', { recordId: stored.id, kind: 'venture-order' });
    tx.emit('order-created', { orderId: stored.id });
    return stored;
  });
}

/** venture.order.list (level read): newest first, each order with its stage steps and what waits on the owner (4J3). */
export async function listOrders(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OrderListRow[]> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  // The records the stages read are indexed once for the whole list, not once per order.
  const index = orderIndex(state, venture, deps.clock().getTime());
  return newestFirst(listRecords(state, 'venture-order', venture.id)).map(order => ({ ...order, ...orderSteps(index, order) }));
}

/**
 * venture.order.deliver (level prepare, evidence). Writes the sale fact (the order's amount before tax, by
 * delivery date), so the books can prove what was earned.
 */
export async function deliverOrder(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OrderRecord> {
  const body = exactPayload(payload, ['orderId', 'deliveredOn'], ['orderId', 'deliveredOn']);
  const orderId = recordId(body.orderId, 'Order');
  const deliveredOn = isoDate(body.deliveredOn, 'Delivery date');

  return ventureAction(deps, ctx, 'prepare', 'order.deliver', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const order = tx.find('venture-order', orderId);
    check(order, 'ORDER_NOT_FOUND', 'This order was not found.');
    check(order.status !== 'cancelled', 'INVALID_VENTURE_REQUEST', 'This order was cancelled.');
    check(order.status !== 'delivered' && order.deliveredOn === null && order.saleFactId === null, 'INVALID_VENTURE_REQUEST', 'This order is already marked delivered.');
    const client = tx.find('venture-client', order.clientId);
    check(client, 'CLIENT_NOT_FOUND', 'The client of this order was not found.');
    const receipt = tx.find('venture-price-receipt', order.priceReceiptId);
    check(receipt, 'RECEIPT_NOT_FOUND', 'The price receipt of this order was not found.');
    const offerName = tx.list('venture-blueprint').find(b => b.digest === receipt.inputs.blueprintDigest)?.offers.find(o => o.id === order.offerId)?.name.value ?? 'Service';
    const fact = insertBooksFact(tx, deps.store, saleFact(order, client, receiptTaxable(receipt), receipt.currency, deliveredOn, oneLine(offerName)));
    const delivered: OrderRecord = { ...order, deliveredOn, saleFactId: fact.id, status: 'delivered' };
    const stored = tx.replace(delivered);
    activateTerm(tx, 'deliverable', { recordId: stored.id, kind: 'venture-order' });
    tx.emit('order-delivered', { orderId: stored.id });
    return stored;
  });
}
