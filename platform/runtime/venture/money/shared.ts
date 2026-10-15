// Lookups shared by the money handlers: blueprint versions, offers, prices, clients and list order.
import { check } from '../../contracts.ts';
import { identifier } from '../records.ts';
import type { BlueprintRecord, MinorString, Offer, VentureRecord } from '../contracts.ts';

/** The newest blueprint version, draft or accepted; null when there is none. */
export function latestBlueprint(blueprints: readonly BlueprintRecord[]): BlueprintRecord | null {
  let latest: BlueprintRecord | null = null;
  for (const blueprint of blueprints) if (latest === null || blueprint.version >= latest.version) latest = blueprint;
  return latest;
}

export function requireLatestBlueprint(blueprints: readonly BlueprintRecord[]): BlueprintRecord {
  const latest = latestBlueprint(blueprints);
  check(latest, 'BLUEPRINT_NOT_FOUND', 'Make your plan first.');
  return latest;
}

/** Real orders and invoices use the accepted plan only. */
export function requireAcceptedBlueprint(venture: VentureRecord, blueprints: readonly BlueprintRecord[]): BlueprintRecord {
  const accepted = venture.acceptedBlueprintId === null ? undefined
    : blueprints.find(b => b.id === venture.acceptedBlueprintId && b.status === 'accepted');
  check(accepted, 'BLUEPRINT_NOT_ACCEPTED', 'Accept your plan first.');
  return accepted;
}

export function requireOffer(blueprint: BlueprintRecord, offerId: string): Offer {
  const offer = blueprint.offers.find(o => o.id === offerId);
  check(offer, 'OFFER_NOT_FOUND', 'Your plan has no such offer.');
  return offer;
}

/** The owner's own price for an offer; PRICE_REQUIRED names the offer when it is not set. */
export function requirePrice(offer: Offer): MinorString {
  check(offer.pricing.unitPriceMinor !== null, 'PRICE_REQUIRED', `Set your price for ${oneLine(offer.name.value)} first.`);
  return offer.pricing.unitPriceMinor;
}

/** A quantity typed as whole-number text from 1 to 10000. */
export function quantityText(value: unknown): string {
  check(typeof value === 'string' && /^[1-9][0-9]{0,4}$/.test(value) && BigInt(value) <= 10000n,
    'INVALID_VENTURE_REQUEST', 'Quantity must be a whole number from 1 to 10000.');
  return value;
}

/** Records newest first: later 'at' first, and for the same instant the one stored later first. */
export function newestFirst<T extends { at: string }>(records: readonly T[]): T[] {
  return records.map((record, index) => ({ record, index }))
    .sort((a, b) => (a.record.at < b.record.at ? 1 : a.record.at > b.record.at ? -1 : b.index - a.index))
    .map(entry => entry.record);
}

/** Names on documents are one line already; this keeps them so even if an older record held a break. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** An id from a payload. */
export function recordId(value: unknown, field: string): string {
  return identifier(value, field);
}
