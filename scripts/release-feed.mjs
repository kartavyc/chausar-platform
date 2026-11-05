#!/usr/bin/env node
// C5 task 30: the signed update feed. Reads the built installers in one folder (the Windows NSIS .exe and the Linux
// AppImage; .deb, .tar.gz, blockmaps and checksums are not update targets), makes one ReleaseManifest for each, signs
// each manifest and then the whole feed with the Ed25519 private key file passed in, and writes the feed and its detached
// signature (<output>.sig). The tag workflow (release.yml) calls it; the private key never enters the checkout.
// D11f task 32: each manifest's dataSchemaVersion is the build's own CURRENT_SCHEMA from the migration ladder.
// Usage: node scripts/release-feed.mjs --artifacts <dir> --private-key <file> --output <feed.json>
//          [--version <x.y.z>] [--channel beta|stable] [--rollout <0-100>] [--base-url <https url/>] [--min-engine <x.y.z>]
//   --version     defaults to package.json's version
//   --channel     defaults to beta for a prerelease version, stable otherwise
//   --base-url    defaults to https://github.com/<GITHUB_REPOSITORY or kartavyc/chausar-platform>/releases/download/v<version>/
//   --output      a file outside the checkout (D3)
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseInsideRepo, runRoot } from '../platform/runtime/run-root.mjs';
import { ReleaseUpdater, canonicalReleaseFeed, canonicalReleaseManifest } from '../platform/runtime/updater.ts';
import { CURRENT_SCHEMA } from '../platform/runtime/migrations/ladder.ts';

const USAGE = 'Usage: node scripts/release-feed.mjs --artifacts <dir> --private-key <file> --output <feed.json> [--version <x.y.z>] [--channel beta|stable] [--rollout <0-100>] [--base-url <https url/>] [--min-engine <x.y.z>]';
const OPTIONS = ['--artifacts', '--private-key', '--output', '--version', '--channel', '--rollout', '--base-url', '--min-engine'];

/** Which update target a built file is, by its name: [platform, architecture], or null for anything else. */
function targetOf(name) {
  if (/uninstall/i.test(name) || /\.blockmap$/i.test(name)) return null;
  const architecture = /(?:arm64|aarch64)/i.test(name) ? 'arm64' : 'x64';
  if (/\.exe$/i.test(name)) return ['win32', architecture];
  if (/\.AppImage$/.test(name)) return ['linux', architecture];
  return null;
}

/** GitHub stores a release asset with spaces turned into dots; the URL names that stored asset. */
const assetName = name => name.replace(/ /g, '.');

async function sha256Of(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** The feed object and its signature, every manifest signed by the same key. Throws with plain words on a refusal. */
export async function buildFeed({ artifacts, privateKey, version, channel, rollout = 100, baseUrl, minEngine = '0.0.0', publishedAt = new Date().toISOString() }) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The release key must be an Ed25519 private key (make one with scripts/release-key.mjs).');
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) throw new Error('--rollout must be a whole number from 0 to 100.');
  const pick = channel ?? (version.includes('-') ? 'beta' : 'stable');
  if (!['beta', 'stable'].includes(pick)) throw new Error('--channel must be beta or stable.');
  const base = baseUrl ?? `https://github.com/${process.env.GITHUB_REPOSITORY || 'kartavyc/chausar-platform'}/releases/download/v${version}/`;
  if (!base.startsWith('https://') || !base.endsWith('/')) throw new Error('--base-url must be an https address ending in /.');
  const seen = new Map(), releases = [];
  for (const name of (await readdir(artifacts)).sort()) {
    const target = targetOf(name), path = join(artifacts, name);
    if (!target || !(await stat(path)).isFile()) continue;
    const id = target.join('/');
    if (seen.has(id)) throw new Error(`Two installers for ${id}: ${seen.get(id)} and ${name}. Keep one in the folder.`);
    seen.set(id, name);
    const manifest = {
      schemaVersion: 1, version, publishedAt, platform: target[0], architecture: target[1],
      url: new URL(encodeURIComponent(assetName(name)), base).href, sha256: await sha256Of(path), size: (await stat(path)).size,
      minEngineVersion: minEngine, dataSchemaVersion: CURRENT_SCHEMA, rollback: { supported: true, requiresBackup: true },
    };
    releases.push({ manifest, signature: sign(null, Buffer.from(canonicalReleaseManifest(manifest)), key).toString('base64url') });
  }
  if (!releases.length) throw new Error(`No installer (.exe or .AppImage) in ${artifacts}.`);
  const feed = { schemaVersion: 1, channel: pick, rolloutPercent: rollout, releases };
  const text = canonicalReleaseFeed(feed), signature = sign(null, Buffer.from(text), key).toString('base64url');
  // The app's own reader checks what was written: every manifest's fields, both signatures and the feed's shape.
  new ReleaseUpdater({ publicKey: createPublicKey(key), version: '0.0.0', stageDirectory: tmpdir() }).verifyFeed(text, signature, { channel: pick, installId: 'release-feed-check' });
  return { feed, text, signature };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!OPTIONS.includes(flag) || !value || value.startsWith('--')) { process.stderr.write(`${USAGE}\n`); process.exit(2); }
    options[flag.slice(2)] = value;
  }
  if (!options.artifacts || !options['private-key'] || !options.output) { process.stderr.write(`${USAGE}\n`); process.exit(2); }
  try {
    const output = refuseInsideRepo(options.output, { variable: '--output', fallback: runRoot('release-feed') });
    const version = options.version ?? JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
    const { text, signature } = await buildFeed({
      artifacts: resolve(options.artifacts), privateKey: await readFile(options['private-key'], 'utf8'), version,
      channel: options.channel, rollout: options.rollout === undefined ? 100 : Number(options.rollout),
      baseUrl: options['base-url'], minEngine: options['min-engine'],
    });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text);
    await writeFile(`${output}.sig`, `${signature}\n`);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
