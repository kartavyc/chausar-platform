// Chausar delivery harness, heavy work: finds the owner's own Claude Code or Codex on this computer and runs it.
// It never installs anything, never logs in and never reads the tool's login: the tool finds its own sign-in in the
// owner's profile. Each run gets a fixed list of arguments, an exact environment (nothing is inherited), standard
// input, a time limit that stops the whole process tree, and a cap on what it may print.
// Ink v2 wave 4 (4J11, H31): no name shaped like a credential ever reaches the tool's environment, and a project .env in
// the work folder may add only allowlisted, non-credential names with plain values; anything odd in it refuses the file.
import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError } from '../../../contracts.ts';
import type { DelegateCli, DelegatePorts, DelegateProcessRequest, DelegateProcessResponse } from '../../contracts.ts';
import { CLI_COMMANDS, locateOnThisComputer } from '../../models/cli-look.ts';

/** Arguments that pass through cmd.exe unchanged: no spaces, quotes, carets, percent signs, pipes or redirects. */
const SAFE_ARGUMENT = /^[A-Za-z0-9_.,:=\/-]+$/;

/**
 * 4J11 (H31): a name that holds, or may hold, a sign-in: ending in KEY, TOKEN or SECRET (any case, so *_KEY, *_TOKEN,
 * *_SECRET and npm's _authToken), or naming a password or credentials anywhere. Such a name never reaches a delegated
 * tool, whatever list it came from. A count such as CLAUDE_CODE_MAX_OUTPUT_TOKENS is not one.
 */
export function isCredentialName(name: string): boolean {
  return /(?:KEY|TOKEN|SECRET)$/i.test(name) || /SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY/i.test(name);
}

/** 4J11 (H31): the only names a project .env may set for a delegated tool: plain settings, never a credential. */
export const DOTENV_ALLOWLIST: readonly string[] = Object.freeze(['TZ', 'LANG', 'LC_ALL', 'NO_COLOR', 'PYTHONIOENCODING', 'PYTHONUTF8']);
const DOTENV_MAX_BYTES = 8 * 1024;
const DOTENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** A plain value: letters, digits and a few marks; no space, quote, $, %, backslash, backtick, ;, &, | or redirect. */
const DOTENV_VALUE = /^[A-Za-z0-9_.,:\/@+-]{0,200}$/;

/**
 * 4J11 (H31): the project .env in a work folder, read as data and never run: one NAME=value per line (an export in front
 * and one pair of matching quotes around the value are allowed), blank lines and # comments. Only allowlisted names load;
 * other names are skipped and listed in refused. Anything odd refuses the whole file and loads nothing: a link or a
 * folder named .env, a file too large or not text, a line that is not NAME=value, a name twice, or a value with a space,
 * a quote inside, $ or % expansion, a backslash, a backtick, a separator (; & |) or a redirect. No .env: nothing at all.
 */
export async function projectEnv(folder: string): Promise<{ env: Record<string, string>; refused: string[] }> {
  const path = join(folder, '.env');
  const none = (why: string) => ({ env: {}, refused: [why] });
  let info;
  try { info = await lstat(path); } catch { return { env: {}, refused: [] }; }
  if (info.isSymbolicLink() || !info.isFile()) return none('.env is not a plain file');
  if (info.size > DOTENV_MAX_BYTES) return none('.env is too large');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)); } catch { return none('.env is not text'); }
  const env: Record<string, string> = {};
  const refused: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(raw) && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(raw)) continue;
    const match = /^(?:export )?([^=]*)=(.*)$/.exec(raw);
    if (!match || !DOTENV_NAME.test(match[1])) return none('.env has a line that is not NAME=value');
    const name = match[1];
    let value = match[2];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    if (!DOTENV_VALUE.test(value)) return none(`.env sets ${name} to something other than a plain value`);
    if (seen.has(name.toUpperCase())) return none(`.env sets ${name} twice`);
    seen.add(name.toUpperCase());
    if (DOTENV_ALLOWLIST.includes(name) && !isCredentialName(name)) env[name] = value;
    else refused.push(name);
  }
  return { env, refused };
}

export type DelegatePortOptions = { pathEnv?: string; platform?: NodeJS.Platform };

/**
 * The first matching executable on the search path, or null: the search the models status makes too
 * (models/cli-look.ts), so both find the same program. On Windows an .exe first (the native installers), then npm's .cmd
 * shim and a .bat; scripts of other kinds are never looked for. Relative entries on the path are skipped.
 */
export async function locateExecutable(cli: DelegateCli, options: DelegatePortOptions = {}): Promise<string | null> {
  const env = options.pathEnv !== undefined ? { PATH: options.pathEnv } : process.env;
  return locateOnThisComputer(CLI_COMMANDS[cli], env, options.platform ?? process.platform);
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
