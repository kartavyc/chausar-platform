/**
 * What the window shows first, read from the engine (no React here; the Boot component holds the state):
 *   - a business is open: the app;
 *   - no business on this computer (on hosted, none on the account): the first run, only the one-sentence start;
 *   - businesses exist but none is open: "Welcome back", a quiet list to open one. When exactly one exists, it opens
 *     with this computer and the owner did not close it on purpose, it opens by itself.
 */

import type { EngineClient, ParamsOf } from '../../engine/types';

/**
 * A business the welcome list can open. `opens` says how: now (this computer keeps its key), with its passphrase, or
 * with its recovery code (this computer's key is missing). `key` is its folder on this computer, its id on hosted.
 */
export interface Openable {
  key: string; name: string | null; opens: 'now' | 'passphrase' | 'key-missing';
  params: ParamsOf<'workspace.open'>;
}
/** `complete: false`: the engine could not list every business here (PostgreSQL storage, say), so a folder can be typed. */
export interface WelcomeFound { kind: 'welcome'; businesses: Openable[]; closedByOwner: boolean; complete: boolean }
export type BootFound = { kind: 'app' } | { kind: 'first-run' } | WelcomeFound;

const OPENS = { 'with-this-computer': 'now', 'needs-passphrase': 'passphrase', 'key-missing': 'key-missing' } as const;

export async function readBoot(client: EngineClient): Promise<BootFound> {
  const status = await client.request('workspace.status', {});
  if (status.open) return { kind: 'app' };
  const closedByOwner = status.closedByOwner === true;
  if (client.transport === 'hosted') {
    const list = status.hosted?.businesses ?? [];
    if (list.length === 0) return { kind: 'first-run' };
    return { kind: 'welcome', closedByOwner, complete: true, businesses: list.map((b) => ({ key: b.id, name: b.name, opens: 'now', params: { businessId: b.id } })) };
  }
  const list = await client.request('workspace.list', {});
  if (list.businesses.length === 0) return { kind: 'first-run' };
  return { kind: 'welcome', closedByOwner, complete: list.complete, businesses: list.businesses.map((b) => ({ key: b.folder, name: b.name, opens: OPENS[b.opens], params: { folder: b.folder } })) };
}

/** The one business to open without asking: the only one, opening with this computer, not closed by the owner. */
export function openByItself(found: BootFound): Openable | null {
  if (found.kind !== 'welcome' || found.closedByOwner || found.businesses.length !== 1) return null;
  const [only] = found.businesses;
  return only && only.opens === 'now' ? only : null;
}
