import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { parseEnterpriseConfig, type EnterpriseConfig, type RoleRule } from '../../enterprise/server/config.ts';
import { createEnterpriseServer, type EnterpriseServer } from '../../enterprise/server/server.ts';
import { IdentityDirectory } from '../../enterprise/server/identity.ts';
import { MemoryIdentityStore, PostgresEnterpriseStore, openEnterpriseStorePool, type IdentityEntry } from '../../enterprise/server/state-store.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from '../../enterprise/server/testing/fake-oidc-provider.ts';
import { realPostgresUnavailable, startTlsPostgres, type TlsPostgres } from '../../enterprise/server/testing/real-postgres.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, String(error?.message)); return true; };
const rules: RoleRule[] = [{ claim: 'groups', equals: 'admins', role: 'owner', branches: ['*'] }, { claim: 'groups', equals: 'readers', role: 'viewer', branches: ['*'] }];
const claims = (sub: string, groups: string[]) => ({ sub, groups, email: `${sub}@example.com`, email_verified: true, name: `Synthetic ${sub}` });
const ISSUER = 'https://login.example.com';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function demoEngine(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-identity-')); await chmod(directory, 0o700);
  const engine = new Engine({ directory: join(directory, 'vaults'), demo: true, storage: 'experimental-file' });
  await engine.request('workspace.create', { name: 'Synthetic identity map', passphrase: 'synthetic identity map passphrase', demo: true });
  t.after(async () => { await engine.shutdown(10_000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { engine, directory, data: join(directory, 'server') };
}
const named = async (engine: Engine, name: string) => (await engine.requestAs(engine.bootstrapContext(), 'members.list')).filter((member: any) => member.name === name);
async function legacyFile(data: string, entries: object[]) {
  await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700);
  await writeFile(join(data, 'identities.json'), JSON.stringify({ version: 1, entries }), { mode: 0o600 });
}

test('the in-memory identity store holds one identity at a time and lets other identities proceed', async () => {
  const store = new MemoryIdentityStore(); const order: string[] = [];
  const entry = (subject: string, memberId: string): IdentityEntry => ({ issuer: ISSUER, subject, memberId, role: 'viewer', branches: ['*'], revoked: false, updatedAt: new Date().toISOString() });
  const a = hash('a'), b = hash('b');
  const first = store.withIdentity(ISSUER, a, async previous => { order.push(`first:${previous?.memberId ?? 'none'}`); await sleep(50); order.push('first:done'); return { memberId: 'm1', save: entry(a, 'm1') }; });
  const second = store.withIdentity(ISSUER, a, async previous => { order.push(`second:${previous?.memberId ?? 'none'}`); return { memberId: previous?.memberId ?? 'm2', ...(previous ? {} : { save: entry(a, 'm2') }) }; });
  const other = store.withIdentity(ISSUER, b, async previous => { order.push(`other:${previous?.memberId ?? 'none'}`); return { memberId: 'm3', save: entry(b, 'm3') }; });
  assert.deepEqual((await Promise.all([first, second, other])).map(item => item.memberId), ['m1', 'm1', 'm3']);
  assert.deepEqual(order, ['first:none', 'other:none', 'first:done', 'second:m1'], 'The second sign-in waited for the first and saw its entry; another identity did not wait.');
  const failed = store.withIdentity(ISSUER, hash('c'), async () => { throw new Error('synthetic failure'); });
  await assert.rejects(failed); assert.equal((await store.list()).length, 2, 'A failed decision saves nothing.');
  assert.equal(await store.importEntries([entry(a, 'other'), entry(hash('d'), 'm4')]), 1, 'Import never overwrites an existing identity.');
  assert.equal((await store.list()).find(item => item.subject === a)?.memberId, 'm1');
});

async function signInRace(engine: Engine, directories: IdentityDirectory[], sub: string) {
  const results = await Promise.all(directories.map(directory => directory.signIn(ISSUER, claims(sub, ['readers']))));
  return results.map(result => result.member.id);
}

test('two directories sharing one identity store provision exactly one member for a concurrent first sign-in', async t => {
  const { engine, data } = await demoEngine(t); const store = new MemoryIdentityStore();
  const a = await IdentityDirectory.open(engine, { dataDirectory: data, rules, store }), b = await IdentityDirectory.open(engine, { dataDirectory: data, rules, store });
  const ids = await signInRace(engine, [a, b, a, b], 'racer-sub');
  assert.equal(new Set(ids).size, 1, 'Every racer signs in as the same member.');
  assert.equal((await named(engine, 'Synthetic racer-sub')).length, 1, 'Exactly one member was provisioned.');
  // Without the shared store, two directories each provision their own member: the store is what prevents it.
  const c = await IdentityDirectory.open(engine, { dataDirectory: data, rules }), d = await IdentityDirectory.open(engine, { dataDirectory: data, rules });
  await signInRace(engine, [c, d], 'unshared-sub');
  assert.equal((await named(engine, 'Synthetic unshared-sub')).length, 2);
});

test('revocation is recorded in the identity map and lasts until the provider mapping changes', async t => {
  const { engine, data } = await demoEngine(t); const directory = await IdentityDirectory.open(engine, { dataDirectory: data, rules });
  const first = await directory.signIn(ISSUER, claims('revoked-sub', ['readers']));
  await engine.requestAs(engine.bootstrapContext(), 'members.revoke', { id: first.member.id });
  await assert.rejects(directory.signIn(ISSUER, claims('revoked-sub', ['readers'])), code('ENTERPRISE_MEMBER_REVOKED'));
  const [entry] = await directory.entries(); assert.equal(entry.revoked, true); assert.equal(entry.subject, hash('revoked-sub'));
  assert.ok(!JSON.stringify(await directory.entries()).includes('revoked-sub'), 'Only the subject digest is stored.');
  await assert.rejects(directory.signIn(ISSUER, claims('revoked-sub', ['readers'])), code('ENTERPRISE_MEMBER_REVOKED'));
  const promoted = await directory.signIn(ISSUER, claims('revoked-sub', ['admins']));
  assert.notEqual(promoted.member.id, first.member.id); assert.equal(promoted.member.role, 'owner');
  assert.deepEqual((await directory.entries()).map(item => [item.memberId, item.role, item.revoked]), [[promoted.member.id, 'owner', false]]);
});

test('an earlier identities.json is read on start; a memory store leaves the file in place', async t => {
  const { engine, data } = await demoEngine(t);
  const member = await engine.requestAs(engine.bootstrapContext(), 'members.add', { name: 'Imported reader', role: 'viewer', branches: ['*'] });
  await legacyFile(data, [{ issuer: ISSUER, subject: hash('legacy-sub'), memberId: member.id, role: 'viewer', branches: ['*'], updatedAt: '2026-01-02T03:04:05.000Z' }]);
  const directory = await IdentityDirectory.open(engine, { dataDirectory: data, rules });
  assert.equal(directory.imported, 1); await stat(join(data, 'identities.json'));
  assert.equal((await directory.signIn(ISSUER, claims('legacy-sub', ['readers']))).member.id, member.id, 'The imported mapping is reused.');
  await writeFile(join(data, 'identities.json'), JSON.stringify({ version: 1, entries: [{ issuer: ISSUER, subject: 'raw-subject' }] }), { mode: 0o600 });
  await assert.rejects(IdentityDirectory.open(engine, { dataDirectory: data, rules }), code('ENTERPRISE_IDENTITY_STORE_INVALID'));
  await chmod(join(data, 'identities.json'), 0o644);
  await assert.rejects(IdentityDirectory.open(engine, { dataDirectory: data, rules }), code('ENTERPRISE_IDENTITY_STORE_INVALID'));
});

// ---- Real PostgreSQL 16 with TLS only (a throw-away cluster), reached on a non-loopback address with the pinned CA. ----
const unavailable = realPostgresUnavailable();
const opensslMissing = spawnSync('openssl', ['version']).status === 0 ? false : 'openssl is not installed';
async function freePort(): Promise<number> {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); await new Promise<void>(resolve => probe.close(() => resolve()));
  if (!address || typeof address !== 'object') throw new Error('No port'); return address.port;
}
type Reply = { status: number; headers: Record<string, string | string[] | undefined>; json: any };
class Instance {
  app!: EnterpriseServer; store!: PostgresEnterpriseStore; port = 0; publicPort = 0; origin = ''; ca!: Buffer;
  call(method: string, path: string, headers: Record<string, string> = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ host: '127.0.0.1', port: this.port, servername: 'localhost', ca: this.ca, method, path, headers: { host: `localhost:${this.publicPort}`, ...headers } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)).on('end', () => {
          let json: any; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      });
      req.on('error', reject); req.end();
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
}

test('identity map in a real TLS PostgreSQL: import, concurrent first sign-ins across instances and processes, restart', { skip: unavailable ?? opensslMissing, timeout: 300_000 }, async t => {
  // Cleanup runs in reverse: servers and pools before the engine, the engine before the cluster.
  const cleanup: (() => Promise<unknown>)[] = []; const later = (work: () => Promise<unknown>) => { cleanup.push(work); };
  t.after(async () => { for (const work of cleanup.reverse()) await work().catch(() => {}); });
  const pg: TlsPostgres = await startTlsPostgres(); later(() => pg.stop());
  const database = { url: pg.url(), tls: { ca: pg.ca } };
  const directory = await mkdtemp(join(tmpdir(), 'chausar-identity-pg-')); await chmod(directory, 0o700); later(() => rm(directory, { recursive: true, force: true }));
  const engine = new Engine({ directory: join(directory, 'vaults'), storage: 'postgres', postgresUrl: database.url, storageMode: 'enterprise-server', postgresTls: database.tls });
  await engine.request('workspace.create', { name: 'Synthetic identity map', passphrase: 'synthetic identity map passphrase' });
  later(() => engine.shutdown(10_000));
  const pool = await openEnterpriseStorePool(database); later(() => pool.end());
  const rows = async (subject?: string) => (await pool.query(`SELECT issuer, subject_hash, member_id, role, branches, revoked FROM public.chausar_enterprise_identities${subject ? ' WHERE subject_hash = $1' : ''} ORDER BY subject_hash`, subject ? [subject] : [])).rows;

  await t.test('an existing identities.json is imported once and renamed .imported', async () => {
    const data = join(directory, 'server'); const member = await engine.requestAs(engine.bootstrapContext(), 'members.add', { name: 'Imported owner', role: 'owner', branches: ['*'] });
    await legacyFile(data, [{ issuer: ISSUER, subject: hash('legacy-sub'), memberId: member.id, role: 'owner', branches: ['*'], updatedAt: '2026-01-02T03:04:05.000Z' }]);
    const store = await PostgresEnterpriseStore.connect(database);
    try {
      const opened = await IdentityDirectory.open(engine, { dataDirectory: data, rules, store: store.identities });
      assert.equal(opened.imported, 1);
      await assert.rejects(stat(join(data, 'identities.json'))); assert.equal((await stat(join(data, 'identities.json.imported'))).isFile(), true);
      assert.deepEqual(await rows(hash('legacy-sub')), [{ issuer: ISSUER, subject_hash: hash('legacy-sub'), member_id: member.id, role: 'owner', branches: ['*'], revoked: false }]);
      assert.equal((await IdentityDirectory.open(engine, { dataDirectory: data, rules, store: store.identities })).imported, 0, 'The renamed file is not read again.');
      assert.equal((await opened.signIn(ISSUER, claims('legacy-sub', ['admins']))).member.id, member.id, 'The imported mapping signs in as the same member.');
    } finally { await store.close(); }
  });

  await t.test('the table refuses a second row for one (issuer, subject) and raw subjects', async () => {
    const values = [ISSUER, hash('legacy-sub'), 'member-x', 'viewer', '["*"]', false, new Date().toISOString()];
    await assert.rejects(pool.query('INSERT INTO public.chausar_enterprise_identities (issuer, subject_hash, member_id, role, branches, revoked, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)', values), /chausar_enterprise_identities_subject/);
    await assert.rejects(pool.query('INSERT INTO public.chausar_enterprise_identities (issuer, subject_hash, member_id, role, branches, revoked, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)', [ISSUER, 'raw-subject', ...values.slice(2)]));
  });

  await t.test('separate OS processes signing in one new identity at the same moment provision exactly once', async () => {
    const child = fileURLToPath(new URL('../../enterprise/server/testing/identity-race-child.ts', import.meta.url));
    const subject = hash('process-race-sub'), startAt = Date.now() + 3000;
    const outputs = await Promise.all([0, 1, 2].map(() => new Promise<string>((resolve, reject) => {
      const proc = spawn(process.execPath, [child], { env: { ...process.env, CHAUSAR_RACE: JSON.stringify({ url: database.url, ca: pg.ca, issuer: ISSUER, subject, startAt, holdMs: 400 }) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; proc.stdout.on('data', chunk => { out += chunk; }); proc.stderr.on('data', chunk => { err += chunk; });
      proc.on('error', reject); proc.on('close', status => status === 0 ? resolve(out) : reject(new Error(`child failed: ${err.slice(-500)}`)));
    })));
    const results = outputs.map(out => JSON.parse(out.trim().split('\n').at(-1)!));
    assert.equal(new Set(results.map(item => item.pid)).size, 3, 'Three distinct processes.');
    assert.equal(results.filter(item => item.provisioned).length, 1, 'Exactly one process provisioned.');
    assert.equal(new Set(results.map(item => item.memberId)).size, 1, 'Every process resolved to the same member.');
    assert.ok(results.filter(item => !item.provisioned).every(item => item.waitedMs >= 300), 'The others waited on the identity lock.');
    assert.equal((await rows(subject)).length, 1);
  });

  await t.test('two server instances racing the same new user over HTTPS provision exactly one member; a restart keeps it', async () => {
    const idp: FakeOidcProvider = await startFakeOidcProvider(); later(() => idp.close());
    const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
    assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=localhost', '-days', '1',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert]).status, 0); await chmod(key, 0o600);
    await writeFile(join(directory, 'client-secret'), idp.clientSecret, { mode: 0o600 });
    const publicPort = await freePort(); const origin = `https://localhost:${publicPort}`;
    const tlsFiles = { cert: await readFile(cert), key: await readFile(key) };
    const config = (listenPort: number): EnterpriseConfig => {
      const value = parseEnterpriseConfig({
        listen: { host: '127.0.0.1', port: listenPort }, tls: { certFile: cert, keyFile: key }, publicOrigin: origin,
        oidc: { issuer: 'https://placeholder.invalid', clientId: idp.clientId, clientSecretFile: join(directory, 'client-secret'), redirectPath: '/auth/callback', scopes: ['openid', 'email'] },
        roles: rules, sessionTtlMinutes: 30, dataDirectory: join(directory, 'server'), workspace: { directory: join(directory, 'vaults'), folder: 'main', unlock: 'keychain' },
      });
      value.oidc.issuer = idp.issuer; return value;
    };
    // Each instance has its own pool, store and identity directory, as separate processes would; the engine is the one workspace writer.
    async function instance(): Promise<Instance> {
      const it = new Instance(); it.port = await freePort(); it.publicPort = publicPort; it.origin = origin; it.ca = tlsFiles.cert;
      it.store = await PostgresEnterpriseStore.connect(database);
      it.app = await createEnterpriseServer(engine, config(it.port), { allowLoopbackHttpIssuer: true, tls: tlsFiles, store: it.store, authRateLimitPerMinute: 1000 });
      await it.app.listen(); return it;
    }
    const stop = async (it: Instance) => { it.app.server.closeAllConnections(); await new Promise<void>(resolve => it.app.server.close(() => resolve())); await it.store.close(); };
    const a = await instance(), b = await instance(); later(async () => { for (const it of [a, b]) await stop(it).catch(() => {}); });
    assert.notEqual(a.app.identity, b.app.identity); assert.equal(a.app.identity.store.kind, 'postgres');

    for (const sub of ['https-race-1', 'https-race-2', 'https-race-3']) {
      const [startA, startB] = await Promise.all([a.begin(), b.begin()]);
      const grantA = idp.authorize(startA.location, claims(sub, ['readers'])), grantB = idp.authorize(startB.location, claims(sub, ['readers']));
      const [onA, onB] = await Promise.all([a.finish(grantA, startA.loginCookie), b.finish(grantB, startB.loginCookie)]);
      assert.equal(onA.reply.status, 302, JSON.stringify(onA.reply.json)); assert.equal(onB.reply.status, 302, JSON.stringify(onB.reply.json));
      const [meA, meB] = await Promise.all([a.me(onA.cookie), b.me(onB.cookie)]);
      assert.equal(meA.json.memberId, meB.json.memberId, `${sub}: both instances signed in as one member.`);
      assert.equal((await named(engine, `Synthetic ${sub}`)).length, 1, `${sub}: exactly one member provisioned.`);
      assert.deepEqual((await rows(hash(sub))).map(row => row.member_id), [meA.json.memberId]);
    }
    const before = (await rows(hash('https-race-1')))[0].member_id;
    await stop(a); await stop(b);
    const c = await instance(); later(() => stop(c));
    const again = await c.begin(); const signed = await c.finish(idp.authorize(again.location, claims('https-race-1', ['readers'])), again.loginCookie);
    assert.equal((await c.me(signed.cookie)).json.memberId, before, 'After a restart with a fresh pool, the same person is the same member.');
    assert.equal((await named(engine, 'Synthetic https-race-1')).length, 1);
    const stored = JSON.stringify(await rows());
    assert.ok(!stored.includes('https-race-1') && !stored.includes('@example.com'), 'Only subject digests are stored.');
  });
});
