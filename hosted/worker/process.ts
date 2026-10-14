import type { Worker } from '../db/queue.ts';
import type { HostedModule } from '../shared/module.ts';

export const SWEEP_EVERY_MS = 60000;
const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * The always-on worker process: runs queued jobs until `signal` aborts and calls every module's `sweep()`
 * about once a minute. Register each module's `jobs(worker)` before calling this. A failing sweep is reported
 * to `onError` (with its fixed code only) and never stops the others or the loop.
 */
export async function runWorkerProcess(input: { worker: Worker; modules: readonly HostedModule[]; signal: AbortSignal; sweepEveryMs?: number; idleMs?: number; onError?: (moduleId: string, code: string) => void }): Promise<void> {
  const { worker, modules, signal } = input;
  async function sweeping() {
    while (!signal.aborted) {
      for (const module of modules) {
        if (!module.sweep || signal.aborted) continue;
        try { await module.sweep(); }
        catch (error: any) { input.onError?.(module.id, typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : 'SWEEP_FAILED'); }
      }
      await pause(input.sweepEveryMs ?? SWEEP_EVERY_MS, signal);
    }
  }
  await Promise.all([worker.loop(signal, input.idleMs), sweeping()]);
}
