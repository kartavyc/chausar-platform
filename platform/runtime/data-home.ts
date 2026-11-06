// D3: where developer data lives. Three kinds of output, three homes: the data home (here: servers and a worker run by
// hand), the run root (run-root.mjs: test receipts, the screenshot walk) and per-test temp folders (mkdtemp). Neither
// home is ever inside the code folder. The run-root and refusal logic is one source, run-root.mjs, shared with the
// scripts; this module re-exports it with the engine's own error class. No import.meta.url path: it works the same from
// a bundle (D7).
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { ChausarError, InternalError } from './portable.ts';
import { checkoutOf, defaultRunRoot, localDay, outputFile, refuseInsideRepo as refuseCore, runRoot as runRootCore, type RunEnv } from './run-root.mjs';

export { checkoutOf, defaultRunRoot, localDay, outputFile };

/** The data kinds. Demo and real never share a folder. */
export const DATA_KINDS = ['local-web', 'local-web-demo', 'hosted', 'worker'] as const;
export type DataKind = typeof DATA_KINDS[number];

export type DataHomeOptions = { env?: RunEnv; platform?: NodeJS.Platform; home?: string };

/** The core's refusal, re-thrown as the engine's ChausarError (same code and words). */
function engineError<T>(run: () => T): T {
  try { return run(); }
  catch (error) {
    const found = error as { code?: unknown; message?: string };
    if (typeof found?.code === 'string' && !(error instanceof ChausarError) && ['DATA_INSIDE_REPO', 'RUN_NAME_INVALID', 'OUTPUT_INVALID'].includes(found.code)) throw new ChausarError(found.code, found.message ?? found.code);
    throw error;
  }
}

/** Refuses a folder inside this checkout (DATA_INSIDE_REPO) unless CHAUSAR_ALLOW_REPO_DATA=1; returns it resolved. */
export function refuseInsideRepo(path: string, options: { env?: RunEnv; variable?: string; fallback?: string } = {}): string {
  return engineError(() => refuseCore(path, options));
}

/** CHAUSAR_RUN_ROOT/<name>, else <temp>/chausar-runs/<YYYY-MM-DD>-<name>; never inside the checkout. */
export function runRoot(name: string, options: { env?: RunEnv; now?: () => Date; temp?: string } = {}): string {
  return engineError(() => runRootCore(name, options));
}

/** The per-user folder for a kind: Windows %LOCALAPPDATA%\Chausar\dev, macOS Application Support, else XDG data. */
export function userDataHome(kind: DataKind, { env = process.env, platform = process.platform, home = homedir() }: DataHomeOptions = {}): string {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Chausar', 'dev', kind);
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'Chausar', 'dev', kind);
  return posix.join(env.XDG_DATA_HOME || posix.join(home, '.local', 'share'), 'chausar', 'dev', kind);
}

/**
 * Where a server or a worker keeps its data: the kind's own variable first (CHAUSAR_HOSTED_DATA for hosted,
 * CHAUSAR_VAULT_DIRECTORY for the others), then CHAUSAR_HOME/<kind>, then the per-user folder. Refused inside this
 * checkout. A path for another system (a test's injected platform) is returned unchecked: it is not on this disk.
 */
export function dataHome(kind: DataKind, options: DataHomeOptions = {}): string {
  if (!DATA_KINDS.includes(kind)) throw new ChausarError('DATA_HOME_KIND_INVALID', 'The data home kinds are local-web, local-web-demo, hosted and worker.');
  const env = options.env ?? process.env, platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const fallback = userDataHome(kind, { ...options, env, platform });
  const own = kind === 'hosted' ? 'CHAUSAR_HOSTED_DATA' : 'CHAUSAR_VAULT_DIRECTORY';
  const [chosen, variable] = env[own] ? [path.resolve(env[own]!), own] : env.CHAUSAR_HOME ? [path.join(env.CHAUSAR_HOME, kind), 'CHAUSAR_HOME'] : [fallback, 'CHAUSAR_HOME'];
  if (platform !== process.platform) return chosen;
  return refuseInsideRepo(chosen, { env, variable, fallback });
}

/** The local web server's data folder: CHAUSAR_VAULT_DIRECTORY, else the data home (the demo kind for --demo). */
export function serverDataDirectory(environment: NodeJS.ProcessEnv = process.env, args: readonly string[] = process.argv): string {
  return dataHome(args.includes('--demo') ? 'local-web-demo' : 'local-web', { env: environment });
}

/**
 * The desktop worker's data folder: CHAUSAR_VAULT_DIRECTORY, which the desktop app always sets (Electron's
 * userData/vaults). Started by hand without it, the worker refuses rather than writing to a quiet default.
 */
export function workerDataDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const folder = environment.CHAUSAR_VAULT_DIRECTORY;
  if (!folder) throw new InternalError('WORKER_NEEDS_DATA_FOLDER', 'The engine worker needs CHAUSAR_VAULT_DIRECTORY. The desktop app sets it; when you start the worker by hand, set it to a folder outside the code folder.');
  return refuseInsideRepo(folder, { env: environment, variable: 'CHAUSAR_VAULT_DIRECTORY' });
}
