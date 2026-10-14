/** TR-04 Keep: how long each kind of data is kept, and everything the app writes to disk. */
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { authorize, audit, check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { coreState, keepKinds, peekCore } from './core-state.ts';

const labels: Record<string, string> = { facts: 'Facts from your sources', modelReceipts: 'Model receipts', activity: 'Activity record', briefs: 'Briefs', exports: 'Exports', learning: 'Learning log' };
export const inventoryLimits = { depth: 4, files: 500 };

export function keepKindsView(state: State) {
  const stored = peekCore(state).keep;
  return keepKinds.map(kind => {
    if (kind === 'facts') return { kind, days: state.policy.retentionDays, note: `${labels[kind]}: removed by the retention clean-up after ${state.policy.retentionDays} days.` };
    const days = stored[kind] ?? null;
    return { kind, days, note: days === null ? `${labels[kind]}: kept until you delete it.`
      : `${labels[kind]}: your rule is ${days} days. Removing these on their own is not built yet; until then they are kept until you delete them.` };
  });
}

function describe(path: string): string {
  const [top, ...rest] = path.split(sep); const file = rest.at(-1) ?? top;
  if (top === 'backups') return 'Encrypted backup of a workspace.';
  if (top === 'exports') return 'A file you exported.';
  if (top === 'updates') return 'A downloaded app update, waiting to be checked or installed.';
  if (file === 'authority.encrypted.json') return 'The locked workspace vault (encrypted).';
  if (file === 'writer.lock') return 'The lock that keeps one writer at a time.';
  return rest.length ? 'A workspace vault file (encrypted).' : 'An app file.';
}

/** Walks the app data directory without following symbolic links, bounded in depth and count. */
export async function inventory(directory: string) {
  const items: { path: string; bytes: number; what: string }[] = [];
  async function walk(folder: string, depth: number) {
    if (depth > inventoryLimits.depth || items.length >= inventoryLimits.files) return;
    let entries; try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (items.length >= inventoryLimits.files) return;
      const path = join(folder, entry.name); if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile()) { const info = await lstat(path).catch(() => null); if (info?.isFile()) { const rel = relative(directory, path); items.push({ path: rel.split(sep).join('/'), bytes: info.size, what: describe(rel) }); } }
    }
  }
  await walk(directory, 1); return items;
}

export async function keepView(host: ModuleHost) { return { kinds: keepKindsView(host.store.read()), inventory: await inventory(host.directory) }; }

export async function setKeep(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check((keepKinds as readonly string[]).includes(payload.kind), 'INVALID_KEEP', 'Choose a kind of data to keep.');
  const days = payload.days;
  check(days === null || (Number.isInteger(days) && days >= 1 && days <= 3650), 'INVALID_KEEP', 'Keep between one and 3650 days, or until you delete it.');
  if (payload.kind === 'facts') {
    check(days !== null, 'INVALID_KEEP', 'Facts follow the retention rule, which needs a number of days.');
    await host.services.trust.updatePolicy(ctx, { retentionDays: days });
  } else await host.store.update(state => {
    authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, 'admin');
    coreState(state).keep[payload.kind] = days; audit(state, 'trustx.keep.changed', { kind: payload.kind, days, memberId: ctx.memberId });
  });
  return keepView(host);
}
