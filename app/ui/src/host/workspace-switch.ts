/**
 * SH-06 switching workspaces from the workspace menu (`workspaces.switch` in the design). It is
 * not one engine method: the host locks the open workspace through the controller's own lock
 * (`workspace.lock`, which never fails open: a refused lock keeps the screen locked and asks the
 * engine again), then draws the lock screen for the chosen folder, which opens only with that
 * folder's own passphrase (or its PIN on this computer). Nothing is read across workspaces:
 * while a workspace is open the menu knows the other folders by name only (`todayx.workspaces`).
 *
 * The demo or real mark of a folder is known only once it has been opened in this session (the
 * mark is inside the encrypted workspace); until then no mark is drawn. The marks live in memory.
 */

import { useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../app/WorkspaceMenu';
import { readWorkspaceFolders, type ComputerPort } from '../screens/first-run/this-computer.ts';

/** Switching is offered to seats that can lock the engine itself (owner, cofounder): another seat's lock is
 *  local only, so the engine would stay open and refuse to open a second workspace. */
export const canSwitch = (role: string | undefined): boolean => role === 'owner' || role === 'cofounder';

/** The folders on this computer, read once per open workspace when switching is allowed. */
export function useWorkspaceFolders(rpc: ComputerPort, enabled: boolean, key: string): readonly string[] {
  const [folders, setFolders] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!enabled) { setFolders([]); return; }
    let live = true;
    void readWorkspaceFolders(rpc).then(found => { if (live) setFolders(found.map(item => item.folder)); });
    return () => { live = false; };
  }, [rpc, enabled, key]);
  return folders;
}

/**
 * The menu's list. The open folder, when the host knows which it is, carries the workspace's own
 * name; every other folder its folder name. A mark is drawn only when known.
 */
export function menuWorkspaces(folders: readonly string[], open: { readonly folder: string | null; readonly name: string }, marks: ReadonlyMap<string, boolean>): WorkspaceEntry[] {
  return folders.map(folder => {
    const demo = marks.get(folder);
    return { id: folder, name: folder === open.folder ? open.name : folder, ...(demo !== undefined ? { demo } : {}) };
  });
}

export interface SwitchHost {
  /** The controller's lock: local at once, then the engine's, retried, never failing open. */
  lock(): Promise<void>;
}

/**
 * Switch to `folder`: choose it for the lock screen first, so the very next screen is that
 * folder's lock, then lock the open workspace. The same folder is not a switch.
 */
export function switchWorkspace(host: SwitchHost, folder: string, open: string | null, choose: (folder: string) => void): boolean {
  if (folder === open || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(folder)) return false;
  choose(folder);
  void host.lock();
  return true;
}
