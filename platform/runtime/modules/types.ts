/**
 * Engine modules: the extension seam for lane-owned engine methods.
 *
 * A module registers named methods without editing engine.ts. The engine authorizes the
 * current member at the declared permission, refuses phone callers unless the method opts in,
 * and then calls the handler with the live store and services. A module keeps its private
 * durable state under `state.extensions[module.id]` (see `moduleState`) and must remove
 * anything derived from a deleted or revoked source in `purge`.
 */
import type { Context, State, StateStore } from '../contracts.ts';

export type ModulePermission = 'read' | 'prepare' | 'approve' | 'admin';

export interface ModuleHost {
  /** The open workspace. Every write goes through `store.update`. */
  readonly store: StateStore;
  /** Live engine services (calculator, imports, actions, jobs, connectors, …) by name. */
  readonly services: Readonly<Record<string, any>>;
  /** True for the synthetic demo launch: providers and external reads stay disabled. */
  readonly demo: boolean;
  /** Application data directory owned by this engine. */
  readonly directory: string;
  /** Trusted host options passed to the engine for this module, if any. */
  readonly options: Readonly<Record<string, unknown>>;
  /** Calls another engine method as the same caller, through the full authorization path. */
  /** Calls another engine method as the same caller. `{ tainted: true }` marks the call as touched by outside text; it can never clear the mark. */
  call(method: string, payload: Record<string, unknown>, options?: { tainted?: boolean }): Promise<unknown>;
}

export interface MethodSpec {
  readonly permission: ModulePermission;
  /** Phone sessions are refused unless the method explicitly opts in. */
  readonly phone?: boolean;
  /** Synthetic demo launches are refused when the method reaches an external system. */
  readonly external?: boolean;
  /**
   * Callable by the trusted local desktop before any workspace is open (no member is authorized
   * then; `host.store` throws). Once a workspace is open the method is authorized normally.
   */
  readonly preVault?: boolean;
  handler(ctx: Context, payload: Record<string, any>, host: ModuleHost): Promise<unknown> | unknown;
}

export interface SchedulerHost { readonly awake: boolean; readonly windowOpen: boolean; readonly backgroundEnabled: boolean }

export interface EngineModule {
  readonly id: string;
  readonly methods: Readonly<Record<string, MethodSpec>>;
  /**
   * Remove module state derived from the named sources or records, and, when `cutoff` (epoch ms)
   * is present, anything older than the workspace retention period. Return the number removed.
   */
  purge?(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; at: string; cutoff?: number }): number;
  /** True for core jobs this module runs itself; the core job scheduler then leaves them alone. */
  ownsJob?(job: { readonly id: string; readonly type?: string }): boolean;
  /**
   * Trusted host options built at engine start when the embedding host passed none for this
   * module (`EngineOptions.modules[id]`). Read only trusted inputs: the engine's directory, demo
   * flag and the engine process environment. Never read workspace or request data here.
   */
  hostOptions?(input: { readonly directory: string; readonly demo: boolean; readonly env: Readonly<Record<string, string | undefined>> }): Readonly<Record<string, unknown>>;
  /** Optional scheduled work for an owner context; runs only while autonomy is on. */
  tick?(ctx: Context, host: ModuleHost, scheduler: SchedulerHost): Promise<unknown[]>;
}

/** The module's private, encrypted-with-the-vault namespace inside workspace state. */
export function moduleState<T>(state: State, id: string, init: () => T): T {
  const extensions = (state.extensions ??= {});
  if (!Object.hasOwn(extensions, id)) extensions[id] = init();
  return extensions[id] as T;
}

/** Read-only view of a module's namespace, without creating it. */
export function peekModuleState<T>(state: State, id: string): T | undefined {
  return state.extensions && Object.hasOwn(state.extensions, id) ? state.extensions[id] as T : undefined;
}
