// Chausar venture launcher, core (Ink v2 wave 4, package 4J8; catalogue U3, "Add this to {business}"): offers the owner
// adds to the plan. Each one is a venture-owner-offer record, so the plan's structure (core/blueprint.ts structureOf)
// appends it on every rewrite and carryOver keeps its price; a plan otherwise rebuilds its offers from its interview,
// composition or playbook and would drop it. Ids are stable (offer_own_1 upward, never reused). A new offer has no
// price, so Today's "Set your prices" names it; the owner sets one as for any offer. Its words are the owner's: one
// line each, never a price or a number. Rewrite with AI never touches them; a suggestion may reword them, applied only
// when the owner applies its patch. The owner may take one out again, unless an open order uses it. On a flagship
// playbook's plan an order for one takes the playbook's own intake (playbooks/plan.ts flagshipOffer). Everything here
// runs inside venture.blueprint.update's transaction.
import { check, ChausarError, type State } from '../../contracts.ts';
import type { BlueprintRecord, Offer, OwnerOfferRecord, PricingModel } from '../contracts.ts';
import { exactPayload, listRecords, singleLine, type VentureTx } from '../records.ts';
import { isPricingModel, UNIT_OF } from './interview.ts';
import { noNumberWords, toldByYou } from './words.ts';

export const OWNER_OFFER_PREFIX = 'offer_own_';
/** How many offers the owner may have added at once. */
export const OWNER_OFFERS_MAX = 5;
export type OwnerOfferInput = { name: string; description: string; pricingModel: PricingModel };

/** The offers the owner added and has not taken out, oldest first. */
export function liveOwnerOffers(state: State, ventureId: string): OwnerOfferRecord[] {
  return listRecords(state, 'venture-owner-offer', ventureId).filter(record => record.removedAt === null);
}

/** The owner's words for an offer: one line, never a price or a number (the rule a suggestion's offer words keep). */
export function ownerOfferWords(value: unknown, field: string, max: number): string {
  const text = singleLine(value, field, { min: 2, max });
  try {
    noNumberWords(text, field.toLowerCase(), []);
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'MODEL_OUTPUT_REJECTED') throw error;
    throw new ChausarError('INVALID_VENTURE_REQUEST', `${field} can't hold a price or a number. Set the price under Set your prices.`);
  }
  return text;
}

/** An addOffer as sent: a name, a description and how it is charged; never a price. */
export function ownerOfferInput(value: unknown): OwnerOfferInput {
  const body = exactPayload(value, ['name', 'description', 'pricingModel'], ['name', 'description', 'pricingModel']);
  const name = ownerOfferWords(body.name, 'The offer name', 60);
  const description = ownerOfferWords(body.description, 'The offer description', 200);
  check(isPricingModel(body.pricingModel), 'INVALID_VENTURE_REQUEST', 'Choose per month, per project or per hour.');
  return { name, description, pricingModel: body.pricingModel };
}

/** A plan offer for an owner's offer record: the owner's words, its pricing, and no price. */
export function ownerOfferOn(record: Pick<OwnerOfferRecord, 'offerId' | 'name' | 'description' | 'pricingModel'>): Offer {
  return {
    id: record.offerId, addedByOwner: true, name: toldByYou(record.name), description: toldByYou(record.description),
    pricing: { model: record.pricingModel, quantityUnit: UNIT_OF[record.pricingModel], unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' },
  };
}

/** Adds an owner's offer to the plan's next version, with its record. Returns the new offer's id. */
export function addOwnerOffer(tx: VentureTx, next: BlueprintRecord, input: OwnerOfferInput): string {
  check(next.offers.filter(offer => offer.addedByOwner).length < OWNER_OFFERS_MAX, 'INVALID_VENTURE_REQUEST', 'Your plan holds five offers you added. Take one out first.');
  const offerId = `${OWNER_OFFER_PREFIX}${tx.list('venture-owner-offer').length + 1}`;
  check(!next.offers.some(offer => offer.id === offerId), 'INVALID_VENTURE_REQUEST', 'Your plan has that offer already.');
  const record: OwnerOfferRecord = { ...tx.base('venture-owner-offer'), offerId, name: input.name, description: input.description, pricingModel: input.pricingModel, removedAt: null };
  tx.put(record);
  next.offers.push(ownerOfferOn(record));
  return offerId;
}

/** Takes an owner's offer out of the plan's next version; its record keeps when. Refused while an open order uses it. */
export function removeOwnerOffer(tx: VentureTx, next: BlueprintRecord, value: unknown): void {
  const body = exactPayload(value, ['id'], ['id']);
  const offer = next.offers.find(item => item.id === body.id);
  check(offer, 'OFFER_NOT_FOUND', 'That offer is not in your plan.');
  check(offer.addedByOwner === true, 'INVALID_VENTURE_REQUEST', 'Only an offer you added can be taken out.');
  check(!tx.list('venture-order').some(order => order.offerId === offer.id && order.status === 'open'), 'INVALID_VENTURE_REQUEST', 'An open order uses this offer. Deliver or cancel it first.');
  for (const record of tx.list('venture-owner-offer')) if (record.offerId === offer.id && record.removedAt === null) tx.replace<OwnerOfferRecord>({ ...record, removedAt: tx.now });
  next.offers = next.offers.filter(item => item.id !== offer.id);
}

/** Keeps each owner offer's record in step with the plan's words and pricing, after an owner edit. */
export function syncOwnerOffers(tx: VentureTx, next: BlueprintRecord): void {
  for (const offer of next.offers) {
    if (!offer.addedByOwner) continue;
    const record = tx.list('venture-owner-offer').find(item => item.offerId === offer.id && item.removedAt === null);
    if (!record) continue;
    if (record.name === offer.name.value && record.description === offer.description.value && record.pricingModel === offer.pricing.model) continue;
    tx.replace<OwnerOfferRecord>({ ...record, name: offer.name.value, description: offer.description.value, pricingModel: offer.pricing.model });
  }
}
