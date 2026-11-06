// D7 task 4: the engine bundle the packaged app runs. rolldown (the version Vite installs, pinned in package.json)
// bundles the engine's entries from platform/runtime into app/engine/dist/runtime: ESM for Node, every bare and node:
// import left outside (so no npm package is inlined and NOTICE stays true), shared chunks flat at that root (so
// engine-paths.ts resolves the same layout as from source), nothing minified (stack traces stay readable and the AGPL
// source recognisable). Source maps go to app/engine/maps, outside the shipped folder. The files the engine finds by
// path (engine-paths.ts) are copied as they are. It empties only its own output folder.
// `node scripts/bundle-engine.mjs [--out <dir>]`
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lazyRequirePlugin } from './engine-lazy-require.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(projectRoot, 'platform', 'runtime');

/** The programs the packaged app starts or imports by path, by their name under runtime/ (without .ts). */
export const ENGINE_ENTRIES = Object.freeze([
  'worker',
  'engine-paths', // stable named exports for the packaged runtime's path contract
  'venture/agent-runtime/stdio-bridge',
  'analytics-worker',
  'venture/network/extract-worker',
  'venture/playbooks/youtube/project-folder',
]);
/** Files the engine finds by path, copied as they are: [from, under platform/runtime or platform/; to, under out]. */
export const ENGINE_ASSETS = Object.freeze([
  { from: 'platform/runtime/wasm-worker.mjs', to: 'runtime/wasm-worker.mjs' },
  { from: 'platform/runtime/venture/packs/pack-worker.mjs', to: 'runtime/venture/packs/pack-worker.mjs' },
  { from: 'platform/runtime/venture/models/credential-contract.cjs', to: 'runtime/venture/models/credential-contract.cjs' },
  { from: 'platform/runtime/venture/core/guide-data.json', to: 'runtime/venture/core/guide-data.json' },
  { from: 'platform/helpers/analytics.py', to: 'helpers/analytics.py' },
  // Every judge and playbook baseline folder (venture/**/baselines/*.json), found when bundling.
  { baselines: true },
]);

const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

async function baselineFolders(folder = RUNTIME) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(folder, entry.name);
    if (entry.name === 'baselines') found.push(path);
    else found.push(...await baselineFolders(path));
  }
  return found;
}

// "Am I the entry": process.argv[1] compared with import.meta.url.
const ENTRY_CHECK = /process\.argv\[1\][^\n]*import\.meta\.url|import\.meta\.url[^\n]*process\.argv\[1\]/;

/** A module id as its path under platform/runtime with forward slashes, or null for anything else. */
function runtimeName(root, moduleId) {
  const rel = relative(join(root, 'platform', 'runtime'), moduleId);
  return rel.startsWith('..') || isAbsolute(rel) ? null : rel.replace(/\\/g, '/');
}

/** The chunk a module must sit in on its own, or null to let rolldown place it. */
export function chunkGroupOf(name, selfStarting) {
  if (name === 'engine-paths.ts') return 'engine-paths';
  return name && selfStarting.has(name) ? `self-${name.replace(/\.ts$/, '').replace(/[^A-Za-z0-9]+/g, '-')}` : null;
}

/**
 * Engine modules that start themselves when run directly but are not bundle entries (server.ts, hosted/server.ts).
 * Merged into an entry's chunk, their check would see that entry's own URL and run: the first bundle's worker started
 * the local server. Each is kept in a chunk of its own, whose URL is never the program's.
 */
export async function selfStartingModules(root = projectRoot) {
  const runtime = join(root, 'platform', 'runtime');
  const entries = new Set(ENGINE_ENTRIES.map(name => `${name}.ts`));
  const found = [];
  for (const entry of await readdir(runtime, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name), name = runtimeName(root, path);
    if (!entries.has(name) && ENTRY_CHECK.test(await readFile(path, 'utf8'))) found.push(name);
  }
  return found.sort();
}

async function sizeOf(folder) {
  let bytes = 0, files = 0;
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
  }
  return { bytes, files };
}

/** Bundles the engine into out (default app/engine/dist) and its maps into maps (default: maps beside out, app/engine/maps). */
export async function bundleEngine({ root = projectRoot, out = join(root, 'app', 'engine', 'dist'), maps } = {}) {
  out = resolve(out); maps = resolve(maps ?? join(dirname(out), 'maps'));
  if (out === resolve(root) || inside(out, resolve(root)) || resolve(root, 'platform') === out || inside(resolve(root, 'platform'), out)) throw new Error('the engine bundle never writes over the checkout or the engine source');
  const { rolldown, VERSION } = await import('rolldown');
  await rm(out, { recursive: true, force: true });
  await rm(maps, { recursive: true, force: true });
  const runtime = join(out, 'runtime');
  const selfStarting = new Set(await selfStartingModules(root));
  const input = Object.fromEntries(ENGINE_ENTRIES.map(name => [name, join(root, 'platform', 'runtime', `${name}.ts`)]));
  const bundle = await rolldown({
    input,
    preserveEntrySignatures: 'strict',
    platform: 'node',
    // Every bare package name and every node: import stays an import: nothing from node_modules is inlined.
    external: (id, _importer, isResolved) => !isResolved && !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('\0'),
    // D7 task 2: the engine's lazy loads become require() calls rolldown follows and runs on first use.
    plugins: [lazyRequirePlugin()],
    // A dynamic import of a module others import statically stays in its chunk; that is expected here, so not printed.
    onLog(level, log, handler) { if (log.code !== 'INEFFECTIVE_DYNAMIC_IMPORT') handler(level, log); },
  });
  let output;
  try {
    ({ output } = await bundle.write({
      dir: runtime, format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js', sourcemap: 'hidden', minify: false,
      // engine-paths.ts resolves the runtime root from its own place, so it is always a chunk at that root; each
      // self-starting module keeps a chunk of its own (selfStartingModules).
      codeSplitting: { groups: [{ debugName: 'engine-paths and self-starting modules', name: moduleId => chunkGroupOf(runtimeName(root, moduleId), selfStarting) }] },
    }));
  } finally { await bundle.close(); }
  const modules = [...new Set(output.filter(item => item.type === 'chunk').flatMap(chunk => chunk.moduleIds ?? Object.keys(chunk.modules ?? {})))];
  // Maps out of the shipped folder.
  await mkdir(maps, { recursive: true });
  for (const item of output) {
    if (!item.fileName.endsWith('.map')) continue;
    const target = join(maps, item.fileName);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(runtime, item.fileName), target);
    await rm(join(runtime, item.fileName));
  }
  for (const asset of ENGINE_ASSETS) {
    if (asset.baselines) {
      for (const folder of await baselineFolders(join(root, 'platform', 'runtime'))) {
        await cp(folder, join(runtime, relative(join(root, 'platform', 'runtime'), folder)), { recursive: true });
      }
    } else {
      await mkdir(dirname(join(out, asset.to)), { recursive: true });
      await cp(join(root, asset.from), join(out, asset.to));
    }
  }
  const chunks = output.filter(item => item.type === 'chunk');
  const size = await sizeOf(out);
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false });
  const manifest = {
    schemaVersion: 1, entries: ENGINE_ENTRIES.map(name => `runtime/${name}.js`), chunks: chunks.length, bytes: size.bytes, files: size.files + 1,
    rolldown: VERSION, sourceCommit: git.status === 0 ? git.stdout.trim() : null, maps: 'app/engine/maps (not shipped)',
  };
  await writeFile(join(out, 'engine-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { out, maps, manifest, modules };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--out')) throw new Error('Use only the optional --out <dir> argument.');
    const { out, manifest } = await bundleEngine(args.length ? { out: args[1] } : {});
    console.log(`Engine bundled into ${out}: ${manifest.entries.length} entries, ${manifest.chunks} chunks, ${manifest.files} files, ${manifest.bytes} bytes (rolldown ${manifest.rolldown}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
