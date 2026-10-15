import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadElectronPreloadFixture } from './fixtures/electron-context-bridge.ts';
import { MAX_PICKED_BYTES, PICK_REFUSALS, createShellPort, pickReply } from '../../app/ui/src/bridge/shell.ts';
import { backupPicker, statementPicker } from '../../app/ui/src/screens/first-run/pick.ts';

// imports.pickFile (frame-today, round 4) across the actual main-side handler (file-ipc.cjs), the
// actual preload and the actual host adapter. The dialog is synthetic; the files are real temporary
// files, so the size, kind and managed-folder checks run against a real filesystem.
const require = createRequire(import.meta.url);
const fileIpc = require('../../app/desktop/file-ipc.cjs') as {
  PICK_FILE_CHANNEL: string; MAX_STATEMENT_BYTES: number; PICK_REFUSALS: readonly string[];
  registerPickFileHandler(options: Record<string, unknown>): void;
};
const preloadPath = new URL('../../app/desktop/preload.cjs', import.meta.url);
const preloadSource = await readFile(preloadPath, 'utf8');

interface PickApi { pickFile(kind: unknown): Promise<unknown> }

async function chain(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-pick-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const backups = join(root, 'vaults', 'backups'), outside = join(root, 'Downloads');
  await mkdir(backups, { recursive: true }); await mkdir(outside, { recursive: true });
  const handlers = new Map<string, (event: unknown, value: unknown) => Promise<unknown>>();
  const dialogs: unknown[][] = []; const channels: string[] = [];
  let answer: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] };
  let gate: Promise<void> | null = null;
  const mainFrame = { url: 'chausar://app/ui/index.html' };
  const contents = { mainFrame };
  const window = { id: 'window' };
  fileIpc.registerPickFileHandler({
    ipcMain: { handle(channel: string, handler: (event: unknown, value: unknown) => Promise<unknown>) { handlers.set(channel, handler); } },
    dialog: { async showOpenDialog(...args: unknown[]) { dialogs.push(args); if (gate) await gate; return answer; } },
    contents: () => contents, document: () => 'chausar://app/ui/index.html', owner: () => window, backupsDirectory: () => backups,
  });
  const handler = handlers.get(fileIpc.PICK_FILE_CHANNEL)!;
  const trusted = { sender: contents, senderFrame: mainFrame };
  const { api } = loadElectronPreloadFixture<PickApi>({ source: preloadSource, filename: preloadPath.pathname,
    async invoke(channel, value) { channels.push(channel); const found = handlers.get(channel); if (!found) throw new Error('No synthetic handler.'); return found(trusted, value); } });
  return {
    root, backups, outside, handler, trusted, api, dialogs, channels, window,
    choose(path: string) { answer = { canceled: false, filePaths: [path] }; },
    cancel() { answer = { canceled: true, filePaths: [] }; },
    hold() { let release!: () => void; gate = new Promise<void>(accept => { release = accept; }); return () => { gate = null; release(); }; },
  };
}

test('main and the renderer agree on the limit and the refusal codes, and the limit fits one desktop request as base64', () => {
  assert.equal(fileIpc.MAX_STATEMENT_BYTES, MAX_PICKED_BYTES);
  assert.deepEqual([...fileIpc.PICK_REFUSALS], [...PICK_REFUSALS]);
  const ipc = require('../../app/desktop/ipc-contract.cjs') as { MAX_REQUEST_BYTES: number };
  assert.ok(Math.ceil(MAX_PICKED_BYTES / 3) * 4 + 1024 < ipc.MAX_REQUEST_BYTES);
});

test('a statement is read by main and returned as its base name and bytes, never its path', async t => {
  const h = await chain(t);
  const csv = join(h.outside, 'September sales.csv');
  await writeFile(csv, 'id,date,amount\ninv-1,2026-09-03,1000.00\n');
  h.choose(csv);
  const reply = await h.handler(h.trusted, 'statement') as Record<string, unknown>;
  assert.deepEqual(Object.keys(reply).sort(), ['bytesBase64', 'name', 'outcome']);
  assert.equal(reply['name'], 'September sales.csv');
  assert.equal(Buffer.from(reply['bytesBase64'] as string, 'base64').toString('utf8'), 'id,date,amount\ninv-1,2026-09-03,1000.00\n');
  assert.equal(JSON.stringify(reply).includes(h.outside), false, 'no path reaches the renderer');
  // The dialog belongs to the window and offers only the three kinds FR-07 reads.
  const [owner, options] = h.dialogs[0] as [unknown, { properties: string[]; filters: { extensions: string[] }[]; defaultPath?: string }];
  assert.equal(owner, h.window);
  assert.deepEqual(options.properties, ['openFile']);
  assert.deepEqual(options.filters.flatMap(filter => filter.extensions), ['csv', 'xlsx', 'pdf']);
  assert.equal(options.defaultPath, undefined);
});

test('main refuses an untrusted sender, an unknown kind, a kind typed past the filter, a file too large, and a folder', async t => {
  const h = await chain(t);
  const big = join(h.outside, 'year.pdf'), text = join(h.outside, 'notes.docx'), edge = join(h.outside, 'edge.xlsx');
  await writeFile(big, Buffer.alloc(fileIpc.MAX_STATEMENT_BYTES + 1, 1));
  await writeFile(edge, Buffer.alloc(fileIpc.MAX_STATEMENT_BYTES, 2));
  await writeFile(text, 'not a statement');
  h.choose(big);
  assert.deepEqual(await h.handler({ sender: {}, senderFrame: h.trusted.senderFrame }, 'statement'), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  assert.deepEqual(await h.handler({ sender: h.trusted.sender, senderFrame: { url: 'chausar://app/ui/index.html' } }, 'statement'), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  for (const kind of ['backup-path', '/etc/passwd', { kind: 'statement' }, undefined, 3]) assert.deepEqual(await h.handler(h.trusted, kind), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  assert.equal(h.dialogs.length, 0, 'no dialog opens for a refused request');
  assert.deepEqual(await h.handler(h.trusted, 'statement'), { outcome: 'refused', code: 'FILE_TOO_LARGE' });
  h.choose(edge);
  const atLimit = await h.handler(h.trusted, 'statement') as { outcome: string; bytesBase64: string };
  assert.equal(atLimit.outcome, 'picked'); assert.equal(Buffer.from(atLimit.bytesBase64, 'base64').length, fileIpc.MAX_STATEMENT_BYTES);
  h.choose(text);
  assert.deepEqual(await h.handler(h.trusted, 'statement'), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  const folder = join(h.outside, 'folder.csv'); await mkdir(folder);
  h.choose(folder);
  assert.deepEqual(await h.handler(h.trusted, 'statement'), { outcome: 'refused', code: 'FILE_UNREADABLE' });
  h.choose(join(h.outside, 'gone.csv'));
  assert.deepEqual(await h.handler(h.trusted, 'statement'), { outcome: 'refused', code: 'FILE_UNREADABLE' });
  h.cancel();
  assert.deepEqual(await h.handler(h.trusted, 'statement'), { outcome: 'cancelled' });
});

test('one dialog at a time', async t => {
  const h = await chain(t);
  const csv = join(h.outside, 'a.csv'); await writeFile(csv, 'a\n1\n'); h.choose(csv);
  const release = h.hold();
  const first = h.handler(h.trusted, 'statement');
  assert.deepEqual(await h.handler(h.trusted, 'backup'), { outcome: 'refused', code: 'PICKER_BUSY' });
  release();
  assert.equal((await first as { outcome: string }).outcome, 'picked');
});

test('a backup is picked only from the managed backups folder and answered by its managed name', async t => {
  const h = await chain(t);
  const managed = join(h.backups, 'chausar-workspace_1-1760000000000.backup');
  await writeFile(managed, '{"backupFormat":"chausar.backup.v1"}');
  h.choose(managed);
  assert.deepEqual(await h.handler(h.trusted, 'backup'), { outcome: 'picked', name: 'chausar-workspace_1-1760000000000.backup' });
  const [, options] = h.dialogs[0] as [unknown, { defaultPath: string; filters: { extensions: string[] }[] }];
  assert.equal(options.defaultPath, h.backups);
  assert.deepEqual(options.filters.flatMap(filter => filter.extensions), ['backup']);
  // Outside the folder, nested, a link out of it, a different kind, or a folder: refused.
  const elsewhere = join(h.outside, 'old.backup'); await writeFile(elsewhere, '{}');
  const nested = join(h.backups, 'inner'); await mkdir(nested); await writeFile(join(nested, 'n.backup'), '{}');
  const link = join(h.backups, 'link.backup'); await symlink(elsewhere, link);
  const other = join(h.backups, 'notes.txt'); await writeFile(other, 'x');
  const dir = join(h.backups, 'dir.backup'); await mkdir(dir);
  for (const path of [elsewhere, join(nested, 'n.backup'), link, other, dir, join(h.backups, 'missing.backup')]) {
    h.choose(path);
    assert.deepEqual(await h.handler(h.trusted, 'backup'), { outcome: 'refused', code: 'BACKUP_NOT_MANAGED' }, path);
  }
});

test('the preload passes only the kind and copies the reply field by field; the host adapter checks it again', async t => {
  const h = await chain(t);
  for (const kind of ['/etc/passwd', { kind: 'statement' }, undefined]) assert.deepEqual(await h.api.pickFile(kind), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  assert.deepEqual(h.channels, []);
  const csv = join(h.outside, 'Sales.csv'); await writeFile(csv, 'id,amount\na,1.00\n'); h.choose(csv);
  const port = createShellPort(h.api as Parameters<typeof createShellPort>[0], null);
  assert.equal(typeof port.pickFile, 'function');
  const picked = await port.pickFile!('statement');
  assert.equal(picked.outcome, 'picked');
  assert.deepEqual(h.channels, [fileIpc.PICK_FILE_CHANNEL]);
  // The first-run adapter turns it into what FR-07 reads: CSV as text.
  assert.deepEqual(await statementPicker(port)!(), { name: 'Sales.csv', format: 'csv', content: 'id,amount\na,1.00\n' });
  const pdf = join(h.outside, 'Statement.PDF'); await writeFile(pdf, '%PDF-1.4'); h.choose(pdf);
  assert.deepEqual(await statementPicker(port)!(), { name: 'Statement.PDF', format: 'pdf', bytesBase64: Buffer.from('%PDF-1.4').toString('base64') });
  const big = join(h.outside, 'big.csv'); await writeFile(big, Buffer.alloc(MAX_PICKED_BYTES + 10, 65)); h.choose(big);
  await assert.rejects(statementPicker(port)!(), (error: { code?: string }) => error.code === 'FILE_TOO_LARGE');
  h.cancel();
  assert.equal(await statementPicker(port)!(), null);
  const managed = join(h.backups, 'chausar-w-1.backup'); await writeFile(managed, '{}'); h.choose(managed);
  assert.equal(await backupPicker(port)!(), 'chausar-w-1.backup');
  h.choose(join(h.outside, 'x.backup'));
  await assert.rejects(backupPicker(port)!(), (error: { code?: string }) => error.code === 'BACKUP_NOT_MANAGED');
  // In the browser there is no chooser: the screens draw a file input instead.
  assert.equal(createShellPort(null, null).pickFile, undefined);
  assert.equal(statementPicker(createShellPort(null, null)), undefined);
  assert.equal(backupPicker(createShellPort({}, null)), undefined);
});

test('the renderer refuses any reply that is not exactly one of the three shapes', () => {
  const unreadable = { outcome: 'refused', code: 'FILE_UNREADABLE' };
  for (const value of [null, 'picked', [], { outcome: 'picked' }, { outcome: 'picked', name: 'a.csv' }, { outcome: 'picked', name: 'a.csv', bytesBase64: '!!!!' },
    { outcome: 'picked', name: 'a.csv', bytesBase64: 'AAAA', path: '/home/me/a.csv' }, { outcome: 'picked', name: 'a\u0000.csv', bytesBase64: 'AAAA' },
    { outcome: 'refused', code: 'ENOENT' }, { outcome: 'cancelled', why: 'x' }, { outcome: 'picked', name: 'x'.repeat(201), bytesBase64: 'AAAA' }]) {
    assert.deepEqual(pickReply('statement', value), unreadable, JSON.stringify(value));
  }
  assert.deepEqual(pickReply('statement', { outcome: 'picked', name: 'a.csv', bytesBase64: 'A'.repeat(Math.ceil(MAX_PICKED_BYTES / 3) * 4 + 4) }), unreadable);
  for (const value of [{ outcome: 'picked', name: '../x.backup' }, { outcome: 'picked', name: 'x.backup', bytesBase64: 'AAAA' }, { outcome: 'picked', name: 'sub/x.backup' }, { outcome: 'picked', name: 'x.csv' }]) {
    assert.deepEqual(pickReply('backup', value), unreadable, JSON.stringify(value));
  }
  assert.deepEqual(pickReply('backup', { outcome: 'picked', name: 'chausar-a-1.backup' }), { outcome: 'picked', name: 'chausar-a-1.backup' });
  assert.deepEqual(pickReply('statement', { outcome: 'refused', code: 'PICKER_BUSY' }), { outcome: 'refused', code: 'PICKER_BUSY' });
});
