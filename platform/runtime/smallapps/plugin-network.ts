/**
 * The plugin network door. WebAssembly runs synchronously in a separate process with no sockets, so a
 * plugin never fetches anything itself: each tool declares its requests (method, exact HTTPS site,
 * path template, typed body) in the signed file, and Chausar performs them for it before the run,
 * once each, then hands the responses in as data. Keys come from a trusted credential broker keyed by the
 * verified publisher key id, the plugin name and the site, and never reach the plugin, the state or the ledger.
 * A credentialed answer is redacted before the plugin sees it and its body never returns to the caller.
 */
import { createHash } from 'node:crypto';
import { ChausarError, check } from '../contracts.ts';
import { canonical } from '../actions.ts';

export type RequestSpec = { method: 'GET' | 'POST'; site: string; path: string; body: 'none' | 'arguments'; maxResponseBytes: number; timeoutMs: number };
export type TransportRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null; timeoutMs: number; maxResponseBytes: number };
export type TransportResponse = { status: number; headers?: Record<string, string>; body: Uint8Array | string };
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;
/** Asked only for a plugin whose signature was verified with a currently trusted key; `keyId` is that key's id. */
export type CredentialBroker = (key: { keyId: string; plugin: string; site: string }) => Promise<Record<string, string> | null> | Record<string, string> | null;
/** One Network ledger line. No bodies, no keys, no query text: the path is kept only as a digest. */
export type LedgerEntry = { id: string; at: string; pluginId: string; plugin: string; digest: string; tool: string; memberId: string; site: string; method: 'GET' | 'POST'; pathDigest: string; requestBytes: number; responseBytes: number; status: number | null; outcome: 'ok' | 'refused' | 'failed'; code: string | null; credential: boolean; rpc?: string };
/** `sessionId` is an MCP session a server assigned (protocol versions before 2026-07-28). It is never logged or returned. */
export type Fetched = { site: string; method: 'GET' | 'POST'; status: number; contentType: string | null; text: string; bytes: number; credential: boolean; sessionId?: string };

export const NETWORK_LIMITS = { requests: 4, path: 512, response: 256 * 1024, minTimeout: 100, maxTimeout: 10_000, ledger: 1000, headers: 4 };
const SITE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PATH = /^\/[A-Za-z0-9\-._~/{}?=&%]*$/;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_-]{0,63})\}/g;
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** Structural check of one declared request. Returns false rather than throwing so files can still be inspected. */
export function requestShapeValid(value: unknown): value is RequestSpec {
  if (!plain(value) || Object.keys(value).sort().join() !== 'body,maxResponseBytes,method,path,site,timeoutMs') return false;
  if (!['GET', 'POST'].includes(value.method) || typeof value.site !== 'string' || !SITE.test(value.site)) return false;
  if (typeof value.path !== 'string' || value.path.length > NETWORK_LIMITS.path || !PATH.test(value.path) || value.path.replace(PLACEHOLDER, '').includes('{') || value.path.replace(PLACEHOLDER, '').includes('}')) return false;
  if (!['none', 'arguments'].includes(value.body) || (value.method === 'GET' && value.body !== 'none')) return false;
  return Number.isSafeInteger(value.maxResponseBytes) && value.maxResponseBytes > 0 && value.maxResponseBytes <= NETWORK_LIMITS.response
    && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= NETWORK_LIMITS.minTimeout && value.timeoutMs <= NETWORK_LIMITS.maxTimeout;
}
export const placeholders = (path: string) => [...path.matchAll(PLACEHOLDER)].map(match => match[1]);

/** Path placeholders must name required string or integer arguments, so a path is always fully determined. */
export function placeholdersBound(spec: RequestSpec, schema: Record<string, any>) {
  return placeholders(spec.path).every(name => Array.isArray(schema.required) && schema.required.includes(name) && ['string', 'integer'].includes(schema.properties?.[name]?.type));
}

/** The exact URL. Arguments are percent-encoded data; they can never change the scheme, host or port. */
/** A value that is, or percent-decodes to, `.` or `..` would remove a path segment, so it is refused. */
function dotSegment(value: string) {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    if (current === '.' || current === '..') return true;
    let next: string; try { next = decodeURIComponent(current); } catch { return false; }
    if (next === current) return false; current = next;
  }
  return true;
}
export function requestUrl(spec: RequestSpec, args: Record<string, unknown>): URL {
  const path = spec.path.replace(PLACEHOLDER, (_m, name: string) => {
    const value = String(args[name]);
    check(!dotSegment(value), 'PLUGIN_ARGUMENTS_INVALID', 'A path argument cannot be a dot segment.');
    return encodeURIComponent(value);
  });
  const url = new URL(`https://${spec.site}${path}`);
  check(url.protocol === 'https:' && url.hostname === spec.site && url.port === '' && !url.username && !url.password, 'PLUGIN_SITE_NOT_APPROVED', 'A plugin request may reach only its exact named site over HTTPS.');
  // The URL parser must not have rewritten the path (dot segments, normalisation): what is sent is exactly what was declared.
  check(`${url.pathname}${url.search}` === path, 'PLUGIN_REQUEST_INVALID', 'The request path would be changed on the way out.');
  return url;
}

export const pathDigest = (url: URL) => createHash('sha256').update(`${url.pathname}${url.search}`).digest('hex');

function credentialHeaders(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  check(plain(value) && Object.keys(value).length <= NETWORK_LIMITS.headers && Object.entries(value).every(([name, text]) => /^[A-Za-z0-9-]{1,64}$/.test(name) && !['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'accept'].includes(name.toLowerCase()) && !/^mcp-/i.test(name) && typeof text === 'string' && text.length > 0 && text.length <= 4096 && !/[\r\n\u0000]/.test(text)), 'PLUGIN_HOST_OPTIONS_INVALID', 'The credential broker returns a few plain headers.');
  return { ...value } as Record<string, string>;
}
/** The headers the broker would attach for this verified key, plugin and site; none without a verified key id. */
export async function credentialFor(broker: CredentialBroker | null, key: { keyId: string | null; plugin: string; site: string }): Promise<Record<string, string>> {
  return credentialHeaders(broker && key.keyId ? await broker({ keyId: key.keyId, plugin: key.plugin, site: key.site }) : null);
}

/**
 * Every form in which a site might echo a credential back: the whole header value, the token after an auth
 * scheme, and each of those JSON-escaped, URL-encoded (either hex case) and base64 / base64url encoded.
 */
export function secretForms(secrets: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    const parts = [secret, ...(/^[A-Za-z][A-Za-z0-9._~+-]*\s+(\S+)$/.exec(secret.trim())?.slice(1) ?? [])];
    for (const part of parts) {
      const base64 = Buffer.from(part, 'utf8').toString('base64'); const encoded = encodeURIComponent(part);
      for (const form of [part, JSON.stringify(part).slice(1, -1), encoded, encoded.replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase()), base64, base64.replace(/=+$/, ''), Buffer.from(part, 'utf8').toString('base64url')]) if (form.length >= 6) forms.add(form);
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}
/** Withhold any credential form a site echoes back, so a key can never reach the plugin through a response. */
export function redact(text: string, secrets: readonly string[]) { let out = text; for (const form of secretForms(secrets)) out = out.split(form).join('[withheld]'); return out; }

/**
 * Perform one declared request once. Returns the ledger fields and either the response as data or a typed
 * refusal. Never retries and never follows a redirect.
 */
export async function performRequest(input: { spec: RequestSpec; args: Record<string, unknown>; plugin: string; keyId: string | null; approvedSites: readonly string[]; transport: Transport; credentials: CredentialBroker | null; expectCredential?: boolean }): Promise<Sent> {
  const { spec } = input; const url = requestUrl(spec, input.args);
  return sendOnce({ ...input, site: spec.site, method: spec.method, url, headers: {}, body: spec.body === 'arguments' ? canonical(input.args) : null, timeoutMs: spec.timeoutMs, maxResponseBytes: spec.maxResponseBytes });
}

export type Sent = { ledger: Pick<LedgerEntry, 'site' | 'method' | 'pathDigest' | 'requestBytes' | 'responseBytes' | 'status' | 'outcome' | 'code' | 'credential'>; fetched?: Fetched; error?: ChausarError };
/**
 * The one door every plugin HTTP request goes through: the approved exact site only, any key from the broker
 * added here (and nothing sent if that differs from what was approved), one attempt, a deadline, a size cap,
 * redirects refused, and the answer redacted of every form of the key before anything reads it. `headers` are
 * fixed, non-secret protocol headers chosen by Chausar, never by a plugin.
 */
export async function sendOnce(input: { site: string; method: 'GET' | 'POST'; url: URL; headers: Record<string, string>; body: string | null; timeoutMs: number; maxResponseBytes: number; plugin: string; keyId: string | null; approvedSites: readonly string[]; transport: Transport; credentials: CredentialBroker | null; expectCredential?: boolean }): Promise<Sent> {
  const { url, body } = input;
  check(url.protocol === 'https:' && url.hostname === input.site && url.port === '' && !url.username && !url.password, 'PLUGIN_SITE_NOT_APPROVED', 'A plugin request may reach only its exact named site over HTTPS.');
  const base = { site: input.site, method: input.method, pathDigest: pathDigest(url), requestBytes: 0, responseBytes: 0, status: null as number | null, credential: false };
  const refuse = (code: string, message: string, extra: Partial<typeof base> = {}, outcome: 'refused' | 'failed' = 'refused') => ({ ledger: { ...base, ...extra, outcome, code }, error: new ChausarError(code, message) });
  if (!input.approvedSites.includes(input.site)) return refuse('PLUGIN_SITE_NOT_APPROVED', 'The owner has not approved this site for this plugin.');
  let headers: Record<string, string>;
  try { headers = await credentialFor(input.credentials, { keyId: input.keyId, plugin: input.plugin, site: input.site }); }
  catch (error) { return refuse(error instanceof ChausarError ? error.code : 'PLUGIN_CREDENTIAL_UNAVAILABLE', 'The credential for this site is unavailable.'); }
  const secrets = Object.values(headers); const credential = secrets.length > 0;
  // The approved preview said whether a key goes with this request; a different answer now sends nothing.
  if (input.expectCredential !== undefined && input.expectCredential !== credential) return refuse(credential ? 'PREVIEW_CHANGED' : 'PLUGIN_CREDENTIAL_UNAVAILABLE', 'Whether a key goes with this request changed since it was approved.');
  const requestBytes = body === null ? 0 : Buffer.byteLength(body);
  const request: TransportRequest = { url: url.href, method: input.method, headers: { accept: 'application/json, text/plain;q=0.9', ...(body === null ? {} : { 'content-type': 'application/json' }), ...input.headers, ...headers }, body, timeoutMs: input.timeoutMs, maxResponseBytes: input.maxResponseBytes };
  let timer: NodeJS.Timeout | undefined;
  let response: TransportResponse;
  try {
    response = await Promise.race([input.transport(request), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ChausarError('PLUGIN_NETWORK_TIMEOUT', 'The site did not answer in time.')), input.timeoutMs); })]);
  } catch (error) {
    const code = error instanceof ChausarError || (error as any)?.code === 'PLUGIN_RESPONSE_TOO_LARGE' ? String((error as any).code) : (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError' ? 'PLUGIN_NETWORK_TIMEOUT' : 'PLUGIN_NETWORK_FAILED';
    return refuse(['PLUGIN_NETWORK_TIMEOUT', 'PLUGIN_RESPONSE_TOO_LARGE', 'PLUGIN_REDIRECT_REFUSED'].includes(code) ? code : 'PLUGIN_NETWORK_FAILED', 'The single request to the site did not complete. It is not retried.', { requestBytes, credential }, 'failed');
  } finally { clearTimeout(timer); }
  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) return refuse('PLUGIN_NETWORK_FAILED', 'The site gave an unreadable answer.', { requestBytes, credential }, 'failed');
  if (status >= 300 && status < 400) return refuse('PLUGIN_REDIRECT_REFUSED', 'The site tried to send the request somewhere else. Redirects are refused.', { requestBytes, credential, status });
  const bytes = typeof response.body === 'string' ? Buffer.from(response.body, 'utf8') : Buffer.from(response.body ?? new Uint8Array());
  if (bytes.length > input.maxResponseBytes) return refuse('PLUGIN_RESPONSE_TOO_LARGE', 'The answer was larger than this request allows.', { requestBytes, credential, status, responseBytes: bytes.length }, 'failed');
  const contentType = typeof response.headers?.['content-type'] === 'string' ? response.headers['content-type'].slice(0, 100) : null;
  const session = response.headers?.['mcp-session-id'];
  return { ledger: { ...base, requestBytes, responseBytes: bytes.length, status, credential, outcome: 'ok', code: null }, fetched: { site: input.site, method: input.method, status, contentType, text: redact(new TextDecoder('utf-8').decode(bytes), secrets), bytes: bytes.length, credential, ...(typeof session === 'string' && session ? { sessionId: session } : {}) } };
}

/** Production transport: fetch with a redirect handed back unfollowed (and refused above), a deadline and a streamed size cap. */
export const fetchTransport: Transport = async request => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body ?? undefined, redirect: 'manual', signal: AbortSignal.timeout(request.timeoutMs) });
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => undefined); return { status: response.status, body: '' }; }
  const chunks: Uint8Array[] = []; let total = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > request.maxResponseBytes) { await reader.cancel().catch(() => undefined); throw new ChausarError('PLUGIN_RESPONSE_TOO_LARGE', 'The answer was larger than this request allows.'); }
    chunks.push(value);
  }
  const session = response.headers.get('mcp-session-id');
  return { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? '', ...(session ? { 'mcp-session-id': session } : {}) }, body: Buffer.concat(chunks) };
};
