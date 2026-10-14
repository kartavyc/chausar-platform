import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { check } from '../contracts.ts';
import { validKeychainHelperManifest, type KeychainHelperManifest } from '../engine-keychain-host.ts';

/** Read-only report on the bundled custody helper. It never starts the helper or
 * touches an OS credential store, so it cannot qualify native custody. */
export type KeychainProvider = 'windows-credential-manager' | 'macos-keychain' | 'linux-libsecret';
export type KeychainStatus = {
  provider: KeychainProvider; helper: 'present' | 'absent' | 'invalid'; manifest: KeychainHelperManifest | null;
  sessionBus?: 'ok' | 'missing'; demo: boolean; qualification: 'not-qualified-on-native-store';
};
export type KeychainStatusInput = {
  platform: NodeJS.Platform; arch: string; environment: NodeJS.ProcessEnv; resourcesPath: string; demo: boolean;
};

const providers: Record<'win32' | 'darwin' | 'linux', KeychainProvider> = {
  win32: 'windows-credential-manager', darwin: 'macos-keychain', linux: 'linux-libsecret',
};
const MAX_MANIFEST = 4096;
const MAX_HELPER = 8 * 1024 * 1024;

/** Bounded read of a regular, non-symlinked file. Returns null when absent. */
async function readRegular(path: string, maximum: number): Promise<Buffer | null | 'invalid'> {
  let info;
  try { info = await lstat(path); } catch (error: any) { return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? null : 'invalid'; }
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum) return 'invalid';
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => undefined);
  if (!file) return 'invalid';
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) return 'invalid';
    const bytes = Buffer.alloc(info.size + 1); let length = 0;
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    return length === info.size ? bytes.subarray(0, length) : 'invalid';
  } finally { await file.close(); }
}

/** Parses with the exact validator engine-keychain-host.ts enforces before enrolling custody (one shared rule). */
export function parseKeychainManifest(bytes: Uint8Array, platform: string, architecture: string): KeychainHelperManifest | null {
  let value: any;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  return validKeychainHelperManifest(value, platform, architecture) ? Object.freeze({ format: value.format, platform: value.platform,
    architecture: value.architecture, executable: value.executable, sha256: value.sha256 }) : null;
}

function sessionBus(environment: NodeJS.ProcessEnv): 'ok' | 'missing' {
  const address = environment.DBUS_SESSION_BUS_ADDRESS;
  return typeof address === 'string' && address.length <= 4096 && address.startsWith('unix:') && !/[\x00-\x20\x7f;]/.test(address)
    && /(?:^unix:|,)(?:path=\/|abstract=)/.test(address) ? 'ok' : 'missing';
}

export async function keychainStatus(input: KeychainStatusInput): Promise<KeychainStatus> {
  const { platform, arch, environment, resourcesPath, demo } = input;
  check(platform === 'win32' || platform === 'darwin' || platform === 'linux', 'KEYCHAIN_UNSUPPORTED', 'Native custody is available on Windows, macOS and Linux only.');
  check(typeof resourcesPath === 'string' && resourcesPath.length > 0 && !/[\x00-\x1f\x7f]/.test(resourcesPath), 'KEYCHAIN_STATUS_INVALID', 'The resources folder must be a plain path.');
  const directory = join(resourcesPath, 'runtime-binaries', 'keychain');
  const base = { provider: providers[platform], demo: demo === true, qualification: 'not-qualified-on-native-store' as const,
    ...(platform === 'linux' ? { sessionBus: sessionBus(environment ?? {}) } : {}) };
  const manifestBytes = await readRegular(join(directory, 'manifest.json'), MAX_MANIFEST);
  if (manifestBytes === null) return { ...base, helper: 'absent', manifest: null };
  const manifest = manifestBytes === 'invalid' ? null : parseKeychainManifest(manifestBytes, platform, arch);
  if (!manifest) return { ...base, helper: 'invalid', manifest: null };
  // Hashing reads bytes only; the helper is never loaded or executed here.
  const helper = await readRegular(join(directory, manifest.executable), MAX_HELPER);
  if (helper === null) return { ...base, helper: 'absent', manifest };
  const matches = helper !== 'invalid' && createHash('sha256').update(helper).digest('hex') === manifest.sha256;
  return { ...base, helper: matches ? 'present' : 'invalid', manifest };
}
