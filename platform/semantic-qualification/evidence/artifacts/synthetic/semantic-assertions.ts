import type { Exclusion, GoldenSemanticAssertion } from '../src/contracts.ts';

/**
 * Independently authored expected canonical facts. Every money, date, quantity,
 * relationship and source-row position below is an explicit reviewed literal.
 * This file imports neither source fixtures nor a mapper and performs no decimal
 * arithmetic, date parsing, unit conversion or mapped-output inspection.
 * sourceRow is the ONE-BASED position in the original source batch.
 */
function semanticRow(
  company: string, entityId: string, kind: GoldenSemanticAssertion['kind'], date: string,
  netMinor: string, taxMinor: string, grossMinor: string, currency: string, currencyScale: number,
  quantity: string, unit: string, relatedIdentity: string | null, sourceRow: number,
): GoldenSemanticAssertion {
  return {
    entityId, kind, date, company, branch: 'main', taxRegistration: 'synthetic-tax',
    currency, currencyScale, netMinor, taxMinor, grossMinor, quantity, unit, relatedIdentity, sourceRow,
  };
}

/** Positive assertions cover every included row; rejected batches expect no facts. */
export const semanticAssertionsByCase: Record<string, GoldenSemanticAssertion[]> = {
  'tuning-retail-separated-events': [
    semanticRow('synthetic-tuning-retail', 'TR-INV-1', 'invoice', '2026-04-10', '120000', '21600', '141600', 'INR', 2, '2.000', 'pcs', null, 1),
    semanticRow('synthetic-tuning-retail', 'TR-SALE-1', 'sale', '2026-04-10', '100000', '18000', '118000', 'INR', 2, '36.000', 'pcs', null, 2),
    semanticRow('synthetic-tuning-retail', 'TR-SALE-2', 'sale', '2026-04-10', '50000', '9000', '59000', 'INR', 2, '1.000', 'pcs', null, 3),
    semanticRow('synthetic-tuning-retail', 'TR-REFUND-1', 'refund', '2026-04-10', '20000', '3600', '23600', 'INR', 2, '1.000', 'pcs', 'TR-SALE-1', 4),
    semanticRow('synthetic-tuning-retail', 'TR-PAY-1', 'payment', '2026-04-10', '80000', '0', '80000', 'INR', 2, '0.000', 'pcs', null, 5),
    semanticRow('synthetic-tuning-retail', 'TR-PURCHASE-1', 'purchase', '2026-04-10', '60000', '10800', '70800', 'INR', 2, '5.000', 'pcs', null, 6),
    semanticRow('synthetic-tuning-retail', 'TR-COST-1', 'cost', '2026-04-10', '5000', '900', '5900', 'INR', 2, '0.000', 'pcs', null, 7),
  ],
  'tuning-zero-and-large-money': [
    semanticRow('synthetic-tuning-exact-money', 'TE-SALE-HUGE', 'sale', '2026-04-10', '900719925474099312', '88', '900719925474099400', 'INR', 2, '1.000', 'pcs', null, 1),
    semanticRow('synthetic-tuning-exact-money', 'TE-SALE-ZERO', 'sale', '2026-04-10', '0', '0', '0', 'INR', 2, '0.000', 'pcs', null, 2),
    semanticRow('synthetic-tuning-exact-money', 'TE-INV-ZERO', 'invoice', '2026-04-10', '0', '0', '0', 'INR', 2, '0.000', 'pcs', null, 3),
  ],
  'tuning-separated-currencies': [
    semanticRow('synthetic-tuning-currencies', 'TC-INR-SALE', 'sale', '2026-04-10', '10000', '1800', '11800', 'INR', 2, '1.000', 'pcs', null, 1),
    semanticRow('synthetic-tuning-currencies', 'TC-USD-SALE', 'sale', '2026-04-10', '1001', '80', '1081', 'USD', 2, '1.000', 'pcs', null, 2),
    semanticRow('synthetic-tuning-currencies', 'TC-JPY-SALE', 'sale', '2026-04-10', '1000', '80', '1080', 'JPY', 0, '1.000', 'pcs', null, 3),
    semanticRow('synthetic-tuning-currencies', 'TC-USD-INV', 'invoice', '2026-04-10', '500', '40', '540', 'USD', 2, '0.000', 'pcs', null, 4),
    semanticRow('synthetic-tuning-currencies', 'TC-USD-REFUND', 'refund', '2026-04-10', '101', '8', '109', 'USD', 2, '0.000', 'pcs', 'TC-USD-SALE', 5),
    semanticRow('synthetic-tuning-currencies', 'TC-INR-COST', 'cost', '2026-04-10', '200', '36', '236', 'INR', 2, '0.000', 'pcs', null, 6),
  ],
  'holdout-wholesale-independent': [
    semanticRow('synthetic-holdout-wholesale', 'HW-INV-A', 'invoice', '2026-04-03', '200000', '36000', '236000', 'INR', 2, '36.000', 'pcs', null, 1),
    semanticRow('synthetic-holdout-wholesale', 'HW-SALE-A', 'sale', '2026-04-08', '150000', '27000', '177000', 'INR', 2, '36.000', 'pcs', null, 2),
    semanticRow('synthetic-holdout-wholesale', 'HW-SALE-B', 'sale', '2026-04-09', '25000', '4500', '29500', 'INR', 2, '2.000', 'pcs', null, 3),
    semanticRow('synthetic-holdout-wholesale', 'HW-REFUND-A', 'refund', '2026-04-12', '5000', '900', '5900', 'INR', 2, '1.000', 'pcs', 'HW-INV-A', 4),
    semanticRow('synthetic-holdout-wholesale', 'HW-PAY-A', 'payment', '2026-04-13', '100000', '0', '100000', 'INR', 2, '0.000', 'pcs', null, 5),
    semanticRow('synthetic-holdout-wholesale', 'HW-PURCHASE-A', 'purchase', '2026-04-02', '70000', '12600', '82600', 'INR', 2, '7.000', 'pcs', null, 6),
    semanticRow('synthetic-holdout-wholesale', 'HW-COST-A', 'cost', '2026-04-15', '4000', '720', '4720', 'INR', 2, '0.000', 'pcs', null, 7),
  ],
  'holdout-crosscurrency-independent': [
    semanticRow('synthetic-holdout-crosscurrency', 'HX-JPY-INV', 'invoice', '2026-04-01', '3000', '240', '3240', 'JPY', 0, '0.000', 'pcs', null, 1),
    semanticRow('synthetic-holdout-crosscurrency', 'HX-JPY-SALE', 'sale', '2026-04-07', '2500', '200', '2700', 'JPY', 0, '2.000', 'pcs', null, 2),
    semanticRow('synthetic-holdout-crosscurrency', 'HX-JPY-REFUND', 'refund', '2026-04-11', '500', '40', '540', 'JPY', 0, '0.000', 'pcs', 'HX-JPY-SALE', 3),
    semanticRow('synthetic-holdout-crosscurrency', 'HX-USD-PAY', 'payment', '2026-04-16', '725', '0', '725', 'USD', 2, '0.000', 'pcs', null, 4),
    semanticRow('synthetic-holdout-crosscurrency', 'HX-INR-COST', 'cost', '2026-04-21', '50', '9', '59', 'INR', 2, '0.000', 'pcs', null, 5),
    semanticRow('synthetic-holdout-crosscurrency', 'HX-USD-PURCHASE', 'purchase', '2026-04-30', '500', '40', '540', 'USD', 2, '1.000', 'pcs', null, 6),
  ],
  'holdout-large-and-explicit-zero': [
    semanticRow('synthetic-holdout-large-money', 'HL-SALE', 'sale', '2026-04-04', '99999999999999999999', '1', '100000000000000000000', 'INR', 2, '1.000', 'pcs', null, 1),
    semanticRow('synthetic-holdout-large-money', 'HL-REFUND-ZERO', 'refund', '2026-04-05', '0', '0', '0', 'INR', 2, '0.000', 'pcs', 'HL-SALE', 2),
    semanticRow('synthetic-holdout-large-money', 'HL-INVOICE-ZERO', 'invoice', '2026-04-06', '0', '0', '0', 'INR', 2, '0.000', 'pcs', null, 3),
    semanticRow('synthetic-holdout-large-money', 'HL-PAY-ZERO', 'payment', '2026-04-07', '0', '0', '0', 'INR', 2, '0.000', 'pcs', null, 4),
    semanticRow('synthetic-holdout-large-money', 'HL-PURCHASE-ZERO', 'purchase', '2026-04-08', '0', '0', '0', 'INR', 2, '0.000', 'pcs', null, 5),
    semanticRow('synthetic-holdout-large-money', 'HL-COST-ZERO', 'cost', '2026-04-09', '0', '0', '0', 'INR', 2, '0.000', 'pcs', null, 6),
  ],
  'tuning-taxed-settled-cash': [
    semanticRow('synthetic-tuning-taxed-cash', 'TP-SETTLED', 'payment', '2026-04-27', '10000', '1800', '11800', 'INR', 2, '0.000', 'pcs', null, 1),
  ],
  'holdout-taxed-settled-cash': [
    semanticRow('synthetic-holdout-taxed-cash', 'HP-SETTLED', 'payment', '2026-04-29', '5000', '900', '5900', 'INR', 2, '0.000', 'pcs', null, 1),
  ],
  'tuning-null-amount-abstains': [],
  'holdout-null-tax-abstains': [],
  'holdout-unknown-status-abstains': [],
  'tuning-impossible-date-abstains': [],
  'holdout-refund-without-link-abstains': [],
  'tuning-cumulative-refund-limit-abstains': [],
  'holdout-unconfigured-currency-abstains': [],
  'tuning-inexact-money-abstains': [],
  'holdout-inexact-quantity-abstains': [],
};

/** Exclusions preserve explicit identity, original one-based row and state reason. */
export const exclusionAssertionsByCase: Record<string, Exclusion[]> = {
  'tuning-retail-separated-events': [
    { entityId: 'TR-CANCELLED-1', row: 8, reason: 'exclude-cancelled' },
    { entityId: 'TR-DRAFT-1', row: 9, reason: 'exclude-draft' },
    { entityId: 'TR-BOUNCED-1', row: 10, reason: 'exclude-bounced' },
  ],
  'tuning-zero-and-large-money': [],
  'tuning-separated-currencies': [],
  'holdout-wholesale-independent': [
    { entityId: 'HW-CANCELLED-A', row: 8, reason: 'exclude-cancelled' },
    { entityId: 'HW-DRAFT-A', row: 9, reason: 'exclude-draft' },
    { entityId: 'HW-BOUNCED-A', row: 10, reason: 'exclude-bounced' },
  ],
  'holdout-crosscurrency-independent': [],
  'holdout-large-and-explicit-zero': [],
  'tuning-taxed-settled-cash': [],
  'holdout-taxed-settled-cash': [],
  'tuning-null-amount-abstains': [],
  'holdout-null-tax-abstains': [],
  'holdout-unknown-status-abstains': [],
  'tuning-impossible-date-abstains': [],
  'holdout-refund-without-link-abstains': [],
  'tuning-cumulative-refund-limit-abstains': [],
  'holdout-unconfigured-currency-abstains': [],
  'tuning-inexact-money-abstains': [],
  'holdout-inexact-quantity-abstains': [],
};
