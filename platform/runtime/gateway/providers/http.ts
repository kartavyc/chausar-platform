// The HTTP model routes (openai-responses, openai-compatible, ollama, managed): the endpoint rule and the bounded,
// no-redirect fetch (split out of gateway.ts, D11).
import { check, ChausarError } from '../../contracts.ts';
import type { RouteKind, HttpRequest, HttpResult } from '../model-request.ts';

export function validateEndpoint(endpoint: string, kind: RouteKind): string {
  let url: URL; try { url = new URL(endpoint); } catch { throw new ChausarError('INVALID_ENDPOINT', 'The route needs a valid endpoint URL.'); }
  check(!url.username && !url.password && !url.search && !url.hash, 'INVALID_ENDPOINT', 'Use an address with no user name, password, query or # part.');
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (kind === 'ollama') check(local && ['http:', 'https:'].includes(url.protocol), 'INVALID_ENDPOINT', 'Ollama must run on localhost.');
  else check(url.protocol === 'https:', 'INVALID_ENDPOINT', 'Cloud model endpoints must use HTTPS.');
  return url.toString();
}

export async function defaultHttp(request: HttpRequest): Promise<HttpResult> {
  const response = await fetch(request.endpoint, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs) });
  if (response.headers.has('location') || (response.status >= 300 && response.status < 400)) throw new ChausarError('REDIRECT_REFUSED', 'Model redirects are refused.');
  check(Number(response.headers.get('content-length') || 0) <= 1048576, 'RESPONSE_TOO_LARGE', 'The model returned too much data.');
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; check(size <= 1048576, 'RESPONSE_TOO_LARGE', 'The model returned too much data.'); chunks.push(value); } } finally { reader.releaseLock(); }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8'), endpoint: response.url, requestId: response.headers.get('x-request-id') || undefined };
}
