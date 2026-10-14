import { createHash } from 'node:crypto';
import { check, ChausarError } from '../contracts.ts';
import { boundedHttp, type BoundedHttp, type HttpRequest, type HttpResponse } from '../connectors.ts';

/**
 * Shared read side for API adapters. An adapter is a description: allowlisted origin, the first
 * request, how to page and how to parse. This runner owns the network rules: one bounded request at
 * a time, no redirects, byte, page, request and time budgets, and typed failures. The access token
 * comes from the engine's credential broker for one origin and is never stored, logged or returned.
 */
export type ReadRequest = { method: 'GET' | 'POST'; url: string; headers?: Record<string, string>; body?: string };
export type ParsedPage = {
  /** Source records as plain objects; numbers keep their source spelling. */
  records: Record<string, unknown>[];
  next: ReadRequest | null;
  /** What the source itself says about the whole result: a total count, a summed amount. */
  declared?: { rowCount?: number | null; amount?: string | null; amountUnit?: 'major' | 'minor'; reference?: string } | null;
  /** Detail requests to run, in order, before `next` (for example one invoice detail per listed id). Each counts against the budgets. */
  queue?: ReadRequest[];
};
/**
 * `header-keys`: the broker returns "id:secret" and the runner sets the two header names the spec
 * declares in `keyHeaders` (Cashfree). `payu-hash`: the broker returns "key:salt"; the runner adds
 * `key` to the form body and signs it as sha512(key|command|var1|salt). The adapter never sees either.
 */
export type AuthScheme = 'bearer' | 'basic' | 'zoho' | 'shopify' | 'header-keys' | 'payu-hash' | 'none';
export type ApiReadSpec<C> = {
  system: string; operation: string; version: string;
  /** OAuth scopes or key permissions the read needs. Shown to the person before sign-in. */
  scopes: readonly string[];
  auth: AuthScheme;
  /** For `header-keys`: the id header and the secret header, e.g. ['x-client-id', 'x-client-secret']. */
  keyHeaders?: readonly [string, string];
  /** Every request must stay on these origins, derived from validated configuration only. */
  origins(config: C): readonly string[];
  validate(config: C): C;
  first(config: C, period: { from: string; to: string } | null): ReadRequest;
  parse(body: string, response: { status: number; headers: Record<string, string>; url: string }, config: C, request: ReadRequest): ParsedPage;
};
export type CredentialRequest = { system: string; sourceId: string; origin: string; scopes: readonly string[]; scheme: AuthScheme };
export type ReadCredentials = (request: CredentialRequest) => Promise<string>;
export type ReadLimits = { maxPages: number; maxRequests: number; maxRecords: number; pageBytes: number; totalBytes: number; timeoutMs: number; totalTimeoutMs: number };
export const API_READ_LIMITS: ReadLimits = Object.freeze({ maxPages: 50, maxRequests: 60, maxRecords: 20_000, pageBytes: 4 * 1024 * 1024, totalBytes: 24 * 1024 * 1024, timeoutMs: 15_000, totalTimeoutMs: 120_000 });
export type ApiReadResult = {
  system: string; operation: string; version: string; records: Record<string, unknown>[];
  pages: number; requests: number; bytes: number; complete: true;
  declared: ParsedPage['declared'] | null; startedAt: string; finishedAt: string;
  /** Hosts and paths only: no query values, headers or tokens. */
  requestLog: { origin: string; path: string; status: number; bytes: number }[];
};
/** Fixed failure codes. A response body never becomes a message. */
export const READ_FAILURES = Object.freeze({
  401: 'SOURCE_SIGN_IN_EXPIRED', 403: 'SOURCE_PERMISSION_DENIED', 404: 'SOURCE_NOT_FOUND', 429: 'SOURCE_RATE_LIMITED',
});
const failure = (status: number): ChausarError => {
  const code = (READ_FAILURES as Record<number, string>)[status] ?? (status >= 500 ? 'SOURCE_UNAVAILABLE' : 'SOURCE_REQUEST_REFUSED');
  const messages: Record<string, string> = {
    SOURCE_SIGN_IN_EXPIRED: 'The sign-in for this system has expired. Sign in again.',
    SOURCE_PERMISSION_DENIED: 'This system refused the read. The sign-in lacks permission for this data.',
    SOURCE_NOT_FOUND: 'This system did not find the requested company or resource.',
    SOURCE_RATE_LIMITED: 'This system asked us to slow down. Nothing was retried; read again later.',
    SOURCE_UNAVAILABLE: 'This system is unavailable right now. Nothing was retried; read again later.',
    SOURCE_REQUEST_REFUSED: 'This system refused the request.',
  };
  return new ChausarError(code, messages[code]);
};
export function basicAuth(user: string, secret: string): string { return `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`; }
function pair(token: string): [string, string] {
  const at = token.indexOf(':'); check(at > 0 && at < token.length - 1, 'CREDENTIAL_REQUIRED', 'A key pair credential needs both parts.');
  return [token.slice(0, at), token.slice(at + 1)];
}
function authHeaders(scheme: AuthScheme, token: string, keyHeaders?: readonly [string, string]): Record<string, string> {
  if (scheme === 'none' || scheme === 'payu-hash') return {};
  check(typeof token === 'string' && token.length > 0 && token.length <= 8192 && !/[\r\n]/.test(token), 'CREDENTIAL_REQUIRED', 'The credential broker did not return a usable credential.');
  if (scheme === 'bearer') return { Authorization: `Bearer ${token}` };
  if (scheme === 'zoho') return { Authorization: `Zoho-oauthtoken ${token}` };
  if (scheme === 'shopify') return { 'X-Shopify-Access-Token': token };
  const [id, secret] = pair(token);
  if (scheme === 'header-keys') {
    check(keyHeaders && keyHeaders.every(name => /^x-[a-z0-9-]{1,60}$/.test(name)) && keyHeaders[0] !== keyHeaders[1], 'ADAPTER_INVALID', 'A header-key adapter names its two key headers.');
    return { [keyHeaders![0]]: id, [keyHeaders![1]]: secret };
  }
  // Basic: the broker returns "user:secret" (key id and key secret); it is encoded here and never kept.
  return { Authorization: basicAuth(id, secret) };
}
/** PayU form signing. The salt never leaves this function; the adapter supplies command and var1 only. */
export function payuSignedBody(body: string | undefined, token: string): string {
  check(typeof body === 'string' && body.length <= 4000, 'ADAPTER_INVALID', 'A signed PayU request is a form body.');
  const form = new URLSearchParams(body), [key, salt] = pair(token);
  check(!form.has('key') && !form.has('hash') && /^[a-z_]{3,60}$/.test(form.get('command') ?? '') && (form.get('var1') ?? '').length > 0, 'ADAPTER_INVALID', 'A signed PayU request carries command and var1, never the key or hash.');
  check(/^[A-Za-z0-9]{4,40}$/.test(key) && /^[A-Za-z0-9]{8,200}$/.test(salt), 'CREDENTIAL_REQUIRED', 'The PayU key or salt is not in the expected form.');
  const signed = new URLSearchParams({ key, command: form.get('command')!, var1: form.get('var1')! });
  for (const [name, value] of form) if (!['command', 'var1'].includes(name)) signed.set(name, value);
  signed.set('hash', createHash('sha512').update(`${key}|${form.get('command')}|${form.get('var1')}|${salt}`).digest('hex'));
  return signed.toString();
}
/** Header names and values the adapter may set; Authorization and cookies are the runner's alone. */
function adapterHeaders(headers: Record<string, string> = {}, reserved: readonly string[] = []): Record<string, string> {
  for (const [name, value] of Object.entries(headers)) check(!reserved.includes(name.toLowerCase()) && /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(name) && !/^(authorization|cookie|x-shopify-access-token|proxy-)/i.test(name)
    && typeof value === 'string' && value.length <= 2000 && !/[\r\n]/.test(value), 'ADAPTER_HEADER_REFUSED', 'Adapters cannot set credentials or unsafe headers.');
  return { ...headers };
}

export async function runApiRead<C>(spec: ApiReadSpec<C>, input: { config: C; sourceId: string; period?: { from: string; to: string } | null; credentials?: ReadCredentials; http?: BoundedHttp; limits?: Partial<ReadLimits>; now?: () => number }): Promise<ApiReadResult> {
  const config = spec.validate(structuredClone(input.config));
  const limits = { ...API_READ_LIMITS, ...input.limits }, now = input.now ?? Date.now, http = input.http ?? boundedHttp;
  for (const [key, value] of Object.entries(limits)) check(Number.isSafeInteger(value) && value > 0 && value <= (API_READ_LIMITS as any)[key], 'READ_LIMIT_INVALID', 'Read limits stay within the engine budget.');
  const origins = spec.origins(config).map(origin => new URL(origin).origin);
  check(origins.length > 0 && origins.every(origin => origin.startsWith('https://') || /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+$/.test(origin)), 'ENDPOINT_REFUSED', 'Reads use HTTPS, or a loopback port for a program on this computer.');
  const startedAt = now(), deadline = startedAt + limits.totalTimeoutMs, tokens = new Map<string, string>();
  const records: Record<string, unknown>[] = [], log: ApiReadResult['requestLog'] = [], seen = new Set<string>();
  const pending: ReadRequest[] = [spec.first(config, input.period ?? null)];
  let request: ReadRequest | undefined, pages = 0, requests = 0, bytes = 0, declared: ParsedPage['declared'] | null = null;
  const reserved = (spec.keyHeaders ?? []).map(name => name.toLowerCase());
  while ((request = pending.shift())) {
    check(pages < limits.maxPages, 'READ_PAGE_LIMIT', 'The source has more pages than one read allows. Choose a shorter period.');
    check(requests < limits.maxRequests && now() < deadline, 'READ_REQUEST_LIMIT', 'The read went over its request or time budget.');
    const url = new URL(request.url);
    check(origins.includes(url.origin) && !url.username && !url.password && !url.hash, 'ENDPOINT_REFUSED', 'The adapter asked for a host outside its allowlist.');
    const key = `${request.method} ${url.href} ${request.body ?? ''}`; check(!seen.has(key), 'READ_PAGINATION_LOOP', 'The source repeated a page. The read was stopped.'); seen.add(key);
    let token = tokens.get(url.origin);
    if (token === undefined && spec.auth !== 'none') {
      check(input.credentials, 'CREDENTIAL_BROKER_REQUIRED', 'Sign in to this system first. The engine credential broker is not configured.');
      token = await input.credentials!({ system: spec.system, sourceId: input.sourceId, origin: url.origin, scopes: spec.scopes, scheme: spec.auth });
      tokens.set(url.origin, token);
    }
    const requestBody = spec.auth === 'payu-hash' ? payuSignedBody(request.body, token ?? '') : request.body;
    const http_request: HttpRequest = { url: url.href, method: request.method, headers: { Accept: 'application/json', ...adapterHeaders(request.headers, reserved), ...authHeaders(spec.auth, token ?? '', spec.keyHeaders) },
      ...(requestBody !== undefined ? { body: requestBody } : {}), maxBytes: Math.min(limits.pageBytes, limits.totalBytes - bytes), timeoutMs: Math.max(1, Math.min(limits.timeoutMs, deadline - now())), redirect: 'error' };
    let response: HttpResponse; requests++;
    try { response = await http(http_request); }
    catch (error: any) { if (typeof error?.code === 'string' && /^HTTP_/.test(error.code)) throw error; throw new ChausarError('SOURCE_NETWORK_FAILED', 'The read could not reach the system. Nothing was retried.'); }
    const body = typeof response.body === 'string' ? Buffer.from(response.body) : Buffer.from(response.body);
    log.push({ origin: url.origin, path: url.pathname, status: response.status, bytes: body.length });
    check(!response.url || response.url === url.href, 'HTTP_REDIRECT_REFUSED', 'Redirected responses are refused.');
    check(body.length <= http_request.maxBytes, 'HTTP_BYTE_LIMIT', 'The response exceeds the byte limit.');
    bytes += body.length;
    if (response.status < 200 || response.status >= 300) throw failure(response.status);
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { throw new ChausarError('SOURCE_ENCODING_INVALID', 'The system returned text that is not UTF-8.'); }
    const headers = Object.fromEntries(Object.entries(response.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const page = spec.parse(text, { status: response.status, headers, url: url.href }, config, request);
    check(Array.isArray(page.records) && records.length + page.records.length <= limits.maxRecords, 'READ_ROW_LIMIT', 'The read returned more records than one import accepts.');
    pages++; records.push(...page.records);
    if (page.declared) {
      if (declared?.rowCount != null && page.declared.rowCount != null) check(declared.rowCount === page.declared.rowCount, 'SOURCE_TOTAL_CHANGED', 'The system changed its declared total during the read.');
      declared = { ...(declared ?? {}), ...page.declared };
    }
    check(!page.next || page.records.length > 0 || (page.queue?.length ?? 0) > 0, 'READ_PAGINATION_INVALID', 'The system offered another page after an empty one.');
    check(page.queue === undefined || (Array.isArray(page.queue) && page.queue.length <= limits.maxRequests), 'READ_REQUEST_LIMIT', 'The read asked for more detail requests than one read allows.');
    pending.unshift(...(page.queue ?? []), ...(page.next ? [page.next] : []));
  }
  if (declared?.rowCount != null) check(declared.rowCount === records.length, 'SOURCE_ROW_MISMATCH', 'The system declared a different number of records than it returned. The read is incomplete.');
  return { system: spec.system, operation: spec.operation, version: spec.version, records, pages, requests, bytes, complete: true, declared, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(now()).toISOString(), requestLog: log };
}

/** Recorded-response transport for tests and Practice: answers by method and URL, never by network. */
export function recordedHttp(responses: Record<string, { status?: number; body: string; headers?: Record<string, string> }>, calls: HttpRequest[] = []): BoundedHttp {
  return async request => {
    calls.push(structuredClone(request));
    const hit = responses[`${request.method} ${request.url}`];
    if (!hit) return { status: 404, body: '{}', url: request.url, headers: { 'content-type': 'application/json' } };
    return { status: hit.status ?? 200, body: hit.body, url: request.url, headers: { 'content-type': 'application/json', ...(hit.headers ?? {}) } };
  };
}
