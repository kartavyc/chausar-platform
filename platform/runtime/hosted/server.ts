// Chausar hosted tier: the HTTP server. Experimental and off by default: it starts only with CHAUSAR_HOSTED=1 or --hosted.
//   node platform/runtime/hosted/server.ts --hosted --dev      (npm run start:hosted: http://localhost:4320, development outbox)
// Every response carries a strict content policy. Every POST must come from the configured origin. Sessions live in
// HttpOnly SameSite=Strict cookies; /api/rpc also needs the page's bearer, an HMAC of the session id. The renderer is the
// same app.js and launch.js as the desktop, told by one meta tag that it runs hosted.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import { openLoopbackPool, type PostgresPool } from '../postgres.ts';
import { SESSION_TTL_MS, type Authenticated, type Browser, type SignedIn } from './accounts.ts';
import { HostedApp } from './app.ts';
import { hostedConfig, type HostedConfig } from './config.ts';
import { HostedCustody } from './custody.ts';
import { FileDirectory, PostgresDirectory, type HostedDirectory } from './directory.ts';
import { DevOutbox, NoMailer, type Mailer } from './mailer.ts';
import { runEventFromActor, sseFrame } from '../venture/views/events.ts';

const rendererDir = fileURLToPath(new URL('../../../app/renderer/', import.meta.url));
const hostedDir = fileURLToPath(new URL('../../../app/hosted/', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const STATIC: Record<string, [string, string]> = {
  '/': [hostedDir, 'index.html'], '/index.html': [hostedDir, 'index.html'], '/hosted.js': [hostedDir, 'hosted.js'], '/hosted.css': [hostedDir, 'hosted.css'],
  '/assets/icon.svg': [rendererDir, 'assets/icon.svg'],
  '/app/': [rendererDir, 'index.html'], '/app/index.html': [rendererDir, 'index.html'], '/app/app.js': [rendererDir, 'app.js'], '/app/launch.js': [rendererDir, 'launch.js'],
  '/app/styles.css': [rendererDir, 'styles.css'], '/app/assets/icon.svg': [rendererDir, 'assets/icon.svg'],
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const HOSTED_META = '<meta name="chausar-mode" content="hosted">';
const MAX_STREAMS_PER_USER = 3;

export type HostedServerOptions = {
  origin: string;
  tls: HostedConfig['tls'];
  trustProxy: boolean;
  maxBodyBytes: number;
  /** Loaded certificate files when tls.kind is 'files'. */
  certificate?: { cert: Buffer; key: Buffer };
};

const statusOf = (code: string | undefined) => {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'UNAUTHENTICATED': return 401;
    case 'METHOD_NOT_ALLOWED': return 405;
    case 'RATE_LIMITED': return 429;
    case 'REQUEST_TOO_LARGE': return 413;
    case 'HOSTED_BUSY': case 'HOSTED_STOPPING': case 'HOSTED_STORAGE_UNAVAILABLE': return 503;
    case 'FORBIDDEN': case 'INVALID_HOST': case 'INVALID_ORIGIN': return 403;
    default: return 400;
  }
};

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= limit, 'REQUEST_TOO_LARGE', 'This request is too large.');
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new ChausarError('INVALID_REQUEST', 'Send JSON.'); }
  const inspect = (input: unknown, depth: number) => {
    check(depth < 40, 'INVALID_REQUEST', 'Request nesting is too deep.');
    if (input && typeof input === 'object') for (const [key, item] of Object.entries(input)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_REQUEST', 'Unsafe object keys are not accepted.');
      inspect(item, depth + 1);
    }
  };
  inspect(value, 0);
  return value;
}

export function createHostedServer(app: HostedApp, options: HostedServerOptions) {
  const origin = new URL(options.origin);
  const secure = origin.protocol === 'https:';
  const names = secure ? { session: '__Host-chausar-session', browser: '__Host-chausar-browser' } : { session: 'chausar-session', browser: 'chausar-browser' };
  const streams = new Map<string, number>();
  let closing = false;

  const cookie = (name: string, value: string, maxAgeSeconds: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${maxAgeSeconds}`;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const setCookies: string[] = [];
    const send = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      res.end(JSON.stringify(body));
    };
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    try {
      check(!closing, 'HOSTED_STOPPING', 'The server is restarting. Try again in a moment.');
      check(req.headers.host === origin.host, 'INVALID_HOST', 'This address is not served here.');
      const url = new URL(req.url ?? '/', origin);
      // With more than one server process, sessions and sign-ins made by the others are in the shared store.
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') await app.options.directory.refresh?.();
      const cookies = parseCookies(req.headers.cookie);
      const forwarded = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : '';
      const address = (options.trustProxy && forwarded) || req.socket.remoteAddress || 'unknown';
      const binding = (create: boolean): string => {
        const current = cookies.get(names.browser);
        if (current && /^[A-Za-z0-9_-]{43}$/.test(current)) return current;
        check(create, 'SIGN_IN_RESTART', 'Start signing in again from this browser.');
        const fresh = randomBytes(32).toString('base64url');
        setCookies.push(cookie(names.browser, fresh, 86400));
        return fresh;
      };
      const browser = (create: boolean): Browser => ({ binding: binding(create), address });
      const auth = (): Authenticated => app.accounts.authenticate(cookies.get(names.session));
      const signIn = (signed: SignedIn) => {
        setCookies.push(cookie(names.session, signed.token, Math.floor(SESSION_TTL_MS / 1000)));
        return { user: signed.user, session: signed.session, created: signed.created };
      };

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (url.pathname === '/app') { res.writeHead(308, { Location: '/app/' }); res.end(); return; }
        if (Object.hasOwn(STATIC, url.pathname)) {
          const [base, file] = STATIC[url.pathname];
          let data: Buffer | string = await readFile(join(base, file));
          if (url.pathname === '/app/' || url.pathname === '/app/index.html') {
            data = data.toString('utf8').replace('<head>', `<head>\n  ${HOSTED_META}`).replace('Opening your local workspace', 'Opening your workspace');
          }
          if (file.endsWith('.html')) binding(true);
          if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
          res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : data);
          return;
        }
        if (url.pathname === '/api/health') return send(200, { status: 'ok', mode: 'hosted-experimental' });
        if (url.pathname === '/api/hosted/session') {
          const session = auth();
          return send(200, { token: app.options.custody.rendererKey(session.session.id), me: app.me(session) });
        }
        if (url.pathname === '/api/hosted/events') return stream(auth(), req, res);
        // The Ink app's run events: the session cookie and the page's bearer, as /api/rpc asks for.
        if (url.pathname === '/api/events') {
          const session = auth();
          const bearer = req.headers.authorization ?? '';
          check(bearer.startsWith('Bearer ') && app.options.custody.sameRendererKey(session.session.id, bearer.slice(7)), 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
          return stream(session, req, res, true);
        }
        throw new ChausarError('NOT_FOUND', 'Nothing is here.');
      }

      check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST for requests.');
      check(req.headers.origin === origin.origin, 'INVALID_ORIGIN', 'Requests must come from the Chausar page.');
      const site = req.headers['sec-fetch-site'];
      check(site === undefined || site === 'same-origin', 'INVALID_ORIGIN', 'Requests must come from the Chausar page.');
      check((req.headers['content-type'] ?? '').startsWith('application/json'), 'INVALID_CONTENT_TYPE', 'Send JSON.');
      const body = await readJson(req, options.maxBodyBytes) as Record<string, unknown>;
      check(body && typeof body === 'object' && !Array.isArray(body), 'INVALID_REQUEST', 'Send one request object.');

      switch (url.pathname) {
        case '/api/auth/magic-link': return send(200, await app.accounts.requestMagicLink(body, browser(true)));
        case '/api/auth/magic-link/verify': return send(200, signIn(await app.accounts.verifyMagicLink(body, browser(false))));
        case '/api/auth/passkey/login/options': return send(200, await app.accounts.passkeyLoginOptions(browser(true)));
        case '/api/auth/passkey/login/verify': {
          check(Object.keys(body).every(key => key === 'credential'), 'INVALID_REQUEST', 'Send the passkey answer.');
          return send(200, signIn(await app.accounts.passkeyLoginVerify(body.credential, browser(false))));
        }
        case '/api/auth/passkey/register/options': return send(200, await app.accounts.passkeyRegisterOptions(auth()));
        case '/api/auth/passkey/register/verify': return send(200, await app.accounts.passkeyRegisterVerify(auth(), body));
        case '/api/auth/passkey/remove': return send(200, await app.accounts.removePasskey(auth(), body));
        case '/api/auth/sign-out': {
          const session = auth();
          check(Object.keys(body).every(key => key === 'everywhere') && (body.everywhere === undefined || typeof body.everywhere === 'boolean'), 'INVALID_REQUEST', 'Send everywhere as true or false.');
          const result = await app.accounts.signOut(session, body.everywhere === true);
          setCookies.push(cookie(names.session, '', 0));
          return send(200, result);
        }
        case '/api/account/delete': {
          const result = await app.accounts.deleteAccount(auth(), body);
          setCookies.push(cookie(names.session, '', 0));
          return send(200, result);
        }
        case '/api/hosted/select': return send(200, await app.select(auth(), body));
        case '/api/rpc': {
          const session = auth();
          const bearer = req.headers.authorization ?? '';
          check(bearer.startsWith('Bearer ') && app.options.custody.sameRendererKey(session.session.id, bearer.slice(7)), 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
          check(Object.keys(body).every(key => key === 'method' || key === 'payload'), 'INVALID_REQUEST', 'Send a method and a payload.');
          return send(200, { result: await app.rpc(session, body.method, body.payload) });
        }
        default: throw new ChausarError('NOT_FOUND', 'Nothing is here.');
      }
    } catch (error) {
      // Only Chausar's own refusals show their words. Node's errors (ENOENT, ERR_...) can carry paths, so they don't.
      const raw = error as { code?: unknown; syscall?: unknown; errno?: unknown };
      const known = error instanceof ChausarError || (typeof raw?.code === 'string' && /^[A-Z_]{1,64}$/.test(raw.code) && !raw.code.startsWith('ERR_')
        && raw.syscall === undefined && raw.errno === undefined);
      const code = known ? (error as ChausarError).code : 'SERVER_ERROR';
      const message = known ? (error as Error).message : 'Something went wrong on the server. Nothing was changed by this request.';
      if (!known) console.error('[hosted] request failed', (error as Error)?.stack ?? error);
      if (res.headersSent) { res.end(); return; }
      const extra: Record<string, string> = {};
      if (code === 'RATE_LIMITED') extra['Retry-After'] = String((error as any).retryAfterSeconds ?? 60);
      send(statusOf(code), { error: { code, message } }, extra);
    }
  };

  /** runEvents: the Ink app's stream, run events only, each as a VentureRunEvent for the open business (views/events.ts). */
  const stream = (session: Authenticated, req: IncomingMessage, res: ServerResponse, runEvents = false) => {
    const open = streams.get(session.user.id) ?? 0;
    check(open < MAX_STREAMS_PER_USER, 'RATE_LIMITED', 'Too many open pages. Close one and try again.');
    let off: (() => void) | null = null;
    const businessId = session.session.businessId ?? '';
    off = app.subscribe(session, runEvents
      ? event => { const run = runEventFromActor(event, businessId); if (run) res.write(sseFrame(run)); }
      : event => { res.write(`id: ${event.seq}\nevent: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`); });
    streams.set(session.user.id, open + 1);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    const heartbeat = setInterval(() => res.write(': still here\n\n'), 25_000);
    heartbeat.unref();
    const done = () => {
      clearInterval(heartbeat);
      if (off) { off(); off = null; const left = (streams.get(session.user.id) ?? 1) - 1; if (left > 0) streams.set(session.user.id, left); else streams.delete(session.user.id); }
    };
    req.on('close', done); res.on('close', done);
  };

  const server: Server = options.tls.kind === 'files'
    ? createHttpsServer({ cert: options.certificate?.cert, key: options.certificate?.key, minVersion: 'TLSv1.2' }, handler)
    : createHttpServer(handler);
  server.headersTimeout = 20_000;
  server.requestTimeout = 180_000;

  return {
    server,
    async listen(host: string, port: number): Promise<{ port: number }> {
      await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); accept(); }); });
      const address = server.address();
      check(address && typeof address === 'object', 'SERVER_FAILED', 'No port was assigned.');
      return { port: address.port };
    },
    async close() {
      closing = true;
      await new Promise<void>(accept => { server.close(() => accept()); server.closeIdleConnections(); setTimeout(() => { server.closeAllConnections(); }, 10_000).unref(); });
      await app.close();
    },
  };
}

/** The development custody key lives in the data folder so restarts keep working. Never in production. */
async function devCustody(dataDirectory: string): Promise<HostedCustody> {
  const path = join(dataDirectory, 'dev-custody.key');
  try { return HostedCustody.fromKey((await readFile(path, 'utf8')).trim()); }
  catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const key = randomBytes(32).toString('base64url');
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
  return HostedCustody.fromKey(key);
}

/** Opens the sealed directory: the file store, or the PostgreSQL store over a pool the business vaults share. */
async function openDirectory(config: HostedConfig, custody: HostedCustody, connect: (options: NonNullable<HostedConfig['postgres']>) => Promise<PostgresPool>) {
  if (config.storage !== 'postgres') return { directory: await FileDirectory.open(config.dataDirectory, custody) as HostedDirectory, pool: undefined };
  check(config.postgres, 'HOSTED_CONFIG_INVALID', 'PostgreSQL storage needs CHAUSAR_HOSTED_POSTGRES_URL.');
  const pool = await connect(config.postgres);
  try { return { directory: await PostgresDirectory.open(pool, custody, { endPoolOnClose: true }) as HostedDirectory, pool }; }
  catch (error) { await pool.end().catch(() => {}); throw error; }
}

/**
 * Builds the app from a checked config: custody, the sealed directory, mail, transports, the runtime. Tests pass a
 * stand-in for the PostgreSQL connection; the server itself always opens a loopback pool.
 */
export async function startHosted(config: HostedConfig, print: (line: string) => void = line => console.log(line),
  connect: (options: NonNullable<HostedConfig['postgres']>) => Promise<PostgresPool> = options => openLoopbackPool(options, 'chausar-hosted')) {
  await mkdir(config.dataDirectory, { recursive: true, mode: 0o700 });
  const custody = config.custody.kind === 'env' ? HostedCustody.fromKey(config.custody.key) : await devCustody(config.dataDirectory);
  const { directory, pool } = await openDirectory(config, custody, connect);
  try {
    const mailer: Mailer = config.mailer === 'dev-outbox' ? new DevOutbox(print) : new NoMailer();
    const models = await import('../venture/models/index.ts');
    const build = await import('../venture/build/index.ts');
    let modelTransport = models.defaultModelTransport();
    let githubTransport: any = build.defaultGitHubTransport();
    if (config.replay?.model) modelTransport = models.createReplayTransport(JSON.parse(await readFile(resolve(config.replay.model), 'utf8')));
    if (config.replay?.github) {
      const fixture = JSON.parse(await readFile(resolve(config.replay.github), 'utf8'));
      githubTransport = (store: any) => build.createFixtureGitHubTransport(fixture, () => ({
        briefId: [...store.read().conversations].reverse().find((r: any) => r.kind === 'venture-brief')?.briefId ?? '' }));
    }
    const app = new HostedApp({ root: config.dataDirectory, rp: config.rp, directory, custody, mailer, limits: config.limits, version: '0.1.0-preview.1', modelTransport, githubTransport, postgres: pool });
    const certificate = config.tls.kind === 'files' ? { cert: await readFile(config.tls.cert), key: await readFile(config.tls.key) } : undefined;
    const http = createHostedServer(app, { origin: config.origin, tls: config.tls, trustProxy: config.trustProxy, maxBodyBytes: config.limits.maxBodyBytes, certificate });
    app.startHousekeeping();
    return { app, http, custody };
  } catch (error) { await directory.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let config: HostedConfig;
  try { config = hostedConfig(process.env, process.argv); }
  catch (error) { console.error((error as Error).message); process.exit(1); }
  const { http } = await startHosted(config);
  await http.listen(config.listen.host, config.listen.port);
  console.log(`Chausar hosted web (experimental) at ${config.origin}, listening on ${config.listen.host}:${config.listen.port}.`);
  console.log(config.storage === 'postgres'
    ? 'Accounts and businesses are kept in PostgreSQL, sealed and encrypted. Experimental: not yet tested on a real deploy.'
    : 'Businesses are kept in experimental encrypted file storage. Practise here; nothing is deployed.');
  if (config.custody.kind === 'dev-file') console.log(`Development custody key in ${join(config.dataDirectory, 'dev-custody.key')}. Never use it for real accounts.`);
  if (config.mailer === 'dev-outbox') console.log('Sign-in links are printed here, not emailed.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void http.close().finally(() => process.exit(0)); });
}

