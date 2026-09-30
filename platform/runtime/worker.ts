import { Engine } from './engine.ts';
import { engineJobOptions } from './engine-jobs.ts';
const engine = new Engine({ version: process.env.CHAUSAR_ENGINE_VERSION, directory: process.env.CHAUSAR_VAULT_DIRECTORY ?? './data', demo: process.env.CHAUSAR_DEMO === '1', storage: process.env.CHAUSAR_DEMO === '1' ? 'experimental-file' : 'postgres', postgresUrl: process.env.CHAUSAR_POSTGRES_URL, pythonExecutable: process.env.CHAUSAR_PYTHON, updatePublicKey: process.env.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs: engineJobOptions(process.env) });
const scheduler = setInterval(() => { void engine.tick().catch(error => reply({ kind: 'scheduler-error', code: (error as any).code ?? 'JOB_SCHEDULER_FAILED' })); }, 30000); scheduler.unref();
function reply(value: unknown) { if (process.connected) process.send?.(value as any, () => {}); }
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
function stop() { if (stopping) return; stopping = true; clearInterval(scheduler); void engine.shutdown().then(() => process.exit(0), () => process.exit(1)); }
process.on('disconnect', stop);
process.on('SIGTERM', stop);
reply({ ready: true });
