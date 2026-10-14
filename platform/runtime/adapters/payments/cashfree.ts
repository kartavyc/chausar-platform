import { check } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, pageSize, plain, requirePeriod, strictConfig } from './shared.ts';

/**
 * Cashfree Payments PG settlements, API version 2023-08-01 ("Get All Settlements", operation
 * PGFetchSettlements): https://www.cashfree.com/docs/api-reference/payments/previous/v2023-08-01/settlements/settlements.md
 *  - POST https://api.cashfree.com/pg/settlements (sandbox: https://sandbox.cashfree.com/pg/settlements)
 *  - headers x-api-version: 2023-08-01, Content-Type application/json; sign-in is the header pair
 *    x-client-id and x-client-secret, set by the read runner from the broker (auth 'header-keys').
 *    This adapter never sees either value.
 *  - body { pagination: { limit (max 1000), cursor (null on the first call) }, filters: { start_date, end_date } }.
 *    The docs' examples spell dates as ISO 8601 UTC ("2022-07-20T00:00:00Z"); an IST calendar day is sent
 *    as its UTC instants.
 *  - response { cursor, limit, data: [settlement] }. A settlement carries cf_settlement_id, amount_settled
 *    (what reached the bank), payment_amount, service_charge, service_tax, settlement_charge,
 *    settlement_tax, adjustment, settlement_utr, settlement_date, status. Paging ends when cursor is
 *    null or absent. Amounts are decimal rupees, kept in their source spelling.
 */
export const CASHFREE_ORIGINS = Object.freeze({ production: 'https://api.cashfree.com', sandbox: 'https://sandbox.cashfree.com' });
export const CASHFREE_API_VERSION = '2023-08-01';
export const CASHFREE_VERSION = 'pg-2023-08-01-adapter-2';
export const CASHFREE_KEY_HEADERS = Object.freeze(['x-client-id', 'x-client-secret'] as const);
export type CashfreeSettlementsConfig = { environment: 'production' | 'sandbox'; pageSize?: number };

const fail = 'CASHFREE_RESPONSE_INVALID';
const headers = (): Record<string, string> => ({ 'Content-Type': 'application/json', 'x-api-version': CASHFREE_API_VERSION });
/** One IST calendar day boundary as a UTC instant, e.g. 2026-09-01 start is 2026-08-31T18:30:00Z. */
const utc = (day: string, end: boolean): string => new Date(Date.parse(`${day}T${end ? '23:59:59' : '00:00:00'}+05:30`)).toISOString().replace('.000Z', 'Z');

/** The documented request. The key pair is added by the runner, never here. */
export function cashfreeSettlementsRequest(config: CashfreeSettlementsConfig, period: { from: string; to: string }, cursor: string | null): ReadRequest {
  const body = { pagination: { limit: config.pageSize, cursor }, filters: { start_date: utc(period.from, false), end_date: utc(period.to, true) } };
  return { method: 'POST', url: `${CASHFREE_ORIGINS[config.environment]}/pg/settlements`, headers: headers(), body: JSON.stringify(body) };
}

export const cashfreeReadSpec: ApiReadSpec<CashfreeSettlementsConfig> = Object.freeze({
  system: 'cashfree', operation: 'settlements', version: CASHFREE_VERSION, scopes: Object.freeze([]),
  auth: 'header-keys' as const, keyHeaders: CASHFREE_KEY_HEADERS,
  origins: (config: CashfreeSettlementsConfig) => [CASHFREE_ORIGINS[config.environment]],
  validate(config: CashfreeSettlementsConfig): CashfreeSettlementsConfig {
    const c = strictConfig(config, ['environment', 'pageSize'], 'CASHFREE_CONFIG_INVALID');
    check(c.environment === 'production' || c.environment === 'sandbox', 'CASHFREE_CONFIG_INVALID', 'Choose the Cashfree production or sandbox environment.');
    return { environment: c.environment, pageSize: pageSize(c.pageSize, 100, 1, 1000, 'CASHFREE_CONFIG_INVALID') };
  },
  first(config: CashfreeSettlementsConfig, period: { from: string; to: string } | null): ReadRequest {
    return cashfreeSettlementsRequest(config, requirePeriod(period), null);
  },
  parse(body: string, _response: unknown, config: CashfreeSettlementsConfig, request: ReadRequest): ParsedPage {
    const root = plain(exactJson(body, fail), fail);
    const records = items(root.data, fail);
    for (const record of records) check(typeof record.cf_settlement_id === 'string' && record.cf_settlement_id.length > 0, fail, 'A settlement has no Cashfree settlement id.');
    const cursor = root.cursor;
    check(cursor === null || cursor === undefined || (typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 512), fail, 'The system returned an unusable page cursor.');
    let next: ReadRequest | null = null;
    if (typeof cursor === 'string') {
      // The request body is one this adapter built; its filters go to the next page unchanged.
      const sent = plain(JSON.parse(request.body ?? '{}'), 'READ_REQUEST_INVALID');
      check(sent.filters !== null && typeof sent.filters === 'object', 'READ_REQUEST_INVALID', 'The page request is not one this adapter made.');
      next = { ...request, headers: headers(), body: JSON.stringify({ pagination: { limit: config.pageSize, cursor }, filters: sent.filters }) };
    }
    return { records, next, declared: null };
  },
});
