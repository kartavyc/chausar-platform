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

const renderer = fileURLToPath(new URL('../../app/renderer/', import.meta.url));
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const validToken = (actual: string, expected: string) => Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

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
export function createLocalServer(engine: Engine, options: { token?: string; port?: number } = {}) {
  const token = options.token ?? randomBytes(32).toString('hex'); let origin = ''; let closing = false;
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => response(res, status, value, closing);
    res.setHeader('Content-Security-Policy', csp); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const host = req.headers.host ?? ''; const expectedHost = new URL(origin).host;
      check(req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1', 'INVALID_HOST', 'The owner instance accepts loopback clients only.');
      check(host === expectedHost, 'INVALID_HOST', 'Only this loopback address is allowed.');
      check(!req.headers.origin || req.headers.origin === origin, 'INVALID_ORIGIN', 'Cross-origin requests are blocked.');
      check(req.headers['sec-fetch-site'] !== 'cross-site', 'INVALID_ORIGIN', 'Cross-site browser requests are blocked.');
      const url = new URL(req.url ?? '/', origin);
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
      if (url.pathname === '/api/rpc' || url.pathname === '/mcp') {
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST for named requests.');
        const auth = req.headers.authorization ?? '';
        check(auth.startsWith('Bearer '), 'UNAUTHENTICATED', 'This request needs a current local session.');
        const suppliedToken = auth.slice(7); const bootstrap = validToken(suppliedToken, token);
        let context;
        if (bootstrap) context = engine.bootstrapContext();
        else {
          try { context = engine.contextForSession(suppliedToken); }
          catch { throw Object.assign(new Error('This workspace session expired or was revoked.'), { code: 'UNAUTHENTICATED' }); }
        }
        check((req.headers['content-type'] ?? '').startsWith('application/json'), 'INVALID_CONTENT_TYPE', 'Use a JSON request.');
        const data = await body(req);
        if (url.pathname === '/mcp') return send(200, await engine.requestAs(context, 'mcp.handle', data));
        if (['auth.accept', 'workspace.create', 'workspace.open', 'workspace.restore', 'workspace.recover'].includes(data.method)) check(bootstrap, 'FORBIDDEN', 'This operation requires the trusted local owner bootstrap session.');
        return send(200, { result: await engine.requestAs(context, data.method, data.payload ?? {}) });
      }
      check(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', 'Use GET for application files.');
      const known: Record<string, string> = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/launch.js': 'launch.js', '/assets/icon.svg': 'assets/icon.svg' };
      check(known[url.pathname], 'NOT_FOUND', 'This application file does not exist.');
      const path = join(renderer, known[url.pathname]); const ext = path.slice(path.lastIndexOf('.')); const data = await readFile(path);
      if (closing) res.setHeader('Connection', 'close');
      res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const e = error as Error & { code?: string }; const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'UNAUTHENTICATED' ? 401 : e.code?.includes('FORBIDDEN') || e.code === 'INVALID_HOST' || e.code === 'INVALID_ORIGIN' ? 403 : e.code === 'METHOD_NOT_ALLOWED' ? 405 : 400;
      send(status, { error: { code: e.code ?? 'REQUEST_FAILED', message: e.message } });
    }
  });
  return {
    server, token,
    async listen() {
      await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolveListen(); }); });
      const address = server.address(); check(address && typeof address === 'object', 'SERVER_FAILED', 'No local port was assigned.'); origin = `http://127.0.0.1:${address.port}`; return { origin, token };
    },
    async close(timeoutMs = 70000) {
      check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded local server shutdown deadline.');
      closing = true;
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
  return new Engine({ directory: environment.CHAUSAR_VAULT_DIRECTORY ?? resolve('data'), demo, storage: demo ? 'experimental-file' : 'postgres', postgresUrl: environment.CHAUSAR_POSTGRES_URL, pythonExecutable: environment.CHAUSAR_PYTHON, updatePublicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs: engineJobOptions(environment), gateway, venture: { ...ventureHostEnv(environment, { demo, host: 'local-web', args }), ...(gateway?.codexCli ? { codexCli: gateway.codexCli, hostProcess: gateway.process } : {}) } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const engine = await createServerEngine(); const demo = engine.options.demo;
  const app = createLocalServer(engine, { port: Number(process.env.CHAUSAR_PORT ?? 4317) });
  const { origin, token } = await app.listen(); console.log(`Chausar owner pairing link: ${origin}/#token=${token}\n${demo ? 'Experimental local file storage; synthetic demo only.' : 'PostgreSQL authority storage.'}`);
  const scheduler = setInterval(() => { void engine.tick().catch(() => {}); }, 30000); scheduler.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearInterval(scheduler); void app.close().finally(() => process.exit(0)); });
}
