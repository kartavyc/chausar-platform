import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import { Vault } from '../runtime/vault.ts';
import { fixture, sha256 } from './fixtures/workspace-interchange-public-acceptance.ts';

// Bind to the frozen join before execution. Actual public RPC, real encrypted
// writes and real source captures remain in use. The fault models a completed
// write with a lost acknowledgement; it does not simulate an OS fsync failure.
const typedRefusal = (error: unknown) => Boolean(error && typeof error === 'object'
  && typeof (error as { code?: unknown }).code === 'string'
  && typeof (error as { message?: unknown }).message === 'string');

async function archiveFiles(directory: string) {
  const files: { name: string; bytes: number; sha256: string }[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.equal(item.isSymbolicLink(), false);
    assert.ok(item.isFile(), 'The actual managed ciphertext namespace contains regular files.');
    if (!/_(archive|pin)\.encrypted\.json$/.test(item.name)) continue;
    const bytes = await readFile(join(directory, item.name));
    files.push({ name: item.name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

for (const part of ['archive', 'pin'] as const) {
  test(`public interchange rolls back a completed ${part} write after lost acknowledgement and permits a later export`, async t => {
    const f = await fixture(t, false), rpc = 'workspace.interchange.export';
    const good = await f.request(rpc, { destinationId: `known-good-${part}`, confirmed: true });
    assert.equal(good.kind, 'export'); assert.equal(good.custodyQualification, 'encrypted-local-host');
    const authority = await f.encrypted(), custody = join(f.directory, 'source', 'private-artifacts', 'workspace-interchange');
    const beforeFiles = await archiveFiles(custody);
    assert.ok(beforeFiles.length >= 2);
    const prototype = Vault.prototype as any, original = prototype.writeArtifact;
    assert.equal(typeof original, 'function');
    let entered = 0, completed: { id: string; diskBytes: number; valueDigest: string } | undefined;
    const hook = t.mock.method(prototype, 'writeArtifact', async function (this: Vault, input: any) {
      const ref = await original.call(this, input);
      if (entered === 0 && input.purpose === 'workspace-interchange' && input.expectedDigest === null
        && input.id.endsWith(`_${part}`)) {
        entered++; completed = ref;
        assert.equal(ref.id, input.id); assert.ok(ref.diskBytes > 0); assert.match(ref.valueDigest, /^[a-f0-9]{64}$/);
        throw new ChausarError('SYNTHETIC_LOST_ACK', 'Disposable fixture lost acknowledgement after an actual encrypted write.');
      }
      return ref;
    });
    const destinationId = `lost-ack-${part}`;
    try {
      await assert.rejects(f.request(rpc, { destinationId, confirmed: true }), typedRefusal);
    } finally { hook.mock.restore(); }
    assert.equal(entered, 1); assert.ok(completed);
    assert.equal(await f.encrypted(), authority, 'A failed portability operation cannot rewrite live authority.');
    for (const receipt of f.retainedReceipts) assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
    assert.deepEqual(await archiveFiles(custody), beforeFiles,
      'A known completed write must be rediscovered and exactly rolled back; no orphan archive or pin may poison future capture.');
    await assert.rejects(f.request('workspace.interchange.prepare', {
      exportId: destinationId, candidateId: `failed-candidate-${part}`, targetId: `failed-target-${part}`,
    }), typedRefusal);
    const next = await f.request(rpc, { destinationId: `after-lost-ack-${part}`, confirmed: true });
    assert.equal(next.kind, 'export'); assert.equal(next.packageDigest, good.packageDigest);
    assert.deepEqual(next.source, good.source);
    assert.equal(await f.encrypted(), authority);
    t.diagnostic(JSON.stringify({ qualification: 'synthetic-completed-write-lost-ack', part,
      actualCompletedDiskBytes: completed.diskBytes, ownedCiphertextFilesBefore: beforeFiles.length }));
  });
}
