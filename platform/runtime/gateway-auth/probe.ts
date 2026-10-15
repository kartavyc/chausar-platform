/**
 * models.probe (SH-09, FR-05): the plain state of each model route, found on this computer only.
 *
 * A probe never sends business data and never contacts a paid provider. It looks for an installed CLI on the PATH,
 * whether an API route holds its key, and the last dispatch the gateway recorded. A deep probe (owner, in the app)
 * also runs the CLI's own `--version` (and Codex's `login status`) and asks a local Ollama for its model list on the
 * loopback address. It never retries, never switches route and never reads or stores a subscription token.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { ChausarError } from '../contracts.ts';

export type RouteState = 'ready' | 'ready-unverified' | 'signed-out' | 'not-installed' | 'version-not-tested' | 'timed-out' | 'error' | 'off' | 'skipped-send-nothing' | 'demo-disabled';
export type ProbeRun = (command: string, args: string[], timeoutMs: number) => Promise<{ exitCode: number | null; timedOut: boolean; stdout: string }>;
export type ProbeHttp = (url: string, timeoutMs: number) => Promise<{ status: number; body: string } | 'refused' | 'timed-out'>;
export type ProbePorts = { run: ProbeRun; http: ProbeHttp; which: (command: string) => Promise<string | null> };

const OUTPUT_LIMIT = 4096;
/** Only these words of a CLI's own output are kept: a version number, nothing else. */
const VERSION = /\b(\d{1,4}\.\d{1,4}(?:\.\d{1,6})?(?:-[0-9A-Za-z.]{1,32})?)\b/;

export const realRun: ProbeRun = (command, args, timeoutMs) => new Promise(resolve => {
  let stdout = ''; let done = false;
  const finish = (exitCode: number | null, timedOut: boolean) => { if (done) return; done = true; clearTimeout(timer); resolve({ exitCode, timedOut, stdout }); };
  let child: ReturnType<typeof spawn>;
  try { child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', USERPROFILE: process.env.USERPROFILE ?? '' } : {}) } }); }
  catch { resolve({ exitCode: null, timedOut: false, stdout: '' }); return; }
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } finish(null, true); }, timeoutMs);
  child.stdout!.on('data', chunk => { if (stdout.length < OUTPUT_LIMIT) stdout += String(chunk).slice(0, OUTPUT_LIMIT - stdout.length); });
  child.on('error', () => finish(null, false));
  child.on('close', code => finish(code, false));
});

export const realHttp: ProbeHttp = async (url, timeoutMs) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)) throw new ChausarError('PROBE_NOT_LOCAL', 'Only a model on this computer is asked directly.');
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const body = (await response.text()).slice(0, 256 * 1024);
    return { status: response.status, body };
  } catch (error) { return (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError' ? 'timed-out' : 'refused'; }
};

export async function realWhich(command: string): Promise<string | null> {
  const candidates = isAbsolute(command) ? [command] : (process.env.PATH ?? '').split(delimiter).filter(dir => isAbsolute(dir))
    .flatMap(dir => (process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']).map(ext => join(dir, command + ext)));
  for (const path of candidates) {
    try { if ((await stat(path)).isFile()) { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return path; } } catch { /* not here */ }
  }
  return null;
}

export const realPorts: ProbePorts = { run: realRun, http: realHttp, which: realWhich };

export type ProbedRoute = {
  routeId: string; kind: string; label: string; order: number; state: RouteState;
  /** The few words SH-09 shows, in English; the screen has its own catalogue keyed by `state`. */
  reason: string;
  version: string | null; signIn: { kind: 'cli'; command: string } | { kind: 'key' } | null;
  lastFailure: { code: string; at: string } | null; checkedAt: string; deep: boolean;
};

const REASONS: Record<RouteState, string> = {
  ready: 'Ready.', 'ready-unverified': 'Set up. It has not answered a question yet.', 'signed-out': 'Signed out. Sign in again.',
  'not-installed': 'Not installed on this computer.', 'version-not-tested': 'Installed, but this version has not been tested with Chausar.',
  'timed-out': 'Did not answer in time.', error: 'The last attempt failed.', off: 'Turned off.',
  'skipped-send-nothing': 'Skipped: Send is set to nothing, so no route is used.', 'demo-disabled': 'Model routes are off in the demo.',
};

const SAFE_FAILURE = /^[A-Z][A-Z0-9_]{1,63}$/;
export async function probeRoute(route: any, input: { order: number; send: string; demo: boolean; deep: boolean; receipts: any[]; codexEvidence: string | null; ports: ProbePorts }): Promise<ProbedRoute> {
  const checkedAt = new Date().toISOString();
  const last = input.receipts.filter(r => r?.kind === 'model-preview' && r.routeId === route.id && typeof r.dispatchedAt === 'string')
    .sort((a, b) => String(b.dispatchedAt).localeCompare(String(a.dispatchedAt)))[0];
  const lastFailure = last?.status === 'failed' ? { code: SAFE_FAILURE.test(String(last.errorCode)) ? String(last.errorCode) : 'MODEL_FAILED', at: String(last.completedAt ?? last.dispatchedAt) } : null;
  const cli = String(route.kind).endsWith('-cli');
  const base = { routeId: String(route.id), kind: String(route.kind), label: typeof route.label === 'string' ? route.label : `${route.kind} ${route.model}`, order: input.order,
    version: null as string | null, signIn: null as ProbedRoute['signIn'], lastFailure, checkedAt, deep: input.deep };
  const done = (state: RouteState, extra: Partial<ProbedRoute> = {}): ProbedRoute => ({ ...base, state, reason: REASONS[state], ...extra });
  if (input.demo) return done('demo-disabled');
  if (!route.enabled) return done('off');
  if (input.send === 'nothing') return done('skipped-send-nothing');
  if (cli) {
    const command = typeof route.command === 'string' ? route.command : route.kind === 'codex-cli' ? 'codex' : 'claude';
    const signIn = { kind: 'cli' as const, command: route.kind === 'codex-cli' ? 'codex login' : 'claude' };
    const found = await input.ports.which(command);
    if (!found) return done('not-installed', { signIn });
    let version: string | null = null;
    if (input.deep) {
      const ran = await input.ports.run(found, ['--version'], 10_000);
      if (ran.timedOut) return done('timed-out', { signIn });
      if (ran.exitCode !== 0) return done('error', { signIn });
      version = VERSION.exec(ran.stdout)?.[1] ?? null;
      if (route.kind === 'codex-cli') {
        // The tool's own status command; only its exit code is read.
        const status = await input.ports.run(found, ['login', 'status'], 10_000);
        if (status.timedOut) return done('timed-out', { version, signIn });
        if (status.exitCode !== 0) return done('signed-out', { version, signIn });
      }
    }
    if (lastFailure) return done('error', { version, signIn });
    const tested = route.kind === 'codex-cli' && input.codexEvidence === 'installed-help';
    return done(tested ? 'ready-unverified' : 'version-not-tested', { version, signIn });
  }
  if (route.kind === 'ollama') {
    if (input.deep) {
      let origin: string;
      try { origin = new URL(String(route.endpoint)).origin; } catch { return done('error'); }
      const reply = await input.ports.http(`${origin}/api/tags`, 5_000).catch(() => 'refused' as const);
      if (reply === 'refused') return done('not-installed');
      if (reply === 'timed-out') return done('timed-out');
      if (reply.status !== 200) return done('error');
      let names: string[] = [];
      try { const body = JSON.parse(reply.body); names = Array.isArray(body?.models) ? body.models.map((m: any) => m?.name).filter((n: unknown) => typeof n === 'string') : []; } catch { return done('error'); }
      if (!names.some(name => name === route.model || name === `${route.model}:latest`)) return done('not-installed');
      return lastFailure ? done('error') : done('ready');
    }
    return lastFailure ? done('error') : done('ready-unverified');
  }
  // API key routes: the key is held by the engine or the credential broker; it is never shown or tested against the provider here.
  if (!route.credentialConfigured) return done('signed-out', { signIn: { kind: 'key' } });
  if (lastFailure) return done(lastFailure.code === 'CREDENTIAL_REQUIRED' ? 'signed-out' : 'error', lastFailure.code === 'CREDENTIAL_REQUIRED' ? { signIn: { kind: 'key' } } : {});
  return done(last?.status === 'completed' ? 'ready' : 'ready-unverified');
}
