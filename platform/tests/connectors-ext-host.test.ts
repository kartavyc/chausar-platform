import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { connectorsExtModule } from '../runtime/modules/lane-connectors-ext.ts';
import { ConnectorCredentialStore, hostCredentialServices, loadOAuthClients } from '../runtime/connectors-ext/credentials.ts';
import { decide } from '../runtime/connectors-ext/schedule.ts';
import { handlers } from '../runtime/connectors-ext/service.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

const owner = { memberId: 'owner', role: 'owner' as const, epoch: 1, channel: 'desktop' as const };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const fx = (name: string) => readFileSync(new URL(`../../fixtures/connectors/tally/${name}`, import.meta.url), 'utf8');
async function temp(t: any, prefix: string) { const dir = await mkdtemp(join(tmpdir(), prefix)); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function open(t: any) {
  const directory = await temp(t, 'chausar-cx-host-');
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' } as any);
  t.after(() => engine.close());
  await engine.request('workspace.create', { name: 'Synthetic Traders', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return { engine, directory };
}
function hostFor(engine: Engine, options: Record<string, unknown>): ModuleHost {
  const e = engine as any;
  return { get store() { return e.store(); }, services: e.services, demo: false, directory: e.options.directory, options, call: (method: string, payload: Record<string, unknown>) => engine.request(method, payload) };
}

test('a fresh Engine with no modules option wires this module from trusted host inputs', async t => {
  const directory = await temp(t, 'chausar-cx-fresh-');
  writeFileSync(join(directory, 'oauth-clients.json'), JSON.stringify({ google: { clientId: 'synthetic.apps', redirectUri: 'http://127.0.0.1:47123/cb', clientSecret: 'not-shown' }, evil: { clientId: 'x', redirectUri: 'http://attacker.example/cb' } }));
  const engine = new Engine({ directory, storage: 'experimental-file' } as any); t.after(() => engine.close());
  const options = engine.moduleHost('connectors-ext', owner).options as any;
  for (const name of ['credentialBroker', 'tokenExchange', 'databaseCredentials', 'http']) assert.equal(typeof options[name], 'function', name);
  assert.deepEqual(options.oauthClients, { google: { clientId: 'synthetic.apps', redirectUri: 'http://127.0.0.1:47123/cb' } }, 'client secrets never reach module options; unknown providers are dropped');
  assert.deepEqual(connectorsExtModule.hostOptions!({ directory, demo: true, env: {} }), {}, 'demo launches wire nothing external');
  assert.deepEqual(loadOAuthClients(join(directory, 'missing.json')), {});
});

test('credentials are sealed outside workspace state and never returned', async t => {
  const dir = await temp(t, 'chausar-cx-cred-');
  const store = new ConnectorCredentialStore(join(dir, 'creds'));
  store.set('cx-razorpay-1', { kind: 'key', system: 'razorpay', secret: 'rzp_id:rzp_SECRET_VALUE', storedAt: '2026-10-14T00:00:00.000Z' });
  const files = await readdir(join(dir, 'creds'));
  for (const name of files) assert.equal((await readFile(join(dir, 'creds', name))).includes('rzp_SECRET_VALUE'), false, name);
  assert.equal((await stat(join(dir, 'creds', '.key'))).mode & 0o077, 0, 'the key is owner-only');
  assert.equal((store.get('cx-razorpay-1') as any).secret, 'rzp_id:rzp_SECRET_VALUE');
  const sealed = join(dir, 'creds', `${Buffer.from('cx-razorpay-1').toString('base64url')}.cred`), record = JSON.parse(readFileSync(sealed, 'utf8'));
  writeFileSync(sealed, JSON.stringify({ ...record, sealed: Buffer.from('tampered').toString('base64') }), { mode: 0o600 });
  assert.throws(() => store.get('cx-razorpay-1'), code('CREDENTIAL_STORE_INVALID'));
  assert.throws(() => store.get('../escape'), code('CREDENTIAL_SOURCE_INVALID'));
  store.set('a:b', { kind: 'key', system: 'x', secret: 'one:1', storedAt: '' }); store.set('a_b', { kind: 'key', system: 'x', secret: 'two:2', storedAt: '' });
  assert.deepEqual([(store.get('a:b') as any).secret, (store.get('a_b') as any).secret], ['one:1', 'two:2'], 'distinct ids never share a file');

  const { engine } = await open(t);
  const options = connectorsExtModule.hostOptions!({ directory: join(dir, 'app'), demo: false, env: {} }) as any;
  const host = hostFor(engine, options);
  const item = await engine.request('connectorsx.connect', { group: 'razorpay', road: 'interface', company: 'Synthetic Traders' });
  assert.deepEqual((await handlers.credentialsStatus(owner, { connectionId: item.id }, host)), { available: true, present: false, kind: null, storedAt: null });
  await assert.rejects(handlers.credentialsSet({ ...owner, channel: 'phone' }, { connectionId: item.id, secret: 'id:secret' }, host), code('OPEN_DESKTOP'));
  assert.deepEqual(await handlers.credentialsSet(owner, { connectionId: item.id, secret: 'key_id:key_SECRET' }, host), { stored: true, connectionId: item.id });
  assert.equal(JSON.stringify((engine as any).store().read()).includes('key_SECRET'), false, 'the key never enters workspace state');
  assert.equal(await options.credentialBroker(owner, { system: 'razorpay', sourceId: item.sourceId, origin: 'https://api.razorpay.com', scopes: [], scheme: 'basic' }), 'key_id:key_SECRET');
  await assert.rejects(options.credentialBroker(owner, { system: 'stripe', sourceId: item.sourceId, origin: 'https://api.stripe.com', scopes: [], scheme: 'bearer' }), code('CREDENTIAL_REQUIRED'));
  await handlers.disconnect(owner, { connectionId: item.id }, host);
  await assert.rejects(options.credentialBroker(owner, { system: 'razorpay', sourceId: item.sourceId, origin: 'https://api.razorpay.com', scopes: [], scheme: 'basic' }), code('CREDENTIAL_REQUIRED'), 'disconnecting removes the key');
});

test('browser sign-in exchanges the code once and refreshes an expired token', async t => {
  const dir = await temp(t, 'chausar-cx-oauth-');
  const store = new ConnectorCredentialStore(dir), calls: any[] = [];
  let issued = 0;
  const http = async (request: any) => { calls.push(request); issued++; return { status: 200, url: request.url, body: JSON.stringify({ access_token: `access-${issued}`, refresh_token: issued === 1 ? 'refresh-1' : undefined, expires_in: issued === 1 ? 1 : 3600 }) }; };
  const services = hostCredentialServices(store, { clients: { zoho: { clientId: 'synthetic-zoho', redirectUri: 'http://127.0.0.1:47123/cb' } }, http });
  await assert.rejects(services.tokenExchange(owner, { provider: 'zoho', code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1:9/elsewhere', scopes: [], connectionId: 'c1', sourceId: 'cx-zoho-books-1', settings: { dataCenter: 'in' } }), code('OAUTH_REDIRECT_INVALID'));
  await services.tokenExchange(owner, { provider: 'zoho', code: 'auth-code', verifier: 'verifier-123', redirectUri: 'http://127.0.0.1:47123/cb', scopes: ['ZohoBooks.invoices.READ'], connectionId: 'c1', sourceId: 'cx-zoho-books-1', settings: { dataCenter: 'in' } });
  assert.equal(calls[0].url, 'https://accounts.zoho.in/oauth/v2/token');
  assert.match(calls[0].body, /grant_type=authorization_code/); assert.match(calls[0].body, /code_verifier=verifier-123/);
  await new Promise(resolve => setTimeout(resolve, 5));
  const token = await services.credentialBroker(owner, { system: 'zoho-books', sourceId: 'cx-zoho-books-1', origin: 'https://www.zohoapis.in', scopes: [], scheme: 'zoho' });
  assert.equal(token, 'access-2', 'an expired token is refreshed before use'); assert.match(calls[1].body, /grant_type=refresh_token/);
  assert.equal((store.get('cx-zoho-books-1') as any).refreshToken, 'refresh-1', 'the refresh token is kept when the provider does not rotate it');
  const refused = hostCredentialServices(store, { clients: {}, http: async (r: any) => ({ status: 400, url: r.url, body: '{"error":"invalid_grant"}' }) });
  await assert.rejects(refused.tokenExchange(owner, { provider: 'google', code: 'c', verifier: 'v', redirectUri: 'x', scopes: [], connectionId: 'c', sourceId: 's', settings: {} }), code('OAUTH_CLIENT_REQUIRED'));
});

test('a scheduled refresh reads a real loopback Tally, honours the catch-up rule and budgets', async t => {
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => { response.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' }); response.end(body.includes('ChausarGroupTotal') ? fx('sales-total.xml') : fx('sales-vouchers.xml')); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const port = (server.address() as any).port;
  const { engine, directory } = await open(t);
  const options = connectorsExtModule.hostOptions!({ directory, demo: false, env: {} }) as any;
  const host = hostFor(engine, options);
  const item = await engine.request('connectorsx.connect', { group: 'tally', road: 'interface', company: 'Synthetic Traders',
    settings: { endpoint: `http://127.0.0.1:${port}/`, company: 'Demo Traders', baseCurrency: 'INR', ledgers: 'Sales GST 18%|Sales GST 5%' } });
  const read: any = await handlers.read(owner, { connectionId: item.id, operation: 'sales-register', period: { from: '2026-04-01', to: '2026-04-30' } }, host);
  assert.equal(read.status, 'accepted', JSON.stringify(read.refusal)); assert.equal(read.sourceTotals.provenance, 'source-declared');
  await assert.rejects(handlers.schedule(owner, { connectionId: item.id, schedule: { operation: 'sales-register', everyHours: 0, freshnessTargetHours: 1, catchUp: 'run-once' } }, host), code('SCHEDULE_INVALID'));
  const razor = await engine.request('connectorsx.connect', { group: 'razorpay', road: 'interface', company: 'Synthetic Traders' });
  await assert.rejects(handlers.schedule(owner, { connectionId: razor.id, schedule: { operation: 'payments', everyHours: 6, freshnessTargetHours: 12, catchUp: 'run-once' } }, host), code('SCHEDULE_NEEDS_SOURCE_TOTAL'));
  await handlers.schedule(owner, { connectionId: item.id, schedule: { operation: 'sales-register', everyHours: 6, freshnessTargetHours: 24, catchUp: 'skip' } }, host);
  const awake = { awake: true, windowOpen: true, backgroundEnabled: false };
  assert.deepEqual(await connectorsExtModule.tick!(owner, hostFor(engine, { ...options }), { ...awake, awake: false }), [], 'nothing runs while the computer sleeps');
  assert.deepEqual(await connectorsExtModule.tick!({ ...owner, memberId: 'cofounder', role: 'cofounder' as any }, host, awake), [], 'only the owner tick reads, so nothing runs twice');
  const first: any[] = await connectorsExtModule.tick!(owner, host, awake);
  assert.equal(first.length, 1); assert.match(first[0].outcome, /^(accepted|refused|failed)/);
  assert.deepEqual(await connectorsExtModule.tick!(owner, host, awake), [], 'not due again inside the interval');
  const [fresh] = await engine.request('connectorsx.freshness', { sourceId: item.sourceId });
  assert.equal(fresh.schedule.everyHours, 6); assert.equal(typeof fresh.stale, 'boolean');
  const schedule = { operation: 'x', everyHours: 6, freshnessTargetHours: 24, autoImport: false, lastOutcome: null, runs: { day: '', count: 0 } };
  const at = Date.parse('2026-10-14T00:00:00.000Z');
  assert.equal(decide({ ...schedule, catchUp: 'skip', lastRunAt: '2026-10-13T00:00:00.000Z' }, at).action, 'skip-missed');
  assert.deepEqual(decide({ ...schedule, catchUp: 'run-once', lastRunAt: '2026-10-13T00:00:00.000Z' }, at), { action: 'run', reason: 'missed-slot-run-once' });
  assert.equal(decide({ ...schedule, catchUp: 'run-once', lastRunAt: '2026-10-13T20:00:00.000Z' }, at).action, 'wait');
  assert.equal(decide({ ...schedule, catchUp: 'run-once', lastRunAt: '2026-10-13T00:00:00.000Z', runs: { day: '2026-10-14', count: 24 } }, at).action, 'budget');
});

test('review fixes: header pass-through, internal hosts, PayU var1 and database password binding', async t => {
  const { readHttp, payuSignedBody } = await import('../runtime/adapters/read-kit.ts');
  const { woocommerceReadSpec } = await import('../runtime/adapters/commerce/index.ts');
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-wp-total': '7', 'set-cookie': 'session=1' }); res.end('{}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as any).port}/`;
  const response = await readHttp({ url, method: 'GET', headers: {}, maxBytes: 1000, timeoutMs: 2000, redirect: 'error' });
  assert.equal(response.headers?.['x-wp-total'], '7'); assert.equal(response.headers?.['set-cookie'], undefined);
  for (const site of ['https://10.0.0.5', 'https://169.254.169.254', 'https://127.0.0.1', 'https://shop.local', 'https://erp.internal'])
    assert.throws(() => woocommerceReadSpec.validate({ site }), code('WOOCOMMERCE_SITE_INVALID'), site);
  assert.throws(() => payuSignedBody('command=get_settlement_details&var1=2026-09-04|x', 'merchantkey:saltsaltsalt'), code('ADAPTER_INVALID'));
  const { engine, directory } = await open(t);
  const options = connectorsExtModule.hostOptions!({ directory, demo: false, env: {} }) as any;
  const host = hostFor(engine, options);
  const stripe = await engine.request('connectorsx.connect', { group: 'stripe', road: 'interface', company: 'Synthetic Traders' });
  await handlers.credentialsSet(owner, { connectionId: stripe.id, secret: 'sk_test_SECRET' }, host);
  await assert.rejects(engine.request('connectorsx.connect', { group: 'plain-database', road: 'database', company: 'X', settings: { engine: 'postgres', host: 'db.example.com', port: '5432', database: 'd', user: 'u', passwordRef: stripe.sourceId } }), code('CREDENTIAL_NOT_ACCEPTED'));
  await assert.rejects(options.databaseCredentials(owner, stripe.sourceId), code('DB_CREDENTIAL_REQUIRED'), 'another system\'s key is never a database password');
  await assert.rejects(handlers.connect({ ...owner, sourceTainted: true }, { group: 'tally', road: 'file', company: 'X' }, host), code('OPEN_DESKTOP'));
  await assert.rejects(handlers.read({ ...owner, channel: 'mcp' as any }, { connectionId: stripe.id, operation: 'payout-reconciliation' }, host), code('OPEN_DESKTOP'));
});
