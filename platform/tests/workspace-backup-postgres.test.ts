import test, { type TestContext } from 'node:test';
import { ProtocolPostgresAdapter } from './fixtures/workspace-backup-postgres-protocol.ts';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { promises as filesystem } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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

test('PG protocol fixture preserves default held-source slot-only admission without constructor relation exclusion', async t => {
  const f = await fixture(t), queries = f.adapter.queries.length;
  await f.custody.withHeldSource(context, async () => {
    assert.equal(f.adapter.leaseActive, true); await f.custody.inspectHeldNamespaces();
  });
  assert.ok(!f.adapter.queries.slice(queries).some(sql => /^LOCK TABLE /.test(sql)));
});

test('PG protocol fixture constructor SHARE exclusion precedes measurement/callback and remains through final guard and lease exit', async t => {
  const f = await fixture(t), events: string[] = [], held = new Set<string>();
  const query = f.adapter.query.bind(f.adapter), withLease = f.adapter.withLease.bind(f.adapter);
  let callbackFinished = false, observedPrelockDrift = false;
  f.adapter.query = async (sql, values) => {
    assert.equal(f.adapter.leaseActive, true);
    if (/^LOCK TABLE /.test(sql)) {
      const name = f.adapter.catalog.find(row => sql.includes(`"${row.schema}"."${row.name}"`))!.name;
      held.add(name); events.push(`lock:${name}`);
      if (!observedPrelockDrift) {
        // A maintenance-sized change before exclusion is part of the initial
        // under-lock measurement, never a stale pre-lock physical baseline.
        f.adapter.catalog[0].bytes = '16384'; observedPrelockDrift = true;
      }
    } else if (/pg_total_relation_size|\bCOUNT\(|string_agg|pg_attribute/.test(sql)) {
      assert.equal(held.size, f.adapter.catalog.length, 'Measure only after every ordinary relation is excluded.');
      events.push('measurement');
    } else if (/pg_class/.test(sql)) events.push('discovery');
    return query(sql, values);
  };
  f.adapter.withLease = async work => {
    if (f.adapter.leaseActive) return withLease(work);
    events.push('lease-enter');
    try {
      return await withLease(lease => work({ ...lease, assertCurrent: async expected => {
        if (callbackFinished) {
          assert.equal(held.size, f.adapter.catalog.length); events.push('final-authority-guard');
        }
        await lease.assertCurrent(expected);
      } }));
    } finally { events.push('lease-exit'); held.clear(); }
  };
  const custody = f.postgresPorts({ heldSourceSqlExclusion: 'share-relations' });
  await custody.withHeldSource(context, async () => {
    events.push('callback-enter'); assert.equal(held.size, f.adapter.catalog.length);
    const measured = await custody.inspectHeldNamespaces();
    const relation = measured.postgres.catalog.find(value => (value as CatalogRelation).name === 'chausar_vault_authority') as CatalogRelation;
    assert.equal(relation.bytes, 16384); assert.equal(relation.entries, 1);
    assert.match((relation as unknown as { generation: string }).generation, /^[a-f0-9]{64}$/);
    await custody.withHeldSource(context, async () => { assert.equal(held.size, f.adapter.catalog.length); });
    callbackFinished = true; events.push('callback-exit');
  });
  const locks = events.flatMap((event, index) => event.startsWith('lock:') ? [index] : []);
  assert.equal(locks.length, f.adapter.catalog.length, 'Nested readers reuse the retained SQL exclusion.');
  assert.ok(locks.every(index => index < events.indexOf('callback-enter') && index < events.indexOf('measurement')));
  assert.ok(events.lastIndexOf('discovery') > events.indexOf('callback-exit'), 'Final relation identity admission remains required.');
  assert.ok(events.indexOf('final-authority-guard') > events.indexOf('callback-exit'));
  assert.ok(events.indexOf('final-authority-guard') < events.indexOf('lease-exit'));
  assert.equal(f.adapter.lastLease?.active, false); assert.equal(held.size, 0);
});

test('PG protocol fixture SHARE acquisition refuses replaced identities before callback and releases its lease', async t => {
  const f = await fixture(t), query = f.adapter.query.bind(f.adapter); let changed = false, entered = false;
  f.adapter.query = async (sql, values) => {
    const result = await query(sql, values);
    if (/^LOCK TABLE /.test(sql) && !changed) { changed = true; f.adapter.catalog[0].oid = '18001'; }
    return result;
  };
  const custody = f.postgresPorts({ heldSourceSqlExclusion: 'share-relations' });
  await assert.rejects(custody.withHeldSource(context, async () => { entered = true; }), code('BACKUP_SOURCE_CHANGED'));
  assert.equal(changed, true); assert.equal(entered, false); assert.equal(f.adapter.lastLease?.active, false);
});

test('PG protocol fixture revoked complete-owner admission refuses constructor relation locks before callback', async t => {
  const f = await fixture(t), custody = f.postgresPorts({ heldSourceSqlExclusion: 'share-relations' });
  const queries = f.adapter.queries.length; let entered = false; f.revokeOwner();
  await assert.rejects(custody.withHeldSource(context, async () => { entered = true; }), code('TEST_OWNER_REVOKED'));
  assert.equal(entered, false); assert.equal(f.adapter.lastLease?.active, false);
  assert.ok(!f.adapter.queries.slice(queries).some(sql => /^LOCK TABLE /.test(sql)), 'Rejected complete-owner context cannot acquire broader source relation exclusion.');
});

test('PG protocol fixture constructor SHARE exclusion retains physical/schema/count/row-generation and final relation-set refusals', async t => {
  for (const change of ['physical-size', 'definition', 'row-count', 'row-content', 'new-relation'] as const) await t.test(change, async sub => {
    const f = await fixture(sub), custody = f.postgresPorts({ heldSourceSqlExclusion: 'share-relations' });
    await assert.rejects(custody.ports.withSource(context, null, async lease => {
      if (change === 'physical-size') f.adapter.catalog[0].bytes = String(Number(f.adapter.catalog[0].bytes) + 8192);
      else if (change === 'definition') f.adapter.catalog[0].definition = '{"owner":18000}';
      else if (change === 'row-count') f.adapter.catalog[0].entries++;
      else if (change === 'row-content') f.adapter.rowContents.set(f.adapter.catalog[0].name, { explicitInjectedReplacement: true });
      else f.adapter.catalog.push({ schema: 'public', name: 'new_unheld_table', kind: 'r', oid: '18009', bytes: '0', columns: '[]', definition: '{}', entries: 0 });
      await lease.assertCurrent();
    }), code('BACKUP_SOURCE_CHANGED'));
    assert.equal(f.adapter.lastLease?.active, false);
    assert.ok(!f.adapter.queries.some(sql => /^LOCK TABLE "pg_toast"/.test(sql)), 'Never invent unsupported SQL TOAST locking.');
  });
});

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

test('PG protocol fixture preflights the complete private batch before opening any ciphertext', async t => {
  for (const refusal of ['count', 'aggregate-bytes', 'late-hardlink'] as const) await t.test(refusal, async sub => {
    const f = await fixture(sub), directory = join(f.vault.directory, 'private-artifacts', 'private-trial');
    const names = (await readdir(directory)).sort(), first = join(directory, names[0]), last = join(directory, names.at(-1)!);
    const corrupt = Buffer.from('Synthetic invalid ciphertext that must not be opened before complete preflight.');
    await writeFile(first, corrupt);
    const writer = join(f.vault.directory, 'writer.lock');
    const privateSizes = await Promise.all(names.map(async name => (await lstat(join(directory, name))).size));
    const restricted = { ...filesystemBudgets };
    if (refusal === 'count') restricted.maxFiles = 2; // Writer plus one private leaf: later entries exceed admission.
    else if (refusal === 'aggregate-bytes') restricted.maxBytes = (await lstat(writer)).size + privateSizes.reduce((sum, size) => sum + size, 0) - 1;
    else await link(last, join(f.applicationDirectory, 'retained-hardlink-evidence'));
    const custody = f.postgresPorts({ filesystemBudgets: restricted });
    let privateOpens = 0, writerOpens = 0;
    const originalOpen = filesystem.open;
    // Observe genuine regular-file opens, preserving the actual filesystem operation.
    filesystem.open = async (...args) => {
      if (typeof args[0] === 'string') {
        if (args[0].startsWith(`${directory}\\`) || args[0].startsWith(`${directory}/`)) privateOpens++;
        if (args[0] === writer) writerOpens++;
      }
      return originalOpen(...args);
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(custody.withHeldSource(context, () => custody.inspectHeldNamespaces()),
        code(refusal === 'late-hardlink' ? 'BACKUP_UNSAFE_FILE' : 'BACKUP_LIMIT'));
    } finally { filesystem.open = originalOpen; syncBuiltinESMExports(); }
    assert.ok(writerOpens > 0, 'The observer must see the actual runtime reader, rather than an unrelated file API.');
    assert.equal(privateOpens, 0, 'No earlier ciphertext may open while a later private leaf fails complete admission.');
    assert.deepEqual(await readFile(first), corrupt, 'Refusal preserves corrupt evidence without rewriting or publishing.');
    assert.deepEqual((await readdir(directory)).sort(), names);
    assert.equal(f.adapter.lastLease?.active, false); assert.equal(f.adapter.deleteCalls, 0);
    if (refusal === 'late-hardlink') assert.equal((await lstat(last, { bigint: true })).nlink, 2n);
  });
});

test('PG protocol fixture keeps zero-byte wider files measured outside the private ciphertext batch', async t => {
  const f = await fixture(t), directory = join(f.vault.directory, 'reports');
  await mkdir(directory); await writeFile(join(directory, 'empty.txt'), '');
  const inventory = await f.custody.withHeldSource(context, () => f.custody.inspectHeldNamespaces());
  const empty = inventory.files.find(item => item.path === 'workspace/reports/empty.txt');
  assert.ok(empty); assert.equal(empty.bytes, 0); assert.equal(empty.sha256, sha(''));
  const wider = inventory.namespaces.find(item => item.namespace === 'workspace/reports');
  assert.ok(wider); assert.equal(wider.disposition, 'outside-archive'); assert.equal(wider.entries, 1); assert.equal(wider.bytes, 0);
  assert.equal(inventory.files.filter(item => item.path.startsWith('private-artifacts/')).length, f.values.length);
  assert.equal(f.adapter.lastLease?.active, false); assert.equal(f.adapter.deleteCalls, 0);
});

test('PG protocol fixture wider filesystem leaves overlap through at most four actual readers', { timeout: 10_000 }, async t => {
  const f = await fixture(t), directory = join(f.vault.directory, 'reports'); await mkdir(directory);
  const names = Array.from({ length: 6 }, (_, index) => `report_${index}.txt`);
  await Promise.all(names.map((name, index) => writeFile(join(directory, name), `synthetic report ${index}`)));
  const nestedDirectory = join(directory, 'report_4_directory'); await mkdir(nestedDirectory);
  const nestedPath = join(nestedDirectory, 'nested.txt'); await writeFile(nestedPath, '');
  const paths = new Set(names.map(name => join(directory, name))), handles: Awaited<ReturnType<typeof filesystem.open>>[] = [];
  const originalOpen = filesystem.open;
  let active = 0, peak = 0, release!: () => void;
  const pendingReaders = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [], events: string[] = [];
  // A serial reader must eventually drain too, leaving an explicit peak=1 red
  // assertion rather than an unresolved test. Four admitted readers release early.
  const timer = setTimeout(release, 1000);
  filesystem.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (typeof args[0] === 'string' && (paths.has(args[0]) || args[0] === nestedPath)) {
      const path = args[0], report = paths.has(path), read = handle.read.bind(handle), close = handle.close.bind(handle);
      let first = true, closed = false;
      if (report) handles.push(handle);
      handle.close = async () => {
        await close(); if (!closed) { closed = true; events.push(`closed:${path}`); }
      };
      handle.read = (async (buffer: Buffer, offset: number, length: number, position: number | null) => {
        if (!first) return read(buffer, offset, length, position);
        first = false; events.push(`read:${path}`);
        if (!report) return read(buffer, offset, length, position);
        started.push(path); active++; peak = Math.max(peak, active);
        if (active === 4) setImmediate(release);
        try { await pendingReaders; return await read(buffer, offset, length, position); }
        finally { active--; }
      }) as typeof handle.read;
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    const inventory = await f.custody.withHeldSource(context, () => f.custody.inspectHeldNamespaces());
    t.diagnostic(JSON.stringify({ actualWiderReaders: handles.length, peakReaders: peak, nativeQualified: false }));
    assert.equal(peak, 4, 'The wider tree must call the bounded leaf batch rather than retaining files serially.');
    assert.equal(active, 0); assert.equal(handles.length, 6); assert.ok(handles.every(handle => handle.fd === -1));
    assert.deepEqual(started.sort(), [...paths].sort());
    for (const name of names.slice(0, 5)) {
      assert.ok(events.indexOf(`closed:${join(directory, name)}`) < events.indexOf(`read:${nestedPath}`),
        'Flush and close the entire contiguous sibling batch before serial directory descent.');
    }
    assert.ok(events.indexOf(`closed:${nestedPath}`) < events.indexOf(`read:${join(directory, names[5])}`));
    const leaves = inventory.files.filter(item => item.path.startsWith('workspace/reports/'));
    assert.deepEqual(leaves.map(item => item.path), [
      ...names.map(name => `workspace/reports/${name}`), 'workspace/reports/report_4_directory/nested.txt',
    ].sort((a, b) => a.localeCompare(b)), 'Public witnesses retain their established deterministic ordering.');
    for (let index = 0; index < names.length; index++) {
      assert.equal(leaves.find(item => item.path === `workspace/reports/${names[index]}`)!.sha256, sha(`synthetic report ${index}`));
    }
    assert.equal(leaves.find(item => item.path.endsWith('/nested.txt'))!.bytes, 0);
    assert.equal(f.adapter.lastLease?.active, false);
  } finally {
    clearTimeout(timer); release(); filesystem.open = originalOpen; syncBuiltinESMExports();
    await Promise.all(handles.map(handle => handle.close()));
  }
});

test('PG protocol fixture wider leaf batches preflight count, bytes and late hardlinks before opening earlier leaves', async t => {
  for (const refusal of ['count', 'aggregate-bytes', 'late-hardlink'] as const) await t.test(refusal, async sub => {
    const f = await fixture(sub), directory = join(f.vault.directory, 'reports'); await mkdir(directory);
    const names = Array.from({ length: 6 }, (_, index) => `report_${index}.txt`);
    const bytes = Buffer.from('synthetic wider evidence preserved on complete-batch refusal');
    await Promise.all(names.map(name => writeFile(join(directory, name), bytes)));
    const writer = join(f.vault.directory, 'writer.lock'), sourceRefs = await refs(f.vault);
    const restricted = { ...filesystemBudgets };
    if (refusal === 'count') restricted.maxFiles = f.values.length + 3; // All private leaves, writer, reports directory, and one report.
    else if (refusal === 'aggregate-bytes') {
      restricted.maxBytes = (await lstat(writer)).size + sourceRefs.reduce((sum, ref) => sum + ref.diskBytes, 0) + bytes.length * names.length - 1;
    } else await link(join(directory, names.at(-1)!), join(f.applicationDirectory, 'retained-wider-hardlink-evidence'));
    const custody = f.postgresPorts({ filesystemBudgets: restricted });
    const paths = new Set(names.map(name => join(directory, name))), originalOpen = filesystem.open, originalLstat = filesystem.lstat;
    let widerOpens = 0, writerOpens = 0, widerLeafStats = 0;
    filesystem.open = async (...args) => {
      if (typeof args[0] === 'string') {
        if (paths.has(args[0])) widerOpens++;
        if (args[0] === writer) writerOpens++;
      }
      return originalOpen(...args);
    };
    filesystem.lstat = ((...args: Parameters<typeof originalLstat>) => {
      if (typeof args[0] === 'string' && paths.has(args[0])) widerLeafStats++;
      return originalLstat(...args);
    }) as typeof filesystem.lstat;
    syncBuiltinESMExports();
    try {
      await assert.rejects(custody.withHeldSource(context, () => custody.inspectHeldNamespaces()),
        code(refusal === 'late-hardlink' ? 'BACKUP_UNSAFE_FILE' : 'BACKUP_LIMIT'));
    } finally { filesystem.open = originalOpen; filesystem.lstat = originalLstat; syncBuiltinESMExports(); }
    assert.ok(writerOpens > 0); assert.equal(widerOpens, 0, 'A late sibling refusal must precede every earlier wider-file open.');
    if (refusal === 'count') {
      const remainingCapacity = restricted.maxFiles - sourceRefs.length - 2; // Private leaves, writer and reports directory already admitted.
      assert.ok(widerLeafStats > 0, 'Observe the actual leaf metadata API used by directory enumeration.');
      assert.ok(widerLeafStats <= remainingCapacity + 1, 'Stop metadata enumeration after capacity plus one refusal probe, before collecting every sibling.');
      sub.diagnostic(JSON.stringify({ widerLeafStats, remainingCapacity, widerOpens }));
    }
    assert.deepEqual(await readFile(join(directory, names[0])), bytes);
    assert.deepEqual((await readdir(directory)).sort(), names);
    assert.deepEqual(await refs(f.vault), sourceRefs);
    assert.equal(f.adapter.lastLease?.active, false); assert.equal(f.adapter.deleteCalls, 0);
    if (refusal === 'late-hardlink') assert.equal((await lstat(join(directory, names.at(-1)!), { bigint: true })).nlink, 2n);
  });
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

// Capture reuse remains injected SQL protocol evidence with authentic Vault ciphertext;
// it does not qualify a native PostgreSQL server or independent-writer exclusion.
function inspectCaptured(custody: ReturnType<typeof createWorkspaceBackupV2PostgresPorts>,
  capture: Awaited<ReturnType<Vault['captureEncryptedCustody']>>) {
  // The old no-argument method deliberately accepts this runtime argument in the red run.
  const inspect = custody.inspectHeldNamespaces as unknown as (capture: Awaited<ReturnType<Vault['captureEncryptedCustody']>>)
    => ReturnType<typeof custody.inspectHeldNamespaces>;
  return inspect.call(custody, capture);
}

test('PG protocol fixture authenticated capture inventory matches default without rereading private artifacts', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'capture_inventory_backup', confirmed: true });
  await f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'capture_inventory_target', reviewedDigest: summary.archiveDigest });
  await f.custody.withHeldSource(context, async () => {
    const capture = await f.vault.captureEncryptedCustody(encryptedBudgets), expected = await f.custody.inspectHeldNamespaces();
    const selected = capture.artifacts.filter(item => /^wbt2_[a-f0-9]{64}_reservation$/.test(item.ref.id));
    assert.equal(selected.length, 1, 'An actual source-encrypted inert reservation exercises selected archived authentication.');
    const list = f.vault.listArtifacts.bind(f.vault), read = f.vault.readArtifact.bind(f.vault);
    const authenticate = f.vault.authenticateArchivedArtifacts.bind(f.vault);
    let lists = 0, reads = 0, archivedCalls = 0;
    f.vault.listArtifacts = async (...args) => { lists++; return list(...args); };
    f.vault.readArtifact = async (...args) => { reads++; return read(...args); };
    f.vault.authenticateArchivedArtifacts = async (input, budget) => {
      archivedCalls++; assert.equal(input.sourceVaultId, capture.vaultId);
      const exactBytes = (items: typeof input.artifacts) => items.map(item => ({ ref: item.ref, bytes: Buffer.from(item.bytes) }));
      assert.deepEqual(exactBytes(input.artifacts), exactBytes(selected));
      return authenticate(input, budget);
    };
    try {
      assert.deepEqual(await inspectCaptured(f.custody, capture), expected);
      assert.equal(lists, 0, 'A complete fresh capture must not decrypt and enumerate the source artifact list again.');
      assert.equal(reads, 0, 'Reserved sibling values must come from exact captured ciphertext rather than live rereads.');
      assert.equal(archivedCalls, 1, 'Authenticate only selected inert-reservation values through the archived-byte API.');
    } finally {
      f.vault.listArtifacts = list; f.vault.readArtifact = read; f.vault.authenticateArchivedArtifacts = authenticate;
    }
  });
  assert.equal(f.adapter.lastLease?.active, false);
});

test('PG protocol fixture authenticated capture inventory refuses changed artifact bytes at an unchanged authority revision', async t => {
  const f = await fixture(t);
  await f.custody.withHeldSource(context, async () => {
    const capture = await f.vault.captureEncryptedCustody(encryptedBudgets);
    const prior = capture.artifacts.find(item => item.ref.id === 'trial_fork')!;
    await f.vault.writeArtifact({ id: prior.ref.id, purpose: prior.ref.purpose,
      value: { type: 'private-trial-fork-v1', version: 1, secret: 'Synthetic changed private artifact' }, expectedDigest: prior.ref.valueDigest });
    assert.deepEqual(f.vault.read(), capture.state, 'Artifact mutation must retain the same business State and authority revision.');
    assert.equal((await f.adapter.authority())!.envelopeDigest, sha(capture.authority));
    await assert.rejects(inspectCaptured(f.custody, capture), code('BACKUP_FILE_CHANGED'));
  });
  assert.equal(f.adapter.lastLease?.active, false);
});

test('PG protocol fixture authenticated capture inventory refuses omitted, added and removed private files', async t => {
  for (const change of ['omitted-capture-entry', 'added-source-entry', 'removed-source-entry'] as const) await t.test(change, async sub => {
    const f = await fixture(sub);
    await f.custody.withHeldSource(context, async () => {
      const capture = await f.vault.captureEncryptedCustody(encryptedBudgets);
      if (change === 'omitted-capture-entry') capture.artifacts.pop();
      else if (change === 'added-source-entry') await f.vault.writeArtifact({ id: 'later_private_entry', purpose: 'private-trial',
        value: { synthetic: 'Authentic entry created after capture' }, expectedDigest: null });
      else {
        const ref = capture.artifacts.find(item => item.ref.id === 'trial_fork')!.ref;
        await rm(join(f.vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`));
      }
      assert.equal(f.vault.read().revision, capture.state.revision);
      await assert.rejects(inspectCaptured(f.custody, capture), typedRefusal);
    });
    assert.equal(f.adapter.lastLease?.active, false);
  });
});

test('PG protocol fixture authenticated capture inventory refuses altered supplied ciphertext, refs and source metadata', async t => {
  for (const change of ['artifact-bytes', 'artifact-digest', 'artifact-size', 'authority-bytes', 'state', 'vault-id', 'storage-kind', 'authority-kind'] as const)
    await t.test(change, async sub => {
      const f = await fixture(sub);
      await f.custody.withHeldSource(context, async () => {
        const capture = await f.vault.captureEncryptedCustody(encryptedBudgets);
        const artifact = capture.artifacts.find(item => item.ref.id === 'trial_fork')!;
        if (change === 'artifact-bytes') artifact.bytes[0] ^= 1;
        else if (change === 'artifact-digest') artifact.ref.valueDigest = '0'.repeat(64);
        else if (change === 'artifact-size') artifact.ref.diskBytes++;
        else if (change === 'authority-bytes') capture.authority[0] ^= 1;
        else if (change === 'state') capture.state.workspace.name = 'Synthetic altered supplied State';
        else if (change === 'vault-id') capture.vaultId = randomUUID();
        else if (change === 'storage-kind') capture.storageKind = 'experimental-file';
        else capture.authorityKind = 'exact-file-bytes';
        await assert.rejects(inspectCaptured(f.custody, capture), typedRefusal);
      });
      assert.equal(f.adapter.lastLease?.active, false);
    });
});

test('PG protocol fixture authenticated capture inventory refuses authentic authority bytes differing from leased native envelope digest', async t => {
  const f = await fixture(t);
  await f.custody.withHeldSource(context, async () => {
    const capture = await f.vault.captureEncryptedCustody(encryptedBudgets);
    capture.authority = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(capture.authority).toString('utf8')), null, 2));
    assert.deepEqual(await f.vault.authenticateEncryptedCustody({ authority: capture.authority, artifacts: capture.artifacts,
      source: { vaultId: capture.vaultId, workspaceId: capture.state.workspace.id, revision: capture.state.revision } }, encryptedBudgets), capture.state,
    'Serialization changes remain cryptographically authentic but do not equal the exact leased adapter envelope bytes.');
    assert.notEqual(sha(capture.authority), (await f.adapter.authority())!.envelopeDigest);
    await assert.rejects(inspectCaptured(f.custody, capture), code('BACKUP_SOURCE_CHANGED'));
  });
  assert.equal(f.adapter.lastLease?.active, false);
});

test('PG protocol fixture authenticated capture inventory preserves unrelated ciphertext corruption refusal before reservation use', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'corrupt_capture_backup', confirmed: true });
  await f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'corrupt_capture_target', reviewedDigest: summary.archiveDigest });
  await f.custody.withHeldSource(context, async () => {
    const capture = await f.vault.captureEncryptedCustody(encryptedBudgets);
    assert.equal(capture.artifacts.filter(item => /^wbt2_[a-f0-9]{64}_reservation$/.test(item.ref.id)).length, 1);
    const unrelated = capture.artifacts.find(item => item.ref.id === 'wic_archive')!;
    const envelope = JSON.parse(Buffer.from(unrelated.bytes).toString('utf8'));
    envelope.valueDigest = '0'.repeat(64); unrelated.bytes = Buffer.from(JSON.stringify(envelope)); unrelated.ref.diskBytes = unrelated.bytes.length;
    const file = join(f.vault.directory, 'private-artifacts', unrelated.ref.purpose, `${unrelated.ref.id}.encrypted.json`);
    await writeFile(file, unrelated.bytes);
    await assert.rejects(f.custody.inspectHeldNamespaces(), code('ARTIFACT_AUTHENTICATION_FAILED'));
    await assert.rejects(inspectCaptured(f.custody, capture), code('ARTIFACT_AUTHENTICATION_FAILED'));
    assert.deepEqual(await readFile(file), Buffer.from(unrelated.bytes), 'Refused inspection must preserve the unrelated corrupt evidence.');
  });
  assert.equal(f.adapter.lastLease?.active, false);
});

test('PG protocol fixture authenticated capture inventory preserves current native slot-incarnation refusal', async t => {
  const f = await fixture(t);
  await f.custody.withHeldSource(context, async () => {
    const capture = await f.vault.captureEncryptedCustody(encryptedBudgets), incarnation = f.adapter.creationId;
    f.adapter.creationId = randomUUID();
    try {
      await assert.rejects(f.custody.inspectHeldNamespaces(), code('POSTGRES_AUTHORITY_CHANGED'));
      await assert.rejects(inspectCaptured(f.custody, capture), code('POSTGRES_AUTHORITY_CHANGED'));
    } finally { f.adapter.creationId = incarnation; }
  });
  assert.equal(f.adapter.lastLease?.active, false);
});
