// One-shot C4 task 33 (66.d1, founder decision 1 of 5 Nov): the owner's own price applies on Save. Inside the one-press
// rule the founder approved for B4 task 7, a price the owner typed and saved in the app is the owner's approval of that
// exact price: the new version is accepted at once, recorded as the owner's decision ("Price of Monthly books set to
// ₹2,000 a month."), and comes with an Undo that puts back exactly the previous version until a quote, an order or an
// invoice uses the new price (UNDO_TOO_LATE after). A price from anywhere else (an agent, the AI, the phone), a change
// that also touches words or tax, or a save that joins another change still waiting keeps its Today row and its Accept.
// Every amount is the owner's typed price, written by formatMoney; nothing here adds anything up.
import { authorize, check, type Context } from '../../contracts.ts';
import { formatMoney } from '../../owner-format.ts';
import { activateTerm, currentVenture, isAppChannel, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { BlueprintRecord, Offer, QueueUndoResult, VentureDeps, VentureRecord } from '../contracts.ts';
import { recordDecision } from '../journal/decisions.ts';
import { blueprintsOf } from './lookups.ts';
import { blueprintDigest, ensureTerms } from './blueprint.ts';

/** The Undo's row id: one per applied version, so the Undo names exactly the version it takes back. */
export const ownerPriceRowId = (ventureId: string, blueprintId: string) => `price-set:${ventureId}:${blueprintId}`;
const ROW = /^price-set:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/;

export const OWNER_PRICE_WORDS = Object.freeze({
  tooLate: 'Too late to undo: the new price is in use or the plan changed since.',
  nothing: 'Nothing to undo here.',
});

const UNIT_WORDS: Readonly<Record<string, string>> = Object.freeze({ month: 'a month', project: 'a project', hour: 'an hour' });

/** "₹2,000 a month", from the owner's price in minor units. */
function priceWords(offer: Offer, currency: string): string {
  const minor = offer.pricing.unitPriceMinor;
  const amount = minor === null ? 'no price' : formatMoney(minor, currency);
  return `${amount} ${UNIT_WORDS[offer.pricing.quantityUnit] ?? `per ${offer.pricing.quantityUnit}`}`;
}

const names = (offers: readonly Offer[]) =>
  (offers.length === 1 ? offers[0].name.value : `${offers.slice(0, -1).map(offer => offer.name.value).join(', ')} and ${offers.at(-1)!.name.value}`);

/**
 * Whether a venture.blueprint.update request is the owner's own price, by its shape alone: from the app, by a member who
 * can approve, with only offer prices in it and no suggestion it was based on. The state decides the rest (ownerPriceApplies).
 */
export function ownerPriceShape(ctx: Context, body: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  if (!isAppChannel(ctx) || !['owner', 'cofounder'].includes(ctx.role) || Object.hasOwn(body, 'basedOn')) return false;
  if (Object.keys(patch).length !== 1 || !Array.isArray(patch.offers)) return false;
  return (patch.offers as unknown[]).every(change => !!change && typeof change === 'object'
    && Object.keys(change).every(key => key === 'id' || key === 'unitPrice') && Object.hasOwn(change, 'unitPrice'));
}

/** The offers whose price differs between two versions. */
function changedPrices(before: BlueprintRecord, after: BlueprintRecord): Offer[] {
  return after.offers.filter(offer => (before.offers.find(item => item.id === offer.id)?.pricing.unitPriceMinor ?? null) !== offer.pricing.unitPriceMinor);
}

/**
 * Inside venture.blueprint.update's transaction, once `next` is sealed: when the version it was made from is the accepted
 * plan and the new one changes prices only, `next` is stored accepted and the decision recorded. Returns the line and the
 * Undo's row id, or null when the change waits on Today as before (`next` is then left a draft).
 */
export function applyOwnerPrice(tx: VentureTx, venture: VentureRecord, latest: BlueprintRecord, next: BlueprintRecord): { line: string; undoRowId: string } | null {
  if (latest.status !== 'accepted' || venture.acceptedBlueprintId !== latest.id) return null;
  const changes = changedPrices(latest, next);
  if (!changes.length) return null;
  const currency = next.backOffice.currency;
  next.status = 'accepted';
  const undoRowId = ownerPriceRowId(venture.id, next.id);
  const said = changes.length === 1 ? `${changes[0].name.value} set to ${priceWords(changes[0], currency)}` : `${names(changes)} set to new prices`;
  recordDecision(tx, { subject: `plan:${venture.id}`, action: 'approve', ruleId: null, reason: `Price of ${said}.`, rowId: undoRowId });
  const line = changes.length === 1
    ? `You set the price of ${changes[0].name.value} to ${priceWords(changes[0], currency)}.`
    : `You set new prices for ${names(changes)}.`;
  return { line, undoRowId };
}

/** Called after `next` is stored accepted: the venture points at it, as venture.blueprint.accept does. */
export function acceptOwnerPrice(tx: VentureTx, next: BlueprintRecord): void {
  tx.touch({ acceptedBlueprintId: next.id });
  ensureTerms(tx, next);
  activateTerm(tx, 'offer', { recordId: next.id, kind: 'venture-blueprint' });
  tx.emit('blueprint-accepted', { blueprintId: next.id, version: next.version, digest: next.digest });
}

/**
 * Whether anything used the applied version's prices: an order or an invoice priced from it, or a quote for a client at
 * another quantity than the offer's usual one. The offer's own receipt at its usual quantity is how Prices shows the
 * price, so it is not a use.
 */
function usedBy(tx: VentureTx, applied: BlueprintRecord): boolean {
  return tx.list('venture-price-receipt').some(receipt => {
    if (receipt.inputs.blueprintDigest !== applied.digest) return false;
    if (receipt.subject.type !== 'offer') return true;
    const offerId = receipt.subject.offerId;
    const offer = applied.offers.find(item => item.id === offerId);
    return !offer || receipt.inputs.quantity !== offer.pricing.defaultQuantity;
  });
}

/**
 * venture.queue.undo { rowId: 'price-set:...' } (approve, app only, checked by the caller): puts back exactly the version
 * before the owner's price, as a new accepted version with the same offers, words and settings, and records it. Refused
 * UNDO_TOO_LATE once the new price is used or the plan changed again; UNDO_NOTHING when there is nothing to take back.
 */
export async function undoOwnerPrice(deps: VentureDeps, ctx: Context, rowId: string): Promise<QueueUndoResult> {
  authorize(deps.store, ctx, 'approve');
  const match = ROW.exec(rowId);
  check(match, 'UNDO_NOTHING', OWNER_PRICE_WORDS.nothing);
  const [, ventureId, blueprintId] = match;
  const state = deps.store.read();
  const venture = currentVenture(state);
  check(venture && venture.id === ventureId, 'UNDO_NOTHING', OWNER_PRICE_WORDS.nothing);
  const decisions = listRecords(state, 'venture-decision', venture.id);
  check(decisions.some(item => item.rowId === rowId && item.action === 'approve'), 'UNDO_NOTHING', OWNER_PRICE_WORDS.nothing);
  check(!decisions.some(item => item.rowId === rowId && item.action === 'undo'), 'UNDO_NOTHING', OWNER_PRICE_WORDS.nothing);
  let line = '';
  await ventureAction(deps, ctx, 'approve', 'queue.undo', tx => {
    const all = blueprintsOf(tx.state, venture.id);
    const index = all.findIndex(item => item.id === blueprintId);
    const applied = all[index];
    const previous = index > 0 ? all[index - 1] : undefined;
    check(applied && previous, 'UNDO_NOTHING', OWNER_PRICE_WORDS.nothing);
    const now = tx.venture as VentureRecord;
    check(all.at(-1)!.id === applied.id && now.acceptedBlueprintId === applied.id && applied.status === 'accepted', 'UNDO_TOO_LATE', OWNER_PRICE_WORDS.tooLate);
    check(!usedBy(tx, applied), 'UNDO_TOO_LATE', OWNER_PRICE_WORDS.tooLate);
    const restored: BlueprintRecord = { ...structuredClone(previous), ...tx.base('venture-blueprint'), version: applied.version + 1, status: 'accepted' };
    restored.digest = blueprintDigest(restored);
    tx.put(restored);
    tx.touch({ blueprintId: restored.id });
    acceptOwnerPrice(tx, restored);
    const changes = changedPrices(previous, applied);
    line = `You took back the new price${changes.length === 1 ? '' : 's'} for ${names(changes.length ? changes : applied.offers)}.`;
    recordDecision(tx, { subject: `plan:${venture.id}`, action: 'undo', ruleId: null, reason: line, rowId });
    tx.emit('queue.changed', { rowId });
  });
  return { restored: true, line };
}

