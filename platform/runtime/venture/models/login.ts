// Chausar venture launcher, models (wave 6, 6C1; DECISIONS D12): Connect your AI starts each tool's OWN official login
// as a child process and shows the owner what that tool prints: Codex's device code and link (`codex login --device-auth`)
// and Claude Code's sign-in page (`claude auth login`). Chausar never reads, copies or forwards a login file, token or
// password: the tool writes its own login where it always does. Sign-in state comes only from the tool's own status
// command (`codex login status`, `claude auth status`), matched against fixed phrases (as cli-status.ts does) and then
// dropped. A tool that already says it is signed in is never asked to sign in again, so the owner's login is untouched.
//
// Each process starts the located program itself (an absolute .exe on Windows, or node with Codex's npm entry script),
// with an argument array, no shell, the tool's minimal environment (cliEnv: no keys), in an empty folder made for it.
// A login is stopped when the owner cancels, when it fails, after fifteen minutes (Codex's code expiry), or when the
// draft desk clears.
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, check } from '../../contracts.ts';
import type { DelegateCli } from '../contracts.ts';
import { cliEnv } from './cli.ts';
import { CLI_COMMANDS, locateOnThisComputer, startableProgram } from './cli-look.ts';
import { CODEX_NPM_ENTRY, NPM_SHIM_FILE, resolveNpmShim } from './npm-shim.ts';
import { CLI_LABELS } from './presets.ts';

import type { LoginState, ToolLogin, ToolView, ToolsView } from '../core/first-run-types.ts';

export type { LoginState, ToolLogin, ToolView, ToolsView } from '../core/first-run-types.ts';

export type LoginLaunch = { cli: DelegateCli; command: string; args: string[]; env: Record<string, string>; cwd: string };
type Readable = { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
export type LoginChild = {
  stdout: Readable | null; stderr: Readable | null; stdin?: { end(): void } | null;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): boolean;
};
export type LoginDeskOptions = {
  spawn?: (launch: LoginLaunch) => LoginChild;
  locate?: (command: string) => string | null;
  platform?: NodeJS.Platform;
  claudeTerms?: 'accepted' | 'pending' | undefined;
  /** How long a status answer is reused, so a two-second poll does not start a process every time. */
  statusCacheMs?: number;
  /** How long a login may wait for the owner: Codex's device code expires in fifteen minutes. */
  loginTimeoutMs?: number;
};

export const LOGIN_TIMEOUT_MS = 15 * 60_000;
const STATUS_TIMEOUT_MS = 8_000;
const READ_CHARS = 8_192;
const CLIS: readonly DelegateCli[] = ['codex', 'claude-code'];
/** The login and status arguments of each tool's own commands. */
const COMMANDS: Readonly<Record<DelegateCli, { login: string[]; status: string[] }>> = Object.freeze({
  codex: { login: ['login', '--device-auth'], status: ['login', 'status'] },
  'claude-code': { login: ['auth', 'login'], status: ['auth', 'status'] },
});
/** The only sites a sign-in link may point at. Anything else the output says is never shown. */
const LINK_HOSTS: Readonly<Record<DelegateCli, readonly string[]>> = Object.freeze({
  codex: ['auth.openai.com', 'chatgpt.com'],
  'claude-code': ['claude.ai', 'claude.com', 'console.anthropic.com'],
});
/** The fixed phrases of cli-status.ts: signed out wins; signed in also needs a clean exit. */
const SIGNED_OUT: readonly RegExp[] = [/\bnot (?:logged|signed) in\b/i, /"loggedIn"\s*:\s*false\b/];
const SIGNED_IN: readonly RegExp[] = [/^\s*(?:logged|signed) in\b/im, /"loggedIn"\s*:\s*true\b/];
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const DEVICE_CODE = /code\b[^\n]*\n?\s*([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/;

const WORDS = Object.freeze({
  line: 'Chausar starts each tool\'s own sign-in. It never sees your password or login files.',
  notInstalled: (label: string) => `Install ${label} with its own installer, then check again.`,
  failed: (label: string) => `${label} stopped before you finished signing in. Try again.`,
  timedOut: (label: string) => `The ${label} sign-in timed out. Start it again.`,
  terms: 'Claude Code is switched off on this computer.',
  noProgram: (label: string) => `${label} is on this computer in a form Chausar does not start. Sign in inside ${label} itself.`,
});

/** The sign-in link (on the tool's own site only) and, for Codex, the one-time code, from what the tool printed. */
export function parseLoginOutput(cli: DelegateCli, output: string): { link: string | null; code: string | null } {
  const text = output.replace(ANSI, '');
  let link: string | null = null;
  for (const match of text.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const url = new URL(match[0]);
      if (!url.username && !url.password && LINK_HOSTS[cli].includes(url.hostname) && url.href.length <= 2000) { link = url.href; break; }
    } catch { /* not a link */ }
  }
  const code = cli === 'codex' && link ? DEVICE_CODE.exec(text)?.[1] ?? null : null;
  return { link, code };
}

function signedInFrom(text: string, ok: boolean): ToolView['signedIn'] {
  if (SIGNED_OUT.some(pattern => pattern.test(text))) return 'no';
  return ok && SIGNED_IN.some(pattern => pattern.test(text)) ? 'yes' : 'unknown';
}

type Program = { command: string; lead: string[] };
type Running = { child: LoginChild; folder: string; output: string; timer: ReturnType<typeof setTimeout> };

/** One per draft desk: the logins in flight and the last status of each tool. */
export class LoginDesk {
  readonly options: LoginDeskOptions;
  #logins = new Map<DelegateCli, ToolLogin>();
  #running = new Map<DelegateCli, Running>();
  #status = new Map<DelegateCli, { at: number; value: ToolView['signedIn'] }>();

  constructor(options: LoginDeskOptions = {}) { this.options = options; }

  #clis(): DelegateCli[] { return CLIS.filter(cli => cli !== 'claude-code' || this.options.claudeTerms !== 'pending'); }

  #program(cli: DelegateCli): Program | null {
    const platform = this.options.platform ?? process.platform;
    const locate = this.options.locate ?? ((command: string) => locateOnThisComputer(command));
    let path: string | null;
    try { path = locate(CLI_COMMANDS[cli]); } catch { path = null; }
    if (!path) return null;
    if (cli === 'codex' && NPM_SHIM_FILE.test(path)) {
      const shim = resolveNpmShim(path, locate, CODEX_NPM_ENTRY, platform);
      return shim ? { command: shim.program, lead: [shim.script] } : { command: '', lead: [] };
    }
    return startableProgram(path, platform) ? { command: path, lead: [] } : { command: '', lead: [] };
  }

  #spawn(cli: DelegateCli, program: Program, args: string[], cwd: string): LoginChild {
    const launch: LoginLaunch = { cli, command: program.command, args: [...program.lead, ...args], env: cliEnv(cli === 'codex' ? 'codex-cli' : 'claude-cli'), cwd };
    if (this.options.spawn) return this.options.spawn(launch);
    return nodeSpawn(launch.command, launch.args, { cwd, env: launch.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as LoginChild;
  }

  /** The tool's own status command, its answer matched and dropped. Unknown on any failure to answer. */
  async #signedIn(cli: DelegateCli, program: Program, fresh = false): Promise<ToolView['signedIn']> {
    const cached = this.#status.get(cli);
    const keep = this.options.statusCacheMs ?? 3_000;
    if (!fresh && cached && Date.now() - cached.at < keep) return cached.value;
    const folder = mkdtempSync(join(tmpdir(), 'chausar-login-check-'));
    const value = await new Promise<ToolView['signedIn']>(resolve => {
      let text = '', settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (answer: ToolView['signedIn']) => { if (!settled) { settled = true; clearTimeout(timer); resolve(answer); } };
      let child: LoginChild;
      try { child = this.#spawn(cli, program, COMMANDS[cli].status, folder); } catch { done('unknown'); return; }
      timer = setTimeout(() => { child.kill(); done('unknown'); }, STATUS_TIMEOUT_MS);
      const read = (chunk: Buffer | string) => { if (text.length < READ_CHARS) text += String(chunk).slice(0, READ_CHARS - text.length); };
      child.stdout?.on('data', read); child.stderr?.on('data', read);
      child.stdin?.end();
      child.on('error', () => done('unknown'));
      child.on('exit', code => done(signedInFrom(text, code === 0)));
    });
    rmSync(folder, { recursive: true, force: true });
    this.#status.set(cli, { at: Date.now(), value });
    return value;
  }

  #login(cli: DelegateCli): ToolLogin {
    return { ...(this.#logins.get(cli) ?? { state: 'idle', code: null, link: null, line: null }) };
  }

  async #view(cli: DelegateCli, fresh = false): Promise<ToolView> {
    const label = CLI_LABELS[cli];
    const program = this.#program(cli);
    if (!program) return { cli, label, found: false, signedIn: 'unknown', login: { state: 'idle', code: null, link: null, line: WORDS.notInstalled(label) } };
    if (!program.command) return { cli, label, found: true, signedIn: 'unknown', login: { state: 'idle', code: null, link: null, line: WORDS.noProgram(label) } };
    const signedIn = await this.#signedIn(cli, program, fresh);
    const login = this.#login(cli);
    // Claude Code's login waits for its page: once its own status says signed in, its process is done.
    if (signedIn === 'yes' && (login.state === 'starting' || login.state === 'waiting')) {
      this.#stop(cli);
      this.#logins.set(cli, { state: 'signed-in', code: null, link: null, line: null });
      return { cli, label, found: true, signedIn, login: this.#login(cli) };
    }
    return { cli, label, found: true, signedIn, login };
  }

  /** venture.ai.tools {}: each tool, whether it is found, its own sign-in state, and any login in flight. */
  async tools(): Promise<ToolsView> {
    const tools: ToolView[] = [];
    for (const cli of this.#clis()) tools.push(await this.#view(cli));
    return { tools, line: WORDS.line };
  }

  /** venture.ai.login.start { cli }: the tool's own login, unless it already says it is signed in. */
  async start(cli: DelegateCli): Promise<ToolView> {
    check(CLIS.includes(cli), 'INVALID_VENTURE_REQUEST', 'Choose Codex or Claude Code.');
    check(cli !== 'claude-code' || this.options.claudeTerms !== 'pending', 'PRESET_UNAVAILABLE', WORDS.terms);
    const label = CLI_LABELS[cli];
    const program = this.#program(cli);
    check(program, 'CLI_UNAVAILABLE', WORDS.notInstalled(label));
    check(program.command, 'CLI_UNAVAILABLE', WORDS.noProgram(label));
    const view = await this.#view(cli, true);
    if (view.signedIn === 'yes' || this.#running.has(cli)) return view;
    const folder = mkdtempSync(join(tmpdir(), 'chausar-login-'));
    let child: LoginChild;
    try { child = this.#spawn(cli, program, COMMANDS[cli].login, folder); }
    catch { rmSync(folder, { recursive: true, force: true }); throw new ChausarError('CLI_UNAVAILABLE', WORDS.failed(label)); }
    const running: Running = { child, folder, output: '', timer: setTimeout(() => this.#end(cli, running, 'failed', WORDS.timedOut(label)), this.options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS) };
    (running.timer as { unref?: () => void }).unref?.();
    this.#running.set(cli, running);
    this.#logins.set(cli, { state: 'starting', code: null, link: null, line: null });
    const read = (chunk: Buffer | string) => {
      if (this.#running.get(cli) !== running || running.output.length >= READ_CHARS) return;
      running.output += String(chunk).slice(0, READ_CHARS - running.output.length);
      const { link, code } = parseLoginOutput(cli, running.output);
      if (link && (cli !== 'codex' || code)) this.#logins.set(cli, { state: 'waiting', code, link, line: null });
    };
    child.stdout?.on('data', read); child.stderr?.on('data', read);
    child.on('error', () => this.#end(cli, running, 'failed', WORDS.failed(label)));
    child.on('exit', code => {
      if (this.#running.get(cli) !== running) return;
      // A clean exit is the tool saying its login finished; its own status confirms it on the next look.
      if (code === 0) { this.#status.delete(cli); this.#end(cli, running, 'signed-in', null); }
      else this.#end(cli, running, 'failed', WORDS.failed(label));
    });
    return { ...view, login: this.#login(cli) };
  }

  /** venture.ai.login.cancel { cli }: stops that tool's login process. */
  async cancel(cli: DelegateCli): Promise<ToolView> {
    check(CLIS.includes(cli), 'INVALID_VENTURE_REQUEST', 'Choose Codex or Claude Code.');
    const running = this.#running.get(cli);
    if (running) this.#end(cli, running, 'cancelled', null);
    return this.#view(cli, true);
  }

  #end(cli: DelegateCli, running: Running, state: LoginState, line: string | null) {
    if (this.#running.get(cli) !== running) return;
    this.#stop(cli);
    this.#logins.set(cli, { state, code: null, link: null, line });
  }

  #stop(cli: DelegateCli) {
    const running = this.#running.get(cli);
    if (!running) return;
    this.#running.delete(cli);
    clearTimeout(running.timer);
    try { running.child.kill(); } catch { /* already gone */ }
    // The tool may still hold its folder for a moment; a failed removal leaves an empty temp folder only.
    try { rmSync(running.folder, { recursive: true, force: true }); } catch { /* empty temp folder */ }
  }

  /** Stops every login and forgets every state (the draft desk was cleared). */
  clear(): void {
    for (const cli of [...this.#running.keys()]) this.#stop(cli);
    this.#logins.clear();
    this.#status.clear();
  }
}
