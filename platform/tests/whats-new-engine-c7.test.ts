// C7 task 26 (the engine half): whatsNew.get answers { version, seen } for the running version, before any vault;
// whatsNew.seen { version } marks it. A fresh install records its version silently, so nothing shows; after an update
// the new version reads as not seen until marked; a mark for another version than the running one is refused.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

async function engineAt(t: TestContext, version: string, folder?: string) {
  const directory = folder ?? await mkdtemp(join(await realpath(tmpdir()), 'chausar-whats-new-engine-'));
  if (!folder) t.after(() => rm(directory, { recursive: true, force: true }));
  const engine = new Engine({ directory, version, demo: true, storage: 'experimental-file' });
  t.after(() => engine.close().catch(() => {}));
  return { directory, ask: (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload) };
}

test('a fresh install reads seen; an update reads not seen until whatsNew.seen marks it', async t => {
  const first = await engineAt(t, '0.2.0');
  assert.deepEqual(await first.ask('whatsNew.get'), { version: '0.2.0', seen: true });
  const updated = await engineAt(t, '0.3.0', first.directory);
  assert.deepEqual(await updated.ask('whatsNew.get'), { version: '0.3.0', seen: false });
  await assert.rejects(updated.ask('whatsNew.seen', { version: '0.2.0' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(updated.ask('whatsNew.get', { extra: true }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(await updated.ask('whatsNew.seen', { version: '0.3.0' }), { version: '0.3.0', seen: true });
  assert.deepEqual(await updated.ask('whatsNew.get'), { version: '0.3.0', seen: true });
});

test('a broken mark reads as seen, so nothing loops', async t => {
  const first = await engineAt(t, '0.2.0');
  await mkdir(join(first.directory, 'custody'), { recursive: true });
  await writeFile(join(first.directory, 'custody', 'seen.json'), '{ not json');
  assert.deepEqual(await first.ask('whatsNew.get'), { version: '0.2.0', seen: true });
});
