import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { lockfileProblems, PINNED_BUILD_GIT_SOURCES } from './lockfile.mjs';
import { TRIM } from './package-trim.mjs';
import { readPackageContents, resourcesFolder } from './package-contents.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platforms = new Set(['win32', 'darwin', 'linux']);
const architectures = new Set(['x64', 'arm64']);
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const previewOutput = 'release/preview';
// Wave 6 (6J1, D3): the unsigned beta, with real data and the bundled Codex: Windows and Linux, and (the founder's
// decision of 14 Nov 2026) macOS on arm64 and x64, unsigned until an Apple Developer ID is given (macSigningState).
const betaOutput = 'release/beta';
const modes = Object.freeze({ preview: { config: 'app/desktop/builder.preview.json', output: previewOutput }, beta: { config: 'app/desktop/builder.beta.json', output: betaOutput }, final: { config: 'app/desktop/builder.json', output: 'release' } });
// 2 Nov: the deb comes first on Linux. Its install script (electron-builder's own) adds an AppArmor profile on Ubuntu
// 24.04 and later, or makes chrome-sandbox SUID root where user namespaces are off; without one, Electron will not start.
// macOS: the dmg is what a person installs from; the zip is the file the update check downloads and shows (updates on
// a Mac are by hand: app/desktop/updates.cjs).
const betaArtifactExtensions = { win32: ['exe'], linux: ['deb', 'AppImage', 'tar.gz'], darwin: ['dmg', 'zip'] };
const CODEX_CHECK = 'bundled Codex with its LICENSE and NOTICE';
// 6J1: electron-builder 26 depends on Electron's own node-gyp fork, which npm records as a Git source. It is a build-time
// (dev) package, never shipped, and never run here (npmRebuild is off). Only this exact commit is accepted, still with
// its integrity hash; every other package must resolve to an HTTPS registry artifact. The list lives in lockfile.mjs (D1).
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
export function createDesktopPackagePlan({ mode = 'preview', platform = process.platform, architecture = process.arch, unpacked = false, hostPlatform = process.platform, hostArchitecture = process.arch, allowUnrecordedCodex = false } = {}) {
  if (!Object.hasOwn(modes, mode)) throw new Error('mode must be preview, beta or final');
  if (!platforms.has(platform) || !architectures.has(architecture)) throw new Error('supported targets are win32, darwin or linux with x64 or arm64 architecture');
  if (platform !== hostPlatform || architecture !== hostArchitecture) throw new Error(`build ${platform}-${architecture} on a matching native host; this host is ${hostPlatform}-${hostArchitecture}`);
  if (mode === 'beta' && !Object.hasOwn(betaArtifactExtensions, platform)) throw new Error('the beta is built for Windows, Linux and macOS only');
  if (typeof unpacked !== 'boolean') throw new Error('unpacked must be a boolean');
  const { config, output } = modes[mode];
  if (typeof allowUnrecordedCodex !== 'boolean') throw new Error('allowUnrecordedCodex must be a boolean');
  return {
    mode, platform, architecture, unpacked, target: `${platform}-${architecture}`, ...(allowUnrecordedCodex ? { allowUnrecordedCodex: true } : {}),
    config,
    output,
    builderArguments: ['--config', config, flags[platform], `--${architecture}`, '--publish', 'never', ...(unpacked ? ['--dir'] : [])],
    qualification: mode === 'preview' ? 'unsigned demo preview; no production runtimes, signing, publishing or update channel'
      : mode === 'beta' ? (platform === 'darwin' ? MAC_UNSIGNED_QUALIFICATION : 'unsigned beta with real data and the bundled Codex; Windows warns about an unknown publisher; no publishing or update channel')
        : 'signed prerequisites required; packaging does not prove native launch or rollback',
  };
}

// The Mac build (14 Nov 2026). Signing and notarising a Mac build needs an Apple Developer ID, which is an outside
// step: nothing here makes, names or stores one. They are wired only through the five values electron-builder itself
// reads. With none set the build is unsigned, and the checks say so in the words a person installing it needs. With
// all five set, electron-builder signs with the certificate in CSC_LINK and sends the app to Apple for notarisation.
// A half-set list is refused by name. No value is ever printed, logged or kept in the receipt.
export const MAC_SIGNING_VARIABLES = Object.freeze(['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
const MAC_SIGNING_CHECK = 'macOS signing and notarisation';
const MAC_UNSIGNED_QUALIFICATION = 'unsigned beta with real data and the bundled Codex; macOS blocks an unsigned app until the person allows it in System Settings; signed and notarised only when the five Apple signing values are set; no publishing or update channel';
const MAC_SIGNED_QUALIFICATION = 'beta with real data and the bundled Codex; signed with an Apple Developer ID and notarised by electron-builder, the signature checked with macOS codesign; no publishing or update channel';
export const MAC_UNSIGNED_WORDS = `This Mac build is not signed with an Apple Developer ID and not notarised (Apple has not checked it). macOS blocks it the first time someone opens it. On macOS 15 or later they open System Settings, Privacy & Security, and choose Open Anyway; on macOS 14 or older they right-click the app and choose Open. Updates on a Mac are by hand: the app shows the new file, and the person replaces the app with it. To sign and notarise, set ${MAC_SIGNING_VARIABLES.slice(0, -1).join(', ')} and ${MAC_SIGNING_VARIABLES.at(-1)}, then build again.`;
export const MAC_SIGNED_WORDS = 'This Mac build will be signed with the Apple Developer ID certificate in CSC_LINK and sent to Apple for notarisation with the Apple ID and team given. The build stops if macOS does not confirm the signature afterwards. Updates on a Mac are still by hand.';

/**
 * 'unsigned' when none of the five values is set; 'developer-id' when all five are and CSC_LINK is a certificate file
 * on this computer, outside the code folder. A half-set list throws, naming what is missing and never a value. Reads
 * no certificate and contacts nobody.
 */
export async function macSigningState({ root = projectRoot, environment = process.env } = {}) {
  const set = name => typeof environment[name] === 'string' && environment[name].trim() !== '';
  const missing = MAC_SIGNING_VARIABLES.filter(name => !set(name));
  if (missing.length === MAC_SIGNING_VARIABLES.length) return { state: 'unsigned', words: MAC_UNSIGNED_WORDS };
  if (missing.length) throw new Error(`A Mac build is signed and notarised only with all five of ${MAC_SIGNING_VARIABLES.join(', ')}. Not set: ${missing.join(', ')}. Set all five or none`);
  const certificate = environment.CSC_LINK.trim();
  if (!isAbsolute(certificate)) throw new Error('CSC_LINK must be the absolute path of the Apple Developer ID certificate file on this computer (not a web address or pasted text)');
  if (inside(resolve(root), resolve(certificate))) throw new Error('CSC_LINK must be a file outside the code folder; a signing certificate is never kept in the checkout');
  try { await regular(certificate); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? 'CSC_LINK names a certificate file that is missing' : 'CSC_LINK must be a regular file, not a link or a folder'); }
  return { state: 'developer-id', words: MAC_SIGNED_WORDS };
}

function quietAnswer(command, args) {
  return new Promise(accept => {
    let output = '';
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = chunk => { if (output.length < 262144) output += String(chunk); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    child.once('error', () => accept({ exitCode: -1, output }));
    child.once('exit', code => accept({ exitCode: typeof code === 'number' ? code : -1, output }));
  });
}

/**
 * After a Mac build that was to be signed: macOS's own codesign must accept the app, and its signature must be a
 * Developer ID one for the given team with the hardened runtime. Null when it is; else the problem in plain words.
 * electron-builder warns and carries on when it finds no identity in the certificate, so without this an unsigned app
 * could leave under a signed label. Read only; macOS only (the caller runs it on a Mac).
 */
export async function macSignatureProblem(appPath, { teamId, run = quietAnswer } = {}) {
  const verified = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  if (verified.exitCode !== 0) return "the app does not pass macOS's own signature check (codesign --verify)";
  const shown = await run('/usr/bin/codesign', ['--display', '--verbose=2', appPath]);
  const lines = String(shown.output ?? '').split(/\r?\n/);
  if (shown.exitCode !== 0 || !lines.some(line => /^Authority=Developer ID Application: /.test(line))) return 'the app carries no Developer ID signature; electron-builder found no usable identity in the certificate';
  if (!lines.includes(`TeamIdentifier=${teamId}`)) return 'the app is signed by another team than APPLE_TEAM_ID names';
  if (!lines.some(line => /^CodeDirectory .*flags=[^ ]*\(([^)]*,)?runtime(,[^)]*)?\)/.test(line))) return 'the app is signed without the hardened runtime, which notarisation needs';
  return null;
}

export function parseDesktopPackageArguments(args) {
  const result = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--check') result.checkOnly = true;
    // A2 review: ship a beta whose bundled Codex has no recorded setup (the owner then chooses it on first use).
    else if (flag === '--allow-unrecorded-codex') result.allowUnrecordedCodex = true;
    else if (flag === '--dir') result.unpacked = true;
    else if (['--mode', '--platform', '--arch'].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
      result[flag === '--arch' ? 'architecture' : flag.slice(2)] = value;
    } else throw new Error(`unknown option: ${flag}; use --mode preview|beta|final --platform win32|darwin|linux --arch x64|arm64 [--dir] [--check] [--allow-unrecorded-codex]`);
  }
  return result;
}

/**
 * Preview and beta child processes never receive signing, release publishing or production service credentials.
 * The one exception (the Mac build, 14 Nov 2026): macSigning true, which packageDesktop passes only for the
 * electron-builder child of a Mac beta whose five Apple signing values are all set (macSigningState). That child gets
 * exactly those five back, and identity discovery is left on: electron-builder looks for the identity only in the
 * keychain it makes from the certificate file in CSC_LINK.
 */
export function desktopPackagingEnvironment(mode, environment = process.env, { macSigning = false } = {}) {
  if (!Object.hasOwn(modes, mode)) throw new Error('mode must be preview, beta or final');
  const result = { ...environment };
  if (mode === 'preview' || mode === 'beta') {
    for (const name of Object.keys(result)) {
      if (/^(?:CSC_|WIN_CSC_|APPLE_|CHAUSAR_|AWS_|DO_|KEYGEN_|COMPOSIO_)/i.test(name) || /(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)/i.test(name)) delete result[name];
    }
    if (mode === 'beta' && macSigning === true) for (const name of MAC_SIGNING_VARIABLES) result[name] = environment[name];
    else result.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  return result;
}

// Wave 6 founder follow-up (6J2, D47): the opt-in report keys. The founder sets CHAUSAR_FEEDBACK_POSTHOG_KEY,
// CHAUSAR_FEEDBACK_POSTHOG_HOST and CHAUSAR_FEEDBACK_SENTRY_DSN when building; packaging writes them to
// vendor/feedback/feedback.json (git-ignored), which the builder config ships as resources/feedback.json and
// app/desktop/feedback-keys.cjs reads. Only write-only keys: PostHog's project key and Sentry's public DSN. No variables:
// no file, and the app says reports are not set up. A value is never printed, logged or kept in the receipt.
const FEEDBACK_VARIABLES = Object.freeze({ posthogKey: 'CHAUSAR_FEEDBACK_POSTHOG_KEY', posthogHost: 'CHAUSAR_FEEDBACK_POSTHOG_HOST', sentryDsn: 'CHAUSAR_FEEDBACK_SENTRY_DSN' });
export const FEEDBACK_STAGED = 'vendor/feedback/feedback.json';
const feedbackHttps = value => /^https:\/\/[^\s]+$/.test(value);
const feedbackKeyish = value => /^[A-Za-z0-9_-]{8,200}$/.test(value);

/** The feedback.json a build ships, or null when no variable is set. A half-set or malformed one is refused by name. */
export function feedbackResource(environment = process.env) {
  const value = name => typeof environment[name] === 'string' ? environment[name].trim() : '';
  const [posthogKey, posthogHost, sentryDsn] = [FEEDBACK_VARIABLES.posthogKey, FEEDBACK_VARIABLES.posthogHost, FEEDBACK_VARIABLES.sentryDsn].map(value);
  if (!posthogKey && !posthogHost && !sentryDsn) return null;
  const result = {};
  if (posthogKey || posthogHost) {
    if (!posthogKey) throw new Error(`${FEEDBACK_VARIABLES.posthogKey} is missing; set it with ${FEEDBACK_VARIABLES.posthogHost}, or unset both`);
    if (!posthogHost) throw new Error(`${FEEDBACK_VARIABLES.posthogHost} is missing; set it with ${FEEDBACK_VARIABLES.posthogKey}, or unset both`);
    if (!feedbackKeyish(posthogKey)) throw new Error(`${FEEDBACK_VARIABLES.posthogKey} must be a PostHog project key (letters, digits, _ or -)`);
    if (!feedbackHttps(posthogHost)) throw new Error(`${FEEDBACK_VARIABLES.posthogHost} must be an https address`);
    Object.assign(result, { posthogKey, posthogHost });
  }
  if (sentryDsn) {
    if (!feedbackHttps(sentryDsn)) throw new Error(`${FEEDBACK_VARIABLES.sentryDsn} must be an https Sentry DSN`);
    result.sentryDsn = sentryDsn;
  }
  return result;
}

/** Write (or remove) the staged feedback.json. A stale file from an earlier build is always removed first, so a build
 * without the variables, or a refused one, ships none. Answers only which services are set up. */
export async function stageFeedbackKeys({ root = projectRoot, environment = process.env } = {}) {
  const path = join(root, ...FEEDBACK_STAGED.split('/'));
  await rm(path, { force: true });
  const resource = feedbackResource(environment);
  if (resource) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(resource) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { posthog: Boolean(resource?.posthogKey), sentry: Boolean(resource?.sentryDsn) };
}

/** Both configurations ship the Ink build and none of its sources; nothing names the retired app/renderer. */
export function validateInkPackagingConfig(config) {
  if (!Array.isArray(config.files) || !config.files.includes(inkBuildGlob)) throw new Error(`the package must include the Ink build (${inkBuildGlob})`);
  for (const glob of INK_SOURCE_EXCLUSIONS) if (!config.files.includes(glob)) throw new Error(`the package must exclude Ink sources and tooling (${glob})`);
  if (JSON.stringify([config.files, config.asarUnpack ?? []]).includes('app/renderer')) throw new Error('the retired app/renderer must not be packaged');
  if ((config.asarUnpack ?? []).some(glob => glob.startsWith('app/ui'))) throw new Error('the Ink build is read from the archive; it is never unpacked');
}

// One-shot A7: the founder's logo is the app icon in every build. The builder reads the Windows icon (the installer, the
// uninstaller and Apps and Features too), the macOS icns and the Linux folder of sized PNGs (the deb and the AppImage);
// the icns is only the builder's, so it stays out of the app archive. The running app reads the tray PNGs, the ico and
// the 256 PNG (main.cjs).
const ICON = Object.freeze({ win: 'app/desktop/icons/icon.ico', mac: 'app/desktop/icons/icon.icns', linux: 'app/desktop/icons/png' });
const LINUX_ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256, 512]);
export const ICON_FILES = Object.freeze([ICON.win, ICON.mac, ...LINUX_ICON_SIZES.map(size => `${ICON.linux}/${size}x${size}.png`)]);
/** Every configuration names the logo for each system it builds, the installer and uninstaller included. */
export function validateIconConfig(config) {
  if (config.win?.icon !== ICON.win || config.linux?.icon !== ICON.linux || (config.mac !== undefined && config.mac.icon !== ICON.mac)) throw new Error(`the app icon is the logo: ${ICON.win} for Windows, ${ICON.linux} for Linux, ${ICON.mac} for macOS`);
  if (config.nsis !== undefined && (config.nsis.installerIcon !== ICON.win || config.nsis.uninstallerIcon !== ICON.win)) throw new Error(`the installer and uninstaller icon is ${ICON.win}`);
  if (!config.files?.includes(`!${ICON.mac}`)) throw new Error('the icns is for the builder only; the package leaves it out');
}

// A7 fix round 1: the unsigned builds keep electron-builder's exe editing off (it needs the winCodeSign download), so
// one pinned afterPack hook sets Chausar.exe's icon and names with the rcedit.exe in node_modules, checked by its
// sha256 (desktop-after-pack.cjs). It is the only hook allowed, spelled exactly so; every other hook is refused.
// Fix round 2: spelled as a path, so electron-builder resolves it from the project and never as a package name.
export const AFTER_PACK_HOOK = './scripts/desktop-after-pack.cjs';
const RCEDIT_PATH = 'node_modules/electron-winstaller/vendor/rcedit.exe';
const RCEDIT_CHECK = 'Windows exe icon tool (rcedit.exe)';
const onlyPinnedHook = config => {
  const hooks = Object.keys(config).filter(name => /^(before|after|artifactBuild|onNodeModule)/.test(name));
  return hooks.length === 1 && hooks[0] === 'afterPack' && config.afterPack === AFTER_PACK_HOOK;
};

// D5: the installer trim (package-trim.mjs): three Chromium languages and no Claude Code program file.
export { TRIM };
// D7 task 6 (additive half): every build carries the engine bundle (scripts/bundle-engine.mjs) as its own file set,
// unpacked, so the packaged worker can run as plain files. Its maps never ship. The engine source still ships beside it
// until desktop main runs the bundle (D7 task 5, main lane).
export const ENGINE_BUNDLE = Object.freeze({
  fileSet: Object.freeze({ from: 'app/engine/dist', to: 'app/engine/dist', filter: Object.freeze(['**/*']) }),
  unpack: 'app/engine/dist/**/*',
  worker: 'app/engine/dist/runtime/worker.js',
  manifest: 'app/engine/dist/engine-manifest.json',
});
/** Every mode: the bundle as its own file set (never a glob in the main set), unpacked, and no maps. */
export function validateEngineBundleConfig(config) {
  const files = Array.isArray(config.files) ? config.files : [];
  const own = files.some(entry => JSON.stringify(entry) === JSON.stringify(ENGINE_BUNDLE.fileSet));
  const glob = files.some(entry => typeof entry === 'string' && entry.replace(/^!/, '').startsWith('app/engine/'));
  if (!own || glob || !(config.asarUnpack ?? []).includes(ENGINE_BUNDLE.unpack)) throw new Error(`the package carries the engine bundle as its own file set (${ENGINE_BUNDLE.fileSet.from}) and unpacks it (${ENGINE_BUNDLE.unpack}); its maps never ship`);
}
/** The receipt's line for the engine bundle, from its engine-manifest.json. */
export function engineReceipt(manifest) {
  const ok = manifest && Array.isArray(manifest.entries) && manifest.entries.length > 0 && Number.isInteger(manifest.chunks) && Number.isInteger(manifest.bytes);
  if (!ok) throw new Error('the engine bundle has no readable engine-manifest.json');
  return { entries: [...manifest.entries], chunks: manifest.chunks, bytes: manifest.bytes, files: manifest.files, rolldown: manifest.rolldown, sourceCommit: manifest.sourceCommit ?? null };
}

/** Every mode: exactly the three languages, and the Agent SDK's platform packages left out after node_modules. */
export function validateTrim(config) {
  if (JSON.stringify(config.electronLanguages) !== JSON.stringify(TRIM.electronLanguages)) throw new Error(`the package carries exactly the Chromium languages ${TRIM.electronLanguages.join(', ')} (electronLanguages)`);
  // The Mac build: macOS spells the same three its own way (package-trim.mjs); a Mac target without them keeps only Hindi.
  if (config.mac !== undefined && JSON.stringify(config.mac?.electronLanguages) !== JSON.stringify(TRIM.macElectronLanguages)) throw new Error(`a Mac target names the same three as macOS languages: ${TRIM.macElectronLanguages.join(', ')} (mac.electronLanguages)`);
  const files = Array.isArray(config.files) ? config.files : [];
  const all = files.indexOf('node_modules/**/*'), cut = files.indexOf(TRIM.claudeBinaryExclusion);
  const putBack = files.slice(cut + 1).some(entry => JSON.stringify(entry).includes('@anthropic-ai/claude-agent-sdk-'));
  if (all < 0 || cut <= all || putBack) throw new Error(`the package carries no Claude Code program file: ${TRIM.claudeBinaryExclusion} after node_modules/**/*, and nothing puts one back`);
}

function validatePreviewConfig(config) {
  if (config.appId !== 'in.chausar.desktop.preview' || config.productName !== 'Chausar Unsigned Preview' || config.extraMetadata?.name !== 'chausar-preview' || config.extraMetadata?.chausarPreview !== true || config.extraMetadata?.chausarReleaseChannel !== 'unsigned-preview') throw new Error('preview requires a separate identity and explicit unsigned demo metadata');
  if (config.forceCodeSigning !== false || config.win?.signAndEditExecutable !== false || config.mac?.identity !== null || config.mac?.notarize !== false || config.mac?.hardenedRuntime !== false) throw new Error('preview config must disable native signing, identity discovery and notarization');
  if (config.publish !== null || config.npmRebuild !== false || config.extraResources?.length !== 0 || config.directories?.output !== previewOutput) throw new Error('preview must disable publishing, dependency rebuilds and native runtime resources and use release/preview');
  if (config.extends !== undefined || !onlyPinnedHook(config)) throw new Error(`preview cannot inherit final configuration or execute custom build hooks; the one hook is afterPack ${AFTER_PACK_HOOK}`);
  if (config.electronDist !== 'node_modules/electron/dist') throw new Error('preview must use the verified local Electron distribution instead of another download');
  const expected = { win: ['zip'], mac: ['dmg', 'zip'], linux: ['AppImage', 'tar.gz'] };
  for (const [key, targets] of Object.entries(expected)) {
    if (JSON.stringify(config[key]?.target) !== JSON.stringify(targets)) throw new Error(`preview ${key} targets must match the documented formats; Windows preview is ZIP only`);
  }
  for (const glob of ['app/desktop/**/*', inkBuildGlob, 'platform/runtime/**/*', 'node_modules/**/*']) {
    if (!config.files?.includes(glob)) throw new Error(`preview package is missing ${glob}`);
  }
  for (const glob of ['platform/runtime/**/*', 'node_modules/**/*']) {
    if (!config.asarUnpack?.includes(glob)) throw new Error(`preview worker execution requires unpacked ${glob}`);
  }
}

/** The files a preview or beta build leaves. electron-builder names an AppImage and a deb by their own architecture
 * names (x64 is x86_64 and amd64); every other target keeps the Node name. Pure, so it is tested for every platform on
 * any host. */
export function expectedArtifactNames({ mode, platform, architecture, version }) {
  const x64Names = { AppImage: 'x86_64', deb: 'amd64' };
  const archFor = extension => architecture === 'x64' ? x64Names[extension] ?? architecture : architecture;
  const named = (product, extensions) => extensions.map(extension => `Chausar-${product}-${version}-${artifactOS[platform]}-${archFor(extension)}.${extension}`);
  return mode === 'preview' ? named('Preview', artifactExtensions[platform]) : mode === 'beta' ? named('Beta', betaArtifactExtensions[platform]) : [];
}

// The Mac build (14 Nov 2026): the beta's Mac target, held field by field.
export const MAC_ENTITLEMENTS = 'app/desktop/entitlements.mac.plist';
// electron-builder never re-signs the bundled Codex: the engine checks its program against the digest recorded when it
// was staged (platform/runtime/codex-trust.ts), and a new signature would change the file.
export const MAC_CODEX_SIGN_IGNORE = '/Contents/Resources/codex/';
const MAC_MICROPHONE_WORDS = 'Chausar uses the microphone only when you start push to talk or live captions.';
const BETA_MAC_KEYS = Object.freeze(['target', 'icon', 'electronLanguages', 'hardenedRuntime', 'entitlements', 'entitlementsInherit', 'signIgnore', 'extendInfo']);
/**
 * A dmg and a zip; the hardened runtime and the app's own entitlements, used when a certificate is given; the bundled
 * Codex left as staged; the microphone words macOS shows. No identity and no notarisation switch in the file: a name
 * there would be a made-up identity, and null or false would switch them off for good. Both come only from the
 * environment values electron-builder reads (macSigningState).
 */
function validateBetaMacConfig(config) {
  const mac = config.mac;
  if (!mac || typeof mac !== 'object') throw new Error('the beta needs its Mac target (mac): a dmg and a zip');
  if (JSON.stringify(mac.target) !== JSON.stringify(['dmg', 'zip'])) throw new Error('the beta Mac targets are a dmg and a zip');
  if (Object.hasOwn(mac, 'identity')) throw new Error('the beta names no Mac signing identity in its file; it comes only from the certificate in CSC_LINK');
  if (Object.hasOwn(mac, 'notarize')) throw new Error('the beta sets no notarisation switch in its file; Apple notarises only when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are set');
  if (mac.hardenedRuntime !== true) throw new Error('a signed Mac build uses the hardened runtime (mac.hardenedRuntime true)');
  if (mac.entitlements !== MAC_ENTITLEMENTS || mac.entitlementsInherit !== MAC_ENTITLEMENTS) throw new Error(`the Mac entitlements are the app's own file, for the app and what it starts: ${MAC_ENTITLEMENTS}`);
  if (JSON.stringify(mac.signIgnore) !== JSON.stringify([MAC_CODEX_SIGN_IGNORE])) throw new Error(`the bundled Codex is never re-signed on a Mac (mac.signIgnore ${MAC_CODEX_SIGN_IGNORE}); the engine checks it against the digest recorded at staging`);
  if (JSON.stringify(mac.extendInfo) !== JSON.stringify({ NSMicrophoneUsageDescription: MAC_MICROPHONE_WORDS })) throw new Error('the Mac build says in plain words why it asks for the microphone (mac.extendInfo NSMicrophoneUsageDescription)');
  const extra = Object.keys(mac).filter(name => !BETA_MAC_KEYS.includes(name));
  if (extra.length) throw new Error(`the beta Mac target carries only ${BETA_MAC_KEYS.join(', ')}; not ${extra.join(', ')}`);
  if (config.dmg !== undefined || config.mas !== undefined || config.pkg !== undefined) throw new Error('the Mac dmg keeps electron-builder\'s own layout and is not signed on its own; the beta has no dmg, pkg or Mac App Store options');
}

/** 6J1: the unsigned beta. Real data (no preview flag), NSIS per user without admin, deb, AppImage and tar.gz, only the
 * staged Codex bundle and the notices as extra resources, the local Electron, no signing, hooks or publishing.
 * 14 Nov 2026: and a Mac dmg and zip (validateBetaMacConfig), unsigned unless the Apple signing values are set. */
export function validateBetaConfig(config) {
  if (config.appId !== 'in.chausar.desktop' || config.productName !== 'Chausar' || config.extraMetadata?.name !== 'chausar' || config.extraMetadata?.productName !== 'Chausar' || config.extraMetadata?.chausarReleaseChannel !== 'beta' || Object.hasOwn(config.extraMetadata ?? {}, 'chausarPreview')) throw new Error('the beta needs the Chausar identity, the beta release channel and no preview flag');
  if (config.forceCodeSigning !== false || config.win?.signAndEditExecutable !== false) throw new Error('the beta is unsigned: signing and electron-builder\'s own exe editing (its winCodeSign download) stay off; the pinned afterPack hook sets the exe\'s icon and names');
  if (config.publish !== null || config.npmRebuild !== false || config.directories?.output !== betaOutput) throw new Error('the beta disables publishing and dependency rebuilds and uses release/beta');
  if (config.extends !== undefined || !onlyPinnedHook(config)) throw new Error(`the beta cannot inherit another configuration or run custom build hooks; the one hook is afterPack ${AFTER_PACK_HOOK}`);
  if (config.electronDist !== 'node_modules/electron/dist') throw new Error('the beta must use the verified local Electron distribution instead of another download');
  validateIconConfig(config);
  validateBetaMacConfig(config);
  if (JSON.stringify(config.win?.target) !== JSON.stringify(['nsis']) || JSON.stringify(config.linux?.target) !== JSON.stringify(['deb', 'AppImage', 'tar.gz'])) throw new Error('beta targets are the Windows installer (NSIS) and Linux deb, AppImage and tar.gz');
  if (!/^[^<>]+ <[^@\s<>]+@[^@\s<>]+>$/.test(config.deb?.maintainer ?? '') || !/^https:\/\//.test(config.extraMetadata?.homepage ?? '')) throw new Error('the deb needs a maintainer with an email address and an https homepage');
  if ([config.linux, config.deb].some(options => Object.keys(options ?? {}).some(name => /^(after|before)/.test(name)))) throw new Error('the deb keeps the install scripts electron-builder ships, which set up the Chromium sandbox');
  const nsis = config.nsis ?? {};
  if (nsis.oneClick !== false || nsis.perMachine !== false || nsis.allowElevation !== false || nsis.deleteAppDataOnUninstall !== false || nsis.include !== 'app/desktop/installer.nsh') throw new Error('the beta installs per user without admin, keeps the owner data on uninstall and removes its login entry');
  const resources = JSON.stringify(config.extraResources);
  if (resources !== JSON.stringify([{ from: 'vendor/codex-bundle/${os}-${arch}', to: 'codex', filter: ['**/*'] }, { from: 'app/desktop/notices', to: 'notices', filter: ['**/*'] }, { from: 'LICENSE', to: 'LICENSE' }, { from: 'NOTICE', to: 'NOTICE' }, { from: FEEDBACK_STAGED, to: 'feedback.json' }])) throw new Error('the beta carries only the staged Codex bundle, the notices, the AGPL licence and NOTICE (6J3) and the staged report keys (6J2) as extra resources');
  for (const glob of ['app/desktop/**/*', inkBuildGlob, 'node_modules/**/*']) {
    if (!config.files?.includes(glob)) throw new Error(`beta package is missing ${glob}`);
  }
  // electron-builder 26 writes every unpacked file of a mixed file set into one pattern that @electron/asar refuses
  // over 64 KB, so each folder unpacked whole is its own file set and adds one short entry.
  for (const folder of ['platform/runtime', 'platform/helpers']) {
    if (!config.files?.some(entry => JSON.stringify(entry) === JSON.stringify({ from: folder, to: folder, filter: ['**/*'] }))) throw new Error(`beta package carries ${folder} as its own file set`);
    if (config.files.includes(`${folder}/**/*`)) throw new Error(`beta package lists ${folder} once, as its own file set`);
  }
  for (const glob of ['platform/runtime/**/*', 'node_modules/**/*']) {
    if (!config.asarUnpack?.includes(glob)) throw new Error(`beta worker execution requires unpacked ${glob}`);
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
  const [problem] = lockfileProblems(lock, pkg, { pinnedGitSources: PINNED_BUILD_GIT_SOURCES });
  if (problem) throw new Error({
    version: 'a genuine npm v3 lockfile matching package.json is required; generate it only with an approved registry install',
    'dependencies-differ': `locked ${problem.kind} differs from package.json`,
    'unresolved-pin': `lockfile does not resolve the exact ${problem.name} pin`,
    entry: 'locked packages require exact versions and registry integrity hashes',
    resolved: 'locked packages must resolve to HTTPS registry artifacts',
  }[problem.code] ?? problem.message);
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

/**
 * Read-only: never installs dependencies, vendors runtimes, creates keys or starts Electron. The host is this computer;
 * tests name another (hostPlatform) to check a Windows plan on Linux and a Linux plan on Windows, and the plan must
 * still match that host exactly.
 */
export async function desktopPackagePrerequisites({ root = projectRoot, plan, environment = process.env, hostPlatform = process.platform, hostArchitecture = process.arch } = {}) {
  plan ??= createDesktopPackagePlan({ platform: hostPlatform, architecture: hostArchitecture, hostPlatform, hostArchitecture });
  // 14 Nov 2026: the one flag a plan may carry (--allow-unrecorded-codex) is rebuilt with it. Before, every build
  // that passed the flag was refused here as a changed plan. Only true counts; any other value is still a changed plan.
  const expectedPlan = createDesktopPackagePlan({ mode: plan.mode, platform: plan.platform, architecture: plan.architecture, unpacked: plan.unpacked, hostPlatform, hostArchitecture, allowUnrecordedCodex: plan.allowUnrecordedCodex === true });
  if (JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new Error('packaging requires an unchanged native plan; arbitrary builder options are refused');
  const failures = [], checks = [];
  let cliPath, viteCli, version;
  const check = async (name, work) => {
    try { await work(); checks.push(name); }
    catch (error) { failures.push({ check: name, reason: error.code === 'ENOENT' ? 'required local file is missing; no download or substitute was attempted' : error.message }); }
  };
  await check('Node runtime', () => { if (!nodeVersionSupported(process.versions.node)) throw new Error('Node 24.13.1 or later is required'); });
  await check('desktop source entrypoints', async () => {
    for (const path of ['app/desktop/main.cjs', 'app/desktop/preload.cjs', 'app/desktop/engine-harness.cjs', 'app/desktop/ipc-contract.cjs', 'app/desktop/icon.png', 'app/desktop/icon@1.5x.png', 'app/desktop/icon@2x.png', ...ICON_FILES, AFTER_PACK_HOOK, 'platform/runtime/worker.ts', 'app/ui/index.html', 'app/ui/src/main.tsx', inkConfig]) await regular(join(root, path));
  });
  await check('locked local packaging dependencies and Electron distribution', async () => { ({ cliPath, viteCli, version } = await dependencyPrerequisites(root, plan.platform)); });
  await check('packaging configuration', async () => {
    const config = JSON.parse(await readFile(join(root, plan.config), 'utf8'));
    validateInkPackagingConfig(config);
    validateIconConfig(config);
    validateTrim(config);
    validateEngineBundleConfig(config);
    if (plan.mode === 'preview') validatePreviewConfig(config);
    else if (plan.mode === 'beta') validateBetaConfig(config);
    else if (config.forceCodeSigning !== true || config.publish !== null || config.extraMetadata?.chausarPreview === true) throw new Error('final config must keep signed-release gating and disable publishing');
  });
  // A7 fix round 1: an unsigned Windows build edits Chausar.exe with the pinned rcedit.exe; it must be there and be that
  // file before electron-builder starts. Nothing is downloaded for it.
  if (plan.platform === 'win32' && plan.mode !== 'final') {
    await check(RCEDIT_CHECK, async () => {
      const { checkRcedit } = createRequire(import.meta.url)('./desktop-after-pack.cjs');
      await checkRcedit({ path: join(root, ...RCEDIT_PATH.split('/')) });
    });
  }
  if (plan.mode === 'beta') {
    await check(CODEX_CHECK, async () => {
      const { verifyCodexBundle, bundleFolderName } = await import('./codex-bundle.mjs');
      await verifyCodexBundle({ directory: join(root, ...bundleFolderName(plan.platform, plan.architecture).split('/')), platform: plan.platform, architecture: plan.architecture, requireSetup: plan.allowUnrecordedCodex !== true });
    });
  }
  // The Mac build (14 Nov 2026): a Mac beta is unsigned unless all five Apple signing values are set. Unsigned passes
  // (it is the state today), and the words for the person installing it go out as a notice; a half-set list blocks.
  let signing = null;
  const notices = [];
  if (plan.mode === 'beta' && plan.platform === 'darwin') {
    await check(MAC_SIGNING_CHECK, async () => { signing = await macSigningState({ root, environment }); });
    if (signing) notices.push(signing.words);
  }
  // 6J2: half-set or malformed report keys block even a --check run, by variable name only.
  if (plan.mode !== 'preview') await check('report keys (CHAUSAR_FEEDBACK_*)', () => { feedbackResource(environment); });
  if (plan.mode === 'final') {
    const { packagePreflight } = await import('./package-preflight.mjs');
    const final = await packagePreflight({ root, platform: plan.platform, architecture: plan.architecture, environment });
    checks.push(...final.checks.map(name => `final: ${name}`));
    failures.push(...final.failures.map(item => ({ ...item, check: `final: ${item.check}` })));
  }
  return {
    ok: failures.length === 0, mode: plan.mode, target: plan.target, cliPath, viteCli, version, checks, failures,
    qualification: signing?.state === 'developer-id' ? MAC_SIGNED_QUALIFICATION : plan.qualification,
    ...(signing ? { macSigning: signing.state } : {}), ...(notices.length ? { notices } : {}),
  };
}

// D5 task 4: a build proves its own notices. The unpacked folder electron-builder leaves (win-unpacked, linux-unpacked)
// is read after the build: a beta or final build carries the AGPL LICENSE, NOTICE, the third-party notices and each
// font's OFL text (app/desktop/notices/fonts, shipped as resources/notices/fonts), and feedback.json exactly when report
// keys were staged; the demo preview carries none of them. Read only; nothing is started.
// These are the x64 names; an arm64 build's folder carries the chip (unpackedBuild below).
export const UNPACKED_FOLDER = Object.freeze({ win32: 'win-unpacked', linux: 'linux-unpacked' });
/**
 * The Mac build (14 Nov 2026): where electron-builder leaves the unpacked build inside the output folder, and where
 * its resources are. Windows and Linux: the unpacked folder and its resources folder. macOS: the app itself, with its
 * resources in Contents/Resources. electron-builder names the folder with the chip unless it is x64 (its default):
 * win-unpacked and win-arm64-unpacked, linux-unpacked and linux-arm64-unpacked, mac and mac-arm64. Before 14 Nov 2026
 * the Windows and Linux names here were the x64 ones only, so an arm64 build was read from a folder that is not there.
 */
export function unpackedBuild({ platform, architecture, productName }) {
  if (!platforms.has(platform) || !architectures.has(architecture)) throw new Error('supported targets are win32, darwin or linux with x64 or arm64 architecture');
  if (platform !== 'darwin') { const folder = `${artifactOS[platform]}${architecture === 'x64' ? '' : `-${architecture}`}-unpacked`; return { folder, resources: `${folder}/resources` }; }
  if (typeof productName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(productName) || productName.includes('..')) throw new Error('the Mac app folder is named after the product name, which must be plain words');
  const folder = `${architecture === 'x64' ? 'mac' : `mac-${architecture}`}/${productName}.app`;
  return { folder, resources: `${folder}/Contents/Resources` };
}
const NOTICE_RESOURCES = Object.freeze(['LICENSE', 'NOTICE', 'notices/THIRD-PARTY-NOTICES.md']);

/** The font licence files a build must carry: the OFL texts in app/desktop/notices/fonts (none until they are copied there). */
export async function packagedFontLicences(folder = join(projectRoot, 'app/desktop/notices/fonts')) {
  try { return (await readdir(folder)).filter(name => /-OFL\.txt$/.test(name)).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

/** What a packaged build lacks or should not carry, in plain words; empty when it is right. */
export async function packagedResourceProblems(unpackedDir, { mode, reports, fonts = [] } = {}) {
  // A Mac app keeps them inside itself (package-contents.mjs resourcesFolder).
  const resources = resourcesFolder(unpackedDir);
  const present = async relativePath => { try { return (await lstat(join(resources, ...relativePath.split('/')))).isFile(); } catch { return false; } };
  try { if (!(await lstat(resources)).isDirectory()) return ['the unpacked build has no resources folder']; }
  catch { return ['the unpacked build has no resources folder']; }
  const problems = [];
  const staged = Boolean(reports && (reports.posthog || reports.sentry));
  if (mode === 'preview') {
    for (const file of [...NOTICE_RESOURCES, 'feedback.json']) if (await present(file)) problems.push(`resources/${file} is in the preview`);
    return problems;
  }
  for (const file of [...NOTICE_RESOURCES, ...fonts.map(name => `notices/fonts/${name}`)]) if (!(await present(file))) problems.push(`resources/${file} is missing`);
  const feedback = await present('feedback.json');
  if (staged && !feedback) problems.push('resources/feedback.json is missing');
  if (!staged && feedback) problems.push('resources/feedback.json is there, but no report keys were staged');
  return problems;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Check freshness before building; never remove or overwrite previous output. */
export async function validateDesktopPackagingOutput({ root = projectRoot, plan = createDesktopPackagePlan(), version } = {}) {
  if (!exactVersion.test(version ?? '')) throw new Error('output checks require an exact package version');
  const expectedPlan = createDesktopPackagePlan({ mode: plan.mode, platform: plan.platform, architecture: plan.architecture, unpacked: plan.unpacked, allowUnrecordedCodex: plan.allowUnrecordedCodex === true });
  if (JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new Error('packaging requires an unchanged native plan; arbitrary builder options are refused');
  for (const path of ['release', ...(plan.mode === 'final' ? [] : [plan.output])]) {
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
  const expectedArtifacts = expectedArtifactNames({ mode: plan.mode, platform: plan.platform, architecture: plan.architecture, version });
  return { receiptPath, expectedArtifacts };
}

/**
 * The children packaging runs, in order: the Ink build (vite build, which empties and refills app/ui/dist), the engine
 * bundle (D7, which empties and refills app/engine/dist), then electron-builder. Each is a local CLI run by this Node, with no shell. Nothing else is spawned.
 */
export function desktopPackageCommands(plan, { cliPath, viteCli }) {
  return [
    { name: 'Ink build', args: [viteCli, 'build', '--config', inkConfig] },
    // D7: the engine bundle the packaged worker runs (npm run build:engine).
    { name: 'engine bundle', args: ['scripts/bundle-engine.mjs'] },
    { name: 'electron-builder', args: [cliPath, ...plan.builderArguments] },
  ];
}

/**
 * The receipt's line for the beta's bundled Codex. A2 second review: whether its setup was recorded at staging, and
 * when the beta was built with --allow-unrecorded-codex.
 */
export function bundledReceipt(codex, plan) {
  return {
    codex: { version: codex.version, target: codex.target, licence: codex.licence, files: Object.keys(codex.files).length, setup: codex.evidence ? 'recorded' : 'not recorded',
      ...(plan.allowUnrecordedCodex === true ? { allowUnrecordedCodex: true } : {}) },
    notices: 'notices/THIRD-PARTY-NOTICES.md',
  };
}

/** Windows preview uses ZIP without NSIS; the beta (6J1) builds an unsigned per-user NSIS installer. Final NSIS builds can execute their generated installer while extracting the uninstaller. No release/update publication is performed. */
export async function packageDesktop({ root = projectRoot, plan = createDesktopPackagePlan(), environment = process.env, checkOnly = false } = {}) {
  const prerequisites = await desktopPackagePrerequisites({ root, plan, environment });
  if (!prerequisites.ok || checkOnly) return { ...prerequisites, packaged: false, checkOnly };
  const { receiptPath, expectedArtifacts } = await validateDesktopPackagingOutput({ root, plan, version: prerequisites.version });
  // 6J2: the report keys are staged before electron-builder copies the resources; the demo preview carries none.
  const feedback = plan.mode !== 'preview' ? await stageFeedbackKeys({ root, environment }) : undefined;
  let engine;
  // The Mac build: the Apple signing values, read once here and never kept; only the state goes on the receipt.
  const signing = plan.mode === 'beta' && plan.platform === 'darwin' ? await macSigningState({ root, environment }) : null;
  for (const command of desktopPackageCommands(plan, prerequisites)) {
    const status = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, command.args, { cwd: root, env: desktopPackagingEnvironment(plan.mode, environment, { macSigning: command.name === 'electron-builder' && signing?.state === 'developer-id' }), shell: false, windowsHide: true, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => signal ? reject(new Error(`${command.name} stopped with signal ${signal}`)) : accept(code));
    });
    if (status !== 0) throw new Error(`${command.name} failed with exit code ${status}`);
    // The window refuses to start without the build, so a package without it is refused here first.
    if (command.name === 'Ink build') await regular(join(root, 'app/ui/dist/index.html'));
    // D7: the packaged worker is the bundle's, so a build without it is refused here.
    if (command.name === 'engine bundle') { await regular(join(root, ENGINE_BUNDLE.worker)); engine = engineReceipt(JSON.parse(await readFile(join(root, ENGINE_BUNDLE.manifest), 'utf8'))); }
  }
  // D5 task 4: no receipt for a build that lacks its notices (or carries report keys nobody staged).
  let contents, macApp = null;
  if (Object.hasOwn(UNPACKED_FOLDER, plan.platform) || plan.platform === 'darwin') {
    // macOS: the app itself (mac or mac-arm64), named after the product name in the build's own configuration.
    const productName = plan.platform === 'darwin' ? JSON.parse(await readFile(join(root, plan.config), 'utf8')).productName : undefined;
    const unpackedDir = join(root, plan.output, ...unpackedBuild({ platform: plan.platform, architecture: plan.architecture, productName }).folder.split('/'));
    if (plan.platform === 'darwin') macApp = unpackedDir;
    const problems = await packagedResourceProblems(unpackedDir, { mode: plan.mode, reports: feedback, fonts: await packagedFontLicences(join(root, 'app/desktop/notices/fonts')) });
    if (problems.length) throw new Error(`the packaged build is incomplete, so no receipt was written: ${problems.join('; ')}`);
    // D5 task 5: what the build carries goes on the receipt; any problem (a fourth language, a Claude Code program file,
    // no Ink build, Ink source, another Codex) refuses it.
    const read = await readPackageContents(unpackedDir, { mode: plan.mode });
    if (read.problems.length) throw new Error(`the packaged build carries the wrong contents, so no receipt was written: ${read.problems.join('; ')}`);
    contents = { sizes: read.sizes, totalBytes: read.totalBytes, fileCount: read.fileCount, locales: read.locales, anthropic: read.anthropic, codexVersion: read.codexVersion, archiveFiles: read.archive.files, problems: read.problems };
  }
  const artifacts = [];
  if (plan.mode !== 'final' && !plan.unpacked) {
    const output = join(root, plan.output);
    for (const name of expectedArtifacts) {
      const path = join(output, name), info = await regular(path);
      artifacts.push({ path: name, size: info.size, sha256: await sha256(path) });
    }
  }
  // 6J1: the beta's own third-party notices sit beside its artifacts too (they are also inside, in resources/notices).
  let bundled;
  if (plan.mode === 'beta') {
    await cp(join(root, 'app/desktop/notices'), join(root, plan.output, 'notices'), { recursive: true, errorOnExist: true, force: false });
    const { verifyCodexBundle, bundleFolderName } = await import('./codex-bundle.mjs');
    const codex = await verifyCodexBundle({ directory: join(root, ...bundleFolderName(plan.platform, plan.architecture).split('/')), platform: plan.platform, architecture: plan.architecture, requireSetup: plan.allowUnrecordedCodex !== true });
    bundled = bundledReceipt(codex, plan);
    // The Mac build: signing (ad-hoc or Developer ID) must not have rewritten the bundled Codex, or the engine would
    // refuse it at start (codex-trust.ts checks the program against the digest recorded at staging). No receipt then.
    if (macApp) {
      try { await verifyCodexBundle({ directory: join(resourcesFolder(macApp), 'codex'), platform: plan.platform, architecture: plan.architecture, requireSetup: plan.allowUnrecordedCodex !== true }); }
      catch (error) { throw new Error(`the Codex inside the Mac app differs from the staged bundle, so no receipt was written: ${error.message}`); }
    }
  }
  // The Mac build: a build that was to be signed is checked with macOS codesign; an unsigned app never gets a signed label.
  if (signing?.state === 'developer-id') {
    const problem = await macSignatureProblem(macApp, { teamId: String(environment.APPLE_TEAM_ID).trim() });
    if (problem) throw new Error(`the Mac build was to be signed, but ${problem}; no receipt was written`);
  }
  const macReceipt = signing ? { macSigning: { state: signing.state, localSignature: signing.state === 'unsigned' ? 'ad-hoc, by scripts/desktop-after-pack.cjs' : false, notarised: signing.state === 'developer-id' ? 'by electron-builder, which stops the build when Apple refuses; not checked again here' : false, words: signing.words } } : {};
  const signed = plan.mode === 'final' ? 'requires-native-verification' : signing?.state === 'developer-id' ? 'developer-id' : false;
  const receipt = { schemaVersion: 1, mode: plan.mode, target: plan.target, version: prerequisites.version, packaged: true, unpacked: plan.unpacked, signed, published: false, qualification: prerequisites.qualification, checks: [...prerequisites.checks, 'Ink app built to app/ui/dist'], artifacts, ...macReceipt, ...(bundled ? { bundled } : {}), ...(feedback ? { reports: feedback } : {}), ...(contents ? { contents } : {}), ...(engine ? { engine } : {}) };
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
    else console.log(`Desktop package created (${plan.mode}, ${plan.target}). ${result.qualification}. Receipt: ${result.receiptPath}`);
    // The Mac build: what the signing state means for the person installing it, said whether the checks passed or not.
    for (const notice of result.notices ?? []) console.log(`Note: ${notice}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
