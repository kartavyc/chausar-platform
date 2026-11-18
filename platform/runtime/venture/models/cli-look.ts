// Chausar venture launcher, package P2 (models), Ink v2 wave 4 (4H1 review, S2-7): the look at the owner's Claude Code
// or Codex that the models status (cli-status.ts) and heavy work (delivery/harness/delegate.ts) share, so the two can
// never disagree about the same tool: which command names it, where the search path has it, what its --version must
// print to count as that tool, which program a look may start, and the Claude Code terms rule. A leaf module: it reads
// the file system to find a command and never starts anything.
import { statSync } from 'node:fs';
import { delimiter, join, posix, win32 } from 'node:path';
import type { DelegateCli } from '../contracts.ts';

/** The command each tool answers to on the search path. */
export const CLI_COMMANDS: Readonly<Record<DelegateCli, string>> = Object.freeze({ 'claude-code': 'claude', codex: 'codex' });
/** On Windows: the native installers' .exe, then npm's .cmd shim and a .bat, in that order. Nothing else is looked for. */
export const WINDOWS_CLI_EXTENSIONS: readonly string[] = Object.freeze(['.exe', '.cmd', '.bat']);

const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };
const absolute = (path: string, platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix).isAbsolute(path);

/**
 * A command on this computer: an absolute path where it says, else the first match on the search path, trying the
 * extensions above in each folder on Windows. Relative search path entries are skipped. Never runs anything.
 */
export function locateOnThisComputer(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (absolute(command, platform)) return isFile(command) ? command : null;
  const pathKey = Object.keys(env).find(name => /^path$/i.test(name));
  const search = pathKey ? env[pathKey] : undefined;
  if (!search) return null;
  const windows = platform === 'win32';
  const names = windows ? WINDOWS_CLI_EXTENSIONS.map(extension => `${command}${extension}`) : [command];
  for (const entry of search.split(windows ? ';' : delimiter)) {
    const folder = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!folder || !absolute(folder, platform)) continue;
    for (const name of names) {
      const candidate = join(folder, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

const isFolder = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };
/**
 * Where the tools' own installers and the usual package managers put a command on macOS and Linux: under the owner's
 * home folder first, then the two shared folders. Fixed names only; nothing is read from a setting or a file.
 */
const HOME_TOOL_FOLDERS: readonly string[][] = [['.local', 'bin'], ['.claude', 'local'], ['.npm-global', 'bin'], ['.bun', 'bin'], ['.volta', 'bin']];
const SHARED_TOOL_FOLDERS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin'];
/**
 * The search path with the usual install folders added after the owner's own, or null when there is nothing to add. A
 * desktop app opened from the Dock or a launcher is given a short search path that leaves these folders out, so
 * neither tool was found there although both were installed (seen on macOS, 11 Nov 2026). Only folders that exist are
 * added, never on Windows (its installers put the tools on the search path themselves), and the owner's own folders
 * stay first, so a tool they chose still wins.
 */
export function withToolFolders(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = isFolder): string | null {
  if (platform === 'win32') return null;
  const current = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const home = typeof env.HOME === 'string' && posix.isAbsolute(env.HOME) ? env.HOME : null;
  const known = [...(home ? HOME_TOOL_FOLDERS.map(parts => join(home, ...parts)) : []), ...SHARED_TOOL_FOLDERS];
  const added = known.filter(folder => !current.includes(folder) && exists(folder));
  return added.length ? [...current, ...added].join(delimiter) : null;
}
/** At engine start: this process, and so every tool it looks for or starts, gets the fuller search path. */
export function addToolFolders(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): void {
  const path = withToolFolders(env, platform);
  if (path !== null) env.PATH = path;
}

/**
 * The version a tool's --version printed, only in the form the real tool prints it on its first line: 'x.y.z (Claude
 * Code)' or 'codex-cli x.y.z', a pre-release or build suffix allowed. Anything else is null: not that tool.
 */
export function cliVersionOf(cli: DelegateCli, output: string): string | null {
  const line = output.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const match = cli === 'claude-code'
    ? /^(\d{1,4}\.\d{1,4}\.\d{1,6})(?:[-+][\w.-]+)?\s+\(Claude Code\)$/.exec(line)
    : /^codex-cli (\d{1,4}\.\d{1,4}\.\d{1,6})(?:[-+][\w.-]+)?$/.exec(line);
  return match ? match[1] : null;
}

/**
 * Claude Code is enabled by default (wave 6 D13). An explicit pending override prevents any run,
 * including its version check. Codex is not behind this switch.
 */
export function cliGateOpen(cli: DelegateCli, claudeTerms: 'accepted' | 'pending' | undefined): boolean {
  return cli !== 'claude-code' || claudeTerms !== 'pending';
}

/**
 * A program a look may start without a shell: an absolute path, and on Windows an .exe only. A command script (.cmd,
 * .bat, .ps1) needs a shell to run, and the models transport never starts one.
 */
export function startableProgram(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return absolute(path, platform) && (platform !== 'win32' || /\.exe$/i.test(path));
}
