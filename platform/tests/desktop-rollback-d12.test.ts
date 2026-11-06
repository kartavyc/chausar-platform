// D12 tasks 9 and 10: a version that won't start goes back to the kept release, once. Everything is in a temp folder with
// stand-ins for the installer, the relaunch and the dialog, so nothing runs and nothing shows on screen.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalReleaseManifest, ReleaseUpdater, type ReleaseManifest } from '../runtime/updater.ts';

const require = createRequire(import.meta.url);
const { createRollback, ROLLBACK_FORMAT } = require('../../app/desktop/rollback.cjs');
const realUpdates = require('../../app/desktop/updates.cjs');
const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const OLD = Buffer.from('the release before, a stand-in that is never run');
const FOLDER = 'sample-business', WORKSPACE = 'workspace-sample';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function manifestFor(platform: string, bytes = OLD, version = '0.1.0'): ReleaseManifest {
  return { schemaVersion: 1, version, publishedAt: '2026-10-01T00:00:00.000Z', platform: platform as ReleaseManifest['platform'], architecture: 'x64', url: 'https://downloads.example.com/chausar.exe', sha256: sha(bytes), size: bytes.length, minEngineVersion: '0.0.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } } as unknown as ReleaseManifest;
}
const signatureOf = (manifest: ReleaseManifest) => sign(null, Buffer.from(canonicalReleaseManifest(manifest)), keys.privateKey).toString('base64url');

async function setup(t: TestContext, options: { platform?: string; previous?: Buffer | null; publisher?: string | null; signature?: { status: string; publisher: string | null } } = {}) {
  const userData = await mkdtemp(join(await realpath(tmpdir()), 'chausar-rollback-d12-'));
  t.after(() => rm(userData, { recursive: true, force: true }));
  const platform = options.platform ?? 'linux', updates = join(userData, 'updates'), vaults = join(userData, 'vaults');
  const manifest = manifestFor(platform);
  if (options.previous !== null) {
    await mkdir(join(updates, 'previous'), { recursive: true });
    await writeFile(join(updates, 'previous', 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(updates, 'previous', 'signature'), `${signatureOf(manifest)}\n`);
    await writeFile(join(updates, 'previous', 'installer'), options.previous ?? OLD);
  }
  // One business this version moved, one it never opened.
  await mkdir(join(vaults, FOLDER), { recursive: true }); await mkdir(join(vaults, 'other-business'), { recursive: true });
  await mkdir(join(vaults, 'backups'), { recursive: true }); await mkdir(join(vaults, 'custody'), { recursive: true });
  const newer = JSON.stringify({ format: 'chausar.vault.v1', id: 'vault', revision: 8, data: 'newer' }), older = JSON.stringify({ format: 'chausar.vault.v1', id: 'vault', revision: 7, data: 'older' });
  await writeFile(join(vaults, FOLDER, 'authority.encrypted.json'), newer);
  await writeFile(join(vaults, 'other-business', 'authority.encrypted.json'), 'never opened by the failed version');
  const backup = `chausar-${WORKSPACE}-1000-migration.backup`;
  await writeFile(join(vaults, 'backups', backup), `{"backupFormat":"chausar.backup.v1","envelope":${older}}`);
  await writeFile(join(vaults, 'custody', 'data-versions.json'), JSON.stringify({ format: 'chausar.data-versions.v1', files: { [backup]: 1 }, live: {
    [FOLDER]: { version: 2, workspaceId: WORKSPACE, migratedBy: '0.2.0', from: 1, backup },
    'other-business': { version: 1, workspaceId: 'workspace-other' },
  } }));
  const appImage = join(userData, 'Chausar.AppImage');
  await writeFile(appImage, 'the failed version'); await chmod(appImage, 0o755);
  const seen = { relaunches: 0, exits: 0, ran: [] as { path: string; args: string[] }[], lines: [] as any[] };
  const rollback = createRollback({
    userData, version: '0.2.0', platform, appImage: platform === 'linux' ? appImage : null, publicKey, windowsPublisher: options.publisher ?? null,
    updates: realUpdates, app: { relaunch: () => { seen.relaunches += 1; }, exit: () => { seen.exits += 1; } }, note: (line: unknown) => { seen.lines.push(line); },
    signatureOf: async () => options.signature ?? { status: 'Valid', publisher: options.publisher ?? null },
    spawnInstaller: (path: string, args: string[]) => { seen.ran.push({ path, args }); },
    now: () => Date.parse('2026-11-06T10:00:00.000Z'),
  });
  return { rollback, userData, updates, vaults, appImage, seen, newer, older, backup };
}
const liveOf = (vaults: string, folder = FOLDER) => readFile(join(vaults, folder, 'authority.encrypted.json'), 'utf8');

test('two failed starts with a verified previous: data back for the moved business only, the newer kept, the AppImage swapped, relaunched', async t => {
  const { rollback, vaults, appImage, updates, seen, newer, older } = await setup(t);
  const answer = await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' });
  assert.equal(answer.state, 'relaunching');
  assert.equal(await liveOf(vaults), older, 'the migration backup is the live file again');
  assert.equal(await liveOf(vaults, 'other-business'), 'never opened by the failed version', 'a business it never opened keeps its bytes');
  const kept = (await readdir(join(vaults, 'backups'))).filter(name => name.endsWith('-rollback-kept.backup'));
  assert.equal(kept.length, 1);
  const wrapped = JSON.parse(await readFile(join(vaults, 'backups', kept[0]!), 'utf8'));
  assert.equal(wrapped.backupFormat, 'chausar.backup.v1');
  assert.equal(JSON.stringify(wrapped.envelope), newer, 'the newer data is kept as a backup that opens');
  assert.equal((await readFile(appImage)).toString(), OLD.toString());
  if (process.platform !== 'win32') assert.equal((await stat(appImage)).mode & 0o777, 0o755);
  assert.equal(seen.relaunches, 1); assert.equal(seen.exits, 1);
  const record = JSON.parse(await readFile(join(updates, 'rollbacks.json'), 'utf8'));
  assert.equal(record.format, ROLLBACK_FORMAT);
  assert.deepEqual(record.skip, ['0.2.0']);
  assert.deepEqual(record.swaps[0], { from: '0.2.0', to: '0.1.0', at: '2026-11-06T10:00:00.000Z', reason: 'failed-start', told: false });
  const versions = JSON.parse(await readFile(join(vaults, 'custody', 'data-versions.json'), 'utf8'));
  assert.equal(versions.live[FOLDER].version, 1); assert.equal(versions.live[FOLDER].migratedBy, undefined);
  assert.equal(versions.files[kept[0]!], 2);
});

test('Windows without a certificate: the data goes back, no installer runs, and the owner installs it from the dialog', async t => {
  const { rollback, vaults, seen, older } = await setup(t, { platform: 'win32', publisher: null });
  const answer = await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' });
  assert.equal(answer.state, 'needs-signing');
  assert.equal(await liveOf(vaults), older);
  assert.deepEqual(seen.ran, []); assert.equal(seen.relaunches, 0);
});

test('Windows with the pinned publisher: the checked copy of the previous installer runs silently', async t => {
  const { rollback, seen } = await setup(t, { platform: 'win32', publisher: 'Chausar' });
  const answer = await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' });
  assert.equal(answer.state, 'installer-started');
  assert.equal(seen.ran.length, 1); assert.deepEqual(seen.ran[0]!.args, ['/S', '--updated']);
  assert.match(seen.ran[0]!.path, /chausar-update-[a-f0-9]{16}\.exe$/);
  assert.equal(seen.exits, 1);
});

test('macOS is the dialog only, after the data went back', async t => {
  const { rollback, vaults, older } = await setup(t, { platform: 'darwin' });
  assert.equal((await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' })).state, 'manual');
  assert.equal(await liveOf(vaults), older);
});

test('a previous installer with one changed byte: no swap, no data moved, and it says why', async t => {
  const { rollback, vaults, appImage, seen, newer } = await setup(t, { previous: Buffer.from('the release befor!, a stand-in that is never run') });
  const answer = await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' });
  assert.equal(answer.state, 'not-verified');
  assert.equal(await liveOf(vaults), newer);
  assert.equal(await readFile(appImage, 'utf8'), 'the failed version');
  assert.equal(seen.relaunches, 0);
  assert.equal(seen.lines.some(line => line.op === 'rollback' && line.state === 'not-verified'), true);
});

test('no kept release: nothing moves', async t => {
  const { rollback, vaults, newer } = await setup(t, { previous: null });
  assert.equal((await rollback.afterFailedStart({ version: '0.2.0', previous: null })).state, 'no-previous');
  assert.equal(await liveOf(vaults), newer);
});

test('a second failure after a rollback never swaps again, in either direction', async t => {
  const { rollback, seen, updates } = await setup(t);
  await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' });
  assert.equal(seen.relaunches, 1);
  assert.equal((await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' })).state, 'already-swapped');
  assert.equal(seen.relaunches, 1);
  const record = JSON.parse(await readFile(join(updates, 'rollbacks.json'), 'utf8'));
  assert.equal(record.swaps.length, 1);
  assert.equal((await rollback.afterFailedStart({ version: '0.1.0', previous: '0.0.9' })).state, 'already-swapped', 'the version gone back to');
});

test('a data step that cannot find what it needs stops before the app changes, and touches no file', async t => {
  const { rollback, vaults, appImage, seen, newer, backup } = await setup(t);
  await rm(join(vaults, 'backups', backup));
  assert.equal((await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' })).state, 'data-not-moved');
  assert.equal(await liveOf(vaults), newer);
  assert.equal(await readFile(appImage, 'utf8'), 'the failed version');
  assert.equal(seen.relaunches, 0);
});

test('with no migration backup, the newest safety backup of that business stands in', async t => {
  const { rollback, vaults, older, backup } = await setup(t);
  await rm(join(vaults, 'backups', backup));
  await writeFile(join(vaults, 'backups', `chausar-${WORKSPACE}-900-safety.backup`), `{"backupFormat":"chausar.backup.v1","envelope":{"too":"old"}}`);
  await writeFile(join(vaults, 'backups', `chausar-${WORKSPACE}-1200-safety.backup`), `{"backupFormat":"chausar.backup.v1","envelope":${older}}`);
  assert.equal((await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' })).state, 'relaunching');
  assert.equal(await liveOf(vaults), older);
});

test('Go back, with the owner\'s yes only: the offer names the version, a changed release is not offered, and Cancel moves nothing', async t => {
  const { rollback, vaults, seen, older, newer } = await setup(t);
  assert.deepEqual(await rollback.goBackOffer(), { version: '0.1.0' });
  const asked: any[] = [];
  const no = await rollback.goBack({ showMessageBox: async (options: any) => { asked.push(options); return { response: 1 }; } }, null);
  assert.equal(no.state, 'cancelled');
  assert.equal(await liveOf(vaults), newer);
  assert.match(asked[0].message, /version 0\.1\.0/); assert.match(asked[0].detail, /0\.2\.0/);
  assert.equal(asked[0].cancelId, 1);
  const yes = await rollback.goBack({ showMessageBox: async () => ({ response: 0 }) }, null);
  assert.equal(yes.state, 'relaunching');
  assert.equal(await liveOf(vaults), older);
  assert.equal(seen.relaunches, 1);
  assert.equal(await rollback.goBackOffer(), null, 'never twice');
  const tampered = await setup(t, { previous: Buffer.from('changed') });
  assert.equal(await tampered.rollback.goBackOffer(), null);
});

test('the skipped version is not offered by verifyFeed, and a newer one is', async t => {
  const stage = await mkdtemp(join(await realpath(tmpdir()), 'chausar-rollback-feed-'));
  t.after(() => rm(stage, { recursive: true, force: true }));
  const updater = new ReleaseUpdater({ publicKey, version: '0.1.0', stageDirectory: stage });
  const release = (version: string) => { const manifest = manifestFor(process.platform, OLD, version) as any; manifest.architecture = process.arch; return { manifest, signature: signatureOf(manifest) }; };
  const signedFeed = (releases: unknown[]) => {
    const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    const text = canonical({ schemaVersion: 1, channel: 'beta', rolloutPercent: 100, expiresAt: '2099-01-01T00:00:00.000Z', releases });
    return { text, signature: sign(null, Buffer.from(text), keys.privateKey).toString('base64url') };
  };
  const options = { channel: 'beta' as const, installId: 'a'.repeat(32) };
  const one = signedFeed([release('0.2.0')]);
  assert.equal(updater.verifyFeed(one.text, one.signature, options).offer?.manifest.version, '0.2.0');
  assert.equal(updater.verifyFeed(one.text, one.signature, { ...options, skip: ['0.2.0'] }).offer, null);
  const both = signedFeed([release('0.2.0'), release('0.3.0')]);
  assert.equal(updater.verifyFeed(both.text, both.signature, { ...options, skip: ['0.2.0'] }).offer?.manifest.version, '0.3.0');
});

test('the update row says once that Chausar went back, then the line goes', async t => {
  const { UpdateService } = await import('../runtime/update-service.ts');
  const { rollback, updates } = await setup(t);
  await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' });
  const service = new UpdateService({ publicKey, feedUrl: 'https://downloads.example.com/feed.json', directory: updates, version: '0.1.0', channel: 'beta', windowsPublisher: null, isBusy: () => false, readFeed: async () => { throw new Error('no network in tests'); } });
  assert.deepEqual((await service.view()).rolledBack, { from: '0.2.0', to: '0.1.0', at: '2026-11-06T10:00:00.000Z', reason: 'failed-start' });
  assert.equal((await service.view()).rolledBack, undefined, 'once');
  assert.equal(JSON.parse(await readFile(join(updates, 'rollbacks.json'), 'utf8')).swaps[0].told, true);
});


test('newer rollback records and data indexes stop rollback without rewriting any file', async t => {
  for (const kind of ['rollbacks', 'data-versions']) {
    const { rollback, updates, vaults, newer, seen } = await setup(t);
    const path = kind === 'rollbacks' ? join(updates, 'rollbacks.json') : join(vaults, 'custody', 'data-versions.json');
    const raw = kind === 'rollbacks' ? { format: 'chausar.rollbacks.v99', swaps: [], skip: [] } : JSON.parse(await readFile(path, 'utf8'));
    raw.format = `chausar.${kind}.v99`;
    const text = JSON.stringify(raw);
    await writeFile(path, text);
    assert.equal((await rollback.afterFailedStart({ version: '0.2.0', previous: '0.1.0' })).state, kind === 'rollbacks' ? 'record-newer' : 'data-not-moved');
    assert.equal(await readFile(path, 'utf8'), text);
    assert.equal(await liveOf(vaults), newer);
    assert.equal(seen.relaunches, 0);
    assert.ok(seen.lines.some(line => line.code === 'LOCAL_FILE_NEWER'));
  }
});
