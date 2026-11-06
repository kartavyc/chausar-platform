import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Vault, ExperimentalFileSnapshotAdapter, type VaultEnvelope } from '../runtime/vault.ts';
const passphrase = 'synthetic coalescing passphrase';
async function setup(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-vault-coalescing-'));
  let writes = 0, rejectWrites = false, release = () => {};
  let blocked: Promise<void> | undefined;
  class Counted extends ExperimentalFileSnapshotAdapter {
    async commit(envelope: VaultEnvelope, expected: number | null) {
      if (expected !== null) { writes++; await blocked; if (rejectWrites) throw new Error('Injected save failure'); }
      return super.commit(envelope, expected);
    }
  }
  const adapter = new Counted(directory);
  const { vault } = await Vault.create({ directory, storage: adapter, passphrase, name: 'Coalescing' });
  t.after(async () => { release(); await vault.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, vault, writes: () => writes, fail: () => { rejectWrites = true; }, block: () => { blocked = new Promise<void>(resolve => { release = resolve; }); }, release: () => release() };
}
test('twenty concurrent updates use at most two durable writes and settle only after their write', async t => {
  const env = await setup(t); env.block(); let settled = 0;
  const pending = Array.from({ length: 20 }, (_, index) => env.vault.update(state => { state.activity.push({ index }); return index; }).then(value => { settled++; return value; }));
  await setImmediate(); assert.equal(env.writes(), 1, 'a lone first batch starts without a timer window'); assert.equal(settled, 0);
  env.release(); assert.deepEqual(await Promise.all(pending), Array.from({ length: 20 }, (_, i) => i));
  assert.ok(env.writes() <= 2, 'concurrent changes share a durable write'); assert.equal(env.vault.read().activity.length, 20);
  assert.equal(env.vault.read().revision, 20, 'each accepted transaction still advances the logical revision');
});
test('a rejected batch rejects every caller and leaves memory and disk at the last committed state', async t => {
  const env = await setup(t), before = env.vault.read(); env.fail();
  const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => env.vault.update(state => { state.workspace.name = 'Never durable'; })));
  assert.ok(outcomes.every(row => row.status === 'rejected')); assert.ok(env.writes() <= 2);
  assert.deepEqual(env.vault.read(), before); await env.vault.close();
  const reopened = await Vault.open({ directory: env.directory, storage: 'experimental-file', passphrase });
  assert.deepEqual(reopened.read(), before); await reopened.close();
});
test('backup is a queue barrier and a failed callback cannot leak its partial mutation into another update', async t => {
  const env = await setup(t), backup = join(env.directory, 'barrier.backup');
  const first = env.vault.update(state => { state.workspace.name = 'Before backup'; });
  const saved = env.vault.backup(backup);
  const bad = env.vault.update(state => { state.workspace.name = 'Leaked change'; throw new Error('Bad callback'); });
  const next = env.vault.update(state => { state.activity.push({ message: 'After backup' }); });
  await Promise.all([first, saved, assert.rejects(bad, /Bad callback/), next]);
  assert.equal(env.vault.read().workspace.name, 'Before backup');
  const restored = await Vault.restore({ directory: join(env.directory, 'restored'), storage: 'experimental-file', passphrase, backupFile: backup });
  assert.equal(restored.read().workspace.name, 'Before backup'); assert.equal(restored.read().activity.length, 0); await restored.close();
  assert.ok((await readFile(backup, 'utf8')).includes('chausar.backup.v1'));
});
test('batched callbacks keep their own async request context and reject nested transactions', async t => {
  const env = await setup(t), context = new AsyncLocalStorage<number>();
  const seen = await Promise.all(Array.from({ length: 4 }, (_, index) => context.run(index, () => env.vault.update(async state => {
    await setImmediate(); assert.equal(context.getStore(), index); state.activity.push({ index });
    await assert.rejects(env.vault.update(() => {}), (error: any) => error.code === 'REENTRANT_TRANSACTION'); return context.getStore();
  }))));
  assert.deepEqual(seen, [0, 1, 2, 3]);
});
