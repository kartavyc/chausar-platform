// C5 tasks 21, 23: the desktop's own picks. The window never names a path: it asks main to pick, and is given a one-time token
// for a file, or only the folder's last name. Only main asks the engine the two methods that take a path, and neither is
// in the window's allowlist or the server's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { CUSTODY_MAIN_ONLY_METHODS } from '../runtime/workspace-custody-contracts.ts';

const require = createRequire(import.meta.url);
const keep = require('../../app/desktop/keep-files.cjs');
const contract = require('../../app/desktop/ipc-contract.cjs');

function deps(picked: string | null, overrides: Record<string, unknown> = {}) {
  const asked: [string, any][] = [];
  const shown: any[] = [];
  return {
    asked, shown,
    window: { webContents: { id: 1 } },
    assertTrustedSender: (event: any) => { if (event !== 'trusted') throw Object.assign(new Error('no'), { code: 'UNTRUSTED_SENDER' }); },
    publicError: contract.publicError,
    documents: 'D:\\docs',
    dialog: { showOpenDialog: async (_owner: unknown, options: any) => { shown.push(options); return picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }; } },
    engine: { request: async (method: string, payload: any) => { asked.push([method, payload]); return { workspace: { name: 'Copy Shop' }, folder: 'copy', unlock: 'passphrase', copy: { folderName: 'USB' } }; } },
    ...overrides,
  };
}

test('neither method that names a path is open to the window or the server', async () => {
  for (const method of CUSTODY_MAIN_ONLY_METHODS) assert.ok(!contract.METHODS.includes(method), method);
  const server = await readFile(new URL('../runtime/server.ts', import.meta.url), 'utf8');
  for (const method of CUSTODY_MAIN_ONLY_METHODS) assert.ok(!server.includes(method), method);
});

test('pick a copy: the window gets a token and a name; the path stays in main; the token works once', async () => {
  const path = process.platform === 'win32' ? 'E:\\usb\\my copy.vault' : '/media/usb/my copy.vault', d = deps(path);
  const picked = await keep.pickCopy('trusted', {}, d);
  assert.equal(picked.ok, true);
  assert.equal(picked.result.name, 'my copy.vault');
  assert.match(picked.result.token, /^[A-Za-z0-9_-]{16,}$/);
  assert.ok(!JSON.stringify(picked).includes('usb'), 'the window never holds the path');
  assert.deepEqual(d.shown[0].filters.flatMap((filter: any) => filter.extensions).sort(), ['backup', 'json', 'vault']);

  const opened = await keep.importCopy('trusted', { token: picked.result.token, passphrase: 'a long passphrase here' }, d);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.deepEqual(d.asked, [['workspace.import', { file: path, passphrase: 'a long passphrase here' }]]);
  // A refusal keeps the token (the passphrase can be asked for); success spends it.
  const again = await keep.importCopy('trusted', { token: picked.result.token }, d);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'COPY_NOT_PICKED');
});

test('a refused import keeps the pick so the owner can answer; extra fields and a stranger are refused', async () => {
  const refusing = deps('E:\\copy.vault', { engine: { request: async () => { throw Object.assign(new Error('Type it.'), { code: 'PASSPHRASE_REQUIRED' }); } } });
  const picked = await keep.pickCopy('trusted', {}, refusing);
  const first = await keep.importCopy('trusted', { token: picked.result.token }, refusing);
  assert.equal(first.error.code, 'PASSPHRASE_REQUIRED');
  const stranger = await keep.importCopy('someone', { token: picked.result.token }, refusing);
  assert.equal(stranger.ok, false);
  assert.equal((await keep.importCopy('trusted', { token: picked.result.token, file: 'C:\\x' }, refusing)).error.code, 'INVALID_REQUEST');
  assert.equal((await keep.importCopy('trusted', { token: picked.result.token, restore: 'yes' }, refusing)).error.code, 'INVALID_REQUEST');
  assert.equal((await keep.pickCopy('trusted', {}, deps(null))).result, null, 'cancelling picks nothing');
});

test('the backup folder: main picks, confirms to the engine with the path, and answers the view; clearing names no path', async () => {
  const d = deps('E:\\usb');
  const set = await keep.setBackupFolder('trusted', { action: 'pick' }, d);
  assert.equal(set.ok, true);
  assert.deepEqual(d.asked, [['workspace.backups.copyTo', { folder: 'E:\\usb', confirmed: true }]]);
  assert.deepEqual(set.result.copy, { folderName: 'USB' });
  assert.deepEqual(d.shown[0].properties, ['openDirectory', 'createDirectory']);
  await keep.setBackupFolder('trusted', { action: 'clear' }, d);
  assert.deepEqual(d.asked[1], ['workspace.backups.copyTo', { folder: null, confirmed: true }]);
  assert.equal((await keep.setBackupFolder('trusted', { action: 'pick', folder: 'C:\\x' }, d)).error.code, 'INVALID_REQUEST');
  assert.equal((await keep.setBackupFolder('trusted', { action: 'pick' }, deps(null))).result, null);
});
