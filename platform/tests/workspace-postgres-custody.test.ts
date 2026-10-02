import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { PostgresSnapshotAdapter, normalizePostgresEnvelope, postgresEnvelopeDigest,
  type PostgresPool, type PostgresQueryResult, type PostgresSnapshotLease } from '../runtime/postgres.ts';
import { WorkspacePostgresCustody, type PostgresPublicationProof } from '../runtime/workspace-postgres-custody.ts';
import { Vault, type VaultEnvelope } from '../runtime/vault.ts';
import { hash, initialState } from '../runtime/contracts.ts';

// This fixture models the SQL protocol, including a shared advisory lock, durable
// COMMIT and a lost acknowledgement. It is not native PostgreSQL qualification.
type Row = Record<string, any>;
type Store = { authority: Map<string, Row>; custody: Map<string, Row> };
type Event = { client: number | 'pool'; sql: string; values: unknown[] };
type Transaction = { active: boolean; store?: Store; dirty: boolean; lock?: string };
const clone = <T>(value: T): T => structuredClone(value);
function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
    .map(([key, child]) => [key, jsonbOrder(child)]));
  return value;
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function decoded(column: string, value: unknown): unknown {
  return ['envelope', 'target_identity'].includes(column) && typeof value === 'string' ? JSON.parse(value) : value;
}
function expression(column: string, sql: string, values: unknown[]): unknown {
  const parameter = /^\$(\d+)/.exec(sql.trim());
  if (parameter) return decoded(column, values[Number(parameter[1]) - 1]);
  const literal = /^'([^']*)'/.exec(sql.trim());
  if (literal) return literal[1];
  if (/^NULL\b/i.test(sql.trim())) return null;
  if (/^CURRENT_TIMESTAMP\b/i.test(sql.trim())) return 'protocol-timestamp';
  throw new Error(`Protocol fixture cannot evaluate ${column} = ${sql}`);
}
function matchesWhere(row: Row, sql: string, values: unknown[]): boolean {
  const where = sql.split(/\bWHERE\b/i)[1] ?? '';
  for (const match of where.matchAll(/\b(\w+)\s*=\s*(\$\d+(?:::\w+)?|'[^']*')/g)) {
    const actual = row[match[1]], expected = expression(match[1], match[2], values);
    if (match[1] === 'envelope' ? canonical(actual) !== canonical(expected) : String(actual) !== String(expected)) return false;
  }
  const vaultId = /envelope\s*->>\s*'id'\s*=\s*\$(\d+)/.exec(where);
  if (vaultId && row.envelope.id !== values[Number(vaultId[1]) - 1]) return false;
  const phases = /phase\s+IN\s*\(([^)]*)\)/i.exec(where);
  if (phases && ![...phases[1].matchAll(/'([^']*)'/g)].some(match => match[1] === row.phase)) return false;
  return true;
}
function protocolFixture() {
  let store: Store = { authority: new Map(), custody: new Map() };
  let nextClient = 0, connects = 0, releases = 0, lostCommitAck = false;
  const events: Event[] = [], locks = new Map<string, number>();
  const waiters = new Map<string, { client: number; grant: () => void }[]>();
  const blockedObservers: (() => void)[] = [];
  let blockedCount = 0;
  const database = { storage_id: 'storage-generation-one', database: 'synthetic_custody', database_oid: '17001',
    server_address: '127.0.0.1', server_port: 15432 };
  let beforeExactDelete: ((slot: string, transaction: Store) => void) | undefined;
  let failQuery: { pattern: RegExp; error: Error } | undefined;
  function releaseLock(client: number, tx: Transaction) {
    if (!tx.lock || locks.get(tx.lock) !== client) return;
    const key = tx.lock, queued = waiters.get(key)?.shift();
    tx.lock = undefined;
    if (queued) { locks.set(key, queued.client); queued.grant(); }
    else locks.delete(key);
  }
  async function query(client: number | 'pool', tx: Transaction | undefined, rawSql: string, values: unknown[] = []): Promise<PostgresQueryResult> {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    events.push({ client, sql, values: clone(values) });
    if (failQuery?.pattern.test(sql)) { const failure = failQuery.error; failQuery = undefined; throw failure; }
    if (/to_regclass/.test(sql)) return { rows: [{ authority_table: true, storage_table: true, custody_table: true, creation_column: true }] };
    if (/^(CREATE TABLE|ALTER TABLE)\b/i.test(sql) || /^INSERT INTO public\.chausar_workspace_postgres_storage\b/i.test(sql)) return { rows: [], rowCount: 0 };
    assert.notEqual(client, 'pool', 'Runtime authority/custody SQL must use the leased client.');
    assert.ok(tx);
    if (sql === 'BEGIN') { assert.equal(tx.active, false); tx.active = true; return { rows: [] }; }
    if (/^SELECT pg_advisory_xact_lock/.test(sql)) {
      assert.equal(tx.active, true);
      const key = String(values[0]);
      if (locks.has(key) && locks.get(key) !== client) {
        blockedCount++;
        for (const notify of blockedObservers.splice(0)) notify();
        await new Promise<void>(grant => {
          const queued = waiters.get(key) ?? []; queued.push({ client: client as number, grant }); waiters.set(key, queued);
        });
      } else locks.set(key, client as number);
      tx.lock = key; tx.store = clone(store);
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      assert.equal(tx.active, true);
      if (tx.dirty) store = clone(tx.store!);
      tx.active = false; releaseLock(client as number, tx);
      if (lostCommitAck) { lostCommitAck = false; throw new Error('Injected lost COMMIT acknowledgement'); }
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') { tx.active = false; releaseLock(client as number, tx); return { rows: [] }; }
    assert.equal(tx.active, true, 'SQL must remain inside the awaited transaction.');
    assert.ok(tx.lock && tx.store, 'SQL must follow advisory lock acquisition.');
    if (/^SELECT .*FROM public\.chausar_workspace_postgres_storage/.test(sql)) return { rows: [clone(database)] };
    const table = /public\.(chausar_vault_authority|chausar_workspace_postgres_custody)\b/.exec(sql)?.[1];
    assert.ok(table, `Unhandled protocol SQL: ${sql}`);
    const rows = table === 'chausar_vault_authority' ? tx.store.authority : tx.store.custody;
    const slot = String(values[0]);
    if (/^SELECT\b/.test(sql)) {
      const row = rows.get(slot);
      return { rows: row ? [{ ...jsonbOrder(clone(row)), revision: row.revision === null ? null : String(row.revision) }] : [] };
    }
    if (/^INSERT INTO\b/.test(sql)) {
      const insert = /\(([^()]*)\) VALUES \(([^()]*)\)/.exec(sql);
      assert.ok(insert, `Unhandled protocol INSERT: ${sql}`);
      const columns = insert[1].split(',').map(part => part.trim()), expressions = insert[2].split(',').map(part => part.trim());
      const row: Row = table === 'chausar_vault_authority' ? { creation_id: randomUUID() }
        : { vault_id: null, revision: null, envelope_digest: null, envelope: null };
      columns.forEach((column, index) => { row[column] = expression(column, expressions[index], values); });
      assert.equal(rows.has(row.slot), false, 'INSERT may never overwrite an existing slot.');
      if (table === 'chausar_workspace_postgres_custody') {
        assert.equal([...rows.values()].some(prior => prior.operation_id === row.operation_id || prior.creation_id === row.creation_id), false,
          'Operation and creation ownership must remain unique.');
      }
      rows.set(row.slot, row); tx.dirty = true; return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE\b/.test(sql)) {
      const row = rows.get(slot);
      if (!row || !matchesWhere(row, sql, values)) return { rows: [], rowCount: 0 };
      const set = sql.split(/\bSET\b/)[1].split(/\bWHERE\b/)[0];
      for (const assignment of set.split(',')) {
        const match = /^\s*(\w+)\s*=\s*(.+)\s*$/.exec(assignment); assert.ok(match);
        row[match[1]] = expression(match[1], match[2], values);
      }
      tx.dirty = true; return { rows: [], rowCount: 1 };
    }
    if (/^DELETE FROM\b/.test(sql)) {
      if (/AND envelope = \$\d+::jsonb/.test(sql) && beforeExactDelete) {
        const inject = beforeExactDelete; beforeExactDelete = undefined; inject(slot, tx.store);
      }
      const row = rows.get(slot);
      if (!row || !matchesWhere(row, sql, values)) return { rows: [], rowCount: 0 };
      rows.delete(slot); tx.dirty = true; return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled protocol SQL: ${sql}`);
  }
  const pool: PostgresPool = {
    query: (sql, values) => query('pool', undefined, sql, values),
    async connect() {
      const client = ++nextClient; connects++;
      const tx: Transaction = { active: false, dirty: false };
      return { query: (sql, values) => query(client, tx, sql, values), release() { releases++; events.push({ client, sql: 'RELEASE', values: [] }); } };
    },
    async end() {}
  };
  return {
    pool, events, database,
    get connects() { return connects; }, get releases() { return releases; },
    seed(slot: string, envelope: VaultEnvelope, creationId = 'source-incarnation-one') {
      store.authority.set(slot, { slot, revision: envelope.revision, envelope: clone(envelope), creation_id: creationId });
    },
    authority(slot: string): any { return clone(store.authority.get(slot)); },
    custody(slot: string): any { return clone(store.custody.get(slot)); },
    forgetCustody(slot: string) { store.custody.delete(slot); },
    mutateCustody(slot: string, change: (row: Row) => void) { const row = store.custody.get(slot); assert.ok(row); change(row); },
    clearEvents() { events.length = 0; },
    loseNextCommitAcknowledgement() { lostCommitAck = true; },
    failNextQuery(pattern: RegExp, error: Error) { failQuery = { pattern, error }; },
    async waitForBlockedWriter() {
      if (blockedCount) return;
      await Promise.race([new Promise<void>(notify => blockedObservers.push(notify)),
        delay(2_000, undefined, { ref: false }).then(() => { throw new Error('Competing writer did not reach the held SQL advisory lock.'); })]);
    },
    replaceBeforeExactDelete(envelope: VaultEnvelope, creationId: string) {
      beforeExactDelete = (slot, transaction) => {
        const replacement = { slot, revision: envelope.revision, envelope: clone(envelope), creation_id: creationId };
        store.authority.set(slot, clone(replacement)); transaction.authority.set(slot, replacement);
      };
    }
  };
}
function envelope(revision = 0, id = 'synthetic-vault', marker = 'snapshot'): VaultEnvelope {
  const ciphertext = (value: string) => ({ nonce: Buffer.alloc(12, 1).toString('base64url'), tag: Buffer.alloc(16, 2).toString('base64url'), data: Buffer.from(value).toString('base64url') });
  return { format: 'chausar.vault.v1', id, revision,
    passphrase: { salt: Buffer.alloc(16, 3).toString('base64url'), kdf: 'scrypt-32768-8-1', ciphertext: ciphertext('passphrase-wrapper') },
    recovery: { salt: Buffer.alloc(16, 4).toString('base64url'), kdf: 'scrypt-32768-8-1', ciphertext: ciphertext('recovery-wrapper') }, snapshot: ciphertext(marker) };
}
async function directoryFor(t: TestContext) {
  const root = resolve(tmpdir());
  if (process.platform === 'win32') assert.equal(parse(root).root.toLowerCase(), 'c:\\', 'Mutable fixture directories must stay on C.');
  const directory = await mkdtemp(join(root, 'chausar-postgres-custody-test-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
async function targetFor(t: TestContext, slot = 'target-slot') {
  const fixture = protocolFixture(), directory = await directoryFor(t);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, slot);
  const custody = new WorkspacePostgresCustody({ adapter, targetDirectory: directory });
  return { fixture, directory, adapter, custody, slot };
}
async function preparedFor(t: TestContext, slot?: string) {
  const target = await targetFor(t, slot), value = envelope();
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  const proof = await target.custody.prepare({ reservation, envelope: jsonbOrder(value) });
  return { ...target, value, reservation, proof };
}

test('held source lease uses one transaction/client through nested load, commit and lease; escaped methods refuse', async () => {
  const fixture = protocolFixture(), original = envelope(); fixture.seed('source-slot', original);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot'); fixture.clearEvents();
  let escaped!: PostgresSnapshotLease;
  await adapter.withLease(async lease => {
    escaped = lease; assert.equal(lease.active, true); assert.equal(lease.slot, 'source-slot');
    assert.deepEqual(fixture.events.slice(0, 3).map(event => event.sql), ['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))',
      'SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE']);
    assert.deepEqual(await adapter.load(), original);
    await adapter.withLease(async nested => { assert.equal(nested, lease); await adapter.commit(envelope(1), 0); });
    assert.equal((await lease.authority())!.revision, 1);
    await assert.rejects(lease.query('SELECT 1; /* held lease */ COMMIT'), { code: 'POSTGRES_LEASE_TRANSACTION_CONTROL' });
  });
  assert.equal(escaped.active, false);
  for (const use of [() => escaped.query('SELECT 1'), () => escaped.load(), () => escaped.authority(),
    () => escaped.commit(envelope(2), 1), () => escaped.assertCurrent({ creationId: 'source-incarnation-one', vaultId: original.id, revision: 0, envelopeDigest: postgresEnvelopeDigest(original) })])
    await assert.rejects(use(), { code: 'POSTGRES_LEASE_INACTIVE' });
  assert.equal(fixture.connects, 1); assert.equal(fixture.releases, 1);
  assert.equal(fixture.events.filter(event => event.sql === 'BEGIN').length, 1);
  assert.equal(fixture.events.filter(event => event.sql === 'COMMIT').length, 1);
  assert.equal(fixture.events.some(event => event.client === 'pool'), false);
  assert.equal(fixture.authority('source-slot').revision, 1);
});

test('callback failure rolls back mutation and releases the held lease', async () => {
  const fixture = protocolFixture(), original = envelope(); fixture.seed('source-slot', original);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot'); fixture.clearEvents();
  const failure = new Error('Synthetic callback failure'); let escaped!: PostgresSnapshotLease;
  await assert.rejects(adapter.withLease(async lease => { escaped = lease; await adapter.commit(envelope(1), 0); throw failure; }), error => error === failure);
  assert.deepEqual(fixture.authority('source-slot').envelope, original); assert.equal(escaped.active, false);
  assert.deepEqual(fixture.events.slice(-2).map(event => event.sql), ['ROLLBACK', 'RELEASE']);
  assert.equal(fixture.releases, 1);
});

test('caught SQL statement failure still aborts held transaction and rolls back earlier authority mutation', async () => {
  const fixture = protocolFixture(), original = envelope(); fixture.seed('source-slot', original);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot'); fixture.clearEvents();
  const failure = new Error('Synthetic failed SQL statement');
  await assert.rejects(adapter.withLease(async lease => {
    await lease.commit(envelope(1), 0); fixture.failNextQuery(/^SELECT synthetic_statement_failure$/, failure);
    await assert.rejects(lease.query('SELECT synthetic_statement_failure'), error => error === failure);
    return 'callback continued after caught SQL error';
  }), { code: 'POSTGRES_TRANSACTION_ABORTED' });
  assert.deepEqual(fixture.authority('source-slot').envelope, original);
  assert.equal(fixture.events.some(event => event.sql === 'COMMIT'), false);
  assert.deepEqual(fixture.events.slice(-2).map(event => event.sql), ['ROLLBACK', 'RELEASE']);
});

test('asynchronous adapter work escaping callback keeps the released lease scope and cannot reacquire authority', async () => {
  const fixture = protocolFixture(); fixture.seed('source-slot', envelope());
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot');
  let releaseLate!: () => void, late!: Promise<VaultEnvelope | null>;
  const gate = new Promise<void>(resolve => { releaseLate = resolve; });
  await adapter.withLease(async () => { late = gate.then(() => adapter.load()); });
  const refused = assert.rejects(late, { code: 'POSTGRES_LEASE_INACTIVE' }); releaseLate(); await refused;
  assert.equal(fixture.connects, 1); assert.equal(fixture.releases, 1);
});

test('two adapters for one slot block competing writer until source lease release in protocol model', async () => {
  const fixture = protocolFixture(); fixture.seed('source-slot', envelope());
  const source = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot');
  const writer = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot'); fixture.clearEvents();
  let releaseCapture!: () => void, captured!: () => void, settled = false;
  const gate = new Promise<void>(resolve => { releaseCapture = resolve; }), entered = new Promise<void>(resolve => { captured = resolve; });
  const capture = source.withLease(async lease => { const pin = await lease.authority(); captured(); await gate; await lease.assertCurrent(pin!); });
  await entered;
  const mutation = writer.commit(envelope(1), 0).finally(() => { settled = true; });
  try { await fixture.waitForBlockedWriter(); await nextTurn(); assert.equal(settled, false); assert.equal(fixture.authority('source-slot').revision, 0); }
  finally { releaseCapture(); }
  await Promise.all([capture, mutation]); assert.equal(fixture.authority('source-slot').revision, 1);
  assert.equal(fixture.releases, 2);
});

test('source identity refuses recreated authority, changed ciphertext at same revision and stale revision', async () => {
  const fixture = protocolFixture(), original = envelope(); fixture.seed('source-slot', original);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot');
  const pin = await adapter.withLease(lease => lease.authority()); assert.ok(pin);
  for (const replacement of [
    { value: original, creationId: 'replacement-incarnation' },
    { value: envelope(0, original.id, 'changed-ciphertext'), creationId: pin.creationId },
    { value: envelope(1), creationId: pin.creationId }
  ]) {
    fixture.seed('source-slot', replacement.value, replacement.creationId);
    await assert.rejects(adapter.withLease(lease => lease.assertCurrent(pin)), { code: 'POSTGRES_AUTHORITY_CHANGED' });
  }
});

test('source custody pins actual SQL identity and final assertion rolls back callback authority changes', async () => {
  const fixture = protocolFixture(), original = envelope(); fixture.seed('source-slot', original);
  const adapter = await PostgresSnapshotAdapter.fromPool(fixture.pool, 'source-slot'), custody = new WorkspacePostgresCustody({ adapter });
  const identity = await custody.storageIdentity(); assert.deepEqual(identity, { storageId: fixture.database.storage_id,
    databaseOid: fixture.database.database_oid, database: fixture.database.database, serverAddress: '127.0.0.1', serverPort: 15432, slot: 'source-slot' });
  const result = await custody.withSource(async source => {
    assert.equal(Object.isFrozen(source.storage), true); assert.equal(Object.isFrozen(source.authority), true);
    assert.deepEqual(source.storage, identity); assert.equal(source.authority.creationId, 'source-incarnation-one');
    await source.assertCurrent(); assert.deepEqual(await adapter.load(), original); return 'captured';
  });
  assert.equal(result, 'captured');
  await assert.rejects(custody.withSource(async source => { await source.lease.commit(envelope(1), 0); return 'stale'; }), { code: 'POSTGRES_AUTHORITY_CHANGED' });
  assert.deepEqual(fixture.authority('source-slot').envelope, original);
  await assert.rejects(new WorkspacePostgresCustody({ adapter: await PostgresSnapshotAdapter.fromPool(fixture.pool, 'absent-slot') }).withSource(async () => null), { code: 'POSTGRES_SOURCE_REQUIRED' });
  await assert.rejects(custody.withSource(async () => { fixture.database.storage_id = 'replacement-database-generation'; }), { code: 'POSTGRES_STORAGE_CHANGED' });
});

test('target reservation requires both absent SQL authority and an actual empty physical directory', async t => {
  const target = await targetFor(t); target.fixture.seed(target.slot, envelope());
  await assert.rejects(target.custody.reserve({ operationId: 'occupied-sql', creationId: 'sql-incarnation' }), { code: 'POSTGRES_TARGET_OCCUPIED' });
  assert.equal(target.fixture.custody(target.slot), undefined);
  const physical = await targetFor(t, 'physical-slot'); await writeFile(join(physical.directory, 'existing-evidence'), 'occupied');
  await assert.rejects(physical.custody.reserve({ operationId: 'occupied-files', creationId: 'physical-incarnation' }), { code: 'POSTGRES_TARGET_OCCUPIED' });
  assert.equal(physical.fixture.authority(physical.slot), undefined); assert.equal(physical.fixture.custody(physical.slot), undefined);
});

test('reserved and prepared authority are unavailable to ordinary adapter load and commit', async t => {
  const target = await targetFor(t), reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  assert.equal((await target.custody.inspect(reservation)).status, 'reserved');
  for (const phase of ['reserved', 'prepared']) {
    if (phase === 'prepared') await target.custody.prepare({ reservation, envelope: envelope() });
    await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
    await assert.rejects(target.adapter.commit(envelope(), null), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
    assert.equal(target.fixture.authority(target.slot), undefined);
  }
  await assert.rejects(async () => target.custody.prepare({ reservation, envelope: envelope(1) }), { code: 'POSTGRES_FRESH_AUTHORITY_REQUIRED' });
});

test('bootstrap staging adapter writes only prepared custody and cleanup uses retained exact encrypted proof', async t => {
  const target = await targetFor(t), value = envelope();
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  const staging = target.custody.createPreparedAdapter(reservation);
  assert.equal(staging.kind, 'postgres'); assert.equal(await staging.load(), null);
  await staging.commit(value, null); assert.deepEqual(await staging.load(), value);
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(target.fixture.custody(target.slot).phase, 'prepared');
  await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  await assert.rejects(staging.commit(envelope(1), 0), { code: 'POSTGRES_FRESH_AUTHORITY_REQUIRED' });
  await assert.rejects(target.custody.rollbackPrepared(reservation), { code: 'POSTGRES_ROLLBACK_REFUSED' });
  assert.equal(target.fixture.custody(target.slot).phase, 'prepared');
  target.fixture.clearEvents(); await staging.delete();
  assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back'); assert.equal(target.fixture.authority(target.slot), undefined);
  assert.equal(target.fixture.events.some(event => event.sql.startsWith('DELETE FROM')), false);
  assert.equal(await staging.load(), null);
  await assert.rejects(target.custody.createPreparedAdapter(reservation).load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
});

test('actual encrypted Vault bootstrap failure cleans only acknowledged prepared SQL custody and preserves original failure', async t => {
  const target = await targetFor(t), stagingDirectory = await directoryFor(t);
  const reservation = await target.custody.reserve({ operationId: 'bootstrap-operation', creationId: 'bootstrap-incarnation' });
  const staging = target.custody.createPreparedAdapter(reservation), state = initialState('Synthetic fresh bootstrap', true);
  state.members[0].id = 'fresh-owner'; state.policy.allowedSources = ['synthetic-source'];
  const failure = new Error('Synthetic keychain publication failure'); let removed = false;
  await assert.rejects(Vault.createBootstrap({ directory: stagingDirectory, storage: staging,
    passphrase: 'Public synthetic bootstrap credential', state, expectedStateDigest: hash(state),
    expectedWorkspaceId: state.workspace.id, expectedOwnerId: 'fresh-owner',
    budgets: { maxStateBytes: 100_000, maxJsonDepth: 32, maxJsonNodes: 10_000, maxRecords: 100 },
    keychain: { async store() { throw failure; }, async remove() { removed = true; } }
  }), error => error === failure);
  assert.equal(removed, true); assert.equal(target.fixture.authority(target.slot), undefined);
  assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back'); assert.equal(await staging.load(), null);
  assert.equal((await target.custody.inspect(reservation)).status, 'rolled-back');
  assert.deepEqual(await readdir(stagingDirectory), []); assert.deepEqual(await readdir(target.directory), []);
  await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
});

test('exact prepare and publish retain normalized encrypted evidence across new adapter/custody instance and admitted writes', async t => {
  const target = await preparedFor(t);
  const prepared = await target.custody.inspect(target.proof);
  assert.equal(prepared.status, 'prepared'); assert.deepEqual(prepared.proof, target.proof); assert.deepEqual(prepared.envelope, target.value);
  assert.deepEqual(Object.keys(prepared.envelope!), ['format', 'id', 'revision', 'passphrase', 'recovery', 'snapshot']);
  await writeFile(join(target.directory, 'root-authenticated-evidence'), 'synthetic durable filesystem publication');
  await target.custody.publish(target.proof); assert.deepEqual(await target.adapter.load(), target.value);
  const reopenedAdapter = await PostgresSnapshotAdapter.fromPool(target.fixture.pool, target.slot);
  const reopened = new WorkspacePostgresCustody({ adapter: reopenedAdapter, targetDirectory: target.directory });
  let inspection = await reopened.inspect(target.proof);
  assert.equal(inspection.status, 'committed'); assert.deepEqual(inspection.envelope, target.value);
  assert.equal(inspection.currentAuthority!.creationId, target.proof.creationId); assert.equal(inspection.currentAuthority!.revision, 0);
  await reopenedAdapter.commit(envelope(1, target.value.id, 'admitted-new-snapshot'), 0);
  inspection = await reopened.inspect(target.proof);
  assert.equal(inspection.status, 'committed'); assert.deepEqual(inspection.proof, target.proof);
  assert.deepEqual(inspection.envelope, target.value); assert.equal(inspection.currentAuthority!.revision, 1);
  assert.notEqual(inspection.currentAuthority!.envelopeDigest, target.proof.envelopeDigest);
  await assert.rejects(reopened.rollbackExactPublication(target.proof), { code: 'POSTGRES_ROLLBACK_REFUSED' });
  assert.equal(target.fixture.authority(target.slot).revision, 1);
});

test('lost COMMIT acknowledgement retains possible committed authority for explicit restart inspection', async t => {
  const target = await preparedFor(t); target.fixture.clearEvents(); target.fixture.loseNextCommitAcknowledgement();
  await assert.rejects(target.custody.publish(target.proof), /Injected lost COMMIT acknowledgement/);
  const reopened = new WorkspacePostgresCustody({ adapter: await PostgresSnapshotAdapter.fromPool(target.fixture.pool, target.slot), targetDirectory: target.directory });
  const inspection = await reopened.inspect(target.proof);
  assert.equal(inspection.status, 'committed'); assert.deepEqual(inspection.proof, target.proof); assert.deepEqual(inspection.envelope, target.value);
  assert.deepEqual(await target.adapter.load(), target.value);
  assert.equal(target.fixture.events.some(event => event.sql.startsWith('DELETE FROM')), false);
  await assert.rejects(reopened.publish(target.proof), { code: 'POSTGRES_PUBLICATION_REPLAY' });
  assert.deepEqual(target.fixture.authority(target.slot).envelope, target.value);
});

test('lost reservation acknowledgement recovers only exact operation/creation custody through read-only restart inspection', async t => {
  const target = await targetFor(t), input = { operationId: 'operation-one', creationId: 'target-incarnation-one' };
  target.fixture.loseNextCommitAcknowledgement();
  await assert.rejects(target.custody.reserve(input), /Injected lost COMMIT acknowledgement/);
  assert.equal(target.fixture.custody(target.slot).phase, 'reserved'); assert.equal(target.fixture.authority(target.slot), undefined);
  const reopened = new WorkspacePostgresCustody({ adapter: await PostgresSnapshotAdapter.fromPool(target.fixture.pool, target.slot), targetDirectory: target.directory });
  target.fixture.clearEvents(); const inspection = await reopened.inspectOperation(input);
  assert.equal(inspection.status, 'reserved'); assert.ok(inspection.reservation);
  assert.equal(inspection.reservation.operationId, input.operationId); assert.equal(inspection.reservation.creationId, input.creationId);
  assert.equal(inspection.reservation.storage.slot, target.slot); assert.equal(inspection.reservation.target.directory, target.directory);
  assert.deepEqual(await reopened.inspect(inspection.reservation), inspection);
  assert.equal((await reopened.inspectOperation({ ...input, operationId: 'other-operation' })).status, 'unknown');
  assert.equal((await reopened.inspectOperation({ ...input, creationId: 'other-incarnation' })).status, 'unknown');
  assert.equal(target.fixture.events.some(event => /^(INSERT|UPDATE|DELETE)\b/.test(event.sql)), false);
});

test('lost prepare acknowledgement retains locally submitted exact proof for staging readback and explicit cleanup', async t => {
  const target = await targetFor(t), value = envelope();
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  const staging = target.custody.createPreparedAdapter(reservation); target.fixture.loseNextCommitAcknowledgement();
  await assert.rejects(staging.commit(value, null), /Injected lost COMMIT acknowledgement/);
  assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.equal(target.fixture.authority(target.slot), undefined);
  assert.deepEqual(await staging.load(), value);
  await staging.delete(); assert.equal(await staging.load(), null);
  assert.equal(target.fixture.custody(target.slot).phase, 'rolled-back'); assert.equal(target.fixture.authority(target.slot), undefined);
  const altered = await targetFor(t, 'altered-lost-prepare'), changed = envelope(0, value.id, 'changed-retained-preparation');
  const alteredReservation = await altered.custody.reserve({ operationId: 'operation-two', creationId: 'target-incarnation-two' });
  const alteredStaging = altered.custody.createPreparedAdapter(alteredReservation); altered.fixture.loseNextCommitAcknowledgement();
  await assert.rejects(alteredStaging.commit(value, null), /Injected lost COMMIT acknowledgement/);
  altered.fixture.mutateCustody(altered.slot, row => { row.envelope = changed; row.envelope_digest = postgresEnvelopeDigest(changed); });
  await assert.rejects(alteredStaging.load(), { code: 'POSTGRES_TARGET_CHANGED' });
  await assert.rejects(alteredStaging.delete(), { code: 'POSTGRES_TARGET_CHANGED' });
  assert.equal(altered.fixture.custody(altered.slot).phase, 'prepared');
});

test('target generation replacement and altered publication proof inspect unknown and refuse publication', async t => {
  const target = await preparedFor(t), replacement = `${target.directory}-original`;
  await rename(target.directory, replacement); t.after(() => rm(replacement, { recursive: true, force: true })); await mkdir(target.directory);
  assert.deepEqual(await target.custody.inspect(target.proof), { status: 'unknown', reasonCode: 'POSTGRES_TARGET_CHANGED' });
  await assert.rejects(target.custody.publish(target.proof), { code: 'POSTGRES_TARGET_CHANGED' });
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(target.fixture.custody(target.slot).phase, 'prepared');
  const exact = await preparedFor(t, 'other-target');
  const altered: PostgresPublicationProof = { ...exact.proof, envelopeDigest: '0'.repeat(64) };
  assert.deepEqual(await exact.custody.inspect(altered), { status: 'unknown', reasonCode: 'POSTGRES_TARGET_CHANGED' });
  await assert.rejects(exact.custody.publish(altered), { code: 'POSTGRES_TARGET_CHANGED' });
  await assert.rejects(exact.custody.rollbackPrepared(altered), { code: 'POSTGRES_TARGET_CHANGED' });
  assert.equal(exact.fixture.custody(exact.slot).phase, 'prepared');
});

test('inspection distinguishes actual absent custody from an unowned SQL occupant without adopting it', async t => {
  const target = await targetFor(t);
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  target.fixture.forgetCustody(target.slot);
  assert.deepEqual(await target.custody.inspect(reservation), { status: 'absent' });
  target.fixture.seed(target.slot, envelope(), 'unowned-incarnation');
  target.fixture.clearEvents();
  assert.deepEqual(await target.custody.inspect(reservation), { status: 'unknown', reasonCode: 'POSTGRES_TARGET_OCCUPIED' });
  assert.equal(target.fixture.custody(target.slot), undefined); assert.equal(target.fixture.authority(target.slot).creation_id, 'unowned-incarnation');
  assert.equal(target.fixture.events.some(event => /^(INSERT|UPDATE|DELETE)\b/.test(event.sql)), false);
});

test('inspection classifies inconsistent phase/evidence and corrupt encoded JSONB as unknown without mutation', async t => {
  const target = await targetFor(t), value = envelope();
  const reservation = await target.custody.reserve({ operationId: 'operation-one', creationId: 'target-incarnation-one' });
  target.fixture.mutateCustody(target.slot, row => {
    row.envelope = value; row.vault_id = value.id; row.revision = 0; row.envelope_digest = postgresEnvelopeDigest(value);
  });
  target.fixture.clearEvents(); const inconsistent = await target.custody.inspect(reservation);
  assert.equal(inconsistent.status, 'unknown'); assert.ok(inconsistent.reasonCode);
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal(target.fixture.custody(target.slot).phase, 'reserved');
  assert.equal(target.fixture.events.some(event => /^(INSERT|UPDATE|DELETE)\b/.test(event.sql)), false);
  for (const field of ['envelope', 'target_identity']) {
    const prepared = await preparedFor(t); prepared.fixture.mutateCustody(prepared.slot, row => { row[field] = '{"invalid-jsonb-string"'; });
    prepared.fixture.clearEvents(); const inspection = await prepared.custody.inspect(prepared.proof);
    assert.equal(inspection.status, 'unknown'); assert.ok(inspection.reasonCode);
    assert.equal(prepared.fixture.custody(prepared.slot).phase, 'prepared'); assert.equal(prepared.fixture.authority(prepared.slot), undefined);
    assert.equal(prepared.fixture.events.some(event => /^(INSERT|UPDATE|DELETE)\b/.test(event.sql)), false);
  }
});

test('reserved and prepared rollback persist tombstones and refuse every replay without deleting filesystem material', async t => {
  for (const phase of ['reserved', 'prepared']) {
    const target = await targetFor(t, `rollback-${phase}`);
    const reservation = await target.custody.reserve({ operationId: `operation-${phase}`, creationId: `incarnation-${phase}` });
    const proof = phase === 'prepared' ? await target.custody.prepare({ reservation, envelope: envelope() }) : undefined;
    const exact = proof ?? reservation; await writeFile(join(target.directory, 'retained-evidence'), 'retain after rollback');
    target.fixture.clearEvents(); await target.custody.rollbackPrepared(exact);
    const inspection = await target.custody.inspect(exact); assert.equal(inspection.status, 'rolled-back');
    assert.equal(await readFile(join(target.directory, 'retained-evidence'), 'utf8'), 'retain after rollback');
    assert.equal(target.fixture.events.some(event => event.sql.startsWith('DELETE FROM')), false);
    await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
    await assert.rejects(target.custody.rollbackPrepared(exact), { code: 'POSTGRES_ROLLBACK_REFUSED' });
    await assert.rejects(target.custody.reserve({ operationId: `new-${phase}`, creationId: `new-incarnation-${phase}` }), { code: 'POSTGRES_TARGET_OCCUPIED' });
    await assert.rejects(target.custody.prepare({ reservation, envelope: envelope() }), { code: 'POSTGRES_PUBLICATION_REPLAY' });
    if (proof) await assert.rejects(target.custody.publish(proof), { code: 'POSTGRES_PUBLICATION_REPLAY' });
  }
});

test('exact publication rollback conditionally removes only unchanged owned revision-zero authority and retains tombstone/evidence', async t => {
  const target = await preparedFor(t); await writeFile(join(target.directory, 'retained-evidence'), 'retain after SQL rollback');
  await target.custody.publish(target.proof); target.fixture.clearEvents(); await target.custody.rollbackExactPublication(target.proof);
  assert.equal(target.fixture.authority(target.slot), undefined); assert.equal((await target.custody.inspect(target.proof)).status, 'rolled-back');
  assert.equal(await readFile(join(target.directory, 'retained-evidence'), 'utf8'), 'retain after SQL rollback');
  const deletion = target.fixture.events.find(event => event.sql.startsWith('DELETE FROM'))!;
  assert.match(deletion.sql, /WHERE slot = \$1 AND creation_id = \$2 AND revision = \$3 AND envelope->>'id' = \$4 AND envelope = \$5::jsonb$/);
  assert.deepEqual(deletion.values, [target.slot, target.proof.creationId, 0, target.proof.vaultId, JSON.stringify(normalizePostgresEnvelope(target.value))]);
  await assert.rejects(target.custody.rollbackExactPublication(target.proof), { code: 'POSTGRES_ROLLBACK_REFUSED' });
  await assert.rejects(target.adapter.commit(envelope(), null), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
});

test('exact rollback rejects replacement occupants at same and different revisions and changed ciphertext', async t => {
  for (const replacement of [
    { revision: 0, creationId: 'replacement-incarnation', marker: 'snapshot' },
    { revision: 1, creationId: 'replacement-incarnation', marker: 'replacement-snapshot' },
    { revision: 0, creationId: 'target-incarnation-one', marker: 'changed-same-revision-ciphertext' }
  ]) {
    const target = await preparedFor(t); await target.custody.publish(target.proof);
    const changed = envelope(replacement.revision, target.value.id, replacement.marker);
    target.fixture.seed(target.slot, changed, replacement.creationId); target.fixture.clearEvents();
    assert.equal((await target.custody.inspect(target.proof)).status, 'unknown');
    await assert.rejects(target.custody.rollbackExactPublication(target.proof), { code: 'POSTGRES_ROLLBACK_REFUSED' });
    assert.deepEqual(target.fixture.authority(target.slot).envelope, changed);
    assert.equal(target.fixture.custody(target.slot).phase, 'committed');
    assert.equal(target.fixture.events.some(event => event.sql.startsWith('DELETE FROM')), false);
    if (replacement.creationId !== target.proof.creationId) await assert.rejects(target.adapter.load(), { code: 'POSTGRES_TARGET_NOT_COMMITTED' });
  }
});

test('conditional rollback JSONB equality refuses a ciphertext occupant injected after identity read', async t => {
  const target = await preparedFor(t); await target.custody.publish(target.proof);
  const changed = envelope(0, target.value.id, 'changed-after-precheck');
  target.fixture.replaceBeforeExactDelete(changed, target.proof.creationId);
  await assert.rejects(target.custody.rollbackExactPublication(target.proof), { code: 'POSTGRES_ROLLBACK_REFUSED' });
  assert.deepEqual(target.fixture.authority(target.slot).envelope, changed); assert.equal(target.fixture.custody(target.slot).phase, 'committed');
});

test('inspection exposes transport failures and never classifies them as safe absence', async t => {
  const target = await preparedFor(t), failure = new Error('Synthetic SQL transport failure');
  target.fixture.failNextQuery(/FROM public\.chausar_workspace_postgres_storage/, failure);
  await assert.rejects(target.custody.inspect(target.proof), error => error === failure);
  assert.equal(target.fixture.custody(target.slot).phase, 'prepared'); assert.equal(target.fixture.authority(target.slot), undefined);
});
