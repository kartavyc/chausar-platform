// Share prices (Ink v2 wave 5, package 5A2; founder decision of 23 Oct; catalogue 2.9.0's share price kind): a price
// that is a share of an amount the client confirms later, such as a recruiting success fee on the hired person's pay,
// a reimbursement audit's share of what was recovered, or a support desk's markup on the AI it passes through. The
// owner sets the share as a percent; the amount it is of is recorded later with the file that shows it, and the share
// is worked out by code in BigInt (money/quote.ts quoteShare), never by a model. On a plan an offer is either a fixed
// price or a share, never both; setting or changing either is a price change that waits on Today and asks twice
// (views/queue.ts). Simple first: the price editor shows a fixed price, and a share is one step away. Written for
// Chausar; nothing here is learned from an outside source.
import { check, type State } from '../../contracts.ts';
import { numberGuard } from '../../calculator.ts';
import { formatMinor } from '../../currency.ts';
import { bpsPercent, digest, findRecord } from '../records.ts';
import type { BpsString, Offer, VentureRecord } from '../contracts.ts';
import type { SharePrice, ShareQuote } from '../playbooks/kit/records-sales.ts';
import { quoteShare } from './quote.ts';

const SHARE_TYPED = 'Type the share as a percent, like 8.33 or 12.';

/** The owner's typed share ('8.33', '12', '0.5 %') as basis points text, from 0.01% to 100%, at most two decimals. */
export function sharePercentBps(value: unknown): BpsString {
  check(typeof value === 'string' && value.length <= 12, 'INVALID_SHARE', SHARE_TYPED);
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.replace(/[\s%]/g, ''));
  check(match, 'INVALID_SHARE', SHARE_TYPED);
  const bps = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  check(bps > 0n && bps <= 10000n, 'INVALID_SHARE', 'A share must be from 0.01% to 100%.');
  return String(bps);
}

/** A share in plain words, as the price editor and Today show it: "8.33% of the amount your client confirms". */
export function shareWords(bps: BpsString): string {
  return `${bpsPercent(bps)}% of the amount your client confirms`;
}

/** A share as a plan's offer keeps it: the owner's basis points, with no base or file until one is recorded. */
export function planShare(bps: BpsString): SharePrice {
  return { kind: 'share', bps, baseMinor: null, baseEvidenceFileId: null, words: shareWords(bps) };
}

/**
 * Applies a plan edit's share to an offer (core/blueprint.ts, venture.blueprint.update): a percent sets the share and
 * takes the fixed price away; null takes the share away and leaves the offer unpriced. A share and a fixed price in
 * one change are refused, so the owner never sets both at once. Answers true when the change set or took away a share.
 */
export function applyShareChange(offer: Offer, change: { share?: unknown; unitPrice?: unknown }): boolean {
  if (!Object.hasOwn(change, 'share')) {
    if (Object.hasOwn(change, 'unitPrice')) delete offer.pricing.share;
    return false;
  }
  check(!Object.hasOwn(change, 'unitPrice'), 'INVALID_VENTURE_REQUEST', 'Set a fixed price or a share, not both.');
  if (change.share === null) {
    delete offer.pricing.share;
    return true;
  }
  const share = change.share;
  check(typeof share === 'object' && share !== null && !Array.isArray(share) && Object.keys(share).length === 1 && Object.hasOwn(share, 'percent'),
    'INVALID_VENTURE_REQUEST', 'Send the share as { percent }.');
  offer.pricing.share = planShare(sharePercentBps((share as { percent: unknown }).percent));
  offer.pricing.unitPriceMinor = null;
  offer.pricing.unitPriceLabel = 'not-set';
  return true;
}

/**
 * Works a share out on its recorded base, as a receipt-shaped value: the base and the share as figures, the BigInt
 * step, the sentence built from them by template (and checked by numberGuard), every number a later sentence may
 * cite, and a digest. Refuses SHARE_BASE_MISSING with no recorded base, and SHARE_BASE_UNPROVEN when the file that
 * shows the base is missing or is not a file of this business.
 */
export function shareQuote(state: State, venture: VentureRecord, price: SharePrice): ShareQuote {
  check(price.baseMinor !== null, 'SHARE_BASE_MISSING', 'Record the amount this share is of first, with the file that shows it.');
  const file = price.baseEvidenceFileId === null ? undefined : findRecord(state, 'venture-upload', price.baseEvidenceFileId);
  check(file && file.ventureId === venture.id, 'SHARE_BASE_UNPROVEN', 'Add the file that shows this amount, such as the offer letter or the refund order.');
  const shareMinor = quoteShare({ bps: price.bps, baseMinor: price.baseMinor });
  const currency = venture.country.currency;
  const percent = bpsPercent(price.bps);
  const base = formatMinor(price.baseMinor, currency), share = formatMinor(shareMinor, currency);
  const figures: ShareQuote['figures'] = [
    { key: 'base', label: 'The amount your client confirmed', minor: price.baseMinor, display: base },
    { key: 'share', label: `Your share at ${percent}%`, minor: shareMinor, display: share },
  ];
  const plain = (display: string) => display.slice(currency.length + 1).replace(/,/g, '');
  const quote: ShareQuote = {
    kind: 'share', bps: price.bps, baseMinor: price.baseMinor, baseEvidenceFileId: file.id, shareMinor, currency, figures,
    steps: [{ op: 'multiply', inputs: [price.baseMinor, price.bps], resultMinor: shareMinor, rule: 'the amount times the share in basis points, over 10000, rounded half up to the minor unit' }],
    explanation: `${percent}% of ${base} (shown by ${file.name}) = ${share}.`,
    allowedNumbers: [...new Set([price.baseMinor, shareMinor, price.bps, percent, plain(base), plain(share)])],
    digest: '',
  };
  numberGuard(quote.explanation.replace(file.name, ''), quote);
  const { digest: _digest, ...body } = quote;
  quote.digest = digest(body);
  return quote;
}
