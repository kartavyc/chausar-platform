import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ChausarError } from './contracts.ts';
import type { VaultKeychainProvider } from './vault.ts';

type NativePlatform = 'win32' | 'darwin' | 'linux';
type NativeArchitecture = 'x64' | 'arm64';
export type PlatformKeychainVerification = {
  executable: string; sha256: string; platform: NativePlatform; architecture: NativeArchitecture;
};
export type PlatformKeychainVerify = (input: Readonly<PlatformKeychainVerification>) => Promise<void>;
export type PlatformKeychainSpawnOptions = {
  shell: false; windowsHide: true; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'];
};
export type PlatformKeychainSpawn = (executable: string, args: string[], options: PlatformKeychainSpawnOptions) => ChildProcessWithoutNullStreams;
export type PlatformKeychainOptions = {
  platform: NodeJS.Platform; architecture?: string; executable: string; sha256: string;
  /** Response bytes, never more than the protocol's 39-byte maximum. */
  maximumBytes?: number; timeoutMs?: number;
  /** Trusted constructor seams for synthetic tests; never RPC/archive input. */
  spawnProcess?: PlatformKeychainSpawn; verifyExecutable?: PlatformKeychainVerify;
};

const backends = { win32: 1, darwin: 2, linux: 3 } as const;
const MAX_EXECUTABLE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 39;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type FailureCode = 'KEYCHAIN_UNAVAILABLE' | 'KEYCHAIN_DENIED' | 'KEYCHAIN_CONFLICT' | 'KEYCHAIN_PROTOCOL_INVALID';
function failure(code: FailureCode): ChausarError {
  const messages = {
    KEYCHAIN_UNAVAILABLE: 'The native workspace keychain is unavailable.',
    KEYCHAIN_DENIED: 'The native workspace keychain denied this operation.',
    KEYCHAIN_CONFLICT: 'The native workspace keychain entry conflicts with this operation.',
    KEYCHAIN_PROTOCOL_INVALID: 'The native workspace keychain protocol is invalid.',
  };
  return new ChausarError(code, messages[code]);
}

function nativeHeader(bytes: Buffer, platform: NativePlatform, architecture: NativeArchitecture): boolean {
  if (platform === 'linux') return bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    && bytes[4] === 2 && bytes[5] === 1 && bytes[6] === 1 && [2, 3].includes(bytes.readUInt16LE(16))
    && bytes.readUInt16LE(18) === (architecture === 'x64' ? 62 : 183) && bytes.readUInt32LE(20) === 1;
  if (platform === 'darwin') return bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf
    && bytes.readUInt32LE(4) === (architecture === 'x64' ? 0x01000007 : 0x0100000c) && bytes.readUInt32LE(12) === 2;
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) return false;
  const pe = bytes.readUInt32LE(60);
  return pe >= 64 && pe <= bytes.length - 26 && bytes.readUInt32LE(pe) === 0x00004550
    && bytes.readUInt16LE(pe + 4) === (architecture === 'x64' ? 0x8664 : 0xaa64)
    && (bytes.readUInt16LE(pe + 22) & 0x2002) === 2 && bytes.readUInt16LE(pe + 24) === 0x20b;
}

/** Pin verification inspects source bytes only; it never loads or executes them.
 * Deployment must protect packaged helper locations against concurrent replacement.
 * Hashing followed by pathname spawn is not an atomic execution-identity guarantee;
 * Windows ACL and signed package location qualification remain host responsibilities. */
async function verifyNativeExecutable(input: Readonly<PlatformKeychainVerification>): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  const bytes = Buffer.alloc(MAX_EXECUTABLE_BYTES + 1);
  try {
    if (input.platform !== process.platform || input.architecture !== process.arch) throw failure('KEYCHAIN_UNAVAILABLE');
    const ancestors: string[] = [];
    for (let path = input.executable; ; path = dirname(path)) {
      ancestors.push(path); if (dirname(path) === path) break;
    }
    // Filesystem roots can expose a mapped uid inside a sandbox; use the root's
    // actual owner as the administrative anchor rather than assuming uid zero.
    const rootUid = (await lstat(ancestors.at(-1)!)).uid, uid = process.getuid?.();
    for (const path of ancestors.slice(1)) {
      const directory = await lstat(path);
      if (directory.isSymbolicLink() || !directory.isDirectory()
        || input.platform !== 'win32' && (directory.uid !== rootUid && directory.uid !== uid
          || directory.mode & 0o022 && !(directory.uid === rootUid && directory.mode & 0o1000))) throw failure('KEYCHAIN_UNAVAILABLE');
    }
    const before = await lstat(input.executable);
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > MAX_EXECUTABLE_BYTES
      || input.platform !== 'win32' && (!(before.mode & 0o111) || Boolean(before.mode & 0o022)
        || before.uid !== rootUid && before.uid !== uid)) throw failure('KEYCHAIN_UNAVAILABLE');
    file = await open(input.executable, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw failure('KEYCHAIN_UNAVAILABLE');
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break; length += read.bytesRead;
    }
    const after = await file.stat(), current = await lstat(input.executable);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
      || current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs
      || createHash('sha256').update(bytes.subarray(0, length)).digest('hex') !== input.sha256
      || !nativeHeader(bytes.subarray(0, length), input.platform, input.architecture)) throw failure('KEYCHAIN_UNAVAILABLE');
  } catch { throw failure('KEYCHAIN_UNAVAILABLE'); }
  finally { bytes.fill(0); await file?.close().catch(() => {}); }
}

function localSessionBus(address: string): boolean {
  if (address.length > 4096 || !address.startsWith('unix:') || /[\x00-\x20\x7f;]/.test(address)) return false;
  const fields = address.slice(5).split(','), keys = new Set<string>();
  for (const field of fields) {
    const match = /^(path|abstract|guid)=([A-Za-z0-9_/.%+-]+)$/.exec(field);
    if (!match || keys.has(match[1]) || /%(?![a-fA-F0-9]{2})/.test(match[2])) return false;
    if (match[1] === 'guid' && !/^[a-fA-F0-9]{32}$/.test(match[2])) return false;
    if (match[1] === 'path' && !match[2].startsWith('/')) return false;
    keys.add(match[1]);
  }
  return Number(keys.has('path')) + Number(keys.has('abstract')) === 1;
}
function environment(platform: NativePlatform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (platform === 'win32') {
    for (const name of ['SystemRoot', 'WINDIR']) {
      const value = process.env[name];
      if (value && !/[\x00-\x1f\x7f]/.test(value)) env[name] = value;
    }
  } else if (platform === 'linux') {
    for (const name of ['HOME', 'XDG_RUNTIME_DIR']) {
      const value = process.env[name];
      if (!value || !value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value)) throw failure('KEYCHAIN_UNAVAILABLE');
      env[name] = value;
    }
    const address = process.env.DBUS_SESSION_BUS_ADDRESS;
    if (!address || !localSessionBus(address)) throw failure('KEYCHAIN_UNAVAILABLE');
    env.DBUS_SESSION_BUS_ADDRESS = address;
  }
  return env;
}

/** Direct native entries only. A missing/locked provider never falls back to file storage. */
export class PlatformKeychain implements VaultKeychainProvider {
  #pin: Readonly<PlatformKeychainVerification>;
  #spawn: PlatformKeychainSpawn;
  #verify: PlatformKeychainVerify;
  #maximumBytes: number;
  #timeoutMs: number;
  #quarantined = false;
  private constructor(options: PlatformKeychainOptions, pin: PlatformKeychainVerification) {
    this.#pin = Object.freeze(pin); this.#spawn = options.spawnProcess ?? spawn;
    this.#verify = options.verifyExecutable ?? verifyNativeExecutable;
    this.#maximumBytes = options.maximumBytes ?? MAX_RESPONSE_BYTES; this.#timeoutMs = options.timeoutMs ?? 10_000;
  }
  static async create(options: PlatformKeychainOptions): Promise<PlatformKeychain> {
    const architecture = options.architecture ?? process.arch;
    if (!Object.hasOwn(backends, options.platform) || !['x64', 'arm64'].includes(architecture)) throw failure('KEYCHAIN_UNAVAILABLE');
    if (typeof options.executable !== 'string' || !isAbsolute(options.executable) || resolve(options.executable) !== options.executable
      || /[\x00-\x1f\x7f]/.test(options.executable) || typeof options.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(options.sha256)
      || options.maximumBytes !== undefined && (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 7 || options.maximumBytes > MAX_RESPONSE_BYTES)
      || options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)
      || options.spawnProcess !== undefined && typeof options.spawnProcess !== 'function'
      || options.verifyExecutable !== undefined && typeof options.verifyExecutable !== 'function') throw failure('KEYCHAIN_PROTOCOL_INVALID');
    const provider = new PlatformKeychain(options, { executable: options.executable, sha256: options.sha256,
      platform: options.platform as NativePlatform, architecture: architecture as NativeArchitecture });
    await provider.#checkPin(); return provider;
  }
  async #checkPin(): Promise<void> {
    try { await this.#verify(this.#pin); } catch { throw failure('KEYCHAIN_UNAVAILABLE'); }
  }
  #assertAvailable(): void {
    if (this.#quarantined) throw failure('KEYCHAIN_UNAVAILABLE');
  }
  async store(vaultId: string, key: Uint8Array): Promise<void> { await this.#operation(1, vaultId, key); }
  async retrieve(vaultId: string): Promise<Uint8Array | null> { return this.#operation(2, vaultId); }
  async remove(vaultId: string): Promise<void> { await this.#operation(3, vaultId); }
  async #operation(operation: 1 | 2 | 3, vaultId: string, key?: Uint8Array): Promise<Uint8Array | null> {
    this.#assertAvailable();
    if (typeof vaultId !== 'string' || !uuid.test(vaultId) || operation === 1 && (!(key instanceof Uint8Array) || key.byteLength !== 32))
      throw failure('KEYCHAIN_PROTOCOL_INVALID');
    // Own the request bytes before the asynchronous pin check. Caller keys are never modified.
    const request = Buffer.alloc(operation === 1 ? 73 : 41);
    request.write('CKP1', 0, 'ascii'); request[4] = operation; request.write(vaultId, 5, 'ascii');
    if (key) request.set(key, 41);
    try {
      await this.#checkPin();
      const env = environment(this.#pin.platform);
      return await this.#exchange(operation, request, env);
    } finally { request.fill(0); }
  }
  #exchange(operation: 1 | 2 | 3, request: Buffer, env: NodeJS.ProcessEnv): Promise<Uint8Array | null> {
    return new Promise((accept, reject) => {
      const response = Buffer.alloc(this.#maximumBytes);
      let child: ChildProcessWithoutNullStreams;
      try {
        // A queued pin verification may have outlived another helper's failed
        // termination. Never launch work after that instance loses its barrier.
        this.#assertAvailable();
        child = this.#spawn(this.#pin.executable, [], { shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
      }
      catch { response.fill(0); reject(failure('KEYCHAIN_UNAVAILABLE')); return; }
      let length = 0, done = false, failed: FailureCode | undefined, deadline: ReturnType<typeof setTimeout>, termination: ReturnType<typeof setTimeout> | undefined;
      const settle = (code: number | null, signal: NodeJS.Signals | null) => {
        if (done) return; done = true; clearTimeout(deadline); clearTimeout(termination); request.fill(0);
        try {
          if (failed) throw failure(failed);
          if (code !== 0 || signal) throw failure('KEYCHAIN_UNAVAILABLE');
          if (length < 7 || !response.subarray(0, 4).equals(Buffer.from('CKR1', 'ascii')) || response[5] !== backends[this.#pin.platform]
            || response[4] > 5 || response[6] !== (operation === 2 && response[4] === 0 ? 32 : 0)
            || length !== 7 + response[6]) throw failure('KEYCHAIN_PROTOCOL_INVALID');
          const status = response[4];
          if (status === 1) { if (operation === 1) throw failure('KEYCHAIN_PROTOCOL_INVALID'); accept(null); }
          else if (status !== 0) throw failure(({ 2: 'KEYCHAIN_UNAVAILABLE', 3: 'KEYCHAIN_DENIED', 4: 'KEYCHAIN_CONFLICT', 5: 'KEYCHAIN_PROTOCOL_INVALID' } as const)[status as 2 | 3 | 4 | 5]);
          else accept(operation === 2 ? Uint8Array.from(response.subarray(7, 39)) : null);
        } catch (error) { reject(error); }
        finally { response.fill(0); }
      };
      const stop = (reason: FailureCode) => {
        if (done || failed) return; failed = reason; request.fill(0); response.fill(0);
        // Discard queued pipe bytes and use a fixed signal. Never interpolate helper errors.
        try { child.stdin.destroy(); } catch {}
        termination = setTimeout(() => {
          // A bounded failure may return before close only by permanently
          // quarantining this instance: old native work could still be active.
          this.#quarantined = true;
          settle(null, null); child.stdout.destroy(); child.stderr.destroy();
        }, 500);
        try { child.kill('SIGKILL'); } catch {}
      };
      const stdout = (chunk: unknown) => {
        if (!(chunk instanceof Uint8Array)) { stop('KEYCHAIN_PROTOCOL_INVALID'); return; }
        try {
          if (done || failed) return;
          if (length + chunk.byteLength > response.length) { stop('KEYCHAIN_PROTOCOL_INVALID'); return; }
          response.set(chunk, length); length += chunk.byteLength;
          if (length >= 4 && !response.subarray(0, 4).equals(Buffer.from('CKR1', 'ascii'))
            || length >= 5 && response[4] > 5 || length >= 6 && response[5] !== backends[this.#pin.platform]
            || length >= 7 && (response[6] !== (operation === 2 && response[4] === 0 ? 32 : 0) || length > 7 + response[6]))
            stop('KEYCHAIN_PROTOCOL_INVALID');
        } finally { chunk.fill(0); }
      };
      child.stdout.on('data', stdout);
      child.stderr.on('data', (chunk: unknown) => { if (chunk instanceof Uint8Array) chunk.fill(0); else stop('KEYCHAIN_PROTOCOL_INVALID'); });
      child.on('error', () => stop('KEYCHAIN_UNAVAILABLE'));
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => stop('KEYCHAIN_UNAVAILABLE'));
      child.once('close', settle);
      deadline = setTimeout(() => stop('KEYCHAIN_UNAVAILABLE'), this.#timeoutMs);
      try { child.stdin.end(request); } catch { stop('KEYCHAIN_UNAVAILABLE'); }
    });
  }
}
