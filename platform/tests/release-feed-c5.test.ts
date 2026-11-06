// C5 task 30 (with D11f task 32): scripts/release-feed.mjs builds and signs the update feed from the built installers and
// a private key file passed in; scripts/release-key.mjs makes the key pair and prints only the public half. Every key here
// is made at run time in a temp folder; nothing is downloaded and nothing is installed.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReleaseUpdater } from '../runtime/updater.ts';
import { CURRENT_SCHEMA } from '../runtime/migrations/ladder.ts';
import { noNet } from './helpers/no-net.ts';

test.beforeEach(t => noNet(t));

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FEED = join(ROOT, 'scripts', 'release-feed.mjs'), KEY = join(ROOT, 'scripts', 'release-key.mjs');
const REPO = 'kartavyc/chausar-platform';

async function folder(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-feed-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true, env: { ...process.env, GITHUB_REPOSITORY: REPO } });
}
async function keyFile(root: string) {
  const pair = generateKeyPairSync('ed25519'), path = join(root, 'release-key.pem');
  await writeFile(path, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  return { path, publicKey: pair.publicKey };
}
async function installers(root: string, version: string, names = [`Chausar-Beta-${version}-win-x64.exe`, `Chausar-Beta-${version}-linux-x86_64.AppImage`]) {
  const dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  for (const name of names) await writeFile(join(dist, name), `stand-in for ${name}; never run`);
  for (const name of [`Chausar-Beta-${version}-linux-amd64.deb`, `Chausar-Beta-${version}-win-x64.exe.blockmap`, 'SHA256SUMS', 'chausar-sbom.cdx.json']) await writeFile(join(dist, name), 'not a feed entry');
  return dist;
}

test('the feed it writes verifies with the matching public key, carries the data version and offers this platform\'s installer', async t => {
  const root = await folder(t), key = await keyFile(root), dist = await installers(root, '0.2.0'), output = join(root, 'out', 'feed.json');
  const done = run(FEED, ['--artifacts', dist, '--private-key', key.path, '--output', output, '--version', '0.2.0']);
  assert.equal(done.status, 0, done.stderr);
  const text = await readFile(output, 'utf8'), signature = (await readFile(`${output}.sig`, 'utf8')).trim(), feed = JSON.parse(text);
  assert.equal(feed.channel, 'stable'); assert.equal(feed.rolloutPercent, 100);
  const days = (Date.parse(feed.expiresAt) - Date.now()) / 86_400_000;
  assert.ok(days > 89 && days <= 90, `the feed expires in ${days} days`);
  assert.deepEqual(feed.releases.map((release: any) => `${release.manifest.platform}/${release.manifest.architecture}`).sort(), ['linux/x64', 'win32/x64']);
  for (const { manifest } of feed.releases) {
    assert.equal(manifest.dataSchemaVersion, CURRENT_SCHEMA);
    assert.equal(manifest.version, '0.2.0');
    assert.equal(manifest.rollback.requiresBackup, true);
    const name = decodeURIComponent(manifest.url.split('/').pop()), bytes = await readFile(join(dist, name));
    assert.equal(manifest.url, `https://github.com/${REPO}/releases/download/v0.2.0/${name}`);
    assert.equal(manifest.size, bytes.length); assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.ok(!text.includes('PRIVATE KEY') && !signature.includes('PRIVATE KEY'));
  const updater = new ReleaseUpdater({ publicKey: key.publicKey, version: '0.1.0', stageDirectory: root });
  const choice = updater.verifyFeed(text, signature, { channel: 'stable', installId: 'e'.repeat(32) });
  if (process.platform === 'win32' || process.platform === 'linux') {
    assert.equal(choice.reason, 'offered');
    assert.equal(choice.offer?.manifest.platform, process.platform);
  }
  const stranger = generateKeyPairSync('ed25519');
  assert.throws(() => new ReleaseUpdater({ publicKey: stranger.publicKey, version: '0.1.0', stageDirectory: root }).verifyFeed(text, signature, { channel: 'stable', installId: 'e'.repeat(32) }), (error: any) => error.code === 'INVALID_FEED_SIGNATURE');
});

test('a prerelease goes to the beta channel, the rollout is set, and a name with spaces keeps GitHub\'s dotted asset name', async t => {
  const root = await folder(t), key = await keyFile(root), dist = await installers(root, '0.2.0-preview.2', ['Chausar Preview Setup 0.2.0-preview.2.exe']), output = join(root, 'feed.json');
  const done = run(FEED, ['--artifacts', dist, '--private-key', key.path, '--output', output, '--version', '0.2.0-preview.2', '--rollout', '25']);
  assert.equal(done.status, 0, done.stderr);
  const feed = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(feed.channel, 'beta'); assert.equal(feed.rolloutPercent, 25);
  const week = run(FEED, ['--artifacts', dist, '--private-key', key.path, '--output', join(root, 'week.json'), '--version', '0.2.0-preview.2', '--valid-days', '7']);
  assert.equal(week.status, 0, week.stderr);
  const days = (Date.parse(JSON.parse(await readFile(join(root, 'week.json'), 'utf8')).expiresAt) - Date.now()) / 86_400_000;
  assert.ok(days > 6 && days <= 7, `${days}`);
  assert.equal(run(FEED, ['--artifacts', dist, '--private-key', key.path, '--output', join(root, 'never.json'), '--version', '0.2.0-preview.2', '--valid-days', '400']).status, 1);
  assert.equal(feed.releases[0].manifest.url, `https://github.com/${REPO}/releases/download/v0.2.0-preview.2/Chausar.Preview.Setup.0.2.0-preview.2.exe`);
});

test('it refuses an empty folder, two installers for one platform, a key that is not Ed25519 and an output inside the checkout', async t => {
  const root = await folder(t), key = await keyFile(root), empty = join(root, 'empty');
  await mkdir(empty);
  const none = run(FEED, ['--artifacts', empty, '--private-key', key.path, '--output', join(root, 'a.json'), '--version', '0.2.0']);
  assert.equal(none.status, 1); assert.match(none.stderr, /No installer/);
  const twice = await installers(join(root, 'twice'), '0.2.0', ['Chausar-Beta-0.2.0-win-x64.exe', 'Chausar Setup 0.2.0.exe']);
  const both = run(FEED, ['--artifacts', twice, '--private-key', key.path, '--output', join(root, 'b.json'), '--version', '0.2.0']);
  assert.equal(both.status, 1); assert.match(both.stderr, /Two installers/);
  const rsa = join(root, 'rsa.pem');
  await writeFile(rsa, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const dist = await installers(join(root, 'one'), '0.2.0');
  const wrong = run(FEED, ['--artifacts', dist, '--private-key', rsa, '--output', join(root, 'c.json'), '--version', '0.2.0']);
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /Ed25519/);
  const inside = run(FEED, ['--artifacts', dist, '--private-key', key.path, '--output', join(ROOT, 'feed-should-not-exist.json'), '--version', '0.2.0']);
  assert.equal(inside.status, 1); assert.match(inside.stderr, /outside the code folder/);
  await assert.rejects(stat(join(ROOT, 'feed-should-not-exist.json')));
  const usage = run(FEED, ['--artifacts', dist]);
  assert.equal(usage.status, 2);
});

// Fix round 2 (review 2, LOW-2): the feed expires, so the release checklist beside the scripts says to re-sign it in time.
test('the release checklist says to re-sign the feed before its 90 days run out', async () => {
  const doc = await readFile(join(ROOT, 'docs', 'desktop-releases.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## The update feed'));
  assert.ok(doc.includes('## The update feed'), 'a section on the update feed');
  assert.match(section, /release-feed\.mjs/); assert.match(section, /90 days/); assert.match(section, /re-sign/i); assert.match(section, /--valid-days/);
  assert.match(await readFile(FEED, 'utf8'), /docs\/desktop-releases\.md/);
});

test('release-key writes the private half outside the checkout, once, and prints only the public half', async t => {
  const root = await folder(t), out = join(root, 'keys', 'chausar-release.pem');
  const made = run(KEY, ['--out', out]);
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /-----BEGIN PUBLIC KEY-----/); assert.doesNotMatch(made.stdout, /PRIVATE/);
  const privateKey = createPrivateKey(await readFile(out, 'utf8')), publicKey = createPublicKey(made.stdout.slice(made.stdout.indexOf('-----BEGIN PUBLIC KEY-----')));
  assert.equal(privateKey.asymmetricKeyType, 'ed25519');
  assert.ok(verify(null, Buffer.from('payload'), publicKey, sign(null, Buffer.from('payload'), privateKey)));
  if (process.platform !== 'win32') assert.equal((await stat(out)).mode & 0o777, 0o600);
  const before = await readFile(out, 'utf8'), again = run(KEY, ['--out', out]);
  assert.equal(again.status, 1); assert.match(again.stderr, /already/); assert.equal(await readFile(out, 'utf8'), before);
  const inside = run(KEY, ['--out', join(ROOT, 'release-key-should-not-exist.pem')]);
  assert.equal(inside.status, 1); assert.match(inside.stderr, /outside the code folder/);
  await assert.rejects(stat(join(ROOT, 'release-key-should-not-exist.pem')));
  assert.equal(run(KEY, []).status, 2);
});
