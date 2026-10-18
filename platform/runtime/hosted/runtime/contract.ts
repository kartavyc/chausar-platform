// Chausar hosted tier: the venture runtime contract. One actor per business, keyed [tenantId, businessId].
// Names follow Rivet Actors (create, get, action, on, broadcast, sleep, destroy) so an adapter onto real Rivet Actors is
// a thin mapping. Two rules are stricter than Rivet's defaults: every action commits through the vault before it
// returns (ventureAction in venture/records.ts), and business data lives only in the encrypted vault, never in actor
// state. Actor state holds pointers.
import { check } from '../../contracts.ts';
import { VENTURE_EVENTS, VENTURE_METHODS, PRE_VAULT_METHODS } from '../../venture/contracts.ts';
import { isBusinessId, isTenantId } from '../custody.ts';

export const RUNTIME_API_VERSION = 'chausar.dev/venture-runtime/v1alpha1';
export const ACTOR_NAME = 'venture';

export type ActorKey = readonly [tenantId: string, businessId: string];
export type CapabilityState = 'available' | 'unverified' | 'planned' | 'unavailable';
export type RuntimeCapability = 'actions' | 'events' | 'state.atomic' | 'hibernate' | 'multi-tenant' | 'schedule' | 'cron' | 'queue' | 'workflow';
export type RuntimeCapabilityStatus = { capability: RuntimeCapability; state: CapabilityState; reason: string };
export type RuntimeDescriptor = {
  apiVersion: typeof RUNTIME_API_VERSION; contractMajor: 1; adapter: 'local' | 'rivet'; actorName: typeof ACTOR_NAME;
  actions: readonly string[]; events: readonly string[]; capabilities: readonly RuntimeCapabilityStatus[];
};

/**
 * The actions one business actor declares: the engine methods a hosted owner may call on it. The two pre-vault
 * venture methods are answered by the server without an actor; creating, locking and deleting a business are runtime
 * calls (create, destroy), not actions.
 */
export const ACTOR_ACTIONS: readonly string[] = Object.freeze([
  'workspace.status',
  ...VENTURE_METHODS.filter(method => !(PRE_VAULT_METHODS as readonly string[]).includes(method)),
  'receipts.get',
]);
export const ACTOR_EVENTS: readonly string[] = VENTURE_EVENTS;

/** Who is asking. Hosted sessions are the only callers in this build, and they act as the business owner. */
export type ActionCaller = { channel: 'web' };
export type ActorEvent = { seq: number; name: string; data: unknown; at: string };
export type ActorCreateInput = { name: string; passphrase: string };
export type ActorCreated = { workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string }; recoveryCode: string };
/** 'unknown' is what an adapter says when its platform decides sleep and wake on its own (Rivet). */
export type ActorState = 'asleep' | 'waking' | 'awake' | 'closing' | 'destroyed' | 'unknown';

export interface ActorHandle {
  readonly key: ActorKey;
  /** Rivet: handle[name](input). Unknown names are refused before anything wakes. */
  action(name: string, input: unknown, caller: ActionCaller): Promise<unknown>;
  /** Rivet: conn.on(event, listener). Only declared events. Returns the unsubscribe function. */
  on(event: string, listener: (event: ActorEvent) => void): () => void;
}

export interface VentureRuntime {
  readonly descriptor: RuntimeDescriptor;
  /** Rivet: client.venture.create(key, { input }). Makes the vault; the recovery code is returned once. */
  create(key: ActorKey, input: ActorCreateInput): Promise<ActorCreated>;
  /** Rivet: client.venture.get(key). Never creates. */
  get(key: ActorKey): ActorHandle;
  /** Rivet: c.destroy() after the vault is deleted. confirmation is the business name, as on the desktop. */
  destroy(key: ActorKey, confirmation: string): Promise<void>;
  state(key: ActorKey): ActorState;
  /** Puts actors to sleep that have been idle for the configured time. Rivet sleeps its actors itself. */
  sleepIdle(): Promise<number>;
  dispose(): Promise<void>;
}

export function checkKey(key: unknown): asserts key is ActorKey {
  check(Array.isArray(key) && key.length === 2 && isTenantId(key[0]) && isBusinessId(key[1]), 'INVALID_ACTOR_KEY', 'An actor key is a tenant id and a business id.');
}
