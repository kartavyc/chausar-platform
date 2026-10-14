import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BundledPostgres, nodePostgresRunner, postgresMajor, type PostgresRunner, type PostgresRunOptions, type PostgresServerProcess } from '../runtime/native/postgres-lifecycle.ts';

type Call = { name: string; executable: string; args: string[]; options?: PostgresRunOptions };
const DEAD_PID = 2_147_483_646;

/** Emulates initdb, postgres (a TCP listener plus postmaster.pid), pg_ctl stop, `postgres --version` and pg_upgrade. */
function fakeRunner(settings: { bundled?: string; failFastStop?: boolean; failUpgradeCheck?: boolean } = {}) {
  const calls: Call[] = [];
  const servers = new Map<string, { server: Server; exited: boolean }>();
  const option = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  const versionOf = (executable: string) => /postgres-(\d+)/.exec(executable)?.[1] ? `${/postgres-(\d+)/.exec(executable)?.[1]}.9` : settings.bundled ?? '17.6';
  const closeServer = async (directory: string) => {
    const entry = servers.get(directory);
    if (!entry || entry.exited) return false;
    await new Promise<void>(accept => entry.server.close(() => accept()));
    entry.exited = true;
    await rm(join(directory, 'postmaster.pid'), { force: true });
    return true;
  };
  const runner: PostgresRunner = {
    async run(executable, args, options) {
      const name = basename(executable).replace(/\.exe$/, '');
      calls.push({ name, executable, args, options });
      const ok = { code: 0, stdout: '', stderr: '', timedOut: false };
      if (name === 'postgres' && args[0] === '--version') return { ...ok, stdout: `postgres (PostgreSQL) ${versionOf(executable)}\n` };
      if (name === 'initdb') {
        const directory = option(args, '-D');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'PG_VERSION'), `${postgresMajor(versionOf(executable))}\n`);
        await writeFile(join(directory, 'postgresql.conf'), '# fake\n');
        return ok;
      }
      if (name === 'pg_ctl' && args[0] === 'stop') {
        const directory = option(args, '-D');
        if (settings.failFastStop && option(args, '-m') === 'fast') return { ...ok, code: 1, stderr: 'fast shutdown failed' };
        return (await closeServer(directory)) ? ok : { ...ok, code: 1, stderr: 'no server running' };
      }
      if (name === 'pg_upgrade') {
        if (args.includes('--check')) return settings.failUpgradeCheck ? { ...ok, code: 1, stderr: 'check failed' } : ok;
        const from = await readFile(join(option(args, '--old-datadir'), 'PG_VERSION'), 'utf8');
        await writeFile(join(option(args, '--new-datadir'), 'upgraded-from'), from);
        return ok;
      }
      return { ...ok, code: 127, stderr: 'unknown fake command' };
    },
    spawnServer(executable, args) {
      const name = basename(executable).replace(/\.exe$/, '');
      calls.push({ name: `${name}:server`, executable, args });
      const directory = option(args, '-D');
      const port = Number(option(args, '-p'));
      const server = createServer(socket => socket.destroy());
      const entry = { server, exited: false };
      servers.set(directory, entry);
      server.once('error', () => { entry.exited = true; });
      writeFileSync(join(directory, 'postmaster.pid'), `${process.pid}\n${directory}\n0\n${port}\n\n127.0.0.1\n`);
      server.listen(port, '127.0.0.1');
      const handle: PostgresServerProcess = {
        pid: process.pid,
        exitStatus: () => ({ exited: entry.exited, code: entry.exited ? 0 : null, failed: false }),
        kill: () => { void closeServer(directory); },
      };
      return handle;
    },
  };
  return { runner, calls, closeAll: async () => { for (const directory of servers.keys()) await closeServer(directory); } };
}

async function runtime(root: string, component = 'postgres', tools = ['postgres', 'initdb', 'pg_ctl', 'pg_upgrade']) {
  const bin = join(root, component, 'bin');
  await mkdir(bin, { recursive: true });
  for (const tool of tools) { await writeFile(join(bin, tool), 'fake binary'); await chmod(join(bin, tool), 0o755); }
}
async function setup(t: TestContext, settings: Parameters<typeof fakeRunner>[0] = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-pg-'));
  const runtimeRoot = join(root, 'runtime-binaries');
  const dataRoot = join(root, 'database');
  await runtime(runtimeRoot);
  const fake = fakeRunner(settings);
  const port = 56000 + Math.floor(Math.random() * 800);
  const make = () => new BundledPostgres({ runtimeRoot, dataRoot, runner: fake.runner, portRange: [port, port + 40], platform: 'linux', startTimeoutMs: 5000 });
  t.after(async () => { await fake.closeAll(); await rm(root, { recursive: true, force: true }); });
  return { root, runtimeRoot, dataRoot, fake, make, pg: make() };
}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('fresh start initialises a private loopback cluster, persists its port and stops in order', async t => {
  const { pg, dataRoot, fake, make } = await setup(t);
  assert.equal((await pg.status()).state, 'absent');
  const connection = await pg.start();
  assert.equal(connection.host, '127.0.0.1');
  assert.equal(connection.user, 'chausar');
  assert.equal(connection.passwordFile, join(dataRoot, 'database-password'));
  const status = await pg.status();
  assert.equal(status.state, 'running');
  assert.equal(status.majorVersion, '17');
  assert.equal(status.bundledMajor, '17');
  assert.equal(status.lock, 'ours');
  assert.equal((await stat(dataRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dataRoot, 'database-password'))).mode & 0o777, 0o600);
  assert.match(await readFile(join(dataRoot, 'database-password'), 'utf8'), /^[A-Za-z0-9_-]{43}$/);
  const record = JSON.parse(await readFile(join(dataRoot, 'chausar-cluster.json'), 'utf8'));
  assert.equal(record.port, connection.port);
  const initdb = fake.calls.find(call => call.name === 'initdb');
  assert.ok(initdb);
  for (const arg of ['--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8', '--username']) assert.ok(initdb.args.includes(arg), arg);
  const server = fake.calls.find(call => call.name === 'postgres:server');
  assert.ok(server);
  assert.deepEqual(server.args.slice(2, 4), ['-h', '127.0.0.1']);
  for (const arg of ['unix_socket_directories=', 'fsync=on', 'password_encryption=scram-sha-256']) assert.ok(server.args.includes(arg), arg);
  assert.match(await pg.connectionUrl(), new RegExp(`^postgresql://chausar:[A-Za-z0-9_-]{43}@127\\.0\\.0\\.1:${connection.port}/postgres$`));
  assert.equal((await pg.start()).port, connection.port, 'a second start is a no-op while running');
  await pg.stop();
  assert.equal((await pg.status()).state, 'stopped');
  assert.deepEqual(fake.calls.filter(call => call.name === 'pg_ctl').map(call => call.args.slice(0, 5)), [['stop', '-D', join(dataRoot, 'cluster'), '-m', 'fast']]);
  assert.throws(() => pg.connection(), code('POSTGRES_NOT_RUNNING'));
  const again = make();
  assert.equal((await again.start()).port, connection.port, 'the persisted port is preferred');
  assert.equal(fake.calls.filter(call => call.name === 'initdb').length, 1, 'an initialised cluster is not re-initialised');
  await again.stop();
});

test('a dead postmaster PID is a recorded stale lock; a live foreign PID refuses', async t => {
  const { pg, dataRoot, make } = await setup(t);
  await pg.start(); await pg.stop();
  await writeFile(join(dataRoot, 'cluster', 'postmaster.pid'), `${DEAD_PID}\n${join(dataRoot, 'cluster')}\n`);
  const recovering = make();
  assert.equal((await recovering.status()).lock, 'stale');
  await recovering.start();
  const status = await recovering.status();
  assert.equal(status.state, 'running');
  assert.equal(status.lastRecovery?.kind, 'stale-lock-recovered');
  assert.equal(status.lastRecovery?.detail.pid, DEAD_PID);
  const intruder = make();
  assert.equal((await intruder.status()).lock, 'foreign');
  await assert.rejects(intruder.start(), code('POSTGRES_DATA_IN_USE'));
  await recovering.stop();
});

test('a failed fast stop falls back to immediate and is recorded', async t => {
  const { pg, fake } = await setup(t, { failFastStop: true });
  await pg.start();
  await pg.stop();
  assert.deepEqual(fake.calls.filter(call => call.name === 'pg_ctl').map(call => call.args[4]), ['fast', 'immediate']);
  const status = await pg.status();
  assert.equal(status.state, 'stopped');
  assert.equal(status.lastRecovery?.kind, 'immediate-stop');
});

test('missing runtime, unsafe folders and newer data refuse with typed codes', async t => {
  const { pg, runtimeRoot, dataRoot, root, fake } = await setup(t);
  await rm(join(runtimeRoot, 'postgres', 'bin', 'pg_ctl'));
  const unavailable = await pg.status();
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.reason, 'POSTGRES_RUNTIME_MISSING');
  await assert.rejects(pg.start(), code('POSTGRES_RUNTIME_MISSING'));
  await runtime(runtimeRoot);
  await mkdir(dataRoot, { recursive: true });
  await mkdir(join(root, 'elsewhere'));
  await symlink(join(root, 'elsewhere'), join(dataRoot, 'cluster'));
  await assert.rejects(pg.start(), code('POSTGRES_DATA_UNSAFE'));
  await rm(join(dataRoot, 'cluster'));
  await mkdir(join(dataRoot, 'cluster'));
  await writeFile(join(dataRoot, 'cluster', 'stray.txt'), 'x');
  assert.equal((await pg.status()).state, 'uninitialized');
  await assert.rejects(pg.start(), code('POSTGRES_DATA_INCOMPLETE'));
  await writeFile(join(dataRoot, 'cluster', 'PG_VERSION'), '18\n');
  const newer = await pg.status();
  assert.equal(newer.state, 'newer-than-app');
  assert.equal(newer.majorVersion, '18');
  await assert.rejects(pg.start(), code('POSTGRES_DATA_NEWER'));
  await assert.rejects(pg.planUpgrade(), code('POSTGRES_UPGRADE_NOT_NEEDED'));
  assert.equal(fake.calls.filter(call => call.name === 'initdb').length, 0);
  assert.throws(() => new BundledPostgres({ runtimeRoot: 'relative', dataRoot }), code('POSTGRES_RUNTIME_PATH_INVALID'));
});

async function olderCluster(dataRoot: string) {
  await mkdir(join(dataRoot, 'cluster'), { recursive: true, mode: 0o700 });
  await writeFile(join(dataRoot, 'cluster', 'PG_VERSION'), '16\n');
  await writeFile(join(dataRoot, 'cluster', 'base-data'), 'old rows');
}
async function vaultCopy(root: string) {
  const path = join(root, 'vault-copy.chausar');
  await writeFile(path, 'vault copy bytes');
  return { path, sha256: createHash('sha256').update('vault copy bytes').digest('hex') };
}

test('an older cluster plans and runs pg_upgrade in copy mode only after a verified vault copy', async t => {
  const { pg, root, runtimeRoot, dataRoot, fake, make } = await setup(t);
  await olderCluster(dataRoot);
  await pg.start().then(() => assert.fail('must refuse'), error => assert.equal(error.code, 'POSTGRES_UPGRADE_REQUIRED'));
  assert.equal((await pg.status()).state, 'needs-upgrade');
  await assert.rejects(pg.planUpgrade(), code('POSTGRES_OLD_RUNTIME_MISSING'));
  await runtime(runtimeRoot, 'postgres-16', ['postgres', 'initdb', 'pg_ctl']);
  const plan = await pg.planUpgrade();
  assert.equal(plan.fromMajor, '16');
  assert.equal(plan.toMajor, '17');
  assert.equal(plan.link, false);
  assert.equal(plan.oldBinDirectory, join(runtimeRoot, 'postgres-16', 'bin'));
  assert.equal(plan.newDataDirectory, join(dataRoot, 'cluster.next-17'));
  assert.equal(plan.retainedDataDirectory, join(dataRoot, 'cluster.pre-17'));
  assert.deepEqual(plan.steps.map(step => step.name), ['initdb', 'check', 'upgrade']);
  assert.ok(plan.steps[1].args.includes('--check'));
  assert.ok(plan.steps.every(step => !step.args.includes('--link')));

  await assert.rejects(pg.upgrade({}), code('BACKUP_REQUIRED'));
  await assert.rejects(pg.upgrade({ backupConfirmed: { path: join(root, 'absent'), sha256: 'a'.repeat(64) } }), code('BACKUP_REQUIRED'));
  const proof = await vaultCopy(root);
  await assert.rejects(pg.upgrade({ backupConfirmed: { ...proof, sha256: 'b'.repeat(64) } }), code('BACKUP_UNVERIFIED'));
  assert.equal(fake.calls.filter(call => call.name === 'pg_upgrade').length, 0, 'no upgrade step runs before the backup proof');

  await writeFile(join(dataRoot, 'cluster', 'postmaster.pid'), `${DEAD_PID}\n`);
  const status = await pg.upgrade({ backupConfirmed: proof });
  assert.equal(status.state, 'stopped');
  assert.equal(status.majorVersion, '17');
  assert.equal(status.lastUpgrade?.kind, 'upgrade-completed');
  assert.equal(status.lastUpgrade?.detail.backupSha256, proof.sha256);
  assert.equal((await readFile(join(dataRoot, 'cluster.pre-17', 'PG_VERSION'), 'utf8')).trim(), '16');
  assert.equal(await readFile(join(dataRoot, 'cluster.pre-17', 'base-data'), 'utf8'), 'old rows');
  assert.equal((await readFile(join(dataRoot, 'cluster', 'upgraded-from'), 'utf8')).trim(), '16');
  await assert.rejects(access(join(dataRoot, 'cluster.next-17')));
  await assert.rejects(access(join(dataRoot, 'upgrade.pgpass')), 'the temporary password file is removed');
  const upgradeCalls = fake.calls.filter(call => call.name === 'pg_upgrade');
  assert.deepEqual(upgradeCalls.map(call => call.args.includes('--check')), [true, false]);
  assert.ok(upgradeCalls.every(call => call.options?.env?.PGPASSFILE === join(dataRoot, 'upgrade.pgpass')));
  assert.ok(fake.calls.some(call => call.name === 'postgres:server' && call.executable.includes('postgres-16')), 'the crashed old cluster is replayed with its own binaries first');
  const upgraded = make();
  await upgraded.start();
  assert.equal((await upgraded.status()).state, 'running');
  await upgraded.stop();
});

test('a failed upgrade check leaves the old cluster untouched and records the event', async t => {
  const { pg, root, runtimeRoot, dataRoot } = await setup(t, { failUpgradeCheck: true });
  await olderCluster(dataRoot);
  await runtime(runtimeRoot, 'postgres-16', ['postgres', 'initdb', 'pg_ctl']);
  await pg.start().catch(() => undefined);
  await assert.rejects(pg.upgrade({ backupConfirmed: await vaultCopy(root) }), code('POSTGRES_UPGRADE_CHECK_FAILED'));
  assert.equal((await readFile(join(dataRoot, 'cluster', 'PG_VERSION'), 'utf8')).trim(), '16');
  await assert.rejects(lstat(join(dataRoot, 'cluster.next-17')));
  await assert.rejects(lstat(join(dataRoot, 'cluster.pre-17')));
  const record = JSON.parse(await readFile(join(dataRoot, 'chausar-cluster.json'), 'utf8'));
  assert.equal(record.events.at(-1).kind, 'upgrade-check-failed');
  assert.equal((await pg.status()).state, 'needs-upgrade');
});

test('the default runner uses no shell, bounds output and enforces deadlines', async () => {
  const noisy = await nodePostgresRunner.run(process.execPath, ['-e', 'process.stderr.write("x".repeat(20000)); process.stdout.write("postgres (PostgreSQL) 17.6"); process.exit(3)'], { timeoutMs: 10_000 });
  assert.equal(noisy.code, 3);
  assert.equal(noisy.stderr.length, 4000);
  assert.equal(noisy.stdout, 'postgres (PostgreSQL) 17.6');
  const literal = await nodePostgresRunner.run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(echo injected); true'], { timeoutMs: 10_000 });
  assert.equal(literal.stdout, '$(echo injected); true');
  const slow = await nodePostgresRunner.run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 200 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.code, null);
  const missingBinary = await nodePostgresRunner.run('/nonexistent/postgres', ['--version'], { timeoutMs: 1000 });
  assert.equal(missingBinary.code, null);
  const server = nodePostgresRunner.spawnServer(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {});
  assert.equal(server.exitStatus().exited, false);
  server.kill();
  for (let i = 0; i < 100 && !server.exitStatus().exited; i += 1) await new Promise(accept => setTimeout(accept, 20));
  assert.equal(server.exitStatus().exited, true);
});

test('postgresMajor follows PostgreSQL numbering', () => {
  assert.equal(postgresMajor('17.6'), '17');
  assert.equal(postgresMajor('9.6.24'), '9.6');
  assert.equal(postgresMajor('16'), '16');
  assert.equal(postgresMajor('beta'), null);
});
