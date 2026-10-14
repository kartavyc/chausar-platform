import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { Socket } from 'node:net';
import { check, ChausarError } from '../contracts.ts';
import type { Dialer, LineSocket, MailEndpoint, Transport, WireMethod, WireObject, WireRequest, WireResponse } from './types.ts';

export const WIRE_LIMITS = Object.freeze({ timeoutMs: 20000, maxBytes: 4 * 1024 * 1024, lineBytes: 64 * 1024 });

/** The production HTTP transport: one bounded request, redirects refused, no retries. */
export const realTransport: Transport = async request => {
  check(/^https:\/\//.test(request.url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(request.url), 'WRITE_ORIGIN_REFUSED', 'Writes go only to HTTPS origins or this computer.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), WIRE_LIMITS.timeoutMs);
  try {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: controller.signal });
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > WIRE_LIMITS.maxBytes) { await reader.cancel().catch(() => {}); throw new ChausarError('WIRE_BYTE_LIMIT', 'The reply exceeded its byte limit.'); }
      chunks.push(value);
    }
    const headers: Record<string, string> = {}; response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    return { status: response.status, headers, body: Buffer.concat(chunks).toString('utf8') };
  } finally { clearTimeout(timer); }
};

/** Builds a request with a JSON or form body. Header names are lower case. */
export function wire(method: WireMethod, url: string, headers: Record<string, string>, body?: WireObject | string, contentType = 'application/json'): WireRequest {
  const lower: Record<string, string> = { accept: 'application/json' };
  for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;
  if (body !== undefined) lower['content-type'] = contentType;
  return { method, url, headers: lower, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) };
}

/** Parses a JSON reply. Status codes outside `ok` are refused with a fixed code; the reply text is never echoed. */
export function json(response: WireResponse, ok: readonly number[] = [200, 201]): any {
  check(ok.includes(response.status), response.status === 401 || response.status === 403 ? 'WRITE_AUTH_REFUSED' : response.status === 404 ? 'WRITE_TARGET_NOT_FOUND' : response.status === 429 ? 'WRITE_RATE_LIMITED' : 'WRITE_SYSTEM_REFUSED', 'The system refused the request.');
  try { return response.body === '' ? {} : JSON.parse(response.body); } catch { throw new ChausarError('WRITE_REPLY_INVALID', 'The system sent a reply that is not valid JSON.'); }
}

/** Redacts credentials before a request is shown or logged. */
export function redact(request: WireRequest): { method: string; target: string; body: string | null } {
  const url = new URL(request.url); for (const name of [...url.searchParams.keys()]) if (/key|token|secret|signature|password/i.test(name)) url.searchParams.set(name, 'redacted');
  return { method: request.method, target: `${url.host}${url.pathname}${url.search}`, body: request.body ?? null };
}

class SocketLines implements LineSocket {
  #socket: Socket | TLSSocket; #buffer = ''; #waiters: ((line: string | Error) => void)[] = []; #lines: string[] = []; #error: Error | null = null;
  #endpoint: MailEndpoint;
  constructor(socket: Socket | TLSSocket, endpoint: MailEndpoint) { this.#endpoint = endpoint; this.#socket = socket; this.#attach(socket); }
  #attach(socket: Socket | TLSSocket) {
    socket.setEncoding('utf8'); socket.setTimeout(WIRE_LIMITS.timeoutMs, () => this.#fail(new ChausarError('MAIL_TIMEOUT', 'The mail server stopped answering.')));
    socket.on('data', (chunk: string) => {
      this.#buffer += chunk; if (this.#buffer.length > WIRE_LIMITS.lineBytes) return this.#fail(new ChausarError('MAIL_LINE_LIMIT', 'The mail server sent an overlong line.'));
      let at: number; while ((at = this.#buffer.indexOf('\r\n')) >= 0) { const line = this.#buffer.slice(0, at); this.#buffer = this.#buffer.slice(at + 2); const waiter = this.#waiters.shift(); if (waiter) waiter(line); else this.#lines.push(line); }
    });
    socket.on('error', () => this.#fail(new ChausarError('MAIL_CONNECTION_LOST', 'The mail connection was lost.')));
    socket.on('close', () => this.#fail(new ChausarError('MAIL_CONNECTION_LOST', 'The mail connection was lost.')));
  }
  #fail(error: Error) { this.#error ??= error; for (const waiter of this.#waiters.splice(0)) waiter(error); this.#socket.destroy(); }
  readLine(): Promise<string> {
    const line = this.#lines.shift(); if (line !== undefined) return Promise.resolve(line);
    if (this.#error) return Promise.reject(this.#error);
    return new Promise((resolve, reject) => this.#waiters.push(value => value instanceof Error ? reject(value) : resolve(value)));
  }
  write(data: string): Promise<void> { return new Promise((resolve, reject) => this.#socket.write(data, error => error ? reject(new ChausarError('MAIL_CONNECTION_LOST', 'The mail connection was lost.')) : resolve())); }
  async upgrade() {
    const plain = this.#socket; plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error');
    const secure = await new Promise<TLSSocket>((resolve, reject) => { const socket = tlsConnect({ socket: plain as Socket, servername: this.#endpoint.host }, () => resolve(socket)); socket.once('error', () => reject(new ChausarError('MAIL_TLS_FAILED', 'The mail server did not complete a secure connection.'))); });
    this.#socket = secure; this.#buffer = ''; this.#attach(secure);
  }
  close() { this.#socket.end(); }
}

/** The production mail dialer: implicit TLS or STARTTLS, certificate verified, one session. */
export const realDialer: Dialer = endpoint => new Promise((resolve, reject) => {
  check(typeof endpoint.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(endpoint.host) && Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port < 65536, 'MAIL_ENDPOINT_INVALID', 'Give the mail server name and port.');
  const socket = endpoint.security === 'implicit-tls' ? tlsConnect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host }) : tcpConnect({ host: endpoint.host, port: endpoint.port });
  socket.once(endpoint.security === 'implicit-tls' ? 'secureConnect' : 'connect', () => resolve(new SocketLines(socket, endpoint)));
  socket.once('error', () => reject(new ChausarError('MAIL_CONNECTION_FAILED', 'The mail server could not be reached.')));
});
