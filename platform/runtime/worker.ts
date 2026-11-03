import { Engine } from './engine.ts';
import { engineJobOptions } from './engine-jobs.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodexCliHostGateway, type CodexCliHostDependencies } from './codex-cli-host.ts';
import { ventureHostEnv } from './venture/host-env.ts';
import { processPrintPort } from './venture/playbooks/kit/report/pdf.ts';
import { processFormsPort } from './venture/build/form-fill-port.ts';
import { workspaceCustodyEnv } from './workspace-custody.ts';
import { processCredentialPort } from './venture/models/credential-port.ts';
import { processRenderPort } from './venture/web/render-port.ts';
import { processFlowPort } from './venture/flows/port.ts';
import { createPhoneAccess } from './phone-access.ts';
import { INK_ROOT, listInkFiles } from './ui-ink.ts';
import { ownerError } from './owner-error.ts';

/** Verified host evidence is installed before the worker can announce readiness. */
export async function createWorkerEngine(environment: NodeJS.ProcessEnv = process.env, dependencies: CodexCliHostDependencies = {}): Promise<Engine> {
  const gateway = await loadCodexCliHostGateway(environment, dependencies);
  // W6 6F7: the phone listener starts only when the owner makes a pairing link in the app.
  let engine: Engine | null = null;
  const phoneAccess = createPhoneAccess(() => engine!, { ink: async () => ({ folder: INK_ROOT, files: await listInkFiles(INK_ROOT) }) });
  return engine = new Engine({ version: environment.CHAUSAR_ENGINE_VERSION, directory: environment.CHAUSAR_VAULT_DIRECTORY ?? './data', demo: environment.CHAUSAR_DEMO === '1', storage: 'experimental-file', pythonExecutable: environment.CHAUSAR_PYTHON, updatePublicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs: engineJobOptions(environment), gateway, workspaceCustody: workspaceCustodyEnv(environment), venture: { ...ventureHostEnv(environment, { demo: environment.CHAUSAR_DEMO === '1', host: 'desktop' }), ...(gateway?.codexCli ? { codexCli: gateway.codexCli, hostProcess: gateway.process } : {}),
    // Ink v2 wave 5 (5A5): a report's PDF is printed by the desktop main process, asked over this worker's own channel.
    ...(typeof process.send === 'function' ? { print: processPrintPort(process), formsBrowser: processFormsPort(process), credentials: processCredentialPort(process),
      // Wave 6 (6F3): pages that need JavaScript are read in the desktop's hidden window (web-render.cjs).
      webRender: processRenderPort(process),
      // Wave 6 (6H2): recorded flows run in the desktop's flow window (flow-browser.cjs).
      flowBrowser: processFlowPort(process) } : {}),
    phoneAccess } });
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
    // Only Chausar's own refusals keep their words; an engine bug never shows its source text (owner-error.ts).
    catch (error) { reply({ id: message.id, error: ownerError(error) }); }
  });
  let stopping = false;
  function stop() { if (stopping) return; stopping = true; clearInterval(scheduler); void engine.shutdown().then(() => process.exit(0), () => process.exit(1)); }
  process.on('disconnect', stop);
  process.on('SIGTERM', stop);
  reply({ ready: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runEngineWorker(await createWorkerEngine());
