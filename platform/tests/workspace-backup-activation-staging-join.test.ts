import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { authorize, check, hash, type Context, type State } from '../runtime/contracts.ts';
import type { PostgresSnapshotAdapter } from '../runtime/postgres.ts';
import type { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { createWorkspaceBackupV2PostgresPorts, type WorkspaceBackupV2PostgresCustody } from '../runtime/workspace-backup-postgres.ts';
import { WorkspaceActivationStagingInventory } from '../runtime/workspace-activation-staging-inventory.ts';
import type { WorkspaceActivationLocalDiagnostic } from '../runtime/workspace-activation-local.ts';
import { captureWorkspaceInterchange, retainedArtifactBytes, workspaceStateProfile } from '../runtime/workspace-interchange.ts';
import type { ArtifactCapture, WorkspaceImportCandidate } from '../runtime/workspace-interchange-contracts.ts';
import { ProtocolPostgresAdapter } from './fixtures/workspace-backup-postgres-protocol.ts';
import { fixture, code, localAttemptId, purpose, treeBytes } from './fixtures/workspace-activation-postgres-protocol.ts';
import { interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Injected SQL protocol only. Both Vaults encrypt actual authority/artifacts and
// actual Local/C code publishes the actual filesystem. No native SQL evidence.
const filesystemBudgets = { maxFiles: 200, maxBytes: 16 * 1024 * 1024, maxDepth: 16 };
const archiveBudgets = { maxArchiveUtf8Bytes: 4_000_000, maxEntryBytes: 1_000_000,
  maxTotalEntryBytes: 2_000_000, maxEntries: 100, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const require = createRequire(import.meta.url);

function injectedNative(adapter: ProtocolPostgresAdapter): WorkspacePostgresCustody {
  return {
    storageIdentity: async () => {
      assert.equal(adapter.leaseActive, true, 'Read identity under the actual injected transaction lease.');
      return structuredClone(adapter.storage);
    },
    withSource: async <T>(work: (native: any) => Promise<T>): Promise<T> => adapter.withLease(async lease => {
      const authority = await lease.authority(); assert.ok(authority);
      const native = { lease, storage: structuredClone(adapter.storage), authority,
        assertCurrent: () => lease.assertCurrent(authority) };
      await native.assertCurrent(); const result = await work(native); await native.assertCurrent(); return result;
    }),
  } as unknown as WorkspacePostgresCustody;
}

async function joinedFixture(t: TestContext, install: boolean, observerFails = false) {
  const sourceAdapter = new ProtocolPostgresAdapter('joined-source');
  const journalAdapter = new ProtocolPostgresAdapter('joined-journal');
  let f!: Awaited<ReturnType<typeof fixture>>, backup!: WorkspaceBackupV2PostgresCustody;
  const diagnostics: WorkspaceActivationLocalDiagnostic[] = [];
  const innerRefusals: string[] = [];
  const phases: { phase: string; location: string; stage: string[]; target: string[]; measured: string[] }[] = [];
  let activationId = 'joined_activation';
  const currentOwner = async (ctx: Context, historical: State) => {
    const member = authorize(f.sourceVault, ctx, 'admin');
    assert.equal(member.role, 'owner'); assert.deepEqual(member.branches, ['*']);
    assert.equal(ctx.channel, 'desktop'); assert.equal(historical.workspace.id, f.sourceVault.read().workspace.id);
    assert.deepEqual(f.sourceVault.read(), f.sourceInitial, 'The actual current source remains unchanged.');
  };
  const inspect = async () => {
    try {
      const measured = await backup.inspectHeldNamespaces();
      const ref = (await f.journalVault.listArtifacts({ purpose })).find(item => item.id === localAttemptId(activationId));
      if (ref) {
        const journal = (await f.journalVault.readArtifact(ref)).value as any;
        if (journal.phase === 'prepared' || journal.phase === 'committed') {
          const stage = Object.keys(await treeBytes(join(f.applicationDirectory, '.workspace-activation-control', 'staging', journal.staging.name))).sort();
          const target = Object.keys(await treeBytes(f.targetPath())).sort();
          const location = stage.length ? 'stage' : 'target';
          const key = `${journal.phase}/${location}`;
          if (!phases.some(item => `${item.phase}/${item.location}` === key)) phases.push({ phase: journal.phase, location,
            stage, target, measured: measured.files.map(item => item.path) });
        }
      }
    } catch (error: any) { innerRefusals.push(error.code); throw error; }
  };
  f = await fixture(t, {
    sourceStorage: sourceAdapter, journalStorage: journalAdapter,
    onDiagnostic: event => { diagnostics.push(event); if (observerFails) throw new Error('Synthetic observer failure'); },
    withSource: (ctx, expected, work) => backup.withHeldSource(ctx, async () => {
      assert.equal(sourceAdapter.leaseActive, true);
      const current = f.sourceVault.read();
      const retainedAuthority = await sourceAdapter.authority(); assert.ok(retainedAuthority);
      // This authenticated candidate was issued by actual Local interchange.
      // Rebuild the fixture's semantic capture under B's single held snapshot;
      // never recursively acquire another Vault.snapshot from inside it.
      const archive = (JSON.parse(f.candidate.content) as WorkspaceImportCandidate).archive;
      const artifacts: ArtifactCapture = { complete: true, enumerationId: archive.inventory.enumerationId,
        generation: structuredClone(archive.inventory.generation), categories: workspaceStateProfile().artifactCategories,
        artifacts: archive.artifacts.map(item => ({ id: item.manifest.id, category: item.manifest.category,
          mediaType: item.manifest.mediaType, bytes: retainedArtifactBytes(item), generation: structuredClone(item.manifest.generation) })) };
      const capture = captureWorkspaceInterchange(current, artifacts);
      assert.deepEqual(capture.inventory, archive.inventory);
      if (expected) assert.deepEqual(capture.inventory, expected);
      const assertCurrent = async () => {
        await inspect();
        await currentOwner(ctx, current);
        check(hash(f.sourceVault.read()) === hash(current), 'INTERCHANGE_AUTHORITY_CHANGED', 'Actual source state changed.');
        await sourceAdapter.lastLease!.assertCurrent(retainedAuthority);
        await inspect();
      };
      await assertCurrent();
      const result = await work({ ready: true, state: current, artifacts, assertCompleteOwner: currentOwner, assertCurrent });
      await assertCurrent(); return result;
    }),
  });
  assert.equal(f.sourceVault.storageKind, 'postgres'); assert.equal(f.journalVault.storageKind, 'postgres');
  const staging = install ? new WorkspaceActivationStagingInventory({ sourceVault: f.sourceVault,
    journalVault: f.journalVault, journalAdapter: journalAdapter as unknown as PostgresSnapshotAdapter,
    journalPostgres: injectedNative(journalAdapter), applicationDirectory: f.applicationDirectory, budgets: filesystemBudgets }) : undefined;
  backup = createWorkspaceBackupV2PostgresPorts({ vault: f.sourceVault, adapter: sourceAdapter as unknown as PostgresSnapshotAdapter,
    postgres: injectedNative(sourceAdapter), applicationDirectory: f.applicationDirectory,
    budgets: archiveBudgets, filesystemBudgets, activationStaging: staging,
    outsideApplicationNamespaces: [{ name: 'journal', requirement: 'Separate actual encrypted activation journal.' },
      { name: 'target_fixture', requirement: 'Separate current target custody is admitted by actual Local/C.' }],
    externalKeyRequirements: [{ provider: 'other', namespace: 'operator/credential-wrappers', requirement: 'Synthetic operator separately retains fixture credentials.' }],
    assertCompleteOwner: currentOwner,
    withCompleteOwner: async (ctx, historical, work) => { await currentOwner(ctx, historical); return f.sourceVault.withCustodyWriterAdmission(work); },
  });
  return { f, backup, sourceAdapter, journalAdapter, diagnostics, innerRefusals, phases,
    activate: (id = 'joined_activation') => { activationId = id; return f.activate(id); } };
}

test('injected SQL join without staging capability retains prepared custody and diagnoses refusal before filesystem publication', async t => {
  const j = await joinedFixture(t, false, true), source = j.f.sourceEnvelope;
  await assert.rejects(j.activate(), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.ok(j.innerRefusals.includes('BACKUP_INVENTORY_INCOMPLETE'));
  assert.deepEqual(j.diagnostics, [{ format: 'chausar.activation-local-diagnostic.v1',
    stage: 'pre-filesystem-publication-source-guard', publicationStarted: false, errorCode: 'BACKUP_INVENTORY_INCOMPLETE' }]);
  assert.equal(j.f.target.publishCalls, 0); assert.equal(j.f.target.phase, 'prepared');
  assert.deepEqual(await readdir(j.f.targetPath()), []); assert.deepEqual(j.f.sourceEnvelope, source);
  const ref = (await j.f.journalVault.listArtifacts({ purpose })).find(item => item.id === localAttemptId('joined_activation'))!;
  const journal = (await j.f.journalVault.readArtifact(ref)).value as any;
  assert.equal(journal.phase, 'prepared');
  const staged = Object.keys(await treeBytes(join(j.f.applicationDirectory, '.workspace-activation-control', 'staging', journal.staging.name))).sort();
  assert.deepEqual(staged, journal.files.map((item: any) => item.path).sort());
  assert.ok(staged.includes('live/postgres-publication.encrypted.json'));
});

test('injected SQL join measures actual prepared stage, prepared target and committed empty stage without granting replay', async t => {
  const j = await joinedFixture(t, true), source = j.f.sourceEnvelope;
  const result = await j.activate(); assert.equal(result.status, 'committed');
  assert.equal(j.f.target.publishCalls, 1); assert.deepEqual(j.diagnostics, []); assert.deepEqual(j.innerRefusals, []);
  assert.deepEqual(j.phases.map(item => `${item.phase}/${item.location}`), ['prepared/stage', 'prepared/target', 'committed/target']);
  const [staged, published, committed] = j.phases;
  assert.ok(staged.stage.length > 0); assert.deepEqual(staged.target, []);
  assert.deepEqual(published.stage, []); assert.deepEqual(published.target, staged.stage);
  assert.deepEqual(committed.stage, []); assert.deepEqual(committed.target, staged.stage);
  for (const path of staged.stage) assert.ok(staged.measured.includes(`application/workspace-activation-control/staging/${
    (await readdir(join(j.f.applicationDirectory, '.workspace-activation-control', 'staging')))[0]}/${path}`));
  for (const path of published.target) assert.ok(published.measured.includes(`application/target_fixture/${path}`));
  assert.deepEqual(j.f.sourceEnvelope, source);
  const current = await j.f.openTarget(); try { assert.equal(current.read().revision, 0); assert.deepEqual(current.read().sessions, []); }
  finally { await current.close(); }
  const ledger = (await j.f.journalVault.readArtifact({ id: 'wal_ledger_v1', purpose })).value as any;
  assert.equal(ledger.claims.length, 1); assert.equal(ledger.claims[0].activationId, 'joined_activation');
  assert.equal(ledger.claims[0].candidateCreationId, j.f.candidate.pin.creationId);
  // Current occupied-target admission refuses before the durable replay check;
  // the authenticated single-use ledger remains the independent consumed proof.
  await assert.rejects(j.activate('joined_replay'), code('ACTIVATION_TARGET_CHANGED'));
  assert.deepEqual((await j.f.journalVault.readArtifact({ id: 'wal_ledger_v1', purpose })).value, ledger);
  assert.equal(j.f.target.publishCalls, 1);
});

test('injected SQL joined inventory refuses an unbound attempt or extra committed-stage file before opening its contents', async t => {
  const j = await joinedFixture(t, true); await j.activate();
  const staging = join(j.f.applicationDirectory, '.workspace-activation-control', 'staging');
  const [bound] = await readdir(staging);
  const badStage = join(staging, 'attempt_11111111-1111-1111-1111-111111111111');
  const badPaths = [join(badStage, 'unissued.encrypted.json'), join(staging, bound, 'unissued.encrypted.json')];
  const fs = require('node:fs/promises'); const open = fs.open; let forbiddenOpens = 0;
  const mock = t.mock.method(fs, 'open', async (path: any, ...args: any[]) => {
    if (badPaths.includes(resolve(String(path)))) { forbiddenOpens++; throw new Error('Unbound contents must not be opened.'); }
    return open(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    await mkdir(badStage); await writeFile(badPaths[0], 'Synthetic unissued file is not valid archive evidence.');
    await assert.rejects(j.backup.withHeldSource(interchangeOwner, () => j.backup.inspectHeldNamespaces()), code('BACKUP_ACTIVATION_STAGING_UNBOUND'));
    assert.equal(forbiddenOpens, 0); await rm(badStage, { recursive: true });
    await writeFile(badPaths[1], 'Synthetic extra file has no journal-issued identity.');
    await assert.rejects(j.backup.withHeldSource(interchangeOwner, () => j.backup.inspectHeldNamespaces()), code('BACKUP_ACTIVATION_STAGING_UNBOUND'));
    assert.equal(forbiddenOpens, 0); await rm(badPaths[1]);
    await j.backup.withHeldSource(interchangeOwner, () => j.backup.inspectHeldNamespaces());
    assert.equal(j.f.target.publishCalls, 1, 'Inventory rejection and recovery never dispatch another publication.');
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});
