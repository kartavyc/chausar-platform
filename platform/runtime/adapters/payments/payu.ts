import { check, ChausarError } from '../../contracts.ts';
import { validDate } from '../../memory.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { exactJson, items, plain, strictConfig } from './shared.ts';

/**
 * PayU India settlement details (https://docs.payu.in/reference/get_settlement_details_api).
 * The documented read is POST {base}/merchant/postservice.php?form=2 with form fields
 * key, command=get_settlement_details, var1=<settlement date YYYY-MM-DD> and
 * hash = sha512(key|command|var1|salt). The response lists `Txn_details` for that day.
 *
 * LIMITATION, by design: the hash needs the merchant salt, a secret. Adapters never see secrets and
 * the read kit has no request-signing scheme, so the request cannot be expressed honestly. `first`
 * refuses with PAYU_SIGNED_REQUEST_UNSUPPORTED before any request or credential lookup. The parser
 * is complete, so recorded responses and exported files read through the same path and recipe.
 */
export const PAYU_ORIGINS = Object.freeze({ production: 'https://info.payu.in', test: 'https://test.payu.in' });
export const PAYU_VERSION = 'postservice-form2-adapter-1';
export type PayuSettlementConfig = { environment: 'production' | 'test'; settlementDate: string };

const fail = 'PAYU_RESPONSE_INVALID';

export const payuReadSpec: ApiReadSpec<PayuSettlementConfig> = Object.freeze({
  system: 'payu', operation: 'settlement-details', version: PAYU_VERSION, scopes: Object.freeze([]), auth: 'none' as const,
  origins: (config: PayuSettlementConfig) => [PAYU_ORIGINS[config.environment]],
  validate(config: PayuSettlementConfig): PayuSettlementConfig {
    const c = strictConfig(config, ['environment', 'settlementDate'], 'PAYU_CONFIG_INVALID');
    check(c.environment === 'production' || c.environment === 'test', 'PAYU_CONFIG_INVALID', 'Choose the PayU production or test environment.');
    check(validDate(c.settlementDate), 'PAYU_CONFIG_INVALID', 'Choose the settlement date to read.');
    return { environment: c.environment, settlementDate: c.settlementDate };
  },
  first(): ReadRequest {
    throw new ChausarError('PAYU_SIGNED_REQUEST_UNSUPPORTED', 'PayU needs every request signed with the merchant salt, which this version cannot do safely. Import the settlement report file instead.');
  },
  parse(body: string): ParsedPage {
    const root = plain(exactJson(body, fail), fail);
    // status 1 with Txn_details; status 0 means no settlement on that date.
    if (root.status === '0') { check(root.Txn_details === undefined || (Array.isArray(root.Txn_details) && root.Txn_details.length === 0), fail, 'The system returned a response in an unexpected shape.'); return { records: [], next: null, declared: null }; }
    check(root.status === '1', fail, 'The system returned a response in an unexpected shape.');
    const records = items(root.Txn_details, fail);
    for (const record of records) check(typeof record.payuid === 'string' && record.payuid.length > 0, fail, 'A settled transaction has no PayU id.');
    return { records, next: null, declared: null };
  },
});
