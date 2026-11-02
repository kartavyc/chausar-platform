import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Wave 6, package 6J1 (D3, D12): the beta installer bundles Codex (Apache-2.0) with its LICENSE and NOTICE. The files
// are copied unchanged from a Codex npm install already on this computer (the platform package's vendor folder); this
// script never downloads, installs or runs anything. The staged folder is what app/desktop/builder.beta.json carries
// as resources/codex, and desktop-package.mjs checks it again (verifyCodexBundle) before a beta build.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CODEX_BUNDLE = Object.freeze({
  version: '0.154.0',
  licence: 'Apache-2.0',
  repository: 'https://github.com/openai/codex',
  tag: 'rust-v0.154.0',
  // The files in openai/codex at the tag above; the npm package carries no licence files of its own.
  licenseSha256: 'd17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc',
  noticeSha256: '9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915',
});
const TARGETS = Object.freeze({
  'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
});
const OS_WORD = Object.freeze({ win32: 'win', linux: 'linux' });
const MAX_FILES = 200;
const safeName = /^[A-Za-z0-9._+@-]+$/;

/** The target triple the official Codex launcher (bin/codex.js) picks for this platform. */
export function codexTarget(platform, architecture) {
  const target = TARGETS[`${platform}-${architecture}`];
  if (!target) throw new Error('the beta bundles Codex for Windows and Linux on x64 or arm64 only');
  return target;
}
/** Where the staged bundle lives, named with electron-builder's own ${os}-${arch} words (builder.beta.json). */
export function bundleFolderName(platform, architecture) {
  codexTarget(platform, architecture);
  return `vendor/codex-bundle/${OS_WORD[platform]}-${architecture}`;
}
async function regularFile(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Codex bundles hold no links (${path})`);
  if (!info.isFile()) throw new Error(`Codex bundle entries must be regular files (${path})`);
  return info;
}
async function realFolder(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Codex bundles hold no links (${path})`);
  if (!info.isDirectory()) throw new Error(`expected a folder (${path})`);
}
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** Every regular file under a folder, as forward-slash relative names; links and special entries are refused. */
async function listTree(folder, prefix = '', found = []) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!safeName.test(entry.name)) throw new Error(`unexpected file name in the Codex bundle (${entry.name})`);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name, path = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Codex bundles hold no links (${name})`);
    if (entry.isDirectory()) await listTree(path, name, found);
    else if (entry.isFile()) found.push(name);
    else throw new Error(`Codex bundle entries must be regular files (${name})`);
    if (found.length > MAX_FILES) throw new Error('the Codex bundle has more files than expected');
  }
  return found;
}

/** The vendor folder of the platform package inside an installed @openai/codex (the layout bin/codex.js reads). */
export async function codexVendorFolder(packageRoot, platform, architecture) {
  const target = codexTarget(platform, architecture);
  const platformPackage = `codex-${platform}-${architecture}`;
  // Nested (a global install), beside @openai/codex (a local install hoists it), or the package's own vendor folder.
  for (const candidate of [join(packageRoot, 'node_modules', '@openai', platformPackage, 'vendor', target), join(packageRoot, '..', platformPackage, 'vendor', target), join(packageRoot, 'vendor', target)]) {
    try { await realFolder(candidate); return candidate; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`no Codex ${target} files under ${packageRoot}; install @openai/codex@${CODEX_BUNDLE.version} for this platform first`);
}

async function readLayout(folder, platform, architecture) {
  const layout = JSON.parse(await readFile(join(folder, 'codex-package.json'), 'utf8'));
  const target = codexTarget(platform, architecture), entrypoint = platform === 'win32' ? 'bin/codex.exe' : 'bin/codex';
  if (layout.layoutVersion !== 1) throw new Error('unknown Codex package layout');
  if (layout.version !== CODEX_BUNDLE.version) throw new Error(`the beta bundles Codex ${CODEX_BUNDLE.version}; this package is ${layout.version}`);
  if (layout.target !== target) throw new Error(`Codex package target ${layout.target} differs from ${target}`);
  if (layout.entrypoint !== entrypoint) throw new Error(`Codex entrypoint must be ${entrypoint}`);
  return { target, entrypoint, layout };
}
/** The entrypoint (and on Windows every bundled .exe) must be a native program for this exact target. */
async function checkExecutables(folder, files, platform, architecture, entrypoint) {
  for (const name of files) {
    if (name !== entrypoint && !(platform === 'win32' && /^(bin|codex-path|codex-resources)\/.+\.exe$/.test(name))) continue;
    // Imported here, not at the top: desktop-package.mjs imports this module while its own command line is running.
    const { validateElectronExecutable } = await import('./desktop-package.mjs');
    try { await validateElectronExecutable(join(folder, name), platform, architecture); }
    catch (error) { throw new Error(`${name}: ${error.message.replace(/^Electron /, 'the program ')}`); }
  }
}

/** Copy a local Codex platform package into an empty destination, add LICENSE and NOTICE, write BUNDLE.json. */
export async function stageCodexBundle({ source, destination, platform, architecture, root = projectRoot }) {
  const vendor = await codexVendorFolder(source, platform, architecture);
  const { target, entrypoint } = await readLayout(vendor, platform, architecture);
  const files = (await listTree(vendor)).sort();
  for (const name of files) await regularFile(join(vendor, name));
  if (!files.includes(entrypoint)) throw new Error(`Codex entrypoint ${entrypoint} is missing`);
  await checkExecutables(vendor, files, platform, architecture, entrypoint);
  const license = join(root, 'app/desktop/notices/codex/LICENSE'), notice = join(root, 'app/desktop/notices/codex/NOTICE');
  if (await sha256(license) !== CODEX_BUNDLE.licenseSha256 || await sha256(notice) !== CODEX_BUNDLE.noticeSha256) throw new Error('the Codex LICENSE or NOTICE in app/desktop/notices differs from the pinned openai/codex files');
  try { if ((await readdir(destination)).length) throw new Error('the Codex bundle folder is not empty; move or remove the earlier bundle first'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(destination, { recursive: true });
  for (const name of files) {
    const to = join(destination, ...name.split('/'));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(vendor, name), to);
    if (platform !== 'win32' && name !== 'codex-package.json') await chmod(to, 0o755);
  }
  await copyFile(license, join(destination, 'LICENSE'));
  await copyFile(notice, join(destination, 'NOTICE'));
  const manifest = { schemaVersion: 1, name: 'OpenAI Codex CLI', version: CODEX_BUNDLE.version, licence: CODEX_BUNDLE.licence, source: `${CODEX_BUNDLE.repository} (${CODEX_BUNDLE.tag}); files from the @openai/codex npm package`, target, entrypoint, files: {} };
  for (const name of [...files, 'LICENSE', 'NOTICE'].sort()) {
    const path = join(destination, ...name.split('/'));
    manifest.files[name] = { size: (await lstat(path)).size, sha256: await sha256(path) };
  }
  await writeFile(join(destination, 'BUNDLE.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

/** Read-only: the staged bundle is complete, unchanged since staging, for this target, with LICENSE and NOTICE. */
export async function verifyCodexBundle({ directory, platform, architecture }) {
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'BUNDLE.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`no staged Codex bundle in ${directory}; run npm run package:codex -- --from <the @openai/codex folder> first`); throw error; }
  const target = codexTarget(platform, architecture);
  if (manifest.version !== CODEX_BUNDLE.version || manifest.target !== target || manifest.licence !== CODEX_BUNDLE.licence) throw new Error(`the staged Codex bundle is not Codex ${CODEX_BUNDLE.version} for ${target}`);
  for (const [name, digest] of [['LICENSE', CODEX_BUNDLE.licenseSha256], ['NOTICE', CODEX_BUNDLE.noticeSha256]]) {
    try { await regularFile(join(directory, name)); }
    catch (error) { if (error.code === 'ENOENT') throw new Error(`the staged Codex bundle has no ${name}`); throw error; }
    if (await sha256(join(directory, name)) !== digest) throw new Error(`the staged Codex ${name} differs from the pinned openai/codex file`);
  }
  const present = (await listTree(directory)).filter(name => name !== 'BUNDLE.json').sort();
  for (const name of present) if (!manifest.files[name]) throw new Error(`${name} is in the Codex bundle but not listed in BUNDLE.json`);
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!present.includes(name)) throw new Error(`the staged Codex bundle has no ${name}`);
    if (await sha256(join(directory, ...name.split('/'))) !== expected.sha256) throw new Error(`${name} changed after the Codex bundle was staged`);
  }
  if (!manifest.files[manifest.entrypoint]) throw new Error('the staged Codex bundle has no entrypoint');
  return manifest;
}

export function parseCodexBundleArguments(args) {
  const result = {}, seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`duplicate option: ${flag}`);
    seen.add(flag);
    if (!['--from', '--platform', '--arch'].includes(flag)) throw new Error(`unknown option: ${flag}; use --from <the installed @openai/codex folder> [--platform win32|linux --arch x64|arm64]`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    result[flag === '--arch' ? 'architecture' : flag.slice(2)] = value;
  }
  if (!result.from) throw new Error('name the installed @openai/codex folder with --from');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { from, platform = process.platform, architecture = process.arch } = parseCodexBundleArguments(process.argv.slice(2));
    const destination = join(projectRoot, ...bundleFolderName(platform, architecture).split('/'));
    const manifest = await stageCodexBundle({ source: resolve(from), destination, platform, architecture });
    console.log(`Codex ${manifest.version} (${manifest.target}) staged in ${destination} with its LICENSE and NOTICE; ${Object.keys(manifest.files).length} files.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
