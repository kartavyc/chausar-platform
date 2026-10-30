import { Engine } from './engine.ts';
import { engineJobOptions } from './engine-jobs.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodexCliHostGateway, type CodexCliHostDependencies } from './codex-cli-host.ts';
import { ventureHostEnv } from './venture/host-env.ts';
import { processPrintPort } from './venture/playbooks/kit/report/pdf.ts';
import { processFormsPort } from './venture/build/form-fill-port.ts';
import { workspaceCustodyEnv } from './workspace-custody.ts';

/** Verified host evidence is installed before the worker can announce readiness. */
export async function createWorkerEngine(environment: NodeJS.ProcessEnv = process.env, dependencies: CodexCliHostDependencies = {}): Promise<Engine> {
  const gateway = await loadCodexCliHostGateway(environment, dependencies);
  return new Engine({ version: environment.CHAUSAR_ENGINE_VERSION, directory: environment.CHAUSAR_VAULT_DIRECTORY ?? './data', demo: environment.CHAUSAR_DEMO === '1', storage: environment.CHAUSAR_DEMO === '1' ? 'experimental-file' : 'postgres', postgresUrl: environment.CHAUSAR_POSTGRES_URL, pythonExecutable: environment.CHAUSAR_PYTHON, updatePublicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs: engineJobOptions(environment), gateway, workspaceCustody: workspaceCustodyEnv(environment), venture: { ...ventureHostEnv(environment, { demo: environment.CHAUSAR_DEMO === '1', host: 'desktop' }), ...(gateway?.codexCli ? { codexCli: gateway.codexCli, hostProcess: gateway.process } : {}),
    // Ink v2 wave 5 (5A5): a report's PDF is printed by the desktop main process, asked over this worker's own channel.
    ...(typeof process.send === 'function' ? { print: processPrintPort(process), formsBrowser: processFormsPort(process) } : {}) } });
}

/** Trusted host entry point. Tests can inject an Engine fixture, never a renderer or RPC. */
export function runEngineWorker(engine: Engine) {
  const scheduler = setInterval(() => { void engine.tick().catch(error => reply({ kind: 'scheduler-error', code: (error as any).code ?? 'JOB_SCHEDULER_FAILED' })); }, 30000); scheduler.unref();
  function reply(value: unknown) { if (process.connected) process.send?.(value as any, () => {}); }
  // Run events for the Ink frontend: the desktop main process checks each one and forwards it to the window.
  engine.onVentureEvent(event => reply({ kind: 'venture-event', event }));
  process.on('message', async (message: any) => {
    if (message?.kind === 'host-lifecycle') {
      try { engine.updateJobLifecycle(message.state); reply({ id: message.id, kind: 'host-lifecycle', applied: true, result: { applied: true } }); }
      catch (error) { reply({ id: message.id, kind: 'host-lifecycle', applied: false, error: { code: (error as any).code ?? 'INVALID_JOB_LIFECYCLE', message: (error as Error).message } }); }
      return;
    }
    // Whether the owner is looking at the window (shown, not minimised, focused): a plain notice, no reply (4G1).
    if (message?.kind === 'host-watching') { engine.updateOwnerWatching(message.watching === true); return; }
    if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
    try { reply({ id: message.id, result: await engine.request(message.method, message.payload) }); }
    catch (error) {
      const e = error as Error & { code?: string; reason?: unknown };
      reply({ id: message.id, error: { code: e.code ?? 'REQUEST_FAILED', message: e.message, ...(typeof e.reason === 'string' && /^[a-z-]{1,32}$/.test(e.reason) ? { reason: e.reason } : {}) } });
    }
  });
  let stopping = false;
  function stop() { if (stopping) return; stopping = true; clearInterval(scheduler); void engine.shutdown().then(() => process.exit(0), () => process.exit(1)); }
  process.on('disconnect', stop);
  process.on('SIGTERM', stop);
  reply({ ready: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runEngineWorker(await createWorkerEngine());
