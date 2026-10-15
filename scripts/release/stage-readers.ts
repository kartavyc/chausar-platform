import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { arch as hostArch, platform as hostPlatform } from 'node:process';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';
import { arrangeComponent, assertArchiveSafe, DEFAULT_SOURCES_PATH, downloadArchive, extractArchive, inventoryFiles, requiredExecutables, safeRelative, selectRuntimeSources, tool, validateRuntimeSources, type Fetcher, type RuntimeLayout } from './stage-runtime.ts';

/*
 * Stages the bundled PDF readers into an already-staged runtime (release lane, FR-07):
 *  - Python: pdfplumber, pypdfium2, Pillow and their dependencies, installed by the staged
 *    interpreter's own pip from a hash-pinned requirement file (one wheel per package), into the
 *    interpreter's site-packages so `python -I` finds them;
 *  - tesseract: conda-forge packages pinned by their repodata SHA-256, of which only
 *    `bin/tesseract` and its shared-library closure are copied (symlinks materialised), plus every
 *    package's licence files and a separately pinned eng.traineddata.
 * Then writes `readers.json` (format chausar.readers.v1), which the runtime inventory covers and
 * platform/runtime/native/reader-bundle.ts reads. Pins live in runtime-sources.json under `readers`.
 */

export type ReaderPin = { name: string; version: string; build?: string; url: string; sha256: string; checksumSource: string; /** Licence files inside the package payload, for packages whose metadata has no info/licenses (the GCC runtime). */ licensePaths?: string[] };
export type TessdataPin = { language: string; commit: string; url: string; sha256: string; checksumSource: string; licenseUrl: string; licenseSha256: string };
export type TesseractPins = { version: string; vendor: string; license: string; licenseFile: string; prefix: string | null; packages: ReaderPin[]; include: string[] | null; tessdata: TessdataPin; note?: string };
export type PythonReaderPins = { requirements: string; sitePackages: string; packages: Record<string, string> };
export type ReaderTarget = { staged: boolean; note?: string; python: PythonReaderPins | null; tesseract: TesseractPins | null };
export type ReaderSources = { note?: string; targets: Record<string, ReaderTarget> };
export type ReadersMetadata = {
  format: 'chausar.readers.v1'; platform: string; architecture: string;
  python: { version: string; sitePackages: string; packages: Record<string, string>; paths: string[] };
  tesseract: { version: string; executable: string; tessdata: string; languages: string[]; license: string; licenseFile: string; source: string; packages: { name: string; version: string; sha256: string }[] };
};
/** Runs pip or compileall with the staged interpreter; injectable for tests. */
export type PythonRunner = (python: string, args: string[]) => Promise<{ code: number | null }>;
export type ReaderStageOptions = {
  platform: string; architecture: string; out: string;
  sourcesPath?: string; readers?: ReaderSources; pythonVersion?: string;
  fetch?: Fetcher; maxBytes?: number; replace?: boolean;
  runPython?: PythonRunner;
  /** The machine staging runs on; pip installs for the interpreter it runs, so it must equal the target. */
  host?: { platform: string; arch: string };
  onNote?: (text: string) => void;
};

export const READERS_FILE = 'readers.json';
export const READERS_FORMAT = 'chausar.readers.v1';
/** The three packages FR-07 needs by name; the others are their dependencies. */
export const READER_PACKAGES = ['pdfplumber', 'pypdfium2', 'pillow'] as const;
const SCRIPTS_ROOT = dirname(fileURLToPath(import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9_.+-]{1,100}$/;
const VERSION = /^[0-9][0-9A-Za-z.+!-]{0,60}$/;
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const https = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
/** PEP 503 name: lower case, runs of `-`, `_` and `.` become one `-`. */
export const canonicalName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');
const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';

function validPin(pin: unknown): boolean {
  return isObject(pin) && NAME.test(pin.name) && VERSION.test(pin.version) && (pin.build === undefined || NAME.test(pin.build)) && https(pin.url) && String(pin.url).endsWith('.conda') && SHA.test(pin.sha256) && text(pin.checksumSource)
    && (pin.licensePaths === undefined || (Array.isArray(pin.licensePaths) && pin.licensePaths.length > 0 && pin.licensePaths.every(safeRelative)));
}
/** Validates the `readers` section of runtime-sources.json. Unresolved targets (`include: null`) are valid here and refused when staging. */
export function validateReaderSources(value: unknown): ReaderSources {
  const invalid = 'The PDF reader pins are malformed.';
  check(isObject(value) && isObject(value.targets), 'READER_SOURCES_INVALID', invalid);
  for (const [target, entry] of Object.entries(value.targets as Record<string, unknown>)) {
    check(/^(win32|darwin|linux)-(x64|arm64)$/.test(target) && isObject(entry) && typeof entry.staged === 'boolean' && (entry.note === undefined || typeof entry.note === 'string'), 'READER_SOURCES_INVALID', invalid);
    const python = entry.python, tesseract = entry.tesseract;
    check(python === null || (isObject(python) && safeRelative(python.requirements) && python.requirements.endsWith('.txt') && safeRelative(python.sitePackages) && python.sitePackages.startsWith('python/') && isObject(python.packages)
      && Object.entries(python.packages).every(([name, version]) => NAME.test(name) && typeof version === 'string' && VERSION.test(version))
      && READER_PACKAGES.every(name => Object.keys(python.packages).some(key => canonicalName(key) === name))), 'READER_SOURCES_INVALID', invalid);
    if (tesseract === null) { check(entry.staged === false, 'READER_SOURCES_INVALID', 'A staged reader target needs tesseract pins.'); continue; }
    check(isObject(tesseract) && VERSION.test(tesseract.version) && text(tesseract.vendor) && text(tesseract.license) && safeRelative(tesseract.licenseFile) && tesseract.licenseFile.startsWith('tesseract/'), 'READER_SOURCES_INVALID', invalid);
    check((tesseract.prefix === null || safeRelative(tesseract.prefix)) && Array.isArray(tesseract.packages) && tesseract.packages.length > 0 && tesseract.packages.every(validPin), 'READER_SOURCES_INVALID', 'Every tesseract package needs an HTTPS .conda URL, a SHA-256 pin and where it was verified.');
    check(new Set(tesseract.packages.map((pin: ReaderPin) => pin.name)).size === tesseract.packages.length && tesseract.packages.some((pin: ReaderPin) => pin.name === 'tesseract'), 'READER_SOURCES_INVALID', invalid);
    check(tesseract.include === null || (Array.isArray(tesseract.include) && tesseract.include.length > 0 && tesseract.include.every(safeRelative)), 'READER_SOURCES_INVALID', invalid);
    check(entry.staged === false || (tesseract.include !== null && python !== null), 'READER_SOURCES_INVALID', 'A staged reader target needs a resolved closure and Python pins.');
    const data = tesseract.tessdata;
    check(isObject(data) && data.language === 'eng' && /^[a-f0-9]{40}$/.test(data.commit) && https(data.url) && SHA.test(data.sha256) && text(data.checksumSource) && https(data.licenseUrl) && SHA.test(data.licenseSha256), 'READER_SOURCES_INVALID', 'The OCR language data needs a pinned commit, URL and SHA-256.');
  }
  return value as ReaderSources;
}
/** The `readers` section of the pin file, validated. */
export async function loadReaderSources(path = DEFAULT_SOURCES_PATH): Promise<{ readers: ReaderSources; raw: unknown }> {
  let parsed: any;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { check(false, 'READER_SOURCES_INVALID', 'The PDF reader pins could not be read.'); }
  check(isObject(parsed) && isObject(parsed.readers), 'READER_SOURCES_INVALID', 'The pin file has no PDF reader section.');
  return { readers: validateReaderSources(parsed.readers), raw: parsed };
}
/** The reader pins for one target; refuses targets that were never resolved. */
export function selectReaderSources(readers: ReaderSources, platform: string, architecture: string): { python: PythonReaderPins; tesseract: TesseractPins & { include: string[] } } {
  const entry = readers.targets[`${platform}-${architecture}`];
  check(entry && entry.python && entry.tesseract, 'READER_SOURCE_UNAVAILABLE', 'No PDF reader pins are recorded for this target.');
  check(entry.tesseract.include !== null, 'READER_SOURCE_UNRESOLVED', 'The OCR program for this target has never been resolved to its file list.');
  return { python: entry.python, tesseract: entry.tesseract as TesseractPins & { include: string[] } };
}

const defaultRunner: PythonRunner = (python, args) => tool(python, args, 900_000);
async function exists(path: string): Promise<boolean> { return lstat(path).then(() => true, () => false); }
async function regularFile(path: string): Promise<boolean> { try { const info = await lstat(path); return info.isFile(); } catch { return false; } }

/** Reads `Name` and `Version` from each `*.dist-info/METADATA` directly under `site`. */
export async function installedDistributions(site: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const item of await readdir(site, { withFileTypes: true })) {
    if (!item.isDirectory() || !item.name.endsWith('.dist-info')) continue;
    const metadata = await readFile(join(site, item.name, 'METADATA'), 'utf8').catch(() => '');
    const name = /^Name: *(\S+)\s*$/m.exec(metadata)?.[1], version = /^Version: *(\S+)\s*$/m.exec(metadata)?.[1];
    check(name && version && VERSION.test(version), 'READER_PACKAGE_INVALID', 'An installed reader package has no readable name and version.');
    found[canonicalName(name)] = version;
  }
  return found;
}

async function stagePython(out: string, pins: PythonReaderPins, python: string, work: string, options: ReaderStageOptions): Promise<{ packages: Record<string, string>; paths: string[] }> {
  const run = options.runPython ?? defaultRunner;
  const site = join(work, 'site');
  await mkdir(site, { recursive: true, mode: 0o700 });
  const requirements = join(SCRIPTS_ROOT, ...pins.requirements.split('/'));
  check(await regularFile(requirements), 'READER_SOURCES_INVALID', 'The pinned reader requirement file is missing.');
  const installed = await run(python, ['-I', '-m', 'pip', 'install', '--no-deps', '--only-binary=:all:', '--require-hashes', '--no-compile', '--disable-pip-version-check', '--no-input', '--root-user-action=ignore', '--target', site, '-r', requirements]);
  check(installed.code === 0, 'READER_PIP_FAILED', 'pip could not install the pinned PDF reader wheels.');
  await rm(join(site, 'bin'), { recursive: true, force: true }); // console scripts carry this machine's interpreter path
  const found = await installedDistributions(site);
  const expected = Object.fromEntries(Object.entries(pins.packages).map(([name, version]) => [canonicalName(name), version]));
  check(JSON.stringify(Object.entries(found).sort()) === JSON.stringify(Object.entries(expected).sort()), 'READER_PACKAGE_MISMATCH', 'The installed reader packages differ from the pinned set.');
  await inventoryFiles(site); // refuses symbolic links and special files
  const target = join(out, ...pins.sitePackages.split('/'));
  check(await exists(target), 'READER_LAYOUT_INVALID', 'The staged Python has no site-packages folder.');
  const names = (await readdir(site)).sort();
  for (const name of names) {
    const destination = join(target, name);
    if (await exists(destination)) { check(options.replace, 'READER_OUTPUT_EXISTS', 'The staged Python already holds reader packages. Pass --replace to restage them.'); await rm(destination, { recursive: true, force: true }); }
    await rename(join(site, name), destination);
  }
  const compiled = await run(python, ['-I', '-m', 'compileall', '-q', '-j', '0', '--invalidation-mode', 'checked-hash', ...names.filter(name => !name.endsWith('.dist-info')).map(name => join(target, name))]);
  check(compiled.code === 0, 'READER_COMPILE_FAILED', 'The reader packages could not be byte-compiled.');
  return { packages: found, paths: names.map(name => `${pins.sitePackages}/${name}`) };
}

/** A `.conda` package is a zip holding `pkg-*.tar.zst` (the files) and `info-*.tar.zst` (metadata and licences). */
async function unpackConda(archive: string, work: string, prefix: string, info: string): Promise<void> {
  const unzipped = join(work, 'unzipped');
  await rm(unzipped, { recursive: true, force: true });
  await assertArchiveSafe(archive, 'zip');
  await extractArchive(archive, unzipped, 'zip'); // conda writes zip64 records, which the update reader refuses
  const members = await readdir(unzipped);
  for (const [kind, destination] of [['pkg-', prefix], ['info-', info]] as const) {
    const member = members.filter(name => name.startsWith(kind) && name.endsWith('.tar.zst'));
    check(member.length === 1, 'READER_ARCHIVE_INVALID', 'A conda package does not have the expected layout.');
    const tar = join(work, `${kind}payload.tar`);
    await pipeline(createReadStream(join(unzipped, member[0])), createZstdDecompress(), createWriteStream(tar, { flags: 'wx', mode: 0o600 }));
    await assertArchiveSafe(tar, 'tar');
    await extractArchive(tar, destination, 'tar');
    await rm(tar, { force: true });
  }
  await rm(unzipped, { recursive: true, force: true });
}
async function fetchPinned(url: string, sha256: string, destination: string, options: ReaderStageOptions): Promise<void> {
  const digest = await downloadArchive(url, destination, { fetch: options.fetch, maxBytes: options.maxBytes });
  check(digest === sha256, 'READER_HASH_MISMATCH', 'A downloaded reader file does not match its pinned SHA-256.');
}

async function stageTesseract(platform: string, pins: TesseractPins & { include: string[] }, work: string, options: ReaderStageOptions): Promise<string> {
  const prefix = join(work, 'prefix'), arranged = join(work, 'arranged', 'tesseract'), downloads = join(work, 'downloads');
  await mkdir(downloads, { recursive: true, mode: 0o700 });
  for (const pin of pins.packages) {
    const archive = join(downloads, `${pin.name}.conda`);
    await fetchPinned(pin.url, pin.sha256, archive, options);
    await unpackConda(archive, work, prefix, join(work, 'info', pin.name));
    await rm(archive, { force: true });
  }
  const layout: RuntimeLayout = { archive: 'tar', strip: pins.prefix, into: 'python', include: pins.include, materialiseSymlinks: true };
  await arrangeComponent(prefix, layout, arranged);
  for (const path of pins.include) check(await regularFile(join(arranged, ...path.split('/'))), 'READER_LAYOUT_INVALID', 'A pinned OCR file is missing from its packages.');
  for (const pin of pins.packages) {
    const destination = join(arranged, 'licenses', pin.name);
    if (pin.licensePaths) await arrangeComponent(prefix, { archive: 'tar', strip: null, into: 'python', include: pin.licensePaths, materialiseSymlinks: true }, destination);
    else if (await exists(join(work, 'info', pin.name, 'info', 'licenses'))) await arrangeComponent(join(work, 'info', pin.name), { archive: 'tar', strip: 'info/licenses', into: 'python', materialiseSymlinks: false }, destination);
    const copied = await exists(destination) ? await inventoryFiles(destination) : [];
    check(copied.length > 0, 'READER_LICENSE_MISSING', 'A bundled OCR package has no licence file.');
  }
  const data = pins.tessdata;
  await mkdir(join(arranged, 'share', 'tessdata'), { recursive: true });
  await fetchPinned(data.url, data.sha256, join(arranged, 'share', 'tessdata', `${data.language}.traineddata`), options);
  await mkdir(join(arranged, 'licenses', 'tessdata_fast'), { recursive: true });
  await fetchPinned(data.licenseUrl, data.licenseSha256, join(arranged, 'licenses', 'tessdata_fast', 'LICENSE'), options);
  check(await regularFile(join(arranged, '..', ...pins.licenseFile.split('/'))), 'READER_LICENSE_MISSING', 'The OCR program licence file is missing after staging.');
  const executable = `bin/tesseract${platform === 'win32' ? '.exe' : ''}`;
  check(await regularFile(join(arranged, ...executable.split('/'))), 'READER_LAYOUT_INVALID', 'The OCR program is missing after staging.');
  return arranged;
}

/**
 * Stages the PDF readers into `<out>` (which already holds the staged Python) and writes
 * `<out>/readers.json`. The caller re-signs and re-inventories the runtime afterwards.
 */
export async function stageReaders(options: ReaderStageOptions): Promise<ReadersMetadata> {
  const { platform, architecture } = options;
  check(/^(win32|darwin|linux)$/.test(platform) && /^(x64|arm64)$/.test(architecture), 'RUNTIME_TARGET_INVALID', 'Supported targets are win32, darwin or linux with x64 or arm64.');
  const host = options.host ?? { platform: hostPlatform, arch: hostArch };
  check(host.platform === platform && host.arch === architecture, 'READER_STAGE_HOST_ONLY', 'Stage the PDF readers on the target platform: pip installs for the interpreter it runs.');
  check(isAbsolute(options.out), 'RUNTIME_OUTPUT_INVALID', 'Provide the output folder as a path.');
  const out = resolve(options.out);
  const loaded = options.readers ? { readers: validateReaderSources(options.readers), raw: null } : await loadReaderSources(options.sourcesPath);
  const pins = selectReaderSources(loaded.readers, platform, architecture);
  let pythonVersion = options.pythonVersion;
  if (!pythonVersion) pythonVersion = selectRuntimeSources(validateRuntimeSources(loaded.raw), platform, architecture, { requirePins: false }).find(source => source.component === 'python')!.version;
  const python = join(out, ...requiredExecutables(platform as 'linux').at(-1)!.split('/'));
  check(await regularFile(python), 'READER_LAYOUT_INVALID', 'Stage the Python runtime before the PDF readers.');
  if (await exists(join(out, 'tesseract'))) check(options.replace, 'READER_OUTPUT_EXISTS', 'The output folder already holds the OCR program. Pass --replace to restage it.');
  const work = join(out, `.readers-${randomBytes(6).toString('hex')}`);
  await mkdir(work, { mode: 0o700 });
  try {
    const arranged = await stageTesseract(platform, pins.tesseract, work, options);
    const installed = await stagePython(out, pins.python, python, work, options);
    await rm(join(out, 'tesseract'), { recursive: true, force: true });
    await rename(arranged, join(out, 'tesseract'));
    const metadata: ReadersMetadata = {
      format: READERS_FORMAT, platform, architecture,
      python: { version: pythonVersion, sitePackages: pins.python.sitePackages, packages: installed.packages, paths: installed.paths },
      tesseract: { version: pins.tesseract.version, executable: `tesseract/bin/tesseract${platform === 'win32' ? '.exe' : ''}`, tessdata: 'tesseract/share/tessdata', languages: [pins.tesseract.tessdata.language],
        license: pins.tesseract.license, licenseFile: pins.tesseract.licenseFile, source: pins.tesseract.vendor, packages: pins.tesseract.packages.map(pin => ({ name: pin.name, version: pin.version, sha256: pin.sha256 })) },
    };
    await writeFile(join(out, READERS_FILE), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o644 });
    options.onNote?.(`Staged PDF readers: ${Object.keys(installed.packages).length} Python packages and tesseract ${pins.tesseract.version} (${pins.tesseract.include.length} files).`);
    return metadata;
  } finally { await rm(work, { recursive: true, force: true }); }
}
