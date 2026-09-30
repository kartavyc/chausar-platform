import { Engine } from './engine.ts';
const engine = new Engine({ directory: process.env.CHAUSAR_VAULT_DIRECTORY ?? './data', demo: process.env.CHAUSAR_DEMO === '1', storage: process.env.CHAUSAR_DEMO === '1' ? 'experimental-file' : 'postgres', postgresUrl: process.env.CHAUSAR_POSTGRES_URL, pythonExecutable: process.env.CHAUSAR_PYTHON, updatePublicKey: process.env.CHAUSAR_UPDATE_PUBLIC_KEY });
const scheduler = setInterval(() => { void engine.tick(); }, 30000); scheduler.unref();
function reply(value: unknown) { if (process.connected) process.send?.(value as any, () => {}); }
process.on('message', async (message: any) => {
  if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
  try { reply({ id: message.id, result: await engine.request(message.method, message.payload) }); }
  catch (error) { const e = error as Error & { code?: string }; reply({ id: message.id, error: { code: e.code ?? 'REQUEST_FAILED', message: e.message } }); }
});
let stopping = false;
function stop() { if (stopping) return; stopping = true; clearInterval(scheduler); void engine.shutdown().then(() => process.exit(0), () => process.exit(1)); }
process.on('disconnect', stop);
process.on('SIGTERM', stop);
reply({ ready: true });
