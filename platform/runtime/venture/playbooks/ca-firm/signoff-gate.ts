// AI-native CA firm: the gate on regulated papers (W1, catalogue row H1). A draft for a regulated offer (a GST or TDS
// working, an income tax return, a notice reply, papers for a tax audit) can be accepted, shared or posted only once
// the CA of record has signed off those exact papers: a 'signoff' record that says signed, on a request made for this
// run, over the digest of the papers as they would go out. The owner's edit is new papers with a digest of its own,
// so it waits for its own sign-off however often it changes. Books work and a business that is not a CA firm pass
// untouched. delivery/runs.ts asks here before Accept and when it shows a run; build/share-links.ts before it makes a
// link; build/posting.ts before a post. Reads only.
//
// Which offer an order is: the playbook offer id the plan keeps (playbooks/plan.ts), which survives the owner renaming
// the offer, else the offer's own words (caOfferOf), which is how an older plan's offers are read.
import {healthClientBlock} from './health-delivery.ts';
import type { State } from '../../../contracts.ts';
import type { DeliveryRunRecord, VentureRecord } from '../../contracts.ts';
import { findRecord, listRecords } from '../../records.ts';
import { gateBlock, gateStage, papersDigestOf, papersEdit } from '../kit/signoff-core.ts';
import { pickPlaybook } from '../registry.ts';
import { CA_OFFERS, type CaOffer, type CaOfferId } from './playbook.ts';
import { CA_FIRM_ID } from './registration.ts';
import { caOfRecord, sentTo, signoffFor, signoffRequests, type SignoffSubject } from './signoff.ts';

/** The words in an offer's name or description that make it one of the playbook's offers, in CA_OFFERS order. */
const OFFER_WORDS: Readonly<Record<CaOfferId, RegExp>> = Object.freeze({
  'itr-form-and-regime': /form and regime/i,
  'itr-computation-only': /computation only/i,
  'itr-check-draft': /check.*draft.*itr/i,
  'itr-checklist': /itr checklist/i,
  'check-return-elsewhere': /return prepared elsewhere/i,
  'advance-tax-freelancer': /advance tax.*freelancer/i,
  'tax-question-desk': /tax question/i,
  'books-health-check': /books.*health|quarterly.*books/i,
  'monthly-books': /\b(books|bookkeeping|month close)\b/i,
  'gst-working': /\bgst(r)?\b/i,
  'itr-salaried': /\b(itr|income[ -]tax)\b/i,
  'itr-small-business': /\b(itr|income[ -]tax)\b.*\b(business|presumptive|44ad|44ada|profession)\b|\b(business|presumptive|44ad|44ada|profession)\b.*\b(itr|income[ -]tax)\b/i,
  'tds-working': /\btds\b/i,
  'audit-support': /\b(tax audit|audit)\b/i,
  'notice-replies': /\bnotices?\b/i,
});
/** What each regulated offer's papers are, for the sign-off record. Every regulated offer has one. */
const SUBJECT_OF: Partial<Record<CaOfferId, SignoffSubject>> = Object.freeze({
  'itr-form-and-regime':'itr-data-pack', 'itr-computation-only':'itr-data-pack', 'itr-check-draft':'itr-data-pack', 'itr-checklist':'itr-data-pack', 'check-return-elsewhere':'itr-data-pack', 'advance-tax-freelancer':'itr-data-pack', 'tax-question-desk':'letter',
  'gst-working': 'gst-working', 'tds-working': 'tds-working', 'itr-salaried': 'itr-data-pack', 'itr-small-business': 'itr-data-pack',
  'notice-replies': 'letter', 'audit-support': 'audit-papers', 'books-health-check':'audit-papers',
});
/** Which regulated offer wins when an offer's words match several: the CA's own work first, then the narrower one. */
const PRIORITY: readonly CaOfferId[] = ['itr-form-and-regime', 'itr-computation-only', 'itr-check-draft', 'itr-checklist', 'check-return-elsewhere', 'advance-tax-freelancer', 'tax-question-desk', 'notice-replies', 'audit-support', 'tds-working', 'gst-working', 'itr-small-business', 'itr-salaried', 'books-health-check', 'monthly-books'];

/** The CA firm offer an order's offer is, from its own words; null when none fits. */
export function caOfferOf(offer: { name: string; description: string }): CaOffer | null {
  const words = `${offer.name} ${offer.description}`;
  for (const id of PRIORITY) if (OFFER_WORDS[id].test(words)) return CA_OFFERS.find(item => item.id === id) ?? null;
  return null;
}

/** The CA firm offer an order is: by the playbook offer id its plan kept, else by its own words. Null outside a CA firm. */
export function caOfferFor(state: State, venture: VentureRecord, orderId: string): CaOffer | null {
  if (pickPlaybook(venture.idea)?.id !== CA_FIRM_ID) return null;
  const order = findRecord(state, 'venture-order', orderId);
  if (!order || order.ventureId !== venture.id) return null;
  const blueprints = listRecords(state, 'venture-blueprint', venture.id).filter(item => item.status === 'accepted');
  const plan = blueprints.find(item => item.id === venture.acceptedBlueprintId) ?? blueprints.at(-1);
  const offer = plan?.offers.find(item => item.id === order.offerId);
  if (!offer) return null;
  return CA_OFFERS.find(item => item.id === offer.playbookOffer) ?? caOfferOf({ name: offer.name.value, description: offer.description.value });
}

export type RegulatedPapers = { offer: CaOffer; subjectKind: SignoffSubject };

/** The regulated CA firm offer an order is, with what its papers are; null when its papers need no CA sign-off. */
export function regulatedPapersOf(state: State, venture: VentureRecord, orderId: string): RegulatedPapers | null {
  const offer = caOfferFor(state, venture, orderId);
  const subjectKind = offer?.regulated ? SUBJECT_OF[offer.id] : undefined;
  return offer && subjectKind ? { offer, subjectKind } : null;
}

type PapersRun = Pick<DeliveryRunRecord, 'id' | 'status' | 'renderedText' | 'deliverable' | 'editedText'>;

/** The owner's paper edits, including those kept when Accept preserves their exact words (clientDraft). W6 6E5: kit/signoff-core.ts. */
const editOf = papersEdit;

/** The digest the CA signs: the run's papers as they would go out. The owner's edit has a digest of its own. */
export function papersDigest(run: PapersRun): string {
  return papersDigestOf(run);
}

/**
 * Where a run's papers stand with the CA. not-needed: no sign-off is needed. outline: a template outline, never sent.
 * no-ca: no CA of record. not-asked: no request for these papers yet. unsent: asked, not sent to the CA. sent: with
 * the CA. returned: the CA returned them. changed: the CA signed other papers of this run. signed: signed, these papers.
 */
export type SignoffStage = 'not-needed' | 'outline' | 'no-ca' | 'not-asked' | 'unsent' | 'sent' | 'returned' | 'changed' | 'signed';

export function signoffStage(state: State, venture: VentureRecord, run: PapersRun & Pick<DeliveryRunRecord, 'orderId' | 'servedBy'>): SignoffStage {
  if (!regulatedPapersOf(state, venture, run.orderId)) return 'not-needed';
  // W6 6E5: the generalised gate (kit/signoff-core.ts), with the CA of record as the signer.
  const edited = editOf(run) !== null;
  const stage = gateStage({
    edited, servedByModel: run.servedBy === 'model', wanted: edited || run.servedBy === 'model' ? papersDigest(run) : '', hasSigner: !!caOfRecord(state, venture.id),
    requests: signoffRequests(state, venture.id).filter(item => item.deliveryId === run.id),
    decision: id => signoffFor(state, venture.id, id)?.decision ?? null,
    sent: id => !!sentTo(state, venture.id, id),
  });
  return stage === 'no-signer' ? 'no-ca' : stage;
}

export const SIGNOFF_WORDS = Object.freeze({
  noCa: 'These are regulated papers. Name your CA of record, who signs them off before you accept or share them.',
  outline: 'An outline is never signed off. Draft these regulated papers with your AI; your CA signs them off before you accept or share them.',
  notSent: 'These regulated papers have not gone to your CA yet. Send them to your CA, who signs them off before you accept or share them.',
  sent: 'These regulated papers are with your CA, waiting for the sign-off. You accept or share them once your CA signs.',
  returned: 'Your CA returned these papers, so they cannot be accepted or shared. Draft them again.',
  changed: 'Your CA signed a different version of these papers. Only the papers your CA signed can be accepted or shared.',
  editNotSent: 'You edited these regulated papers, and your edit has not gone to your CA yet. Send it to your CA; it reaches a client only once your CA signs it.',
  editSent: 'Your edit of these regulated papers is with your CA, waiting for the sign-off. It reaches a client only once your CA signs it.',
});

/**
 * Why a run's papers can't be accepted, shared or posted yet, or null when they can: they need no CA sign-off, or the
 * CA of record signed off exactly these papers.
 */
export function caSignoffBlock(state: State, venture: VentureRecord, run: PapersRun & Pick<DeliveryRunRecord, 'orderId' | 'servedBy'>): string | null {
  if(caOfferFor(state,venture,run.orderId)?.id==='books-health-check'){const block=healthClientBlock(state,venture.id,run);if(block)return block;}
  const stage = signoffStage(state, venture, run);
  return gateBlock(stage === 'no-ca' ? 'no-signer' : stage, editOf(run) !== null, { ...SIGNOFF_WORDS, noSigner: SIGNOFF_WORDS.noCa });
}
