import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, ChausarError, type Context, type State } from '../runtime/contracts.ts';
import type { PostgresSnapshotAdapter } from '../runtime/postgres.ts';
import type { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { Vault, type EncryptedSnapshotAdapter, type PrivateArtifactRef, type VaultEnvelope } from '../runtime/vault.ts';
import {
  captureWorkspaceBackupV2, createWorkspaceBackupV2Host, inspectWorkspaceBackupV2, workspaceBackupV2Bytes,
  type WorkspaceBackupV2Budgets, type WorkspaceBackupV2HostPorts,
} from '../runtime/workspace-backup-v2.ts';
import { createWorkspaceBackupV2PostgresPorts } from '../runtime/workspace-backup-postgres.ts';

// These are injected SQL protocol fixtures with real Vault encryption and filesystem
// custody. They do not start PostgreSQL or prove native independent-writer exclusion.
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 4_000_000, maxEntryBytes: 1_000_000,
  maxTotalEntryBytes: 2_000_000, maxEntries: 100, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const filesystemBudgets = { maxFiles: 100, maxBytes: 4_000_000, maxDepth: 16 };
const encryptedBudgets = { maxEntryBytes: budgets.maxEntryBytes, maxTotalEntryBytes: budgets.maxTotalEntryBytes,
  maxArtifacts: budgets.maxEntries - 1 };
const externalKeyRequirements = [{ provider: 'other' as const, namespace: 'operator/credential-wrappers',
  requirement: 'Separately retain this synthetic fixture operator credential; no credentials are archived.' }];
const context: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: false };
const passphrase = 'Synthetic PostgreSQL backup protocol fixture passphrase';
const privateSecret = 'Synthetic PostgreSQL private artifact secret 874133';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identity = (ref: PrivateArtifactRef) => `${ref.purpose}/${ref.id}`;
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const typedRefusal = (error: unknown) => error instanceof ChausarError;

type AuthorityIdentity = { creationId: string; vaultId: string; revision: number; envelopeDigest: string };
type CatalogRelation = { schema: string; name: string; kind: string; oid: string; bytes: string; columns: string; definition: string; entries: number };
type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };
type FixtureLease = {
  readonly slot: string; readonly active: boolean;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  load(): Promise<VaultEnvelope | null>;
  commit(envelope: VaultEnvelope, expectedRevision: number | null): Promise<void>;
  authority(): Promise<AuthorityIdentity | null>;
  assertCurrent(expected: AuthorityIdentity): Promise<void>;
};

/** Ciphertext-only adapter using the frozen lease shape; all SQL results are authored. */
class ProtocolPostgresAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  readonly vaultSlot = 'fixture-source';
  readonly storage = { storageId: randomUUID(), databaseOid: '17000', database: 'synthetic_protocol_database',
    serverAddress: '127.0.0.1', serverPort: 55432, slot: this.vaultSlot };
  creationId = randomUUID();
  envelope: VaultEnvelope | null = null;
  catalog: CatalogRelation[] = [
    { schema: 'public', name: 'chausar_vault_authority', kind: 'r', oid: '17001', bytes: '8192', columns: '[["slot",25,-1,true],["envelope",3802,-1,true]]', definition: '{}', entries: 1 },
    { schema: 'public', name: 'chausar_workspace_postgres_storage', kind: 'r', oid: '17002', bytes: '8192', columns: '[["storage_id",25,-1,true]]', definition: '{}', entries: 1 },
    { schema: 'public', name: 'chausar_workspace_postgres_custody', kind: 'r', oid: '17003', bytes: '0', columns: '[["slot",25,-1,true],["phase",25,-1,true]]', definition: '{}', entries: 0 },
  ];
  readonly queries: string[] = [];
  readonly rowContents = new Map<string, unknown>();
  readonly unsupportedObjects: Record<string, unknown>[] = [];
  leaseCalls = 0;
  deleteCalls = 0;
  lastLease: FixtureLease | undefined;
  readonly #scope = new AsyncLocalStorage<FixtureLease>();
  get leaseActive() { return this.#scope.getStore()?.active === true; }

  async load() { return structuredClone(this.envelope); }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null) {
    if ((this.envelope?.revision ?? null) !== expectedRevision)
      throw new ChausarError('REVISION_CONFLICT', 'Synthetic adapter expected revision changed.');
    this.envelope = structuredClone(envelope);
  }
  async delete() { this.deleteCalls++; this.envelope = null; }
  async close() { /* Fixture ownership remains available for explicit Vault reopen. */ }
  async authority(): Promise<AuthorityIdentity | null> {
    return this.envelope ? { creationId: this.creationId, vaultId: this.envelope.id, revision: this.envelope.revision,
      envelopeDigest: sha(JSON.stringify(this.envelope)) } : null;
  }
  async withLease<T>(work: (lease: FixtureLease) => Promise<T>): Promise<T> {
    const nested = this.#scope.getStore();
    if (nested) { assert.equal(nested.active, true); return work(nested); }
    this.leaseCalls++; let active = true;
    const assertActive = () => {
      if (!active) throw new ChausarError('POSTGRES_LEASE_RELEASED', 'Synthetic native lease has been released.');
    };
    const lease: FixtureLease = {
      slot: this.vaultSlot, get active() { return active; },
      query: async (sql, values) => { assertActive(); return this.query(sql, values); },
      load: async () => { assertActive(); return this.load(); },
      commit: async (envelope, revision) => { assertActive(); return this.commit(envelope, revision); },
      authority: async () => { assertActive(); return this.authority(); },
      assertCurrent: async expected => {
        assertActive();
        if (JSON.stringify(await this.authority()) !== JSON.stringify(expected))
          throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'Synthetic slot incarnation or ciphertext changed.');
      },
    };
    this.lastLease = lease;
    try { return await this.#scope.run(lease, () => work(lease)); }
    finally { active = false; }
  }
  async query(sql: string, _values?: unknown[]): Promise<QueryResult> {
    this.queries.push(sql);
    if (/^SET LOCAL (?:statement_timeout|lock_timeout|row_security)/i.test(sql.trim())) return { rows: [], rowCount: 0 };
    if (/^LOCK TABLE /i.test(sql.trim())) {
      assert.ok(this.catalog.some(relation => sql.includes(`"${relation.schema}"."${relation.name}"`)) && / IN SHARE MODE$/.test(sql),
        `Fixture refuses unexpected relation lock query: ${sql}`);
      return { rows: [], rowCount: 0 };
    }
    if (/\bcount\s*\(/i.test(sql)) {
      const relation = this.catalog.find(item => sql.includes(item.name));
      assert.ok(relation, `Fixture refuses unexpected count query: ${sql}`);
      return { rows: [{ entries: String(relation.entries) }], rowCount: 1 };
    }
    if (/string_agg/.test(sql) && /sha256/.test(sql)) {
      const relation = this.catalog.find(item => sql.includes(item.name));
      assert.ok(relation, `Fixture refuses unexpected fingerprint query: ${sql}`);
      const fixtureRows = this.rowContents.has(relation.name) ? this.rowContents.get(relation.name)
        : relation.name === 'chausar_vault_authority' ? { creationId: this.creationId, envelope: this.envelope }
        : relation.name === 'chausar_workspace_postgres_storage' ? this.storage : [];
      return { rows: [{ generation: sha(JSON.stringify(fixtureRows)) }], rowCount: 1 };
    }
    if (/pg_type/.test(sql)) return { rows: structuredClone(this.unsupportedObjects), rowCount: this.unsupportedObjects.length };
    if (/pg_class/.test(sql)) return { rows: this.catalog.map(({ entries: _entries, ...entry }) => ({ ...entry })), rowCount: this.catalog.length };
    if (/pg_proc/.test(sql)) return { rows: [], rowCount: 0 };
    if (/pg_namespace/.test(sql)) {
      const rows = [...new Set(this.catalog.map(item => item.schema))].sort().map((schema, index) => ({ schema, oid: String(2200 + index), owner: '17000', acl: null }));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Fixture refuses unexpected SQL: ${sql}`);
  }
}

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate C-only scratch before creating fixture files.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-backup-postgres-protocol-')));
  assert.equal(dirname(applicationDirectory), base);
  const adapter = new ProtocolPostgresAdapter();
  const postgres = { storageIdentity: async () => {
    assert.equal(adapter.leaseActive, true, 'Actual storage identity must be read under the same held SQL source lease.');
    return structuredClone(adapter.storage);
  } };
  const created = await Vault.create({ directory: join(applicationDirectory, 'source'), storage: adapter,
    passphrase, name: 'Synthetic PostgreSQL backup protocol fixture', demo: true });
  let vault = created.vault, ownerRevoked = false;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(applicationDirectory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-postgres-protocol-'));
    await rm(actual, { recursive: true, force: true });
  });
  const assertCompleteOwner = async (current: Context, historical: State) => {
    if (ownerRevoked) throw new ChausarError('TEST_OWNER_REVOKED', 'Synthetic current complete-owner admission was revoked.');
    const member = authorize(vault, current, 'admin');
    assert.equal(member.role, 'owner'); assert.deepEqual(member.branches, ['*']);
    assert.equal(historical.workspace.id, vault.read().workspace.id);
  };
  const withCompleteOwner = async <T>(current: Context, historical: State,
    work: (assertCurrent: () => void) => Promise<T>): Promise<T> => {
    await assertCompleteOwner(current, historical);
    return vault.withCustodyWriterAdmission(work);
  };
  const postgresPorts = (options: Partial<Parameters<typeof createWorkspaceBackupV2PostgresPorts>[0]> = {}) => createWorkspaceBackupV2PostgresPorts({ vault,
    adapter: adapter as unknown as PostgresSnapshotAdapter,
    postgres: postgres as unknown as WorkspacePostgresCustody,
    applicationDirectory, budgets, filesystemBudgets, externalKeyRequirements, assertCompleteOwner, withCompleteOwner, ...options });
  const values = [
    ['trial_fork', 'private-trial', { type: 'private-trial-fork-v1', version: 1, secret: privateSecret }],
    ['trial_evaluation', 'private-trial', { type: 'private-trial-evaluation-v1', version: 1 }],
    ['trial_active', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'active' }],
    ['trial_discarded', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'discarded' }],
    ['trial_promoting', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'promoting' }],
    ['trial_promoted', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'promoted' }],
    ['wic_archive', 'workspace-interchange', { format: 'chausar.interchange-archive.v1' }],
    ['wic_pin', 'workspace-interchange', { format: 'chausar.interchange-custody-pin.v1' }],
    ['wic_commit', 'workspace-interchange', { format: 'chausar.interchange-local-binding.v1', state: 'committed' }],
    ['wic_tombstone', 'workspace-interchange', { format: 'chausar.interchange-local-binding.v1', state: 'discarded' }],
    ['wit_reservation', 'workspace-interchange', { format: 'chausar.interchange-target-reservation.v1' }],
  ] as const;
  for (const [id, purpose, value] of values) await vault.writeArtifact({ id, purpose, value, expectedDigest: null });
  // Original private envelope formatting remains byte evidence even though SQL authority is adapter-issued.
  const file = join(vault.directory, 'private-artifacts', 'private-trial', 'trial_fork.encrypted.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, `${JSON.stringify({ ciphertext: envelope.ciphertext, purpose: envelope.purpose, id: envelope.id,
    valueDigest: envelope.valueDigest, vaultId: envelope.vaultId, format: envelope.format }, null, 4)}\r\n`);
  const custody = postgresPorts(), host = createWorkspaceBackupV2Host(custody.ports, budgets);
  return { get vault() { return vault; }, adapter, applicationDirectory, custody, host, values, postgresPorts, recoveryCode: created.recoveryCode,
    revokeOwner() { ownerRevoked = true; },
    capture() { return vault.snapshot(() => adapter.withLease(() => vault.captureEncryptedCustody(encryptedBudgets))); },
    async reopen() {
      await vault.close(); vault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: adapter, passphrase });
      const reopened = postgresPorts(); return { custody: reopened, host: createWorkspaceBackupV2Host(reopened.ports, budgets) };
    } };
}

async function refs(vault: Vault) {
  return [...await vault.listArtifacts({ purpose: 'private-trial' }), ...await vault.listArtifacts({ purpose: 'workspace-interchange' })];
}

test('PG protocol fixture captures every authentic private status and measures separate encrypted archive, pin and binding across Vault reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), before = await f.capture(), state = f.vault.read();
  assert.equal(before.storageKind, 'postgres'); assert.equal(before.authorityKind, 'adapter-issued-envelope');
  const summary = await f.host.create(context, { destinationId: 'complete_protocol_backup', confirmed: true });
  assert.equal(summary.entries, f.values.length + 1); assert.equal(summary.fullWorkspacePortable, false);
  const retained = await f.custody.ports.custody.read(context, summary.recordId);
  const decoded = workspaceBackupV2Bytes(inspectWorkspaceBackupV2(retained.content, budgets), budgets);
  assert.deepEqual(decoded.authority, before.authority); assert.deepEqual(decoded.artifacts, before.artifacts);
  const sourceRequirement = decoded.externalKeyRequirements.find(item => item.provider === 'postgres' && item.namespace === 'database/source-slot');
  assert.ok(sourceRequirement, 'Actual SQL storage and slot incarnation must be retained separately from archive bodies.');
  for (const expected of [f.adapter.storage.storageId, f.adapter.storage.slot, f.adapter.creationId])
    assert.ok(sourceRequirement.requirement.includes(expected), `Source custody requirement must retain ${expected}.`);
  const previous = new Set(before.artifacts.map(item => identity(item.ref)));
  const added = (await refs(f.vault)).filter(ref => !previous.has(identity(ref)));
  assert.equal(added.length, 3, 'Archive, independent pin, and issuance binding need separate authenticated ciphertexts.');
  for (const ref of added) {
    const raw = await readFile(join(f.vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`), 'utf8');
    assert.equal(Buffer.byteLength(raw), ref.diskBytes);
    for (const secret of [privateSecret, passphrase, f.recoveryCode, retained.content]) assert.ok(!raw.includes(secret));
  }
  const measured = f.custody.custodyMeasurement(summary.recordId)!;
  assert.equal(measured.state, 'committed');
  assert.equal(measured.archiveCiphertextBytes, summary.measurement.archiveCiphertextBytes);
  assert.equal(measured.pinCiphertextBytes, summary.measurement.pinCiphertextBytes);
  assert.ok(measured.bindingCiphertextBytes > 0);
  assert.equal(measured.totalRetainedCiphertextBytes, added.reduce((bytes, ref) => bytes + ref.diskBytes, 0));
  const reopened = await f.reopen();
  assert.deepEqual(await reopened.custody.ports.custody.read(context, summary.recordId), retained);
  assert.deepEqual((await reopened.host.read(context, { backupId: summary.recordId })).sourcePin, retained.pin.sourcePin);
  assert.deepEqual(f.vault.read(), state);
  assert.equal(f.adapter.lastLease?.active, false);
  await assert.rejects(f.adapter.lastLease!.query('SELECT protocol_fixture'), code('POSTGRES_LEASE_RELEASED'));
  assert.ok(f.adapter.queries.some(sql => /pg_namespace/.test(sql) && /pg_class/.test(sql)));
  assert.ok(f.adapter.queries.some(sql => /^LOCK TABLE /.test(sql)), 'Complete capture must invoke its relation-writer fence through the held SQL lease.');
  assert.equal(f.adapter.deleteCalls, 0);
  t.diagnostic(JSON.stringify({ evidence: 'injected-postgres-protocol-fixture', realVaultEncryption: true,
    adapterIssuedAuthority: true, completeTypedArtifacts: true, reopened: true, fullWorkspacePortable: false, nativeQualified: false }));
});

test('PG protocol fixture restores complete inert archive and reads exact reservation and receipt through another Vault reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'inert_backup', confirmed: true });
  const retained = await f.custody.ports.custody.read(context, summary.recordId);
  const receipt = await f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'inert_target', reviewedDigest: summary.archiveDigest });
  assert.equal(receipt.inert, true); assert.equal(receipt.activation, 'root-only'); assert.equal(receipt.entries, summary.entries);
  const target = f.custody.targetPath(receipt.targetId);
  assert.deepEqual(await readdir(target), ['backup.inert.json']);
  assert.equal(JSON.parse(await readFile(join(target, 'backup.inert.json'), 'utf8')).content, retained.content);
  const reopened = await f.reopen();
  const readback = await reopened.host.readRestored(context, { backupId: summary.recordId, targetId: receipt.targetId,
    creationId: receipt.creationId, reviewedDigest: summary.archiveDigest });
  assert.deepEqual(readback.receipt, receipt);
  assert.deepEqual(await reopened.custody.restoredIdentity(context, receipt.targetId), {
    targetId: receipt.targetId, creationId: receipt.creationId, archiveDigest: receipt.archiveDigest });
  await assert.rejects(Vault.open({ directory: target, storage: 'experimental-file', passphrase }), code('UNLOCK_FAILED'));
  assert.deepEqual(await readdir(target), ['backup.inert.json']);
  assert.equal(f.adapter.deleteCalls, 0);
});

test('PG protocol fixture pins slot incarnation and refuses identical encrypted authority after delete/recreate ABA', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'incarnation_backup', confirmed: true });
  const receipt = await f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'incarnation_inert_target',
    reviewedDigest: summary.archiveDigest });
  const before = await refs(f.vault);
  const pin = await f.custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets).pin);
  let admitted = 0;
  await f.custody.ports.withSource(context, pin, async () => { admitted++; });
  assert.equal(admitted, 1);
  const original = await f.adapter.authority(); f.adapter.creationId = randomUUID();
  assert.equal((await f.adapter.authority())!.envelopeDigest, original!.envelopeDigest);
  await assert.rejects(f.custody.ports.withSource(context, pin, async () => { admitted++; }), typedRefusal);
  assert.equal(admitted, 1, 'Unchanged revision/ciphertext must not admit a replacement slot incarnation.');
  await assert.rejects(f.host.read(context, { backupId: summary.recordId }), code('BACKUP_SOURCE_CHANGED'));
  await assert.rejects(f.custody.ports.custody.read(context, summary.recordId), code('BACKUP_SOURCE_CHANGED'));
  await assert.rejects(f.custody.ports.restore.readRestored(context, { targetId: receipt.targetId,
    creationId: receipt.creationId }), code('BACKUP_SOURCE_CHANGED'));
  await assert.rejects(f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'stale_incarnation_target',
    reviewedDigest: summary.archiveDigest }), code('BACKUP_SOURCE_CHANGED'));
  await assert.rejects(lstat(f.custody.targetPath('stale_incarnation_target')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(f.custody.targetPath(receipt.targetId)), ['backup.inert.json'], 'Stale read refusal retains inert evidence.');
  assert.deepEqual(await refs(f.vault), before);
});

test('PG protocol fixture independently detects SQL catalog generation changes and refuses unclassified relations', async t => {
  for (const change of ['changed-generation', 'changed-definition', 'changed-row-content', 'unclassified-relation', 'unclassified-type', 'unclassified-object'] as const) await t.test(change, async sub => {
    const f = await fixture(sub), before = await refs(f.vault);
    if (change === 'changed-row-content') {
      f.adapter.catalog.push({ schema: 'chausar_core', name: 'reviewed_fixture_rows', kind: 'r', oid: '18003', bytes: '4096', columns: '[["value",25,-1,true]]', definition: '{}', entries: 1 });
      f.adapter.rowContents.set('reviewed_fixture_rows', [{ value: 'original' }]);
    }
    const pin = await f.custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets).pin);
    if (change === 'changed-generation') f.adapter.catalog[0].oid = '18001';
    else if (change === 'changed-definition') f.adapter.catalog[0].definition = '{"owner":18000}';
    else if (change === 'changed-row-content') f.adapter.rowContents.set('reviewed_fixture_rows', [{ value: 'changed' }]);
    else if (change === 'unclassified-relation') f.adapter.catalog.push({ schema: 'public', name: 'unclassified_business_view', kind: 'v', oid: '18002', bytes: '0', columns: '[]', definition: '{}', entries: 0 });
    else if (change === 'unclassified-type') f.adapter.unsupportedObjects.push({ kind: 'type', oid: '18006' });
    else f.adapter.unsupportedObjects.push({ kind: 'trigger', oid: '18004' });
    let admitted = false;
    await assert.rejects(f.custody.ports.withSource(context, pin, async () => { admitted = true; }), typedRefusal);
    assert.equal(admitted, false); assert.deepEqual(await refs(f.vault), before);
    if (change === 'unclassified-relation' || change === 'unclassified-type' || change === 'unclassified-object') {
      await assert.rejects(f.host.create(context, { destinationId: 'unclassified_catalog_backup', confirmed: true }), code('BACKUP_SQL_INVENTORY_REQUIRED'));
      assert.deepEqual(await refs(f.vault), before);
    }
  });
});

test('PG protocol fixture refuses aggregate SQL row budget without truncating or publishing a partial inventory', async t => {
  const f = await fixture(t), before = await refs(f.vault);
  f.adapter.catalog.push({ schema: 'chausar_core', name: 'reviewed_fixture_rows', kind: 'r', oid: '18005', bytes: '0',
    columns: '[["value",25,-1,true]]', definition: '{}', entries: filesystemBudgets.maxFiles - 1 });
  await assert.rejects(f.host.create(context, { destinationId: 'over_sql_row_budget', confirmed: true }), code('BACKUP_LIMIT'));
  assert.deepEqual(await refs(f.vault), before);
});

test('PG protocol fixture rechecks current owner after awaited archive reads before target allocation', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'owner_backup', confirmed: true });
  let reads = 0;
  const ports: WorkspaceBackupV2HostPorts = { ...f.custody.ports, custody: { ...f.custody.ports.custody,
    async read(...args) { const result = await f.custody.ports.custody.read(...args); if (++reads === 2) f.revokeOwner(); return result; } } };
  await assert.rejects(createWorkspaceBackupV2Host(ports, budgets).restoreInert(context, {
    backupId: summary.recordId, targetId: 'revoked_owner_target', reviewedDigest: summary.archiveDigest }), code('TEST_OWNER_REVOKED'));
  await assert.rejects(lstat(f.custody.targetPath('revoked_owner_target')), { code: 'ENOENT' });
});

test('PG protocol fixture refuses occupied targets and preserves unrelated work', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'occupied_backup', confirmed: true });
  const target = f.custody.targetPath('occupied_target'); await mkdir(target);
  const file = join(target, 'unrelated-work.txt'); await writeFile(file, 'Synthetic competing target occupant');
  await assert.rejects(f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'occupied_target', reviewedDigest: summary.archiveDigest }), typedRefusal);
  assert.equal(await readFile(file, 'utf8'), 'Synthetic competing target occupant');
  assert.deepEqual(await readdir(target), ['unrelated-work.txt']);
});

test('PG protocol fixture detects a replaced restored target and exact rollback preserves its competing occupant', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'replaced_backup', confirmed: true });
  const receipt = await f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'replaced_target', reviewedDigest: summary.archiveDigest });
  const target = f.custody.targetPath(receipt.targetId), original = join(f.applicationDirectory, 'retained-original-target');
  await rename(target, original); await mkdir(target); await writeFile(join(target, 'competing.txt'), 'Synthetic replacement occupant');
  await assert.rejects(f.custody.ports.restore.readRestored(context, { targetId: receipt.targetId, creationId: receipt.creationId }), typedRefusal);
  await assert.rejects(f.custody.ports.restore.rollback(context, { targetId: receipt.targetId, creationId: receipt.creationId,
    expectedArchiveDigest: receipt.archiveDigest }), typedRefusal);
  assert.equal(await readFile(join(target, 'competing.txt'), 'utf8'), 'Synthetic replacement occupant');
  assert.deepEqual(await readdir(original), ['backup.inert.json']);
  assert.equal(f.adapter.deleteCalls, 0);
});

test('PG protocol fixture rolls back only its exact inert publication after altered readback and retains single-use reservation', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'rollback_backup', confirmed: true });
  const retained = await f.custody.ports.custody.read(context, summary.recordId);
  const ports: WorkspaceBackupV2HostPorts = { ...f.custody.ports, restore: { ...f.custody.ports.restore,
    async readRestored(...args) { const result = await f.custody.ports.restore.readRestored(...args); return { ...result, content: `${result.content} ` }; } } };
  await assert.rejects(createWorkspaceBackupV2Host(ports, budgets).restoreInert(context, {
    backupId: summary.recordId, targetId: 'rolled_back_target', reviewedDigest: summary.archiveDigest }), code('BACKUP_CANONICAL'));
  assert.deepEqual(await readdir(f.custody.targetPath('rolled_back_target')), []);
  assert.deepEqual(await f.custody.ports.custody.read(context, summary.recordId), retained);
  await assert.rejects(f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'rolled_back_target', reviewedDigest: summary.archiveDigest }), code('BACKUP_TARGET_EXISTS'));
  assert.equal(f.adapter.deleteCalls, 0);
});

test('PG protocol fixture refuses byte-identical replacement container during direct read and rollback while retaining the replacement inode', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'container_identity_backup', confirmed: true });
  const receipt = await f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'container_identity_target', reviewedDigest: summary.archiveDigest });
  const target = f.custody.targetPath(receipt.targetId), inert = join(target, 'backup.inert.json');
  const original = await lstat(inert, { bigint: true }), bytes = await readFile(inert);
  const replacement = join(target, 'replacement.fixture'); await writeFile(replacement, bytes); await rename(replacement, inert);
  const replaced = await lstat(inert, { bigint: true }); assert.notEqual(replaced.ino, original.ino);
  await assert.rejects(f.custody.ports.restore.readRestored(context, { targetId: receipt.targetId, creationId: receipt.creationId }), code('BACKUP_TARGET_CHANGED'));
  await assert.rejects(f.custody.ports.restore.rollback(context, { targetId: receipt.targetId, creationId: receipt.creationId,
    expectedArchiveDigest: receipt.archiveDigest }), code('BACKUP_TARGET_CHANGED'));
  assert.deepEqual(await readFile(inert), bytes); assert.equal((await lstat(inert, { bigint: true })).ino, replaced.ino);
  assert.deepEqual(await readdir(target), ['backup.inert.json']); assert.equal(f.adapter.deleteCalls, 0);
});

test('PG protocol fixture retains byte-identical replacement after possible inert publication and reports cleanup required', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'post_link_backup', confirmed: true });
  const targetId = 'post_link_replaced_target', target = f.custody.targetPath(targetId), inert = join(target, 'backup.inert.json');
  let replacementBytes: Buffer | undefined, replacementInode: bigint | undefined, admissionCalls = 0;
  const custody = f.postgresPorts({ withCompleteOwner: async (_current, _historical, work) =>
    f.vault.withCustodyWriterAdmission(async assertCurrent => {
      admissionCalls++; await work(assertCurrent);
      const original = await lstat(inert, { bigint: true }); replacementBytes = await readFile(inert);
      const replacement = join(target, 'replacement.fixture'); await writeFile(replacement, replacementBytes); await rename(replacement, inert);
      replacementInode = (await lstat(inert, { bigint: true })).ino;
      assert.notEqual(replacementInode, original.ino);
      throw new Error('Synthetic post-link root acknowledgement failure after replacement');
    }) });
  const host = createWorkspaceBackupV2Host(custody.ports, budgets);
  await assert.rejects(host.restoreInert(context, { backupId: summary.recordId, targetId, reviewedDigest: summary.archiveDigest }), code('BACKUP_RESTORE_CLEANUP_REQUIRED'));
  assert.equal(admissionCalls, 1); assert.ok(replacementBytes); assert.ok(replacementInode);
  assert.deepEqual(await readFile(inert), replacementBytes); assert.equal((await lstat(inert, { bigint: true })).ino, replacementInode);
  assert.deepEqual(await readdir(target), ['backup.inert.json']);
  await assert.rejects(f.host.restoreInert(context, { backupId: summary.recordId, targetId, reviewedDigest: summary.archiveDigest }), code('BACKUP_TARGET_EXISTS'));
  assert.equal(f.adapter.deleteCalls, 0);
});

test('PG protocol fixture resolves lost encrypted archive-write acknowledgement through exact authenticated readback without replay', async t => {
  const f = await fixture(t), before = await f.capture(), write = f.vault.writeArtifact.bind(f.vault);
  const archiveId = `wb2_${sha('lost_archive_ack')}_archive`; let archiveWrites = 0, injected = false;
  f.vault.writeArtifact = async input => {
    const result = await write(input);
    if (input.id === archiveId) {
      archiveWrites++;
      if (!injected) { injected = true; throw new Error('Synthetic lost encrypted archive acknowledgement'); }
    }
    return result;
  };
  const summary = await f.host.create(context, { destinationId: 'lost_archive_ack', confirmed: true });
  assert.equal(injected, true); assert.equal(archiveWrites, 1);
  assert.equal((await f.custody.ports.custody.read(context, summary.recordId)).pin.archiveDigest, summary.archiveDigest);
  assert.equal(f.custody.custodyMeasurement(summary.recordId)!.state, 'committed');
  const after = await f.capture(); assert.deepEqual(after.authority, before.authority);
  for (const entry of before.artifacts) assert.deepEqual(after.artifacts.find(item => identity(item.ref) === identity(entry.ref)), entry);
  assert.equal(after.artifacts.length, before.artifacts.length + 3);
  const reopened = await f.reopen();
  assert.equal((await reopened.host.read(context, { backupId: summary.recordId })).summary.archiveDigest, summary.archiveDigest);
  await assert.rejects(reopened.host.create(context, { destinationId: summary.recordId, confirmed: true }), code('BACKUP_OUTPUT_EXISTS'));
  assert.equal(archiveWrites, 1); assert.equal(f.adapter.deleteCalls, 0);
});
