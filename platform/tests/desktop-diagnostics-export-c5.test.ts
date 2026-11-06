// C5 task 27: Export diagnostics. The window reads exactly what would be saved first; Save writes that exact text through
// the system dialog (a stand-in here: nothing shows on screen). Crash files go in only when the owner ticks them.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createDiagnosticsExport, diagnosticSources, MAX_DUMP_BYTES } = require('../../app/desktop/diagnostics-export.cjs');
const { assertTrustedSender, publicError } = require('../../app/desktop/ipc-contract.cjs');

async function setup(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-export-c5-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const user = join(root, 'user'), dumps = join(root, 'dumps'), saved = join(root, 'saved');
  await mkdir(join(user, 'diagnostics'), { recursive: true });
  await mkdir(join(user, 'vaults', 'custody'), { recursive: true });
  await mkdir(join(dumps, 'reports'), { recursive: true });
  await mkdir(saved);
  await writeFile(join(user, 'diagnostics', 'startup.jsonl'), '{"phase":"app-ready","ms":1}\n');
  await writeFile(join(user, 'diagnostics', 'rpc.jsonl'), '{"method":"workspace.status","ms":3}\n');
  await writeFile(join(user, 'vaults', 'custody', 'diagnostics.jsonl'), '{"op":"transfer-import","code":"EPERM"}\n');
  await writeFile(join(dumps, 'reports', 'a1.dmp'), Buffer.from([1, 2, 3, 4]));
  const window = { webContents: { mainFrame: { url: 'chausar://app/index.html' } } };
  const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const asked: any[] = [];
  let answer: any = { canceled: false, filePath: join(saved, 'chausar-diagnostics-2026-11-06.json') };
  const deps = { window, assertTrustedSender, publicError, documents: saved, sources: diagnosticSources(user), dumpsFolder: dumps, version: '0.1.1', platform: 'win32', now: () => '2026-11-06T10:00:00.000Z',
    dialog: { showSaveDialog: async (_window: unknown, options: unknown) => { asked.push(options); return answer; } } };
  return { root, user, dumps, saved, own, deps, asked, setAnswer: (value: unknown) => { answer = value; } };
}

test('the preview lists each file with its size and the full text; Save writes exactly that text', async t => {
  const { own, deps, saved, asked } = await setup(t);
  const exporter = createDiagnosticsExport();
  const reply = await exporter.preview(own, { dumps: false }, deps);
  assert.equal(reply.ok, true, JSON.stringify(reply.error));
  const { id, files, dumps, text, bytes } = reply.result;
  assert.deepEqual(files.map((file: any) => file.name), ['startup.jsonl', 'rpc.jsonl', 'custody-diagnostics.jsonl']);
  assert.equal(files[0].bytes, Buffer.byteLength('{"phase":"app-ready","ms":1}\n'));
  assert.deepEqual(dumps, []);
  assert.equal(bytes, Buffer.byteLength(text));
  const bundle = JSON.parse(text);
  assert.equal(bundle.format, 'chausar.diagnostics.v1');
  assert.equal(bundle.version, '0.1.1');
  assert.equal(bundle.files[1].text, '{"method":"workspace.status","ms":3}\n');
  assert.equal(bundle.dumps.length, 0);
  assert.equal(text.includes(deps.dumpsFolder), false, 'no path on this computer');

  const saving = await exporter.save(own, { id }, deps);
  assert.deepEqual([saving.ok, saving.result.saved, saving.result.name], [true, true, 'chausar-diagnostics-2026-11-06.json']);
  assert.match(saving.result.line, /did not send it anywhere/);
  assert.equal(await readFile(join(saved, 'chausar-diagnostics-2026-11-06.json'), 'utf8'), text, 'the saved file equals the previewed text');
  assert.match(asked[0].defaultPath, /chausar-diagnostics-2026-11-06\.json$/);
});

test('crash files go in only when ticked, as names and sizes on screen and their bytes in the file', async t => {
  const { own, deps, saved, dumps } = await setup(t);
  const exporter = createDiagnosticsExport();
  const without = await exporter.preview(own, { dumps: false }, deps);
  assert.equal(without.result.text.includes('AQIDBA'), false);
  assert.equal(without.result.dumpsThere, 1, 'the page knows there is one to tick');
  const ticked = await exporter.preview(own, { dumps: true }, deps);
  assert.deepEqual(ticked.result.dumps, [{ name: 'a1.dmp', bytes: 4 }]);
  assert.equal(JSON.parse(ticked.result.text).dumps[0].base64, 'AQIDBA==');
  assert.equal(ticked.result.leftOut, 0);
  await exporter.save(own, { id: ticked.result.id }, deps);
  assert.equal(await readFile(join(saved, 'chausar-diagnostics-2026-11-06.json'), 'utf8'), ticked.result.text);
  // Only the newest crash files that fit go in; the rest are counted.
  await writeFile(join(dumps, 'reports', 'old.dmp'), Buffer.alloc(MAX_DUMP_BYTES));
  await utimes(join(dumps, 'reports', 'old.dmp'), new Date(1000), new Date(1000));
  const capped = await exporter.preview(own, { dumps: true }, deps);
  assert.deepEqual(capped.result.dumps.map((dump: any) => dump.name), ['a1.dmp']);
  assert.equal(capped.result.leftOut, 1);
});

test('Save saves only the latest preview: an old or made-up id is refused and writes nothing; a cancel keeps the preview', async t => {
  const { own, deps, saved, setAnswer } = await setup(t);
  const exporter = createDiagnosticsExport();
  const first = await exporter.preview(own, { dumps: false }, deps);
  const second = await exporter.preview(own, { dumps: true }, deps);
  const old = await exporter.save(own, { id: first.result.id }, deps);
  assert.deepEqual([old.ok, old.error.code], [false, 'DIAGNOSTICS_PREVIEW_GONE']);
  assert.deepEqual(await readdir(saved), []);
  setAnswer({ canceled: true });
  assert.deepEqual(await exporter.save(own, { id: second.result.id }, deps), { ok: true, result: null });
  setAnswer({ canceled: false, filePath: join(saved, 'mine.json') });
  assert.equal((await exporter.save(own, { id: second.result.id }, deps)).result.name, 'mine.json');
  const again = await exporter.save(own, { id: second.result.id }, deps);
  assert.equal(again.error.code, 'DIAGNOSTICS_PREVIEW_GONE', 'once saved, a new preview is needed');
});

test('only the app window asks, naming nothing but the tick or the id', async t => {
  const { own, deps, saved } = await setup(t);
  const exporter = createDiagnosticsExport();
  const stranger = { sender: {}, senderFrame: own.senderFrame };
  assert.equal((await exporter.preview(stranger, { dumps: true }, deps)).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await exporter.save(stranger, { id: 'x' }, deps)).error.code, 'UNTRUSTED_SENDER');
  for (const bad of [{}, { dumps: 'yes' }, { dumps: true, path: 'C:/x' }, null, 'x']) assert.equal((await exporter.preview(own, bad, deps)).error.code, 'INVALID_REQUEST', JSON.stringify(bad));
  for (const bad of [{}, { id: 1 }, { id: 'x', path: 'C:/x.json' }, null]) assert.equal((await exporter.save(own, bad, deps)).error.code, 'INVALID_REQUEST', JSON.stringify(bad));
  assert.deepEqual(await readdir(saved), []);
});

test('a missing log or crash folder just leaves that row out', async t => {
  const { own, deps, user, dumps } = await setup(t);
  await rm(join(user, 'diagnostics'), { recursive: true });
  await rm(dumps, { recursive: true });
  const reply = await createDiagnosticsExport().preview(own, { dumps: true }, deps);
  assert.deepEqual(reply.result.files.map((file: any) => file.name), ['custody-diagnostics.jsonl']);
  assert.deepEqual([reply.result.dumps, reply.result.dumpsThere], [[], 0]);
});
