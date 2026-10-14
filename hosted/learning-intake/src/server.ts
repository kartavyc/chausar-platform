/**
 * HTTP API of the learning intake service. Written and tested; not deployed.
 *
 * Errors are `{ error: { code } }` with a fixed upper-case code; no error ever carries request
 * content. VALUE_FOUND also carries `hits`, each naming a batch line and the kind of value found.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IntakeStore } from './store.ts';
import { canonical, IntakeError, validateRequest, type ValueHit } from './validate.ts';
import { LEARNING_SCHEMA, OPEN_BOXES } from './vocabulary.ts';

export type IntakeOptions = {
  store: IntakeStore;
  clock?: () => Date;
  open: boolean;
  maxBytes?: number;
  /** Requests per contributor per window; `false` turns the limit off. */
  rateLimit?: { max: number; windowMs: number } | false;
  /** Addresses of reverse proxies in front of the service. Only their `X-Forwarded-For` is believed. */
  trustedProxies?: readonly string[];
};
const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;
const bare = (address: string) => address.startsWith('::ffff:') ? address.slice(7) : address;
/**
 * The client the rate limit counts. A direct caller is its socket address. A caller that came
 * through a trusted proxy is the right-most `X-Forwarded-For` entry that is not itself a trusted
 * proxy; a malformed header, or one from an untrusted peer, is ignored.
 */
export function clientAddress(socketAddress: string | undefined, forwardedFor: string | undefined, trustedProxies: readonly string[] = []): string | undefined {
  if (!socketAddress) return undefined;
  const trusted = new Set(trustedProxies.map(bare)), peer = bare(socketAddress);
  if (!trusted.has(peer) || !forwardedFor || forwardedFor.length > 2000) return peer;
  const hops = forwardedFor.split(',').map(hop => bare(hop.trim()));
  if (!hops.every(hop => ADDRESS.test(hop))) return peer;
  for (let index = hops.length - 1; index >= 0; index--) if (!trusted.has(hops[index])) return hops[index];
  return hops[0] ?? peer;
}
export type IntakeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const STATUS: Record<string, number> = {
  INVALID_BATCH: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405, IDEMPOTENCY_CONFLICT: 409,
  TOO_LARGE: 413, VALUE_FOUND: 422, BOX_NOT_OPEN: 422, RATE_LIMITED: 429, INTERNAL_ERROR: 500, INTAKE_CLOSED: 503,
};
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Exactly the desktop's batch identifier, so the key can carry nothing else. */
const IDEMPOTENCY_KEY = /^sharebatch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[A-Za-z0-9_-]{1,64}$/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const header = (req: IncomingMessage, name: string) => { const value = req.headers[name]; return typeof value === 'string' ? value : undefined; };

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra,
  });
  res.end(text);
}
function fail(code: string, hits?: ValueHit[]): never { throw new IntakeError(code, hits); }
function need(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

/** Read the body up to `limit` bytes as strict UTF-8; a longer body is refused before it is held. */
async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const declared = Number(header(req, 'content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) { req.resume(); fail('TOO_LARGE'); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) { req.resume(); fail('TOO_LARGE'); }
    chunks.push(chunk as Buffer);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { return fail('INVALID_BATCH'); }
}

export function createIntakeHandler(options: IntakeOptions): IntakeHandler {
  const { store, open } = options;
  const clock = options.clock ?? (() => new Date());
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const limit = options.rateLimit === undefined ? { max: 30, windowMs: 60_000 } : options.rateLimit;
  const windows = new Map<string, { start: number; count: number }>();

  function contributor(req: IncomingMessage): string {
    const match = /^Bearer ([^\s]+)$/.exec(header(req, 'authorization') ?? '');
    need(match && TOKEN.test(match[1]), 'UNAUTHORIZED');
    return sha256(match[1]);
  }
  /** Per contributor, per address and overall: a fresh made-up token per request does not get past the address or global limit. */
  function throttle(contributorHash: string, req?: IncomingMessage) {
    if (!limit) return;
    const at = clock().getTime();
    if (windows.size > 10_000) for (const [key, window] of windows) if (at - window.start >= limit.windowMs) windows.delete(key);
    need(windows.size <= 50_000, 'RATE_LIMITED');
    const address = req ? clientAddress(req.socket?.remoteAddress, header(req, 'x-forwarded-for'), options.trustedProxies) : undefined;
    const keys: [string, number][] = [[`c:${contributorHash}`, limit.max], ...(address ? [[`a:${address}`, limit.max * 4] as [string, number]] : []), ['global', limit.max * 200]];
    for (const [key, max] of keys) {
      const window = windows.get(key);
      if (!window || at - window.start >= limit.windowMs) { windows.set(key, { start: at, count: 1 }); continue; }
      window.count += 1;
      need(window.count <= max, 'RATE_LIMITED');
    }
  }

  async function postBatch(req: IncomingMessage, res: ServerResponse) {
    need(open, 'INTAKE_CLOSED');
    const contributorHash = contributor(req);
    throttle(contributorHash, req);
    const key = header(req, 'idempotency-key'), deletionToken = header(req, 'x-deletion-token');
    need(key && IDEMPOTENCY_KEY.test(key), 'INVALID_BATCH');
    need(deletionToken && TOKEN.test(deletionToken), 'INVALID_BATCH');
    need(/^application\/json(?:\s*;.*)?$/i.test(header(req, 'content-type') ?? ''), 'INVALID_BATCH');
    const { batch, publicName } = validateRequest(await readBody(req, maxBytes));
    const bodyDigest = sha256(`${contributorHash}\n${canonical({ batch, contributor: { publicName } })}`);
    const { created, batch: stored } = await store.putBatch({
      reference: `lb_${randomBytes(16).toString('base64url')}`, idempotencyKey: key, contributorHash, publicName, bodyDigest,
      boxes: batch.boxes, events: batch.events, receivedAt: clock().toISOString(), deletionTokenHash: sha256(deletionToken),
    });
    if (!created) {
      need(stored.bodyDigest === bodyDigest, 'IDEMPOTENCY_CONFLICT');
      need(stored.deletedAt === null, 'NOT_FOUND');
    }
    const { credits } = await store.credits(contributorHash);
    send(res, created ? 201 : 200, { reference: stored.reference, accepted: stored.eventCount, credits, replayed: !created });
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://intake.invalid').pathname;
    const method = req.method ?? 'GET';
    const only = (allowed: string) => { if (method !== allowed) { req.resume(); send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: allowed }); return false; } return true; };
    if (path === '/v1/status') {
      if (only('GET')) send(res, 200, { open, schema: LEARNING_SCHEMA, boxes: OPEN_BOXES });
    } else if (path === '/v1/batches') {
      if (only('POST')) await postBatch(req, res);
    } else if (path.startsWith('/v1/batches/')) {
      if (!only('DELETE')) return;
      const reference = path.slice('/v1/batches/'.length);
      need(REFERENCE.test(reference), 'NOT_FOUND');
      const token = header(req, 'x-deletion-token');
      need(token && TOKEN.test(token), 'FORBIDDEN');
      const result = await store.deleteBatch(reference, sha256(token), clock().toISOString());
      need(result !== 'not-found', 'NOT_FOUND');
      need(result !== 'forbidden', 'FORBIDDEN');
      send(res, 200, { deleted: true });
    } else if (path === '/v1/credits') {
      if (!only('GET')) return;
      const contributorHash = contributor(req);
      throttle(contributorHash, req);
      send(res, 200, await store.credits(contributorHash));
    } else if (path === '/v1/credits/public') {
      if (only('GET')) send(res, 200, await store.publicCredits());
    } else {
      req.resume();
      fail('NOT_FOUND');
    }
  }

  return async (req, res) => {
    try { await route(req, res); } catch (error) {
      const code = error instanceof IntakeError && STATUS[error.code] ? error.code : 'INTERNAL_ERROR';
      const hits = error instanceof IntakeError && code === 'VALUE_FOUND' ? error.hits : undefined;
      if (res.headersSent) { res.destroy(); return; }
      send(res, STATUS[code], { error: hits ? { code, hits } : { code } }, code === 'TOO_LARGE' ? { connection: 'close' } : {});
    }
  };
}

/** Start the service on a real port. Binds to loopback unless a host is given. */
export async function startIntakeServer(options: IntakeOptions & { port: number; host?: string }): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const handler = createIntakeHandler(options);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host ?? '127.0.0.1', () => resolve()); });
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return { server, url: `http://${host}:${address.port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
