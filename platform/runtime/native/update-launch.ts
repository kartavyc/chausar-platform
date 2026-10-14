import { createHash } from 'node:crypto';
import { copyFile, chmod, lstat, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check, ChausarError } from '../contracts.ts';
import type { ReleaseManifest } from '../updater.ts';
import { InstallLayout, artifactKind, type InstallPointer, type LaunchDecision } from './update-install.ts';
import { resolveInstalledLaunch } from './update-service.ts';

/**
 * The resolver behind the launcher stub (scripts/release/launcher/chausar-launcher.sh).
 *
 * The person starts `<installRoot>/chausar-launcher`. The stub runs this file with an installed
 * Chausar executable in Node mode (ELECTRON_RUN_AS_NODE=1), preferring the last committed version
 * while a new one is on trial, so a broken new build cannot break its own rollback. `resolve` calls
 * `resolveInstalledLaunch()` from update-service.ts (one counted trial launch; after MAX_TRIAL_LAUNCHES unconfirmed
 * launches the pointer returns to the previous version) and prints the executable to start. The
 * engine commits the trial once a workspace opens (`confirmInstalledTrial`, from the release module).
 *
 *   resolve --install-root <dir> [--executable-name chausar]
 *   adopt   --install-root <dir> --archive <Chausar-x.y.z-linux-x64.tar.gz> --version <x.y.z> [--launcher <chausar-launcher.sh>]
 */
export type LaunchTarget = Readonly<{ decision:LaunchDecision; executable:string }>;
export type TrialConfirmation = 'confirmed' | 'already-committed' | 'not-installed' | 'other-version';
const EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

async function regularExecutable(path:string):Promise<boolean> {
  try { const stat = await lstat(path); return stat.isFile() && !stat.isSymbolicLink() && (process.platform === 'win32' || (stat.mode & 0o100) !== 0); }
  catch (error:any) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
}
/**
 * The app executable inside one version directory: `<dir>/<name>`, or `<dir>/<top>/<name>` for an
 * archive with one top-level folder (electron-builder's tar.gz and zip), or a single `*.AppImage`.
 */
export async function findAppExecutable(versionDirectory:string, name = 'chausar'):Promise<string> {
  check(isAbsolute(versionDirectory) && EXECUTABLE.test(name), 'LAUNCH_EXECUTABLE_INVALID', 'Name the app executable plainly.');
  const direct = join(versionDirectory, name);
  if (await regularExecutable(direct)) return direct;
  const items = await readdir(versionDirectory, { withFileTypes: true });
  const folders = items.filter(item => item.isDirectory() && !item.name.startsWith('.'));
  if (folders.length === 1 && await regularExecutable(join(versionDirectory, folders[0].name, name))) return join(versionDirectory, folders[0].name, name);
  const images = items.filter(item => item.isFile() && /\.AppImage$/i.test(item.name));
  if (images.length === 1 && await regularExecutable(join(versionDirectory, images[0].name))) return join(versionDirectory, images[0].name);
  check(false, 'LAUNCH_EXECUTABLE_MISSING', 'The installed version holds no app executable.');
}
/** One counted launch: resolves the pointer (rolling back an unconfirmed trial) and finds its executable. */
export async function resolveLaunchTarget(installRoot:string, name = 'chausar'):Promise<LaunchTarget> {
  // Resolving never creates an install root that is not there.
  try { await lstat(join(installRoot, 'current.json')); } catch (error:any) { check(error.code !== 'ENOENT' && error.code !== 'ENOTDIR', 'LAUNCH_NOT_INSTALLED', 'No Chausar version is installed here yet.'); throw error; }
  // The service's rule: never roll back automatically past a raised data-schema marker.
  const decision = await resolveInstalledLaunch({ installRoot });
  check(decision, 'LAUNCH_NOT_INSTALLED', 'No Chausar version is installed here yet.');
  // A trial past its launches with nothing to return to still starts: it is the only version there is.
  return Object.freeze({ decision, executable: await findAppExecutable(decision.directory, name) });
}
/**
 * Commits the version on trial when it is the running version. Called by the engine (release module)
 * after a workspace opened, which is the health signal; idempotent and silent when nothing is on trial.
 */
export async function confirmInstalledTrial(installRoot:string, runningVersion:string):Promise<TrialConfirmation> {
  const layout = new InstallLayout({ installRoot });
  const pointer:InstallPointer|null = await layout.pointer();
  if (!pointer) return 'not-installed';
  if (pointer.version !== runningVersion) return 'other-version';
  if (pointer.state === 'committed') return 'already-committed';
  await layout.confirmHealthy(runningVersion);
  return 'confirmed';
}
/**
 * First install from an archive the person downloaded and checked: unpacks it as `versions/<version>`,
 * commits it and places the launcher stub in the install root. Later versions arrive through the updater.
 */
export async function adoptArchive(options:{ installRoot:string; archive:string; version:string; launcher?:string }):Promise<Readonly<{ version:string; directory:string; launcher:string|null }>> {
  check(isAbsolute(options.installRoot) && isAbsolute(options.archive), 'UNSAFE_UPDATE_PATH', 'Use absolute install and archive paths.');
  const bytes = await readFile(options.archive), info = artifactKind(pathToFileURL(options.archive).href);
  check(info.kind !== 'appimage', 'LAUNCH_ARCHIVE_REQUIRED', 'The launcher needs an unpacked app; install the tar.gz or zip release.');
  const manifest:ReleaseManifest = { schemaVersion: 1, version: options.version, publishedAt: new Date().toISOString(), platform: process.platform as ReleaseManifest['platform'],
    architecture: process.arch as ReleaseManifest['architecture'], url: pathToFileURL(options.archive).href, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    minEngineVersion: options.version, dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
  const layout = new InstallLayout({ installRoot: options.installRoot }), installed = await layout.install(options.archive, manifest);
  await layout.confirmHealthy(options.version);
  let launcher:string|null = null;
  if (options.launcher) {
    launcher = join(options.installRoot, 'chausar-launcher');
    await copyFile(options.launcher, launcher); await chmod(launcher, 0o755);
  }
  return Object.freeze({ version: installed.version, directory: installed.directory, launcher });
}

function argumentsOf(argv:string[], allowed:string[]):Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    check(allowed.includes(argv[index]) && argv[index + 1] !== undefined && !values.has(argv[index]), 'LAUNCH_USAGE', 'Usage: update-launch.ts resolve --install-root <dir> [--executable-name chausar] | adopt --install-root <dir> --archive <file> --version <x.y.z> [--launcher <file>]');
    values.set(argv[index], argv[index + 1]);
  }
  return values;
}
/** Command line used by the launcher stub. Prints `key=value` lines; one path per line, never shell-evaluated. */
export async function main(argv:string[]):Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'resolve') {
      const values = argumentsOf(rest, ['--install-root', '--executable-name']);
      const root = values.get('--install-root');
      check(root && isAbsolute(root), 'LAUNCH_USAGE', 'Pass the absolute install root.');
      const target = await resolveLaunchTarget(resolve(root), values.get('--executable-name') ?? 'chausar');
      check(!/[\r\n]/.test(target.executable), 'LAUNCH_EXECUTABLE_INVALID', 'The app path cannot hold a line break.');
      const d = target.decision;
      process.stdout.write(`version=${d.version}\nstate=${d.state}\nattempts=${d.attempts}\nrolledBack=${d.rolledBack}\nrolledBackFrom=${d.rolledBackFrom ?? ''}\nrollbackUnavailable=${d.rollbackUnavailable}\nexecutable=${target.executable}\n`);
      return 0;
    }
    if (command === 'adopt') {
      const values = argumentsOf(rest, ['--install-root', '--archive', '--version', '--launcher']);
      const root = values.get('--install-root'), archive = values.get('--archive'), version = values.get('--version'), launcher = values.get('--launcher');
      check(root && archive && version && isAbsolute(root) && isAbsolute(archive) && (launcher === undefined || isAbsolute(launcher)), 'LAUNCH_USAGE', 'Pass absolute install root and archive paths and the version.');
      const adopted = await adoptArchive({ installRoot: resolve(root), archive: resolve(archive), version, launcher });
      process.stdout.write(`version=${adopted.version}\ndirectory=${adopted.directory}\nlauncher=${adopted.launcher ?? ''}\n`);
      return 0;
    }
    check(false, 'LAUNCH_USAGE', 'Use the resolve or adopt command.');
  } catch (error) {
    // A fixed code and sentence only; never paths or outside text.
    const code = error instanceof ChausarError ? error.code : 'LAUNCH_FAILED';
    process.stderr.write(`Chausar launcher: ${code}: ${error instanceof ChausarError ? error.message : 'The launch could not be resolved.'}\n`);
    return error instanceof ChausarError && error.code === 'LAUNCH_USAGE' ? 64 : 70;
  }
}
/** The packaged location of this file relative to an app executable (Linux/Windows layout). */
export const resolverPath = (appDirectory:string) => join(appDirectory, 'resources', 'app.asar.unpacked', 'platform', 'runtime', 'native', basename(fileURLToPath(import.meta.url)));
export const launcherSource = () => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'release', 'launcher', 'chausar-launcher.sh');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
