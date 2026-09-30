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
}
export class EngineHarness extends EventEmitter {
  constructor(options: EngineHarnessOptions);
  state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped';
  waiting: Map<string, unknown>;
  start(): Promise<void>;
  request(method: string, payload?: Record<string, unknown>): Promise<unknown>;
  updateJobLifecycle(state: Readonly<{ awake: boolean; windowOpen: boolean; backgroundEnabled: boolean }>): Promise<{ applied: true }>;
  stop(): Promise<{ graceful: boolean; forced: boolean; exitCode?: number | null }>;
}
