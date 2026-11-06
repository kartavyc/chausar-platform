// One-shot B4 task 7 (founder approved): a new price accepts on one press, on that exact price, with an Undo. This file
// says which versions qualify and when the Undo is too late. A version qualifies only when it changes the price of one
// offer and nothing else, so the card shows all that the press decides: two prices, or a price with any other change,
// keep the second ask and no Undo (views/queue.ts planRows, views/queue-actions.ts queueUndoHandler).
import type { State } from '../../contracts.ts';
import { blueprintCountry } from '../core/country-history.ts';
import { digest, listRecords } from '../records.ts';
import type { BlueprintRecord, Offer, VentureRecord } from '../contracts.ts';

/** A version's own marks, which every new version changes whatever it says. Words are compared; who wrote them is not. */
function sayingOf(blueprint: BlueprintRecord, offerId: string) {
  const { id: _id, at: _at, digest: _digest, status: _status, version: _version, source: _source, structureHash: _hash, modelCallIds: _calls, memberId: _member, epoch: _epoch, country: _country, ...rest } = blueprint;
  return {
    ...rest,
    offers: rest.offers.map(offer => {
      if (offer.id !== offerId) return offer;
      const { unitPriceMinor: _minor, unitPriceLabel: _label, share: _share, ...pricing } = offer.pricing;
      return { ...offer, pricing };
    }),
  };
}

/** The offers whose price or share differs between two versions (the same test as the row and its counted change). */
export function changedPrices(from: BlueprintRecord, to: BlueprintRecord): Offer[] {
  return to.offers.filter(offer => {
    const before = from.offers.find(item => item.id === offer.id);
    return (before?.pricing.unitPriceMinor ?? null) !== offer.pricing.unitPriceMinor || (before?.pricing.share?.bps ?? null) !== (offer.pricing.share?.bps ?? null);
  });
}

/** The one offer whose price is all that changed between two versions, or null when anything else did. */
export function priceOnlyOffer(venture: VentureRecord, from: BlueprintRecord, to: BlueprintRecord): Offer | null {
  const changed = changedPrices(from, to);
  if (changed.length !== 1) return null;
  const [offer] = changed;
  if (blueprintCountry(venture, from).code !== blueprintCountry(venture, to).code) return null;
  return digest(sayingOf(from, offer.id)) === digest(sayingOf(to, offer.id)) ? offer : null;
}

/** The version in use before this one: the newest accepted version under it. */
export function acceptedBefore(state: State, venture: VentureRecord, version: BlueprintRecord): BlueprintRecord | null {
  let found: BlueprintRecord | null = null;
  for (const item of listRecords(state, 'venture-blueprint', venture.id)) {
    if (item.status === 'accepted' && item.version < version.version && (!found || item.version > found.version)) found = item;
  }
  return found;
}

/**
 * Whether anything used this version's price of this offer since the press at `after` (a place in the record list):
 * a quote made after it, or an order or an invoice priced on this version. An order counts by its offer too, as an offer
 * priced as a share has no receipt. A brief written from this version carries the price to the owner's builder. A quote
 * from before the press does not count: saving a price quotes the waiting version (places/business/shared.tsx quoteAgain).
 */
export function priceInUse(state: State, venture: VentureRecord, version: BlueprintRecord, offerId: string, after: number): boolean {
  const records = state.conversations as readonly { id?: unknown; kind?: unknown }[];
  const placeOf = (record: { id: string; kind: string }) => records.findIndex(item => item?.id === record.id && item?.kind === record.kind);
  const since = (record: { id: string; kind: string }) => placeOf(record) > after;
  const orders = listRecords(state, 'venture-order', venture.id);
  const invoices = listRecords(state, 'venture-invoice', venture.id);
  const orderOffer = (orderId: string) => orders.find(order => order.id === orderId)?.offerId;
  if (orders.some(order => order.offerId === offerId && since(order))) return true;
  if (listRecords(state, 'venture-brief', venture.id).some(brief => brief.blueprintDigest === version.digest && since(brief))) return true;
  return listRecords(state, 'venture-price-receipt', venture.id).some(receipt => {
    if (receipt.inputs.blueprintDigest !== version.digest) return false;
    const { subject } = receipt;
    if (subject.type === 'offer') return subject.offerId === offerId && since(receipt);
    if (subject.type === 'order') return orderOffer(subject.orderId) === offerId;
    const invoice = invoices.find(item => item.id === subject.invoiceId);
    return invoice !== undefined && orderOffer(invoice.orderId) === offerId;
  });
}
