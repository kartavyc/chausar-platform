import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';
import { stageReaders, type PythonRunner, type ReaderSources } from './stage-readers.ts';

/*
 * Stages vendored PostgreSQL and Python runtimes into `runtime-binaries/` for one target and writes
 * the manifest that scripts/package-preflight.mjs validates. Pins live in runtime-sources.json; a null
 * pin refuses. Staged runtimes are build outputs and are never committed (runtime-binaries/.gitignore).
 *
 *   node scripts/release/stage-runtime.ts --platform win32 --arch x64 --out runtime-binaries
 *   node scripts/release/stage-runtime.ts --platform linux --arch x64 --out runtime-binaries --inventory-only
 *   node scripts/release/stage-runtime.ts --platform linux --arch x64 --out runtime-binaries --readers-only
 *
 * `--readers` (with a full stage) or `--readers-only` (into an already-staged runtime) adds the
 * bundled PDF readers from stage-readers.ts: Python's PDF packages and tesseract with English data.
 *
 * The inventory covers every regular file under the output folder, including `keychain/` (the CI
 * builds the helper and its keychain/manifest.json first, then runs --inventory-only).
 * electron-builder does not sign extraResources, so `--sign-command <absolute path>` (or the
 * CHAUSAR_RUNTIME_SIGN_COMMAND environment variable) is run once per native executable or library
 * under postgres/ and python/ before hashes are computed. keychain/ is excluded from signing: its
 * own manifest pins the already-signed helper bytes. Signing state is printed, never written into
 * the strict manifest schema.
 */

export type RuntimePlatform = 'win32' | 'darwin' | 'linux';
export type RuntimeArchitecture = 'x64' | 'arm64';
export type RuntimeComponent = 'postgres' | 'python';
export type RuntimeLayout = { archive: 'zip' | 'tar.gz' | 'tar.xz' | 'tar'; strip: string | null; into: RuntimeComponent; include?: string[]; /** Archive paths left out, such as a symlinked duplicate of a large file. */ exclude?: string[]; materialiseSymlinks: boolean };
export type RuntimeSource = { component: RuntimeComponent; version: string; vendor: string; url: string | null; sha256: string | null; license: string; licenseFile: string; official: boolean; layout: RuntimeLayout; note?: string; /** Where the pin was verified (the vendor's own checksum file); required with a pin. */ checksumSource?: string };
export type RuntimeSources = { schemaVersion: 1; note?: string; targets: Record<string, RuntimeSource[]> };
export type ManifestComponent = { version: string; source: string; license: string; licenseFile: string };
export type ManifestFile = { path: string; sha256: string; size: number };
export type RuntimeManifest = { schemaVersion: 1; platform: RuntimePlatform; architecture: RuntimeArchitecture; components: { postgres: ManifestComponent; python: ManifestComponent }; files: ManifestFile[] };
export type Fetcher = (url: string, init: { redirect: 'follow' }) => Promise<Response>;
export type StageOptions = {
  platform: string;
  architecture: string;
  out: string;
  sources?: RuntimeSources;
  sourcesPath?: string;
  fetch?: Fetcher;
  maxBytes?: number;
  replace?: boolean;
  repoRoot?: string;
  /** Absolute signing executable run as `<command> <file>` (no shell) on each native file before hashing. */
  signCommand?: string | null;
  /** Also stage the bundled PDF readers (runtime-sources.json `readers`) before signing and inventory. */
  readers?: boolean;
  runPython?: PythonRunner;
  onNote?: (text: string) => void;
};

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_SOURCES_PATH = join(PROJECT_ROOT, 'scripts', 'release', 'runtime-sources.json');
const PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const ARCHITECTURES = new Set(['x64', 'arm64']);
const TARGETS = new Set([...PLATFORMS].flatMap(platform => [...ARCHITECTURES].map(architecture => `${platform}-${architecture}`)));
const RUNTIME_VERSION = /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_.+@ /-]+$/;
const DEFAULT_MAX_BYTES = 1_500_000_000;
const MAX_FILES = 20_000;
const OUTPUT_LIMIT = 4000;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const safeRelative = (value: unknown): value is string => typeof value === 'string' && SAFE_RELATIVE.test(value) && !value.endsWith('/');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

function validTarget(platform: string, architecture: string): asserts platform is RuntimePlatform {
  check(PLATFORMS.has(platform) && ARCHITECTURES.has(architecture), 'RUNTIME_TARGET_INVALID', 'Supported targets are win32, darwin or linux with x64 or arm64.');
}
function httpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

/** Validates the pin file's shape. Null `url` and `sha256` are allowed here and refused when staging. */
export function validateRuntimeSources(value: unknown): RuntimeSources {
  const invalid = 'The runtime source pins are malformed.';
  check(isObject(value) && value.schemaVersion === 1 && isObject(value.targets), 'RUNTIME_SOURCES_INVALID', invalid);
  for (const [target, entries] of Object.entries(value.targets)) {
    check(TARGETS.has(target) && Array.isArray(entries) && entries.length === 2, 'RUNTIME_SOURCES_INVALID', invalid);
    const components = new Set<string>();
    for (const entry of entries as unknown[]) {
      check(isObject(entry) && (entry.component === 'postgres' || entry.component === 'python') && !components.has(entry.component), 'RUNTIME_SOURCES_INVALID', invalid);
      components.add(entry.component as string);
      check(typeof entry.version === 'string' && RUNTIME_VERSION.test(entry.version) && typeof entry.vendor === 'string' && entry.vendor.trim() !== '' && typeof entry.license === 'string' && entry.license.trim() !== '' && typeof entry.official === 'boolean', 'RUNTIME_SOURCES_INVALID', invalid);
      check(entry.url === null || (typeof entry.url === 'string' && httpsUrl(entry.url)), 'RUNTIME_SOURCES_INVALID', 'Every runtime source must be a public HTTPS URL or null.');
      check(entry.sha256 === null || (typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)), 'RUNTIME_SOURCES_INVALID', 'Every runtime pin must be a lowercase SHA-256 or null.');
      check(entry.note === undefined || typeof entry.note === 'string', 'RUNTIME_SOURCES_INVALID', invalid);
      check(entry.sha256 === null ? entry.checksumSource === undefined : typeof entry.checksumSource === 'string' && entry.checksumSource.trim() !== '', 'RUNTIME_SOURCES_INVALID', 'Every runtime pin must say where it was verified, and only a pin may.');
      const layout = entry.layout;
      check(isObject(layout) && ['zip', 'tar.gz', 'tar.xz'].includes(layout.archive as string) && layout.into === entry.component && typeof layout.materialiseSymlinks === 'boolean', 'RUNTIME_SOURCES_INVALID', invalid);
      check(layout.strip === null || safeRelative(layout.strip), 'RUNTIME_SOURCES_INVALID', invalid);
      check(layout.include === undefined || (Array.isArray(layout.include) && layout.include.length > 0 && layout.include.every(safeRelative)), 'RUNTIME_SOURCES_INVALID', invalid);
      check(layout.exclude === undefined || (Array.isArray(layout.exclude) && layout.exclude.length > 0 && layout.exclude.every(safeRelative)), 'RUNTIME_SOURCES_INVALID', invalid);
      check(safeRelative(entry.licenseFile) && entry.licenseFile.startsWith(`${entry.component}/`), 'RUNTIME_SOURCES_INVALID', 'Each license file must sit inside its component folder.');
    }
  }
  return value as RuntimeSources;
}
export async function loadRuntimeSources(path = DEFAULT_SOURCES_PATH): Promise<RuntimeSources> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { check(false, 'RUNTIME_SOURCES_INVALID', 'The runtime source pins could not be read.'); }
  return validateRuntimeSources(parsed);
}
/** The two sources for a target. Refuses missing upstreams and null pins before any download. */
export function selectRuntimeSources(sources: RuntimeSources, platform: string, architecture: string, options: { requirePins?: boolean } = {}): RuntimeSource[] {
  validTarget(platform, architecture);
  const entries = sources.targets[`${platform}-${architecture}`];
  check(Array.isArray(entries) && entries.length === 2, 'RUNTIME_SOURCE_UNAVAILABLE', 'No runtime sources are recorded for this target.');
  const ordered = (['postgres', 'python'] as const).map(component => entries.find(entry => entry.component === component) as RuntimeSource);
  for (const entry of ordered) check(entry.url !== null, 'RUNTIME_SOURCE_UNAVAILABLE', 'A runtime for this target has no identified upstream archive.');
  if (options.requirePins !== false) for (const entry of ordered) check(entry.sha256 !== null, 'RUNTIME_SOURCE_UNPINNED', 'A runtime archive has no pinned SHA-256. The release operator must pin it first.');
  return ordered;
}

/** Streams an HTTPS archive to `destination` with a byte bound; returns its SHA-256. */
export async function downloadArchive(url: string, destination: string, options: { fetch?: Fetcher; maxBytes?: number } = {}): Promise<string> {
  check(httpsUrl(url), 'RUNTIME_SOURCE_INSECURE', 'Runtime archives are downloaded over HTTPS only.');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetcher: Fetcher = options.fetch ?? ((target, init) => fetch(target, init));
  let response: Response;
  try { response = await fetcher(url, { redirect: 'follow' }); } catch { check(false, 'RUNTIME_DOWNLOAD_FAILED', 'The runtime archive could not be downloaded.'); }
  check(!response.url || httpsUrl(response.url), 'RUNTIME_SOURCE_INSECURE', 'The runtime archive redirected away from HTTPS.');
  check(response.ok && response.body, 'RUNTIME_DOWNLOAD_FAILED', 'The runtime archive could not be downloaded.');
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body.cancel(); check(false, 'RUNTIME_DOWNLOAD_TOO_LARGE', 'The runtime archive exceeds the download size limit.'); }
  const hash = createHash('sha256');
  const file = await open(destination, 'wx', 0o600);
  const reader = response.body.getReader();
  let total = 0, tooLarge = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { tooLarge = true; await reader.cancel(); break; }
      hash.update(value);
      await file.write(value);
    }
  } finally { await file.close(); }
  if (tooLarge) { await rm(destination, { force: true }); check(false, 'RUNTIME_DOWNLOAD_TOO_LARGE', 'The runtime archive exceeds the download size limit.'); }
  return hash.digest('hex');
}

/** Runs a staging tool without a shell; `env` replaces the inherited environment when given. */
export function tool(executable: string, args: string[], timeoutMs = 600_000, env?: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string }> {
  return new Promise(accept => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    const chunks: Buffer[] = [];
    let size = 0, stderr = '', done = false;
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(deadline); accept({ code, stdout: Buffer.concat(chunks).toString('utf8') }); };
    const deadline = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 64_000_000) chunks.push(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-OUTPUT_LIMIT); });
    child.once('error', () => finish(null));
    child.once('close', code => finish(code));
  });
}
const usesUnzip = (kind: RuntimeLayout['archive'], platform: NodeJS.Platform) => kind === 'zip' && platform !== 'win32';

/** Lists archive members and refuses absolute paths, drive letters, backslashes and parent traversal. */
export async function assertArchiveSafe(archive: string, kind: RuntimeLayout['archive'], platform: NodeJS.Platform = process.platform): Promise<number> {
  const listed = usesUnzip(kind, platform) ? await tool('unzip', ['-Z1', archive]) : await tool('tar', ['-tf', archive]);
  check(listed.code === 0, 'RUNTIME_EXTRACT_FAILED', 'The runtime archive could not be listed.');
  const names = listed.stdout.split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    const clean = name.replace(/\/+$/, '').replace(/^\.\//, '');
    check(clean === '' || clean === '.' || (!clean.includes('\\') && !/^[A-Za-z]:/.test(clean) && !clean.startsWith('/') && !clean.split('/').includes('..')), 'RUNTIME_ARCHIVE_UNSAFE', 'The runtime archive contains an unsafe path.');
  }
  return names.length;
}
/** Extracts with the system tools: `tar` (bsdtar on Windows also reads zip) or `unzip` for zip elsewhere. */
export async function extractArchive(archive: string, destination: string, kind: RuntimeLayout['archive'], platform: NodeJS.Platform = process.platform): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const flags = kind === 'tar.gz' ? '-xzf' : kind === 'tar.xz' ? '-xJf' : '-xf';
  const result = usesUnzip(kind, platform) ? await tool('unzip', ['-q', archive, '-d', destination]) : await tool('tar', [flags, archive, '-C', destination, '--no-same-owner']);
  check(result.code === 0, 'RUNTIME_EXTRACT_FAILED', 'The runtime archive could not be extracted.');
}

const included = (path: string, include: string[] | undefined, directory: boolean) => !include || include.some(item => path === item || path.startsWith(`${item}/`) || (directory && item.startsWith(`${path}/`)));
const excluded = (path: string, exclude: string[] | undefined) => Boolean(exclude?.some(item => path === item || path.startsWith(`${item}/`)));
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); };

/** Copies the stripped archive tree into `<target>`; symlinks refuse unless the layout materialises them as regular files. */
export async function arrangeComponent(extracted: string, layout: RuntimeLayout, target: string): Promise<number> {
  const base = layout.strip ? join(extracted, ...layout.strip.split('/')) : extracted;
  let baseInfo;
  try { baseInfo = await lstat(base); } catch { baseInfo = null; }
  check(baseInfo?.isDirectory() && !baseInfo.isSymbolicLink(), 'RUNTIME_LAYOUT_INVALID', 'The runtime archive does not have the recorded layout.');
  const realBase = await realpath(base);
  let count = 0;
  const walk = async (directory: string, prefix: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      const source = join(directory, item.name);
      const destination = join(target, ...path.split('/'));
      const info = await lstat(source);
      if (!included(path, layout.include, info.isDirectory()) || excluded(path, layout.exclude)) continue;
      check(++count <= MAX_FILES, 'RUNTIME_LAYOUT_INVALID', 'The runtime exceeds the bundled file limit.');
      if (info.isSymbolicLink()) {
        check(layout.materialiseSymlinks, 'RUNTIME_SYMLINK_REFUSED', 'The runtime archive contains a symbolic link.');
        let resolved: string | null = null;
        try { resolved = await realpath(source); } catch { resolved = null; }
        check(resolved !== null && inside(realBase, resolved), 'RUNTIME_SYMLINK_REFUSED', 'A runtime symbolic link points outside its component.');
        const targetInfo = await stat(resolved);
        check(targetInfo.isFile(), 'RUNTIME_SYMLINK_REFUSED', 'A runtime symbolic link does not point to a regular file.');
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(resolved, destination);
        await chmod(destination, targetInfo.mode & 0o755);
      } else if (info.isDirectory()) {
        await mkdir(destination, { recursive: true });
        await walk(source, path);
      } else if (info.isFile()) {
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
        await chmod(destination, info.mode & 0o755);
      } else check(false, 'RUNTIME_ARCHIVE_UNSAFE', 'The runtime archive contains a special file.');
    }
  };
  await mkdir(target, { recursive: true });
  await walk(base, '');
  return count;
}

export function requiredExecutables(platform: RuntimePlatform): string[] {
  const extension = platform === 'win32' ? '.exe' : '';
  return [...['postgres', 'initdb', 'pg_ctl'].map(name => `postgres/bin/${name}${extension}`), platform === 'win32' ? 'python/python.exe' : 'python/bin/python3'];
}
async function regularFile(path: string): Promise<boolean> {
  try { const info = await lstat(path); return info.isFile() && !info.isSymbolicLink(); } catch { return false; }
}

/** Every regular file under `root` except the root `manifest.json`, sorted; refuses links and special files. */
export async function inventoryFiles(root: string): Promise<ManifestFile[]> {
  const files: ManifestFile[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      const full = join(directory, item.name);
      check(!item.isSymbolicLink(), 'RUNTIME_SYMLINK_REFUSED', 'The staged runtime contains a symbolic link.');
      if (item.isDirectory()) { await walk(full, path); continue; }
      check(item.isFile(), 'RUNTIME_ARCHIVE_UNSAFE', 'The staged runtime contains a special file.');
      if (path === 'manifest.json') continue;
      check(safeRelative(path), 'RUNTIME_PATH_UNSAFE', 'A staged runtime file name is not a safe relative path.');
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of createReadStream(full)) { hash.update(chunk as Buffer); size += (chunk as Buffer).length; }
      files.push({ path, sha256: hash.digest('hex'), size });
      check(files.length <= MAX_FILES, 'RUNTIME_LAYOUT_INVALID', 'The runtime exceeds the bundled file limit.');
    }
  };
  await walk(root, '');
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

const manifestComponent = (source: RuntimeSource): ManifestComponent => ({ version: source.version, source: source.url as string, license: source.license, licenseFile: source.licenseFile });

/** Writes `<out>/manifest.json` in the schema scripts/package-preflight.mjs validates. */
export async function writeRuntimeManifest(out: string, platform: string, architecture: string, sources: RuntimeSource[]): Promise<RuntimeManifest> {
  validTarget(platform, architecture);
  const postgres = sources.find(source => source.component === 'postgres');
  const python = sources.find(source => source.component === 'python');
  check(postgres?.url && python?.url, 'RUNTIME_SOURCE_UNAVAILABLE', 'Both runtime components need a recorded HTTPS source.');
  for (const path of requiredExecutables(platform)) check(await regularFile(join(out, ...path.split('/'))), 'RUNTIME_LAYOUT_INVALID', 'A required runtime executable is missing after staging.');
  for (const source of [postgres, python]) check(await regularFile(join(out, ...source.licenseFile.split('/'))), 'RUNTIME_LICENSE_MISSING', 'A runtime license file is missing after staging.');
  const manifest: RuntimeManifest = { schemaVersion: 1, platform, architecture: architecture as RuntimeArchitecture, components: { postgres: manifestComponent(postgres), python: manifestComponent(python) }, files: await inventoryFiles(out) };
  const temporary = join(out, `.manifest-${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644, flag: 'wx' });
  await rename(temporary, join(out, 'manifest.json'));
  return manifest;
}

const NATIVE_MAGIC = ['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca', 'cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', '7f454c46'];
/** PE, ELF or Mach-O by header bytes. */
export async function isNativeFile(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead < 4) return false;
    return header.subarray(0, 2).toString('latin1') === 'MZ' || NATIVE_MAGIC.includes(header.toString('hex'));
  } finally { await handle.close(); }
}
/** Runs the signing command on every native file under the staged postgres/ and python/ folders. */
export async function signNativeFiles(out: string, signCommand: string, components: string[] = ['postgres', 'python']): Promise<string[]> {
  check(isAbsolute(signCommand) && await regularFile(signCommand), 'RUNTIME_SIGN_COMMAND_INVALID', 'The signing command must be an absolute path to a regular file.');
  const signed: string[] = [];
  for (const component of components) {
    for (const entry of await inventoryFiles(join(out, component))) {
      const path = join(out, component, ...entry.path.split('/'));
      if (!(await isNativeFile(path))) continue;
      const result = await tool(signCommand, [path], 600_000);
      check(result.code === 0, 'RUNTIME_SIGN_FAILED', 'The signing command failed for a runtime file.');
      signed.push(`${component}/${entry.path}`);
    }
  }
  return signed;
}
async function signIfRequested(out: string, options: Pick<StageOptions, 'signCommand' | 'onNote'>): Promise<void> {
  if (!options.signCommand) { options.onNote?.('Runtime files were not signed: no signing command was supplied.'); return; }
  const tesseract = await lstat(join(out, 'tesseract')).then(info => info.isDirectory(), () => false);
  const signed = await signNativeFiles(out, options.signCommand, tesseract ? ['postgres', 'python', 'tesseract'] : ['postgres', 'python']);
  options.onNote?.(`Signed ${signed.length} native runtime files before hashing.`);
}

async function trackedPaths(repoRoot: string, paths: string[]): Promise<string[]> {
  const result = await tool('git', ['-C', repoRoot, 'ls-files', '-z', '--', ...paths.map(path => relative(repoRoot, path).split(sep).join('/'))], 60_000);
  return result.code === 0 ? result.stdout.split('\0').filter(Boolean) : [];
}
/** Inside the repository, refuse any tracked destination; outside `runtime-binaries/` refuse a tracked folder outright. */
export async function assertOutputAllowed(out: string, repoRoot = PROJECT_ROOT): Promise<void> {
  const rel = relative(resolve(repoRoot), out);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return;
  const runtimeFolder = rel === 'runtime-binaries' || rel.startsWith(`runtime-binaries${sep}`);
  const written = ['postgres', 'python', 'tesseract', 'readers.json', 'manifest.json'].map(name => join(out, name));
  const tracked = await trackedPaths(repoRoot, runtimeFolder ? written : [out]);
  check(tracked.length === 0, 'RUNTIME_OUTPUT_TRACKED', 'Staged runtimes are never committed. Choose runtime-binaries or a folder outside the repository.');
}

async function prepareOutput(out: string, options: StageOptions, components: RuntimeComponent[]): Promise<void> {
  check(isAbsolute(out), 'RUNTIME_OUTPUT_INVALID', 'Provide the output folder as a path.');
  await assertOutputAllowed(out, options.repoRoot);
  await mkdir(out, { recursive: true });
  const info = await lstat(out);
  check(info.isDirectory() && !info.isSymbolicLink(), 'RUNTIME_OUTPUT_INVALID', 'The output folder must be a real directory.');
  for (const component of components) {
    const existing = await lstat(join(out, component)).then(() => true, error => { if (missing(error)) return false; throw error; });
    check(!existing || options.replace, 'RUNTIME_OUTPUT_EXISTS', 'The output folder already holds a staged runtime. Pass --replace to restage it.');
  }
}

/** The `readers` section when the sources object carries one (otherwise stage-readers.ts reads the pin file). */
const readerPins = (sources: RuntimeSources) => isObject((sources as { readers?: unknown }).readers) ? (sources as unknown as { readers: ReaderSources }).readers : undefined;

/** Download, verify, extract and arrange both runtimes for one target, then write the manifest. */
export async function stageRuntime(options: StageOptions): Promise<RuntimeManifest> {
  validTarget(options.platform, options.architecture);
  const out = resolve(options.out);
  const sources = options.sources ? validateRuntimeSources(options.sources) : await loadRuntimeSources(options.sourcesPath);
  const selected = selectRuntimeSources(sources, options.platform, options.architecture);
  await prepareOutput(out, options, selected.map(source => source.layout.into));
  const work = join(out, `.stage-${randomBytes(6).toString('hex')}`);
  await mkdir(work, { mode: 0o700 });
  try {
    for (const source of selected) {
      const archive = join(work, `${source.component}.${source.layout.archive}`);
      const digest = await downloadArchive(source.url as string, archive, { fetch: options.fetch, maxBytes: options.maxBytes });
      check(digest === source.sha256, 'RUNTIME_HASH_MISMATCH', 'A downloaded runtime archive does not match its pinned SHA-256.');
      await assertArchiveSafe(archive, source.layout.archive);
      await extractArchive(archive, join(work, `${source.component}-extracted`), source.layout.archive);
      await arrangeComponent(join(work, `${source.component}-extracted`), source.layout, join(work, 'arranged', source.layout.into));
      await rm(archive, { force: true });
    }
    for (const path of requiredExecutables(options.platform)) check(await regularFile(join(work, 'arranged', ...path.split('/'))), 'RUNTIME_LAYOUT_INVALID', 'A required runtime executable is missing from the archive.');
    for (const source of selected) check(await regularFile(join(work, 'arranged', ...source.licenseFile.split('/'))), 'RUNTIME_LICENSE_MISSING', 'A runtime license file is missing from the archive.');
    for (const source of selected) {
      await rm(join(out, source.layout.into), { recursive: true, force: true });
      await rename(join(work, 'arranged', source.layout.into), join(out, source.layout.into));
    }
  } finally { await rm(work, { recursive: true, force: true }); }
  if (options.readers) await stageReaders({ platform: options.platform, architecture: options.architecture, out, sourcesPath: options.sourcesPath, readers: readerPins(sources), fetch: options.fetch, maxBytes: options.maxBytes, replace: true, runPython: options.runPython, pythonVersion: selected[1].version, onNote: options.onNote });
  await signIfRequested(out, options);
  return writeRuntimeManifest(out, options.platform, options.architecture, selected);
}

/** Adds the bundled PDF readers to an already-staged runtime, then re-signs and re-inventories it. */
export async function stageReadersIntoRuntime(options: StageOptions): Promise<RuntimeManifest> {
  validTarget(options.platform, options.architecture);
  const out = resolve(options.out);
  await assertOutputAllowed(out, options.repoRoot);
  const sources = options.sources ? validateRuntimeSources(options.sources) : await loadRuntimeSources(options.sourcesPath);
  const selected = selectRuntimeSources(sources, options.platform, options.architecture, { requirePins: false });
  await stageReaders({ platform: options.platform, architecture: options.architecture, out, sourcesPath: options.sourcesPath, readers: readerPins(sources), fetch: options.fetch, maxBytes: options.maxBytes, replace: options.replace, runPython: options.runPython, pythonVersion: selected[1].version, onNote: options.onNote });
  await signIfRequested(out, options);
  return writeRuntimeManifest(out, options.platform, options.architecture, selected);
}

/** Writes the manifest for an already-assembled directory, using the recorded sources for provenance. */
export async function inventoryRuntime(options: Pick<StageOptions, 'platform' | 'architecture' | 'out' | 'sources' | 'sourcesPath' | 'repoRoot' | 'signCommand' | 'onNote'>): Promise<RuntimeManifest> {
  validTarget(options.platform, options.architecture);
  const out = resolve(options.out);
  await assertOutputAllowed(out, options.repoRoot);
  const sources = options.sources ? validateRuntimeSources(options.sources) : await loadRuntimeSources(options.sourcesPath);
  const selected = selectRuntimeSources(sources, options.platform, options.architecture, { requirePins: false });
  await signIfRequested(out, options);
  return writeRuntimeManifest(out, options.platform, options.architecture, selected);
}

export function parseStageArguments(argv: string[], environment: Record<string, string | undefined> = process.env): StageOptions & { inventoryOnly: boolean; readersOnly: boolean } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (['--inventory-only', '--replace', '--readers', '--readers-only'].includes(name)) { check(!flags.has(name), 'RUNTIME_USAGE', 'Give each option once.'); flags.add(name); continue; }
    check(['--platform', '--arch', '--out', '--sources', '--max-bytes', '--sign-command'].includes(name) && argv[index + 1] !== undefined && !values.has(name), 'RUNTIME_USAGE', 'Usage: node scripts/release/stage-runtime.ts --platform win32|darwin|linux --arch x64|arm64 --out runtime-binaries [--inventory-only | --readers-only] [--readers] [--replace] [--sources file] [--max-bytes n] [--sign-command /absolute/path]');
    values.set(name, argv[index += 1]);
  }
  check(values.has('--platform') && values.has('--arch') && values.has('--out'), 'RUNTIME_USAGE', 'Provide --platform, --arch and --out.');
  check([...flags].filter(flag => ['--inventory-only', '--readers-only', '--readers'].includes(flag)).length <= 1, 'RUNTIME_USAGE', 'Choose one of --inventory-only, --readers-only or --readers.');
  const maxBytes = values.has('--max-bytes') ? Number(values.get('--max-bytes')) : undefined;
  check(maxBytes === undefined || (Number.isSafeInteger(maxBytes) && maxBytes > 0), 'RUNTIME_USAGE', 'The download size limit must be a positive whole number of bytes.');
  const signCommand = values.get('--sign-command') ?? (environment.CHAUSAR_RUNTIME_SIGN_COMMAND?.trim() || null);
  check(signCommand === null || isAbsolute(signCommand), 'RUNTIME_USAGE', 'The signing command must be an absolute path.');
  return { signCommand, platform: values.get('--platform') as string, architecture: values.get('--arch') as string, out: resolve(values.get('--out') as string), sourcesPath: values.has('--sources') ? resolve(values.get('--sources') as string) : undefined, maxBytes, replace: flags.has('--replace'), inventoryOnly: flags.has('--inventory-only'), readers: flags.has('--readers'), readersOnly: flags.has('--readers-only') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = { ...parseStageArguments(process.argv.slice(2)), onNote: (text: string) => console.log(text) };
    const manifest = options.inventoryOnly ? await inventoryRuntime(options) : options.readersOnly ? await stageReadersIntoRuntime(options) : await stageRuntime(options);
    console.log(`Runtime manifest written for ${manifest.platform}-${manifest.architecture}: ${manifest.files.length} files. Run node scripts/package-preflight.mjs next.`);
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    console.error(`${failure.code ?? 'RUNTIME_STAGE_FAILED'}: ${failure.message ?? 'Runtime staging failed.'}`);
    process.exitCode = 1;
  }
}
