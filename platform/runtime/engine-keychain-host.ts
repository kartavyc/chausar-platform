import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { check } from './contracts.ts';
import { safeDirectory, type VaultKeychainProvider } from './vault.ts';
import { PlatformKeychain, type PlatformKeychainOptions } from './platform-keychain.ts';

/** Constructor-only host composition; never parsed from a renderer or archive. */
export type EngineKeychainHostDependencies = {
  keychain?: VaultKeychainProvider;
  readKeychainManifest?: (path: string) => Promise<Uint8Array>;
  keychainProcess?: Pick<PlatformKeychainOptions, 'spawnProcess' | 'verifyExecutable' | 'timeoutMs'>;
  keychainPlatform?: NodeJS.Platform;
  keychainArchitecture?: string;
};
export type KeychainHelperManifest = { format: 'chausar.keychain-helper.v1'; platform: 'win32' | 'darwin' | 'linux';
  architecture: 'x64' | 'arm64'; executable: string; sha256: string };

/** The single helper-manifest rule, shared with native/keychain-status.ts so the status report cannot drift from
 * what custody enrollment accepts: exact keys, pinned helper name (never a path) and target, lowercase SHA-256. */
export function validKeychainHelperManifest(value: unknown, platform: string, architecture: string): value is KeychainHelperManifest {
  const manifest = value as KeychainHelperManifest;
  return Boolean(manifest) && typeof manifest === 'object' && !Array.isArray(manifest)
    && Object.keys(manifest).sort().join(',') === 'architecture,executable,format,platform,sha256'
    && manifest.format === 'chausar.keychain-helper.v1' && ['win32', 'darwin', 'linux'].includes(platform)
    && manifest.platform === platform && ['x64', 'arm64'].includes(architecture) && manifest.architecture === architecture
    && manifest.executable === (platform === 'win32' ? 'chausar-keychain.exe' : 'chausar-keychain')
    && typeof manifest.sha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.sha256);
}

async function readManifest(path: string): Promise<Uint8Array> {
  await safeDirectory(dirname(path));
  const before = await lstat(path);
  check(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= 4096,
    'KEYCHAIN_MANIFEST_INVALID', 'The native custody manifest must be a bounded regular file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await file.stat();
    check(actual.isFile() && actual.dev === before.dev && actual.ino === before.ino && actual.size === before.size,
      'KEYCHAIN_MANIFEST_INVALID', 'The native custody manifest changed during inspection.');
    const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    check(bytesRead === before.size && (await file.stat()).size === before.size,
      'KEYCHAIN_MANIFEST_INVALID', 'The native custody manifest changed during inspection.');
    return bytes.subarray(0, bytesRead);
  } finally { await file.close(); }
}

/** Omission preserves explicitly passphrase-only local hosts. Installed desktop
 * production supplies its fixed bundled manifest; invalid/missing configured
 * custody refuses startup rather than silently falling back. No helper runs here. */
export async function loadEngineKeychain(environment: NodeJS.ProcessEnv, dependencies: EngineKeychainHostDependencies = {}, demo = false): Promise<VaultKeychainProvider | undefined> {
  if (dependencies.keychain) {
    check(['store', 'retrieve', 'remove'].every(name => typeof dependencies.keychain![name as keyof VaultKeychainProvider] === 'function'),
      'KEYCHAIN_PROVIDER_REQUIRED', 'Trusted custody must implement registration, retrieval and removal.');
    return dependencies.keychain;
  }
  const path = environment.CHAUSAR_KEYCHAIN_MANIFEST;
  if (path === undefined) return undefined;
  check(!demo, 'KEYCHAIN_PREVIEW_REFUSED', 'Preview hosts cannot enroll a native custody provider.');
  check(isAbsolute(path) && basename(path) === 'manifest.json', 'KEYCHAIN_MANIFEST_INVALID', 'Use the explicit native custody manifest path.');
  const platform = dependencies.keychainPlatform ?? process.platform, architecture = dependencies.keychainArchitecture ?? process.arch;
  let manifest: KeychainHelperManifest;
  try {
    const bytes = await (dependencies.readKeychainManifest ?? readManifest)(path);
    check(bytes.byteLength > 0 && bytes.byteLength <= 4096, 'KEYCHAIN_MANIFEST_INVALID', 'Native custody manifest exceeds its bound.');
    manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch { check(false, 'KEYCHAIN_MANIFEST_INVALID', 'A configured native custody manifest must be readable and valid.'); }
  check(validKeychainHelperManifest(manifest!, platform, architecture),
  'KEYCHAIN_MANIFEST_INVALID', 'Native custody manifest must pin the exact helper and running platform/architecture.');
  return PlatformKeychain.create({ platform, architecture, executable: join(dirname(path), manifest!.executable), sha256: manifest!.sha256,
    ...dependencies.keychainProcess });
}
