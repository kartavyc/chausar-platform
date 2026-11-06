// D5 task 5: a contents check that reads a packaged build and never runs it. The archive's file list comes from the
// asar header itself (its size words, then the JSON header), so nothing is extracted. The stand-in builds here are made
// at run time: a tiny archive in the same layout, locale files, the unpacked Agent SDK folders and a Codex manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/package-contents.mjs', import.meta.url));
const modulePath = '../../scripts/package-contents.mjs';
const { readPackageContents, readAsarFileList } = await import(modulePath);

/** An asar archive as @electron/asar writes one: UInt32 4, UInt32 header pickle size, then the pickled JSON header. */
function asar(files: Record<string, string>): Buffer {
  const tree: any = { files: {} };
  let offset = 0;
  const bodies: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/');
    let node = tree;
    for (const part of parts.slice(0, -1)) node = (node.files[part] ??= { files: {} });
    const body = Buffer.from(text);
    node.files[parts.at(-1)!] = { size: body.length, offset: String(offset) };
    offset += body.length;
    bodies.push(body);
  }
  const json = Buffer.from(JSON.stringify(tree));
  const padded = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + padded);
  header.writeUInt32LE(4 + padded, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  return Buffer.concat([size, header, ...bodies]);
}

type Build = { locales?: string[]; archive?: Record<string, string>; anthropic?: string[]; codex?: string | null; bundle?: string[] };
const CLEAN: Required<Build> = {
  locales: ['en-GB.pak', 'en-US.pak', 'hi.pak'],
  archive: { 'app/ui/dist/index.html': '<!doctype html>', 'app/ui/dist/assets/index.js': 'x', 'app/desktop/main.cjs': 'x', 'package.json': '{}' },
  anthropic: ['claude-agent-sdk'],
  codex: '0.166.0',
  // D7: the engine bundle, unpacked.
  bundle: ['runtime/worker.js', 'runtime/engine-paths-x.js', 'engine-manifest.json'],
};

async function build(t: any, overrides: Build = {}) {
  const spec = { ...CLEAN, ...overrides };
  const root = await mkdtemp(join(tmpdir(), 'chausar-contents-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'locales'));
  for (const name of spec.locales) await writeFile(join(root, 'locales', name), 'pak');
  await writeFile(join(root, 'Chausar.exe'), Buffer.alloc(2048));
  await mkdir(join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai'), { recursive: true });
  await mkdir(join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@duckdb', 'node-api'), { recursive: true });
  await writeFile(join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@duckdb', 'node-api', 'index.js'), 'duck');
  for (const name of spec.anthropic) {
    await mkdir(join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', name), { recursive: true });
    await writeFile(join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', name, 'package.json'), '{}');
  }
  for (const file of spec.unpackedExtra ?? []) {
    const path = join(root, 'resources', 'app.asar.unpacked', ...file.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'x');
  }
  await writeFile(join(root, 'resources', 'app.asar'), asar(spec.archive));
  for (const file of spec.bundle) {
    const path = join(root, 'resources', 'app.asar.unpacked', 'app', 'engine', 'dist', ...file.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'bundle');
  }
  if (spec.codex !== null) {
    await mkdir(join(root, 'resources', 'codex'), { recursive: true });
    await writeFile(join(root, 'resources', 'codex', 'BUNDLE.json'), JSON.stringify({ version: spec.codex }));
  }
  return root;
}

test('the archive file list is read from its own header, nothing extracted', async t => {
  const root = await build(t);
  assert.deepEqual((await readAsarFileList(join(root, 'resources', 'app.asar'))).sort(), Object.keys(CLEAN.archive).sort());
  await writeFile(join(root, 'resources', 'broken.asar'), Buffer.from([1, 2, 3]));
  await assert.rejects(readAsarFileList(join(root, 'resources', 'broken.asar')), /not an asar archive/);
});

test('a clean build has no problems and reports the size of each piece', async t => {
  const contents = await readPackageContents(await build(t), { mode: 'beta' });
  assert.deepEqual(contents.problems, []);
  assert.deepEqual(contents.locales, ['en-GB.pak', 'en-US.pak', 'hi.pak']);
  assert.deepEqual(contents.anthropic, ['claude-agent-sdk']);
  assert.equal(contents.codexVersion, '0.166.0');
  assert.equal(contents.archive.files, 4);
  for (const piece of ['codex', 'electron', '@anthropic-ai', '@duckdb', 'locales', 'app.asar.unpacked/platform', 'app.asar', 'app/engine/dist']) assert.equal(typeof contents.sizes[piece], 'number', piece);
  assert.equal(contents.sizes.locales, 9);
  assert.ok(contents.totalBytes > 2048);
  assert.equal(contents.fileCount, 11);
  assert.equal(contents.sizes['app/engine/dist'], 18);
});

test('each problem is named', async t => {
  const cases: [Build, RegExp][] = [
    [{ unpackedExtra: ['platform/runtime/worker.ts'] }, /engine source ships: platform\/runtime\/worker\.ts/],
    [{ archive: { ...CLEAN.archive, 'platform/runtime/engine.ts': 'x' } }, /engine source ships: platform\/runtime\/engine\.ts/],
    [{ archive: { ...CLEAN.archive, 'platform/runtime/venture/models/credential-contract.cjs': 'x', 'platform/helpers/analytics.py': 'x' } }, /engine source ships: platform\/helpers\/analytics\.py/],
    [{ locales: [...CLEAN.locales, 'ta.pak'] }, /locale ta is not one of en-US, en-GB, hi/],
    [{ locales: ['en-US.pak', 'hi.pak'] }, /locale en-GB is missing/],
    [{ anthropic: ['claude-agent-sdk', 'claude-agent-sdk-win32-x64'] }, /Claude Code program file: claude-agent-sdk-win32-x64/],
    [{ archive: { ...CLEAN.archive, 'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude': 'x' } }, /Claude Code program file: claude-agent-sdk-linux-x64-musl/],
    [{ anthropic: [] }, /the Agent SDK is missing/],
    [{ archive: { 'app/desktop/main.cjs': 'x' } }, /the Ink build \(app\/ui\/dist\/index\.html\) is missing/],
    [{ archive: { ...CLEAN.archive, 'app/ui/src/main.tsx': 'x' } }, /Ink source in the archive: app\/ui\/src\/main\.tsx/],
    [{ codex: '0.154.0' }, /Codex 0\.154\.0, not 0\.166\.0/],
    [{ codex: null }, /the bundled Codex is missing/],
    [{ bundle: ['engine-manifest.json'] }, /the engine bundle's worker \(app\/engine\/dist\/runtime\/worker\.js\) is not unpacked/],
    [{ bundle: [...CLEAN.bundle, 'runtime/worker.js.map'] }, /a source map ships: app\/engine\/dist\/runtime\/worker\.js\.map/],
  ];
  for (const [overrides, expected] of cases) {
    const contents = await readPackageContents(await build(t, overrides), { mode: 'beta' });
    assert.equal(contents.problems.length, 1, JSON.stringify(contents.problems));
    assert.match(contents.problems[0], expected);
  }
  // The preview carries no Codex, and that is right.
  assert.deepEqual((await readPackageContents(await build(t, { codex: null }), { mode: 'preview' })).problems, []);
});

test('the command line prints the problems and exits 1, or 0 with --json for a clean build', async t => {
  const clean = spawnSync(process.execPath, [SCRIPT, await build(t), '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).problems, []);
  const bad = spawnSync(process.execPath, [SCRIPT, await build(t, { locales: ['de.pak'] })], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /locale de is not one of/);
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', windowsHide: true });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /Usage/);
});

// Found on the first real beta --dir build: package-contents.mjs imported desktop-package.mjs, whose command line is a
// top-level await, so packageDesktop's own import of package-contents.mjs waited on itself and Node exited (code 13)
// before the receipt. The shared rule lives in package-trim.mjs, and nothing packageDesktop imports reaches back.
test('package-contents.mjs never imports desktop-package.mjs, so packaging cannot wait on itself', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(SCRIPT, 'utf8');
  assert.doesNotMatch(text, /from '\.\/desktop-package\.mjs'|import\('\.\/desktop-package\.mjs'\)/);
  const trim = await readFile(new URL('../../scripts/package-trim.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(trim, /^import /m, 'the shared rule imports nothing');
});
