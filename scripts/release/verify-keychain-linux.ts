import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';
import { loadEngineKeychain } from '../../platform/runtime/engine-keychain-host.ts';
import { Engine } from '../../platform/runtime/engine.ts';
import { PlatformKeychain } from '../../platform/runtime/platform-keychain.ts';
import { Vault, type VaultKeychainProvider } from '../../platform/runtime/vault.ts';
import { writeKeychainManifest } from './keychain-manifest.ts';

/*
 * Real Secret Service qualification of the Linux keychain helper (platform/native/keychain, libsecret backend).
 * Starts a private D-Bus session bus and an unlocked gnome-keyring-daemon (secrets component only) under a
 * temporary HOME, pins the compiled helper with keychain-manifest.ts, loads it through the engine's own manifest
 * reader, then drives the real PlatformKeychain: store, retrieve, idempotent re-store, conflict, remove, absence;
 * a Vault created with native custody and reopened with Vault.openWithKeychain; an Engine reopened with
 * `workspace.open { unlock: 'keychain' }`; and the failure paths (no session bus, a bus without a Secret Service,
 * a locked keyring). All keys, passwords and vault ids are synthetic. Prints one JSON receipt; never prints a key.
 *
 *   node scripts/release/verify-keychain-linux.ts --build /tmp/keychain-build [--as-user name]
 *   node scripts/release/verify-keychain-linux.ts --helper /path/to/chausar-keychain [--as-user name]
 */

export type KeychainStep = { name: string; ok: boolean; ms: number; detail?: Record<string, unknown>; error?: string };
export type KeychainReceipt = {
  format: 'chausar.keychain-real-run.v1';
  startedAt: string;
  host: { platform: NodeJS.Platform; arch: string; uid: number | null; kernel: string };
  helper: { sha256: string; bytes: number };
  versions: { libsecret: string | null; glib: string | null; gnomeKeyring: string | null; dbus: string | null };
  steps: KeychainStep[];
  ok: boolean;
};
export type KeychainVerifyOptions = { helper: string; workRoot?: string; keep?: boolean; onStep?: (step: KeychainStep) => void };

const pause = (ms: number) => new Promise(accept => setTimeout(accept, ms));
type RunResult = { code: number | null; stdout: string; stderr: string };
function run(executable: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; cwd?: string } = {}): Promise<RunResult> {
  return new Promise(accept => {
    const child = spawn(executable, args, { shell: false, cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 60_000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-20_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20_000); });
    child.once('error', error => { clearTimeout(deadline); accept({ code: null, stdout, stderr: error.message }); });
    child.once('close', code => { clearTimeout(deadline); accept({ code, stdout, stderr }); });
    child.stdin.on('error', () => {}); child.stdin.end(options.input ?? '');
  });
}
const firstLine = async (executable: string, args: string[]) => {
  const result = await run(executable, args, { timeoutMs: 10_000 });
  return result.code === 0 ? (result.stdout + result.stderr).trim().split('\n')[0] : null;
};

/** Compiles the real libsecret helper exactly as the native-keychain workflow does. Returns the helper path. */
export async function buildKeychainHelper(buildRoot: string): Promise<string> {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'platform', 'native', 'keychain');
  const configure = await run('cmake', ['-S', source, '-B', buildRoot, '-DCMAKE_BUILD_TYPE=Release'], { timeoutMs: 120_000 });
  check(configure.code === 0, 'KEYCHAIN_BUILD_FAILED', 'CMake could not configure the native keychain helper (libsecret-1 and glib-2.0 development files are needed).');
  const build = await run('cmake', ['--build', buildRoot, '--config', 'Release', '--target', 'chausar-keychain'], { timeoutMs: 300_000 });
  check(build.code === 0, 'KEYCHAIN_BUILD_FAILED', 'The native keychain helper did not compile.');
  return join(buildRoot, 'chausar-keychain');
}

/** One private session bus: a dbus-daemon child listening on a socket in `directory`. */
async function startBus(directory: string): Promise<{ address: string; process: ChildProcess }> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const address = `unix:path=${join(directory, 'bus')}`;
  const child = spawn('dbus-daemon', ['--session', `--address=${address}`, '--nofork', '--nopidfile', '--print-address=1'],
    { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  let printed = '';
  child.stdout!.on('data', chunk => { printed += chunk; });
  for (let attempt = 0; attempt < 100 && !printed.includes('\n'); attempt += 1) await pause(50);
  check(printed.startsWith('unix:path='), 'KEYCHAIN_BUS_FAILED', 'The private session bus did not start.');
  return { address, process: child };
}
async function nameOwner(env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
    '--method', 'org.freedesktop.DBus.GetNameOwner', 'org.freedesktop.secrets'], { env, timeoutMs: 5_000 });
  return result.code === 0 ? /'(:[0-9.]+)'/.exec(result.stdout)?.[1] ?? null : null;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(accept => child.once('close', accept));
  child.kill('SIGTERM');
  await Promise.race([closed, pause(3_000).then(() => { child.kill('SIGKILL'); return closed; })]);
}
async function refusal(work: Promise<unknown>): Promise<string> {
  try { await work; return 'no refusal'; } catch (error) { return (error as { code?: string }).code ?? 'uncoded'; }
}

export async function verifyKeychainLinux(options: KeychainVerifyOptions): Promise<KeychainReceipt> {
  check(process.platform === 'linux', 'VERIFY_LINUX_ONLY', 'This verification runs on Linux.');
  check(isAbsolute(options.helper), 'VERIFY_USAGE', 'Pass the compiled helper as an absolute path.');
  const helperBytes = await readFile(options.helper);
  const receipt: KeychainReceipt = {
    format: 'chausar.keychain-real-run.v1', startedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, uid: process.getuid?.() ?? null, kernel: release() },
    helper: { sha256: createHash('sha256').update(helperBytes).digest('hex'), bytes: helperBytes.byteLength },
    versions: { libsecret: await firstLine('pkg-config', ['--modversion', 'libsecret-1']), glib: await firstLine('pkg-config', ['--modversion', 'glib-2.0']),
      gnomeKeyring: await firstLine('gnome-keyring-daemon', ['--version']), dbus: await firstLine('dbus-daemon', ['--version']) },
    steps: [], ok: false,
  };
  const work = await mkdtemp(join(options.workRoot ?? await realpath(tmpdir()), 'chausar-keychain-real-'));
  const home = join(work, 'home'), runtime = join(work, 'runtime');
  await mkdir(home, { mode: 0o700 }); await mkdir(runtime, { mode: 0o700 }); await chmod(runtime, 0o700);
  const saved = new Map(['HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'].map(name => [name, process.env[name]]));
  const daemons: ChildProcess[] = [];
  let failedEarly = false;
  const step = async (name: string, body: () => Promise<Record<string, unknown> | void>) => {
    if (failedEarly) return;
    const started = Date.now();
    let entry: KeychainStep;
    try { const detail = await body(); entry = { name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }; }
    catch (error) {
      const failure = error as { code?: string; message?: string };
      entry = { name, ok: false, ms: Date.now() - started, error: `${failure.code ?? 'ERROR'}: ${failure.message ?? String(error)}` };
    }
    receipt.steps.push(entry); options.onStep?.(entry);
    return entry.ok;
  };
  const expect = (actual: unknown, expected: unknown, what: string) =>
    check(JSON.stringify(actual) === JSON.stringify(expected), 'KEYCHAIN_VERIFY_MISMATCH', `${what}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`);
  let keychain: PlatformKeychain | undefined, executable = '', busEnv: NodeJS.ProcessEnv = {};
  const helperSpawns = { count: 0 };
  try {
    process.env.HOME = home; process.env.XDG_RUNTIME_DIR = runtime;
    if (!await step('secret-service-started', async () => {
      const bus = await startBus(join(work, 'bus')); daemons.push(bus.process);
      busEnv = { PATH: process.env.PATH, HOME: home, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: bus.address };
      // A synthetic login password, used only to create and unlock this throwaway keyring.
      const keyring = spawn('gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets'],
        { shell: false, env: busEnv, stdio: ['pipe', 'ignore', 'ignore'] });
      daemons.push(keyring); keyring.stdin!.end(randomBytes(16).toString('hex'));
      let owner: string | null = null;
      for (let attempt = 0; attempt < 100 && !owner; attempt += 1) { await pause(100); owner = await nameOwner(busEnv); }
      check(owner !== null, 'KEYCHAIN_SERVICE_FAILED', 'gnome-keyring-daemon did not own org.freedesktop.secrets.');
      process.env.DBUS_SESSION_BUS_ADDRESS = bus.address;
      const alias = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.secrets', '--object-path', '/org/freedesktop/secrets',
        '--method', 'org.freedesktop.Secret.Service.ReadAlias', 'default'], { env: busEnv, timeoutMs: 5_000 });
      return { busOwner: owner, defaultCollection: /'([^']+)'/.exec(alias.stdout)?.[1] ?? null, privateBus: true, keyringUnlocked: true };
    })) failedEarly = true;

    await step('manifest-written-and-loaded-by-engine', async () => {
      const out = join(work, 'keychain');
      const manifest = await writeKeychainManifest({ helper: options.helper, platform: 'linux', architecture: process.arch, out });
      executable = join(out, manifest.executable);
      const loaded = await loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: join(out, 'manifest.json') }, {}, false);
      check(loaded instanceof PlatformKeychain, 'KEYCHAIN_VERIFY_MISMATCH', 'The engine did not load a PlatformKeychain.');
      keychain = loaded;
      const wrongPin = await refusal(PlatformKeychain.create({ platform: 'linux', executable, sha256: '0'.repeat(64) }));
      expect(wrongPin, 'KEYCHAIN_UNAVAILABLE', 'a wrong SHA-256 pin');
      return { sha256: manifest.sha256, executable: manifest.executable, architecture: manifest.architecture, wrongPinRefusal: wrongPin };
    });
    if (!keychain) failedEarly = true;
    const provider = () => keychain as PlatformKeychain;

    await step('store-retrieve-conflict-remove', async () => {
      const vaultId = randomUUID(), key = randomBytes(32), other = randomBytes(32);
      const before = await provider().retrieve(vaultId);
      expect(before, null, 'retrieve before store');
      await provider().store(vaultId, Uint8Array.from(key));
      const first = await provider().retrieve(vaultId);
      check(first instanceof Uint8Array && Buffer.from(first).equals(key), 'KEYCHAIN_VERIFY_MISMATCH', 'Retrieved bytes differ from the stored key.');
      await provider().store(vaultId, Uint8Array.from(key));
      const conflict = await refusal(provider().store(vaultId, Uint8Array.from(other)));
      expect(conflict, 'KEYCHAIN_CONFLICT', 'a second store with a different key');
      const kept = await provider().retrieve(vaultId);
      check(kept instanceof Uint8Array && Buffer.from(kept).equals(key), 'KEYCHAIN_VERIFY_MISMATCH', 'A refused store replaced the custody entry.');
      const search = await run('secret-tool', ['search', '--all', 'account', vaultId], { env: busEnv, timeoutMs: 10_000 });
      // secret-tool prints attributes on stderr and the secret on stdout; only attribute lines are read here.
      const entries = (search.stderr.match(/^attribute\.account = /gm) ?? []).length;
      const schema = /^schema = (.+)$/m.exec(search.stderr + search.stdout)?.[1] ?? null, label = /^label = (.+)$/m.exec(search.stderr + search.stdout)?.[1] ?? null;
      check(entries === 1 && schema === 'in.chausar.vault.v1', 'KEYCHAIN_VERIFY_MISMATCH', 'The Secret Service does not hold exactly one entry under the vault schema.');
      await provider().remove(vaultId);
      const after = await provider().retrieve(vaultId);
      expect(after, null, 'retrieve after remove');
      await provider().remove(vaultId);
      const gone = await run('secret-tool', ['search', '--all', 'account', vaultId], { env: busEnv, timeoutMs: 10_000 });
      [key, other, first, kept].forEach(bytes => bytes?.fill(0));
      return { bytesEqual: true, idempotentRestore: true, conflict, removed: true, retrieveAfterRemove: null, removeAbsentOk: true,
        entriesInStore: entries, schema, label, entriesAfterRemove: (gone.stderr.match(/^attribute\.account = /gm) ?? []).length };
    });

    await step('vault-created-with-custody-reopened-with-keychain', async () => {
      const directory = join(work, 'vault');
      const name = 'Synthetic keychain qualification workspace', passphrase = 'Synthetic public keychain passphrase 2026';
      const created = await Vault.create({ directory, storage: 'experimental-file', passphrase, name, keychain: provider() });
      const vaultId = created.vault.vaultId; await created.vault.close();
      const stored = await provider().retrieve(vaultId);
      check(stored instanceof Uint8Array && stored.byteLength === 32, 'KEYCHAIN_VERIFY_MISMATCH', 'Vault.create did not register its key.');
      stored.fill(0);
      const reopened = await Vault.openWithKeychain({ directory, storage: 'experimental-file', keychain: provider() as VaultKeychainProvider });
      const reopenedName = reopened.read().workspace.name;
      expect(reopenedName, name, 'workspace name after keychain reopen');
      await reopened.delete();
      const afterDelete = await provider().retrieve(vaultId);
      expect(afterDelete, null, 'custody after Vault.delete');
      const reopenRefused = await refusal(Vault.openWithKeychain({ directory, storage: 'experimental-file', keychain: provider() }));
      return { reopened: true, custodyRemovedOnDelete: true, reopenAfterDelete: reopenRefused };
    });

    await step('engine-workspace-open-unlock-keychain', async () => {
      const directory = join(work, 'engine');
      const name = 'Synthetic engine keychain workspace', passphrase = 'Synthetic public engine passphrase 2026';
      // File storage outside PostgreSQL is the engine's explicit experimental/demo mode; custody is the real helper.
      const engineFor = () => new Engine({ directory, demo: true, storage: 'experimental-file', keychain: provider() });
      const first = engineFor();
      let vaultId: string;
      try {
        await first.request('workspace.create', { name, passphrase });
        vaultId = first.vault!.vaultId; await first.request('workspace.lock');
      } finally { await first.close(); }
      const second = engineFor();
      try {
        const reply = await second.request('workspace.open', { unlock: 'keychain' });
        expect(reply.workspace.name, name, 'workspace name after engine keychain unlock');
        expect(second.vault!.vaultId, vaultId, 'vault id after engine keychain unlock');
        const deleted = await second.request('workspace.delete', { confirmation: name });
        expect(deleted.deleted, true, 'workspace.delete');
        const afterDelete = await provider().retrieve(vaultId);
        expect(afterDelete, null, 'custody after workspace.delete');
        const reopen = await refusal(second.request('workspace.open', { unlock: 'keychain' }));
        expect(reopen, 'UNLOCK_FAILED', 'keychain unlock after deletion');
        return { unlock: 'keychain', storage: 'experimental-file', custodyRemovedOnDelete: true, reopenAfterDelete: reopen };
      } finally { await second.close(); }
    });

    // Failure paths below count real helper launches through a pass-through spawn, so the receipt shows whether
    // the refusal came from the native helper itself or from the provider before any launch.
    const countingKeychain = async () => PlatformKeychain.create({ platform: 'linux', executable, sha256: receipt.helper.sha256,
      spawnProcess: (file, args, spawnOptions) => { helperSpawns.count += 1; return spawn(file, args, spawnOptions); } });

    await step('no-session-bus', async () => {
      const counted = await countingKeychain(), vaultId = randomUUID(), address = process.env.DBUS_SESSION_BUS_ADDRESS;
      try {
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(work, 'no-such-bus')}`;
        const launched = helperSpawns.count;
        const missingSocket = await refusal(counted.retrieve(vaultId));
        const helperRan = helperSpawns.count === launched + 1;
        delete process.env.DBUS_SESSION_BUS_ADDRESS;
        const unset = await refusal(counted.retrieve(vaultId));
        const unsetLaunched = helperSpawns.count !== launched + 1;
        expect([missingSocket, unset], ['KEYCHAIN_UNAVAILABLE', 'KEYCHAIN_UNAVAILABLE'], 'no session bus');
        check(helperRan && !unsetLaunched, 'KEYCHAIN_VERIFY_MISMATCH', 'Unexpected helper launch count.');
        return { missingSocket: { refusal: missingSocket, helperRan }, unsetAddress: { refusal: unset, helperRan: unsetLaunched } };
      } finally { process.env.DBUS_SESSION_BUS_ADDRESS = address; }
    });

    await step('bus-without-secret-service', async () => {
      const empty = await startBus(join(work, 'empty-bus')); daemons.push(empty.process);
      const counted = await countingKeychain(), address = process.env.DBUS_SESSION_BUS_ADDRESS, launched = helperSpawns.count;
      try {
        process.env.DBUS_SESSION_BUS_ADDRESS = empty.address;
        const retrieve = await refusal(counted.retrieve(randomUUID()));
        const store = await refusal(counted.store(randomUUID(), randomBytes(32)));
        expect([retrieve, store], ['KEYCHAIN_UNAVAILABLE', 'KEYCHAIN_UNAVAILABLE'], 'a bus without org.freedesktop.secrets');
        return { retrieve, store, helperRuns: helperSpawns.count - launched, serviceAutostarted: await nameOwner({ ...busEnv, DBUS_SESSION_BUS_ADDRESS: empty.address }) !== null };
      } finally { process.env.DBUS_SESSION_BUS_ADDRESS = address; await stop(empty.process); }
    });

    await step('locked-keyring', async () => {
      const held = randomUUID(), key = randomBytes(32);
      await provider().store(held, Uint8Array.from(key));
      const alias = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.secrets', '--object-path', '/org/freedesktop/secrets',
        '--method', 'org.freedesktop.Secret.Service.ReadAlias', 'default'], { env: busEnv, timeoutMs: 5_000 });
      const collection = /'([^']+)'/.exec(alias.stdout)?.[1];
      check(collection, 'KEYCHAIN_VERIFY_MISMATCH', 'No default collection to lock.');
      const lock = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.secrets', '--object-path', '/org/freedesktop/secrets',
        '--method', 'org.freedesktop.Secret.Service.Lock', `['${collection}']`], { env: busEnv, timeoutMs: 5_000 });
      check(lock.code === 0, 'KEYCHAIN_VERIFY_MISMATCH', 'The default collection did not lock.');
      const started = Date.now();
      const retrieve = await refusal(provider().retrieve(held));
      const storeNew = await refusal(provider().store(randomUUID(), randomBytes(32)));
      const storeSame = await refusal(provider().store(held, Uint8Array.from(key)));
      const remove = await refusal(provider().remove(held));
      const engine = new Engine({ directory: join(work, 'locked-engine'), demo: true, storage: 'experimental-file', keychain: provider() });
      let create: string;
      try { create = await refusal(engine.request('workspace.create', { name: 'Synthetic locked keyring workspace', passphrase: 'Synthetic public locked passphrase 2026' })); }
      finally { await engine.close(); }
      key.fill(0);
      expect({ retrieve, storeNew, storeSame, remove }, { retrieve: 'KEYCHAIN_DENIED', storeNew: 'KEYCHAIN_DENIED', storeSame: 'KEYCHAIN_DENIED', remove: 'KEYCHAIN_DENIED' }, 'a locked keyring');
      check(create !== 'no refusal', 'KEYCHAIN_VERIFY_MISMATCH', 'A workspace was created while custody was locked.');
      return { collection, retrieve, storeNew, storeSame, remove, engineCreate: create, ms: Date.now() - started };
    });
  } finally {
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    for (const daemon of daemons.reverse()) await stop(daemon);
    if (!options.keep) await rm(work, { recursive: true, force: true });
  }
  receipt.ok = receipt.steps.length === 8 && receipt.steps.every(entry => entry.ok);
  return receipt;
}

type CliOptions = { helper: string | null; build: string | null; asUser: string | null; keep: boolean };
export function parseKeychainArguments(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  let keep = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--keep') { keep = true; continue; }
    check(['--helper', '--build', '--as-user'].includes(argv[index]) && argv[index + 1] !== undefined && !values.has(argv[index]), 'VERIFY_USAGE',
      'Usage: node scripts/release/verify-keychain-linux.ts (--helper file | --build dir) [--as-user name] [--keep]');
    values.set(argv[index], argv[index += 1]);
  }
  check(values.has('--helper') !== values.has('--build'), 'VERIFY_USAGE', 'Pass exactly one of --helper (a compiled helper) or --build (compile it first).');
  check(values.get('--as-user') === undefined || /^[a-z_][a-z0-9_-]{0,31}$/.test(values.get('--as-user') as string), 'VERIFY_USAGE', 'The account name is not a plain user name.');
  const absolute = (value: string | undefined) => value === undefined ? null : resolve(value);
  return { helper: absolute(values.get('--helper')), build: absolute(values.get('--build')), asUser: values.get('--as-user') ?? null, keep };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.platform === 'linux', 'VERIFY_LINUX_ONLY', 'This verification runs on Linux.');
    const options = parseKeychainArguments(process.argv.slice(2));
    let helper = options.helper ?? await buildKeychainHelper(options.build as string);
    await access(helper);
    if (options.asUser && process.getuid?.() === 0) {
      // The other account gets its own readable copy; the receipt still pins the same bytes.
      const shared = await mkdtemp(join(tmpdir(), 'chausar-keychain-helper-'));
      await chmod(shared, 0o755); await copyFile(helper, join(shared, 'chausar-keychain')); helper = join(shared, 'chausar-keychain');
      await chmod(helper, 0o755);
      const args = [process.execPath, fileURLToPath(import.meta.url), '--helper', helper, ...(options.keep ? ['--keep'] : [])];
      const child = spawn('runuser', ['-u', options.asUser, '--', ...args], { stdio: ['ignore', 'pipe', 'inherit'],
        cwd: dirname(fileURLToPath(import.meta.url)), env: { PATH: process.env.PATH, TMPDIR: tmpdir() } });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      const code = await new Promise<number | null>(accept => child.once('close', accept));
      await rm(shared, { recursive: true, force: true });
      const receipt = JSON.parse(output) as KeychainReceipt;
      console.log(JSON.stringify({ ...receipt, ranAs: options.asUser }, null, 2));
      process.exitCode = code ?? 1;
    } else {
      const receipt = await verifyKeychainLinux({ helper, keep: options.keep,
        onStep: entry => console.error(`${entry.ok ? 'pass' : 'FAIL'} ${entry.name} (${entry.ms} ms)${entry.error ? ` ${entry.error}` : ''}`) });
      console.log(JSON.stringify(receipt, null, 2));
      process.exitCode = receipt.ok ? 0 : 1;
    }
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    console.error(`${failure.code ?? 'VERIFY_FAILED'}: ${failure.message ?? 'The keychain verification failed.'}`);
    process.exitCode = 1;
  }
}
