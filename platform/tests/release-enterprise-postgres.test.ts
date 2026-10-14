import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { parseEnterpriseConfig, type EnterpriseConfig } from '../../enterprise/server/config.ts';
import { createEnterpriseServer, type EnterpriseServer } from '../../enterprise/server/server.ts';
import { MemoryEnterpriseStore, PostgresEnterpriseStore, openEnterpriseStorePool, type EnterpriseStateStore } from '../../enterprise/server/state-store.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from '../../enterprise/server/testing/fake-oidc-provider.ts';

// Real PostgreSQL runs only when CHAUSAR_TEST_POSTGRES_URL is set (CHAUSAR_TEST_POSTGRES_CA: path of the CA PEM for
// a TLS connection, required for a non-loopback host). The in-memory store runs the same contract every time.
const postgresUrl = process.env.CHAUSAR_TEST_POSTGRES_URL;
const caFile = process.env.CHAUSAR_TEST_POSTGRES_CA;
const servername = process.env.CHAUSAR_TEST_POSTGRES_SERVERNAME;
const realSkip = postgresUrl ? false : 'set CHAUSAR_TEST_POSTGRES_URL (and CHAUSAR_TEST_POSTGRES_CA for TLS) to run against a real PostgreSQL';
const openssl = spawnSync('openssl', ['version']).status === 0;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, String(error?.message)); return true; };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const unique = () => digest(`${Date.now()}-${Math.random()}`);
async function connection() { return { url: postgresUrl!, ...(caFile ? { tls: { ca: await readFile(caFile, 'utf8'), ...(servername ? { servername } : {}) } } : {}) }; }

async function storeContract(store: EnterpriseStateStore, other: EnterpriseStateStore) {
  const now = Date.now(), key = unique();
  await store.putSession(key, { memberId: 'member-1', role: 'viewer', epoch: 3, expiresAt: now + 60_000 }, 20_000, now);
  assert.deepEqual(await other.getSession(key, now), { memberId: 'member-1', role: 'viewer', epoch: 3, expiresAt: now + 60_000 });
  assert.equal(await other.getSession(key, now + 60_000), null, 'An expired session is not returned.');
  await other.deleteSession(key); assert.equal(await store.getSession(key, now), null, 'Deletion is seen by every process.');
  const login = unique();
  await store.putLogin(login, { nonce: 'n', verifier: 'v', expiresAt: now + 600_000 }, 2000, now);
  assert.deepEqual(await other.takeLogin(login, now), { nonce: 'n', verifier: 'v', expiresAt: now + 600_000 });
  assert.equal(await store.takeLogin(login, now), null, 'A sign-in state works once, across processes.');
  const late = unique(); await store.putLogin(late, { nonce: 'n', verifier: 'v', expiresAt: now + 10 }, 2000, now);
  assert.equal(await other.takeLogin(late, now + 11), null);
  const address = `198.51.100.${Math.floor(Math.random() * 250)}-${unique()}`;
  await store.hit(address, now, 3); await other.hit(address, now + 1, 3); await store.hit(address, now + 2, 3);
  await assert.rejects(other.hit(address, now + 3, 3), code('RATE_LIMITED'));
  await store.hit(address, now + 61_000, 3);
}

test('the in-memory store keeps the shared-store contract within one process', async () => {
  const store = new MemoryEnterpriseStore(); await storeContract(store, store);
  const now = Date.now(); await store.putSession(unique(), { memberId: 'm', role: 'owner', epoch: 1, expiresAt: now + 1000 }, 1, now);
  await assert.rejects(store.putSession(unique(), { memberId: 'm', role: 'owner', epoch: 1, expiresAt: now + 1000 }, 1, now), code('ENTERPRISE_BUSY'));
  await store.putSession(unique(), { memberId: 'm', role: 'owner', epoch: 1, expiresAt: now + 3000 }, 1, now + 2000);
  assert.equal(await store.sessionCount(now + 2000), 1, 'Expired sessions make room.');
});

test('the PostgreSQL store shares sessions, sign-in state and rate limits between two connections', { skip: realSkip }, async t => {
  const a = await PostgresEnterpriseStore.connect(await connection()), b = await PostgresEnterpriseStore.connect(await connection());
  t.after(async () => { await a.close(); await b.close(); });
  await storeContract(a, b);
  const pool = await openEnterpriseStorePool(await connection()); t.after(() => pool.end());
  const tls = await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
  if (caFile) assert.equal(tls.rows[0].ssl, true, 'The store connection is encrypted.');
  await assert.rejects(pool.query("INSERT INTO public.chausar_enterprise_sessions (session_digest, member_id, role, epoch, expires_at) VALUES ('raw-session-id', 'm', 'owner', 1, 1)"), 'Only digests fit the session key column.');
});

async function freePort(): Promise<number> {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); await new Promise<void>(resolve => probe.close(() => resolve()));
  if (!address || typeof address !== 'object') throw new Error('No port'); return address.port;
}
type Reply = { status: number; headers: Record<string, string | string[] | undefined>; json: any };
class Instance {
  app!: EnterpriseServer; store!: PostgresEnterpriseStore; port = 0; origin = ''; ca!: Buffer;
  call(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ host: '127.0.0.1', port: this.port, servername: 'localhost', ca: this.ca, method, path, headers: { host: `localhost:${this.port}`, ...headers } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)).on('end', () => {
          let json: any; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      });
      req.on('error', reject); req.end(body);
    });
  }
  async begin() {
    const start = await this.call('GET', '/auth/login'); assert.equal(start.status, 302);
    return { location: String(start.headers.location), loginCookie: String((start.headers['set-cookie'] as string[])[0]).split(';')[0] };
  }
  async finish(grant: { code: string; state: string }, loginCookie: string) {
    const reply = await this.call('GET', `/auth/callback?${new URLSearchParams(grant)}`, { cookie: loginCookie });
    const session = ((reply.headers['set-cookie'] as string[] | undefined) ?? []).find(item => item.startsWith('__Host-chausar=') && !item.startsWith('__Host-chausar=;'));
    return { reply, cookie: session ? session.split(';')[0] : '' };
  }
  me(cookie: string) { return this.call('GET', '/api/me', { cookie }); }
  rpc(cookie: string, method: string, payload: unknown = {}) {
    return this.call('POST', '/api/rpc', { cookie, 'content-type': 'application/json', origin: this.origin, 'x-chausar-request': '1' }, JSON.stringify({ method, payload }));
  }
  logout(cookie: string) { return this.call('POST', '/auth/logout', { cookie, origin: this.origin, 'x-chausar-request': '1' }); }
}

test('two enterprise server instances share one PostgreSQL: sign in on A, use and sign out on B, refused on A', { skip: realSkip || (openssl ? false : 'openssl is not installed'), timeout: 180_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-enterprise-pg-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const idp: FakeOidcProvider = await startFakeOidcProvider(); t.after(() => idp.close());
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=localhost', '-days', '1',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert]).status, 0); await chmod(key, 0o600);
  await writeFile(join(directory, 'client-secret'), idp.clientSecret, { mode: 0o600 });
  const database = await connection();
  const engine = new Engine({ directory: join(directory, 'vaults'), storage: 'postgres', postgresUrl: database.url, storageMode: 'enterprise-server', ...(database.tls ? { postgresTls: database.tls } : {}) });
  await engine.request('workspace.create', { name: 'Synthetic shared sessions', passphrase: 'synthetic shared session passphrase' });
  t.after(() => engine.shutdown(10_000).catch(() => {}));
  const port = await freePort(); const origin = `https://localhost:${port}`;
  const base = (listenPort: number): EnterpriseConfig => {
    const config = parseEnterpriseConfig({
      listen: { host: '127.0.0.1', port: listenPort }, tls: { certFile: cert, keyFile: key }, publicOrigin: origin,
      oidc: { issuer: 'https://placeholder.invalid', clientId: idp.clientId, clientSecretFile: join(directory, 'client-secret'), redirectPath: '/auth/callback', scopes: ['openid', 'email'] },
      roles: [{ claim: 'groups', equals: 'admins', role: 'owner', branches: ['*'] }, { claim: 'groups', equals: 'readers', role: 'viewer', branches: ['*'] }],
      sessionTtlMinutes: 30, dataDirectory: join(directory, 'server'), workspace: { directory: join(directory, 'vaults'), folder: 'main', unlock: 'keychain' },
    });
    config.oidc.issuer = idp.issuer; return config;
  };
  const tlsFiles = { cert: await readFile(cert), key: await readFile(key) };
  // Both instances answer for the same public origin, as they would behind one load balancer.
  async function instance(shared?: EnterpriseServer): Promise<Instance> {
    const it = new Instance(); it.port = await freePort(); it.origin = origin; it.ca = tlsFiles.cert;
    it.store = await PostgresEnterpriseStore.connect(database);
    it.app = await createEnterpriseServer(engine, base(it.port), { allowLoopbackHttpIssuer: true, tls: tlsFiles, store: it.store, identity: shared?.identity, authRateLimitPerMinute: 1000 });
    await it.app.listen(); return it;
  }
  const a = await instance(), b = await instance(a.app);
  const stop = async (it: Instance) => { it.app.server.closeAllConnections(); await new Promise<void>(resolve => it.app.server.close(() => resolve())); await it.store.close(); };
  t.after(async () => { for (const it of [a, b]) await stop(it).catch(() => {}); });
  // The Host header is the public origin (one load-balanced name); each instance listens on its own port.
  for (const it of [a, b]) { const call = it.call.bind(it); it.call = (method, path, headers = {}, body) => call(method, path, { host: `localhost:${port}`, ...headers }, body); }
  const claims = (sub: string, groups: string[]) => ({ sub, groups, email: `${sub}@example.com`, email_verified: true, name: `Synthetic ${sub}` });

  const started = await a.begin();
  const signedIn = await a.finish(idp.authorize(started.location, claims('owner-sub', ['admins'])), started.loginCookie);
  assert.equal(signedIn.reply.status, 302); assert.ok(signedIn.cookie);
  const onB = await b.me(signedIn.cookie); assert.equal(onB.status, 200, 'The session made on A works on B.'); assert.equal(onB.json.role, 'owner');
  assert.equal((await b.rpc(signedIn.cookie, 'workspace.status')).json.result.open, true, 'An authenticated engine round trip on B.');
  const raw = signedIn.cookie.slice('__Host-chausar='.length);
  const pool = await openEnterpriseStorePool(database); t.after(() => pool.end());
  const rows = (await pool.query('SELECT session_digest FROM public.chausar_enterprise_sessions WHERE session_digest = $1 OR session_digest = $2', [digest(raw), raw])).rows;
  assert.deepEqual(rows.map(row => row.session_digest), [digest(raw)], 'Only the SHA-256 of the session id is stored.');

  assert.equal((await b.logout(signedIn.cookie)).status, 200);
  const refused = await a.me(signedIn.cookie); assert.equal(refused.status, 401, 'Signed out on B is refused on A.'); assert.equal(refused.json.error.code, 'UNAUTHENTICATED');

  // A sign-in started on A can finish on B: the state, nonce and PKCE verifier are shared and single use.
  const crossStart = await a.begin(); const grant = idp.authorize(crossStart.location, claims('reader-sub', ['readers']));
  const crossed = await b.finish(grant, crossStart.loginCookie); assert.equal(crossed.reply.status, 302); assert.equal((await a.me(crossed.cookie)).json.role, 'viewer');
  assert.equal((await a.finish(grant, crossStart.loginCookie)).reply.json.error.code, 'OIDC_STATE_INVALID', 'The state cannot be replayed on the other instance.');

  // Revocation through the engine ends the session everywhere and removes its row.
  const ownerStart = await b.begin(); const ownerSession = await b.finish(idp.authorize(ownerStart.location, claims('owner-sub', ['admins'])), ownerStart.loginCookie);
  const readerId = (await a.me(crossed.cookie)).json.memberId;
  assert.equal((await a.rpc(ownerSession.cookie, 'members.revoke', { id: readerId })).status, 200);
  assert.equal((await b.me(crossed.cookie)).status, 401); assert.equal((await a.me(crossed.cookie)).status, 401);
  const readerRaw = crossed.cookie.slice('__Host-chausar='.length);
  assert.equal((await pool.query('SELECT 1 FROM public.chausar_enterprise_sessions WHERE session_digest = $1', [digest(readerRaw)])).rows.length, 0);

  // A restart keeps people signed in: a fresh instance with a fresh pool reads the same session.
  await stop(a); const c = await instance(b.app);
  const callC = c.call.bind(c); c.call = (method, path, headers = {}, body) => callC(method, path, { host: `localhost:${port}`, ...headers }, body);
  t.after(() => stop(c).catch(() => {}));
  assert.equal((await c.me(ownerSession.cookie)).json.role, 'owner', 'A session survives the process that created it.');

});
