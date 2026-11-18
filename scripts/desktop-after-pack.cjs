'use strict';
// One-shot A7 fix round 1: the unsigned builds (beta, preview) keep electron-builder's own exe editing off, because it
// needs the winCodeSign download. So Chausar.exe, and the Start menu and desktop shortcuts made from it, kept Electron's
// icon, and Task Manager said "Electron". This is the one build hook the package checks allow (desktop-package.mjs):
// after packing, on a Windows host building for Windows with signAndEditExecutable false, it sets the logo and the names
// on the exe with the rcedit.exe already in node_modules (electron-winstaller's vendor folder), the same tool
// electron-builder runs at the same step. The tool is checked by its sha256 first; nothing is downloaded. The asar
// integrity resource and the fuse wire stay as electron-builder wrote them (checked on a copy, A7 notes).
// The Mac build (14 Nov 2026): on a Mac building for macOS the same hook gives an app that will stay unsigned macOS's
// own local (ad-hoc) signature (adHocSignMac below), after putting back the language marker folders electron-builder's
// copy of the local Electron drops (restoreMacLanguageFolders below). It does nothing else there, and nothing on Linux.
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstat, mkdir, readFile } = require('node:fs/promises');
const { basename, join } = require('node:path');

const ROOT = join(__dirname, '..');
const RCEDIT = join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const RCEDIT_SHA256 = 'e2df7b664db830f159d0dc6b3da8a95442cca175b9577f2d19952646d37ac32f';
const ICON = join(ROOT, 'app', 'desktop', 'icons', 'icon.ico');
// Fix round 2: the copyright holder and line as NOTICE has them (a test holds them to NOTICE).
const COPYRIGHT = 'Copyright (C) 2026 Kartavy Chauhan';
const COMPANY = 'Kartavy Chauhan';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The pinned rcedit.exe's path, or a plain refusal when it is missing or is another file. */
async function checkRcedit({ path = RCEDIT, readFile: read = readFile, sha256: hash = sha256 } = {}) {
  let bytes;
  try { bytes = await read(path); } catch {
    throw new Error(`rcedit.exe is missing (${path}). Run npm ci so electron-winstaller's copy is there; nothing is downloaded for it.`);
  }
  const found = hash(bytes);
  if (found !== RCEDIT_SHA256) throw new Error(`rcedit.exe at ${path} is not the pinned one (sha256 ${found}, expected ${RCEDIT_SHA256}); the exe is not edited.`);
  return path;
}

/**
 * The arguments: the logo, and the details Windows shows for a program (Task Manager, the file's Properties), from the
 * build itself: the product's own name (the beta "Chausar", the preview "Chausar Unsigned Preview"), the exe's file
 * name, the copyright holder, and the app version (electron-builder's build version when it gives one).
 */
function rceditArguments(exe, { productName, version }) {
  return [exe, '--set-icon', ICON,
    '--set-version-string', 'FileDescription', productName, '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'CompanyName', COMPANY, '--set-version-string', 'LegalCopyright', COPYRIGHT,
    '--set-version-string', 'OriginalFilename', basename(exe), '--set-file-version', version, '--set-product-version', version];
}

function quietRun(command, args) {
  return new Promise((done, fail) => {
    execFile(command, args, { windowsHide: true, timeout: 120_000 }, error => (error ? fail(new Error(`rcedit.exe could not edit the exe: ${error.message}`)) : done()));
  });
}

// The Mac build (14 Nov 2026). With no certificate electron-builder leaves a Mac app unsigned, and its own changes (the
// new name, the resources) break the seal Electron's files came with. macOS on Apple chips calls a downloaded copy of
// such an app damaged and offers no way to open it. So on a Mac building for macOS this hook gives the app macOS's own
// local (ad-hoc) signature with /usr/bin/codesign: no certificate and no identity, nothing downloaded, and nothing
// under Contents/Resources (the bundled Codex, the unpacked engine) is rewritten. macOS still blocks the first open of
// an ad-hoc signed download; the owner allows it in System Settings (desktop-package.mjs says so in its checks). When
// a certificate is given (CSC_LINK) and the file does not switch signing off, electron-builder signs after this hook
// and nothing is done here. Run on a real build on 14 Nov 2026 (macOS 27.2, Apple silicon): the app passes
// codesign --verify --deep --strict, and the bundled Codex keeps OpenAI's own signature and its staged digest
// (docs/desktop-releases.md).
const CODESIGN = '/usr/bin/codesign';
function quietSign(command, args) {
  return new Promise((done, fail) => {
    execFile(command, args, { timeout: 600_000 }, (error, _stdout, stderr) => (error ? fail(new Error(`${String(stderr || '').trim() || error.message}`)) : done()));
  });
}
// The first real Mac build (14 Nov 2026) found this. Electron keeps one empty marker folder for each language in the
// app's Contents/Resources (en.lproj and 54 more); macOS reads them to know which languages the app speaks. Every build
// here uses the checked local Electron folder (electronDist), and electron-builder 26.0.12 copies that folder with a
// copy that never makes empty folders (builder-util copyDir), so the app came out with no marker folder at all and its
// own language trim had nothing left to trim. macOS then takes the app as English only. So the hook puts back exactly
// the folders the Mac target names (mac.electronLanguages: en, en_GB, hi), each only when Electron's own framework in
// this build carries that language's file. It runs before any signing, and whether or not a certificate is given.
const MAC_LANGUAGE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
async function restoreMacLanguageFolders(context) {
  const wanted = context.packager?.platformSpecificBuildOptions?.electronLanguages;
  if (wanted === undefined || wanted === null) return [];
  if (!Array.isArray(wanted) || wanted.some(name => typeof name !== 'string' || !MAC_LANGUAGE_NAME.test(name))) throw new Error('mac.electronLanguages names plain macOS language names (en, en_GB, hi); no marker folder was made');
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const made = [];
  for (const language of wanted) {
    const folder = `${language}.lproj`;
    let carried = false;
    try { carried = (await lstat(join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', folder, 'locale.pak'))).isFile(); } catch { carried = false; }
    if (!carried) throw new Error(`Electron in this build carries no ${language} language file, so the app cannot say it speaks ${language} (mac.electronLanguages)`);
    const marker = join(app, 'Contents', 'Resources', folder);
    try { await mkdir(marker); made.push(folder); }
    catch (error) { if (error.code !== 'EEXIST' || !(await lstat(marker)).isDirectory()) throw new Error(`the ${folder} language folder could not be made in the Mac app: ${error.message}`); }
  }
  return made;
}

async function adHocSignMac(context, { env, sign }) {
  const options = context.packager?.platformSpecificBuildOptions ?? {};
  const languageFolders = await restoreMacLanguageFolders(context);
  const restored = languageFolders.length ? { languageFolders } : {};
  const certificate = typeof env.CSC_LINK === 'string' && env.CSC_LINK.trim() !== '';
  if (options.identity !== null && certificate) return { edited: false, adHocSigned: false, ...restored };
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    await sign(CODESIGN, ['--force', '--deep', '--sign', '-', app]);
    await sign(CODESIGN, ['--verify', '--deep', '--strict', app]);
  } catch (error) { throw new Error(`macOS could not give the unsigned app its local (ad-hoc) signature, so it is not packed: ${error.message}`); }
  return { edited: false, adHocSigned: true, ...restored };
}

/**
 * electron-builder's afterPack: { edited: true } when the exe was edited here, { edited: false } when it was not ours.
 * On a Mac building for macOS: { edited: false, adHocSigned } (adHocSignMac above), with languageFolders when any
 * language marker folder was put back.
 */
async function afterPack(context, { platform = process.platform, env = process.env, run = quietRun, sign = quietSign, readFile: read = readFile, sha256: hash = sha256 } = {}) {
  if (platform === 'darwin' && context?.electronPlatformName === 'darwin') return adHocSignMac(context, { env, sign });
  if (platform !== 'win32' || context?.electronPlatformName !== 'win32') return { edited: false };
  if (context.packager?.platformSpecificBuildOptions?.signAndEditExecutable !== false) return { edited: false };
  const tool = await checkRcedit({ readFile: read, sha256: hash });
  const { appInfo } = context.packager;
  const exe = join(context.appOutDir, `${appInfo.productFilename}.exe`);
  await run(tool, rceditArguments(exe, { productName: appInfo.productName, version: appInfo.buildVersion || appInfo.version }));
  return { edited: true };
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.afterPack = afterPack;
module.exports.checkRcedit = checkRcedit;
module.exports.rceditArguments = rceditArguments;
module.exports.RCEDIT = RCEDIT;
module.exports.RCEDIT_SHA256 = RCEDIT_SHA256;
module.exports.COPYRIGHT = COPYRIGHT;
module.exports.COMPANY = COMPANY;
module.exports.CODESIGN = CODESIGN;
