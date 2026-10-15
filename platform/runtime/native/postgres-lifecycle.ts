import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { check } from '../contracts.ts';

/**
 * Lifecycle of the bundled PostgreSQL cluster: binaries from `runtime-binaries/postgres/bin`,
 * a private data root (`cluster/`, `database-password`, `chausar-cluster.json`), loopback-only
 * start, orderly stop, stale-lock recovery and a pg_upgrade path that never uses `--link`.
 * Every process goes through a `PostgresRunner` so tests can substitute a fake.
 */

export type PostgresRunOptions = { timeoutMs: number; cwd?: string; env?: Record<string, string> };
export type PostgresRunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };
export type PostgresExitStatus = { exited: boolean; code: number | null; failed: boolean };
export interface PostgresServerProcess {
  readonly pid: number | undefined;
  exitStatus(): PostgresExitStatus;
  kill(): void;
}
export interface PostgresRunner {
  run(executable: string, args: string[], options: PostgresRunOptions): Promise<PostgresRunResult>;
  spawnServer(executable: string, args: string[], options: { env?: Record<string, string>; onDiagnostic?: (text: string) => void }): PostgresServerProcess;
}

const OUTPUT_LIMIT = 4000;
const bounded = (current: string, chunk: Buffer | string) => (current + chunk.toString()).slice(-OUTPUT_LIMIT);

/** Real process runner: no shell, hidden windows, bounded output, hard deadline. */
export const nodePostgresRunner: PostgresRunner = {
  run(executable, args, options) {
    return new Promise(accept => {
      const child = spawn(executable, args, { shell: false, windowsHide: true, cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', timedOut = false, settled = false;
      const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(deadline); accept({ code, stdout, stderr, timedOut }); };
      const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs);
      child.stdout.on('data', chunk => { stdout = bounded(stdout, chunk); });
      child.stderr.on('data', chunk => { stderr = bounded(stderr, chunk); });
      child.once('error', error => { stderr = bounded(stderr, error.message); finish(null); });
      child.once('close', code => finish(timedOut ? null : code));
    });
  },
  spawnServer(executable, args, options) {
    const child = spawn(executable, args, { shell: false, windowsHide: true, env: options.env, stdio: ['ignore', 'ignore', 'pipe'] });
    const status: PostgresExitStatus = { exited: false, code: null, failed: false };
    child.once('error', () => { status.exited = true; status.failed = true; });
    child.once('exit', code => { status.exited = true; status.code = code; status.failed = code !== 0; });
    child.stderr.on('data', chunk => options.onDiagnostic?.(chunk.toString().slice(-OUTPUT_LIMIT)));
    return { pid: child.pid, exitStatus: () => ({ ...status }), kill: () => { if (!status.exited) child.kill('SIGKILL'); } };
  },
};

export type PostgresState = 'absent' | 'uninitialized' | 'stopped' | 'running' | 'needs-upgrade' | 'newer-than-app' | 'unavailable';
export type PostgresEventKind = 'stale-lock-recovered' | 'immediate-stop' | 'forced-kill' | 'upgrade-completed' | 'upgrade-check-failed' | 'upgrade-failed';
export type PostgresEvent = { at: string; kind: PostgresEventKind; detail: Record<string, string | number | null> };
export type PostgresLock = 'none' | 'stale' | 'ours' | 'foreign';
export type PostgresStatus = {
  state: PostgresState;
  majorVersion: string | null;
  bundledMajor: string | null;
  port: number | null;
  dataDirectory: string;
  lock: PostgresLock;
  /** Refusal code explaining `unavailable`; null otherwise. */
  reason: string | null;
  lastRecovery: PostgresEvent | null;
  lastUpgrade: PostgresEvent | null;
};
export type PostgresConnection = { host: '127.0.0.1'; port: number; user: string; database: string; passwordFile: string };
export type PostgresUpgradeStep = { name: 'initdb' | 'check' | 'upgrade'; executable: string; args: string[] };
export type PostgresUpgradePlan = {
  fromMajor: string;
  toMajor: string;
  oldBinDirectory: string;
  newBinDirectory: string;
  oldDataDirectory: string;
  newDataDirectory: string;
  /** The pre-upgrade cluster is kept here after the swap: `cluster.pre-<toMajor>`. */
  retainedDataDirectory: string;
  link: false;
  /** `upgrade()` runs the check and upgrade steps from a private short temporary folder, passed as `--socketdir`. */
  steps: PostgresUpgradeStep[];
};
export type BackupProof = { path: string; sha256: string };
export type BundledPostgresOptions = {
  /** Absolute `runtime-binaries` directory for the running target. */
  runtimeRoot: string;
  /** Absolute private folder holding `cluster/`, `database-password` and `chausar-cluster.json`. */
  dataRoot: string;
  user?: string;
  database?: string;
  platform?: NodeJS.Platform;
  portRange?: [number, number];
  runner?: PostgresRunner;
  startTimeoutMs?: number;
  commandTimeoutMs?: number;
  upgradeTimeoutMs?: number;
  processAlive?: (pid: number) => boolean;
  onDiagnostic?: (text: string) => void;
  now?: () => string;
  /**
   * Effective user id; PostgreSQL refuses to run as root (0). Defaults to the process's own id with the real
   * runner and to null (not checked) with a substitute runner, which decides how its processes run.
   */
  effectiveUid?: () => number | null;
  /**
   * Server processes a dead postmaster left running on this data directory. Defaults to a /proc scan on Linux
   * (real runner only), `ps` on macOS and PowerShell's Win32_Process on Windows (both through the runner).
   */
  orphanedServerProcesses?: (dataDirectory: string, scan: OrphanScan) => Promise<number[]>;
  /** Ends an orphaned server process: SIGKILL by default, `taskkill /PID n /F` through the runner on Windows. */
  killProcess?: (pid: number) => void | Promise<void>;
};
/** What a sweep may use to prove a process belongs to this cluster. */
export type OrphanScan = {
  /** The dead postmaster's PID from the stale lock file, when readable. */
  postmasterPid: number | null;
  /** `cluster_name` the lifecycle starts every server with; PostgreSQL puts it in each process title. */
  clusterName: string;
  /** Absolute path of the `postgres` executable that served this data directory. */
  postgresExecutable: string;
  /** Effective user id (macOS); null when unknown. */
  uid: number | null;
};
export type ProcessRow = { pid: number; ppid: number; uid: number | null; executable: string | null; command: string };

type Executables = { binDirectory: string; postgres: string; initdb: string; pgCtl: string; pgUpgrade: string };
type ClusterRecord = { schemaVersion: 1; port: number | null; events: PostgresEvent[] };
type ClusterInspection = { exists: boolean; initialized: boolean; major: string | null; empty: boolean };

const RECORD_FILE = 'chausar-cluster.json';
const PASSWORD_FILE = 'database-password';
const CLUSTER_DIRECTORY = 'cluster';
const PASSWORD = /^[A-Za-z0-9_-]{43}$/;
const MAJOR = /^\d+(?:\.\d+)?$/;
const RECOVERY_KINDS: PostgresEventKind[] = ['stale-lock-recovered', 'immediate-stop', 'forced-kill'];

/** Paths of a PostgreSQL bin directory: `<runtimeRoot>/<component>/bin/{postgres,initdb,pg_ctl,pg_upgrade}[.exe]`. */
export function postgresExecutables(runtimeRoot: string, platform: NodeJS.Platform = process.platform, component = 'postgres'): Executables {
  const extension = platform === 'win32' ? '.exe' : '';
  const binDirectory = join(runtimeRoot, component, 'bin');
  return { binDirectory, postgres: join(binDirectory, `postgres${extension}`), initdb: join(binDirectory, `initdb${extension}`), pgCtl: join(binDirectory, `pg_ctl${extension}`), pgUpgrade: join(binDirectory, `pg_upgrade${extension}`) };
}
/** PostgreSQL's major: the first number from 10 onward, the first two numbers before 10. */
export function postgresMajor(version: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!match) return null;
  return Number(match[1]) >= 10 || match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}
const compareMajor = (left: string, right: string) => {
  const [a1, a2 = 0] = left.split('.').map(Number); const [b1, b2 = 0] = right.split('.').map(Number);
  return a1 !== b1 ? a1 - b1 : a2 - b2;
};
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const pause = (ms: number) => new Promise(accept => setTimeout(accept, ms));
export function defaultProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
async function vacant(port: number): Promise<boolean> {
  const server = createServer();
  const bound = await new Promise<boolean>(accept => { server.once('error', () => accept(false)); server.listen({ port, host: '127.0.0.1', exclusive: true }, () => accept(true)); });
  if (bound) await new Promise<void>(accept => server.close(() => accept()));
  return bound;
}
function listening(port: number): Promise<boolean> {
  return new Promise(accept => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (value: boolean) => { socket.destroy(); accept(value); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(250, () => done(false));
  });
}
/**
 * Linux: after a `kill -9` of the postmaster, a backend busy in a query keeps running and keeps the old shared
 * memory attached, so a new postmaster refuses to start. Such processes run the `postgres` executable with the
 * data directory as their working directory. Only processes of the same user can be read here.
 */
export async function linuxOrphanedServerProcesses(dataDirectory: string): Promise<number[]> {
  let real: string, entries: string[];
  try { real = await realpath(dataDirectory); entries = await readdir('/proc'); } catch { return []; }
  const found: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (await readlink(`/proc/${entry}/cwd`) !== real) continue;
      if (basename(await readlink(`/proc/${entry}/exe`)).replace(/ \(deleted\)$/, '') === 'postgres') found.push(Number(entry));
    } catch { /* another user's process, or gone */ }
  }
  return found;
}
/** Stable per data directory; started as `cluster_name`, so every backend's process title names its cluster. */
export function postgresClusterName(dataDirectory: string): string {
  return `chausar-${createHash('sha256').update(resolve(dataDirectory)).digest('hex').slice(0, 16)}`;
}
/** Rows of `ps -axww -o pid=,ppid=,uid=,command=`; lines that do not parse are skipped. */
export function parseDarwinProcessList(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,10})\s+(\d{1,10})\s+(\d{1,10})\s(.*)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), executable: null, command: match[4].trimStart() });
  }
  return rows;
}
/**
 * macOS: a postmaster killed with SIGKILL leaves its children reparented to launchd (PID 1). A process is this
 * cluster's only when it runs as the same user, its parent is PID 1, and either its title starts with
 * `postgres: <cluster_name>: ` or it is the bundled `postgres` executable started with `-D <dataDirectory>`.
 */
export function darwinOrphans(rows: ProcessRow[], dataDirectory: string, scan: OrphanScan, selfPid = process.pid): number[] {
  const title = `postgres: ${scan.clusterName}: `, postmaster = `${scan.postgresExecutable} -D ${dataDirectory} `;
  return rows.filter(row => row.pid > 1 && row.pid !== selfPid && row.ppid === 1 && scan.uid !== null && row.uid === scan.uid
    && (row.command.startsWith(title) || row.command.startsWith(postmaster))).map(row => row.pid);
}
export async function darwinOrphanedServerProcesses(runner: PostgresRunner, dataDirectory: string, scan: OrphanScan): Promise<number[]> {
  const listed = await runner.run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,uid=,command='], { timeoutMs: 15_000 });
  return listed.code === 0 ? darwinOrphans(parseDarwinProcessList(listed.stdout), dataDirectory, scan) : [];
}
/** Windows command-line splitting (CommandLineToArgvW rules for quotes and backslashes). */
export function splitWindowsCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = '', quoted = false, started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\') {
      let count = 0;
      while (line[index] === '\\') { count += 1; index += 1; }
      if (line[index] === '"') { current += '\\'.repeat(count >> 1); if (count % 2) current += '"'; else { quoted = !quoted; } }
      else { current += '\\'.repeat(count); index -= 1; }
      started = true;
    } else if (char === '"') { quoted = !quoted; started = true; }
    else if ((char === ' ' || char === '\t') && !quoted) { if (started) args.push(current); current = ''; started = false; }
    else { current += char; started = true; }
  }
  if (started) args.push(current);
  return args;
}
/** Rows from `ConvertTo-Json` of Win32_Process (one object or an array); anything malformed yields no rows. */
export function parseWindowsProcessList(text: string): ProcessRow[] {
  let value: unknown;
  try { value = text.trim() ? JSON.parse(text) : []; } catch { return []; }
  const items = Array.isArray(value) ? value : [value];
  const rows: ProcessRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return [];
    const { ProcessId: pid, ParentProcessId: ppid, ExecutablePath: executable, CommandLine: command } = item as Record<string, unknown>;
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || (executable !== null && typeof executable !== 'string') || (command !== null && typeof command !== 'string')) return [];
    rows.push({ pid: pid as number, ppid: ppid as number, uid: null, executable: executable as string | null, command: (command as string | null) ?? '' });
  }
  return rows;
}
const windowsPath = (path: string) => win32.normalize(path).toLowerCase();
/**
 * Windows: there is no reparenting, so a backend forked by the dead postmaster still names it as its parent. A
 * process is this cluster's only when it is the bundled `postgres.exe` (same executable path) and either it is a
 * forked child (`--fork…`) whose recorded parent is the dead postmaster from the lock file and is not running,
 * or it was started with `-D <dataDirectory>`.
 */
export function windowsOrphans(rows: ProcessRow[], dataDirectory: string, scan: OrphanScan, alive: (pid: number) => boolean, selfPid = process.pid): number[] {
  const executable = windowsPath(scan.postgresExecutable), directory = windowsPath(dataDirectory);
  return rows.filter(row => {
    if (row.pid <= 4 || row.pid === selfPid || !row.executable || windowsPath(row.executable) !== executable) return false;
    const args = splitWindowsCommandLine(row.command).slice(1);
    const forked = args.some(arg => arg.startsWith('--fork'));
    if (forked) return scan.postmasterPid !== null && row.ppid === scan.postmasterPid && !alive(row.ppid);
    const flag = args.indexOf('-D');
    return flag >= 0 && args[flag + 1] !== undefined && windowsPath(args[flag + 1]) === directory;
  }).map(row => row.pid);
}
const systemRoot = () => process.env.SystemRoot && win32.isAbsolute(process.env.SystemRoot) ? process.env.SystemRoot : 'C:\\Windows';
const WINDOWS_PROCESS_QUERY = "Get-CimInstance -ClassName Win32_Process -Filter \"Name = 'postgres.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
export async function windowsOrphanedServerProcesses(runner: PostgresRunner, dataDirectory: string, scan: OrphanScan, alive: (pid: number) => boolean = defaultProcessAlive): Promise<number[]> {
  const powershell = win32.join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const listed = await runner.run(powershell, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_QUERY], { timeoutMs: 30_000 });
  return listed.code === 0 ? windowsOrphans(parseWindowsProcessList(listed.stdout), dataDirectory, scan, alive) : [];
}
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class BundledPostgres {
  readonly runtimeRoot: string;
  readonly dataRoot: string;
  readonly dataDirectory: string;
  readonly passwordFile: string;
  readonly user: string;
  readonly database: string;
  private readonly platform: NodeJS.Platform;
  private readonly portRange: [number, number];
  private readonly runner: PostgresRunner;
  private readonly startTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly upgradeTimeoutMs: number;
  private readonly processAlive: (pid: number) => boolean;
  private readonly onDiagnostic?: (text: string) => void;
  private readonly now: () => string;
  private readonly effectiveUid: () => number | null;
  private readonly orphanedServerProcesses: (dataDirectory: string, scan: OrphanScan) => Promise<number[]>;
  private readonly killProcess: (pid: number) => void | Promise<void>;
  private server: PostgresServerProcess | null = null;
  private serverPort: number | null = null;
  private bundledVersionCache: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: BundledPostgresOptions) {
    check(typeof options.runtimeRoot === 'string' && isAbsolute(options.runtimeRoot), 'POSTGRES_RUNTIME_PATH_INVALID', 'Provide the absolute bundled runtime directory.');
    check(typeof options.dataRoot === 'string' && isAbsolute(options.dataRoot), 'POSTGRES_DATA_PATH_INVALID', 'Provide an absolute private database folder.');
    const user = options.user ?? 'chausar';
    check(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(user), 'POSTGRES_USER_INVALID', 'The database user name is not a plain identifier.');
    const database = options.database ?? 'postgres';
    check(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database), 'POSTGRES_DATABASE_INVALID', 'The database name is not a plain identifier.');
    const range = options.portRange ?? [55400, 55499];
    check(Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] >= 1024 && range[1] <= 65535 && range[0] <= range[1], 'POSTGRES_PORT_RANGE_INVALID', 'The port range must be unprivileged and ordered.');
    this.runtimeRoot = resolve(options.runtimeRoot);
    this.dataRoot = resolve(options.dataRoot);
    this.dataDirectory = join(this.dataRoot, CLUSTER_DIRECTORY);
    this.passwordFile = join(this.dataRoot, PASSWORD_FILE);
    this.user = user;
    this.database = database;
    this.platform = options.platform ?? process.platform;
    this.portRange = [range[0], range[1]];
    this.runner = options.runner ?? nodePostgresRunner;
    this.startTimeoutMs = options.startTimeoutMs ?? 30_000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 60_000;
    this.upgradeTimeoutMs = options.upgradeTimeoutMs ?? 3_600_000;
    this.processAlive = options.processAlive ?? defaultProcessAlive;
    this.onDiagnostic = options.onDiagnostic;
    this.now = options.now ?? (() => new Date().toISOString());
    const realRunner = this.runner === nodePostgresRunner;
    this.effectiveUid = options.effectiveUid ?? (() => realRunner && typeof process.geteuid === 'function' ? process.geteuid() : null);
    const runner = this.runner, alive = this.processAlive;
    this.orphanedServerProcesses = options.orphanedServerProcesses ?? (
      this.platform === 'linux' ? (realRunner ? linuxOrphanedServerProcesses : async () => [])
      : this.platform === 'darwin' ? (directory, scan) => darwinOrphanedServerProcesses(runner, directory, scan)
      : this.platform === 'win32' ? (directory, scan) => windowsOrphanedServerProcesses(runner, directory, scan, alive)
      : async () => []);
    this.killProcess = options.killProcess ?? (this.platform === 'win32'
      ? async pid => { await runner.run(win32.join(systemRoot(), 'System32', 'taskkill.exe'), ['/PID', String(pid), '/F'], { timeoutMs: 15_000 }); }
      : pid => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } });
  }

  /** Read-only summary; never creates files or starts processes other than `postgres --version`. */
  async status(): Promise<PostgresStatus> {
    const record = await this.readRecord();
    const last = (kinds: PostgresEventKind[]) => [...record.events].reverse().find(event => kinds.includes(event.kind)) ?? null;
    const summary: PostgresStatus = { state: 'unavailable', majorVersion: null, bundledMajor: null, port: this.serverAlive() ? this.serverPort : record.port, dataDirectory: this.dataDirectory, lock: 'none', reason: null, lastRecovery: last(RECOVERY_KINDS), lastUpgrade: last(['upgrade-completed']) };
    let cluster: ClusterInspection;
    try {
      summary.bundledMajor = await this.bundledMajor(await this.executables());
      cluster = await this.inspectCluster();
    } catch (error) { summary.reason = (error as { code?: string }).code ?? 'POSTGRES_RUNTIME_UNUSABLE'; return summary; }
    summary.majorVersion = cluster.major;
    if (!cluster.exists) return { ...summary, state: 'absent' };
    if (!cluster.initialized) return { ...summary, state: 'uninitialized' };
    const order = compareMajor(cluster.major as string, summary.bundledMajor);
    if (order > 0) return { ...summary, state: 'newer-than-app' };
    if (order < 0) return { ...summary, state: 'needs-upgrade' };
    summary.lock = (await this.lock()).kind;
    return { ...summary, state: summary.lock === 'ours' ? 'running' : 'stopped' };
  }

  /** Initialise when absent, recover a stale lock, then start on loopback and wait for readiness. */
  start(): Promise<PostgresConnection> {
    return this.exclusive(async () => {
      if (this.serverAlive()) return this.connection();
      this.refuseRoot();
      const executables = await this.executables();
      await this.preparePrivateRoot();
      await this.ensurePasswordFile();
      const bundled = await this.bundledMajor(executables);
      const cluster = await this.inspectCluster();
      if (cluster.initialized) {
        const order = compareMajor(cluster.major as string, bundled);
        check(order <= 0, 'POSTGRES_DATA_NEWER', 'The database was written by a newer PostgreSQL than this app bundles. Install the newer app version.');
        check(order >= 0, 'POSTGRES_UPGRADE_REQUIRED', 'The database needs an upgrade to the bundled PostgreSQL before it can start.');
        await this.recoverLock();
      } else {
        check(cluster.empty, 'POSTGRES_DATA_INCOMPLETE', 'The database folder holds files but no PostgreSQL cluster. Move it aside before starting.');
        await this.initdb(executables, this.dataDirectory);
      }
      const port = await this.choosePort();
      await this.launch(executables, this.dataDirectory, port);
      return this.connection();
    });
  }

  /** Orderly stop: `pg_ctl stop -m fast`, then `-m immediate`, then a kill as the last resort. */
  stop(): Promise<void> {
    return this.exclusive(() => this.stopServer(postgresExecutables(this.runtimeRoot, this.platform), this.dataDirectory));
  }

  connection(): PostgresConnection {
    check(this.serverAlive() && this.serverPort !== null, 'POSTGRES_NOT_RUNNING', 'The bundled database is not running.');
    return { host: '127.0.0.1', port: this.serverPort, user: this.user, database: this.database, passwordFile: this.passwordFile };
  }

  /** The URL form the engine reads from CHAUSAR_POSTGRES_URL. Contains the password; never log it. */
  async connectionUrl(): Promise<string> {
    const connection = this.connection();
    const password = await this.readPassword();
    return `postgresql://${connection.user}:${encodeURIComponent(password)}@${connection.host}:${connection.port}/${connection.database}`;
  }

  /** The pg_upgrade plan for a cluster older than the bundled major. Copy mode only; `--check` runs first. */
  async planUpgrade(): Promise<PostgresUpgradePlan> {
    const executables = await this.executables();
    const bundled = await this.bundledMajor(executables);
    const cluster = await this.inspectCluster();
    check(cluster.initialized && compareMajor(cluster.major as string, bundled) < 0, 'POSTGRES_UPGRADE_NOT_NEEDED', 'The database does not need an upgrade.');
    const fromMajor = cluster.major as string;
    const old = postgresExecutables(this.runtimeRoot, this.platform, `postgres-${fromMajor}`);
    for (const path of [old.postgres, old.pgCtl]) check(await this.isExecutable(path), 'POSTGRES_OLD_RUNTIME_MISSING', 'The previous PostgreSQL runtime needed for the upgrade is not bundled.');
    check(await this.isExecutable(executables.pgUpgrade), 'POSTGRES_UPGRADE_TOOL_MISSING', 'The bundled PostgreSQL runtime does not include pg_upgrade.');
    const newDataDirectory = join(this.dataRoot, `${CLUSTER_DIRECTORY}.next-${bundled}`);
    const [oldPort, newPort] = await this.vacantPorts(2);
    const upgradeArgs = ['--old-bindir', old.binDirectory, '--new-bindir', executables.binDirectory, '--old-datadir', this.dataDirectory, '--new-datadir', newDataDirectory, '--username', this.user, '--old-port', String(oldPort), '--new-port', String(newPort)];
    return {
      fromMajor, toMajor: bundled, oldBinDirectory: old.binDirectory, newBinDirectory: executables.binDirectory,
      oldDataDirectory: this.dataDirectory, newDataDirectory, retainedDataDirectory: join(this.dataRoot, `${CLUSTER_DIRECTORY}.pre-${bundled}`), link: false,
      steps: [
        { name: 'initdb', executable: executables.initdb, args: this.initdbArgs(newDataDirectory) },
        { name: 'check', executable: executables.pgUpgrade, args: [...upgradeArgs, '--check'] },
        { name: 'upgrade', executable: executables.pgUpgrade, args: upgradeArgs },
      ],
    };
  }

  /** Runs the plan after re-hashing the caller's vault copy, then swaps directories and keeps the old cluster. */
  upgrade(options: { backupConfirmed?: BackupProof | null }): Promise<PostgresStatus> {
    return this.exclusive(async () => {
      const proof = options?.backupConfirmed;
      this.refuseRoot();
      check(proof && typeof proof.path === 'string' && isAbsolute(proof.path) && typeof proof.sha256 === 'string' && /^[a-f0-9]{64}$/.test(proof.sha256), 'BACKUP_REQUIRED', 'Take a vault copy of the database before upgrading it.');
      const backupRelative = relative(this.dataDirectory, resolve(proof.path));
      check(backupRelative.startsWith(`..${sep}`) || backupRelative === '..' || isAbsolute(backupRelative), 'BACKUP_REQUIRED', 'The vault copy must be stored outside the database folder.');
      let info;
      try { info = await lstat(proof.path); } catch { info = null; }
      check(info?.isFile() && !info.isSymbolicLink(), 'BACKUP_REQUIRED', 'The vault copy named for this upgrade is missing.');
      check(await sha256File(proof.path) === proof.sha256, 'BACKUP_UNVERIFIED', 'The vault copy does not match its recorded checksum.');
      if (this.serverAlive()) await this.stopServer(postgresExecutables(this.runtimeRoot, this.platform), this.dataDirectory);
      await this.preparePrivateRoot();
      await this.readPassword();
      const plan = await this.planUpgrade();
      const lockState = await this.lock();
      check(lockState.kind !== 'foreign', 'POSTGRES_DATA_IN_USE', 'Another program is using the database folder.');
      if (lockState.kind === 'stale') await this.cleanShutdownWithOld(plan, lockState.pid);
      check(!(await this.exists(plan.retainedDataDirectory)), 'POSTGRES_UPGRADE_RETAINED_EXISTS', 'A retained pre-upgrade cluster already exists. Move it aside before upgrading again.');
      await this.removeOwnDirectory(plan.newDataDirectory);
      const passFile = join(this.dataRoot, 'upgrade.pgpass');
      await rm(passFile, { force: true });
      await writeFile(passFile, `*:*:*:${this.user}:${await this.readPassword()}\n`, { mode: 0o600, flag: 'wx' });
      const env = this.environment({ PGPASSFILE: passFile });
      // pg_upgrade writes its scripts (delete_old_cluster.sh would delete the swapped-in cluster) to its working
      // folder and puts server sockets there; a private short folder keeps both out of the data root and keeps the
      // socket path under the Unix 107-byte limit however deep the data root is.
      const work = await mkdtemp(join(this.platform !== 'win32' && tmpdir().length > 64 ? '/tmp' : tmpdir(), 'chausar-pgu-'));
      await chmod(work, 0o700);
      const socketArgs = this.platform === 'win32' ? [] : ['--socketdir', work];
      const fail = async (kind: PostgresEventKind, code: string, message: string, result: PostgresRunResult) => {
        this.onDiagnostic?.(`${result.stdout}\n${result.stderr}`.trim().slice(-OUTPUT_LIMIT));
        await this.removeOwnDirectory(plan.newDataDirectory);
        await this.recordEvent(kind, { from: plan.fromMajor, to: plan.toMajor });
        check(false, code, message);
      };
      try {
        const [initdb, preflight, upgrade] = plan.steps;
        await mkdir(plan.newDataDirectory, { mode: 0o700 });
        const created = await this.runner.run(initdb.executable, initdb.args, { timeoutMs: this.commandTimeoutMs, cwd: work, env });
        if (created.code !== 0) await fail('upgrade-failed', 'POSTGRES_INITDB_FAILED', 'PostgreSQL could not create the upgraded database folder.', created);
        const checked = await this.runner.run(preflight.executable, [...preflight.args, ...socketArgs], { timeoutMs: this.upgradeTimeoutMs, cwd: work, env });
        if (checked.code !== 0) await fail('upgrade-check-failed', 'POSTGRES_UPGRADE_CHECK_FAILED', 'The upgrade check failed. The existing database was left unchanged.', checked);
        const upgraded = await this.runner.run(upgrade.executable, [...upgrade.args, ...socketArgs], { timeoutMs: this.upgradeTimeoutMs, cwd: work, env });
        if (upgraded.code !== 0) await fail('upgrade-failed', 'POSTGRES_UPGRADE_FAILED', 'The upgrade did not finish. The existing database was left unchanged.', upgraded);
        await rename(plan.oldDataDirectory, plan.retainedDataDirectory);
        try { await rename(plan.newDataDirectory, plan.oldDataDirectory); }
        catch (error) { await rename(plan.retainedDataDirectory, plan.oldDataDirectory); throw error; }
      } finally {
        await rm(passFile, { force: true });
        await rm(work, { recursive: true, force: true });
      }
      await this.recordEvent('upgrade-completed', { from: plan.fromMajor, to: plan.toMajor, retained: `${CLUSTER_DIRECTORY}.pre-${plan.toMajor}`, backupSha256: proof.sha256 });
      return this.status();
    });
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private refuseRoot(): void {
    check(this.platform === 'win32' || this.effectiveUid() !== 0, 'POSTGRES_RUN_AS_ROOT', 'PostgreSQL refuses to run as the administrator account. Start the app as an ordinary user.');
  }
  private serverAlive(): boolean {
    return this.server !== null && !this.server.exitStatus().exited;
  }
  private async isExecutable(path: string): Promise<boolean> {
    try {
      const info = await lstat(path);
      return info.isFile() && !info.isSymbolicLink() && (this.platform === 'win32' || (info.mode & 0o111) !== 0);
    } catch { return false; }
  }
  private async executables(): Promise<Executables> {
    const executables = postgresExecutables(this.runtimeRoot, this.platform);
    for (const path of [executables.postgres, executables.initdb, executables.pgCtl]) check(await this.isExecutable(path), 'POSTGRES_RUNTIME_MISSING', 'The bundled PostgreSQL runtime is missing or is not a regular executable.');
    return executables;
  }
  private async bundledMajor(executables: Executables): Promise<string> {
    if (!this.bundledVersionCache) {
      const result = await this.runner.run(executables.postgres, ['--version'], { timeoutMs: this.commandTimeoutMs, env: this.environment() });
      const match = /\(PostgreSQL\)\s+(\d+(?:\.\d+)?)/.exec(result.stdout);
      check(result.code === 0 && match, 'POSTGRES_RUNTIME_UNUSABLE', 'The bundled PostgreSQL runtime did not report its version.');
      this.bundledVersionCache = postgresMajor(match[1]);
    }
    return this.bundledVersionCache as string;
  }
  private environment(extra: Record<string, string> = {}): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^PG/i.test(key)) env[key] = value;
    return { ...env, ...extra };
  }
  private async exists(path: string): Promise<boolean> {
    try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; }
  }
  private async preparePrivateRoot(): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    const info = await lstat(this.dataRoot);
    check(info.isDirectory() && !info.isSymbolicLink(), 'POSTGRES_DATA_UNSAFE', 'The private database folder must be a real directory.');
    if (this.platform !== 'win32' && (info.mode & 0o077)) await chmod(this.dataRoot, 0o700);
  }
  private async inspectCluster(): Promise<ClusterInspection> {
    let info;
    try { info = await lstat(this.dataDirectory); }
    catch (error) { if (missing(error)) return { exists: false, initialized: false, major: null, empty: true }; throw error; }
    check(info.isDirectory() && !info.isSymbolicLink(), 'POSTGRES_DATA_UNSAFE', 'The database cluster folder must be a real directory, not a link.');
    let text: string;
    try {
      const versionInfo = await lstat(join(this.dataDirectory, 'PG_VERSION'));
      check(versionInfo.isFile() && versionInfo.size < 64, 'POSTGRES_DATA_UNRECOGNIZED', 'The database version marker is not a regular file.');
      text = (await readFile(join(this.dataDirectory, 'PG_VERSION'), 'utf8')).trim();
    } catch (error) {
      if (!missing(error)) throw error;
      return { exists: true, initialized: false, major: null, empty: (await readdir(this.dataDirectory)).length === 0 };
    }
    check(MAJOR.test(text), 'POSTGRES_DATA_UNRECOGNIZED', 'The database version marker is not recognised.');
    return { exists: true, initialized: true, major: postgresMajor(text), empty: false };
  }
  private async readRecord(): Promise<ClusterRecord> {
    try {
      const path = join(this.dataRoot, RECORD_FILE);
      const info = await lstat(path);
      check(info.isFile() && !info.isSymbolicLink() && info.size < 1_000_000, 'POSTGRES_RECORD_INVALID', 'The cluster record is not a regular file.');
      const value = JSON.parse(await readFile(path, 'utf8')) as Partial<ClusterRecord>;
      const port = Number.isInteger(value.port) && (value.port as number) >= 1024 && (value.port as number) <= 65535 ? value.port as number : null;
      const events = Array.isArray(value.events) ? value.events.filter(event => event && typeof event.at === 'string' && typeof event.kind === 'string' && event.detail && typeof event.detail === 'object').slice(-50) : [];
      return { schemaVersion: 1, port, events };
    } catch (error) {
      if (missing(error) || error instanceof SyntaxError) return { schemaVersion: 1, port: null, events: [] };
      throw error;
    }
  }
  private async writeRecord(record: ClusterRecord): Promise<void> {
    const path = join(this.dataRoot, RECORD_FILE);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...record, events: record.events.slice(-50) }, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
  }
  private async recordEvent(kind: PostgresEventKind, detail: PostgresEvent['detail']): Promise<void> {
    const record = await this.readRecord();
    record.events.push({ at: this.now(), kind, detail });
    await this.writeRecord(record);
  }
  private async readPassword(): Promise<string> {
    let info;
    try { info = await lstat(this.passwordFile); } catch (error) { check(!missing(error), 'POSTGRES_PASSWORD_MISSING', 'The database password file is missing.'); throw error; }
    check(info.isFile() && !info.isSymbolicLink(), 'POSTGRES_PASSWORD_FILE_UNSAFE', 'The database password file must be a regular file.');
    check(this.platform === 'win32' || !(info.mode & 0o077), 'POSTGRES_PASSWORD_FILE_UNSAFE', 'The database password file must be readable by its owner only.');
    const password = (await readFile(this.passwordFile, 'utf8')).trim();
    check(PASSWORD.test(password), 'POSTGRES_PASSWORD_FILE_INVALID', 'The database password file is not in the expected format.');
    return password;
  }
  private async ensurePasswordFile(): Promise<void> {
    try { await lstat(this.passwordFile); }
    catch (error) {
      if (!missing(error)) throw error;
      await writeFile(this.passwordFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
    }
    await this.readPassword();
  }
  private initdbArgs(directory: string): string[] {
    return ['-D', directory, '--username', this.user, '--pwfile', this.passwordFile, '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C'];
  }
  private async initdb(executables: Executables, directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const result = await this.runner.run(executables.initdb, this.initdbArgs(directory), { timeoutMs: this.commandTimeoutMs, cwd: this.dataRoot, env: this.environment() });
    if (result.code !== 0) {
      this.onDiagnostic?.(result.stderr);
      if ((await readdir(directory).catch(() => [])).length === 0) await rm(directory, { recursive: true, force: true });
      check(false, 'POSTGRES_INITDB_FAILED', 'PostgreSQL could not initialise the database folder.');
    }
  }
  private async lock(directory = this.dataDirectory): Promise<{ kind: PostgresLock; pid: number | null }> {
    let text: string;
    try { text = await readFile(join(directory, 'postmaster.pid'), 'utf8'); }
    catch (error) { if (missing(error)) return { kind: 'none', pid: null }; throw error; }
    const pid = Number(text.split(/\r?\n/, 1)[0]?.trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) return { kind: 'stale', pid: null };
    if (this.serverAlive() && this.server?.pid === pid && directory === this.dataDirectory) return { kind: 'ours', pid };
    return { kind: this.processAlive(pid) ? 'foreign' : 'stale', pid };
  }
  /** A dead postmaster PID is a stale lock: PostgreSQL replays its WAL on a normal start. */
  private async recoverLock(): Promise<void> {
    const state = await this.lock();
    check(state.kind !== 'foreign', 'POSTGRES_DATA_IN_USE', 'Another program is using the database folder.');
    if (state.kind === 'stale') await this.recordEvent('stale-lock-recovered', { pid: state.pid, orphansEnded: await this.endOrphans(this.dataDirectory, state.pid, postgresExecutables(this.runtimeRoot, this.platform).postgres) });
  }
  /** Ends server processes a crashed postmaster left on this data directory, so the new postmaster can start. */
  private async endOrphans(directory: string, postmasterPid: number | null, postgresExecutable: string): Promise<number> {
    const uid = this.effectiveUid() ?? (typeof process.geteuid === 'function' ? process.geteuid() : null);
    const orphans = await this.orphanedServerProcesses(directory, { postmasterPid, clusterName: postgresClusterName(directory), postgresExecutable, uid });
    for (const pid of orphans) await this.killProcess(pid);
    const deadline = Date.now() + Math.min(10_000, this.startTimeoutMs);
    while (orphans.some(pid => this.processAlive(pid)) && Date.now() < deadline) await pause(50);
    check(!orphans.some(pid => this.processAlive(pid)), 'POSTGRES_STALE_PROCESSES', 'Database processes left by a crash are still running. End them, then start again.');
    return orphans.length;
  }
  private async vacantPorts(count: number, avoid: number[] = []): Promise<number[]> {
    const found: number[] = [];
    for (let port = this.portRange[0]; port <= this.portRange[1] && found.length < count; port += 1) {
      if (!avoid.includes(port) && await vacant(port)) found.push(port);
    }
    check(found.length === count, 'POSTGRES_PORT_UNAVAILABLE', 'No free local port is available for the bundled database.');
    return found;
  }
  private async choosePort(): Promise<number> {
    const record = await this.readRecord();
    if (record.port !== null && await vacant(record.port)) return record.port;
    const [port] = await this.vacantPorts(1, record.port === null ? [] : [record.port]);
    await this.writeRecord({ ...record, port });
    return port;
  }
  private serverArgs(directory: string, port: number): string[] {
    return ['-D', directory, '-h', '127.0.0.1', '-p', String(port), '-c', `cluster_name=${postgresClusterName(directory)}`, '-c', 'unix_socket_directories=', '-c', 'password_encryption=scram-sha-256', '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on'];
  }
  /**
   * Ready means the postmaster wrote `ready` into its lock file (PostgreSQL 10+, as `pg_ctl -w` checks). An open port
   * alone is not enough: during crash recovery the server listens but refuses connections, and a fast stop then
   * leaves the cluster "shut down in recovery", which pg_upgrade refuses.
   */
  private async ready(directory: string, pid: number | undefined): Promise<boolean> {
    let lines: string[];
    try { lines = (await readFile(join(directory, 'postmaster.pid'), 'utf8')).split(/\r?\n/); } catch { return false; }
    return (pid === undefined || Number(lines[0]) === pid) && lines[7]?.trim() === 'ready';
  }
  private async launch(executables: Executables, directory: string, port: number): Promise<void> {
    const server = this.runner.spawnServer(executables.postgres, this.serverArgs(directory, port), { env: this.environment(), onDiagnostic: this.onDiagnostic });
    this.server = server; this.serverPort = port;
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (server.exitStatus().exited) { this.server = null; this.serverPort = null; check(false, 'POSTGRES_START_FAILED', 'The bundled database stopped before it was ready.'); }
      if (await this.ready(directory, server.pid) && await listening(port)) return;
      await pause(100);
    }
    await this.stopServer(executables, directory);
    check(false, 'POSTGRES_START_TIMEOUT', 'The bundled database did not become ready in time.');
  }
  private async stopServer(executables: Executables, directory: string): Promise<void> {
    const server = this.server;
    if (!server || server.exitStatus().exited) { this.server = null; this.serverPort = null; return; }
    const env = this.environment();
    const fast = await this.runner.run(executables.pgCtl, ['stop', '-D', directory, '-m', 'fast', '-w', '-t', '30'], { timeoutMs: 40_000, env });
    if (fast.code !== 0) {
      const immediate = await this.runner.run(executables.pgCtl, ['stop', '-D', directory, '-m', 'immediate', '-w', '-t', '10'], { timeoutMs: 20_000, env });
      await this.recordEvent('immediate-stop', { pid: server.pid ?? null });
      if (immediate.code !== 0) { server.kill(); await this.recordEvent('forced-kill', { pid: server.pid ?? null }); }
    }
    const deadline = Date.now() + 10_000;
    while (!server.exitStatus().exited && Date.now() < deadline) await pause(50);
    if (!server.exitStatus().exited) server.kill();
    this.server = null; this.serverPort = null;
  }
  /** pg_upgrade requires a clean shutdown: replay a crashed old cluster with its own binaries first. */
  private async cleanShutdownWithOld(plan: PostgresUpgradePlan, pid: number | null): Promise<void> {
    const old = postgresExecutables(this.runtimeRoot, this.platform, `postgres-${plan.fromMajor}`);
    await this.recordEvent('stale-lock-recovered', { pid, orphansEnded: await this.endOrphans(plan.oldDataDirectory, pid, old.postgres) });
    const [port] = await this.vacantPorts(1);
    await this.launch(old, plan.oldDataDirectory, port);
    await this.stopServer(old, plan.oldDataDirectory);
  }
  private async removeOwnDirectory(path: string): Promise<void> {
    let info;
    try { info = await lstat(path); } catch (error) { if (missing(error)) return; throw error; }
    check(info.isDirectory() && !info.isSymbolicLink(), 'POSTGRES_DATA_UNSAFE', 'An upgrade working folder is not a real directory.');
    await rm(path, { recursive: true, force: true });
  }
}
