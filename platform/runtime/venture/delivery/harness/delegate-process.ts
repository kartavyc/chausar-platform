// Chausar delivery harness, heavy work: finds the owner's own Claude Code or Codex on this computer and runs it.
// It never installs anything, never logs in and never reads the tool's login: the tool finds its own sign-in in the
// owner's profile. Each run gets a fixed list of arguments, an exact environment (nothing is inherited), standard
// input, a time limit that stops the whole process tree, and a cap on what it may print.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { ChausarError } from '../../../contracts.ts';
import type { DelegateCli, DelegatePorts, DelegateProcessRequest, DelegateProcessResponse } from '../../contracts.ts';

const NAMES: Readonly<Record<DelegateCli, string>> = { 'claude-code': 'claude', codex: 'codex' };
/** On Windows an npm install leaves a .cmd shim; the native installers leave an .exe. Scripts of other kinds are never run. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];
/** Arguments that pass through cmd.exe unchanged: no spaces, quotes, carets, percent signs, pipes or redirects. */
const SAFE_ARGUMENT = /^[A-Za-z0-9_.,:=\/-]+$/;

export type DelegatePortOptions = { pathEnv?: string; platform?: NodeJS.Platform };

async function regularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/** The first matching executable on the search path, or null. Relative entries on the path are skipped. */
export async function locateExecutable(cli: DelegateCli, options: DelegatePortOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const pathEnv = options.pathEnv ?? process.env.PATH ?? process.env.Path ?? '';
  const names = platform === 'win32' ? WINDOWS_EXTENSIONS.map(ext => `${NAMES[cli]}${ext}`) : [NAMES[cli]];
  for (const directory of pathEnv.split(delimiter)) {
    const folder = directory.trim().replace(/^"(.*)"$/, '$1');
    if (!folder || !isAbsolute(folder)) continue;
    for (const name of names) {
      const candidate = join(folder, name);
      if (await regularFile(candidate)) return candidate;
    }
  }
  return null;
}

function isShim(command: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
}

/** Stops the tool and everything it started. */
function stopTree(pid: number | undefined, platform: NodeJS.Platform) {
  if (pid === undefined) return;
  try {
    if (platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/** Runs one request. A .cmd shim goes through cmd.exe with every argument checked to pass through it unchanged. */
export function runDelegateProcess(request: DelegateProcessRequest, platform: NodeJS.Platform = process.platform): Promise<DelegateProcessResponse> {
  for (const arg of request.args) {
    if (!SAFE_ARGUMENT.test(arg)) return Promise.reject(new ChausarError('TIER_UNAVAILABLE', 'Chausar refused to start the tool: an argument had characters it does not pass on.'));
  }
  const shim = isShim(request.command, platform);
  const command = shim ? (request.env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe') : request.command;
  const args = shim ? ['/d', '/s', '/c', `"${[`"${request.command}"`, ...request.args.map(arg => `"${arg}"`)].join(' ')}"`] : request.args;
  return new Promise(resolve => {
    let stdout = '', stderr = '', truncated = false, timedOut = false, settled = false;
    const child = spawn(command, args, {
      cwd: request.cwd, env: request.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
      windowsVerbatimArguments: shim, detached: platform !== 'win32',
    });
    const take = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) + chunk.length > request.maxOutputBytes) { truncated = true; return current; }
      return current + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = take(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = take(stderr, chunk); });
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, truncated });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child.pid, platform);
      // A tool that ignores the stop still ends the wait.
      setTimeout(() => finish(null), 5000).unref();
    }, request.timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', code => finish(timedOut ? null : code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(request.stdin);
  });
}

/** The real port: the search path of the engine's own environment, and the process runner above. */
export function createDelegatePorts(options: DelegatePortOptions = {}): DelegatePorts {
  return {
    locate: cli => locateExecutable(cli, options),
    process: request => runDelegateProcess(request, options.platform ?? process.platform),
  };
}
