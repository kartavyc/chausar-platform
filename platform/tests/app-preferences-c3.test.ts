// One-shot C3 task 3: the app's own preference on this computer, animations on or off, through the real Engine with
// experimental file storage and a temp folder. It is answered before any business is open, survives a new engine on
// the same folder, holds only the preference, and only the computer's owner may change it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { APP_PREFERENCE_METHODS } from '../runtime/app-preferences.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

async function folder(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-prefs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function engineAt(t: any, directory: string) {
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(() => engine.close().catch(() => {}));
  return { engine, ask: (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload) };
}

test('the two methods are named once, for the method lists', () => {
  assert.deepEqual([...APP_PREFERENCE_METHODS], ['app.preferences.get', 'app.preferences.set']);
});

test('with no business open, get answers system; set off, then get answers off; a new engine on the same folder reads off', async t => {
  const directory = await folder(t);
  const { ask, engine } = engineAt(t, directory);
  assert.equal((await ask('workspace.status')).open, false);
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
  assert.deepEqual(await ask('app.preferences.set', { motion: 'off' }), { motion: 'off', language: 'en' });
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'off', language: 'en' });
  await engine.close();
  const again = engineAt(t, directory);
  assert.deepEqual(await again.ask('app.preferences.get'), { motion: 'off', language: 'en' });
  assert.deepEqual(await again.ask('app.preferences.set', { motion: 'system' }), { motion: 'system', language: 'en' });
});

test('an unknown value or field is refused in plain words, and nothing is written', async t => {
  const directory = await folder(t);
  const { ask } = engineAt(t, directory);
  await assert.rejects(ask('app.preferences.set', { motion: 'fast' }), (error: any) => {
    assert.equal(error.code, 'INVALID_PREFERENCE');
    assert.equal(error.message, 'Animations can follow this computer or be off.');
    return true;
  });
  await assert.rejects(ask('app.preferences.set', { motion: 'off', theme: 'dark' }), (error: any) => {
    assert.equal(error.code, 'INVALID_PREFERENCE');
    assert.equal(error.message, 'This app has no such setting.');
    return true;
  });
  await assert.rejects(ask('app.preferences.set', {}), code('INVALID_PREFERENCE'));
  await assert.rejects(readFile(join(directory, 'preferences.json'), 'utf8'), { code: 'ENOENT' });
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
});

test('the file holds only the preference; a broken file reads as the defaults', async t => {
  const directory = await folder(t);
  const { ask } = engineAt(t, directory);
  await ask('app.preferences.set', { motion: 'off' });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8')), { format: 'chausar.preferences.v1', motion: 'off', language: 'en' });
  await writeFile(join(directory, 'preferences.json'), '{ not json');
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
  await writeFile(join(directory, 'preferences.json'), JSON.stringify({ motion: 'off', business: 'Asha Studio' }));
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'system', language: 'en' });
});

test('with a business open, only the computer’s owner may change it; anyone may read it', async t => {
  const directory = await folder(t);
  const { ask, engine } = engineAt(t, directory);
  await ask('workspace.create', { name: 'Asha Studio', passphrase: 'a long owner passphrase here', folder: 'main' });
  assert.deepEqual(await ask('app.preferences.set', { motion: 'off' }), { motion: 'off', language: 'en' });
  const cofounder = { memberId: 'member_cofounder', role: 'cofounder', epoch: 1, channel: 'web' } as any;
  await assert.rejects(engine.requestAs(cofounder, 'app.preferences.set', { motion: 'system', language: 'en' }), (error: any) => typeof error?.code === 'string');
  assert.deepEqual(await ask('app.preferences.get'), { motion: 'off', language: 'en' });
});
