import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the key memo is a constructor-only test option absent from production entrypoints and environment settings', async () => {
  const engine = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  assert.ok(/kdfMemo\?:/.test(engine), 'Engine exposes the explicit test-only memo option');
  for (const file of ['../runtime/worker.ts', '../runtime/server.ts', '../runtime/hosted/server.ts', '../runtime/config/env.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /kdfMemo|KDF_MEMO/);
  }
});
test('the second open uses the memo without deriving again and a different passphrase cannot reuse its entry', async t => {
  const { Vault } = await import('../runtime/vault.ts');
  const directory = await mkdtemp(join(tmpdir(), 'chausar-kdf-memo-'));
  let writes = 0, hits = 0;
  class Memo extends Map<string, Buffer> {
    set(key: string, value: Buffer) { writes++; return super.set(key, value); }
    get(key: string) { const found = super.get(key); if (found) hits++; return found; }
  }
  const memo = new Memo(), options = { directory, storage: 'experimental-file' as const, passphrase: 'synthetic memo passphrase', kdfMemo: memo };
  t.after(async () => { for (const value of memo.values()) value.fill(0); memo.clear(); await rm(directory, { recursive: true, force: true }); });
  const { vault } = await Vault.create({ ...options, name: 'Memo sample' }); await vault.close();
  const first = await Vault.open(options); await first.close(); const firstWrites = writes;
  assert.ok(firstWrites > 0, 'the supplied memo receives derived keys');
  const second = await Vault.open(options); assert.equal(writes, firstWrites); assert.ok(hits > 0);
  assert.equal(second.read().workspace.name, 'Memo sample'); await second.close();
  await assert.rejects(Vault.open({ ...options, passphrase: 'a different synthetic passphrase' }), (error: any) => error.code === 'UNLOCK_FAILED');
  assert.ok([...memo.keys()].every(key => !key.includes(options.passphrase)));
  assert.ok([...memo.values()].every(value => value.some(byte => byte !== 0)), 'zeroing the local derivation buffer must not erase the memo');
});
