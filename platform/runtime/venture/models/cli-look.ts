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
 * The Claude Code terms gate (onboarding spec 2.8): until the trusted host says 'accepted', nothing of Claude Code is
 * run, not even its version. Codex is not behind it.
 */
export function cliGateOpen(cli: DelegateCli, claudeTerms: 'accepted' | 'pending' | undefined): boolean {
  return cli !== 'claude-code' || claudeTerms === 'accepted';
}

/**
 * A program a look may start without a shell: an absolute path, and on Windows an .exe only. A command script (.cmd,
 * .bat, .ps1) needs a shell to run, and the models transport never starts one.
 */
export function startableProgram(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return absolute(path, platform) && (platform !== 'win32' || /\.exe$/i.test(path));
}
