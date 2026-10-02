import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { ChausarError, hash } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { PostgresSnapshotAdapter, type PostgresPool, type PostgresQueryResult } from '../runtime/postgres.ts';
import { Vault, type VaultEnvelope } from '../runtime/vault.ts';
import { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { InstalledPostgresWorkspaceProfile, type InstalledPostgresWorkspaceProfileOptions } from '../runtime/workspace-postgres-installed-profile.ts';

// Injected SQL protocol only. Adapted from workspace-postgres-custody.test.ts:
// actual adapter, custody, Vault encryption and Engine admission are exercised;
// this file does not qualify server locks, native SQL or cross-process durability.
type Row = Record<string, any>;
type Store = { authority: Map<string, Row>; custody: Map<string, Row> };
const clone = <T>(value: T): T => structuredClone(value);
function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b)).map(([key, child]) => [key, jsonbOrder(child)]));
  return value;
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function expression(column: string, text: string, values: unknown[]): unknown {
  const parameter = /^\$(\d+)/.exec(text.trim());
  if (parameter) {
    const value = values[Number(parameter[1]) - 1];
    return ['envelope', 'target_identity'].includes(column) && typeof value === 'string' ? JSON.parse(value) : value;
  }
  const literal = /^'([^']*)'/.exec(text.trim());
  if (literal) return literal[1];
  if (/^NULL\b/i.test(text.trim())) return null;
  if (/^CURRENT_TIMESTAMP\b/i.test(text.trim())) return 'injected-protocol-timestamp';
  throw new ChausarError('TEST_SQL_UNSUPPORTED', 'Every injected SQL expression must be modelled explicitly.');
}
function matches(row: Row, sql: string, values: unknown[]) {
  const where = sql.split(/\bWHERE\b/i)[1] ?? '';
  for (const match of where.matchAll(/\b(\w+)\s*=\s*(\$\d+(?:::\w+)?|'[^']*')/g)) {
    const actual = row[match[1]], expected = expression(match[1], match[2], values);
    if (match[1] === 'envelope' ? canonical(actual) !== canonical(expected) : String(actual) !== String(expected)) return false;
  }
  const id = /envelope\s*->>\s*'id'\s*=\s*\$(\d+)/.exec(where);
  return !id || row.envelope.id === values[Number(id[1]) - 1];
}
function protocolFixture() {
  let store: Store = { authority: new Map(), custody: new Map() }, connects = 0, releases = 0, active = 0;
  const events: string[] = [], database = { storage_id: 'injected-profile-storage', database: 'injected_profile',
    database_oid: '17017', server_address: '127.0.0.1', server_port: 15432 };
  const pool: PostgresPool = {
    async query(sql) {
      assert.match(sql, /to_regclass/); events.push('SCHEMA_READ');
      return { rows: [{ authority_table: true, storage_table: true, custody_table: true, creation_column: true }] };
    },
    async connect() {
      connects++; let transaction: Store | undefined, dirty = false, held = false;
      return { async query(rawSql, values = []): Promise<PostgresQueryResult> {
        const sql = rawSql.replace(/\s+/g, ' ').trim(); events.push(sql);
        if (sql === 'BEGIN') { assert.equal(transaction, undefined); transaction = clone(store); active++; return { rows: [], command: 'BEGIN' }; }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (transaction) { if (sql === 'COMMIT' && dirty) store = clone(transaction); transaction = undefined; active--; }
          held = false; return { rows: [], command: sql };
        }
        assert.ok(transaction, 'Queries remain in the adapter-owned transaction.');
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) { held = true; return { rows: [] }; }
        assert.equal(held, true, 'Authority/custody SQL follows the injected advisory admission.');
        if (/^SELECT .*FROM public\.chausar_workspace_postgres_storage/.test(sql)) return { rows: [clone(database)] };
        const table = /public\.(chausar_vault_authority|chausar_workspace_postgres_custody)\b/.exec(sql)?.[1];
        assert.ok(table, 'Every authority/custody query must name its actual table.');
        const rows = table === 'chausar_vault_authority' ? transaction.authority : transaction.custody, slot = String(values[0]);
        if (sql.startsWith('SELECT ')) {
          const row = rows.get(slot);
          return { rows: row ? [{ ...jsonbOrder(clone(row)), revision: row.revision === null ? null : String(row.revision) }] : [] };
        }
        if (sql.startsWith('INSERT INTO ')) {
          const insert = /\(([^()]*)\) VALUES \(([^()]*)\)/.exec(sql); assert.ok(insert);
          const columns = insert[1].split(',').map(part => part.trim()), parts = insert[2].split(',');
          const row: Row = table === 'chausar_vault_authority' ? { creation_id: randomUUID() }
            : { vault_id: null, revision: null, envelope_digest: null, envelope: null };
          columns.forEach((column, i) => { row[column] = expression(column, parts[i], values); });
          assert.equal(rows.has(row.slot), false, 'A slot cannot be overwritten by INSERT.');
          if (table === 'chausar_workspace_postgres_custody') assert.equal([...rows.values()].some(prior =>
            prior.operation_id === row.operation_id || prior.creation_id === row.creation_id), false);
          rows.set(row.slot, row); dirty = true; return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE ')) {
          const row = rows.get(slot); if (!row || !matches(row, sql, values)) return { rows: [], rowCount: 0 };
          const set = sql.split(/\bSET\b/)[1].split(/\bWHERE\b/)[0];
          for (const assignment of set.split(',')) {
            const field = /^\s*(\w+)\s*=\s*(.+)\s*$/.exec(assignment); assert.ok(field);
            row[field[1]] = expression(field[1], field[2], values);
          }
          dirty = true; return { rows: [], rowCount: 1 };
        }
        throw new ChausarError('TEST_SQL_UNSUPPORTED', 'This fixture never treats unmodelled SQL as a successful operation.');
      }, release() { assert.equal(transaction, undefined); assert.equal(held, false); releases++; events.push('RELEASE'); } };
    }, async end() {}
  };
  return { pool, events, authority: (slot: string) => clone(store.authority.get(slot)), custody: (slot: string) => clone(store.custody.get(slot)),
    counts: () => ({ connects, releases, active }) };
}
const credential = 'Public synthetic installed profile regression credential';
const wrongCredential = 'Public synthetic wrong installed profile credential';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:[\\/]/i, 'Validate canonical C-drive scratch before fixture creation.');
  const root = await realpath(await mkdtemp(join(parent, 'chausar-pg-profile-admission-'))), vaults = new Set<Vault>();
  t.after(async () => {
    for (const vault of vaults) await vault.close();
    const actual = await realpath(root), child = relative(parent, actual);
    assert.equal(dirname(actual), parent);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-pg-profile-admission-'));
    await rm(actual, { recursive: true, force: true });
  });
  const sql = protocolFixture(), sourceDirectory = join(root, 'source'), journalDirectory = join(root, 'journal');
  const adapter = (directory: string) => PostgresSnapshotAdapter.fromPool(sql.pool, hash(directory));
  const sourceAdapter = await adapter(sourceDirectory);
  const source = (await Vault.create({ directory: sourceDirectory, storage: sourceAdapter, passphrase: credential,
    name: 'Synthetic installed-profile source', demo: true })).vault; vaults.add(source);
  const sourceState = source.read(), journalAdapter = await adapter(journalDirectory);
  const journal = (await Vault.create({ directory: journalDirectory, storage: journalAdapter, passphrase: credential,
    name: 'Synthetic installed-profile journal', demo: true })).vault; vaults.add(journal);
  const targetId = 'profile_target', targetAdapter = await adapter(join(root, targetId, 'live', 'main'));
  const policy = { approvedSyntheticWorkspaceIds: [sourceState.workspace.id], allowedSyntheticSourceIds: ['demo-export'],
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 32, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 };
  let factories = 0;
  const closes: boolean[] = [];
  const options: InstalledPostgresWorkspaceProfileOptions = { applicationDirectory: root, sourceDirectory,
    journalVault: journal, journalAdapter, policy, targetPassphrase: async () => credential,
    async sourceAdapter() {
      factories++; const owned = await adapter(sourceDirectory), close = owned.close.bind(owned);
      owned.close = async () => { closes.push(owned.hasActiveLease); sql.events.push('ADAPTER_CLOSE'); await close(); }; return owned;
    }, targets: [{ targetId, adapter: targetAdapter, ownedAdapter: () => adapter(join(root, targetId, 'live', 'main')) }] };
  return { root, sql, source, sourceAdapter, sourceDirectory, sourceState, options,
    profile: new InstalledPostgresWorkspaceProfile(options), adapter, closes, factories: () => factories,
    track(vault: Vault) { vaults.add(vault); return vault; } };
}

test('injected SQL profile: wrong passphrase preserves UNLOCK_FAILED and durable authority while releasing the writer lock and held lease', async t => {
  const f = await fixture(t); await f.source.close();
  const original = f.sql.authority(hash(f.sourceDirectory)); let callbacks = 0;
  assert.ok(original);
  await assert.rejects(f.profile.withWorkspaceAdmission({ directory: f.sourceDirectory, operation: 'open' }, async adapter => {
    callbacks++; return Vault.open({ directory: f.sourceDirectory, storage: adapter, passphrase: wrongCredential });
  }), code('UNLOCK_FAILED'));
  assert.equal(callbacks, 1); assert.deepEqual(f.closes, [false], 'Transferred storage closes only after its held lease exits.');
  assert.deepEqual(f.sql.events.slice(-3), ['ROLLBACK', 'RELEASE', 'ADAPTER_CLOSE']);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
  await assert.rejects(lstat(join(f.sourceDirectory, 'writer.lock')), { code: 'ENOENT' });
  assert.deepEqual(f.sql.authority(hash(f.sourceDirectory)), original);
  const reopened = f.track(await f.profile.withWorkspaceAdmission({ directory: f.sourceDirectory, operation: 'open' }, adapter =>
    Vault.open({ directory: f.sourceDirectory, storage: adapter, passphrase: credential })));
  assert.deepEqual(reopened.read(), f.sourceState); assert.deepEqual(f.sql.authority(hash(f.sourceDirectory)), original);
});

test('injected SQL profile: source aliases and noncanonical source/final target slots are refused before custody transfer', async t => {
  const f = await fixture(t), alias = join(f.root, 'source_alias');
  await symlink(f.sourceDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await realpath(alias), await realpath(f.sourceDirectory)); let callbacks = 0;
  await assert.rejects(f.profile.withWorkspaceAdmission({ directory: alias, operation: 'open' }, async () => { callbacks++; }),
    code('POSTGRES_WORKSPACE_ROOT_REQUIRED'));
  assert.equal(f.factories(), 0); assert.equal(callbacks, 0);
  const wrongSource = await f.adapter(join(f.root, 'wrong_source_slot')), closeSource = wrongSource.close.bind(wrongSource);
  let wrongSourceCloses = 0;
  wrongSource.close = async () => { assert.equal(wrongSource.hasActiveLease, false); wrongSourceCloses++; await closeSource(); };
  const mismatchedSource = new InstalledPostgresWorkspaceProfile({ ...f.options, sourceAdapter: async () => wrongSource });
  await assert.rejects(mismatchedSource.withWorkspaceAdmission({ directory: f.sourceDirectory, operation: 'open' },
    async () => { callbacks++; }), code('POSTGRES_WORKSPACE_STORAGE_CHANGED'));
  assert.equal(wrongSourceCloses, 1); assert.equal(callbacks, 0);
  const wrongFinal = await f.adapter(join(f.root, 'profile_target', 'staging', 'main'));
  assert.throws(() => new InstalledPostgresWorkspaceProfile({ ...f.options,
    targets: [{ ...f.options.targets[0], adapter: wrongFinal }] }), code('POSTGRES_WORKSPACE_ROOT_REQUIRED'));
  await wrongFinal.close(); assert.equal(f.factories(), 0);
});

test('injected SQL ordinary Engine: prepared authority refuses create/open/recover/restore before invoking Vault or backup intake', async t => {
  const f = await fixture(t), targetDirectory = join(f.root, 'prepared'); await mkdir(targetDirectory);
  const preparedAdapter = await f.adapter(targetDirectory), custody = new WorkspacePostgresCustody({ adapter: preparedAdapter, targetDirectory });
  const originalAuthority = f.sql.authority(hash(f.sourceDirectory)); assert.ok(originalAuthority);
  const originalEnvelope = originalAuthority.envelope as VaultEnvelope;
  const reserved = await custody.reserve({ operationId: 'injected_preflight_operation', creationId: 'injected_preflight_creation' });
  await custody.prepare({ reservation: reserved, envelope: originalEnvelope });
  const preparedBefore = f.sql.custody(preparedAdapter.slot); assert.ok(preparedBefore); assert.equal(preparedBefore.phase, 'prepared');
  const backupDirectory = join(f.root, 'backups'); await mkdir(backupDirectory);
  const backupFile = join(backupDirectory, 'actual-encrypted.backup'); await f.source.backup(backupFile);
  const backupBefore = await readFile(backupFile);
  // Independently authenticate the actual backup, rather than claiming that an
  // invalid or missing path is a valid archive. The restore preflight below must
  // still refuse before this production file/decryption operation is invoked.
  const archive = f.track(await Vault.restore({ directory: join(f.root, 'archive_authentication'), storage: 'experimental-file',
    backupFile, passphrase: credential })); assert.deepEqual(archive.read(), f.sourceState); await archive.close();
  const spies = [t.mock.method(Vault, 'create'), t.mock.method(Vault, 'open'), t.mock.method(Vault, 'recover'), t.mock.method(Vault, 'restore')];
  const engine = new Engine({ directory: f.root, storage: 'postgres' }); t.after(() => engine.close());
  let admissions = 0, storageCloses = 0;
  // TypeScript private is a test-only substitution here. No production connector,
  // connection URL or native process is used to obtain the actual adapter.
  Object.defineProperty(engine, 'adapter', { value: async (folder: string) => {
    assert.equal(folder, 'prepared'); admissions++;
    const owned = await f.adapter(targetDirectory), close = owned.close.bind(owned);
    owned.close = async () => { assert.equal(owned.hasActiveLease, false); storageCloses++; await close(); }; return owned;
  } });
  const cases = [
    { method: 'workspace.create', payload: { name: 'Synthetic prepared refusal', folder: 'prepared', pack: 'ecommerce', passphrase: credential } },
    { method: 'workspace.open', payload: { folder: 'prepared', passphrase: credential } },
    { method: 'workspace.recover', payload: { folder: 'prepared', recoveryCode: 'syntactic_unused_recovery', passphrase: credential } },
    { method: 'workspace.restore', payload: { folder: 'prepared', backupFile: 'actual-encrypted.backup', passphrase: credential } },
    // Gate ordering only: a managed syntactic path is sufficient to reach the
    // storage preflight. This path is deliberately not presented as an archive.
    { method: 'workspace.restore', payload: { folder: 'prepared', backupFile: 'syntactic-unread.backup', passphrase: credential } },
  ];
  for (const { method, payload } of cases) {
    await assert.rejects(engine.request(method, payload), code('POSTGRES_TARGET_NOT_COMMITTED'));
    assert.equal(engine.vault, null); assert.deepEqual(f.sql.custody(preparedAdapter.slot), preparedBefore);
    assert.equal(f.sql.authority(preparedAdapter.slot), undefined); assert.deepEqual(await readdir(targetDirectory), []);
  }
  assert.equal(admissions, cases.length); assert.equal(storageCloses, cases.length);
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0, 'A refused prepared target never invokes a Vault operation.');
  assert.deepEqual(await readFile(backupFile), backupBefore);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
});

test('injected held SQL callback: inspectPostgresSnapshot authenticates an already-open Vault without a second writer or authority mutation', async t => {
  const f = await fixture(t), original = f.sql.authority(hash(f.sourceDirectory)), lock = await lstat(join(f.sourceDirectory, 'writer.lock'));
  assert.ok(original);
  const inspected = await f.source.snapshot(() => f.sourceAdapter.withLease(async lease => {
    const authority = await lease.authority(); assert.ok(authority);
    return Vault.inspectPostgresSnapshot({ passphrase: credential, loadHeldEnvelope: () => lease.load(),
      assertHeld: () => lease.assertCurrent(authority) });
  }));
  assert.equal(inspected.vaultId, f.source.vaultId); assert.deepEqual(inspected.state, f.source.read());
  assert.equal(inspected.revision, original.revision);
  assert.equal(inspected.authorityCiphertextBytes, Buffer.byteLength(JSON.stringify(original.envelope)));
  assert.deepEqual(f.sql.authority(hash(f.sourceDirectory)), original);
  const after = await lstat(join(f.sourceDirectory, 'writer.lock')); assert.equal(after.ino, lock.ino); assert.equal(after.birthtimeMs, lock.birthtimeMs);
});

test('injected held callback: snapshot inspection refuses a changed held guard or envelope after actual decryption without releasing State', async t => {
  const f = await fixture(t), original = f.sql.authority(hash(f.sourceDirectory));
  assert.ok(original);
  let guards = 0;
  await assert.rejects(Vault.inspectPostgresSnapshot({ passphrase: credential,
    loadHeldEnvelope: async () => clone(original.envelope), async assertHeld() {
      if (++guards === 2) throw new ChausarError('TEST_HELD_GUARD_CHANGED', 'Injected held custody was withdrawn during authentication.');
    } }), code('TEST_HELD_GUARD_CHANGED'));
  let reads = 0;
  await assert.rejects(Vault.inspectPostgresSnapshot({ passphrase: credential, async assertHeld() {},
    async loadHeldEnvelope() { const value = clone(original.envelope); if (++reads === 2) value.revision++; return value; } }),
  code('POSTGRES_AUTHORITY_CHANGED'));
  assert.equal(guards, 2); assert.equal(reads, 2); assert.deepEqual(f.sql.authority(hash(f.sourceDirectory)), original);
  assert.deepEqual(f.source.read(), f.sourceState);
});
