// A2 review: a tool Chausar starts is stopped with everything it started. On Windows, killing a process leaves its own
// children running (Codex's app-server starts helpers), so the whole tree is ended with taskkill /T /F. Elsewhere the
// tool starts as the leader of its own process group and the group is ended. No shell is used for either.
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join } from 'node:path';

/** Ends a process and every process it started. Never throws. */
export function killTree(pid: number | undefined, platform: NodeJS.Platform = process.platform): void {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    if (platform === 'win32') {
      const system = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
      spawnSync(join(system, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}

/** Starts a program without a shell so that its kill() ends its whole tree. */
export function spawnTree(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  const child = spawn(command, args, { ...options, shell: false, windowsHide: true, ...(process.platform === 'win32' ? {} : { detached: true }) });
  const plain = child.kill.bind(child);
  child.kill = (signal?: NodeJS.Signals | number) => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    killTree(child.pid);
    try { return plain(signal ?? 'SIGKILL'); } catch { return true; }
  };
  return child;
}
