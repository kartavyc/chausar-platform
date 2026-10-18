// Chausar hosted tier: the local actor runtime. Every business actor lives in this server process. An actor wakes on
// its first action (its vault opens with the passphrase from custody), runs actions concurrently the way Rivet does
// (the vault still commits one change at a time), broadcasts the declared events each action appended, and sleeps
// after an idle spell or when the server needs room. Sleeping closes the vault and drops every key typed into it.
import { ChausarError, check } from '../../contracts.ts';
import { BusinessEngine, type BusinessEngineOptions } from './business.ts';
import {
  ACTOR_ACTIONS, ACTOR_EVENTS, ACTOR_NAME, RUNTIME_API_VERSION, checkKey,
  type ActionCaller, type ActorCreateInput, type ActorCreated, type ActorEvent, type ActorHandle, type ActorKey, type ActorState,
  type RuntimeDescriptor, type VentureRuntime,
} from './contract.ts';

export type LocalRuntimeOptions = BusinessEngineOptions & {
  /** The vault passphrase for a business, unsealed from custody. Throws BUSINESS_NOT_FOUND for an unknown key. */
  passphrase: (key: ActorKey) => Promise<string>;
  idleMs: number;
  maxAwake: number;
  clock?: () => number;
};

type Slot = {
  key: ActorKey; id: string;
  state: ActorState;
  business: BusinessEngine | null;
  waking: Promise<void> | null;
  closing: Promise<void> | null;
  inflight: number;
  lastUsed: number;
  listeners: Map<string, Set<(event: ActorEvent) => void>>;
  pumping: Promise<void>;
};

export const LOCAL_DESCRIPTOR: RuntimeDescriptor = Object.freeze({
  apiVersion: RUNTIME_API_VERSION, contractMajor: 1, adapter: 'local', actorName: ACTOR_NAME,
  actions: ACTOR_ACTIONS, events: ACTOR_EVENTS,
  capabilities: Object.freeze([
    { capability: 'actions', state: 'unverified', reason: 'Runs in this hosted server process. Experimental: not yet tested on a real deploy.' },
    { capability: 'events', state: 'unverified', reason: 'Declared venture events are pushed to the page after each action. Experimental.' },
    { capability: 'state.atomic', state: 'available', reason: 'Every action commits once through the encrypted vault, or changes nothing.' },
    { capability: 'hibernate', state: 'unverified', reason: 'Idle businesses close their vault and wake on the next action. Keys typed into them are dropped.' },
    { capability: 'multi-tenant', state: 'unverified', reason: 'One folder, vault key and actor per business, keyed by tenant. Experimental.' },
    { capability: 'schedule', state: 'planned', reason: 'No venture action needs a timer yet; sync is a click.' },
    { capability: 'cron', state: 'planned', reason: 'Weekly briefs and repo checks are planned.' },
    { capability: 'queue', state: 'planned', reason: 'Owner decisions are records in the vault, not queue messages, in this build.' },
    { capability: 'workflow', state: 'planned', reason: 'Replayable workflow steps are planned.' },
  ] as const),
});

export class LocalVentureRuntime implements VentureRuntime {
  readonly descriptor = LOCAL_DESCRIPTOR;
  #options: LocalRuntimeOptions;
  #slots = new Map<string, Slot>();
  #clock: () => number;
  #disposed = false;

  constructor(options: LocalRuntimeOptions) {
    check(Number.isSafeInteger(options.maxAwake) && options.maxAwake >= 1 && Number.isSafeInteger(options.idleMs) && options.idleMs >= 1000, 'INVALID_LIMIT', 'The runtime needs whole limits.');
    this.#options = options;
    this.#clock = options.clock ?? Date.now;
  }

  #slot(key: ActorKey): Slot {
    checkKey(key);
    check(!this.#disposed, 'HOSTED_STOPPING', 'The hosted server is stopping.');
    const id = `${key[0]}/${key[1]}`;
    let slot = this.#slots.get(id);
    if (!slot || slot.state === 'destroyed') {
      slot = { key: [key[0], key[1]], id, state: 'asleep', business: null, waking: null, closing: null, inflight: 0, lastUsed: this.#clock(), listeners: new Map(), pumping: Promise.resolve() };
      this.#slots.set(id, slot);
    }
    return slot;
  }

  state(key: ActorKey): ActorState {
    checkKey(key);
    return this.#slots.get(`${key[0]}/${key[1]}`)?.state ?? 'asleep';
  }

  async create(key: ActorKey, input: ActorCreateInput): Promise<ActorCreated> {
    const slot = this.#slot(key);
    check(slot.state === 'asleep' && !slot.business, 'BUSINESS_EXISTS', 'This business already exists.');
    slot.inflight++;
    try {
      await this.#makeRoom(slot);
      slot.state = 'waking';
      const { business, created } = await BusinessEngine.create(this.#options, slot.key, input);
      slot.business = business;
      slot.state = 'awake';
      slot.lastUsed = this.#clock();
      return created;
    } catch (error) {
      if (slot.state === 'waking') slot.state = 'asleep';
      throw error;
    } finally { slot.inflight--; }
  }

  get(key: ActorKey): ActorHandle {
    const slot = this.#slot(key);
    const runtime = this;
    return Object.freeze({
      key: slot.key,
      action(name: string, input: unknown, caller: ActionCaller) { return runtime.#action(slot.key, name, input, caller); },
      on(event: string, listener: (event: ActorEvent) => void) { return runtime.#on(slot.key, event, listener); },
    });
  }

  async #action(key: ActorKey, name: string, input: unknown, caller: ActionCaller): Promise<unknown> {
    check(ACTOR_ACTIONS.includes(name), 'ACTION_NOT_DECLARED', 'This business has no such action on the hosted server.');
    check(caller?.channel === 'web', 'FORBIDDEN', 'Only a signed-in owner may act on a business.');
    const slot = this.#slot(key);
    slot.inflight++;
    try {
      const business = await this.#ready(slot);
      slot.lastUsed = this.#clock();
      return await business.request(name, input);
    } finally {
      slot.inflight--;
      slot.lastUsed = this.#clock();
      this.#pump(slot);
    }
  }

  async #ready(slot: Slot): Promise<BusinessEngine> {
    for (;;) {
      check(slot.state !== 'destroyed', 'BUSINESS_NOT_FOUND', 'That business no longer exists.');
      if (slot.closing) { await slot.closing.catch(() => {}); continue; }
      if (slot.state === 'awake' && slot.business) return slot.business;
      if (!slot.waking) {
        slot.waking = (async () => {
          await this.#makeRoom(slot);
          slot.state = 'waking';
          try {
            const passphrase = await this.#options.passphrase(slot.key);
            slot.business = await BusinessEngine.open(this.#options, slot.key, passphrase);
            slot.state = 'awake';
          } catch (error) { slot.state = 'asleep'; slot.business = null; throw error; }
        })().finally(() => { slot.waking = null; });
      }
      await slot.waking;
    }
  }

  /** Keeps at most maxAwake actors awake: the least recently used idle one sleeps first. */
  async #makeRoom(wanting: Slot) {
    const awake = [...this.#slots.values()].filter(s => s !== wanting && (s.state === 'awake' || s.state === 'waking'));
    if (awake.length < this.#options.maxAwake) return;
    await Promise.all(awake.map(s => s.pumping.catch(() => {})));
    const idle = awake.filter(s => s.state === 'awake' && s.inflight === 0).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const candidate of idle) if (await this.#sleep(candidate)) return;
    throw new ChausarError('HOSTED_BUSY', 'The server is busy right now. Try again in a minute.');
  }

  async #sleep(slot: Slot): Promise<boolean> {
    if (slot.state !== 'awake' || !slot.business) return false;
    // The event pump that follows each action holds the actor briefly; let it finish, then look again.
    await slot.pumping.catch(() => {});
    if (slot.state !== 'awake' || slot.inflight > 0 || !slot.business) return false;
    const business = slot.business;
    slot.state = 'closing';
    slot.closing = (async () => {
      try { await business.close(); }
      finally { slot.business = null; if (slot.state === 'closing') slot.state = 'asleep'; }
    })().finally(() => { slot.closing = null; });
    await slot.closing;
    return true;
  }

  async sleepIdle(): Promise<number> {
    const now = this.#clock();
    let slept = 0;
    for (const slot of [...this.#slots.values()]) {
      if (slot.state === 'awake' && now - slot.lastUsed >= this.#options.idleMs && await this.#sleep(slot)) slept++;
      if (slot.state === 'asleep' && slot.listeners.size === 0 && !slot.business) this.#slots.delete(slot.id);
    }
    return slept;
  }

  #on(key: ActorKey, event: string, listener: (event: ActorEvent) => void): () => void {
    check(ACTOR_EVENTS.includes(event), 'EVENT_NOT_DECLARED', 'This business has no such event.');
    check(typeof listener === 'function', 'INVALID_REQUEST', 'An event listener must be a function.');
    const slot = this.#slot(key);
    let set = slot.listeners.get(event);
    if (!set) { set = new Set(); slot.listeners.set(event, set); }
    set.add(listener);
    return () => {
      const current = slot.listeners.get(event);
      current?.delete(listener);
      if (current && current.size === 0) slot.listeners.delete(event);
    };
  }

  /** After each action, one at a time: read the new events and hand them to listeners. A listener's throw is its own. */
  #pump(slot: Slot) {
    slot.pumping = slot.pumping.then(async () => {
      if (slot.state !== 'awake' || !slot.business) return;
      slot.inflight++;
      try {
        const events = await slot.business.newEvents();
        // With nobody listening the events are still read, so a later listener hears only what comes after it.
        for (const event of events) {
          for (const listener of [...(slot.listeners.get(event.name) ?? [])]) {
            try { listener(event); } catch { /* a broken listener does not stop the others */ }
          }
        }
      } finally { slot.inflight--; }
    }).catch(() => {});
  }

  async destroy(key: ActorKey, confirmation: string): Promise<void> {
    const slot = this.#slot(key);
    slot.inflight++;
    try {
      const business = await this.#ready(slot);
      await slot.pumping.catch(() => {});
      check(slot.inflight === 1, 'VAULT_BUSY', 'Something is still running on this business. Try again in a moment.');
      await business.delete(this.#options.root, confirmation);
      slot.business = null;
      slot.state = 'destroyed';
      slot.listeners.clear();
      this.#slots.delete(slot.id);
    } finally { slot.inflight--; }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    const failures: unknown[] = [];
    for (const slot of [...this.#slots.values()]) {
      if (slot.waking) await slot.waking.catch(() => {});
      for (let i = 0; i < 300 && slot.inflight > 0; i++) await new Promise(resolve => setTimeout(resolve, 100));
      if (slot.closing) await slot.closing.catch(() => {});
      if (slot.business) {
        const business = slot.business;
        slot.business = null; slot.state = 'asleep';
        try { await slot.pumping.catch(() => {}); await business.close(); } catch (error) { failures.push(error); }
      }
    }
    this.#slots.clear();
    if (failures.length) throw failures[0] instanceof Error ? failures[0] : new ChausarError('HOSTED_STOPPING', 'Some businesses did not close cleanly.');
  }
}
