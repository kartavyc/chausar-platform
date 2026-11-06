import { sha256Hex } from '../../hash.ts';
// D5 (founder, 5 Nov): no Chausar installer carries Claude Code. When the owner has none, "Install Claude Code" (the
// first run's Your AI step) downloads Anthropic's official installer only after the owner's yes, shows its progress, runs
// it unmodified, then looks for Claude Code again. The yes is made inside the engine from the click in main's own dialog
// (engine.ts installClaudeCodeFor, mintClaudeInstallYes), fresh and for one use; no request can carry one. Nothing is downloaded without that yes,
// the downloaded bytes are the bytes run (their sha256 is reported), the installer gets no Chausar or secret variable,
// and Chausar never signs in for the owner: the owner opens Claude Code and signs in themselves. Never on the hosted
// web server. The ports are injected so tests never download or start anything. D5 fix: it fails closed. The caller
// passes the ports (the real set is built once, at the wiring), and only an explicit desktop host installs.
import { spawn } from 'node:child_process';

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, check } from '../../contracts.ts';
import { locateOnThisComputer } from './cli-look.ts';

/** Anthropic's documented native installers, by system: the script is downloaded, then run by the system's own shell. */
export const CLAUDE_CODE_INSTALLERS = Object.freeze({
  win32: Object.freeze({ url: 'https://claude.ai/install.ps1', file: 'install.ps1', command: 'powershell.exe', lead: Object.freeze(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']) }),
  linux: Object.freeze({ url: 'https://claude.ai/install.sh', file: 'install.sh', command: '/bin/bash', lead: Object.freeze([]) }),
  darwin: Object.freeze({ url: 'https://claude.ai/install.sh', file: 'install.sh', command: '/bin/bash', lead: Object.freeze([]) }),
} as const);
type InstallerPlatform = keyof typeof CLAUDE_CODE_INSTALLERS;

/** Where a download may come from after redirects: Anthropic's own hosts, over HTTPS only. */
const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*(?:claude\.ai|anthropic\.com)$/i;
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
/** The only variables the installer gets: where things are on this computer, never a key, token or Chausar setting. */
const PASSED_VARIABLES = /^(?:PATH|Path|PATHEXT|SystemRoot|SYSTEMROOT|WINDIR|windir|ComSpec|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|ProgramData|ProgramFiles|ProgramFiles\(x86\)|SHELL|USER|USERNAME|LOGNAME|LANG|LC_ALL|XDG_[A-Z_]+)$/;

export const CLAUDE_INSTALL_WORDS = Object.freeze({
  needsYes: 'Chausar downloads Claude Code only after you say yes.',
  hosted: 'Claude Code is installed on your own computer, not on the web app.',
  unsupported: 'Anthropic has no Claude Code installer for this system.',
  downloadFailed: "Chausar could not download Anthropic's Claude Code installer. Nothing was run. Try again, or install it from claude.ai.",
  failed: "Anthropic's Claude Code installer stopped with an error. Try again, or install it from claude.ai.",
  already: 'Claude Code is already on this computer.',
  installed: 'Claude Code is installed. Open it once in a terminal and sign in yourself; Chausar never signs in for you.',
  notChosen: 'Nothing was downloaded.',
  notFoundAfter: 'The installer finished, but Chausar cannot find Claude Code yet. Restart Chausar, or open a new terminal and run claude.',
});

export type ClaudeInstallStep = 'downloading' | 'installing' | 'checking' | 'done' | 'failed';
export type ClaudeInstallProgress = { step: ClaudeInstallStep; receivedBytes?: number; totalBytes?: number | null };
/** venture.ai.claude.progress: how far the install has come, for the Your AI step; idle before any. */
export type ClaudeInstallView = { step: ClaudeInstallStep | 'idle'; receivedBytes: number; totalBytes: number | null; line: string | null };
export type ClaudeInstallResult = {
  outcome: 'already-installed' | 'installed' | 'not-found-after';
  path: string | null; installerUrl: string | null; installerSha256: string | null; words: string;
};
type DownloadResponse = {
  ok: boolean; status: number; url: string;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
};
export type ClaudeInstallPorts = {
  fetch(url: string, options: { signal: AbortSignal }): Promise<DownloadResponse>;
  run(command: string, args: string[], options: { cwd: string; env: Record<string, string>; timeoutMs: number; windowsHide: true; shell: false }): Promise<{ exitCode: number }>;
  /** Finds Claude Code on this computer: the search path, then the folder Anthropic's installer puts it in. */
  locate(command: 'claude'): string | null;
  tempFolder(): Promise<string>;
};

/** A yes this long after the click is too old to act on. */
export const CLAUDE_INSTALL_YES_FRESH_MS = 5 * 60_000;
/** Every yes the engine has made and whether it is spent. A copy, or anything from a payload, is not in here. */
const MINTED = new WeakMap<object, { at: number; spent: boolean }>();
/** Only engine.ts calls this, when the click in main's own dialog arrives over the worker's host channel. */
export function mintClaudeInstallYes(now: () => number = Date.now): Readonly<{ yes: true; at: string }> {
  const at = now(), yes = Object.freeze({ yes: true as const, at: new Date(at).toISOString() });
  MINTED.set(yes, { at, spent: false });
  return yes;
}
/** Spends the yes: one the engine made, not used before, and fresh. */
function ownerSaidYes(approval: unknown, now: () => number): boolean {
  if (!approval || typeof approval !== 'object') return false;
  const minted = MINTED.get(approval);
  if (!minted || minted.spent) return false;
  const age = now() - minted.at;
  if (!(age >= 0 && age <= CLAUDE_INSTALL_YES_FRESH_MS)) return false;
  minted.spent = true;
  return true;
}

function installerEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) if (typeof value === 'string' && PASSED_VARIABLES.test(name)) result[name] = value;
  return result;
}

async function download(url: string, ports: ClaudeInstallPorts, progress: (step: ClaudeInstallProgress) => void): Promise<Buffer> {
  const failed = () => new ChausarError('CLAUDE_INSTALL_DOWNLOAD_FAILED', CLAUDE_INSTALL_WORDS.downloadFailed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    let response: DownloadResponse;
    try { response = await ports.fetch(url, { signal: controller.signal }); } catch { throw failed(); }
    let final: URL;
    try { final = new URL(response.url || url); } catch { throw failed(); }
    if (!response.ok || response.status !== 200 || final.protocol !== 'https:' || !ALLOWED_HOST.test(final.hostname) || !response.body) throw failed();
    const declared = Number(response.headers.get('content-length'));
    const totalBytes = Number.isSafeInteger(declared) && declared > 0 ? declared : null;
    if (totalBytes !== null && totalBytes > MAX_INSTALLER_BYTES) throw failed();
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    progress({ step: 'downloading', receivedBytes, totalBytes });
    try {
      for await (const chunk of response.body) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_INSTALLER_BYTES) throw failed();
        chunks.push(Buffer.from(chunk));
        progress({ step: 'downloading', receivedBytes, totalBytes });
      }
    } catch (error) { throw error instanceof ChausarError ? error : failed(); }
    if (receivedBytes === 0 || totalBytes !== null && receivedBytes !== totalBytes) throw failed();
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}

/**
 * Installs Claude Code with Anthropic's official installer, after the owner's yes. Already installed: nothing is
 * downloaded. The installer runs hidden, with no shell around it, in a temporary folder removed afterwards.
 */
export async function installClaudeCode(
  request: { approval: unknown; platform: NodeJS.Platform; host: 'desktop' | 'hosted-web' | string; environment?: NodeJS.ProcessEnv; now?: () => number },
  ports: ClaudeInstallPorts,
  onProgress: (progress: ClaudeInstallProgress) => void = () => undefined,
): Promise<ClaudeInstallResult> {
  check(!!ports && typeof ports === 'object' && (['fetch', 'run', 'locate', 'tempFolder'] as const).every(name => typeof ports[name] === 'function'),
    'INVALID_VENTURE_REQUEST', 'Pass the ports that download and run the installer.');
  check(request.host === 'desktop', 'TIER_UNAVAILABLE', CLAUDE_INSTALL_WORDS.hosted);
  check(Object.hasOwn(CLAUDE_CODE_INSTALLERS, request.platform), 'CLAUDE_INSTALL_UNSUPPORTED', CLAUDE_INSTALL_WORDS.unsupported);
  const installer = CLAUDE_CODE_INSTALLERS[request.platform as InstallerPlatform];
  const before = ports.locate('claude');
  if (before) return { outcome: 'already-installed', path: before, installerUrl: null, installerSha256: null, words: CLAUDE_INSTALL_WORDS.already };
  check(ownerSaidYes(request.approval, request.now ?? Date.now), 'CLAUDE_INSTALL_NEEDS_YES', CLAUDE_INSTALL_WORDS.needsYes);
  const progress = (step: ClaudeInstallProgress) => { try { onProgress(step); } catch { /* a progress reader never stops the install */ } };

  const folder = await ports.tempFolder();
  try {
    let script: Buffer;
    try { script = await download(installer.url, ports, progress); }
    catch (error) { progress({ step: 'failed' }); throw error; }
    const installerSha256 = sha256Hex(script);
    const path = join(folder, installer.file);
    await writeFile(path, script, { mode: 0o600 });
    progress({ step: 'installing' });
    let exitCode: number;
    try {
      ({ exitCode } = await ports.run(installer.command, [...installer.lead, path], {
        cwd: folder, env: installerEnvironment(request.environment ?? process.env), timeoutMs: RUN_TIMEOUT_MS, windowsHide: true, shell: false,
      }));
    } catch { exitCode = -1; }
    if (exitCode !== 0) {
      progress({ step: 'failed' });
      throw new ChausarError('CLAUDE_INSTALL_FAILED', CLAUDE_INSTALL_WORDS.failed);
    }
    progress({ step: 'checking' });
    const after = ports.locate('claude');
    progress({ step: 'done' });
    return after
      ? { outcome: 'installed', path: after, installerUrl: installer.url, installerSha256, words: CLAUDE_INSTALL_WORDS.installed }
      : { outcome: 'not-found-after', path: null, installerUrl: installer.url, installerSha256, words: CLAUDE_INSTALL_WORDS.notFoundAfter };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** What the real ports call on this computer: Node's own spawn and fetch unless a test swaps in recorders (D5 fix). */
export type ClaudeInstallSystem = {
  spawn?: (command: string, args: readonly string[], options: { cwd: string; env: Record<string, string>; shell: false; windowsHide: true; stdio: 'ignore' })
    => { once(event: 'error' | 'exit', listener: (value?: any) => void): unknown; kill(): unknown };
  fetch?: (url: string, init: { signal: AbortSignal; redirect: 'manual' }) => Promise<{ ok: boolean; status: number; url: string; headers: { get(name: string): string | null }; body: unknown }>;
};

/** The real ports: Node's fetch, a hidden process with no shell, the search path and the installer's own folder. */
export function defaultClaudeInstallPorts(system?: ClaudeInstallSystem): ClaudeInstallPorts {
  const missing = () => { throw new Error('test port not set'); };
  const run = system === undefined ? spawn : system.spawn ?? missing;
  const get = system === undefined ? fetch : system.fetch ?? missing;
  return {
    async fetch(url, { signal }) {
      for (let hop = 0; hop <= 5; hop++) {
        const address = new URL(url);
        if (address.protocol !== 'https:' || !ALLOWED_HOST.test(address.hostname) || address.username || address.password) throw new Error('Installer address refused');
        const response = await get(url, { signal, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, body: response.body as unknown as AsyncIterable<Uint8Array> | null };
        }
        await (response.body as { cancel?: () => Promise<void> } | null)?.cancel?.();
        const location = response.headers.get('location');
        if (!location || hop === 5) throw new Error('Installer redirect refused');
        url = new URL(location, url).href;
      }
      throw new Error('Installer redirect refused');
    },
    run(command, args, options) {
      return new Promise(resolve => {
        const child = run(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } resolve({ exitCode: -1 }); }, options.timeoutMs);
        child.once('error', () => { clearTimeout(timer); resolve({ exitCode: -1 }); });
        child.once('exit', code => { clearTimeout(timer); resolve({ exitCode: code ?? -1 }); });
      });
    },
    locate(command) {
      try { const found = locateOnThisComputer(command); if (found) return found; } catch { /* not on the search path */ }
      // Anthropic's installer puts it in ~/.local/bin, which a running Chausar's search path may not hold yet.
      const known = join(homedir(), '.local', 'bin', process.platform === 'win32' ? `${command}.exe` : command);
      return existsSync(known) ? known : null;
    },
    tempFolder: () => mkdtemp(join(tmpdir(), 'chausar-claude-install-')),
  };
}
