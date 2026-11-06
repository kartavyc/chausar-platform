/** Request-scoped developer capture. No environment switch and no shared mutable replay cursor. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertCaptureText, type RunRecorder } from './capture.ts';
import type { RunReplay } from './replay-run.ts';

export type RunScope = { recorder?: RunRecorder; replay?: RunReplay; failure?: unknown; owner?: object; checks?: (() => void)[]; pending?: Set<Promise<unknown>>; tools?: Map<number, (request: unknown, session: string) => Promise<unknown>>; guards?: Map<number, () => void>; timerCount?: number; driver?: 'codex' | 'claude' };
const scope = new AsyncLocalStorage<RunScope>();
export const inRun = <T>(run: RunScope, work: () => T): T => scope.run(run, work);
export const currentRun = () => scope.getStore();
export function finishRun(run: RunScope) {
  if (run.failure) throw run.failure;
  for (const check of run.checks ?? []) check();
}
export function runClock(clock: () => Date = () => new Date()): Date {
  const run = scope.getStore();
  if (run?.replay) return new Date(run.replay.now());
  const value = clock();
  if (run?.recorder) run.recorder.clock(value.toISOString());
  return value;
}
export async function runExchange<T>(purpose: string, request: unknown, work: () => Promise<T>): Promise<T> {
  const run = scope.getStore();
  if (!run) return work();
  try {
    const text = JSON.stringify(request);
    assertCaptureText(text);
    if (run.replay) return JSON.parse(run.replay.model(purpose, text)) as T;
    // Validate the request before allowing the operation to run. No headers or environment enter model captures.
    const answer = await work();
    run.recorder!.model(purpose, text, JSON.stringify(answer));
    return answer;
  } catch (error) { run.failure ??= error; throw error; }
}

export function trackRunWork(work: Promise<unknown>): void {
  const run = currentRun(); if (!run) return;
  (run.pending ??= new Set()).add(work);
  void work.catch(error => { run.failure ??= error; }).finally(() => run.pending!.delete(work));
}
export async function drainRun(run: RunScope): Promise<void> {
  while (run.pending?.size) await Promise.allSettled([...run.pending]);
  finishRun(run);
}

/** Timer callbacks retain their real guards; replay runs them at their recorded clock boundary. */
type RunTimer = { close(): void; unref(): void };
export const runInterval = (work: () => void, milliseconds: number): RunTimer => runTimer(work, milliseconds, true);
export const runTimeout = (work: () => void, milliseconds: number): RunTimer => runTimer(work, milliseconds, false);
function runTimer(work: () => void, milliseconds: number, repeat: boolean): RunTimer {
  const run = currentRun(), schedule = repeat ? setInterval : setTimeout;
  if (!run) { const timer = schedule(work, milliseconds); return { close: () => clearTimeout(timer), unref: () => { timer.unref(); } }; }
  const id = run.timerCount ?? 0; run.timerCount = id + 1;
  if (run.replay) {
    run.replay.timer(id, () => { if (!repeat) run.replay!.timer(id, null); work(); });
    return { close: () => { run.replay!.flushTimers(); run.replay!.timer(id, null); }, unref() {} };
  }
  const timer = schedule(() => { run.recorder!.timer(id); work(); }, milliseconds);
  return { close: () => clearTimeout(timer), unref: () => { timer.unref(); } };
}

export function runIdentity<T extends string>(purpose: string, create: () => T): T {
  const run = currentRun();
  if (run?.replay) return run.replay.identity(purpose) as T;
  const value = create(); if (run?.recorder) run.recorder.identity(purpose, value); return value;
}
