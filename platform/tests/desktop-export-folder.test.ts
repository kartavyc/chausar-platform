// Review of A1 (row 1): after Delete, the copies the owner exported stay, and "Show in folder" shows one. The desktop
// shows only a file of Chausar's own exports folder, named as Chausar names an export, never any other path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { showExport } = require('../../app/desktop/export-folder.cjs');

test('show in folder: only a Chausar export in the exports folder, by its name', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-exports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const exportsFolder = join(root, 'exports');
  await mkdir(exportsFolder);
  const name = 'chausar-workspace_3f3279f5-7199-438d-8c87-73e89598ce5f-1793672695278.vault';
  await writeFile(join(exportsFolder, name), 'x');
  const shown: string[] = [];
  const deps = { window: { webContents: {} }, assertTrustedSender: () => {}, publicError: (e: any) => ({ code: e.code, message: e.message }), shell: { showItemInFolder: (path: string) => { shown.push(path); } }, exportsFolder };
  assert.deepEqual(await showExport({}, { name }, deps), { ok: true });
  assert.deepEqual(shown, [join(exportsFolder, name)]);
  for (const bad of ['../secret.vault', 'C:\Windows\notepad.exe', 'chausar-x-1.exe', '', 42, null]) {
    const reply = await showExport({}, { name: bad }, deps);
    assert.equal(reply.ok, false, String(bad));
    assert.equal(reply.error.code, 'INVALID_REQUEST');
  }
  assert.equal((await showExport({}, { name: 'chausar-workspace_gone-1793672695278.json' }, deps)).error.code, 'EXPORT_NOT_FOUND');
  assert.equal(shown.length, 1, 'nothing else was shown');
});

test('show in folder: the real preload forwards only the name', async () => {
  let bridge: any; const calls: any[] = [];
  runInNewContext(await readFile('app/desktop/preload.cjs', 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (channel: string, input: any) => { calls.push({ channel, input }); return { ok: true }; } } }) });
  await bridge.showExport('chausar-ws-1.vault');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ channel: 'chausar:exports:show', input: { name: 'chausar-ws-1.vault' } }]);
});
