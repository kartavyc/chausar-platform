import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresSnapshotAdapter } from '../platform/runtime/postgres.ts';
import { Vault } from '../platform/runtime/vault.ts';

// This runner accepts a dedicated local disposable database only. It never reuses
// a product database or searches for credentials. No dependency installation occurs.
const checks = [];
let pool;
let vault;
let directory;
const record = (name) => checks.push({ name, passed: true });
try {
  assert.equal(process.env.CHAUSAR_TEST_DATABASE_DISPOSABLE, '1', 'Set CHAUSAR_TEST_DATABASE_DISPOSABLE=1 for a fresh disposable local database.');
  const url = new URL(process.env.CHAUSAR_TEST_DATABASE_URL ?? '');
  assert.equal(url.protocol, 'postgresql:', 'Use an explicit postgresql URL.');
  assert.ok(['127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'Only an isolated loopback test database is accepted.');
  assert.equal(url.pathname, '/chausar_test', 'Only the dedicated chausar_test database is accepted.');
  assert.ok(url.username && url.password, 'Explicit fixture credentials are required.');
  assert.equal(url.search, '', 'Unreviewed database URL options are refused.');
  const pg = await import('pg');
  const Pool = pg.Pool ?? pg.default?.Pool;
  pool = new Pool({ connectionString: url.href, max: 4, connectionTimeoutMillis: 3000, application_name: 'chausar-disposable-verification' });
  const existing = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(existing.rows[0].count, 0, 'Refusing a populated database; provision a fresh disposable fixture.');
  directory = await mkdtemp(join(tmpdir(), 'chausar-pg-acceptance-'));
  const adapter = await PostgresSnapshotAdapter.fromPool(pool, 'acceptance-main');
  const passphrase = 'Independent fixture passphrase 2026';
  const secretMarker = 'plaintext-canary-do-not-store';
  vault = (await Vault.create({ directory: join(directory, 'main'), passphrase, name: 'Disposable verification', storage: adapter })).vault;
  await vault.update(state => { state.workspace.name = secretMarker; });
  assert.equal(vault.read().workspace.name, secretMarker);
  record('PostgreSQL commits encrypted workspace authority');
  const raw = await pool.query('SELECT envelope::text AS raw, revision::text AS revision FROM chausar_vault_authority WHERE slot=$1', ['acceptance-main']);
  assert.equal(raw.rows[0].revision, String(vault.read().revision));
  assert.ok(!raw.rows[0].raw.includes(secretMarker), 'Application plaintext must not enter the authority table.');
  record('Stored envelope hides fixture plaintext and matches revision');
  const backup = join(directory, 'backup.chausar');
  await vault.backup(backup);
  const envelope = await adapter.load();
  const contender = await PostgresSnapshotAdapter.fromPool(pool, 'acceptance-cas');
  const races = await Promise.allSettled([contender.commit(envelope, null), contender.commit(envelope, null)]);
  assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
  const failure = races.find(result => result.status === 'rejected');
  assert.equal(failure.reason.code, 'REVISION_CONFLICT');
  await assert.rejects(() => contender.commit(envelope, null), { code: 'REVISION_CONFLICT' });
  record('Concurrent creation admits one writer and refuses stale revision');
  await vault.close(); vault = undefined;
  await assert.rejects(() => Vault.open({ directory: join(directory, 'main'), passphrase: 'Wrong independent passphrase', storage: adapter }));
  vault = await Vault.open({ directory: join(directory, 'main'), passphrase, storage: adapter });
  assert.equal(vault.read().workspace.name, secretMarker);
  record('Wrong passphrase does not damage PostgreSQL authority; reopen succeeds');
  await vault.close(); vault = undefined;
  const restoredAdapter = await PostgresSnapshotAdapter.fromPool(pool, 'acceptance-restored');
  vault = await Vault.restore({ directory: join(directory, 'restored'), backupFile: backup, passphrase, storage: restoredAdapter });
  assert.equal(vault.read().workspace.name, secretMarker);
  assert.ok(!(await readFile(backup, 'utf8')).includes(secretMarker));
  record('Encrypted backup restores into a fresh PostgreSQL slot');
  await vault.delete(); vault = undefined;
  assert.equal(await restoredAdapter.load(), null);
  record('Deletion removes PostgreSQL authority slot');
  await contender.delete(); await adapter.delete();
  await pool.query('DROP TABLE chausar_vault_authority');
  console.log(JSON.stringify({ suite: 'disposable-postgresql', passed: true, checks }, null, 2));
} catch (error) {
  // Never print connection URLs, credentials or raw database errors.
  const reason = error?.code === 'ERR_MODULE_NOT_FOUND' ? 'Pinned pg dependency is unavailable.'
    : !process.env.CHAUSAR_TEST_DATABASE_DISPOSABLE ? 'Disposable PostgreSQL was not configured; integration was not executed.'
    : error?.code === 'ECONNREFUSED' ? 'Disposable PostgreSQL was unavailable.'
    : error?.code ?? 'POSTGRES_VERIFICATION_FAILED';
  console.error(JSON.stringify({ suite: 'disposable-postgresql', passed: false, checks, reason }, null, 2));
  process.exitCode = 1;
} finally {
  await vault?.close().catch(() => {});
  await pool?.end().catch(() => {});
  if (directory) await rm(directory, { recursive: true, force: true });
}
