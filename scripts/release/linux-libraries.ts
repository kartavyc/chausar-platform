import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { check } from '../../platform/runtime/contracts.ts';

/*
 * Makes a staged Linux runtime self-contained. The theseus-rs PostgreSQL builds link system libraries
 * (OpenSSL 3, libxml2, zstd, lz4, GSSAPI, zlib and their own dependencies). This copies exactly the
 * libraries a component needs, taken from pinned distribution packages (each .deb's SHA-256 comes from
 * the distribution's signed Packages index), into `<component>/lib`, and rewrites each ELF file's RUNPATH
 * to `$ORIGIN`-relative so the loader finds them without LD_LIBRARY_PATH. Only the C runtime stays a
 * system requirement (the `system` list: glibc's own libraries and libgcc_s), and every file's GLIBC_
 * symbol versions are checked against the declared minimum.
 *
 * RUNPATH is rewritten with `patchelf` (a build tool; `pip install patchelf` ships a binary wheel). The
 * ELF reader below only reads; it never edits.
 */

/** `copyright` is a path inside the package, or inside `copyrightFrom` (another listed package) when this one only links to it. */
export type LibraryPackage = { package: string; version: string; url: string; sha256: string; checksumSource: string; copyright: string; copyrightFrom?: string };
export type LinuxLibraries = { distribution: string; minimumGlibc: string; system: string[]; note?: string; packages: LibraryPackage[] };
export type ElfInfo = { machine: number; soname: string | null; needed: string[]; runpath: string[] | null; versions: string[]; glibc: string | null };
export type SetRunpath = (file: string, runpath: string) => Promise<void>;
export type VendorReport = { vendored: { file: string; package: string; version: string }[]; patched: string[]; licenses: string[]; glibc: string | null; elfFiles: number };

const SONAME = /^[A-Za-z0-9_+.-]+\.so(?:\.[0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GLIBC = /^2\.\d{1,3}$/;
const PACKAGE = /^[a-z0-9][a-z0-9+.-]*$/;
const MAX_ELF_BYTES = 512 * 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const httpsUrl = (value: unknown) => { try { const url = new URL(value as string); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const safeRelative = (value: unknown): value is string => typeof value === 'string' && /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_.+@ /-]+$/.test(value) && !value.endsWith('/');

/** `2.34` style comparison of GLIBC versions. */
export function compareGlibc(left: string, right: string): number {
  const [a1, a2] = left.split('.').map(Number), [b1, b2] = right.split('.').map(Number);
  return a1 !== b1 ? a1 - b1 : a2 - b2;
}

export function validateLinuxLibraries(value: unknown): LinuxLibraries {
  const invalid = 'The pinned Linux library packages are malformed.';
  check(isObject(value) && typeof value.distribution === 'string' && value.distribution.trim() !== '' && typeof value.minimumGlibc === 'string' && GLIBC.test(value.minimumGlibc), 'RUNTIME_SOURCES_INVALID', invalid);
  check(Array.isArray(value.system) && value.system.length > 0 && value.system.every(name => typeof name === 'string' && SONAME.test(name)), 'RUNTIME_SOURCES_INVALID', invalid);
  check(value.note === undefined || typeof value.note === 'string', 'RUNTIME_SOURCES_INVALID', invalid);
  check(Array.isArray(value.packages) && value.packages.length > 0, 'RUNTIME_SOURCES_INVALID', invalid);
  const names = new Set<string>();
  for (const entry of value.packages as unknown[]) {
    check(isObject(entry) && typeof entry.package === 'string' && PACKAGE.test(entry.package) && !names.has(entry.package) && typeof entry.version === 'string' && entry.version.trim() !== '', 'RUNTIME_SOURCES_INVALID', invalid);
    names.add(entry.package as string);
    check(httpsUrl(entry.url) && typeof entry.sha256 === 'string' && SHA256.test(entry.sha256), 'RUNTIME_SOURCES_INVALID', 'Every library package needs an HTTPS URL and a lowercase SHA-256 pin.');
    check(typeof entry.checksumSource === 'string' && entry.checksumSource.trim() !== '', 'RUNTIME_SOURCES_INVALID', 'Every library package pin must say where it was verified.');
    check(safeRelative(entry.copyright) && (entry.copyrightFrom === undefined || typeof entry.copyrightFrom === 'string'), 'RUNTIME_SOURCES_INVALID', invalid);
  }
  for (const entry of value.packages as LibraryPackage[]) check(entry.copyrightFrom === undefined || (entry.copyrightFrom !== entry.package && names.has(entry.copyrightFrom)), 'RUNTIME_SOURCES_INVALID', invalid);
  return value as LinuxLibraries;
}

/** Reads the dynamic section (NEEDED, SONAME, RUNPATH/RPATH) and version needs of a 64-bit little-endian ELF file; null when the bytes are not ELF. */
export function readElf(bytes: Buffer): ElfInfo | null {
  if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x7f454c46) return null;
  const bad = () => check(false, 'RUNTIME_ELF_INVALID', 'A runtime file has a malformed ELF header.');
  if (bytes[4] !== 2 || bytes[5] !== 1) bad();
  const u64 = (offset: number) => { const value = bytes.readBigUInt64LE(offset); return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value); };
  const machine = bytes.readUInt16LE(18), shoff = u64(0x28), shentsize = bytes.readUInt16LE(0x3a), shnum = bytes.readUInt16LE(0x3c);
  if (shnum === 0 || shentsize < 64 || shoff + shnum * shentsize > bytes.length) bad();
  const sections = Array.from({ length: shnum }, (_, index) => {
    const base = shoff + index * shentsize;
    return { type: bytes.readUInt32LE(base + 4), offset: u64(base + 24), size: u64(base + 32), link: bytes.readUInt32LE(base + 40), info: bytes.readUInt32LE(base + 44) };
  });
  for (const section of sections) if (section.type !== 8 && section.offset + section.size > bytes.length) bad();
  const string = (table: number, offset: number) => {
    const strtab = sections[table];
    if (!strtab || strtab.type !== 3 || offset >= strtab.size) bad();
    const start = strtab.offset + offset, end = bytes.indexOf(0, start);
    if (end < 0 || end > strtab.offset + strtab.size) bad();
    return bytes.toString('latin1', start, end);
  };
  const info: ElfInfo = { machine, soname: null, needed: [], runpath: null, versions: [], glibc: null };
  let rpath: string[] | null = null;
  for (const section of sections.filter(item => item.type === 6)) {
    for (let at = section.offset; at + 16 <= section.offset + section.size; at += 16) {
      const tag = bytes.readBigInt64LE(at), value = Number(bytes.readBigUInt64LE(at + 8));
      if (tag === 0n) break;
      if (tag === 1n) info.needed.push(string(section.link, value));
      else if (tag === 14n) info.soname = string(section.link, value);
      else if (tag === 29n) info.runpath = string(section.link, value).split(':').filter(Boolean);
      else if (tag === 15n) rpath = string(section.link, value).split(':').filter(Boolean);
    }
  }
  info.runpath ??= rpath;
  for (const section of sections.filter(item => item.type === 0x6ffffffe)) {
    let at = section.offset;
    for (let entry = 0; entry < section.info; entry += 1) {
      if (at + 16 > section.offset + section.size) bad();
      const count = bytes.readUInt16LE(at + 2), aux = bytes.readUInt32LE(at + 8), next = bytes.readUInt32LE(at + 12);
      let auxAt = at + aux;
      for (let index = 0; index < count; index += 1) {
        if (auxAt + 16 > section.offset + section.size) bad();
        info.versions.push(string(section.link, bytes.readUInt32LE(auxAt + 8)));
        const auxNext = bytes.readUInt32LE(auxAt + 12);
        if (!auxNext) break;
        auxAt += auxNext;
      }
      if (!next) break;
      at += next;
    }
  }
  for (const version of info.versions) {
    const match = /^GLIBC_(2\.\d+)$/.exec(version);
    if (match && (!info.glibc || compareGlibc(match[1], info.glibc) > 0)) info.glibc = match[1];
  }
  return info;
}

function runTool(executable: string, args: string[], timeoutMs = 300_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(accept => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', done = false;
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(deadline); accept({ code, stdout, stderr }); };
    const deadline = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-8_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', () => finish(null));
    child.once('close', code => finish(code));
  });
}

/** RUNPATH writer backed by patchelf. Refuses up front when the tool cannot run. */
export async function patchelfRunpath(executable = 'patchelf'): Promise<SetRunpath> {
  const version = await runTool(executable, ['--version'], 30_000);
  check(version.code === 0 && /patchelf/i.test(version.stdout), 'RUNTIME_PATCHELF_MISSING', 'Vendoring Linux libraries needs patchelf. Install it (for example pip install patchelf==0.17.2.4) or pass --patchelf with its absolute path.');
  return async (file, runpath) => {
    const result = await runTool(executable, ['--set-rpath', runpath, file]);
    check(result.code === 0, 'RUNTIME_PATCHELF_FAILED', 'patchelf could not rewrite a runtime library path.');
  };
}

/** Splits an `ar` archive (the .deb container) into its members. */
export function arMembers(bytes: Buffer): Map<string, Buffer> {
  check(bytes.length >= 8 && bytes.toString('latin1', 0, 8) === '!<arch>\n', 'RUNTIME_PACKAGE_INVALID', 'A library package is not a Debian archive.');
  const members = new Map<string, Buffer>();
  let at = 8;
  while (at + 60 <= bytes.length) {
    const name = bytes.toString('latin1', at, at + 16).trim().replace(/\/$/, '');
    const size = Number(bytes.toString('latin1', at + 48, at + 58).trim());
    check(bytes.toString('latin1', at + 58, at + 60) === '`\n' && Number.isSafeInteger(size) && size >= 0 && at + 60 + size <= bytes.length, 'RUNTIME_PACKAGE_INVALID', 'A library package is not a Debian archive.');
    members.set(name, bytes.subarray(at + 60, at + 60 + size));
    at += 60 + size + (size % 2);
  }
  return members;
}

/** Extracts a .deb's data archive into `destination` after refusing unsafe member names. */
export async function extractDeb(deb: string, destination: string): Promise<void> {
  const members = arMembers(await readFile(deb));
  const name = [...members.keys()].find(member => /^data\.tar(?:\.(?:zst|xz|gz))?$/.test(member));
  check(name !== undefined, 'RUNTIME_PACKAGE_INVALID', 'A library package has no data archive.');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  let data = members.get(name) as Buffer, tarFile = `${destination}.data.tar`;
  if (name.endsWith('.zst')) data = zstdDecompressSync(data);
  if (name.endsWith('.xz') || name.endsWith('.gz')) tarFile += name.endsWith('.xz') ? '.xz' : '.gz';
  await writeFile(tarFile, data, { mode: 0o600 });
  const listed = await runTool('tar', ['-tf', tarFile]);
  check(listed.code === 0, 'RUNTIME_EXTRACT_FAILED', 'A library package could not be listed.');
  for (const entry of listed.stdout.split(/\r?\n/).filter(Boolean)) {
    const clean = entry.replace(/\/+$/, '').replace(/^\.\//, '');
    check(clean === '' || clean === '.' || (!clean.includes('\\') && !clean.startsWith('/') && !clean.split('/').includes('..')), 'RUNTIME_ARCHIVE_UNSAFE', 'A library package contains an unsafe path.');
  }
  const extracted = await runTool('tar', ['-xf', tarFile, '-C', destination, '--no-same-owner', '--no-same-permissions']);
  check(extracted.code === 0, 'RUNTIME_EXTRACT_FAILED', 'A library package could not be extracted.');
}

/** Downloads (through the caller's verified downloader) and extracts each package once per staging run. */
export class LibraryPackages {
  private readonly extracted = new Map<string, Promise<string>>();
  private readonly work: string;
  private readonly download: (url: string, destination: string) => Promise<string>;
  constructor(work: string, download: (url: string, destination: string) => Promise<string>) { this.work = work; this.download = download; }
  root(entry: LibraryPackage): Promise<string> {
    let pending = this.extracted.get(entry.package);
    if (!pending) {
      pending = (async () => {
        await mkdir(this.work, { recursive: true, mode: 0o700 });
        const deb = join(this.work, `${entry.package}.deb`);
        const digest = await this.download(entry.url, deb);
        check(digest === entry.sha256, 'RUNTIME_HASH_MISMATCH', 'A downloaded library package does not match its pinned SHA-256.');
        const root = join(this.work, entry.package);
        await extractDeb(deb, root);
        return root;
      })();
      this.extracted.set(entry.package, pending);
    }
    return pending;
  }
}

async function elfFiles(root: string): Promise<{ path: string; info: ElfInfo }[]> {
  const found: { path: string; info: ElfInfo }[] = [];
  const walk = async (directory: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) { await walk(path); continue; }
      if (!item.isFile()) continue;
      const stat = await lstat(path);
      if (stat.size < 64 || stat.size > MAX_ELF_BYTES) continue;
      const info = readElf(await readFile(path));
      if (info) found.push({ path, info });
    }
  };
  await walk(root);
  return found;
}
/** Library files a package offers, by file name, resolved to regular files inside the package. */
async function packageLibraries(root: string): Promise<Map<string, string>> {
  const offered = new Map<string, string>();
  const realRoot = await realpath(root);
  const walk = async (directory: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) { if (!path.slice(root.length).includes(`${sep}share${sep}`)) await walk(path); continue; }
      if (!SONAME.test(item.name) || !/(?:^|\/)(?:usr\/)?lib(?:64)?\/(?:[a-z0-9_-]+-linux-gnu[a-z0-9_]*\/)?[^/]+$/.test(relative(root, path).split(sep).join('/'))) continue;
      let real: string;
      try { real = await realpath(path); } catch { continue; }
      const inside = relative(realRoot, real);
      if (inside.startsWith('..') || isAbsolute(inside) || !(await lstat(real)).isFile()) continue;
      if (!offered.has(item.name)) offered.set(item.name, real);
    }
  };
  await walk(root);
  return offered;
}
const runpathFor = (component: string, file: string) => {
  const up = relative(dirname(file), join(component, 'lib')).split(sep).join('/');
  return up === '' ? '$ORIGIN' : `$ORIGIN/${up}`;
};
const expand = (entry: string, file: string) => entry.replace(/^\$(?:ORIGIN|\{ORIGIN\})(?=\/|$)/, dirname(file));

/**
 * Vendors the libraries `component` needs from the pinned packages into `component/lib`, writes each used
 * package's copyright into `component/licenses/`, points every ELF file's RUNPATH at the bundled lib folder,
 * then proves each NEEDED name resolves inside the component (or is a declared system library) and that no
 * file needs a newer glibc than declared.
 */
export async function vendorLinuxLibraries(component: string, libraries: LinuxLibraries, options: { packages: LibraryPackages; setRunpath: SetRunpath; onNote?: (text: string) => void }): Promise<VendorReport> {
  const system = new Set(libraries.system);
  const libDirectory = join(component, 'lib');
  await mkdir(libDirectory, { recursive: true });
  const report: VendorReport = { vendored: [], patched: [], licenses: [], glibc: null, elfFiles: 0 };
  const present = async (name: string) => { try { return (await lstat(join(libDirectory, name))).isFile(); } catch { return false; } };
  let offered: Map<string, { path: string; entry: LibraryPackage }> | null = null;
  const offers = async () => {
    if (!offered) {
      offered = new Map();
      for (const entry of libraries.packages) for (const [name, path] of await packageLibraries(await options.packages.root(entry))) if (!offered.has(name)) offered.set(name, { path, entry });
    }
    return offered;
  };
  const queue = (await elfFiles(component)).flatMap(file => file.info.needed);
  const usedPackages = new Map<string, LibraryPackage>();
  while (queue.length) {
    const name = queue.shift() as string;
    if (system.has(name) || await present(name)) continue;
    check(SONAME.test(name), 'RUNTIME_LIBRARY_UNRESOLVED', 'A runtime file needs a library with an unexpected name.');
    const offer = (await offers()).get(name);
    check(offer !== undefined, 'RUNTIME_LIBRARY_UNRESOLVED', 'A runtime file needs a library that no pinned package provides.');
    const target = join(libDirectory, name);
    await copyFile(offer.path, target);
    await chmod(target, 0o755);
    report.vendored.push({ file: `lib/${name}`, package: offer.entry.package, version: offer.entry.version });
    usedPackages.set(offer.entry.package, offer.entry);
    const info = readElf(await readFile(target));
    check(info !== null, 'RUNTIME_ELF_INVALID', 'A vendored library is not an ELF file.');
    queue.push(...info.needed);
  }
  for (const entry of usedPackages.values()) {
    const holder = entry.copyrightFrom ? libraries.packages.find(item => item.package === entry.copyrightFrom) as LibraryPackage : entry;
    const source = join(await options.packages.root(holder), ...entry.copyright.split('/'));
    const real = await realpath(source).catch(() => null);
    check(real !== null && (await lstat(real)).isFile(), 'RUNTIME_LICENSE_MISSING', 'A vendored library package has no copyright file.');
    await mkdir(join(component, 'licenses'), { recursive: true });
    await copyFile(real, join(component, 'licenses', `${entry.package}.copyright`));
    report.licenses.push(`licenses/${entry.package}.copyright`);
  }
  for (const file of await elfFiles(component)) {
    // A leftover absolute RUNPATH (the build's /opt/postgresql/lib) would be searched even for libc: rewrite it too.
    if (!file.info.needed.some(name => !system.has(name)) && !file.info.runpath?.length) continue;
    const wanted = runpathFor(component, file.path);
    if (file.info.runpath?.length === 1 && file.info.runpath[0] === wanted) continue;
    await options.setRunpath(file.path, wanted);
    report.patched.push(relative(component, file.path).split(sep).join('/'));
  }
  const files = await elfFiles(component);
  report.elfFiles = files.length;
  for (const file of files) {
    check((file.info.runpath ?? []).every(entry => /^\$(?:ORIGIN|\{ORIGIN\})(?:\/|$)/.test(entry)), 'RUNTIME_LIBRARY_UNRESOLVED', 'A runtime file still searches a library folder outside the bundled runtime.');
    for (const name of file.info.needed) {
      if (system.has(name)) continue;
      const directories = (file.info.runpath ?? []).map(entry => expand(entry, file.path)).filter(directory => { const inside = relative(component, directory); return !inside.startsWith('..') && !isAbsolute(inside); });
      let found = false;
      for (const directory of directories) { try { found = (await lstat(join(directory, name))).isFile(); } catch { found = false; } if (found) break; }
      check(found, 'RUNTIME_LIBRARY_UNRESOLVED', 'A runtime file still needs a library from outside the bundled runtime.');
    }
    if (file.info.glibc && (!report.glibc || compareGlibc(file.info.glibc, report.glibc) > 0)) report.glibc = file.info.glibc;
  }
  check(!report.glibc || compareGlibc(report.glibc, libraries.minimumGlibc) <= 0, 'RUNTIME_GLIBC_TOO_NEW', 'A bundled file needs a newer glibc than the runtime declares as its minimum.');
  options.onNote?.(`Vendored ${report.vendored.length} libraries from ${usedPackages.size} packages into ${posix.basename(component)}/lib; rewrote ${report.patched.length} library paths; ${report.elfFiles} ELF files need glibc ${report.glibc ?? 'any'} (declared minimum ${libraries.minimumGlibc}).`);
  return report;
}
