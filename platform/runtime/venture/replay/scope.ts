/** Request-scoped developer capture. No environment switch and no shared mutable replay cursor. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertCaptureText, type RunRecorder } from './capture.ts';
import type { RunReplay } from './replay-run.ts';
import type { ModelTransport } from '../contracts.ts';

export type RunScope = { recorder?: RunRecorder; replay?: RunReplay; failure?: unknown; owner?: object; checks?: (() => void)[]; pending?: Set<Promise<unknown>>; tools?: Map<number, (request: unknown, session: string) => Promise<unknown>>; guards?: Map<number, () => void>; driver?: 'codex' | 'claude' };
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
export function runTransport(transport: ModelTransport): ModelTransport {
  return {
    get replay() { return !!scope.getStore()?.replay || transport.replay; },
    http: request => runExchange(`http:${request.purpose}`, { url: request.url, method: request.method, body: request.body }, () => transport.http(request)),
    process: request => runExchange(`process:${request.purpose}`, { command: request.command, args: request.args, stdin: request.stdin }, () => transport.process(request)),
  };
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
