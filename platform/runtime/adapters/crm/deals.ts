import { check } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { checkPeriod, currencyCode, istMidnightMs, nextDay, optionalCurrency, pageToken, parseSourceJson, scalarText, sourceArray, sourceObject, strictConfig } from '../google/common.ts';

/**
 * CRM deal reads. A deal is a sales opportunity, not a sale: a won deal is a commitment that has not
 * been invoiced or earned. Records carry the stage as source text; recipes map won stages to
 * 'deal_won', lost stages to 'deal_lost' and the rest to 'deal_open', never to 'sale'.
 * Amounts are the CRM's own major-unit numbers, exact as the system spelled them.
 */

// ---------------------------------------------------------------- Zoho CRM
export type ZohoCrmDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca';
export const ZOHO_CRM_DATA_CENTERS: readonly ZohoCrmDataCenter[] = Object.freeze(['com', 'eu', 'in', 'com.au', 'jp', 'ca']);
export const ZOHO_CRM_DEALS_SCOPE = 'ZohoCRM.modules.deals.READ';
export type ZohoCrmDealsConfig = {
  dataCenter: ZohoCrmDataCenter;
  /** The org's home currency, used only for deals that carry no Currency (single-currency orgs). */
  orgCurrency?: string;
};
const zohoOrigin = (dc: ZohoCrmDataCenter) => `https://www.zohoapis.${dc}`;
export function zohoCrmDealsUrl(config: ZohoCrmDealsConfig, token?: string): string {
  const url = `${zohoOrigin(config.dataCenter)}/crm/v8/Deals?fields=Deal_Name,Amount,Stage,Closing_Date,Currency&per_page=200`;
  return token === undefined ? url : `${url}&page_token=${encodeURIComponent(token)}`;
}
/**
 * Every deal in the module (the list endpoint has no date filter; Closing_Date travels with each
 * record and the recipe reports the period it saw). Pages follow info.next_page_token while
 * info.more_records is true. Zoho answers an empty module with 204 and no body.
 */
export const zohoCrmDealsSpec: ApiReadSpec<ZohoCrmDealsConfig> = Object.freeze({
  system: 'zoho-crm', operation: 'deals', version: '1',
  scopes: Object.freeze([ZOHO_CRM_DEALS_SCOPE]), auth: 'zoho',
  origins: config => [zohoOrigin(config.dataCenter)],
  validate(config: ZohoCrmDealsConfig) {
    strictConfig(config, ['dataCenter', 'orgCurrency'], ['dataCenter']);
    check(ZOHO_CRM_DATA_CENTERS.includes(config.dataCenter), 'CONFIG_INVALID', 'Choose the Zoho data center the account lives in.');
    optionalCurrency(config.orgCurrency);
    return config;
  },
  first: config => ({ method: 'GET', url: zohoCrmDealsUrl(config) }),
  parse(body, _response, config): ParsedPage {
    if (body.trim() === '') return { records: [], next: null };
    const root = parseSourceJson(body), info = sourceObject(root.info);
    const records = sourceArray(root.data).map(entry => {
      const deal = sourceObject(entry), id = scalarText(deal.id);
      check(/^\d{1,30}$/.test(id), 'SOURCE_ID_INVALID', 'A deal has no usable id.');
      const amount = scalarText(deal.Amount);
      return { id, Deal_Name: scalarText(deal.Deal_Name), Amount: amount, amountState: amount.trim() === '' ? 'missing' : 'stated',
        Stage: scalarText(deal.Stage), Closing_Date: scalarText(deal.Closing_Date), Currency: currencyCode(deal.Currency) || (config.orgCurrency ?? '') };
    });
    check(typeof info.more_records === 'boolean', 'SOURCE_PAGINATION_INVALID', 'The system did not say whether more records follow.');
    const next: ReadRequest | null = info.more_records ? { method: 'GET', url: zohoCrmDealsUrl(config, pageToken(info.next_page_token)) } : null;
    return { records, next };
  },
});

// ---------------------------------------------------------------- HubSpot
export const HUBSPOT_DEALS_SCOPE = 'crm.objects.deals.read';
const HUBSPOT = 'https://api.hubapi.com';
export const HUBSPOT_DEALS_SEARCH_URL = `${HUBSPOT}/crm/v3/objects/deals/search`;
/** The search endpoint returns at most this many results for one query, whatever `total` says. */
export const HUBSPOT_SEARCH_WINDOW = 10_000;
export type HubSpotDealsConfig = {
  /** The portal's company currency, used only for deals with no deal_currency_code. */
  orgCurrency?: string;
};
export function hubspotDealsSearchBody(period: { from: string; to: string } | null, after?: string): string {
  // closedate is an instant; the period is India Standard Time calendar days, inclusive.
  const filterGroups = period ? [{ filters: [{ propertyName: 'closedate', operator: 'BETWEEN',
    value: String(istMidnightMs(period.from)), highValue: String(istMidnightMs(nextDay(period.to)) - 1) }] }] : [];
  return JSON.stringify({ filterGroups, properties: ['amount', 'dealstage', 'closedate', 'deal_currency_code', 'dealname'],
    sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }], limit: 100, ...(after === undefined ? {} : { after }) });
}
const searchRequest = (body: string): ReadRequest => ({ method: 'POST', url: HUBSPOT_DEALS_SEARCH_URL, headers: { 'Content-Type': 'application/json' }, body });
/**
 * POST to the CRM search endpoint is a read: it changes nothing. `total` is HubSpot's own count of
 * matching deals and becomes the declared row count, so a read that returns fewer is refused.
 */
export const hubspotDealsSpec: ApiReadSpec<HubSpotDealsConfig> = Object.freeze({
  system: 'hubspot', operation: 'deals', version: '1',
  scopes: Object.freeze([HUBSPOT_DEALS_SCOPE]), auth: 'bearer',
  origins: () => [HUBSPOT],
  validate(config: HubSpotDealsConfig) { strictConfig(config, ['orgCurrency']); optionalCurrency(config.orgCurrency); return config; },
  first: (_config, period) => searchRequest(hubspotDealsSearchBody(checkPeriod(period, false))),
  parse(body, _response, config, request): ParsedPage {
    const root = parseSourceJson(body), total = scalarText(root.total);
    check(/^\d{1,9}$/.test(total), 'SOURCE_TOTAL_INVALID', 'The system did not state how many deals match.');
    check(Number(total) <= HUBSPOT_SEARCH_WINDOW, 'HUBSPOT_SEARCH_WINDOW', 'More deals match than one search can return. Choose a shorter period.');
    const records = sourceArray(root.results).map(entry => {
      const deal = sourceObject(entry), props = sourceObject(deal.properties ?? {}), id = scalarText(deal.id);
      check(/^\d{1,30}$/.test(id), 'SOURCE_ID_INVALID', 'A deal has no usable id.');
      const close = scalarText(props.closedate), closeMs = close === '' ? '' : String(Date.parse(close));
      check(close === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(close) && closeMs !== 'NaN', 'SOURCE_DATE_INVALID', 'A close date is not a UTC timestamp.');
      const amount = scalarText(props.amount);
      return { id, dealname: scalarText(props.dealname), amount, amountState: amount.trim() === '' ? 'missing' : 'stated', dealstage: scalarText(props.dealstage),
        closedate: close, closeDateMs: closeMs, currency: currencyCode(props.deal_currency_code) || (config.orgCurrency ?? '') };
    });
    let next: ReadRequest | null = null;
    if (root.paging !== undefined) {
      const after = scalarText(sourceObject(sourceObject(root.paging).next ?? {}).after);
      if (after !== '') {
        check(/^\d{1,9}$/.test(after), 'SOURCE_PAGINATION_INVALID', 'The system returned an unusable page cursor.');
        // Same query, next cursor: the body is this adapter's own JSON, never source text.
        next = searchRequest(JSON.stringify({ ...JSON.parse(request.body ?? '{}'), after }));
      }
    }
    return { records, next, declared: { rowCount: Number(total), reference: 'hubspot-search-total' } };
  },
});
