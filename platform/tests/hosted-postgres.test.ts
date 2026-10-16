// Hosted tier on PostgreSQL: the sealed directory in one row with compare and set, business vaults in rows whose slots
// come from the tenant and business ids, the settings that turn it on, and two hosted servers sharing one database.
// The stand-in (hosted-postgres-standin.ts) answers the exact statements and needs no database. The checks against a
// real PostgreSQL server are a separate qualification run (qualification/hosted-postgres-real.test.ts), outside the
// open suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import { loopbackPostgresUrl } from '../runtime/postgres.ts';
import { AccountService } from '../runtime/hosted/accounts.ts';
import { HostedApp } from '../runtime/hosted/app.ts';
import { hostedConfig } from '../runtime/hosted/config.ts';
import { HostedCustody, newBusinessId, newTenantId } from '../runtime/hosted/custody.ts';
import { DIRECTORY_SQL, PostgresDirectory, prepareHostedTables, type DirectoryState, type HostedUser } from '../runtime/hosted/directory.ts';
import { DEFAULT_LIMITS } from '../runtime/hosted/limits.ts';
import { DevOutbox } from '../runtime/hosted/mailer.ts';
import { BusinessEngine, hostedVaultSlot } from '../runtime/hosted/runtime/business.ts';
import type { ActorKey } from '../runtime/hosted/runtime/contract.ts';
import { createHostedServer } from '../runtime/hosted/server.ts';
import type { ModelTransport } from '../runtime/venture/contracts.ts';
import { createPostgresStandIn } from './hosted-postgres-standin.ts';

const rp = { id: 'localhost', name: 'Chausar', origin: 'http://localhost:4398' };
const HOST = 'localhost:4398';
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };
const binding = () => randomBytes(32).toString('base64url');
const custodyKey = () => randomBytes(32).toString('base64url');
const noNetwork: ModelTransport = {
  replay: false,
  async http() { throw new ChausarError('MODEL_FAILED', 'No network in tests.'); },
  async process() { throw new ChausarError('MODEL_FAILED', 'No processes in tests.'); },
};
const engineOptions = () => ({ demo: true, storage: 'postgres' as const, venture: { host: 'hosted-web' as const, modelTransport: noNetwork } });
const user = (id: string): HostedUser => ({ id, tenantId: newTenantId(), email: `${id}@example.com`, userHandle: id, createdAt: 'x', verifiedAt: 'x', status: 'active', passkeys: [], businesses: [] });
const ids = (state: DirectoryState) => state.users.map(item => item.id);

async function folder(t: any, label: string) {
  const path = await mkdtemp(join(tmpdir(), `chausar-hosted-pg-${label}-`));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

// ---------------------------------------------------------------------------------------------------------------------
// The directory's compare and set, on the stand-in
// ---------------------------------------------------------------------------------------------------------------------

test('two servers change the directory at once and neither change is lost', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey());
  const a = await PostgresDirectory.open(db.pool, custody), b = await PostgresDirectory.open(db.pool, custody);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let runs = 0;
  const slow = a.update(async state => { runs++; state.users.push(user('huser_a')); await gate; return runs; });
  await new Promise(resolve => setImmediate(resolve));
  await b.update(state => { state.users.push(user('huser_b')); });
  release();
  assert.equal(await slow, 2, 'the change ran again on what the other server wrote');
  assert.equal(db.conflicts, 1);
  assert.deepEqual(ids(a.read()), ['huser_b', 'huser_a']);
  assert.equal(a.read().revision, 2);
  assert.equal(db.directoryRows.get('main')!.revision, 2);
  assert.deepEqual(ids(b.read()), ['huser_b'], 'read() answers from what this server last saw');
  await b.refresh();
  assert.deepEqual(ids(b.read()), ['huser_b', 'huser_a']);
  assert.equal(JSON.stringify([...db.directoryRows.values()]).includes('huser_a@example.com'), false, 'only the sealed value is stored');
});

test('a sign-in link works once, even when two servers take it at the same moment', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey()), outbox = new DevOutbox();
  const service = async () => new AccountService({ directory: await PostgresDirectory.open(db.pool, custody), custody, mailer: outbox, rp, limits: DEFAULT_LIMITS });
  const a = await service(), b = await service();
  const browser = { binding: binding(), address: '203.0.113.5' };
  await a.requestMagicLink({ email: 'owner@example.com' }, browser);
  const token = new URL(outbox.latest('owner@example.com')!.link).hash.replace('#signin=', '');
  const results = await Promise.allSettled([a.verifyMagicLink({ token }, browser), b.verifyMagicLink({ token }, browser)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const refused = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(refused.reason.code, 'MAGIC_LINK_INVALID');
  assert.ok(db.conflicts >= 1, 'both servers really raced for the same row');
  await a.directory.refresh!();
  assert.equal(a.directory.read().sessions.length, 1);
  assert.equal(a.directory.read().users.length, 1);
});

test('a session made on one server is seen by another once it catches up, and so is signing out', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey()), outbox = new DevOutbox();
  const service = async () => new AccountService({ directory: await PostgresDirectory.open(db.pool, custody), custody, mailer: outbox, rp, limits: DEFAULT_LIMITS });
  const a = await service(), b = await service();
  const browser = { binding: binding(), address: '203.0.113.5' };
  await a.requestMagicLink({ email: 'owner@example.com' }, browser);
  const signed = await a.verifyMagicLink({ token: new URL(outbox.latest('owner@example.com')!.link).hash.replace('#signin=', '') }, browser);
  assert.throws(() => b.authenticate(signed.token), code('UNAUTHENTICATED'), 'before catching up');
  await b.directory.refresh!();
  const auth = b.authenticate(signed.token);
  assert.equal(auth.user.email, 'owner@example.com');
  await b.signOut(auth);
  assert.equal(a.authenticate(signed.token).user.email, 'owner@example.com', 'still the old view');
  await a.directory.refresh!();
  assert.throws(() => a.authenticate(signed.token), code('UNAUTHENTICATED'));
});

test('a change that keeps losing gives up after its attempts and writes nothing', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey());
  const a = await PostgresDirectory.open(db.pool, custody, { maxAttempts: 3 }), b = await PostgresDirectory.open(db.pool, custody);
  await b.update(state => { state.users.push(user('huser_first')); });
  let inside = false, n = 0;
  db.before = async sql => {
    if (inside || (sql !== DIRECTORY_SQL.swap && sql !== DIRECTORY_SQL.insert)) return;
    inside = true;
    try { await b.update(state => { state.users.push(user(`huser_b${n++}`)); }); } finally { inside = false; }
  };
  let runs = 0;
  await assert.rejects(a.update(state => { runs++; state.users.push(user('huser_a')); }), code('HOSTED_BUSY'));
  db.before = null;
  assert.equal(runs, 3);
  await a.refresh();
  assert.equal(ids(a.read()).includes('huser_a'), false, 'nothing of the losing change was written');
  assert.deepEqual(ids(a.read()), ['huser_first', 'huser_b0', 'huser_b1', 'huser_b2']);
  await assert.rejects(a.update(() => { throw new ChausarError('NOPE', 'A failed change.'); }), code('NOPE'));
  assert.equal(db.directoryRows.get('main')!.revision, 4, 'a failed change commits nothing');
});

test('a damaged, foreign or rolled back directory row is refused', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey());
  const a = await PostgresDirectory.open(db.pool, custody);
  await a.update(state => { state.users.push(user('huser_1')); });
  const first = structuredClone(db.directoryRows.get('main')!);
  await a.update(state => { state.users.push(user('huser_2')); });
  await assert.rejects(PostgresDirectory.open(db.pool, HostedCustody.fromKey(custodyKey())), code('CUSTODY_KEY_MISMATCH'));

  // Someone puts back an older copy while the server runs.
  db.directoryRows.set('main', first);
  await assert.rejects(a.refresh(), code('HOSTED_DIRECTORY_INVALID'));
  await assert.rejects(a.update(state => { state.users.push(user('huser_3')); }), code('HOSTED_DIRECTORY_INVALID'));
  // An old sealed value under a newer revision number.
  db.directoryRows.set('main', { revision: 7, sealed: first.sealed });
  await assert.rejects(PostgresDirectory.open(db.pool, custody), code('HOSTED_DIRECTORY_INVALID'));
  db.directoryRows.set('main', { revision: 1, sealed: 'not a sealed value' });
  await assert.rejects(PostgresDirectory.open(db.pool, custody), code('HOSTED_DIRECTORY_INVALID'));
});

test('the directory says so when the database is out of reach, and carries on when it is back', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey());
  const a = await PostgresDirectory.open(db.pool, custody);
  await a.update(state => { state.users.push(user('huser_1')); });
  db.failWith = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
  await assert.rejects(a.refresh(), code('HOSTED_STORAGE_UNAVAILABLE'));
  await assert.rejects(a.update(state => { state.users.push(user('huser_2')); }), code('HOSTED_STORAGE_UNAVAILABLE'));
  await assert.rejects(PostgresDirectory.open(db.pool, custody), code('HOSTED_STORAGE_UNAVAILABLE'));
  assert.deepEqual(ids(a.read()), ['huser_1']);
  db.failWith = null;
  await a.update(state => { state.users.push(user('huser_2')); });
  assert.deepEqual(ids(a.read()), ['huser_1', 'huser_2']);
});

test('slots keep deployments apart, and close ends the pool only when asked', async () => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey());
  const one = await PostgresDirectory.open(db.pool, custody, { slot: 'one' }), two = await PostgresDirectory.open(db.pool, custody, { slot: 'two' });
  await one.update(state => { state.users.push(user('huser_one')); });
  await two.refresh();
  assert.equal(two.read().users.length, 0);
  assert.deepEqual([...db.directoryRows.keys()], ['one']);
  await assert.rejects(PostgresDirectory.open(db.pool, custody, { slot: '../main' }), code('INVALID_SLOT'));
  await assert.rejects(PostgresDirectory.open(db.pool, custody, { maxAttempts: 0 }), code('INVALID_LIMIT'));
  await two.close();
  assert.equal(db.ended, false);
  await assert.rejects(two.update(() => {}), code('HOSTED_STOPPING'));
  const owner = await PostgresDirectory.open(db.pool, custody, { slot: 'one', endPoolOnClose: true });
  assert.deepEqual(ids(owner.read()), ['huser_one']);
  await owner.close();
  assert.equal(db.ended, true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------------

test('PostgreSQL storage is accepted for a database on this computer only', () => {
  const on = (env: Record<string, string>) => hostedConfig({ CHAUSAR_HOSTED: '1', ...env }, ['--dev']);
  const refused = (env: Record<string, string>) => assert.throws(() => on(env), code('HOSTED_CONFIG_INVALID'), JSON.stringify(env));
  const pg = on({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://chausar:p%40ss@127.0.0.1:6432/chausar_hosted' });
  assert.equal(pg.storage, 'postgres');
  assert.deepEqual(pg.postgres, { host: '127.0.0.1', port: 6432, user: 'chausar', password: 'p@ss', database: 'chausar_hosted', maxConnections: 10 });
  assert.equal(on({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgresql://u:p@[::1]/d' }).postgres!.host, '::1');
  assert.deepEqual([on({}).storage, on({}).postgres], ['experimental-file', null]);
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://u:p@db.example.com:5432/d' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://u:p@localhost:5432/d' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://u:p@127.0.0.1:5432/d?sslmode=disable' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://u@127.0.0.1:5432/d' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'mysql://u:p@127.0.0.1:3306/d' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres', CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://u:p@127.0.0.1:80/d' });
  refused({ CHAUSAR_HOSTED_POSTGRES_URL: 'postgres://u:p@127.0.0.1:5432/d' });
  refused({ CHAUSAR_HOSTED_STORAGE: 'sqlite' });
  assert.throws(() => loopbackPostgresUrl('not a url'), code('INVALID_POSTGRES_CONFIG'));
});

test('each business vault has its own slot, made from its ids alone', () => {
  const tenant = newTenantId(), business = newBusinessId();
  const slot = hostedVaultSlot([tenant, business]);
  assert.equal(slot, `hosted.${tenant}.${business}`);
  assert.match(slot, /^[A-Za-z0-9_.-]{1,100}$/, 'the vault adapter accepts it');
  assert.notEqual(hostedVaultSlot([tenant, newBusinessId()]), slot);
  assert.notEqual(hostedVaultSlot([newTenantId(), business]), slot);
  assert.throws(() => hostedVaultSlot(['../x', business] as any), code('INVALID_ACTOR_KEY'));
  assert.throws(() => hostedVaultSlot([tenant, 'b_short'] as any), code('INVALID_ACTOR_KEY'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Business vaults on the stand-in
// ---------------------------------------------------------------------------------------------------------------------

test('a business vault is one row, opens on another server, and the second writer is refused rather than lost', async t => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey());
  await prepareHostedTables(db.pool);
  const rootA = await folder(t, 'a'), rootB = await folder(t, 'b');
  const key: ActorKey = [newTenantId(), newBusinessId()];
  const passphrase = custody.newVaultPassphrase();
  await assert.rejects(BusinessEngine.create({ root: rootA, engineOptions: () => ({ demo: true, storage: 'experimental-file' as const }), postgres: db.pool }, key, { name: 'Mixed', passphrase }), code('HOSTED_STORAGE_INVALID'));
  await assert.rejects(BusinessEngine.create({ root: rootA, engineOptions: () => ({ ...engineOptions(), postgresUrl: 'postgres://u:p@127.0.0.1:5432/d' }), postgres: db.pool }, key, { name: 'Mixed', passphrase }), code('HOSTED_STORAGE_INVALID'));
  await assert.rejects(BusinessEngine.create({ root: rootA, engineOptions }, key, { name: 'No Pool', passphrase }), code('HOSTED_STORAGE_INVALID'));

  const { business: a } = await BusinessEngine.create({ root: rootA, engineOptions, postgres: db.pool }, key, { name: 'Ledger Cafe Books', passphrase });
  t.after(() => a.close());
  assert.deepEqual([...db.vaultRows.keys()], [hostedVaultSlot(key)]);
  assert.equal(JSON.stringify(db.vaultRows.get(hostedVaultSlot(key))).includes('Ledger Cafe Books'), false, 'only ciphertext enters PostgreSQL');
  assert.deepEqual(await readdir(join(rootA, key[0], key[1])), ['writer.lock'], 'the folder holds only the writer lock');
  const status = await a.request('workspace.status', {}) as any;
  assert.deepEqual([status.storage, status.experimental], ['postgres', true]);

  const b = await BusinessEngine.open({ root: rootB, engineOptions, postgres: db.pool }, key, passphrase);
  t.after(() => b.close());
  assert.equal((await b.request('workspace.status', {}) as any).workspace.name, 'Ledger Cafe Books', 'another server with another data folder finds the same vault');
  const made = await a.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' }) as any;
  const revision = db.vaultRows.get(hostedVaultSlot(key))!.revision;
  await assert.rejects(b.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Other Books' }), code('REVISION_CONFLICT'));
  assert.equal(db.vaultRows.get(hostedVaultSlot(key))!.revision, revision, 'the stale server wrote nothing');
  await b.close();
  const again = await BusinessEngine.open({ root: rootB, engineOptions, postgres: db.pool }, key, passphrase);
  t.after(() => again.close());
  assert.equal((await again.request('venture.get', {}) as any).venture.id, made.venture.id);

  const capabilities = await again.request('venture.capabilities', {}) as any[];
  const storage = capabilities.find(row => row.id === 'durable-storage');
  assert.equal(storage.state, 'unverified', 'PostgreSQL on the hosted server stays experimental until a real deploy is tested');
  assert.match(storage.reason, /not yet tested on a real deploy/);

  await again.close(); await a.close();
  await assert.rejects(BusinessEngine.open({ root: rootB, engineOptions, postgres: db.pool }, key, 'not the passphrase at all, wrong'), code('UNLOCK_FAILED'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Two hosted servers over real sockets, one stand-in database
// ---------------------------------------------------------------------------------------------------------------------

function client() {
  const jar = new Map<string, string>();
  let bearer: string | null = null;
  const send = (port: number, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: HOST };
    if (method === 'POST') Object.assign(headers, { Origin: rp.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' });
    if (jar.size) headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (bearer && path === '/api/rpc') headers.Authorization = `Bearer ${bearer}`;
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, res => {
      for (const line of [res.headers['set-cookie'] ?? []].flat()) {
        const [pair] = line.split(';'); const at = pair.indexOf('=');
        if (/Max-Age=0/.test(line)) jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* a page */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  return {
    send,
    async session(port: number) { const reply = await send(port, 'GET', '/api/hosted/session'); if (reply.status === 200) bearer = reply.json.token; return reply; },
    async rpc(port: number, method: string, payload: unknown = {}) {
      const reply = await send(port, 'POST', '/api/rpc', { method, payload });
      if (reply.json?.error) throw Object.assign(new Error(reply.json.error.message), { code: reply.json.error.code });
      return reply.json.result;
    },
  };
}

test('two hosted servers on one database share sign-in, and a business made on one opens on the other', async t => {
  const db = createPostgresStandIn(), custody = HostedCustody.fromKey(custodyKey()), outbox = new DevOutbox();
  const server = async (label: string) => {
    const root = await folder(t, label);
    const directory = await PostgresDirectory.open(db.pool, custody);
    const app = new HostedApp({ root, rp, directory, custody, mailer: outbox, limits: DEFAULT_LIMITS, version: '0.1.0-preview.1', modelTransport: noNetwork, githubTransport: undefined, postgres: db.pool });
    const http = createHostedServer(app, { origin: rp.origin, tls: { kind: 'none' }, trustProxy: false, maxBodyBytes: DEFAULT_LIMITS.maxBodyBytes });
    const { port } = await http.listen('127.0.0.1', 0);
    let open = true;
    const close = async () => { if (open) { open = false; await http.close(); } };
    t.after(close);
    return { root, directory, port, close };
  };
  const a = await server('a'), b = await server('b');
  const owner = client();

  assert.equal((await owner.send(a.port, 'GET', '/')).status, 200);
  assert.equal((await owner.send(a.port, 'POST', '/api/auth/magic-link', { email: 'cafe@example.com' })).status, 200);
  const token = new URL(outbox.latest('cafe@example.com')!.link).hash.replace('#signin=', '');
  assert.equal((await owner.send(a.port, 'POST', '/api/auth/magic-link/verify', { token })).status, 200);
  assert.equal((await owner.session(a.port)).status, 200);
  const created = await owner.rpc(a.port, 'workspace.create', { name: 'Ledger Cafe Books' });
  assert.match(created.recoveryCode, /^CHR-/);
  const status = await owner.rpc(a.port, 'workspace.status');
  assert.deepEqual([status.open, status.storage, status.experimental], [true, 'postgres', true]);
  const venture = await owner.rpc(a.port, 'venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });

  const tenantId = a.directory.read().users[0].tenantId;
  const slot = hostedVaultSlot([tenantId, created.businessId]);
  assert.deepEqual([[...db.directoryRows.keys()], [...db.vaultRows.keys()]], [['main'], [slot]]);
  const stored = JSON.stringify([...db.directoryRows.values(), ...db.vaultRows.values()]);
  for (const secret of ['cafe@example.com', 'Ledger Cafe Books', created.recoveryCode]) assert.equal(stored.includes(secret), false, `${secret} is not in the database in the clear`);

  // Server B loaded the directory before anyone signed in. Its next API request catches up.
  assert.equal(b.directory.read().sessions.length, 0);
  const seen = await owner.session(b.port);
  assert.equal(seen.status, 200, JSON.stringify(seen.json));
  assert.equal(seen.json.me.user.businesses[0].name, 'Ledger Cafe Books');

  // A stops; B wakes the business from its row, in its own data folder.
  await a.close();
  const woke = await owner.rpc(b.port, 'workspace.status');
  assert.deepEqual([woke.open, woke.workspace.name, woke.storage, woke.experimental], [true, 'Ledger Cafe Books', 'postgres', true]);
  assert.equal((await owner.rpc(b.port, 'venture.get')).venture.id, venture.venture.id);
  assert.deepEqual(await readdir(join(b.root, 'tenants', tenantId)), [created.businessId]);

  await owner.rpc(b.port, 'workspace.delete', { confirmation: 'Ledger Cafe Books' });
  assert.equal(db.vaultRows.size, 0, 'deleting the business deletes its row');
  await assert.rejects(stat(join(b.root, 'tenants', tenantId, created.businessId)), (error: any) => error.code === 'ENOENT');
  await b.close();
  assert.equal(db.ended, false, 'the stand-in pool belongs to the test');
});
