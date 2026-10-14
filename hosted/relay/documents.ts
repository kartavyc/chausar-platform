import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import type { Fetch, HostedDeps } from '../shared/module.ts';
import type { Router } from '../shared/http.ts';
import { fields, json, ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { isId, newId, openServer, sealServer } from '../shared/crypto.ts';
import type { Sql } from '../db/sql.ts';
import { PermanentJobError } from '../db/queue.ts';
import type { Job, Worker } from '../db/queue.ts';

/**
 * Documents sent from the phone (experimental). A document or image the opted-in owner sends on WhatsApp or
 * Telegram is downloaded by a worker job, encrypted in memory to each of the account's registered desktop keys
 * (X25519 with an ephemeral key, HKDF-SHA256, AES-256-GCM) and kept only as sealed bytes, its size, its media
 * type and when it arrived. The plaintext never reaches the disk or the database. A forwarded document is data:
 * nothing in it is read here, and the desktop holds it for review before anything is imported.
 */
export const DOCUMENT_JOB = 'relay.document';
export const DOCUMENT_FORMAT = 'chausar-relay-document-v1';
/** Magic (8 bytes), ephemeral public key (32), nonce (12), then the ciphertext with its 16-byte tag. */
export const DOCUMENT_MAGIC = Buffer.from('CHSDOC1\0', 'latin1');
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENTS_PER_DAY = 20;
export const DOCUMENT_KEEP_MS = 7 * 86400000;
const MAX_DEVICES = 10;
export const MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'] as const;
export type MediaType = typeof MEDIA_TYPES[number];
export type DocumentChannel = 'whatsapp' | 'telegram';

/** The AAD every sealed document carries: it cannot be moved to another account, device, document or type. */
export const documentAad = (accountId: string, deviceId: string, documentId: string, mediaType: string) =>
  Buffer.from(`${DOCUMENT_FORMAT}|${accountId}|${deviceId}|${documentId}|${mediaType}`);
const documentKey = (shared: Buffer, ephemeral: Buffer, recipient: Buffer) =>
  Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), DOCUMENT_FORMAT, 32));

/** A raw X25519 public key (32 bytes, strict base64), or null. */
export function rawPublicKey(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value || bytes.every(byte => byte === 0)) return null;
  try { createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: bytes.toString('base64url') }, format: 'jwk' }); } catch { return null; }
  return bytes;
}
/** Encrypts one document to one desktop public key. */
export function sealDocument(recipient: Buffer, aad: Buffer, plaintext: Buffer): Buffer {
  const pair = generateKeyPairSync('x25519');
  const ephemeral = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const shared = diffieHellman({ privateKey: pair.privateKey, publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: recipient.toString('base64url') }, format: 'jwk' }) });
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', documentKey(shared, ephemeral, recipient), nonce);
  cipher.setAAD(aad);
  return Buffer.concat([DOCUMENT_MAGIC, ephemeral, nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** What the bytes are, judged from the bytes; a CSV is accepted only when the provider also called it one. */
export function sniffMediaType(bytes: Buffer, declared: string | null): MediaType | null {
  if (bytes.length === 0) return null;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const base = (declared ?? '').split(';')[0].trim().toLowerCase();
  if (base !== 'text/csv' && base !== 'text/comma-separated-values') return null;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ? null : 'text/csv';
}

/** Downloads one provider media reference through the injected Fetch. Never writes to disk. */
export interface MediaSource {
  readonly channel: DocumentChannel;
  download(fetch: Fetch, ref: string, maxBytes: number): Promise<{ bytes: Buffer; declaredType: string | null }>;
}
async function get(fetch: Fetch, url: string, headers: Record<string, string>): Promise<Awaited<ReturnType<Fetch>>> {
  let response: Awaited<ReturnType<Fetch>>;
  try { response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(60000) }); }
  catch { throw new HostedError('PROVIDER_UNREACHABLE', 'The message provider could not be reached.', 502); }
  if (!response.ok) {
    const retry = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new HostedError(retry ? 'PROVIDER_FAILED' : 'PROVIDER_REFUSED', 'The message provider refused the download.', 502);
  }
  return response;
}
async function providerJson(fetch: Fetch, url: string, headers: Record<string, string>): Promise<any> {
  const response = await get(fetch, url, { accept: 'application/json', ...headers });
  const text = await response.text();
  check(text.length <= 65536, 'PROVIDER_REPLY_INVALID', 'The message provider reply was not understood.', 502);
  try { return JSON.parse(text); } catch { throw new HostedError('PROVIDER_REPLY_INVALID', 'The message provider reply was not understood.', 502); }
}
async function bounded(fetch: Fetch, url: string, headers: Record<string, string>, maxBytes: number): Promise<Buffer> {
  const response = await get(fetch, url, headers);
  const declared = (response.headers.get('content-length') ?? '').trim();
  check(!(/^[0-9]{1,20}$/.test(declared) && Number(declared) > maxBytes), 'DOCUMENT_TOO_LARGE', 'The document is too large.', 413);
  const bytes = Buffer.from(await response.arrayBuffer());
  check(bytes.length <= maxBytes, 'DOCUMENT_TOO_LARGE', 'The document is too large.', 413);
  return bytes;
}
const MEDIA_HOST = /(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/;
export function whatsappMedia(config: { accessToken: string }): MediaSource {
  check(/^[A-Za-z0-9_.-]{20,1000}$/.test(config.accessToken), 'RELAY_CONFIG_INVALID', 'The WhatsApp configuration is not valid.', 500);
  const auth = { authorization: `Bearer ${config.accessToken}` };
  return {
    channel: 'whatsapp',
    async download(fetch, ref, maxBytes) {
      check(/^[0-9A-Za-z_.-]{1,128}$/.test(ref), 'PROVIDER_REPLY_INVALID', 'The media reference is not valid.', 502);
      const media = await providerJson(fetch, `https://graph.facebook.com/v21.0/${ref}`, auth);
      let url: URL | undefined;
      try { url = typeof media?.url === 'string' && media.url.length <= 4096 ? new URL(media.url) : undefined; } catch { url = undefined; }
      check(url && url.protocol === 'https:' && !url.username && !url.password && !url.port && MEDIA_HOST.test(url.hostname), 'PROVIDER_REPLY_INVALID', 'The message provider reply was not understood.', 502);
      check(!(Number.isSafeInteger(media.file_size) && media.file_size > maxBytes), 'DOCUMENT_TOO_LARGE', 'The document is too large.', 413);
      const bytes = await bounded(fetch, url.href, auth, maxBytes);
      if (typeof media.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(media.sha256))
        check(createHash('sha256').update(bytes).digest('hex') === media.sha256.toLowerCase(), 'PROVIDER_FAILED', 'The download did not match the provider digest.', 502);
      return { bytes, declaredType: typeof media.mime_type === 'string' && media.mime_type.length <= 200 ? media.mime_type : null };
    },
  };
}
export function telegramMedia(config: { botToken: string }): MediaSource {
  check(/^[0-9]{3,20}:[A-Za-z0-9_-]{20,100}$/.test(config.botToken), 'RELAY_CONFIG_INVALID', 'The Telegram configuration is not valid.', 500);
  return {
    channel: 'telegram',
    async download(fetch, ref, maxBytes) {
      check(/^[A-Za-z0-9_-]{1,256}$/.test(ref), 'PROVIDER_REPLY_INVALID', 'The media reference is not valid.', 502);
      const reply = await providerJson(fetch, `https://api.telegram.org/bot${config.botToken}/getFile?file_id=${ref}`, {});
      const file = reply?.ok === true ? reply.result : undefined, path = file?.file_path;
      check(typeof path === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,255}$/.test(path) && !path.split('/').includes('..'), 'PROVIDER_REPLY_INVALID', 'The message provider reply was not understood.', 502);
      check(!(Number.isSafeInteger(file.file_size) && file.file_size > maxBytes), 'DOCUMENT_TOO_LARGE', 'The document is too large.', 413);
      return { bytes: await bounded(fetch, `https://api.telegram.org/file/bot${config.botToken}/${path}`, {}, maxBytes), declaredType: null };
    },
  };
}

export type RelayDocumentOptions = { whatsapp?: MediaSource | null; telegram?: MediaSource | null; maxBytes?: number; perDay?: number };
/** An inbound document as the webhook saw it: a provider reference, never content. */
export type InboundDocument = { channel: DocumentChannel; accountId: string | null; ref: string; declaredType: string | null; declaredSize: number | null };
export type RelayDocuments = {
  /** Called inside the inbound transaction. Stores nothing unless the opted-in owner has a registered desktop key. */
  received(sql: Sql, input: InboundDocument): Promise<boolean>;
  routes(router: Router): void;
  jobs(worker: Worker): void;
  sweep(): Promise<void>;
};

const isoOf = (value: unknown) => new Date(value as string).toISOString();
const indianDay = (at: Date) => new Date(at.getTime() + 330 * 60000).toISOString().slice(0, 10);

export function createRelayDocuments(deps: HostedDeps, options: RelayDocumentOptions = {}): RelayDocuments {
  const sources = { whatsapp: options.whatsapp ?? null, telegram: options.telegram ?? null };
  const maxBytes = options.maxBytes ?? DOCUMENT_MAX_BYTES, perDay = options.perDay ?? DOCUMENTS_PER_DAY;
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= DOCUMENT_MAX_BYTES && Number.isSafeInteger(perDay) && perDay >= 0, 'RELAY_CONFIG_INVALID', 'The document limits are not valid.', 500);
  const refKey = Buffer.from(hkdfSync('sha256', deps.pepper, 'chausar-relay', 'relay-document-ref', 32));
  const now = () => deps.clock();

  /** Keys of this account's desktop installs that are not revoked. */
  async function deviceKeys(sql: Sql, accountId: string): Promise<{ deviceId: string; publicKey: Buffer }[]> {
    const { rows } = await sql.query(`SELECT k.device_id, k.public_key FROM relay_device_keys k WHERE k.account_id = $1
      AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.id = k.device_id AND d.revoked_at IS NOT NULL) ORDER BY k.updated_at DESC LIMIT $2`, [accountId, MAX_DEVICES]);
    return rows.flatMap(row => { const key = rawPublicKey(row.public_key); return key ? [{ deviceId: row.device_id as string, publicKey: key }] : []; });
  }
  async function ownerOn(sql: Sql, accountId: string, channel: DocumentChannel): Promise<boolean> {
    const { rows: [row] } = await sql.query('SELECT status FROM relay_channels WHERE account_id = $1 AND channel = $2', [accountId, channel]);
    return row?.status === 'on' && (await deps.entitlements(accountId)).relay;
  }

  async function received(sql: Sql, input: InboundDocument): Promise<boolean> {
    if (!input.accountId || !sources[input.channel] || !/^[A-Za-z0-9_.-]{1,256}$/.test(input.ref)) return false;
    if (input.declaredSize !== null && input.declaredSize > maxBytes) return false;
    if (!await ownerOn(sql, input.accountId, input.channel)) return false;
    if (!(await deviceKeys(sql, input.accountId)).length) return false;
    const at = now(), day = indianDay(at);
    await sql.query('INSERT INTO relay_document_days (account_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING', [input.accountId, day]);
    const { rows: [counted] } = await sql.query('UPDATE relay_document_days SET received = received + 1 WHERE account_id = $1 AND day = $2 AND received < $3 RETURNING received', [input.accountId, day, perDay]);
    if (!counted) return false;
    const documentId = newId('doc');
    const ref = sealServer(refKey, JSON.stringify({ ref: input.ref, declaredType: input.declaredType }), `relay-document:${documentId}`);
    await deps.queue.enqueue({ type: DOCUMENT_JOB, accountId: input.accountId, payload: { documentId, channel: input.channel, receivedAt: at.toISOString(), ref }, dedupeKey: `relay-document:${documentId}` }, sql);
    return true;
  }

  async function collect(job: Job) {
    const { documentId, channel, receivedAt, ref } = job.payload as Record<string, unknown>;
    const accountId = job.accountId;
    if (!accountId || !isId(documentId, 'doc') || (channel !== 'whatsapp' && channel !== 'telegram') || typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt)) || typeof ref !== 'string')
      throw new PermanentJobError('JOB_PAYLOAD_INVALID');
    const source = sources[channel];
    if (!source) throw new PermanentJobError('CHANNEL_NOT_CONFIGURED');
    let media: { ref: string; declaredType: string | null };
    try { media = JSON.parse(openServer(refKey, ref, `relay-document:${documentId}`)); } catch { throw new PermanentJobError('JOB_PAYLOAD_INVALID'); }
    const expires = new Date(Date.parse(receivedAt) + DOCUMENT_KEEP_MS);
    // An owner who turned the channel off, or a desktop that has no key any more, gets nothing stored.
    if (expires <= now() || !await ownerOn(deps.sql, accountId, channel)) return;
    const keys = await deviceKeys(deps.sql, accountId);
    if (!keys.length) return;
    let downloaded: { bytes: Buffer; declaredType: string | null };
    try { downloaded = await source.download(deps.fetch, media.ref, maxBytes); }
    catch (error) {
      if (error instanceof HostedError && !['PROVIDER_UNREACHABLE', 'PROVIDER_FAILED'].includes(error.code)) throw new PermanentJobError(error.code);
      throw error;
    }
    const plaintext = downloaded.bytes;
    try {
      const mediaType = sniffMediaType(plaintext, downloaded.declaredType ?? media.declaredType);
      if (!mediaType) throw new PermanentJobError('DOCUMENT_TYPE_REFUSED');
      if (plaintext.length > maxBytes) throw new PermanentJobError('DOCUMENT_TOO_LARGE');
      await deps.sql.transaction(async tx => {
        for (const key of keys) await tx.query(`INSERT INTO relay_documents (id, document_id, account_id, device_id, channel, media_type, size_bytes, received_at, expires_at, sealed)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (document_id, device_id) DO NOTHING`,
          [newId('rdc'), documentId, accountId, key.deviceId, channel, mediaType, plaintext.length, receivedAt, expires.toISOString(),
            sealDocument(key.publicKey, documentAad(accountId, key.deviceId, documentId, mediaType), plaintext)]);
      });
    } finally { plaintext.fill(0); }
  }

  function routes(router: Router) {
    router.add('PUT', '/v1/relay/device-key', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { publicKey } = fields<{ publicKey: unknown }>(json(request), ['publicKey']);
      check(rawPublicKey(publicKey), 'DEVICE_KEY_INVALID', 'The device key is not a raw X25519 public key.');
      const at = now().toISOString();
      await deps.sql.query(`INSERT INTO relay_device_keys (account_id, device_id, public_key, updated_at) VALUES ($1, $2, $3, $4)
        ON CONFLICT (account_id, device_id) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = EXCLUDED.updated_at`, [accountId, deviceId, publicKey, at]);
      return ok({ deviceId, registered: true, updatedAt: at });
    });
    // Each install sees only the copies sealed to its own key.
    router.add('GET', '/v1/relay/documents', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { rows } = await deps.sql.query(`SELECT document_id, channel, media_type, size_bytes, received_at, expires_at FROM relay_documents
        WHERE account_id = $1 AND device_id = $2 AND expires_at > $3 ORDER BY received_at, document_id LIMIT 100`, [accountId, deviceId, now().toISOString()]);
      return ok({ documents: rows.map(row => ({ documentId: row.document_id, channel: row.channel, mediaType: row.media_type, sizeBytes: row.size_bytes,
        receivedAt: isoOf(row.received_at), expiresAt: isoOf(row.expires_at) })) });
    });
    router.add('GET', '/v1/relay/documents/:documentId', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { rows: [row] } = await deps.sql.query('SELECT sealed FROM relay_documents WHERE document_id = $1 AND account_id = $2 AND device_id = $3 AND expires_at > $4',
        [request.params.documentId, accountId, deviceId, now().toISOString()]);
      check(row, 'DOCUMENT_NOT_FOUND', 'There is no such document.', 404);
      const sealed = Buffer.from(row.sealed);
      return { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-chausar-sha256': createHash('sha256').update(sealed).digest('hex') }, body: sealed };
    });
    router.add('POST', '/v1/relay/documents/:documentId/ack', async request => {
      const { accountId, deviceId } = await deps.authenticate(request);
      const { disposition } = fields<{ disposition: unknown }>(json(request), ['disposition']);
      check(disposition === 'collected' || disposition === 'invalid', 'INVALID_REQUEST', 'The disposition is not valid.');
      const { rowCount } = await deps.sql.query('DELETE FROM relay_documents WHERE document_id = $1 AND account_id = $2 AND device_id = $3', [request.params.documentId, accountId, deviceId]);
      check(rowCount === 1, 'DOCUMENT_NOT_FOUND', 'There is no such document.', 404);
      return ok({ documentId: request.params.documentId, disposition });
    });
  }

  return {
    received, routes,
    jobs(worker) { worker.register(DOCUMENT_JOB, collect); },
    async sweep() {
      const at = now();
      await deps.sql.query('DELETE FROM relay_documents WHERE expires_at <= $1', [at.toISOString()]);
      await deps.sql.query('DELETE FROM relay_document_days WHERE day < $1::date', [indianDay(new Date(at.getTime() - 2 * 86400000))]);
    },
  };
}
