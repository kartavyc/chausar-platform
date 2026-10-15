import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ChausarError, check } from '../../platform/runtime/contracts.ts';
import type { Context } from '../../platform/runtime/contracts.ts';
import type { Engine } from '../../platform/runtime/engine.ts';
import uiAssets from '../../app/desktop/ui-assets.cjs';
import ipc from '../../app/desktop/ipc-contract.cjs';
import { readSecretFile, readTlsFiles, type EnterpriseConfig } from './config.ts';
import { OidcClient, type FetchLike } from './oidc.ts';
import { IdentityDirectory } from './identity.ts';
import { MemoryEnterpriseStore, type EnterpriseStateStore } from './state-store.ts';
const { readUiAsset } = uiAssets;
const { validateRequest } = ipc;

export type EnterpriseServerDeps = {
  /** Trusted test composition: replaces the provider transport. */
  fetch?: FetchLike;
  /** Trusted test composition only; never read from configuration. */
  allowLoopbackHttpIssuer?: boolean;
  oidc?: OidcClient; identity?: IdentityDirectory; tls?: { cert: Buffer; key: Buffer };
  now?: () => number; uiRoot?: string; authRateLimitPerMinute?: number;
  /** Shared sessions, sign-ins in progress, rate limits and the identity map. The caller owns and closes it. Defaults to one process's memory. */
  store?: EnterpriseStateStore;
};
export type EnterpriseServer = { server: Server; oidc: OidcClient; identity: IdentityDirectory; store: EnterpriseStateStore; sessionCount(): Promise<number>; listen(): Promise<{ origin: string; port: number }>; close(timeoutMs?: number): Promise<void> };

/** Methods that change custody or the server itself stay with the trusted local operator. */
export const BOOTSTRAP_ONLY_METHODS: readonly string[] = Object.freeze(['auth.accept', 'workspace.create', 'workspace.open', 'workspace.restore', 'workspace.recover', 'workspace.delete', 'workspace.lock']);
export const BOOTSTRAP_ONLY_PREFIXES: readonly string[] = Object.freeze(['updates.', 'release.', 'service.', 'native.', 'workspace.activation.', 'workspace.backup.activation.']);
export const isDeniedMethod = (method: string) => BOOTSTRAP_ONLY_METHODS.includes(method) || BOOTSTRAP_ONLY_PREFIXES.some(prefix => method.startsWith(prefix));

const SESSION_COOKIE = '__Host-chausar';
const LOGIN_COOKIE = '__Host-chausar-login';
const MAX_SESSIONS = 20_000;
const BODY_LIMIT = 2_000_000;
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const shellFile = fileURLToPath(new URL('./ui/shell.js', import.meta.url));
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const sameText = (left: string, right: string) => Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));

function cookies(req: IncomingMessage): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').slice(0, 8192).split(';')) {
    const at = part.indexOf('='); if (at < 0) continue;
    const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
    if (!found.has(name)) found.set(name, value);
  }
  return found;
}
function statusFor(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'UNAUTHENTICATED' || code.startsWith('OIDC_') || code === 'ENTERPRISE_SESSION_REQUIRED') return 401;
  if (code === 'METHOD_NOT_ALLOWED') return 405;
  if (code === 'REQUEST_TOO_LARGE') return 413;
  if (code === 'RATE_LIMITED') return 429;
  if (code.includes('FORBIDDEN') || ['ACCESS_REVOKED', 'INVALID_HOST', 'INVALID_ORIGIN', 'CSRF_REQUIRED', 'ENTERPRISE_ROLE_UNMAPPED', 'ENTERPRISE_EMAIL_REFUSED', 'ENTERPRISE_MEMBER_REVOKED', 'ENTERPRISE_METHOD_DENIED'].includes(code)) return 403;
  return 400;
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  check(Number(req.headers['content-length'] ?? '0') <= BODY_LIMIT, 'REQUEST_TOO_LARGE', 'A request is limited to two megabytes.');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; check(size <= BODY_LIMIT, 'REQUEST_TOO_LARGE', 'A request is limited to two megabytes.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { check(false, 'INVALID_REQUEST', 'Use a JSON request.'); }
}
/** The desktop allowlist and structure checks, with their refusal restated as a fixed engine error. */
function namedRequest(value: unknown): { method: string; payload: Record<string, unknown> } {
  try { return validateRequest(value); }
  catch (error) { const code = (error as { code?: string }).code; check(false, code === 'REQUEST_TOO_LARGE' ? code : 'INVALID_REQUEST', code === 'REQUEST_TOO_LARGE' ? 'A request is limited to two megabytes.' : 'This request is not supported.'); }
}

/** HTTPS server: OIDC sign-in, server-side sessions, and engine requests as the signed-in member. */
export async function createEnterpriseServer(engine: Engine, config: EnterpriseConfig, deps: EnterpriseServerDeps = {}): Promise<EnterpriseServer> {
  const now = deps.now ?? Date.now; const origin = config.publicOrigin; const expectedHost = new URL(origin).host;
  const ownStore = !deps.store; const store = deps.store ?? new MemoryEnterpriseStore();
  const tls = deps.tls ?? await readTlsFiles(config);
  const oidc = deps.oidc ?? new OidcClient({ issuer: config.oidc.issuer, clientId: config.oidc.clientId, clientSecret: await readSecretFile(config.oidc.clientSecretFile),
    redirectUri: `${origin}${config.oidc.redirectPath}`, scopes: config.oidc.scopes, fetch: deps.fetch, now, allowLoopbackHttpIssuer: deps.allowLoopbackHttpIssuer === true, logins: store });
  const identity = deps.identity ?? await IdentityDirectory.open(engine, { dataDirectory: config.dataDirectory, rules: config.roles, allowedEmailDomains: config.allowedEmailDomains, store: store.identities });
  const ttlMs = config.sessionTtlMinutes * 60_000;
  const limit = deps.authRateLimitPerMinute ?? 60;
  let closing = false;

  async function createSession(context: Context): Promise<string> {
    const at = now(); const id = randomBytes(32).toString('base64url');
    await store.putSession(digest(id), { memberId: context.memberId, role: context.role, epoch: context.epoch, expiresAt: at + ttlMs }, MAX_SESSIONS, at); return id;
  }
  /** Re-checks the member on every request: revocation or a changed epoch ends the session. */
  async function currentSession(req: IncomingMessage) {
    const id = cookies(req).get(SESSION_COOKIE) ?? '';
    check(tokenShape.test(id), 'UNAUTHENTICATED', 'Sign in to continue.');
    const key = digest(id); const session = await store.getSession(key, now());
    check(session && session.expiresAt > now(), 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    const member = await identity.current(session.memberId, session.role, session.epoch);
    if (!member) { await store.deleteSession(key); check(false, 'UNAUTHENTICATED', 'Your workspace access changed. Sign in again.'); }
    const context: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
    return { key, context, member };
  }
  function requireCsrf(req: IncomingMessage) {
    check(req.headers['x-chausar-request'] === '1', 'CSRF_REQUIRED', 'This request is missing its same-site marker.');
    check(req.headers.origin === origin, 'INVALID_ORIGIN', 'Cross-origin requests are blocked.');
    check(req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin', 'INVALID_ORIGIN', 'Cross-site browser requests are blocked.');
  }
  const sessionCookie = (value: string, maxAge: number) => `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  const loginCookie = (value: string, maxAge: number) => `${LOGIN_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

  async function route(req: IncomingMessage, res: ServerResponse, send: (status: number, value: unknown, headers?: Record<string, string | string[]>) => void) {
    const url = new URL(req.url ?? '/', origin); const path = url.pathname;
    if (path === '/healthz') { check(req.method === 'GET', 'METHOD_NOT_ALLOWED', 'Use GET for the health check.'); return send(closing ? 503 : 200, { status: closing ? 'stopping' : 'ok', vaultOpen: !!engine.vault }); }
    check(req.headers.host === expectedHost, 'INVALID_HOST', 'Use the configured public address.');
    if (path === '/') { check(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', 'Use GET.'); res.writeHead(302, { Location: '/ui/index.html', 'Cache-Control': 'no-store' }); return res.end(); }
    if (path.startsWith('/auth/')) {
      await store.hit(req.socket.remoteAddress ?? 'unknown', now(), limit);
      if (path === '/auth/login') {
        check(req.method === 'GET', 'METHOD_NOT_ALLOWED', 'Use GET to sign in.');
        const { url: target, state } = await oidc.beginLogin();
        res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', 'Set-Cookie': loginCookie(state, 600) }); return res.end();
      }
      if (path === config.oidc.redirectPath) {
        check(req.method === 'GET', 'METHOD_NOT_ALLOWED', 'Use GET for the sign-in return.');
        res.setHeader('Set-Cookie', loginCookie('', 0));
        check(!url.searchParams.has('error'), 'OIDC_LOGIN_FAILED', 'The sign-in provider did not complete the sign-in.');
        const state = url.searchParams.get('state') ?? ''; const bound = cookies(req).get(LOGIN_COOKIE) ?? '';
        check(tokenShape.test(state) && tokenShape.test(bound) && sameText(state, bound), 'OIDC_STATE_INVALID', 'This sign-in attempt is not recognised. Start again.');
        const claims = await oidc.completeLogin({ state, code: url.searchParams.get('code') });
        const signedIn = await identity.signIn(oidc.options.issuer, claims);
        const id = await createSession(signedIn.context);
        res.writeHead(302, { Location: '/ui/index.html', 'Cache-Control': 'no-store', 'Set-Cookie': [sessionCookie(id, Math.floor(ttlMs / 1000)), loginCookie('', 0)] }); return res.end();
      }
      if (path === '/auth/logout') {
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST to sign out.');
        requireCsrf(req);
        const id = cookies(req).get(SESSION_COOKIE) ?? ''; if (tokenShape.test(id)) await store.deleteSession(digest(id));
        return send(200, { signedOut: true }, { 'Set-Cookie': sessionCookie('', 0) });
      }
      check(false, 'NOT_FOUND', 'This address does not exist.');
    }
    if (path === '/api/me') {
      check(req.method === 'GET', 'METHOD_NOT_ALLOWED', 'Use GET.');
      const { member } = await currentSession(req);
      return send(200, { memberId: member.id, role: member.role, branches: [...member.branches] });
    }
    if (path === '/api/rpc') {
      check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST for named requests.');
      check(!closing, 'ENGINE_STOPPING', 'The server is completing pending work.');
      requireCsrf(req);
      const { context } = await currentSession(req);
      check((req.headers['content-type'] ?? '').startsWith('application/json'), 'INVALID_CONTENT_TYPE', 'Use a JSON request.');
      const { method, payload } = namedRequest(await readBody(req));
      check(!isDeniedMethod(method), 'ENTERPRISE_METHOD_DENIED', 'This operation is only available to the local server operator.');
      return send(200, { result: await engine.requestAs(context, method, payload) });
    }
    check(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', 'Use GET for application files.');
    // The enterprise shell keeps the session in an HttpOnly cookie instead of a launch token.
    const asset = path === '/ui/shell.js' ? { body: await readFile(shellFile), mime: 'text/javascript; charset=utf-8' } : await readUiAsset(deps.uiRoot ?? repositoryRoot, path, true);
    check(asset, 'NOT_FOUND', 'This application file does not exist.');
    res.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  }

  const server = createServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' }, async (req, res) => {
    const send = (status: number, value: unknown, headers: Record<string, string | string[]> = {}) => {
      if (closing) res.setHeader('Connection', 'close');
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(value));
    };
    res.setHeader('Content-Security-Policy', csp); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try { await route(req, res, send); }
    catch (error) {
      // Only fixed engine sentences leave the server; anything else is a generic failure.
      const known = error instanceof ChausarError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code);
      if (res.headersSent) { res.destroy(); return; }
      if (known) send(statusFor(error.code), { error: { code: error.code, message: error.message } });
      else send(500, { error: { code: 'REQUEST_FAILED', message: 'The request could not be completed.' } });
    }
  });
  server.requestTimeout = 60_000; server.headersTimeout = 20_000;
  return {
    server, oidc, identity, store, sessionCount: () => store.sessionCount(now()),
    async listen() {
      await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(config.listen.port, config.listen.host, () => { server.off('error', reject); resolveListen(); }); });
      const address = server.address(); check(address && typeof address === 'object', 'SERVER_FAILED', 'No port was assigned.');
      return { origin, port: address.port };
    },
    async close(timeoutMs = 70000) {
      check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded server shutdown deadline.');
      // A shared store keeps its sessions: another process, or this one after a restart, continues them.
      closing = true; if (ownStore) await store.close();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drain = new Promise<void>((resolveClose, reject) => {
        timer = setTimeout(() => { server.closeAllConnections(); reject(new Error('HTTPS shutdown exceeded its deadline.')); }, timeoutMs);
        server.close(error => error ? reject(error) : resolveClose()); server.closeIdleConnections();
      });
      try { await Promise.all([drain, engine.shutdown(timeoutMs)]); }
      finally { if (timer) clearTimeout(timer); }
    },
  };
}
