import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, ChausarError, type Context, type State } from '../runtime/contracts.ts';
import { Vault, type PrivateArtifactRef, type VaultEncryptedCustodyCapture } from '../runtime/vault.ts';
import {
  createWorkspaceBackupV2Host, inspectWorkspaceBackupV2, workspaceBackupV2Bytes,
  type WorkspaceBackupV2Budgets, type WorkspaceBackupV2HostPorts,
} from '../runtime/workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts } from '../runtime/workspace-backup-local.ts';

const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 4_000_000, maxEntryBytes: 1_000_000,
  maxTotalEntryBytes: 2_000_000, maxEntries: 100, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const filesystemBudgets = { maxFiles: 100, maxBytes: 4_000_000, maxDepth: 16 };
const externalKeyRequirements = [{ provider: 'other' as const, namespace: 'operator/credential-wrappers',
  requirement: 'Root must separately retain the synthetic operator credential used to unwrap encrypted authority.' }];
const encryptedBudgets = { maxEntryBytes: budgets.maxEntryBytes, maxTotalEntryBytes: budgets.maxTotalEntryBytes,
  maxArtifacts: budgets.maxEntries - 1 };
const context: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: false };
const passphrase = 'Synthetic complete local backup passphrase';
const privateSecret = 'Synthetic private fork secret 619183';
const archiveSecret = 'Synthetic archived customer secret 721842';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identity = (ref: PrivateArtifactRef) => `${ref.purpose}/${ref.id}`;
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

async function fixture(t: TestContext, populate = true) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate canonical C-drive scratch before creating fixture files.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-backup-local-')));
  assert.equal(dirname(applicationDirectory), base);
  const created = await Vault.create({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file',
    passphrase, name: 'Synthetic exact encrypted backup', demo: true });
  let vault = created.vault, guardCalls = 0, ownerRevoked = false;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(applicationDirectory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-local-'));
    await rm(actual, { recursive: true, force: true });
  });
  const assertCompleteOwner = async (current: Context, historical: State) => {
    guardCalls++;
    if (ownerRevoked) throw new ChausarError('TEST_OWNER_REVOKED', 'Synthetic current owner guard was revoked.');
    const member = authorize(vault, current, 'admin');
    assert.equal(member.role, 'owner'); assert.deepEqual(member.branches, ['*']);
    assert.equal(historical.workspace.id, vault.read().workspace.id);
  };
  const withCompleteOwner = async <T>(current: Context, historical: State,
    work: (assertCurrent: () => void) => Promise<T>): Promise<T> => {
    await assertCompleteOwner(current, historical);
    return vault.withCustodyWriterAdmission(work);
  };
  const local = (options: Partial<Parameters<typeof createWorkspaceBackupV2LocalPorts>[0]> = {}) =>
    createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets, filesystemBudgets,
      externalKeyRequirements, assertCompleteOwner, withCompleteOwner, ...options });
  const values = [
    ['trial_fork', 'private-trial', { type: 'private-trial-fork-v1', version: 1, secret: privateSecret }],
    ['trial_evaluation', 'private-trial', { type: 'private-trial-evaluation-v1', version: 1 }],
    ['trial_active', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'active' }],
    ['trial_discarded', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'discarded' }],
    ['trial_promoting', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'promoting' }],
    ['trial_promoted', 'private-trial', { type: 'private-trial-issued-binding-v1', version: 1, status: 'promoted' }],
    ['wic_archive', 'workspace-interchange', { format: 'chausar.interchange-archive.v1', secret: archiveSecret }],
    ['wic_pin', 'workspace-interchange', { format: 'chausar.interchange-custody-pin.v1' }],
    ['wic_commit', 'workspace-interchange', { format: 'chausar.interchange-local-binding.v1', state: 'committed' }],
    ['wic_tombstone', 'workspace-interchange', { format: 'chausar.interchange-local-binding.v1', state: 'discarded' }],
    ['wit_reservation', 'workspace-interchange', { format: 'chausar.interchange-target-reservation.v1' }],
  ] as const;
  if (populate) for (const [id, purpose, value] of values) await vault.writeArtifact({ id, purpose, value, expectedDigest: null });
  // Preserve authentic envelopes whose whitespace and artifact field order differ from a reserialization.
  const authorityFile = join(vault.directory, 'authority.encrypted.json');
  await writeFile(authorityFile, `${JSON.stringify(JSON.parse(await readFile(authorityFile, 'utf8')), null, 2)}\r\n`);
  if (populate) {
    const path = join(vault.directory, 'private-artifacts', 'private-trial', 'trial_fork.encrypted.json');
    const envelope = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, `${JSON.stringify({ ciphertext: envelope.ciphertext, purpose: envelope.purpose, id: envelope.id,
      valueDigest: envelope.valueDigest, vaultId: envelope.vaultId, format: envelope.format }, null, 4)}\r\n`);
  }
  const custody = local(), host = createWorkspaceBackupV2Host(custody.ports, budgets);
  return { get vault() { return vault; }, applicationDirectory, custody, host, local, values,
    recoveryCode: created.recoveryCode, guardCalls: () => guardCalls,
    revokeOwner() { ownerRevoked = true; },
    async capture(): Promise<VaultEncryptedCustodyCapture> { return vault.snapshot(() => vault.captureEncryptedCustody(encryptedBudgets)); },
    async reopen() {
      await vault.close(); vault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file', passphrase });
      const reopened = local(); return { custody: reopened, host: createWorkspaceBackupV2Host(reopened.ports, budgets) };
    } };
}

async function refs(vault: Vault) {
  return [...await vault.listArtifacts({ purpose: 'private-trial' }), ...await vault.listArtifacts({ purpose: 'workspace-interchange' })];
}
async function addedArtifacts(vault: Vault, before: PrivateArtifactRef[]) {
  const prior = new Set(before.map(identity));
  return (await refs(vault)).filter(ref => !prior.has(identity(ref)));
}

test('real local custody preserves exact authority and every encrypted private status, then restores only inert evidence after reopening', { timeout: 30_000 }, async t => {
  const f = await fixture(t), before = await f.capture(), prior = before.artifacts.map(item => item.ref);
  const summary = await f.host.create(context, { destinationId: 'complete_backup', confirmed: true });
  assert.equal(summary.entries, before.artifacts.length + 1); assert.equal(summary.entries, 12);
  assert.equal(summary.measurement.qualification, 'encrypted-local-host');
  assert.equal(summary.measurement.encrypted, true); assert.equal(summary.fullWorkspacePortable, false);
  assert.deepEqual(f.vault.read(), before.state, 'Backup custody must not commit historical authority.');
  const retained = await f.custody.ports.custody.read(context, summary.recordId);
  const archive = inspectWorkspaceBackupV2(retained.content, budgets), decoded = workspaceBackupV2Bytes(archive, budgets);
  assert.deepEqual(decoded.authority, before.authority);
  assert.equal(archive.pin.authority.sha256, sha(before.authority));
  assert.deepEqual(decoded.artifacts, before.artifacts);
  const envelope = JSON.parse(Buffer.from(decoded.authority).toString('utf8'));
  assert.deepEqual(Object.keys(envelope.passphrase), ['salt', 'kdf', 'ciphertext']);
  assert.deepEqual(Object.keys(envelope.passphrase.ciphertext), ['nonce', 'tag', 'data']);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(decoded.artifacts.find(item => item.ref.id === 'trial_fork')!.bytes).toString('utf8'))),
    ['ciphertext', 'purpose', 'id', 'valueDigest', 'vaultId', 'format']);
  const authenticated = await f.vault.snapshot(() => f.vault.authenticateEncryptedCustody({ ...decoded, source: archive.pin.source }, encryptedBudgets));
  assert.deepEqual(authenticated, before.state);
  assert.deepEqual(archive.pin.artifacts.map(item => `${item.purpose}/${item.id}`), before.artifacts.map(item => identity(item.ref)));
  assert.ok(archive.pin.artifacts.some(item => item.id === 'wic_tombstone'));
  assert.ok(archive.pin.artifacts.some(item => item.id === 'wit_reservation'));
  for (const secret of [privateSecret, archiveSecret, passphrase, f.recoveryCode]) assert.ok(!retained.content.includes(secret));
  const created = await addedArtifacts(f.vault, prior);
  assert.equal(created.length, 3, 'Archive, source/record pin and final issuance require separate authenticated ciphertexts.');
  const values = [];
  for (const ref of created) {
    const file = join(f.vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`), raw = await readFile(file, 'utf8');
    assert.equal((await lstat(file)).size, ref.diskBytes);
    for (const secret of [privateSecret, archiveSecret, passphrase, f.recoveryCode, retained.content]) assert.ok(!raw.includes(secret));
    values.push((await f.vault.readArtifact(ref)).value);
  }
  assert.equal(new Set(created.map(ref => ref.valueDigest)).size, 3);
  assert.ok(values.some(value => JSON.stringify(value).includes(retained.pin.creationId)));
  assert.ok(values.some(value => JSON.stringify(value).includes(retained.pin.archiveDigest)));
  const measurement = f.custody.custodyMeasurement(summary.recordId)!;
  assert.equal(measurement.state, 'committed');
  assert.equal(measurement.archiveCiphertextBytes, summary.measurement.archiveCiphertextBytes);
  assert.equal(measurement.pinCiphertextBytes, summary.measurement.pinCiphertextBytes);
  assert.ok(measurement.bindingCiphertextBytes > 0);
  assert.equal(measurement.totalRetainedCiphertextBytes, created.reduce((total, ref) => total + ref.diskBytes, 0));
  assert.equal(measurement.totalRetainedCiphertextBytes,
    measurement.archiveCiphertextBytes + measurement.pinCiphertextBytes + measurement.bindingCiphertextBytes);
  const diagnostics = f.custody.diagnostics()!;
  assert.equal(diagnostics.qualification, 'encrypted-local-host'); assert.equal(diagnostics.fullWorkspacePortable, false);
  assert.deepEqual(diagnostics.externalKeyRequirements, externalKeyRequirements);
  assert.ok(diagnostics.namespaces.some(item => item.namespace === 'private-artifacts/private-trial' && item.disposition === 'included'));
  assert.ok(diagnostics.namespaces.some(item => item.namespace === 'workspace/writer.lock' && item.disposition === 'transient'));
  assert.ok(diagnostics.physicalFiles.some(item => item.path === 'authority' && item.sha256 === sha(before.authority)));
  assert.ok(diagnostics.measuredCaptureMs >= 0);
  const restarted = await f.reopen();
  assert.deepEqual(await restarted.custody.ports.custody.read(context, summary.recordId), retained);
  const receipt = await restarted.host.restoreInert(context, { backupId: summary.recordId, targetId: 'new_inert_target', reviewedDigest: summary.archiveDigest });
  assert.equal(receipt.inert, true); assert.equal(receipt.activation, 'root-only'); assert.equal(receipt.entries, 12);
  const target = restarted.custody.targetPath(receipt.targetId);
  assert.deepEqual(await readdir(target), ['backup.inert.json']);
  const container = JSON.parse(await readFile(join(target, 'backup.inert.json'), 'utf8'));
  assert.equal(container.content, retained.content);
  assert.deepEqual((await restarted.custody.ports.restore.readRestored(context, { targetId: receipt.targetId, creationId: receipt.creationId })).receipt, receipt);
  assert.deepEqual(f.vault.read(), before.state);
  await assert.rejects(Vault.open({ directory: target, storage: 'experimental-file', passphrase }), code('UNLOCK_FAILED'));
  assert.deepEqual(await readdir(target), ['backup.inert.json'], 'Historical ciphertext is not mounted as runnable authority.');
  assert.ok(f.guardCalls() > 10);
  t.diagnostic(JSON.stringify({ scope: summary.scope, entries: summary.entries,
    archiveCiphertextBytes: summary.measurement.archiveCiphertextBytes, pinCiphertextBytes: summary.measurement.pinCiphertextBytes,
    exactEnvelopeBytes: true, reopened: true, inert: true, fullWorkspacePortable: false, nativeQualified: false }));
});

test('a later complete backup includes all prior encrypted backup archive, pin and issuance controls', async t => {
  const f = await fixture(t);
  const first = await f.host.create(context, { destinationId: 'first_backup', confirmed: true });
  const captured = await f.capture();
  assert.equal(captured.artifacts.length, 14);
  const second = await f.host.create(context, { destinationId: 'second_backup', confirmed: true });
  assert.equal(second.entries, 15);
  const retained = await f.custody.ports.custody.read(context, second.recordId);
  const decoded = workspaceBackupV2Bytes(inspectWorkspaceBackupV2(retained.content, budgets), budgets);
  assert.deepEqual(decoded.authority, captured.authority); assert.deepEqual(decoded.artifacts, captured.artifacts);
  const firstRecord = await f.custody.ports.custody.read(context, first.recordId);
  assert.equal(firstRecord.pin.archiveDigest, first.archiveDigest);
  assert.equal(decoded.artifacts.length, captured.artifacts.length, 'Backup controls must not be excluded by a broad ID prefix.');
});

test('root encrypted custody authentication requires the snapshot fence and independently binds every retained source byte', async t => {
  const f = await fixture(t), captured = await f.capture();
  await assert.rejects(f.vault.withCustodyWriterAdmission(async assertCurrent => { assertCurrent(); }), code('CUSTODY_SNAPSHOT_REQUIRED'));
  await assert.rejects(f.vault.captureEncryptedCustody(encryptedBudgets), code('CUSTODY_SNAPSHOT_REQUIRED'));
  const source = { vaultId: captured.vaultId, workspaceId: captured.state.workspace.id, revision: captured.state.revision };
  await assert.rejects(f.vault.authenticateEncryptedCustody({ ...captured, source }, encryptedBudgets), code('CUSTODY_SNAPSHOT_REQUIRED'));
  await assert.rejects(f.vault.snapshot(() => f.vault.authenticateEncryptedCustody({ ...captured, source: { ...source, vaultId: 'another_vault' } }, encryptedBudgets)),
    code('ARTIFACT_AUTHENTICATION_FAILED'));
  const altered = structuredClone(captured), body = JSON.parse(Buffer.from(altered.artifacts[0].bytes).toString('utf8'));
  body.ciphertext.data = `${body.ciphertext.data[0] === 'A' ? 'B' : 'A'}${body.ciphertext.data.slice(1)}`;
  altered.artifacts[0].bytes = Buffer.from(JSON.stringify(body)); altered.artifacts[0].ref.diskBytes = altered.artifacts[0].bytes.byteLength;
  await assert.rejects(f.vault.snapshot(() => f.vault.authenticateEncryptedCustody({ ...altered, source }, encryptedBudgets)), code('ARTIFACT_AUTHENTICATION_FAILED'));
});

test('local construction requires continuous complete-owner publication admission', async t => {
  const f = await fixture(t);
  assert.throws(() => f.local({ withCompleteOwner: undefined as never }), code('BACKUP_LOCAL_REQUIRED'));
});

test('held publication admission refuses synchronous revocation and deferred assertions before linking inert custody', async t => {
  for (const mode of ['revoked', 'deferred'] as const) await t.test(mode, async subtest => {
    const f = await fixture(subtest), summary = await f.host.create(context, { destinationId: 'gated_backup', confirmed: true });
    const before = await refs(f.vault), retained = await f.custody.ports.custody.read(context, summary.recordId);
    const local = f.local({
      withCompleteOwner: async (_current, _historical, work) => work(mode === 'revoked'
        ? () => { throw new ChausarError('TEST_PUBLICATION_REVOKED', 'Synthetic held publication admission was revoked.'); }
        : (() => Promise.resolve()) as unknown as () => void),
    });
    await assert.rejects(createWorkspaceBackupV2Host(local.ports, budgets).restoreInert(context,
      { backupId: summary.recordId, targetId: 'gated_target', reviewedDigest: summary.archiveDigest }),
    code(mode === 'revoked' ? 'TEST_PUBLICATION_REVOKED' : 'BACKUP_HOST_GUARD'));
    await assert.rejects(lstat(local.targetPath('gated_target')), { code: 'ENOENT' });
    const added = await addedArtifacts(f.vault, before);
    assert.equal(added.length, 1, 'Only the durable rolled-back target reservation remains.');
    const reservation = (await f.vault.readArtifact(added[0])).value as { format: string; state: string };
    assert.equal(reservation.format, 'chausar.backup-local-target.v2'); assert.equal(reservation.state, 'rolled-back');
    assert.deepEqual(await readdir(join(f.applicationDirectory, '.workspace-backup-control', 'targets')), [],
      'Refused publication must remove its exact staging file and target lock.');
    assert.deepEqual(await f.custody.ports.custody.read(context, summary.recordId), retained);
  });
});

test('source byte mutation after actual custody publication refuses success and cleans only its owned encrypted record', async t => {
  const f = await fixture(t), before = await refs(f.vault);
  const source = join(f.vault.directory, 'private-artifacts', 'private-trial', 'trial_fork.encrypted.json');
  const ports: WorkspaceBackupV2HostPorts = { ...f.custody.ports, custody: { ...f.custody.ports.custody,
    async create(...args) {
      const result = await f.custody.ports.custody.create(...args);
      await writeFile(source, `${await readFile(source, 'utf8')} `); return result;
    } } };
  await assert.rejects(createWorkspaceBackupV2Host(ports, budgets).create(context,
    { destinationId: 'changed_source', confirmed: true }), code('BACKUP_SOURCE_CHANGED'));
  await assert.rejects(f.custody.ports.custody.read(context, 'changed_source'), code('BACKUP_CUSTODY_NOT_COMMITTED'));
  const remaining = await refs(f.vault);
  for (const ref of before) assert.ok(remaining.some(item => identity(item) === identity(ref) && item.valueDigest === ref.valueDigest));
  const revoked = await addedArtifacts(f.vault, before);
  assert.equal(revoked.length, 1, 'Only the durable revoked issuance may remain after cleanup.');
  assert.equal(((await f.vault.readArtifact(revoked[0])).value as { state: string }).state, 'discarded');
});

test('current owner revocation while custody read awaits refuses restore before creating a target', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'owner_backup', confirmed: true });
  let reads = 0;
  const ports: WorkspaceBackupV2HostPorts = { ...f.custody.ports, custody: { ...f.custody.ports.custody,
    async read(...args) { const result = await f.custody.ports.custody.read(...args); if (++reads === 2) f.revokeOwner(); return result; } } };
  await assert.rejects(createWorkspaceBackupV2Host(ports, budgets).restoreInert(context,
    { backupId: summary.recordId, targetId: 'revoked_owner_target', reviewedDigest: summary.archiveDigest }), code('TEST_OWNER_REVOKED'));
  await assert.rejects(lstat(f.custody.targetPath('revoked_owner_target')), { code: 'ENOENT' });
});

test('unknown wider source entries and unknown private namespaces refuse complete capture before writing custody', async t => {
  const f = await fixture(t), before = await refs(f.vault);
  const unknown = join(f.vault.directory, 'unclassified.fixture'); await writeFile(unknown, 'Synthetic unclassified source file');
  await assert.rejects(f.host.create(context, { destinationId: 'unknown_source', confirmed: true }), code('BACKUP_INVENTORY_INCOMPLETE'));
  assert.deepEqual(await refs(f.vault), before); await unlink(unknown);
  const unknownPrivate = join(f.vault.directory, 'private-artifacts', 'unknown-private'); await mkdir(unknownPrivate);
  await assert.rejects(f.host.create(context, { destinationId: 'unknown_private', confirmed: true }), code('ARTIFACT_INVENTORY_INCOMPLETE'));
  assert.deepEqual(await refs(f.vault), before);
});

test('a failed encrypted publication revokes its issuance while preserving every byte of prior successful custody', async t => {
  const f = await fixture(t), good = await f.host.create(context, { destinationId: 'prior_good_backup', confirmed: true });
  const before = await f.capture(), write = f.vault.writeArtifact.bind(f.vault);
  let injected = false;
  f.vault.writeArtifact = async input => {
    if (!injected && input.id === `wb2_${sha('failed_publication')}_pin`) {
      injected = true; throw new Error('Synthetic pin publication unavailable');
    }
    return write(input);
  };
  await assert.rejects(f.host.create(context, { destinationId: 'failed_publication', confirmed: true }), /Synthetic pin publication unavailable/);
  assert.equal(injected, true);
  await assert.rejects(f.custody.ports.custody.read(context, 'failed_publication'), code('BACKUP_CUSTODY_NOT_COMMITTED'));
  const after = await f.capture();
  assert.deepEqual(after.authority, before.authority);
  for (const entry of before.artifacts) assert.deepEqual(after.artifacts.find(item => identity(item.ref) === identity(entry.ref)), entry);
  const revoked = await addedArtifacts(f.vault, before.artifacts.map(item => item.ref));
  assert.equal(revoked.length, 1); assert.equal(((await f.vault.readArtifact(revoked[0])).value as { state: string }).state, 'discarded');
  assert.equal((await f.custody.ports.custody.read(context, good.recordId)).pin.archiveDigest, good.archiveDigest);
  const later = await f.host.create(context, { destinationId: 'after_failed_publication', confirmed: true });
  assert.equal(later.entries, after.artifacts.length + 1, 'A later complete backup must include the inert tombstone.');
});

test('explicit wire, encrypted count/byte and filesystem budgets refuse the whole operation without scope truncation', async t => {
  const f = await fixture(t), before = await refs(f.vault);
  await mkdir(join(f.vault.directory, 'reports', 'a', 'b'), { recursive: true });
  const cases = [
    { budgets: { ...budgets, maxEntryBytes: 100 } },
    { budgets: { ...budgets, maxTotalEntryBytes: 1_000_001, maxEntryBytes: 1_000_000 } },
    { budgets: { ...budgets, maxEntries: 2 } },
    { budgets: { ...budgets, maxArchiveUtf8Bytes: 100 } },
    { filesystemBudgets: { ...filesystemBudgets, maxFiles: 1 } },
    { filesystemBudgets: { ...filesystemBudgets, maxBytes: 1 } },
    { filesystemBudgets: { ...filesystemBudgets, maxDepth: 1 } },
  ];
  const captured = await f.capture();
  cases[1] = { budgets: { ...budgets, maxEntryBytes: Math.max(captured.authority.byteLength, ...captured.artifacts.map(item => item.bytes.byteLength)),
    maxTotalEntryBytes: captured.authority.byteLength + captured.artifacts.reduce((total, item) => total + item.bytes.byteLength, 0) - 1 } };
  for (const [index, options] of cases.entries()) {
    const local = f.local(options), host = createWorkspaceBackupV2Host(local.ports, options.budgets ?? budgets);
    await assert.rejects(host.create(context, { destinationId: `limited_${index}`, confirmed: true }), error => error instanceof ChausarError);
    assert.deepEqual(await refs(f.vault), before, `Budget case ${index} must not leave custody or skip entries.`);
  }
});

test('preexisting target work is refused and remains untouched', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'target_backup', confirmed: true });
  const target = f.custody.targetPath('preexisting_target'); await mkdir(target, { recursive: true });
  const file = join(target, 'user-work.txt'); await writeFile(file, 'Synthetic unrelated work must remain');
  await assert.rejects(f.host.restoreInert(context, { backupId: summary.recordId, targetId: 'preexisting_target', reviewedDigest: summary.archiveDigest }));
  assert.equal(await readFile(file, 'utf8'), 'Synthetic unrelated work must remain');
});

test('altered inert readback rolls back only its owned publication and durably reserves the target ID', async t => {
  const f = await fixture(t), summary = await f.host.create(context, { destinationId: 'readback_backup', confirmed: true });
  const ports: WorkspaceBackupV2HostPorts = { ...f.custody.ports, restore: { ...f.custody.ports.restore,
    async readRestored(...args) { const result = await f.custody.ports.restore.readRestored(...args); return { ...result, content: `${result.content} ` }; } } };
  await assert.rejects(createWorkspaceBackupV2Host(ports, budgets).restoreInert(context,
    { backupId: summary.recordId, targetId: 'failed_readback', reviewedDigest: summary.archiveDigest }), code('BACKUP_CANONICAL'));
  assert.deepEqual(await readdir(f.custody.targetPath('failed_readback')), []);
  await assert.rejects(f.host.restoreInert(context,
    { backupId: summary.recordId, targetId: 'failed_readback', reviewedDigest: summary.archiveDigest }), code('BACKUP_TARGET_EXISTS'));
});

test('completed encrypted writes with lost acknowledgements recover through authenticated exact readback', async t => {
  for (const lostWrite of [1, 2, 3, 4, 5, 6]) await t.test(`write_${lostWrite}`, async subtest => {
    const f = await fixture(subtest), before = await refs(f.vault), write = f.vault.writeArtifact.bind(f.vault);
    let writes = 0, injected = false;
    f.vault.writeArtifact = async input => {
      const result = await write(input);
      if (!injected && ++writes === lostWrite) { injected = true; throw new Error(`Synthetic lost acknowledgement ${lostWrite}`); }
      return result;
    };
    const summary = await f.host.create(context, { destinationId: 'lost_ack_backup', confirmed: true });
    assert.equal(injected, true);
    const retained = await f.custody.ports.custody.read(context, summary.recordId);
    assert.equal(retained.pin.archiveDigest, summary.archiveDigest);
    const current = await refs(f.vault);
    for (const ref of before) assert.deepEqual(current.find(item => identity(item) === identity(ref)), ref);
    const remaining = await addedArtifacts(f.vault, before);
    assert.equal(remaining.length, 3);
    assert.equal(f.custody.custodyMeasurement(summary.recordId)!.state, 'committed');
    await assert.rejects(f.host.create(context, { destinationId: summary.recordId, confirmed: true }), code('BACKUP_OUTPUT_EXISTS'));
  });
});

test('wider measured files remain explicitly outside the archive and credential dependencies require root classification', async t => {
  const f = await fixture(t), reports = join(f.vault.directory, 'reports'); await mkdir(reports);
  const report = 'Synthetic report outside encrypted archive'; await writeFile(join(reports, 'report.txt'), report);
  const summary = await f.host.create(context, { destinationId: 'wider_backup', confirmed: true });
  assert.deepEqual(summary.namespaces.find(item => item.namespace === 'workspace/reports'), {
    namespace: 'workspace/reports', disposition: 'outside-archive', entries: 1, bytes: Buffer.byteLength(report),
    requirement: 'Root must separately retain these exact measured wider files before claiming workspace portability.' });
  assert.equal(summary.fullWorkspacePortable, false);
  const missing = f.local({ externalKeyRequirements: [] });
  await assert.rejects(createWorkspaceBackupV2Host(missing.ports, budgets).create(context,
    { destinationId: 'missing_keys', confirmed: true }), code('BACKUP_EXTERNAL_KEYS_REQUIRED'));
});

test('hard-linked authority refuses physical custody without altering prior encrypted source artifacts', async t => {
  const f = await fixture(t), before = await refs(f.vault), alias = join(f.applicationDirectory, 'synthetic-authority-hardlink');
  await link(join(f.vault.directory, 'authority.encrypted.json'), alias);
  try {
    await assert.rejects(f.host.create(context, { destinationId: 'hardlinked_source', confirmed: true }), code('BACKUP_UNSAFE_FILE'));
    assert.deepEqual(await refs(f.vault), before);
  } finally { await unlink(alias); }
  await f.host.create(context, { destinationId: 'regular_source', confirmed: true });
});

test('an archive still builds beside custody cards, key records, a transfers folder and automatic backup names', async t => {
  const f = await fixture(t), workspaceId = f.vault.read().workspace.id, now = Date.now();
  await mkdir(join(f.applicationDirectory, 'custody', 'cards'), { recursive: true });
  await mkdir(join(f.applicationDirectory, 'custody', 'keys'), { recursive: true });
  await mkdir(join(f.applicationDirectory, 'transfers'));
  await writeFile(join(f.applicationDirectory, 'custody', 'cards', 'source.json'), JSON.stringify({ format: 'chausar.vault-card.v1', folder: 'source' }));
  await writeFile(join(f.applicationDirectory, 'custody', 'keys', `${f.vault.vaultId}.json`), JSON.stringify({ format: 'chausar.device-key.v1', vaultId: f.vault.vaultId, scheme: 'memory' }));
  await mkdir(join(f.applicationDirectory, 'backups'));
  for (const kind of ['auto', 'manual', 'safety']) await writeFile(join(f.applicationDirectory, 'backups', `chausar-${workspaceId}-${now}-${kind}.backup`), '{}');
  await writeFile(join(f.applicationDirectory, 'backups', `chausar-${workspaceId}-${now}.backup`), '{}');
  const summary = await f.host.create(context, { destinationId: 'custody_beside', confirmed: true });
  const custody = summary.namespaces.find(item => item.namespace === 'application/custody');
  assert.equal(custody?.disposition, 'outside-archive'); assert.equal(custody?.entries, 2, 'the card and the key record are measured, outside the archive');
  assert.equal(summary.namespaces.find(item => item.namespace === 'application/transfers')?.disposition, 'empty');
  assert.equal(summary.namespaces.find(item => item.namespace === 'application/backups')?.entries, 4);
  await writeFile(join(f.applicationDirectory, 'backups', `chausar-${workspaceId}-${now}-weekly.backup`), '{}');
  await assert.rejects(f.host.create(context, { destinationId: 'unknown_kind', confirmed: true }), code('BACKUP_EXTERNAL_ENUMERATION_REQUIRED'));
});
