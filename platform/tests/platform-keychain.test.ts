import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformKeychain, type PlatformKeychainOptions, type PlatformKeychainSpawnOptions,
  type PlatformKeychainVerification } from '../runtime/platform-keychain.ts';

// These public synthetic bytes never reach an OS credential store or a native process.
const id = '11111111-2222-4333-8444-555555555555';
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const executable = join(process.cwd(), 'synthetic-keychain-helper');
const sha256 = 'a'.repeat(64);
const backend = { win32: 1, darwin: 2, linux: 3 } as const;
function reply(status: number, nativeBackend: number, value?: Uint8Array) {
  const bytes = Buffer.alloc(value ? 39 : 7);
  bytes.write('CKR1', 0, 'ascii'); bytes[4] = status; bytes[5] = nativeBackend; bytes[6] = value ? 32 : 0;
  if (value) bytes.set(value, 7); return bytes;
}
type Behavior = (child: SyntheticChild, request: Buffer) => void;
class SyntheticChild extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); stdin: Writable;
  requestReferences: Buffer[] = []; outputReferences: Buffer[] = []; killed: string[] = [];
  closed = false; closeOnKill = true; killFailure?: 'false' | 'throw';
  constructor(behavior: Behavior) {
    super(); const chunks: Buffer[] = [];
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => { this.requestReferences.push(chunk); chunks.push(Buffer.from(chunk)); callback(); },
      final: callback => {
        const request = Buffer.concat(chunks); chunks.forEach(chunk => chunk.fill(0)); callback();
        queueMicrotask(() => { try { behavior(this, request); } finally { request.fill(0); } });
      },
    });
  }
  send(bytes: Buffer) { this.outputReferences.push(bytes); this.stdout.write(bytes); }
  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    if (this.closed) return; this.closed = true; this.stdout.end(); this.stderr.end(); this.emit('close', code, signal);
  }
  kill(signal: string) {
    this.killed.push(signal);
    if (this.killFailure === 'throw') throw new Error('Synthetic native termination denied');
    if (this.killFailure === 'false') return false;
    if (this.closeOnKill) queueMicrotask(() => this.close(null, 'SIGKILL')); return true;
  }
}
const environmentOwners = new WeakSet<TestContext>();
function syntheticEnvironment(t: TestContext) {
  if (environmentOwners.has(t)) return;
  environmentOwners.add(t);
  const supplied: Record<string, string> = { HOME: '/synthetic/home', XDG_RUNTIME_DIR: '/synthetic/runtime',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/synthetic/runtime/bus', SystemRoot: 'C:\\SyntheticWindows', WINDIR: 'C:\\SyntheticWindows',
    SYNTHETIC_CREDENTIAL: 'Public synthetic value never forwarded' };
  const before = new Map(Object.keys(supplied).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(supplied)) process.env[name] = value;
  t.after(() => { for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
}
async function fixture(t: TestContext, platform: 'win32' | 'darwin' | 'linux' = 'linux', behavior?: Behavior,
  overrides: Partial<PlatformKeychainOptions> = {}) {
  syntheticEnvironment(t);
  const entries = new Map<string, Uint8Array>(), frames: Buffer[] = [], children: SyntheticChild[] = [];
  const spawns: { path: string; args: string[]; options: PlatformKeychainSpawnOptions }[] = [], pins: Readonly<PlatformKeychainVerification>[] = [];
  const operations: Array<{ operation: number; vaultId: string }> = [];
  const emulate: Behavior = (child, request) => {
    frames.push(Buffer.from(request));
    assert.equal(request.toString('ascii', 0, 4), 'CKP1');
    const operation = request[4], vaultId = request.toString('ascii', 5, 41);
    assert.equal(request.length, operation === 1 ? 73 : 41); operations.push({ operation, vaultId });
    if (operation === 1) {
      const existing = entries.get(vaultId), incoming = request.subarray(41);
      if (existing && !Buffer.from(existing).equals(incoming)) child.send(reply(4, backend[platform]));
      else { entries.set(vaultId, Uint8Array.from(incoming)); child.send(reply(0, backend[platform])); }
    } else if (operation === 2) child.send(entries.has(vaultId) ? reply(0, backend[platform], entries.get(vaultId)) : reply(1, backend[platform]));
    else { const stored = entries.get(vaultId); stored?.fill(0); entries.delete(vaultId); child.send(reply(stored ? 0 : 1, backend[platform])); }
    child.close();
  };
  const provider = await PlatformKeychain.create({ platform, architecture: 'x64', executable, sha256,
    verifyExecutable: async pin => { pins.push(pin); },
    spawnProcess: (path, args, options) => {
      spawns.push({ path, args, options }); const child = new SyntheticChild(behavior ?? emulate); children.push(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    }, ...overrides });
  t.after(() => { for (const bytes of [...entries.values(), ...frames]) bytes.fill(0); entries.clear(); });
  return { provider, entries, frames, operations, children, spawns, pins };
}
const errorCode = (code: string) => (error: any) => {
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /SyntheticCredential|native detail|11111111|aaaaaaaa|denied stderr/);
  assert.equal(error.cause, undefined); return true;
};
const cleared = (bytes: Uint8Array) => assert.ok(bytes.every(byte => byte === 0));

for (const platform of ['win32', 'darwin', 'linux'] as const) {
  test(`${platform}: fixed-frame direct entry custody, detached retrieval and per-Vault idempotent removal`, async t => {
    const f = await fixture(t, platform);
    assert.equal(f.spawns.length, 0); assert.equal(f.pins.length, 1);
    assert.equal(await f.provider.retrieve(id), null);
    await f.provider.store(id, key); await f.provider.store(id, key); await f.provider.store(otherId, key);
    assert.deepEqual(f.entries.get(id), key);
    const retrieved = await f.provider.retrieve(id); assert.deepEqual(retrieved, key);
    retrieved!.fill(0); assert.deepEqual(f.entries.get(id), key);
    const ownedEntry = f.entries.get(id)!; await f.provider.remove(id); cleared(ownedEntry);
    assert.equal(await f.provider.retrieve(id), null); await f.provider.remove(id);
    assert.deepEqual(f.entries.get(otherId), key);
    assert.equal(f.operations.filter(item => item.vaultId === otherId).length, 1);
    assert.equal(f.pins.length, f.spawns.length + 1);
    for (const call of f.spawns) {
      assert.equal(call.path, executable); assert.deepEqual(call.args, []);
      assert.equal(call.options.shell, false); assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
      assert.equal(call.options.env.SYNTHETIC_CREDENTIAL, undefined); assert.equal(call.options.env.PATH, undefined);
      assert.deepEqual(Object.keys(call.options.env).sort(), platform === 'linux' ? ['DBUS_SESSION_BUS_ADDRESS', 'HOME', 'XDG_RUNTIME_DIR']
        : platform === 'win32' ? ['SystemRoot', 'WINDIR'] : []);
    }
    for (const child of f.children) {
      assert.equal(child.closed, true); child.requestReferences.forEach(cleared); child.outputReferences.forEach(cleared);
    }
    assert.deepEqual(key, Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    const storeFrame = f.frames.find(frame => frame[4] === 1)!;
    assert.equal(storeFrame.toString('ascii', 5, 41), id); assert.deepEqual(storeFrame.subarray(41), Buffer.from(key));
    assert.equal(f.frames.filter(frame => frame[4] !== 1).every(frame => frame.length === 41), true);
  });
}

test('rejects noncanonical Vault identities and key lengths before verification or spawn', async t => {
  const f = await fixture(t);
  for (const value of ['', 'workspace_123', id.toUpperCase().replace('11111111', 'AAAAAAAA'), id + '\n', '../' + id]) {
    await assert.rejects(f.provider.retrieve(value), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
    await assert.rejects(f.provider.remove(value), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
    await assert.rejects(f.provider.store(value, key), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
  }
  for (const size of [0, 31, 33, 1024]) await assert.rejects(f.provider.store(id, new Uint8Array(size)), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
  await assert.rejects(f.provider.store(id, 'SyntheticCredential' as unknown as Uint8Array), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
  assert.equal(f.spawns.length, 0); assert.equal(f.pins.length, 1);
});

test('same entry different key fails with sanitized conflict and preserves original custody', async t => {
  const f = await fixture(t); await f.provider.store(id, key);
  const other = new Uint8Array(32).fill(250);
  await assert.rejects(f.provider.store(id, other), errorCode('KEYCHAIN_CONFLICT'));
  assert.deepEqual(await f.provider.retrieve(id), key); other.fill(0);
});

for (const [status, code] of [[2, 'KEYCHAIN_UNAVAILABLE'], [3, 'KEYCHAIN_DENIED'], [4, 'KEYCHAIN_CONFLICT'], [5, 'KEYCHAIN_PROTOCOL_INVALID']] as const) {
  test(`native status ${status} is sanitized for all operations`, async t => {
    const f = await fixture(t, 'linux', child => {
      const stderr = Buffer.from('denied stderr SyntheticCredential native detail'); child.outputReferences.push(stderr); child.stderr.write(stderr);
      child.send(reply(status, 3)); child.close();
    });
    await assert.rejects(f.provider.store(id, key), errorCode(code));
    await assert.rejects(f.provider.retrieve(id), errorCode(code));
    await assert.rejects(f.provider.remove(id), errorCode(code));
    for (const child of f.children) child.outputReferences.forEach(cleared);
  });
}

test('store missing response is invalid; unavailable removal retains custody for explicit retry', async t => {
  const entries = new Map([[id, Uint8Array.from(key)]]); let unavailable = true;
  const f = await fixture(t, 'linux', (child, request) => {
    if (request[4] === 1) child.send(reply(1, 3));
    else if (unavailable) child.send(reply(2, 3));
    else { entries.get(id)!.fill(0); entries.delete(id); child.send(reply(0, 3)); }
    child.close();
  });
  t.after(() => { entries.get(id)?.fill(0); entries.clear(); });
  await assert.rejects(f.provider.store(id, key), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
  await assert.rejects(f.provider.remove(id), errorCode('KEYCHAIN_UNAVAILABLE')); assert.deepEqual(entries.get(id), key);
  unavailable = false; await f.provider.remove(id); assert.equal(entries.size, 0);
});

const malformed: Array<[string, () => Buffer]> = [
  ['truncated header', () => reply(0, 3).subarray(0, 6)],
  ['truncated key', () => reply(0, 3, key).subarray(0, 38)],
  ['wrong magic', () => { const value = reply(0, 3, key); value[0] = 0; return value; }],
  ['high-bit magic alias', () => { const value = reply(0, 3, key); value[0] |= 0x80; return value; }],
  ['wrong backend', () => reply(0, 2, key)],
  ['unknown status', () => reply(6, 3)],
  ['wrong key length', () => { const value = reply(0, 3, key); value[6] = 31; return value; }],
  ['missing with key', () => reply(1, 3, key)],
  ['trailing stdout', () => Buffer.concat([reply(0, 3, key), Buffer.from([1])])],
];
for (const [name, bytes] of malformed) {
  test(`refuses ${name}, zeroes output and terminates oversized responses`, async t => {
    const f = await fixture(t, 'linux', child => { child.send(bytes()); if (!child.killed.length) child.close(); });
    await assert.rejects(f.provider.retrieve(id), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
    f.children[0].requestReferences.forEach(cleared); f.children[0].outputReferences.forEach(cleared);
    if (name === 'trailing stdout') assert.deepEqual(f.children[0].killed, ['SIGKILL']);
  });
}

test('bounded split responses return only after child close and clear all pipe buffers', async t => {
  let close!: () => void;
  const f = await fixture(t, 'linux', child => {
    const value = reply(0, 3, key);
    child.send(value.subarray(0, 5)); child.send(value.subarray(5, 22)); child.send(value.subarray(22));
    close = () => child.close();
  });
  let settled = false; const operation = f.provider.retrieve(id).then(value => { settled = true; return value; });
  await new Promise<void>(done => setImmediate(done)); assert.equal(settled, false);
  f.children[0].outputReferences.forEach(cleared); close();
  const value = await operation; assert.deepEqual(value, key); value!.fill(0); f.children[0].requestReferences.forEach(cleared);
});

test('process errors, nonzero exits and signals sanitize native details even after valid output', async t => {
  for (const kind of ['error', 'exit', 'signal'] as const) {
    const f = await fixture(t, 'linux', child => {
      child.send(reply(0, 3, key));
      if (kind === 'error') child.emit('error', new Error('SyntheticCredential native detail'));
      else child.close(kind === 'exit' ? 1 : 0, kind === 'signal' ? 'SIGTERM' : null);
    });
    await assert.rejects(f.provider.retrieve(id), errorCode('KEYCHAIN_UNAVAILABLE'));
    f.children[0].requestReferences.forEach(cleared); f.children[0].outputReferences.forEach(cleared);
  }
  const f = await fixture(t, 'linux', undefined, { spawnProcess: () => { throw new Error('SyntheticCredential native detail'); } });
  await assert.rejects(f.provider.store(id, key), errorCode('KEYCHAIN_UNAVAILABLE'));
});

test('timeout terminates pending native work, clears request bytes and returns unavailable', async t => {
  let operations = 0;
  const f = await fixture(t, 'linux', child => { if (++operations > 1) { child.send(reply(1, 3)); child.close(); } }, { timeoutMs: 5 });
  await assert.rejects(f.provider.store(id, key), errorCode('KEYCHAIN_UNAVAILABLE'));
  assert.deepEqual(f.children[0].killed, ['SIGKILL']); assert.equal(f.children[0].closed, true);
  f.children[0].requestReferences.forEach(cleared);
  assert.equal(await f.provider.retrieve(id), null); assert.equal(f.spawns.length, 2);
});

test('timeout remains bounded if a synthetic child never acknowledges termination', async t => {
  const f = await fixture(t, 'linux', child => { child.closeOnKill = false; }, { timeoutMs: 1 });
  await assert.rejects(f.provider.retrieve(id), errorCode('KEYCHAIN_UNAVAILABLE'));
  assert.deepEqual(f.children[0].killed, ['SIGKILL']); assert.equal(f.children[0].stdout.destroyed, true);
  f.children[0].requestReferences.forEach(cleared);
  for (const operation of [() => f.provider.store(id, key), () => f.provider.retrieve(id), () => f.provider.remove(id)])
    await assert.rejects(operation(), errorCode('KEYCHAIN_UNAVAILABLE'));
  assert.equal(f.spawns.length, 1);
});

for (const killFailure of ['false', 'throw'] as const) {
  test(`unconfirmed ${killFailure} kill permanently quarantines instance and blocks queued launches`, async t => {
    let verifications = 0, releasePin!: () => void, enteredPin!: () => void;
    const pendingPin = new Promise<void>(done => { releasePin = done; });
    const entered = new Promise<void>(done => { enteredPin = done; });
    const f = await fixture(t, 'linux', child => { child.killFailure = killFailure; }, { timeoutMs: 1,
      verifyExecutable: async () => { if (++verifications === 3) { enteredPin(); await pendingPin; } } });
    const timedOut = assert.rejects(f.provider.store(id, key), errorCode('KEYCHAIN_UNAVAILABLE'));
    const queued = assert.rejects(f.provider.remove(otherId), errorCode('KEYCHAIN_UNAVAILABLE'));
    await entered; await timedOut; releasePin(); await queued;
    assert.equal(f.children[0].closed, false); assert.deepEqual(f.children[0].killed, ['SIGKILL']);
    assert.equal(f.spawns.length, 1); f.children[0].requestReferences.forEach(cleared);
    for (const operation of [() => f.provider.store(id, key), () => f.provider.retrieve(id), () => f.provider.remove(id)])
      await assert.rejects(operation(), errorCode('KEYCHAIN_UNAVAILABLE'));
    assert.equal(verifications, 3); assert.equal(f.spawns.length, 1);
    // Late close cannot undo the lost completion barrier for this instance.
    f.children[0].close(); await assert.rejects(f.provider.store(id, key), errorCode('KEYCHAIN_UNAVAILABLE'));
    assert.equal(f.spawns.length, 1);
  });
}

test('a changed executable pin prevents every later operation without spawn or leaked verification error', async t => {
  let verifications = 0;
  const f = await fixture(t, 'linux', undefined, { verifyExecutable: async () => {
    if (++verifications > 1) throw new Error('SyntheticCredential native detail');
  } });
  await assert.rejects(f.provider.store(id, key), errorCode('KEYCHAIN_UNAVAILABLE'));
  await assert.rejects(f.provider.retrieve(id), errorCode('KEYCHAIN_UNAVAILABLE'));
  await assert.rejects(f.provider.remove(id), errorCode('KEYCHAIN_UNAVAILABLE'));
  assert.equal(verifications, 4); assert.equal(f.spawns.length, 0); assert.deepEqual(key, Uint8Array.from({ length: 32 }, (_, i) => i + 1));
});

test('Linux refuses absent or remote/mixed session buses before invoking the helper', async t => {
  const f = await fixture(t);
  for (const address of ['', 'tcp:host=example.com,port=1234', 'unix:path=/synthetic/bus;tcp:host=example.com',
    'autolaunch:', 'unixexec:path=/synthetic/helper', 'unix:path=/synthetic/bus,abstract=other', 'unix:path=relative',
    'unix:path=/synthetic/bus,guid=not-guid', 'unix:path=/synthetic/bus,path=/another']) {
    process.env.DBUS_SESSION_BUS_ADDRESS = address;
    await assert.rejects(f.provider.retrieve(id), errorCode('KEYCHAIN_UNAVAILABLE'));
  }
  process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:abstract=synthetic-bus,guid=1234567890abcdef1234567890abcdef';
  assert.equal(await f.provider.retrieve(id), null); assert.equal(f.spawns.length, 1);
});

test('configuration rejects unsupported platforms, weak pins, PATH lookup and unbounded budgets without native work', async () => {
  const options: PlatformKeychainOptions = { platform: 'linux', executable, sha256, verifyExecutable: async () => {} };
  for (const patch of [{ platform: 'freebsd' }, { architecture: 'ia32' }] as const)
    await assert.rejects(PlatformKeychain.create({ ...options, ...patch }), errorCode('KEYCHAIN_UNAVAILABLE'));
  for (const patch of [{ executable: 'chausar-keychain' }, { executable: executable + '/..' }, { sha256: '123' },
    { sha256: 'A'.repeat(64) }, { maximumBytes: 40 }, { maximumBytes: 6 }, { timeoutMs: 0 }, { timeoutMs: 60_001 }])
    await assert.rejects(PlatformKeychain.create({ ...options, ...patch }), errorCode('KEYCHAIN_PROTOCOL_INVALID'));
});

function syntheticNativeHeader() {
  const bytes = Buffer.alloc(256);
  if (process.platform === 'linux') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); bytes.writeUInt16LE(2, 16);
    bytes.writeUInt16LE(process.arch === 'x64' ? 62 : 183, 18); bytes.writeUInt32LE(1, 20);
  } else if (process.platform === 'darwin') {
    bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(process.arch === 'x64' ? 0x01000007 : 0x0100000c, 4); bytes.writeUInt32LE(2, 12);
  } else {
    bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x00004550, 64);
    bytes.writeUInt16LE(process.arch === 'x64' ? 0x8664 : 0xaa64, 68); bytes.writeUInt16LE(2, 86); bytes.writeUInt16LE(0x20b, 88);
  }
  return bytes;
}
test('default pin verifier reads synthetic native bytes, refuses replacement, scripts and symlink paths without execution', async t => {
  if (!['linux', 'darwin', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) return t.skip('No supported native format to inspect.');
  const root = await realpath(tmpdir()), directory = await mkdtemp(join(root, 'chausar-keychain-pin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'synthetic-native.bin'), bytes = syntheticNativeHeader();
  await writeFile(file, bytes, { mode: 0o700 });
  let spawns = 0;
  const options: PlatformKeychainOptions = { platform: process.platform, executable: file, sha256: createHash('sha256').update(bytes).digest('hex'),
    spawnProcess: () => { spawns++; throw new Error('Native execution is forbidden in this test.'); } };
  const provider = await PlatformKeychain.create(options); assert.equal(spawns, 0);
  await assert.rejects(PlatformKeychain.create({ ...options, sha256 }), errorCode('KEYCHAIN_UNAVAILABLE'));
  await assert.rejects(PlatformKeychain.create({ ...options, architecture: process.arch === 'x64' ? 'arm64' : 'x64' }), errorCode('KEYCHAIN_UNAVAILABLE'));
  await writeFile(file, Buffer.from('#!/bin/sh\nnever-executed\n'), { mode: 0o700 });
  await assert.rejects(provider.retrieve(id), errorCode('KEYCHAIN_UNAVAILABLE'));
  await assert.rejects(PlatformKeychain.create({ ...options, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }), errorCode('KEYCHAIN_UNAVAILABLE'));
  assert.equal(spawns, 0);
  if (process.platform !== 'win32') {
    await writeFile(file, bytes); const link = join(directory, 'symlink-native'); await symlink(file, link);
    await assert.rejects(PlatformKeychain.create({ ...options, executable: link }), errorCode('KEYCHAIN_UNAVAILABLE'));
    const ancestor = join(directory, 'symlink-directory'); await symlink(directory, ancestor);
    await assert.rejects(PlatformKeychain.create({ ...options, executable: join(ancestor, 'synthetic-native.bin') }), errorCode('KEYCHAIN_UNAVAILABLE'));
  }
  bytes.fill(0);
});
