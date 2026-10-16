// Chausar hosted tier: the seam for real Rivet Actors (rivetkit). rivetkit is not a dependency of this repo, so this file
// describes the few parts it would use as structural types, and maps the venture runtime contract onto them:
// - ventureActorConfig() is what a Rivet runner would pass to rivetkit's actor(): state holds pointers only, the
//   business's Engine lives in per-instance vars, every action saves state immediately after the vault committed.
// - RivetVentureRuntime is the server side: client.venture.create/get, handle[action](input), conn.on(event).
// Both are checked only against an in-memory stand-in (platform/tests/hosted-rivet-standin.ts), never a real Rivet
// engine, so every capability below says planned. The hosted server refuses to start on this adapter.
import { check } from '../../contracts.ts';
import { BusinessEngine, type BusinessEngineOptions } from './business.ts';
import {
  ACTOR_ACTIONS, ACTOR_EVENTS, ACTOR_NAME, RUNTIME_API_VERSION, checkKey,
  type ActionCaller, type ActorCreateInput, type ActorCreated, type ActorEvent, type ActorHandle, type ActorKey, type ActorState,
  type RuntimeDescriptor, type VentureRuntime,
} from './contract.ts';

const PLANNED = 'Mapped to Rivet Actors and checked against an in-memory stand-in only. Not run on a real Rivet engine.';
export const RIVET_DESCRIPTOR: RuntimeDescriptor = Object.freeze({
  apiVersion: RUNTIME_API_VERSION, contractMajor: 1, adapter: 'rivet', actorName: ACTOR_NAME,
  actions: ACTOR_ACTIONS, events: ACTOR_EVENTS,
  capabilities: Object.freeze((['actions', 'events', 'state.atomic', 'hibernate', 'multi-tenant', 'schedule', 'cron', 'queue', 'workflow'] as const)
    .map(capability => ({ capability, state: 'planned' as const, reason: PLANNED }))),
});

/** Rivet action names avoid dots, which rivetkit may read as nested action groups. */
export const rivetActionName = (method: string) => method.replace(/\./g, '_');
export const CREATE_VAULT = 'chausar_createVault';
export const DESTROY_VAULT = 'chausar_destroyVault';

// ---------------------------------------------------------------------------------------------------------------
// Structural types for the parts of rivetkit this adapter uses
// ---------------------------------------------------------------------------------------------------------------

export type RivetVentureState = { schemaVersion: 1; tenantId: string; businessId: string; lastSeq: number; hasVault: boolean };
export type RivetVentureVars = { business: BusinessEngine | null };
export type RivetActorContext = {
  state: RivetVentureState; vars: RivetVentureVars; key: string[];
  broadcast(name: string, payload: unknown): void;
  saveState(options: { immediate: true }): Promise<void>;
  keepAwake<T>(promise: Promise<T>): Promise<T>;
  destroy(): void;
};
type RivetAction = (c: RivetActorContext, ...args: any[]) => Promise<unknown>;
export type RivetVentureConfig = {
  createState: (c: { key: string[] }, input: unknown) => RivetVentureState;
  createVars: () => RivetVentureVars;
  events: Record<string, unknown>;
  actions: Record<string, RivetAction>;
  onSleep: (c: RivetActorContext) => Promise<void>;
  onDestroy: (c: RivetActorContext) => Promise<void>;
  options: { actionTimeout: number; sleepTimeout: number };
};

export type RivetConnLike = { on(event: string, listener: (payload: any) => void): () => void; dispose(): Promise<void> | void };
export type RivetHandleLike = { connect(): RivetConnLike } & { [action: string]: unknown };
export type RivetClientLike = { venture: { create(key: string[], options: { input: unknown }): Promise<RivetHandleLike> | RivetHandleLike; get(key: string[]): RivetHandleLike } };

export type RivetActorHost = BusinessEngineOptions & { passphrase: (key: ActorKey) => Promise<string>; idleMs: number };

// ---------------------------------------------------------------------------------------------------------------
// The actor definition (runner side)
// ---------------------------------------------------------------------------------------------------------------

/** The config for rivetkit's actor(). `event` is rivetkit's event() token maker. */
export function ventureActorConfig(event: () => unknown, host: RivetActorHost): RivetVentureConfig {
  const keyOf = (c: RivetActorContext): ActorKey => { const key = [c.state.tenantId, c.state.businessId] as const; checkKey(key); return key; };
  const business = async (c: RivetActorContext): Promise<BusinessEngine> => {
    check(c.state.hasVault, 'BUSINESS_NOT_FOUND', 'This business has no vault.');
    if (!c.vars.business) {
      const opened = await BusinessEngine.open(host, keyOf(c), await host.passphrase(keyOf(c)));
      opened.lastSeq = Math.max(opened.lastSeq, c.state.lastSeq);
      c.vars.business = opened;
    }
    return c.vars.business;
  };
  const afterAction = async (c: RivetActorContext, opened: BusinessEngine) => {
    for (const item of await opened.newEvents()) c.broadcast(item.name, item);
    c.state.lastSeq = opened.lastSeq;
    await c.saveState({ immediate: true });
  };
  const actions: Record<string, RivetAction> = {};
  for (const method of ACTOR_ACTIONS) {
    actions[rivetActionName(method)] = async (c, input: unknown, caller: ActionCaller) => {
      check(caller?.channel === 'web', 'FORBIDDEN', 'Only a signed-in owner may act on a business.');
      const opened = await business(c);
      try { return await c.keepAwake(opened.request(method, input)); }
      finally { await afterAction(c, opened); }
    };
  }
  actions[CREATE_VAULT] = async (c, input: ActorCreateInput) => {
    check(!c.state.hasVault, 'BUSINESS_EXISTS', 'This business already has a vault.');
    const { business: opened, created } = await BusinessEngine.create(host, keyOf(c), input);
    c.vars.business = opened;
    c.state.hasVault = true;
    await afterAction(c, opened);
    return created;
  };
  actions[DESTROY_VAULT] = async (c, input: { confirmation: string }) => {
    const opened = await business(c);
    await opened.delete(host.root, input?.confirmation);
    c.vars.business = null;
    c.state.hasVault = false;
    await c.saveState({ immediate: true });
    c.destroy();
    return { deleted: true };
  };
  return {
    createState: (c, _input) => {
      const key = [c.key[0], c.key[1]] as const;
      checkKey(key);
      return { schemaVersion: 1, tenantId: key[0], businessId: key[1], lastSeq: 0, hasVault: false };
    },
    createVars: () => ({ business: null }),
    events: Object.fromEntries(ACTOR_EVENTS.map(name => [name, event()])),
    actions,
    onSleep: async c => { const opened = c.vars.business; c.vars.business = null; await opened?.close(); },
    onDestroy: async c => { const opened = c.vars.business; c.vars.business = null; await opened?.close(); },
    options: { actionTimeout: 120_000, sleepTimeout: host.idleMs },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The runtime (server side)
// ---------------------------------------------------------------------------------------------------------------

async function call(handle: RivetHandleLike, name: string, ...args: unknown[]): Promise<unknown> {
  const action = handle[name];
  check(typeof action === 'function', 'ACTION_NOT_DECLARED', 'This business has no such action on the hosted server.');
  return (action as (...values: unknown[]) => Promise<unknown>).apply(handle, args);
}

export class RivetVentureRuntime implements VentureRuntime {
  readonly descriptor = RIVET_DESCRIPTOR;
  #client: RivetClientLike;
  constructor(client: RivetClientLike) { this.#client = client; }

  async create(key: ActorKey, input: ActorCreateInput): Promise<ActorCreated> {
    checkKey(key);
    const handle = await this.#client.venture.create([key[0], key[1]], { input: {} });
    return await call(handle, CREATE_VAULT, input) as ActorCreated;
  }

  get(key: ActorKey): ActorHandle {
    checkKey(key);
    const client = this.#client;
    const rivetKey = [key[0], key[1]];
    return Object.freeze({
      key,
      async action(name: string, input: unknown, caller: ActionCaller) {
        check(ACTOR_ACTIONS.includes(name), 'ACTION_NOT_DECLARED', 'This business has no such action on the hosted server.');
        return call(client.venture.get(rivetKey), rivetActionName(name), input, caller);
      },
      on(event: string, listener: (event: ActorEvent) => void) {
        check(ACTOR_EVENTS.includes(event), 'EVENT_NOT_DECLARED', 'This business has no such event.');
        const conn = client.venture.get(rivetKey).connect();
        const off = conn.on(event, listener);
        return () => { off(); void conn.dispose(); };
      },
    });
  }

  async destroy(key: ActorKey, confirmation: string): Promise<void> {
    checkKey(key);
    await call(this.#client.venture.get([key[0], key[1]]), DESTROY_VAULT, { confirmation });
  }

  state(key: ActorKey): ActorState { checkKey(key); return 'unknown'; }
  async sleepIdle(): Promise<number> { return 0; }
  async dispose(): Promise<void> {}
}
