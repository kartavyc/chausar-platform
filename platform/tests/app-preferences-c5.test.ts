// C5 task 36: one language preference, in <vaults>/preferences.json, answered before the vault check, so Welcome, the
// desktop, the phone and the paired browser read one place. Only the owner's choice sets it; nothing reads the computer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { memoryDeviceKeyStore } from '../runtime/device-custody.ts';
import { BOOTSTRAP_ONLY_METHODS } from '../runtime/server.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

async function folder(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-prefs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function engineAt(t: any, directory: string) {
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', workspaceCustody: { deviceKeys: memoryDeviceKeyStore(), autoBackups: false } });
  t.after(() => engine.close().catch(() => {}));
  return (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
}

test('set and get with no business open; English until the owner chooses', async t => {
  const directory = await folder(t);
  const ask = engineAt(t, directory);
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
  assert.deepEqual(await ask('app.preferences.set', { language: 'hi' }), { motion: 'system', language: 'hi' });
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'hi' });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8')), { motion: 'system', language: 'hi' });
  // A new start of the engine reads the same place, and the file does not look like a business.
  const again = engineAt(t, directory);
  assert.deepEqual(await again('app.preferences.get'), { motion: 'system', language: 'hi' });
  assert.deepEqual((await again('workspace.list')).businesses, []);
});

test('it answers with a business open too, and the business does not change it', async t => {
  const ask = engineAt(t, await folder(t));
  await ask('workspace.create', { name: 'Language Shop', pack: 'services', folder: null });
  assert.deepEqual(await ask('app.preferences.set', { language: 'hi' }), { motion: 'system', language: 'hi' });
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'hi' });
  await ask('workspace.lock');
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'hi' });
});

test('an unknown language or an extra field is refused, and changes nothing', async t => {
  const ask = engineAt(t, await folder(t));
  await ask('app.preferences.set', { language: 'hi' });
  for (const payload of [{ language: 'fr' }, { language: 'HI' }, { language: 1 }, {}, { language: 'en', theme: 'dark' }]) {
    await assert.rejects(ask('app.preferences.set', payload), code('INVALID_PREFERENCE'));
  }
  await assert.rejects(ask('app.preferences.get', { language: 'hi' }), code('INVALID_PREFERENCE'));
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'hi' });
});

test('a damaged file reads as English; the next choice writes it whole', async t => {
  const directory = await folder(t);
  await writeFile(join(directory, 'preferences.json'), '{not json');
  const ask = engineAt(t, directory);
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
  await writeFile(join(directory, 'preferences.json'), JSON.stringify({ language: 'klingon' }));
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
  await ask('app.preferences.set', { language: 'en' });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8')), { motion: 'system', language: 'en' });
});

test('a member session or a phone reads it; only the local owner sets it', () => {
  assert.ok(BOOTSTRAP_ONLY_METHODS.includes('app.preferences.set'));
  assert.ok(!BOOTSTRAP_ONLY_METHODS.includes('app.preferences.get'));
});
