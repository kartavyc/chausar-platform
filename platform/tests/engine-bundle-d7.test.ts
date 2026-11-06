// D7 task 4: the engine bundle. It bundles into a fresh folder under app/engine (git-ignored, removed after; inside the
// checkout so the bundled worker finds the packages in node_modules, as the packaged one finds app.asar.unpacked's), then checks: every entry is there, nothing from
// node_modules was inlined, every file the engine finds by path was copied, the founder's model ids survived, no map
// ships, and the bundled worker started by EngineHarness with plain Node answers and stops gracefully. Slow tier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const modulePath = '../../scripts/bundle-engine.mjs';
const { bundleEngine, ENGINE_ENTRIES } = await import(modulePath);
const { EngineHarness } = createRequire(import.meta.url)('../../app/desktop/engine-harness.cjs');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

await mkdir(join(ROOT, 'app', 'engine'), { recursive: true });
const folder = await mkdtemp(join(ROOT, 'app', 'engine', 'bundle-test-'));
test.after(() => rm(folder, { recursive: true, force: true }));
const out = join(folder, 'dist'), maps = join(folder, 'maps');
const built = await bundleEngine({ out, maps });
const runtime = join(out, 'runtime');

async function allFiles(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
}

test('the manifest lists every entry, and each exists', async () => {
  const manifest = JSON.parse(await readFile(join(out, 'engine-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.entries, ENGINE_ENTRIES.map((name: string) => `runtime/${name}.js`));
  for (const entry of manifest.entries) assert.ok(existsSync(join(out, entry)), entry);
  assert.equal(manifest.rolldown, '1.2.16');
  assert.ok(manifest.chunks >= ENGINE_ENTRIES.length);
  assert.ok(manifest.bytes > 1_000_000);
});

test('nothing from node_modules is inlined: every package stays an import', () => {
  assert.ok(built.modules.length > 500, `${built.modules.length} engine modules`);
  assert.deepEqual(built.modules.filter((id: string) => /node_modules/.test(id)), []);
  assert.deepEqual(built.modules.filter((id: string) => !/[\\/]platform[\\/]runtime[\\/]/.test(id) && !id.startsWith('\0')), []);
});

test('every file the engine finds by path is in the bundle at the same place, and no map ships', async () => {
  for (const file of ['wasm-worker.mjs', 'venture/core/guide-data.json', 'venture/packs/pack-worker.mjs', 'venture/models/credential-contract.cjs', 'venture/delivery/judge/baselines', 'venture/playbooks/social/baselines', 'venture/playbooks/youtube/baselines', 'venture/playbooks/ca-firm/baselines', 'analytics-worker.js', 'venture/agent-runtime/stdio-bridge.js']) {
    assert.ok(existsSync(join(runtime, file)), file);
  }
  assert.ok(existsSync(join(out, 'helpers', 'analytics.py')));
  const shipped = await allFiles(out);
  assert.deepEqual(shipped.filter(file => file.endsWith('.map')), []);
  assert.ok((await allFiles(maps)).some(file => file.endsWith('.map')), 'the maps are kept beside, outside the shipped folder');
  assert.deepEqual(shipped.filter(file => file.endsWith('.ts')), [], 'no TypeScript source ships');
  // The local server's own start check never shares the worker's chunk (the first bundle's worker started the server).
  const { selfStartingModules } = await import(modulePath);
  assert.deepEqual(await selfStartingModules(), ['hosted/server.ts', 'server.ts']);
  assert.ok((await readdir(runtime)).some(name => /^self-server-.*\.js$/.test(name)));
  // engine-paths is a chunk at the runtime root, so it resolves the same layout as from source.
  assert.ok((await readdir(runtime)).some(name => /^engine-paths-.*\.js$/.test(name)));
});

test('the founder\'s model ids survived the bundle', async () => {
  const text = (await Promise.all((await allFiles(runtime)).filter(file => file.endsWith('.js')).map(file => readFile(file, 'utf8')))).join('\n');
  assert.match(text, /gpt-6-luna/);
  assert.match(text, /gpt-6\.1-terra/);
});

test('the bundled worker, started by EngineHarness with plain Node, answers and stops gracefully', { timeout: 120_000 }, async () => {
  const vault = await mkdtemp(join(tmpdir(), 'chausar-engine-bundle-vault-'));
  // Desktop main always names the Ink build for the packaged worker (CHAUSAR_INK_ROOT); a stand-in build here.
  const ink = await mkdtemp(join(tmpdir(), 'chausar-engine-bundle-ink-'));
  await writeFile(join(ink, 'index.html'), '<!doctype html><title>Chausar</title>');
  const engine = new EngineHarness({ workerPath: join(runtime, 'worker.js'), environment: { ...process.env, CHAUSAR_ENGINE_VERSION: pkg.version, CHAUSAR_VAULT_DIRECTORY: vault, CHAUSAR_INK_ROOT: ink, CHAUSAR_DEMO: '1', CHAUSAR_UPDATE_PUBLIC_KEY: '' }, startupTimeoutMs: 60_000 });
  try {
    await engine.start();
    const status = await engine.request('workspace.status');
    assert.equal(status.version, pkg.version);
    assert.equal(status.open, false);
    // Every playbook, as from source: this reads the lazily loaded kit definitions (engine-lazy-require.mjs).
    const { PLAYBOOK_DEFINITIONS } = await import('../runtime/venture/playbooks/definitions.ts');
    const list = await engine.request('venture.playbooks.list', {});
    assert.ok(Array.isArray(list.ways) && list.ways.length >= PLAYBOOK_DEFINITIONS.length, `${list.ways?.length} ways`);
    const stopped = await engine.stop();
    assert.equal(stopped.graceful, true);
  } finally {
    await engine.stop();
    await rm(vault, { recursive: true, force: true });
    await rm(ink, { recursive: true, force: true });
  }
});

// D7 fix (review 1, MEDIUM 4): the bundle's own engine-paths chunk names the bundled .js entries, which exist, and finds
// the files copied beside them; were it to think it runs from source, it would name .ts files the package does not hold.
test('D7 fix: the bundled engine-paths chunk starts its bundled .js entries and finds its copied files', async () => {
  const chunk = (await readdir(runtime)).find(name => /^engine-paths-.*\.js$/.test(name))!;
  const exported = Object.values(await import(pathToFileURL(join(runtime, chunk)).href)) as unknown[];
  const named = (name: string) => exported.find(value => typeof value === 'function' && value.name === name) as ((path: string) => string) | undefined;
  const runtimeEntry = named('runtimeEntry'), runtimeFile = named('runtimeFile');
  assert.ok(runtimeEntry && runtimeFile, 'the chunk exports runtimeEntry and runtimeFile');
  // The chunk's body runs lazily: its importers call its one other export (rolldown's init) first, so the test does too.
  const helpers = new Set(['runtimeUrl', 'runtimeFile', 'runtimeEntry']);
  for (const value of exported) if (typeof value === 'function' && !helpers.has(value.name)) value();
  for (const name of ['analytics-worker', 'venture/agent-runtime/stdio-bridge']) {
    const entry = runtimeEntry(name);
    assert.equal(entry, join(runtime, `${name}.js`), `${name}: the bundled .js, never the source .ts`);
    assert.ok(existsSync(entry), entry);
  }
  for (const file of ['../helpers/analytics.py', 'wasm-worker.mjs', 'venture/packs/pack-worker.mjs', 'venture/models/credential-contract.cjs']) assert.ok(existsSync(runtimeFile(file)), file);
});

test('the bundled MCP bridge and DuckDB worker load as programs', () => {
  for (const entry of ['venture/agent-runtime/stdio-bridge.js', 'analytics-worker.js']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL(`file:///${join(runtime, entry).replace(/\\/g, '/')}`).href)})`], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.equal(result.status, 0, `${entry}: ${result.stderr}`);
  }
});
