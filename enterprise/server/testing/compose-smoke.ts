import { execFileSync, spawnSync } from 'node:child_process';
import { request } from 'node:https';
import { chmodSync, chownSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// TEST ONLY. End-to-end smoke run of enterprise/server/compose.yaml on one Linux machine with Docker:
// generated CAs and certificates, PostgreSQL with TLS only, the server image, and a fake OpenID provider.
// It checks /healthz from the host, signs in, makes engine requests, restarts the server, signs out,
// and removes every container, network and volume it made. Nothing is pushed or published.
//
//   docker build -f enterprise/server/Dockerfile -t chausar-enterprise:dev .     (first)
//   node enterprise/server/testing/compose-smoke.ts                                (run as root: it sets file owners)
//
// Ports 8443 and 9443 on the host must be free.

const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const files = mkdtempSync(join(tmpdir(), 'chausar-compose-smoke-')); chmodSync(files, 0o755);
const project = `chausar-smoke-${randomBytes(3).toString('hex')}`;
const compose = ['compose', '-p', project, '-f', join(repository, 'enterprise/server/compose.yaml'), '-f', join(repository, 'enterprise/server/testing/compose.smoke.yaml')];
const env = { ...process.env, CHAUSAR_ENTERPRISE_FILES: files };
const results: { step: string; ok: boolean; detail?: string }[] = [];
const SERVER_UID = 10001, POSTGRES_UID = 999;

function sh(command: string, args: string[], options: { allowFail?: boolean; quiet?: boolean } = {}): { status: number; out: string } {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 600_000 });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 && !options.allowFail) throw new Error(`${command} ${args.join(' ')} failed:\n${out.slice(-2000)}`);
  if (!options.quiet && out.trim()) process.stdout.write(out.split('\n').map(line => `    ${line}`).join('\n').replace(/\s+$/, '') + '\n');
  return { status: result.status ?? 1, out };
}
const docker = (args: string[], options: { allowFail?: boolean; quiet?: boolean } = {}) => sh('docker', [...compose, ...args], options);
function step(name: string, ok: boolean, detail?: string) { results.push({ step: name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) throw new Error(name); }
function own(path: string, uid: number, mode: number) { chownSync(path, uid, uid); chmodSync(path, mode); }
function openssl(args: string[]) { execFileSync('openssl', args, { stdio: 'pipe' }); }
function authority(directory: string, name: string) {
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  openssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', `/CN=${name}`, '-days', '2',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', join(directory, 'ca.key'), '-out', join(directory, 'ca.pem')]);
}
function leaf(directory: string, cert: string, key: string, names: string) {
  openssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=chausar-smoke', '-keyout', join(directory, key), '-out', join(directory, 'leaf.csr')]);
  writeFileSync(join(directory, 'leaf.ext'), `subjectAltName=${names}\nextendedKeyUsage=serverAuth\n`);
  openssl(['x509', '-req', '-in', join(directory, 'leaf.csr'), '-CA', join(directory, 'ca.pem'), '-CAkey', join(directory, 'ca.key'), '-CAcreateserial', '-days', '2', '-extfile', join(directory, 'leaf.ext'), '-out', join(directory, cert)]);
  for (const extra of ['leaf.csr', 'leaf.ext', 'ca.key', 'ca.srl']) rmSync(join(directory, extra), { force: true });
}

function prepare() {
  const database = join(files, 'database-tls'); authority(database, 'Chausar smoke database CA'); leaf(database, 'server.pem', 'server.key', 'DNS:postgres');
  own(join(database, 'server.key'), POSTGRES_UID, 0o600); chmodSync(join(database, 'server.pem'), 0o644); chmodSync(join(database, 'ca.pem'), 0o644);
  const web = join(files, 'tls'); authority(web, 'Chausar smoke HTTPS CA'); leaf(web, 'fullchain.pem', 'privkey.pem', 'DNS:localhost,IP:127.0.0.1');
  own(join(web, 'privkey.pem'), SERVER_UID, 0o600); chmodSync(join(web, 'fullchain.pem'), 0o644);
  const idp = join(files, 'idp-tls'); authority(idp, 'Chausar smoke IdP CA'); leaf(idp, 'cert.pem', 'key.pem', 'DNS:idp,DNS:localhost');
  own(join(idp, 'key.pem'), SERVER_UID, 0o600); chmodSync(join(idp, 'cert.pem'), 0o644); chmodSync(join(idp, 'ca.pem'), 0o644);
  const secrets = join(files, 'secrets'); mkdirSync(secrets, { mode: 0o755 });
  const password = randomBytes(18).toString('base64url');
  writeFileSync(join(secrets, 'postgres_password'), `${password}\n`); own(join(secrets, 'postgres_password'), POSTGRES_UID, 0o400);
  writeFileSync(join(secrets, 'postgres_url'), `postgres://chausar:${password}@postgres:5432/chausar\n`); own(join(secrets, 'postgres_url'), SERVER_UID, 0o600);
  writeFileSync(join(secrets, 'oidc_client_secret'), `${randomBytes(24).toString('base64url')}\n`); own(join(secrets, 'oidc_client_secret'), SERVER_UID, 0o600);
  writeFileSync(join(secrets, 'workspace_passphrase'), `${randomBytes(24).toString('base64url')}\n`); own(join(secrets, 'workspace_passphrase'), SERVER_UID, 0o600);
  writeFileSync(join(files, 'config.json'), JSON.stringify({
    listen: { host: '0.0.0.0', port: 8443 }, tls: { certFile: '/etc/chausar/tls/fullchain.pem', keyFile: '/etc/chausar/tls/privkey.pem' }, publicOrigin: 'https://localhost:8443',
    oidc: { issuer: 'https://idp:9443', clientId: 'chausar', clientSecretFile: '/run/secrets/oidc_client_secret', redirectPath: '/auth/callback', scopes: ['openid', 'email', 'profile'] },
    roles: [{ claim: 'groups', equals: 'chausar-owners', role: 'owner', branches: ['*'] }], allowedEmailDomains: ['example.com'], sessionTtlMinutes: 60,
    dataDirectory: '/var/lib/chausar/server', workspace: { directory: '/var/lib/chausar/vaults', folder: 'main', unlock: { passphraseFile: '/run/secrets/workspace_passphrase' } },
    database: { caFile: '/etc/chausar/database-ca.pem' },
  }, null, 2)); chmodSync(join(files, 'config.json'), 0o644);
}

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; json: any; text: string };
function call(url: string, options: { method?: string; headers?: Record<string, string>; body?: string; ca: string }): Promise<Reply> {
  return new Promise((done, fail) => {
    const target = new URL(url);
    const req = request({ host: '127.0.0.1', port: Number(target.port), servername: 'localhost', path: target.pathname + target.search, method: options.method ?? 'GET', ca: readFileSync(options.ca),
      headers: { host: target.host, ...options.headers }, timeout: 15_000 }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)).on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8'); let json: any; try { json = JSON.parse(text); } catch {}
        done({ status: res.statusCode ?? 0, headers: res.headers, json, text });
      });
    });
    req.on('error', fail); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end(options.body);
  });
}
async function until(check: () => Promise<boolean>, seconds: number) {
  for (let i = 0; i < seconds; i++) { try { if (await check()) return true; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  return false;
}

async function main() {
  const webCa = join(files, 'tls', 'ca.pem'), idpCa = join(files, 'idp-tls', 'ca.pem'), origin = 'https://localhost:8443';
  step('image chausar-enterprise:dev exists', sh('docker', ['image', 'inspect', 'chausar-enterprise:dev'], { allowFail: true, quiet: true }).status === 0, 'build it first; this run never builds or pushes');
  prepare(); step('generated database, HTTPS and IdP certificates and secrets', true, files);
  docker(['up', '-d', '--no-build', '--wait', 'postgres', 'idp']); step('postgres (TLS only) and fake IdP are up', true);
  const init = docker(['run', '--rm', '--no-deps', 'server', 'node', 'enterprise/server/main.ts', '--init-workspace', 'Synthetic smoke business'], { quiet: true });
  step('workspace created by the operator command', /Workspace created/.test(init.out));
  docker(['up', '-d', '--no-build', 'server'], { quiet: true });
  step('server container reports healthy', await until(async () => docker(['ps', '--format', '{{.Health}}', 'server'], { quiet: true }).out.trim() === 'healthy', 120));
  const health = await call(`${origin}/healthz`, { ca: webCa });
  step('GET /healthz from the host', health.status === 200 && health.json?.status === 'ok' && health.json?.vaultOpen === true, health.text);

  const tls = docker(['exec', '-T', 'postgres', 'psql', '-U', 'chausar', '-d', 'chausar', '-tAc',
    "SELECT a.application_name || ':' || s.ssl || ':' || coalesce(s.version, '-') FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid) WHERE a.application_name LIKE 'chausar%' ORDER BY 1"], { quiet: true }).out.trim().split('\n').filter(Boolean);
  step('every Chausar database connection uses TLS', tls.length > 0 && tls.every(line => /:(t|true):TLSv1\.[23]$/.test(line)), [...new Set(tls)].join(', '));
  const plain = docker(['exec', '-T', 'postgres', 'psql', 'host=127.0.0.1 sslmode=disable user=chausar dbname=chausar', '-c', 'select 1'], { allowFail: true, quiet: true });
  step('a plaintext TCP connection is refused by PostgreSQL', plain.status !== 0 && /no pg_hba\.conf entry/.test(plain.out));

  const login = await call(`${origin}/auth/login`, { ca: webCa });
  const loginCookie = String((login.headers['set-cookie'] as string[])[0]).split(';')[0];
  const authorize = new URL(String(login.headers.location)); step('GET /auth/login redirects to the provider', login.status === 302 && authorize.origin === 'https://idp:9443');
  const approved = await call(`https://localhost:9443${authorize.pathname}${authorize.search}`, { ca: idpCa });
  const callback = new URL(String(approved.headers.location));
  const signedIn = await call(`${origin}${callback.pathname}${callback.search}`, { ca: webCa, headers: { cookie: loginCookie } });
  const session = ((signedIn.headers['set-cookie'] as string[] | undefined) ?? []).find(item => item.startsWith('__Host-chausar=') && !item.startsWith('__Host-chausar=;'))?.split(';')[0] ?? '';
  step('sign-in callback (server fetched discovery, token and keys from the IdP over TLS)', signedIn.status === 302 && !!session, signedIn.json?.error?.code);
  const me = await call(`${origin}/api/me`, { ca: webCa, headers: { cookie: session } });
  step('GET /api/me', me.status === 200 && me.json.role === 'owner', me.text);
  const rpc = (method: string, cookie = session) => call(`${origin}/api/rpc`, { method: 'POST', ca: webCa, body: JSON.stringify({ method, payload: {} }),
    headers: { cookie, origin, 'x-chausar-request': '1', 'content-type': 'application/json' } });
  const status = await rpc('workspace.status'); step('POST /api/rpc workspace.status', status.status === 200 && status.json.result.open === true);
  const members = await rpc('members.list'); step('POST /api/rpc members.list', members.status === 200 && Array.isArray(members.json.result), `${members.json?.result?.length} members`);
  const rows = docker(['exec', '-T', 'postgres', 'psql', '-U', 'chausar', '-d', 'chausar', '-tAc', 'SELECT count(*) FROM public.chausar_enterprise_sessions'], { quiet: true }).out.trim();
  step('the session is stored in PostgreSQL (digest only)', Number(rows) >= 1, `${rows} row(s)`);

  docker(['restart', 'server'], { quiet: true });
  step('server healthy again after a restart', await until(async () => (await call(`${origin}/healthz`, { ca: webCa })).json?.vaultOpen === true, 120));
  const after = await call(`${origin}/api/me`, { ca: webCa, headers: { cookie: session } });
  step('the session survives the server restart', after.status === 200 && after.json.role === 'owner');
  const out = await call(`${origin}/auth/logout`, { method: 'POST', ca: webCa, headers: { cookie: session, origin, 'x-chausar-request': '1' } });
  const refused = await call(`${origin}/api/me`, { ca: webCa, headers: { cookie: session } });
  step('sign-out ends the session', out.status === 200 && refused.status === 401);
}

let failed = false;
try { await main(); } catch (error) { failed = true; console.error(`Smoke run stopped: ${(error as Error).message}`); docker(['logs', '--tail', '60'], { allowFail: true }); }
finally {
  docker(['down', '-v', '--remove-orphans', '--timeout', '20'], { allowFail: true, quiet: true });
  rmSync(files, { recursive: true, force: true });
  const left = sh('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '-q'], { allowFail: true, quiet: true }).out.trim();
  console.log(`Torn down: ${left ? `containers remain: ${left}` : 'no containers, networks or volumes left'}`);
  console.log(`${results.filter(item => item.ok).length}/${results.length} steps passed${failed ? ' (stopped at the first failure)' : ''}.`);
  process.exitCode = failed ? 1 : 0;
}
