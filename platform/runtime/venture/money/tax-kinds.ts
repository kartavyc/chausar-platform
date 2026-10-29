// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M15): Indian invoice tax kinds beside normal GST.
// A tax-included price is split by code into the amount before tax and the tax, in BigInt, each step with its rule, so
// the total stays exactly the price the owner agreed. TDS the client deducts is kept on the payment with the section the
// client named, and settles the invoice pending the client's TDS certificate; it is never money received. A draft whose
// rate is no longer the plan's says so; it keeps the rate charged until the owner drafts it again. A business not
// registered for GST never sees any of it: taxDecision gives it 'none', and none of this applies.
import { check, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { listRecords } from '../records.ts';
import { computePrice, PRICE_RULES, type PriceAmounts, type PriceInput } from './price.ts';
import { ratePercent, taxDecision } from './tax.ts';
import type { InvoiceRecord, InvoiceView, PriceStep, VentureRecord } from '../contracts.ts';

import {computeInclusivePrice,splitsInclusive,inclusiveUnit} from './price-inclusive.ts';
export {computeInclusivePrice,splitsInclusive,inclusiveUnit,INCLUSIVE_RULES} from './price-inclusive.ts';

// ---------------------------------------------------------------------------
// TDS the client deducts (India)
// ---------------------------------------------------------------------------

/** The section the client named on their remittance ('194J', '393(1) Table 6(iii)'), as one short line. */
export function tdsSection(value: unknown): string {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ().,/-]{0,39}$/.test(value.trim()), 'INVALID_VENTURE_REQUEST',
    'Give the TDS section as the client wrote it, like 194J.');
  return value.trim();
}

/** "TDS INR 1,975.00 under 194J, to be shown on the client's TDS certificate." */
export function tdsLine(tds: { section: string; amountMinor: string }, currency: string): string {
  return `TDS ${formatMinor(tds.amountMinor, currency)} under ${tds.section}, to be shown on the client's TDS certificate.`;
}

// ---------------------------------------------------------------------------
// A rate change on drafts
// ---------------------------------------------------------------------------

/**
 * A draft invoice whose rate is no longer what the accepted plan charges this client: the rate it keeps, the rate now,
 * and the words. Issued invoices keep their rate for good, so they never have one.
 */
export function rateChangeOf(state: State, venture: VentureRecord, invoice: InvoiceRecord): InvoiceView['rateChange'] {
  if (invoice.status !== 'draft') return undefined;
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId && item.status === 'accepted');
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === invoice.clientId);
  if (!plan || !client) return undefined;
  const now = taxDecision(plan.backOffice, client, venture.country).rateBps;
  const charged = invoice.taxRateBps;
  if (now === charged) return undefined;
  const label = plan.backOffice.taxLabel.trim() || 'Tax';
  const line = now === '0'
    ? `This business does not charge ${label} now. This draft keeps ${ratePercent(charged)}%, the rate when it was drafted. Draft it again to leave ${label} off.`
    : charged === '0'
      ? `${label} is ${ratePercent(now)}% now. This draft has no ${label}, as when it was drafted. Draft it again to add it.`
      : `${label} is ${ratePercent(now)}% now. This draft keeps ${ratePercent(charged)}%, the rate when it was drafted. Draft it again to use ${ratePercent(now)}%.`;
  return { charged, now, line };
}
