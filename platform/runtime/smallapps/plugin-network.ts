/**
 * The plugin network door. WebAssembly runs synchronously in a separate process with no sockets, so a
 * plugin never fetches anything itself: each tool declares its requests (method, exact HTTPS site,
 * path template, typed body) in the signed file, and Chausar performs them for it before the run,
 * once each, then hands the responses in as data. Keys come from a trusted credential broker keyed by
 * (plugin, site) and never reach the plugin, the state or the ledger.
 */
import { createHash } from 'node:crypto';
import { ChausarError, check } from '../contracts.ts';
import { canonical } from '../actions.ts';

export type RequestSpec = { method: 'GET' | 'POST'; site: string; path: string; body: 'none' | 'arguments'; maxResponseBytes: number; timeoutMs: number };
export type TransportRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null; timeoutMs: number; maxResponseBytes: number };
export type TransportResponse = { status: number; headers?: Record<string, string>; body: Uint8Array | string };
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;
export type CredentialBroker = (key: { plugin: string; site: string }) => Promise<Record<string, string> | null> | Record<string, string> | null;
/** One Network ledger line. No bodies, no keys, no query text: the path is kept only as a digest. */
export type LedgerEntry = { id: string; at: string; pluginId: string; plugin: string; digest: string; tool: string; memberId: string; site: string; method: 'GET' | 'POST'; pathDigest: string; requestBytes: number; responseBytes: number; status: number | null; outcome: 'ok' | 'refused' | 'failed'; code: string | null; credential: boolean };
export type Fetched = { site: string; method: 'GET' | 'POST'; status: number; contentType: string | null; text: string; bytes: number };

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
export function requestUrl(spec: RequestSpec, args: Record<string, unknown>): URL {
  const path = spec.path.replace(PLACEHOLDER, (_m, name: string) => encodeURIComponent(String(args[name])));
  const url = new URL(`https://${spec.site}${path}`);
  check(url.protocol === 'https:' && url.hostname === spec.site && url.port === '' && !url.username && !url.password, 'PLUGIN_SITE_NOT_APPROVED', 'A plugin request may reach only its exact named site over HTTPS.');
  return url;
}

export const pathDigest = (url: URL) => createHash('sha256').update(`${url.pathname}${url.search}`).digest('hex');

function credentialHeaders(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  check(plain(value) && Object.keys(value).length <= NETWORK_LIMITS.headers && Object.entries(value).every(([name, text]) => /^[A-Za-z0-9-]{1,64}$/.test(name) && !['host', 'content-length', 'content-type', 'transfer-encoding', 'connection'].includes(name.toLowerCase()) && typeof text === 'string' && text.length > 0 && text.length <= 4096 && !/[\r\n\u0000]/.test(text)), 'PLUGIN_HOST_OPTIONS_INVALID', 'The credential broker returns a few plain headers.');
  return { ...value } as Record<string, string>;
}

/** Withhold any credential value a site echoes back, so a key can never reach the plugin through a response. */
function withhold(text: string, secrets: string[]) { let out = text; for (const secret of secrets) if (secret.length >= 6) out = out.split(secret).join('[withheld]'); return out; }

/**
 * Perform one declared request once. Returns the ledger fields and either the response as data or a typed
 * refusal. Never retries and never follows a redirect.
 */
export async function performRequest(input: { spec: RequestSpec; args: Record<string, unknown>; plugin: string; approvedSites: readonly string[]; transport: Transport; credentials: CredentialBroker | null }): Promise<{ ledger: Pick<LedgerEntry, 'site' | 'method' | 'pathDigest' | 'requestBytes' | 'responseBytes' | 'status' | 'outcome' | 'code' | 'credential'>; fetched?: Fetched; error?: ChausarError }> {
  const { spec } = input; const url = requestUrl(spec, input.args);
  const base = { site: spec.site, method: spec.method, pathDigest: pathDigest(url), requestBytes: 0, responseBytes: 0, status: null as number | null, credential: false };
  const refuse = (code: string, message: string, extra: Partial<typeof base> = {}, outcome: 'refused' | 'failed' = 'refused') => ({ ledger: { ...base, ...extra, outcome, code }, error: new ChausarError(code, message) });
  if (!input.approvedSites.includes(spec.site)) return refuse('PLUGIN_SITE_NOT_APPROVED', 'The owner has not approved this site for this plugin.');
  let headers: Record<string, string>;
  try { headers = credentialHeaders(input.credentials ? await input.credentials({ plugin: input.plugin, site: spec.site }) : null); }
  catch (error) { return refuse(error instanceof ChausarError ? error.code : 'PLUGIN_CREDENTIAL_UNAVAILABLE', 'The credential for this site is unavailable.'); }
  const secrets = Object.values(headers); const credential = secrets.length > 0;
  const body = spec.body === 'arguments' ? canonical(input.args) : null;
  const requestBytes = body === null ? 0 : Buffer.byteLength(body);
  const request: TransportRequest = { url: url.href, method: spec.method, headers: { accept: 'application/json, text/plain;q=0.9', ...(body === null ? {} : { 'content-type': 'application/json' }), ...headers }, body, timeoutMs: spec.timeoutMs, maxResponseBytes: spec.maxResponseBytes };
  let timer: NodeJS.Timeout | undefined;
  let response: TransportResponse;
  try {
    response = await Promise.race([input.transport(request), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ChausarError('PLUGIN_NETWORK_TIMEOUT', 'The site did not answer in time.')), spec.timeoutMs); })]);
  } catch (error) {
    const code = error instanceof ChausarError || (error as any)?.code === 'PLUGIN_RESPONSE_TOO_LARGE' ? String((error as any).code) : (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError' ? 'PLUGIN_NETWORK_TIMEOUT' : 'PLUGIN_NETWORK_FAILED';
    return refuse(['PLUGIN_NETWORK_TIMEOUT', 'PLUGIN_RESPONSE_TOO_LARGE', 'PLUGIN_REDIRECT_REFUSED'].includes(code) ? code : 'PLUGIN_NETWORK_FAILED', 'The single request to the site did not complete. It is not retried.', { requestBytes, credential }, 'failed');
  } finally { clearTimeout(timer); }
  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) return refuse('PLUGIN_NETWORK_FAILED', 'The site gave an unreadable answer.', { requestBytes, credential }, 'failed');
  if (status >= 300 && status < 400) return refuse('PLUGIN_REDIRECT_REFUSED', 'The site tried to send the request somewhere else. Redirects are refused.', { requestBytes, credential, status });
  const bytes = typeof response.body === 'string' ? Buffer.from(response.body, 'utf8') : Buffer.from(response.body ?? new Uint8Array());
  if (bytes.length > spec.maxResponseBytes) return refuse('PLUGIN_RESPONSE_TOO_LARGE', 'The answer was larger than this request allows.', { requestBytes, credential, status, responseBytes: bytes.length }, 'failed');
  const contentType = typeof response.headers?.['content-type'] === 'string' ? response.headers['content-type'].slice(0, 100) : null;
  return { ledger: { ...base, requestBytes, responseBytes: bytes.length, status, credential, outcome: 'ok', code: null }, fetched: { site: spec.site, method: spec.method, status, contentType, text: withhold(new TextDecoder('utf-8').decode(bytes), secrets), bytes: bytes.length } };
}

/** Production transport: fetch with redirects as errors, a deadline and a streamed size cap. */
export const fetchTransport: Transport = async request => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body ?? undefined, redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs) });
  const chunks: Uint8Array[] = []; let total = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > request.maxResponseBytes) { await reader.cancel().catch(() => undefined); throw new ChausarError('PLUGIN_RESPONSE_TOO_LARGE', 'The answer was larger than this request allows.'); }
    chunks.push(value);
  }
  return { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? '' }, body: Buffer.concat(chunks) };
};
