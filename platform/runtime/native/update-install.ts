import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, chmod, lstat, mkdir, readdir, readlink, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { check } from '../contracts.ts';
import { compareVersions, type ReleaseManifest } from '../updater.ts';
import { safeDirectory } from '../vault.ts';
import { acquireProcessLock } from '../process-lock.ts';
import { unzipArchive } from './update-zip.ts';
import { copyVerifiedPrivate, exactKeys, hashRegularFile, isoTimestamp, readJsonFile, syncDirectory, writeJsonAtomic, type AtomicWriteHooks } from './update-files.ts';

export const MAX_TRIAL_LAUNCHES = 2, KEEP_OLD_VERSIONS = 2;
const MAX_ENTRIES = 200000, UNPACK_TIMEOUT_MS = 10 * 60 * 1000;
export type ArtifactKind = 'appimage' | 'tar' | 'zip';
export type UnpackInfo = Readonly<{ kind:ArtifactKind; fileName:string }>;
/** Places the verified artifact's contents into an empty private destination directory. */
export type Unpack = (artifactPath:string, destination:string, info:UnpackInfo) => Promise<void>;
export type InstallPointer = Readonly<{ version:string; previous:string|null; state:'committed'|'trial'; attempts:number; swappedAt:string }>;
export type InstallResult = Readonly<{ installed:true; version:string; previous:string|null; state:'trial'; directory:string; pruned:readonly string[] }>;
export type LaunchDecision = Readonly<{
  version:string; directory:string; state:'committed'|'trial'; attempts:number;
  /** True when this call moved the pointer back because the trial version failed to confirm in time. */
  rolledBack:boolean; rolledBackFrom:string|null;
  /** True when a trial exceeded its launches but no previous version exists to return to. */
  rollbackUnavailable:boolean;
}>;
export type RollbackResult = Readonly<{ rolledBack:true; from:string; to:string; pointer:InstallPointer }>;
/**
 * Decides, inside the install lock, whether the pointer may move back to `version` (manual or automatic rollback).
 * Return false to keep the current version; throw a typed error to refuse with a specific reason.
 */
export type CanReturnTo = (version:string) => Promise<boolean>;
export type InstallLayoutOptions = { installRoot:string; unpack?:Unpack; now?:()=>number; hooks?:{ pointer?:AtomicWriteHooks } };

/** Infers the artifact type from the signed URL. Native installers are never executed by the updater. */
export function artifactKind(url:string):UnpackInfo {
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { check(false, 'UNSUPPORTED_ARTIFACT', 'The release artifact URL is invalid.'); }
  const name = decodeURIComponent(pathname.split('/').pop() ?? '');
  check(!/\.(exe|msi|msix|appx|dmg|pkg|mpkg)$/i.test(name), 'NATIVE_INSTALLER_REQUIRED', 'This release is a native installer. Chausar never runs a downloaded installer; install it yourself.');
  const kind:ArtifactKind|null = /\.AppImage$/i.test(name) ? 'appimage' : /\.(tar\.gz|tgz|tar\.xz|tar)$/i.test(name) ? 'tar' : /\.zip$/i.test(name) ? 'zip' : null;
  check(kind, 'UNSUPPORTED_ARTIFACT', 'Only AppImage, tar and zip release artifacts can be swapped in place.');
  return Object.freeze({ kind, fileName: /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) ? name : kind === 'appimage' ? 'Chausar.AppImage' : 'artifact' });
}
/** Default unpacker: copies an AppImage, reads a zip with the built-in reader, or runs the system `tar -xf` (no shell) for tar archives. */
export const defaultUnpack:Unpack = async (artifactPath, destination, info) => {
  if (info.kind === 'appimage') { const target = join(destination, info.fileName); await copyFile(artifactPath, target); await chmod(target, 0o755); return; }
  if (info.kind === 'zip') { await unzipArchive(artifactPath, destination); return; }
  const child = spawn('tar', ['-xf', artifactPath, '-C', destination], { shell: false, windowsHide: true, stdio: 'ignore', timeout: UNPACK_TIMEOUT_MS });
  const status = await new Promise<number|null>(done => { child.once('error', () => done(-1)); child.once('close', code => done(code)); });
  check(status === 0, 'INSTALL_UNPACK_FAILED', 'The release archive could not be unpacked.');
};
function validVersion(value:unknown):value is string { try { compareVersions(value as string, value as string); return true; } catch { return false; } }
function validatePointer(value:any):InstallPointer {
  check(exactKeys(value, ['version','previous','state','attempts','swappedAt']) && validVersion(value.version) && (value.previous === null || (validVersion(value.previous) && value.previous !== value.version))
    && ['committed','trial'].includes(value.state) && Number.isSafeInteger(value.attempts) && value.attempts >= 0 && value.attempts <= 1000 && isoTimestamp(value.swappedAt), 'INSTALL_POINTER_INVALID', 'The installed-version pointer is invalid.');
  return Object.freeze({ ...value });
}
/** Walks unpacked content: only files, directories and links that stay inside the version directory. */
async function verifyTree(root:string):Promise<number> {
  let files = 0, entries = 0;
  const walk = async (directory:string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      check(++entries <= MAX_ENTRIES, 'INSTALL_UNSAFE_CONTENT', 'The release archive holds too many entries.');
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        // A hard link would let one write change a file inside and outside the version directory.
        check((await lstat(path)).nlink === 1, 'INSTALL_UNSAFE_CONTENT', 'The release archive holds a hard-linked file.');
        files++;
      }
      else if (item.isSymbolicLink()) {
        const target = await readlink(path), inside = relative(root, resolve(dirname(path), target));
        check(!isAbsolute(target) && inside !== '' && !inside.startsWith('..') && !isAbsolute(inside), 'INSTALL_UNSAFE_CONTENT', 'The release archive holds a link that leaves its directory.');
      } else check(false, 'INSTALL_UNSAFE_CONTENT', 'The release archive holds a special file.');
    }
  };
  await walk(root); return files;
}

/**
 * Side-by-side install layout: `<root>/versions/<version>/…` and an atomically replaced `<root>/current.json`.
 * A new version starts on trial; it is committed by `confirmHealthy` or rolled back automatically by `resolveLaunch`.
 */
export class InstallLayout {
  #root:string; #unpack:Unpack; #now:()=>number; #hooks:AtomicWriteHooks;
  constructor(options:InstallLayoutOptions) {
    check(typeof options.installRoot === 'string' && isAbsolute(options.installRoot), 'UNSAFE_UPDATE_PATH', 'Choose an absolute private install directory.');
    this.#root = options.installRoot; this.#unpack = options.unpack ?? defaultUnpack; this.#now = options.now ?? Date.now; this.#hooks = options.hooks?.pointer ?? {};
  }
  async #paths() {
    const root = await safeDirectory(this.#root, true), versions = await safeDirectory(join(root, 'versions'), true);
    return { root, versions, pointer: join(root, 'current.json') };
  }
  async #locked<T>(work:(paths:{root:string;versions:string;pointer:string})=>Promise<T>):Promise<T> {
    const paths = await this.#paths(), lock = await acquireProcessLock(join(paths.root, 'install.lock'), { busyCode: 'UPDATE_BUSY', changedCode: 'UPDATE_LOCK_CHANGED', unsafeCode: 'UNSAFE_UPDATE_PATH' });
    try { return await work(paths); } finally { await lock.release(); }
  }
  async #read(pointerPath:string):Promise<InstallPointer|null> {
    const value = await readJsonFile(pointerPath, 4096, 'INSTALL_POINTER_INVALID');
    return value === undefined ? null : validatePointer(value);
  }
  async #write(pointerPath:string, pointer:InstallPointer) { await writeJsonAtomic(pointerPath, validatePointer(pointer), this.#hooks); return pointer; }
  async #present(versions:string, version:string|null):Promise<boolean> {
    if (!version) return false;
    try { const stat = await lstat(join(versions, version)); return stat.isDirectory() && !stat.isSymbolicLink(); } catch (error:any) { if (error.code === 'ENOENT') return false; throw error; }
  }
  #stamp() { return new Date(this.#now()).toISOString(); }
  async pointer():Promise<InstallPointer|null> { return this.#read((await this.#paths()).pointer); }
  async versionDirectory(version:string):Promise<string> { check(validVersion(version), 'INVALID_VERSION', 'Use an explicit semantic version.'); return join((await this.#paths()).versions, version); }

  /** Unpacks a staged artifact already verified against a signed manifest, then swaps the pointer atomically. */
  async install(stagedArtifactPath:string, verifiedManifest:ReleaseManifest):Promise<InstallResult> {
    check(verifiedManifest && validVersion(verifiedManifest.version) && /^[a-f0-9]{64}$/.test(verifiedManifest.sha256) && Number.isSafeInteger(verifiedManifest.size), 'INVALID_MANIFEST', 'Install needs a verified release manifest.');
    const info = artifactKind(verifiedManifest.url);
    check(typeof stagedArtifactPath === 'string' && isAbsolute(stagedArtifactPath), 'UNSAFE_UPDATE_PATH', 'The staged artifact needs an absolute path.');
    return this.#locked(async ({ versions, pointer: pointerPath }) => {
      const current = await this.#read(pointerPath), version = verifiedManifest.version;
      check(current?.version !== version, 'INSTALL_ALREADY_CURRENT', 'This version is already the installed version.');
      check(current?.state !== 'trial', 'INSTALL_TRIAL_PENDING', 'Confirm or roll back the version on trial before installing another.');
      const partial = join(versions, `.partial-${version}-${randomUUID()}`), target = join(versions, version);
      // The staged file could be swapped after it was hashed: copy it into the private versions folder,
      // hashing the bytes as they are copied, and unpack only that copy.
      const copy = join(versions, `.partial-artifact-${randomUUID()}`);
      try {
        await copyVerifiedPrivate(stagedArtifactPath, copy, { sha256: verifiedManifest.sha256, size: verifiedManifest.size }, 'INSTALL_ARTIFACT_MISMATCH', 'The staged artifact differs from its signed length or digest.');
        await mkdir(partial, { mode: 0o700 });
        await this.#unpack(copy, partial, info);
        check(await verifyTree(partial) > 0, 'INSTALL_INCOMPLETE', 'The unpacked release holds no files.');
        if (info.kind === 'appimage') {
          const copy = await hashRegularFile(join(partial, info.fileName), 'INSTALL_INCOMPLETE', 'The unpacked AppImage is missing.');
          check(copy.sha256 === verifiedManifest.sha256, 'INSTALL_INCOMPLETE', 'The unpacked AppImage differs from the signed artifact.');
        }
        if (await this.#present(versions, version)) await rename(target, join(versions, `.trash-${version}-${randomUUID()}`));
        await rename(partial, target); await syncDirectory(versions);
      } catch (error) { await rm(partial, { recursive: true, force: true }).catch(() => {}); throw error; }
      finally { await rm(copy, { force: true }).catch(() => {}); }
      const previous = current && await this.#present(versions, current.version) ? current.version : null;
      await this.#write(pointerPath, { version, previous, state: 'trial', attempts: 0, swappedAt: this.#stamp() });
      const pruned = await this.#prune(versions, version, previous);
      return Object.freeze({ installed: true, version, previous, state: 'trial', directory: target, pruned: Object.freeze(pruned) });
    });
  }
  /**
   * Called once per launch: counts trial attempts and rolls back after more than two unconfirmed launches.
   * `canReturnTo` (evaluated under the lock) can keep the trial current when the previous version must not run.
   */
  async resolveLaunch(options:{ canReturnTo?:CanReturnTo } = {}):Promise<LaunchDecision|null> {
    return this.#locked(async ({ versions, pointer: pointerPath }) => {
      const current = await this.#read(pointerPath);
      if (!current) return null;
      const decide = (pointer:InstallPointer, rolledBackFrom:string|null, rollbackUnavailable = false):LaunchDecision => Object.freeze({ version: pointer.version, directory: join(versions, pointer.version), state: pointer.state, attempts: pointer.attempts, rolledBack: rolledBackFrom !== null, rolledBackFrom, rollbackUnavailable });
      const allowed = async () => !options.canReturnTo || await options.canReturnTo(current.previous!);
      const canReturn = await this.#present(versions, current.previous);
      const healthy = await this.#present(versions, current.version);
      if (!healthy) {
        check(canReturn && await allowed(), 'INSTALL_INCOMPLETE', 'The installed version directory is missing and no usable previous version exists.');
        return decide(await this.#write(pointerPath, { version: current.previous!, previous: null, state: 'committed', attempts: 0, swappedAt: this.#stamp() }), current.version);
      }
      if (current.state === 'committed') return decide(current, null);
      const attempts = current.attempts + 1;
      if (attempts > MAX_TRIAL_LAUNCHES && canReturn && await allowed())
        // The failed version is not kept as `previous`, so a later manual rollback cannot return to it.
        return decide(await this.#write(pointerPath, { version: current.previous!, previous: null, state: 'committed', attempts: 0, swappedAt: this.#stamp() }), current.version);
      // The count stops one past the limit, so a trial that can never roll back keeps a valid pointer.
      return decide(await this.#write(pointerPath, { ...current, attempts: Math.min(attempts, MAX_TRIAL_LAUNCHES + 1) }), null, attempts > MAX_TRIAL_LAUNCHES);
    });
  }
  /** Commits the trial version once the running app (of exactly that version) reports itself healthy. */
  async confirmHealthy(runningVersion:string):Promise<InstallPointer> {
    return this.#locked(async ({ pointer: pointerPath }) => {
      const current = await this.#read(pointerPath);
      check(current && current.version === runningVersion, 'INSTALL_VERSION_MISMATCH', 'Only the installed version can confirm that it is healthy.');
      if (current.state === 'committed') return current;
      return this.#write(pointerPath, { ...current, state: 'committed', attempts: 0 });
    });
  }
  /** Flips the pointer to the previous version (and keeps the current one as `previous`). */
  async rollback(options:{ canReturnTo?:CanReturnTo } = {}):Promise<RollbackResult> {
    return this.#locked(async ({ versions, pointer: pointerPath }) => {
      const current = await this.#read(pointerPath);
      check(current && current.previous && await this.#present(versions, current.previous), 'ROLLBACK_UNAVAILABLE', 'There is no previous installed version to return to.');
      check(!options.canReturnTo || await options.canReturnTo(current.previous), 'ROLLBACK_UNAVAILABLE', 'The previous installed version cannot be returned to.');
      const pointer = await this.#write(pointerPath, { version: current.previous, previous: current.version, state: 'committed', attempts: 0, swappedAt: this.#stamp() });
      return Object.freeze({ rolledBack: true, from: current.version, to: current.previous, pointer });
    });
  }
  /** Keeps the current version and at most two older ones (always including `previous`); removes leftovers. */
  async #prune(versions:string, current:string, previous:string|null):Promise<string[]> {
    const removed:string[] = [], old:string[] = [];
    for (const item of await readdir(versions, { withFileTypes: true })) {
      if (/^\.(partial|trash)-/.test(item.name)) { await rm(join(versions, item.name), { recursive: true, force: true }); continue; }
      if (item.isDirectory() && validVersion(item.name) && item.name !== current && item.name !== previous) old.push(item.name);
    }
    old.sort((a, b) => compareVersions(b, a));
    for (const name of old.slice(previous ? KEEP_OLD_VERSIONS - 1 : KEEP_OLD_VERSIONS)) { await rm(join(versions, name), { recursive: true, force: true }); removed.push(name); }
    if (removed.length) await syncDirectory(versions);
    return removed;
  }
}
