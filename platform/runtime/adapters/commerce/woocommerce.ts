import { check } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, pageSize, requirePeriod, strictConfig } from '../payments/shared.ts';

/**
 * WooCommerce orders through the REST API v3 (https://woocommerce.github.io/woocommerce-rest-api-docs/#list-all-orders).
 * GET {site}/wp-json/wc/v3/orders?per_page=N&page=P&after=&before=&orderby=date&order=asc.
 * The consumer key and secret reach the runner through the credential broker as "ck_...:cs_..." and
 * are sent as HTTP Basic over HTTPS only; this file never sees them.
 *
 * X-WP-Total is the declared order count, checked by the runner against the orders returned.
 * X-WP-TotalPages bounds paging: it must agree with the total and page size, every page before the
 * last must be full, and no page is requested past it. Money is decimal text in the order currency.
 */
export const WOOCOMMERCE_VERSION = 'wc-v3-adapter-1';
export const WOOCOMMERCE_SCOPES = Object.freeze(['read']);
export const WOOCOMMERCE_NOTICES = Object.freeze([
  'Order totals include tax and shipping. Refunded and cancelled orders stay listed with their status.',
  'Order dates are the store\'s local time. Check that the store is set to India time.',
]);
export type WooCommerceOrdersConfig = { site: string; pageSize?: number };
const fail = 'WOOCOMMERCE_RESPONSE_INVALID';

function origin(site: unknown): string {
  check(typeof site === 'string' && site.length <= 300, 'WOOCOMMERCE_SITE_INVALID', 'Enter the store address as https:// and the domain only.');
  let url: URL;
  try { url = new URL(site); } catch { check(false, 'WOOCOMMERCE_SITE_INVALID', 'Enter the store address as https:// and the domain only.'); }
  check(url!.protocol === 'https:' && !url!.username && !url!.password && (url!.pathname === '/' || url!.pathname === '') && !url!.search && !url!.hash
    && /^[a-z0-9.-]+$/.test(url!.hostname) && url!.hostname.includes('.') && site.replace(/\/$/, '') === url!.origin
    // A public store name, never an IP literal or a private or local name.
    && !/^[\d.]+$/.test(url!.hostname) && !/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(url!.hostname),
    'WOOCOMMERCE_SITE_INVALID', 'Enter the store address as https:// and the domain only.');
  return url!.origin;
}
const pageUrl = (config: WooCommerceOrdersConfig, page: number, from: string, to: string) =>
  `${config.site}/wp-json/wc/v3/orders?per_page=${config.pageSize}&page=${page}&after=${from}T00:00:00&before=${to}T23:59:59&orderby=date&order=asc`;
const header = (headers: Record<string, string>, name: string): number => {
  const value = headers[name];
  check(typeof value === 'string' && /^(?:0|[1-9]\d{0,8})$/.test(value.trim()), 'WOOCOMMERCE_TOTAL_MISSING', 'The store did not state its total order count. The read cannot be checked.');
  return Number(value.trim());
};

export const woocommerceReadSpec: ApiReadSpec<WooCommerceOrdersConfig> = Object.freeze({
  system: 'woocommerce', operation: 'orders', version: WOOCOMMERCE_VERSION, scopes: WOOCOMMERCE_SCOPES, auth: 'basic' as const,
  origins: (config: WooCommerceOrdersConfig) => [config.site],
  validate(config: WooCommerceOrdersConfig): WooCommerceOrdersConfig {
    const c = strictConfig(config, ['site', 'pageSize'], 'WOOCOMMERCE_CONFIG_INVALID');
    return { site: origin(c.site), pageSize: pageSize(c.pageSize, 100, 1, 100, 'WOOCOMMERCE_CONFIG_INVALID') };
  },
  first(config: WooCommerceOrdersConfig, period: { from: string; to: string } | null): ReadRequest {
    const p = requirePeriod(period);
    return { method: 'GET', url: pageUrl(config, 1, p.from, p.to) };
  },
  parse(body: string, response: { headers: Record<string, string> }, config: WooCommerceOrdersConfig, request: ReadRequest): ParsedPage {
    const records = items(exactJson(body, fail), fail);
    for (const record of records) check(typeof record.id === 'string' && /^\d+$/.test(record.id), fail, 'The system returned a record of another kind.');
    const total = header(response.headers, 'x-wp-total'), pages = header(response.headers, 'x-wp-totalpages');
    const size = config.pageSize!, params = new URL(request.url).searchParams, page = Number(params.get('page'));
    check(pages === Math.ceil(total / size), 'WOOCOMMERCE_PAGING_INVALID', 'The store\'s page count does not agree with its order count.');
    check(page >= 1 && (page <= pages || (pages === 0 && page === 1)), 'WOOCOMMERCE_PAGING_INVALID', 'The read went past the store\'s last page.');
    check(page === pages || pages === 0 ? records.length === total - (page - 1) * size : records.length === size, 'WOOCOMMERCE_PAGE_SHORT', 'A page has fewer orders than the store says it holds. The read is incomplete.');
    const next = page < pages ? { method: 'GET' as const, url: pageUrl(config, page + 1, params.get('after')!.slice(0, 10), params.get('before')!.slice(0, 10)) } : null;
    return { records, next, declared: { rowCount: total, reference: 'woocommerce-x-wp-total' } };
  },
});
