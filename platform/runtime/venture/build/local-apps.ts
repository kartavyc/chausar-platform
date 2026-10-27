// Chausar connectors: the owner's own local apps (Ink v2 wave 5, package 5A6, catalogue K13). Apps the owner installed
// themselves (BaoCut, Kimo, FilmCraft) are connectors through their public command line only: Chausar never installs,
// bundles or downloads one (BaoCut's licence bars bundling its code, binaries or skill text; driving its public CLI is
// allowed). An app found on PATH is labelled write; one not found is planned, with the manual path "Install it
// yourself; Chausar never installs it."; the hosted app runs none. One exit-code contract for every app:
//   0 done; 1 failed; 2 action required, with {"remedy", "next"} on standard output, which becomes a Today row until a
//   later run works; 3 not available; 4 bad arguments, or an irreversible command without --yes, refused.
// Before anything runs: only Chausar adds --yes, so a caller's --yes is refused; any command other than asking the
// app's version or help may change something, so it runs only as the exact command the owner approved, journalled
// ('connector.write', operation 'local-app-run'), and only then with --yes. On a real order the localapp.run tool's
// call is that approval: the taint latch holds every call that writes until the owner approves exactly that call. In a
// rehearsal only the version and help run. The app runs without a shell, with a short environment and a time limit;
// what it prints is untrusted and screened before an agent reads it.
// The exit-code envelope follows BaoCut's apps/cli/src/envelope.ts as a public interface only (learn-only by licence:
// nothing copied); Kimo (MIT) and FilmCraft (MIT or Apache-2.0) are driven the same way.
import { check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { LocalAppRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, exactPayload, listRecords, readVenture, ventureAction } from '../records.ts';
import { journalled } from '../journal/journal.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { runCapped } from '../../capped-run.ts';
import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { W4RowItem } from '../views/queue-w4.ts';
import type { LocalAppId, LocalAppNeeds, LocalAppPort, LocalAppRun, LocalAppsView, LocalAppView } from './records-connect.ts';

type LocalApp = { id: LocalAppId; name: string; binary: string; note: string; licence: string };

export const LOCAL_APPS: readonly LocalApp[] = Object.freeze([
  { id: 'baocut', name: 'BaoCut', binary: 'baocut', note: 'Video cutting and dubbing on this computer, through its public command line.',
    licence: 'Source-available (BaoCut Community License): Chausar never bundles it and drives only a copy you installed.' },
  { id: 'kimo', name: 'Kimo', binary: 'kimo', note: 'Transcripts and captions on this computer, through its command line.', licence: 'MIT' },
  { id: 'filmcraft', name: 'FilmCraft', binary: 'filmcraft', note: 'Video editing on this computer, through its command line.', licence: 'MIT or Apache-2.0' },
]);
export const LOCAL_APP_IDS: readonly LocalAppId[] = Object.freeze(LOCAL_APPS.map(app => app.id));

export const LOCAL_APP_WORDS = Object.freeze({
  manualPath: 'Install it yourself; Chausar never installs it.',
  hosted: 'Apps on your computer run only in the desktop app.',
  noYes: 'Only Chausar adds --yes, and only to the exact command you approved.',
  needsApproval: 'This command may change something, so it runs only as the exact command you approve.',
  refused: (name: string) => `${name} refused the command: its arguments were wrong, or it can't be undone and was not confirmed.`,
  unavailable: (name: string) => `${name} says this is not available right now.`,
  failed: (name: string) => `${name} could not do it.`,
  notFound: (name: string) => `${name} is not installed on this computer. Install it yourself; Chausar never installs it.`,
});

/** The commands that change nothing: asking the app its version or its help. Everything else waits for the owner. */
const READ_ONLY: ReadonlySet<string> = new Set(['--version', '--help', 'version', 'help', '-V', '-h']);
export const LOCAL_APP_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_LIMIT = 256 * 1024;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The environment an app gets: where programs and temporary files are, and the language. No key, no Chausar setting. */
function shortEnv(): Record<string, string | undefined> {
  const keep = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];
  return Object.fromEntries(keep.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
}

/**
 * An app's program on PATH that a spawn without a shell can start, or null: only absolute PATH folders (a relative
 * one would resolve against wherever Chausar happens to run), and on Windows only PATHEXT's own program kinds, never
 * .bat or .cmd, which need a shell. Never installs anything.
 */
export function locateApp(name: string, env: Record<string, string | undefined> = process.env, platform: string = process.platform): string | null {
  const key = (wanted: string) => Object.keys(env).find(item => item.toUpperCase() === wanted);
  const pathKey = key('PATH');
  const value = pathKey ? env[pathKey] : undefined;
  if (!value) return null;
  const windows = platform === 'win32';
  const extKey = key('PATHEXT');
  const exts = windows
    ? ((extKey ? env[extKey] : undefined) ?? '.COM;.EXE').split(';').filter(ext => ext && !/^\.(?:bat|cmd)$/i.test(ext))
    : [''];
  for (const dir of value.split(windows ? ';' : ':').filter(Boolean)) {
    if (!isAbsolute(dir) || (windows && !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(dir))) continue;
    for (const ext of exts) {
      for (const candidate of windows ? [name + ext.toLowerCase(), name + ext] : [name]) {
        const path = join(dir, candidate);
        try { if (statSync(path).isFile()) return path; } catch { /* not here */ }
      }
    }
  }
  return null;
}

/** The real port: PATH only, no shell, the capped runner. */
export const systemLocalApps: LocalAppPort = Object.freeze({
  locate: (binary: string) => locateApp(binary),
  run: async (path: string, args: readonly string[], timeoutMs: number): Promise<LocalAppRun> => {
    const result = await runCapped({ command: path, args, env: shortEnv(), timeoutMs, stdoutLimit: OUTPUT_LIMIT, stderrLimit: 4096 });
    return { code: result.end === 'closed' ? result.exitCode : null, stdout: result.stdout, stderr: result.stderr, timedOut: result.end === 'timeout', startError: result.startError };
  },
});

const portOf = (deps: VentureDeps) => deps.localApps ?? systemLocalApps;

export function localApp(id: unknown): LocalApp {
  const app = LOCAL_APPS.find(item => item.id === id);
  check(app, 'INVALID_VENTURE_REQUEST', `Choose one of: ${LOCAL_APPS.map(item => item.name).join(', ')}.`);
  return app;
}

/** The command as given, checked: at most 20 plain arguments, no --yes from anyone but Chausar. */
export function commandOf(args: unknown): string[] {
  check(Array.isArray(args) && args.length <= 20 && args.every(arg => typeof arg === 'string' && arg.length >= 1 && arg.length <= 200 && !CONTROL.test(arg)),
    'INVALID_VENTURE_REQUEST', 'Give the command as up to 20 plain arguments.');
  const list = args as string[];
  if (list.some(arg => arg === '--yes' || arg === '-y' || arg.startsWith('--yes='))) throw new ChausarError('LOCAL_APP_REFUSED', LOCAL_APP_WORDS.noYes);
  return [...list];
}

/** Whether a command only asks the app its version or its help. */
export const readOnlyCommand = (args: readonly string[]) => args.length === 1 && READ_ONLY.has(args[0]);
/** How a command reads to the owner: the program and its arguments, quoted where a space is. */
export const commandLine = (app: LocalApp, args: readonly string[]) => [app.binary, ...args].map(arg => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(' ');

/** Untrusted words from an app for the owner or an agent: screened, one line, at most 300 characters; null when held. */
function screened(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const result = screenUntrusted({ source: 'tool-output', text: text.replace(/\s+/g, ' ').trim().slice(0, 300) }, { mode: 'enforce' });
  return result.status === 'quarantined' ? null : result.text;
}

/** What an exit 2 asked for: {remedy, next} from standard output. */
function needsOf(stdout: string): { remedy: string; next: string | null } {
  let parsed: { remedy?: unknown; next?: unknown } = {};
  try { parsed = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '{}'); } catch { /* no envelope: the plain words below */ }
  return { remedy: screened(parsed.remedy) ?? 'It asks you to do something first. Open it to see what.', next: screened(parsed.next) };
}

/** What one run did: its output when it worked, else the refusal in Chausar's words. */
export type LocalAppResult = { exit: number; output: unknown; line: string };

/** Records the app's last run, and what it asked of the owner (cleared by a run that worked), in its own commit. */
async function recordRun(deps: VentureDeps, ctx: Context, app: LocalApp, command: string, exit: number | null, line: string, needs: LocalAppNeeds | null): Promise<void> {
  await ventureAction(deps, ctx, 'prepare', 'localapp.run', tx => {
    const old = tx.list('venture-local-app').find(record => record.app === app.id);
    const keepNeeds = exit === 0 ? null : needs ?? old?.needs ?? null;
    const body = { app: app.id, lastRun: { at: tx.now, command, exit, line }, needs: keepNeeds };
    if (old) tx.replace<LocalAppRecord>({ ...old, ...body }); else tx.put<LocalAppRecord>({ ...tx.base('venture-local-app'), ...body });
    if (needs) tx.emit('queue.changed', {});
  });
}

/** Runs one command and reads its exit by the contract. Throws the refusal for 1 to 4; answers the output for 0. */
async function runOnce(deps: VentureDeps, ctx: Context, app: LocalApp, path: string, argv: readonly string[], shown: string): Promise<LocalAppResult> {
  const run = await portOf(deps).run(path, argv, LOCAL_APP_TIMEOUT_MS);
  // It never started (the program went, or cannot be started without a shell): nothing ran.
  if (run.startError !== null && run.code === null && !run.timedOut) {
    const line = `${app.name} did not start on this computer (${run.startError.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20)}). Nothing ran.`;
    await recordRun(deps, ctx, app, shown, null, line, null);
    throw new ChausarError('LOCAL_APP_NOT_FOUND', line);
  }
  const exit = run.code;
  if (exit === 0) {
    let output: unknown = run.stdout;
    try { output = JSON.parse(run.stdout); } catch { /* plain text */ }
    const line = `${app.name} did it.`;
    await recordRun(deps, ctx, app, shown, 0, line, null);
    return { exit: 0, output, line };
  }
  if (exit === 2) {
    const asked = needsOf(run.stdout);
    const now = deps.clock().toISOString();
    const line = `${app.name} needs you first: ${asked.remedy}`;
    await recordRun(deps, ctx, app, shown, 2, line, { remedy: asked.remedy, next: asked.next, at: now, command: shown });
    throw new ChausarError('LOCAL_APP_NEEDS_YOU', `${line}${asked.next ? ` Then: ${asked.next}` : ''}`);
  }
  const [code, line] = exit === 3 ? ['LOCAL_APP_UNAVAILABLE', LOCAL_APP_WORDS.unavailable(app.name)] as const
    : exit === 4 ? ['LOCAL_APP_REFUSED', LOCAL_APP_WORDS.refused(app.name)] as const
      : ['LOCAL_APP_FAILED', `${LOCAL_APP_WORDS.failed(app.name)}${run.timedOut ? ' It ran past its time and was stopped.' : ''}`] as const;
  await recordRun(deps, ctx, app, shown, exit, line, null);
  throw new ChausarError(code, line);
}

/** Where the app is on this computer, or the refusal: never on the hosted app, never installed by Chausar. */
function located(deps: VentureDeps, app: LocalApp): string {
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', LOCAL_APP_WORDS.hosted);
  const path = portOf(deps).locate(app.binary);
  check(path, 'LOCAL_APP_NOT_FOUND', LOCAL_APP_WORDS.notFound(app.name));
  return path;
}

/**
 * A command that changes nothing (the app's version or help), run as it is, without --yes. Any other command is
 * refused before it runs: it waits for the owner's approval of that exact command (runApprovedLocalApp).
 */
export async function runReadOnlyLocalApp(deps: VentureDeps, ctx: Context, input: { app: unknown; args: unknown }): Promise<LocalAppResult> {
  const app = localApp(input.app);
  const args = commandOf(input.args);
  if (!readOnlyCommand(args)) throw new ChausarError('LOCAL_APP_REFUSED', LOCAL_APP_WORDS.needsApproval);
  const path = located(deps, app);
  return runOnce(deps, ctx, app, path, args, commandLine(app, args));
}

/**
 * The exact command the owner approved, inside the app: journalled as one write to a connected service whose line is
 * the command, and only then run, with --yes added by Chausar. The journal's digest is the command's, so another
 * command is another approval. A run that did not finish is outcome unknown, never run again on its own.
 */
export async function runApprovedLocalApp(deps: VentureDeps, ctx: Context, input: { app: unknown; args: unknown }): Promise<LocalAppResult> {
  const app = localApp(input.app);
  const args = commandOf(input.args);
  const path = located(deps, app);
  const shown = commandLine(app, args);
  const commandDigest = digest(`${app.id}\n${JSON.stringify(args)}`);
  let refusal: unknown = null;
  const done = await journalled<LocalAppResult | null>(deps, ctx, {
    action: 'connector.write', operation: 'local-app-run', subject: `localapp:${app.id}:${commandDigest.slice(0, 16)}:${Date.parse(deps.clock().toISOString())}`,
    target: `${app.name} on this computer`, actionDigest: commandDigest, line: `Run ${shown} --yes`.slice(0, 300), descriptionComplete: shown.length <= 290,
  }, async () => {
    try {
      const result = await runOnce(deps, ctx, app, path, [...args, '--yes'], `${shown} --yes`);
      return { outcome: 'applied', line: result.line, value: result, by: 'platform' };
    } catch (error) {
      refusal = error;
      const code = (error as { code?: string }).code;
      // The app answered and did nothing (needs you, unavailable, refused), or never started: known not to have happened.
      if (code === 'LOCAL_APP_NEEDS_YOU' || code === 'LOCAL_APP_UNAVAILABLE' || code === 'LOCAL_APP_REFUSED' || code === 'LOCAL_APP_NOT_FOUND') return { outcome: 'not-sent', line: (error as Error).message, value: null, by: 'platform' };
      return { outcome: 'unknown', line: (error as Error).message ?? LOCAL_APP_WORDS.failed(app.name), value: null };
    }
  });
  if (refusal) throw refusal;
  return done.value!;
}

// ---------------------------------------------------------------------------
// venture.localApps.list and Today's rows
// ---------------------------------------------------------------------------

function viewOf(deps: VentureDeps, state: State, venture: VentureRecord, app: LocalApp, hosted: boolean): LocalAppView {
  const found = !hosted && portOf(deps).locate(app.binary) !== null;
  const record = listRecords(state, 'venture-local-app', venture.id).find(item => item.app === app.id);
  return {
    id: app.id, name: app.name, label: found ? 'write' : 'planned: write', found, licence: app.licence,
    note: hosted ? LOCAL_APP_WORDS.hosted : found ? `${app.note} Found on this computer. Anything that changes something runs only as the exact command you approve.` : app.note,
    manualPath: found ? null : LOCAL_APP_WORDS.manualPath, needs: record?.needs ?? null,
  };
}

/** venture.localApps.list {} (read): each app Chausar can drive, found here or planned, and what one asked of the owner. */
export async function localAppsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LocalAppsView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  const hosted = deps.host === 'hosted-web';
  const apps = LOCAL_APPS.map(app => viewOf(deps, state, venture, app, hosted));
  const found = apps.filter(app => app.found).length;
  const line = hosted ? LOCAL_APP_WORDS.hosted : found ? `${found} of your apps ${found === 1 ? 'is' : 'are'} on this computer.` : 'None of these apps is on this computer.';
  return { apps, hosted, line };
}

/** Today's notice rows: an app that asked the owner to do something (exit 2), until a later run of it works. */
export function localAppRows(state: State, venture: VentureRecord): W4RowItem[] {
  return listRecords(state, 'venture-local-app', venture.id).filter(record => record.needs).map(record => {
    const app = localApp(record.app);
    const needs = record.needs!;
    return {
      kind: 'notice' as const, subject: `localapp:${record.app}`, version: needs.at.replace(/[^0-9]/g, ''), createdAt: needs.at,
      title: `${app.name} needs you`, line: `${needs.remedy}${needs.next ? ` Then: ${needs.next}` : ''}`,
      actions: [{ id: 'later' as const, label: 'Later', primary: false }, { id: 'open' as const, label: 'Open Connections', primary: true }],
      navigate: `Open Connections to see what ${app.name} asked.`,
    };
  });
}
