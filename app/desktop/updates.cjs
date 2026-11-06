'use strict';
// Chausar desktop (one-shot C5 task 32): install a staged update when the owner quits, and the boot marker.
// The engine's ReleaseUpdater (platform/runtime/updater.ts) verifies the signed feed and streams the release into its
// stage folder; this file runs in the main process at quit and checks the staged file again before using it: the
// Ed25519 signature over the canonical manifest, this platform, the length and the SHA-256. Then:
//   Linux:   an AppImage (process.env.APPIMAGE) is replaced by the verified file with the same mode, by a copy in the same
//            folder and one rename, so the old file is gone only once the rename has happened.
//   Windows: a private copy of the staged NSIS installer, made after the safety backup and checked again (hash and
//            signature) right before it runs, runs silently (/S --updated) only when Get-AuthenticodeSignature says Valid and
//            the signer is the pinned publisher (chausarWindowsCertificateThumbprint in the build metadata). With no publisher
//            pinned, or an unsigned file, nothing runs and the state is needs-signing (the certificate is an outside step).
//   macOS:   manual.
// Never during a busy run, and never a release whose data version is lower than the open data's (D12 attach point 1).
// Before an install the beforeInstall hook runs (main.cjs makes the safety backup there; a throw stops the install),
// and the release installed last time moves to <updates>/previous/ (manifest.json, signature, installer) for D12's
// prepareRollback (attach point 2). The boot marker <updates>/boot.json counts starts of one version until the first
// ready and paint clear it; the third start calls onFailedBoot once (attach point 3), which D12 replaces with the
// automatic rollback. Nothing here downloads, and nothing is sent anywhere.
const fsp = require('node:fs/promises');
const { createReadStream, constants: fsConstants } = require('node:fs');
const { createHash, createPublicKey, randomBytes, verify } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { dirname, isAbsolute, join, basename, win32 } = require('node:path');
const { createDiagnostics } = require('./diagnostics.cjs');

const BOOT_FORMAT = 'chausar.boot.v1';
const FAILED_STARTS = 2;
const UPDATE_STATES = Object.freeze(['nothing', 'busy', 'not-verified', 'data-newer', 'manual', 'needs-signing', 'publisher-mismatch', 'installed', 'installer-started', 'failed']);
const FAILED_BOOT_WORDS = "This version didn't start. Install the previous one:";
const FAILED_BOOT_WORDS_NO_PREVIOUS = "This version didn't start.";

/** The same canonical sorted JSON the engine signs (updater.ts canonicalReleaseManifest). */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
async function sha256Of(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function regularFile(path) {
  try { const stat = await fsp.lstat(path); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; }
}
const tempName = path => join(dirname(path), `.${basename(path)}.update-${randomBytes(6).toString('hex')}`);

/** True when the staged release is signed by the pinned key, made for this platform, and the file is exactly it. */
async function verifyStaged(staged, publicKey, platform) {
  try {
    const { manifest, signature, artifactPath } = staged;
    if (!manifest || typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature) || typeof artifactPath !== 'string' || !isAbsolute(artifactPath)) return false;
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    if (key.asymmetricKeyType !== 'ed25519') return false;
    if (!verify(null, Buffer.from(canonical(manifest)), key, Buffer.from(signature, 'base64url'))) return false;
    if (manifest.platform !== platform || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return false;
    const stat = await regularFile(artifactPath);
    return !!stat && stat.size === manifest.size && await sha256Of(artifactPath) === manifest.sha256;
  } catch { return false; }
}

/** The exact certificate identity, never the publisher's display name. */
function certificateThumbprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toUpperCase() : null;
}
function publisherMatches(answer, expected) {
  const pinned = certificateThumbprint(expected);
  return !!pinned && answer?.status === 'Valid' && certificateThumbprint(answer.thumbprint) === pinned;
}
/** Authenticode status and certificate thumbprint, read by the system PowerShell in a hidden process. */
function windowsSignature(path) {
  const command = '$s = Get-AuthenticodeSignature -LiteralPath $env:UPDATE_FILE_TO_CHECK; [pscustomobject]@{ status = $s.Status.ToString(); thumbprint = if ($s.SignerCertificate) { $s.SignerCertificate.Thumbprint } else { $null } } | ConvertTo-Json -Compress';
  return new Promise(resolve => {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !win32.isAbsolute(systemRoot)) return resolve({ status: 'Unknown', thumbprint: null });
    const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 30000, env: { ...process.env, UPDATE_FILE_TO_CHECK: path } }, (error, stdout) => {
      if (error) return resolve({ status: 'Unknown', thumbprint: null });
      try {
        const answer = JSON.parse(stdout);
        resolve({ status: String(answer.status), thumbprint: certificateThumbprint(answer.thumbprint) });
      } catch { resolve({ status: 'Unknown', thumbprint: null }); }
    });
  });
}

function runInstaller(path, args) {
  spawn(path, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** One line in <updates>/updates.jsonl, through diagnostics.cjs: names and versions only, rotated at 1 MB. The log never stops an update. */
function noterFor(updatesFolder) {
  const log = updatesFolder ? createDiagnostics({ folder: updatesFolder }) : null;
  return async line => { await log?.line('updates.jsonl', line); };
}

/** Writes this release (manifest.json, signature, installer) into a fresh hidden folder; nothing is kept yet. */
async function prepareKeep(updatesFolder, staged) {
  await fsp.mkdir(updatesFolder, { recursive: true });
  const building = join(updatesFolder, `.installed-${randomBytes(6).toString('hex')}`);
  await fsp.mkdir(building);
  try {
    await fsp.writeFile(join(building, 'manifest.json'), JSON.stringify(staged.manifest));
    await fsp.writeFile(join(building, 'signature'), `${staged.signature}\n`);
    await fsp.copyFile(staged.artifactPath, join(building, 'installer'));
  } catch (error) { await fsp.rm(building, { recursive: true, force: true }); throw error; }
  return building;
}
/**
 * Keeps a prepared release: its installer must still match the signed manifest. Then <updates>/installed moves to
 * previous/ and the prepared folder becomes installed/. A copy that no longer matches is thrown away.
 */
async function commitKeep(updatesFolder, building, manifest) {
  const installer = join(building, 'installer'), stat = await regularFile(installer);
  if (!stat || stat.size !== manifest.size || await sha256Of(installer) !== manifest.sha256) {
    await fsp.rm(building, { recursive: true, force: true });
    throw Object.assign(new Error('The kept copy changed.'), { code: 'UPDATE_COPY_CHANGED' });
  }
  const installed = join(updatesFolder, 'installed'), previous = join(updatesFolder, 'previous');
  if (await fsp.stat(installed).then(() => true, () => false)) {
    const old = join(updatesFolder, `.previous-${randomBytes(6).toString('hex')}`);
    if (await fsp.stat(previous).then(() => true, () => false)) await fsp.rename(previous, old);
    await fsp.rename(installed, previous);
    await fsp.rm(old, { recursive: true, force: true });
  }
  await fsp.rename(building, installed);
}
/** Moves <updates>/installed to previous/, then keeps this release as installed/ (manifest.json, signature, installer). */
async function keepRelease(updatesFolder, staged) {
  await commitKeep(updatesFolder, await prepareKeep(updatesFolder, staged), staged.manifest);
}

/** The version of the release kept as previous, or null. */
async function previousVersion(updatesFolder) {
  try { const version = JSON.parse(await fsp.readFile(join(updatesFolder, 'previous', 'manifest.json'), 'utf8')).version; return typeof version === 'string' ? version : null; } catch { return null; }
}

/** A copy of the staged installer, beside it under a fresh name, to be checked and run. */
async function privateCopy(staged) {
  const runPath = join(dirname(staged.artifactPath), `chausar-update-${randomBytes(8).toString('hex')}.exe`);
  await fsp.copyFile(staged.artifactPath, runPath, fsConstants.COPYFILE_EXCL);
  return runPath;
}

async function swapAppImage(appImage, staged, fs) {
  const old = await fsp.stat(appImage), temporary = tempName(appImage);
  try {
    await fsp.copyFile(staged.artifactPath, temporary);
    await fsp.chmod(temporary, old.mode & 0o7777);
    if (await sha256Of(temporary) !== staged.manifest.sha256) throw Object.assign(new Error('The copy changed.'), { code: 'UPDATE_COPY_CHANGED' });
    await fs.rename(temporary, appImage);
  } catch (error) { await fsp.unlink(temporary).catch(() => {}); throw error; }
}

/**
 * Installs the staged update at quit, or says why not. Returns { state, version }, state one of UPDATE_STATES.
 * input: { staged: {manifest, signature, artifactPath} | null, publicKey, isBusy, platform?, appImage?, windowsCertificateThumbprint?,
 *          openDataSchema?, updatesFolder?, beforeInstall?, signatureOf?, spawnInstaller?, fs? }
 */
async function installOnQuit(input) {
  const { staged, publicKey, platform = process.platform, appImage = process.env.APPIMAGE, windowsCertificateThumbprint = null, openDataSchema = null, updatesFolder = null } = input;
  const signatureOf = input.signatureOf ?? windowsSignature, spawnInstaller = input.spawnInstaller ?? runInstaller, fs = { rename: fsp.rename, ...(input.fs ?? {}) };
  const note = noterFor(updatesFolder), version = staged?.manifest?.version ?? null;
  const done = async (state, extra = {}) => { await note({ op: 'install-on-quit', state, version }); return { state, version, ...extra }; };
  if (!staged) return { state: 'nothing', version: null };
  if (await input.isBusy?.()) return done('busy');
  if (!(await verifyStaged(staged, publicKey, platform))) return done('not-verified');
  if (Number.isSafeInteger(openDataSchema) && staged.manifest.dataSchemaVersion < openDataSchema) return done('data-newer');
  try {
    if (platform === 'linux') {
      if (typeof appImage !== 'string' || !isAbsolute(appImage) || !(await regularFile(appImage))) return done('manual');
      await input.beforeInstall?.(staged);
      await swapAppImage(appImage, staged, fs);
      if (updatesFolder) await keepRelease(updatesFolder, staged).catch(() => note({ op: 'keep-release', state: 'failed', version }));
      return done('installed');
    }
    if (platform === 'win32') {
      if (!certificateThumbprint(windowsCertificateThumbprint)) return done('needs-signing');
      const answer = await signatureOf(staged.artifactPath);
      if (answer?.status !== 'Valid') return done('needs-signing');
      if (!publisherMatches(answer, windowsCertificateThumbprint)) return done('publisher-mismatch');
      await input.beforeInstall?.(staged);
      // Review rounds 1 and 2 (MEDIUM-3, MEDIUM-1): what runs is a private copy made after the backup. Its keeping copy is
      // prepared first; then the copy's hash against the signed manifest and its signature are the very last checks,
      // with nothing awaited between them and the spawn. The prepared release is kept only after the spawn, and only if
      // its own copy still matches the manifest. The staged path is never run.
      const runPath = await privateCopy(staged);
      let building = null;
      const refuseCopy = async state => {
        await fsp.unlink(runPath).catch(() => {});
        if (building) await fsp.rm(building, { recursive: true, force: true }).catch(() => {});
        return done(state);
      };
      if (updatesFolder) building = await prepareKeep(updatesFolder, { ...staged, artifactPath: runPath }).catch(() => null);
      if (!(await verifyStaged({ ...staged, artifactPath: runPath }, publicKey, platform))) return refuseCopy('not-verified');
      const last = await signatureOf(runPath);
      if (last?.status !== 'Valid') return refuseCopy('needs-signing');
      if (!publisherMatches(last, windowsCertificateThumbprint)) return refuseCopy('publisher-mismatch');
      spawnInstaller(runPath, ['/S', '--updated']);
      if (building) await commitKeep(updatesFolder, building, staged.manifest).catch(() => note({ op: 'keep-release', state: 'failed', version }));
      else if (updatesFolder) await note({ op: 'keep-release', state: 'failed', version });
      return done('installer-started');
    }
    return done('manual');
  } catch (error) {
    return done('failed', { code: typeof error?.code === 'string' ? error.code : 'UPDATE_INSTALL_FAILED' });
  }
}

async function readBoot(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return undefined; }
}
const newerBoot = raw => !!raw && typeof raw === 'object' && typeof raw.format === 'string' && raw.format !== BOOT_FORMAT && /^chausar\.boot\.v\d+$/.test(raw.format);

/** The C5 hook: one diagnostics line, and the words for the window (main.cjs shows them with Show installer). */
async function onFailedBoot({ version, previous }, { note = async () => {}, show } = {}) {
  await note({ op: 'failed-boot', version, previous: previous ?? null });
  const words = previous ? FAILED_BOOT_WORDS : FAILED_BOOT_WORDS_NO_PREVIOUS;
  if (show) await show(words);
  return words;
}

/**
 * Called before the engine starts: counts this start of the version in <updates>/boot.json (written whole by a rename).
 * When two earlier starts of this version never reached ready and first paint, calls onFailedBoot once for it.
 * A marker written by a newer Chausar is left untouched and counts nothing.
 */
async function startBoot(updatesFolder, version, { onFailedBoot: hook, show } = {}) {
  const file = join(updatesFolder, 'boot.json'), raw = await readBoot(file);
  if (newerBoot(raw)) return { attempts: 0, failed: false };
  const same = raw && raw.format === BOOT_FORMAT && raw.version === version && Number.isSafeInteger(raw.attempts) && raw.attempts >= 0;
  const marker = { format: BOOT_FORMAT, version, attempts: same ? raw.attempts + 1 : 1, reported: same ? raw.reported === true : false };
  const failed = marker.attempts > FAILED_STARTS;
  const report = failed && !marker.reported;
  if (report) marker.reported = true;
  await fsp.mkdir(updatesFolder, { recursive: true });
  const temporary = tempName(file);
  await fsp.writeFile(temporary, JSON.stringify(marker));
  await fsp.rename(temporary, file);
  if (report) {
    const input = { version, previous: await previousVersion(updatesFolder) };
    if (hook) await hook(input); else await onFailedBoot(input, { note: noterFor(updatesFolder), show });
  }
  return { attempts: marker.attempts, failed };
}

/** Called at the first ready plus first paint: this version started, so the count goes. */
async function clearBoot(updatesFolder) {
  const file = join(updatesFolder, 'boot.json');
  if (newerBoot(await readBoot(file))) return;
  await fsp.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

module.exports = { BOOT_FORMAT, UPDATE_STATES, installOnQuit, verifyStaged, certificateThumbprint, publisherMatches, windowsSignature, runInstaller, keepRelease, previousVersion, startBoot, clearBoot, onFailedBoot };
