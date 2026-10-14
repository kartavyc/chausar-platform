import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';
import { canonicalReleaseManifest, compareVersions, type ReleaseManifest } from '../../platform/runtime/updater.ts';

/** Builds the updater's ReleaseManifest for one artifact and signs its canonical
 * bytes with the publisher's Ed25519 key, read from CHAUSAR_RELEASE_PRIVATE_KEY_FILE.
 * Without a configured key it refuses with RELEASE_KEY_UNCONFIGURED; it never makes a key. */
export type UpdateManifestInput = {
  artifactPath: string; version: string; url: string;
  platform: ReleaseManifest['platform']; architecture: ReleaseManifest['architecture'];
  minEngineVersion: string; dataSchemaVersion: number; rollbackSupported: boolean; publishedAt?: string;
};

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function buildReleaseManifest(input: UpdateManifestInput): Promise<ReleaseManifest> {
  const info = await lstat(input.artifactPath);
  check(info.isFile() && !info.isSymbolicLink() && info.size > 0, 'RELEASE_ARTIFACT_INVALID', 'The release artifact must be a regular file.');
  compareVersions(input.version, input.minEngineVersion);
  check(['win32', 'linux', 'darwin'].includes(input.platform) && ['x64', 'arm64'].includes(input.architecture), 'RELEASE_TARGET_INVALID', 'Use a supported platform and architecture.');
  check(Number.isSafeInteger(input.dataSchemaVersion) && input.dataSchemaVersion > 0 && typeof input.rollbackSupported === 'boolean', 'RELEASE_MANIFEST_INVALID', 'The data schema version and rollback flag are required.');
  check(typeof input.url === 'string' && input.url.startsWith('https://'), 'RELEASE_MANIFEST_INVALID', 'The artifact URL must use HTTPS.');
  return {
    schemaVersion: 1, version: input.version, publishedAt: input.publishedAt ?? new Date().toISOString(),
    platform: input.platform, architecture: input.architecture, url: input.url,
    sha256: await digest(input.artifactPath), size: info.size, minEngineVersion: input.minEngineVersion,
    dataSchemaVersion: input.dataSchemaVersion, rollback: { supported: input.rollbackSupported, requiresBackup: true },
  };
}

export async function releaseSigningKey(environment: NodeJS.ProcessEnv = process.env): Promise<KeyObject> {
  const path = environment.CHAUSAR_RELEASE_PRIVATE_KEY_FILE;
  check(typeof path === 'string' && path.trim() !== '' && isAbsolute(path), 'RELEASE_KEY_UNCONFIGURED', 'Set CHAUSAR_RELEASE_PRIVATE_KEY_FILE to the absolute path of the Ed25519 release key.');
  let key: KeyObject | undefined;
  try {
    const info = await lstat(path);
    if (info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 65536) key = createPrivateKey(await readFile(path));
  } catch { key = undefined; }
  check(key && key.type === 'private' && key.asymmetricKeyType === 'ed25519', 'RELEASE_KEY_UNCONFIGURED', 'The release key file must hold an Ed25519 private key.');
  return key;
}

/** Returns the exact canonical payload the updater verifies and its detached base64url signature. */
export function signReleaseManifest(manifest: ReleaseManifest, key: KeyObject): { payload: string; signature: string } {
  const payload = canonicalReleaseManifest(manifest);
  return { payload, signature: sign(null, Buffer.from(payload), key).toString('base64url') };
}

export async function signUpdateManifest(input: UpdateManifestInput, environment: NodeJS.ProcessEnv = process.env) {
  const key = await releaseSigningKey(environment);
  const manifest = await buildReleaseManifest(input);
  return { manifest, ...signReleaseManifest(manifest, key) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options: Record<string, string> = {}, args = process.argv.slice(2);
    const names = ['--artifact', '--version', '--url', '--platform', '--arch', '--min-engine', '--data-schema', '--rollback', '--out'];
    for (let index = 0; index < args.length; index += 2) {
      check(names.includes(args[index]) && args[index + 1] !== undefined && !(args[index].slice(2) in options), 'USAGE',
        'usage: node scripts/release/sign-update-manifest.ts --artifact <file> --version <v> --url <https url> --platform <p> --arch <a> --min-engine <v> --data-schema <n> --rollback true|false [--out <folder>]');
      options[args[index].slice(2)] = args[index + 1];
    }
    const artifactPath = resolve(options.artifact ?? '');
    const result = await signUpdateManifest({ artifactPath, version: options.version, url: options.url,
      platform: options.platform as ReleaseManifest['platform'], architecture: options.arch as ReleaseManifest['architecture'],
      minEngineVersion: options['min-engine'], dataSchemaVersion: Number(options['data-schema']), rollbackSupported: options.rollback === 'true' });
    const out = resolve(options.out ?? join(artifactPath, '..')), name = basename(artifactPath);
    await writeFile(join(out, `${name}.manifest.json`), result.payload, { flag: 'wx' });
    await writeFile(join(out, `${name}.manifest.sig`), result.signature + '\n', { flag: 'wx' });
    console.log(`Signed update manifest for ${name} (${result.manifest.version}).`);
  } catch (error: any) { console.error(`${error.code ?? 'RELEASE_SIGNING_FAILED'}: ${error.message}`); process.exitCode = 1; }
}
