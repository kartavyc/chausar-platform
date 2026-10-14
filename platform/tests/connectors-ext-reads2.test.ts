import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { recordedHttp, runApiRead, type ApiReadResult, type ApiReadSpec, type CredentialRequest } from '../runtime/adapters/read-kit.ts';
import type { BoundedHttp, HttpRequest } from '../runtime/connectors.ts';
import { CASHFREE_API_VERSION, cashfreeReadSpec, payuReadSpec, PAYU_PAGE_SIZE, type CashfreeSettlementsConfig, type PayuSettlementConfig } from '../runtime/adapters/payments/index.ts';
import { zohoBooksInvoiceDetailUrl, zohoBooksInvoicesNetSpec, zohoBooksInvoicesUrl, zohoBooksNetRequests } from '../runtime/adapters/accounting/books-api.ts';
import { recipeInput } from '../runtime/adapters/google/index.ts';
import { runRegistered } from '../runtime/connectors-ext/recipes/index.ts';
import { readsFor } from '../runtime/connectors-ext/reads.ts';

const fx = (group: string, name: string) => readFileSync(new URL(`../../fixtures/connectors/${group}/${name}`, import.meta.url), 'utf8');
const SEPT = { from: '2026-09-01', to: '2026-09-30' };
const refused = (expected: string) => (error: any) => { assert.equal(error?.code, expected); assert.doesNotMatch(error.message, /\d{3,}|Synth|SECRET/); return true; };
function broker(token: string) {
  const asked: CredentialRequest[] = [];
  return { asked, credentials: async (request: CredentialRequest) => { asked.push(structuredClone(request)); return token; } };
}
/** Requests sharing one URL are routed by a marker in the body. */
function byBody(routes: [string, { status?: number; body: string }][], calls: HttpRequest[]): BoundedHttp {
  return async request => {
    calls.push(structuredClone(request));
    const hit = routes.find(([marker]) => (request.body ?? '').includes(marker));
    return hit ? { status: hit[1].status ?? 200, body: hit[1].body, url: request.url, headers: { 'content-type': 'application/json' } } : { status: 404, body: '{}', url: request.url };
  };
}
const logIsClean = (result: ApiReadResult) => {
  for (const entry of result.requestLog) { assert.deepEqual(Object.keys(entry).sort(), ['bytes', 'origin', 'path', 'status']); assert.doesNotMatch(entry.path, /[?#]/); }
};

// ---------------------------------------------------------------- Cashfree: header-key sign-in
const CF_ID = 'CF1234SynthClientId', CF_SECRET = 'cfsk_ma_test_SECRETSynthValue0001';
const CF_CURSOR = 'c3ludGhldGljLWN1cnNvci0y';
const cashfreeHttp = (calls: HttpRequest[], page2 = fx('cashfree', 'settlements-page-2.json')) => byBody([
  ['"cursor":null', { body: fx('cashfree', 'settlements-page-1.json') }], [`"cursor":"${CF_CURSOR}"`, { body: page2 }],
], calls);
const cfRead = (http: BoundedHttp, token = `${CF_ID}:${CF_SECRET}`, spec: ApiReadSpec<CashfreeSettlementsConfig> = cashfreeReadSpec) => {
  const b = broker(token);
  return { b, run: runApiRead(spec, { config: { environment: 'production', pageSize: 2 }, sourceId: 'cf-1', period: SEPT, credentials: b.credentials, http }) };
};

test('cashfree: key headers set by the runner only, cursor pages, exact settled total', async () => {
  const calls: HttpRequest[] = [], { b, run } = cfRead(cashfreeHttp(calls));
  const result = await run;
  assert.equal(result.records.length, 3); assert.equal(result.pages, 2); assert.equal(result.requests, 2);
  assert.deepEqual(b.asked.map(a => [a.system, a.origin, a.scheme]), [['cashfree', 'https://api.cashfree.com', 'header-keys']]);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.cashfree.com/pg/settlements'); assert.equal(call.method, 'POST');
    assert.equal(call.headers['x-client-id'], CF_ID); assert.equal(call.headers['x-client-secret'], CF_SECRET);
    assert.equal(call.headers['x-api-version'], CASHFREE_API_VERSION); assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.headers.Authorization, undefined);
  }
  const bodies = calls.map(call => JSON.parse(call.body!));
  assert.deepEqual(bodies[0], { pagination: { limit: 2, cursor: null }, filters: { start_date: '2026-08-31T18:30:00Z', end_date: '2026-09-30T18:29:59Z' } });
  assert.deepEqual(bodies[1], { pagination: { limit: 2, cursor: CF_CURSOR }, filters: bodies[0].filters });
  // The adapter's own requests carry no key header; the secret is never in the result or its log.
  const config = cashfreeReadSpec.validate({ environment: 'production', pageSize: 2 });
  assert.deepEqual(Object.keys(cashfreeReadSpec.first(config, SEPT).headers ?? {}).sort(), ['Content-Type', 'x-api-version']);
  const out = JSON.stringify(result);
  assert.equal(out.includes(CF_SECRET), false); assert.equal(out.includes(CF_ID), false); assert.equal(/x-client/i.test(out), false);
  logIsClean(result); assert.deepEqual(result.requestLog.map(e => e.path), ['/pg/settlements', '/pg/settlements']);
  const imported = runRegistered('cashfree.settlements', recipeInput(result), { reportTotals: { rowCount: 3, total: '2343409' } });
  assert.equal(imported.status, 'accepted', JSON.stringify(imported.refusal ?? imported.abstention));
  assert.equal(imported.observed.total, '2343409');
  assert.deepEqual(imported.records.map(r => [r.date, (r.measure as any).amountMinor]), [['2026-09-02', '1464600'], ['2026-09-03', '781169'], ['2026-09-04', '97640']]);
  assert.equal(runRegistered('cashfree.settlements', recipeInput(result), { reportTotals: { rowCount: 3, total: '2343400' } }).refusal?.code, 'SOURCE_TOTAL_MISMATCH');
});

test('cashfree: a failed settlement is excluded; an adapter cannot set a key header; bad credentials and 401 are refused', async () => {
  const calls: HttpRequest[] = [];
  const failed = await cfRead(cashfreeHttp(calls, fx('cashfree', 'settlements-page-2.json').replace('"SUCCESS"', '"FAILED"'))).run;
  const out = runRegistered('cashfree.settlements', recipeInput(failed), { reportTotals: { rowCount: 2, total: '2245769' } });
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal ?? out.abstention)); assert.equal(out.excludedRows, 1);
  // An adapter that tries to send the key header itself is refused before any request.
  const sneaky: ApiReadSpec<CashfreeSettlementsConfig> = { ...cashfreeReadSpec, first: (config, period) => ({ ...cashfreeReadSpec.first(config, period), headers: { 'x-client-secret': 'guess' } }) };
  const none: HttpRequest[] = [];
  await assert.rejects(cfRead(cashfreeHttp(none), undefined, sneaky).run, refused('ADAPTER_HEADER_REFUSED')); assert.equal(none.length, 0);
  await assert.rejects(cfRead(cashfreeHttp([]), 'no-colon-here').run, refused('CREDENTIAL_REQUIRED'));
  await assert.rejects(cfRead(byBody([['"cursor":null', { status: 401, body: '{"message":"authentication Failed"}' }]], [])).run, refused('SOURCE_SIGN_IN_EXPIRED'));
  await assert.rejects(cfRead(cashfreeHttp([], '{"cursor":null,"data":[{"settlement_id":"x"}]}')).run, refused('CASHFREE_RESPONSE_INVALID'));
});

// ---------------------------------------------------------------- PayU: runner-signed form
const PAYU_KEY = 'SynthKey01', PAYU_SALT = 'SynthSaltValueSECRET0001';
const PAYU_URL = 'https://info.payu.in/merchant/postservice.php?form=2';
const PAYU_CONFIG: PayuSettlementConfig = { environment: 'production', settlementDate: '2026-09-04' };
const payuRead = (http: BoundedHttp, spec: ApiReadSpec<PayuSettlementConfig> = payuReadSpec, token = `${PAYU_KEY}:${PAYU_SALT}`) => {
  const b = broker(token);
  return { b, run: runApiRead(spec, { config: PAYU_CONFIG, sourceId: 'payu-1', credentials: b.credentials, http }) };
};
const expectedHash = (key: string, command: string, var1: string, salt: string) => createHash('sha512').update([key, command, var1, salt].join('|')).digest('hex');

test('payu: the transport receives sha512(key|command|var1|salt); the salt appears nowhere else', async () => {
  const calls: HttpRequest[] = [], { b, run } = payuRead(recordedHttp({ [`POST ${PAYU_URL}`]: { body: fx('payu', 'settlement-details.json') } }, calls));
  const result = await run;
  assert.equal(result.records.length, 3); assert.equal(calls.length, 1);
  assert.deepEqual(b.asked.map(a => [a.system, a.origin, a.scheme]), [['payu', 'https://info.payu.in', 'payu-hash']]);
  const call = calls[0], form = new URLSearchParams(call.body);
  assert.equal(call.method, 'POST'); assert.equal(call.url, PAYU_URL);
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded'); assert.equal(call.headers.Authorization, undefined);
  assert.equal(form.get('key'), PAYU_KEY); assert.equal(form.get('command'), 'get_settlement_details'); assert.equal(form.get('var1'), '2026-09-04');
  assert.equal(form.get('var2'), '1'); assert.equal(form.get('var3'), String(PAYU_PAGE_SIZE));
  assert.equal(form.get('hash'), expectedHash(PAYU_KEY, 'get_settlement_details', '2026-09-04', PAYU_SALT));
  assert.equal(call.body!.includes(PAYU_SALT), false);
  // The adapter's own form has no key or hash; the result and log carry neither the salt nor the hash.
  const own = new URLSearchParams(payuReadSpec.first(payuReadSpec.validate(PAYU_CONFIG), null).body);
  assert.equal(own.has('key') || own.has('hash'), false);
  const out = JSON.stringify(result);
  assert.equal(out.includes(PAYU_SALT), false); assert.equal(out.includes(form.get('hash')!), false); assert.equal(out.includes(PAYU_KEY), false);
  logIsClean(result); assert.deepEqual(result.requestLog.map(e => e.path), ['/merchant/postservice.php']);
  const imported = runRegistered('payu.settlement-details', recipeInput(result), { reportTotals: { rowCount: 3, total: '137000' } });
  assert.equal(imported.status, 'accepted', JSON.stringify(imported.refusal ?? imported.abstention));
  assert.deepEqual(imported.records.map(r => [r.kind, (r.measure as any).amountMinor]), [['payment', '98000'], ['payment', '49000'], ['refund', '-10000']]);
});

test('payu: a full page asks for the next page; an adapter cannot supply the key; a bad salt is refused', async () => {
  const one = JSON.parse(fx('payu', 'settlement-details.json')).Txn_details[0];
  const full = { status: 1, msg: 'ok', Txn_details: Array.from({ length: PAYU_PAGE_SIZE }, (_, i) => ({ ...one, payuid: String(41000000000 + i) })) };
  const calls: HttpRequest[] = [];
  const result = await payuRead(byBody([['var2=1&', { body: JSON.stringify(full) }], ['var2=2&', { body: '{"status":0,"msg":"No settlement data"}' }]], calls)).run;
  assert.equal(result.records.length, PAYU_PAGE_SIZE); assert.equal(result.requests, 2);
  const hashes = calls.map(call => new URLSearchParams(call.body).get('hash'));
  assert.equal(hashes[0], expectedHash(PAYU_KEY, 'get_settlement_details', '2026-09-04', PAYU_SALT)); assert.equal(hashes[1], hashes[0]);
  const imported = runRegistered('payu.settlement-details', recipeInput(result), { reportTotals: { rowCount: PAYU_PAGE_SIZE, total: '49000000' } });
  assert.equal(imported.status, 'accepted', JSON.stringify(imported.refusal ?? imported.abstention));
  const none: HttpRequest[] = [];
  const sneaky: ApiReadSpec<PayuSettlementConfig> = { ...payuReadSpec, first: config => ({ ...payuReadSpec.first(config, null), body: `key=${PAYU_KEY}&command=get_settlement_details&var1=2026-09-04` }) };
  await assert.rejects(payuRead(recordedHttp({}, none), sneaky).run, refused('ADAPTER_INVALID')); assert.equal(none.length, 0);
  await assert.rejects(payuRead(recordedHttp({}, none), payuReadSpec, `${PAYU_KEY}:bad salt!`).run, refused('CREDENTIAL_REQUIRED')); assert.equal(none.length, 0);
  await assert.rejects(payuRead(recordedHttp({ [`POST ${PAYU_URL}`]: { body: '{"status":"1","Txn_details":[{"txnid":"x"}]}' } })).run, refused('PAYU_RESPONSE_INVALID'));
});

// ---------------------------------------------------------------- Zoho Books: net amounts from invoice detail
const ZB = { dataCenter: 'in' as const, organizationId: '60012345678' };
const april = { from: '2026-04-01', to: '2026-04-30' };
const ZB_TOKEN = '1000.SECRETzohoAccessToken';
const IDS = ['9800000000001', '9800000000002', '9800000000003', '9800000000004'];
function zohoRoutes(edit: Partial<Record<string, string>> = {}): Record<string, { status?: number; body: string }> {
  const routes: Record<string, { status?: number; body: string }> = {
    [`GET ${zohoBooksInvoicesUrl(ZB, 1, april)}`]: { body: edit.page1 ?? fx('zoho-books', 'invoices-page1.json') },
    [`GET ${zohoBooksInvoicesUrl(ZB, 2, april)}`]: { body: edit.page2 ?? fx('zoho-books', 'invoices-page2.json') },
  };
  for (const id of IDS) routes[`GET ${zohoBooksInvoiceDetailUrl(ZB, id)}`] = { body: edit[id] ?? fx('zoho-books', `invoice-${id}.json`) };
  return routes;
}
const zohoRead = (routes: Record<string, { status?: number; body: string }>, calls: HttpRequest[] = [], limits?: { maxRequests: number }) =>
  runApiRead(zohoBooksInvoicesNetSpec, { config: ZB, sourceId: 'zb-1', period: april, credentials: async () => ZB_TOKEN, http: recordedHttp(routes, calls), ...(limits ? { limits } : {}) });

test('Zoho Books net: list pages queue one detail per invoice; sub_total is the net amount; exact totals', async () => {
  const calls: HttpRequest[] = [];
  const result = await zohoRead(zohoRoutes(), calls);
  assert.deepEqual(calls.map(call => call.url), [zohoBooksInvoicesUrl(ZB, 1, april), zohoBooksInvoiceDetailUrl(ZB, IDS[0]), zohoBooksInvoiceDetailUrl(ZB, IDS[1]),
    zohoBooksInvoicesUrl(ZB, 2, april), zohoBooksInvoiceDetailUrl(ZB, IDS[2]), zohoBooksInvoiceDetailUrl(ZB, IDS[3])]);
  assert.ok(calls.every(call => call.headers.Authorization === `Zoho-oauthtoken ${ZB_TOKEN}`));
  assert.equal(result.records.length, 4); assert.equal(result.requests, 6); assert.equal(result.declared?.rowCount, 4);
  assert.deepEqual(result.records.map(r => [r.id, r.netAmount, r.grossAmount, r.taxAmount]), [
    [IDS[0], '1000.00', '1180.00', '180.00'], [IDS[1], '2000.50', '2360.50', '360.00'], [IDS[2], '423.73', '500.00', '76.27'], [IDS[3], '500.00', '590.00', '90.00']]);
  assert.equal(result.records[1].number, 'INV-002'); assert.equal(result.records[1].customerName, 'Ravi & Co');
  assert.equal(JSON.stringify(result).includes(ZB_TOKEN), false); logIsClean(result);
  const net = runRegistered('zoho-books.invoices.net', recipeInput(result), { reportTotals: { rowCount: 3, total: '350050' } });
  assert.equal(net.status, 'accepted', JSON.stringify(net.refusal ?? net.abstention));
  assert.equal(net.observed.total, '350050'); assert.equal(net.excludedRows, 1);
  assert.deepEqual(net.records.map(r => [r.kind, (r.measure as any).amountMinor]), [['invoice', '100000'], ['invoice', '200050'], ['invoice', '50000']]);
  assert.equal(runRegistered('zoho-books.invoices.net', recipeInput(result), { reportTotals: { rowCount: 3, total: '413050' } }).refusal?.code, 'SOURCE_TOTAL_MISMATCH');
  // The gross recipe reads the same detail records.
  const gross = runRegistered('zoho-books.invoices.gross', recipeInput(result), { reportTotals: { rowCount: 3, total: '413050' } });
  assert.equal(gross.status, 'accepted', JSON.stringify(gross.refusal ?? gross.abstention));
});

test('Zoho Books net: bounded up front, never a partial set; a missing subtotal is refused, never zero', async () => {
  assert.equal(zohoBooksNetRequests(59), 60); assert.equal(zohoBooksNetRequests(60), 61); assert.equal(zohoBooksNetRequests(0), 1);
  // 60 declared invoices need 61 requests: refused on the first list page, before any detail.
  const calls: HttpRequest[] = [];
  await assert.rejects(zohoRead(zohoRoutes({ page1: fx('zoho-books', 'invoices-page1.json').replace('"total": 4', '"total": 60') }), calls), refused('ZOHO_DETAIL_BUDGET'));
  assert.equal(calls.length, 1);
  // More pages and no stated total cannot be bounded.
  await assert.rejects(zohoRead(zohoRoutes({ page1: fx('zoho-books', 'invoices-page1.json').replace(',\n    "total": 4', '') })), refused('ZOHO_DETAIL_BUDGET'));
  // A lower engine budget stops the whole read; nothing partial is returned.
  await assert.rejects(zohoRead(zohoRoutes(), [], { maxRequests: 4 }), refused('READ_REQUEST_LIMIT'));
  // One missing detail fails the read.
  const routes = zohoRoutes(); delete routes[`GET ${zohoBooksInvoiceDetailUrl(ZB, IDS[2])}`];
  await assert.rejects(zohoRead(routes), refused('SOURCE_NOT_FOUND'));
  // A detail for another invoice is refused.
  await assert.rejects(zohoRead(zohoRoutes({ [IDS[1]]: fx('zoho-books', `invoice-${IDS[0]}.json`) })), refused('ZOHO_DETAIL_ID_MISMATCH'));
  // A detail without sub_total leaves the net amount missing: the net recipe refuses it.
  const noSub = await zohoRead(zohoRoutes({ [IDS[0]]: fx('zoho-books', `invoice-${IDS[0]}.json`).replace('"sub_total": 1000.00,', '') }));
  assert.equal(noSub.records[0].netAmount, '');
  assert.equal(runRegistered('zoho-books.invoices.net', recipeInput(noSub), { reportTotals: { rowCount: 3, total: '350050' } }).refusal?.code, 'MISSING_AMOUNT');
  // A declared total that differs from what was read is refused.
  await assert.rejects(zohoRead(zohoRoutes({ page1: fx('zoho-books', 'invoices-page1.json').replace('"total": 4', '"total": 5'), page2: fx('zoho-books', 'invoices-page2.json').replace('"total": 4', '"total": 5') })), refused('SOURCE_ROW_MISMATCH'));
});

test('read bindings: Cashfree, PayU and Zoho Books net are live', () => {
  const [cashfree] = readsFor('cashfree'), [payu] = readsFor('payu');
  assert.equal(cashfree.live, true); assert.equal(cashfree.spec, cashfreeReadSpec);
  assert.equal(payu.live, true); assert.equal(payu.spec, payuReadSpec);
  assert.deepEqual(payu.config({ environment: 'test' }, { settlementDate: '2026-09-04' }), { environment: 'test', settlementDate: '2026-09-04' });
  const net = readsFor('zoho-books').find(read => read.id === 'invoices-net')!;
  assert.equal(net.live, true); assert.equal(net.recipe, 'zoho-books.invoices.net'); assert.equal(net.spec, zohoBooksInvoicesNetSpec);
  for (const read of [cashfree, payu, net]) assert.doesNotMatch(read.limitation, /not built|cannot be read live/);
});
