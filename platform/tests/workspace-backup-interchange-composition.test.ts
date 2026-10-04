import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, ChausarError, hash, type Context, type State } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { Vault } from '../runtime/vault.ts';
import { createWorkspaceBackupV2Host, type WorkspaceBackupV2Budgets } from '../runtime/workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts } from '../runtime/workspace-backup-local.ts';
import { WorkspaceInterchangeHost } from '../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../runtime/workspace-interchange-local.ts';
import { inspectWorkspaceInterchange, interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { deterministicShopState, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

const passphrase = 'Synthetic backup interchange composition fixture';
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 16_000_000, maxEntryBytes: 8_000_000,
  maxTotalEntryBytes: 12_000_000, maxEntries: 100, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const backupId = (recordId: string, part: 'archive' | 'pin' | 'binding') => `wb2_${sha(recordId)}_${part}`;
const targetId = (id: string) => `wbt2_${sha(id)}_reservation`;
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-backup-interchange-')));
  assert.equal(dirname(applicationDirectory), base);
  let ownerRevoked = false;
  let vault = (await Vault.create({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file',
    passphrase, name: 'Synthetic composition fixture', demo: true })).vault;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(applicationDirectory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-interchange-'));
    await rm(actual, { recursive: true, force: true });
  });
  await vault.update(draft => {
    const state = deterministicShopState(); state.workspace.id = draft.workspace.id;
    const input = { sourceId: 'demo-export', format: 'csv' as const, content: demoCsv, recipe: demoRecipe,
      expectedTotals: { rowCount: 10, amountMinor: '1230000' } };
    state.imports[0].retainedInput = { version: 1, generation: 1, input, digest: hash(input) };
    Object.assign(draft, state);
  });
  const assertCompleteOwner = async (context: Context, historical: State) => {
    if (ownerRevoked) throw new ChausarError('TEST_OWNER_REVOKED', 'Synthetic complete-owner readiness was revoked.');
    const owner = authorize(vault, context, 'admin');
    assert.equal(owner.role, 'owner'); assert.deepEqual(owner.branches, ['*']);
    assert.equal(historical.workspace.id, vault.read().workspace.id);
  };
  const compose = (interchangeOptions: Partial<Parameters<typeof createWorkspaceInterchangeLocalPorts>[0]> = {}) => {
    const backupLocal = createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets,
      filesystemBudgets: { maxFiles: 100, maxBytes: 16_000_000, maxDepth: 16 },
      externalKeyRequirements: [{ provider: 'other', namespace: 'operator/credential-wrappers',
        requirement: 'Retain the synthetic fixture credential separately.' }], assertCompleteOwner,
      withCompleteOwner: async (context, historical, work) => {
        await assertCompleteOwner(context, historical); return vault.withCustodyWriterAdmission(work);
      } });
    const interchangeLocal = createWorkspaceInterchangeLocalPorts({ vault, applicationDirectory,
      qualification: 'test-fixture', assertCompleteOwner, backupControlCustody: backupLocal, ...interchangeOptions });
    return { backupLocal, backup: createWorkspaceBackupV2Host(backupLocal.ports, budgets),
      interchangeLocal, interchange: new WorkspaceInterchangeHost(interchangeLocal.ports) };
  };
  return { get vault() { return vault; }, applicationDirectory, compose,
    revokeOwner() { ownerRevoked = true; },
    async reopen() {
      await vault.close(); vault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file', passphrase });
      return compose();
    } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Composition = ReturnType<Fixture['compose']>;
async function artifact(vault: Vault, id: string) {
  return vault.readArtifact({ id, purpose: 'workspace-interchange' });
}
async function rewrite(vault: Vault, id: string, change: (value: any) => void) {
  const retained = await artifact(vault, id), value = structuredClone(retained.value);
  change(value);
  return vault.writeArtifact({ id, purpose: retained.purpose, value, expectedDigest: retained.valueDigest });
}
async function remove(vault: Vault, id: string) {
  const ref = await artifact(vault, id);
  await vault.removeArtifact({ id, purpose: ref.purpose, expectedDigest: ref.valueDigest });
}
async function controlBytes(vault: Vault) {
  const directory = join(vault.directory, 'private-artifacts', 'workspace-interchange');
  const names = (await readdir(directory)).sort();
  return Promise.all(names.map(async name => ({ name, bytes: await readFile(join(directory, name)) })));
}
async function refusesExport(f: Fixture, composed: Composition, expected: string, destinationId = 'refused_export') {
  const state = f.vault.read(), authority = await readFile(join(f.vault.directory, 'authority.encrypted.json'));
  const controls = await controlBytes(f.vault);
  await assert.rejects(composed.interchange.export(interchangeOwner, { destinationId, confirmed: true }), code(expected));
  assert.deepEqual(f.vault.read(), state);
  assert.deepEqual(await readFile(join(f.vault.directory, 'authority.encrypted.json')), authority,
    'Refusal must preserve exact source authority ciphertext.');
  assert.deepEqual(await controlBytes(f.vault), controls,
    'Refusal must not publish export custody or alter existing backup controls.');
}

test('backup controls compose with same-workspace export and repeated backup/export after safe reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), first = f.compose(), before = f.vault.read();
  const backup = await first.backup.create(interchangeOwner, { destinationId: 'backup_one', confirmed: true });
  const exported = await first.interchange.export(interchangeOwner, { destinationId: 'export_one', confirmed: true });
  const retained = await first.interchangeLocal.ports.custody.read(interchangeOwner, exported.recordId);
  assert.deepEqual(readHistoricalWorkspaceState(inspectWorkspaceInterchange(retained.content)), before);
  assert.equal(first.interchangeLocal.diagnostics()!.controlArtifactsExcluded, 6);
  assert.equal(backup.fullWorkspacePortable, false);
  const reopened = await f.reopen();
  assert.equal((await reopened.backupLocal.ports.custody.read(interchangeOwner, backup.recordId)).pin.archiveDigest, backup.archiveDigest);
  await reopened.backup.create(interchangeOwner, { destinationId: 'backup_two', confirmed: true });
  const repeated = await reopened.interchange.export(interchangeOwner, { destinationId: 'export_two', confirmed: true });
  assert.deepEqual(await reopened.interchangeLocal.ports.custody.read(interchangeOwner, exported.recordId), retained);
  assert.equal(reopened.interchangeLocal.diagnostics()!.controlArtifactsExcluded, 12);
  assert.equal(repeated.inventory.stores, 26);
  assert.deepEqual(repeated.inventory, exported.inventory);
  assert.equal(repeated.source.inventoryDigest, exported.source.inventoryDigest,
    'Later backup administration must preserve the earlier export business pin.');
  const prepared = await reopened.interchange.prepare(interchangeOwner,
    { exportId: exported.recordId, candidateId: 'retained_export_candidate', targetId: 'empty_candidate_target' });
  assert.deepEqual(await readdir(join(f.applicationDirectory, 'empty_candidate_target')), []);
  const reviewed = await (await f.reopen()).interchange.review(interchangeOwner,
    { candidateId: prepared.recordId, reviewedDigest: prepared.reviewedDigest! });
  assert.equal(reviewed.reviewedDigest, prepared.reviewedDigest);
  assert.deepEqual(await readdir(join(f.applicationDirectory, 'empty_candidate_target')), []);
  assert.deepEqual(f.vault.read(), before);
});

test('discarded controls and a failed backup attempt compose with later export and repeat after reopening', { timeout: 30_000 }, async t => {
  const f = await fixture(t), composed = f.compose(), before = f.vault.read();
  const good = await composed.backup.create(interchangeOwner, { destinationId: 'retained_backup', confirmed: true });
  const retained = await composed.backupLocal.ports.custody.read(interchangeOwner, good.recordId);
  const discarded = await composed.backup.create(interchangeOwner, { destinationId: 'discarded_backup', confirmed: true });
  const discardedRecord = await composed.backupLocal.ports.custody.read(interchangeOwner, discarded.recordId);
  await composed.backupLocal.ports.custody.remove(interchangeOwner, { recordId: discarded.recordId,
    creationId: discardedRecord.pin.creationId, expectedArchiveDigest: discarded.archiveDigest,
    expectedPinDigest: interchangeDigest(discardedRecord.pin) });
  const write = f.vault.writeArtifact.bind(f.vault);
  let injected = false;
  f.vault.writeArtifact = async input => {
    if (!injected && input.id === backupId('failed_backup', 'pin')) {
      injected = true; throw new Error('Synthetic backup pin publication failed');
    }
    return write(input);
  };
  try {
    await assert.rejects(composed.backup.create(interchangeOwner, { destinationId: 'failed_backup', confirmed: true }),
      /Synthetic backup pin publication failed/);
  } finally { f.vault.writeArtifact = write; }
  assert.equal(injected, true);
  for (const recordId of ['discarded_backup', 'failed_backup']) {
    assert.equal(((await artifact(f.vault, backupId(recordId, 'binding'))).value as any).state, 'discarded');
    await assert.rejects(artifact(f.vault, backupId(recordId, 'archive')), code('ARTIFACT_NOT_FOUND'));
    await assert.rejects(artifact(f.vault, backupId(recordId, 'pin')), code('ARTIFACT_NOT_FOUND'));
  }
  await composed.interchange.export(interchangeOwner, { destinationId: 'after_failed_backup', confirmed: true });
  const reopened = await f.reopen();
  assert.deepEqual(await reopened.backupLocal.ports.custody.read(interchangeOwner, good.recordId), retained);
  await assert.rejects(reopened.backup.create(interchangeOwner, { destinationId: 'failed_backup', confirmed: true }), code('BACKUP_OUTPUT_EXISTS'));
  await reopened.backup.create(interchangeOwner, { destinationId: 'later_backup', confirmed: true });
  await reopened.interchange.export(interchangeOwner, { destinationId: 'after_failed_backup_reopened', confirmed: true });
  assert.deepEqual(f.vault.read(), before);
});

test('missing, orphaned and unknown backup controls refuse export without publication', { timeout: 30_000 }, async t => {
  for (const part of ['archive', 'pin', 'binding'] as const) await t.test(`missing_${part}`, async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await remove(f.vault, backupId('backup', part));
    await refusesExport(f, composed, 'BACKUP_CUSTODY_CHANGED');
    await refusesExport(f, await f.reopen(), 'BACKUP_CUSTODY_CHANGED', 'refused_reopened');
  });
  for (const retainedPart of ['archive', 'pin'] as const) await t.test(`orphan_${retainedPart}`, async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await remove(f.vault, backupId('backup', 'binding'));
    await remove(f.vault, backupId('backup', retainedPart === 'archive' ? 'pin' : 'archive'));
    await refusesExport(f, composed, 'BACKUP_CUSTODY_CHANGED');
  });
  await t.test('unknown_wb_control', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await f.vault.writeArtifact({ id: `wb2_${sha('backup')}_unexpected`, purpose: 'workspace-interchange',
      value: { format: 'synthetic.unknown-backup-control' }, expectedDigest: null });
    await refusesExport(f, composed, 'INTERCHANGE_CUSTODY_INCOMPLETE');
  });
});

test('physical tampering and authenticated provenance, reference and alias changes refuse backup control exclusion', { timeout: 30_000 }, async t => {
  await t.test('hardlink_alias', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    const directory = join(f.vault.directory, 'private-artifacts', 'workspace-interchange');
    await link(join(directory, `${backupId('backup', 'archive')}.encrypted.json`),
      join(directory, `${backupId('alias_backup', 'archive')}.encrypted.json`));
    await refusesExport(f, composed, 'INTERCHANGE_UNSAFE_FILE');
    await refusesExport(f, await f.reopen(), 'INTERCHANGE_UNSAFE_FILE', 'refused_reopened');
  });
  await t.test('tampered_ciphertext', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    const path = join(f.vault.directory, 'private-artifacts', 'workspace-interchange', `${backupId('backup', 'archive')}.encrypted.json`);
    const envelope = JSON.parse(await readFile(path, 'utf8'));
    const ciphertext = envelope.ciphertext.data as string;
    envelope.ciphertext.data = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
    await writeFile(path, JSON.stringify(envelope));
    await refusesExport(f, composed, 'ARTIFACT_AUTHENTICATION_FAILED');
    await refusesExport(f, await f.reopen(), 'ARTIFACT_AUTHENTICATION_FAILED', 'refused_reopened');
  });
  for (const mode of ['archive_record', 'archive_creation', 'pin_record', 'pin_creation', 'binding_owner', 'bound_ref', 'binding_alias'] as const) {
    await t.test(mode, async subtest => {
      const f = await fixture(subtest), composed = f.compose();
      await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
      if (mode.startsWith('archive_')) {
        const ref = await rewrite(f.vault, backupId('backup', 'archive'), value => {
          value[mode === 'archive_record' ? 'recordId' : 'creationId'] = 'different_issuance';
        });
        await rewrite(f.vault, backupId('backup', 'binding'), value => { value.archive = ref; });
      } else if (mode.startsWith('pin_')) {
        const ref = await rewrite(f.vault, backupId('backup', 'pin'), value => {
          value.pin[mode === 'pin_record' ? 'recordId' : 'creationId'] = 'different_issuance';
        });
        const pin = (await artifact(f.vault, ref.id)).value as any;
        await rewrite(f.vault, backupId('backup', 'binding'), value => {
          value.pin = ref; value.pinDigest = interchangeDigest(pin.pin);
        });
      } else if (mode === 'binding_owner') {
        await rewrite(f.vault, backupId('backup', 'binding'), value => { value.contextDigest = '0'.repeat(64); });
      } else if (mode === 'bound_ref') {
        await rewrite(f.vault, backupId('backup', 'binding'), value => { value.archive = value.pin; });
      } else {
        const binding = await artifact(f.vault, backupId('backup', 'binding'));
        await f.vault.writeArtifact({ id: backupId('alias_backup', 'binding'), purpose: binding.purpose,
          value: binding.value, expectedDigest: null });
      }
      await refusesExport(f, composed, 'BACKUP_CUSTODY_CHANGED');
    });
  }
});

test('preparing and discarded bindings with unresolved backup payloads require exact cleanup', { timeout: 30_000 }, async t => {
  for (const state of ['preparing', 'discarded']) await t.test(state, async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await rewrite(f.vault, backupId('backup', 'binding'), value => { value.state = state; });
    await refusesExport(f, composed, 'BACKUP_CLEANUP_REQUIRED');
    await refusesExport(f, await f.reopen(), 'BACKUP_CLEANUP_REQUIRED', 'refused_reopened');
  });
  await t.test('malformed_discarded_reference', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await remove(f.vault, backupId('backup', 'archive')); await remove(f.vault, backupId('backup', 'pin'));
    await rewrite(f.vault, backupId('backup', 'binding'), value => {
      value.state = 'discarded'; value.archive.purpose = 'private-trial';
    });
    await refusesExport(f, composed, 'BACKUP_CUSTODY_CHANGED');
  });
});

test('a physical backup control rewrite during export refuses its fence and revokes only the new export', { timeout: 30_000 }, async t => {
  const f = await fixture(t), composed = f.compose(), before = f.vault.read();
  const backup = await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
  const retained = await composed.backupLocal.ports.custody.read(interchangeOwner, backup.recordId);
  const path = join(f.vault.directory, 'private-artifacts', 'workspace-interchange', `${backupId('backup', 'archive')}.encrypted.json`);
  const prior = await readFile(path, 'utf8'), authority = await readFile(join(f.vault.directory, 'authority.encrypted.json'));
  const envelope = JSON.parse(prior);
  const rewritten = JSON.stringify(Object.fromEntries(Object.entries(envelope).reverse()));
  assert.notEqual(rewritten, prior); assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(prior));
  const ports = { ...composed.interchangeLocal.ports, custody: { ...composed.interchangeLocal.ports.custody,
    create: async (...args: Parameters<typeof composed.interchangeLocal.ports.custody.create>) => {
      const result = await composed.interchangeLocal.ports.custody.create(...args);
      await writeFile(path, rewritten); return result;
    } } };
  await assert.rejects(new WorkspaceInterchangeHost(ports).export(interchangeOwner,
    { destinationId: 'changed_control_export', confirmed: true }), code('INTERCHANGE_AUTHORITY_CHANGED'));
  assert.deepEqual(f.vault.read(), before);
  assert.deepEqual(await readFile(join(f.vault.directory, 'authority.encrypted.json')), authority);
  assert.deepEqual(await composed.backupLocal.ports.custody.read(interchangeOwner, backup.recordId), retained,
    'The backup remains authentic with unchanged identity, digest and ciphertext size.');
  const refs = await f.vault.listArtifacts({ purpose: 'workspace-interchange' });
  const exports = refs.filter(ref => ref.id.startsWith('wic_'));
  assert.equal(exports.length, 1); assert.ok(exports[0].id.endsWith('_commit'));
  assert.equal(((await artifact(f.vault, exports[0].id)).value as any).state, 'discarded');
  await assert.rejects(composed.interchangeLocal.ports.custody.read(interchangeOwner, 'changed_control_export'), code('INTERCHANGE_CUSTODY_NOT_COMMITTED'));
  await (await f.reopen()).interchange.export(interchangeOwner, { destinationId: 'later_valid_export', confirmed: true });
  assert.deepEqual(f.vault.read(), before);
});

test('typed control accounting retains exact source custodian and current owner and historical source authority', { timeout: 30_000 }, async t => {
  await t.test('wrong_open_source_custodian', async subtest => {
    const f = await fixture(subtest), other = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await refusesExport(f, f.compose({ backupControlCustody: other.compose().backupLocal }), 'BACKUP_SOURCE_SCOPE');
  });
  await t.test('missing_cross_module_custodian', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await refusesExport(f, f.compose({ backupControlCustody: undefined }), 'INTERCHANGE_CUSTODY_INCOMPLETE');
  });
  await t.test('root_readiness_revoked', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    f.revokeOwner();
    await refusesExport(f, composed, 'TEST_OWNER_REVOKED');
  });
  await t.test('current_owner_revoked', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await f.vault.update(draft => { draft.members.find(member => member.id === interchangeOwner.memberId)!.active = false; });
    await refusesExport(f, composed, 'ACCESS_REVOKED');
  });
  await t.test('historical_source_revoked_after_current_rows_removed', async subtest => {
    const f = await fixture(subtest), composed = f.compose();
    await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
    await f.vault.update(draft => {
      draft.facts = []; draft.imports = []; draft.sourceRules.push({ sourceId: 'demo-export', revoked: true });
    });
    await refusesExport(f, composed, 'SOURCE_REVOKED');
    await refusesExport(f, await f.reopen(), 'SOURCE_REVOKED', 'refused_reopened');
  });
});

test('exact empty, restored, rolled-back and absent failed-allocation reservations compose through restart', { timeout: 30_000 }, async t => {
  const f = await fixture(t), composed = f.compose(), before = f.vault.read();
  const backup = await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
  await composed.backupLocal.ports.withTarget(interchangeOwner, { targetId: 'empty_target' }, async lease => {
    await lease.assertEmpty();
  });
  const restored = await composed.backup.restoreInert(interchangeOwner,
    { backupId: backup.recordId, targetId: 'restored_target', reviewedDigest: backup.archiveDigest });
  const rollback = await composed.backup.restoreInert(interchangeOwner,
    { backupId: backup.recordId, targetId: 'rolled_back_target', reviewedDigest: backup.archiveDigest });
  await composed.backupLocal.ports.restore.rollback(interchangeOwner, { targetId: rollback.targetId,
    creationId: rollback.creationId, expectedArchiveDigest: rollback.archiveDigest });
  await assert.rejects(composed.backupLocal.ports.withTarget(interchangeOwner, { targetId: 'failed_allocation' }, async () => {
    throw new ChausarError('TEST_FAILED_ALLOCATION', 'Synthetic allocation callback failed before publication.');
  }), code('TEST_FAILED_ALLOCATION'));
  assert.deepEqual(await readdir(composed.backupLocal.targetPath('empty_target')), []);
  assert.deepEqual(await readdir(composed.backupLocal.targetPath('rolled_back_target')), []);
  await assert.rejects(lstat(composed.backupLocal.targetPath('failed_allocation')), { code: 'ENOENT' });
  const failed = (await artifact(f.vault, targetId('failed_allocation'))).value as any;
  assert.equal(failed.state, 'rolled-back'); assert.equal(failed.creationId, null);
  await composed.interchange.export(interchangeOwner, { destinationId: 'reservation_export', confirmed: true });
  const reopened = await f.reopen();
  assert.deepEqual((await reopened.backupLocal.ports.restore.readRestored(interchangeOwner,
    { targetId: restored.targetId, creationId: restored.creationId })).receipt, restored);
  await reopened.interchange.export(interchangeOwner, { destinationId: 'reservation_export_reopened', confirmed: true });
  await reopened.backup.create(interchangeOwner, { destinationId: 'reservation_backup_reopened', confirmed: true });
  await reopened.interchange.export(interchangeOwner, { destinationId: 'reservation_export_repeated', confirmed: true });
  assert.deepEqual(f.vault.read(), before);
});

test('unowned, changed and unresolved inert targets and external staging cannot be excluded as backup controls', { timeout: 30_000 }, async t => {
  for (const mode of ['empty_unknown_entry', 'empty_missing', 'restored_unknown_entry', 'restored_tampered',
    'restored_missing', 'restored_replaced_directory', 'rolled_back_leftover', 'reservation_owner', 'reservation_alias',
    'external_staging', 'external_stage_file'] as const) {
    await t.test(mode, async subtest => {
      const f = await fixture(subtest), composed = f.compose();
      const backup = await composed.backup.create(interchangeOwner, { destinationId: 'backup', confirmed: true });
      const id = 'inert_target', path = composed.backupLocal.targetPath(id);
      let expected = 'BACKUP_TARGET_CHANGED';
      if (mode.startsWith('empty_')) {
        await composed.backupLocal.ports.withTarget(interchangeOwner, { targetId: id }, async () => {});
        if (mode === 'empty_unknown_entry') {
          await writeFile(join(path, 'unexpected.fixture'), 'Synthetic unresolved target entry');
          expected = 'BACKUP_TARGET_CLEANUP_REQUIRED';
        } else { await rm(path, { recursive: true }); expected = 'BACKUP_TARGET_CLEANUP_REQUIRED'; }
      } else if (mode === 'external_staging') {
        await mkdir(join(f.applicationDirectory, '.workspace-backup-control', 'staging'));
        await writeFile(join(f.applicationDirectory, '.workspace-backup-control', 'staging', 'pending.fixture'), 'Synthetic unowned staged bytes');
        expected = 'BACKUP_INVENTORY_INCOMPLETE';
      } else if (mode === 'external_stage_file') {
        await writeFile(join(f.applicationDirectory, '.workspace-backup-control', 'targets', `${sha(id)}.stage`),
          'Synthetic unowned staging in an otherwise reviewed process-control section');
        expected = 'BACKUP_INVENTORY_INCOMPLETE';
      } else {
        await composed.backup.restoreInert(interchangeOwner,
          { backupId: backup.recordId, targetId: id, reviewedDigest: backup.archiveDigest });
        if (mode === 'restored_unknown_entry') await writeFile(join(path, 'unexpected.fixture'), 'Synthetic unresolved target entry');
        else if (mode === 'restored_tampered') {
          const container = join(path, 'backup.inert.json');
          await writeFile(container, `${await readFile(container, 'utf8')} `);
        } else if (mode === 'restored_missing') { await rm(path, { recursive: true }); expected = 'BACKUP_TARGET_CLEANUP_REQUIRED'; }
        else if (mode === 'restored_replaced_directory') {
          const bytes = await readFile(join(path, 'backup.inert.json'));
          await rm(path, { recursive: true }); await mkdir(path); await writeFile(join(path, 'backup.inert.json'), bytes);
        } else if (mode === 'rolled_back_leftover') {
          await rewrite(f.vault, targetId(id), value => { value.state = 'rolled-back'; });
          expected = 'BACKUP_TARGET_CLEANUP_REQUIRED';
        } else if (mode === 'reservation_owner') await rewrite(f.vault, targetId(id), value => { value.contextDigest = '0'.repeat(64); });
        else {
          const reservation = await artifact(f.vault, targetId(id));
          await f.vault.writeArtifact({ id: targetId('alias_target'), purpose: reservation.purpose,
            value: reservation.value, expectedDigest: null });
        }
      }
      await refusesExport(f, composed, expected);
      await refusesExport(f, await f.reopen(), expected, 'refused_reopened');
    });
  }
});
