import { check } from '../../contracts.ts';
import { validDate } from '../../memory.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, plain, strictConfig } from './shared.ts';

/**
 * PayU India settlement details, through the merchant post-service API:
 * https://docs.payu.in/reference/get_settlement_details_api and the post-service hash rule
 * https://docs.payu.in/docs/apis-used-for-merchant-integration.
 *  - POST https://info.payu.in/merchant/postservice.php?form=2 (test: https://test.payu.in/...),
 *    Content-Type application/x-www-form-urlencoded.
 *  - form: key, command=get_settlement_details, var1=<settlement date YYYY-MM-DD>, var2=<page number>,
 *    var3=<records per page> (2000 when absent), hash = sha512(key|command|var1|salt).
 *  - response { status: 1, msg, Txn_details: [...] }; status 0 means nothing settled that day.
 *
 * Auth is 'payu-hash': this adapter writes command, var1 and the paging fields only. The read runner
 * adds `key` and `hash` from the broker's "key:salt"; the salt never reaches this file, the result or
 * the request log. Paging: a full page asks for the next page number; a short or empty page ends the read.
 */
export const PAYU_ORIGINS = Object.freeze({ production: 'https://info.payu.in', test: 'https://test.payu.in' });
export const PAYU_VERSION = 'postservice-form2-adapter-2';
export const PAYU_COMMAND = 'get_settlement_details';
export const PAYU_PAGE_SIZE = 500;
export type PayuSettlementConfig = { environment: 'production' | 'test'; settlementDate: string };

const fail = 'PAYU_RESPONSE_INVALID';
export const payuEndpoint = (config: PayuSettlementConfig): string => `${PAYU_ORIGINS[config.environment]}/merchant/postservice.php?form=2`;
/** The unsigned form this adapter sends; the runner signs it. */
export function payuSettlementRequest(config: PayuSettlementConfig, page: number): ReadRequest {
  const form = new URLSearchParams({ command: PAYU_COMMAND, var1: config.settlementDate, var2: String(page), var3: String(PAYU_PAGE_SIZE) });
  return { method: 'POST', url: payuEndpoint(config), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() };
}

export const payuReadSpec: ApiReadSpec<PayuSettlementConfig> = Object.freeze({
  system: 'payu', operation: 'settlement-details', version: PAYU_VERSION, scopes: Object.freeze([]), auth: 'payu-hash' as const,
  origins: (config: PayuSettlementConfig) => [PAYU_ORIGINS[config.environment]],
  validate(config: PayuSettlementConfig): PayuSettlementConfig {
    const c = strictConfig(config, ['environment', 'settlementDate'], 'PAYU_CONFIG_INVALID');
    check(c.environment === 'production' || c.environment === 'test', 'PAYU_CONFIG_INVALID', 'Choose the PayU production or test environment.');
    check(validDate(c.settlementDate), 'PAYU_CONFIG_INVALID', 'Choose the settlement date to read.');
    return { environment: c.environment, settlementDate: c.settlementDate };
  },
  first: (config: PayuSettlementConfig): ReadRequest => payuSettlementRequest(config, 1),
  parse(body: string, _response: unknown, config: PayuSettlementConfig, request: ReadRequest): ParsedPage {
    const root = plain(exactJson(body, fail), fail);
    // status 1 with Txn_details; status 0 means no settlement on that date (or no further page).
    if (root.status === '0') { check(root.Txn_details === undefined || (Array.isArray(root.Txn_details) && root.Txn_details.length === 0), fail, 'The system returned a response in an unexpected shape.'); return { records: [], next: null, declared: null }; }
    check(root.status === '1', fail, 'The system returned a response in an unexpected shape.');
    const records = items(root.Txn_details, fail);
    for (const record of records) check(typeof record.payuid === 'string' && record.payuid.length > 0, fail, 'A settled transaction has no PayU id.');
    check(records.length <= PAYU_PAGE_SIZE, fail, 'The system returned more records than the page size asked for.');
    // The request is one this adapter built; it carries the page number.
    const page = Number(new URLSearchParams(request.body ?? '').get('var2') ?? '');
    check(Number.isSafeInteger(page) && page >= 1, 'READ_REQUEST_INVALID', 'The page request is not one this adapter made.');
    return { records, next: records.length === PAYU_PAGE_SIZE ? payuSettlementRequest(config, page + 1) : null, declared: null };
  },
});
