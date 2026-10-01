import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { Vault } from '../runtime/vault.ts';

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:\\/i);
  const directory = await mkdtemp(join(parent, 'chausar-private-custody-'));
  t.after(async () => {
    const child = relative(parent, directory);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-private-custody-'));
    await rm(directory, { recursive: true, force: true });
  });
  const passphrase = 'Synthetic custody passphrase only';
  const { vault } = await Vault.create({ directory, passphrase, name: 'Synthetic encrypted custody', demo: true, storage: 'experimental-file' });
  t.after(() => vault.close());
  return { directory, passphrase, vault };
}

test('managed artifacts remain encrypted, purpose-bound, CAS-fenced and readable after real Vault reopening', async t => {
  const { directory, passphrase, vault } = await fixture(t);
  const value = { type: 'synthetic-private-fork', secretMarker: 'Synthetic customer cash ledger 918731', baseline: vault.read() };
  const ref = await vault.writeArtifact({ id: 'synthetic_fork', purpose: 'private-trial', value, expectedDigest: null });
  const file = join(directory, 'private-artifacts', 'private-trial', 'synthetic_fork.encrypted.json');
  assert.equal(ref.diskBytes, (await stat(file)).size);
  assert.ok(!(await readFile(file, 'utf8')).includes(value.secretMarker));
  assert.deepEqual((await vault.readArtifact(ref)).value, value);
  await assert.rejects(vault.writeArtifact({ ...ref, value: { changed: true }, expectedDigest: null }), { code: 'ARTIFACT_REVISION_CONFLICT' });
  const updated = await vault.writeArtifact({ ...ref, value: { ...value, status: 'discarded' }, expectedDigest: ref.valueDigest });
  await assert.rejects(vault.removeArtifact({ ...ref, expectedDigest: ref.valueDigest }), { code: 'ARTIFACT_REVISION_CONFLICT' });
  assert.deepEqual(await vault.listArtifacts({ purpose: 'private-trial' }), [updated]);
  await vault.close();
  const reopened = await Vault.open({ directory, passphrase, storage: 'experimental-file' });
  t.after(() => reopened.close());
  assert.deepEqual((await reopened.readArtifact(updated)).value, { ...value, status: 'discarded' });
  assert.deepEqual(await reopened.removeArtifact({ ...updated, expectedDigest: updated.valueDigest }), { removed: true, diskBytes: updated.diskBytes });
  await assert.rejects(reopened.readArtifact(updated), { code: 'ARTIFACT_NOT_FOUND' });
  assert.deepEqual(await reopened.removeArtifact({ ...updated, expectedDigest: updated.valueDigest }), { removed: false, diskBytes: 0 });
});

test('tampered encrypted artifacts refuse instead of issuing a custody identity', async t => {
  const { directory, vault } = await fixture(t);
  const ref = await vault.writeArtifact({ id: 'synthetic_archive', purpose: 'workspace-interchange', value: { synthetic: true }, expectedDigest: null });
  const file = join(directory, 'private-artifacts', 'workspace-interchange', 'synthetic_archive.encrypted.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.valueDigest = 'f'.repeat(64);
  await writeFile(file, JSON.stringify(raw));
  await assert.rejects(vault.readArtifact(ref), { code: 'ARTIFACT_AUTHENTICATION_FAILED' });
  await assert.rejects(vault.listArtifacts({ purpose: 'workspace-interchange' }), { code: 'ARTIFACT_AUTHENTICATION_FAILED' });
});

test('managed custody rejects paths and nested authority work and deletes only typed managed artifacts', async t => {
  const { vault } = await fixture(t);
  assert.throws(() => vault.writeArtifact({ id: '../user-file', purpose: 'private-trial', value: {}, expectedDigest: null }), { code: 'ARTIFACT_ID_INVALID' });
  await assert.rejects(vault.update(() => vault.writeArtifact({ id: 'nested', purpose: 'private-trial', value: {}, expectedDigest: null })), { code: 'REENTRANT_TRANSACTION' });
  const snapshot = await vault.snapshot(async state => { assert.equal(state.workspace.demo, true); return state.revision; });
  assert.equal(snapshot, vault.read().revision);
  const input = { id: 'new_binding', purpose: 'private-trial' as const, value: { synthetic: true }, expectedDigest: null };
  await vault.writeArtifact(input);
  await assert.rejects(vault.backup(join(vault.directory, 'synthetic-incomplete.backup')), { code: 'ARTIFACT_BACKUP_REQUIRED' });
  const value = 'Synthetic string payload contract';
  const stringRef = await vault.writeArtifact({ id: 'string_payload', purpose: 'private-trial', value, expectedDigest: null });
  assert.deepEqual((await vault.readArtifact(stringRef)).value, value);
  const { hash } = await import('../runtime/contracts.ts'); assert.equal(stringRef.valueDigest, hash(JSON.stringify(value)));
  assert.equal((await vault.purgeArtifacts()).length, 2); assert.deepEqual(await vault.listArtifacts({ purpose: 'private-trial' }), []);
  await vault.backup(join(vault.directory, 'synthetic-complete-snapshot.backup'));
  await vault.delete();
});
