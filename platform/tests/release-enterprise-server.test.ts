import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { parseEnterpriseConfig, type EnterpriseConfig } from '../../enterprise/server/config.ts';
import { createEnterpriseServer, type EnterpriseServer } from '../../enterprise/server/server.ts';
import { startFakeOidcProvider, type FakeOidcProvider, type TokenOptions } from '../../enterprise/server/testing/fake-oidc-provider.ts';

const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;
type Reply = { status: number; headers: Record<string, string | string[] | undefined>; text: string; json: any };

async function freePort(): Promise<number> {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); await new Promise<void>(resolve => probe.close(() => resolve()));
  if (!address || typeof address !== 'object') throw new Error('No port'); return address.port;
}
async function certificate(directory: string) {
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=localhost', '-days', '1',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { encoding: 'utf8' });
  assert.equal(made.status, 0, 'openssl could not create a test certificate'); await chmod(key, 0o600); return { cert, key };
}

class Fixture {
  directory = ''; engine!: Engine; app!: EnterpriseServer; idp!: FakeOidcProvider; config!: EnterpriseConfig; port = 0; origin = ''; ca!: Buffer;
  static async start(t: any, extra: { rateLimit?: number } = {}) {
    const f = new Fixture(); f.directory = await mkdtemp(join(tmpdir(), 'chausar-enterprise-'));
    f.idp = await startFakeOidcProvider();
    const { cert, key } = await certificate(f.directory); f.ca = await readFile(cert);
    await writeFile(join(f.directory, 'client-secret'), `${f.idp.clientSecret}\n`, { mode: 0o600 });
    f.port = await freePort(); f.origin = `https://localhost:${f.port}`;
    f.config = parseEnterpriseConfig({
      listen: { host: '127.0.0.1', port: f.port }, tls: { certFile: cert, keyFile: key }, publicOrigin: f.origin,
      oidc: { issuer: 'https://placeholder.invalid', clientId: f.idp.clientId, clientSecretFile: join(f.directory, 'client-secret'), redirectPath: '/auth/callback', scopes: ['openid', 'email', 'profile'] },
      roles: [
        { claim: 'groups', equals: 'admins', role: 'owner', branches: ['*'] },
        { claim: 'groups', equals: 'books', role: 'accountant', branches: ['north'] },
        { claim: 'groups', equals: 'readers', role: 'viewer', branches: ['*'] },
      ],
      allowedEmailDomains: ['example.com'], sessionTtlMinutes: 30, dataDirectory: join(f.directory, 'server'),
      workspace: { directory: join(f.directory, 'vaults'), folder: 'main', unlock: { passphraseFile: join(f.directory, 'passphrase') } },
    });
    // The loopback test issuer is only reachable through the trusted constructor option.
    f.config.oidc.issuer = f.idp.issuer;
    f.engine = new Engine({ directory: join(f.directory, 'vaults'), demo: true, storage: 'experimental-file' });
    await f.engine.request('workspace.create', { name: 'Synthetic enterprise', passphrase: 'synthetic-enterprise-passphrase', demo: true });
    f.app = await createEnterpriseServer(f.engine, f.config, { allowLoopbackHttpIssuer: true, authRateLimitPerMinute: extra.rateLimit ?? 1000 });
    await f.app.listen();
    t.after(async () => { await f.app.close(5000).catch(() => {}); await f.idp.close(); await rm(f.directory, { recursive: true, force: true }); });
    return f;
  }
  call(method: string, path: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ host: '127.0.0.1', port: this.port, servername: 'localhost', ca: this.ca, method, path, headers: { host: `localhost:${this.port}`, ...options.headers } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)).on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8'); let json: any; try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      });
      req.on('error', reject); req.end(options.body);
    });
  }
  async beginLogin() {
    const start = await this.call('GET', '/auth/login'); assert.equal(start.status, 302);
    const loginCookie = String((start.headers['set-cookie'] as string[])[0]).split(';')[0];
    return { location: String(start.headers.location), loginCookie };
  }
  callback(params: { code: string; state: string }, cookie: string) {
    return this.call('GET', `/auth/callback?${new URLSearchParams(params)}`, { headers: { cookie } });
  }
  async login(sub: string, groups: string[], options: TokenOptions & { nonce?: string } = {}): Promise<{ cookie: string; reply: Reply }> {
    const { location, loginCookie } = await this.beginLogin();
    const grant = this.idp.authorize(location, { sub, groups, email: `${sub}@example.com`, email_verified: true, name: `Synthetic ${sub}` }, options);
    const reply = await this.callback(grant, loginCookie);
    const cookies = (reply.headers['set-cookie'] as string[] | undefined) ?? [];
    const session = cookies.find(item => item.startsWith('__Host-chausar=') && !item.startsWith('__Host-chausar=;'));
    return { cookie: session ? session.split(';')[0] : '', reply };
  }
  rpc(cookie: string, method: string, payload: unknown = {}, headers: Record<string, string> = {}) {
    return this.call('POST', '/api/rpc', { headers: { cookie, 'content-type': 'application/json', origin: this.origin, 'x-chausar-request': '1', ...headers }, body: JSON.stringify({ method, payload }) });
  }
}

test('enterprise HTTPS server: OIDC sign-in, roles, branch scope, CSRF, denied methods and session revocation', { skip: openssl ? false : 'openssl is not installed' }, async t => {
  const f = await Fixture.start(t);

  await t.test('full login and engine round trip as the mapped owner', async () => {
    const root = await f.call('GET', '/'); assert.equal(root.status, 302); assert.equal(root.headers.location, '/ui/index.html');
    const page = await f.call('GET', '/ui/index.html'); assert.equal(page.status, 200);
    assert.match(String(page.headers['strict-transport-security']), /max-age=31536000/); assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    const shell = await f.call('GET', '/ui/shell.js'); assert.equal(shell.status, 200); assert.ok(shell.text.includes("'X-Chausar-Request': '1'")); assert.ok(!shell.text.includes('Authorization'));
    assert.equal((await f.call('GET', '/package.json')).status, 404);
    assert.equal((await f.call('GET', '/healthz', { headers: { host: '127.0.0.1' } })).json.status, 'ok');
    const { cookie, reply } = await f.login('owner-sub', ['admins']);
    assert.equal(reply.status, 302); assert.equal(reply.headers.location, '/ui/index.html');
    const setCookie = (reply.headers['set-cookie'] as string[]).find(item => item.startsWith('__Host-chausar='))!;
    for (const part of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict']) assert.ok(setCookie.includes(part), part);
    const me = await f.call('GET', '/api/me', { headers: { cookie } }); assert.equal(me.status, 200);
    assert.equal(me.json.role, 'owner'); assert.deepEqual(me.json.branches, ['*']);
    const context = await f.rpc(cookie, 'ui.context'); assert.equal(context.status, 200);
    assert.equal(context.json.result.member.id, me.json.memberId); assert.equal(context.json.result.member.role, 'owner');
    assert.equal((await f.rpc(cookie, 'workspace.status')).json.result.open, true);
    const stored = await readFile(join(f.config.dataDirectory, 'identities.json'), 'utf8');
    assert.ok(!stored.includes('owner-sub') && !stored.includes('example.com') && !stored.includes('access'), 'Only hashed subjects are stored.');
    if (process.platform !== 'win32') assert.equal((await stat(join(f.config.dataDirectory, 'identities.json'))).mode & 0o777, 0o600);
    const again = await f.login('owner-sub', ['admins']); const meAgain = await f.call('GET', '/api/me', { headers: { cookie: again.cookie } });
    assert.equal(meAgain.json.memberId, me.json.memberId, 'An unchanged mapping reuses the member.');
  });

  await t.test('viewer reads but cannot administer; accountant branch scope reaches the engine', async () => {
    const viewer = await f.login('viewer-sub', ['readers']);
    assert.equal((await f.rpc(viewer.cookie, 'ui.context')).json.result.member.role, 'viewer');
    const add = await f.rpc(viewer.cookie, 'members.add', { name: 'Escalation', role: 'owner' }); assert.equal(add.status, 403); assert.equal(add.json.error.code, 'FORBIDDEN');
    const accountant = await f.login('books-sub', ['books']);
    const scoped = await f.rpc(accountant.cookie, 'ui.context'); assert.equal(scoped.status, 200);
    assert.equal(scoped.json.result.member.role, 'accountant'); assert.deepEqual(scoped.json.result.member.branches, ['north']);
    assert.equal((await f.rpc(accountant.cookie, 'members.list')).status, 403);
    const owner = await f.login('owner-sub', ['admins']);
    const ownerDashboard = (await f.rpc(owner.cookie, 'dashboard.get')).json; const accountantDashboard = (await f.rpc(accountant.cookie, 'dashboard.get')).json;
    assert.ok(ownerDashboard.result.factCount > 0, 'The owner sees the synthetic facts.');
    assert.equal(accountantDashboard.result.factCount, 0, 'The engine filters facts outside the accountant branch grant.');
  });

  await t.test('unmapped users, foreign domains and broken callbacks get no session', async () => {
    const unmapped = await f.login('stranger-sub', ['nobody']); assert.equal(unmapped.reply.status, 403);
    assert.equal(unmapped.reply.json.error.code, 'ENTERPRISE_ROLE_UNMAPPED'); assert.equal(unmapped.cookie, '');
    const wrongNonce = await f.login('owner-sub', ['admins'], { nonce: 'not-the-nonce' }); assert.equal(wrongNonce.reply.json.error.code, 'OIDC_NONCE_INVALID'); assert.equal(wrongNonce.cookie, '');
    const forged = await f.login('owner-sub', ['admins'], { badSignature: true }); assert.equal(forged.reply.json.error.code, 'OIDC_SIGNATURE_INVALID');
    const audience = await f.login('owner-sub', ['admins'], { claims: { aud: 'other' } }); assert.equal(audience.reply.json.error.code, 'OIDC_CLAIMS_INVALID');
    const none = await f.login('owner-sub', ['admins'], { alg: 'none' }); assert.equal(none.reply.json.error.code, 'OIDC_ALGORITHM_REFUSED');
    const expired = await f.login('owner-sub', ['admins'], { claims: { exp: Math.floor(Date.now() / 1000) - 600 } }); assert.equal(expired.reply.json.error.code, 'OIDC_TOKEN_EXPIRED');
    const { location, loginCookie } = await f.beginLogin();
    const grant = f.idp.authorize(location, { sub: 'owner-sub', groups: ['admins'], email: 'owner-sub@example.com', email_verified: true });
    assert.equal((await f.callback(grant, '')).json.error.code, 'OIDC_STATE_INVALID', 'A callback without the browser binding is refused.');
    assert.equal((await f.callback(grant, loginCookie)).status, 302);
    const replay = await f.callback(grant, loginCookie); assert.equal(replay.status, 401); assert.equal(replay.json.error.code, 'OIDC_STATE_INVALID');
    const begin = await f.beginLogin(); const domain = f.idp.authorize(begin.location, { sub: 'outsider', groups: ['admins'], email: 'x@evil.test', email_verified: true });
    assert.equal((await f.callback(domain, begin.loginCookie)).json.error.code, 'ENTERPRISE_EMAIL_REFUSED');
    const providerError = await f.call('GET', '/auth/callback?error=access_denied&error_description=%3Cscript%3E', { headers: { cookie: begin.loginCookie } });
    assert.equal(providerError.json.error.code, 'OIDC_LOGIN_FAILED'); assert.ok(!providerError.text.includes('script'));
  });

  await t.test('requests need the CSRF marker, the exact origin, the right host and a session', async () => {
    const { cookie } = await f.login('owner-sub', ['admins']);
    const noMarker = await f.call('POST', '/api/rpc', { headers: { cookie, 'content-type': 'application/json', origin: f.origin }, body: '{"method":"workspace.status"}' });
    assert.equal(noMarker.status, 403); assert.equal(noMarker.json.error.code, 'CSRF_REQUIRED');
    const noOrigin = await f.call('POST', '/api/rpc', { headers: { cookie, 'content-type': 'application/json', 'x-chausar-request': '1' }, body: '{"method":"workspace.status"}' });
    assert.equal(noOrigin.status, 403); assert.equal(noOrigin.json.error.code, 'INVALID_ORIGIN');
    assert.equal((await f.rpc(cookie, 'workspace.status', {}, { origin: 'https://evil.example' })).json.error.code, 'INVALID_ORIGIN');
    assert.equal((await f.rpc(cookie, 'workspace.status', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await f.rpc('', 'workspace.status')).status, 401);
    assert.equal((await f.rpc('__Host-chausar=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'workspace.status')).status, 401);
    assert.equal((await f.rpc(cookie, 'workspace.status', {}, { host: 'evil.example' })).json.error.code, 'INVALID_HOST');
    const unsafe = await f.call('POST', '/api/rpc', { headers: { cookie, 'content-type': 'application/json', origin: f.origin, 'x-chausar-request': '1' }, body: '{"method":"workspace.status","payload":{"__proto__":{"x":1}}}' });
    assert.equal(unsafe.status, 400); assert.equal(({} as any).x, undefined);
    const malformed = await f.call('POST', '/api/rpc', { headers: { cookie, 'content-type': 'application/json', origin: f.origin, 'x-chausar-request': '1' }, body: '{"method": SECRET-TEXT' });
    assert.equal(malformed.json.error.code, 'INVALID_REQUEST'); assert.ok(!malformed.text.includes('SECRET-TEXT'), 'Errors never echo request data.');
    const huge = await f.call('POST', '/api/rpc', { headers: { cookie, 'content-type': 'application/json', origin: f.origin, 'x-chausar-request': '1' }, body: JSON.stringify({ method: 'workspace.status', payload: { blob: 'x'.repeat(2_100_000) } }) });
    assert.equal(huge.status, 413);
    assert.equal((await f.call('GET', '/api/rpc', { headers: { cookie } })).status, 405);
  });

  await t.test('bootstrap-only and unlisted methods are refused before the engine', async () => {
    const { cookie } = await f.login('owner-sub', ['admins']);
    for (const method of ['auth.accept', 'workspace.create', 'workspace.open', 'workspace.restore', 'workspace.recover', 'workspace.delete', 'workspace.lock', 'updates.status', 'updates.stage']) {
      const reply = await f.rpc(cookie, method, {}); assert.equal(reply.status, 403, method); assert.equal(reply.json.error.code, 'ENTERPRISE_METHOD_DENIED', method);
    }
    assert.equal((await f.rpc(cookie, 'engine.secretMethod')).json.error.code, 'INVALID_REQUEST');
    assert.equal((await f.rpc(cookie, 'workspace.status')).json.result.open, true, 'The workspace stayed open.');
  });

  await t.test('logout and member revocation end sessions; a revoked member stays revoked until the mapping changes', async () => {
    const first = await f.login('leaver-sub', ['books']);
    const logout = await f.call('POST', '/auth/logout', { headers: { cookie: first.cookie, origin: f.origin, 'x-chausar-request': '1' } });
    assert.equal(logout.status, 200); assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await f.rpc(first.cookie, 'ui.context')).status, 401);
    assert.equal((await f.call('POST', '/auth/logout', { headers: { cookie: first.cookie } })).status, 403, 'Logout needs the CSRF marker too.');

    const member = await f.login('leaver-sub', ['books']); const id = (await f.call('GET', '/api/me', { headers: { cookie: member.cookie } })).json.memberId;
    const owner = await f.login('owner-sub', ['admins']);
    assert.equal((await f.rpc(owner.cookie, 'members.revoke', { id })).status, 200);
    const after = await f.rpc(member.cookie, 'ui.context'); assert.equal(after.status, 401); assert.equal(after.json.error.code, 'UNAUTHENTICATED');
    assert.equal((await f.call('GET', '/api/me', { headers: { cookie: member.cookie } })).status, 401);
    const back = await f.login('leaver-sub', ['books']); assert.equal(back.reply.json.error.code, 'ENTERPRISE_MEMBER_REVOKED'); assert.equal(back.cookie, '');

    const changed = await f.login('leaver-sub', ['readers']); assert.equal(changed.reply.status, 302);
    const meChanged = (await f.call('GET', '/api/me', { headers: { cookie: changed.cookie } })).json;
    assert.equal(meChanged.role, 'viewer'); assert.notEqual(meChanged.memberId, id);

    const mover = await f.login('mover-sub', ['readers']); const moverId = (await f.call('GET', '/api/me', { headers: { cookie: mover.cookie } })).json.memberId;
    const promoted = await f.login('mover-sub', ['books']);
    assert.equal((await f.rpc(mover.cookie, 'ui.context')).status, 401, 'A mapping change revokes the old member and its sessions.');
    const members = (await f.rpc(owner.cookie, 'members.list')).json.result;
    assert.equal(members.find((m: any) => m.id === moverId).active, false);
    assert.equal((await f.call('GET', '/api/me', { headers: { cookie: promoted.cookie } })).json.role, 'accountant');
  });
});

test('sign-in routes are rate limited per address', { skip: openssl ? false : 'openssl is not installed' }, async t => {
  const f = await Fixture.start(t, { rateLimit: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await f.call('GET', '/auth/login')).status, 302);
  const limited = await f.call('GET', '/auth/login'); assert.equal(limited.status, 429); assert.equal(limited.json.error.code, 'RATE_LIMITED');
  assert.equal((await f.call('GET', '/ui/index.html')).status, 200, 'Application files are not rate limited.');
});

test('the server refuses to start without TLS files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-enterprise-notls-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = parseEnterpriseConfig({
    listen: { host: '127.0.0.1', port: 8443 }, tls: { certFile: join(directory, 'missing-cert.pem'), keyFile: join(directory, 'missing-key.pem') }, publicOrigin: 'https://localhost:8443',
    oidc: { issuer: 'https://login.example.com', clientId: 'c', clientSecretFile: join(directory, 'secret'), redirectPath: '/auth/callback', scopes: ['openid'] },
    roles: [{ claim: 'groups', equals: 'admins', role: 'owner', branches: ['*'] }], sessionTtlMinutes: 30, dataDirectory: join(directory, 'server'),
    workspace: { directory: join(directory, 'vaults'), folder: 'main', unlock: 'keychain' },
  });
  const engine = new Engine({ directory: join(directory, 'vaults'), demo: true, storage: 'experimental-file' });
  await assert.rejects(createEnterpriseServer(engine, config), (error: any) => error.code === 'TLS_FILE_INVALID');
  assert.throws(() => parseEnterpriseConfig({ ...config, tls: undefined }), (error: any) => error.code === 'TLS_REQUIRED');
});
