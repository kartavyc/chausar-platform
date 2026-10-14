import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router } from '../../hosted/shared/http.ts';
import { check } from '../../hosted/shared/errors.ts';
import { FREE_ENTITLEMENTS, type Entitlements } from '../../hosted/shared/auth.ts';
import type { HostedDeps } from '../../hosted/shared/module.ts';
import { JobQueue, Worker } from '../../hosted/db/queue.ts';
import { createBackupModule, backupConfig, backupStore, FileBlobStore, blobKey, BACKUP_MAGIC, LAPSED_KEEP_DAYS } from '../../hosted/backup/index.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

const folders: string[] = [];
after(async () => { await closeDatabases(); for (const folder of folders) rmSync(folder, { recursive: true, force: true }); });
const pgSkip = postgresAvailable();
const folder = () => { const path = mkdtempSync(join(tmpdir(), 'chausar-backup-')); folders.push(path); return path; };

const PAID: Entitlements = { ...FREE_ENTITLEMENTS, plan: 'paid', backup: true, backupQuotaBytes: 1000, backupKeep: 2 };
const id = (n: number) => `bk_${n.toString(16).padStart(32, '0')}`;
const blob = (fill: string, size: number) => Buffer.concat([BACKUP_MAGIC, Buffer.alloc(size - BACKUP_MAGIC.length, fill)]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function setup() {
  const sql = await freshDatabase();
  let time = new Date('2026-10-14T10:00:00Z');
  const clock = () => time;
  const plans = new Map<string, Entitlements>([['acct_a', PAID], ['acct_b', PAID]]);
  const queue = new JobQueue(sql, clock);
  const deps: HostedDeps = {
    sql, clock, queue, fetch: async () => { throw new Error('no network in tests'); }, pepper: 'p'.repeat(32), linkOrigin: 'https://link.chausar.test',
    authenticate: async request => { const accountId = request.headers['x-test-account']; check(accountId, 'UNAUTHENTICATED', 'Sign in first.', 401); return { accountId, deviceId: 'dev_a', sessionId: 'ses_a' }; },
    entitlements: async accountId => plans.get(accountId) ?? FREE_ENTITLEMENTS,
  };
  const directory = folder();
  const module = createBackupModule(deps, { store: new FileBlobStore(directory) });
  const router = new Router(); module.routes(router);
  const worker = new Worker(queue); module.jobs!(worker);
  const put = (account: string, backupId: string, body: Buffer, digest = sha(body), type = 'application/octet-stream') =>
    router.handle({ method: 'PUT', url: `/v1/backups/${backupId}`, headers: { 'x-test-account': account, 'content-type': type, 'x-chausar-sha256': digest }, body });
  const call = (method: string, url: string, account = 'acct_a') => router.handle({ method, url, headers: { 'x-test-account': account } });
  return { sql, module, router, worker, plans, directory, put, call, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
const code = (reply: { body?: unknown }) => (reply.body as any)?.error?.code;

test('backup config and the missing store refuse plainly', async () => {
  assert.deepEqual(backupConfig({}), { directory: null });
  assert.equal(backupStore(backupConfig({ BACKUP_DIRECTORY: '  ' })), null);
  assert.ok(backupStore(backupConfig({ BACKUP_DIRECTORY: '/var/lib/chausar/backups' })) instanceof FileBlobStore);
  const deps = { authenticate: async () => ({ accountId: 'acct_a', deviceId: 'd', sessionId: 's' }), entitlements: async () => PAID } as unknown as HostedDeps;
  const router = new Router(); createBackupModule(deps, { store: null }).routes(router);
  const body = blob('x', 32);
  const reply = await router.handle({ method: 'PUT', url: `/v1/backups/${id(1)}`, headers: { 'content-type': 'application/octet-stream', 'x-chausar-sha256': sha(body) }, body });
  assert.equal(reply.status, 503); assert.equal(code(reply), 'BLOB_STORE_NOT_CONFIGURED');
});

test('the file store refuses keys that could leave their folder', async () => {
  const directory = folder(), store = new FileBlobStore(directory);
  for (const key of [`../${id(1)}`, `acct_a/../${id(1)}`, `acct_a/${id(1)}/x`, `..`, `acct_a/..`, `./${id(1)}`, `acct_a/bk_../../etc`, `/etc/${id(1)}`, `acct a/${id(1)}`])
    await assert.rejects(store.put(key, Buffer.from('x')), { code: 'BLOB_KEY_INVALID' }, key);
  assert.throws(() => blobKey('..', id(1)), { code: 'BLOB_KEY_INVALID' });
  const bytes = blob('z', 64);
  assert.deepEqual(await store.put(blobKey('acct_a', id(1)), (async function* () { yield bytes.subarray(0, 10); yield bytes.subarray(10); })()), { sizeBytes: 64, sha256: sha(bytes) });
  assert.deepEqual(await store.get(`acct_a/${id(1)}`), bytes);
  assert.deepEqual(readdirSync(join(directory, 'acct_a')), [id(1)], 'no temporary file is left behind');
  await store.delete(`acct_a/${id(1)}`); await store.delete(`acct_a/${id(1)}`);
  assert.equal(await store.get(`acct_a/${id(1)}`), undefined);
});

test('backup upload, list, download and delete; the server keeps only ciphertext metadata', { skip: pgSkip }, async () => {
  const { put, call, directory, sql } = await setup();
  const body = blob('a', 300);
  const created = await put('acct_a', id(1), body);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { backupId: id(1), sizeBytes: 300, sha256: sha(body), createdAt: '2026-10-14T10:00:00.000Z' });
  assert.ok(existsSync(join(directory, 'acct_a', id(1))));
  const listed = await call('GET', '/v1/backups');
  assert.deepEqual(listed.body, { backups: [{ backupId: id(1), sizeBytes: 300, sha256: sha(body), createdAt: '2026-10-14T10:00:00.000Z' }], quotaBytes: 1000, usedBytes: 300, keep: 2 });
  const got = await call('GET', `/v1/backups/${id(1)}`);
  assert.equal(got.status, 200); assert.deepEqual(got.body, body);
  assert.deepEqual(got.headers, { 'content-type': 'application/octet-stream', 'x-chausar-sha256': sha(body) });
  const { rows: columns } = await sql.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'backups' ORDER BY ordinal_position`);
  assert.deepEqual(columns.map(c => c.column_name), ['account_id', 'backup_id', 'size_bytes', 'sha256', 'state', 'created_at'], 'no key, no plaintext');
  assert.deepEqual((await call('DELETE', `/v1/backups/${id(1)}`)).body, { backupId: id(1), deleted: true });
  assert.equal(existsSync(join(directory, 'acct_a', id(1))), false);
  assert.equal(code(await call('GET', `/v1/backups/${id(1)}`)), 'BACKUP_NOT_FOUND');
  assert.equal(code(await call('DELETE', `/v1/backups/${id(1)}`)), 'BACKUP_NOT_FOUND');
  assert.deepEqual((await call('GET', '/v1/backups')).body, { backups: [], quotaBytes: 1000, usedBytes: 0, keep: 2 });
});

test('backup refuses a changed body, a foreign format, a full quota, a reused id and a free plan', { skip: pgSkip }, async () => {
  const { put, call, plans } = await setup();
  const body = blob('b', 400);
  const mismatch = await put('acct_a', id(2), body, sha(blob('c', 400)));
  assert.equal(mismatch.status, 400); assert.equal(code(mismatch), 'BACKUP_DIGEST_MISMATCH');
  assert.equal(code(await put('acct_a', id(2), body, 'nothex')), 'INVALID_REQUEST');
  const plain = Buffer.from('SQLite format 3\0 and then the books');
  assert.equal(code(await put('acct_a', id(2), plain)), 'BACKUP_FORMAT_INVALID');
  assert.equal(code(await put('acct_a', id(2), BACKUP_MAGIC)), 'BACKUP_FORMAT_INVALID', 'the marker alone is not a backup');
  assert.equal((await put('acct_a', id(2), body, sha(body), 'application/json')).status, 415);
  assert.equal((await put('acct_a', id(2), body)).status, 201);
  const again = await put('acct_a', id(2), body);
  assert.equal(again.status, 409); assert.equal(code(again), 'BACKUP_EXISTS');
  assert.equal((await put('acct_a', id(3), blob('d', 600))).status, 201, '400 + 600 fills the 1000 bytes exactly');
  const full = await put('acct_a', id(4), blob('e', 9));
  assert.equal(full.status, 413); assert.equal(code(full), 'BACKUP_QUOTA_EXCEEDED');
  assert.equal(code(await put('acct_a', id(5), blob('e', 1001))), 'BACKUP_QUOTA_EXCEEDED');
  assert.equal(((await call('GET', '/v1/backups')).body as any).usedBytes, 1000);
  plans.set('acct_a', FREE_ENTITLEMENTS);
  const free = await put('acct_a', id(6), blob('f', 20));
  assert.equal(free.status, 402); assert.equal(code(free), 'PLAN_REQUIRED');
  assert.equal((await call('GET', `/v1/backups/${id(2)}`)).status, 200, 'a lapsed plan can still take its backups home');
});

test('concurrent uploads cannot overrun the quota together', { skip: pgSkip }, async () => {
  const { put, call } = await setup();
  const replies = await Promise.all([1, 2, 3, 4, 5].map(n => put('acct_a', id(10 + n), blob(String(n), 300))));
  assert.deepEqual(replies.map(r => r.status).sort(), [201, 201, 201, 413, 413]);
  assert.equal(((await call('GET', '/v1/backups')).body as any).usedBytes, 900);
});

test('path tricks and other accounts get nothing', { skip: pgSkip }, async () => {
  const { put, call, router, plans } = await setup();
  plans.set('../acct_a', PAID);
  const body = blob('s', 50);
  assert.equal((await put('acct_a', id(7), body)).status, 201);
  for (const url of ['/v1/backups/..', `/v1/backups/x/../../${id(7)}`]) assert.equal((await call('GET', url)).status, 404, `${url} is normalised away before routing`);
  for (const url of ['/v1/backups/...', '/v1/backups/bk_..', `/v1/backups/${id(7)}.tmp`, '/v1/backups/BK_00000000000000000000000000000007'])
    assert.equal(code(await call('GET', url)), 'BACKUP_ID_INVALID', url);
  assert.equal((await call('GET', '/v1/backups/%2e%2e%2fetc')).status, 404, 'an encoded slash never reaches a handler');
  const traversal = await router.handle({ method: 'PUT', url: `/v1/backups/${id(8)}`, headers: { 'x-test-account': '../acct_a', 'content-type': 'application/octet-stream', 'x-chausar-sha256': sha(body) }, body });
  assert.equal(code(traversal), 'BLOB_KEY_INVALID', 'an account id is checked before it becomes a path');
  const other = await call('GET', `/v1/backups/${id(7)}`, 'acct_b');
  assert.equal(other.status, 404); assert.equal(code(other), 'BACKUP_NOT_FOUND');
  assert.equal((await call('DELETE', `/v1/backups/${id(7)}`, 'acct_b')).status, 404);
  assert.deepEqual(((await call('GET', '/v1/backups', 'acct_b')).body as any).backups, []);
  assert.equal((await put('acct_b', id(7), blob('t', 50))).status, 201, 'ids are per account');
  assert.deepEqual((await call('GET', `/v1/backups/${id(7)}`)).body, body, 'the first account still reads its own bytes');
  assert.equal((await call('GET', '/v1/backups', '')).status, 401);
});

test('prune keeps the newest versions, and a lapsed plan keeps everything for thirty days', { skip: pgSkip }, async () => {
  const { put, call, worker, module, plans, advance, directory } = await setup();
  for (const n of [1, 2, 3]) { assert.equal((await put('acct_a', id(n), blob(String(n), 100))).status, 201); advance(60000); }
  assert.deepEqual(await worker.runOnce(), { done: 3, retried: 0, dead: 0 }, 'one prune per upload');
  assert.deepEqual(((await call('GET', '/v1/backups')).body as any).backups.map((b: any) => b.backupId), [id(3), id(2)]);
  assert.equal(existsSync(join(directory, 'acct_a', id(1))), false);
  await module.sweep!(); await module.sweep!();
  assert.deepEqual(await worker.runOnce(), { done: 1, retried: 0, dead: 0 }, 'one sweep prune per hour');
  plans.set('acct_a', { ...FREE_ENTITLEMENTS });
  advance(3600000); await module.sweep!(); await worker.runOnce();
  assert.equal(((await call('GET', '/v1/backups')).body as any).backups.length, 2, 'kept while lapsed');
  advance((LAPSED_KEEP_DAYS - 1) * 86400000); await module.sweep!(); await worker.runOnce();
  assert.equal(((await call('GET', '/v1/backups')).body as any).backups.length, 2, 'still kept on day twenty-nine');
  advance(86400000); await module.sweep!(); await worker.runOnce();
  assert.deepEqual(((await call('GET', '/v1/backups')).body as any).backups, [], 'removed after thirty days');
  assert.deepEqual(readdirSync(join(directory, 'acct_a')), []);
});
