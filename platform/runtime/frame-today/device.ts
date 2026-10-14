/**
 * This computer, before any workspace is open (FR-01, FR-03, SH-02, SH-06): the disk check,
 * the language and view saved for this device, and the workspace folders that exist.
 *
 * Nothing here opens or decrypts a workspace. The disk check runs read-only system tools with
 * a fixed argument list, no shell and a timeout, behind an injectable probe; anything that
 * fails, times out or prints what we do not recognise is `unknown`. The device file holds two
 * words (a language and a view) and is never workspace data.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve, sep, win32 } from 'node:path';
import { check } from '../contracts.ts';
import { safeDirectory } from '../vault.ts';

/* ------------------------------------------------------------------ disk check */

export type DiskEncryption = 'encrypted' | 'not-encrypted' | 'unknown';
export type DevicePlatform = 'windows' | 'macos' | 'linux' | 'other';
export type Keyring = 'safe' | 'none' | 'unknown';
export interface DiskCheck { readonly disk: DiskEncryption; readonly platform: DevicePlatform; readonly keyring: Keyring }

/** Runs one read-only system tool with fixed arguments; rejects when it cannot run. */
export type DiskProbe = (command: string, args: readonly string[], timeoutMs: number) => Promise<{ readonly code: number | null; readonly stdout: string }>;
export const PROBE_TIMEOUT_MS = 4000;

/** The real probe: no shell, a bounded output, a small fixed environment, and a timeout. */
export const systemProbe: DiskProbe = (command, args, timeoutMs) => new Promise((done, fail) => {
  const env: Record<string, string> = process.platform === 'win32'
    ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }
    : { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' };
  execFile(command, [...args], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 256 * 1024, encoding: 'utf8', env }, (error, stdout) => {
    if (error && typeof (error as { code?: unknown }).code !== 'number') { fail(error); return; }
    done({ code: error ? (error as { code: number }).code : 0, stdout: String(stdout) });
  });
});

const platformOf = (platform: string): DevicePlatform => platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : 'other';

async function run(probe: DiskProbe, command: string, args: readonly string[], timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>(done => { timer = setTimeout(() => done(null), timeoutMs); });
    const result = await Promise.race([probe(command, args, timeoutMs), timeout]);
    if (result === null || result.code !== 0 || typeof result.stdout !== 'string') return null;
    return result.stdout.slice(0, 256 * 1024);
  } catch { return null; } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** `Get-BitLockerVolume` prints the enum name (`On`/`Off`), which is not translated. */
export function bitLockerFromPowerShell(stdout: string): DiskEncryption {
  const value = stdout.trim();
  return value === 'On' ? 'encrypted' : value === 'Off' ? 'not-encrypted' : 'unknown';
}
/** `manage-bde -status X:` in English; any other wording is `unknown`. */
export function bitLockerFromManageBde(stdout: string): DiskEncryption {
  const status = /^\s*Protection Status:\s*(.+?)\s*$/m.exec(stdout)?.[1];
  return status === undefined ? 'unknown' : /^Protection On\b/.test(status) ? 'encrypted' : /^Protection Off\b/.test(status) ? 'not-encrypted' : 'unknown';
}
/** `fdesetup status`: "FileVault is On." or "FileVault is Off." */
export function fileVault(stdout: string): DiskEncryption {
  return /^FileVault is On\./m.test(stdout) ? 'encrypted' : /^FileVault is Off\./m.test(stdout) ? 'not-encrypted' : 'unknown';
}

type BlockNode = { type?: unknown; mountpoint?: unknown; children?: unknown };
/**
 * `lsblk -J -s -o TYPE,MOUNTPOINT`: an inverted tree, each mounted device first with the devices
 * it sits on as its children. The data directory's disk is encrypted when the longest mount
 * point holding it is, or sits on, a `crypt` device (LUKS).
 */
export function luksFromLsblk(stdout: string, directory: string): DiskEncryption {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { return 'unknown'; }
  const devices = (parsed as { blockdevices?: unknown })?.blockdevices;
  if (!Array.isArray(devices)) return 'unknown';
  const crypt = (node: BlockNode, depth: number): boolean => depth < 16 && (node.type === 'crypt'
    || (Array.isArray(node.children) && node.children.some(child => child !== null && typeof child === 'object' && crypt(child as BlockNode, depth + 1))));
  const target = resolve(directory);
  let best: { length: number; encrypted: boolean } | null = null;
  for (const device of devices as BlockNode[]) {
    if (device === null || typeof device !== 'object' || typeof device.mountpoint !== 'string' || !device.mountpoint.startsWith('/')) continue;
    const mount = device.mountpoint;
    const holds = mount === '/' || target === mount || target.startsWith(mount.endsWith(sep) ? mount : mount + sep);
    if (holds && (best === null || mount.length > best.length)) best = { length: mount.length, encrypted: crypt(device, 0) };
  }
  return best === null ? 'unknown' : best.encrypted ? 'encrypted' : 'not-encrypted';
}

export interface DiskCheckInput {
  readonly directory: string;
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly probe: DiskProbe;
  readonly timeoutMs?: number;
}

export async function diskCheck(input: DiskCheckInput): Promise<DiskCheck> {
  const platform = platformOf(input.platform), timeout = input.timeoutMs ?? PROBE_TIMEOUT_MS;
  if (platform === 'windows') {
    const drive = win32.parse(win32.resolve(input.directory)).root.slice(0, 2).toUpperCase();
    if (!/^[A-Z]:$/.test(drive)) return { disk: 'unknown', platform, keyring: 'safe' };
    const system = input.env.SystemRoot ?? 'C:\\Windows';
    const powershell = await run(input.probe, `${system}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-BitLockerVolume -MountPoint '${drive}').ProtectionStatus`], timeout);
    let disk = powershell === null ? 'unknown' as DiskEncryption : bitLockerFromPowerShell(powershell);
    if (disk === 'unknown') {
      const manage = await run(input.probe, `${system}\\System32\\manage-bde.exe`, ['-status', drive], timeout);
      disk = manage === null ? 'unknown' : bitLockerFromManageBde(manage);
    }
    // Windows keeps keys in the Credential Manager, protected by the person's sign-in.
    return { disk, platform, keyring: 'safe' };
  }
  if (platform === 'macos') {
    const out = await run(input.probe, '/usr/bin/fdesetup', ['status'], timeout);
    // macOS keeps keys in the login Keychain.
    return { disk: out === null ? 'unknown' : fileVault(out), platform, keyring: 'safe' };
  }
  if (platform === 'linux') {
    const out = await run(input.probe, 'lsblk', ['-J', '-s', '-o', 'TYPE,MOUNTPOINT'], timeout);
    // A safe keyring is a Secret Service on the session bus. With no session bus there is none;
    // with one, whether a keyring answers is not checked here.
    const keyring: Keyring = input.env.DBUS_SESSION_BUS_ADDRESS ? 'unknown' : 'none';
    return { disk: out === null ? 'unknown' : luksFromLsblk(out, input.directory), platform, keyring };
  }
  return { disk: 'unknown', platform, keyring: 'unknown' };
}

/* ------------------------------------------------------------------ language and view */

export type DeviceLanguage = 'en' | 'hi';
export type DeviceView = 'simple' | 'guided' | 'books';
export interface DeviceChoices { readonly language: DeviceLanguage | null; readonly view: DeviceView | null; readonly saved: boolean }
export const DEVICE_FILE = 'frame-today-device.json';
const DEVICE_FORMAT = 'chausar.frame-today.device.v1';
const LANGUAGES: readonly string[] = ['en', 'hi'];
const VIEWS: readonly string[] = ['simple', 'guided', 'books'];
const NOT_SAVED: DeviceChoices = Object.freeze({ language: null, view: null, saved: false });

export function deviceInput(payload: Record<string, unknown>): { language: DeviceLanguage; view: DeviceView } {
  check(Object.keys(payload).length === 2 && LANGUAGES.includes(payload.language as string) && VIEWS.includes(payload.view as string),
    'INVALID_TODAYX_REQUEST', 'Give the language (en or hi) and the view (simple, guided or books).');
  return { language: payload.language as DeviceLanguage, view: payload.view as DeviceView };
}

/** The saved choices. A missing, oversized, linked or malformed file reads as not saved. */
export async function readDevice(directory: string): Promise<DeviceChoices> {
  const path = join(directory, DEVICE_FILE);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024) return NOT_SAVED;
    const handle = await open(path, 'r');
    let text: string;
    try { text = await handle.readFile('utf8'); } finally { await handle.close(); }
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'format,language,view'
      || value.format !== DEVICE_FORMAT || !LANGUAGES.includes(value.language) || !VIEWS.includes(value.view)) return NOT_SAVED;
    return Object.freeze({ language: value.language, view: value.view, saved: true });
  } catch { return NOT_SAVED; }
}

/** Write the two words atomically: a private temporary file, flushed, then renamed over the old one. */
export async function writeDevice(directory: string, choices: { language: DeviceLanguage; view: DeviceView }): Promise<DeviceChoices> {
  const root = await safeDirectory(directory, true);
  const target = join(root, DEVICE_FILE), temp = join(root, `.${DEVICE_FILE}.${randomUUID()}.tmp`);
  const existing = await lstat(target).catch(() => null);
  check(existing === null || existing.isFile(), 'INVALID_PATH', 'The device settings file is not a plain file.');
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ format: DEVICE_FORMAT, language: choices.language, view: choices.view }), 'utf8');
    await handle.sync();
  } catch (error) { await handle.close(); await unlink(temp).catch(() => {}); throw error; }
  await handle.close();
  try { await rename(temp, target); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  return Object.freeze({ ...choices, saved: true });
}

/* ------------------------------------------------------------------ workspace folders */

/** Same rule as the engine's own `workspacePath`. */
const FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
/** Folders the engine itself keeps beside the workspaces. */
const RESERVED = new Set(['backups', 'exports', 'updates']);
/** What a workspace folder holds: its encrypted snapshot (file storage), its writer lock, its encrypted artifacts. */
const VAULT_ENTRY = (name: string) => name === 'authority.encrypted.json' || name === 'writer.lock' || name === 'private-artifacts' || name.startsWith('.');
export interface WorkspaceFolder { readonly folder: string; readonly main: boolean }

/**
 * The workspace folders under the engine's directory, by name only. A folder counts when it is a
 * plain directory whose entries are only those a workspace keeps (with PostgreSQL storage the
 * snapshot is in the database and the folder may be empty). Nothing is opened or decrypted.
 */
export async function workspaceFolders(directory: string): Promise<readonly WorkspaceFolder[]> {
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const found: WorkspaceFolder[] = [];
  for (const name of names.sort()) {
    if (!FOLDER.test(name) || RESERVED.has(name) || found.length >= 50) continue;
    const path = join(directory, name);
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory()) continue;
      const entries = await readdir(path);
      if (entries.every(VAULT_ENTRY)) found.push(Object.freeze({ folder: name, main: name === 'main' }));
    } catch { continue; }
  }
  return Object.freeze(found.sort((a, b) => Number(b.main) - Number(a.main) || (a.folder < b.folder ? -1 : 1)));
}
