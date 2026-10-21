// AI-native CA firm: a delivery run for a regulated offer asks the CA of record to sign off its papers when the draft
// is ready. delivery/runs.ts calls requestSignoffForRun after a run reaches 'ready-for-review'; this file decides
// whether the run's papers are regulated and puts them in front of the CA (signoff.ts). It never undoes or fails the
// run: whatever goes wrong here leaves the draft as it is, and the owner can still read it.
//
// When it asks:
// - the business's idea picks the AI-native CA firm playbook, and a CA of record is named;
// - the order's offer is one of the playbook's regulated offers, matched by its own words (GST, TDS, income tax return,
//   notice); a tax audit is the CA's own work end to end, so its papers are not sent on their own;
// - the draft can be accepted as it stands: an agent draft at approve each whose checks passed. A practice draft, a
//   draft with a failed check, and a template outline (which never read the client's request) are not papers yet.
// A run asks once: requestCaSignoff returns the earlier request for the same run.
import type { Context } from '../../../contracts.ts';
import type { DeliveryRunView, VentureDeps } from '../../contracts.ts';
import { digest, findRecord, listRecords, readVenture } from '../../records.ts';
import { pickPlaybook } from '../registry.ts';
import { CA_OFFERS, type CaOffer, type CaOfferId } from './playbook.ts';
import { CA_FIRM_ID } from './registration.ts';
import { caOfRecord, requestCaSignoff, type SignoffSubject } from './signoff.ts';

/** The words in an offer's name or description that make it one of the playbook's offers, in CA_OFFERS order. */
const OFFER_WORDS: Readonly<Record<CaOfferId, RegExp>> = Object.freeze({
  'monthly-books': /\b(books|bookkeeping|month close)\b/i,
  'gst-working': /\bgst(r)?\b/i,
  'itr-salaried': /\b(itr|income[ -]tax)\b/i,
  'itr-small-business': /\b(itr|income[ -]tax)\b.*\b(business|presumptive|44ad|44ada|profession)\b|\b(business|presumptive|44ad|44ada|profession)\b.*\b(itr|income[ -]tax)\b/i,
  'tds-working': /\btds\b/i,
  'audit-support': /\b(tax audit|audit)\b/i,
  'notice-replies': /\bnotices?\b/i,
});
/** What each regulated offer's papers are, for the sign-off record. Absent: the offer's papers are not sent on their own. */
const SUBJECT_OF: Partial<Record<CaOfferId, SignoffSubject>> = Object.freeze({
  'gst-working': 'gst-working', 'tds-working': 'tds-working', 'itr-salaried': 'itr-data-pack', 'itr-small-business': 'itr-data-pack', 'notice-replies': 'letter',
});
/** Which regulated offer wins when an offer's words match several: the CA's own work first, then the narrower one. */
const PRIORITY: readonly CaOfferId[] = ['notice-replies', 'audit-support', 'tds-working', 'gst-working', 'itr-small-business', 'itr-salaried', 'monthly-books'];

/** The CA firm offer an order's offer is, from its own words; null when none fits. */
export function caOfferOf(offer: { name: string; description: string }): CaOffer | null {
  const words = `${offer.name} ${offer.description}`;
  for (const id of PRIORITY) if (OFFER_WORDS[id].test(words)) return CA_OFFERS.find(item => item.id === id) ?? null;
  return null;
}

const RECEIPT_ID = /^[A-Za-z0-9_.:-]{3,80}$/;

/**
 * Puts a ready run's papers in front of the CA of record when the run is regulated CA firm work. Returns the request id
 * it made or found, or null when the run is not regulated work or anything stopped it. Never throws.
 */
export async function requestSignoffForRun(deps: VentureDeps, ctx: Context, run: Pick<DeliveryRunView, 'id' | 'status' | 'canAccept' | 'servedBy' | 'orderId'>): Promise<string | null> {
  try {
    if (run.status !== 'ready-for-review' || !run.canAccept || run.servedBy !== 'model') return null;
    const { state, venture } = readVenture(deps, ctx);
    if (pickPlaybook(venture.idea)?.id !== CA_FIRM_ID || !caOfRecord(state, venture.id)) return null;
    const stored = findRecord(state, 'venture-delivery-run', run.id);
    const order = findRecord(state, 'venture-order', run.orderId);
    if (!stored || stored.ventureId !== venture.id || !order || order.ventureId !== venture.id) return null;
    const blueprints = listRecords(state, 'venture-blueprint', venture.id).filter(item => item.status === 'accepted');
    const plan = blueprints.find(item => item.id === venture.acceptedBlueprintId) ?? blueprints.at(-1);
    const offer = plan?.offers.find(item => item.id === order.offerId);
    if (!offer) return null;
    const caOffer = caOfferOf({ name: offer.name.value, description: offer.description.value });
    const subjectKind = caOffer?.regulated ? SUBJECT_OF[caOffer.id] : undefined;
    if (!caOffer || !subjectKind) return null;
    const client = findRecord(state, 'venture-client', order.clientId);
    const clientName = client && client.ventureId === venture.id ? client.name.slice(0, 120) : null;
    const title = `${caOffer.name}${clientName ? ` for ${clientName}` : ''}`.slice(0, 140);
    const receiptIds = [order.priceReceiptId, ...(stored.harness?.workReceiptIds ?? [])].filter(id => RECEIPT_ID.test(id)).slice(0, 50);
    if (!receiptIds.length) return null;
    const request = await requestCaSignoff(deps, ctx, {
      subjectKind, title, clientName, workingDigest: digest({ runId: stored.id, text: stored.renderedText, deliverable: stored.deliverable }),
      receiptIds, playbookHash: /^[a-f0-9]{64}$/.test(stored.playbookHash) ? stored.playbookHash : null, deliveryId: stored.id,
    });
    return request.id;
  } catch {
    // The draft stands as it is: asking the CA is never a reason for the run itself to fail.
    return null;
  }
}
