import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platforms = new Set(['win32', 'darwin', 'linux']);
const architectures = new Set(['x64', 'arm64']);
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const previewOutput = 'release/preview';
const flags = { win32: '--win', darwin: '--mac', linux: '--linux' };
const binaryPaths = { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron', linux: 'electron' };
const artifactOS = { win32: 'win', darwin: 'mac', linux: 'linux' };
const artifactExtensions = { win32: ['zip'], darwin: ['dmg', 'zip'], linux: ['AppImage', 'tar.gz'] };
// The window is the Ink app (app/ui). A package carries its build (app/ui/dist), made fresh by packageDesktop, and never
// its sources, tests, public files already copied into the build, fonts already copied into the build, or tooling.
const inkBuildGlob = 'app/ui/dist/**/*';
export const INK_SOURCE_EXCLUSIONS = Object.freeze(['!app/ui/src/**/*', '!app/ui/tests/**/*', '!app/ui/public/**/*', '!app/ui/assets/**/*', '!app/ui/node_modules/**/*',
  '!app/ui/index.html', '!app/ui/README.md', '!app/ui/tsconfig.json', '!app/ui/vite.config.ts', '!app/ui/vitest.config.ts']);
const inkConfig = 'app/ui/vite.config.ts';

function inside(root, path) {
  const result = relative(root, path);
  return result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result);
}
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('requires a regular local file');
  return info;
}

/** Read only executable headers. This never starts the executable or asserts vendor qualification. */
export async function validateElectronExecutable(path, platform, architecture) {
  if (!platforms.has(platform) || !architectures.has(architecture)) throw new Error('invalid executable target');
  const info = await regular(path);
  if (info.size < 4096 || platform !== 'win32' && !(info.mode & 0o111)) throw new Error('Electron requires a native executable distribution with correct permissions');
  const handle = await open(path, 'r');
  const read = async (size, offset = 0) => {
    const bytes = Buffer.alloc(size);
    if ((await handle.read(bytes, 0, size, offset)).bytesRead !== size) throw new Error('Electron executable header is truncated');
    return bytes;
  };
  try {
    const header = await read(64), magic = header.subarray(0, 4).toString('hex');
    if (platform === 'win32') {
      if (header.subarray(0, 2).toString() !== 'MZ') throw new Error('Electron must be a Windows PE executable');
      const offset = header.readUInt32LE(60);
      if (offset < 64 || offset > 4_194_304 || offset + 6 > info.size) throw new Error('Electron PE header location is invalid');
      const pe = await read(6, offset);
      if (pe.subarray(0, 4).toString('hex') !== '50450000' || pe.readUInt16LE(4) !== (architecture === 'x64' ? 0x8664 : 0xaa64)) throw new Error('Electron Windows architecture differs from the package target');
    } else if (platform === 'linux') {
      if (magic !== '7f454c46' || header[4] !== 2 || ![1, 2].includes(header[5])) throw new Error('Electron must be a 64-bit Linux ELF executable');
      const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
      if (machine !== (architecture === 'x64' ? 62 : 183)) throw new Error('Electron Linux architecture differs from the package target');
    } else {
      const machine = architecture === 'x64' ? 0x01000007 : 0x0100000c;
      if (['cffaedfe', 'feedfacf'].includes(magic)) {
        if ((magic === 'cffaedfe' ? header.readUInt32LE(4) : header.readUInt32BE(4)) !== machine) throw new Error('Electron macOS architecture differs from the package target');
      } else if (['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)) {
        const little = ['bebafeca', 'bfbafeca'].includes(magic), uint32 = (bytes, offset) => little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
        const count = uint32(header, 4), width = ['cafebabf', 'bfbafeca'].includes(magic) ? 32 : 20;
        if (!count || count > 64 || 8 + count * width > info.size) throw new Error('Electron universal header is invalid');
        const table = await read(count * width, 8);
        if (!Array.from({ length: count }, (_, index) => uint32(table, index * width)).includes(machine)) throw new Error('Electron universal executable lacks the package architecture');
      } else throw new Error('Electron must be a macOS Mach-O executable');
    }
  } finally { await handle.close(); }
}
/** Validate the supplied dist without importing electron, which can automatically download a missing binary. */
export async function validateLocalElectronDistribution(electronRoot, version, platform, architecture) {
  const dist = join(electronRoot, 'dist'), info = await lstat(dist);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Electron dist must be a real local directory');
  const versionPath = join(dist, 'version');
  await regular(versionPath);
  if ((await readFile(versionPath, 'utf8')).trim().replace(/^v/, '') !== version) throw new Error('Electron dist version differs from the exact project pin');
  const pathFile = join(electronRoot, 'path.txt');
  await regular(pathFile);
  if ((await readFile(pathFile, 'utf8')).trim() !== binaryPaths[platform]) throw new Error('the installed Electron distribution must match the target platform');
  await validateElectronExecutable(join(dist, binaryPaths[platform]), platform, architecture);
}
function nodeVersionSupported(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return major > 24 || major === 24 && (minor > 13 || minor === 13 && patch >= 1);
}

/** Native builds deliberately require the host OS and architecture; this is not a cross-compilation claim. */
export function createDesktopPackagePlan({ mode = 'preview', platform = process.platform, architecture = process.arch, unpacked = false, hostPlatform = process.platform, hostArchitecture = process.arch } = {}) {
  if (!['preview', 'final'].includes(mode)) throw new Error('mode must be preview or final');
  if (!platforms.has(platform) || !architectures.has(architecture)) throw new Error('supported targets are win32, darwin or linux with x64 or arm64 architecture');
  if (platform !== hostPlatform || architecture !== hostArchitecture) throw new Error(`build ${platform}-${architecture} on a matching native host; this host is ${hostPlatform}-${hostArchitecture}`);
  if (typeof unpacked !== 'boolean') throw new Error('unpacked must be a boolean');
  return {
    mode, platform, architecture, unpacked, target: `${platform}-${architecture}`,
    config: `app/desktop/builder${mode === 'preview' ? '.preview' : ''}.json`,
    output: mode === 'preview' ? previewOutput : 'release',
    builderArguments: ['--config', `app/desktop/builder${mode === 'preview' ? '.preview' : ''}.json`, flags[platform], `--${architecture}`, '--publish', 'never', ...(unpacked ? ['--dir'] : [])],
    qualification: mode === 'preview' ? 'unsigned demo preview; no production runtimes, signing, publishing or update channel' : 'signed prerequisites required; packaging does not prove native launch or rollback',
  };
}

export function parseDesktopPackageArguments(args) {
  const result = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--check') result.checkOnly = true;
    else if (flag === '--dir') result.unpacked = true;
    else if (['--mode', '--platform', '--arch'].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
      result[flag === '--arch' ? 'architecture' : flag.slice(2)] = value;
    } else throw new Error(`unknown option: ${flag}; use --mode preview|final --platform win32|darwin|linux --arch x64|arm64 [--dir] [--check]`);
  }
  return result;
}

/** Preview child processes never receive signing, release publishing or production service credentials. */
export function desktopPackagingEnvironment(mode, environment = process.env) {
  if (!['preview', 'final'].includes(mode)) throw new Error('mode must be preview or final');
  const result = { ...environment };
  if (mode === 'preview') {
    for (const name of Object.keys(result)) {
      if (/^(?:CSC_|WIN_CSC_|APPLE_|CHAUSAR_|AWS_|DO_|KEYGEN_|COMPOSIO_)/i.test(name) || /(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)/i.test(name)) delete result[name];
    }
    result.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  return result;
}

/** Both configurations ship the Ink build and none of its sources; nothing names the retired app/renderer. */
export function validateInkPackagingConfig(config) {
  if (!Array.isArray(config.files) || !config.files.includes(inkBuildGlob)) throw new Error(`the package must include the Ink build (${inkBuildGlob})`);
  for (const glob of INK_SOURCE_EXCLUSIONS) if (!config.files.includes(glob)) throw new Error(`the package must exclude Ink sources and tooling (${glob})`);
  if (JSON.stringify([config.files, config.asarUnpack ?? []]).includes('app/renderer')) throw new Error('the retired app/renderer must not be packaged');
  if ((config.asarUnpack ?? []).some(glob => glob.startsWith('app/ui'))) throw new Error('the Ink build is read from the archive; it is never unpacked');
}

function validatePreviewConfig(config) {
  if (config.appId !== 'in.chausar.desktop.preview' || config.productName !== 'Chausar Unsigned Preview' || config.extraMetadata?.name !== 'chausar-preview' || config.extraMetadata?.chausarPreview !== true || config.extraMetadata?.chausarReleaseChannel !== 'unsigned-preview') throw new Error('preview requires a separate identity and explicit unsigned demo metadata');
  if (config.forceCodeSigning !== false || config.win?.signAndEditExecutable !== false || config.mac?.identity !== null || config.mac?.notarize !== false || config.mac?.hardenedRuntime !== false) throw new Error('preview config must disable native signing, identity discovery and notarization');
  if (config.publish !== null || config.npmRebuild !== false || config.extraResources?.length !== 0 || config.directories?.output !== previewOutput) throw new Error('preview must disable publishing, dependency rebuilds and native runtime resources and use release/preview');
  if (config.extends !== undefined || Object.keys(config).some(name => /^(before|after|artifactBuild|onNodeModule)/.test(name))) throw new Error('preview cannot inherit final configuration or execute custom build hooks');
  if (config.electronDist !== 'node_modules/electron/dist') throw new Error('preview must use the verified local Electron distribution instead of another download');
  const expected = { win: ['zip'], mac: ['dmg', 'zip'], linux: ['AppImage', 'tar.gz'] };
  for (const [key, targets] of Object.entries(expected)) {
    if (JSON.stringify(config[key]?.target) !== JSON.stringify(targets)) throw new Error(`preview ${key} targets must match the documented formats; Windows preview is ZIP only`);
  }
  for (const glob of ['app/desktop/**/*', inkBuildGlob, 'platform/runtime/**/*', 'fixtures/**/*', 'node_modules/**/*']) {
    if (!config.files?.includes(glob)) throw new Error(`preview package is missing ${glob}`);
  }
  for (const glob of ['platform/runtime/**/*', 'node_modules/**/*']) {
    if (!config.asarUnpack?.includes(glob)) throw new Error(`preview worker execution requires unpacked ${glob}`);
  }
}

async function dependencyPrerequisites(root, platform) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const { compareVersions } = await import('../platform/runtime/updater.ts');
  compareVersions(pkg.version, pkg.version);
  if (!exactVersion.test(pkg.version ?? '')) throw new Error('package version must be an exact release version');
  if (pkg.main !== 'app/desktop/main.cjs') throw new Error('desktop entrypoint must be app/desktop/main.cjs');
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!exactVersion.test(version)) throw new Error(`dependency ${name} requires an exact pin`);
  }
  const lockPath = join(root, 'package-lock.json');
  try { await regular(lockPath); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('package-lock.json is absent; an approved registry install must generate a genuine npm lockfile first'); throw error; }
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (lock.lockfileVersion !== 3 || lock.packages?.['']?.version !== pkg.version) throw new Error('a genuine npm v3 lockfile matching package.json is required; generate it only with an approved registry install');
  for (const kind of ['dependencies', 'devDependencies']) {
    if (JSON.stringify(Object.entries(lock.packages[''][kind] ?? {}).sort()) !== JSON.stringify(Object.entries(pkg[kind] ?? {}).sort())) throw new Error(`locked ${kind} differs from package.json`);
    for (const [name, version] of Object.entries(pkg[kind] ?? {})) {
      if (lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`lockfile does not resolve the exact ${name} pin`);
    }
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (entry.link || !exactVersion.test(entry.version ?? '') || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity ?? '')) throw new Error('locked packages require exact versions and registry integrity hashes');
    const url = new URL(entry.resolved);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('locked packages must resolve to HTTPS registry artifacts');
  }
  for (const name of ['electron', 'electron-builder', 'vite', 'pg', '@duckdb/node-api']) {
    const packagePath = join(root, 'node_modules', name, 'package.json');
    await regular(packagePath);
    const installed = JSON.parse(await readFile(packagePath, 'utf8'));
    if (installed.version !== (pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])) throw new Error(`installed ${name} differs from its pin; use an approved npm ci`);
  }
  const builderRoot = join(root, 'node_modules', 'electron-builder');
  const builder = JSON.parse(await readFile(join(builderRoot, 'package.json'), 'utf8'));
  const bin = typeof builder.bin === 'string' ? builder.bin : builder.bin?.['electron-builder'];
  if (typeof bin !== 'string' || !inside(builderRoot, resolve(builderRoot, bin))) throw new Error('installed electron-builder requires a local bin entry inside its package');
  const cliPath = resolve(builderRoot, bin);
  await regular(cliPath);
  // The Ink build runs through Vite's own local CLI, never npm or a shell.
  const viteRoot = join(root, 'node_modules', 'vite');
  const vite = JSON.parse(await readFile(join(viteRoot, 'package.json'), 'utf8'));
  const viteBin = typeof vite.bin === 'string' ? vite.bin : vite.bin?.vite;
  if (typeof viteBin !== 'string' || !inside(viteRoot, resolve(viteRoot, viteBin))) throw new Error('installed vite requires a local bin entry inside its package');
  const viteCli = resolve(viteRoot, viteBin);
  await regular(viteCli);
  const electronRoot = join(root, 'node_modules', 'electron');
  const executable = (await readFile(join(electronRoot, 'path.txt'), 'utf8')).trim();
  if (executable !== binaryPaths[platform]) throw new Error('the installed Electron distribution must match the target platform');
  await validateLocalElectronDistribution(electronRoot, pkg.devDependencies.electron, platform, process.arch);
  return { cliPath, viteCli, version: pkg.version };
}

/** Read-only: never installs dependencies, vendors runtimes, creates keys or starts Electron. */
export async function desktopPackagePrerequisites({ root = projectRoot, plan = createDesktopPackagePlan(), environment = process.env } = {}) {
  const expectedPlan = createDesktopPackagePlan({ mode: plan.mode, platform: plan.platform, architecture: plan.architecture, unpacked: plan.unpacked });
  if (JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new Error('packaging requires an unchanged native plan; arbitrary builder options are refused');
  const failures = [], checks = [];
  let cliPath, viteCli, version;
  const check = async (name, work) => {
    try { await work(); checks.push(name); }
    catch (error) { failures.push({ check: name, reason: error.code === 'ENOENT' ? 'required local file is missing; no download or substitute was attempted' : error.message }); }
  };
  await check('Node runtime', () => { if (!nodeVersionSupported(process.versions.node)) throw new Error('Node 24.13.1 or later is required'); });
  await check('desktop source entrypoints', async () => {
    for (const path of ['app/desktop/main.cjs', 'app/desktop/preload.cjs', 'app/desktop/engine-harness.cjs', 'app/desktop/ipc-contract.cjs', 'app/desktop/icon.png', 'platform/runtime/worker.ts', 'app/ui/index.html', 'app/ui/src/main.tsx', inkConfig]) await regular(join(root, path));
  });
  await check('locked local packaging dependencies and Electron distribution', async () => { ({ cliPath, viteCli, version } = await dependencyPrerequisites(root, plan.platform)); });
  await check('packaging configuration', async () => {
    const config = JSON.parse(await readFile(join(root, plan.config), 'utf8'));
    validateInkPackagingConfig(config);
    if (plan.mode === 'preview') validatePreviewConfig(config);
    else if (config.forceCodeSigning !== true || config.publish !== null || config.extraMetadata?.chausarPreview === true) throw new Error('final config must keep signed-release gating and disable publishing');
  });
  if (plan.mode === 'final') {
    const { packagePreflight } = await import('./package-preflight.mjs');
    const final = await packagePreflight({ root, platform: plan.platform, architecture: plan.architecture, environment });
    checks.push(...final.checks.map(name => `final: ${name}`));
    failures.push(...final.failures.map(item => ({ ...item, check: `final: ${item.check}` })));
  }
  return { ok: failures.length === 0, mode: plan.mode, target: plan.target, cliPath, viteCli, version, checks, failures, qualification: plan.qualification };
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Check freshness before building; never remove or overwrite previous output. */
export async function validateDesktopPackagingOutput({ root = projectRoot, plan = createDesktopPackagePlan(), version } = {}) {
  if (!exactVersion.test(version ?? '')) throw new Error('output checks require an exact package version');
  const expectedPlan = createDesktopPackagePlan({ mode: plan.mode, platform: plan.platform, architecture: plan.architecture, unpacked: plan.unpacked });
  if (JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new Error('packaging requires an unchanged native plan; arbitrary builder options are refused');
  for (const path of ['release', ...(plan.mode === 'preview' ? ['release/preview'] : [])]) {
    try {
      const info = await lstat(join(root, path));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('packaging output paths must be real directories inside the checkout');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const receiptPath = join(root, plan.output, `packaging-receipt-${plan.target}.json`);
  try {
    const priorOutput = await readdir(join(root, plan.output));
    if (priorOutput.length) throw new Error('packaging output directory is not empty; review and move or archive the previous output before another build');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const expectedArtifacts = plan.mode === 'preview' ? artifactExtensions[plan.platform].map(extension => `Chausar-Preview-${version}-${artifactOS[plan.platform]}-${plan.architecture}.${extension}`) : [];
  return { receiptPath, expectedArtifacts };
}

/**
 * The children packaging runs, in order: the Ink build (vite build, which empties and refills app/ui/dist), then
 * electron-builder. Each is a local CLI run by this Node, with no shell. Nothing else is spawned.
 */
export function desktopPackageCommands(plan, { cliPath, viteCli }) {
  return [
    { name: 'Ink build', args: [viteCli, 'build', '--config', inkConfig] },
    { name: 'electron-builder', args: [cliPath, ...plan.builderArguments] },
  ];
}

/** Windows preview uses ZIP without NSIS. Final NSIS builds can execute their generated installer while extracting the uninstaller. No release/update publication is performed. */
export async function packageDesktop({ root = projectRoot, plan = createDesktopPackagePlan(), environment = process.env, checkOnly = false } = {}) {
  const prerequisites = await desktopPackagePrerequisites({ root, plan, environment });
  if (!prerequisites.ok || checkOnly) return { ...prerequisites, packaged: false, checkOnly };
  const { receiptPath, expectedArtifacts } = await validateDesktopPackagingOutput({ root, plan, version: prerequisites.version });
  for (const command of desktopPackageCommands(plan, prerequisites)) {
    const status = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, command.args, { cwd: root, env: desktopPackagingEnvironment(plan.mode, environment), shell: false, windowsHide: true, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => signal ? reject(new Error(`${command.name} stopped with signal ${signal}`)) : accept(code));
    });
    if (status !== 0) throw new Error(`${command.name} failed with exit code ${status}`);
    // The window refuses to start without the build, so a package without it is refused here first.
    if (command.name === 'Ink build') await regular(join(root, 'app/ui/dist/index.html'));
  }
  const artifacts = [];
  if (plan.mode === 'preview' && !plan.unpacked) {
    const output = join(root, previewOutput);
    for (const name of expectedArtifacts) {
      const path = join(output, name), info = await regular(path);
      artifacts.push({ path: name, size: info.size, sha256: await sha256(path) });
    }
  }
  const receipt = { schemaVersion: 1, mode: plan.mode, target: plan.target, version: prerequisites.version, packaged: true, unpacked: plan.unpacked, signed: plan.mode === 'preview' ? false : 'requires-native-verification', published: false, qualification: plan.qualification, checks: [...prerequisites.checks, 'Ink app built to app/ui/dist'], artifacts };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return { ...prerequisites, packaged: true, receiptPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { checkOnly = false, ...options } = parseDesktopPackageArguments(process.argv.slice(2));
    const plan = createDesktopPackagePlan(options);
    const result = await packageDesktop({ plan, checkOnly });
    if (!result.ok) {
      console.error(`Desktop packaging blocked (${result.mode}, ${result.target}).`);
      for (const failure of result.failures) console.error(`- ${failure.check}: ${failure.reason}`);
      process.exitCode = 1;
    } else if (checkOnly) console.log(`Packaging prerequisites passed (${plan.mode}, ${plan.target}); no package or launch was attempted.`);
    else console.log(`Desktop package created (${plan.mode}, ${plan.target}). ${plan.qualification}. Receipt: ${result.receiptPath}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
