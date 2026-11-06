// One-shot C4 task 36: Export asks where to save. The save dialog lives in main (stubbed here: nothing opens on
// screen); the window names only the kind of copy and gets back the file's name and an id, never a path; a cancel
// writes nothing; the window's own requests can't carry a path to workspace.export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { saveBusinessExport, showSavedExport, SAVE_CHANNEL, SHOW_CHANNEL } = require('../../app/desktop/export-save.cjs');
const { validateRequest } = require('../../app/desktop/ipc-contract.cjs');

function deps(answer: { canceled: boolean; filePath?: string }) {
  const asked: any[] = [], requests: any[] = [], shown: string[] = [];
  return {
    asked, requests, shown,
    deps: {
      window: { webContents: {} }, assertTrustedSender: () => {}, publicError: (e: any) => ({ code: e.code, message: e.message }), documents: join('C:', 'Users', 'owner', 'Documents'),
      dialog: { showSaveDialog: async (_window: unknown, options: any) => { asked.push(options); return answer; } },
      engine: { request: async (method: string, payload: any) => {
        requests.push({ method, payload });
        if (method === 'workspace.custody.get') return { business: { exportName: 'Pune Frames, 3 Nov 2026.vault' } };
        return { path: payload.path, name: payload.path.split(/[\\/]/).pop(), encrypted: !payload.plaintext };
      } },
      shell: { showItemInFolder: (path: string) => { shown.push(path); } },
      fs: { stat: async () => ({ isFile: () => true }) },
    },
  };
}

test('the dialog offers the business name and day in Documents; the engine writes where the owner picked; the window gets the name', async () => {
  const chosen = join('D:', 'Copies', 'Pune Frames, 3 Nov 2026.vault');
  const run = deps({ canceled: false, filePath: chosen });
  const reply = await saveBusinessExport({}, { plaintext: false }, run.deps);
  assert.equal(reply.ok, true);
  assert.equal(run.asked[0].defaultPath, join('C:', 'Users', 'owner', 'Documents', 'Pune Frames, 3 Nov 2026.vault'));
  assert.deepEqual(run.asked[0].filters, [{ name: 'Chausar copy', extensions: ['vault'] }]);
  assert.deepEqual(run.requests.at(-1), { method: 'workspace.export', payload: { confirmed: true, plaintext: false, path: chosen } });
  assert.deepEqual(Object.keys(reply.result).sort(), ['encrypted', 'id', 'name']);
  assert.equal(reply.result.name, 'Pune Frames, 3 Nov 2026.vault');
  assert.ok(!JSON.stringify(reply).includes('Copies'), 'the window never gets the folder');
  // Show in folder: by the id only.
  assert.deepEqual(await showSavedExport({}, { id: reply.result.id }, run.deps), { ok: true });
  assert.deepEqual(run.shown, [chosen]);
  for (const bad of [{ id: 'nope' }, { path: chosen }, { id: reply.result.id, extra: 1 }, null]) assert.equal((await showSavedExport({}, bad, run.deps)).error.code, 'INVALID_REQUEST');
  // A readable copy is offered as .json, and a name typed without its extension gets it.
  const readable = deps({ canceled: false, filePath: join('D:', 'Copies', 'readable') });
  await saveBusinessExport({}, { plaintext: true }, readable.deps);
  assert.equal(readable.asked[0].defaultPath, join('C:', 'Users', 'owner', 'Documents', 'Pune Frames, 3 Nov 2026.json'));
  assert.equal(readable.requests.at(-1).payload.path, join('D:', 'Copies', 'readable.json'));
});

test('a cancel writes nothing; a bad request opens no dialog', async () => {
  const run = deps({ canceled: true });
  assert.deepEqual(await saveBusinessExport({}, { plaintext: false }, run.deps), { ok: true, result: null });
  assert.equal(run.requests.some(item => item.method === 'workspace.export'), false, 'nothing was written');
  const bad = deps({ canceled: false, filePath: 'x' });
  for (const input of [{}, { plaintext: 'yes' }, { plaintext: false, path: 'C:\\x.vault' }, null]) {
    const reply = await saveBusinessExport({}, input, bad.deps);
    assert.equal(reply.error.code, 'INVALID_REQUEST');
  }
  assert.equal(bad.asked.length, 0);
});

test('the window cannot send a path to workspace.export; the preload forwards only the kind and the id', async () => {
  assert.throws(() => validateRequest({ method: 'workspace.export', payload: { confirmed: true, plaintext: false, path: 'C:\\Windows\\x.vault' } }), (error: any) => error.code === 'INVALID_REQUEST');
  assert.doesNotThrow(() => validateRequest({ method: 'workspace.export', payload: { confirmed: true, plaintext: false } }));
  let bridge: any; const calls: any[] = [];
  runInNewContext(await readFile('app/desktop/preload.cjs', 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (channel: string, input: any) => { calls.push({ channel, input }); return { ok: true, result: null }; } } }) });
  assert.equal(await bridge.saveBusinessExport(true), null);
  await bridge.showSavedExport('abc');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ channel: SAVE_CHANNEL, input: { plaintext: true } }, { channel: SHOW_CHANNEL, input: { id: 'abc' } }]);
  const main = await readFile('app/desktop/main.cjs', 'utf8');
  assert.match(main, /export-save\.cjs/);
});
