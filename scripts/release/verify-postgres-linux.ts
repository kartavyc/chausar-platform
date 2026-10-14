import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';
import { BundledPostgres, linuxOrphanedServerProcesses, type PostgresConnection } from '../../platform/runtime/native/postgres-lifecycle.ts';
import { loadRuntimeSources, selectRuntimeSources, stageRuntime } from './stage-runtime.ts';

/*
 * Real-binary qualification of the bundled PostgreSQL on Linux. Stages (or reuses) the pinned runtime,
 * then drives BundledPostgres against the real binaries: initdb, start, connect and `select 1`, stop,
 * restart on the persisted port, a live foreign lock, `kill -9` crash recovery with WAL replay, data
 * newer than the bundled major, and a pg_upgrade from an older major after a crash, with a vault copy.
 * Prints one JSON receipt. PostgreSQL refuses to run as root: as root, pass `--as-user <name>` and the
 * checks re-run under that account through `runuser` (staging still happens first, as the caller).
 *
 *   node scripts/release/verify-postgres-linux.ts --stage /tmp/runtime [--old-bin /usr/lib/postgresql/16/bin] [--as-user postgres]
 *   node scripts/release/verify-postgres-linux.ts --runtime /tmp/runtime --old-bin /usr/lib/postgresql/16/bin
 *   (--work <dir> puts the data roots in a chosen folder, for example one deeper than the 107-byte socket limit)
 */

export type VerifyStep = { name: string; ok: boolean; ms: number; detail?: Record<string, unknown>; error?: string };
export type VerifyReceipt = {
  format: 'chausar.postgres-real-run.v1';
  startedAt: string;
  host: { platform: NodeJS.Platform; arch: string; uid: number | null; kernel: string };
  runtimeRoot: string;
  bundledVersion: string | null;
  oldVersion: string | null;
  pins: { component: string; version: string; url: string | null; sha256: string | null; checksumSource: string | null }[];
  steps: VerifyStep[];
  ok: boolean;
};
export type VerifyOptions = { runtimeRoot: string; oldBin?: string | null; workRoot?: string; keep?: boolean; portRange?: [number, number]; onStep?: (step: VerifyStep) => void };

type PgClient = { on(event: 'error', listener: (error: Error) => void): void; connect(): Promise<void>; query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>; end(): Promise<void> };
type PgModule = { Client: new (config: Record<string, unknown>) => PgClient };
async function loadPg(): Promise<PgModule> {
  const moduleName = 'pg';
  const loaded = await import(moduleName) as PgModule & { default?: PgModule };
  return loaded.Client ? loaded : loaded.default as PgModule;
}
const pause = (ms: number) => new Promise(accept => setTimeout(accept, ms));
function run(executable: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(accept => {
    const child = spawn(executable, args, { shell: false, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 120_000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-20_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20_000); });
    child.once('error', error => { clearTimeout(deadline); accept({ code: null, stdout, stderr: error.message }); });
    child.once('close', code => { clearTimeout(deadline); accept({ code, stdout, stderr }); });
  });
}
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}
/** Copies a directory tree as regular files (the lifecycle refuses symlinked executables). */
async function copyTree(source: string, target: string): Promise<number> {
  let count = 0;
  await mkdir(target, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    const from = join(source, item.name), to = join(target, item.name);
    if (item.isDirectory()) { count += await copyTree(from, to); continue; }
    const info = await lstat(from);
    if (!info.isFile() && !info.isSymbolicLink()) continue;
    await copyFile(from, to);
    await chmod(to, info.isSymbolicLink() ? 0o755 : info.mode & 0o755);
    count += 1;
  }
  return count;
}
async function versionOf(postgres: string): Promise<string | null> {
  const result = await run(postgres, ['--version']);
  return /\(PostgreSQL\)\s+(\S+)/.exec(result.stdout)?.[1] ?? null;
}
async function client(database: BundledPostgres): Promise<PgClient> {
  const connection: PostgresConnection = database.connection();
  const password = (await readFile(connection.passwordFile, 'utf8')).trim();
  const { Client } = await loadPg();
  const connected = new Client({ host: connection.host, port: connection.port, user: connection.user, database: connection.database, password });
  connected.on('error', () => undefined);
  await connected.connect();
  return connected;
}
async function query<T = Record<string, unknown>>(database: BundledPostgres, text: string, values: unknown[] = []): Promise<T[]> {
  const connected = await client(database);
  try { return (await connected.query(text, values)).rows as T[]; } finally { await connected.end(); }
}
async function refusal(work: () => Promise<unknown>): Promise<string | null> {
  try { await work(); return null; } catch (error) { return (error as { code?: string }).code ?? 'UNCODED'; }
}
async function waitGone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await pause(50);
  }
  return false;
}
async function postmasterPid(dataDirectory: string): Promise<number> {
  const pid = Number((await readFile(join(dataDirectory, 'postmaster.pid'), 'utf8')).split('\n', 1)[0]);
  check(Number.isSafeInteger(pid) && pid > 0, 'VERIFY_POSTMASTER_PID', 'The running cluster has no readable postmaster PID.');
  return pid;
}

/** Runs every real-binary check and returns the receipt; never throws for a failed step. */
export async function verifyBundledPostgres(options: VerifyOptions): Promise<VerifyReceipt> {
  check(isAbsolute(options.runtimeRoot), 'VERIFY_USAGE', 'Provide the staged runtime root as an absolute path.');
  const runtimeRoot = resolve(options.runtimeRoot);
  const kernel = (await run('uname', ['-sr']).catch(() => ({ stdout: '' }))).stdout.trim();
  const receipt: VerifyReceipt = {
    format: 'chausar.postgres-real-run.v1', startedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, uid: typeof process.getuid === 'function' ? process.getuid() : null, kernel },
    runtimeRoot, bundledVersion: await versionOf(join(runtimeRoot, 'postgres', 'bin', 'postgres')),
    oldVersion: options.oldBin ? await versionOf(join(options.oldBin, 'postgres')) : null, pins: [], steps: [], ok: false,
  };
  try {
    const sources = selectRuntimeSources(await loadRuntimeSources(), process.platform, process.arch, { requirePins: false });
    receipt.pins = sources.map(source => ({ component: source.component, version: source.version, url: source.url, sha256: source.sha256, checksumSource: source.checksumSource ?? null }));
  } catch { receipt.pins = []; }
  const work = options.workRoot ?? await mkdtemp(join(tmpdir(), 'chausar-pg-real-'));
  await mkdir(work, { recursive: true, mode: 0o700 });
  const diagnostics: string[] = [];
  const onDiagnostic = (text: string) => { diagnostics.push(text); if (diagnostics.length > 400) diagnostics.shift(); };
  const portRange = options.portRange ?? [56400, 56499];
  const make = (root: string, dataRoot: string) => new BundledPostgres({ runtimeRoot: root, dataRoot, onDiagnostic, portRange, startTimeoutMs: 60_000 });
  const live: BundledPostgres[] = [];
  const step = async (name: string, work: () => Promise<Record<string, unknown> | void>) => {
    const started = Date.now();
    let entry: VerifyStep;
    try { entry = { name, ok: true, ms: 0, detail: (await work()) ?? undefined }; }
    catch (error) {
      const failure = error as { code?: string; message?: string };
      entry = { name, ok: false, ms: 0, error: `${failure.code ?? 'ERROR'}: ${failure.message ?? String(error)}`.slice(0, 2000), detail: { lastDiagnostics: diagnostics.slice(-5).join('').slice(-1500) } };
    }
    entry.ms = Date.now() - started;
    receipt.steps.push(entry);
    options.onStep?.(entry);
    return entry.ok;
  };

  try {
    const main = make(runtimeRoot, join(work, 'main'));
    live.push(main);
    let firstPort = 0;
    if (receipt.host.uid === 0) {
      await step('root-refused', async () => {
        const code = await refusal(() => main.start());
        check(code === 'POSTGRES_RUN_AS_ROOT', 'VERIFY_ROOT', 'Starting as root was not refused with POSTGRES_RUN_AS_ROOT.');
        return { refusal: code };
      });
      await step('unprivileged-account', async () => { check(false, 'VERIFY_RUNNING_AS_ROOT', 'PostgreSQL refuses to run as root; run the checks as an unprivileged account (--as-user).'); });
      return receipt;
    }
    await step('unprivileged-account', async () => ({ uid: receipt.host.uid }));
    await step('initdb-start-select-1', async () => {
      const before = (await main.status()).state;
      const connection = await main.start();
      firstPort = connection.port;
      const [row] = await query<{ one: number; version: string }>(main, 'select 1 as one, version() as version');
      check(row.one === 1, 'VERIFY_SELECT_FAILED', 'select 1 did not return 1.');
      await query(main, 'create table chausar_probe (id integer primary key, note text not null)');
      await query(main, "insert into chausar_probe values (1, 'before restart')");
      const status = await main.status();
      check(status.state === 'running' && status.lock === 'ours', 'VERIFY_STATUS', 'The running cluster did not report itself as running.');
      return { stateBefore: before, port: connection.port, user: connection.user, server: row.version, stateAfter: status.state, passwordFileMode: ((await lstat(connection.passwordFile)).mode & 0o777).toString(8) };
    });
    await step('foreign-lock-refused', async () => {
      const intruder = make(runtimeRoot, join(work, 'main'));
      const status = await intruder.status();
      const code = await refusal(() => intruder.start());
      check(status.lock === 'foreign' && code === 'POSTGRES_DATA_IN_USE', 'VERIFY_FOREIGN_LOCK', 'A second instance did not refuse the live cluster.');
      return { lock: status.lock, refusal: code };
    });
    await step('orderly-stop', async () => {
      await main.stop();
      const status = await main.status();
      check(status.state === 'stopped' && status.lock === 'none' && !(await exists(join(main.dataDirectory, 'postmaster.pid'))), 'VERIFY_STOP', 'The cluster did not stop cleanly.');
      return { state: status.state, lock: status.lock };
    });
    await step('restart-reuses-port', async () => {
      const connection = await main.start();
      check(connection.port === firstPort, 'VERIFY_PORT', 'The restart did not reuse the persisted port.');
      const rows = await query<{ note: string }>(main, 'select note from chausar_probe order by id');
      check(rows.length === 1 && rows[0].note === 'before restart', 'VERIFY_DATA', 'Data written before the restart is missing.');
      return { port: connection.port, rows: rows.length };
    });
    await step('crash-recovery-kill-9', async () => {
      await query(main, "insert into chausar_probe select g, 'committed before kill ' || g from generate_series(2, 1001) g");
      const pid = await postmasterPid(main.dataDirectory);
      process.kill(pid, 'SIGKILL');
      check(await waitGone(pid), 'VERIFY_KILL', 'The postmaster did not die after SIGKILL.');
      const crashed = await main.status();
      check(crashed.lock === 'stale', 'VERIFY_STALE_LOCK', 'The dead postmaster was not seen as a stale lock.');
      const mark = diagnostics.length;
      const started = Date.now();
      const connection = await main.start();
      const restartMs = Date.now() - started;
      const log = diagnostics.slice(mark).join('');
      const replayed = /automatic recovery in progress|redo starts at|redo done at|not properly shut down/.test(log);
      const [count] = await query<{ n: string }>(main, 'select count(*)::text as n from chausar_probe');
      const status = await main.status();
      check(count.n === '1001', 'VERIFY_DATA', 'Committed rows written before the kill did not survive.');
      check(status.lastRecovery?.kind === 'stale-lock-recovered', 'VERIFY_RECOVERY_EVENT', 'The stale-lock recovery was not recorded.');
      check(replayed, 'VERIFY_WAL_REPLAY', 'The server log did not show crash recovery.');
      return { killedPid: pid, lockAfterKill: crashed.lock, port: connection.port, restartMs, walReplayLogged: replayed, rowsAfterRecovery: Number(count.n), lastRecovery: status.lastRecovery?.kind, logLines: log.split('\n').filter(line => /recovery|redo|shut down/.test(line)).slice(0, 6) };
    });
    await step('crash-recovery-busy-backend', async () => {
      const busy = await client(main);
      const running = busy.query('select count(*) from generate_series(1, 3000000000)').then(() => 'finished', () => 'ended by the recovery');
      await pause(500);
      const pid = await postmasterPid(main.dataDirectory);
      process.kill(pid, 'SIGKILL');
      check(await waitGone(pid), 'VERIFY_KILL', 'The postmaster did not die after SIGKILL.');
      const orphans = await linuxOrphanedServerProcesses(main.dataDirectory);
      const started = Date.now();
      const connection = await main.start();
      const restartMs = Date.now() - started;
      const outcome = await running;
      await busy.end().catch(() => undefined);
      const [count] = await query<{ n: string }>(main, 'select count(*)::text as n from chausar_probe');
      const recovery = (await main.status()).lastRecovery;
      check(orphans.length > 0 && Number(recovery?.detail.orphansEnded) === orphans.length, 'VERIFY_ORPHANS', 'The busy backend left by the crash was not found and ended.');
      check(count.n === '1001', 'VERIFY_DATA', 'Committed rows did not survive the second crash.');
      return { killedPid: pid, orphansFound: orphans.length, orphansEnded: recovery?.detail.orphansEnded, busyQuery: outcome, port: connection.port, restartMs, rows: Number(count.n) };
    });
    await step('stop-after-recovery', async () => { await main.stop(); return { state: (await main.status()).state }; });
    await step('newer-data-refused', async () => {
      const newer = make(runtimeRoot, join(work, 'newer'));
      await mkdir(newer.dataRoot, { mode: 0o700 });
      await copyTree(main.dataDirectory, newer.dataDirectory);
      await chmod(newer.dataDirectory, 0o700);
      const bundled = Number((await readFile(join(main.dataDirectory, 'PG_VERSION'), 'utf8')).trim());
      await writeFile(join(newer.dataDirectory, 'PG_VERSION'), `${bundled + 1}\n`);
      await writeFile(newer.passwordFile, await readFile(main.passwordFile, 'utf8'), { mode: 0o600 });
      const status = await newer.status();
      const code = await refusal(() => newer.start());
      check(status.state === 'newer-than-app' && code === 'POSTGRES_DATA_NEWER', 'VERIFY_NEWER', 'A newer cluster was not refused.');
      check(!(await exists(join(newer.dataDirectory, 'postmaster.pid'))), 'VERIFY_NEWER', 'A newer cluster was started.');
      return { marker: bundled + 1, state: status.state, refusal: code };
    });
    if (options.oldBin) {
      const oldVersion = receipt.oldVersion ?? '';
      const oldMajor = /^(\d+)/.exec(oldVersion)?.[1] ?? '';
      const oldRoot = join(work, 'runtime-old');
      const upgradeRoot = join(work, 'runtime-upgrade');
      const upgradeData = join(work, 'upgrade');
      const old = make(oldRoot, upgradeData);
      const fresh = make(upgradeRoot, upgradeData);
      live.push(old, fresh);
      await step('upgrade-prepare-old-cluster', async () => {
        check(oldMajor !== '' && receipt.bundledVersion !== null && Number(oldMajor) < Number(/^(\d+)/.exec(receipt.bundledVersion)?.[1]), 'VERIFY_OLD_MAJOR', 'The old PostgreSQL must be an older major than the bundled one.');
        // A distribution build finds $libdir relative to its bin folder, so the sibling lib/ travels with it.
        const oldLib = join(dirname(options.oldBin as string), 'lib');
        let oldFiles = 0;
        for (const component of [join(oldRoot, 'postgres'), join(upgradeRoot, `postgres-${oldMajor}`)]) {
          oldFiles = await copyTree(options.oldBin as string, join(component, 'bin'));
          if (await exists(oldLib)) oldFiles += await copyTree(oldLib, join(component, 'lib'));
        }
        await copyTree(join(runtimeRoot, 'postgres'), join(upgradeRoot, 'postgres'));
        await old.start();
        await query(old, 'create table ledger (id integer primary key, amount_paise text not null)');
        await query(old, "insert into ledger select g, (g * 100)::text from generate_series(1, 500) g");
        const pid = await postmasterPid(old.dataDirectory);
        process.kill(pid, 'SIGKILL');
        check(await waitGone(pid), 'VERIFY_KILL', 'The old postmaster did not die after SIGKILL.');
        const status = await fresh.status();
        check(status.state === 'needs-upgrade', 'VERIFY_NEEDS_UPGRADE', 'The old cluster was not reported as needing an upgrade.');
        return { oldVersion, oldBinFilesCopied: oldFiles, rows: 500, crashedBeforeUpgrade: true, state: status.state, majorVersion: status.majorVersion, bundledMajor: status.bundledMajor };
      });
      await step('upgrade-refusals', async () => {
        const start = await refusal(() => fresh.start());
        const noProof = await refusal(() => fresh.upgrade({ backupConfirmed: null }));
        check(start === 'POSTGRES_UPGRADE_REQUIRED' && noProof === 'BACKUP_REQUIRED', 'VERIFY_UPGRADE_REFUSALS', 'The upgrade guards did not refuse.');
        return { start, noProof };
      });
      await step('upgrade-with-vault-copy', async () => {
        const vault = join(work, 'vault');
        await mkdir(vault, { mode: 0o700 });
        const copy = join(vault, `cluster-${oldMajor}.tar`);
        const tarred = await run('tar', ['-cf', copy, '-C', upgradeData, 'cluster']);
        check(tarred.code === 0, 'VERIFY_VAULT_COPY', 'The vault copy could not be written.');
        const sha256 = await sha256File(copy);
        const plan = await fresh.planUpgrade();
        const started = Date.now();
        const status = await fresh.upgrade({ backupConfirmed: { path: copy, sha256 } });
        const upgradeMs = Date.now() - started;
        const retained = (await readFile(join(upgradeData, `cluster.pre-${plan.toMajor}`, 'PG_VERSION'), 'utf8')).trim();
        const current = (await readFile(join(upgradeData, 'cluster', 'PG_VERSION'), 'utf8')).trim();
        check(status.state === 'stopped' && current === plan.toMajor && retained === plan.fromMajor, 'VERIFY_UPGRADE', 'The upgraded cluster or the retained old cluster is wrong.');
        await fresh.start();
        const [row] = await query<{ n: string; total: string }>(fresh, 'select count(*)::text as n, sum(amount_paise::bigint)::text as total from ledger');
        const [server] = await query<{ server_version: string }>(fresh, 'show server_version');
        check(row.n === '500' && row.total === '12525000', 'VERIFY_DATA', 'Data did not survive the upgrade.');
        const leftovers = (await readdir(upgradeData)).sort();
        await fresh.stop();
        return { from: plan.fromMajor, to: plan.toMajor, link: plan.link, vaultCopy: { bytes: (await lstat(copy)).size, sha256 }, upgradeMs, state: status.state, lastUpgrade: status.lastUpgrade?.kind, retainedPgVersion: retained, serverVersion: server.server_version, rows: Number(row.n), totalPaise: row.total, dataRootEntries: leftovers };
      });
    }
  } finally {
    for (const database of live) await database.stop().catch(() => undefined);
    if (!options.keep && !options.workRoot) await rm(work, { recursive: true, force: true });
  }
  receipt.ok = receipt.steps.length > 0 && receipt.steps.every(entry => entry.ok);
  return receipt;
}

type CliOptions = { runtime: string | null; stage: string | null; oldBin: string | null; asUser: string | null; work: string | null; keep: boolean };
export function parseVerifyArguments(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  let keep = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--keep') { keep = true; continue; }
    check(['--runtime', '--stage', '--old-bin', '--as-user', '--work'].includes(argv[index]) && argv[index + 1] !== undefined && !values.has(argv[index]), 'VERIFY_USAGE', 'Usage: node scripts/release/verify-postgres-linux.ts (--runtime dir | --stage dir) [--old-bin dir] [--as-user name] [--work dir] [--keep]');
    values.set(argv[index], argv[index += 1]);
  }
  check(values.has('--runtime') !== values.has('--stage'), 'VERIFY_USAGE', 'Pass exactly one of --runtime (reuse a staged runtime) or --stage (stage it first).');
  check(values.get('--as-user') === undefined || /^[a-z_][a-z0-9_-]{0,31}$/.test(values.get('--as-user') as string), 'VERIFY_USAGE', 'The account name is not a plain user name.');
  const absolute = (value: string | undefined) => value === undefined ? null : resolve(value);
  return { runtime: absolute(values.get('--runtime')), stage: absolute(values.get('--stage')), oldBin: absolute(values.get('--old-bin')), asUser: values.get('--as-user') ?? null, work: absolute(values.get('--work')), keep };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.platform === 'linux', 'VERIFY_LINUX_ONLY', 'This verification runs on Linux.');
    const options = parseVerifyArguments(process.argv.slice(2));
    let runtimeRoot = options.runtime as string;
    let staging: { ms: number; files: number } | null = null;
    if (options.stage) {
      const started = Date.now();
      const manifest = await stageRuntime({ platform: process.platform, architecture: process.arch, out: options.stage, replace: true, onNote: text => console.error(text) });
      staging = { ms: Date.now() - started, files: manifest.files.length };
      runtimeRoot = options.stage;
    }
    if (options.asUser && process.getuid?.() === 0) {
      const args = [process.execPath, fileURLToPath(import.meta.url), '--runtime', runtimeRoot, ...(options.oldBin ? ['--old-bin', options.oldBin] : []), ...(options.work ? ['--work', options.work] : []), ...(options.keep ? ['--keep'] : [])];
      const child = spawn('runuser', ['-u', options.asUser, '--', ...args], { stdio: ['ignore', 'pipe', 'inherit'], cwd: dirname(fileURLToPath(import.meta.url)), env: { ...process.env, HOME: tmpdir(), TMPDIR: tmpdir() } });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      const code = await new Promise<number | null>(accept => child.once('close', accept));
      const receipt = JSON.parse(output) as VerifyReceipt & { ranAs?: string; staging?: unknown };
      console.log(JSON.stringify({ ...receipt, ranAs: options.asUser, staging }, null, 2));
      process.exitCode = code ?? 1;
    } else {
      const receipt = await verifyBundledPostgres({ runtimeRoot, oldBin: options.oldBin, workRoot: options.work ?? undefined, keep: options.keep, onStep: entry => console.error(`${entry.ok ? 'pass' : 'FAIL'} ${entry.name} (${entry.ms} ms)${entry.error ? ` ${entry.error}` : ''}`) });
      console.log(JSON.stringify({ ...receipt, staging }, null, 2));
      process.exitCode = receipt.ok ? 0 : 1;
    }
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    console.error(`${failure.code ?? 'VERIFY_FAILED'}: ${failure.message ?? 'The PostgreSQL verification failed.'}`);
    process.exitCode = 1;
  }
}
