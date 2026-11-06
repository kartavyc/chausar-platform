import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t: any) {
  const { JournalStore } = await import('../runtime/store/journal.ts');
  const { initialState } = await import('../runtime/contracts.ts');
  const directory = await mkdtemp(join(tmpdir(), 'chausar-journal-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = initialState('Journal sample', true);
  base.conversations = Array.from({ length: 1000 }, (_, index) => ({ id: 'sample-' + index, kind: 'venture-person', name: 'Sample person ' + index }));
  let checkpoint = structuredClone(base), checkpoints = 0;
  const options = () => ({ directory, id: 'synthetic-vault', key: Buffer.alloc(32, 19), base: checkpoint, baseHash: 'a'.repeat(64), checkpoint: async (state: typeof base) => { checkpoint = structuredClone(state); checkpoints++; return 'a'.repeat(64); } });
  return { directory, base, options, checkpoints: () => checkpoints, JournalStore };
}
test('a one-field journal commit appends only the changed record and reopens exactly', async t => {
  const env = await fixture(t), journal = await env.JournalStore.open(env.options()), next = journal.read();
  next.revision++; next.conversations[500].name = 'Changed sample'; await journal.commit(next);
  assert.ok((await stat(join(env.directory, 'journal.log'))).size < 4_000);
  const reopened = await env.JournalStore.open(env.options()); assert.deepEqual(reopened.read(), next); await reopened.close();
});
test('a torn last line is set aside and recovery stops at the preceding revision', async t => {
  const env = await fixture(t), journal = await env.JournalStore.open(env.options());
  for (let index = 1; index <= 2; index++) { const next = journal.read(); next.revision++; next.conversations[0].name = 'Change ' + index; await journal.commit(next); }
  const path = join(env.directory, 'journal.log'), original = await readFile(path, 'utf8');
  const prefix = original.slice(0, original.lastIndexOf('\n', original.length - 2) + 1), torn = original.slice(prefix.length, -12);
  await writeFile(path, prefix + torn);
  const recovered = await env.JournalStore.open(env.options()); assert.equal(recovered.read().revision, 1);
  assert.equal(await readFile(join(env.directory, 'journal.torn'), 'utf8'), torn); assert.equal(await readFile(path, 'utf8'), prefix);
});
test('an authenticated line changed in the middle refuses without touching any file', async t => {
  const env = await fixture(t), journal = await env.JournalStore.open(env.options());
  for (let index = 0; index < 3; index++) { const next = journal.read(); next.revision++; next.conversations[index].name = 'Changed'; await journal.commit(next); }
  const path = join(env.directory, 'journal.log'), lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
  const changed = JSON.parse(lines[1]!); changed.cipher.data = (changed.cipher.data[0] === 'A' ? 'B' : 'A') + changed.cipher.data.slice(1); lines[1] = JSON.stringify(changed);
  const damaged = lines.join('\n') + '\n'; await writeFile(path, damaged);
  await assert.rejects(env.JournalStore.open(env.options()), (error: any) => error.code === 'UNLOCK_FAILED'); assert.equal(await readFile(path, 'utf8'), damaged);
});
test('the journal checkpoints at 200 lines and on clean close', async t => {
  const env = await fixture(t), journal = await env.JournalStore.open(env.options());
  for (let index = 0; index < 200; index++) { const next = journal.read(); next.revision++; next.conversations[0].name = 'Change ' + index; await journal.commit(next); }
  assert.equal(env.checkpoints(), 1); assert.equal((await stat(join(env.directory, 'journal.log'))).size, 0);
  const next = journal.read(); next.revision++; next.conversations[1].name = 'Last'; await journal.commit(next); await journal.close(); assert.equal(env.checkpoints(), 2);
});

test('the candidate Vault uses the journal and still writes a standalone restorable snapshot backup', async t => {
  const { Vault } = await import('../runtime/vault.ts');
  const directory = await mkdtemp(join(tmpdir(), 'chausar-vault-journal-candidate-'));
  const options = { directory, storage: 'experimental-file' as const, passphrase: 'synthetic journal candidate passphrase', experimentalJournal: true };
  const { vault } = await Vault.create({ ...options, name: 'Candidate', demo: true });
  t.after(async () => { await vault.close(); await rm(directory, { recursive: true, force: true }); });
  await vault.update(state => { state.workspace.name = 'Committed candidate'; });
  assert.ok((await stat(join(directory, 'journal.log'))).size > 0);
  const backup = join(directory, 'candidate.backup'); await vault.backup(backup);
  const restored = await Vault.restore({ directory: join(directory, 'restored'), storage: 'experimental-file', passphrase: options.passphrase, backupFile: backup });
  assert.equal(restored.read().workspace.name, 'Committed candidate'); await restored.close(); await vault.close();
  const opened = await Vault.open(options); assert.equal(opened.read().workspace.name, 'Committed candidate'); await opened.close();
});
