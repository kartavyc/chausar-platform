'use strict';
// One-shot A7 fix round 1: the unsigned builds (beta, preview) keep electron-builder's own exe editing off, because it
// needs the winCodeSign download. So Chausar.exe, and the Start menu and desktop shortcuts made from it, kept Electron's
// icon, and Task Manager said "Electron". This is the one build hook the package checks allow (desktop-package.mjs):
// after packing, on a Windows host building for Windows with signAndEditExecutable false, it sets the logo and the names
// on the exe with the rcedit.exe already in node_modules (electron-winstaller's vendor folder), the same tool
// electron-builder runs at the same step. The tool is checked by its sha256 first; nothing is downloaded. The asar
// integrity resource and the fuse wire stay as electron-builder wrote them (checked on a copy, A7 notes).
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const RCEDIT = join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const RCEDIT_SHA256 = 'e2df7b664db830f159d0dc6b3da8a95442cca175b9577f2d19952646d37ac32f';
const ICON = join(ROOT, 'app', 'desktop', 'icons', 'icon.ico');
const NAME = 'Chausar';

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

/** The arguments: the logo, and "Chausar" where Windows shows a program's name (Task Manager, the file's details). */
function rceditArguments(exe) {
  return [exe, '--set-icon', ICON, '--set-version-string', 'FileDescription', NAME, '--set-version-string', 'ProductName', NAME];
}

function quietRun(command, args) {
  return new Promise((done, fail) => {
    execFile(command, args, { windowsHide: true, timeout: 120_000 }, error => (error ? fail(new Error(`rcedit.exe could not edit the exe: ${error.message}`)) : done()));
  });
}

/** electron-builder's afterPack: { edited: true } when the exe was edited here, { edited: false } when it was not ours. */
async function afterPack(context, { platform = process.platform, run = quietRun, readFile: read = readFile, sha256: hash = sha256 } = {}) {
  if (platform !== 'win32' || context?.electronPlatformName !== 'win32') return { edited: false };
  if (context.packager?.platformSpecificBuildOptions?.signAndEditExecutable !== false) return { edited: false };
  const tool = await checkRcedit({ readFile: read, sha256: hash });
  await run(tool, rceditArguments(join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)));
  return { edited: true };
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.afterPack = afterPack;
module.exports.checkRcedit = checkRcedit;
module.exports.rceditArguments = rceditArguments;
module.exports.RCEDIT = RCEDIT;
module.exports.RCEDIT_SHA256 = RCEDIT_SHA256;
