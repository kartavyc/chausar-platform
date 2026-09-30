import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { createActivities } from './activities.ts';

async function main() {
  const coreUrl = process.env.CHAUSAR_CORE_URL;
  const serviceToken = process.env.CHAUSAR_INTERNAL_SERVICE_TOKEN;
  if (!coreUrl || !serviceToken) throw new Error('Core URL and internal service token are required');
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' });
  let worker: Worker | undefined;
  try {
    worker = await Worker.create({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'chausar-investigations',
      workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
      activities: createActivities({ coreUrl, serviceToken }),
    });
    let stopping = false;
    const shutdown = () => { if (!stopping) { stopping = true; worker!.shutdown(); } };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    try {
      const running = worker.run();
      process.send?.({ type: 'ready', component: 'runtime-worker' });
      await running;
    } finally {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    }
  } finally { await connection.close(); }
}

main().catch(() => {
  // No configuration, token, URL or raw request error is printed.
  console.error('Runtime worker failed; check runtime configuration and service availability');
  process.send?.({ type: 'failed', component: 'runtime-worker' });
  process.exitCode = 1;
});
