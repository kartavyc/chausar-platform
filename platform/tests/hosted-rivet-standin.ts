// An in-memory stand-in for the few rivetkit behaviours the Rivet adapter relies on: one instance per key, state from
// createState, fresh vars after sleep, actions called as handle[name](...args) with a context, broadcast to
// connections. It proves the mapping in runtime/rivet.ts, not Rivet itself; the adapter stays labelled planned.
import type { RivetActorContext, RivetClientLike, RivetHandleLike, RivetVentureConfig, RivetVentureState, RivetVentureVars } from '../runtime/hosted/runtime/rivet.ts';

type Instance = {
  key: string[]; state: RivetVentureState; saved: RivetVentureState; vars: RivetVentureVars; destroyed: boolean;
  conns: Set<Map<string, Set<(payload: unknown) => void>>>;
};

export function createRivetStandIn(config: RivetVentureConfig) {
  const instances = new Map<string, Instance>();
  const id = (key: string[]) => key.join('/');
  const context = (instance: Instance): RivetActorContext => ({
    get state() { return instance.state; },
    set state(value) { instance.state = value; },
    vars: instance.vars,
    key: instance.key,
    broadcast(name: string, payload: unknown) {
      if (!(name in config.events)) throw new Error(`Undeclared event ${name}`);
      for (const conn of instance.conns) for (const listener of conn.get(name) ?? []) listener(payload);
    },
    async saveState() { instance.saved = structuredClone(instance.state); },
    keepAwake: promise => promise,
    destroy() { instance.destroyed = true; },
  });
  const handle = (instance: Instance): RivetHandleLike => new Proxy({} as RivetHandleLike, {
    get(_target, property) {
      if (property === 'connect') return () => {
        const listeners = new Map<string, Set<(payload: unknown) => void>>();
        instance.conns.add(listeners);
        return {
          on(event: string, listener: (payload: unknown) => void) {
            let set = listeners.get(event); if (!set) { set = new Set(); listeners.set(event, set); }
            set.add(listener);
            return () => { set.delete(listener); };
          },
          dispose() { instance.conns.delete(listeners); },
        };
      };
      if (typeof property !== 'string' || !Object.hasOwn(config.actions, property)) return undefined;
      return async (...args: unknown[]) => {
        if (instance.destroyed) throw Object.assign(new Error('Actor destroyed'), { code: 'BUSINESS_NOT_FOUND' });
        return config.actions[property](context(instance), ...args);
      };
    },
  });
  const client: RivetClientLike = {
    venture: {
      create(key: string[], options: { input: unknown }) {
        if (instances.has(id(key)) && !instances.get(id(key))!.destroyed) throw Object.assign(new Error('Actor exists'), { code: 'BUSINESS_EXISTS' });
        const state = config.createState({ key }, options.input);
        const instance: Instance = { key: [...key], state, saved: structuredClone(state), vars: config.createVars(), destroyed: false, conns: new Set() };
        instances.set(id(key), instance);
        return handle(instance);
      },
      get(key: string[]) {
        const instance = instances.get(id(key));
        if (!instance || instance.destroyed) throw Object.assign(new Error('Actor not found'), { code: 'BUSINESS_NOT_FOUND' });
        return handle(instance);
      },
    },
  };
  return {
    client,
    instances,
    /** Every instance sleeps: onSleep runs, vars start fresh, state comes back from the last save. */
    async sleepAll() {
      for (const instance of instances.values()) {
        if (instance.destroyed) continue;
        await config.onSleep(context(instance));
        instance.vars.business = null;
        instance.state = structuredClone(instance.saved);
      }
    },
  };
}
