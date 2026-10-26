// Chausar venture launcher, package P2 (models), Ink v2 wave 4 (4H1): the owner's own Claude Code and Codex, checked
// against what is installed on this computer. Evidence only: where the search path has the tool, the version its
// --version prints in the real tool's own form (cli-look.ts, shared with heavy work), whether its --help lists every flag
// the route sends (cliRouteFlags in cli.ts) but the few it takes without listing (CLI_UNLISTED_FLAGS, from evidence:
// Claude Code's --max-turns), and its sign-in only from a status command the tool's own help lists, read for a fixed
// phrase and dropped at once. Each look starts only the program the search path has (an absolute .exe on Windows, or
// node with Codex's entry script for npm's standard shim), never a bare name, in an empty folder made for that look,
// through the model transport: an argument array, no shell, a time limit, and only the first few thousand characters
// read. While the Claude Code terms are pending, Claude Code is only located, never run. It never reads a sign-in file,
// a token or a key, never keeps or shows what a status command printed, and never says "signed in" without that
// evidence. The hosted app never looks at all.
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import type { State } from '../../contracts.ts';
import type { CliFinding, CliStatusView, DelegateCli, Display, IsoTime, ModelAvailability, ModelTransport } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { CLI_UNLISTED_FLAGS, cliEnv, cliRouteFlags, codexCommand, type CodexHost } from './cli.ts';
import { CLI_COMMANDS, cliGateOpen, cliVersionOf, startableProgram } from './cli-look.ts';
import { CODEX_NPM_ENTRY, NPM_SHIM_FILE, resolveNpmShim } from './npm-shim.ts';
import { AVAILABILITY_REASONS, CLI_LABELS, cliFlagsWords, cliNamed, cliSignedOutWords, type CliWords } from './presets.ts';
import { VERSION_CHECK_TIMEOUT_MS } from './types.ts';

export { locateOnThisComputer } from './cli-look.ts';

/** --help and the sign-in status command each get five seconds. */
export const HELP_TIMEOUT_MS = 5_000;
export const STATUS_TIMEOUT_MS = 5_000;
/** The empty folder each look runs its checks in, made in the temp folder and removed after. */
export const CLI_LOOK_PREFIX = 'chausar-cli-look-';
/** How much of each answer is read: a help page is long; a version line and a sign-in line are short. */
const HELP_READ_CHARS = 65_536;
const SHORT_READ_CHARS = 4_096;

export const CLI_STATUS_WORDS = Object.freeze({
  hosted: 'The hosted app uses keys only.',
  noPort: "Chausar can't look for command-line tools here.",
});

const ROUTE_KINDS: Readonly<Record<DelegateCli, 'claude-cli' | 'codex-cli'>> = Object.freeze({ 'claude-code': 'claude-cli', codex: 'codex-cli' });
/** Codex's route flags are its exec command's; Claude Code lists its flags and its commands on one help page. */
const FLAG_HELP: Readonly<Record<DelegateCli, string[]>> = Object.freeze({ 'claude-code': ['--help'], codex: ['exec', '--help'] });
/** The sign-in status command, run only when the tool's own top help lists the command it belongs to. */
const STATUS_COMMANDS: Readonly<Record<DelegateCli, { listed: RegExp; args: string[] }>> = Object.freeze({
  'claude-code': { listed: /^[ \t]{1,8}auth\b/m, args: ['auth', 'status'] },
  codex: { listed: /^[ \t]{1,8}login\b/m, args: ['login', 'status'] },
});
/** The fixed phrases. Signed out wins over signed in; signed in also needs a clean exit. Anything else is unknown. */
const SIGNED_OUT: readonly RegExp[] = [/\bnot (?:logged|signed) in\b/i, /"loggedIn"\s*:\s*false\b/];
const SIGNED_IN: readonly RegExp[] = [/^\s*(?:logged|signed) in\b/im, /"loggedIn"\s*:\s*true\b/];
/** A Windows command script: the model transport starts programs without a shell, so it never runs one of these. */
const SCRIPT_SHIM = /\.(?:cmd|bat|ps1)$/i;
const SCRIPT_FIX: Readonly<Record<DelegateCli, string>> = Object.freeze({
  'claude-code': 'Install Claude Code with its own installer, then check again, or use an Anthropic key.',
  codex: "Set Codex up through Chausar's reviewed Codex setup, which names the Codex program itself, or use an OpenAI key.",
});
const FLAG = /--[A-Za-z0-9][A-Za-z0-9-]*/g;

/**
 * What one look needs: the transport that runs the tool, the search, Codex's reviewed host profile, the terms gate, the
 * clock, and the system the rules are for (this computer's unless a test names one).
 */
export type CliLook = {
  transport: ModelTransport;
  locate: (command: string) => string | null;
  codex: CodexHost | null;
  claudeTerms: 'accepted' | 'pending' | undefined;
  now: () => IsoTime;
  platform?: NodeJS.Platform;
};

type Ran = { ok: boolean; stdout: string; text: string; cut: boolean };
/** The program a look runs, what goes before the check's own arguments (an npm shim's entry script), and its folder. */
type Target = { command: string; lead: string[]; cwd: string | undefined };

/** One check command through the transport. Any failure to start, time out or answer is null. */
async function run(look: CliLook, cli: DelegateCli, target: Target, args: string[], timeoutMs: number, readChars: number): Promise<Ran | null> {
  try {
    const response = await look.transport.process({
      command: target.command, args: [...target.lead, ...args], env: cliEnv(ROUTE_KINDS[cli]), stdin: '', timeoutMs, purpose: 'version-check',
      ...(target.cwd ? { cwd: target.cwd } : {}),
    });
    if (!response || typeof response.exitCode !== 'number') return null;
    const stdout = typeof response.stdout === 'string' ? response.stdout : '';
    const all = `${stdout}\n${typeof response.stderr === 'string' ? response.stderr : ''}`;
    return { ok: response.exitCode === 0, stdout: stdout.slice(0, readChars), text: all.slice(0, readChars), cut: all.length > readChars };
  } catch {
    return null;
  }
}

/** 'yes' only from a fixed signed-in phrase and a clean exit; 'no' from a fixed signed-out phrase; else 'unknown'. */
function signedInFrom(said: Ran | null): CliFinding['signedIn'] {
  if (!said) return 'unknown';
  if (SIGNED_OUT.some(pattern => pattern.test(said.text))) return 'no';
  return said.ok && SIGNED_IN.some(pattern => pattern.test(said.text)) ? 'yes' : 'unknown';
}

/**
 * What a look may start for a found tool, or null when nothing may be: the located program itself when it is startable
 * without a shell (an absolute .exe on Windows), or, for Codex only, node with the entry script of npm's standard shim
 * (npm-shim.ts). Claude Code's model route starts `claude` itself, so a look through its shim would show a tool that
 * every call then fails to start.
 */
function startable(cli: DelegateCli, path: string, look: CliLook, platform: NodeJS.Platform): { command: string; lead: string[]; via?: 'npm-shim' } | null {
  if (cli === 'codex' && NPM_SHIM_FILE.test(path)) {
    const shim = resolveNpmShim(path, look.locate, CODEX_NPM_ENTRY, platform);
    return shim ? { command: shim.program, lead: [shim.script], via: 'npm-shim' } : null;
  }
  return startableProgram(path, platform) ? { command: path, lead: [] } : null;
}

/**
 * Looks at one tool: --version (ten seconds), then its help (five seconds) for the route's flags, then, when the help
 * lists it, its own sign-in status command (five seconds). Only the program the search path has is started, never a
 * bare name, and every check runs in one empty folder made for this look and removed after. Nothing of Claude Code runs
 * behind its terms gate: it is only located, as heavy work does (cli-look.ts). Against a synthetic recording nothing
 * starts at all, and nothing past --version is asked. What the status command printed is only matched against the
 * fixed phrases above; it is not kept.
 */
export async function inspectInstalledCli(cli: DelegateCli, look: CliLook): Promise<CliFinding> {
  const platform = look.platform ?? process.platform;
  const command = cli === 'codex' && look.codex ? codexCommand(look.codex) : CLI_COMMANDS[cli];
  let path: string | null;
  try { path = look.locate(command); } catch { path = null; }
  const finding: CliFinding = {
    cli, at: look.now(), found: path !== null, path, answered: false, version: null, flags: 'unknown', missingFlags: [], signedIn: 'unknown',
    statusCommand: false, profile: cli === 'claude-code' || look.codex !== null, replay: look.transport.replay === true,
  };
  if (!cliGateOpen(cli, look.claudeTerms)) return finding;

  // A synthetic recording starts nothing: it answers the version check for whichever command it is given.
  if (finding.replay) {
    const version = await run(look, cli, { command: path ?? command, lead: [], cwd: undefined }, ['--version'], VERSION_CHECK_TIMEOUT_MS, SHORT_READ_CHARS);
    if (!version || !version.ok || version.stdout.trim().length === 0) return finding;
    return { ...finding, answered: true, found: true, version: cliVersionOf(cli, version.stdout) };
  }
  if (path === null) return finding;
  const program = startable(cli, path, look, platform);
  if (!program) return finding;
  if (program.via) finding.via = program.via;
  let folder: string;
  try { folder = await mkdtemp(join(tmpdir(), CLI_LOOK_PREFIX)); } catch { return finding; }
  // From here the tool itself is started: the line of what ran names it (cliListLine).
  finding.ran = true;
  try {
    return await checksOf(cli, look, { command: program.command, lead: program.lead, cwd: folder }, finding);
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The checks of one look, in its folder: the version in the real tool's own form, the route's flags, the sign-in. */
async function checksOf(cli: DelegateCli, look: CliLook, target: Target, finding: CliFinding): Promise<CliFinding> {
  const version = await run(look, cli, target, ['--version'], VERSION_CHECK_TIMEOUT_MS, SHORT_READ_CHARS);
  // Only the version line the real tool prints counts as its answer (cli-look.ts), as heavy work reads it.
  const named = version && version.ok ? cliVersionOf(cli, version.stdout) : null;
  if (named === null) return finding;
  finding.answered = true;
  finding.version = named;

  const help = await run(look, cli, target, FLAG_HELP[cli], HELP_TIMEOUT_MS, HELP_READ_CHARS);
  if (help && help.ok && help.text.trim().length > 0) {
    const listed = new Set(help.text.match(FLAG) ?? []);
    // A flag the tool takes without listing it (CLI_UNLISTED_FLAGS, from evidence) is not asked of its help page.
    const unlisted = CLI_UNLISTED_FLAGS[ROUTE_KINDS[cli]];
    const missing = cliRouteFlags(ROUTE_KINDS[cli]).filter(flag => !listed.has(flag) && !unlisted.includes(flag));
    // A help page longer than Chausar reads may list a flag past the cut: unknown, never a mismatch it cannot show.
    finding.flags = missing.length === 0 ? 'match' : help.cut ? 'unknown' : 'mismatch';
    finding.missingFlags = finding.flags === 'mismatch' ? missing : [];
  }

  const commands = cli === 'codex' ? await run(look, cli, target, ['--help'], HELP_TIMEOUT_MS, HELP_READ_CHARS) : help;
  if (!commands || !commands.ok || !STATUS_COMMANDS[cli].listed.test(commands.text)) return finding;
  finding.statusCommand = true;
  finding.signedIn = signedInFrom(await run(look, cli, target, STATUS_COMMANDS[cli].args, STATUS_TIMEOUT_MS, SHORT_READ_CHARS));
  return finding;
}

/**
 * The last real task on the tool in this business, from records: a model call through its route (completed or
 * failed, never a replay) or a heavy-work run it did. Null when there is none.
 */
export function lastCliTask(state: State, ventureId: string | null, cli: DelegateCli): CliStatusView['lastTask'] {
  if (!ventureId) return null;
  const presetId = cli === 'claude-code' ? 'claude-code-cli' : 'codex-cli';
  let newest: CliStatusView['lastTask'] = null;
  const consider = (at: IsoTime, outcome: 'succeeded' | 'failed') => { if (!newest || at >= newest.at) newest = { at, outcome }; };
  for (const call of listRecords(state, 'venture-model-call', ventureId)) {
    if (call.presetId !== presetId || call.replay) continue;
    if (call.status === 'completed') consider(call.at, 'succeeded');
    else if (call.status === 'failed') consider(call.at, 'failed');
  }
  for (const run of listRecords(state, 'venture-delegate-run', ventureId)) {
    if (run.cli !== cli || run.outcome === 'cancelled') continue;
    consider(run.at, run.outcome === 'succeeded' ? 'succeeded' : 'failed');
  }
  return newest;
}

type Words = { state: ModelAvailability; line: string; fix: string | null };
const needsSetup = (words: CliWords): Words => ({ state: 'needs-setup', ...words });

/**
 * The state, the one line and the one fix: the terms gate first (nothing of Claude Code is run behind it, so nothing
 * more is known), then the finding, the profile and the last task.
 */
function statusWords(finding: CliFinding, terms: CliStatusView['terms'], lastTask: CliStatusView['lastTask']): Words {
  const label = CLI_LABELS[finding.cli];
  const named = cliNamed(finding.cli, finding.version);
  if (terms === 'pending') return needsSetup({ line: "Chausar hasn't yet accepted Anthropic's terms for running Claude Code.", fix: 'Use an Anthropic key for now.' });
  if (!finding.found) return needsSetup({ line: `${label} isn't installed on this computer.`, fix: `Install ${label} and sign in to it, then check again.` });
  // A command script (an npm .cmd shim on Windows) cannot be started without a shell, and Chausar never uses one.
  if (!finding.answered && finding.path && SCRIPT_SHIM.test(finding.path) && finding.via !== 'npm-shim') {
    return needsSetup({ line: `${label} is on this computer as a command script (${basename(finding.path)}), which Chausar doesn't start.`, fix: SCRIPT_FIX[finding.cli] });
  }
  if (!finding.answered) return needsSetup({ line: `${label} is on this computer but did not answer its version check.`, fix: `Update or reinstall ${label}, then check again.` });
  if (finding.replay) return { state: 'unverified', line: `${label} answered a synthetic recording, not a tool on this computer.`, fix: null };
  if (finding.flags === 'mismatch') return needsSetup(cliFlagsWords(finding.cli, finding.version, finding.missingFlags));
  if (!finding.profile) return needsSetup({ line: `${named} is on this computer. Chausar runs it only through the reviewed Codex setup.`, fix: AVAILABILITY_REASONS.codexMissing });
  if (finding.signedIn === 'no') return needsSetup(cliSignedOutWords(finding.cli, finding.version));
  const parts = [finding.signedIn === 'yes' ? `${named} is on this computer and signed in.` : `${named} is on this computer.`];
  if (finding.flags === 'unknown') parts.push("Chausar couldn't read its help, so its flags are not checked.");
  if (lastTask?.outcome === 'succeeded') return { state: 'ready', line: [...parts, 'Its last task worked.'].join(' '), fix: null };
  if (lastTask?.outcome === 'failed') return { state: 'unverified', line: [...parts, 'Its last task failed.'].join(' '), fix: `Check that you're signed in to ${label}, then try again.` };
  parts.push(finding.signedIn === 'yes' ? 'Not yet tried on a real task.' : "Chausar can't check your sign-in without running a task. It will say so if the first task fails.");
  return { state: 'unverified', line: parts.join(' '), fix: null };
}

/** 'A', 'A and B'. */
const andList = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * 4H2: the one line of what this look ran, naming each tool it started and only the commands it ran on them (version
 * and help always, the sign-in status command only when a tool's help listed one). A tool that was only located (the
 * Claude Code terms gate, a command script, not installed) or answered from a synthetic recording is left out.
 */
export function cliListLine(findings: readonly CliFinding[]): Display {
  const ran = findings.filter(finding => finding.ran === true && !finding.replay);
  if (ran.length === 0) return "Chausar didn't run either tool on this computer.";
  const commands = ran.some(finding => finding.statusCommand) ? 'version, help and sign-in commands' : 'version and help commands';
  const whose = ran.length === 1 ? 'its' : 'their';
  return `Chausar ran only the ${commands} of ${andList(ran.map(finding => CLI_LABELS[finding.cli]))} on this computer. It never reads ${whose} sign-in files or keys.`;
}

/** 4H2: a path inside the owner's home folder, shown from ~ ('~\.local\bin\claude.exe'); any other path as it is. */
export function homePath(path: string | null, home: string = homedir(), platform: NodeJS.Platform = process.platform): string | null {
  if (!path || !home) return path;
  const windows = platform === 'win32';
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  const root = home.endsWith(sep) ? home.slice(0, -1) : home;
  if (same(path, root)) return '~';
  return same(path.slice(0, root.length + 1), `${root}${sep}`) ? `~${path.slice(root.length)}` : path;
}

/**
 * One tool as Your AI shows it. state: 'ready' only once a real task on it worked; 'unverified' while it is found and
 * usable but untried (or its last task failed); 'needs-setup' with the fix otherwise. Never 'signed in' without the
 * tool's own status command saying so.
 */
export function cliStatusView(finding: CliFinding, context: { claudeTerms: 'accepted' | 'pending' | undefined; lastTask: CliStatusView['lastTask'] }): CliStatusView {
  const terms: CliStatusView['terms'] = finding.cli === 'codex' ? 'not-needed' : context.claudeTerms === 'accepted' ? 'accepted' : 'pending';
  return {
    cli: finding.cli, label: CLI_LABELS[finding.cli], found: finding.found, path: homePath(finding.path), version: finding.version, flags: finding.flags,
    missingFlags: [...finding.missingFlags], signedIn: finding.signedIn, terms, lastTask: context.lastTask,
    ...statusWords(finding, terms, context.lastTask),
  };
}
