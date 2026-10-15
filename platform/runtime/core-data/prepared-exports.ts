/**
 * Files written by `approvals.exportPrepared` (WK-02) live in `<app directory>/exports/` under names that
 * carry no workspace id, so the engine's managed-copy purge cannot tell whose they are. The workspace's own
 * record names them: each export audits `approvals.exported` with its file names. Those names are also kept
 * in this part's private state whenever this part sees them (every deletion method, and the purge hook that
 * runs on source deletion, revocation and keep-period cleanup), so a later trim of the activity log does not
 * lose them. Workspace delete removes exactly those files: each name must match the export name pattern,
 * and nothing outside the exports folder, no symbolic link and no folder is ever touched.
 */
import { lstat, unlink } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { check, type State } from '../contracts.ts';
import { dataState, peekDataState } from './deletion-register.ts';

/** Exactly the names `exportName` in work-books makes: stamp, up to 12 letters or digits, an optional copy number 2..50, the part. */
export const PREPARED_EXPORT_NAME = /^chausar-prepared-\d{8}-\d{6}Z-[A-Za-z0-9]{1,12}(?:-(?:[2-9]|[1-4]\d|50))?-(?:prepared\.json|checklist\.txt)$/;
const MAX_KEPT = 5000;

function fromActivity(state: State): string[] {
  const names: string[] = [];
  for (const item of Array.isArray(state.activity) ? state.activity : []) {
    if (item?.event !== 'approvals.exported' || !Array.isArray(item.details?.files)) continue;
    for (const name of item.details.files) if (typeof name === 'string' && PREPARED_EXPORT_NAME.test(name)) names.push(name);
  }
  return names;
}
/** Every prepared-export file name this workspace made, from its activity and from the names kept earlier. */
export function preparedExportNames(state: State): string[] {
  return [...new Set([...(peekDataState(state)?.exports ?? []).filter(n => typeof n === 'string' && PREPARED_EXPORT_NAME.test(n)), ...fromActivity(state)])].sort();
}
/** Copies names seen in the activity into private state (inside a store update). Returns how many were new. */
export function rememberPreparedExports(state: State): number {
  const seen = fromActivity(state); if (!seen.length && !peekDataState(state)) return 0;
  const kept = dataState(state).exports, known = new Set(kept); let added = 0;
  for (const name of seen) if (!known.has(name)) { kept.push(name); known.add(name); added++; }
  if (kept.length > MAX_KEPT) kept.splice(0, kept.length - MAX_KEPT);
  return added;
}

/**
 * Reads the names now (before the vault goes) and returns the removal to run inside the vault deletion's
 * cleanup. Removed files are reported as `exports/<name>`; a file already gone is not reported.
 */
export function preparedExportPurge(state: State, directory: string): (assertCurrent?: () => void) => Promise<string[]> {
  const names = preparedExportNames(state);
  return async (assertCurrent = () => {}) => {
    const folder = resolve(directory, 'exports'), removed: string[] = [];
    for (const name of names) {
      const path = resolve(folder, name);
      check(PREPARED_EXPORT_NAME.test(name) && relative(folder, path) === name, 'INVALID_PATH', 'A prepared export left its export directory.');
      let file; try { file = await lstat(path); } catch (error) { if ((error as { code?: unknown })?.code === 'ENOENT') continue; throw error; }
      if (!file.isFile()) continue;
      assertCurrent(); await unlink(path); removed.push(`exports/${name}`);
    }
    return removed;
  };
}
