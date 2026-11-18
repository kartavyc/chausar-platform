// Closing the engine while a vault update is under way: a read is refused at once, the accepted update still
// finishes and is kept, and the business reopens with it. A real encrypted experimental-file vault, no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { Vault } from '../runtime/vault.ts';

const passphrase = 'Synthetic engine close fixture passphrase';

function deferred() {
  let resolvePromise!: () => void;
  return { promise: new Promise<void>(done => { resolvePromise = done; }), resolve: () => resolvePromise() };
}

test('closing drains an accepted asynchronous update in ordinary local mode', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-engine-close-'));
  const engines: Engine[] = [];
  const engineHere = () => {
    const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
    engines.push(engine); return engine;
  };
  t.after(async () => {
    for (const engine of engines) await engine.close();
    await rm(directory, { recursive: true, force: true });
  });
  const bootstrap = engineHere();
  await bootstrap.request('workspace.create', { name: 'Synthetic Close Drain', passphrase, demo: false, pack: 'ecommerce' });
  await bootstrap.close();
  const local = engineHere();
  await local.request('workspace.open', { folder: 'main', passphrase });
  const vault = local.vault!, entered = deferred(), released = deferred();
  const expected = vault.read(); expected.policy.autonomy = true; expected.revision++;
  const update = vault.update(async state => {
    state.policy.autonomy = true; entered.resolve(); await released.promise;
    return 'synthetic-local-update';
  });
  await entered.promise;
  const closing = local.close();
  assert.throws(() => vault.read(), (error: unknown) => (error as { code?: string }).code === 'VAULT_CLOSED');
  released.resolve();
  assert.equal(await update, 'synthetic-local-update'); await closing;

  const reopened = await Vault.open({ directory: join(directory, 'main'), passphrase, storage: 'experimental-file' });
  try { assert.deepEqual(reopened.read(), expected); }
  finally { await reopened.close(); }
});
