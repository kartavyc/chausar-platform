// Chausar venture launcher, notify (Ink v2 wave 4, package 4G3; spec 5.7, catalogue O13): web push with a count only.
// A phone alert is one push message whose payload is {"count":N} and nothing else, padded to one length so its size
// says nothing about the number, and encrypted for the browser that subscribed (RFC 8291 over the aes128gcm content
// coding of RFC 8188: an ephemeral P-256 key and a fresh salt for every message, so no two messages look alike). The
// push service sees an encrypted blob, a TTL of one hour, one fixed topic and the server's VAPID token (RFC 8292, ES256,
// 12 hours long); never a title, a name or a figure. Only https endpoints on the known push services are accepted.
// Code on node:crypto, no new dependency. The private VAPID key never comes here: the host's port signs
// (contracts.ts WebPushPort).
import { createCipheriv, createECDH, ECDH, hkdfSync, randomBytes } from 'node:crypto';
import { ChausarError, check } from '../../contracts.ts';
import type { WebPushPort } from '../contracts.ts';
import { checkUrl } from '../core/net-guard.ts';

/** How long a push service keeps an undelivered alert: one hour, after which the count is stale. */
export const PUSH_TTL_SECONDS = 3600;
/** One topic for every alert: a push service still holding an undelivered one replaces it with the newer count. */
export const PUSH_TOPIC = 'chausar-count';
/** Every payload is padded to this many bytes (the delimiter and zeros included), so its size hides the count. */
export const PUSH_PADDED_BYTES = 32;
/** The record size the header announces (RFC 8188); a count fits one record. */
const RECORD_SIZE = 4096;
/** A VAPID token lasts 12 hours (RFC 8292 allows at most 24). */
const VAPID_TTL_SECONDS = 12 * 3600;
export const MAX_ENDPOINT_LENGTH = 2048;

/**
 * The push services a subscription may name (a founder choice the plan lists: "the push service host list (4G3)"):
 * Google (Chrome, Android), Mozilla (Firefox) and Apple (Safari) by exact host; Microsoft (Edge) by the regional hosts
 * of the Windows notification service.
 */
export const PUSH_SERVICE_HOSTS = Object.freeze({
  exact: Object.freeze(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']),
  suffix: Object.freeze(['.notify.windows.com']),
});

const ENDPOINT_REFUSED = 'Phone alerts go only to a browser push service (Google, Mozilla, Microsoft or Apple) over https.';
const KEYS_WORDS = 'The browser sent push keys Chausar cannot use. Turn phone alerts off and on again in this browser.';
const ZERO = Buffer.from([0]);

/** A known push service's https endpoint, checked by the network guard too. Anything else is PUSH_ENDPOINT_REFUSED. */
export function pushServiceOf(endpoint: unknown): { url: URL; host: string } {
  check(typeof endpoint === 'string' && endpoint.length > 0 && endpoint.length <= MAX_ENDPOINT_LENGTH, 'PUSH_ENDPOINT_REFUSED', ENDPOINT_REFUSED);
  let url: URL;
  try { url = new URL(endpoint as string); } catch { throw new ChausarError('PUSH_ENDPOINT_REFUSED', ENDPOINT_REFUSED); }
  const host = url.hostname.toLowerCase();
  const known = PUSH_SERVICE_HOSTS.exact.includes(host) || PUSH_SERVICE_HOSTS.suffix.some(suffix => host.endsWith(suffix) && host.length > suffix.length);
  check(url.protocol === 'https:' && !url.username && !url.password && url.port === '' && !url.hash && !(endpoint as string).includes('#') && known,
    'PUSH_ENDPOINT_REFUSED', ENDPOINT_REFUSED);
  // The network guard's own check as well: never an address inside this computer or its network.
  try { checkUrl(url.href); } catch { throw new ChausarError('PUSH_ENDPOINT_REFUSED', ENDPOINT_REFUSED); }
  return { url, host };
}

/** base64url bytes of an exact length; padding '=' is allowed and dropped. */
function keyBytes(value: unknown, length: number): Buffer {
  check(typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9_-]+={0,2}$/.test(value), 'INVALID_VENTURE_REQUEST', KEYS_WORDS);
  const text = (value as string).replace(/=+$/, '');
  const bytes = Buffer.from(text, 'base64url');
  check(bytes.length === length && bytes.toString('base64url') === text, 'INVALID_VENTURE_REQUEST', KEYS_WORDS);
  return bytes;
}

/**
 * A browser's push keys, checked and in one spelling: p256dh an uncompressed P-256 point on the curve (65 bytes), auth
 * a 16-byte secret, both base64url. Anything else could never be encrypted to, so it is refused.
 */
export function subscriptionKeys(value: unknown): { p256dh: string; auth: string } {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', KEYS_WORDS);
  const keys = value as Record<string, unknown>;
  check(Object.keys(keys).every(key => key === 'p256dh' || key === 'auth'), 'INVALID_VENTURE_REQUEST', KEYS_WORDS);
  const point = keyBytes(keys.p256dh, 65);
  check(point[0] === 4, 'INVALID_VENTURE_REQUEST', KEYS_WORDS);
  try { ECDH.convertKey(point, 'prime256v1', undefined, undefined, 'uncompressed'); }
  catch { throw new ChausarError('INVALID_VENTURE_REQUEST', KEYS_WORDS); }
  return { p256dh: point.toString('base64url'), auth: keyBytes(keys.auth, 16).toString('base64url') };
}

/** The payload of a phone alert: {"count":N} and nothing else. */
export function pushPayload(count: unknown): string {
  check(Number.isSafeInteger(count) && (count as number) >= 0, 'INVALID_VENTURE_REQUEST', 'A phone alert carries a whole count.');
  return JSON.stringify({ count });
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/**
 * RFC 8291: the message for one browser. The server key and the salt are fresh each time; tests pass the RFC's own to
 * check the vector. padTo: the plaintext length after padding (the 0x02 delimiter and zeros), PUSH_PADDED_BYTES by
 * default; 0 adds the delimiter only.
 */
export function encryptPush(plaintext: Uint8Array, keys: { p256dh: string; auth: string }, options: { asPrivate?: Buffer; salt?: Buffer; padTo?: number } = {}): Buffer {
  const uaPublic = Buffer.from(keys.p256dh, 'base64url');
  const auth = Buffer.from(keys.auth, 'base64url');
  const server = createECDH('prime256v1');
  if (options.asPrivate) server.setPrivateKey(options.asPrivate); else server.generateKeys();
  const asPublic = server.getPublicKey();
  const ikm = hkdf(auth, server.computeSecret(uaPublic), Buffer.concat([Buffer.from('WebPush: info', 'latin1'), ZERO, uaPublic, asPublic]), 32);
  const salt = options.salt ?? randomBytes(16);
  check(salt.length === 16, 'INVALID_VENTURE_REQUEST', 'A push salt is 16 bytes.');
  const cek = hkdf(salt, ikm, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm', 'latin1'), ZERO]), 16);
  const nonce = hkdf(salt, ikm, Buffer.concat([Buffer.from('Content-Encoding: nonce', 'latin1'), ZERO]), 12);
  const length = Math.max(plaintext.length + 1, options.padTo ?? PUSH_PADDED_BYTES);
  check(length + 16 <= RECORD_SIZE, 'INVALID_VENTURE_REQUEST', 'A phone alert is a count, nothing longer.');
  const record = Buffer.alloc(length);
  record.set(plaintext);
  record[plaintext.length] = 2;
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, sealed]);
}

const base64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

/** RFC 8292: the Authorization header for one push service origin, signed by the host's port. */
export function vapidAuthorization(port: WebPushPort, audience: string, nowMs: number): string {
  const claims = { aud: audience, exp: Math.floor(nowMs / 1000) + VAPID_TTL_SECONDS, ...(port.subject ? { sub: port.subject } : {}) };
  const signingInput = `${base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${base64url(JSON.stringify(claims))}`;
  const signature = Buffer.from(port.sign(Buffer.from(signingInput, 'utf8')));
  check(signature.length === 64, 'INVALID_VENTURE_REQUEST', 'The push key gave a signature of the wrong length.');
  return `vapid t=${signingInput}.${signature.toString('base64url')}, k=${port.publicKey}`;
}

/** One push request, ready for the network guard: the endpoint, the encrypted count and the headers, nothing more. */
export function pushRequest(port: WebPushPort, browser: { endpoint: string; keys: { p256dh: string; auth: string } }, count: number, nowMs: number):
  { url: string; body: Buffer; headers: Record<string, string> } {
  const { url } = pushServiceOf(browser.endpoint);
  const body = encryptPush(Buffer.from(pushPayload(count), 'utf8'), browser.keys);
  return {
    url: url.href, body,
    headers: {
      ttl: String(PUSH_TTL_SECONDS), urgency: 'normal', topic: PUSH_TOPIC,
      'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', 'content-length': String(body.length),
      authorization: vapidAuthorization(port, url.origin, nowMs),
    },
  };
}
