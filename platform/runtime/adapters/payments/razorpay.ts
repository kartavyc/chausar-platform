import { check } from '../../contracts.ts';
import type { ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { EPOCH_SECONDS, exactJson, istDay, istEndSeconds, istStartSeconds, items, pageSize, plain, queryValue, requirePeriod, strictConfig, WHOLE } from './shared.ts';

/**
 * Razorpay read specs (REST API v1, https://razorpay.com/docs/api/). Key id and key secret reach the
 * runner through the credential broker as "key_id:key_secret" and are sent as HTTP Basic; this file
 * never sees them. Amounts are integers in paise (minor units) and stay exact text.
 *
 * Collections (`entity: "collection"`) carry `count`, which is the size of this page, not a total.
 * Lists therefore declare nothing; the settlement read declares the settlement's own amount.
 */
export const RAZORPAY_ORIGIN = 'https://api.razorpay.com';
export const RAZORPAY_VERSION = 'v1-adapter-1';
/** Razorpay API keys carry no per-resource scopes; OAuth partners ask for read_only. */
export const RAZORPAY_SCOPES = Object.freeze(['read_only']);
export const RAZORPAY_NOTICES = Object.freeze([
  'An order or payment paid status can persist after refunds; captured payments are not net revenue.',
  'Settlement, refund and net-sales meanings are separate observations. Review them before reporting revenue.',
]);

export type RazorpayListConfig = { pageSize?: number };
export type RazorpaySettlementReconConfig = { settlementId: string; pageSize?: number };

const SETTLEMENT_ID = /^setl_[A-Za-z0-9]{8,32}$/;
const fail = 'RAZORPAY_RESPONSE_INVALID';

function collection(body: string, entity: string | null): Record<string, unknown>[] {
  const root = plain(exactJson(body, fail), fail);
  check(root.entity === 'collection', fail, 'The system returned a response in an unexpected shape.');
  const list = items(root.items, fail);
  check(root.count === undefined || root.count === String(list.length), fail, 'The system returned a page whose count does not match its items.');
  if (entity) for (const item of list) check(item.entity === entity, fail, 'The system returned a record of another kind.');
  return list;
}
function withSkip(request: ReadRequest, skip: number): ReadRequest {
  const url = new URL(request.url); url.searchParams.set('skip', String(skip));
  return { method: 'GET', url: url.href };
}
function nextSkip(request: ReadRequest, received: number, size: number): ReadRequest | null {
  if (received < size) return null;
  const skip = Number(queryValue(request.url, 'skip') ?? '0');
  check(Number.isSafeInteger(skip) && skip >= 0, fail, 'The read lost its page position.');
  return withSkip(request, skip + size);
}

function listSpec(operation: 'payments' | 'settlements', entity: string, max: number): ApiReadSpec<RazorpayListConfig> {
  return Object.freeze({
    system: 'razorpay', operation, version: RAZORPAY_VERSION, scopes: RAZORPAY_SCOPES, auth: 'basic' as const,
    origins: () => [RAZORPAY_ORIGIN],
    validate(config: RazorpayListConfig): RazorpayListConfig {
      const c = strictConfig(config, ['pageSize'], 'RAZORPAY_CONFIG_INVALID');
      return { pageSize: pageSize(c.pageSize, max, 1, max, 'RAZORPAY_CONFIG_INVALID') };
    },
    first(config: RazorpayListConfig, period: { from: string; to: string } | null): ReadRequest {
      const p = requirePeriod(period);
      return { method: 'GET', url: `${RAZORPAY_ORIGIN}/v1/${operation}?from=${istStartSeconds(p.from)}&to=${istEndSeconds(p.to)}&count=${config.pageSize}&skip=0` };
    },
    parse(body: string, _response: unknown, config: RazorpayListConfig, request: ReadRequest): ParsedPage {
      const records = collection(body, entity);
      return { records, next: nextSkip(request, records.length, config.pageSize!), declared: null };
    },
  });
}
/** GET /v1/payments?from=&to=&count=&skip= (count at most 100). No declared total. */
export const razorpayPaymentsReadSpec: ApiReadSpec<RazorpayListConfig> = listSpec('payments', 'payment', 100);
/** GET /v1/settlements?from=&to=&count=&skip= (count at most 100). No declared total. */
export const razorpaySettlementsReadSpec: ApiReadSpec<RazorpayListConfig> = listSpec('settlements', 'settlement', 100);

/**
 * One settlement against its own reconciliation items. The first page is the settlement itself
 * (GET /v1/settlements/{id}); it is emitted as a record with `entity: "settlement"`, which the recipe
 * excludes, and its `amount` becomes the declared total. Then GET /v1/settlements/recon/combined for
 * the settlement's own IST day, paged by skip, keeping only items whose settlement_id is this one.
 * Credit minus debit over those items must equal the settlement amount.
 */
export const razorpaySettlementReconReadSpec: ApiReadSpec<RazorpaySettlementReconConfig> = Object.freeze({
  system: 'razorpay', operation: 'settlement-recon', version: RAZORPAY_VERSION, scopes: RAZORPAY_SCOPES, auth: 'basic' as const,
  origins: () => [RAZORPAY_ORIGIN],
  validate(config: RazorpaySettlementReconConfig): RazorpaySettlementReconConfig {
    const c = strictConfig(config, ['settlementId', 'pageSize'], 'RAZORPAY_CONFIG_INVALID');
    check(typeof c.settlementId === 'string' && SETTLEMENT_ID.test(c.settlementId), 'RAZORPAY_SETTLEMENT_ID_INVALID', 'Enter a Razorpay settlement id that starts with setl_.');
    return { settlementId: c.settlementId, pageSize: pageSize(c.pageSize, 1000, 1, 1000, 'RAZORPAY_CONFIG_INVALID') };
  },
  first(config: RazorpaySettlementReconConfig): ReadRequest {
    return { method: 'GET', url: `${RAZORPAY_ORIGIN}/v1/settlements/${config.settlementId}` };
  },
  parse(body: string, _response: unknown, config: RazorpaySettlementReconConfig, request: ReadRequest): ParsedPage {
    const path = new URL(request.url).pathname;
    if (path === `/v1/settlements/${config.settlementId}`) {
      const settlement = plain(exactJson(body, fail), fail);
      check(settlement.entity === 'settlement' && settlement.id === config.settlementId, 'RAZORPAY_SETTLEMENT_MISMATCH', 'The system returned a different settlement than the one asked for.');
      check(settlement.status === 'processed', 'RAZORPAY_SETTLEMENT_NOT_PROCESSED', 'This settlement is not processed yet. Read it after it settles.');
      check(typeof settlement.amount === 'string' && WHOLE.test(settlement.amount), fail, 'The settlement amount is not a whole number of paise.');
      check(typeof settlement.created_at === 'string' && EPOCH_SECONDS.test(settlement.created_at), fail, 'The settlement has no usable date.');
      const day = istDay(settlement.created_at);
      return {
        records: [settlement],
        next: { method: 'GET', url: `${RAZORPAY_ORIGIN}/v1/settlements/recon/combined?year=${day.year}&month=${day.month}&day=${day.day}&count=${config.pageSize}&skip=0` },
        declared: { rowCount: null, amount: settlement.amount, amountUnit: 'minor', reference: 'razorpay-settlement-amount' },
      };
    }
    check(path === '/v1/settlements/recon/combined', fail, 'The read reached an unexpected page.');
    const raw = collection(body, null);
    const records = raw.filter(item => item.settlement_id === config.settlementId);
    return { records, next: nextSkip(request, raw.length, config.pageSize!), declared: null };
  },
});

export const razorpayReadSpecs = Object.freeze({
  payments: razorpayPaymentsReadSpec, settlements: razorpaySettlementsReadSpec, 'settlement-recon': razorpaySettlementReconReadSpec,
});
