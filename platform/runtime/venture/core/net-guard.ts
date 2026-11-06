// Chausar venture launcher, core: the network guard for any web address an agent opens or a client or owner supplies
// (catalogue H16). Only http and https, never a name or password in the address, and never an address inside this
// computer or its network: private, loopback, link-local, cloud metadata and reserved ranges are refused in every
// spelling (decimal, octal, hex, short forms, IPv4 inside IPv6), before DNS and again after it. Every redirect hop is
// checked again with its own lookup, and the socket connects to the address that was checked, so a name cannot answer
// one way for the check and another way for the request. One deadline covers the whole chain.
// The pinned lookup and the hop-by-hop re-check follow the SSRF guards surveyed in the 2026-10-21 harvest (Lexware
// pinned-fetch.ts, Qwen-CUA safety.py, yominpost _is_public_url); this is a rewrite in TypeScript, not a copy.
import { lookup as systemLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ChausarError } from '../../contracts.ts';
import {checkUrlValue,literalAddress,type NetAddress} from './net-address.ts';
export {classifyAddress} from './net-address.ts';
export type {NetAddress,AddressKind} from './net-address.ts';

export type NetResolver = (hostname: string) => Promise<NetAddress[]>;
export type NetMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One request, already checked: the socket goes to `address` while the URL keeps its name for the Host header and TLS. */
export type PinnedTarget = {
  url: URL; address: string; family: 4 | 6; method: NetMethod; headers: Record<string, string>; body: string | Uint8Array | undefined;
  timeoutMs: number; maxBytes: number;
};
export type PinnedAnswer = { status: number; headers: Record<string, string>; body: Buffer };
export type PinnedSender = (target: PinnedTarget) => Promise<PinnedAnswer>;

export type GuardedRequest = {
  url: string; method?: NetMethod; headers?: Record<string, string>; body?: string | Uint8Array;
  timeoutMs?: number; maxBytes?: number; maxRedirects?: number;
};
export type GuardedResponse = { status: number; url: string; headers: Record<string, string>; body: Buffer; address: string; hops: string[] };

export const NET_LIMITS = Object.freeze({ timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024, maxRedirects: 5 });

export const NET_WORDS = Object.freeze({
  url: 'Chausar opens only plain web addresses (http or https) with no name or password in them.',
  address: 'This address points inside your computer or your network, so Chausar will not open it.',
  lookup: 'Chausar could not find this address.',
  redirect: 'The site tried to send this request somewhere else. Chausar does not follow that for this request.',
  signedIn: 'The site tried to send this request somewhere else. It carries a sign-in, so Chausar never follows that. Nothing more was sent.',
  hops: 'The site sent Chausar on too many hops. Nothing more was opened.',
  large: 'The site sent back more than Chausar reads.',
  timeout: 'The site did not answer in time. Chausar did not retry it.',
  failed: 'Chausar could not reach the site. Nothing was retried.',
});

const refuse = (code: string, words: string) => new ChausarError(code, words);

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export function checkUrl(raw:string):URL{return checkUrlValue(raw,refuse);}

/** The computer's own resolver: every address a name has, in the order the system gives them. */
export const systemResolver: NetResolver = async hostname => {
  const found = await systemLookup(hostname, { all: true, verbatim: true });
  return found.map(item => ({ address: item.address, family: item.family === 6 ? 6 : 4 }));
};

/**
 * The address to connect to. A literal is checked as it is; a name is looked up and every address it has must be
 * public, so a name that mixes a public and a private answer is refused whole. Returns the first address.
 */
export async function resolvePublic(hostname: string, resolve: NetResolver = systemResolver): Promise<NetAddress> {
  const literal = literalAddress(hostname);
  if (literal) {
    if (literal.kind !== 'public') throw refuse('NET_ADDRESS_REFUSED', NET_WORDS.address);
    return { address: literal.address, family: literal.family };
  }
  let found: NetAddress[];
  try { found = await resolve(hostname); } catch { throw refuse('NET_LOOKUP_FAILED', NET_WORDS.lookup); }
  if (!Array.isArray(found) || found.length === 0) throw refuse('NET_LOOKUP_FAILED', NET_WORDS.lookup);
  const checked = found.map(item => literalAddress(String(item?.address ?? '')));
  if (checked.some(item => !item || item.kind !== 'public')) throw refuse('NET_ADDRESS_REFUSED', NET_WORDS.address);
  return { address: checked[0]!.address, family: checked[0]!.family };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** A lookup that answers every name with the checked address, in both shapes Node asks for. */
export function pinnedLookup(checked: NetAddress) {
  return (_hostname: string, options: unknown, callback: (...args: any[]) => void) => {
    const all = typeof options === 'object' && options !== null && (options as { all?: unknown }).all === true;
    if (all) callback(null, [{ address: checked.address, family: checked.family }]);
    else callback(null, checked.address, checked.family);
  };
}

function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(', ') : value;
  return flat;
}

/**
 * The real sender: one request, no pooled socket, connected to the checked address while the URL keeps its name for
 * the Host header and the certificate check. The body stops at maxBytes and the whole request at timeoutMs.
 */
export function pinnedSend(target: PinnedTarget): Promise<PinnedAnswer> {
  const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<PinnedAnswer>((resolve, reject) => {
    let done = false;
    const finish = (error: ChausarError | null, answer?: PinnedAnswer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { outgoing.destroy(); reject(error); } else resolve(answer!);
    };
    const outgoing = send(target.url, { method: target.method, headers: target.headers, agent: false, lookup: pinnedLookup(target) as never }, incoming => {
      const declared = parseInt(String(incoming.headers['content-length'] ?? '0'), 10);
      if (declared > target.maxBytes) { incoming.destroy(); finish(refuse('NET_RESPONSE_TOO_LARGE', NET_WORDS.large)); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > target.maxBytes) { incoming.destroy(); finish(refuse('NET_RESPONSE_TOO_LARGE', NET_WORDS.large)); return; }
        chunks.push(chunk);
      });
      incoming.on('end', () => finish(null, { status: incoming.statusCode ?? 0, headers: flatHeaders(incoming.headers), body: Buffer.concat(chunks) }));
      incoming.on('error', () => finish(refuse('NET_FAILED', NET_WORDS.failed)));
    });
    const timer = setTimeout(() => finish(refuse('NET_TIMEOUT', NET_WORDS.timeout)), Math.max(1, target.timeoutMs));
    outgoing.on('error', () => finish(refuse('NET_FAILED', NET_WORDS.failed)));
    if (target.body !== undefined) outgoing.write(target.body);
    outgoing.end();
  });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);
/** A header name that carries a sign-in: the credential headers, or one naming a key, a token, a secret, a session or auth. */
const SIGN_IN_HEADER = /(?:api[-_]?key|key$|token|secret|session|auth|signature|password)/i;

/** A query parameter that carries a sign-in: a key, a token, a signature, a secret, a session, auth, a password or a code. */
const SIGN_IN_PARAM = /(?:key|token|sig|secret|session|auth|password|passwd|credential|code$)/i;

/**
 * 4J11 (H31): whether a request carries a sign-in (fail closed: a name that may hold one counts): a credential header
 * or a header naming a key, a token and the like, a name or password in the address, or such a query parameter
 * (?api_key=, ?access_token=, ?sig=, X-Amz-Signature and the like).
 */
export function signedIn(headers: Readonly<Record<string, string>>, url?: URL): boolean {
  if (Object.keys(headers).some(name => CREDENTIAL_HEADERS.has(name.toLowerCase()) || SIGN_IN_HEADER.test(name))) return true;
  if (!url) return false;
  return url.username !== '' || url.password !== '' || [...url.searchParams.keys()].some(name => SIGN_IN_PARAM.test(name));
}

function cleanHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === 'host' || typeof value !== 'string' || /[\r\n]/.test(value) || /[\r\n:]/.test(name)) continue;
    clean[lower] = value;
  }
  return clean;
}

/**
 * Fetches a web address through the guard: the address is checked, its name looked up and every answer checked, and
 * the request sent to the checked address. A redirect is followed only for GET and HEAD, at most maxRedirects times,
 * each hop checked and looked up again; credentials never follow a hop to another origin. One deadline covers it all.
 * Ink v2 wave 4 (4J11, H31): a request that carries a sign-in (signedIn) never follows a redirect at all, not even to
 * the same site: the redirect is refused and nothing more is sent.
 */
export async function guardedFetch(request: GuardedRequest, deps: { resolve?: NetResolver; send?: PinnedSender } = {}): Promise<GuardedResponse> {
  const resolve = deps.resolve ?? systemResolver;
  const send = deps.send ?? pinnedSend;
  const method: NetMethod = request.method ?? 'GET';
  const maxRedirects = request.maxRedirects ?? NET_LIMITS.maxRedirects;
  const maxBytes = request.maxBytes ?? NET_LIMITS.maxBytes;
  const deadline = Date.now() + (request.timeoutMs ?? NET_LIMITS.timeoutMs);
  let headers = cleanHeaders(request.headers);
  let url = checkUrl(request.url);
  const hops: string[] = [];
  for (let redirects = 0; ; redirects += 1) {
    if (Date.now() >= deadline) throw refuse('NET_TIMEOUT', NET_WORDS.timeout);
    const checked = await resolvePublic(url.hostname.replace(/\.$/, ''), resolve);
    hops.push(url.href);
    const answer = await send({ url, address: checked.address, family: checked.family, method, headers: { ...headers }, body: request.body, timeoutMs: deadline - Date.now(), maxBytes });
    if (Date.now() > deadline) throw refuse('NET_TIMEOUT', NET_WORDS.timeout);
    if (!REDIRECTS.has(answer.status)) return { status: answer.status, url: url.href, headers: answer.headers, body: answer.body, address: checked.address, hops };
    const location = answer.headers.location;
    if (!location || (method !== 'GET' && method !== 'HEAD')) throw refuse('NET_REDIRECT_REFUSED', NET_WORDS.redirect);
    if (signedIn(headers, url)) throw refuse('NET_REDIRECT_REFUSED', NET_WORDS.signedIn);
    if (redirects >= maxRedirects) throw refuse('NET_TOO_MANY_REDIRECTS', NET_WORDS.hops);
    let next: URL;
    try { next = new URL(location, url); } catch { throw refuse('NET_URL_REFUSED', NET_WORDS.url); }
    next = checkUrl(next.href);
    if (next.origin !== url.origin) headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name)));
    url = next;
  }
}
