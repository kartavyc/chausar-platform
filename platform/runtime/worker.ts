import { Engine } from './engine.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodexCliHostGateway, type CodexCliHostDependencies } from './codex-cli-host.ts';
import { loadEngineKeychain, type EngineKeychainHostDependencies } from './engine-keychain-host.ts';
import { desktopSyncOptions } from './core-sync-jobs/desktop-sync.ts';
import { desktopJobOptions } from './core-sync-jobs/desktop-jobs.ts';

/** Verified host evidence is installed before the worker can announce readiness. */
export async function createWorkerEngine(environment: NodeJS.ProcessEnv = process.env, dependencies: CodexCliHostDependencies & EngineKeychainHostDependencies = {}): Promise<Engine> {
  const demo = environment.CHAUSAR_DEMO === '1';
  const gateway = demo ? undefined : await loadCodexCliHostGateway(environment, dependencies);
  const keychain = demo ? undefined : await loadEngineKeychain(environment, dependencies, demo);
  const directory = resolve(environment.CHAUSAR_VAULT_DIRECTORY ?? './data');
  // TR-07: an enrolled computer gets its device key and pen admission; sync stays off until the owner turns it on.
  const sync = await desktopSyncOptions(directory, demo);
  // WK-11: typed jobs and calendar rules, so month-end jobs run in the installed app.
  const { durableJobs, jobCalendar } = desktopJobOptions(environment);
  return new Engine({ version: environment.CHAUSAR_ENGINE_VERSION, directory, demo, storage: demo ? 'experimental-file' : 'postgres', postgresUrl: environment.CHAUSAR_POSTGRES_URL, pythonExecutable: environment.CHAUSAR_PYTHON, updatePublicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs, jobCalendar, gateway, keychain, ...(sync ? { sync } : {}) });
}

/** Trusted host entry point. Tests can inject an Engine fixture, never a renderer or RPC. */
export function runEngineWorker(engine: Engine) {
  const scheduler = setInterval(() => { void engine.tick().catch(error => reply({ kind: 'scheduler-error', code: (error as any).code ?? 'JOB_SCHEDULER_FAILED' })); }, 30000); scheduler.unref();
  function reply(value: unknown) { if (process.connected) process.send?.(value as any, () => {}); }
  // core-sync-jobs (round 4): live refresh. A workspace change reaches the desktop as a bare sequence number, at most one
  // message per 250 ms; the renderer then asks `events.subscribe` what it may see.
  let pushedAt = 0, push: NodeJS.Timeout | null = null;
  const stopEvents = engine.events.on(() => {
    if (push) return;
    push = setTimeout(() => { push = null; pushedAt = Date.now(); reply({ kind: 'engine-event', seq: engine.events.seq }); }, Math.max(0, pushedAt + 250 - Date.now()));
    push.unref();
  });
  process.on('message', async (message: any) => {
    if (message?.kind === 'host-lifecycle') {
      try { engine.updateJobLifecycle(message.state); reply({ id: message.id, kind: 'host-lifecycle', applied: true, result: { applied: true } }); }
      catch (error) { reply({ id: message.id, kind: 'host-lifecycle', applied: false, error: { code: (error as any).code ?? 'INVALID_JOB_LIFECYCLE', message: (error as Error).message } }); }
      return;
    }
    if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
    try { reply({ id: message.id, result: await engine.request(message.method, message.payload) }); }
    catch (error) { const e = error as Error & { code?: string }; reply({ id: message.id, error: { code: e.code ?? 'REQUEST_FAILED', message: e.message } }); }
  });
  let stopping = false;
  function stop() { if (stopping) return; stopping = true; clearInterval(scheduler); stopEvents(); if (push) clearTimeout(push); void engine.shutdown().then(() => process.exit(0), () => process.exit(1)); }
  process.on('disconnect', stop);
  process.on('SIGTERM', stop);
  reply({ ready: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runEngineWorker(await createWorkerEngine());
