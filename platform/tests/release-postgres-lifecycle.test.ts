import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BundledPostgres, darwinOrphans, nodePostgresRunner, parseDarwinProcessList, parseWindowsProcessList, postgresClusterName, postgresMajor, splitWindowsCommandLine, windowsOrphans, type BundledPostgresOptions, type OrphanScan, type PostgresRunner, type PostgresRunOptions, type PostgresServerProcess } from '../runtime/native/postgres-lifecycle.ts';

type Call = { name: string; executable: string; args: string[]; options?: PostgresRunOptions };
const DEAD_PID = 2_147_483_646;

/** Emulates initdb, postgres (a TCP listener plus postmaster.pid), pg_ctl stop, `postgres --version` and pg_upgrade. */
function fakeRunner(settings: { bundled?: string; failFastStop?: boolean; failUpgradeCheck?: boolean; neverReady?: boolean; ps?: string; powershell?: string } = {}) {
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
      const name = (executable.split(/[\\/]/).pop() as string).replace(/\.exe$/, '');
      calls.push({ name, executable, args, options });
      const ok = { code: 0, stdout: '', stderr: '', timedOut: false };
      if (name === 'postgres' && args[0] === '--version') return { ...ok, stdout: `postgres (PostgreSQL) ${versionOf(executable)}\n` };
      if (name === 'ps') return settings.ps === undefined ? { ...ok, code: 1 } : { ...ok, stdout: settings.ps };
      if (name === 'powershell') return settings.powershell === undefined ? { ...ok, code: 1 } : { ...ok, stdout: settings.powershell };
      if (name === 'taskkill') return ok;
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
      const name = (executable.split(/[\\/]/).pop() as string).replace(/\.exe$/, '');
      calls.push({ name: `${name}:server`, executable, args });
      const directory = option(args, '-D');
      const port = Number(option(args, '-p'));
      const server = createServer(socket => socket.destroy());
      const entry = { server, exited: false };
      servers.set(directory, entry);
      server.once('error', () => { entry.exited = true; });
      writeFileSync(join(directory, 'postmaster.pid'), `${process.pid}\n${directory}\n0\n${port}\n\n127.0.0.1\n0\n${settings.neverReady ? 'starting' : 'ready   '}\n`);
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
async function setup(t: TestContext, settings: Parameters<typeof fakeRunner>[0] = {}, options: Partial<BundledPostgresOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-pg-'));
  const runtimeRoot = join(root, 'runtime-binaries');
  const dataRoot = join(root, 'database');
  await runtime(runtimeRoot);
  const fake = fakeRunner(settings);
  const port = 56000 + Math.floor(Math.random() * 800);
  const make = () => new BundledPostgres({ runtimeRoot, dataRoot, runner: fake.runner, portRange: [port, port + 40], platform: 'linux', startTimeoutMs: 5000, ...options });
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
  for (const arg of ['unix_socket_directories=', 'fsync=on', 'password_encryption=scram-sha-256', `cluster_name=${postgresClusterName(join(dataRoot, 'cluster'))}`]) assert.ok(server.args.includes(arg), arg);
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

test('an open port is not readiness: start waits for the lock file to say ready', async t => {
  const { pg } = await setup(t, { neverReady: true }, { startTimeoutMs: 600 });
  await assert.rejects(pg.start(), code('POSTGRES_START_TIMEOUT'));
});

test('as root, start and upgrade refuse before running any PostgreSQL program', async t => {
  const { pg, root, fake } = await setup(t, {}, { effectiveUid: () => 0 });
  await assert.rejects(pg.start(), code('POSTGRES_RUN_AS_ROOT'));
  await assert.rejects(pg.upgrade({ backupConfirmed: await vaultCopy(root) }), code('POSTGRES_RUN_AS_ROOT'));
  assert.deepEqual(fake.calls, []);
  const windows = new BundledPostgres({ runtimeRoot: join(root, 'rt'), dataRoot: join(root, 'db'), platform: 'win32', effectiveUid: () => 0, runner: fake.runner });
  await assert.rejects(windows.start(), code('POSTGRES_RUNTIME_MISSING'), 'Windows has no root refusal');
});

test('server processes a crashed postmaster left behind are ended before the restart', async t => {
  const alive = new Set([4242]);
  const killed: number[] = [];
  const { pg, dataRoot } = await setup(t, {}, {
    processAlive: pid => alive.has(pid),
    orphanedServerProcesses: async directory => { assert.equal(directory, join(dataRoot, 'cluster')); return [...alive]; },
    killProcess: pid => { killed.push(pid); alive.delete(pid); },
  });
  await pg.start(); await pg.stop();
  await writeFile(join(dataRoot, 'cluster', 'postmaster.pid'), `${DEAD_PID}\n`);
  await pg.start();
  assert.deepEqual(killed, [4242]);
  assert.equal((await pg.status()).lastRecovery?.detail.orphansEnded, 1);
  await pg.stop();
  const stubborn = await setup(t, {}, { startTimeoutMs: 400, processAlive: pid => pid === 4343, orphanedServerProcesses: async () => [4343], killProcess: () => undefined });
  await stubborn.pg.start(); await stubborn.pg.stop();
  await writeFile(join(stubborn.dataRoot, 'cluster', 'postmaster.pid'), `${DEAD_PID}\n`);
  await assert.rejects(stubborn.pg.start(), code('POSTGRES_STALE_PROCESSES'));
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
  const workFolder = upgradeCalls[0].options?.cwd as string;
  assert.ok(workFolder && !workFolder.startsWith(dataRoot) && basename(workFolder).startsWith('chausar-pgu-'), 'pg_upgrade runs from a private folder outside the data root');
  assert.ok(upgradeCalls.every(call => call.options?.cwd === workFolder && call.args[call.args.indexOf('--socketdir') + 1] === workFolder), 'its sockets go to the short private folder');
  await assert.rejects(access(workFolder), 'the private folder, with pg_upgrade\'s delete_old_cluster script, is removed');
  assert.deepEqual((await readdir(dataRoot)).sort(), ['chausar-cluster.json', 'cluster', 'cluster.pre-17', 'database-password']);
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

test('the cluster name in every process title is stable per data directory and a valid cluster_name', () => {
  const name = postgresClusterName('/home/a/.config/Chausar/database/cluster');
  assert.match(name, /^chausar-[a-f0-9]{16}$/);
  assert.ok(name.length < 64, 'cluster_name must fit NAMEDATALEN');
  assert.equal(postgresClusterName('/home/a/.config/Chausar/database/./cluster'), name);
  assert.notEqual(postgresClusterName('/home/b/.config/Chausar/database/cluster'), name);
});

// Captured-shape `ps -axww -o pid=,ppid=,uid=,command=` output from macOS after a SIGKILL of the postmaster (synthetic).
const DARWIN_DATA = '/Users/asha/Library/Application Support/Chausar/database/cluster';
const DARWIN_EXE = '/Applications/Chausar.app/Contents/Resources/runtime-binaries/postgres/bin/postgres';
const darwinScan = (): OrphanScan => ({ postmasterPid: 4100, clusterName: postgresClusterName(DARWIN_DATA), postgresExecutable: DARWIN_EXE, uid: 501 });
const darwinPs = () => {
  const ours = postgresClusterName(DARWIN_DATA), other = postgresClusterName('/Users/asha/elsewhere/cluster');
  return [
    '    1     0     0 /sbin/launchd',
    `  412     1   501 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder`,
    ` 4123     1   501 postgres: ${ours}: chausar postgres 127.0.0.1(50432) SELECT`,
    ` 4124     1   501 postgres: ${ours}: checkpointer `,
    ` 4125     1   501 postgres: ${ours}: walwriter`,
    ` 4126  4200   501 postgres: ${ours}: chausar postgres 127.0.0.1(50433) idle`,
    ` 4127     1   502 postgres: ${ours}: chausar postgres 127.0.0.1(50434) idle`,
    ` 4128     1   501 postgres: ${ours}-evil: chausar postgres 127.0.0.1(50435) idle`,
    ` 4129     1   501 postgres: ${other}: chausar postgres 127.0.0.1(50436) idle`,
    ` 4130     1   501 postgres: chausar postgres 127.0.0.1(50437) idle`,
    ` 4131     1   501 ${DARWIN_EXE} -D ${DARWIN_DATA} -h 127.0.0.1 -p 55400 -c cluster_name=${ours}`,
    ` 4132     1   501 ${DARWIN_EXE} -D ${DARWIN_DATA}-copy -h 127.0.0.1 -p 55401`,
    ` 4133     1   501 /usr/local/bin/postgres -D ${DARWIN_DATA} -h 127.0.0.1 -p 55400`,
    ` 4134     1   501 /bin/sh -c echo postgres: ${ours}: fake`,
    'garbage line without numbers',
    '',
  ].join('\n');
};

test('macOS sweep: parses ps output and ends only orphans provably this cluster’s (title or exact -D, parent launchd, same user)', () => {
  const rows = parseDarwinProcessList(darwinPs());
  assert.equal(rows.length, 14);
  assert.deepEqual(rows.find(row => row.pid === 4124), { pid: 4124, ppid: 1, uid: 501, executable: null, command: `postgres: ${postgresClusterName(DARWIN_DATA)}: checkpointer ` });
  assert.deepEqual(darwinOrphans(rows, DARWIN_DATA, darwinScan(), 99999), [4123, 4124, 4125, 4131]);
  // 4126: parent still alive (not reparented); 4127: another user; 4128/4129/4130: other or no cluster name;
  // 4132: another data folder; 4133: another postgres executable; 4134: a shell that merely prints the title.
  assert.deepEqual(darwinOrphans(rows, DARWIN_DATA, { ...darwinScan(), uid: null }), [], 'an unknown user id matches nothing');
  assert.deepEqual(darwinOrphans(rows, DARWIN_DATA, darwinScan(), 4123), [4124, 4125, 4131], 'never the calling process');
  assert.deepEqual(parseDarwinProcessList(''), []);
});

// Captured-shape `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress` (synthetic).
const WIN_EXE = 'C:\\Users\\Asha\\AppData\\Local\\Programs\\Chausar\\resources\\runtime-binaries\\postgres\\bin\\postgres.exe';
const WIN_DATA = 'C:\\Users\\Asha\\AppData\\Roaming\\Chausar\\database\\cluster';
const winScan = (): OrphanScan => ({ postmasterPid: 7000, clusterName: postgresClusterName(WIN_DATA), postgresExecutable: WIN_EXE, uid: null });
const winRows = () => [
  { ProcessId: 7101, ParentProcessId: 7000, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" --forkchild="backend" 7368` },
  { ProcessId: 7102, ParentProcessId: 7000, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" --forkbackend 7369` },
  { ProcessId: 7103, ParentProcessId: 7000, ExecutablePath: WIN_EXE.toUpperCase(), CommandLine: `"${WIN_EXE}" --forkchild="checkpointer" 7370` },
  { ProcessId: 7201, ParentProcessId: 8000, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" --forkchild="backend" 7371` },
  { ProcessId: 7202, ParentProcessId: 9000, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" --forkchild="backend" 7372` },
  { ProcessId: 7301, ParentProcessId: 7000, ExecutablePath: 'C:\\Program Files\\PostgreSQL\\17\\bin\\postgres.exe', CommandLine: '"C:\\Program Files\\PostgreSQL\\17\\bin\\postgres.exe" --forkchild="backend" 1' },
  { ProcessId: 7302, ParentProcessId: 7000, ExecutablePath: null, CommandLine: null },
  { ProcessId: 7401, ParentProcessId: 1200, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" -D "${WIN_DATA.toLowerCase()}" -h 127.0.0.1 -p 55400 -c cluster_name=x` },
  { ProcessId: 7402, ParentProcessId: 1200, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" -D "${WIN_DATA}-old" -h 127.0.0.1 -p 55401` },
  { ProcessId: 7403, ParentProcessId: 1200, ExecutablePath: WIN_EXE, CommandLine: `"${WIN_EXE}" -h 127.0.0.1 -p 55402` },
];

test('Windows sweep: parses Win32_Process JSON and ends only the bundled postgres.exe children of the dead postmaster or -D on this folder', () => {
  const alive = (pid: number) => pid === 9000;
  const rows = parseWindowsProcessList(JSON.stringify(winRows()));
  assert.equal(rows.length, 10);
  assert.deepEqual(windowsOrphans(rows, WIN_DATA, winScan(), alive, 1), [7101, 7102, 7103, 7401]);
  // 7201: another postmaster's child; 7202: parent 9000 is alive; 7301: another installation; 7302: unreadable
  // (another user); 7402: another folder; 7403: no -D.
  assert.deepEqual(windowsOrphans(rows, WIN_DATA, { ...winScan(), postmasterPid: null }, alive, 1), [7401], 'without the dead postmaster PID no forked child is provably ours');
  assert.deepEqual(windowsOrphans(rows, WIN_DATA, { ...winScan(), postmasterPid: 9000 }, alive, 1), [7401], 'a live parent is never treated as dead');
  assert.deepEqual(parseWindowsProcessList(JSON.stringify(winRows()[0])).map(row => row.pid), [7101], 'one process is a JSON object, not an array');
  assert.deepEqual(parseWindowsProcessList(''), []);
  assert.deepEqual(parseWindowsProcessList('not json'), []);
  assert.deepEqual(parseWindowsProcessList(JSON.stringify([...winRows(), { ProcessId: '12', ParentProcessId: 1 }])), [], 'a malformed row discards the whole scan');
  assert.deepEqual(splitWindowsCommandLine('"C:\\Program Files\\pg\\postgres.exe" -D "C:\\a b\\cluster" -c x=1'), ['C:\\Program Files\\pg\\postgres.exe', '-D', 'C:\\a b\\cluster', '-c', 'x=1']);
  assert.deepEqual(splitWindowsCommandLine('a\\\\\\"b "c\\\\" d'), ['a\\"b', 'c\\', 'd']);
  assert.deepEqual(splitWindowsCommandLine('  --forkchild="backend"   12 '), ['--forkchild=backend', '12']);
});

test('macOS and Windows restarts run the sweep through the runner, then end the orphans (taskkill on Windows)', async t => {
  const darwinAlive = new Set([4123]);
  const killed: number[] = [];
  const mac = await setup(t, {}, { platform: 'darwin', effectiveUid: () => 501, processAlive: pid => darwinAlive.has(pid), killProcess: pid => { killed.push(pid); darwinAlive.delete(pid); } });
  await mac.pg.start(); await mac.pg.stop();
  const executable = join(mac.runtimeRoot, 'postgres', 'bin', 'postgres');
  const cluster = join(mac.dataRoot, 'cluster');
  const ps = [`   1 0 0 /sbin/launchd`, ` 4123 1 501 postgres: ${postgresClusterName(cluster)}: chausar postgres 127.0.0.1(50432) SELECT`, ` 4129 1 501 postgres: ${postgresClusterName('/elsewhere')}: idle`, ` 4131 1 501 ${executable} -D ${cluster}-other -h 127.0.0.1`].join('\n');
  const macSweep = new BundledPostgres({ runtimeRoot: mac.runtimeRoot, dataRoot: mac.dataRoot, runner: fakeRunner({ ps }).runner, portRange: [56900, 56940], platform: 'darwin', effectiveUid: () => 501, processAlive: pid => darwinAlive.has(pid), killProcess: pid => { killed.push(pid); darwinAlive.delete(pid); }, startTimeoutMs: 5000 });
  await writeFile(join(cluster, 'postmaster.pid'), `${DEAD_PID}\n`);
  await macSweep.start();
  assert.deepEqual(killed, [4123]);
  assert.equal((await macSweep.status()).lastRecovery?.detail.orphansEnded, 1);
  await macSweep.stop();

  const root = await mkdtemp(join(tmpdir(), 'chausar-pg-win-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = join(root, 'runtime-binaries'), dataRoot = join(root, 'database');
  await runtime(runtimeRoot, 'postgres', ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_upgrade.exe']);
  const winAlive = new Set<number>();
  const first = fakeRunner();
  const windows = (runner: PostgresRunner) => new BundledPostgres({ runtimeRoot, dataRoot, runner, portRange: [56950, 56990], platform: 'win32', processAlive: pid => winAlive.has(pid), startTimeoutMs: 5000 });
  const initial = windows(first.runner);
  await initial.start(); await initial.stop(); await first.closeAll();
  const exe = join(runtimeRoot, 'postgres', 'bin', 'postgres.exe');
  winAlive.add(7101);
  const second = fakeRunner({ powershell: JSON.stringify([{ ProcessId: 7101, ParentProcessId: DEAD_PID, ExecutablePath: exe, CommandLine: `"${exe}" --forkchild="backend" 1` }, { ProcessId: 7201, ParentProcessId: 8000, ExecutablePath: exe, CommandLine: `"${exe}" --forkchild="backend" 2` }]) });
  const originalRun = second.runner.run;
  second.runner.run = async (executable, args, options) => { if (/taskkill/.test(executable)) winAlive.delete(Number(args[1])); return originalRun(executable, args, options); };
  t.after(() => second.closeAll());
  await writeFile(join(dataRoot, 'cluster', 'postmaster.pid'), `${DEAD_PID}\n`);
  const recovered = windows(second.runner);
  await recovered.start();
  const sweep = second.calls.find(call => call.name === 'powershell');
  assert.ok(sweep && /WindowsPowerShell\\v1\.0\\powershell\.exe$/.test(sweep.executable), 'PowerShell is run by absolute path');
  assert.deepEqual(sweep.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(sweep.args[3], /Win32_Process/);
  const kills = second.calls.filter(call => call.name === 'taskkill');
  assert.deepEqual(kills.map(call => call.args), [['/PID', '7101', '/F']], 'only the dead postmaster’s child is ended');
  assert.ok(/System32\\taskkill\.exe$/.test(kills[0].executable));
  assert.equal((await recovered.status()).lastRecovery?.detail.orphansEnded, 1);
  await recovered.stop();
});
