import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { ChausarError, hash } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { PostgresSnapshotAdapter, postgresEnvelopeDigest, type PostgresPool, type PostgresQueryResult } from '../runtime/postgres.ts';
import { Vault, type KeychainHook, type OpenVaultOptions, type VaultEnvelope } from '../runtime/vault.ts';
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
  let commitFailure: unknown;
  const events: string[] = [], database = { id: 'current', storage_id: 'injected-profile-storage', database: 'injected_profile',
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
          if (sql === 'COMMIT' && commitFailure) { const error = commitFailure; commitFailure = undefined; throw error; }
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
        if (sql.startsWith('DELETE FROM ')) {
          const row = rows.get(slot); if (!row || !matches(row, sql, values)) return { rows: [], rowCount: 0 };
          rows.delete(slot); dirty = true; return { rows: [], rowCount: 1 };
        }
        throw new ChausarError('TEST_SQL_UNSUPPORTED', 'This fixture never treats unmodelled SQL as a successful operation.');
      }, release() { assert.equal(transaction, undefined); assert.equal(held, false); releases++; events.push('RELEASE'); } };
    }, async end() {}
  };
  return { pool, events, authority: (slot: string) => clone(store.authority.get(slot)), custody: (slot: string) => clone(store.custody.get(slot)),
    replaceAuthority(slot: string, change: (row: Row) => void) { const row = store.authority.get(slot); assert.ok(row); change(row); },
    setCustody(slot: string, row: Row) { store.custody.set(slot, clone(row)); },
    // Explicit quiescent mutation/readback of the existing
    // protocol model's storage-generation row. This is never native SQL proof.
    storageGeneration: () => clone(database),
    replaceStorageGeneration(storageId: string) {
      assert.equal(active, 0, 'Generation injection occurs only between drained model transactions.');
      assert.ok(storageId && storageId !== database.storage_id); database.storage_id = storageId;
    },
    authorityGateRows: () => clone({
      authority: [...store.authority].sort(([left], [right]) => left.localeCompare(right)),
      custody: [...store.custody].sort(([left], [right]) => left.localeCompare(right)),
    }),
    failNextCommit(error: unknown) { assert.ok(error); commitFailure = error; },
    counts: () => ({ connects, releases, active }) };
}
const credential = 'Public synthetic installed profile regression credential';
const wrongCredential = 'Public synthetic wrong installed profile credential';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:[\\/]/i, 'Validate canonical C-drive scratch before fixture creation.');
  const root = await realpath(await mkdtemp(join(parent, 'chausar-pg-profile-admission-'))), vaults = new Set<Vault>(), expectedShutdownFailures = new Map<Vault, unknown>();
  const beforeVaultCleanup: (() => Promise<void>)[] = [];
  t.after(async () => {
    // Engine owns its opened handle and must capture invoice custody before the
    // fallback Vault closes or the shared fixture root is removed.
    for (const cleanup of beforeVaultCleanup) await cleanup();
    for (const vault of vaults) {
      try { await vault.close(); } catch (error) { assert.equal(error, expectedShutdownFailures.get(vault), 'Only the exact expected failed-delete shutdown may reject cleanup.'); }
    }
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
    beforeVaultCleanup(cleanup: () => Promise<void>) { beforeVaultCleanup.push(cleanup); },
    expectShutdownFailure(vault: Vault, failure: unknown) { expectedShutdownFailures.set(vault, failure); },
    track(vault: Vault) { vaults.add(vault); return vault; } };
}

async function publicDeleteFixture(t: TestContext, keychain?: KeychainHook, authorityGatePublication = false) {
  const f = await fixture(t); await f.source.close();
  const engine = new Engine({ directory: f.root, storage: 'postgres', demo: true });
  let owned!: PostgresSnapshotAdapter, expectedShutdownFailure: unknown;
  Object.defineProperty(engine, 'adapter', { value: async (folder: string) => {
    assert.equal(folder, 'source'); owned = await f.adapter(f.sourceDirectory);
    const close = owned.close.bind(owned);
    owned.close = async () => { assert.equal(owned.hasActiveLease, false); f.sql.events.push('ADAPTER_CLOSE'); await close(); };
    return owned;
  } });
  f.beforeVaultCleanup(async () => {
    try { await engine.close(); } catch (error) { assert.equal(error, expectedShutdownFailure, 'Only this request\'s exact shutdown refusal may reject Engine close.'); }
  });
  if (keychain) {
    const open = Vault.open.bind(Vault);
    t.mock.method(Vault, 'open', (options: OpenVaultOptions) => open({ ...options, keychain }));
  }
  if (authorityGatePublication) {
    // Inject only protocol custody for the actual existing encrypted revision-0
    // authority BEFORE the fresh adapter opens it. Subsequent real Vault writes
    // may advance ordinary revisions without changing original publication.
    const slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
    assert.ok(authority); assert.equal(authority.envelope.revision, 0);
    const physical = await lstat(f.sourceDirectory, { bigint: true });
    f.sql.setCustody(slot, { slot, phase: 'committed', creation_id: authority.creation_id,
      vault_id: authority.envelope.id, operation_id: 'proposed-authority-gate-' + randomUUID(),
      storage_id: f.sql.storageGeneration().storage_id, revision: 0,
      envelope_digest: postgresEnvelopeDigest(authority.envelope), envelope: authority.envelope,
      target_identity: { directory: f.sourceDirectory, physical: {
        dev: String(physical.dev), ino: String(physical.ino), birthtimeNs: String(physical.birthtimeNs),
      } } });
  }
  await engine.request('workspace.open', { folder: 'source', passphrase: credential });
  const vault = f.track(engine.vault!), state = vault.read(), prefix = `chausar-${state.workspace.id}-`;
  await mkdir(join(f.root, 'backups')); await mkdir(join(f.root, 'exports'));
  const backup = join(f.root, 'backups', prefix + '1.backup'), exported = join(f.root, 'exports', prefix + '2.json');
  await vault.backup(backup); await vault.export(exported, { plaintext: true });
  await vault.writeArtifact({ id: 'delete_trial', purpose: 'private-trial', value: { synthetic: 'private trial deletion evidence' }, expectedDigest: null });
  await vault.writeArtifact({ id: 'delete_interchange', purpose: 'workspace-interchange', value: { synthetic: 'private interchange deletion evidence' }, expectedDigest: null });
  if (authorityGatePublication) {
    // writeArtifact persists its private ciphertext, not the ordinary SQL State
    // snapshot. Exercise a real, explicit snapshot update and injected SQL protocol
    // readback rather than assuming artifact writes advance authority revision.
    const slot = hash(f.sourceDirectory), beforeUpdate = f.sql.authority(slot), publication = f.sql.custody(slot);
    assert.ok(beforeUpdate && publication);
    await vault.update(current => { current.activity.push('Bound-incarnation ordinary revision advance control'); });
    const afterUpdate = f.sql.authority(slot); assert.ok(afterUpdate);
    assert.equal(afterUpdate.creation_id, beforeUpdate.creation_id);
    assert.equal(afterUpdate.envelope.id, beforeUpdate.envelope.id);
    assert.equal(afterUpdate.envelope.revision, beforeUpdate.envelope.revision + 1);
    assert.deepEqual(f.sql.custody(slot), publication, 'A normal snapshot update preserves original committed publication.');
  }
  const foreign = join(f.root, 'backups', `chausar-${f.options.journalVault.read().workspace.id}-3.backup`);
  await f.options.journalVault.backup(foreign);
  const privatePaths = ['private-artifacts/private-trial/delete_trial.encrypted.json', 'private-artifacts/workspace-interchange/delete_interchange.encrypted.json'];
  const files = [...privatePaths.map(path => join(f.sourceDirectory, path)), backup, exported, foreign];
  const bytes = async () => Promise.all(files.map(async path => {
    try { return await readFile(path); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  }));
  const before = await bytes(); assert.ok(before.every(value => value instanceof Buffer));
  return { ...f, engine, vault, state, owned, files, bytes, before, foreign, privatePaths,
    expectedRemoved: [...privatePaths, `backups/${prefix}1.backup`, `exports/${prefix}2.json`],
    expectFailure(error: unknown) { expectedShutdownFailure = error; f.expectShutdownFailure(vault, error); } };
}

test('public PostgreSQL deletion preserves all encrypted artifacts and managed copies on stale native admission', async t => {
  for (const condition of ['reserved', 'prepared', 'mismatched', 'creation', 'vault', 'revision', 'ciphertext']) {
    await t.test(condition, async t => {
      const f = await publicDeleteFixture(t), slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
      assert.ok(authority);
      if (['reserved', 'prepared', 'mismatched'].includes(condition)) f.sql.setCustody(slot, {
        slot, phase: condition === 'mismatched' ? 'committed' : condition,
        creation_id: condition === 'mismatched' ? 'foreign-creation' : authority.creation_id, vault_id: authority.envelope.id,
        operation_id: 'synthetic_delete_operation', storage_id: 'injected-profile-storage', revision: authority.revision,
        envelope_digest: postgresEnvelopeDigest(authority.envelope), envelope: authority.envelope, target_identity: { synthetic: true },
      });
      else f.sql.replaceAuthority(slot, row => {
        if (condition === 'creation') row.creation_id = 'replacement-delete-incarnation';
        if (condition === 'vault') row.envelope.id = 'replacement-delete-vault';
        if (condition === 'revision') { row.revision++; row.envelope.revision++; }
        if (condition === 'ciphertext') row.envelope.snapshot.data += 'A';
      });
      const nativeBefore = { authority: f.sql.authority(slot), custody: f.sql.custody(slot) }; f.sql.events.length = 0;
      let refusal: unknown; try { await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name }); } catch (error) { refusal = error; f.expectFailure(error); }
      const after = await f.bytes(), fingerprint = (values: (Buffer | null)[]) => values.map(value => value && createHash('sha256').update(value).digest('hex'));
      t.diagnostic(JSON.stringify({ condition, errorCode: refusal instanceof ChausarError ? refusal.code : null,
        before: fingerprint(f.before), after: fingerprint(after), nativePreserved: canonical(nativeBefore) === canonical({ authority: f.sql.authority(slot), custody: f.sql.custody(slot) }) }));
      assert.deepEqual(after, f.before, 'Admission refusal must precede every private-artifact, backup and export removal.');
      assert.deepEqual({ authority: f.sql.authority(slot), custody: f.sql.custody(slot) }, nativeBefore);
      assert.ok(code(['reserved', 'prepared', 'mismatched'].includes(condition) ? 'POSTGRES_TARGET_NOT_COMMITTED' : 'POSTGRES_AUTHORITY_CHANGED')(refusal));
      assert.equal(f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length, 0);
      assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
      assert.equal(f.sql.events.at(-1), 'ADAPTER_CLOSE');
      await assert.rejects(lstat(join(f.sourceDirectory, 'writer.lock')), { code: 'ENOENT' });
    });
  }
});

// Parent-approved conservative deletion authority: exact retained original
// publication binding and current database generation for public deletion.
// They are source-protocol regressions, NOT evidence of native SQL behaviour.
// These agreed exact refusal codes never use a widened code whitelist.
const proposedAuthorityGateCases = [
  { mutation: 'operation-id', expectedCode: 'POSTGRES_AUTHORITY_CHANGED' },
  { mutation: 'custody-storage-id', expectedCode: 'POSTGRES_AUTHORITY_CHANGED' },
  { mutation: 'target-physical', expectedCode: 'POSTGRES_AUTHORITY_CHANGED' },
  { mutation: 'database-generation', expectedCode: 'POSTGRES_STORAGE_CHANGED' },
] as const;

type PublicDeleteFixture = Awaited<ReturnType<typeof publicDeleteFixture>>;
async function proposedAuthorityGateWitness(f: PublicDeleteFixture) {
  const bytes = await f.bytes(), files = await Promise.all(f.files.map(async (path, index) => {
    let physical: null | Record<string, string>;
    try {
      const stat = await lstat(path, { bigint: true });
      physical = Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs']
        .map(field => [field, String(stat[field as keyof typeof stat])]));
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; physical = null; }
    return { role: ['private-trial', 'private-interchange', 'managed-backup', 'managed-export', 'foreign-backup'][index],
      path, bytes: bytes[index], physical };
  }));
  return { protocolRows: f.sql.authorityGateRows(), generation: f.sql.storageGeneration(), files };
}

test('public deletion refuses changed retained publication binding or database generation before any purge', async t => {
  for (const { mutation, expectedCode } of proposedAuthorityGateCases) await t.test(mutation, async t => {
    let keychainRemovals = 0;
    const f = await publicDeleteFixture(t, { async store() {}, async remove() { keychainRemovals++; } }, true);
    const slot = hash(f.sourceDirectory), originalPublication = f.sql.custody(slot), authority = f.sql.authority(slot);
    assert.ok(originalPublication && authority);
    assert.equal(originalPublication.revision, 0);
    assert.ok(authority.envelope.revision > originalPublication.revision,
      'An explicit ordinary Vault snapshot update advances revision without rebinding original publication.');
    const changed = clone(originalPublication);
    if (mutation === 'operation-id') changed.operation_id = 'changed-operation-' + randomUUID();
    if (mutation === 'custody-storage-id') changed.storage_id = 'changed-custody-storage-' + randomUUID();
    if (mutation === 'target-physical') changed.target_identity.physical.birthtimeNs =
      String(BigInt(changed.target_identity.physical.birthtimeNs) + 1n);
    if (mutation === 'database-generation') f.sql.replaceStorageGeneration('changed-database-generation-' + randomUUID());
    else f.sql.setCustody(slot, changed);
    assert.deepEqual(f.sql.authority(slot), authority, 'Mutation retains exact creation and complete current ciphertext.');
    const before = await proposedAuthorityGateWitness(f);
    assert.ok(before.files.every(file => file.bytes && file.physical));
    let admissionAttempts = 0, destructiveAdmissions = 0, managedCallbacks = 0, adapterDeletes = 0;
    const admission = f.owned.withDeletionAdmission.bind(f.owned);
    f.owned.withDeletionAdmission = (expected, work) => {
      admissionAttempts++;
      return admission(expected, async () => { destructiveAdmissions++; return work(); });
    };
    const deleteAdapter = f.owned.delete.bind(f.owned);
    t.mock.method(f.owned, 'delete', async () => { adapterDeletes++; await deleteAdapter(); });
    const deleteVault = f.vault.delete.bind(f.vault);
    t.mock.method(f.vault, 'delete', (cleanup?: Parameters<Vault['delete']>[0]) => deleteVault(async input => {
      managedCallbacks++; if (cleanup) await cleanup(input);
    }));
    f.sql.events.length = 0;
    let refusal: unknown, submitted = 0;
    try { submitted++; await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name }); }
    catch (error) { refusal = error; f.expectFailure(error); }
    const after = await proposedAuthorityGateWitness(f);
    t.diagnostic(JSON.stringify({ mutation, expectedCode,
      observedCode: refusal instanceof ChausarError ? refusal.code : null,
      admissionAttempts, destructiveAdmissions, managedCallbacks, adapterDeletes,
      protocolRowsPreserved: canonical(before.protocolRows) === canonical(after.protocolRows),
      fileDigestsBefore: before.files.map(file => file.bytes && createHash('sha256').update(file.bytes).digest('hex')),
      fileDigestsAfter: after.files.map(file => file.bytes && createHash('sha256').update(file.bytes).digest('hex')) }));
    assert.equal(submitted, 1, 'Issue and settle one original request; never retry.');
    assert.ok(code(expectedCode)(refusal), 'The agreed exact typed refusal must occur.');
    assert.equal(admissionAttempts, 1);
    assert.equal(destructiveAdmissions, 0, 'No private inventory/removal work may be admitted.');
    assert.equal(managedCallbacks, 0, 'No managed application-copy callback may run.');
    assert.equal(adapterDeletes, 0); assert.equal(keychainRemovals, 0);
    assert.deepEqual(after, before, 'Complete protocol authority/custody/generation plus private/managed/foreign bytes and physical identities survive.');
    assert.equal(f.sql.events.filter(sql => /^(?:DELETE FROM|UPDATE|INSERT INTO) /.test(sql)).length, 0);
    assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
    assert.equal(f.sql.events.at(-1), 'ADAPTER_CLOSE');
    await assert.rejects(lstat(join(f.sourceDirectory, 'writer.lock')), { code: 'ENOENT' });
  });
});

test('valid original committed binding permits deletion after ordinary revision advances', async t => {
  const f = await publicDeleteFixture(t, undefined, true), slot = hash(f.sourceDirectory);
  const publication = f.sql.custody(slot), authority = f.sql.authority(slot), generation = f.sql.storageGeneration();
  assert.ok(publication && authority); assert.equal(publication.revision, 0);
  assert.ok(authority.envelope.revision > publication.revision);
  const foreignSlot = hash(join(f.root, 'journal')),
    foreign = { authority: f.sql.authority(foreignSlot), custody: f.sql.custody(foreignSlot) };
  let admitted = 0;
  const admission = f.owned.withDeletionAdmission.bind(f.owned);
  f.owned.withDeletionAdmission = (expected, work) => admission(expected, async () => {
    admitted++; assert.equal(f.owned.hasActiveLease, true);
    const result = await work(); assert.equal(f.owned.hasActiveLease, true); return result;
  });
  const result = await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name });
  assert.equal(result.deleted, true); assert.equal(admitted, 1);
  assert.deepEqual(result.copiesRemoved, f.expectedRemoved);
  assert.equal(f.sql.authority(slot), undefined); assert.deepEqual(f.sql.custody(slot), publication);
  assert.deepEqual(f.sql.storageGeneration(), generation);
  assert.deepEqual({ authority: f.sql.authority(foreignSlot), custody: f.sql.custody(foreignSlot) }, foreign);
  assert.deepEqual(await f.bytes(), [null, null, null, null, f.before.at(-1)]);
});

test('direct adapter.delete refuses changed admitted database generation without SQL deletion', async t => {
  const f = await publicDeleteFixture(t, undefined, true);
  f.sql.replaceStorageGeneration('changed-direct-delete-generation-' + randomUUID());
  const before = await proposedAuthorityGateWitness(f); f.sql.events.length = 0;
  let refusal: unknown;
  try { await f.owned.delete(); } catch (error) { refusal = error; }
  const after = await proposedAuthorityGateWitness(f);
  t.diagnostic(JSON.stringify({ control: 'direct-delete-generation',
    observedCode: refusal instanceof ChausarError ? refusal.code : null,
    protocolRowsPreserved: canonical(before.protocolRows) === canonical(after.protocolRows),
    sqlDeletes: f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length }));
  assert.ok(code('POSTGRES_STORAGE_CHANGED')(refusal));
  assert.deepEqual(after, before);
  assert.equal(f.sql.events.filter(sql => /^(?:DELETE FROM|UPDATE|INSERT INTO) /.test(sql)).length, 0);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
});

test('deleteIfCurrent reports mismatch for changed admitted generation and preserves revision-zero owned ciphertext', async t => {
  // Use an ordinary genuine revision-zero source, so existing committed-target
  // advanced-revision cleanup rules cannot make this generation control vacuous.
  const f = await fixture(t), slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
  assert.ok(authority); assert.equal(authority.envelope.revision, 0); assert.equal(f.sql.custody(slot), undefined);
  await f.sourceAdapter.load();
  f.sql.replaceStorageGeneration('changed-exact-cleanup-generation-' + randomUUID());
  const before = { protocolRows: f.sql.authorityGateRows(), generation: f.sql.storageGeneration(), state: f.source.read() };
  f.sql.events.length = 0;
  const outcome = await f.sourceAdapter.deleteIfCurrent(authority.envelope);
  const after = { protocolRows: f.sql.authorityGateRows(), generation: f.sql.storageGeneration(), state: f.source.read() };
  t.diagnostic(JSON.stringify({ control: 'exact-cleanup-generation', outcome,
    protocolRowsPreserved: canonical(before.protocolRows) === canonical(after.protocolRows),
    sqlDeletes: f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length }));
  assert.equal(outcome, 'mismatch', 'Stale logical generation preserves the existing cleanup mismatch contract.');
  assert.deepEqual(after, before);
  assert.equal(f.sql.events.filter(sql => /^(?:DELETE FROM|UPDATE|INSERT INTO) /.test(sql)).length, 0);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
});

test('direct adapter.delete refuses custody appearing after admitted absence without learning replacement ownership', async t => {
  const f = await fixture(t), slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
  assert.ok(authority); assert.equal(authority.envelope.revision, 0); assert.equal(f.sql.custody(slot), undefined);
  await f.sourceAdapter.load(); // Genuine occupied admission retains custody absence.
  const physical = await lstat(f.sourceDirectory, { bigint: true });
  f.sql.setCustody(slot, { slot, phase: 'committed', creation_id: authority.creation_id,
    vault_id: authority.envelope.id, operation_id: 'appeared-after-admitted-absence-' + randomUUID(),
    storage_id: f.sql.storageGeneration().storage_id, revision: 0,
    envelope_digest: postgresEnvelopeDigest(authority.envelope), envelope: authority.envelope,
    target_identity: { directory: f.sourceDirectory, physical: {
      dev: String(physical.dev), ino: String(physical.ino), birthtimeNs: String(physical.birthtimeNs),
    } } });
  const before = { protocolRows: f.sql.authorityGateRows(), generation: f.sql.storageGeneration(), state: f.source.read() };
  f.sql.events.length = 0; let refusal: unknown;
  try { await f.sourceAdapter.delete(); } catch (error) { refusal = error; }
  const after = { protocolRows: f.sql.authorityGateRows(), generation: f.sql.storageGeneration(), state: f.source.read() };
  t.diagnostic(JSON.stringify({ control: 'admitted-null-custody-appears',
    observedCode: refusal instanceof ChausarError ? refusal.code : null,
    protocolRowsPreserved: canonical(before.protocolRows) === canonical(after.protocolRows),
    sqlDeletes: f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length }));
  assert.ok(code('POSTGRES_AUTHORITY_CHANGED')(refusal));
  assert.deepEqual(after, before);
  assert.equal(f.sql.events.filter(sql => /^(?:DELETE FROM|UPDATE|INSERT INTO) /.test(sql)).length, 0);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
});

test('public PostgreSQL deletion refuses missing held-admission capability before any purge', async t => {
  const f = await publicDeleteFixture(t), slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
  assert.ok(authority);
  Object.defineProperty(f.owned, 'withDeletionAdmission', { value: undefined }); f.sql.events.length = 0;
  let refusal: unknown; try { await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name }); } catch (error) { refusal = error; f.expectFailure(error); }
  assert.deepEqual(await f.bytes(), f.before); assert.deepEqual(f.sql.authority(slot), authority);
  assert.ok(code('POSTGRES_DELETION_CUSTODY_REQUIRED')(refusal));
  assert.equal(f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length, 0);
});

test('public PostgreSQL deletion preflights both private purposes before deleting any managed copy', async t => {
  const f = await publicDeleteFixture(t), slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
  assert.ok(authority);
  await writeFile(join(f.sourceDirectory, 'private-artifacts', 'workspace-interchange', 'unclassified.txt'), 'synthetic unknown file');
  let refusal: unknown; try { await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name }); } catch (error) { refusal = error; f.expectFailure(error); }
  assert.ok(code('ARTIFACT_INVENTORY_INCOMPLETE')(refusal)); assert.deepEqual(await f.bytes(), f.before);
  assert.deepEqual(f.sql.authority(slot), authority);
});

test('public PostgreSQL deletion through Vault preflights both private purposes before its first unlink', async t => {
  // Direct Vault deletion owns a standalone handle. Borrowing Engine.vault here
  // would close it without running the Engine's own deletion lifecycle.
  const f = await fixture(t), vault = f.source, slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
  assert.ok(authority);
  const files = ['private-artifacts/private-trial/delete_trial.encrypted.json',
    'private-artifacts/workspace-interchange/delete_interchange.encrypted.json'].map(path => join(f.sourceDirectory, path));
  const prefix = `chausar-${vault.read().workspace.id}-`;
  await mkdir(join(f.root, 'backups')); await mkdir(join(f.root, 'exports'));
  files.push(join(f.root, 'backups', prefix + '1.backup'), join(f.root, 'exports', prefix + '2.json'),
    join(f.root, 'backups', `chausar-${f.options.journalVault.read().workspace.id}-3.backup`));
  await vault.backup(files[2]); await vault.export(files[3], { plaintext: true }); await f.options.journalVault.backup(files[4]);
  await vault.writeArtifact({ id: 'delete_trial', purpose: 'private-trial', value: { synthetic: 'private trial deletion evidence' }, expectedDigest: null });
  await vault.writeArtifact({ id: 'delete_interchange', purpose: 'workspace-interchange', value: { synthetic: 'private interchange deletion evidence' }, expectedDigest: null });
  const bytes = () => Promise.all(files.map(path => readFile(path))), before = await bytes();
  await writeFile(join(f.sourceDirectory, 'private-artifacts', 'workspace-interchange', 'unclassified.txt'), 'synthetic unknown file');
  let refusal: unknown; try { await vault.delete(); } catch (error) { refusal = error; f.expectShutdownFailure(vault, error); }
  assert.ok(code('ARTIFACT_INVENTORY_INCOMPLETE')(refusal)); assert.deepEqual(await bytes(), before);
  assert.deepEqual(f.sql.authority(slot), authority);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
  assert.throws(() => vault.read(), code('VAULT_CLOSED'));
  await assert.rejects(lstat(join(f.sourceDirectory, 'writer.lock')), { code: 'ENOENT' });
});

test('public PostgreSQL deletion preserves ordinary and committed deletion, copy reporting and foreign copies', async t => {
  for (const disposition of ['ordinary', 'committed']) await t.test(disposition, async t => {
    const f = await publicDeleteFixture(t, undefined, disposition === 'committed'), slot = hash(f.sourceDirectory), authority = f.sql.authority(slot);
    assert.ok(authority);
    const custodyBefore = f.sql.custody(slot); f.sql.events.length = 0;
    let heldWork = 0;
    const admission = f.owned.withDeletionAdmission?.bind(f.owned);
    if (admission) f.owned.withDeletionAdmission = (expected, work) => admission(expected, async () => {
      assert.equal(f.owned.hasActiveLease, true); assert.deepEqual(await f.bytes(), f.before); heldWork++;
      const result = await work();
      assert.equal(f.owned.hasActiveLease, true); assert.deepEqual(await f.bytes(), [null, null, null, null, f.before.at(-1)]);
      return result;
    });
    const result = await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name });
    assert.equal(result.deleted, true); assert.deepEqual(result.copiesRemoved, f.expectedRemoved);
    assert.equal(heldWork, 1, 'The actual owned adapter holds admission throughout every managed removal and SQL deletion.');
    assert.deepEqual(await f.bytes(), [null, null, null, null, f.before.at(-1)]);
    assert.equal(f.sql.authority(slot), undefined); assert.deepEqual(f.sql.custody(slot), custodyBefore);
    assert.equal(f.sql.events.filter(sql => sql === 'BEGIN').length, 1);
    assert.equal(f.sql.events.filter(sql => sql === 'COMMIT').length, 1);
    assert.equal(f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length, 1);
    assert.deepEqual(f.sql.events.slice(-3), ['COMMIT', 'RELEASE', 'ADAPTER_CLOSE']);
    assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
    assert.equal(f.engine.vault, null);
    await assert.rejects(lstat(join(f.sourceDirectory, 'writer.lock')), { code: 'ENOENT' });
  });
});

test('public PostgreSQL deletion captures its exact envelope after already accepted Vault writes drain', async t => {
  const f = await publicDeleteFixture(t), slot = hash(f.sourceDirectory), before = f.sql.authority(slot);
  assert.ok(before);
  let unblock!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { unblock = resolve; });
  const update = f.vault.update(async state => { entered(); await blocked; state.activity.push('Accepted before deletion'); });
  await waiting;
  let admittedRevision: number | undefined;
  const admission = f.owned.withDeletionAdmission?.bind(f.owned);
  if (admission) f.owned.withDeletionAdmission = (expected, work) => {
    admittedRevision = expected.revision; return admission(expected, work);
  };
  const deleting = f.engine.request('workspace.delete', { confirmation: f.state.workspace.name });
  unblock(); await update; await deleting;
  assert.equal(admittedRevision, before.revision + 1);
  assert.equal(f.sql.authority(slot), undefined);
  assert.deepEqual(await f.bytes(), [null, null, null, null, f.before.at(-1)]);
});

test('public PostgreSQL deletion revokes restatement custody before capturing its exact encrypted admission', async t => {
  const f = await publicDeleteFixture(t), slot = hash(f.sourceDirectory), context = { memberId: 'owner', role: 'owner' as const, epoch: 1 };
  await new OntologyService(f.vault).publish(context, 'ecommerce');
  // This is the actual pure calculator with its native verifier omitted. The
  // synthetic restatement context produces a complete encrypted receipt.
  const receipt = await new CalculatorService(f.vault, { restatement: { version: 1, interpretation: 'restated-private-diagnostic',
    trialId: 'synthetic_delete_trial', forkDigest: 'a'.repeat(64), candidateStateDigest: 'b'.repeat(64), publicationId: 'synthetic_delete_publication',
    originalAnswerId: 'synthetic_delete_original_answer', originalReceiptId: 'synthetic_delete_original_receipt' } }).calculate(context, { operation: 'net_sales' });
  const before = f.sql.authority(slot), admission = f.owned.withDeletionAdmission.bind(f.owned);
  assert.ok(before);
  let inspected = 0;
  f.owned.withDeletionAdmission = (expected, work) => admission(expected, async () => {
    assert.equal(expected.revision, before.revision + 1);
    const captured = await Vault.inspectPostgresSnapshot({ passphrase: credential, loadHeldEnvelope: async () => expected,
      async assertHeld() { assert.equal(f.owned.hasActiveLease, true); } });
    assert.deepEqual(captured.state.receipts, [receipt]);
    const tombstone = captured.state.tombstones.find(item => item.kind === 'private-restatement-custody');
    assert.ok(tombstone); assert.deepEqual(tombstone.receiptIds, [receipt.id]); assert.equal(tombstone.reason, 'managed-retention-or-deletion');
    inspected++; return work();
  });
  const result = await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name });
  assert.equal(inspected, 1); assert.deepEqual(result.copiesRemoved, f.expectedRemoved);
  assert.equal(f.sql.authority(slot), undefined); assert.deepEqual(await f.bytes(), [null, null, null, null, f.before.at(-1)]);
});

test('public PostgreSQL deletion commits authority removal before a failing keychain hook', async t => {
  const failure = new ChausarError('TEST_KEYCHAIN_REMOVAL_FAILED', 'Synthetic keychain removal failure.'), observed: { vaultId: string; leaseActive: boolean }[] = [];
  let f!: Awaited<ReturnType<typeof publicDeleteFixture>>;
  f = await publicDeleteFixture(t, { async store() {}, async remove(vaultId) {
    observed.push({ vaultId, leaseActive: f.owned.hasActiveLease }); f.sql.events.push('KEYCHAIN_REMOVE'); throw failure;
  } });
  const slot = hash(f.sourceDirectory), vaultId = f.vault.vaultId; f.sql.events.length = 0;
  let refusal: unknown; try { await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name }); } catch (error) { refusal = error; f.expectFailure(error); }
  t.diagnostic(JSON.stringify({ hookLeaseActive: observed.map(value => value.leaseActive), authorityPresent: !!f.sql.authority(slot),
    commitCount: f.sql.events.filter(sql => sql === 'COMMIT').length, rollbackCount: f.sql.events.filter(sql => sql === 'ROLLBACK').length }));
  assert.equal(refusal, failure);
  assert.equal(f.sql.authority(slot), undefined, 'A keychain failure cannot roll back admitted SQL deletion after managed files are purged.');
  assert.deepEqual(await f.bytes(), [null, null, null, null, f.before.at(-1)]);
  assert.deepEqual(observed, [{ vaultId, leaseActive: false }]);
  assert.equal(f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length, 1);
  assert.equal(f.sql.events.filter(sql => sql === 'COMMIT').length, 1); assert.equal(f.sql.events.filter(sql => sql === 'ROLLBACK').length, 0);
  assert.deepEqual(f.sql.events.slice(-4), ['COMMIT', 'RELEASE', 'KEYCHAIN_REMOVE', 'ADAPTER_CLOSE']);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
  assert.throws(() => f.vault.read(), code('VAULT_CLOSED')); await assert.rejects(lstat(join(f.sourceDirectory, 'writer.lock')), { code: 'ENOENT' });
});

test('public PostgreSQL deletion skips keychain removal when native admission or SQL commit fails', async t => {
  for (const condition of ['admission', 'commit']) await t.test(condition, async t => {
    let calls = 0;
    const f = await publicDeleteFixture(t, { async store() {}, async remove() { calls++; } }), slot = hash(f.sourceDirectory), before = f.sql.authority(slot);
    assert.ok(before);
    const commitFailure = new ChausarError('TEST_DELETE_COMMIT_FAILED', 'Synthetic SQL deletion commit failure.');
    if (condition === 'admission') f.sql.setCustody(slot, { slot, phase: 'prepared', creation_id: before.creation_id, vault_id: before.envelope.id });
    else f.sql.failNextCommit(commitFailure);
    f.sql.events.length = 0;
    let refusal: unknown; try { await f.engine.request('workspace.delete', { confirmation: f.state.workspace.name }); } catch (error) { refusal = error; f.expectFailure(error); }
    assert.ok(condition === 'admission' ? code('POSTGRES_TARGET_NOT_COMMITTED')(refusal) : refusal === commitFailure);
    assert.equal(calls, 0, 'Native admission and SQL acknowledgement must complete before calling keychain removal.');
    assert.deepEqual(f.sql.authority(slot), before);
    assert.deepEqual(await f.bytes(), condition === 'admission' ? f.before : [null, null, null, null, f.before.at(-1)]);
    assert.equal(f.sql.events.at(-1), 'ADAPTER_CLOSE'); assert.equal(f.sql.counts().active, 0);
    assert.equal(f.sql.counts().connects, f.sql.counts().releases);
  });
});

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

// Injected SQL protocol only. Reuse the green public fixture's actual encrypted
// publication, ordinary revision advance and five private/managed/foreign files.
// A fresh adapter encounters only the malformed first binding, never the original
// opened handle's retained valid custody. No native qualification is claimed.
test('ordinary admission refuses malformed pre-open committed physical target before direct deletion', async t => {
  const f = await publicDeleteFixture(t, undefined, true), slot = hash(f.sourceDirectory);
  const authority = f.sql.authority(slot), publication = f.sql.custody(slot);
  assert.ok(authority && publication); assert.equal(publication.phase, 'committed');
  assert.equal(publication.revision, 0); assert.equal(publication.envelope.revision, 0);
  assert.equal(publication.envelope_digest, postgresEnvelopeDigest(publication.envelope));
  assert.equal(authority.creation_id, publication.creation_id);
  assert.equal(authority.envelope.id, publication.vault_id);
  assert.ok(authority.envelope.revision > publication.revision, 'The green fixture genuinely advanced ordinary authority without changing original publication.');
  f.sql.setCustody(slot, { ...clone(publication), target_identity: {} }); // Sole unknown proof field.
  const fresh = await f.adapter(f.sourceDirectory); // Never reuse the bound public handle.
  const witness = async () => ({ protocolRows: f.sql.authorityGateRows(), generation: f.sql.storageGeneration(),
    files: await Promise.all(f.files.map(async path => {
      let bytes: Buffer | null = null, physical: Record<string, string> | null = null;
      try {
        bytes = await readFile(path); const stat = await lstat(path, { bigint: true });
        physical = Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs']
          .map(field => [field, String(stat[field as keyof typeof stat])]));
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      return { path, bytes, physical };
    })) });
  const before = await witness(); assert.equal(before.files.length, 5);
  assert.ok(before.files.every(file => file.bytes && file.physical));
  f.sql.events.length = 0; let refusal: unknown, loadedMalformed = false, deletionSubmissions = 0;
  try {
    try { assert.ok(await fresh.load()); loadedMalformed = true; } catch (error) { refusal = error; }
    if (loadedMalformed) {
      // An admitted unknown physical target still must refuse direct deletion.
      // Submit once; never retry an uncertain request or rebind the constructor.
      try { deletionSubmissions++; await fresh.delete(); } catch (error) { refusal = error; }
    }
  } finally { await fresh.close(); }
  const after = await witness();
  t.diagnostic(JSON.stringify({ control: 'malformed-preopen-target', loadedMalformed, deletionSubmissions,
    observedCode: refusal instanceof ChausarError ? refusal.code : null,
    protocolRowsPreserved: canonical(before.protocolRows) === canonical(after.protocolRows),
    sqlDeletes: f.sql.events.filter(sql => sql.startsWith('DELETE FROM ')).length }));
  assert.ok(code('POSTGRES_TARGET_NOT_COMMITTED')(refusal), 'Unknown committed physical proof refuses ordinary admission or deletion.');
  assert.ok(deletionSubmissions <= 1);
  assert.deepEqual(after, before, 'Full protocol proof/ciphertext/generation and private/managed/foreign byte/physical witnesses survive.');
  assert.equal(f.sql.events.filter(sql => /^(?:DELETE FROM|UPDATE|INSERT INTO) /.test(sql)).length, 0);
  assert.equal(f.sql.counts().active, 0); assert.equal(f.sql.counts().connects, f.sql.counts().releases);
});
