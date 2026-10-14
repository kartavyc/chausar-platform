import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OidcClient } from '../../enterprise/server/oidc.ts';
import { loadEnterpriseConfig, parseEnterpriseConfig } from '../../enterprise/server/config.ts';
import { checkEmailDomain, mapRole } from '../../enterprise/server/identity.ts';
import { startFakeOidcProvider, type FakeOidcProvider, type TokenOptions } from '../../enterprise/server/testing/fake-oidc-provider.ts';

const code = (expected: string) => (error: any) => { assert.equal(error.code, expected); return true; };
async function provider(t: any) { const idp = await startFakeOidcProvider(); t.after(() => idp.close()); return idp; }
const client = (idp: FakeOidcProvider, extra: Partial<ConstructorParameters<typeof OidcClient>[0]> = {}) => new OidcClient({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret,
  redirectUri: 'https://localhost:8443/auth/callback', scopes: ['openid', 'email'], allowLoopbackHttpIssuer: true, ...extra });
async function login(oidc: OidcClient, idp: FakeOidcProvider, claims: Record<string, unknown> = { sub: 'user-1' }, options: TokenOptions & { nonce?: string } = {}) {
  const begin = await oidc.beginLogin(); const grant = idp.authorize(begin.url, claims, options);
  assert.equal(grant.state, begin.state); return oidc.completeLogin(grant);
}

test('authorization-code login with PKCE verifies RS256 and ES256 identity tokens', async t => {
  const idp = await provider(t); const oidc = client(idp);
  const begin = await oidc.beginLogin(); const url = new URL(begin.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.match(url.searchParams.get('nonce')!, /^[A-Za-z0-9_-]{43}$/); assert.equal(url.searchParams.get('redirect_uri'), 'https://localhost:8443/auth/callback');
  const rsa = await login(oidc, idp, { sub: 'user-rsa', email: 'a@example.com' }); assert.equal(rsa.sub, 'user-rsa'); assert.equal(rsa.iss, idp.issuer);
  const ec = await login(oidc, idp, { sub: 'user-ec' }, { alg: 'ES256' }); assert.equal(ec.sub, 'user-ec');
  assert.equal(idp.jwksRequests, 1, 'The key set is cached between logins.');
});

test('forged, misdirected, expired and unsigned identity tokens are refused', async t => {
  const idp = await provider(t); const oidc = client(idp); const now = Math.floor(Date.now() / 1000);
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { badSignature: true }), code('OIDC_SIGNATURE_INVALID'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { alg: 'ES256', badSignature: true }), code('OIDC_SIGNATURE_INVALID'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { claims: { aud: 'another-client' } }), code('OIDC_CLAIMS_INVALID'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { claims: { aud: [idp.clientId, 'another-client'] } }), code('OIDC_CLAIMS_INVALID'));
  assert.equal((await login(oidc, idp, { sub: 'u' }, { claims: { aud: [idp.clientId, 'another-client'], azp: idp.clientId } })).sub, 'u');
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { claims: { iss: 'https://evil.example' } }), code('OIDC_CLAIMS_INVALID'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { claims: { exp: now - 600, iat: now - 900 } }), code('OIDC_TOKEN_EXPIRED'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { claims: { nbf: now + 900 } }), code('OIDC_CLAIMS_INVALID'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { claims: { iat: now + 900 } }), code('OIDC_CLAIMS_INVALID'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { omit: ['exp'] }), code('OIDC_TOKEN_EXPIRED'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { alg: 'none' }), code('OIDC_ALGORITHM_REFUSED'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { alg: 'HS256' }), code('OIDC_ALGORITHM_REFUSED'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { kid: 'unknown-key' }), code('OIDC_KEY_UNKNOWN'));
  await assert.rejects(login(oidc, idp, { sub: 'u' }, { nonce: 'a-different-nonce' }), code('OIDC_NONCE_INVALID'));
  await assert.rejects(login(oidc, idp, {}, {}), code('OIDC_CLAIMS_INVALID'));
});

test('state is single use and expires after ten minutes', async t => {
  const idp = await provider(t); let clock = Date.now(); const oidc = client(idp, { now: () => clock });
  const begin = await oidc.beginLogin(); const grant = idp.authorize(begin.url, { sub: 'u' });
  assert.equal((await oidc.completeLogin(grant)).sub, 'u');
  const before = idp.tokenRequests;
  await assert.rejects(oidc.completeLogin(grant), code('OIDC_STATE_INVALID'));
  assert.equal(idp.tokenRequests, before, 'A replayed state never reaches the token endpoint.');
  const late = await oidc.beginLogin(); const lateGrant = idp.authorize(late.url, { sub: 'u' }); clock += 10 * 60 * 1000 + 1;
  await assert.rejects(oidc.completeLogin(lateGrant), code('OIDC_STATE_INVALID'));
  await assert.rejects(oidc.completeLogin({ state: 'not-a-state', code: 'x' }), code('OIDC_STATE_INVALID'));
});

test('discovery requires the exact issuer and https, and key rotation refreshes on a miss', async t => {
  const idp = await provider(t);
  assert.throws(() => client(idp, { allowLoopbackHttpIssuer: false }), code('OIDC_CONFIG_INVALID'));
  idp.metadataOverrides = { issuer: `${idp.issuer}/` };
  await assert.rejects(client(idp).beginLogin(), code('OIDC_ISSUER_MISMATCH'));
  idp.metadataOverrides = { token_endpoint: 'http://192.0.2.1/token' };
  await assert.rejects(client(idp).beginLogin(), code('OIDC_PROVIDER_INVALID'));
  idp.metadataOverrides = { code_challenge_methods_supported: ['plain'] };
  await assert.rejects(client(idp).beginLogin(), code('OIDC_PROVIDER_INVALID'));
  idp.metadataOverrides = {};
  let clock = Date.now(); const oidc = client(idp, { now: () => clock });
  await login(oidc, idp); idp.rotate();
  await assert.rejects(login(oidc, idp), code('OIDC_KEY_UNKNOWN'), 'Refresh on a miss is rate limited.');
  clock += 31_000; assert.equal((await login(oidc, idp, { sub: 'after-rotation' })).sub, 'after-rotation');
});

test('role rules: first match wins, arrays match by member, unmatched users and foreign domains are refused', () => {
  const rules = [
    { claim: 'groups', equals: 'admins', role: 'owner' as const, branches: ['*'] },
    { claim: 'groups', equals: 'books', role: 'accountant' as const, branches: ['north'] },
    { claim: 'department', equals: 'finance', role: 'viewer' as const, branches: ['*'] },
  ];
  assert.deepEqual(mapRole(rules, { groups: ['books', 'admins'] }), { role: 'owner', branches: ['*'] });
  assert.deepEqual(mapRole(rules, { groups: ['books'] }), { role: 'accountant', branches: ['north'] });
  assert.deepEqual(mapRole(rules, { department: 'finance' }), { role: 'viewer', branches: ['*'] });
  assert.throws(() => mapRole(rules, { groups: ['other'], department: 'Finance' }), code('ENTERPRISE_ROLE_UNMAPPED'));
  assert.throws(() => mapRole(rules, { groups: 'admin' }), code('ENTERPRISE_ROLE_UNMAPPED'));
  checkEmailDomain(['example.com'], { email: 'A@Example.com', email_verified: true });
  assert.throws(() => checkEmailDomain(['example.com'], { email: 'a@example.com', email_verified: false }), code('ENTERPRISE_EMAIL_REFUSED'));
  assert.throws(() => checkEmailDomain(['example.com'], { email: 'a@example.com.evil.test', email_verified: true }), code('ENTERPRISE_EMAIL_REFUSED'));
});

function baseConfig(directory: string): any {
  return {
    listen: { host: '127.0.0.1', port: 8443 }, tls: { certFile: join(directory, 'cert.pem'), keyFile: join(directory, 'key.pem') }, publicOrigin: 'https://chausar.example.com',
    oidc: { issuer: 'https://login.example.com', clientId: 'chausar', clientSecretFile: join(directory, 'client-secret'), redirectPath: '/auth/callback', scopes: ['openid', 'email'] },
    roles: [{ claim: 'groups', equals: 'admins', role: 'owner', branches: ['*'] }], sessionTtlMinutes: 60, dataDirectory: join(directory, 'server'),
    workspace: { directory: join(directory, 'vaults'), folder: 'main', unlock: { passphraseFile: join(directory, 'passphrase') } },
  };
}

test('configuration requires TLS, refuses inline secrets and unknown keys, and checks file custody', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-enterprise-config-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const valid = baseConfig(directory); assert.equal(parseEnterpriseConfig(valid).sessionTtlMinutes, 60);
  const without = (mutate: (value: any) => void) => { const value = structuredClone(valid); mutate(value); return value; };
  assert.throws(() => parseEnterpriseConfig(without(v => { delete v.tls; })), code('TLS_REQUIRED'));
  assert.throws(() => parseEnterpriseConfig(without(v => { delete v.tls; v.extra = 1; })), code('TLS_REQUIRED'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.tls = { certFile: v.tls.certFile }; })), code('TLS_REQUIRED'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.tls.keyFile = 'relative/key.pem'; })), code('TLS_REQUIRED'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.oidc.clientSecret = 'inline'; })), code('ENTERPRISE_INLINE_SECRET'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.workspace.unlock = { passphrase: 'inline' }; })), code('ENTERPRISE_INLINE_SECRET'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.unknown = true; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.oidc.allowLoopbackHttpIssuer = true; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.oidc.issuer = 'http://login.example.com'; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.publicOrigin = 'http://chausar.example.com'; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.publicOrigin = 'https://chausar.example.com/app'; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.oidc.scopes = ['email']; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.roles = []; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.roles[0].role = 'admin'; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.roles[0].branches = ['*', 'north']; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.throws(() => parseEnterpriseConfig(without(v => { v.sessionTtlMinutes = 100000; })), code('ENTERPRISE_CONFIG_INVALID'));
  assert.equal(parseEnterpriseConfig(without(v => { v.workspace.unlock = 'keychain'; })).workspace.unlock, 'keychain');
  const example = JSON.parse(await readFile(new URL('../../enterprise/server/config.example.json', import.meta.url), 'utf8'));
  assert.equal(parseEnterpriseConfig(example).roles.length, 4, 'The shipped example configuration is valid.');

  const path = join(directory, 'config.json'); await writeFile(path, JSON.stringify(valid));
  await writeFile(valid.tls.certFile, 'certificate'); await writeFile(valid.tls.keyFile, 'key', { mode: 0o600 });
  await writeFile(valid.oidc.clientSecretFile, 'secret\n', { mode: 0o600 }); await writeFile(valid.workspace.unlock.passphraseFile, 'passphrase', { mode: 0o600 });
  assert.equal((await loadEnterpriseConfig(path)).oidc.clientId, 'chausar');
  await assert.rejects(loadEnterpriseConfig('relative.json'), code('ENTERPRISE_CONFIG_INVALID'));
  if (process.platform !== 'win32') {
    await chmod(valid.tls.keyFile, 0o644); await assert.rejects(loadEnterpriseConfig(path), code('TLS_FILE_INVALID')); await chmod(valid.tls.keyFile, 0o600);
    await chmod(valid.oidc.clientSecretFile, 0o640); await assert.rejects(loadEnterpriseConfig(path), code('ENTERPRISE_SECRET_FILE_INVALID')); await chmod(valid.oidc.clientSecretFile, 0o600);
    await rm(valid.tls.keyFile); await symlink(valid.oidc.clientSecretFile, valid.tls.keyFile); await assert.rejects(loadEnterpriseConfig(path), code('TLS_FILE_INVALID'));
  }
  await rm(valid.tls.keyFile); await assert.rejects(loadEnterpriseConfig(path), code('TLS_FILE_INVALID'));
});
