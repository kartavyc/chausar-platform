// The operating system keeps a business's computer secret for the owner's login (KEYCHAIN-SPEC 2.2 to 2.7).
// Windows: DPAPI (current user) through Windows PowerShell 5.1. macOS: the login keychain through /usr/bin/security.
// Linux: the Secret Service through /usr/bin/secret-tool. No npm packages; every call is one child process with the
// secret on stdin only. stderr is never read (it can echo input), and this file never logs.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { ChausarError } from './contracts.ts';
import { CUSTODY_WORDS, type DeviceScheme, type DeviceUnavailableReason } from './workspace-custody-contracts.ts';

export type DeviceKeyRecord = {
  format: 'chausar.device-key.v1'; vaultId: string; scheme: DeviceScheme;
  /** The OS's protected blob (DPAPI, standard base64). Only this login on this computer opens it. */
  blob?: string;
  /** A pointer to the OS item (keychain, keyring, memory). Never the secret. */
  item?: { service: string; account: string };
  createdAt: string;
};
export type ProbeResult = { available: true } | { available: false; reason: DeviceUnavailableReason };
export interface DeviceKeyStore {
  readonly scheme: DeviceScheme | null;
  /** One real round trip with the OS. A success is kept for the store's life; a failure is asked again after PROBE_RETRY_MS. Never throws. */
  probe(): Promise<ProbeResult>;
  /** Hands the secret to the OS; returns the record to write (no secret in clear). Throws DEVICE_KEY_FAILED. */
  protect(vaultId: string, secret: Buffer): Promise<DeviceKeyRecord>;
  /** The secret, or null when the OS has no such item. Throws DEVICE_KEY_FAILED when the OS refuses. */
  unprotect(record: DeviceKeyRecord): Promise<Buffer | null>;
  forget(record: DeviceKeyRecord): Promise<void>;
}
export type RunProcess = (file: string, args: readonly string[], input: string, options: { timeoutMs: number; env: Record<string, string> }) =>
  Promise<{ code: number | null; stdout: string; timedOut: boolean }>;   // stderr deliberately absent

export const DEVICE_KEY_FORMAT = 'chausar.device-key.v1';
export const KEY_SERVICE = 'chausar.vault-key';
export const KEY_LABEL = 'Chausar vault key';
const VAULT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_STDOUT = 65_536;

export function deviceKeysUnavailable(reason: DeviceUnavailableReason): ChausarError {
  return Object.assign(new ChausarError('DEVICE_KEYS_UNAVAILABLE', CUSTODY_WORDS.unavailable[reason]), { reason });
}
export function deviceKeyFailed(reason: DeviceUnavailableReason = 'failed'): ChausarError {
  return Object.assign(new ChausarError('DEVICE_KEY_FAILED', CUSTODY_WORDS.errors.DEVICE_KEY_FAILED), { reason });
}
function checkVaultId(vaultId: string) { if (typeof vaultId !== 'string' || !VAULT_ID.test(vaultId)) throw deviceKeyFailed(); }
function checkSecret(secret: Buffer) { if (!Buffer.isBuffer(secret) || secret.length < 16 || secret.length > 256) throw deviceKeyFailed(); }
/** How long a failed probe answers from memory before the next call asks the OS again. */
export const PROBE_RETRY_MS = 15_000;
/** Keeps a successful probe for the life of the store. A failure (a slow cold start, a locked keyring) is kept only
 * for PROBE_RETRY_MS, so a burst of calls doesn't start many processes, and then the next call asks again. */
export function memoProbe(work: () => Promise<ProbeResult>, clock: () => number = Date.now, retryMs = PROBE_RETRY_MS): () => Promise<ProbeResult> {
  let pending: Promise<ProbeResult> | null = null, failedAt: number | null = null;
  return () => {
    if (pending && (failedAt === null || clock() - failedAt < retryMs)) return pending;
    failedAt = null;
    const attempt: Promise<ProbeResult> = work().catch((): ProbeResult => ({ available: false, reason: 'failed' })).then(result => {
      if (!result.available && pending === attempt) failedAt = clock();
      return result;
    });
    pending = attempt;
    return attempt;
  };
}
function record(vaultId: string, scheme: DeviceScheme, fields: { blob?: string; item?: { service: string; account: string } }): DeviceKeyRecord {
  return { format: DEVICE_KEY_FORMAT, vaultId, scheme, ...fields, createdAt: new Date().toISOString() };
}
function checkRecord(value: DeviceKeyRecord, scheme: DeviceScheme) {
  if (!value || value.format !== DEVICE_KEY_FORMAT || value.scheme !== scheme || typeof value.vaultId !== 'string' || !VAULT_ID.test(value.vaultId)) throw deviceKeyFailed();
}
function fromBase64Url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{22,400}$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

/** The real child process runner: no shell, stderr ignored, stdout bounded, a hard timeout. */
export const execFileRun: RunProcess = (file, args, input, options) => new Promise((accept, reject) => {
  let child: ReturnType<typeof spawn>;
  try { child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: options.env, shell: false }); }
  catch (error) { reject(error); return; }
  let stdout = '', settled = false, timedOut = false, overflow = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { if (stdout.length + chunk.length > MAX_STDOUT) { overflow = true; child.kill(); } else stdout += chunk; });
  child.on('error', error => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
  child.on('close', code => {
    if (settled) return; settled = true; clearTimeout(timer);
    accept({ code: timedOut || overflow ? null : code, stdout: overflow ? '' : stdout, timedOut });
  });
  child.stdin!.on('error', () => {});
  child.stdin!.end(input);
});

// ---------------------------------------------------------------- Windows: DPAPI through Windows PowerShell 5.1

export const DPAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { [Console]::Out.Write('MODE:' + $ExecutionContext.SessionState.LanguageMode); exit 3 }",
  'Add-Type -AssemblyName System.Security',
  // Three stdin lines (op, entropy, base64 data), read with .NET calls only. No cmdlet and no pipeline touches them:
  // PowerShell module logging writes each cmdlet's parameter values to the event log (event 4103).
  '$op = [Console]::In.ReadLine()',
  '$entropy = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadLine())',
  '$data = [Convert]::FromBase64String([Console]::In.ReadLine())',
  '$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
  'switch ($op) {',
  "  'protect' { $blob = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope); $back = [Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, $scope); if ([Convert]::ToBase64String($back) -ne [Convert]::ToBase64String($data)) { exit 4 }; [Console]::Out.Write('OK:' + [Convert]::ToBase64String($blob)) }",
  "  'unprotect' { [Console]::Out.Write('OK:' + [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope))) }",
  '  default { exit 5 }',
  '}',
].join('\n');
export const DPAPI_ARGS = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT]);
export const dpapiEntropy = (vaultId: string) => `chausar.device-key.v1:${vaultId}`;
const WINDOWS_TIMEOUT = 20_000;

export function windowsDeviceKeyStore(run: RunProcess = execFileRun, environment: NodeJS.ProcessEnv = process.env, fileExists: (path: string) => boolean = existsSync): DeviceKeyStore {
  const executable = (): { path: string; env: Record<string, string> } | null => {
    const root = environment.SystemRoot;
    if (typeof root !== 'string' || !root || !isAbsolute(root)) return null;
    const path = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return fileExists(path) ? { path, env: { SystemRoot: root } } : null;
  };
  async function call(op: 'protect' | 'unprotect', entropy: string, data: Buffer): Promise<{ ok: true; data: Buffer } | { ok: false; reason: DeviceUnavailableReason }> {
    const shell = executable(); if (!shell) return { ok: false, reason: 'platform' };
    const input = `${op}\n${entropy}\n${data.toString('base64')}\n`;
    let result: Awaited<ReturnType<RunProcess>>;
    try { result = await run(shell.path, DPAPI_ARGS, input, { timeoutMs: WINDOWS_TIMEOUT, env: shell.env }); }
    catch { return { ok: false, reason: 'failed' }; }
    if (result.timedOut || result.code === null) return { ok: false, reason: 'failed' };
    if (result.code === 3) return { ok: false, reason: 'blocked' };
    if (result.code !== 0) return { ok: false, reason: 'failed' };
    const match = /^OK:([A-Za-z0-9+/]*={0,2})$/.exec(result.stdout.trim());
    if (!match) return { ok: false, reason: 'failed' };
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64') !== match[1] || !bytes.length) return { ok: false, reason: 'failed' };
    return { ok: true, data: bytes };
  }
  return {
    scheme: 'windows-dpapi',
    probe: memoProbe(async () => {
      const sample = randomBytes(32);
      try { const answer = await call('protect', dpapiEntropy('probe'), sample); return answer.ok ? { available: true } : { available: false, reason: answer.reason }; }
      finally { sample.fill(0); }
    }),
    async protect(vaultId, secret) {
      checkVaultId(vaultId); checkSecret(secret);
      const answer = await call('protect', dpapiEntropy(vaultId), secret);
      if (!answer.ok) throw deviceKeyFailed(answer.reason);
      return record(vaultId, 'windows-dpapi', { blob: answer.data.toString('base64') });
    },
    async unprotect(value) {
      checkRecord(value, 'windows-dpapi');
      if (typeof value.blob !== 'string' || !/^[A-Za-z0-9+/]{4,4000}={0,2}$/.test(value.blob)) throw deviceKeyFailed();
      const answer = await call('unprotect', dpapiEntropy(value.vaultId), Buffer.from(value.blob, 'base64'));
      if (!answer.ok) throw deviceKeyFailed(answer.reason);
      return answer.data;
    },
    async forget() { /* The blob lives only in the record file; removing the file forgets it. */ },
  };
}

// ---------------------------------------------------------------- macOS: the login keychain through /usr/bin/security

export const SECURITY = '/usr/bin/security';
const MAC_TIMEOUT = 20_000;
/** `security` exits with the low byte of the OSStatus: errSecItemNotFound (-25300) is 44,
 * errSecInteractionNotAllowed (-25308, a locked keychain or an SSH session) is 36. */
export const MAC_EXIT = Object.freeze({ notFound: 44, interactionNotAllowed: 36 });

export function macDeviceKeyStore(run: RunProcess = execFileRun, environment: NodeJS.ProcessEnv = process.env, fileExists: (path: string) => boolean = existsSync): DeviceKeyStore {
  const env = (): Record<string, string> => (typeof environment.HOME === 'string' && environment.HOME ? { HOME: environment.HOME } : {});
  const reasonFor = (result: { code: number | null; timedOut: boolean }): DeviceUnavailableReason => result.code === MAC_EXIT.interactionNotAllowed ? 'locked' : 'failed';
  async function exec(args: readonly string[], input = '') {
    if (!fileExists(SECURITY)) return { code: null, stdout: '', timedOut: false, missing: true };
    try { return { ...(await run(SECURITY, args, input, { timeoutMs: MAC_TIMEOUT, env: env() })), missing: false }; }
    catch { return { code: null, stdout: '', timedOut: false, missing: false }; }
  }
  async function store(account: string, text: string): Promise<DeviceUnavailableReason | null> {
    // The secret is base64url (no spaces or quotes) and goes on stdin, never into the process list.
    const added = await exec(['-i'], `add-generic-password -U -s ${KEY_SERVICE} -a ${account} -l "${KEY_LABEL}" -w ${text}\n`);
    if (added.missing) return 'platform';
    if (added.code !== 0) return reasonFor(added);
    const read = await lookup(account);
    if (read.kind !== 'found') return read.kind === 'error' ? read.reason : 'failed';
    const same = read.text === text; return same ? null : 'failed';
  }
  async function lookup(account: string): Promise<{ kind: 'found'; text: string } | { kind: 'absent' } | { kind: 'error'; reason: DeviceUnavailableReason }> {
    const result = await exec(['find-generic-password', '-s', KEY_SERVICE, '-a', account, '-w']);
    if (result.missing) return { kind: 'error', reason: 'platform' };
    if (result.code === MAC_EXIT.notFound) return { kind: 'absent' };
    if (result.code !== 0) return { kind: 'error', reason: reasonFor(result) };
    return { kind: 'found', text: result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout };
  }
  async function remove(account: string): Promise<DeviceUnavailableReason | null> {
    const result = await exec(['delete-generic-password', '-s', KEY_SERVICE, '-a', account]);
    if (result.missing) return 'platform';
    return result.code === 0 || result.code === MAC_EXIT.notFound ? null : reasonFor(result);
  }
  return {
    scheme: 'macos-keychain',
    probe: memoProbe(async () => {
      const account = `probe-${randomBytes(8).toString('hex')}`;
      const stored = await store(account, randomBytes(32).toString('base64url'));
      if (stored) { await remove(account); return { available: false, reason: stored }; }
      const removed = await remove(account);
      return removed ? { available: false, reason: removed } : { available: true };
    }),
    async protect(vaultId, secret) {
      checkVaultId(vaultId); checkSecret(secret);
      const failed = await store(vaultId, secret.toString('base64url'));
      if (failed) throw deviceKeyFailed(failed);
      return record(vaultId, 'macos-keychain', { item: { service: KEY_SERVICE, account: vaultId } });
    },
    async unprotect(value) {
      checkRecord(value, 'macos-keychain');
      if (value.item?.service !== KEY_SERVICE || value.item.account !== value.vaultId) throw deviceKeyFailed();
      const read = await lookup(value.vaultId);
      if (read.kind === 'absent') return null;
      if (read.kind === 'error') throw deviceKeyFailed(read.reason);
      const bytes = fromBase64Url(read.text); if (!bytes) throw deviceKeyFailed();
      return bytes;
    },
    async forget(value) {
      checkRecord(value, 'macos-keychain');
      const failed = await remove(value.vaultId); if (failed) throw deviceKeyFailed(failed);
    },
  };
}

// ---------------------------------------------------------------- Linux: the Secret Service through /usr/bin/secret-tool

export const SECRET_TOOL = '/usr/bin/secret-tool';
const LINUX_TIMEOUT = 30_000;
export const LINUX_ENV_NAMES = Object.freeze(['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'HOME']);

export function linuxDeviceKeyStore(run: RunProcess = execFileRun, environment: NodeJS.ProcessEnv = process.env, fileExists: (path: string) => boolean = existsSync): DeviceKeyStore {
  const env = (): Record<string, string> => Object.fromEntries(LINUX_ENV_NAMES.flatMap(name => typeof environment[name] === 'string' && environment[name] ? [[name, environment[name] as string]] : []));
  const session = () => !!(environment.DBUS_SESSION_BUS_ADDRESS || environment.XDG_RUNTIME_DIR);
  async function exec(args: readonly string[], input = ''): Promise<{ code: number | null; stdout: string; timedOut: boolean } | { reason: DeviceUnavailableReason }> {
    if (!session()) return { reason: 'no-keyring' };
    if (!fileExists(SECRET_TOOL)) return { reason: 'no-keyring' };
    try {
      const result = await run(SECRET_TOOL, args, input, { timeoutMs: LINUX_TIMEOUT, env: env() });
      // A locked keyring may show its own unlock prompt; no answer in time means it stayed locked.
      return result.timedOut ? { reason: 'locked' } : result;
    } catch (error: any) { return { reason: error?.code === 'ENOENT' ? 'no-keyring' : 'failed' }; }
  }
  const attributes = (account: string) => ['service', KEY_SERVICE, 'account', account];
  async function lookup(account: string): Promise<{ kind: 'found'; text: string } | { kind: 'absent' } | { kind: 'error'; reason: DeviceUnavailableReason }> {
    const result = await exec(['lookup', ...attributes(account)]);
    if ('reason' in result) return { kind: 'error', reason: result.reason };
    if (result.code === 1 && result.stdout === '') return { kind: 'absent' };
    if (result.code !== 0 || !result.stdout) return { kind: 'error', reason: 'failed' };
    return { kind: 'found', text: result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout };
  }
  async function store(account: string, text: string): Promise<DeviceUnavailableReason | null> {
    const stored = await exec(['store', '--label', KEY_LABEL, ...attributes(account)], text);
    if ('reason' in stored) return stored.reason;
    if (stored.code !== 0) return 'failed';
    const read = await lookup(account);
    if (read.kind !== 'found') return read.kind === 'error' ? read.reason : 'failed';
    return read.text === text ? null : 'failed';
  }
  async function remove(account: string): Promise<DeviceUnavailableReason | null> {
    const result = await exec(['clear', ...attributes(account)]);
    if ('reason' in result) return result.reason;
    return result.code === 0 ? null : 'failed';
  }
  return {
    scheme: 'linux-secret-service',
    probe: memoProbe(async () => {
      const account = `probe-${randomBytes(8).toString('hex')}`;
      const stored = await store(account, randomBytes(32).toString('base64url'));
      if (stored) { if (stored !== 'no-keyring') await remove(account); return { available: false, reason: stored }; }
      const removed = await remove(account);
      return removed ? { available: false, reason: removed } : { available: true };
    }),
    async protect(vaultId, secret) {
      checkVaultId(vaultId); checkSecret(secret);
      const failed = await store(vaultId, secret.toString('base64url'));
      if (failed) throw deviceKeyFailed(failed);
      return record(vaultId, 'linux-secret-service', { item: { service: KEY_SERVICE, account: vaultId } });
    },
    async unprotect(value) {
      checkRecord(value, 'linux-secret-service');
      if (value.item?.service !== KEY_SERVICE || value.item.account !== value.vaultId) throw deviceKeyFailed();
      const read = await lookup(value.vaultId);
      if (read.kind === 'absent') return null;
      if (read.kind === 'error') throw deviceKeyFailed(read.reason);
      const bytes = fromBase64Url(read.text); if (!bytes) throw deviceKeyFailed();
      return bytes;
    },
    async forget(value) {
      checkRecord(value, 'linux-secret-service');
      const failed = await remove(value.vaultId); if (failed) throw deviceKeyFailed(failed);
    },
  };
}

// ---------------------------------------------------------------- choosing, tests, and no storage

/** The store for this computer: 'win32', 'darwin' or 'linux'; anything else asks for a passphrase. */
export function osDeviceKeyStore(platform: NodeJS.Platform = process.platform, run: RunProcess = execFileRun, environment: NodeJS.ProcessEnv = process.env, fileExists: (path: string) => boolean = existsSync): DeviceKeyStore {
  if (platform === 'win32') return windowsDeviceKeyStore(run, environment, fileExists);
  if (platform === 'darwin') return macDeviceKeyStore(run, environment, fileExists);
  if (platform === 'linux') return linuxDeviceKeyStore(run, environment, fileExists);
  return noDeviceKeyStore('platform');
}

/** Tests only: two instances behave as two computers. */
export function memoryDeviceKeyStore(): DeviceKeyStore & { items(): number } {
  const items = new Map<string, Buffer>();
  return {
    scheme: 'memory',
    items: () => items.size,
    probe: memoProbe(async () => ({ available: true })),
    async protect(vaultId, secret) {
      checkVaultId(vaultId); checkSecret(secret);
      const account = `${vaultId}.${randomBytes(6).toString('hex')}`;
      items.set(account, Buffer.from(secret));
      return record(vaultId, 'memory', { item: { service: KEY_SERVICE, account } });
    },
    async unprotect(value) {
      checkRecord(value, 'memory');
      const found = value.item?.account ? items.get(value.item.account) : undefined;
      return found ? Buffer.from(found) : null;
    },
    async forget(value) {
      checkRecord(value, 'memory');
      const account = value.item?.account; if (!account) return;
      items.get(account)?.fill(0); items.delete(account);
    },
  };
}

export function noDeviceKeyStore(reason: DeviceUnavailableReason): DeviceKeyStore {
  return {
    scheme: null,
    probe: async () => ({ available: false, reason }),
    async protect() { throw deviceKeysUnavailable(reason); },
    async unprotect() { throw deviceKeysUnavailable(reason); },
    async forget() {},
  };
}
