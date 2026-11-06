// Ink v2 wave 5, package 5A5 (P11, plan test 5): the desktop saves a client report through W4's atomic export. The
// window names only the draft; main asks the engine to make the report, the owner picks a folder, and every file and
// manifest.json go into a new folder there together or not at all (money-export.cjs stage and commit). Stub dialog and
// engine; real files in a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const contract = require('../../app/desktop/ipc-contract.cjs');
const { saveReport } = require('../../app/desktop/report-save.cjs');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const file = (name: string, format: string, text: string) => ({ name, format, bytes: Buffer.byteLength(text), sha256: sha(Buffer.from(text)), contentBase64: Buffer.from(text).toString('base64') });
const MANIFEST = '{"files":[]}\n';
const REPORT = {
  id: 'report_1', runId: 'delivery_1', title: 'September', formats: ['html', 'docx'], notes: [], channels: [], period: null, estimates: 0,
  files: [file('september.html', 'html', '<!doctype html><p>hi</p>'), file('september.docx', 'docx', 'PK fake docx')],
  manifest: file('manifest.json', 'json', MANIFEST),
};
const trusted = { sender: 'window', senderFrame: {} };

function deps(folder: string | null, overrides: Record<string, unknown> = {}) {
  const asked: unknown[] = [];
  return {
    asked,
    window: { webContents: 'window' },
    assertTrustedSender: (event: { sender: unknown }) => { if (event.sender !== 'window') throw Object.assign(new Error('Untrusted.'), { code: 'UNTRUSTED_SENDER' }); },
    publicError: (error: any) => ({ code: error?.code ?? 'REQUEST_FAILED', message: error?.message ?? 'Failed.' }),
    engine: { request: async (method: string, payload: unknown) => { asked.push([method, payload]); return structuredClone(REPORT); } },
    dialog: { showOpenDialog: async () => (folder ? { canceled: false, filePaths: [folder] } : { canceled: true, filePaths: [] }) },
    documents: tmpdir(),
    ...overrides,
  };
}

test('the save channel is declared, and refuses an untrusted sender or anything but a draft id', async () => {
  assert.equal(contract.REPORT_SAVE_CHANNEL, 'chausar:report:save');
  const d = deps(null);
  assert.equal((await saveReport({ sender: 'other', senderFrame: {} }, { runId: 'delivery_1' }, d)).error.code, 'UNTRUSTED_SENDER');
  for (const input of [null, {}, { runId: '../x' }, { runId: 'delivery_1', path: 'C:/' }, { runId: 'delivery_1', formats: ['html'] }]) {
    assert.equal((await saveReport(trusted, input, d)).error.code, 'INVALID_REQUEST', JSON.stringify(input));
  }
  assert.deepEqual(d.asked, [], 'nothing was asked of the engine');
});

test('main makes the report, the owner picks a folder, and every file and the manifest go into a new folder together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-report-save-'));
  try {
    const d = deps(root);
    assert.deepEqual(await saveReport(trusted, { runId: 'delivery_1' }, deps(null)), { ok: true, result: null }, 'cancelled: nothing written');
    const saved = await saveReport(trusted, { runId: 'delivery_1' }, d);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.deepEqual(d.asked, [['venture.report.render', { runId: 'delivery_1', formats: ['html', 'pdf', 'docx', 'xlsx'] }]]);
    assert.equal(saved.result.folder, 'september');
    assert.match(saved.result.line, /Saved 3 files in the folder september\. Chausar did not send them anywhere\./);
    const folder = join(root, 'september');
    assert.deepEqual((await readdir(folder)).sort(), ['manifest.json', 'september.docx', 'september.html']);
    assert.equal(await readFile(join(folder, 'manifest.json'), 'utf8'), MANIFEST);
    assert.equal(JSON.stringify(saved).includes(root), false, 'no path on this computer reaches the window');
    // The same report again: the folder is there, so nothing is written over.
    const again = await saveReport(trusted, { runId: 'delivery_1' }, d);
    assert.equal(again.error.code, 'EXPORT_EXISTS');
    // A rename that fails part way leaves no new folder content behind.
    let renames = 0;
    const failing = { ...fsp, rename: async (from: string, to: string) => { renames += 1; if (renames === 2) throw Object.assign(new Error('disk'), { code: 'ENOSPC' }); return fsp.rename(from, to); } };
    const other = deps(root, { engine: { request: async () => ({ ...structuredClone(REPORT), files: REPORT.files.map(item => ({ ...item, name: item.name.replace('september', 'october') })) }) }, fs: failing });
    const broken = await saveReport(trusted, { runId: 'delivery_1' }, other);
    assert.equal(broken.error.code, 'EXPORT_NOT_SAVED');
    assert.deepEqual(await readdir(join(root, 'october')).catch(() => []), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a file whose bytes do not match the sha256 the engine gave, or a name that is not a report file, is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-report-save-'));
  try {
    const tampered = deps(root, { engine: { request: async () => ({ ...structuredClone(REPORT), files: [{ ...REPORT.files[0], sha256: 'f'.repeat(64) }] }) } });
    assert.equal((await saveReport(trusted, { runId: 'delivery_1' }, tampered)).error.code, 'REQUEST_FAILED');
    const named = deps(root, { engine: { request: async () => ({ ...structuredClone(REPORT), files: [{ ...REPORT.files[0], name: '../evil.html' }] }) } });
    assert.equal((await saveReport(trusted, { runId: 'delivery_1' }, named)).error.code, 'REQUEST_FAILED');
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('main.cjs answers the save channel with report-save.cjs, and the preload offers saveReport with only the draft id', async () => {
  const main = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /ipcMain\.handle\(require\('\.\/ipc-contract\.cjs'\)\.REPORT_SAVE_CHANNEL, \(event, input\) => require\('\.\/report-save\.cjs'\)\.saveReport\(event, input, /);
  const preload = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /ipcRenderer\.invoke\('chausar:report:save', \{ runId: String\(runId\) \}\)/);
});
