import { check } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, pageSize, plain, strictConfig } from './shared.ts';

/**
 * Stripe payout reconciliation (https://docs.stripe.com/api). The secret key, ideally a restricted
 * key with read access to balance and payouts only, reaches the runner through the credential broker
 * and is sent as a Bearer token; this file never sees it.
 *
 * First page: GET /v1/payouts/{id}. The payout is emitted as one record with `object: "payout"`,
 * which the recipe excludes, and its `amount` is the declared total. Then
 * GET /v1/balance_transactions?payout={id}&limit=N[&starting_after=txn] while `has_more`.
 * The payout's own balance transaction (type "payout", source = this payout) is dropped here, so the
 * `net` of every other transaction sums to the payout amount. Amounts are integers in the minor unit
 * of the transaction currency; a non-INR payout stays in its own currency.
 *
 * Stripe only links balance transactions to automatic payouts, so a manual payout is refused.
 */
export const STRIPE_ORIGIN = 'https://api.stripe.com';
export const STRIPE_API_VERSION = '2024-06-20';
export const STRIPE_VERSION = 'v1-adapter-1';
export const STRIPE_SCOPES = Object.freeze(['Balance: Read', 'Payouts: Read']);
export type StripePayoutConfig = { payoutId: string; pageSize?: number };

const PAYOUT_ID = /^po_[A-Za-z0-9]{8,64}$/;
const TXN_ID = /^txn_[A-Za-z0-9]{8,64}$/;
const fail = 'STRIPE_RESPONSE_INVALID';
const headers = Object.freeze({ 'Stripe-Version': STRIPE_API_VERSION });

export const stripeReadSpec: ApiReadSpec<StripePayoutConfig> = Object.freeze({
  system: 'stripe', operation: 'payout-reconciliation', version: STRIPE_VERSION, scopes: STRIPE_SCOPES, auth: 'bearer' as const,
  origins: () => [STRIPE_ORIGIN],
  validate(config: StripePayoutConfig): StripePayoutConfig {
    const c = strictConfig(config, ['payoutId', 'pageSize'], 'STRIPE_CONFIG_INVALID');
    check(typeof c.payoutId === 'string' && PAYOUT_ID.test(c.payoutId), 'STRIPE_PAYOUT_ID_INVALID', 'Enter a Stripe payout id that starts with po_.');
    // At least two per page, so a page never holds only the payout's own transaction.
    return { payoutId: c.payoutId, pageSize: pageSize(c.pageSize, 100, 2, 100, 'STRIPE_CONFIG_INVALID') };
  },
  first(config: StripePayoutConfig): ReadRequest {
    return { method: 'GET', url: `${STRIPE_ORIGIN}/v1/payouts/${config.payoutId}`, headers: { ...headers } };
  },
  parse(body: string, _response: unknown, config: StripePayoutConfig, request: ReadRequest): ParsedPage {
    const path = new URL(request.url).pathname;
    const list = `${STRIPE_ORIGIN}/v1/balance_transactions?payout=${config.payoutId}&limit=${config.pageSize}`;
    if (path === `/v1/payouts/${config.payoutId}`) {
      const payout = plain(exactJson(body, fail), fail);
      check(payout.object === 'payout' && payout.id === config.payoutId, 'STRIPE_PAYOUT_MISMATCH', 'The system returned a different payout than the one asked for.');
      check(payout.automatic === true, 'STRIPE_PAYOUT_MANUAL_UNSUPPORTED', 'Stripe lists the transactions of automatic payouts only. This payout was made manually.');
      check(payout.status === 'paid' || payout.status === 'in_transit', 'STRIPE_PAYOUT_NOT_SETTLED', 'This payout is pending, failed or cancelled. Read it after it is paid.');
      check(typeof payout.amount === 'string' && /^(?:0|[1-9]\d{0,17})$/.test(payout.amount), fail, 'The payout amount is not a whole number of minor units.');
      check(typeof payout.currency === 'string' && /^[a-z]{3}$/.test(payout.currency), fail, 'The payout has no currency code.');
      return { records: [payout], next: { method: 'GET', url: list, headers: { ...headers } },
        declared: { rowCount: null, amount: payout.amount, amountUnit: 'minor', reference: 'stripe-payout-amount' } };
    }
    check(path === '/v1/balance_transactions', fail, 'The read reached an unexpected page.');
    const root = plain(exactJson(body, fail), fail);
    check(root.object === 'list' && typeof root.has_more === 'boolean', fail, 'The system returned a response in an unexpected shape.');
    const raw = items(root.data, fail);
    for (const item of raw) check(item.object === 'balance_transaction' && typeof item.id === 'string' && TXN_ID.test(item.id), fail, 'The system returned a record of another kind.');
    const records = raw.filter(item => !(item.type === 'payout' && item.source === config.payoutId));
    let next: ReadRequest | null = null;
    if (root.has_more) {
      check(raw.length > 0, 'READ_PAGINATION_INVALID', 'The system offered another page after an empty one.');
      next = { method: 'GET', url: `${list}&starting_after=${raw.at(-1)!.id as string}`, headers: { ...headers } };
    }
    return { records, next, declared: null };
  },
});
