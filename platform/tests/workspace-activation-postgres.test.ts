import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { authorize, check, ChausarError, hash } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { Vault, type EncryptedSnapshotAdapter, type VaultEnvelope } from '../runtime/vault.ts';
import { WorkspaceInterchangeHost } from '../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../runtime/workspace-interchange-local.ts';
import { interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type WorkspaceActivationPolicy } from '../runtime/workspace-activation.ts';
import { createWorkspaceActivationPostgresPorts, type WorkspaceActivationPostgresOptions } from '../runtime/workspace-activation-postgres.ts';
import type { PostgresAuthorityIdentity, PostgresPublicationProof, PostgresStorageIdentity,
  PostgresTargetInspection, PostgresTargetReservation, WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { deterministicShopState, fixedTime, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

import { purpose, passphrase, sha, code, clone, pgAttemptId, localAttemptId, sqlFile, storageIdentity, authority, EncryptedMemoryStorage, InjectedTargetCustody, fixture, treeBytes } from './fixtures/workspace-activation-postgres-protocol.ts';

test('PostgreSQL activation authenticates actual fresh Vault encryption and preserved evidence after later target revision and reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate();
  assert.equal(summary.status, 'committed'); assert.equal(summary.qualification, 'test-fixture');
  assert.equal(f.counts().preparedOpenDenied, 1); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  assert.ok(f.leaseOrder.length >= 4); assert.equal(f.leaseOrder.length % 4, 0);
  for (let offset = 0; offset < f.leaseOrder.length; offset += 4)
    assert.deepEqual(f.leaseOrder.slice(offset, offset + 4), ['root-enter', 'native-enter', 'native-exit', 'root-exit']);
  const read = await f.custody.ports.readback(interchangeOwner, { activationId: summary.activationId });
  assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
  assert.deepEqual(readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive), f.sourceInitial);
  assert.equal(read.evidence.content, f.candidate.content); assert.deepEqual(read.evidence.pin, f.candidate.pin);
  assert.equal(read.state.revision, 0); assert.deepEqual(read.state.members, [read.authority.owner]);
  assert.deepEqual(read.state.sessions, []); assert.deepEqual(read.state.routes, []);
  assert.notEqual(read.authority.owner.id, interchangeOwner.memberId); assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
  const files = await treeBytes(f.targetPath());
  assert.equal(read.ciphertextBytes, Object.values(files).reduce((sum, bytes) => sum + Buffer.from(bytes, 'base64').length, 0)
    + Buffer.byteLength(JSON.stringify(f.target.original)) + Buffer.byteLength(JSON.stringify(f.target.current)),
    'Measurement includes filesystem ciphertext, retained original SQL ciphertext and independently authenticated current SQL ciphertext.');
  assert.equal(summary.ciphertextBytes, read.ciphertextBytes);
  for (const bytes of Object.values(files).map(value => Buffer.from(value, 'base64'))) {
    assert.equal(bytes.includes(Buffer.from('synthetic_old_session_token')), false);
    assert.equal(bytes.includes(Buffer.from('demo-export')), false);
  }
  const live = await f.openTarget();
  try { await live.update(state => { state.activity.push({ id: 'later_target_revision', at: fixedTime }); }); }
  finally { await live.close(); }
  assert.equal(f.target.current!.revision, 1); assert.equal(f.target.original!.revision, 0);
  await f.reopen(); const resolved = await f.host.resolve(interchangeOwner, { activationId: summary.activationId });
  assert.equal(resolved.status, 'committed'); assert.deepEqual(await treeBytes(f.targetPath()), files);
  if (resolved.status === 'committed') {
    assert.equal(resolved.ciphertextBytes, Object.values(files).reduce((sum, bytes) => sum + Buffer.from(bytes, 'base64').length, 0)
      + Buffer.byteLength(JSON.stringify(f.target.original)) + Buffer.byteLength(JSON.stringify(f.target.current)));
    assert.ok(resolved.ciphertextBytes > read.ciphertextBytes, 'Later authority is independently measured while original publication stays immutable.');
  }
  assert.equal(f.counts().prepared, 1); assert.equal(f.target.publishCalls, 1); assert.ok(f.counts().nativeAssertions > 1);
  assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
  t.diagnostic(JSON.stringify({ nativePostgresQualified: false, sqlCustody: 'injected-test-fixture',
    actualVaultEncryption: true, realBootstrapAndOpen: true, sourceAndJournalReopened: true,
    ordinaryPreparedOpenRefused: true, currentTargetRevision: 1, originalPublicationRevision: 0, ciphertextBytes: read.ciphertextBytes }));
});

test('failure before SQL publication retains prepared target, refuses ordinary open and never retries across reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.beforePublish = async () => { throw new Error('Synthetic boundary before SQL publication.'); };
  await assert.rejects(f.activate('activation_before_sql'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'prepared'); assert.equal(f.target.current, undefined);
  await assert.rejects(f.openTarget()); const files = await treeBytes(f.targetPath()); await f.reopen();
  const resolved = await f.host.resolve(interchangeOwner, { activationId: 'activation_before_sql' });
  assert.equal(resolved.status, 'unknown'); assert.equal(resolved.reasonCode, 'ACTIVATION_POSTGRES_PREPARED');
  assert.deepEqual(await treeBytes(f.targetPath()), files); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  const journal = await f.journalVault.readArtifact({ id: pgAttemptId('activation_before_sql'), purpose });
  assert.equal((journal.value as { phase: string }).phase, 'prepared');
});

test('lost SQL commit acknowledgement resolves exact committed evidence after reopen without publication replay', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.afterPublish = async () => { throw new Error('Synthetic lost SQL commit acknowledgement.'); };
  await assert.rejects(f.activate('activation_sql_ack_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'committed');
  const journalBefore = await f.journalVault.readArtifact({ id: pgAttemptId('activation_sql_ack_lost'), purpose });
  assert.equal((journalBefore.value as { phase: string }).phase, 'prepared');
  const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_sql_ack_lost' })).status, 'committed');
  assert.deepEqual(await treeBytes(f.targetPath()), files); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  const journalAfter = await f.journalVault.readArtifact({ id: pgAttemptId('activation_sql_ack_lost'), purpose });
  assert.equal(journalAfter.valueDigest, journalBefore.valueDigest, 'Read-only recovery never writes a new acknowledgement marker.');
  await assert.rejects(f.activate('activation_sql_ack_replay'), code('ACTIVATION_TARGET_CHANGED'));
  assert.equal(f.target.publishCalls, 1); assert.equal(f.counts().prepared, 1);
});

test('lost final SQL journal acknowledgement resolves committed custody and preserves single-use claims', { timeout: 30_000 }, async t => {
  const f = await fixture(t), original = f.journalVault.writeArtifact.bind(f.journalVault); let lost = false;
  f.journalVault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id === pgAttemptId('activation_journal_ack_lost') && (input.value as { phase?: string }).phase === 'committed') {
      lost = true; throw new Error('Synthetic durable PostgreSQL journal acknowledgement lost.');
    }
    return result;
  };
  await assert.rejects(f.activate('activation_journal_ack_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(lost, true); const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_journal_ack_lost' })).status, 'committed');
  await assert.rejects(f.activate('activation_journal_replay'), code('ACTIVATION_TARGET_CHANGED'));
  assert.deepEqual(await treeBytes(f.targetPath()), files); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
});

test('a competing SQL occupant before publish survives refused activation and read-only restart', { timeout: 30_000 }, async t => {
  const f = await fixture(t); let occupant: VaultEnvelope | undefined;
  f.target.beforePublish = async () => {
    occupant = { ...clone(f.target.original!), id: 'synthetic_competing_occupant' };
    f.target.current = clone(occupant); f.target.currentCreationId = 'competing_creation';
  };
  await assert.rejects(f.activate('activation_competing'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(f.target.current, occupant); const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_competing' })).status, 'unknown');
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
});

test('replaced committed SQL incarnation remains unknown and retained', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_replaced_sql'), files = await treeBytes(f.targetPath());
  f.target.currentCreationId = 'replacement_creation'; const occupant = clone(f.target.current);
  await f.reopen(); assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
});

test('native source revision mismatch refuses before target reservation', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.setNativeRevisionOffset(1);
  await assert.rejects(f.activate('activation_stale_native'), code('ACTIVATION_POSTGRES_SOURCE_CHANGED'));
  assert.equal(f.target.reserveCalls, 0); assert.equal(f.target.publishCalls, 0); assert.equal(f.counts().prepared, 0);
  assert.deepEqual(await readdir(f.targetPath()), []); assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
});

test('restart authenticates source incarnation and repeats current owner readiness after awaited inspection', { timeout: 40_000 }, async t => {
  await t.test('source slot ABA', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_source_aba'); f.replaceSourceCreation(); await f.reopen();
    await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('ACTIVATION_POSTGRES_SOURCE_CHANGED'));
    assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  });
  await t.test('late root readiness revoked', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_root_fence');
    f.onInspection(async () => { f.setReady(false); });
    await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('INTERCHANGE_NOT_READY'));
    f.setReady(true); f.onInspection();
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'committed');
    assert.equal(f.target.publishCalls, 1);
  });
});

test('changed original SQL envelope or physical evidence refuses recovery and retains modified material', { timeout: 40_000 }, async t => {
  await t.test('changed retained SQL envelope', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_altered_envelope');
    f.target.original!.snapshot.data = f.target.original!.snapshot.data.replace(/^./, value => value === 'A' ? 'B' : 'A');
    const changed = clone(f.target.original); await f.reopen();
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
    assert.deepEqual(f.target.original, changed); assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
  });
  await t.test('changed encrypted publication file', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_altered_file');
    const path = join(f.targetPath(), sqlFile), bytes = await readFile(path); bytes[bytes.length - 2] ^= 1; await writeFile(path, bytes);
    await f.reopen(); assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
    assert.deepEqual(await readFile(path), bytes); assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
  });
  await t.test('byte-identical encrypted publication file replacement', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_replaced_sidecar');
    const path = join(f.targetPath(), sqlFile), bytes = await readFile(path), before = await lstat(path, { bigint: true });
    const replacement = join(f.targetPath(), 'live', 'replacement-postgres-envelope.encrypted.json');
    assert.equal(dirname(replacement), dirname(path)); await writeFile(replacement, bytes, { flag: 'wx' });
    const fresh = await lstat(replacement, { bigint: true });
    assert.notDeepEqual({ dev: String(fresh.dev), ino: String(fresh.ino), birthtimeNs: String(fresh.birthtimeNs) },
      { dev: String(before.dev), ino: String(before.ino), birthtimeNs: String(before.birthtimeNs) });
    await unlink(path); await rename(replacement, path); const files = await treeBytes(f.targetPath());
    assert.deepEqual(await readFile(path), bytes); await f.reopen();
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
    assert.deepEqual(await treeBytes(f.targetPath()), files); assert.deepEqual(await readFile(path), bytes);
    assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
  });
});

test('filesystem publication failure leaves prepared SQL inaccessible with both encrypted attempt records', { timeout: 30_000 }, async t => {
  const f = await fixture(t), original = f.sourceVault.withCustodyWriterAdmission.bind(f.sourceVault);
  f.sourceVault.withCustodyWriterAdmission = async _work => original(async () => { throw new Error('Synthetic boundary before filesystem links.'); });
  await assert.rejects(f.activate('activation_before_files'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'prepared'); assert.equal(f.target.publishCalls, 0);
  for (const id of [pgAttemptId('activation_before_files'), localAttemptId('activation_before_files')]) {
    const retained = await f.journalVault.readArtifact({ id, purpose }); assert.equal((retained.value as { phase: string }).phase, 'prepared');
  }
  assert.deepEqual(await readdir(f.targetPath()), []); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_before_files' })).status, 'unknown');
  for (const activationId of ['activation_before_files', 'activation_before_files_replay'])
    await assert.rejects(f.activate(activationId), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.target.deleteCalls, 0); assert.equal(f.counts().prepared, 1);
});

test('lost SQL reservation acknowledgement remains reserved after exact read-only operation inspection', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.afterReserve = async () => { throw new Error('Synthetic durable reserve acknowledgement lost.'); };
  await assert.rejects(f.activate('activation_reserve_ack_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'reserved'); assert.equal(f.counts().prepared, 0); assert.equal(f.target.publishCalls, 0);
  const journal = await f.journalVault.readArtifact({ id: pgAttemptId('activation_reserve_ack_lost'), purpose });
  assert.equal((journal.value as { phase: string }).phase, 'attempted');
  assert.deepEqual(await readdir(f.targetPath()), []); await f.reopen();
  const result = await f.host.resolve(interchangeOwner, { activationId: 'activation_reserve_ack_lost' });
  assert.equal(result.status, 'unknown'); assert.equal(result.reasonCode, 'ACTIVATION_POSTGRES_RESERVED');
  assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.target.reserveCalls, 1); assert.equal(f.target.deleteCalls, 0);
  const after = await f.journalVault.readArtifact({ id: pgAttemptId('activation_reserve_ack_lost'), purpose });
  assert.equal(after.valueDigest, journal.valueDigest, 'Recovery classifies exact reserved custody without changing durable attempts.');
});

test('already occupied SQL target refuses activation without removing its occupant or publishing physical files', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.current = f.sourceEnvelope;
  const occupant = clone(f.target.current);
  await assert.rejects(f.activate('activation_occupied_sql'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await readdir(f.targetPath()), []);
  assert.equal(f.counts().prepared, 0); assert.equal(f.target.publishCalls, 0); assert.equal(f.target.deleteCalls, 0);
});

test('lost filesystem committed-marker acknowledgement keeps SQL prepared and resolves unknown without publishing', { timeout: 30_000 }, async t => {
  const f = await fixture(t), activationId = 'activation_filesystem_ack_lost';
  const original = f.journalVault.writeArtifact.bind(f.journalVault); let lost = false;
  f.journalVault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id === localAttemptId(activationId) && (input.value as { phase?: string }).phase === 'committed') {
      lost = true; throw new Error('Synthetic durable filesystem committed-marker acknowledgement lost.');
    }
    return result;
  };
  await assert.rejects(f.activate(activationId), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(lost, true); assert.equal(f.target.phase, 'prepared'); assert.equal(f.target.publishCalls, 0);
  const local = await f.journalVault.readArtifact({ id: localAttemptId(activationId), purpose });
  assert.equal((local.value as { phase: string }).phase, 'committed');
  const pg = await f.journalVault.readArtifact({ id: pgAttemptId(activationId), purpose });
  assert.equal((pg.value as { phase: string }).phase, 'prepared');
  const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId }),
    { status: 'unknown', activationId, reasonCode: 'ACTIVATION_POSTGRES_PREPARED' });
  await assert.rejects(f.openTarget()); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.publishCalls, 0); assert.equal(f.target.deleteCalls, 0); assert.equal(f.counts().prepared, 1);
  assert.equal((await f.journalVault.readArtifact({ id: pgAttemptId(activationId), purpose })).valueDigest, pg.valueDigest);
});

test('SQL inspection transport failure resolves exact unknown and leaves committed material intact', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_inspection_transport');
  const files = await treeBytes(f.targetPath()), occupant = clone(f.target.current);
  const original = f.target.inspect.bind(f.target);
  f.target.inspect = async () => { throw new Error('Synthetic read-only SQL inspection transport failure.'); };
  await f.reopen();
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId: summary.activationId }),
    { status: 'unknown', activationId: summary.activationId, reasonCode: 'ACTIVATION_POSTGRES_INSPECTION_UNKNOWN' });
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  f.target.inspect = original;
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'committed');
  assert.equal(f.target.publishCalls, 1);
});

test('injected prepared cleanup retains exact-owned tombstones and refuses changed custody or occupants', { timeout: 30_000 }, async t => {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const root = await realpath(await mkdtemp(join(base, 'chausar-activation-cleanup-')));
  assert.equal(dirname(root), base);
  const memory = new EncryptedMemoryStorage();
  let vault: Vault | undefined;
  t.after(async () => {
    await vault?.close();
    const actual = await realpath(root);
    assert.equal(dirname(actual), base); assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-activation-cleanup-/);
    await rm(actual, { recursive: true, force: true });
  });
  vault = (await Vault.create({ directory: join(root, 'envelope'), name: 'Injected cleanup ciphertext fixture',
    storage: memory, passphrase, demo: true })).vault;
  const envelope = clone(memory.envelope!); await vault.close();
  async function prepared(label: string, commit = true) {
    const target = new InjectedTargetCustody(); target.directory = join(root, label); await mkdir(target.directory);
    const reserved = await target.reserve({ operationId: `fixture_${label}`, creationId: `fixture_${label}` });
    const adapter = target.createPreparedAdapter(reserved);
    if (commit) await adapter.commit(clone(envelope), null);
    return { target, adapter };
  }
  const reserved = await prepared('reserved', false);
  assert.equal(await reserved.adapter.deleteIfCurrent!(clone(envelope)), 'absent');
  assert.equal(reserved.target.phase, 'reserved'); assert.equal(reserved.target.deleteCalls, 0);
  const owned = await prepared('owned'), original = clone(owned.target.original), proof = clone(owned.target.proof);
  assert.equal(await owned.adapter.deleteIfCurrent!(clone(envelope)), 'deleted');
  assert.equal(owned.target.phase, 'rolled-back'); assert.equal(owned.target.deleteCalls, 1);
  assert.deepEqual(owned.target.original, original); assert.deepEqual(owned.target.proof, proof);
  assert.equal(await owned.adapter.load(), null);
  assert.equal(await owned.adapter.deleteIfCurrent!(clone(envelope)), 'absent');
  assert.equal(owned.target.deleteCalls, 1); assert.deepEqual(owned.target.original, original);
  owned.target.original!.snapshot.data += '_changed_tombstone';
  await assert.rejects(owned.adapter.load());
  assert.equal(await owned.adapter.deleteIfCurrent!(clone(envelope)), 'mismatch');
  assert.equal(owned.target.deleteCalls, 1);
  const callerOwned = await prepared('caller_owned', false), callerReservation = clone(callerOwned.target.reservation!);
  const captured = callerOwned.target.createPreparedAdapter(callerReservation);
  callerReservation.creationId = 'mutated_caller_creation';
  await captured.commit(clone(envelope), null);
  assert.equal(callerOwned.target.proof!.creationId, callerOwned.target.reservation!.creationId);
  assert.equal(await captured.deleteIfCurrent!(clone(envelope)), 'deleted');
  const cases: { label: string; change(target: InjectedTargetCustody, expected: VaultEnvelope): void }[] = [
    { label: 'wrong_expected_ciphertext', change: (_target, expected) => { expected.snapshot.data += '_different'; } },
    { label: 'ordinary_occupant', change: target => { target.current = { ...clone(envelope), id: 'competing_fixture_vault' }; target.currentCreationId = 'competing_fixture_creation'; } },
    { label: 'ordinary_incarnation_without_ciphertext', change: target => { target.currentCreationId = 'competing_fixture_creation'; } },
    { label: 'replaced_proof', change: target => { target.proof!.creationId = 'competing_fixture_creation'; } },
    { label: 'replaced_reservation', change: target => { target.reservation!.operationId = 'competing_fixture_operation'; } },
    { label: 'changed_retained_ciphertext', change: target => { target.original!.snapshot.data += '_different'; } },
    { label: 'committed_phase', change: target => { target.phase = 'committed'; } },
    { label: 'changed_storage', change: target => { target.storage.slot = 'competing_fixture_slot'; } },
  ];
  for (const item of cases) {
    const { target, adapter } = await prepared(item.label), expected = clone(envelope); item.change(target, expected);
    const before = clone({ phase: target.phase, reservation: target.reservation, proof: target.proof, original: target.original,
      current: target.current, currentCreationId: target.currentCreationId, deleteCalls: target.deleteCalls });
    assert.equal(await adapter.deleteIfCurrent!(expected), 'mismatch', item.label);
    assert.deepEqual({ phase: target.phase, reservation: target.reservation, proof: target.proof, original: target.original,
      current: target.current, currentCreationId: target.currentCreationId, deleteCalls: target.deleteCalls }, before, item.label);
  }
  const changedPhysical = await prepared('changed_physical');
  await rename(changedPhysical.target.directory, changedPhysical.target.directory + '_retained');
  await mkdir(changedPhysical.target.directory);
  assert.equal(await changedPhysical.adapter.deleteIfCurrent!(clone(envelope)), 'mismatch');
  assert.equal(changedPhysical.target.phase, 'prepared'); assert.equal(changedPhysical.target.deleteCalls, 0);
  t.diagnostic(JSON.stringify({ nativePostgresQualified: false, cleanupCustody: 'injected-test-fixture',
    exactOwnedCleanup: true, retainedCiphertextTombstone: true, changedOccupantsPreserved: true }));
});
