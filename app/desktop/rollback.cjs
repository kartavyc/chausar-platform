'use strict';
// Chausar desktop (one-shot D12 tasks 9, 10): going back to the release kept in <updates>/previous, when a new version won't
// start, or when the owner says so after a business couldn't be brought up to date. Main does this without any key: a
// backup's envelope is exactly the live file's content. The kept release is checked again right before use (signature, this
// platform, length, hash). The data goes first, and every move is a copy, a hash check, then one rename. The newer data is
// never deleted: it stays as a backup that opens. A version that failed is skipped by the daily check until a newer one comes,
// and a version is never swapped away from twice. Nothing here downloads, and nothing is sent anywhere.
const fsp = require('node:fs/promises');
const { createHash, randomBytes } = require('node:crypto');
const { dirname, join, basename } = require('node:path');

const ROLLBACK_FORMAT = 'chausar.rollbacks.v1';
const LIVE_FILE = 'authority.encrypted.json';
const FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const BACKUP = /^chausar-[A-Za-z0-9_-]{1,200}-\d{1,16}-(?:migration|safety)\.backup$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tempOf = path => join(dirname(path), `.${basename(path)}.rollback-${randomBytes(6).toString('hex')}`);

/** One move: a temp file beside the target, read back and hashed, then one rename. A failure leaves the target as it was. */
async function placeChecked(path, bytes, fs) {
  const temporary = tempOf(path);
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    if (sha(await fs.readFile(temporary)) !== sha(bytes)) throw Object.assign(new Error('The copy changed.'), { code: 'ROLLBACK_COPY_CHANGED' });
    await fs.rename(temporary, path);
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

function createRollback({ userData, version, platform, appImage = null, publicKey, windowsCertificateThumbprint = null, updates, app, note = () => {}, signatureOf, spawnInstaller, now = Date.now, fs = fsp }) {
  const folder = join(userData, 'updates'), vaults = join(userData, 'vaults'), recordPath = join(folder, 'rollbacks.json');
  const readJson = async path => { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return null; } };

  async function readRecord() {
    const raw = await readJson(recordPath);
    return raw?.format === ROLLBACK_FORMAT && Array.isArray(raw.swaps) && Array.isArray(raw.skip) ? raw : { format: ROLLBACK_FORMAT, swaps: [], skip: [] };
  }
  async function writeRecord(record) {
    await fs.mkdir(folder, { recursive: true });
    await placeChecked(recordPath, Buffer.from(JSON.stringify(record)), fs);
  }
  /** The kept release as updates.cjs wrote it, checked again now, or null. */
  async function keptRelease() {
    const manifest = await readJson(join(folder, 'previous', 'manifest.json'));
    let signature;
    try { signature = (await fs.readFile(join(folder, 'previous', 'signature'), 'utf8')).trim(); } catch { return null; }
    const release = { manifest, signature, artifactPath: join(folder, 'previous', 'installer') };
    return manifest && await updates.verifyStaged(release, publicKey, platform) ? release : null;
  }

  /** What to put back for one business: the backup named when it moved, else its newest safety copy. */
  async function backupFor(entry) {
    const backups = join(vaults, 'backups');
    const names = (await fs.readdir(backups).catch(() => [])).filter(name => BACKUP.test(name));
    const safety = names.filter(name => entry.workspaceId && name.startsWith(`chausar-${entry.workspaceId}-`) && name.endsWith('-safety.backup')).sort((a, b) => Number(/-(\d+)-safety/.exec(b)[1]) - Number(/-(\d+)-safety/.exec(a)[1]));
    for (const name of [...(typeof entry.backup === 'string' && names.includes(entry.backup) ? [entry.backup] : []), ...safety]) {
      const parsed = await readJson(join(backups, name));
      if (parsed?.backupFormat === 'chausar.backup.v1' && parsed.envelope?.format === 'chausar.vault.v1') return { name, envelope: JSON.stringify(parsed.envelope) };
    }
    return null;
  }

  /**
   * For each business this version moved: the newer live file becomes a rollback-kept backup, and the backup from before it
   * becomes the live file. Everything is read first, so a business with nothing to go back to stops the whole step untouched.
   */
  async function moveData() {
    const indexPath = join(vaults, 'custody', 'data-versions.json');
    const index = await readJson(indexPath);
    if (!index?.live || typeof index.live !== 'object') return true;
    const moved = Object.entries(index.live).filter(([name, entry]) => FOLDER.test(name) && entry?.migratedBy === version);
    const plans = [];
    for (const [name, entry] of moved) {
      const back = await backupFor(entry);
      if (!back) return false;
      plans.push({ name, entry, back, newer: await fs.readFile(join(vaults, name, LIVE_FILE), 'utf8') });
    }
    let stamp = now();
    for (const { name, entry, back, newer } of plans) {
      const kept = `chausar-${entry.workspaceId}-${stamp++}-rollback-kept.backup`;
      await placeChecked(join(vaults, 'backups', kept), Buffer.from(`{"backupFormat":"chausar.backup.v1","envelope":${newer}}`), fs);
      await placeChecked(join(vaults, name, LIVE_FILE), Buffer.from(back.envelope), fs);
      index.files = { ...index.files, [kept]: entry.version };
      index.live[name] = { version: entry.from ?? 1, workspaceId: entry.workspaceId };
    }
    if (plans.length) await placeChecked(indexPath, Buffer.from(JSON.stringify(index)), fs);
    return true;
  }

  async function swapApp(release) {
    if (platform === 'linux' && typeof appImage === 'string') {
      const old = await fs.stat(appImage), temporary = tempOf(appImage), bytes = await fs.readFile(release.artifactPath);
      await placeChecked(temporary, bytes, fs);
      await fs.chmod(temporary, old.mode & 0o7777);
      // The failed file stays beside the record until the next update; it's only a copy of what the signed feed had.
      await fs.copyFile(appImage, join(folder, `failed-${version}.AppImage`)).catch(() => {});
      await fs.rename(temporary, appImage);
      app.relaunch(); app.exit(0);
      return 'relaunching';
    }
    if (platform === 'win32') {
      if (!updates.certificateThumbprint(windowsCertificateThumbprint)) return 'needs-signing';
      const runPath = join(folder, 'stage', `chausar-update-${randomBytes(8).toString('hex')}.exe`);
      await fs.mkdir(dirname(runPath), { recursive: true });
      await fs.copyFile(release.artifactPath, runPath);
      if (!(await updates.verifyStaged({ ...release, artifactPath: runPath }, publicKey, platform))) { await fs.unlink(runPath).catch(() => {}); return 'not-verified'; }
      const signed = await signatureOf(runPath);
      if (!updates.publisherMatches(signed, windowsCertificateThumbprint)) { await fs.unlink(runPath).catch(() => {}); return 'needs-signing'; }
      spawnInstaller(runPath, ['/S', '--updated']);
      app.exit(0);
      return 'installer-started';
    }
    return 'manual';
  }

  /** The whole way back. Returns { state }; anything short of a swap leaves the app as it is, and C5's dialog says the rest. */
  async function run(from, reason) {
    const done = state => { note({ op: 'rollback', state, reason, from }); return { state }; };
    const record = await readRecord();
    if (record.swaps.some(swap => swap.from === from || swap.to === from)) return done('already-swapped');
    const release = await keptRelease();
    if (!release) return done(await fs.stat(join(folder, 'previous', 'manifest.json')).then(() => 'not-verified', () => 'no-previous'));
    let moved = false;
    try { moved = await moveData(); } catch { moved = false; }
    if (!moved) return done('data-not-moved');
    const to = String(release.manifest.version);
    await writeRecord({ ...record, swaps: [...record.swaps, { from, to, at: new Date(now()).toISOString(), reason, told: false }], skip: [...new Set([...record.skip, from])] });
    try { return done(await swapApp(release)); }
    catch { return done('failed'); }
  }

  return Object.freeze({
    afterFailedStart: ({ version: failed }) => run(failed, 'failed-start'),
    /** D12 task 10: what the unlock screen may offer: the kept release, checked now; null when there is none to go to. */
    async goBackOffer() {
      const record = await readRecord();
      if (record.swaps.some(swap => swap.from === version || swap.to === version)) return null;
      const release = await keptRelease();
      return release ? { version: String(release.manifest.version) } : null;
    },
    /** Main's own dialog asks first and names both versions; Cancel is the default and moves nothing. */
    async goBack(dialog, parent) {
      const offer = await this.goBackOffer();
      if (!offer) return { state: 'no-previous' };
      const options = { type: 'question', title: 'Chausar', message: `Go back to version ${offer.version}?`, detail: `This version, ${version}, couldn't bring your business up to date. Chausar goes back to ${offer.version} and your business stays as it was before the update.`, buttons: ['Go back', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true };
      const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (answer?.response !== 0) return { state: 'cancelled' };
      return run(version, 'failed-migration');
    },
  });
}

module.exports = Object.freeze({ ROLLBACK_FORMAT, createRollback });
