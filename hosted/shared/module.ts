import type { Sql } from '../db/sql.ts';
import type { JobQueue, Worker } from '../db/queue.ts';
import type { Router } from './http.ts';
import type { Clock } from './clock.ts';
import type { Authenticator, EntitlementSource } from './auth.ts';

/** Outbound HTTP. Production passes global fetch; tests pass a local fake. Nothing else reaches the network. */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

/** What every hosted module receives. `env` is the module's own configuration (see each module's `config.ts`). */
export type HostedDeps = {
  sql: Sql; clock: Clock; queue: JobQueue; fetch: Fetch;
  /** At least 32 characters. Keys every stored hash of a bearer secret. */
  pepper: string;
  /** https origin of the link pages, for example https://link.chausar.app. Digit-free by rule. */
  linkOrigin: string;
  authenticate: Authenticator;
  entitlements: EntitlementSource;
};
export interface HostedModule {
  readonly id: string;
  routes(router: Router): void;
  /** Registers job handlers and any repeating schedule the worker must keep. */
  jobs?(worker: Worker): void;
  /** Scheduled maintenance, called by the worker process about once a minute. */
  sweep?(): Promise<void>;
}
export type Env = Readonly<Record<string, string | undefined>>;
