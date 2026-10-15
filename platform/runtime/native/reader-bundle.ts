import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { check } from '../contracts.ts';
import { hashRegularFile } from './update-files.ts';

/**
 * The bundled PDF readers (FR-07), described and verified from the staged runtime's own records:
 * `runtime-binaries/manifest.json` (every file, SHA-256 and size) and `runtime-binaries/readers.json`
 * (written by scripts/release/stage-readers.ts and itself listed in the manifest). Nothing here runs
 * Python, tesseract or any user content, and nothing is downloaded.
 *
 * Engine methods (wired by the release module): `native.readerBundle` (read) returns
 * `readerBundle(...)`; `native.installReader` (admin) returns `verifyReaderBundle(...)`, which
 * re-hashes every reader file against the manifest and reports `installed: true` without a download.
 */
export type ReaderBundleOptions = { resourcesPath: string; pythonExecutable?: string | null; platform?: NodeJS.Platform; arch?: string };
export type ReaderBundle = Readonly<{
  present: boolean;
  /** Why the bundle is absent: a fixed code, null when present. */
  reason: string | null;
  python: { version: string } | null;
  packages: { pdfplumber: string; pypdfium2: string; Pillow: string } | null;
  tesseract: { version: string; languages: string[] } | null;
  /** Bytes of every file under python/ and tesseract/, from the manifest. */
  sizeBytes: number | null;
  manifestSha256: string | null;
}>;
export type ReaderInstall = Readonly<{ installed: true; downloaded: false; verifiedFiles: number; verifiedBytes: number; manifestSha256: string; bundle: ReaderBundle }>;

type ManifestFile = { path: string; sha256: string; size: number };
type Readers = { platform: string; architecture: string; python: { version: string; sitePackages: string; packages: Record<string, string>; paths: string[] }; tesseract: { version: string; executable: string; tessdata: string; languages: string[] } };
const MANIFEST_BYTES = 32 * 1024 * 1024, READERS_BYTES = 1024 * 1024;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_.+@ /-]{1,1024}$/;
const VERSION = /^[0-9][0-9A-Za-z.+!-]{0,60}$/;
const SHA = /^[a-f0-9]{64}$/;
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const absent = (reason: string, manifestSha256: string | null = null): ReaderBundle => Object.freeze({ present: false, reason, python: null, packages: null, tesseract: null, sizeBytes: null, manifestSha256 });
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

async function regular(path: string): Promise<boolean> { try { const info = await lstat(path); return info.isFile(); } catch { return false; } }
async function bounded(path: string, maximum: number): Promise<Buffer | null> {
  try { const info = await lstat(path); if (!info.isFile() || info.size > maximum) return null; return await readFile(path); } catch { return null; }
}
function manifestFiles(value: unknown, platform: string, arch: string): ManifestFile[] | null {
  if (!isObject(value) || value.schemaVersion !== 1 || value.platform !== platform || value.architecture !== arch || !Array.isArray(value.files) || value.files.length > 100_000) return null;
  for (const file of value.files) if (!isObject(file) || typeof file.path !== 'string' || !PATH.test(file.path) || typeof file.sha256 !== 'string' || !SHA.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) return null;
  return value.files as ManifestFile[];
}
function readersRecord(value: unknown, platform: string, arch: string): Readers | null {
  if (!isObject(value) || value.format !== 'chausar.readers.v1' || value.platform !== platform || value.architecture !== arch) return null;
  const { python, tesseract } = value;
  if (!isObject(python) || typeof python.version !== 'string' || !VERSION.test(python.version) || typeof python.sitePackages !== 'string' || !PATH.test(python.sitePackages) || !under(python.sitePackages, 'python')) return null;
  if (!isObject(python.packages) || !Object.entries(python.packages).every(([name, version]) => /^[a-z0-9-]{1,100}$/.test(name) && typeof version === 'string' && VERSION.test(version))) return null;
  if (!Array.isArray(python.paths) || python.paths.length === 0 || !python.paths.every((path: unknown) => typeof path === 'string' && PATH.test(path) && path.startsWith(`${python.sitePackages}/`))) return null;
  if (!isObject(tesseract) || typeof tesseract.version !== 'string' || !VERSION.test(tesseract.version) || typeof tesseract.executable !== 'string' || !PATH.test(tesseract.executable) || !under(tesseract.executable, 'tesseract')) return null;
  if (typeof tesseract.tessdata !== 'string' || !PATH.test(tesseract.tessdata) || !under(tesseract.tessdata, 'tesseract') || !Array.isArray(tesseract.languages) || tesseract.languages.length === 0 || !tesseract.languages.every((code: unknown) => typeof code === 'string' && /^[a-z_]{3,16}$/.test(code))) return null;
  return value as Readers;
}
/** `<site>/<name>-<version>.dist-info/METADATA`, the wheel spelling of a distribution name. */
const metadataPath = (site: string, name: string, version: string) => `${site}/${name.replace(/-/g, '_')}-${version}.dist-info/METADATA`;
const bundledPython = (root: string, platform: string) => platform === 'win32' ? join(root, 'python', 'python.exe') : join(root, 'python', 'bin', 'python3');

type Loaded = { root: string; files: ManifestFile[]; listed: Map<string, ManifestFile>; readers: Readers; manifestSha256: string };
async function load(options: ReaderBundleOptions): Promise<Loaded | ReaderBundle> {
  check(typeof options.resourcesPath === 'string' && isAbsolute(options.resourcesPath), 'READER_BUNDLE_INVALID', 'The app resources folder must be an absolute path.');
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
  const root = join(options.resourcesPath, 'runtime-binaries');
  const manifestBytes = await bounded(join(root, 'manifest.json'), MANIFEST_BYTES);
  if (!manifestBytes) return absent('RUNTIME_NOT_BUNDLED');
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  let files: ManifestFile[] | null = null;
  try { files = manifestFiles(JSON.parse(manifestBytes.toString('utf8')), platform, arch); } catch { files = null; }
  if (!files) return absent('RUNTIME_MANIFEST_INVALID', manifestSha256);
  const listed = new Map(files.map(file => [file.path, file]));
  const entry = listed.get('readers.json');
  if (!entry) return absent('READERS_NOT_BUNDLED', manifestSha256);
  const readerBytes = await bounded(join(root, 'readers.json'), READERS_BYTES);
  if (!readerBytes || readerBytes.length !== entry.size || createHash('sha256').update(readerBytes).digest('hex') !== entry.sha256) return absent('READERS_CHANGED', manifestSha256);
  let readers: Readers | null = null;
  try { readers = readersRecord(JSON.parse(readerBytes.toString('utf8')), platform, arch); } catch { readers = null; }
  if (!readers) return absent('READERS_INVALID', manifestSha256);
  const python = options.pythonExecutable;
  if (typeof python !== 'string' || !isAbsolute(python)) return absent('PYTHON_NOT_CONFIGURED', manifestSha256);
  const [configured, bundled] = await Promise.all([realpath(python).catch(() => null), realpath(bundledPython(root, platform)).catch(() => null)]);
  if (!configured || configured !== bundled) return absent('PYTHON_NOT_BUNDLED', manifestSha256);
  return { root, files, listed, readers, manifestSha256 };
}

/** What the installed app bundles for reading PDFs, from the staged manifest and readers record only. */
export async function readerBundle(options: ReaderBundleOptions): Promise<ReaderBundle> {
  const loaded = await load(options);
  if (!('readers' in loaded)) return loaded;
  const { root, listed, readers, files, manifestSha256 } = loaded;
  const site = readers.python.sitePackages, versions = readers.python.packages;
  const packages = { pdfplumber: versions.pdfplumber, pypdfium2: versions.pypdfium2, Pillow: versions.pillow };
  if (!packages.pdfplumber || !packages.pypdfium2 || !packages.Pillow) return absent('READER_PACKAGE_MISSING', manifestSha256);
  for (const [name, version] of Object.entries(versions)) if (!listed.has(metadataPath(site, name, version))) return absent('READER_PACKAGE_MISSING', manifestSha256);
  const languageFiles = readers.tesseract.languages.map(code => `${readers.tesseract.tessdata}/${code}.traineddata`);
  for (const path of [readers.tesseract.executable, ...languageFiles]) if (!listed.has(path) || !(await regular(join(root, ...path.split('/'))))) return absent('OCR_PROGRAM_MISSING', manifestSha256);
  const sizeBytes = files.reduce((sum, file) => under(file.path, 'python') || under(file.path, 'tesseract') ? sum + file.size : sum, 0);
  return Object.freeze({ present: true, reason: null, python: { version: readers.python.version }, packages, tesseract: { version: readers.tesseract.version, languages: [...readers.tesseract.languages] }, sizeBytes, manifestSha256 });
}

/**
 * Verifies every reader file against the manifest (the reader packages' folders, everything under
 * tesseract/, and readers.json): each listed file must be a regular file with its recorded size and
 * SHA-256, and no unlisted file may sit inside those folders. Downloads nothing.
 */
export async function verifyReaderBundle(options: ReaderBundleOptions): Promise<ReaderInstall> {
  const loaded = await load(options);
  check('readers' in loaded, 'READER_BUNDLE_MISSING', 'This installation does not include the PDF readers. Install the full release.');
  const bundle = await readerBundle(options);
  check(bundle.present, 'READER_BUNDLE_MISSING', 'This installation does not include the PDF readers. Install the full release.');
  const { root, files, readers, manifestSha256 } = loaded;
  check(bundle.manifestSha256 === manifestSha256, 'READER_BUNDLE_CHANGED', 'The PDF reader files changed while they were checked.');
  const scopes = ['tesseract', ...readers.python.paths];
  const inScope = (path: string) => path === 'readers.json' || scopes.some(scope => under(path, scope));
  const expected = files.filter(file => inScope(file.path));
  let verifiedBytes = 0;
  for (const file of expected) {
    const actual = await hashRegularFile(join(root, ...file.path.split('/')), 'READER_BUNDLE_CHANGED', 'A PDF reader file is missing or changed. Reinstall the app.');
    check(actual.size === file.size && actual.sha256 === file.sha256, 'READER_BUNDLE_CHANGED', 'A PDF reader file is missing or changed. Reinstall the app.');
    verifiedBytes += actual.size;
  }
  const known = new Set(expected.map(file => file.path));
  const walk = async (directory: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, item.name);
      const path = relative(root, full).split(sep).join('/');
      if (item.isDirectory() && !item.isSymbolicLink()) { await walk(full); continue; }
      check(item.isFile() && known.has(path), 'READER_BUNDLE_CHANGED', 'An unlisted file sits among the PDF reader files. Reinstall the app.');
    }
  };
  for (const scope of scopes) {
    const full = join(root, ...scope.split('/'));
    const info = await lstat(full).catch(() => null);
    check(info && !info.isSymbolicLink(), 'READER_BUNDLE_CHANGED', 'A PDF reader file is missing or changed. Reinstall the app.');
    if (info.isDirectory()) await walk(full);
  }
  return Object.freeze({ installed: true, downloaded: false, verifiedFiles: expected.length, verifiedBytes, manifestSha256, bundle });
}
