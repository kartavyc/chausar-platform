import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Engine } from './engine.ts';
import { engineJobOptions } from './engine-jobs.ts';
import { loadCodexCliHostGateway, type CodexCliHostDependencies } from './codex-cli-host.ts';
import { check } from './contracts.ts';
import { ventureHostEnv } from './venture/host-env.ts';
import { SSE_HEADERS, SSE_HEARTBEAT, SSE_PREAMBLE, sseFrame } from './venture/views/events.ts';
import { CUSTODY_METHODS } from './workspace-custody-contracts.ts';
import { workspaceCustodyEnv } from './workspace-custody.ts';
import { INK_ROOT, INK_TYPES, listInkFiles } from './ui-ink.ts';
import { createPhoneAccess, privatePeer } from './phone-access.ts';
import { ownerError } from './owner-error.ts';

/** Only the trusted local owner bootstrap session may send these (never a member session). */
export const BOOTSTRAP_ONLY_METHODS: readonly string[] = Object.freeze(['auth.accept', 'workspace.create', 'workspace.open', 'workspace.restore', 'workspace.recover',
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls', 'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
  'venture.country.suggest',
  'venture.ai.tools', 'venture.ai.login.start', 'venture.ai.login.cancel', 'venture.about.read', 'venture.about.pick', 'venture.about.families',
  ...CUSTODY_METHODS]);

/** The built Ink app (app/ui/dist) and its allowlist (listInkFiles in ui-ink.ts, shared with the hosted web server). */
export type InkBuild = { folder: string; files: Record<string, string> };
/**
 * W6 6F7: the phone listener's side of this server (phone-access.ts makes it). bind: the address it listens on. hosts:
 * the host:port names a phone may use (this computer's home network and Tailscale addresses). pair: exchanges a one-time
 * code from a pairing link for a member session. accepts: whether a bearer is a phone session this listener issued.
 */
export type PhoneListener = { bind: string; hosts(port: number): string[]; pair(code: unknown): Promise<{ token: string; expiresAt: string }>; accepts(token: string): boolean };
/**
 * Methods a phone never sends, on top of the bootstrap-only ones: sessions, invitations, members, the companion's pairing,
 * the trust settings and the workspace itself (it may read the workspace status).
 */
const PHONE_REFUSED = /^(auth|phone|members|trust)\.|^workspace\.(?!status$)/;
const validToken = (actual: string, expected: string) => Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function response(res: ServerResponse, status: number, body: unknown, closing = false) {
  if (closing) res.setHeader('Connection', 'close');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; check(size <= 2_000_000, 'REQUEST_TOO_LARGE', 'File import is limited to two megabytes per request.'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  function inspect(input: unknown, depth = 0) {
    check(depth < 40, 'INVALID_REQUEST', 'Request nesting is too deep.');
    if (input && typeof input === 'object') for (const [key, item] of Object.entries(input)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_REQUEST', 'Unsafe object keys are not accepted.'); inspect(item, depth + 1);
    }
  }
  inspect(value); return value;
}
/**
 * The owner's loopback server: the Ink app at / and the named requests at /api/rpc. The entrypoint always passes the Ink
 * build, listed before the engine opens; without it (tests of the API alone) every application file answers 404.
 */
export function createLocalServer(engine: Engine, options: { token?: string; port?: number; ink?: InkBuild; phone?: PhoneListener } = {}) {
  const token = options.token ?? randomBytes(32).toString('hex'); let origin = ''; let closing = false;
  const ink = options.ink ?? null;
  // W6 6F7: in phone mode this server is the phone listener: home-network peers only, phone sessions only, channel 'phone'.
  const phone = options.phone ?? null;
  const phoneContext = (bearer: string) => {
    check(phone!.accepts(bearer), 'UNAUTHENTICATED', 'Pair this phone again from the Chausar app on your computer.');
    try { return engine.contextForSession(bearer, 'phone'); }
    catch { throw Object.assign(new Error('This phone session ended. Pair again from the Chausar app on your computer.'), { code: 'UNAUTHENTICATED' }); }
  };
  // Open /api/events streams: closing the server ends them, so a shutdown never waits on a page that stays open.
  const streams = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => response(res, status, value, closing);
    res.setHeader('Content-Security-Policy', csp); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const host = req.headers.host ?? ''; const expectedHost = new URL(origin).host;
      if (phone) {
        check(privatePeer(req.socket.remoteAddress), 'INVALID_HOST', 'Phone access accepts phones on this home network or Tailscale only.');
        check(phone.hosts(Number(new URL(origin).port)).includes(host), 'INVALID_HOST', 'Open the pairing link exactly as Chausar made it.');
        check(!req.headers.origin || req.headers.origin === `http://${host}`, 'INVALID_ORIGIN', 'Cross-origin requests are blocked.');
      } else {
        check(req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1', 'INVALID_HOST', 'The owner instance accepts loopback clients only.');
        check(host === expectedHost, 'INVALID_HOST', 'Only this loopback address is allowed.');
        check(!req.headers.origin || req.headers.origin === origin, 'INVALID_ORIGIN', 'Cross-origin requests are blocked.');
      }
      check(req.headers['sec-fetch-site'] !== 'cross-site', 'INVALID_ORIGIN', 'Cross-site browser requests are blocked.');
      const url = new URL(req.url ?? '/', origin);
      // Client share links open only on the hosted web server (hosted/server.ts); this computer serves none, and no
      // client's file request page (/share/<token>/upload, 4J7) either.
      check(url.pathname !== '/share' && !url.pathname.startsWith('/share/'), 'NOT_FOUND', 'Share links open only on the hosted Chausar.');
      // The phone listener never serves the desktop's own routes: the companion protocol, the bootstrap session or MCP.
      check(!phone || !['/api/companion/rpc', '/api/session', '/mcp'].includes(url.pathname), 'NOT_FOUND', 'This address is not served to phones.');
      if (phone && url.pathname === '/api/phone/pair') {
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST to pair a phone.');
        check((req.headers['content-type'] ?? '').startsWith('application/json'), 'INVALID_CONTENT_TYPE', 'Use a JSON request.');
        const data = await body(req);
        check(data && typeof data === 'object' && typeof data.code === 'string' && Object.keys(data).length === 1, 'INVALID_REQUEST', 'Send the pairing code from the link.');
        return send(200, await phone.pair(data.code));
      }
      if (url.pathname === '/api/companion/rpc') {
        check(!closing, 'ENGINE_STOPPING', 'The local server is completing pending work.');
        return await engine.handleCompanionHttp(req, res);
      }
      if (url.pathname === '/api/session' && req.method === 'GET') {
        const bearer = req.headers.authorization ?? '';
        check(bearer.startsWith('Bearer ') && validToken(bearer.slice(7), token), 'UNAUTHENTICATED', 'Pair this owner browser using the local launch link.');
        return send(200, { token });
      }
      if (url.pathname === '/api/health' && req.method === 'GET') return send(200, { status: 'ok', vaultOpen: !!engine.vault, mode: engine.options.demo ? 'experimental-demo' : 'postgres' });
      // Run events as Server-Sent Events, with the same bearer as /api/rpc. Each frame says only what changed.
      if (url.pathname === '/api/events') {
        check(req.method === 'GET', 'METHOD_NOT_ALLOWED', 'Use GET for the event stream.');
        check(!closing, 'ENGINE_STOPPING', 'The local server is completing pending work.');
        const auth = req.headers.authorization ?? '';
        check(auth.startsWith('Bearer '), 'UNAUTHENTICATED', 'This request needs a current local session.');
        // The owner's own stream (the bootstrap token, or a session with the owner's role) is the owner watching (4G1).
        let ownerStream = !phone && validToken(auth.slice(7), token);
        if (phone) ownerStream = phoneContext(auth.slice(7)).role === 'owner';
        else if (!ownerStream) {
          try { ownerStream = engine.contextForSession(auth.slice(7)).role === 'owner'; }
          catch { throw Object.assign(new Error('This workspace session expired or was revoked.'), { code: 'UNAUTHENTICATED' }); }
        }
        res.writeHead(200, SSE_HEADERS); res.write(SSE_PREAMBLE);
        // Each frame carries its seq (and names it as the event id).
        const off = engine.onVentureEvent(event => { res.write(sseFrame(event)); });
        const unwatch = ownerStream ? engine.watchEvents() : () => {};
        const heartbeat = setInterval(() => res.write(SSE_HEARTBEAT), 25_000); heartbeat.unref();
        streams.add(res);
        const done = () => { clearInterval(heartbeat); off(); unwatch(); streams.delete(res); };
        req.on('close', done); res.on('close', done);
        return;
      }
      if (url.pathname === '/api/rpc' || url.pathname === '/mcp') {
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST for named requests.');
        const auth = req.headers.authorization ?? '';
        check(auth.startsWith('Bearer '), 'UNAUTHENTICATED', 'This request needs a current local session.');
        const suppliedToken = auth.slice(7); const bootstrap = !phone && validToken(suppliedToken, token);
        let context;
        if (phone) context = phoneContext(suppliedToken);
        else if (bootstrap) context = engine.bootstrapContext();
        else {
          try { context = engine.contextForSession(suppliedToken); }
          catch { throw Object.assign(new Error('This workspace session expired or was revoked.'), { code: 'UNAUTHENTICATED' }); }
        }
        check((req.headers['content-type'] ?? '').startsWith('application/json'), 'INVALID_CONTENT_TYPE', 'Use a JSON request.');
        const data = await body(req);
        if (url.pathname === '/mcp') return send(200, await engine.requestAs(context, 'mcp.handle', data));
        if (BOOTSTRAP_ONLY_METHODS.includes(data.method)) check(bootstrap, 'FORBIDDEN', 'This operation requires the trusted local owner bootstrap session.');
        check(!phone || !PHONE_REFUSED.test(String(data.method)), 'FORBIDDEN', 'Do this in the Chausar app on your computer.');
        return send(200, { result: await engine.requestAs(context, data.method, data.payload ?? {}) });
      }
      check(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', 'Use GET for application files.');
      check(ink !== null && Object.hasOwn(ink.files, url.pathname), 'NOT_FOUND', 'This application file does not exist.');
      const path = join(ink.folder, ink.files[url.pathname]); const ext = path.slice(path.lastIndexOf('.')); const data = await readFile(path);
      if (closing) res.setHeader('Connection', 'close');
      res.writeHead(200, { 'Content-Type': INK_TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const e = error as Error & { code?: string; reason?: unknown }; const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'UNAUTHENTICATED' ? 401 : e.code?.includes('FORBIDDEN') || e.code === 'INVALID_HOST' || e.code === 'INVALID_ORIGIN' ? 403 : e.code === 'METHOD_NOT_ALLOWED' ? 405 : 400;
      // DEVICE_KEYS_UNAVAILABLE carries why, so the page can show the engine's words without guessing.
      // Only Chausar's own refusals keep their words; an engine bug never shows its source text (owner-error.ts).
      send(status, { error: ownerError(error) });
    }
  });
  return {
    server, token,
    async listen() {
      const bind = phone?.bind ?? '127.0.0.1';
      await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(options.port ?? 0, bind, () => { server.off('error', reject); resolveListen(); }); });
      const address = server.address(); check(address && typeof address === 'object', 'SERVER_FAILED', 'No local port was assigned.'); origin = `http://${bind}:${address.port}`; return { origin, token };
    },
    /** W6 6F7: closes this listener only (the phone listener), never the engine: open streams end, then connections. */
    async stopListening(timeoutMs = 5000) {
      closing = true;
      for (const stream of [...streams]) stream.end();
      await new Promise<void>(resolveClose => {
        const timer = setTimeout(() => server.closeAllConnections(), timeoutMs); timer.unref();
        server.close(() => { clearTimeout(timer); resolveClose(); });
        server.closeIdleConnections();
      });
    },
    async close(timeoutMs = 70000) {
      check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded local server shutdown deadline.');
      closing = true;
      for (const stream of [...streams]) stream.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drain = new Promise<void>((resolveClose, reject) => {
        timer = setTimeout(() => { server.closeAllConnections(); reject(new Error('Local HTTP shutdown exceeded its deadline.')); }, timeoutMs);
        server.close(error => error ? reject(error) : resolveClose());
      });
      // Interrupt/drain active jobs while HTTP connections are finishing, not after.
      try { await Promise.all([drain, engine.shutdown(timeoutMs)]); }
      finally { if (timer) clearTimeout(timer); }
    },
  };
}

/** The normal server entrypoint and trusted host tests share the same constructor. */
export async function createServerEngine(environment: NodeJS.ProcessEnv = process.env, args: readonly string[] = process.argv, dependencies: CodexCliHostDependencies = {}): Promise<Engine> {
  const demo = args.includes('--demo');
  const gateway = await loadCodexCliHostGateway(environment, dependencies);
  // W6 6F7: the phone listener starts only when the owner makes a pairing link in the app.
  let engine: Engine | null = null;
  const phoneAccess = createPhoneAccess(() => engine!, { ink: async () => ({ folder: INK_ROOT, files: await listInkFiles(INK_ROOT) }) });
  return engine = new Engine({ directory: environment.CHAUSAR_VAULT_DIRECTORY ?? resolve('data'), demo, storage: demo ? 'experimental-file' : 'postgres', postgresUrl: environment.CHAUSAR_POSTGRES_URL, pythonExecutable: environment.CHAUSAR_PYTHON, updatePublicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs: engineJobOptions(environment), gateway, workspaceCustody: workspaceCustodyEnv(environment), venture: { ...ventureHostEnv(environment, { demo, host: 'local-web', args }), ...(gateway?.codexCli ? { codexCli: gateway.codexCli, hostProcess: gateway.process } : {}), phoneAccess } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The host settings are checked first (a refused Codex CLI host stops here, CLI_HOST_EVIDENCE_INVALID), then the Ink
  // build is listed, both before anything listens: an unbuilt Ink app stops the start with its own plain reason
  // (UI_NOT_BUILT). Making the engine opens no vault.
  const engine = await createServerEngine(); const demo = engine.options.demo;
  let ink: InkBuild;
  try { ink = { folder: INK_ROOT, files: await listInkFiles(INK_ROOT) }; }
  catch (error) { if ((error as { code?: string }).code !== 'UI_NOT_BUILT') throw error; console.error((error as Error).message); process.exit(1); }
  const app = createLocalServer(engine, { port: Number(process.env.CHAUSAR_PORT ?? 4317), ink });
  const { origin, token } = await app.listen(); console.log(`Chausar owner pairing link: ${origin}/#token=${token}\n${demo ? 'Experimental local file storage; synthetic demo only.' : 'PostgreSQL authority storage.'}`);
  const scheduler = setInterval(() => { void engine.tick().catch(() => {}); }, 30000); scheduler.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearInterval(scheduler); void app.close().finally(() => process.exit(0)); });
}
