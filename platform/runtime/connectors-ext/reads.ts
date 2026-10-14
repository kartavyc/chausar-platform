import type { ApiReadSpec } from '../adapters/read-kit.ts';
import { cashfreeReadSpec, payuReadSpec, razorpayPaymentsReadSpec, razorpaySettlementReconReadSpec, razorpaySettlementsReadSpec, stripeReadSpec } from '../adapters/payments/index.ts';
import { shopifyReadSpec, woocommerceReadSpec } from '../adapters/commerce/index.ts';

/**
 * Read operations reachable through a connected system's own interface. Each binds an adapter
 * description to the recipe that maps its records and checks them against the source's totals.
 * `settings` are the connection's non-secret settings; `parameters` are per-read choices such as a
 * settlement id. Credentials are never either.
 */
export type ReadBinding = {
  group: string; id: string; label: string; recipe: string; settings: readonly string[]; parameters: readonly string[];
  spec: ApiReadSpec<any>; config(settings: Readonly<Record<string, string>>, parameters?: Readonly<Record<string, string>>): unknown;
  /** False when the adapter refuses live reads by design until a missing piece exists. */
  live: boolean; limitation: string;
};
const none = () => ({});
export const READS: readonly ReadBinding[] = [
  { group: 'razorpay', id: 'payments', label: 'Payments for a period', recipe: 'razorpay.payments', settings: [], parameters: [], spec: razorpayPaymentsReadSpec, config: none, live: true, limitation: 'The person enters the total from Razorpay\'s report. Captured payments are not net revenue.' },
  { group: 'razorpay', id: 'settlements', label: 'Settlements for a period', recipe: 'razorpay.settlements', settings: [], parameters: [], spec: razorpaySettlementsReadSpec, config: none, live: true, limitation: 'The person enters the total from Razorpay\'s report.' },
  { group: 'razorpay', id: 'settlement-recon', label: 'One settlement, item by item', recipe: 'razorpay.settlement-recon', settings: [], parameters: ['settlementId'], spec: razorpaySettlementReconReadSpec, config: (_s, p = {}) => ({ settlementId: p.settlementId }), live: true, limitation: 'Checked against the settlement\'s own amount.' },
  { group: 'stripe', id: 'payout-reconciliation', label: 'One payout, transaction by transaction', recipe: 'stripe.payout-reconciliation', settings: [], parameters: ['payoutId'], spec: stripeReadSpec, config: (_s, p = {}) => ({ payoutId: p.payoutId }), live: true, limitation: 'Automatic payouts only; checked against the payout amount.' },
  { group: 'cashfree', id: 'settlements', label: 'Settlements', recipe: 'cashfree.settlements', settings: ['environment'], parameters: [], spec: cashfreeReadSpec, config: s => ({ environment: s.environment ?? 'production' }), live: false, limitation: 'Live reads need header-key sign-in, not built yet. Exported files are read.' },
  { group: 'payu', id: 'settlement-details', label: 'Settlement details for a day', recipe: 'payu.settlement-details', settings: ['environment'], parameters: ['settlementDate'], spec: payuReadSpec, config: (s, p = {}) => ({ environment: s.environment ?? 'production', settlementDate: p.settlementDate }), live: false, limitation: 'PayU signed requests are not built yet.' },
  { group: 'shopify', id: 'orders', label: 'Orders for a period', recipe: 'shopify.orders', settings: ['shop'], parameters: [], spec: shopifyReadSpec, config: s => ({ shop: s.shop }), live: true, limitation: 'Order count is checked; the amount waits for the report total. Orders are billed claims.' },
  { group: 'woocommerce', id: 'orders', label: 'Orders for a period', recipe: 'woocommerce.orders', settings: ['site'], parameters: [], spec: woocommerceReadSpec, config: s => ({ site: s.site }), live: true, limitation: 'Order count is checked; the amount waits for the report total.' },
];
export const readsFor = (group: string) => READS.filter(item => item.group === group);
