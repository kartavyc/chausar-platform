// One-shot C4 task 24: the CA's export. The names in owner words, a read-me beside the files that says what each holds,
// the last folder remembered in the desktop's own settings, a cancel that writes nothing, and a Show in folder id, with
// the path staying in main. Stubs only: no dialog ever opens on screen.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const saving = require('../../app/desktop/money-export.cjs');
const exportSave = require('../../app/desktop/export-save.cjs');
const contract = require('../../app/desktop/ipc-contract.cjs');

const contents: any = { mainFrame: { url: 'chausar://app/index.html' } };
const trusted = { sender: contents, senderFrame: contents.mainFrame };
const receipts = { format: 'chausar-signed-receipts/1', business: 'Pune Frames', algorithm: 'ed25519', publicKey: 'pk', keys: [], receipts: [] };
const file = {
  fileName: 'pune-frames-2026-10-for-ca.csv', ownerFileName: 'Pune Frames, sales, Oct 2026.csv', business: 'Pune Frames', period: 'October 2026',
  csv: 'Section\r\n', rows: 0, line: 'x', receipts,
};

async function folder(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-ca-c4-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function depsFor(dir: string, pick: (options: any) => string | null, extra: Record<string, unknown> = {}) {
  const shown: any[] = [];
  const dialog = { showSaveDialog: async (_owner: unknown, options: any) => { shown.push(options); const path = pick(options); return path ? { canceled: false, filePath: path } : { canceled: true }; } };
  return { shown, deps: { dialog, window: { webContents: contents }, engine: { request: async () => file }, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, documents: join(dir, 'Documents'), settingsFile: join(dir, 'settings.json'), ...extra } };
}

test('the dialog offers the name in owner words; three files land, named alike; the window gets names, a folder word and an id, never a path', async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    const { shown, deps } = depsFor(dir, options => options.defaultPath);
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(basename(shown[0].defaultPath), 'Pune Frames, sales, Oct 2026.csv');
    assert.deepEqual((await readdir(join(dir, 'Documents'))).sort(), ['Pune Frames, read me, Oct 2026.txt', 'Pune Frames, receipts, Oct 2026.json', 'Pune Frames, sales, Oct 2026.csv']);
    const { id, ...rest } = saved.result;
    assert.match(id, /^[a-f0-9]{18}$/);
    assert.deepEqual(rest, { saved: true, name: 'Pune Frames, sales, Oct 2026.csv', receipts: 'Pune Frames, receipts, Oct 2026.json', readme: 'Pune Frames, read me, Oct 2026.txt', count: 3, folder: 'Documents', line: 'Saved 3 files to Documents. Chausar did not send them anywhere.' });
    assert.ok(!JSON.stringify(saved.result).includes(dir), 'no full path reaches the window');
  });
});

test('the read-me says the business, the period, what each file holds and that nothing was sent', async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    const { deps } = depsFor(dir, options => options.defaultPath);
    await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    const lines = (await readFile(join(dir, 'Documents', 'Pune Frames, read me, Oct 2026.txt'), 'utf8')).split('\r\n');
    assert.deepEqual(lines, [
      'Pune Frames',
      'For your CA: October 2026',
      '',
      'Pune Frames, sales, Oct 2026.csv',
      "The month's invoices, credit notes, payments and costs, then the totals with the receipt behind each one.",
      '',
      'Pune Frames, receipts, Oct 2026.json',
      "The business's signed receipts, so your CA can check that the totals have not changed.",
      '',
      'Chausar did not send this anywhere.',
      '',
    ]);
  });
});

test('a name the owner typed keeps the files together, and no receipts means two files', async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    const { deps } = depsFor(dir, () => join(dir, 'Documents', 'october.csv'), { engine: { request: async () => ({ ...file, receipts: undefined }) } });
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.deepEqual((await readdir(join(dir, 'Documents'))).sort(), ['october-read-me.txt', 'october.csv']);
    assert.equal(saved.result.count, 2);
    assert.equal(saved.result.line, 'Saved 2 files to Documents. Chausar did not send them anywhere.');
    const lines = (await readFile(join(dir, 'Documents', 'october-read-me.txt'), 'utf8')).split('\r\n');
    assert.ok(lines.includes('october.csv'));
    assert.ok(!lines.some(line => line.includes('signed receipts')));
  });
});

test("the last folder is remembered in the desktop's own settings; a folder that has gone falls back to Documents", async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    await mkdir(join(dir, 'CA files'));
    const { shown, deps } = depsFor(dir, () => join(dir, 'CA files', 'Pune Frames, sales, Oct 2026.csv'));
    await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(shown[0].defaultPath, join(dir, 'Documents', 'Pune Frames, sales, Oct 2026.csv'));
    await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(shown[1].defaultPath, join(dir, 'CA files', 'Pune Frames, sales, Oct 2026.csv'));
    await rm(join(dir, 'CA files'), { recursive: true, force: true });
    const third = depsFor(dir, () => null);
    await saving.saveMoneyExport(trusted, { month: '2026-10' }, third.deps);
    assert.equal(third.shown[0].defaultPath, join(dir, 'Documents', 'Pune Frames, sales, Oct 2026.csv'));
  });
});

test('settings that cannot be read are ignored, and a save still works', async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    await writeFile(join(dir, 'settings.json'), 'not json');
    const { shown, deps } = depsFor(dir, options => options.defaultPath);
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(saved.ok, true);
    assert.equal(shown[0].defaultPath, join(dir, 'Documents', 'Pune Frames, sales, Oct 2026.csv'));
  });
});

test('a cancelled dialog writes nothing and remembers nothing', async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    const { deps } = depsFor(dir, () => null);
    assert.deepEqual(await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps), { ok: true, result: null });
    assert.deepEqual(await readdir(join(dir, 'Documents')), []);
    assert.deepEqual((await readdir(dir)).sort(), ['Documents']);
  });
});

test("a name that could point elsewhere never reaches the dialog: the engine's plain name stands in", async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    const { shown, deps } = depsFor(dir, () => null, { engine: { request: async () => ({ ...file, ownerFileName: '..\\..\\evil.csv' }) } });
    await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(basename(shown[0].defaultPath), 'pune-frames-2026-10-for-ca.csv');
  });
});

test('Show in folder takes the id the save answered and shows the saved file', async () => {
  await folder(async dir => {
    await mkdir(join(dir, 'Documents'));
    const { deps } = depsFor(dir, options => options.defaultPath);
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    const shownPaths: string[] = [];
    const reply = await exportSave.showSavedExport(trusted, { id: saved.result.id }, { ...deps, shell: { showItemInFolder: (path: string) => shownPaths.push(path) } });
    assert.deepEqual(reply, { ok: true });
    assert.deepEqual(shownPaths, [join(dir, 'Documents', 'Pune Frames, sales, Oct 2026.csv')]);
  });
});
