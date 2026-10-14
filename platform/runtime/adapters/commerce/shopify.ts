import { check, ChausarError } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, pageSize, plain, requirePeriod, strictConfig } from '../payments/shared.ts';

/**
 * Shopify orders through the GraphQL Admin API (https://shopify.dev/docs/api/admin-graphql/2025-07).
 * POST https://{shop}/admin/api/2025-07/graphql.json is the API's read endpoint; the query below
 * holds no mutation. The Admin API access token reaches the runner through the credential broker
 * and is sent as X-Shopify-Access-Token; this file never sees it.
 *
 * The first request also asks for ordersCount with the same search. When Shopify says that count is
 * EXACT it becomes the declared row count, and the runner refuses a read that returns a different
 * number of orders. Later pages follow pageInfo.endCursor while hasNextPage. Money is decimal text
 * in shop currency (shopMoney), kept exact.
 */
export const SHOPIFY_API_VERSION = '2025-07';
export const SHOPIFY_VERSION = 'admin-graphql-2025-07-adapter-1';
export const SHOPIFY_SCOPES = Object.freeze(['read_orders']);
export const SHOPIFY_NOTICES = Object.freeze([
  'Draft orders are not sales. They are not read here and do not establish settled business activity.',
  'Refunds need separate evidence: a refund object alone does not prove money moved.',
  'Subtotals may include tax when the store shows tax-inclusive prices. Review the tax basis before reporting net sales.',
  'Order times are read in UTC. An order placed between midnight and 5:30 a.m. IST is dated the previous day.',
]);
export type ShopifyOrdersConfig = { shop: string; pageSize?: number };

const SHOP = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
const fail = 'SHOPIFY_RESPONSE_INVALID';
export const SHOPIFY_ORDERS_QUERY = `query ChausarOrders($first: Int!, $after: String, $search: String!, $withCount: Boolean!) {
  ordersCount(query: $search, limit: null) @include(if: $withCount) { count precision }
  orders(first: $first, after: $after, query: $search, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name processedAt currencyCode cancelledAt displayFinancialStatus
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
    }
  }
}`;
type Variables = { first: number; after: string | null; search: string; withCount: boolean };
const request = (config: ShopifyOrdersConfig, variables: Variables): ReadRequest => ({
  method: 'POST', url: `https://${config.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: SHOPIFY_ORDERS_QUERY, variables }),
});

export const shopifyReadSpec: ApiReadSpec<ShopifyOrdersConfig> = Object.freeze({
  system: 'shopify', operation: 'orders', version: SHOPIFY_VERSION, scopes: SHOPIFY_SCOPES, auth: 'shopify' as const,
  origins: (config: ShopifyOrdersConfig) => [`https://${config.shop}`],
  validate(config: ShopifyOrdersConfig): ShopifyOrdersConfig {
    const c = strictConfig(config, ['shop', 'pageSize'], 'SHOPIFY_CONFIG_INVALID');
    check(typeof c.shop === 'string' && SHOP.test(c.shop), 'SHOPIFY_SHOP_INVALID', 'Enter the store address ending in .myshopify.com.');
    return { shop: c.shop, pageSize: pageSize(c.pageSize, 100, 1, 250, 'SHOPIFY_CONFIG_INVALID') };
  },
  first(config: ShopifyOrdersConfig, period: { from: string; to: string } | null): ReadRequest {
    const p = requirePeriod(period);
    const search = `processed_at:>='${p.from}T00:00:00+05:30' AND processed_at:<='${p.to}T23:59:59+05:30'`;
    return request(config, { first: config.pageSize!, after: null, search, withCount: true });
  },
  parse(body: string, _response: unknown, config: ShopifyOrdersConfig, sent: ReadRequest): ParsedPage {
    const root = plain(exactJson(body, fail), fail);
    if (root.errors !== undefined) {
      const errors = Array.isArray(root.errors) ? root.errors : [];
      if (errors.some(error => (error as any)?.extensions?.code === 'THROTTLED'))
        throw new ChausarError('SOURCE_RATE_LIMITED', 'This system asked us to slow down. Nothing was retried; read again later.');
      throw new ChausarError('SHOPIFY_QUERY_REFUSED', 'Shopify refused the orders query. The sign-in may lack read_orders.');
    }
    const data = plain(root.data, fail), orders = plain(data.orders, fail), pageInfo = plain(orders.pageInfo, fail);
    const records = items(orders.nodes, fail);
    for (const record of records) check(typeof record.id === 'string' && record.id.startsWith('gid://shopify/Order/'), fail, 'The system returned a record of another kind.');
    check(typeof pageInfo.hasNextPage === 'boolean', fail, 'The system returned a response in an unexpected shape.');
    const variables = JSON.parse(sent.body ?? '{}').variables as Variables;
    let declared: ParsedPage['declared'] = null;
    if (variables.withCount) {
      const count = plain(data.ordersCount, fail);
      check(typeof count.count === 'string' && /^(?:0|[1-9]\d{0,8})$/.test(count.count), fail, 'The order count is not a whole number.');
      if (count.precision === 'EXACT') declared = { rowCount: Number(count.count), reference: 'shopify-orders-count' };
    }
    let next: ReadRequest | null = null;
    if (pageInfo.hasNextPage) {
      check(typeof pageInfo.endCursor === 'string' && pageInfo.endCursor.length > 0 && pageInfo.endCursor.length <= 1024, fail, 'The system returned an unusable page cursor.');
      next = request(config, { ...variables, after: pageInfo.endCursor, withCount: false });
    }
    return { records, next, declared };
  },
});
