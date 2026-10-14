import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, realpath, writeFile, utimes, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataGuard } from '../runtime/native/update-data-guard.ts';

const code = (expected:string) => (error:any) => error.code === expected;
const hash = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t:any) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-data-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('{"backupFormat":"synthetic fixture"}'), backupPath = join(root, 'backup.json'); await writeFile(backupPath, bytes);
  return { root, guard: new DataGuard({ appDataDirectory: join(root, 'app-data') }), backup: { path: backupPath, sha256: hash(bytes) } };
}

test('an older app refuses a vault whose marker records a newer data schema', async t => {
  const { root, guard } = await fixture(t);
  assert.equal(await guard.assertAppCanOpen(1), null);
  await guard.recordSchema(3, '1.4.0');
  assert.equal((await guard.assertAppCanOpen(3))?.dataSchemaVersion, 3);
  await guard.assertAppCanOpen(4);
  await assert.rejects(guard.assertAppCanOpen(2), code('VAULT_NEWER_THAN_APP'));
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(root, 'app-data', 'release', 'data-schema.json'), 'utf8'))).sort(), ['at', 'dataSchemaVersion', 'writtenBy']);
});

test('the schema marker is written atomically and is never lowered', async t => {
  const { guard } = await fixture(t);
  await guard.recordSchema(2, '1.1.0');
  assert.equal((await guard.recordSchema(2, '1.2.0')).writtenBy, '1.1.0');
  await assert.rejects(guard.recordSchema(1, '1.0.0'), code('SCHEMA_DOWNGRADE_REFUSED'));
  assert.equal((await guard.marker())?.dataSchemaVersion, 2);
  await guard.recordSchema(5, '2.0.0');
  assert.equal((await guard.marker())?.writtenBy, '2.0.0');
});

test('a corrupt marker refuses rather than letting any app open the vault', async t => {
  const { root, guard } = await fixture(t);
  await mkdir(join(root, 'app-data', 'release'), { recursive: true });
  await writeFile(join(root, 'app-data', 'release', 'data-schema.json'), '{"dataSchemaVersion":"9"}');
  await assert.rejects(guard.assertAppCanOpen(1), code('DATA_SCHEMA_MARKER_INVALID'));
});

test('a schema bump without a backup refuses; a correct fresh backup passes; a changed or stale one refuses', async t => {
  const { guard, backup } = await fixture(t);
  assert.equal((await guard.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 1 })).backupRequired, false);
  await assert.rejects(guard.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2 }), code('BACKUP_REQUIRED'));
  await assert.rejects(guard.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2, backup: { path: backup.path + '.missing', sha256: backup.sha256 } }), code('BACKUP_REQUIRED'));
  const ok = await guard.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2, backup });
  assert.equal(ok.backupRequired, true); assert.equal(ok.backup?.sha256, backup.sha256);
  await assert.rejects(guard.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2, backup: { path: backup.path, sha256: 'f'.repeat(64) } }), code('BACKUP_REQUIRED'));
  await writeFile(backup.path, '{"backupFormat":"changed"}');
  await assert.rejects(guard.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2, backup }), code('BACKUP_REQUIRED'));
  await assert.rejects(guard.requireBackupBeforeSchemaChange({ fromSchema: 2, toSchema: 1, backup }), code('SCHEMA_DOWNGRADE_REFUSED'));
});

test('a backup older than one hour refuses, judged by an injected clock', async t => {
  const { root, backup } = await fixture(t), now = Date.now();
  const late = new DataGuard({ appDataDirectory: join(root, 'app-data'), now: () => now + 2 * 3600000 });
  await assert.rejects(late.requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2, backup }), code('BACKUP_REQUIRED'));
  const old = new Date(now - 2 * 3600000); await utimes(backup.path, old, old);
  await assert.rejects(new DataGuard({ appDataDirectory: join(root, 'app-data') }).requireBackupBeforeSchemaChange({ fromSchema: 1, toSchema: 2, backup }), code('BACKUP_REQUIRED'));
});
