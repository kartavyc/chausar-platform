import { EventEmitter } from 'node:events';
export interface WorkerProcess extends EventEmitter {
  connected: boolean;
  send(message: unknown, callback: (error?: Error | null) => void): unknown;
  disconnect(): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}
export interface EngineHarnessOptions {
  workerPath: string;
  environment: NodeJS.ProcessEnv;
  execPath?: string;
  forkProcess?: (path: string, args: string[], options: Record<string, unknown>) => WorkerProcess;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  lifecycleTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  maxPending?: number;
  /** C5 task 26: each request's method, milliseconds and bytes each way; never its content. */
  onTiming?: ((line: { method: string; ms: number; requestBytes: number; answerBytes: number; ok: boolean; code?: string }) => void) | null;
}
export class EngineHarness extends EventEmitter {
  constructor(options: EngineHarnessOptions);
  state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped' | 'reconnecting';
  waiting: Map<string, unknown>;
  start(): Promise<void>;
  request(method: string, payload?: Record<string, unknown>): Promise<unknown>;
  updateJobLifecycle(state: Readonly<{ awake: boolean; windowOpen: boolean; backgroundEnabled: boolean }>): Promise<{ applied: true }>;
  /** Ink v2 wave 4 (4G1): whether the owner is looking at the window, as a plain notice. False when it was not sent. */
  reportWatching(watching: boolean): boolean;
  /** C5 task 29: main is starting a fresh worker after this one died. */
  reconnecting(): void;
  /** C5 task 32: at quit, main's own route: is a run busy, the open data's version, and the safety copy. */
  prepareUpdateInstall(payload: { backup?: boolean }): Promise<unknown>;
  stop(): Promise<{ graceful: boolean; forced: boolean; exitCode?: number | null }>;
}
