import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HostedError, check } from './errors.ts';

export type HostedRequest = {
  method: string; path: string; params: Record<string, string>; query: URLSearchParams;
  headers: Record<string, string | undefined>; body: Buffer;
};
export type HostedResponse = { status: number; headers?: Record<string, string>; body?: unknown };
export type Handler = (request: HostedRequest) => Promise<HostedResponse> | HostedResponse;
type Route = { method: string; parts: string[]; handler: Handler; maxBody: number };

export const DEFAULT_MAX_BODY = 256 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin',
};

/** A small router that is testable without sockets: `handle` takes a plain request. */
export class Router {
  readonly #routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler, options: { maxBody?: number } = {}) {
    check(/^\/[A-Za-z0-9/:._-]*$/.test(pattern), 'ROUTE_INVALID', 'Route patterns are plain paths.', 500);
    this.#routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, maxBody: options.maxBody ?? DEFAULT_MAX_BODY });
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
  maxBody(method: string, path: string): number { const found = this.match(method, path); return typeof found === 'object' ? found.route.maxBody : DEFAULT_MAX_BODY; }
  async handle(input: { method: string; url: string; headers?: Record<string, string | undefined>; body?: Buffer }): Promise<HostedResponse> {
    let url: URL;
    try { url = new URL(input.url, 'http://hosted.invalid'); } catch { return problem(new HostedError('INVALID_REQUEST', 'The address is not valid.')); }
    const found = this.match(input.method, url.pathname);
    if (found === 'method') return problem(new HostedError('METHOD_NOT_ALLOWED', 'This address does not accept that method.', 405));
    if (!found) return problem(new HostedError('NOT_FOUND', 'Nothing is here.', 404));
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(input.headers ?? {})) headers[key.toLowerCase()] = value;
    const body = input.body ?? Buffer.alloc(0);
    if (body.length > found.route.maxBody) return problem(new HostedError('BODY_TOO_LARGE', 'The request is too large.', 413));
    try { return await found.route.handler({ method: input.method, path: url.pathname, params: found.params, query: url.searchParams, headers, body }); }
    catch (error) { return problem(error); }
  }
}

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
      const path = (() => { try { return new URL(url, 'http://hosted.invalid').pathname; } catch { return '/'; } })();
      const body = await readBody(request, router.maxBody(method, path));
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
      write(response, await router.handle({ method, url, headers, body }));
    } catch (error) { write(response, problem(error)); }
  });
  server.requestTimeout = 120000; server.headersTimeout = 20000;
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host ?? '0.0.0.0', () => resolve(server)); });
}
