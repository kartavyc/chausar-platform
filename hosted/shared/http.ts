import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HostedError, check } from './errors.ts';

export type HostedRequest = {
  method: string; path: string; params: Record<string, string>; query: URLSearchParams;
  headers: Record<string, string | undefined>; body: Buffer;
};
export type HostedResponse = { status: number; headers?: Record<string, string>; body?: unknown };
export type Handler = (request: HostedRequest) => Promise<HostedResponse> | HostedResponse;
export type HeaderMap = Record<string, string | undefined>;
/** `authenticateFirst` runs on the headers alone, before a byte of the body is read; it throws to refuse. */
export type RouteOptions = { maxBody?: number; authenticateFirst?: (headers: HeaderMap) => Promise<unknown> };
type Route = { method: string; parts: string[]; handler: Handler; maxBody: number; authenticateFirst?: RouteOptions['authenticateFirst'] };

export const DEFAULT_MAX_BODY = 256 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin',
};

/** A small router that is testable without sockets: `handle` takes a plain request. */
export class Router {
  readonly #routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler, options: RouteOptions = {}) {
    check(/^\/[A-Za-z0-9/:._-]*$/.test(pattern), 'ROUTE_INVALID', 'Route patterns are plain paths.', 500);
    this.#routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, maxBody: options.maxBody ?? DEFAULT_MAX_BODY, authenticateFirst: options.authenticateFirst });
    return this;
  }
  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | undefined {
    const parts = path.split('/').filter(Boolean); let wrongMethod = false;
    for (const route of this.#routes) {
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {}; let ok = true;
      for (let i = 0; i < parts.length && ok; i++) {
        const want = route.parts[i];
        if (want.startsWith(':')) { if (!/^[A-Za-z0-9_.-]{1,200}$/.test(parts[i])) ok = false; else params[want.slice(1)] = parts[i]; }
        else ok = want === parts[i];
      }
      if (!ok) continue;
      if (route.method !== method) { wrongMethod = true; continue; }
      return { route, params };
    }
    return wrongMethod ? 'method' : undefined;
  }
  /**
   * What can be refused from the request line and headers alone: an unknown address, a declared length above the
   * route's limit, and a failed `authenticateFirst`. `serve` calls it before reading the body; `handle` calls it too.
   */
  async preflight(method: string, url: string, headers: HeaderMap): Promise<{ route: Route; params: Record<string, string>; path: string; query: URLSearchParams } | HostedResponse> {
    let parsed: URL;
    try { parsed = new URL(url, 'http://hosted.invalid'); } catch { return problem(new HostedError('INVALID_REQUEST', 'The address is not valid.')); }
    const found = this.match(method, parsed.pathname);
    if (found === 'method') return problem(new HostedError('METHOD_NOT_ALLOWED', 'This address does not accept that method.', 405));
    if (!found) return problem(new HostedError('NOT_FOUND', 'Nothing is here.', 404));
    const declared = (headers['content-length'] ?? '').trim();
    if (/^[0-9]{1,20}$/.test(declared) && Number(declared) > found.route.maxBody) return problem(new HostedError('BODY_TOO_LARGE', 'The request is too large.', 413));
    if (found.route.authenticateFirst) { try { await found.route.authenticateFirst(headers); } catch (error) { return problem(error); } }
    return { ...found, path: parsed.pathname, query: parsed.searchParams };
  }
  async handle(input: { method: string; url: string; headers?: HeaderMap; body?: Buffer }, preflighted?: Awaited<ReturnType<Router['preflight']>>): Promise<HostedResponse> {
    const headers: HeaderMap = {};
    for (const [key, value] of Object.entries(input.headers ?? {})) headers[key.toLowerCase()] = value;
    const found = preflighted ?? await this.preflight(input.method, input.url, headers);
    if (!('route' in found)) return found;
    const body = input.body ?? Buffer.alloc(0);
    if (body.length > found.route.maxBody) return problem(new HostedError('BODY_TOO_LARGE', 'The request is too large.', 413));
    try { return await found.route.handler({ method: input.method, path: found.path, params: found.params, query: found.query, headers, body }); }
    catch (error) { return problem(error); }
  }
}

/** For `authenticateFirst`: runs a module's authenticator on the headers alone. */
export const headersOnly = (authenticate: (request: HostedRequest) => Promise<unknown>) => (headers: HeaderMap) =>
  authenticate({ method: '', path: '', params: {}, query: new URLSearchParams(), headers, body: Buffer.alloc(0) });

export function problem(error: unknown): HostedResponse {
  if (error instanceof HostedError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  return { status: 500, body: { error: { code: 'SERVER_ERROR', message: 'The server could not complete the request.' } } };
}
export function json<T = any>(request: HostedRequest): T {
  check((request.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json', 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.', 415);
  let value: unknown;
  try { value = JSON.parse(request.body.toString('utf8')); } catch { throw new HostedError('INVALID_JSON', 'The request body is not valid JSON.'); }
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_REQUEST', 'Send a JSON object.');
  return value as T;
}
/** Exact keys: unknown fields are refused rather than ignored. */
export function fields<T extends Record<string, unknown>>(value: any, required: readonly string[], optional: readonly string[] = []): T {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_REQUEST', 'Send a JSON object.');
  for (const key of Object.keys(value)) check(required.includes(key) || optional.includes(key), 'INVALID_REQUEST', 'The request has an unexpected field.');
  for (const key of required) check(Object.hasOwn(value, key), 'INVALID_REQUEST', 'The request is missing a field.');
  return value as T;
}
export const ok = (body: unknown, status = 200): HostedResponse => ({ status, body });
export function bearer(request: HostedRequest): string {
  const value = request.headers.authorization ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(value);
  check(match, 'UNAUTHENTICATED', 'Sign in first.', 401);
  return match[1];
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HostedError('BODY_TOO_LARGE', 'The request is too large.', 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
function write(response: ServerResponse, result: HostedResponse) {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, ...(result.headers ?? {}) };
  let payload: Buffer | string = '';
  if (Buffer.isBuffer(result.body)) payload = result.body;
  else if (typeof result.body === 'string') payload = result.body;
  else if (result.body !== undefined) { payload = JSON.stringify(result.body); headers['content-type'] ??= 'application/json; charset=utf-8'; }
  response.writeHead(result.status, headers); response.end(payload);
}
/** Plain HTTP behind the TLS-terminating proxy named in DEPLOY.md. */
export function serve(router: Router, options: { port: number; host?: string }): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET', url = request.url ?? '/';
      const headers: HeaderMap = {};
      for (const [key, value] of Object.entries(request.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
      // Refused from the headers alone (too large, not signed in) before the body is read, so nobody can make the server hold it.
      const found = await router.preflight(method, url, headers);
      if (!('route' in found)) { write(response, { ...found, headers: { ...found.headers, connection: 'close' } }); return; }
      const body = await readBody(request, found.route.maxBody);
      write(response, await router.handle({ method, url, headers, body }, found));
    } catch (error) { write(response, problem(error)); }
  });
  server.requestTimeout = 120000; server.headersTimeout = 20000;
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host ?? '0.0.0.0', () => resolve(server)); });
}
