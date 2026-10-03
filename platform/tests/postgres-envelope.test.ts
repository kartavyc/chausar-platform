import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hash, initialState } from '../runtime/contracts.ts';
import { Vault, type VaultEnvelope } from '../runtime/vault.ts';
import { PostgresSnapshotAdapter, normalizePostgresEnvelope, postgresEnvelopeDigest, type PostgresPool,
  type PostgresSnapshotLease, type PostgresAuthority } from '../runtime/postgres.ts';

// A protocol fixture, never native PostgreSQL evidence: PostgreSQL JSONB does
// not preserve object insertion order. The actual hard gate independently
// exercises server storage, reopening and authenticated encrypted backups.
function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => [key, jsonbOrder(child)]));
  return value;
}
function protocolFixture() {
  let envelope: any, creationId = 'fixture-creation-1', custody: any = null, storedRevision: string | null = null;
  let connections = 0, released = 0, connected = false, committedAcknowledgement: Error | null = null, rollbackCommit = false;
  const statements: { sql: string; values?: unknown[]; client: boolean }[] = [];
  const query = async (sql: string, values?: unknown[], client = false) => {
    statements.push({ sql, values, client });
    if (sql === 'SELECT synthetic_sql_failure') throw new Error('Synthetic underlying SQL failure');
    if (sql.includes('to_regclass')) return { rows: [{ authority_table: true, storage_table: true, custody_table: true, creation_column: true }] };
    if (sql === "SELECT storage_id FROM public.chausar_workspace_postgres_storage WHERE id = 'current' FOR SHARE") return { rows: [{ storage_id: 'envelope-fixture-storage' }] };
    if (sql.startsWith('SELECT creation_id, revision, envelope')) return { rows: envelope
      ? [{ creation_id: creationId, revision: storedRevision ?? String(envelope.revision), envelope: jsonbOrder(envelope) }] : [] };
    if (sql.startsWith('SELECT phase, creation_id, vault_id')) return { rows: custody ? [structuredClone(custody)] : [] };
    if (/^(INSERT INTO|UPDATE) public\.chausar_vault_authority/.test(sql)) {
      envelope = JSON.parse(String(values![2])); return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM public.chausar_vault_authority')) { envelope = undefined; return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  };
  const pool: PostgresPool = { query, async connect() {
    assert.equal(connected, false, 'Protocol fixture has only one connection: nested operations must reuse it.');
    connected = true; connections++;
    let before: { envelope: any; creationId: string; custody: any } | undefined;
    return { async query(sql, values) {
      if (sql === 'BEGIN') before = { envelope: structuredClone(envelope), creationId, custody: structuredClone(custody) };
      if (sql === 'ROLLBACK' && before) { envelope = before.envelope; creationId = before.creationId; custody = before.custody; before = undefined; }
      const result = await query(sql, values, true);
      if (sql === 'COMMIT') {
        if (rollbackCommit) {
          rollbackCommit = false;
          if (before) { envelope = before.envelope; creationId = before.creationId; custody = before.custody; }
          before = undefined; return { rows: [], rowCount: null, command: 'ROLLBACK' };
        }
        before = undefined;
        if (committedAcknowledgement) { const failure = committedAcknowledgement; committedAcknowledgement = null; throw failure; }
      }
      return result;
    }, release() { assert.equal(connected, true); connected = false; released++; } };
  }, async end() {} };
  return { pool, current: () => envelope, currentCustody: () => structuredClone(custody), statements, connections: () => connections, released: () => released,
    replace(value: VaultEnvelope | null, incarnation = creationId) { envelope = value ? structuredClone(value) : undefined; creationId = incarnation; },
    custody(value: unknown) { custody = value; }, storedRevision(value: string | null) { storedRevision = value; },
    loseCommitAcknowledgement() { committedAcknowledgement = new Error('Synthetic lost COMMIT acknowledgement'); },
    rollbackCommit() { rollbackCommit = true; } };
}
function syntheticEnvelope(revision = 0): VaultEnvelope {
  const ciphertext = (prefix: string) => ({ nonce: `${prefix}-nonce`, tag: `${prefix}-tag`, data: `${prefix}-data` });
  return { format: 'chausar.vault.v1', id: 'synthetic-vault', revision,
    passphrase: { salt: 'passphrase-salt', kdf: 'scrypt-32768-8-1', ciphertext: ciphertext('passphrase') },
    recovery: { salt: 'recovery-salt', kdf: 'scrypt-32768-8-1', ciphertext: ciphertext('recovery') }, snapshot: ciphertext('snapshot') };
}
// Shape-only injected SQL publication evidence; never native physical identity proof.
function committedCustody() {
  const envelope = syntheticEnvelope();
  return { phase: 'committed', creation_id: 'fixture-creation-1', operation_id: 'fixture-operation-1',
    storage_id: 'envelope-fixture-storage', vault_id: envelope.id, revision: 0,
    envelope_digest: postgresEnvelopeDigest(envelope), envelope,
    target_identity: { directory: join(tmpdir(), 'chausar-envelope-protocol-target'),
      physical: { dev: '1', ino: '2', birthtimeNs: '3' } } };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
const credential = 'Public synthetic JSONB regression credential';
async function directoryFor(t: any) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:\\/i, 'Synthetic PostgreSQL files require canonical C-drive scratch.');
  const directory = await mkdtemp(join(parent, 'chausar-postgres-envelope-test-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}

test('PostgreSQL JSONB protocol fixture preserves authenticated vault reopening despite nested key reordering', async t => {
  const directory = await directoryFor(t), fixture = protocolFixture();
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'jsonb-order-fixture');
  const { vault } = await Vault.create({ directory, storage: adapter, passphrase: credential, name: 'Synthetic order regression' });
  t.after(() => vault.close());
  await vault.update(state => { state.activity.push({ message: 'Committed synthetic value' }); });
  assert.deepEqual(Object.keys(fixture.current().passphrase), ['salt', 'kdf', 'ciphertext']);
  assert.deepEqual(Object.keys(jsonbOrder(fixture.current()).passphrase), ['kdf', 'salt', 'ciphertext']);
  const capture = await vault.snapshot(state => adapter.withLease(async lease => {
    const pin = await lease.authority(); assert.ok(pin);
    const captured = await vault.captureEncryptedCustody({ maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000, maxArtifacts: 100 });
    assert.deepEqual(captured.state, state);
    assert.equal(Buffer.from(captured.authority).toString('utf8'), JSON.stringify(fixture.current()));
    await lease.assertCurrent(pin); return captured;
  }));
  assert.equal(capture.authorityKind, 'adapter-issued-envelope');
  await vault.close();
  const reopened = await Vault.open({ directory, storage: adapter, passphrase: credential });
  t.after(() => reopened.close());
  assert.equal(reopened.read().revision, 1);
  assert.equal(reopened.read().activity[0].message, 'Committed synthetic value');
  await reopened.close();

  // Recovery metadata is authenticated even when unlocking with the passphrase.
  const tag = fixture.current().recovery.ciphertext.tag;
  fixture.current().recovery.ciphertext.tag = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
  await assert.rejects(Vault.open({ directory, storage: adapter, passphrase: credential }), { code: 'UNLOCK_FAILED' });
});

test('complete v1 normalization restores exact factory serialization without changing encrypted values', () => {
  const original = syntheticEnvelope(8), stored = jsonbOrder(original), normalized = normalizePostgresEnvelope(stored);
  assert.notEqual(JSON.stringify(stored), JSON.stringify(original));
  assert.equal(JSON.stringify(normalized), JSON.stringify(original));
  assert.deepEqual(Object.keys(normalized), ['format', 'id', 'revision', 'passphrase', 'recovery', 'snapshot']);
  assert.deepEqual(Object.keys(normalized.snapshot), ['nonce', 'tag', 'data']);
  assert.equal(postgresEnvelopeDigest(stored), createHash('sha256').update(JSON.stringify(original)).digest('hex'));
  normalized.snapshot.data = 'changed'; assert.equal(stored.snapshot.data, original.snapshot.data);
});

test('normalization refuses unreviewed or missing fields at every envelope level', () => {
  for (const path of [[], ['passphrase'], ['recovery'], ['passphrase', 'ciphertext'], ['recovery', 'ciphertext'], ['snapshot']]) {
    const extra: any = syntheticEnvelope(); let target = extra; for (const key of path) target = target[key];
    target.extra = 'unreviewed'; assert.throws(() => normalizePostgresEnvelope(extra), { code: 'CORRUPT_VAULT' });
    const missing: any = syntheticEnvelope(); target = missing; for (const key of path) target = target[key];
    delete target[Object.keys(target)[0]]; assert.throws(() => normalizePostgresEnvelope(missing), { code: 'CORRUPT_VAULT' });
  }
  const symbol: any = syntheticEnvelope(); symbol[Symbol('unreviewed')] = true;
  assert.throws(() => normalizePostgresEnvelope(symbol), { code: 'CORRUPT_VAULT' });
  const hidden: any = syntheticEnvelope(); Object.defineProperty(hidden.snapshot, 'extra', { value: 'hidden' });
  assert.throws(() => normalizePostgresEnvelope(hidden), { code: 'CORRUPT_VAULT' });
  const accessor: any = syntheticEnvelope(); Object.defineProperty(accessor.snapshot, 'data', { enumerable: true, get() { throw new Error('must not invoke an accessor'); } });
  assert.throws(() => normalizePostgresEnvelope(accessor), { code: 'CORRUPT_VAULT' });
});

test('normalization refuses unsupported identity, revision, wrapper and ciphertext values', () => {
  for (const change of [
    (value: any) => { value.format = 'chausar.vault.v2'; }, (value: any) => { value.id = ''; },
    (value: any) => { value.id = '../slot'; }, (value: any) => { value.revision = '0'; },
    (value: any) => { value.revision = -1; }, (value: any) => { value.revision = Number.MAX_SAFE_INTEGER + 1; },
    (value: any) => { value.passphrase.kdf = 'unreviewed-kdf'; }, (value: any) => { value.recovery.salt = null; },
    (value: any) => { value.snapshot.nonce = 42; }, (value: any) => { value.passphrase.ciphertext.data = []; }
  ]) {
    const value = syntheticEnvelope(); change(value); assert.throws(() => normalizePostgresEnvelope(value), { code: 'CORRUPT_VAULT' });
  }
});

test('held lease retains one transaction through awaited capture and nested adapter calls', { timeout: 5000 }, async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'held-source');
  const entered = deferred(), resume = deferred();
  let retained!: PostgresSnapshotLease;
  const capture = adapter.withLease(async lease => {
    retained = lease; assert.equal(lease.slot, adapter.slot); assert.equal(lease.active, true);
    const pin = await lease.authority(); assert.ok(pin); await lease.assertCurrent(pin);
    assert.equal((await adapter.load())!.revision, 0);
    await adapter.withLease(async nested => { assert.equal(nested, lease); await nested.assertCurrent(pin); });
    await assert.rejects(adapter.close(), { code: 'POSTGRES_LEASE_ACTIVE' });
    entered.resolve(); await resume.promise;
    await adapter.commit(syntheticEnvelope(1), 0);
    assert.equal((await adapter.load())!.revision, 1); return 'captured';
  });
  await entered.promise;
  assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 0);
  assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 0);
  assert.ok(fixture.statements.some(value => value.sql.includes('FOR UPDATE')));
  resume.resolve(); assert.equal(await capture, 'captured');
  assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 1); assert.equal(retained.active, false);
  assert.equal(fixture.statements.filter(value => value.sql === 'BEGIN').length, 1);
  assert.equal(fixture.statements.filter(value => value.sql.includes('pg_advisory_xact_lock')).length, 1);
  assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 1);
  assert.ok(fixture.statements.filter(value => !value.sql.includes('to_regclass')).every(value => value.client));
  const pin: PostgresAuthority = { creationId: 'fixture-creation-1', vaultId: 'synthetic-vault', revision: 1, envelopeDigest: postgresEnvelopeDigest(syntheticEnvelope(1)) };
  for (const work of [() => retained.query('SELECT 1'), () => retained.load(), () => retained.commit(syntheticEnvelope(2), 1),
    () => retained.authority(), () => retained.assertCurrent(pin)]) await assert.rejects(work(), { code: 'POSTGRES_LEASE_INACTIVE' });
});

test('detached async adapter calls retain an expired context and cannot start a new transaction', async () => {
  const fixture = protocolFixture(), adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'detached-source');
  const resume = deferred(); let detached!: Promise<VaultEnvelope | null>;
  await adapter.withLease(async () => { detached = resume.promise.then(() => adapter.load()); });
  resume.resolve(); await assert.rejects(detached, { code: 'POSTGRES_LEASE_INACTIVE' });
  assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 1);
});

test('callback failure rolls back nested mutation and releases its transaction', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'rollback-source'); let retained!: PostgresSnapshotLease;
  await assert.rejects(adapter.withLease(async lease => {
    retained = lease; await adapter.commit(syntheticEnvelope(1), 0); throw new Error('Synthetic callback failure');
  }), /Synthetic callback failure/);
  assert.equal(fixture.current().revision, 0); assert.equal(retained.active, false); assert.equal(fixture.released(), 1);
  assert.equal(fixture.statements.filter(value => value.sql === 'ROLLBACK').length, 1);
  assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 0);
  assert.equal((await adapter.load())!.revision, 0);
});

test('lease rejects transaction controls that could release the native fence', async () => {
  const fixture = protocolFixture(), adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'transaction-source');
  await adapter.withLease(async lease => {
    for (const sql of ['BEGIN', 'COMMIT', 'ROLLBACK', 'START TRANSACTION', 'END', 'ABORT', 'PREPARE TRANSACTION \'name\'',
      '/* comment */ COMMIT', 'SELECT 1; -- comment\nROLLBACK'])
      await assert.rejects(lease.query(sql), { code: 'POSTGRES_LEASE_TRANSACTION_CONTROL' });
    await lease.query("SELECT 'COMMIT; ROLLBACK' AS synthetic_literal");
  });
  assert.equal(fixture.statements.filter(value => value.sql === 'BEGIN').length, 1);
  assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 1);
});

test('source authority pin detects revision, ciphertext, vault and creation changes after release', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'pin-source');
  const pin = await adapter.withLease(lease => lease.authority()); assert.ok(pin);
  for (const mutate of [
    (value: VaultEnvelope) => { value.revision++; }, (value: VaultEnvelope) => { value.snapshot.data += '-changed'; },
    (value: VaultEnvelope) => { value.id = 'replacement-vault'; }
  ]) {
    const value = syntheticEnvelope(); mutate(value); fixture.replace(value);
    await assert.rejects(adapter.withLease(lease => lease.assertCurrent(pin)), { code: 'POSTGRES_AUTHORITY_CHANGED' });
  }
  fixture.replace(syntheticEnvelope(), 'replacement-creation');
  await assert.rejects(adapter.withLease(lease => lease.assertCurrent(pin)), { code: 'POSTGRES_AUTHORITY_CHANGED' });
  fixture.replace(null);
  await assert.rejects(adapter.withLease(lease => lease.assertCurrent(pin)), { code: 'POSTGRES_AUTHORITY_CHANGED' });
});

test('reserved, prepared and rolled-back custody excludes ordinary open, write and source authority', async () => {
  const fixture = protocolFixture(), adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'inert-target');
  for (const phase of ['reserved', 'prepared', 'rolled-back']) for (const occupied of [false, true]) {
    fixture.replace(occupied ? syntheticEnvelope() : null);
    fixture.custody({ phase, creation_id: 'fixture-creation-1', vault_id: 'synthetic-vault' });
    await assert.rejects(adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
    await assert.rejects(adapter.commit(syntheticEnvelope(occupied ? 1 : 0), occupied ? 0 : null), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
    await assert.rejects(adapter.withLease(lease => lease.authority()), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  }
});

test('exact committed custody allows ordinary revision advances while excluding replacement identities', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const custody = committedCustody();
  fixture.custody(custody);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'committed-target');
  await adapter.commit(syntheticEnvelope(1), 0); await adapter.commit(syntheticEnvelope(2), 1);
  assert.equal((await adapter.load())!.revision, 2); assert.equal(custody.revision, 0);
  const replacement = syntheticEnvelope(3); replacement.id = 'other-vault';
  await assert.rejects(adapter.commit(replacement, 2), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  for (const [value, incarnation] of [[syntheticEnvelope(), 'other-creation'], [replacement, 'fixture-creation-1'], [null, 'fixture-creation-1']] as const) {
    fixture.replace(value, incarnation);
    await assert.rejects(adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
    await assert.rejects(adapter.withLease(lease => lease.authority()), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  }
});

test('ordinary PostgreSQL delete refuses unpublished custody without removing authority or retained evidence', async t => {
  for (const phase of ['reserved', 'prepared', 'rolled-back']) for (const occupied of [false, true]) {
    await t.test(`${phase}, ${occupied ? 'occupied' : 'absent'} authority`, async () => {
      const fixture = protocolFixture(); fixture.replace(occupied ? syntheticEnvelope() : null);
      fixture.custody({ phase, creation_id: 'fixture-creation-1', vault_id: 'synthetic-vault' });
      const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'delete-unpublished');
      const before = { authority: structuredClone(fixture.current()), custody: fixture.currentCustody() };
      await assert.rejects(adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
      const afterFailedAdmission = fixture.statements.length;
      await assert.rejects(adapter.delete(), { code: 'POSTGRES_AUTHORITY_CHANGED' });
      assert.equal(fixture.statements.length, afterFailedAdmission, 'Unknown ownership refuses without another SQL lease.');
      assert.deepEqual({ authority: fixture.current(), custody: fixture.currentCustody() }, before);
      assert.equal(fixture.statements.filter(value => value.sql.startsWith('DELETE FROM public.chausar_vault_authority')).length, 0);
      assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 0);
      assert.equal(fixture.statements.filter(value => value.sql === 'ROLLBACK').length, 1);
      assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 1);
    });
  }
});

test('ordinary PostgreSQL delete refuses missing or mismatched committed authority', async t => {
  for (const mismatch of ['missing', 'creation', 'vault']) {
    await t.test(mismatch, async () => {
      const fixture = protocolFixture(), value = syntheticEnvelope();
      if (mismatch === 'vault') value.id = 'replacement-vault';
      fixture.replace(mismatch === 'missing' ? null : value, mismatch === 'creation' ? 'replacement-creation' : 'fixture-creation-1');
      fixture.custody(committedCustody());
      const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'delete-mismatched');
      const before = { authority: structuredClone(fixture.current()), custody: fixture.currentCustody() };
      await assert.rejects(adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
      const afterFailedAdmission = fixture.statements.length;
      await assert.rejects(adapter.delete(), { code: 'POSTGRES_AUTHORITY_CHANGED' });
      assert.equal(fixture.statements.length, afterFailedAdmission, 'Unknown ownership refuses without another SQL lease.');
      assert.deepEqual({ authority: fixture.current(), custody: fixture.currentCustody() }, before);
      assert.equal(fixture.statements.filter(value => value.sql.startsWith('DELETE FROM public.chausar_vault_authority')).length, 0);
      assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 1);
    });
  }
});

test('ordinary PostgreSQL deletion requires prior admission and preserves valid present or committed authority', async t => {
  for (const disposition of ['absent', 'present', 'committed']) {
    await t.test(disposition, async () => {
      const fixture = protocolFixture(); fixture.replace(disposition === 'absent' ? null : syntheticEnvelope(2));
      if (disposition === 'committed') fixture.custody(committedCustody());
      const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'delete-admitted');
      const beforeCustody = fixture.currentCustody();
      if (disposition === 'absent') {
        // A fresh constructor has never admitted ownership of this incarnation.
        const beforeStatements = fixture.statements.length;
        await assert.rejects(adapter.delete(), { code: 'POSTGRES_AUTHORITY_CHANGED' });
        assert.equal(fixture.current(), undefined); assert.deepEqual(fixture.currentCustody(), beforeCustody);
        assert.equal(fixture.statements.length, beforeStatements);
        assert.equal(fixture.statements.filter(value => value.sql.startsWith('DELETE FROM public.chausar_vault_authority')).length, 0);
        assert.equal(fixture.statements.filter(value => value.sql === 'BEGIN').length, 0);
        assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 0);
        assert.equal(fixture.statements.filter(value => value.sql === 'ROLLBACK').length, 0);
        assert.equal(fixture.connections(), 0); assert.equal(fixture.released(), 0);
        return;
      }
      await adapter.withLease(async lease => {
        assert.equal((await lease.load())!.revision, 2);
        await adapter.delete();
      });
      assert.equal(fixture.current(), undefined); assert.deepEqual(fixture.currentCustody(), beforeCustody);
      assert.equal(fixture.statements.filter(value => value.sql.startsWith('DELETE FROM public.chausar_vault_authority')).length, 1);
      assert.equal(fixture.statements.filter(value => value.sql === 'BEGIN').length, 1);
      assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 1);
      assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 1);
    });
  }
});

test('ordinary PostgreSQL deletion refuses fresh unadmitted present authority without issuing SQL', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'delete-unadmitted-present');
  const before = structuredClone(fixture.current()), beforeStatements = fixture.statements.length;
  await assert.rejects(adapter.delete(), { code: 'POSTGRES_AUTHORITY_CHANGED' });
  assert.deepEqual(fixture.current(), before); assert.equal(fixture.currentCustody(), null);
  assert.equal(fixture.statements.length, beforeStatements);
  assert.equal(fixture.statements.filter(value => value.sql.startsWith('DELETE FROM public.chausar_vault_authority')).length, 0);
  assert.equal(fixture.connections(), 0); assert.equal(fixture.released(), 0);
});

test('ordinary PostgreSQL delete reuses the active lease through admission and deletion', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  fixture.custody(committedCustody());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'delete-reentrant');
  await adapter.withLease(async lease => {
    assert.equal((await lease.load())!.revision, 0);
    await adapter.delete();
    assert.equal(lease.active, true); assert.equal(fixture.current(), undefined);
    assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 0);
    assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 0);
  });
  assert.equal(fixture.connections(), 1); assert.equal(fixture.released(), 1);
  assert.equal(fixture.statements.filter(value => value.sql === 'BEGIN').length, 1);
  assert.equal(fixture.statements.filter(value => value.sql.includes('pg_advisory_xact_lock')).length, 1);
  assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 1);
  assert.ok(fixture.statements.filter(value => !value.sql.includes('to_regclass')).every(value => value.client));
});

test('ordinary PostgreSQL delete preserves a replacement of its already admitted incarnation', async t => {
  for (const replacement of ['creation', 'vault']) {
    await t.test(replacement, async () => {
      const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
      const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'delete-sticky');
      await adapter.load();
      const value = syntheticEnvelope(); if (replacement === 'vault') value.id = 'replacement-vault';
      fixture.replace(value, replacement === 'creation' ? 'replacement-creation' : 'fixture-creation-1');
      fixture.statements.length = 0;
      await assert.rejects(adapter.delete(), { code: 'POSTGRES_AUTHORITY_CHANGED' });
      assert.deepEqual(fixture.current(), value); assert.equal(fixture.currentCustody(), null);
      assert.equal(fixture.statements.filter(value => value.sql.startsWith('DELETE FROM public.chausar_vault_authority')).length, 0);
      assert.equal(fixture.connections(), 2); assert.equal(fixture.released(), 2);
    });
  }
});

test('revision conflicts do not replace authority; malformed revisions refuse before connecting', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope(9));
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'revision-source');
  for (const [revision, expected] of [[9, 9], [8, 9], [11, 9], [-1, null], [Number.MAX_SAFE_INTEGER + 1, null], [10, NaN]] as const)
    await assert.rejects(adapter.commit(syntheticEnvelope(revision), expected), { code: 'INVALID_REVISION' });
  assert.equal(fixture.connections(), 0);
  await assert.rejects(adapter.commit(syntheticEnvelope(9), 8), { code: 'REVISION_CONFLICT' });
  assert.equal(fixture.current().revision, 9);
  assert.ok(!fixture.statements.some(value => /^(INSERT INTO|UPDATE) public\.chausar_vault_authority/.test(value.sql)));
});

test('stored SQL revision must exactly match the safe encrypted-envelope revision', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'corrupt-revision');
  for (const revision of ['1', '9007199254740993', '-1', '0.0']) {
    fixture.storedRevision(revision); await assert.rejects(adapter.load(), { code: 'CORRUPT_VAULT' });
  }
});

test('lost COMMIT acknowledgement retains possible publication and fresh inspection reveals it', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'lost-ack-source');
  fixture.loseCommitAcknowledgement();
  await assert.rejects(adapter.commit(syntheticEnvelope(1), 0), /Synthetic lost COMMIT acknowledgement/);
  assert.equal(fixture.current().revision, 1); assert.equal(fixture.released(), 1);
  assert.equal((await adapter.load())!.revision, 1);
  await assert.rejects(adapter.commit(syntheticEnvelope(1), 0), { code: 'REVISION_CONFLICT' });
});

test('swallowed underlying SQL failure cannot acknowledge earlier writes as committed', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'aborted-source');
  await assert.rejects(adapter.withLease(async lease => {
    await lease.commit(syntheticEnvelope(1), 0);
    await assert.rejects(lease.query('SELECT synthetic_sql_failure'), /Synthetic underlying SQL failure/);
    return 'caught failure';
  }), { code: 'POSTGRES_TRANSACTION_ABORTED' });
  assert.equal(fixture.current().revision, 0);
  assert.equal(fixture.statements.filter(value => value.sql === 'COMMIT').length, 0);
  assert.equal(fixture.statements.filter(value => value.sql === 'ROLLBACK').length, 1);
});

test('PostgreSQL ROLLBACK command tag on COMMIT is never returned as successful publication', async () => {
  const fixture = protocolFixture(); fixture.replace(syntheticEnvelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'rollback-tag-source'); fixture.rollbackCommit();
  await assert.rejects(adapter.commit(syntheticEnvelope(1), 0), { code: 'POSTGRES_TRANSACTION_ABORTED' });
  assert.equal(fixture.current().revision, 0); assert.equal(fixture.released(), 1);
});

test('fresh PG bootstrap reads back the exact encrypted envelope after complete JSONB reordering', async t => {
  const directory = await directoryFor(t), fixture = protocolFixture(), state = initialState('Synthetic fresh PostgreSQL bootstrap', true);
  state.policy.allowedSources = ['synthetic-source'];
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'fresh-bootstrap');
  const result = await Vault.createBootstrap({ directory, storage: adapter, passphrase: credential, state,
    expectedStateDigest: hash(state), expectedWorkspaceId: state.workspace.id, expectedOwnerId: state.members[0].id,
    budgets: { maxStateBytes: 1_000_000, maxJsonDepth: 32, maxJsonNodes: 20_000, maxRecords: 1000 } });
  t.after(() => result.vault.close());
  assert.deepEqual(result.vault.read(), state); await result.vault.close();
  const reopened = await Vault.open({ directory, storage: adapter, passphrase: credential }); t.after(() => reopened.close());
  assert.deepEqual(reopened.read(), state);
});

test('ready schema reconnect uses catalog reads and avoids DDL under a source lease', async () => {
  const fixture = protocolFixture(), adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot');
  await adapter.withLease(async () => {
    const target = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'target-slot'); assert.equal(target.slot, 'target-slot');
  });
  assert.equal(fixture.connections(), 1);
  assert.ok(!fixture.statements.some(value => /^(CREATE|ALTER)/.test(value.sql)));
  assert.ok(!fixture.statements.some(value => value.values?.[0] === 'chausar-postgres-schema-v1'));
});

test('schema installation and legacy column migration serialize only the missing DDL', async () => {
  for (const legacy of [false, true]) {
    const calls: { sql: string; values?: unknown[] }[] = []; let released = 0;
    const query = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('to_regclass')) return { rows: [{ authority_table: legacy, storage_table: false, custody_table: false, creation_column: false }] };
      return { rows: [] };
    };
    const pool: PostgresPool = { query, async connect() { return { query, release() { released++; } }; }, async end() {} };
    await PostgresSnapshotAdapter.fromPool(pool, 'schema-slot');
    assert.ok(calls.some(value => value.values?.[0] === 'chausar-postgres-schema-v1'));
    assert.equal(calls.filter(value => value.sql.startsWith('ALTER TABLE')).length, legacy ? 1 : 0);
    assert.equal(calls.filter(value => value.sql.startsWith('CREATE TABLE IF NOT EXISTS public.chausar_vault_authority')).length, legacy ? 0 : 1);
    assert.equal(calls.filter(value => value.sql === 'BEGIN').length, 1); assert.equal(calls.filter(value => value.sql === 'COMMIT').length, 1);
    assert.equal(released, 1);
  }
});

test('PostgreSQL JSONB normalization refuses unknown authenticated wrapper fields rather than discarding them', async t => {
  const directory = await directoryFor(t), fixture = protocolFixture();
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'jsonb-shape-fixture');
  const { vault } = await Vault.create({ directory, storage: adapter, passphrase: credential, name: 'Synthetic shape regression' });
  t.after(() => vault.close()); await vault.close();
  fixture.current().recovery.extra = 'Unexpected authenticated field';
  await assert.rejects(adapter.load(), { code: 'CORRUPT_VAULT' });
  await assert.rejects(Vault.open({ directory, storage: adapter, passphrase: credential }), { code: 'UNLOCK_FAILED' });
});
