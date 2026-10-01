import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { Vault, type PrivateArtifactPurpose } from '../runtime/vault.ts';
import {
  captureWorkspaceBackupV2, createWorkspaceBackupV2Host, encodeWorkspaceBackupV2, inspectWorkspaceBackupV2,
  validateWorkspaceBackupV2, workspaceBackupV2Bytes,
  type WorkspaceBackupV2Archive, type WorkspaceBackupV2Budgets, type WorkspaceBackupV2Capture,
  type WorkspaceBackupV2CustodyRecord, type WorkspaceBackupV2HostPorts, type WorkspaceBackupV2Measurement,
  type WorkspaceBackupV2Namespace, type WorkspaceBackupV2RestoreReceipt, type WorkspaceBackupV2SourceLease,
} from '../runtime/workspace-backup-v2.ts';

const budget: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 4_000_000, maxEntryBytes: 1_000_000,
  maxTotalEntryBytes: 2_000_000, maxEntries: 100, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const context: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: false };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function reseal(value: WorkspaceBackupV2Archive): string {
  const { digest: _old, ...body } = value; return canonical({ ...body, digest: sha(canonical(body)) });
}
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'chausar-backup-v2-'));
  if (process.platform === 'win32') assert.match(root, /^C:\\/i);
  t.after(async () => {
    const child = relative(parent, root);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-v2-'));
    await rm(root, { recursive: true, force: true });
  });
  const passphrase = 'Synthetic archive backup passphrase';
  const { vault, recoveryCode } = await Vault.create({ directory: join(root, 'source'), storage: 'experimental-file',
    passphrase, name: 'Synthetic complete archive', demo: true });
  t.after(() => vault.close());
  // Deliberately cover control and terminal status records that business transfer omits.
  const values = [
    ['trial_fork', 'private-trial', { type: 'private-trial-fork-v1', version: 1, secret: 'Synthetic fork secret' }],
    ['trial_evaluation', 'private-trial', { type: 'private-trial-evaluation-v1', version: 1 }],
    ['trial_binding', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'discarded' }],
    ['trial_promoting', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'promoting' }],
    ['trial_promoted', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'promoted' }],
    ['wic_archive', 'workspace-interchange', { format: 'chausar.interchange-archive.v1', secret: 'Synthetic archive secret' }],
    ['wic_pin', 'workspace-interchange', { format: 'chausar.interchange-custody-pin.v1' }],
    ['wic_commit', 'workspace-interchange', { format: 'chausar.interchange-local-binding.v1', state: 'committed' }],
    ['wic_tombstone', 'workspace-interchange', { format: 'chausar.interchange-local-binding.v1', state: 'discarded' }],
    ['wit_reservation', 'workspace-interchange', { format: 'chausar.interchange-target-reservation.v1' }],
  ] as const;
  const artifacts: WorkspaceBackupV2Capture['artifacts'] = [];
  for (const [id, purpose, value] of values) {
    const ref = await vault.writeArtifact({ id, purpose, value, expectedDigest: null });
    artifacts.push({ ref, bytes: await readFile(join(vault.directory, 'private-artifacts', purpose, `${id}.encrypted.json`)) });
  }
  const authority = await readFile(join(vault.directory, 'authority.encrypted.json'));
  const namespaces: WorkspaceBackupV2Namespace[] = [{ namespace: 'authority', disposition: 'included', entries: 1, bytes: authority.length, requirement: '' }];
  for (const purpose of ['private-trial', 'workspace-interchange'] as PrivateArtifactPurpose[]) {
    const entries = artifacts.filter(item => item.ref.purpose === purpose);
    namespaces.push({ namespace: `private-artifacts/${purpose}`, disposition: 'included', entries: entries.length,
      bytes: entries.reduce((sum, item) => sum + item.bytes.length, 0), requirement: '' });
  }
  namespaces.push({ namespace: 'workspace/reports', disposition: 'empty', entries: 0, bytes: 0, requirement: '' },
    { namespace: 'application/exports', disposition: 'outside-archive', entries: 1, bytes: 123, requirement: 'Root must separately retain the synthetic application export.' },
    { namespace: 'application/workspace-interchange-control', disposition: 'transient', entries: 1, bytes: 12, requirement: 'Process locks must be reacquired and must never be restored.' });
  const capture: WorkspaceBackupV2Capture = { source: { vaultId: vault.vaultId, workspaceId: vault.read().workspace.id,
    revision: vault.read().revision, captureId: 'synthetic_capture', enumerationId: 'synthetic_enumeration' }, authority, artifacts, namespaces,
    externalKeyRequirements: [{ provider: 'keychain', namespace: 'operator/keychain', requirement: 'Root must separately register a destination keychain; archive contains credential-wrapped keys only.' }] };
  return { root, vault, passphrase, recoveryCode, capture };
}

test('exact original envelopes and all private controls survive archive roundtrip and real credential authentication', async t => {
  const { root, vault, passphrase, recoveryCode, capture } = await fixture(t);
  const archive = captureWorkspaceBackupV2(capture, budget), wire = encodeWorkspaceBackupV2(archive, budget);
  const decoded = workspaceBackupV2Bytes(validateWorkspaceBackupV2(wire, archive.pin, budget), budget);
  assert.deepEqual(decoded.authority, capture.authority);
  assert.equal(decoded.artifacts.length, 10); assert.equal(archive.pin.fullWorkspacePortable, false);
  assert.ok(!wire.includes('Synthetic fork secret') && !wire.includes('Synthetic archive secret') && !wire.includes(passphrase) && !wire.includes(recoveryCode));
  for (const item of decoded.artifacts) {
    const original = capture.artifacts.find(entry => entry.ref.id === item.ref.id && entry.ref.purpose === item.ref.purpose)!;
    assert.deepEqual(item, original);
  }
  const envelope = JSON.parse(Buffer.from(decoded.authority).toString('utf8'));
  assert.deepEqual(Object.keys(envelope.passphrase), ['salt', 'kdf', 'ciphertext']);
  assert.deepEqual(Object.keys(envelope.passphrase.ciphertext), ['nonce', 'tag', 'data']);
  const v1 = join(root, 'synthetic-original-envelope.backup');
  await writeFile(v1, `{"backupFormat":"chausar.backup.v1","envelope":${Buffer.from(decoded.authority).toString('utf8')}}`);
  const restored = await Vault.restore({ directory: join(root, 'synthetic-empty-authentication-target'), storage: 'experimental-file', backupFile: v1, passphrase });
  t.after(() => restored.close());
  for (const item of decoded.artifacts) {
    const directory = join(restored.directory, 'private-artifacts', item.ref.purpose); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${item.ref.id}.encrypted.json`), item.bytes);
    assert.deepEqual(await restored.readArtifact(item.ref), await vault.readArtifact(item.ref));
  }
  const recovered = await Vault.restore({ directory: join(root, 'synthetic-empty-recovery-target'), storage: 'experimental-file', backupFile: v1, recoveryCode,
    newPassphrase: 'Synthetic replacement recovery passphrase' });
  t.after(() => recovered.close()); assert.equal(recovered.read().workspace.id, capture.source.workspaceId);
  const badV1 = join(root, 'synthetic-sorted-wrapper.backup');
  await writeFile(badV1, canonical({ backupFormat: 'chausar.backup.v1', envelope }));
  await assert.rejects(Vault.restore({ directory: join(root, 'synthetic-empty-rejected-target'), storage: 'experimental-file', backupFile: badV1, passphrase }), { code: 'UNLOCK_FAILED' });
});

test('pure codec preserves valid whitespace and insertion order inside original encrypted envelope bytes', async t => {
  const { capture } = await fixture(t);
  capture.authority = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(capture.authority).toString('utf8')), null, 2));
  capture.namespaces.find(item => item.namespace === 'authority')!.bytes = capture.authority.byteLength;
  const archive = captureWorkspaceBackupV2(capture, budget);
  assert.deepEqual(workspaceBackupV2Bytes(archive, budget).authority, capture.authority);
});

test('strict archive refuses missing, duplicate, unknown, truncated, tampered and wrong-bound entries', async t => {
  const { capture } = await fixture(t), archive = captureWorkspaceBackupV2(capture, budget);
  const invalid: { name: string; alter(value: any): void }[] = [
    { name: 'unknown archive field', alter: value => { value.rawKey = 'forbidden'; } },
    { name: 'missing body', alter: value => { value.artifacts.pop(); } },
    { name: 'extra body', alter: value => { value.artifacts.push(value.artifacts[0]); } },
    { name: 'duplicate manifest', alter: value => { value.pin.artifacts[1] = value.pin.artifacts[0]; } },
    { name: 'unknown purpose', alter: value => { value.pin.artifacts[0].purpose = 'unreviewed'; } },
    { name: 'purpose substitution', alter: value => { value.artifacts[0].purpose = 'workspace-interchange'; } },
    { name: 'wrong source vault', alter: value => { value.pin.source.vaultId = 'different_vault'; } },
    { name: 'wrong revision', alter: value => { value.pin.source.revision++; } },
    { name: 'truncated authority', alter: value => { value.authorityBase64 = value.authorityBase64.slice(0, -4); } },
    { name: 'alternate base64', alter: value => { value.artifacts[0].dataBase64 += '\n'; } },
    { name: 'wrong ciphertext digest', alter: value => { value.pin.artifacts[0].sha256 = 'f'.repeat(64); } },
    { name: 'wrong byte count', alter: value => { value.pin.artifacts[0].bytes++; } },
    { name: 'missing namespace', alter: value => { value.pin.namespaces = value.pin.namespaces.filter((item: any) => item.namespace !== 'private-artifacts/private-trial'); } },
    { name: 'unclassified namespace', alter: value => { value.pin.namespaces.push({ namespace: 'workspace/unknown', disposition: 'included', entries: 1, bytes: 1, requirement: '' }); } },
    { name: 'unsafe count', alter: value => { value.pin.authority.bytes = Number.MAX_SAFE_INTEGER + 1; } },
  ];
  for (const item of invalid) {
    const changed = structuredClone(archive); item.alter(changed);
    assert.throws(() => inspectWorkspaceBackupV2(reseal(changed), budget), (error: unknown) => error instanceof ChausarError, item.name);
  }
  const wire = encodeWorkspaceBackupV2(archive, budget);
  assert.throws(() => inspectWorkspaceBackupV2(wire.slice(0, -1), budget), { code: 'BACKUP_JSON' });
  assert.throws(() => inspectWorkspaceBackupV2(wire.replace('"backupFormat":', '"backupFormat":"duplicate","backupFormat":'), budget), { code: 'BACKUP_DUPLICATE' });
  assert.throws(() => inspectWorkspaceBackupV2(`${wire}\n`, budget), { code: 'BACKUP_CANONICAL' });
});

test('independent source pin rejects coherent attacker rehash after omissions or workspace substitution', async t => {
  const { capture } = await fixture(t), archive = captureWorkspaceBackupV2(capture, budget), changed = structuredClone(archive);
  const removed = changed.pin.artifacts.pop()!; changed.artifacts.pop();
  const namespace = changed.pin.namespaces.find(item => item.namespace === `private-artifacts/${removed.purpose}`)!;
  namespace.entries--; namespace.bytes -= removed.bytes;
  const forged = reseal(changed); assert.equal(inspectWorkspaceBackupV2(forged, budget).artifacts.length, 9);
  assert.throws(() => validateWorkspaceBackupV2(forged, archive.pin, budget), { code: 'BACKUP_SOURCE_CHANGED' });
  const otherWorkspace = structuredClone(archive); otherWorkspace.pin.source.workspaceId = 'different_workspace';
  assert.throws(() => validateWorkspaceBackupV2(reseal(otherWorkspace), archive.pin, budget), { code: 'BACKUP_SOURCE_CHANGED' });
});

test('encrypted envelopes reject invalid JSON duplicates, UTF-8, ciphertext shapes and filesystem case aliases', async t => {
  const { capture } = await fixture(t);
  const duplicate = structuredClone(capture), authorityText = Buffer.from(duplicate.authority).toString('utf8');
  duplicate.authority = Buffer.from(authorityText.replace('"format":', '"format":"duplicate","format":'));
  duplicate.namespaces.find(item => item.namespace === 'authority')!.bytes = duplicate.authority.byteLength;
  assert.throws(() => captureWorkspaceBackupV2(duplicate, budget), { code: 'BACKUP_DUPLICATE' });
  const invalidUtf8 = structuredClone(capture); invalidUtf8.authority = Buffer.from([0xff]); invalidUtf8.namespaces.find(item => item.namespace === 'authority')!.bytes = 1;
  assert.throws(() => captureWorkspaceBackupV2(invalidUtf8, budget), { code: 'BACKUP_ENCODING' });
  const changed = structuredClone(capture), envelope = JSON.parse(Buffer.from(changed.artifacts[0].bytes).toString('utf8'));
  envelope.ciphertext.nonce = 'AA'; changed.artifacts[0].bytes = Buffer.from(JSON.stringify(envelope)); changed.artifacts[0].ref.diskBytes = changed.artifacts[0].bytes.byteLength;
  changed.namespaces.find(item => item.namespace === 'private-artifacts/private-trial')!.bytes += changed.artifacts[0].bytes.byteLength - capture.artifacts[0].bytes.byteLength;
  assert.throws(() => captureWorkspaceBackupV2(changed, budget), { code: 'BACKUP_ENCODING' });
  const caseAlias = structuredClone(capture), alias = structuredClone(caseAlias.artifacts[0]);
  alias.ref.id = alias.ref.id.toUpperCase(); caseAlias.artifacts.push(alias);
  caseAlias.namespaces.find(item => item.namespace === 'private-artifacts/private-trial')!.entries++;
  caseAlias.namespaces.find(item => item.namespace === 'private-artifacts/private-trial')!.bytes += alias.bytes.byteLength;
  assert.throws(() => captureWorkspaceBackupV2(caseAlias, budget), { code: 'BACKUP_MANIFEST' });
});

test('explicit byte, count, depth and node budgets refuse whole captures without silently truncating scope', async t => {
  const { capture } = await fixture(t), archive = captureWorkspaceBackupV2(capture, budget), wire = encodeWorkspaceBackupV2(archive, budget);
  assert.throws(() => captureWorkspaceBackupV2(capture, { ...budget, maxEntries: 10 }), { code: 'BACKUP_LIMIT' });
  assert.throws(() => captureWorkspaceBackupV2(capture, { ...budget, maxEntryBytes: 20 }), { code: 'BACKUP_LIMIT' });
  const total = capture.authority.byteLength + capture.artifacts.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  const maximum = Math.max(capture.authority.byteLength, ...capture.artifacts.map(item => item.bytes.byteLength));
  assert.throws(() => captureWorkspaceBackupV2(capture, { ...budget, maxTotalEntryBytes: total - 1, maxEntryBytes: maximum }), { code: 'BACKUP_LIMIT' });
  assert.throws(() => inspectWorkspaceBackupV2(wire, { ...budget, maxArchiveUtf8Bytes: wire.length - 1 }), { code: 'BACKUP_LIMIT' });
  assert.throws(() => inspectWorkspaceBackupV2(wire, { ...budget, maxJsonDepth: 2 }), { code: 'BACKUP_LIMIT' });
  assert.throws(() => inspectWorkspaceBackupV2(wire, { ...budget, maxJsonNodes: 10 }), { code: 'BACKUP_LIMIT' });
  assert.throws(() => captureWorkspaceBackupV2(capture, { ...budget, maxEntries: 0 }), { code: 'BACKUP_BUDGET_REQUIRED' });
});

function hostFixture(capture: WorkspaceBackupV2Capture, state: ReturnType<Vault['read']>) {
  const measurement: WorkspaceBackupV2Measurement = { encrypted: true, archiveCiphertextBytes: 1000, pinCiphertextBytes: 500, qualification: 'test-fixture' };
  const records = new Map<string, WorkspaceBackupV2CustodyRecord>(), targets = new Map<string, { content: string; receipt: WorkspaceBackupV2RestoreReceipt }>();
  const faults = { sourceChanged: false, sourceChangeOnCreate: false, sourceExit: false, targetExit: false, targetNonempty: false, targetChangeOnRestore: false, partialReceipt: false,
    restoreReadback: false, createReadback: false, remove: false, rollback: false, skipCreatePublicationFence: false, skipRestorePublicationFence: false,
    failArchiveAuthentication: false, ownerRevoked: false, ownerRevokedOnRead: false, deferredOwner: false, sourceNotReady: false,
    changeCreationOnAuthentication: false, changeMeasurementAfterAuthentication: false, targetChangesOnSecondRead: false,
    sourceCallback: 1, targetCallback: 1 };
  const events: string[] = [];
  const lease: WorkspaceBackupV2SourceLease = { independentlyEnumerated: true, state, capture,
    async assertCurrent() { events.push('source-current'); if (faults.sourceChanged) throw new ChausarError('TEST_SOURCE_CHANGED', 'Synthetic source changed.'); },
    async assertCompleteOwner() { events.push('owner'); if (faults.deferredOwner) return { pending: true } as never; },
    async authenticateCapture(value) { events.push('authenticate-capture'); assert.deepEqual(value, structuredClone(capture)); } };
  const ports: WorkspaceBackupV2HostPorts = {
    async withSource(_context, _expected, work) { let result: unknown;
      for (let index = 0; index < faults.sourceCallback; index++) result = await work(lease);
      if (faults.sourceExit) throw new ChausarError('TEST_SOURCE_EXIT', 'Synthetic source exit failed.'); return result as never; },
    async withTarget(_context, input, work) { let result: unknown;
      for (let index = 0; index < faults.targetCallback; index++) result = await work({ inspection: { targetId: input.targetId, locationId: 'synthetic_location',
        generation: 'synthetic_generation', ready: true, authorityRecords: 0, artifactRecords: 0, unexpectedEntries: faults.targetNonempty ? ['foreign'] : [] },
        async assertCurrent() { events.push('target-current'); if (faults.targetChangeOnRestore) throw new ChausarError('TEST_TARGET_CHANGED', 'Synthetic physical target changed.'); },
        async assertEmpty() { events.push('target-empty'); assert.equal(targets.has(input.targetId), false); } });
      if (faults.targetExit) throw new ChausarError('TEST_TARGET_EXIT', 'Synthetic target exit failed.'); return result as never; },
    async assertRestoreOwner(_context, source) { events.push('restore-owner'); assert.deepEqual(source, capture.source);
      if (faults.sourceChanged) throw new ChausarError('TEST_SOURCE_CHANGED', 'Synthetic source changed.');
      if (faults.sourceNotReady) throw new ChausarError('TEST_SOURCE_NOT_READY', 'Synthetic source is not ready.');
      if (faults.ownerRevoked) throw new ChausarError('TEST_OWNER_REVOKED', 'Synthetic owner epoch changed.'); },
    async authenticateArchive() { events.push('authenticate-archive'); if (faults.failArchiveAuthentication) throw new ChausarError('TEST_AUTHENTICATION', 'Synthetic authentication failed.');
      if (faults.changeCreationOnAuthentication) for (const record of records.values()) record.pin.creationId = 'changed_creation'; },
    custody: {
      async create(_context, record, assertCurrent) { if (!faults.skipCreatePublicationFence) await assertCurrent();
        assert.equal(records.has(record.pin.recordId), false); events.push('create'); records.set(record.pin.recordId, structuredClone(record));
        if (faults.sourceChangeOnCreate) faults.sourceChanged = true; return structuredClone(measurement); },
      async read(_context, recordId) { assert.ok(records.has(recordId)); const retained = structuredClone(records.get(recordId)!);
        if (faults.ownerRevokedOnRead && events.includes('restore-owner')) faults.ownerRevoked = true;
        if (faults.createReadback) retained.pin.creationId = 'different_creation';
        const measured = structuredClone(measurement);
        if (faults.changeMeasurementAfterAuthentication && events.includes('authenticate-archive')) measured.archiveCiphertextBytes++;
        return { ...retained, measurement: measured }; },
      async remove(_context, input) { events.push('remove'); if (faults.remove) throw new Error('Synthetic cleanup unavailable.');
        const record = records.get(input.recordId)!; assert.equal(record.pin.creationId, input.creationId); assert.equal(record.pin.archiveDigest, input.expectedArchiveDigest);
        assert.equal(sha(canonical(record.pin)), input.expectedPinDigest); records.delete(input.recordId); },
    },
    restore: {
      async restoreAtomic(_context, input, assertEmptyCurrent) { if (!faults.skipRestorePublicationFence) await assertEmptyCurrent();
        assert.equal(targets.has(input.target.targetId), false); events.push('restore');
        const receipt: WorkspaceBackupV2RestoreReceipt = { targetId: input.target.targetId, creationId: input.creationId, archiveDigest: input.archive.digest,
          sourcePin: structuredClone(input.archive.pin), entries: input.archive.pin.artifacts.length + 1,
          bytes: input.archive.pin.authority.bytes + input.archive.pin.artifacts.reduce((sum, item) => sum + item.bytes, 0), inert: true, activation: 'root-only' };
        targets.set(receipt.targetId, { content: encodeWorkspaceBackupV2(input.archive, budget), receipt: structuredClone(receipt) });
        return faults.partialReceipt ? { ...receipt, entries: receipt.entries - 1 } : receipt; },
      async readRestored(_context, input) { const retained = structuredClone(targets.get(input.targetId)!);
        events.push('read-restored');
        if (faults.targetChangesOnSecondRead && events.filter(event => event === 'read-restored').length === 2) retained.receipt.bytes--;
        if (faults.restoreReadback) retained.receipt.creationId = 'different_creation'; return retained; },
      async rollback(_context, input) { events.push('rollback'); if (faults.rollback) throw new Error('Synthetic rollback unavailable.');
        const record = targets.get(input.targetId)!; assert.equal(record.receipt.creationId, input.creationId); assert.equal(record.receipt.archiveDigest, input.expectedArchiveDigest);
        targets.delete(input.targetId); },
    },
  };
  const host = createWorkspaceBackupV2Host(ports, budget);
  return { host, ports, faults, records, targets, events };
}

test('host holds source and empty-target guards through exact authenticated inert custody readback', async t => {
  const { capture, vault } = await fixture(t), { host, records, targets, events } = hostFixture(capture, vault.read());
  const summary = await host.create(context, { destinationId: 'synthetic_backup', confirmed: true });
  assert.equal(summary.entries, 11); assert.equal(summary.measurement.qualification, 'test-fixture');
  const restored = await host.restoreInert(context, { backupId: summary.recordId, targetId: 'synthetic_empty_target', reviewedDigest: summary.archiveDigest });
  assert.equal(restored.inert, true); assert.equal(restored.activation, 'root-only'); assert.equal(restored.entries, 11);
  assert.equal(targets.get(restored.targetId)!.content, records.get(summary.recordId)!.content);
  assert.ok(events.indexOf('authenticate-capture') < events.indexOf('create'));
  assert.ok(events.indexOf('authenticate-archive') < events.indexOf('restore')); assert.ok(events.lastIndexOf('target-current') > events.indexOf('restore'));
});

test('host refuses unauthorized/deferred owners and public paths, ports or unreviewed digests before publication', async t => {
  const { capture, vault } = await fixture(t), fixtureHost = hostFixture(capture, vault.read()), { host, records } = fixtureHost;
  await assert.rejects(host.create({ ...context, channel: 'phone' }, { destinationId: 'backup', confirmed: true }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(host.create({ ...context, epoch: 2 }, { destinationId: 'backup', confirmed: true }), { code: 'ACCESS_REVOKED' });
  await assert.rejects(host.create(context, { destinationId: '../arbitrary', confirmed: true }), { code: 'CONFIRMATION_REQUIRED' });
  await assert.rejects(host.create(context, { destinationId: 'backup', confirmed: true, ports: {} } as never), { code: 'BACKUP_SHAPE' });
  fixtureHost.faults.deferredOwner = true;
  await assert.rejects(host.create(context, { destinationId: 'backup', confirmed: true }), { code: 'BACKUP_HOST_GUARD' });
  assert.equal(records.size, 0); fixtureHost.faults.deferredOwner = false;
  const summary = await host.create(context, { destinationId: 'backup', confirmed: true });
  await assert.rejects(host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: 'f'.repeat(64) }), { code: 'BACKUP_REVIEW_CHANGED' });
  fixtureHost.faults.failArchiveAuthentication = true;
  await assert.rejects(host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest }), { code: 'TEST_AUTHENTICATION' });
  assert.equal(fixtureHost.targets.size, 0);
});

test('source publication/readback/lease-exit failures remove only the exact owned custody record', async t => {
  const { capture, vault } = await fixture(t);
  for (const fault of ['createReadback', 'sourceChangeOnCreate', 'sourceExit', 'skipCreatePublicationFence'] as const) {
    const { host, faults, records, events } = hostFixture(capture, vault.read()); faults[fault] = true;
    await assert.rejects(host.create(context, { destinationId: 'backup', confirmed: true }));
    assert.equal(records.size, 0, fault); assert.ok(events.includes('remove'), fault);
  }
  const failed = hostFixture(capture, vault.read()); failed.faults.createReadback = true; failed.faults.remove = true;
  await assert.rejects(failed.host.create(context, { destinationId: 'backup', confirmed: true }), { code: 'BACKUP_CLEANUP_REQUIRED' });
  assert.equal(failed.records.size, 1);
  const changed = hostFixture(capture, vault.read()); changed.faults.sourceChanged = true;
  await assert.rejects(changed.host.create(context, { destinationId: 'backup', confirmed: true }), { code: 'TEST_SOURCE_CHANGED' }); assert.equal(changed.records.size, 0);
});

test('owner epoch revocation during awaited custody read is rechecked before any target publication', async t => {
  const { capture, vault } = await fixture(t), { host, faults, targets, events } = hostFixture(capture, vault.read());
  const summary = await host.create(context, { destinationId: 'backup', confirmed: true }); faults.ownerRevokedOnRead = true;
  await assert.rejects(host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest }), { code: 'TEST_OWNER_REVOKED' });
  assert.equal(targets.size, 0); assert.equal(events.includes('restore'), false);
});

test('target nonempty, partial receipt, altered readback and final lease failure cannot leave an adopted restore', async t => {
  const { capture, vault } = await fixture(t);
  for (const fault of ['targetNonempty', 'targetChangeOnRestore', 'partialReceipt', 'restoreReadback', 'targetExit', 'skipRestorePublicationFence'] as const) {
    const { host, faults, targets, events } = hostFixture(capture, vault.read()), summary = await host.create(context, { destinationId: 'backup', confirmed: true });
    faults[fault] = true; await assert.rejects(host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest }));
    assert.equal(targets.size, 0, fault);
    assert.equal(events.includes('rollback'), !['targetNonempty', 'targetChangeOnRestore'].includes(fault), fault);
  }
  const failed = hostFixture(capture, vault.read()), summary = await failed.host.create(context, { destinationId: 'backup', confirmed: true });
  failed.faults.partialReceipt = true; failed.faults.rollback = true;
  await assert.rejects(failed.host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest }), { code: 'BACKUP_RESTORE_CLEANUP_REQUIRED' });
  assert.equal(failed.targets.size, 1); assert.equal(failed.targets.get('target')!.receipt.inert, true);
});

test('root source/target leases must invoke callbacks exactly once and clean prior owned publication on duplicate callback', async t => {
  const { capture, vault } = await fixture(t);
  for (const sourceCallback of [0, 2]) {
    const { host, faults, records } = hostFixture(capture, vault.read()); faults.sourceCallback = sourceCallback;
    await assert.rejects(host.create(context, { destinationId: 'backup', confirmed: true }), { code: 'BACKUP_HOST_CUSTODY' }); assert.equal(records.size, 0);
  }
  for (const targetCallback of [0, 2]) {
    const { host, faults, targets } = hostFixture(capture, vault.read()), summary = await host.create(context, { destinationId: 'backup', confirmed: true }); faults.targetCallback = targetCallback;
    await assert.rejects(host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest }), { code: 'BACKUP_HOST_CUSTODY' }); assert.equal(targets.size, 0);
  }
});

test('authenticated public readback reopens committed custody through reconstructed hosts and returns metadata only', async t => {
  const { capture, vault, passphrase, root } = await fixture(t), fixtureHost = hostFixture(capture, vault.read());
  const summary = await fixtureHost.host.create(context, { destinationId: 'backup', confirmed: true });
  const reopened = createWorkspaceBackupV2Host(fixtureHost.ports, budget), backup = await reopened.read(context, { backupId: 'backup' });
  const retained = fixtureHost.records.get('backup')!;
  assert.deepEqual(backup, { summary, creationId: retained.pin.creationId, sourcePin: retained.pin.sourcePin });
  const receipt = await reopened.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest });
  const reconstructed = createWorkspaceBackupV2Host(fixtureHost.ports, budget);
  const restored = await reconstructed.readRestored(context, { backupId: 'backup', targetId: 'target', creationId: receipt.creationId, reviewedDigest: summary.archiveDigest });
  assert.deepEqual(restored, { receipt, summary, sourcePin: retained.pin.sourcePin });
  assert.equal(restored.receipt.inert, true); assert.equal(restored.receipt.activation, 'root-only');
  assert.equal(restored.summary.measurement.qualification, 'test-fixture');
  for (const output of [backup, restored]) {
    const text = JSON.stringify(output);
    for (const forbidden of ['authorityBase64', 'dataBase64', 'ciphertext', 'Synthetic fork secret', 'Synthetic archive secret', passphrase, root]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  }
});

test('public backup read refuses malformed payloads, stale contexts, unavailable source readiness and unauthenticated archives', async t => {
  const { capture, vault } = await fixture(t), fixtureHost = hostFixture(capture, vault.read());
  await fixtureHost.host.create(context, { destinationId: 'backup', confirmed: true });
  await assert.rejects(fixtureHost.host.read(context, { backupId: 'backup', path: '../caller-selected' } as never), { code: 'BACKUP_SHAPE' });
  await assert.rejects(fixtureHost.host.read(context, { backupId: '../caller-selected' }), { code: 'BACKUP_REVIEW_REQUIRED' });
  for (const deniedContext of [{ ...context, channel: 'phone' as const }, { ...context, sourceTainted: true }, { ...context, role: 'viewer' as const }]) {
    await assert.rejects(fixtureHost.host.read(deniedContext, { backupId: 'backup' }), { code: 'APP_APPROVAL_REQUIRED' });
  }
  await assert.rejects(fixtureHost.host.read({ ...context, epoch: 2 }, { backupId: 'backup' }), { code: 'BACKUP_HOST_CUSTODY' });
  for (const [fault, code] of [['sourceNotReady', 'TEST_SOURCE_NOT_READY'], ['sourceChanged', 'TEST_SOURCE_CHANGED'],
    ['ownerRevoked', 'TEST_OWNER_REVOKED'], ['failArchiveAuthentication', 'TEST_AUTHENTICATION']] as const) {
    const current = hostFixture(capture, vault.read()); await current.host.create(context, { destinationId: 'backup', confirmed: true }); current.faults[fault] = true;
    await assert.rejects(current.host.read(context, { backupId: 'backup' }), { code }); assert.equal(current.events.includes('remove'), false);
  }
  const malformed = structuredClone(fixtureHost.records.get('backup')!); malformed.pin.sourcePin.source.vaultId = 'different_source'; fixtureHost.records.set('backup', malformed);
  await assert.rejects(fixtureHost.host.read(context, { backupId: 'backup' }), { code: 'BACKUP_SOURCE_CHANGED' });
  malformed.pin.sourcePin.source.vaultId = capture.source.vaultId; malformed.content = malformed.content.slice(0, -1);
  await assert.rejects(fixtureHost.host.read(context, { backupId: 'backup' }), { code: 'BACKUP_JSON' });
});

test('public backup read rechecks exact issuance, measurements and owner epoch after awaited authentication', async t => {
  const { capture, vault } = await fixture(t);
  for (const [fault, code] of [['changeCreationOnAuthentication', 'BACKUP_SOURCE_CHANGED'],
    ['changeMeasurementAfterAuthentication', 'BACKUP_SOURCE_CHANGED'], ['ownerRevokedOnRead', 'TEST_OWNER_REVOKED']] as const) {
    const current = hostFixture(capture, vault.read()); await current.host.create(context, { destinationId: 'backup', confirmed: true }); current.faults[fault] = true;
    await assert.rejects(current.host.read(context, { backupId: 'backup' }), { code });
    assert.equal(current.records.size, 1); assert.equal(current.events.includes('remove'), false);
  }
});

test('public inert target readback refuses changed complete target bytes, pins, receipts and late binding changes', async t => {
  const { capture, vault } = await fixture(t), current = hostFixture(capture, vault.read());
  const summary = await current.host.create(context, { destinationId: 'backup', confirmed: true });
  const receipt = await current.host.restoreInert(context, { backupId: 'backup', targetId: 'target', reviewedDigest: summary.archiveDigest });
  const input = { backupId: 'backup', targetId: 'target', creationId: receipt.creationId, reviewedDigest: summary.archiveDigest };
  await assert.rejects(current.host.readRestored(context, { ...input, ports: {} } as never), { code: 'BACKUP_SHAPE' });
  await assert.rejects(current.host.readRestored(context, { ...input, targetId: '../caller-selected' }), { code: 'BACKUP_REVIEW_REQUIRED' });
  await assert.rejects(current.host.readRestored(context, { ...input, reviewedDigest: 'f'.repeat(64) }), { code: 'BACKUP_REVIEW_CHANGED' });
  await assert.rejects(current.host.readRestored(context, { ...input, creationId: 'different_creation' }), { code: 'BACKUP_PARTIAL_RESTORE' });
  const baseline = structuredClone(current.targets.get('target')!);
  const changes: { name: string; change(value: typeof baseline): void }[] = [
    { name: 'target identity', change: value => { value.receipt.targetId = 'different_target'; } },
    { name: 'creation binding', change: value => { value.receipt.creationId = 'different_creation'; } },
    { name: 'archive digest binding', change: value => { value.receipt.archiveDigest = 'f'.repeat(64); } },
    { name: 'source pin binding', change: value => { value.receipt.sourcePin.source.enumerationId = 'changed_enumeration'; } },
    { name: 'partial entry receipt', change: value => { value.receipt.entries--; } },
    { name: 'partial byte receipt', change: value => { value.receipt.bytes--; } },
    { name: 'activated target', change: value => { value.receipt.inert = false as never; } },
    { name: 'truncated target archive', change: value => { value.content = value.content.slice(0, -1); } },
    { name: 'coherent wrong target source', change: value => { const archive = JSON.parse(value.content) as WorkspaceBackupV2Archive;
      archive.pin.source.workspaceId = 'different_workspace'; value.content = reseal(archive); } },
  ];
  for (const changed of changes) {
    const altered = structuredClone(baseline); changed.change(altered); current.targets.set('target', altered);
    await assert.rejects(current.host.readRestored(context, input), (error: unknown) => error instanceof ChausarError, changed.name);
    assert.equal(current.events.includes('rollback'), false, changed.name);
  }
  current.targets.set('target', baseline); current.events.length = 0; current.faults.targetChangesOnSecondRead = true;
  await assert.rejects(current.host.readRestored(context, input), { code: 'BACKUP_PARTIAL_RESTORE' });
  assert.equal(current.events.filter(event => event === 'read-restored').length, 2);
  assert.equal(current.events.includes('rollback'), false);
});
