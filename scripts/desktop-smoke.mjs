import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineHarness } from '../app/desktop/engine-harness.cjs';

// Headless worker validation: no Electron window, browser, HTTP listener or vault creation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROGRAM = Object.freeze({ win32: 'Chausar.exe', linux: 'chausar' });

/**
 * D5 task 6: the packaged build's folder, checked: a folder that holds the packaged program (Chausar.exe, or chausar on
 * Linux). Shared with desktop-electron-smoke.mjs.
 */
export function packagedFolder(folder, platform = process.platform) {
  if (typeof folder !== 'string' || folder.length === 0 || folder.startsWith('--')) throw new Error('--packaged needs the unpacked build folder (release/beta/win-unpacked, say).');
  const directory = resolve(folder);
  let info;
  try { info = statSync(directory); } catch { info = null; }
  if (!info?.isDirectory()) throw new Error(`${directory} is not a folder.`);
  const name = PROGRAM[platform] ?? 'chausar';
  const program = join(directory, name);
  let found;
  try { found = statSync(program).isFile(); } catch { found = false; }
  if (!found) throw new Error(`${directory} has no ${name}; point --packaged at the unpacked build folder.`);
  return { folder: directory, program };
}

/** No option: the source worker under this Node. --packaged <dir>: the worker inside that build. */
export function parseSmokeArguments(args, { platform = process.platform } = {}) {
  if (args.length === 0) return { packaged: null, worker: join(root, 'platform/runtime/worker.ts'), packageJson: join(root, 'package.json') };
  if (args[0] !== '--packaged' || args.length > 2) throw new Error('Use only the optional --packaged <unpacked build folder> argument.');
  const { folder } = packagedFolder(args[1], platform);
  const unpacked = join(folder, 'resources', 'app.asar.unpacked');
  return { packaged: folder, worker: join(unpacked, 'app', 'engine', 'dist', 'runtime', 'worker.js'), packageJson: join(unpacked, 'package.json') };
}

async function smoke({ packaged, worker, packageJson }) {
  const metadata = JSON.parse(await readFile(packageJson, 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'chausar-desktop-smoke-'));
  const engine = new EngineHarness({ workerPath: worker, environment: { ...process.env, CHAUSAR_ENGINE_VERSION: metadata.version, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1', CHAUSAR_UPDATE_PUBLIC_KEY: '' } });
  try {
    await engine.start();
    const status = await engine.request('workspace.status');
    if (status.open !== false || status.experimental !== true || status.version !== metadata.version) throw new Error('The synthetic worker status is invalid.');
    const stopped = await engine.stop();
    if (!stopped.graceful) throw new Error('The worker did not shut down gracefully.');
    console.log(JSON.stringify({ ok: true, platform: process.platform, architecture: process.arch, node: process.versions.node, version: status.version, worker: 'synthetic-only', ...(packaged ? { packaged } : {}), gui: 'not-executed', gracefulShutdown: true }));
  } finally {
    await engine.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await smoke(parseSmokeArguments(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
