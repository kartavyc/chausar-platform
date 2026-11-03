import { ChausarError, authorize, type Context, type StateStore } from '../../contracts.ts';
import type { SecretShelf, VentureDeps } from '../contracts.ts';
const closed = new WeakSet<SecretShelf>(), queues = new WeakMap<StateStore, Promise<unknown>>();
export function closeCredentialSession(shelf: SecretShelf) { closed.add(shelf); }
export function assertCredentialSession(deps: VentureDeps, ctx?: Context) {
  if (closed.has(deps.secrets) || deps.closing?.signal.aborted) throw new ChausarError('VAULT_LOCKED', 'Open your workspace first.');
  if (ctx) authorize(deps.store, ctx, 'admin');
}
/** OS storage and connection metadata form one serialized change, with explicit compensation on failure. */
export function credentialChange<T>(deps: VentureDeps, change: () => Promise<T>): Promise<T> {
  const previous = queues.get(deps.store) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    assertCredentialSession(deps); const release = deps.closing?.hold();
    try { return await change(); } finally { release?.(); }
  });
  queues.set(deps.store, pending); void pending.finally(() => { if (queues.get(deps.store) === pending) queues.delete(deps.store); }).catch(() => {}); return pending;
}
