import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { createWorkerEngine } from '../runtime/worker.ts';
import { createServerEngine } from '../runtime/server.ts';
import type { Engine } from '../runtime/engine.ts';
import { hash } from '../runtime/contracts.ts';
import { ExperimentalFileSnapshotAdapter } from '../runtime/vault.ts';
import { PostgresSnapshotAdapter, type PostgresOptions } from '../runtime/postgres.ts';
import { PlatformKeychain, type PlatformKeychainSpawnOptions, type PlatformKeychainVerification } from '../runtime/platform-keychain.ts';
import type { EngineKeychainHostDependencies, KeychainHelperManifest } from '../runtime/engine-keychain-host.ts';

const passphrase = 'Public synthetic configured provider passphrase';
const name = 'Synthetic configured direct-entry workspace';
const postgresUrl = 'postgresql://synthetic:public-synthetic-password@127.0.0.1:15432/synthetic';
const backend = { win32: 1, darwin: 2, linux: 3 } as const;
type Platform = keyof typeof backend;
type Host = 'worker' | 'server';
type Operation = { operation: 1 | 2 | 3; vaultId: string };
const absent = (file: string) => assert.rejects(access(file), { code: 'ENOENT' });
const cleared = (bytes: Uint8Array) => assert.ok(bytes.every(byte => byte === 0));

function response(platform: Platform, status: number, key?: Uint8Array) {
  const bytes = Buffer.alloc(key ? 39 : 7); bytes.write('CKR1', 0, 'ascii');
  bytes[4] = status; bytes[5] = backend[platform]; bytes[6] = key ? 32 : 0;
  if (key) { assert.equal(key.byteLength, 32); bytes.set(key, 7); } return bytes;
}

// A pipe-only child double: no native process exists. Exact bounded request
// frames mutate a custody map; successful retrieval returns that stored key.
class SyntheticChild extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); stdin: Writable;
  requestReferences: Buffer[] = []; responseReferences: Buffer[] = [];
  closed = false;
  constructor(work: (child: SyntheticChild, request: Buffer) => Promise<void>, errors: unknown[]) {
    super(); const chunks: Buffer[] = []; let length = 0;
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        this.requestReferences.push(chunk); length += chunk.byteLength;
        if (length > 73) { callback(new Error('Synthetic request exceeds fixed protocol frame')); return; }
        chunks.push(Buffer.from(chunk)); callback();
      },
      final: callback => {
        const request = Buffer.concat(chunks); chunks.forEach(chunk => chunk.fill(0)); callback();
        queueMicrotask(() => {
          void work(this, request).catch(error => { errors.push(error); this.emit('error', error); })
            .finally(() => { request.fill(0); });
        });
      },
    });
  }
  send(bytes: Buffer) {
    this.responseReferences.push(bytes);
    // Exercise bounded framing across header and key boundaries.
    this.stdout.write(bytes.subarray(0, 4)); this.stdout.write(bytes.subarray(4, 7));
    if (bytes.length > 7) this.stdout.write(bytes.subarray(7));
  }
  diagnostic() { const bytes = Buffer.from('Public synthetic denied provider detail'); this.responseReferences.push(bytes); this.stderr.write(bytes); }
  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    if (this.closed) return; this.closed = true; this.stdout.end(); this.stderr.end(); this.emit('close', code, signal);
  }
  kill() { queueMicrotask(() => this.close(null, 'SIGKILL')); return true; }
}

async function fixture(t: TestContext, host: Host, platform: Platform) {
  const root = await realpath(tmpdir()), directory = await mkdtemp(join(root, 'chausar-engine-platform-keychain-'));
  const authorityDirectory = join(directory, 'main'), authorityFile = join(authorityDirectory, 'authority.encrypted.json');
  const manifestPath = join(directory, 'synthetic-helper', 'manifest.json');
  const manifest: KeychainHelperManifest = { format: 'chausar.keychain-helper.v1', platform, architecture: 'x64',
    executable: platform === 'win32' ? 'chausar-keychain.exe' : 'chausar-keychain', sha256: 'b'.repeat(64) };
  const executable = join(directory, 'synthetic-helper', manifest.executable);
  const entries = new Map<string, Uint8Array>(), operations: Operation[] = [], children: SyntheticChild[] = [], errors: unknown[] = [];
  const spawns: Array<{ executable: string; args: string[]; options: PlatformKeychainSpawnOptions }> = [];
  const pins: Readonly<PlatformKeychainVerification>[] = [], manifestReads: string[] = [], connections: string[] = [], engines: Engine[] = [];
  let denyRemoval = false;

  // The configured factory remains production. Only the database boundary is
  // replaced with a synthetic encrypted file; no pg import or connection runs.
  t.mock.method(PostgresSnapshotAdapter, 'connect', async (options: PostgresOptions) => {
    assert.deepEqual({ host: options.host, port: options.port, user: options.user, database: options.database, password: options.password },
      { host: '127.0.0.1', port: 15432, user: 'synthetic', database: 'synthetic', password: 'public-synthetic-password' });
    assert.equal(options.vaultSlot, hash(authorityDirectory)); connections.push(options.vaultSlot);
    return new ExperimentalFileSnapshotAdapter(authorityDirectory) as unknown as PostgresSnapshotAdapter;
  });

  // Test-only Unix environment values keep Linux simulation portable on every
  // CI host. They reach only the synthetic spawn port; no service is contacted.
  const syntheticEnvironment = { HOME: '/synthetic/platform-keychain/home', XDG_RUNTIME_DIR: '/synthetic/platform-keychain/runtime',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/synthetic/platform-keychain/runtime/bus' };
  const previous = new Map(Object.keys(syntheticEnvironment).map(key => [key, process.env[key]]));
  if (platform === 'linux') {
    for (const [key, value] of Object.entries(syntheticEnvironment)) process.env[key] = value;
  }

  const dependencies: EngineKeychainHostDependencies = {
    keychainPlatform: platform, keychainArchitecture: 'x64',
    readKeychainManifest: async selected => {
      assert.equal(selected, manifestPath); manifestReads.push(selected); return Buffer.from(JSON.stringify(manifest));
    },
    keychainProcess: {
      verifyExecutable: async pin => {
        assert.deepEqual(pin, { platform, architecture: 'x64', executable, sha256: manifest.sha256 }); pins.push(pin);
      },
      spawnProcess: (path, args, options) => {
        spawns.push({ executable: path, args, options });
        const child = new SyntheticChild(async (child, request) => {
          assert.ok(request.subarray(0, 4).equals(Buffer.from('CKP1', 'ascii')));
          const operation = request[4]; assert.ok(operation === 1 || operation === 2 || operation === 3);
          assert.equal(request.byteLength, operation === 1 ? 73 : 41);
          const vaultId = request.toString('ascii', 5, 41);
          assert.match(vaultId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
          operations.push({ operation, vaultId });
          if (operation === 1) {
            const incoming = request.subarray(41), existing = entries.get(vaultId);
            if (existing && !Buffer.from(existing).equals(incoming)) child.send(response(platform, 4));
            else { if (!existing) entries.set(vaultId, Uint8Array.from(incoming)); child.send(response(platform, 0)); }
          } else if (operation === 2) {
            const stored = entries.get(vaultId); child.send(stored ? response(platform, 0, stored) : response(platform, 1));
          } else {
            // Confirm actual Vault authority deletion and its writer barrier
            // before acknowledging or refusing external entry removal.
            await absent(authorityFile); await access(join(authorityDirectory, 'writer.lock'));
            const stored = entries.get(vaultId);
            if (denyRemoval) { child.diagnostic(); child.send(response(platform, 3)); }
            else { stored?.fill(0); entries.delete(vaultId); child.send(response(platform, stored ? 0 : 1)); }
          }
          child.close();
        }, errors);
        children.push(child); return child as unknown as ChildProcessWithoutNullStreams;
      },
    },
  };
  const environment: NodeJS.ProcessEnv = { CHAUSAR_VAULT_DIRECTORY: directory,
    CHAUSAR_POSTGRES_URL: postgresUrl, CHAUSAR_KEYCHAIN_MANIFEST: manifestPath };
  const createEngine = async () => {
    const engine = host === 'worker' ? await createWorkerEngine(environment, dependencies)
      : await createServerEngine(environment, ['synthetic-platform-host'], dependencies);
    engines.push(engine); assert.equal(engine.options.demo, false); assert.equal(engine.options.storage, 'postgres');
    assert.ok(engine.options.keychain instanceof PlatformKeychain); return engine;
  };
  t.after(async () => {
    try { for (const engine of engines) await engine.close(); }
    finally {
      for (const key of entries.values()) key.fill(0); entries.clear();
      for (const child of children) for (const bytes of [...child.requestReferences, ...child.responseReferences]) bytes.fill(0);
      if (platform === 'linux') for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      const child = relative(root, directory);
      assert.ok(child.startsWith('chausar-engine-platform-keychain-') && !child.startsWith('..') && !isAbsolute(child));
      await rm(directory, { recursive: true, force: true });
    }
  });
  const assertProtocol = () => {
    assert.deepEqual(errors, []); assert.equal(manifestReads.length, 2);
    assert.equal(pins.length, spawns.length + manifestReads.length);
    for (const call of spawns) {
      assert.equal(call.executable, executable); assert.deepEqual(call.args, []);
      assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
      assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']); assert.equal(call.options.env.PATH, undefined);
      assert.equal(call.options.env.CHAUSAR_POSTGRES_URL, undefined); assert.equal(call.options.env.CHAUSAR_KEYCHAIN_MANIFEST, undefined);
      assert.ok(Object.keys(call.options.env).every(key => (platform === 'linux' ? ['HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']
        : platform === 'win32' ? ['SystemRoot', 'WINDIR'] : []).includes(key)));
    }
    for (const child of children) {
      assert.equal(child.closed, true); child.requestReferences.forEach(cleared); child.responseReferences.forEach(cleared);
    }
  };
  return { createEngine, entries, operations, spawns, manifestReads, connections, authorityFile, authorityDirectory, assertProtocol,
    denyRemoval: () => { denyRemoval = true; } };
}

for (const host of ['worker', 'server'] as const) for (const platform of ['win32', 'darwin', 'linux'] as const) {
  test(`${host}/${platform}: configured PlatformKeychain frames register, authenticate file Vault reopen, and remove actual custody after deletion`, async t => {
    const f = await fixture(t, host, platform), engine = await f.createEngine();
    assert.equal(f.manifestReads.length, 1); assert.equal(f.spawns.length, 0);
    await engine.request('workspace.create', { name, passphrase });
    const vaultId = engine.vault!.vaultId, ownedEntry = f.entries.get(vaultId)!;
    const retained = Uint8Array.from(ownedEntry); t.after(() => retained.fill(0));
    assert.equal(ownedEntry.byteLength, 32); assert.equal(f.entries.size, 1);
    const authority = await readFile(f.authorityFile, 'utf8'); assert.equal(JSON.parse(authority).id, vaultId);
    assert.ok(!authority.includes(name) && !authority.includes(passphrase));
    await engine.request('workspace.lock'); await engine.close();
    assert.equal(f.entries.get(vaultId), ownedEntry); assert.deepEqual(f.operations, [{ operation: 1, vaultId }]);
    const reopened = await f.createEngine(), reply = await reopened.request('workspace.open', { unlock: 'keychain' });
    assert.deepEqual(Object.keys(reply), ['workspace']); assert.equal(reply.workspace.name, name);
    assert.equal(reopened.vault!.vaultId, vaultId); assert.equal(reopened.vault!.storageKind, 'experimental-file');
    assert.equal(f.entries.get(vaultId), ownedEntry); assert.deepEqual(ownedEntry, retained);
    const deleted = await reopened.request('workspace.delete', { confirmation: name });
    assert.equal(deleted.deleted, true); assert.equal(reopened.vault, null); assert.deepEqual(reopened.services, {});
    assert.equal(f.entries.size, 0); cleared(ownedEntry); await absent(f.authorityFile); await absent(join(f.authorityDirectory, 'writer.lock'));
    await assert.rejects(reopened.request('workspace.open', { unlock: 'keychain' }), { code: 'UNLOCK_FAILED' });
    await assert.rejects(reopened.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
    assert.deepEqual(f.operations, [{ operation: 1, vaultId }, { operation: 2, vaultId }, { operation: 3, vaultId }]);
    assert.ok(f.connections.length > 0); f.assertProtocol();
  });

  test(`${host}/${platform}: configured PlatformKeychain denied removal reports failure after authority deletion and retains unresolved external custody`, async t => {
    const f = await fixture(t, host, platform), engine = await f.createEngine();
    await engine.request('workspace.create', { name, passphrase });
    const vaultId = engine.vault!.vaultId, ownedEntry = f.entries.get(vaultId)!, retained = Uint8Array.from(ownedEntry);
    t.after(() => retained.fill(0));
    await engine.request('workspace.lock'); await engine.close();
    const reopened = await f.createEngine(); await reopened.request('workspace.open', { unlock: 'keychain' });
    const vault = reopened.vault!; f.denyRemoval();
    await assert.rejects(reopened.request('workspace.delete', { confirmation: name }), (error: any) => {
      assert.equal(error.code, 'KEYCHAIN_DENIED'); assert.equal(error.message, 'The native workspace keychain denied this operation.');
      assert.equal(error.cause, undefined); assert.ok(!String(error).includes('provider detail')); return true;
    });
    assert.equal(reopened.vault, null); assert.deepEqual(reopened.services, {}); assert.throws(() => vault.read(), { code: 'VAULT_CLOSED' });
    assert.equal((await reopened.request('workspace.status')).open, false);
    assert.equal(f.entries.get(vaultId), ownedEntry); assert.deepEqual(ownedEntry, retained);
    await absent(f.authorityFile); await absent(join(f.authorityDirectory, 'writer.lock'));
    await assert.rejects(reopened.request('workspace.open', { unlock: 'keychain' }), { code: 'UNLOCK_FAILED' });
    await assert.rejects(reopened.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
    assert.deepEqual(f.operations, [{ operation: 1, vaultId }, { operation: 2, vaultId }, { operation: 3, vaultId }]);
    assert.equal(f.entries.size, 1); retained.fill(0); f.assertProtocol();
  });
}
