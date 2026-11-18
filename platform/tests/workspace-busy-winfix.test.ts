// Seen in the real app on Windows (15 Nov 2026): after a second business was created, workspace.lock answered
// VAULT_BUSY at 14:14:50, 14:16:16, 14:20:43 and 14:28:07, and a workspace.open 0.2 s after a lock answered it too.
// The request log shows why: each time, the window's own short reads (whatsNew.get, app.preferences.get,
// venture.queue.list, workspace.list; 15 to 600 ms each) were still on their way, and the engine refused a lock, open
// or create at once while any request was in flight. A lock, open, create or close now waits a short capped time for
// the requests in flight to end, and when one does not end it says in plain words what is still running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

const passphrase = 'Synthetic busy fixture passphrase';
const SHA = 'a'.repeat(64);

function deferred<T = void>() {
  let resolvePromise!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolvePromise = done; }), resolve: (value: T) => resolvePromise(value) };
}

/** An engine with one open business, and a request the test can hold in flight for as long as it likes. */
async function open(t: { after(run: () => Promise<void>): void }, busyWaitMs?: number) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-busy-'));
  const hold = deferred<unknown>();
  const engine = new Engine({
    directory, demo: true, storage: 'experimental-file', ...(busyWaitMs === undefined ? {} : { busyWaitMs }),
    venture: { codexCli: { record: () => hold.promise } } as never,
  });
  t.after(async () => { hold.resolve({}); await engine.shutdown(5000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Busy Studio', passphrase, folder: 'first' });
  /** Choosing a Codex, held open: a request that stays in flight until the test lets it end. */
  const stuck = () => engine.confirmCodexSetup({ cli: 'codex', sha256: SHA, path: '/synthetic/codex' });
  return { engine, hold, stuck };
}

test('a lock waits for the short reads still on their way instead of refusing', async t => {
  const { engine } = await open(t);
  // The window's own reads, sent just before the lock (the log's whatsNew.get, app.preferences.get and a status read).
  const reads = [engine.request('whatsNew.get'), engine.request('app.preferences.get'), engine.request('workspace.backups.list')];
  const locked = await engine.request('workspace.lock');
  assert.deepEqual(locked, { locked: true });
  // Reads that began before the lock were answered, not dropped.
  for (const read of await Promise.allSettled(reads)) assert.equal(read.status, 'fulfilled');
  assert.equal((await engine.request('workspace.status')).open, false);
});

test('an open right after a lock waits for the reads that arrived in the gap', async t => {
  const { engine } = await open(t);
  await engine.request('workspace.lock');
  const reads = [engine.request('workspace.backups.list'), engine.request('whatsNew.get')];
  await engine.request('workspace.open', { folder: 'first', passphrase });
  for (const read of await Promise.allSettled(reads)) assert.equal(read.status, 'fulfilled');
  assert.equal((await engine.request('workspace.status')).workspace.name, 'Synthetic Busy Studio');
});

test('a second business is created while reads are still on their way', async t => {
  const { engine } = await open(t);
  await engine.request('workspace.lock');
  const reads = [engine.request('app.preferences.get'), engine.request('whatsNew.get')];
  const made = await engine.request('workspace.create', { name: 'Synthetic Second Studio', passphrase, folder: 'second' });
  assert.equal(made.workspace.name, 'Synthetic Second Studio');
  for (const read of await Promise.allSettled(reads)) assert.equal(read.status, 'fulfilled');
});

test('a request that does not end holds a lock for a capped time only, and the refusal says what is still running', async t => {
  const { engine, hold, stuck } = await open(t, 150);
  const choosing = stuck();
  const started = Date.now();
  await assert.rejects(engine.request('workspace.lock'), (error: unknown) => {
    const { code, message } = error as { code?: string; message: string };
    assert.equal(code, 'VAULT_BUSY');
    assert.match(message, /still/);
    assert.match(message, /saving your choice of Codex/);
    assert.doesNotMatch(message, /workspace operation|venture\./);
    return true;
  });
  const waited = Date.now() - started;
  assert.ok(waited >= 140 && waited < 3000, `waited ${waited} ms`);
  // The refused lock left nothing behind: the business is still open and answers.
  assert.equal((await engine.request('workspace.status')).open, true);
  assert.ok(await engine.request('app.preferences.get'));
  // Once the request ends, the same lock works.
  hold.resolve({});
  await choosing;
  assert.deepEqual(await engine.request('workspace.lock'), { locked: true });
});

test('while a lock waits, no new request starts, so reads that keep coming can never hold it off', async t => {
  const { engine, hold, stuck } = await open(t, 2000);
  const choosing = stuck();
  const locking = engine.request('workspace.lock');
  // A read sent while the lock waits is refused at once, in plain words, and does not join the queue.
  await assert.rejects(engine.request('app.preferences.get'), (error: unknown) => {
    const { code, message } = error as { code?: string; message: string };
    assert.equal(code, 'VAULT_BUSY');
    assert.doesNotMatch(message, /workspace operation/);
    return true;
  });
  await assert.rejects(engine.request('workspace.open', { folder: 'first', passphrase }), { code: 'VAULT_BUSY' });
  hold.resolve({});
  await choosing;
  assert.deepEqual(await locking, { locked: true });
});

test('closing the engine waits for a short read too', async t => {
  const { engine } = await open(t);
  const read = engine.request('whatsNew.get');
  await engine.close();
  assert.equal((await Promise.allSettled([read]))[0]!.status, 'fulfilled');
  assert.equal(engine.vault, null);
});
