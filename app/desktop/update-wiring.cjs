'use strict';
// Chausar desktop (one-shot C5 tasks 31, 32): main's side of auto-update, kept here so main.cjs only calls it. Reads the
// build's metadata (chausarUpdatePublicKey, chausarUpdateFeed, chausarWindowsPublisher in package.json), so a packaged app
// needs no environment variable. Empty or absent until the founder gives them: the owner then reads a plain state, and
// nothing here touches the disk. Previews and development runs never take part.
//
// At the start: old private copies of the installer go, and the boot marker counts this start (updates.cjs). At first
// ready plus first paint the marker clears. At quit: while the engine is still up it says whether a run is busy and makes
// the safety copy (a closed vault can't), then, once it has stopped, installOnQuit runs and what it found is kept for the
// Updates row. Anything using a release kept on disk checks it again right before use.
const fsp = require('node:fs/promises');
const { join } = require('node:path');

const OLD_COPY = /^chausar-update-[a-f0-9]{16}\.exe$/;
const INSTALLER_ENDINGS = Object.freeze({ win32: 'setup.exe', linux: 'x64.AppImage', darwin: 'mac.zip' });
const VERSION = /^[0-9A-Za-z.-]{1,100}$/;

function failure(code, message) { return Object.assign(new Error(message), { code }); }

/** The build's update keys, or null when this run has none: a preview, a development run, or a build with no key yet. */
function updateMetadata(metadata, { packaged }) {
  const text = value => (typeof value === 'string' && value.trim() !== '' ? value : null);
  if (!packaged || metadata?.chausarPreview === true) return null;
  const publicKey = text(metadata?.chausarUpdatePublicKey);
  return publicKey ? { publicKey, feedUrl: text(metadata?.chausarUpdateFeed), windowsPublisher: text(metadata?.chausarWindowsPublisher) } : null;
}

/** What the worker needs for the daily check. The folder is always named, so the owner's row reads a plain state. */
function updateEnvironment(metadata, { userData, packaged }) {
  const keys = updateMetadata(metadata, { packaged });
  return {
    CHAUSAR_UPDATES_DIRECTORY: join(userData, 'updates'),
    CHAUSAR_UPDATE_CHANNEL: metadata?.chausarReleaseChannel === 'beta' ? 'beta' : 'stable',
    CHAUSAR_UPDATE_PUBLIC_KEY: keys?.publicKey ?? '',
    CHAUSAR_UPDATE_FEED: keys?.feedUrl ?? '',
    CHAUSAR_WINDOWS_PUBLISHER: keys?.windowsPublisher ?? '',
  };
}

function createUpdateWiring({ metadata, userData, packaged, version, platform, appImage, updates, engine, dialog, shell, note = () => {}, fs = fsp }) {
  const keys = updateMetadata(metadata, { packaged });
  const folder = join(userData, 'updates'), stage = join(folder, 'stage');
  let ready = false, painted = false, cleared = false, work = Promise.resolve();
  const later = job => { work = work.then(job).catch(() => { /* a help, never a gate */ }); return work; };

  /** The staged release as updates.cjs reads it, or null. One the running version has reached is the engine's to clear. */
  async function readStaged() {
    try {
      const { manifest, signature, artifactPath } = JSON.parse(await fs.readFile(join(stage, 'pending-release.json'), 'utf8'));
      return manifest && typeof signature === 'string' && typeof artifactPath === 'string' ? { manifest, signature, artifactPath } : null;
    } catch { return null; }
  }
  /** A release kept in <updates>/previous, as updates.cjs wrote it, or null. */
  async function readPrevious() {
    try {
      const manifest = JSON.parse(await fs.readFile(join(folder, 'previous', 'manifest.json'), 'utf8'));
      return { manifest, signature: (await fs.readFile(join(folder, 'previous', 'signature'), 'utf8')).trim(), artifactPath: join(folder, 'previous', 'installer') };
    } catch { return null; }
  }
  /** Could anything install here at quit? When not, quit asks for no copy and hashes nothing; the row already says so. */
  const canInstall = () => (platform === 'win32' ? !!keys?.windowsPublisher : platform === 'linux' && !!appImage);

  /**
   * Checks a kept release again (signature, platform, length, hash) right before use, copies it under a name a person can
   * run, checks the copy, and shows that in the file manager. The window names only which one.
   */
  async function showInstaller(kind) {
    if (kind !== 'staged' && kind !== 'previous') throw failure('INVALID_REQUEST', 'Say which installer to show.');
    if (!keys) throw failure('UPDATES_NOT_SET_UP', "Updates aren't set up in this copy of Chausar.");
    const refused = failure('UPDATE_NOT_VERIFIED', "That installer changed on this computer, so Chausar won't show it. The next check gets a fresh one.");
    const release = kind === 'staged' ? await readStaged() : await readPrevious();
    if (!release || !VERSION.test(String(release.manifest?.version)) || !(await updates.verifyStaged(release, keys.publicKey, platform))) throw refused;
    const shown = join(folder, 'show');
    await fs.mkdir(shown, { recursive: true });
    const path = join(shown, `Chausar-${release.manifest.version}-${INSTALLER_ENDINGS[platform] ?? 'installer'}`);
    await fs.copyFile(release.artifactPath, path);
    if (!(await updates.verifyStaged({ ...release, artifactPath: path }, keys.publicKey, platform))) {
      await fs.unlink(path).catch(() => {});
      throw refused;
    }
    shell.showItemInFolder(path);
    return path;
  }

  /** D12 replaces this with the automatic rollback (its attach point 3). */
  function failedBoot(input) {
    return updates.onFailedBoot(input, {
      note: async line => { note(line); },
      show: words => {
        later(async () => {
          const buttons = input.previous ? ['Show installer', 'Not now'] : ['OK'];
          const { response } = await dialog.showMessageBox({ type: 'warning', title: 'Chausar', message: words, buttons, defaultId: 0, cancelId: buttons.length - 1 });
          if (input.previous && response === 0) await showInstaller('previous');
        });
      },
    });
  }
  /** Before the engine starts. Never stops the start. */
  async function beforeStart() {
    if (!keys) return;
    const names = await fs.readdir(stage).catch(() => []);
    await Promise.all(names.filter(name => OLD_COPY.test(name)).map(name => fs.unlink(join(stage, name)).catch(() => { /* still running: the next start */ })));
    await updates.startBoot(folder, version, { onFailedBoot: failedBoot }).catch(() => {});
  }
  function maybeClear() {
    if (!keys || !ready || !painted || cleared) return Promise.resolve();
    cleared = true;
    return later(() => updates.clearBoot(folder));
  }

  /** While the engine is up: a busy run, the open data's version, and the safety copy. Null: nothing to install at this quit. */
  async function prepareQuit() {
    if (!keys || !canInstall()) return null;
    const staged = await readStaged();
    const running = engine();
    if (!staged || running?.state !== 'ready') return null;
    try { return { staged, ...(await running.prepareUpdateInstall({ backup: true })) }; }
    catch { return null; }
  }
  /** After the engine stopped. What it found stays for the Updates row. */
  async function installAfterStop(prepared) {
    if (!prepared) return null;
    const answer = await updates.installOnQuit({
      staged: prepared.staged, publicKey: keys.publicKey, platform, appImage, windowsPublisher: keys.windowsPublisher, openDataSchema: prepared.openDataSchema ?? null, updatesFolder: folder,
      isBusy: async () => prepared.busy === true,
      // The engine made the copy before it stopped; a copy that failed stops the install here.
      beforeInstall: async () => { if (prepared.backup === 'failed') throw failure('SAFETY_BACKUP_FAILED', 'The safety copy failed, so the update waits.'); },
    });
    await fs.mkdir(folder, { recursive: true }).then(() => fs.writeFile(join(folder, 'last-install.json'), JSON.stringify({ version: answer.version, state: answer.state }), { mode: 0o600 })).catch(() => {});
    return answer;
  }

  return Object.freeze({
    enabled: !!keys, beforeStart, prepareQuit, installAfterStop, showInstaller,
    noteReady() { ready = true; return maybeClear(); },
    notePaint() { painted = true; return maybeClear(); },
    settled: () => work,
  });
}

module.exports = Object.freeze({ updateMetadata, updateEnvironment, createUpdateWiring });
