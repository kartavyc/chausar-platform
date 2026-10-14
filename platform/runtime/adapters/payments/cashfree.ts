import { check, ChausarError } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, pageSize, plain, requirePeriod, strictConfig } from './shared.ts';

/**
 * Cashfree Payments PG settlements (https://www.cashfree.com/docs/api-reference/payments/latest/settlements/get-all).
 * The documented read is POST {base}/pg/settlements with a JSON body of filters and a cursor, and
 * x-api-version 2023-08-01. Authentication is a pair of headers, x-client-id and x-client-secret.
 *
 * LIMITATION, by design: the read kit's auth schemes are bearer, basic, zoho and shopify. Adapters
 * may not set credential headers and never see credentials, so the header-key pair cannot be sent
 * honestly. `first` therefore refuses with CASHFREE_AUTH_UNSUPPORTED before any request or
 * credential lookup, until the read kit supports header-key auth. The parser below is complete, so
 * recorded responses and exported files read through the same path and recipe.
 */
export const CASHFREE_ORIGINS = Object.freeze({ production: 'https://api.cashfree.com', sandbox: 'https://sandbox.cashfree.com' });
export const CASHFREE_API_VERSION = '2023-08-01';
export const CASHFREE_VERSION = 'pg-2023-08-01-adapter-1';
export type CashfreeSettlementsConfig = { environment: 'production' | 'sandbox'; pageSize?: number };

const fail = 'CASHFREE_RESPONSE_INVALID';
const headers = (): Record<string, string> => ({ 'Content-Type': 'application/json', 'x-api-version': CASHFREE_API_VERSION });

/** The request Cashfree documents. Exported so the shape is reviewable; the runner never sends it today. */
export function cashfreeSettlementsRequest(config: CashfreeSettlementsConfig, period: { from: string; to: string }, cursor: string | null): ReadRequest {
  const body = { pagination: { limit: config.pageSize, cursor }, filters: { start_date: `${period.from}T00:00:00+05:30`, end_date: `${period.to}T23:59:59+05:30` } };
  return { method: 'POST', url: `${CASHFREE_ORIGINS[config.environment]}/pg/settlements`, headers: headers(), body: JSON.stringify(body) };
}

export const cashfreeReadSpec: ApiReadSpec<CashfreeSettlementsConfig> = Object.freeze({
  system: 'cashfree', operation: 'settlements', version: CASHFREE_VERSION, scopes: Object.freeze([]), auth: 'none' as const,
  origins: (config: CashfreeSettlementsConfig) => [CASHFREE_ORIGINS[config.environment]],
  validate(config: CashfreeSettlementsConfig): CashfreeSettlementsConfig {
    const c = strictConfig(config, ['environment', 'pageSize'], 'CASHFREE_CONFIG_INVALID');
    check(c.environment === 'production' || c.environment === 'sandbox', 'CASHFREE_CONFIG_INVALID', 'Choose the Cashfree production or sandbox environment.');
    return { environment: c.environment, pageSize: pageSize(c.pageSize, 100, 1, 1000, 'CASHFREE_CONFIG_INVALID') };
  },
  first(): ReadRequest {
    throw new ChausarError('CASHFREE_AUTH_UNSUPPORTED', 'Cashfree signs in with a key pair sent as headers, which this version cannot send safely. Import the settlement export file instead.');
  },
  parse(body: string, _response: unknown, config: CashfreeSettlementsConfig, request: ReadRequest): ParsedPage {
    const root = plain(exactJson(body, fail), fail);
    const records = items(root.data, fail);
    for (const record of records) check(typeof record.cf_settlement_id === 'string' && record.cf_settlement_id.length > 0, fail, 'A settlement has no Cashfree settlement id.');
    const cursor = root.cursor;
    check(cursor === null || cursor === undefined || (typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 512), fail, 'The system returned an unusable page cursor.');
    let next: ReadRequest | null = null;
    if (typeof cursor === 'string') {
      // The request body is one this adapter built; its period is carried to the next page unchanged.
      const sent = JSON.parse(request.body ?? '{}');
      const period = requirePeriod({ from: String(sent?.filters?.start_date ?? '').slice(0, 10), to: String(sent?.filters?.end_date ?? '').slice(0, 10) });
      next = cashfreeSettlementsRequest(config, period, cursor);
    }
    return { records, next, declared: null };
  },
});
