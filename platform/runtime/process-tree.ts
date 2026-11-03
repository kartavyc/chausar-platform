// A2 review: a tool Chausar starts is stopped with everything it started. On Windows, killing a process leaves its own
// children running (Codex's app-server starts helpers), so the whole tree is ended with taskkill /T /F. Elsewhere the
// tool starts as the leader of its own process group and the group is ended. No shell is used for either.
// A2 second review: a tool that ends on its own is not allowed to leave its helpers behind either. Elsewhere its group is
// ended as soon as it exits. On Windows a helper whose parent has gone is no longer in any tree, so the processes whose
// parent was the tool and that started while the tool ran are found and ended (sweepAfterExit). Node itself already puts
// every child it starts into one kill-on-close job held by the engine, so nothing outlives the engine unless it broke
// away from that job; a job per tool would need a native call, and is not used (see the A2 notes).
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join } from 'node:path';

const systemFolder = () => process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';

/** Ends a process and every process it started. Never throws. */
export function killTree(pid: number | undefined, platform: NodeJS.Platform = process.platform): void {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    if (platform === 'win32') {
      spawnSync(join(systemFolder(), 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}

/**
 * A2 second review: after a tool exited, ends what it left running. Elsewhere: its process group. On Windows: each process
 * whose parent id is the tool's and that was created between the tool's start and its exit (so a later process that got
 * the same id, and anything it starts, is never touched), with its own tree. The Windows search runs one fixed
 * PowerShell command with only numbers and times in it, in the background. Never throws.
 */
export function sweepAfterExit(pid: number | undefined, startedAt: Date, endedAt: Date, platform: NodeJS.Platform = process.platform): void {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return;
  if (platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* the group is gone */ }
    return;
  }
  const system = systemFolder();
  const taskkill = join(system, 'System32', 'taskkill.exe').replace(/'/g, "''");
  const time = (date: Date) => `[datetime]::Parse('${date.toISOString()}', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()`;
  const script = `$s = ${time(startedAt)}; $e = ${time(endedAt)}; Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | Where-Object { $c = $_.CreationDate.ToUniversalTime(); $c -ge $s -and $c -le $e } | ForEach-Object { & '${taskkill}' /PID $_.ProcessId /T /F 2>&1 | Out-Null }`;
  try {
    const sweeper = spawn(join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore', shell: false });
    sweeper.on('error', () => undefined);
    sweeper.unref();
  } catch { /* best effort */ }
}

/**
 * How spawnTree cleans up. sweepAfterMs: on Windows, the search after an exit (which starts PowerShell) runs only for a
 * tool that ran at least this long; a quick check that answered at once is not searched. Elsewhere the group is always
 * ended. 0 (the default) searches after every exit.
 */
export type TreeOptions = { sweepAfterMs?: number };

/** Starts a program without a shell so that its kill() ends its whole tree, and its own exit leaves nothing behind. */
export function spawnTree(command: string, args: readonly string[], options: SpawnOptions, tree: TreeOptions = {}): ChildProcess {
  const startedAt = new Date();
  const child = spawn(command, args, { ...options, shell: false, windowsHide: true, ...(process.platform === 'win32' ? {} : { detached: true }) });
  const plain = child.kill.bind(child);
  child.kill = (signal?: NodeJS.Signals | number) => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    killTree(child.pid);
    try { return plain(signal ?? 'SIGKILL'); } catch { return true; }
  };
  child.once('exit', () => {
    const endedAt = new Date();
    if (process.platform !== 'win32' || endedAt.getTime() - startedAt.getTime() >= (tree.sweepAfterMs ?? 0)) sweepAfterExit(child.pid, startedAt, endedAt);
  });
  return child;
}
