import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

const code = (expected: string) => (error: any) => error?.code === expected;

async function workspace(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-module-taint-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Taint Fixture', passphrase: 'Module host taint synthetic passphrase', demo: true, pack: 'ecommerce', folder: 'main' });
  return engine;
}

test('a module call can add the outside-text mark but never clear it', async t => {
  const engine = await workspace(t);
  const owner = { ...engine.context };
  assert.equal(owner.sourceTainted, undefined);

  // Untainted, the approval reaches the preview lookup; marked, it is refused before any state is read.
  const plain = engine.moduleHost('a-module', owner);
  await assert.rejects(plain.call('models.approve', { id: 'missing-preview' }), code('PREVIEW_NOT_FOUND'));
  await assert.rejects(plain.call('models.approve', { id: 'missing-preview' }, { tainted: true }), code('TAINTED_APPROVAL'));

  const tainted = engine.moduleHost('a-module', { ...owner, sourceTainted: true });
  await assert.rejects(tainted.call('models.approve', { id: 'missing-preview' }), code('TAINTED_APPROVAL'));
  await assert.rejects(tainted.call('models.approve', { id: 'missing-preview' }, { tainted: false }), code('TAINTED_APPROVAL'));
});
