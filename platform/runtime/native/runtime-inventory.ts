import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import { check } from '../contracts.ts';
import { exactKeys, hashRegularFile, readJsonFile, writeJsonAtomic } from './update-files.ts';

/**
 * Start-up check of the installed `runtime-binaries` against its own `manifest.json` (written by
 * scripts/release/stage-runtime.ts): every listed file must be present as a regular file with its
 * recorded size and SHA-256, and no unlisted file may sit beside them. Hashing the whole runtime
 * is slow, so a passing check leaves a receipt keyed by the manifest's SHA-256, the app version
 * and a fingerprint of every file's size, change time and identity; later launches of the same
 * version only re-read that fingerprint and hash again when anything moved.
 *
 * Dotfiles are the one tolerance: electron-builder's resource filters drop names that start with
 * a dot (such as `.gitignore`), so a listed dotfile that is absent is skipped and reported, and an
 * unlisted dotfile is ignored. Every other difference refuses.
 */
export type RuntimeManifestFile = { path:string; sha256:string; size:number };
export type InventoryResult = Readonly<{
  verified:true; files:number; bytes:number; manifestSha256:string; cached:boolean;
  /** Listed dotfiles that the package does not carry (dropped by electron-builder filters). */
  skippedDotfiles:readonly string[];
}>;
export type InventoryOptions = {
  runtimeRoot:string; appVersion:string;
  /** Private folder for the receipt (the app's `userData/release`). Omit to hash on every call. */
  receiptDirectory?:string;
  platform?:NodeJS.Platform; arch?:string;
};
const MANIFEST_BYTES = 32 * 1024 * 1024, MAX_FILES = 100000, RECEIPT = 'runtime-inventory.json';
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\:\x00-\x1f\x7f]{1,1024}$/;
const dotfile = (path:string) => posix.basename(path).startsWith('.');

function validManifest(value:any, platform:string, arch:string):RuntimeManifestFile[] {
  check(value && typeof value === 'object' && value.schemaVersion === 1 && Array.isArray(value.files) && value.files.length <= MAX_FILES, 'RUNTIME_MANIFEST_INVALID', 'The bundled runtime manifest is not a version 1 inventory.');
  check(value.platform === platform && value.architecture === arch, 'RUNTIME_MANIFEST_TARGET', 'The bundled runtime was built for another platform or architecture.');
  const seen = new Set<string>();
  for (const file of value.files) {
    check(exactKeys(file, ['path', 'sha256', 'size']) && typeof file.path === 'string' && PATH.test(file.path) && file.path !== 'manifest.json'
      && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.size) && file.size >= 0 && !seen.has(file.path),
    'RUNTIME_MANIFEST_INVALID', 'The bundled runtime manifest lists an invalid file.');
    seen.add(file.path);
  }
  return value.files;
}
/** Every file under the runtime root (relative POSIX paths), refusing links and special files. */
async function walk(root:string):Promise<Map<string, { size:number; ino:number; mtimeMs:number; ctimeMs:number }>> {
  const found = new Map<string, { size:number; ino:number; mtimeMs:number; ctimeMs:number }>();
  const visit = async (directory:string, prefix:string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name, path = join(directory, item.name);
      check(found.size < MAX_FILES, 'RUNTIME_FILE_UNEXPECTED', 'The bundled runtime holds more files than its manifest allows.');
      if (item.isDirectory()) { await visit(path, relative); continue; }
      check(item.isFile(), 'RUNTIME_FILE_UNEXPECTED', 'The bundled runtime holds a link or special file.');
      const stat = await lstat(path);
      check(stat.isFile() && !stat.isSymbolicLink(), 'RUNTIME_FILE_UNEXPECTED', 'The bundled runtime holds a link or special file.');
      found.set(relative, { size: stat.size, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
    }
  };
  await visit(root, '');
  return found;
}
/** Verifies the installed runtime against its manifest; refuses a missing, changed or unexpected file. */
export async function verifyRuntimeInventory(options:InventoryOptions):Promise<InventoryResult> {
  check(isAbsolute(options.runtimeRoot) && (options.receiptDirectory === undefined || isAbsolute(options.receiptDirectory)), 'RUNTIME_PATH_INVALID', 'The bundled runtime and receipt folders must be absolute.');
  check(typeof options.appVersion === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(options.appVersion), 'RUNTIME_PATH_INVALID', 'The app version is not a plain version.');
  const root = options.runtimeRoot, manifestPath = join(root, 'manifest.json');
  const rootInfo = await lstat(root).catch((error:any) => { check(error.code !== 'ENOENT', 'RUNTIME_MANIFEST_MISSING', 'The bundled runtime folder is missing.'); throw error; });
  check(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'RUNTIME_PATH_INVALID', 'The bundled runtime folder must be a real directory.');
  const manifestFile = await hashRegularFile(manifestPath, 'RUNTIME_MANIFEST_MISSING', 'The bundled runtime manifest is missing.');
  check(manifestFile.size <= MANIFEST_BYTES, 'RUNTIME_MANIFEST_INVALID', 'The bundled runtime manifest is too large.');
  const listed = validManifest(await readJsonFile(manifestPath, MANIFEST_BYTES, 'RUNTIME_MANIFEST_INVALID'), options.platform ?? process.platform, options.arch ?? process.arch);
  const present = await walk(root), skipped:string[] = [], expected = new Set(listed.map(file => file.path));
  for (const file of listed) {
    if (present.has(file.path)) continue;
    check(dotfile(file.path), 'RUNTIME_FILE_MISSING', 'A bundled runtime file is missing. Reinstall Chausar.');
    skipped.push(file.path);
  }
  for (const path of present.keys()) check(path === 'manifest.json' || expected.has(path) || dotfile(path), 'RUNTIME_FILE_UNEXPECTED', 'The bundled runtime holds a file its manifest does not list. Reinstall Chausar.');
  const kept = listed.filter(file => present.has(file.path));
  const fingerprint = createHash('sha256');
  for (const file of kept) { const stat = present.get(file.path)!; fingerprint.update(`${file.path}\u0000${stat.size}\u0000${stat.ino}\u0000${stat.mtimeMs}\u0000${stat.ctimeMs}\n`); }
  const receipt = { format: 'chausar.runtime-inventory.v1', appVersion: options.appVersion, manifestSha256: manifestFile.sha256, fingerprint: fingerprint.digest('hex'), files: kept.length };
  const result = (cached:boolean):InventoryResult => Object.freeze({ verified: true, files: kept.length, bytes: kept.reduce((sum, file) => sum + file.size, 0), manifestSha256: manifestFile.sha256, cached, skippedDotfiles: Object.freeze(skipped) });
  const receiptPath = options.receiptDirectory ? join(options.receiptDirectory, RECEIPT) : null;
  if (receiptPath) {
    const previous:any = await readJsonFile(receiptPath, 4096, 'RUNTIME_RECEIPT_INVALID').catch(() => undefined);
    if (previous && exactKeys(previous, Object.keys(receipt)) && Object.entries(receipt).every(([key, value]) => previous[key] === value)) {
      // Same version, manifest and file identities: sizes still have to match the manifest.
      for (const file of kept) check(present.get(file.path)!.size === file.size, 'RUNTIME_FILE_CHANGED', 'A bundled runtime file changed after installation. Reinstall Chausar.');
      return result(true);
    }
  }
  for (const file of kept) {
    check(present.get(file.path)!.size === file.size, 'RUNTIME_FILE_CHANGED', 'A bundled runtime file changed after installation. Reinstall Chausar.');
    const actual = await hashRegularFile(join(root, ...file.path.split('/')), 'RUNTIME_FILE_CHANGED', 'A bundled runtime file changed while it was checked.');
    check(actual.size === file.size && actual.sha256 === file.sha256, 'RUNTIME_FILE_CHANGED', 'A bundled runtime file changed after installation. Reinstall Chausar.');
  }
  if (receiptPath) { await mkdir(options.receiptDirectory!, { recursive: true, mode: 0o700 }); await writeJsonAtomic(receiptPath, receipt); }
  return result(false);
}
