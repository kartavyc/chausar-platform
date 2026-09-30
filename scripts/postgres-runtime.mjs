import { spawn } from 'node:child_process';
import { lstat, mkdir, access } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function binary(path, name) {
  if (!path || !isAbsolute(path)) throw new Error(`Provide an absolute bundled ${name} binary path.`);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${name} must be a regular bundled executable.`);
  return resolve(path);
}
function run(executable, args) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore','ignore','pipe'] });
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Bundled PostgreSQL command exceeded its deadline.')); }, 60000);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('exit', code => { clearTimeout(deadline); code === 0 ? accept(undefined) : reject(new Error(`Bundled PostgreSQL command failed (${code}): ${stderr}`)); });
  });
}
async function vacantPort(port) {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept(undefined)));
}
async function listening(port) {
  return new Promise(accept => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); accept(true); });
    socket.once('error', () => { socket.destroy(); accept(false); });
    socket.setTimeout(200, () => { socket.destroy(); accept(false); });
  });
}
/** Caller must ship and supply PostgreSQL binaries and a private password file. */
export async function startBundledPostgres(options) {
  const postgres = await binary(options.postgresBinary, 'postgres');
  const initdb = await binary(options.initdbBinary, 'initdb');
  const pgCtl = await binary(options.pgCtlBinary, 'pg_ctl');
  if (!isAbsolute(options.dataDirectory ?? '') || !isAbsolute(options.passwordFile ?? '') || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(options.user ?? '') || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('Provide explicit absolute data/password paths, a database user, and an unprivileged port.');
  const dataDirectory = resolve(options.dataDirectory);
  const password = await lstat(options.passwordFile);
  if (!password.isFile() || password.isSymbolicLink()) throw new Error('The password file must be a regular private file.');
  if (process.platform !== 'win32' && (password.mode & 0o077)) throw new Error('Restrict the password file to its owner (mode 0600).');
  await vacantPort(options.port);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const dataInfo = await lstat(dataDirectory);
  if (!dataInfo.isDirectory() || dataInfo.isSymbolicLink()) throw new Error('The PostgreSQL data directory cannot be a symbolic link.');
  let initialized = true;
  try { await access(join(dataDirectory, 'PG_VERSION')); } catch { initialized = false; }
  if (!initialized) await run(initdb, ['-D', dataDirectory, '--username', options.user, '--pwfile', resolve(options.passwordFile), '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8']);
  const child = spawn(postgres, ['-D', dataDirectory, '-h', '127.0.0.1', '-p', String(options.port), '-c', 'unix_socket_directories=', '-c', 'password_encryption=scram-sha-256', '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on'], { windowsHide: true, shell: false, stdio: ['ignore','ignore','pipe'] });
  let failure, exited = false;
  child.once('error', error => { failure = error; });
  child.once('exit', code => { exited = true; if (code !== 0) failure = new Error(`Bundled PostgreSQL exited (${code}).`); });
  child.stderr.on('data', chunk => options.onDiagnostic?.(chunk.toString()));
  const deadline = Date.now() + (options.startTimeoutMs ?? 30000);
  while (Date.now() < deadline) {
    if (failure || exited) throw failure ?? new Error('Bundled PostgreSQL stopped before readiness.');
    if (await listening(options.port)) return { host: '127.0.0.1', port: options.port, user: options.user, dataDirectory, processId: child.pid, async close() { await run(pgCtl, ['stop', '-D', dataDirectory, '-m', 'fast', '-w', '-t', '30']); } };
    await new Promise(accept => setTimeout(accept, 100));
  }
  await run(pgCtl, ['stop', '-D', dataDirectory, '-m', 'fast', '-w', '-t', '10']).catch(() => child.kill());
  throw new Error('Bundled PostgreSQL did not become ready before the timeout.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
  try {
    const server = await startBundledPostgres({ postgresBinary: args.postgres, initdbBinary: args.initdb, pgCtlBinary: args['pg-ctl'], dataDirectory: args.data, passwordFile: args['password-file'], user: args.user, port: Number(args.port) });
    process.stdout.write(JSON.stringify({ host: server.host, port: server.port, processId: server.processId }) + '\n');
    let stopping = false;
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { if (stopping) return; stopping = true; await server.close(); process.exit(0); });
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
