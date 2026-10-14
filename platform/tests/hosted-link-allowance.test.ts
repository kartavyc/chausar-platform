import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../hosted/shared/http.ts';
import { check } from '../../hosted/shared/errors.ts';
import { FREE_ENTITLEMENTS, type Entitlements } from '../../hosted/shared/auth.ts';
import type { Fetch, HostedDeps } from '../../hosted/shared/module.ts';
import type { Sql } from '../../hosted/db/sql.ts';
import { JobQueue } from '../../hosted/db/queue.ts';
import { authenticator } from '../../hosted/accounts/module.ts';
import { newId, opaqueToken, secretHash } from '../../hosted/shared/crypto.ts';
import {
  createAllowanceModule, allowanceConfig, allowanceProviders, parsePricing, costPaise, inputTokenBound, anthropicProvider, openaiProvider,
  type ModelProvider, type PricingTable,
} from '../../hosted/allowance/index.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();

const PRICING: PricingTable = parsePricing({
  checkedOn: '2026-10-01', source: 'Provider price pages, copied by hand', fxPaisePerUsd: '8450',
  models: [
    { route: 'anthropic', model: 'claude-test', inputUsdMicrosPerMillionTokens: '3000000', outputUsdMicrosPerMillionTokens: '15000000' },
    { route: 'openai', model: 'gpt-test', inputUsdMicrosPerMillionTokens: '2500000', outputUsdMicrosPerMillionTokens: '10000000' },
  ],
});
const CLAUDE = PRICING.models[0];
const PAID: Entitlements = { ...FREE_ENTITLEMENTS, plan: 'paid', allowance: true, allowanceMonthlyPaise: '300' };

type Recorded = { url: string; init: any };
function fakeFetch(replies: ({ status: number; body: unknown } | Error)[]): Fetch & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch = (async (url: string, init?: any) => {
    calls.push({ url, init });
    const reply = replies.shift(); if (!reply) throw new Error('unexpected call');
    if (reply instanceof Error) throw reply;
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
  }) as unknown as Fetch & { calls: Recorded[] };
  fetch.calls = calls; return fetch;
}
const ANTHROPIC_REPLY = { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'MANGO-ANSWER ' }, { type: 'text', text: 'done.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 } };
const OPENAI_REPLY = { id: 'resp_test', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'MANGO-ANSWER done.', annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };

async function setup(options: { providers?: { anthropic?: ModelProvider; openai?: ModelProvider }; pricing?: PricingTable | null; sql?: Sql } = {}) {
  const sql = options.sql ?? await freshDatabase();
  let time = new Date('2026-10-14T10:00:00Z');
  const clock = () => time;
  const plans = new Map<string, Entitlements>([['acct_a', PAID]]);
  const deps: HostedDeps = {
    sql, clock, queue: new JobQueue(sql, clock), fetch: async () => { throw new Error('no network in tests'); }, pepper: 'p'.repeat(32), linkOrigin: 'https://link.chausar.test',
    authenticate: async request => { const accountId = request.headers['x-test-account']; check(accountId, 'UNAUTHENTICATED', 'Sign in first.', 401); return { accountId, deviceId: 'dev_a', sessionId: 'ses_a' }; },
    entitlements: async accountId => plans.get(accountId) ?? FREE_ENTITLEMENTS,
  };
  const router = new Router();
  createAllowanceModule(deps, { providers: options.providers ?? {}, pricing: options.pricing === undefined ? PRICING : options.pricing }).routes(router);
  const complete = (body: Record<string, unknown>, account = 'acct_a') =>
    router.handle({ method: 'POST', url: '/v1/allowance/complete', headers: { 'x-test-account': account, 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
  const summary = async (account = 'acct_a') => (await router.handle({ method: 'GET', url: '/v1/allowance', headers: { 'x-test-account': account } })).body as any;
  return { sql, plans, complete, summary, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
const ask = (requestId: string, extra: Record<string, unknown> = {}) => ({ requestId, route: 'anthropic', model: 'claude-test', messages: [{ role: 'user', content: 'Hello' }], maxOutputTokens: 1000, ...extra });
const code = (reply: { body?: unknown }) => (reply.body as any)?.error?.code;

test('pricing is exact BigInt paise, rounded up', () => {
  assert.equal(costPaise(CLAUDE, '8450', 1_000_000, 0), 25350n, 'one million input tokens at three dollars is 253.50 rupees');
  assert.equal(costPaise(CLAUDE, '8450', 1000, 500), 89n, '88.725 paise rounds up');
  assert.equal(costPaise(CLAUDE, '8450', 1, 0), 1n, 'any use costs at least a paisa');
  assert.equal(costPaise(CLAUDE, '8450', 0, 0), 0n);
  assert.equal(costPaise(CLAUDE, '8450', 123456789, 987654321), 128314815n);
  assert.equal(costPaise(CLAUDE, '8450', 10n ** 15n, 10n ** 15n), 152100000000000n, 'no float rounding at large counts');
  assert.equal(inputTokenBound('ab', [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'नमस्ते' }]), 2 + 5 + 16 + 18 + 16 + 64, 'Devanagari counts by UTF-8 bytes');
  assert.throws(() => parsePricing({ ...PRICING, fxPaisePerUsd: '84.50' }), { code: 'PRICING_INVALID' });
  assert.throws(() => parsePricing({ ...PRICING, models: [{ ...CLAUDE, inputUsdMicrosPerMillionTokens: 3000000 }] }), { code: 'PRICING_INVALID' });
  assert.throws(() => parsePricing({ ...PRICING, models: [CLAUDE, CLAUDE] }), { code: 'PRICING_INVALID' });
  assert.throws(() => parsePricing({ ...PRICING, checkedOn: '2026-02-30' }), { code: 'PRICING_INVALID' });
  assert.throws(() => allowanceConfig({ ALLOWANCE_PRICING_JSON: '{' }), { code: 'PRICING_INVALID' });
  const config = allowanceConfig({ ANTHROPIC_API_KEY: 'sk-ant', ALLOWANCE_PRICING_JSON: JSON.stringify(PRICING) });
  assert.deepEqual(config, { anthropicApiKey: 'sk-ant', openaiApiKey: null, pricing: PRICING, apiOrigin: null });
  assert.deepEqual(Object.keys(allowanceProviders(config, fakeFetch([]))), ['anthropic']);
  assert.deepEqual(allowanceConfig({}), { anthropicApiKey: null, openaiApiKey: null, pricing: null, apiOrigin: null });
  assert.equal(allowanceConfig({ HOSTED_API_ORIGIN: 'https://api.chausar.test/' }).apiOrigin, 'https://api.chausar.test');
  for (const bad of ['http://api.chausar.test', 'https://api.chausar.test/v1', 'https://user@api.chausar.test', 'https://api.chausar.test?x=1', 'not a url'])
    assert.throws(() => allowanceConfig({ HOSTED_API_ORIGIN: bad }), { code: 'SERVER_MISCONFIGURED' }, bad);
});

test('the Anthropic and OpenAI clients send the documented request shapes', async () => {
  const a = fakeFetch([{ status: 200, body: ANTHROPIC_REPLY }]);
  const messages = [{ role: 'user' as const, content: 'Q' }, { role: 'assistant' as const, content: 'A' }, { role: 'user' as const, content: 'Q2' }];
  assert.deepEqual(await anthropicProvider('sk-ant-key', a).complete({ model: 'claude-test', system: 'Be brief.', messages, maxOutputTokens: 300 }),
    { text: 'MANGO-ANSWER done.', inputTokens: 10, outputTokens: 20 });
  assert.equal(a.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(a.calls[0].init.method, 'POST');
  assert.deepEqual(a.calls[0].init.headers, { 'content-type': 'application/json', 'x-api-key': 'sk-ant-key', 'anthropic-version': '2023-06-01' });
  assert.equal(a.calls[0].init.body, JSON.stringify({ model: 'claude-test', max_tokens: 300, system: 'Be brief.', messages: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'Q2' }] }));
  const noSystem = fakeFetch([{ status: 200, body: ANTHROPIC_REPLY }]);
  await anthropicProvider('k', noSystem).complete({ model: 'claude-test', messages: [messages[0]], maxOutputTokens: 5 });
  assert.equal(Object.hasOwn(JSON.parse(noSystem.calls[0].init.body), 'system'), false);

  const o = fakeFetch([{ status: 200, body: OPENAI_REPLY }, { status: 200, body: { output_text: 'Short.', output: [], usage: { input_tokens: 3, output_tokens: 1 } } }]);
  assert.deepEqual(await openaiProvider('sk-oa-key', o).complete({ model: 'gpt-test', system: 'Be brief.', messages, maxOutputTokens: 300 }),
    { text: 'MANGO-ANSWER done.', inputTokens: 10, outputTokens: 20 });
  assert.equal(o.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(o.calls[0].init.headers, { 'content-type': 'application/json', authorization: 'Bearer sk-oa-key' });
  assert.equal(o.calls[0].init.body, JSON.stringify({ model: 'gpt-test', input: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'Q2' }], instructions: 'Be brief.', max_output_tokens: 300, store: false }));
  assert.deepEqual(await openaiProvider('k', o).complete({ model: 'gpt-test', messages: [messages[0]], maxOutputTokens: 5 }), { text: 'Short.', inputTokens: 3, outputTokens: 1 });
  assert.equal(Object.hasOwn(JSON.parse(o.calls[1].init.body), 'instructions'), false);

  await assert.rejects(anthropicProvider('k', fakeFetch([{ status: 429, body: { error: { message: 'secret detail' } } }])).complete({ model: 'm', messages: [messages[0]], maxOutputTokens: 1 }), { code: 'PROVIDER_FAILED', status: 429 });
  await assert.rejects(openaiProvider('k', fakeFetch([{ status: 200, body: { usage: {} } }])).complete({ model: 'm', messages: [messages[0]], maxOutputTokens: 1 }), { code: 'PROVIDER_REPLY_INVALID' });
});

test('a grant that is not set, or not in the plan, is said in words and never shown as zero', { skip: pgSkip }, async () => {
  const { plans, summary, complete } = await setup();
  plans.set('acct_unset', { ...FREE_ENTITLEMENTS, plan: 'paid', relay: true, backup: true, worker: true });
  const unset = await summary('acct_unset');
  assert.deepEqual([unset.grantPaise, unset.grantState, unset.balancePaise, unset.spentPaise], [null, 'not-set', null, '0']);
  const free = await summary('acct_free');
  assert.deepEqual([free.grantPaise, free.grantState, free.balancePaise], [null, 'not-included', null]);
  assert.equal(code(await complete(ask('req_unset_01'), 'acct_unset')), 'PLAN_REQUIRED');
});

test('a request reserves, settles the measured cost and releases the rest; one attempt per request id', { skip: pgSkip }, async () => {
  const fetch = fakeFetch([{ status: 200, body: ANTHROPIC_REPLY }, { status: 200, body: OPENAI_REPLY }]);
  const { complete, summary } = await setup({ providers: { anthropic: anthropicProvider('sk-ant', fetch), openai: openaiProvider('sk-oa', fetch) } });
  assert.deepEqual(await summary(), {
    month: '2026-10', grantPaise: '300', grantState: 'set', spentPaise: '0', reservedPaise: '0', balancePaise: '300',
    pricing: { checkedOn: '2026-10-01', fxPaisePerUsd: '8450', source: 'Provider price pages, copied by hand' },
    models: [{ route: 'anthropic', model: 'claude-test' }, { route: 'openai', model: 'gpt-test' }],
  });
  const first = await complete(ask('req_00000001'));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { requestId: 'req_00000001', text: 'MANGO-ANSWER done.', usage: { inputTokens: 10, outputTokens: 20 }, costPaise: '3', balancePaise: '297', route: 'anthropic', model: 'claude-test', pricingCheckedOn: '2026-10-01' });
  const second = await complete(ask('req_00000002', { route: 'openai', model: 'gpt-test' }));
  assert.equal((second.body as any).costPaise, '2', 'ceil((10 * 2.5 + 20 * 10) * 8450 / 10^6) = ceil(1.90125)');
  const again = await complete(ask('req_00000001'));
  assert.equal(again.status, 409); assert.equal(code(again), 'REQUEST_EXISTS');
  assert.equal(fetch.calls.length, 2, 'a repeated request id never reaches the provider');
  const now = await summary();
  assert.deepEqual([now.spentPaise, now.reservedPaise, now.balancePaise], ['5', '0', '295']);
});

test('concurrent requests can never reserve more than the grant', { skip: pgSkip }, async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow: ModelProvider = { async complete() { calls++; await gate; return { text: 'ok', inputTokens: 10, outputTokens: 20 }; } };
  const { complete, summary } = await setup({ providers: { anthropic: slow } });
  assert.equal(costPaise(CLAUDE, '8450', inputTokenBound(undefined, [{ role: 'user', content: 'Hello' }]), 1000), 129n, 'each worst case is 129 paise; two fit in 300');
  let answered = 0;
  const replies = [1, 2, 3, 4, 5].map(n => complete(ask(`req_concurrent_${n}`)).then(reply => { answered++; return reply; }));
  while (!(calls === 2 && answered === 3)) await new Promise(resolve => setTimeout(resolve, 5));
  const held = await summary();
  assert.deepEqual([held.reservedPaise, held.balancePaise], ['258', '42'], 'both worst cases are held while the provider works');
  release();
  const done = await Promise.all(replies);
  assert.deepEqual(done.map(r => r.status).sort(), [200, 200, 402, 402, 402]);
  assert.deepEqual(done.filter(r => r.status === 402).map(code), ['ALLOWANCE_EXHAUSTED', 'ALLOWANCE_EXHAUSTED', 'ALLOWANCE_EXHAUSTED']);
  const settled = await summary();
  assert.deepEqual([settled.spentPaise, settled.reservedPaise, settled.balancePaise], ['6', '0', '294'], 'settling released the rest of each reservation');
  const refused = done.findIndex(r => r.status === 402) + 1, won = done.findIndex(r => r.status === 200) + 1;
  assert.equal((await complete(ask(`req_concurrent_${refused}`))).status, 200, 'a refused request id may be tried again once there is room');
  assert.equal(code(await complete(ask(`req_concurrent_${won}`))), 'REQUEST_EXISTS');
});

test('an unclear provider outcome keeps the reservation; a clear refusal releases it', { skip: pgSkip }, async () => {
  const fetch = fakeFetch([new TypeError('fetch failed'), { status: 500, body: { error: 'overloaded' } }, { status: 200, body: '{"content": [' }]);
  const { complete, summary, sql } = await setup({ providers: { anthropic: anthropicProvider('sk-ant', fetch) } });
  const lost = await complete(ask('req_unknown_1'));
  assert.equal(lost.status, 504); assert.equal(code(lost), 'PROVIDER_OUTCOME_UNKNOWN');
  assert.deepEqual([(await summary()).reservedPaise, (await summary()).balancePaise], ['129', '171'], 'the unknown outcome stays counted');
  const refused = await complete(ask('req_failed_1'));
  assert.equal(refused.status, 502); assert.equal(code(refused), 'PROVIDER_FAILED');
  assert.equal((await summary()).reservedPaise, '129', 'a refusal holds nothing');
  assert.equal(code(await complete(ask('req_garbled1'))), 'PROVIDER_OUTCOME_UNKNOWN', 'an unreadable success may have been billed');
  assert.equal(code(await complete(ask('req_unknown_1'))), 'REQUEST_EXISTS');
  const { rows } = await sql.query('SELECT request_id, state, reserved_paise, cost_paise FROM allowance_requests ORDER BY request_id');
  assert.deepEqual(rows, [
    { request_id: 'req_failed_1', state: 'failed', reserved_paise: '129', cost_paise: null },
    { request_id: 'req_garbled1', state: 'unknown', reserved_paise: '129', cost_paise: null },
    { request_id: 'req_unknown_1', state: 'unknown', reserved_paise: '129', cost_paise: null },
  ]);
  assert.equal(code(await complete(ask('req_after_01'))), 'ALLOWANCE_EXHAUSTED', '300 - 2 x 129 leaves 42');
});

test('refusals: no pricing, unpriced model, missing provider, free plan, bad input', { skip: pgSkip }, async () => {
  const sql = await freshDatabase();
  const unpriced = await setup({ sql, pricing: null, providers: { anthropic: { complete: async () => assert.fail('never called') } } });
  const noPrice = await unpriced.complete(ask('req_np_0001'));
  assert.equal(noPrice.status, 503); assert.equal(code(noPrice), 'PRICING_NOT_SET');
  const view = await unpriced.summary();
  assert.equal(view.pricing, null); assert.deepEqual(view.models, []);
  const { complete, plans } = await setup({ sql, providers: { anthropic: { complete: async () => ({ text: 'x', inputTokens: 1, outputTokens: 1 }) } } });
  const model = await complete(ask('req_mn_0001', { model: 'claude-other' }));
  assert.equal(model.status, 400); assert.equal(code(model), 'MODEL_NOT_PRICED');
  const route = await complete(ask('req_pc_0001', { route: 'openai', model: 'gpt-test' }));
  assert.equal(route.status, 503); assert.equal(code(route), 'PROVIDER_NOT_CONFIGURED');
  plans.set('acct_free', FREE_ENTITLEMENTS);
  assert.equal((await complete(ask('req_fr_0001'), 'acct_free')).status, 402);
  const bad = [
    { messages: [] }, { messages: Array.from({ length: 51 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })) },
    { messages: [{ role: 'assistant', content: 'x' }] }, { messages: [{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }] },
    { messages: [{ role: 'system', content: 'x' }] }, { messages: [{ role: 'user', content: 'x', name: 'n' }] }, { messages: [{ role: 'user', content: '' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(100_001) }] }, { system: 'x'.repeat(99_999), messages: [{ role: 'user', content: 'xx' }] },
    { maxOutputTokens: 0 }, { maxOutputTokens: 8193 }, { maxOutputTokens: 1.5 }, { requestId: 'short' }, { route: 'gemini' }, { system: 7 }, { temperature: 1 },
  ];
  for (const extra of bad) assert.equal(code(await complete(ask('req_bad_0001', extra))), 'INVALID_REQUEST', JSON.stringify(extra).slice(0, 80));
  assert.equal((await complete(ask('req_ok_00001', { maxOutputTokens: 8192, system: 'x'.repeat(99_000) }))).status, 402, 'valid but larger than the grant');
});

test('the proxy stores no prompt and no answer anywhere in the database', { skip: pgSkip }, async () => {
  const fetch = fakeFetch([{ status: 200, body: ANTHROPIC_REPLY }, new TypeError('fetch failed')]);
  const { complete, sql } = await setup({ providers: { anthropic: anthropicProvider('sk-ant-SECRETKEY', fetch) } });
  const prompt = { system: 'ZEBRA-SYSTEM-TEXT', messages: [{ role: 'user', content: 'ZEBRA-PROMPT how much did Sharma Traders owe?' }] };
  assert.equal((await complete(ask('req_scan_001', prompt))).status, 200);
  assert.equal((await complete(ask('req_scan_002', prompt))).status, 504);
  const { rows: tables } = await sql.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  assert.ok(tables.some(t => t.table_name === 'allowance_requests'));
  for (const { table_name } of tables) {
    const { rows } = await sql.query(`SELECT t::text AS row FROM "${table_name}" t`);
    for (const { row } of rows) for (const needle of ['ZEBRA', 'Sharma', 'MANGO', 'SECRETKEY']) assert.equal(row.includes(needle), false, `${table_name} holds ${needle}`);
  }
});

// Allowance credentials and the Responses endpoint, with the real session authenticator over real account rows.
const PEPPER = 'p'.repeat(32), API_ORIGIN = 'https://api.chausar.test';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['claimIds'], properties: { claimIds: { type: 'array', items: { type: 'string' } } } };
/** Exactly the body the core gateway's managed route sends (gateway.ts modelPayload). */
const gatewayBody = (model: string, extra: Record<string, unknown> = {}) => ({ model, instructions: 'Select claims. Reply in JSON.', input: '{"question":"ZEBRA-INPUT what is this business about"}',
  tools: [], tool_choice: 'none', store: false, max_output_tokens: 512, text: { format: { type: 'json_schema', name: 'business_context_selection', strict: false, schema: SCHEMA } }, ...extra });
const SELECTION = JSON.stringify({ claimIds: ['context_workspace'] });

async function credentialSetup(options: { providers?: { anthropic?: ModelProvider; openai?: ModelProvider }; apiOrigin?: string | null } = {}) {
  const sql = await freshDatabase();
  let time = new Date('2026-10-14T10:00:00Z');
  const clock = () => time;
  const plans = new Map<string, Entitlements>();
  const deps: HostedDeps = { sql, clock, queue: new JobQueue(sql, clock), fetch: async () => { throw new Error('no network in tests'); }, pepper: PEPPER, linkOrigin: 'https://link.chausar.test',
    authenticate: authenticator(sql, PEPPER, clock), entitlements: async accountId => plans.get(accountId) ?? FREE_ENTITLEMENTS };
  const router = new Router();
  createAllowanceModule(deps, { providers: options.providers ?? {}, pricing: PRICING, apiOrigin: options.apiOrigin === undefined ? API_ORIGIN : options.apiOrigin }).routes(router);
  let phone = 9876500000;
  async function account(plan: Entitlements = PAID) {
    const accountId = newId('acct'), deviceId = newId('dev'), session = opaqueToken(), at = time.toISOString();
    await sql.query('INSERT INTO accounts (id, phone, created_at) VALUES ($1, $2, $3)', [accountId, `+91${phone++}`, at]);
    await sql.query('INSERT INTO devices (id, account_id, device_name, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)', [deviceId, accountId, 'Shop computer', at]);
    await sql.query('INSERT INTO sessions (id, token_hash, account_id, device_id, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $5, $6)',
      [newId('sess'), secretHash(PEPPER, 'session', session), accountId, deviceId, at, new Date(time.getTime() + 86400000).toISOString()]);
    plans.set(accountId, plan);
    return { accountId, deviceId, session };
  }
  const call = (method: string, url: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) => router.handle({ method, url,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
  const issue = (session: string) => call('POST', '/v1/allowance/credentials', session, {});
  const respond = (credential: string, body: unknown = gatewayBody('gpt-test'), headers: Record<string, string> = {}) => call('POST', '/v1/allowance/responses', credential, body, headers);
  return { sql, plans, router, account, call, issue, respond, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

test('an allowance credential is issued once, bound to its device, revocable, and opens only the Responses endpoint', { skip: pgSkip }, async () => {
  const fetch = fakeFetch(Array.from({ length: 8 }, () => ({ status: 200, body: { ...OPENAI_REPLY, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SELECTION }] }] } })));
  const f = await credentialSetup({ providers: { openai: openaiProvider('sk-oa', fetch) } });
  const free = await f.account(FREE_ENTITLEMENTS);
  const refused = await f.issue(free.session);
  assert.equal(refused.status, 402); assert.equal(code(refused), 'PLAN_REQUIRED');
  assert.equal(code(await f.call('POST', '/v1/allowance/credentials', null, {})), 'UNAUTHENTICATED');

  const a = await f.account();
  const issued = await f.issue(a.session);
  assert.equal(issued.status, 201);
  const grant = issued.body as any;
  assert.deepEqual(Object.keys(grant).sort(), ['createdAt', 'credential', 'credentialId', 'endpoint']);
  assert.match(grant.credentialId, /^alc_[0-9a-f-]{36}$/); assert.match(grant.credential, /^ca_[A-Za-z0-9_-]{43}$/);
  assert.equal(grant.endpoint, `${API_ORIGIN}/v1/allowance/responses`); assert.equal(grant.createdAt, '2026-10-14T10:00:00.000Z');
  assert.equal(code(await f.call('POST', '/v1/allowance/credentials', a.session, { extra: true })), 'INVALID_REQUEST');

  // Only a keyed hash is stored, bound to the account and the device that asked.
  const { rows: [row] } = await f.sql.query('SELECT account_id, device_id, token_hash, revoked_at FROM allowance_credentials WHERE id = $1', [grant.credentialId]);
  assert.deepEqual(row, { account_id: a.accountId, device_id: a.deviceId, token_hash: secretHash(PEPPER, 'allowance-credential', grant.credential), revoked_at: null });
  const { rows: dump } = await f.sql.query(`SELECT t::text AS row FROM allowance_credentials t`);
  assert.equal(dump.some(r => r.row.includes(grant.credential.slice(3))), false);

  // Scope: the credential opens the Responses endpoint and nothing else; the session token does not open it.
  assert.equal((await f.respond(grant.credential)).status, 200);
  for (const [method, url, body] of [['GET', '/v1/allowance', undefined], ['POST', '/v1/allowance/complete', ask('req_scope_01', { route: 'openai', model: 'gpt-test' })],
    ['POST', '/v1/allowance/credentials', {}], ['DELETE', `/v1/allowance/credentials/${grant.credentialId}`, undefined]] as const) {
    const reply = await f.call(method, url, grant.credential, body);
    assert.equal(reply.status, 401, `${method} ${url}`); assert.equal(code(reply), 'UNAUTHENTICATED');
  }
  const bySession = await f.respond(a.session);
  assert.equal(bySession.status, 401); assert.equal(code(bySession), 'UNAUTHENTICATED');
  assert.equal(code(await f.respond(`ca_${a.session}`)), 'UNAUTHENTICATED', 'the session token with the prefix is still not a credential');
  assert.equal(fetch.calls.length, 1, 'refused credentials never reach the provider');

  // At most three live per device: a fourth revokes the oldest.
  const more: any[] = [];
  for (let i = 0; i < 3; i++) { f.advance(1000); more.push((await f.issue(a.session)).body); }
  assert.equal(code(await f.respond(grant.credential)), 'UNAUTHENTICATED', 'the oldest was rotated out');
  for (const live of more) assert.equal((await f.respond(live.credential)).status, 200);
  assert.equal((await f.sql.query('SELECT count(*)::int AS n FROM allowance_credentials WHERE device_id = $1 AND revoked_at IS NULL', [a.deviceId])).rows[0].n, 3);

  // Revocation: once, idempotent, own account only.
  const other = await f.account();
  const notMine = await f.call('DELETE', `/v1/allowance/credentials/${more[0].credentialId}`, other.session);
  assert.equal(notMine.status, 404); assert.equal(code(notMine), 'NOT_FOUND');
  assert.equal(code(await f.call('DELETE', '/v1/allowance/credentials/alc_nope', a.session)), 'NOT_FOUND');
  f.advance(1000);
  const revoked = await f.call('DELETE', `/v1/allowance/credentials/${more[0].credentialId}`, a.session);
  assert.deepEqual(revoked, { status: 200, body: { credentialId: more[0].credentialId, revokedAt: '2026-10-14T10:00:04.000Z' } });
  f.advance(1000);
  assert.deepEqual((await f.call('DELETE', `/v1/allowance/credentials/${more[0].credentialId}`, a.session)).body, revoked.body, 'a second revoke keeps the first time');
  assert.equal(code(await f.respond(more[0].credential)), 'UNAUTHENTICATED');

  // Revoking the device ends its credentials; a lapsed plan refuses before any provider call.
  await f.sql.query('UPDATE devices SET revoked_at = $2 WHERE id = $1', [a.deviceId, '2026-10-14T10:00:06.000Z']);
  assert.equal(code(await f.respond(more[1].credential)), 'UNAUTHENTICATED');
  const b = await f.account(), bGrant = (await f.issue(b.session)).body as any;
  f.plans.set(b.accountId, FREE_ENTITLEMENTS);
  assert.equal(code(await f.respond(bGrant.credential)), 'PLAN_REQUIRED');
  assert.equal(fetch.calls.length, 4);

  const unset = await credentialSetup({ apiOrigin: null }), c = await unset.account();
  const noEndpoint = await unset.issue(c.session);
  assert.equal(noEndpoint.status, 503); assert.equal(code(noEndpoint), 'ALLOWANCE_ENDPOINT_NOT_SET');
});

test('the Responses endpoint forwards to OpenAI with the json_schema format and meters it through the ledger', { skip: pgSkip }, async () => {
  const reply = { id: 'resp_upstream', object: 'response', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SELECTION, annotations: [] }] }], usage: { input_tokens: 400, output_tokens: 30, total_tokens: 430 } };
  const fetch = fakeFetch([{ status: 200, body: reply }, { status: 200, body: { ...reply, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }]);
  const f = await credentialSetup({ providers: { openai: openaiProvider('sk-oa-key', fetch) } });
  const a = await f.account(), grant = (await f.issue(a.session)).body as any;
  const body = gatewayBody('gpt-test');
  const answer = await f.respond(grant.credential, body);
  assert.equal(answer.status, 200);
  const id = (answer.body as any).id;
  assert.match(id, /^rsp_[0-9a-f-]{36}$/);
  assert.deepEqual(answer.body, { id, object: 'response', status: 'completed', model: 'gpt-test',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SELECTION }] }], output_text: SELECTION, usage: { input_tokens: 400, output_tokens: 30 } });
  // ceil((400 * 2.5 + 30 * 10) * 8450 / 10^6) = ceil(10.985)
  assert.deepEqual(answer.headers, { 'x-request-id': id, 'x-chausar-cost-paise': '11', 'x-chausar-balance-paise': '289' });
  assert.equal(fetch.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(fetch.calls[0].init.headers, { 'content-type': 'application/json', authorization: 'Bearer sk-oa-key' });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { model: 'gpt-test', input: [{ role: 'user', content: body.input }], instructions: body.instructions, max_output_tokens: 512, store: false,
    text: { format: { type: 'json_schema', name: 'business_context_selection', schema: SCHEMA, strict: false } } });
  const { rows } = await f.sql.query('SELECT request_id, route, model, state, cost_paise, input_tokens, output_tokens FROM allowance_requests');
  assert.deepEqual(rows, [{ request_id: id, route: 'openai', model: 'gpt-test', state: 'settled', cost_paise: '11', input_tokens: 400, output_tokens: 30 }]);
  const summary = (await f.call('GET', '/v1/allowance', a.session)).body as any;
  assert.deepEqual([summary.spentPaise, summary.reservedPaise, summary.balancePaise], ['11', '0', '289']);

  const cut = await f.respond(grant.credential, body, { 'idempotency-key': 'gateway-key-0001' });
  assert.equal((cut.body as any).status, 'incomplete', 'a reply cut at the output limit is not passed off as complete');
  assert.deepEqual((cut.body as any).incomplete_details, { reason: 'max_output_tokens' });
  assert.equal((cut.body as any).id, 'idk_gateway-key-0001');
  const again = await f.respond(grant.credential, body, { 'idempotency-key': 'gateway-key-0001' });
  assert.equal(again.status, 409); assert.equal(code(again), 'REQUEST_EXISTS');
  assert.equal(code(await f.respond(grant.credential, body, { 'idempotency-key': 'short' })), 'INVALID_REQUEST');
  assert.equal(fetch.calls.length, 2);
});

test('the Responses endpoint calls Anthropic with the instructions as system and wraps the text as a Responses reply', { skip: pgSkip }, async () => {
  const fetch = fakeFetch([
    { status: 200, body: { ...ANTHROPIC_REPLY, content: [{ type: 'text', text: SELECTION }], usage: { input_tokens: 500, output_tokens: 40 } } },
    { status: 200, body: { ...ANTHROPIC_REPLY, content: [{ type: 'text', text: '{"claimIds": [' }], stop_reason: 'max_tokens', usage: { input_tokens: 500, output_tokens: 512 } } },
    { status: 529, body: { error: { message: 'overloaded' } } }, new TypeError('fetch failed'),
  ]);
  const f = await credentialSetup({ providers: { anthropic: anthropicProvider('sk-ant-key', fetch) } });
  const a = await f.account(), grant = (await f.issue(a.session)).body as any;
  const body = gatewayBody('claude-test');
  const answer = await f.respond(grant.credential, body);
  assert.equal(answer.status, 200);
  const id = (answer.body as any).id;
  assert.deepEqual(answer.body, { id, object: 'response', status: 'completed', model: 'claude-test',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SELECTION }] }], output_text: SELECTION, usage: { input_tokens: 500, output_tokens: 40 } });
  assert.equal(fetch.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(fetch.calls[0].init.headers, { 'content-type': 'application/json', 'x-api-key': 'sk-ant-key', 'anthropic-version': '2023-06-01' });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { model: 'claude-test', max_tokens: 512, system: body.instructions, messages: [{ role: 'user', content: body.input }] });
  // ceil((500 * 3 + 40 * 15) * 8450 / 10^6) = ceil(17.745)
  assert.equal(answer.headers!['x-chausar-cost-paise'], '18');
  const cut = await f.respond(grant.credential, body);
  assert.equal((cut.body as any).status, 'incomplete');
  const refused = await f.respond(grant.credential, body);
  assert.equal(refused.status, 502); assert.equal(code(refused), 'PROVIDER_FAILED');
  const lost = await f.respond(grant.credential, body);
  assert.equal(lost.status, 504); assert.equal(code(lost), 'PROVIDER_OUTCOME_UNKNOWN');
  assert.deepEqual(Object.keys(lost.body as any), ['error'], 'errors keep the hosted error shape');
  const { rows } = await f.sql.query(`SELECT state, count(*)::int AS n FROM allowance_requests GROUP BY state ORDER BY state`);
  assert.deepEqual(rows, [{ state: 'failed', n: 1 }, { state: 'settled', n: 2 }, { state: 'unknown', n: 1 }]);
  const summary = (await f.call('GET', '/v1/allowance', a.session)).body as any;
  // Settled: 18 + ceil((500 * 3 + 512 * 15) * 8450 / 10^6) = 18 + 78; held: the unknown request's worst case.
  assert.equal(summary.spentPaise, '96');
  assert.equal(BigInt(summary.reservedPaise) > 0n, true, 'the unclear outcome keeps its reservation');
});

test('the Responses endpoint refuses anything but the gateway form, unpriced models and tools', { skip: pgSkip }, async () => {
  const f = await credentialSetup({ providers: { openai: { complete: async () => assert.fail('never called') } } });
  const a = await f.account(), grant = (await f.issue(a.session)).body as any;
  const big = { type: 'object', description: 'x'.repeat(70 * 1024) };
  const cases: [Record<string, unknown>, string][] = [
    [{ tools: [{ type: 'web_search' }] }, 'TOOLS_NOT_ALLOWED'], [{ tool_choice: 'auto' }, 'TOOLS_NOT_ALLOWED'],
    [{ store: true }, 'INVALID_REQUEST'], [{ temperature: 0 }, 'INVALID_REQUEST'], [{ stream: true }, 'INVALID_REQUEST'],
    [{ input: [{ role: 'user', content: 'x' }] }, 'INVALID_REQUEST'], [{ input: '' }, 'INVALID_REQUEST'], [{ instructions: 7 }, 'INVALID_REQUEST'],
    [{ max_output_tokens: 0 }, 'INVALID_REQUEST'], [{ max_output_tokens: 8193 }, 'INVALID_REQUEST'], [{ max_output_tokens: 1.5 }, 'INVALID_REQUEST'],
    [{ text: { format: { type: 'text' } } }, 'INVALID_REQUEST'], [{ text: { format: { type: 'json_schema', name: 'bad name', schema: SCHEMA } } }, 'INVALID_REQUEST'],
    [{ text: { format: { type: 'json_schema', name: 'n', schema: [] } } }, 'INVALID_REQUEST'], [{ text: { format: { type: 'json_schema', name: 'n', schema: big } } }, 'INVALID_REQUEST'],
    [{ text: { verbosity: 'low', format: { type: 'json_schema', name: 'n', schema: SCHEMA } } }, 'INVALID_REQUEST'],
    [{ input: 'x'.repeat(250_001) }, 'INVALID_REQUEST'], [{ model: 'gpt-other' }, 'MODEL_NOT_PRICED'], [{ model: 'bad model' }, 'INVALID_REQUEST'],
  ];
  for (const [extra, expected] of cases) assert.equal(code(await f.respond(grant.credential, gatewayBody('gpt-test', extra))), expected, JSON.stringify(extra).slice(0, 80));
  assert.equal(code(await f.respond(grant.credential, gatewayBody('claude-test'))), 'PROVIDER_NOT_CONFIGURED');
  const { model, input, max_output_tokens } = gatewayBody('gpt-test');
  assert.equal(code(await f.respond(grant.credential, { model, input, max_output_tokens, max_tokens: 5 })), 'INVALID_REQUEST');
  assert.equal(code(await f.call('POST', '/v1/allowance/responses', grant.credential, undefined, { 'content-type': 'text/plain' })), 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal((await f.sql.query('SELECT count(*)::int AS n FROM allowance_requests')).rows[0].n, 0, 'nothing refused was reserved');
});

test('the Responses endpoint stores no prompt, schema or answer anywhere in the database', { skip: pgSkip }, async () => {
  const fetch = fakeFetch([{ status: 200, body: { ...OPENAI_REPLY, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'MANGO-ANSWER {}' }] }] } }, new TypeError('fetch failed'),
    { status: 200, body: { ...ANTHROPIC_REPLY, content: [{ type: 'text', text: 'MANGO-ANSWER {}' }] } }]);
  const f = await credentialSetup({ providers: { openai: openaiProvider('sk-oa-SECRETKEY', fetch), anthropic: anthropicProvider('sk-ant-SECRETKEY', fetch) } });
  const a = await f.account(), grant = (await f.issue(a.session)).body as any;
  const body = gatewayBody('gpt-test', { instructions: 'ZEBRA-SYSTEM Sharma Traders', text: { format: { type: 'json_schema', name: 'zebra_schema', strict: false, schema: { ...SCHEMA, description: 'ZEBRA-SCHEMA' } } } });
  assert.equal((await f.respond(grant.credential, body)).status, 200);
  assert.equal((await f.respond(grant.credential, body)).status, 504);
  assert.equal((await f.respond(grant.credential, { ...body, model: 'claude-test' })).status, 200);
  const { rows: tables } = await f.sql.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  for (const { table_name } of tables) {
    const { rows } = await f.sql.query(`SELECT t::text AS row FROM "${table_name}" t`);
    for (const { row } of rows) for (const needle of ['ZEBRA', 'zebra', 'Sharma', 'MANGO', 'SECRETKEY', grant.credential.slice(3)]) assert.equal(row.includes(needle), false, `${table_name} holds ${needle}`);
  }
});
