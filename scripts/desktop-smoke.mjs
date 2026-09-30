import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineHarness } from '../app/desktop/engine-harness.cjs';

// Headless worker validation: no Electron window, browser, HTTP listener or vault creation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'chausar-desktop-smoke-'));
const engine = new EngineHarness({ workerPath: join(root, 'platform/runtime/worker.ts'), environment: { ...process.env, CHAUSAR_ENGINE_VERSION: metadata.version, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1', CHAUSAR_UPDATE_PUBLIC_KEY: '' } });
try {
  await engine.start();
  const status = await engine.request('workspace.status');
  if (status.open !== false || status.experimental !== true || status.version !== metadata.version) throw new Error('The synthetic worker status is invalid.');
  const stopped = await engine.stop();
  if (!stopped.graceful) throw new Error('The worker did not shut down gracefully.');
  console.log(JSON.stringify({ ok: true, platform: process.platform, architecture: process.arch, node: process.versions.node, version: status.version, worker: 'synthetic-only', gui: 'not-executed', gracefulShutdown: true }));
} finally {
  await engine.stop();
  await rm(directory, { recursive: true, force: true });
}
