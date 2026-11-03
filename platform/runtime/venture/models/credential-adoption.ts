import { ChausarError, check, type Context } from '../../contracts.ts';
import type { ModelConnectionRecord, SecretName, SecretShelf, VentureDeps } from '../contracts.ts';
import { assertCredentialSession } from './credential-state.ts';
import { presetSpec } from './presets.ts';

/** Prepare OS storage before adopting connection metadata. Failed saves leave the draft available to retry. */
export async function prepareAdoptedCredentials(deps: VentureDeps, ctx: Context, connections: readonly ModelConnectionRecord[]) {
  const values = new Map<SecretName, string>();
  const staging: SecretShelf = { get: name => values.get(name) ?? null, set: (name, value) => { values.set(name, value); }, delete: name => { values.delete(name); }, has: name => values.has(name), clear: () => values.clear() };
  deps.draft?.moveKeys(staging);
  const names = [...new Set(connections.filter(connection => presetSpec(connection.presetId).needsKey).map(connection => `model:${connection.presetId}` as SecretName))];
  const scope = deps.store.read().workspace.id, previous = new Map<string, string | null>();
  const rollback = async () => {
    let failed = false;
    for (const [name, value] of [...previous].reverse()) {
      try { if (value === null) await deps.credentials!.delete(scope, name); else await deps.credentials!.set(scope, name, value); } catch { failed = true; }
    }
    values.clear(); if (failed) throw new ChausarError('CREDENTIAL_UNAVAILABLE', 'The saved key could not be restored. Reconnect this AI before using it.');
  };
  try {
    check(!names.length || deps.credentials || deps.host !== 'desktop' || deps.demo, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
    for (const name of names) {
      const value = values.get(name); check(value, 'MODEL_KEY_MISSING', 'The saved key is unavailable. Reconnect this AI.');
      assertCredentialSession(deps, ctx);
      if (deps.credentials) { const before = await deps.credentials.get(scope, name); assertCredentialSession(deps, ctx); previous.set(name, before); await deps.credentials.set(scope, name, value); }
    }
    assertCredentialSession(deps, ctx);
  } catch (error) { await rollback(); throw error; }
  return {
    rollback,
    commit() {
      try { assertCredentialSession(deps); for (const name of names) deps.secrets.set(name, values.get(name)!); }
      finally { values.clear(); }
    },
  };
}
