import { spawnSync } from 'node:child_process';
import { chmod, chown, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

// TEST ONLY. Starts a real, throw-away PostgreSQL cluster with ssl=on and a certificate signed by a
// freshly generated CA, for platform/tests/release-postgres-tls.test.ts and the enterprise tests.
// Plaintext connections are refused by pg_hba.conf (hostssl lines only). Never used by production code.

export type TlsPostgres = {
  host: string; port: number; user: string; password: string; database: string;
  /** PEM of the CA that signed the server certificate. */
  ca: string; caFile: string; otherCa: string;
  /** Names in the server certificate: DNS localhost and chausar-db.test, IP 127.0.0.1 and `host`. */
  url(host?: string): string; stop(): Promise<void>;
};

function run(command: string, args: string[], options: { asUser?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const [file, argv] = options.asUser ? ['runuser', ['-u', options.asUser, '--', command, ...args]] : [command, args];
  const result = spawnSync(file, argv, { encoding: 'utf8', cwd: options.cwd, env: options.env ?? process.env, timeout: 60_000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').slice(0, 600)}`);
  return result.stdout;
}
function binaries(): string | null {
  const fromConfig = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
  const candidates = [process.env.CHAUSAR_TEST_PG_BINDIR, fromConfig.status === 0 ? fromConfig.stdout.trim() : undefined,
    ...(existsSync('/usr/lib/postgresql') ? readdirSync('/usr/lib/postgresql').sort().reverse().map(version => `/usr/lib/postgresql/${version}/bin`) : [])];
  return candidates.find(dir => dir && existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) ?? null;
}
/** Why a real cluster cannot start here, or null when it can. */
export function realPostgresUnavailable(): string | null {
  if (process.platform === 'win32') return 'real PostgreSQL clusters are started only on Linux and macOS in these tests';
  if (spawnSync('openssl', ['version']).status !== 0) return 'openssl is not installed';
  if (!binaries()) return 'no PostgreSQL server binaries (initdb, pg_ctl) were found; set CHAUSAR_TEST_PG_BINDIR';
  if (process.getuid?.() === 0 && spawnSync('id', ['postgres']).status !== 0) return 'running as root and there is no unprivileged postgres user to run the cluster';
  return null;
}
async function freePort(): Promise<number> {
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); await new Promise<void>(resolve => probe.close(() => resolve()));
  if (!address || typeof address !== 'object') throw new Error('No port'); return address.port;
}
/** The first non-loopback IPv4 address, so a test can reach the cluster by a genuinely remote-looking host. */
export function nonLoopbackAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const item of list ?? []) if (item.family === 'IPv4' && !item.internal) return item.address;
  return null;
}
async function certificates(directory: string, address: string | null) {
  const file = (name: string) => join(directory, name);
  run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=Chausar test database CA', '-days', '2',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', file('ca.key'), '-out', file('ca.pem')]);
  run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=Unrelated CA', '-days', '2',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', file('other-ca.key'), '-out', file('other-ca.pem')]);
  run('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=chausar-db.test', '-keyout', file('server.key'), '-out', file('server.csr')]);
  await writeFile(file('server.ext'), `subjectAltName=DNS:localhost,DNS:chausar-db.test,IP:127.0.0.1${address ? `,IP:${address}` : ''}\nextendedKeyUsage=serverAuth\n`);
  run('openssl', ['x509', '-req', '-in', file('server.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key'), '-CAcreateserial', '-days', '2', '-extfile', file('server.ext'), '-out', file('server.pem')]);
}

export async function startTlsPostgres(): Promise<TlsPostgres> {
  const reason = realPostgresUnavailable(); if (reason) throw new Error(reason);
  const bin = binaries()!; const asUser = process.getuid?.() === 0 ? 'postgres' : undefined;
  // mkdtemp makes a 0700 directory; the cluster user must be able to reach its own data inside it.
  const root = await mkdtemp(join(tmpdir(), 'chausar-pg-tls-')); await chmod(root, 0o755);
  const tls = join(root, 'tls'), data = join(root, 'data'); await mkdir(tls, { mode: 0o755 });
  const address = nonLoopbackAddress(); await certificates(tls, address);
  const port = await freePort(); const user = 'chausar', database = 'chausar', password = `synthetic-${Math.random().toString(36).slice(2)}-password`;
  await writeFile(join(root, 'pwfile'), `${password}\n`, { mode: 0o600 });
  if (asUser) {
    const ids = run('id', ['-u', asUser]).trim(), gid = run('id', ['-g', asUser]).trim();
    for (const path of [root, tls, join(root, 'pwfile'), join(tls, 'server.key'), join(tls, 'server.pem'), join(tls, 'ca.pem')]) await chown(path, Number(ids), Number(gid));
  }
  await chmod(join(tls, 'server.key'), 0o600);
  run(join(bin, 'initdb'), ['-D', data, '-U', user, '--pwfile', join(root, 'pwfile'), '-A', 'scram-sha-256', '--no-sync', '-E', 'UTF8', '--locale', 'C'], { asUser });
  const listen = ['127.0.0.1', ...(address ? [address] : [])].join(',');
  await writeFile(join(data, 'postgresql.auto.conf'), [
    `listen_addresses = '${listen}'`, `port = ${port}`, `unix_socket_directories = '${data}'`,
    'ssl = on', `ssl_cert_file = '${join(tls, 'server.pem')}'`, `ssl_key_file = '${join(tls, 'server.key')}'`, "ssl_min_protocol_version = 'TLSv1.2'",
    'fsync = off', 'max_connections = 40', '',
  ].join('\n'));
  // TLS only: there is no `host` (plaintext) line, so a connection without TLS is refused by the server too.
  await writeFile(join(data, 'pg_hba.conf'), ['local all all scram-sha-256', 'hostssl all all 0.0.0.0/0 scram-sha-256', 'hostssl all all ::/0 scram-sha-256', ''].join('\n'));
  if (asUser) { const ids = run('id', ['-u', asUser]).trim(), gid = run('id', ['-g', asUser]).trim(); for (const name of ['postgresql.auto.conf', 'pg_hba.conf']) await chown(join(data, name), Number(ids), Number(gid)); }
  run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '60', 'start'], { asUser, cwd: root });
  run(join(bin, 'createdb'), ['-h', data, '-p', String(port), '-U', user, database], { asUser, cwd: root, env: { ...process.env, PGPASSWORD: password } });
  const ca = await readFile(join(tls, 'ca.pem'), 'utf8'), otherCa = await readFile(join(tls, 'other-ca.pem'), 'utf8');
  let stopped = false;
  return {
    host: address ?? 'localhost', port, user, password, database, ca, caFile: join(tls, 'ca.pem'), otherCa,
    url: (host = address ?? 'localhost') => `postgresql://${user}:${encodeURIComponent(password)}@${host.includes(':') ? `[${host}]` : host}:${port}/${database}`,
    async stop() {
      if (stopped) return; stopped = true;
      try { run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { asUser, cwd: root }); } finally { await rm(root, { recursive: true, force: true }); }
    },
  };
}
