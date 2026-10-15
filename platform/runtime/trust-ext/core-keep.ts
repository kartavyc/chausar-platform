/** TR-04 Keep: how long each kind of data is kept, and everything the app writes to disk. */
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { authorize, audit, check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { coreState, keepKinds, peekCore } from './core-state.ts';

const labels: Record<string, string> = { facts: 'Facts from your sources', modelReceipts: 'Model receipts', activity: 'Activity record', briefs: 'Briefs', exports: 'Exports', learning: 'Learning log' };
export const inventoryLimits = { depth: 4, files: 500 };

/**
 * How each kind's rule is applied: `retention` (facts, by the retention clean-up), `enforced` (core-data's keep clean-up removes
 * older ones: daily while the app runs on its own, with the retention clean-up, and through `keep.enforce`), `not-enforced` (the
 * rule is stored but nothing removes these yet: core-data's `keep.enforce` is absent), or `until-deleted` (no rule).
 */
export type KeepRule = 'retention' | 'enforced' | 'not-enforced' | 'until-deleted';
/** The last keep clean-up's counts for one kind, from the core's `trust.keep.enforced` activity entry: counts, never money. */
type Applied = { at: string; removed: number; held: number };

/** The newest `trust.keep.enforced` entry, read by kind; counts that are not whole numbers are left out. */
function lastApplied(state: State): Map<string, Applied> {
  const out = new Map<string, Applied>();
  const entry = [...state.activity].reverse().find(item => item?.event === 'trust.keep.enforced');
  const kinds = (entry?.details as { kinds?: unknown } | undefined)?.kinds;
  if (!entry || !Array.isArray(kinds)) return out;
  for (const item of kinds.slice(0, 20)) {
    const { kind, removed, held } = (item ?? {}) as Record<string, unknown>;
    if (typeof kind === 'string' && (keepKinds as readonly string[]).includes(kind) && Number.isSafeInteger(removed) && (removed as number) >= 0 && Number.isSafeInteger(held) && (held as number) >= 0)
      out.set(kind, { at: entry.at, removed: removed as number, held: held as number });
  }
  return out;
}

export function keepKindsView(state: State, enforced = false) {
  const stored = peekCore(state).keep, applied = lastApplied(state);
  return keepKinds.map(kind => {
    if (kind === 'facts') return { kind, days: state.policy.retentionDays, rule: 'retention' as KeepRule, lastApplied: null,
      note: `${labels[kind]}: removed by the retention clean-up after ${state.policy.retentionDays} days.` };
    const days = stored[kind] ?? null;
    const rule: KeepRule = days === null ? 'until-deleted' : enforced ? 'enforced' : 'not-enforced';
    const note = rule === 'until-deleted' ? `${labels[kind]}: kept until you delete it.`
      : rule === 'not-enforced' ? `${labels[kind]}: your rule is ${days} days. Removing these on their own is not built yet; until then they are kept until you delete them.`
      : `${labels[kind]}: your rule is ${days} days. Older ones are removed each day while the app runs on its own; anything another record still needs is held back.`
        + (kind === 'activity' ? ' Entries the tamper-evident record links are held back, so this record may hardly shrink.' : '');
    return { kind, days, rule, lastApplied: enforced ? applied.get(kind) ?? null : null, note };
  });
}

/** True when core-data's `keep.enforce` is registered (core-data merged); read at call time, after every module has loaded. */
async function keepEnforced(): Promise<boolean> {
  const { moduleMethods } = await import('../modules/registry.ts');
  return moduleMethods.has('keep.enforce');
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

export async function keepView(host: ModuleHost) { return { kinds: keepKindsView(host.store.read(), await keepEnforced()), inventory: await inventory(host.directory) }; }

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
