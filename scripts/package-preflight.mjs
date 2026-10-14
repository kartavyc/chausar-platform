import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platforms = new Set(['win32', 'darwin', 'linux']);
const architectures = new Set(['x64', 'arm64']);
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const runtimeVersion = /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const safeRelative = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_.+@ /-]+$/;

async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('must be a regular file, without a symbolic link');
  return info;
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function nativeExecutable(path, info, platform, architecture) {
  const handle = await open(path, 'r');
  const header = Buffer.alloc(64);
  const read = async (buffer, offset) => {
    const result = await handle.read(buffer, 0, buffer.length, offset);
    if (result.bytesRead !== buffer.length) throw new Error('native executable header is truncated');
  };
  try {
    await read(header, 0);
    const magic = header.subarray(0, 4).toString('hex');
    if (platform === 'win32') {
      if (header.subarray(0, 2).toString() !== 'MZ') throw new Error('runtime must be a Windows PE executable');
      const offset = header.readUInt32LE(60);
      if (offset < 64 || offset > 4_194_304 || offset + 6 > info.size) throw new Error('Windows PE header location is invalid');
      const pe = Buffer.alloc(6); await read(pe, offset);
      if (pe.subarray(0, 4).toString('hex') !== '50450000' || pe.readUInt16LE(4) !== (architecture === 'x64' ? 0x8664 : 0xaa64)) throw new Error('Windows executable architecture does not match the package target');
    } else if (platform === 'linux') {
      if (magic !== '7f454c46' || header[4] !== 2 || ![1, 2].includes(header[5])) throw new Error('runtime must be a 64-bit Linux ELF executable');
      const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
      if (machine !== (architecture === 'x64' ? 62 : 183)) throw new Error('Linux executable architecture does not match the package target');
    } else {
      const machine = architecture === 'x64' ? 0x01000007 : 0x0100000c;
      if (magic === 'cffaedfe' || magic === 'feedfacf') {
        const actual = magic === 'cffaedfe' ? header.readUInt32LE(4) : header.readUInt32BE(4);
        if (actual !== machine) throw new Error('macOS executable architecture does not match the package target');
      } else if (['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)) {
        const little = ['bebafeca', 'bfbafeca'].includes(magic);
        const uint32 = (data, offset) => little ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
        const count = uint32(header, 4);
        const width = ['cafebabf', 'bfbafeca'].includes(magic) ? 32 : 20;
        if (!count || count > 64 || 8 + count * width > info.size) throw new Error('macOS universal executable header is invalid');
        const table = Buffer.alloc(count * width); await read(table, 8);
        if (!Array.from({ length: count }, (_, index) => uint32(table, index * width)).includes(machine)) throw new Error('macOS universal executable does not contain the package architecture');
      } else throw new Error('runtime must be a macOS Mach-O executable');
    }
  } finally { await handle.close(); }
}
async function safeTree(directory, paths = [], prefix = '') {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('runtime directories must be real directories');
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('symbolic links are forbidden in vendored runtimes');
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) await safeTree(join(directory, item.name), paths, name);
    else if (item.isFile()) paths.push(name);
    else throw new Error('special filesystem entries are forbidden in vendored runtimes');
    if (paths.length > 20000) throw new Error('runtime bundle exceeds the 20,000 file limit');
  }
  return paths;
}
function ownKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

/** Read-only prerequisite check. Passing does not assert a signed or qualified native release. */
export async function packagePreflight({ root = projectRoot, platform = process.platform, architecture = process.arch, environment = process.env } = {}) {
  const failures = [];
  const checks = [];
  const check = async (name, fn) => {
    try { await fn(); checks.push(name); }
    catch (error) { failures.push({ check: name, reason: error.code === 'ENOENT' ? 'required file or directory is missing' : error.message }); }
  };
  const requireValue = (name) => {
    if (typeof environment[name] !== 'string' || !environment[name].trim()) throw new Error(`${name} must be supplied by the release operator`);
    return environment[name];
  };
  if (!platforms.has(platform) || !architectures.has(architecture)) return { ok: false, failures: [{ check: 'target', reason: 'supported targets are win32, darwin or linux with x64 or arm64 architecture' }], checks: [] };
  const target = `${platform}-${architecture}`;
  await check('Node runtime', () => {
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    if (major < 24 || major === 24 && (minor < 13 || minor === 13 && patch < 1)) throw new Error('Node 24.13.1 or later is required');
  });

  let pkg;
  await check('exact dependency pins', async () => {
    pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const { compareVersions } = await import('../platform/runtime/updater.ts');
    compareVersions(pkg.version, pkg.version);
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (typeof version !== 'string' || !exactVersion.test(version)) throw new Error(`dependency ${name} requires an exact release version`);
    }
  });
  await check('genuine npm dependency lockfile', async () => {
    if (!pkg) throw new Error('package.json must be valid first');
    const path = join(root, 'package-lock.json');
    await regular(path);
    const lock = JSON.parse(await readFile(path, 'utf8'));
    if (lock.lockfileVersion !== 3 || !lock.packages?.[''] || lock.packages[''].version !== pkg.version) throw new Error('npm lockfile version 3 must match package.json');
    for (const kind of ['dependencies', 'devDependencies']) {
      if (JSON.stringify(Object.entries(lock.packages[''][kind] ?? {}).sort()) !== JSON.stringify(Object.entries(pkg[kind] ?? {}).sort())) throw new Error(`locked ${kind} must match package.json`);
      for (const [name, version] of Object.entries(pkg[kind] ?? {})) {
        if (lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`the lockfile must resolve the exact ${name} version`);
      }
    }
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue;
      if (entry.link || !exactVersion.test(entry.version ?? '') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity ?? '')) throw new Error('every locked package requires an exact version and registry integrity hash');
      const url = new URL(entry.resolved);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('every locked package must resolve to an HTTPS registry artifact');
    }
  });
  await check('installed packaging dependencies', async () => {
    if (!pkg) throw new Error('package.json must be valid first');
    for (const name of ['electron', 'electron-builder', 'pg', '@duckdb/node-api']) {
      const path = join(root, 'node_modules', name, 'package.json');
      await regular(path);
      const installed = JSON.parse(await readFile(path, 'utf8'));
      if (installed.version !== (pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])) throw new Error(`run npm ci: installed ${name} does not match its exact pin`);
    }
  });

  const vendorRoot = join(root, 'runtime-binaries');
  const bundle = vendorRoot;
  const extension = platform === 'win32' ? '.exe' : '';
  const executables = ['postgres', 'initdb', 'pg_ctl'].map(name => `postgres/bin/${name}${extension}`);
  executables.push(platform === 'win32' ? 'python/python.exe' : 'python/bin/python3');
  for (const path of executables) {
    await check(`vendored ${path}`, async () => {
      const filename = join(bundle, ...path.split('/'));
      const info = await regular(filename);
      if (info.size < 4096) throw new Error('executable is too small to be a genuine native runtime');
      if (platform !== 'win32' && !(info.mode & 0o111)) throw new Error('native binary must have executable permissions');
      await nativeExecutable(filename, info, platform, architecture);
    });
  }
  await check('complete runtime integrity and provenance manifest', async () => {
    const vendorInfo = await lstat(vendorRoot);
    if (!vendorInfo.isDirectory() || vendorInfo.isSymbolicLink()) throw new Error('runtime-binaries must be a real directory');
    const manifestPath = join(bundle, 'manifest.json');
    const manifestInfo = await regular(manifestPath);
    if (manifestInfo.size > 2_000_000) throw new Error('runtime manifest exceeds 2 MB');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!ownKeys(manifest, ['schemaVersion', 'platform', 'architecture', 'components', 'files']) || manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.architecture !== architecture) throw new Error('runtime manifest schema and target must match the package target');
    if (!ownKeys(manifest.components, ['postgres', 'python']) || !Array.isArray(manifest.files) || manifest.files.length > 20000) throw new Error('runtime manifest requires PostgreSQL and Python provenance plus complete file inventory');
    const inventory = new Map();
    for (const entry of manifest.files) {
      if (!ownKeys(entry, ['path', 'sha256', 'size']) || typeof entry.path !== 'string' || !safeRelative.test(entry.path) || entry.path.includes('\\') || entry.path === 'manifest.json' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 1_073_741_824 || inventory.has(entry.path)) throw new Error('runtime inventory contains an unsafe, duplicate or invalid entry');
      inventory.set(entry.path, entry);
    }
    for (const name of ['postgres', 'python']) {
      const component = manifest.components[name];
      if (!ownKeys(component, ['version', 'source', 'license', 'licenseFile']) || !runtimeVersion.test(component.version) || typeof component.license !== 'string' || !component.license.trim() || !inventory.has(component.licenseFile)) throw new Error(`${name} requires an exact version, source and bundled license`);
      const source = new URL(component.source);
      if (source.protocol !== 'https:' || source.username || source.password) throw new Error(`${name} provenance must be a public HTTPS vendor source`);
    }
    const files = (await safeTree(bundle)).filter(path => path !== 'manifest.json');
    if (files.length !== inventory.size || files.some(path => !inventory.has(path)) || executables.some(path => !inventory.has(path))) throw new Error('the integrity inventory must cover every bundled file, including all required executables');
    for (const [path, entry] of inventory) {
      const file = resolve(bundle, ...path.split('/'));
      if (relative(bundle, file).startsWith(`..${sep}`) || isAbsolute(relative(bundle, file))) throw new Error('runtime file leaves its target bundle');
      const info = await regular(file);
      if (info.size !== entry.size || await digest(file) !== entry.sha256) throw new Error(`runtime integrity failed for ${path}`);
    }
  });

  await check('packaged helpers and runtime resource paths', async () => {
    await regular(join(root, 'platform', 'helpers', 'analytics.py'));
    await regular(join(root, 'scripts', 'postgres-runtime.mjs'));
    const builder = JSON.parse(await readFile(join(root, 'app', 'desktop', 'builder.json'), 'utf8'));
    if (!builder.files?.some(value => ['platform/helpers/**/*', 'platform/**/*', '**/*'].includes(value))) throw new Error('electron-builder files must include platform/helpers/**/*');
    if (!builder.asarUnpack?.some(value => ['platform/helpers/**/*', 'platform/**/*', '**/*'].includes(value))) throw new Error('the Python helper must be unpacked for native execution');
    if (!builder.files?.some(value => ['scripts/postgres-runtime.mjs', 'scripts/**/*', '**/*'].includes(value))) throw new Error('electron-builder files must include scripts/postgres-runtime.mjs');
    if (!builder.asarUnpack?.some(value => ['scripts/postgres-runtime.mjs', 'scripts/**/*', '**/*'].includes(value))) throw new Error('the PostgreSQL launcher must be unpacked for native execution');
    if (!builder.extraResources?.some(value => value.from === 'runtime-binaries' && value.to === 'runtime-binaries')) throw new Error('electron-builder must ship runtime-binaries as external resources');
    if (platform === 'win32' && builder.win?.signAndEditExecutable !== true) throw new Error('Windows executable signing must be enabled');
    if (platform === 'darwin' && builder.mac?.hardenedRuntime !== true) throw new Error('macOS hardened runtime must be enabled');
  });
  await check('Ed25519 release manifest signing key pair', async () => {
    const privatePath = requireValue('CHAUSAR_RELEASE_PRIVATE_KEY_FILE');
    const publicPath = requireValue('CHAUSAR_RELEASE_PUBLIC_KEY_FILE');
    if (!isAbsolute(privatePath) || !isAbsolute(publicPath)) throw new Error('release signing key files must use explicit absolute paths outside the source tree');
    const privateRelative = relative(resolve(root), resolve(privatePath));
    if (!privateRelative.startsWith(`..${sep}`) && !isAbsolute(privateRelative)) throw new Error('the private release key must not be stored in the source repository');
    const privateInfo = await regular(privatePath);
    const publicInfo = await regular(publicPath);
    if (privateInfo.size > 65536 || publicInfo.size > 65536) throw new Error('release signing key file exceeds 64 KB');
    if (platform !== 'win32' && privateInfo.mode & 0o077) throw new Error('the private release key file must have owner-only permissions');
    const privateKey = createPrivateKey(await readFile(privatePath));
    const publicKey = createPublicKey(await readFile(publicPath));
    if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') throw new Error('release manifest signing requires Ed25519 keys');
    const message = Buffer.from('Chausar release prerequisite key ownership check v1');
    if (!verify(null, message, publicKey, sign(null, message, privateKey))) throw new Error('the release signing key pair does not match');
  });
  if (platform === 'win32' || platform === 'darwin') {
    await check('native installer signing credential', async () => {
      // Windows may sign through a configured cloud key service instead of a local certificate file.
      if (platform === 'win32' && environment.CHAUSAR_WIN_SIGNER) { createRequire(import.meta.url)('./release/windows-sign.cjs').signingConfiguration(environment); return; }
      const certificate = requireValue('CSC_LINK');
      requireValue('CSC_KEY_PASSWORD');
      if (!isAbsolute(certificate)) throw new Error('CSC_LINK must point to an explicit absolute local signing certificate file');
      const certificateRelative = relative(resolve(root), resolve(certificate));
      if (!certificateRelative.startsWith(`..${sep}`) && !isAbsolute(certificateRelative)) throw new Error('the native signing certificate must not be stored in the source repository');
      await regular(certificate);
    });
  }
  if (platform === 'darwin') {
    await check('macOS notarization credentials', () => {
      requireValue('APPLE_ID'); requireValue('APPLE_APP_SPECIFIC_PASSWORD'); requireValue('APPLE_TEAM_ID');
    });
  }
  return { ok: failures.length === 0, target, failures, checks, qualification: 'prerequisites only; native signing, launch and recovery verification remain required' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!['--platform', '--arch'].includes(args[index]) || !args[index + 1]) throw new Error('usage: node scripts/package-preflight.mjs [--platform win32|darwin|linux] [--arch x64|arm64]');
      const key = args[index] === '--arch' ? 'architecture' : 'platform';
      if (options[key]) throw new Error('duplicate target option');
      options[key] = args[index + 1];
    }
    const result = await packagePreflight(options);
    if (!result.ok) {
      console.error(`Release packaging blocked (${result.target ?? 'invalid target'}).`);
      for (const failure of result.failures) console.error(`- ${failure.check}: ${failure.reason}`);
      process.exitCode = 1;
    } else console.log(`Package prerequisites passed for ${result.target}. Native signing and release qualification must still pass.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
