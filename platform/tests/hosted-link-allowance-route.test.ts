/**
 * The allowance as a gateway model route, end to end: one Engine with the hosted-link module and the core gateway,
 * one composed hosted app on a disposable PostgreSQL, joined by an in-process fetch. `hosted.allowanceCredential`
 * hands the models-ext lane's `connectAllowance` what it needs; the gateway's `managed` route then sends its Responses
 * body with that credential to `/v1/allowance/responses`, and the hosted ledger records the cost. Only the payment
 * partner, the SMS sender and the model providers (recorded replies) are fakes.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import type { HttpRequest, HttpResult } from '../runtime/gateway.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { initialHostedLinkState } from '../runtime/hosted-link/service.ts';
import { allowanceCredential, allowanceRevoke } from '../runtime/hosted-link/allowance-credential.ts';
import { buildHosted } from '../../hosted/app.ts';
import type { Fetch } from '../../hosted/shared/module.ts';
import { FakeOtpProvider } from '../../hosted/accounts/otp.ts';
import { FakePaymentPartner } from '../../hosted/billing/partner.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const API = 'https://api.chausar.app', PHONE = '+919876543210', ENDPOINT = `${API}/v1/allowance/responses`;
const passphrase = 'Synthetic allowance route passphrase';
const PRICING = { checkedOn: '2026-10-01', source: 'Synthetic rate card', fxPaisePerUsd: '8450', models: [
  { route: 'openai', model: 'gpt-test', inputUsdMicrosPerMillionTokens: '2500000', outputUsdMicrosPerMillionTokens: '10000000' },
  { route: 'anthropic', model: 'claude-test', inputUsdMicrosPerMillionTokens: '3000000', outputUsdMicrosPerMillionTokens: '15000000' },
] };
const importInput = {
  sourceId: 'synthetic-invoice-export', format: 'csv',
  content: 'id,kind,date,amount,currency,branch,description\ninvoice-a,invoice,2026-09-02,100.00,INR,main,Private customer note\ninvoice-b,invoice,2026-09-03,200.00,INR,main,Quoted untrusted business instructions',
  recipe: { version: 1, id: 'synthetic-context-invoices', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Context', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice'], allowedStatuses: ['unpaid'], onUnmapped: 'reject' }, expectedTotals: { rowCount: 2, amountMinor: '30000' },
};
const SELECTION = JSON.stringify({ claimIds: ['context_workspace', 'context_records'], unknownCategories: ['industry', 'products', 'customers', 'business_model', 'location'] });

async function setup(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-allowance-route-')));
  const sql = await freshDatabase();
  let time = Date.parse('2026-10-14T06:00:00.000Z');
  // The model providers behind the hosted proxy: recorded replies, one per call.
  const upstream: { url: string; headers: Record<string, string>; body: any }[] = [];
  const providers: Fetch = async (url, init = {}) => {
    upstream.push({ url, headers: init.headers ?? {}, body: JSON.parse(String(init.body)) });
    const reply = url === 'https://api.openai.com/v1/responses'
      ? { id: 'resp_upstream', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SELECTION, annotations: [] }] }], usage: { input_tokens: 1200, output_tokens: 60 } }
      : { id: 'msg_upstream', type: 'message', role: 'assistant', content: [{ type: 'text', text: SELECTION }], stop_reason: 'end_turn', usage: { input_tokens: 1300, output_tokens: 70 } };
    const text = JSON.stringify(reply);
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  };
  const otp = new FakeOtpProvider(), partner = new FakePaymentPartner();
  const app = buildHosted({ HOSTED_PEPPER: 'allowance-route-pepper-long-enough-for-the-server', LINK_ORIGIN: 'https://link.chausar.app', HOSTED_API_ORIGIN: API,
    BILLING_PAID_PRICE_PAISE: '49900', ALLOWANCE_MONTHLY_PAISE: '50000', ALLOWANCE_PRICING_JSON: JSON.stringify(PRICING),
    OPENAI_API_KEY: 'synthetic-openai-test-key', ANTHROPIC_API_KEY: 'synthetic-anthropic-test-key' },
  sql, providers, { clock: () => new Date(time), otp, partner, blobStore: null });
  const route = (method: string, url: string, headers: Record<string, string>, body?: string | Uint8Array) => {
    const target = new URL(url); assert.equal(target.origin, API);
    return app.router.handle({ method, url: target.pathname + target.search, headers, body: body === undefined ? undefined : Buffer.from(body) });
  };
  // The desktop module's fetch reaches the hosted router in process, exactly as bytes over HTTP would.
  const bridge = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const response = await route(init.method, url, init.headers, init.body);
    const raw = Buffer.isBuffer(response.body) ? response.body : Buffer.from(typeof response.body === 'string' ? response.body : response.body === undefined ? '' : JSON.stringify(response.body));
    const headers: Record<string, string> = { 'content-length': String(raw.length), ...(Buffer.isBuffer(response.body) ? {} : { 'content-type': 'application/json' }) };
    for (const [key, value] of Object.entries(response.headers ?? {})) headers[key.toLowerCase()] = value;
    return { status: response.status, ok: response.status >= 200 && response.status < 300, headers: { get: name => headers[name.toLowerCase()] ?? null },
      text: async () => raw.toString('utf8'), arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
  };
  // The core gateway's HTTP port reaches the same router.
  const gatewayCalls: HttpRequest[] = [];
  const gatewayHttp = async (request: HttpRequest): Promise<HttpResult> => {
    gatewayCalls.push(structuredClone(request));
    const response = await route(request.method, request.endpoint, request.headers, request.body);
    return { status: response.status, body: JSON.stringify(response.body), endpoint: request.endpoint, requestId: response.headers?.['x-request-id'] };
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock),
    gateway: { http: gatewayHttp, process: async () => { assert.fail('No native provider runs in this test.'); } },
    modules: { 'hosted-link': { origin: API, linkOrigin: 'https://link.chausar.app', fetch: bridge, clock: () => new Date(time) } } });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Context', passphrase, pack: 'ecommerce' });
  const rpc = (method: string, payload: Record<string, unknown> = {}, ctx: Context = owner) => engine.requestAs(ctx, method, payload);
  async function pair() {
    const started = await rpc('hosted.pair.start', { phone: PHONE });
    await rpc('hosted.pair.finish', { challengeId: started.challengeId, code: otp.last(), deviceName: 'Shop computer' });
    return (engine.vault!.read().extensions!['hosted-link'] as any).pairing.sessionToken as string;
  }
  async function pay(session: string) {
    const pay = await app.router.handle({ method: 'POST', url: '/v1/billing/checkout', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: Buffer.from(JSON.stringify({ plan: 'paid', idempotencyKey: 'allowance-route-checkout' })) });
    assert.equal(pay.status, 200);
    const event = partner.webhook({ eventId: 'evt_allowance_route', type: 'activated', checkoutId: (pay.body as any).checkoutId, subscriptionRef: 'sub_allowance_route', currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
    assert.equal((await app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body })).status, 200);
  }
  return { engine, app, sql, rpc, pair, pay, upstream, gatewayCalls, route, advance: (ms: number) => { time += ms; } };
}

/** Exactly what models-ext's `connectAllowance` does with the reply (routes-methods.ts on claude/lane-models-ext). */
async function connectAllowance(engine: Engine, ctx: Context, grant: any, model?: string) {
  assert.ok(grant && typeof grant === 'object' && typeof grant.endpoint === 'string' && typeof grant.credential === 'string' && grant.credential.length > 0);
  return engine.services.gateway.configureRoute(ctx, { id: 'route_managed_allowance', kind: 'managed', model: model ?? grant.model, endpoint: grant.endpoint, label: 'Chausar allowance',
    ...(grant.budgetMinor !== undefined ? { budgetMinor: grant.budgetMinor } : {}) }, grant.credential);
}

/** One reviewed business-context request through the route: preview, approve, then dispatch once. */
async function askThroughRoute(rpc: (method: string, payload?: Record<string, unknown>) => Promise<any>) {
  const question = 'what is this business about', routeId = 'route_managed_allowance';
  const preview = await rpc('models.preview', { question, routeId });
  assert.equal(preview.purpose, 'business-context'); assert.equal(preview.endpoint, ENDPOINT);
  const approval = await rpc('models.approve', { id: preview.id });
  const answer = await rpc('conversation.ask', { question, routeId, previewId: preview.id, approvalId: approval.id });
  return { preview, answer };
}

test('the allowance credential becomes a managed gateway route whose requests the hosted ledger meters', { skip: pgSkip }, async t => {
  const f = await setup(t);
  await assert.rejects(f.rpc('hosted.allowanceCredential'), { code: 'HOSTED_NOT_PAIRED' });
  const session = await f.pair();
  // Not yet paid: the server refuses the credential and issues nothing.
  await assert.rejects(f.rpc('hosted.allowanceCredential'), { code: 'PLAN_REQUIRED' });
  assert.equal((await f.sql.query('SELECT count(*)::int AS n FROM allowance_credentials')).rows[0].n, 0);
  await f.pay(session);
  await assert.rejects(f.rpc('hosted.allowanceCredential', {}, { ...owner, channel: 'phone' }), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.rpc('hosted.allowanceCredential', { model: 'gpt-test' }), { code: 'INVALID_REQUEST' });

  const grant = await f.rpc('hosted.allowanceCredential');
  assert.deepEqual(Object.keys(grant).sort(), ['budgetMinor', 'credential', 'endpoint', 'model']);
  assert.equal(grant.endpoint, ENDPOINT); assert.equal(grant.model, 'gpt-test'); assert.equal(grant.budgetMinor, '50000');
  assert.match(grant.credential, /^ca_[A-Za-z0-9_-]{43}$/);
  const state = f.engine.vault!.read();
  const recorded = (state.extensions!['hosted-link'] as any).allowanceCredentials;
  assert.equal(recorded.length, 1); assert.match(recorded[0].credentialId, /^alc_/);
  assert.equal(JSON.stringify(state).includes(grant.credential), false, 'the token is not kept in the vault');
  assert.ok(state.activity.some((a: any) => a.event === 'hosted.allowance.credential.issued' && a.details.credentialId === recorded[0].credentialId));
  assert.equal(JSON.stringify(state.activity).includes(grant.credential), false);

  // The session token cannot use the endpoint; the credential cannot use any session route.
  assert.equal((await f.route('POST', ENDPOINT, { 'content-type': 'application/json', authorization: `Bearer ${session}` }, '{}')).status, 401);
  assert.equal((await f.route('GET', `${API}/v1/accounts/me`, { authorization: `Bearer ${grant.credential}` })).status, 401);

  // connectAllowance: the gateway takes the route with the credential in its own store.
  const configured = await connectAllowance(f.engine, owner, grant);
  assert.equal(configured.kind, 'managed'); assert.equal(configured.endpoint, ENDPOINT); assert.equal(configured.budgetMinor, '50000');
  assert.equal(configured.model, 'gpt-test'); assert.equal(configured.credentialConfigured, true);
  assert.equal(JSON.stringify(f.engine.vault!.read().routes).includes(grant.credential), false, 'the credential stays in the gateway credential store');

  await f.rpc('sources.import', importInput);
  await f.rpc('trust.update', { send: 'shape' });
  const { preview, answer } = await askThroughRoute(f.rpc);
  assert.equal(answer.kind, 'business-context');
  assert.equal(f.gatewayCalls.length, 1);
  const sent = f.gatewayCalls[0];
  assert.equal(sent.endpoint, ENDPOINT); assert.equal(sent.headers.Authorization, `Bearer ${grant.credential}`); assert.equal(sent.body, preview.payload);
  const body = JSON.parse(sent.body);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'max_output_tokens', 'model', 'store', 'text', 'tool_choice', 'tools']);

  // The proxy forwarded the gateway's json_schema format to OpenAI and settled the measured cost.
  assert.equal(f.upstream.length, 1);
  assert.equal(f.upstream[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(f.upstream[0].body, { model: 'gpt-test', input: [{ role: 'user', content: body.input }], instructions: body.instructions, max_output_tokens: body.max_output_tokens, store: false, text: body.text });
  const { rows } = await f.sql.query('SELECT request_id, route, model, state, cost_paise, input_tokens, output_tokens FROM allowance_requests');
  // ceil((1200 * 2.5 + 60 * 10) * 8450 / 10^6) = ceil(30.42)
  assert.deepEqual(rows.map(r => ({ ...r, request_id: undefined })), [{ request_id: undefined, route: 'openai', model: 'gpt-test', state: 'settled', cost_paise: '31', input_tokens: 1200, output_tokens: 60 }]);
  const receipt = f.engine.vault!.read().modelReceipts.find((r: any) => r.id === preview.id);
  assert.equal(receipt.status, 'completed');
  const status = await f.rpc('hosted.allowance.status');
  assert.deepEqual([status.spentPaise, status.reservedPaise, status.balancePaise], ['31', '0', '49969']);

  // The same route on the Anthropic model: instructions as system, input as the one user message.
  await connectAllowance(f.engine, owner, await f.rpc('hosted.allowanceCredential'), 'claude-test');
  await askThroughRoute(f.rpc);
  assert.equal(f.upstream.length, 2);
  assert.equal(f.upstream[1].url, 'https://api.anthropic.com/v1/messages');
  const second = JSON.parse(f.gatewayCalls[1].body);
  assert.deepEqual(f.upstream[1].body, { model: 'claude-test', max_tokens: second.max_output_tokens, system: second.instructions, messages: [{ role: 'user', content: second.input }] });
  // ceil((1300 * 3 + 70 * 15) * 8450 / 10^6) = ceil(41.8275)
  assert.deepEqual((await f.sql.query(`SELECT cost_paise FROM allowance_requests WHERE route = 'anthropic'`)).rows, [{ cost_paise: '42' }]);
  assert.equal((await f.rpc('hosted.allowance.status')).spentPaise, '73');

  // Revoking ends both credentials on the server; the route then fails without reaching a provider.
  const revoked = await f.rpc('hosted.allowanceRevoke');
  assert.equal(revoked.revoked.length, 2); assert.deepEqual(revoked.failed, []);
  assert.deepEqual((f.engine.vault!.read().extensions!['hosted-link'] as any).allowanceCredentials, []);
  await assert.rejects(askThroughRoute(f.rpc), { code: 'MODEL_FAILED' });
  assert.equal(f.upstream.length, 2);
  assert.deepEqual(await f.rpc('hosted.allowanceRevoke'), { revoked: [], failed: [] });
});

test('the credential reply leaves out a model or grant the server does not have, and refuses a foreign endpoint', async () => {
  const replies: { status: number; body: unknown }[] = [];
  const stub = async (url: string, init: { method: string }): Promise<FetchReply> => {
    const reply = replies.shift() ?? assert.fail(`unexpected ${init.method} ${url}`);
    const text = JSON.stringify(reply.body);
    return { status: reply.status, ok: reply.status < 300, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  };
  let state: any = { activity: [], extensions: { 'hosted-link': { ...initialHostedLinkState(), relayKey: 'synthetic-relay-key',
    pairing: { accountId: 'acct_a', deviceId: 'dev_a', sessionToken: 'synthetic-session-token-letters', sessionExpiresAt: '2026-11-14T06:00:00.000Z', pairedAt: '2026-10-14T06:00:00.000Z', phoneMasked: '+91******3210' } } } };
  const host = { options: { origin: API, fetch: stub }, demo: false, directory: '/nonexistent', services: {}, call: async () => assert.fail('no nested calls'),
    store: { read: () => state, update: async (work: (s: any) => any) => { const next = structuredClone(state); const out = await work(next); state = next; return out; } } } as unknown as ModuleHost;
  const status = (extra: Record<string, unknown>) => ({ status: 200, body: { month: '2026-10', grantPaise: null, grantState: 'not-set', spentPaise: '0', reservedPaise: '0', balancePaise: null, pricing: null, models: [], ...extra } });
  const issued = (endpoint = ENDPOINT) => ({ status: 201, body: { credentialId: 'alc_00000000-0000-4000-8000-000000000001', credential: 'ca_synthetic-credential-letters-only', endpoint, createdAt: '2026-10-14T06:00:00.000Z' } });

  replies.push(status({}), issued());
  assert.deepEqual(await allowanceCredential(owner, {}, host), { endpoint: ENDPOINT, credential: 'ca_synthetic-credential-letters-only' }, 'no model and no grant: both left out, never zero');
  replies.push(status({ grantState: 'set', grantPaise: '30000', balancePaise: '30000', models: [{ route: 'anthropic', model: 'claude-test' }] }), issued());
  assert.deepEqual(await allowanceCredential(owner, {}, host), { endpoint: ENDPOINT, credential: 'ca_synthetic-credential-letters-only', model: 'claude-test', budgetMinor: '30000' });
  replies.push(status({}), issued('https://elsewhere.example/v1/allowance/responses'));
  await assert.rejects(allowanceCredential(owner, {}, host), { code: 'HOSTED_REPLY_INVALID' });
  assert.equal(state.extensions['hosted-link'].allowanceCredentials.length, 2);
  await assert.rejects(allowanceCredential({ ...owner, channel: 'phone' }, {}, host), { code: 'OPEN_DESKTOP' });

  // A credential the server no longer knows counts as revoked; an unreachable server keeps the record for a retry.
  state.extensions['hosted-link'].allowanceCredentials = [
    { credentialId: 'alc_00000000-0000-4000-8000-000000000001', deviceId: 'dev_a', createdAt: '2026-10-14T06:00:00.000Z' },
    { credentialId: 'alc_00000000-0000-4000-8000-000000000002', deviceId: 'dev_a', createdAt: '2026-10-14T06:00:00.000Z' },
    { credentialId: 'alc_00000000-0000-4000-8000-000000000003', deviceId: 'dev_old', createdAt: '2026-10-14T06:00:00.000Z' }];
  replies.push({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }, { status: 503, body: { error: { code: 'SERVER_ERROR', message: 'x' } } });
  assert.deepEqual(await allowanceRevoke(owner, {}, host), { revoked: ['alc_00000000-0000-4000-8000-000000000001'], failed: ['alc_00000000-0000-4000-8000-000000000002'] });
  assert.deepEqual(state.extensions['hosted-link'].allowanceCredentials.map((r: any) => r.credentialId), ['alc_00000000-0000-4000-8000-000000000002']);
});
