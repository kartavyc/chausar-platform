/**
 * A disposable PostgreSQL for hosted-link tests. It starts one private cluster per test file on a
 * unix socket in a temporary directory, and removes it on exit. When no PostgreSQL server binaries
 * exist the hosted database tests skip and say why; set CHAUSAR_TEST_PG_BIN to the bin directory.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, chownSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect, migrate } from '../../hosted/db/sql.ts';
import type { Sql } from '../../hosted/db/sql.ts';

function binDirectory(): string | undefined {
  const named = process.env.CHAUSAR_TEST_PG_BIN;
  if (named) return existsSync(join(named, 'initdb')) ? named : undefined;
  const root = '/usr/lib/postgresql';
  if (!existsSync(root)) return undefined;
  for (const version of readdirSync(root).sort().reverse()) if (existsSync(join(root, version, 'bin', 'initdb'))) return join(root, version, 'bin');
  return undefined;
}

type Cluster = { directory: string; socket: string; port: number; stop(): void };
let cluster: Cluster | undefined | null = null;

function startCluster(): Cluster | undefined {
  const bin = binDirectory(); if (!bin) return undefined;
  const directory = mkdtempSync(join(tmpdir(), 'chausar-hosted-pg-'));
  // PostgreSQL refuses to run as root; in a root container the tests run the server as the postgres user.
  const asRoot = process.getuid?.() === 0;
  const prefix = asRoot ? ['runuser', '-u', 'postgres', '--'] : [];
  if (asRoot) { try { const uid = Number(execFileSync('id', ['-u', 'postgres']).toString()); chownSync(directory, uid, 0); } catch { rmSync(directory, { recursive: true, force: true }); return undefined; } }
  // The server inherits no pipe from us (its log goes to a file), so spawnSync returns as soon as pg_ctl does.
  const run = (command: string, args: string[]) => {
    const [head, ...rest] = [...prefix, join(bin, command), ...args];
    return spawnSync(head, rest, { stdio: 'ignore', timeout: 60000 });
  };
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = join(directory, 'data');
  if (run('initdb', ['-D', data, '-U', 'chausar', '--auth=trust', '-E', 'UTF8', '--no-sync']).status !== 0) { rmSync(directory, { recursive: true, force: true }); return undefined; }
  const started = run('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-o', `-p ${port} -k ${directory} -c listen_addresses='' -c fsync=off -c max_connections=60`, '-w', '-t', '30', 'start']);
  if (started.status !== 0) { rmSync(directory, { recursive: true, force: true }); return undefined; }
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); rmSync(directory, { recursive: true, force: true }); };
  process.once('exit', stop);
  return { directory, socket: directory, port, stop };
}

export function postgresAvailable(): string | undefined {
  if (cluster === null) cluster = startCluster();
  return cluster ? undefined : 'No PostgreSQL server binaries were found (set CHAUSAR_TEST_PG_BIN).';
}

const opened: (Sql & { end(): Promise<void> })[] = [];
/** A new empty database with every hosted migration applied. */
export async function freshDatabase(): Promise<Sql & { end(): Promise<void> }> {
  if (cluster === null) cluster = startCluster();
  if (!cluster) throw new Error('PostgreSQL is not available.');
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const admin = await connect(`postgresql://chausar@/postgres?host=${encodeURIComponent(cluster.socket)}&port=${cluster.port}`, 1);
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const sql = await connect(`postgresql://chausar@/${name}?host=${encodeURIComponent(cluster.socket)}&port=${cluster.port}`, 5);
  await migrate(sql); opened.push(sql); return sql;
}
export async function closeDatabases(): Promise<void> { while (opened.length) await opened.pop()!.end().catch(() => {}); }
