import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, ChausarError, hash, type Context } from '../runtime/contracts.ts';
import { PostgresSnapshotAdapter, type PostgresPool } from '../runtime/postgres.ts';
import { Vault, type VaultEnvelope } from '../runtime/vault.ts';
import { WorkspaceInterchangeLocalCustody } from '../runtime/workspace-interchange-local.ts';
import { EnginePostgresWorkspaceActivation } from '../runtime/workspace-postgres-engine.ts';
import type { EnginePostgresWorkspaceOptions, PostgresWorkspaceAuthorityWitness, PostgresWorkspaceInstallation,
  PostgresWorkspaceInstallInput, PostgresWorkspaceStorageIdentity } from '../runtime/workspace-postgres-contracts.ts';
import { emptyTarget } from './fixtures/workspace-interchange-fixture.ts';

// Injected SQL protocol fixture, adapted from postgres-envelope.test.ts. This
// exercises actual PostgresSnapshotAdapter and Vault encrypted authority, not
// PostgreSQL server transactions, physical database identity or native custody.
function protocolFixture() {
  let row: { slot: string; creationId: string; envelope: VaultEnvelope } | null = null, reads = 0, writes = 0;
  const schema = { authority_table: false, storage_table: false, custody_table: false, creation_column: false };
  let storageId: string | null = null;
  const jsonbOrder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(jsonbOrder);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, jsonbOrder(child)]));
    return value;
  };
  const query: PostgresPool['query'] = async (sql, values) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.includes("to_regclass('public.chausar_vault_authority')")) return { rows: [{ ...schema }] };
    if (text.startsWith('CREATE TABLE IF NOT EXISTS public.chausar_vault_authority')) {
      schema.authority_table = true; schema.creation_column = true; return { rows: [] };
    }
    if (text.startsWith('CREATE TABLE IF NOT EXISTS public.chausar_workspace_postgres_storage')) {
      schema.storage_table = true; return { rows: [] };
    }
    if (text.startsWith('CREATE TABLE IF NOT EXISTS public.chausar_workspace_postgres_custody')) {
      schema.custody_table = true; return { rows: [] };
    }
    if (text.startsWith('INSERT INTO public.chausar_workspace_postgres_storage')) {
      storageId ??= randomUUID(); return { rows: [], rowCount: 1 };
    }
    if (text === "SELECT storage_id FROM public.chausar_workspace_postgres_storage WHERE id = 'current'"
      || text === "SELECT storage_id FROM public.chausar_workspace_postgres_storage WHERE id = 'current' FOR SHARE")
      return { rows: storageId ? [{ storage_id: storageId }] : [] };
    if (text === 'SELECT pg_advisory_xact_lock(hashtext($1))') return { rows: [] };
    if (text === 'SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE') {
      reads++; return { rows: row && row.slot === values?.[0]
        ? [{ creation_id: row.creationId, revision: String(row.envelope.revision), envelope: jsonbOrder(row.envelope) }] : [] };
    }
    if (text === 'SELECT phase, creation_id, vault_id, operation_id, storage_id, revision, envelope_digest, envelope, target_identity FROM public.chausar_workspace_postgres_custody WHERE slot = $1 FOR UPDATE')
      return { rows: [] }; // These are legacy ordinary workspace rows, without target publication custody.
    if (text.startsWith('INSERT INTO public.chausar_vault_authority ')) {
      assert.equal(row, null, 'The injected SQL slot enforces primary-key creation.');
      const envelope = JSON.parse(String(values![2])) as VaultEnvelope;
      assert.equal(envelope.revision, values![1]); writes++;
      row = { slot: String(values![0]), creationId: randomUUID(), envelope }; return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE public.chausar_vault_authority ')) {
      if (!row || row.slot !== values?.[0] || row.envelope.revision !== values?.[3]
        || row.creationId !== values?.[4] || row.envelope.id !== values?.[5]
        || hash(row.envelope) !== hash(JSON.parse(String(values?.[6])))) return { rows: [], rowCount: 0 };
      const envelope = JSON.parse(String(values![2])) as VaultEnvelope;
      assert.equal(envelope.revision, values![1]); writes++; row.envelope = envelope; return { rows: [], rowCount: 1 };
    }
    throw new ChausarError('TEST_SQL_UNSUPPORTED', 'The injected SQL protocol must explicitly implement each adapter query.');
  };
  const pool: PostgresPool = { query, async connect() {
    let retained: { row: typeof row; schema: typeof schema; storageId: string | null } | null = null;
    return { async query(sql, values) {
      if (sql === 'BEGIN') {
        assert.equal(retained, null); retained = { row: structuredClone(row), schema: { ...schema }, storageId };
        return { rows: [], command: 'BEGIN' };
      }
      if (sql === 'COMMIT') { assert.ok(retained); retained = null; return { rows: [], command: 'COMMIT' }; }
      if (sql === 'ROLLBACK') {
        if (retained) { row = retained.row; Object.assign(schema, retained.schema); storageId = retained.storageId; retained = null; }
        return { rows: [], command: 'ROLLBACK' };
      }
      assert.ok(retained, 'Actual adapter queries must remain within their owned transaction.');
      return query(sql, values);
    }, release() { assert.equal(retained, null, 'The adapter must finish the transaction before release.'); } };
  }, async end() {} };
  return { pool, current: () => structuredClone(row?.envelope ?? null), counts: () => ({ reads, writes }) };
}
const credential = 'Public synthetic coordinator SQL protocol credential';
const captureBudgets = { maxArtifacts: 32, maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000 };
const backupBudgets = { maxArchiveUtf8Bytes: 8_000_000, maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000,
  maxEntries: 32, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const unavailable = async (): Promise<never> => { throw new ChausarError('TEST_UNUSED_PORT', 'This coordinator test does not execute backup or activation publication.'); };

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:[\\/]/i, 'Canonical C-drive scratch is required before fixture creation.');
  const root = await realpath(await mkdtemp(join(parent, 'chausar-pg-coordinator-contract-'))), opened = new Set<Vault>();
  t.after(async () => {
    for (const vault of opened) await vault.close();
    const actual = await realpath(root), child = relative(parent, actual);
    assert.equal(dirname(actual), parent);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-pg-coordinator-contract-'));
    await rm(actual, { recursive: true, force: true });
  });
  const sourceSql = protocolFixture(), journalSql = protocolFixture();
  const sourceAdapter = await PostgresSnapshotAdapter.fromPool(sourceSql.pool, 'source_fixture');
  const journalAdapter = await PostgresSnapshotAdapter.fromPool(journalSql.pool, 'journal_fixture');
  const source = (await Vault.create({ directory: join(root, 'source'), storage: sourceAdapter,
    passphrase: credential, name: 'Synthetic coordinator source', demo: true })).vault;
  opened.add(source);
  const journal = (await Vault.create({ directory: join(root, 'journal'), storage: journalAdapter,
    passphrase: credential, name: 'Synthetic coordinator journal', demo: true })).vault;
  opened.add(journal);
  assert.notEqual(source.vaultId, journal.vaultId); assert.notEqual(source.directory, journal.directory);
  const member = source.read().members[0];
  const context: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  const assertCompleteOwner: PostgresWorkspaceInstallInput['assertCompleteOwner'] = async (current) => {
    const owner = authorize(source, current, 'admin');
    assert.equal(owner.role, 'owner'); assert.deepEqual(owner.branches, ['*']);
  };
  const interchange = new WorkspaceInterchangeLocalCustody({ vault: source, applicationDirectory: root,
    assertCompleteOwner, qualification: 'test-fixture' });
  const policy = { approvedSyntheticWorkspaceIds: [source.read().workspace.id], allowedSyntheticSourceIds: ['demo-export'],
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 32, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 };
  const backupPolicy = { approvedSyntheticWorkspaceIds: [...policy.approvedSyntheticWorkspaceIds], backupBudgets,
    maxMaterialUtf8Bytes: 8_000_000, maxCandidateUtf8Bytes: 8_000_000 };
  const target = emptyTarget(); let targetCalls = 0, installs = 0, configurationCurrent = true;
  let onCreate = async () => {}, onInspect = async () => {};
  const witness = async (vault: Vault, storage: PostgresWorkspaceStorageIdentity): Promise<PostgresWorkspaceAuthorityWitness> => {
    const captured = await vault.snapshot(() => vault.captureEncryptedCustody(captureBudgets));
    assert.equal(captured.storageKind, 'postgres'); assert.equal(captured.authorityKind, 'adapter-issued-envelope');
    return { storage, vaultId: vault.vaultId, revision: vault.read().revision,
      envelopeDigest: createHash('sha256').update(captured.authority).digest('hex') };
  };
  const sourceWitness = await witness(source, { storeId: 'injected_store', slot: 'source_fixture', incarnation: 'source_incarnation' });
  const journalWitness = await witness(journal, { storeId: 'injected_store', slot: 'journal_fixture', incarnation: 'journal_incarnation' });
  const installed: PostgresWorkspaceInstallation = { source: sourceWitness, journal: journalWitness,
    backup: { restoredIdentity: unavailable, ports: { withSource: unavailable, withTarget: unavailable,
      authenticateArchive: unavailable, assertRestoreOwner: unavailable,
      custody: { create: unavailable, read: unavailable, remove: unavailable },
      restore: { restoreAtomic: unavailable, readRestored: unavailable, rollback: unavailable } },
      diagnostics() { return { qualification: 'injected-SQL-protocol-only' }; } },
    activation: { bridgePorts: { withTransaction: unavailable, custody: { read: unavailable } },
      activationPorts: { withTransaction: unavailable, custody: { read: unavailable }, readback: unavailable },
      async createTarget(current, targetId) { assert.deepEqual(current, context); assert.equal(targetId, target.targetId);
        targetCalls++; await onCreate(); return structuredClone(target); },
      async inspectTarget(current, targetId) { assert.deepEqual(current, context); assert.equal(targetId, target.targetId);
        targetCalls++; await onInspect(); return structuredClone(target); },
      inspectOpenTarget: unavailable, inspectCurrentLive: unavailable } };
  const profile: EnginePostgresWorkspaceOptions = { format: 'chausar.postgres-workspace-profile.v1', journalVault: journal, policy,
    targetPassphrase: async () => credential, withWorkspaceAdmission: unavailable,
    async install() { installs++; return installed; } };
  const input: PostgresWorkspaceInstallInput = { sourceVault: source, journalVault: journal, applicationDirectory: root,
    interchange, backupBudgets, backupPolicy, policy, assertCompleteOwner,
    bootstrap: options => Vault.createBootstrap(options), openVault: options => Vault.open(options), targetPassphrase: profile.targetPassphrase };
  const assertConfiguration = () => { if (!configurationCurrent) throw new ChausarError('TEST_CONFIGURATION_CHANGED', 'Injected constructor profile changed during awaited target inspection.'); };
  return { source, journal, sourceSql, journalSql, context, target, installed,
    counts: () => ({ targetCalls, installs }),
    install: () => EnginePostgresWorkspaceActivation.install(profile, input, assertConfiguration),
    onCreate(callback: () => Promise<void>) { onCreate = callback; }, onInspect(callback: () => Promise<void>) { onInspect = callback; },
    withdrawConfiguration() { configurationCurrent = false; } };
}

test('injected SQL coordinator: different incarnations cannot make the same physical store and slot distinct source/journal authority', async t => {
  const f = await fixture(t), sourceBefore = f.sourceSql.current(), journalBefore = f.journalSql.current();
  const writes = [f.sourceSql.counts().writes, f.journalSql.counts().writes];
  f.installed.journal.storage = { ...f.installed.source.storage, incarnation: 'different_incarnation_same_physical_slot' };
  // Both Vault identities and encrypted envelope digests are genuinely distinct.
  // Only the injected installation's physical-slot claim is conflicting.
  assert.notEqual(f.installed.source.vaultId, f.installed.journal.vaultId);
  assert.notEqual(f.installed.source.envelopeDigest, f.installed.journal.envelopeDigest);
  await assert.rejects(f.install(), code('POSTGRES_WORKSPACE_ROOT_REQUIRED'));
  assert.deepEqual(f.counts(), { targetCalls: 0, installs: 1 });
  assert.deepEqual(f.sourceSql.current(), sourceBefore); assert.deepEqual(f.journalSql.current(), journalBefore);
  assert.deepEqual([f.sourceSql.counts().writes, f.journalSql.counts().writes], writes);
});

test('injected SQL coordinator: createTarget rechecks actual owner epoch after its awaited target callback before releasing a result', async t => {
  const f = await fixture(t), coordinator = await f.install();
  const before = f.source.read().members[0].epoch;
  f.onCreate(async () => { await Promise.resolve(); await f.source.update(state => { state.members[0].epoch++; }); });
  await assert.rejects(coordinator.createTarget(f.context, f.target.targetId), code('ACCESS_REVOKED'));
  assert.equal(f.source.read().members[0].epoch, before + 1); assert.equal(f.counts().targetCalls, 1);
});

test('injected SQL coordinator: inspectTarget rechecks constructor configuration after its awaited callback before releasing a result', async t => {
  const f = await fixture(t), coordinator = await f.install();
  f.onInspect(async () => { await Promise.resolve(); f.withdrawConfiguration(); });
  await assert.rejects(coordinator.inspectTarget(f.context, f.target.targetId), code('TEST_CONFIGURATION_CHANGED'));
  assert.equal(f.counts().targetCalls, 1);
});
