import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { authorize, ChausarError, hash, type Context } from '../runtime/contracts.ts';
import { PostgresSnapshotAdapter, type PostgresPool, type PostgresQueryResult } from '../runtime/postgres.ts';
import { Vault, type VaultEnvelope } from '../runtime/vault.ts';
import { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { WorkspaceInterchangeLocalCustody } from '../runtime/workspace-interchange-local.ts';

// Production capability fixture with injected SQL protocol only. Actual Vault,
// adapter, native custody class and local interchange implementation are used.
// No PostgreSQL server lock or cross-process qualification is claimed.
type Row = { creation_id: string; revision: number; envelope: VaultEnvelope };
function protocolFixture() {
  let rows = new Map<string, Row>(), nextClient = 0;
  const events: string[] = [], active = new Set<number>();
  const equalEnvelope = (a: VaultEnvelope, b: VaultEnvelope) => JSON.stringify(a) === JSON.stringify(b);
  const pool: PostgresPool = {
    async query(sql) {
      assert.match(sql, /to_regclass/);
      return { rows: [{ authority_table: true, storage_table: true, custody_table: true, creation_column: true }] };
    },
    async connect() {
      const client = ++nextClient; let transaction: Map<string, Row> | undefined, locked = false, dirty = false;
      return { async query(raw, values = []): Promise<PostgresQueryResult> {
        const sql = raw.replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN') {
          assert.equal(transaction, undefined); transaction = structuredClone(rows); active.add(client);
          events.push(`BEGIN:${client}`); return { rows: [], command: 'BEGIN' };
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (transaction) { if (sql === 'COMMIT' && dirty) rows = structuredClone(transaction); transaction = undefined; }
          locked = false; active.delete(client); events.push(`${sql}:${client}`); return { rows: [], command: sql };
        }
        assert.ok(transaction);
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) { locked = true; events.push(`LOCK:${client}`); return { rows: [] }; }
        assert.equal(locked, true, 'Authority/custody queries require the owned injected SQL transaction.');
        if (/^SELECT .*FROM public\.chausar_workspace_postgres_storage/.test(sql)) {
          events.push(`META:${client}`); return { rows: [{ storage_id: 'injected-interchange-generation', database: 'injected_interchange',
            database_oid: '17021', server_address: '127.0.0.1', server_port: 15432 }] };
        }
        if (/^SELECT .*FROM public\.chausar_workspace_postgres_custody/.test(sql)) {
          events.push(`ADMISSION:${client}`); return { rows: [] }; // Actual ordinary source has no target publication row.
        }
        const slot = String(values[0]);
        if (sql === 'SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE') {
          events.push(`AUTH:${client}`); const row = transaction.get(slot);
          return { rows: row ? [{ ...structuredClone(row), revision: String(row.revision) }] : [] };
        }
        if (sql.startsWith('INSERT INTO public.chausar_vault_authority ')) {
          assert.equal(transaction.has(slot), false);
          const envelope = JSON.parse(String(values[2])) as VaultEnvelope; assert.equal(envelope.revision, values[1]);
          transaction.set(slot, { creation_id: randomUUID(), revision: envelope.revision, envelope });
          dirty = true; events.push(`INSERT:${client}`); return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE public.chausar_vault_authority ')) {
          const row = transaction.get(slot), expected = JSON.parse(String(values[6])) as VaultEnvelope;
          if (!row || row.revision !== values[3] || row.creation_id !== values[4]
            || row.envelope.id !== values[5] || !equalEnvelope(row.envelope, expected)) return { rows: [], rowCount: 0 };
          const envelope = JSON.parse(String(values[2])) as VaultEnvelope; assert.equal(envelope.revision, values[1]);
          row.revision = envelope.revision; row.envelope = envelope; dirty = true; events.push(`UPDATE:${client}`);
          return { rows: [], rowCount: 1 };
        }
        throw new ChausarError('TEST_SQL_UNSUPPORTED', 'An unmodelled SQL query cannot pass this source fixture.');
      }, release() {
        assert.equal(transaction, undefined); assert.equal(locked, false); assert.equal(active.has(client), false);
        events.push(`RELEASE:${client}`);
      } };
    }, async end() {}
  };
  return { pool, events, activeCount: () => active.size, authority: (slot: string) => structuredClone(rows.get(slot)) };
}
function signal() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release };
}
const credential = 'Public synthetic interchange source fence credential';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

test('injected SQL interchange: Vault queue precedes native source capture and the native lease covers awaited work and final local/native refusal guards',
  { timeout: 10_000 }, async t => {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:[\\/]/i, 'Canonical C-drive scratch is required before fixture creation.');
  const root = await realpath(await mkdtemp(join(parent, 'chausar-pg-interchange-fence-'))), vaults = new Set<Vault>();
  const priorEntered = signal(), releasePrior = signal(), sourceEntered = signal(), releaseSource = signal();
  const operations: Promise<unknown>[] = [];
  t.after(async () => {
    releasePrior.release(); releaseSource.release(); await Promise.allSettled(operations);
    for (const vault of vaults) await vault.close();
    const actual = await realpath(root), child = relative(parent, actual);
    assert.equal(dirname(actual), parent);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-pg-interchange-fence-'));
    await rm(actual, { recursive: true, force: true });
  });
  const sql = protocolFixture(), directory = join(root, 'source'), adapter = await PostgresSnapshotAdapter.fromPool(sql.pool, hash(directory));
  const source = (await Vault.create({ directory, storage: adapter, passphrase: credential, name: 'Synthetic local interchange source', demo: true })).vault;
  vaults.add(source); const member = source.read().members[0];
  const context: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  let ready = true, workReturned = false, finalRefusalHeld = false, queuedWriterStarted = false;
  const guards: { afterWork: boolean; nativeHeld: boolean }[] = [];
  const local = new WorkspaceInterchangeLocalCustody({ vault: source, applicationDirectory: root, qualification: 'test-fixture',
    async assertCompleteOwner(current) {
      authorize(source, current, 'admin'); guards.push({ afterWork: workReturned, nativeHeld: adapter.hasActiveLease });
      sql.events.push(`OWNER_GUARD:${workReturned ? 'after' : 'before'}`);
      assert.equal(adapter.hasActiveLease, true, 'Every initial and final owner/readiness check runs under the actual adapter lease.');
      if (!ready) { finalRefusalHeld = adapter.hasActiveLease; throw new ChausarError('TEST_SOURCE_READINESS_REVOKED', 'Injected readiness withdrawn during awaited export work.'); }
    } });
  const native = new WorkspacePostgresCustody({ adapter }); local.installPostgresSourceCustody(native);
  assert.throws(() => local.installPostgresSourceCustody(native), code('POSTGRES_WORKSPACE_ROOT_REQUIRED'));
  sql.events.length = 0;
  const prior = source.update(async state => { priorEntered.release(); await releasePrior.promise; state.activity.push({ marker: 'prior_queue_commit' }); });
  operations.push(prior); await priorEntered.promise;
  const pending = local.ports.withSource(context, null, async lease => {
    assert.equal(lease.state.revision, 1); assert.equal(lease.state.activity[0].marker, 'prior_queue_commit');
    assert.equal(adapter.hasActiveLease, true);
    const encrypted = await source.captureEncryptedCustody({ maxArtifacts: 32, maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000 });
    assert.equal(encrypted.vaultId, source.vaultId); assert.deepEqual(encrypted.state, lease.state);
    sourceEntered.release(); await releaseSource.promise; workReturned = true; sql.events.push('WORK_RETURNED');
    return 'private_result_must_not_escape_a_revoked_final_guard';
  }); operations.push(pending);
  await nextTurn();
  assert.equal(sql.activeCount(), 0, 'Queued source capture cannot acquire native custody ahead of the existing Vault writer.');
  assert.equal(sql.events.length, 0);
  releasePrior.release(); await prior;
  await Promise.race([sourceEntered.promise, pending.then(() => { throw new Error('Source work returned before its held callback was admitted.'); })]);
  const queued = source.update(state => { queuedWriterStarted = true; state.activity.push({ marker: 'following_queue_commit' }); });
  operations.push(queued); await nextTurn();
  assert.equal(queuedWriterStarted, false); assert.equal(sql.activeCount(), 1);
  ready = false; releaseSource.release();
  await assert.rejects(pending, code('TEST_SOURCE_READINESS_REVOKED'));
  assert.equal(finalRefusalHeld, true); assert.ok(guards.some(guard => guard.afterWork && guard.nativeHeld));
  await queued; assert.equal(source.read().revision, 2); assert.equal(queuedWriterStarted, true);
  const refusal = sql.events.lastIndexOf('OWNER_GUARD:after');
  const rollback = sql.events.findIndex((event, i) => i > refusal && event.startsWith('ROLLBACK:'));
  const released = sql.events.findIndex((event, i) => i > rollback && event.startsWith('RELEASE:'));
  const nextWrite = sql.events.findIndex((event, i) => i > released && event.startsWith('UPDATE:'));
  assert.ok(refusal >= 0 && rollback > refusal && released > rollback && nextWrite > released);

  ready = true; workReturned = false; guards.length = 0; sql.events.length = 0;
  const before = sql.authority(adapter.slot);
  const result = await local.ports.withSource(context, null, async lease => {
    assert.equal(adapter.hasActiveLease, true); assert.equal(lease.state.revision, 2);
    await nextTurn(); workReturned = true; sql.events.push('WORK_RETURNED'); return { qualification: 'injected-protocol-only' };
  });
  assert.deepEqual(result, { qualification: 'injected-protocol-only' }); assert.deepEqual(sql.authority(adapter.slot), before);
  const finalGuard = sql.events.lastIndexOf('OWNER_GUARD:after'), finalMetadata = sql.events.findIndex((event, i) => i > finalGuard && event.startsWith('META:'));
  const commit = sql.events.findIndex((event, i) => i > finalMetadata && event.startsWith('COMMIT:'));
  assert.ok(finalGuard >= 0 && finalMetadata > finalGuard && commit > finalMetadata,
    'Native identity/current-authority assertion follows the final Local guard, before the held transaction exits.');
  assert.ok(guards.every(guard => guard.nativeHeld)); assert.equal(sql.activeCount(), 0);

  const otherDirectory = join(root, 'other_source'), otherAdapter = await PostgresSnapshotAdapter.fromPool(sql.pool, hash(otherDirectory));
  const other = (await Vault.create({ directory: otherDirectory, storage: otherAdapter, passphrase: credential,
    name: 'Synthetic independently encrypted wrong source', demo: true })).vault; vaults.add(other);
  const mismatched = new WorkspaceInterchangeLocalCustody({ vault: source, applicationDirectory: root, qualification: 'test-fixture',
    async assertCompleteOwner() { throw new Error('A mismatched native Vault must fail before owner admission.'); } });
  mismatched.installPostgresSourceCustody(new WorkspacePostgresCustody({ adapter: otherAdapter })); let callbacks = 0;
  await assert.rejects(mismatched.ports.withSource(context, null, async () => { callbacks++; }), code('POSTGRES_WORKSPACE_STORAGE_CHANGED'));
  assert.equal(callbacks, 0); assert.equal(sql.activeCount(), 0);
});
